// ============================================================
// CORE ENGINE - MapPlanner
// Main application state, grid management, and core functions
// FIXED: Context menu logic, error handling, null checks
// ============================================================

(function(){
  const Core = {};

  // ============================================================
  // GRID CONFIGURATION
  // ============================================================
  Core.GRID = 180;
  Core.SIZE = { X:3, Y:3, P:6 };
  Core.TYPES = { X:'X', Y:'Y', P:'P' };
  Core.FILL = {
    X:'rgba(74,163,255,0.5)',
    Y:'rgba(255,216,74,0.5)',
    P:'#ff66ff'
  };
  Core.BORDER='rgba(240,240,255,0.28)';
  Core.BORDER_SEL='#00e5ff';

  // ============================================================
  // DOM HELPERS
  // ============================================================
  Core.$ = id => document.getElementById(id);
  Core.canvas = null;
  Core.ctx = null;

  // ============================================================
  // APPLICATION STATE
  // ============================================================
  Core.items = [];
  Core.idSeq = 1;
  Core.selectionMode = false;
  Core.selected = new Set();
  Core.lassoStart = null;
  Core.clipboard = [];
  Core.legendLabels = {};
  Core.lastPaintRC = null;
  Core.mode = 'draw'; // modes: draw | select | view

  // ============================================================
  // DIRTY FLAGS FOR RENDER OPTIMIZATION
  // ============================================================
  Core._stateVersion = 0;
  Core._lastRenderVersion = -1;
  Core._dirtyFlags = {
    items: false,
    selection: false,
    view: false,
    legend: false
  };

  // ============================================================
  // HISTORY MANAGEMENT (UNDO/REDO)
  // ============================================================
  Core.history = {
    undo: [],
    redo: [],
    maxSize: 100,
    
    push(action) {
      this.undo.push({
        version: Core._stateVersion++,
        timestamp: Date.now(),
        action: action
      });
      if(this.undo.length > this.maxSize) this.undo.shift();
      this.redo.length = 0;
      Core.markDirty('items');
    },
    
    createSnapshot() {
      return {
        items: JSON.parse(JSON.stringify(Core.items)),
        idSeq: Core.idSeq,
        legendLabels: {...Core.legendLabels},
        gridSize: Core.GRID
      };
    }
  };

  // ============================================================
  // VIEWPORT & ZOOM STATE
  // ============================================================
  Core.basePx = 600;
  Core.dpr = 1;
  Core.zoom = 1;
  Core.pan = {x:0, y:0};
  Core._mouseW = {x:0, y:0};
  Core._initView = false;

  // ============================================================
  // SPATIAL INDEX FOR COLLISION DETECTION
  // ============================================================
  Core.spatialIndex = {
    cellSize: 20,
    grid: new Map(),
    dirty: true,
    
    rebuild() {
      this.grid.clear();
      for(const it of Core.items) {
        const size = Core.getSize(it);
        const minR = Math.floor(it.row / this.cellSize);
        const maxR = Math.floor((it.row + size - 1) / this.cellSize);
        const minC = Math.floor(it.col / this.cellSize);
        const maxC = Math.floor((it.col + size - 1) / this.cellSize);
        
        for(let r = minR; r <= maxR; r++) {
          for(let c = minC; c <= maxC; c++) {
            const key = `${r},${c}`;
            if(!this.grid.has(key)) this.grid.set(key, []);
            this.grid.get(key).push(it);
          }
        }
      }
      this.dirty = false;
    },
    
    query(row, col) {
      if(this.dirty) this.rebuild();
      const r = Math.floor(row / this.cellSize);
      const c = Math.floor(col / this.cellSize);
      return this.grid.get(`${r},${c}`) || [];
    },
    
    markDirty() {
      this.dirty = true;
    }
  };

  // ============================================================
  // COLOR PALETTE
  // ============================================================
  Core.COLORS = [
    "#e6194b","#3cb44b","#ffe119","#4363d8",
    "#f58231","#911eb4","#46f0f0","#f032e6",
    "#bcf60c","#fabebe","#008080","#e6beff",
    "#9a6324","#fffac8","#800000","#aaffc3"
  ];

  // ============================================================
  // DIRTY FLAG MANAGEMENT
  // ============================================================
  Core.markDirty = function(flag) {
    if(Core._dirtyFlags.hasOwnProperty(flag)) {
      Core._dirtyFlags[flag] = true;
    }
    if(flag === 'items') {
      Core.spatialIndex.markDirty();
    }
  };

  Core.clearDirtyFlags = function() {
    for(let key in Core._dirtyFlags) {
      Core._dirtyFlags[key] = false;
    }
  };

  // ============================================================
  // GRID CALCULATIONS
  // ============================================================
  Core.cell = () => Core.basePx / Core.GRID;

  Core.getSize = function(it) {
    if(!it) return 1;
    if(it.type === Core.TYPES.P) {
      return Math.max(it.sizeW || it.size || Core.SIZE.P, 
                      it.sizeH || it.size || Core.SIZE.P);
    }
    return Number.isFinite(it.size) ? it.size : Core.SIZE[it.type];
  };

  // ============================================================
  // UNDO/REDO THROTTLING
  // ============================================================
  Core._lastUndoTime = 0;
  Core._undoThrottle = 300;
  
  Core.pushUndo = function(force = false) {
    const now = Date.now();
    if(!force && (now - Core._lastUndoTime) < Core._undoThrottle) {
      return;
    }
    Core._lastUndoTime = now;
    
    Core.history.push({
      type: 'snapshot',
      data: Core.history.createSnapshot()
    });
  };

  // ============================================================
  // STATE RESTORATION
  // ============================================================
  Core.restore = function(snapshot) {
    if(Number.isFinite(snapshot.gridSize)) {
      Core.GRID = snapshot.gridSize;
    }
    Core.items = snapshot.items || [];
    Core.idSeq = snapshot.idSeq || 1;
    Core.legendLabels = snapshot.legendLabels || {};
    Core.markDirty('items');
    Core.markDirty('legend');
    Core.resizeCanvas();
  };
  
  // ============================================================
  // DYNAMIC ZOOM LIMITS BASED ON GRID SIZE
  // ============================================================
  Core.getDynamicMaxZoom = function () {
    const g = Math.max(20, Math.min(Core.GRID || 180, 2000));
    const ratio = g / 20;
    const zoom = 1 + Math.pow(ratio, 0.75) * 1.65;
    return Math.min(60, zoom);
  };

  // ============================================================
  // AUTO-NUMBERING FOR X/Y BLOCKS
  // ============================================================
  Core.renumber = function() {
    const groups = new Map();
    for(const it of Core.items) {
      if(it.type === Core.TYPES.X || it.type === Core.TYPES.Y) {
        const key = (it.type || '') + '|' + (it.color || Core.FILL[it.type] || 'default');
        if(!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      }
    }
    for(const [key, arr] of groups) {
      arr.sort((a,b) => a.row - b.row || a.col - b.col || a.id - b.id);
      arr.forEach((it, i) => { it.order = i + 1; });
    }
  };

  // ============================================================
  // COLLISION DETECTION
  // ============================================================
  Core.isOccupied = function(row, col, size, excludeId = null) {
    const candidates = Core.spatialIndex.query(row, col);
    
    for(const it of candidates) {
      if(excludeId !== null && it.id === excludeId) continue;
      
      const otherSize = Core.getSize(it);
      const otherW = (it.sizeW !== undefined) ? it.sizeW : otherSize;
      const otherH = (it.sizeH !== undefined) ? it.sizeH : otherSize;
      
      const thisW = (typeof size === 'object' && size.w !== undefined) ? size.w : size;
      const thisH = (typeof size === 'object' && size.h !== undefined) ? size.h : size;
      
      const overlap = !(
        row >= it.row + otherH ||
        row + thisH <= it.row ||
        col >= it.col + otherW ||
        col + thisW <= it.col
      );
      
      if(overlap) return true;
    }
    return false;
  };

  // ============================================================
  // FIND FREE SPACE NEAR TARGET
  // ============================================================
  Core.findFree = function(targetR, targetC, size) {
    const w = (typeof size === 'object' && size.w !== undefined) ? size.w : size;
    const h = (typeof size === 'object' && size.h !== undefined) ? size.h : size;
    
    if(!Core.isOccupied(targetR, targetC, {w, h})) {
      return {r: targetR, c: targetC};
    }
    
    for(let radius = 1; radius <= 30; radius++) {
      const tests = [];
      for(let dr = -radius; dr <= radius; dr++) {
        for(let dc = -radius; dc <= radius; dc++) {
          if(Math.max(Math.abs(dr), Math.abs(dc)) === radius) {
            const r = targetR + dr;
            const c = targetC + dc;
            if(r >= 0 && r + h <= Core.GRID && c >= 0 && c + w <= Core.GRID) {
              tests.push({r, c, dist: dr * dr + dc * dc});
            }
          }
        }
      }
      
      tests.sort((a, b) => a.dist - b.dist);
      
      for(const test of tests) {
        if(!Core.isOccupied(test.r, test.c, {w, h})) {
          return {r: test.r, c: test.c};
        }
      }
    }
    
    return null;
  };

  // ============================================================
  // ADD BLOCKS (X/Y)
  // ============================================================
  Core.addBlock = function(type, row, col, color = null) {
    const size = Core.SIZE[type];
    if(!size) return null;
    
    const free = Core.findFree(row, col, size);
    if(!free) return null;
    
    const item = {
      id: Core.idSeq++,
      type: type,
      row: free.r,
      col: free.c,
      size: size,
      color: color || Core.FILL[type],
      order: 0
    };
    
    Core.items.push(item);
    Core.renumber();
    Core.markDirty('items');
    Core.markDirty('legend');
    
    return item;
  };

  // ============================================================
  // ADD POINT (P) WITH CUSTOM CONFIG
  // ============================================================
  Core.addPoint = function(row, col, config = {}) {
    const sizeW = config.sizeW || config.size || Core.SIZE.P;
    const sizeH = config.sizeH || config.size || Core.SIZE.P;
    
    const free = Core.findFree(row, col, {w: sizeW, h: sizeH});
    if(!free) {
      console.warn('No free space found for point');
      return null;
    }
    
    const item = {
      id: Core.idSeq++,
      type: Core.TYPES.P,
      row: free.r,
      col: free.c,
      sizeW: sizeW,
      sizeH: sizeH,
      label: config.label || '',
      color: config.color || Core.FILL.P,
      image: config.image || null,
      area: config.area || 0,
      locked: false,
      glow: config.glow !== undefined ? config.glow : false,
      
      fillAlpha: config.fillAlpha !== undefined ? config.fillAlpha : 100,
      borderAlpha: config.borderAlpha !== undefined ? config.borderAlpha : 100,
      borderWidth: config.borderWidth !== undefined ? config.borderWidth : 2,
      borderColor: config.borderColor || '#000000',
      
      areaAlpha: config.areaAlpha !== undefined ? config.areaAlpha : 30,
      areaColor: config.areaColor || config.color || Core.FILL.P,
      areaBorderAlpha: config.areaBorderAlpha !== undefined ? config.areaBorderAlpha : 100,
      areaBorderWidth: config.areaBorderWidth !== undefined ? config.areaBorderWidth : 2
    };
    
    Core.items.push(item);
    Core.markDirty('items');
    Core.markDirty('legend');
    
    return item;
  };

  // ============================================================
  // DELETE ITEM
  // ============================================================
  Core.deleteItem = function(id) {
    const idx = Core.items.findIndex(it => it.id === id);
    if(idx >= 0) {
      Core.items.splice(idx, 1);
      Core.selected.delete(id);
      Core.renumber();
      Core.markDirty('items');
      Core.markDirty('legend');
      return true;
    }
    return false;
  };

  // ============================================================
  // MOVE ITEM
  // ============================================================
  Core.moveItem = function(id, newRow, newCol) {
    const it = Core.items.find(x => x.id === id);
    if(!it) return false;
    
    if(it.locked) return false;
    
    const sizeW = it.sizeW !== undefined ? it.sizeW : Core.getSize(it);
    const sizeH = it.sizeH !== undefined ? it.sizeH : Core.getSize(it);
    
    if(newRow < 0 || newRow + sizeH > Core.GRID || 
       newCol < 0 || newCol + sizeW > Core.GRID) {
      return false;
    }
    
    if(Core.isOccupied(newRow, newCol, {w: sizeW, h: sizeH}, id)) {
      return false;
    }
    
    it.row = newRow;
    it.col = newCol;
    
    Core.renumber();
    Core.markDirty('items');
    
    return true;
  };

  // ============================================================
  // COPY/PASTE
  // ============================================================
  Core.copySelected = function() {
    Core.clipboard = Array.from(Core.selected).map(id => {
      const it = Core.items.find(x => x.id === id);
      return it ? JSON.parse(JSON.stringify(it)) : null;
    }).filter(Boolean);
    
    return Core.clipboard.length;
  };

  Core.pasteClipboard = function(offsetR = 2, offsetC = 2) {
    if(!Core.clipboard.length) return 0;
    
    const minR = Math.min(...Core.clipboard.map(it => it.row));
    const minC = Math.min(...Core.clipboard.map(it => it.col));
    
    Core.selected.clear();
    let pasted = 0;
    
    for(const orig of Core.clipboard) {
      const relR = orig.row - minR;
      const relC = orig.col - minC;
      const newR = minR + offsetR + relR;
      const newC = minC + offsetC + relC;
      
      const sizeW = orig.sizeW !== undefined ? orig.sizeW : Core.getSize(orig);
      const sizeH = orig.sizeH !== undefined ? orig.sizeH : Core.getSize(orig);
      
      const free = Core.findFree(newR, newC, {w: sizeW, h: sizeH});
      if(!free) continue;
      
      const newItem = JSON.parse(JSON.stringify(orig));
      newItem.id = Core.idSeq++;
      newItem.row = free.r;
      newItem.col = free.c;
      
      Core.items.push(newItem);
      Core.selected.add(newItem.id);
      pasted++;
    }
    
    Core.renumber();
    Core.markDirty('items');
    
    return pasted;
  };

  // ============================================================
  // GRID SIZE SETTER
  // ============================================================
  Core.setGridSize = function(newSize, opts = {}) {
    const oldGrid = Core.GRID;
    Core.GRID = Math.max(20, Math.min(newSize, 2000));
    
    if(opts.scale && oldGrid > 0 && Core.GRID !== oldGrid) {
      const ratio = Core.GRID / oldGrid;
      for(const it of Core.items) {
        it.row = Math.round(it.row * ratio);
        it.col = Math.round(it.col * ratio);
        if(it.size) it.size = Math.round(it.size * ratio);
        if(it.sizeW) it.sizeW = Math.round(it.sizeW * ratio);
        if(it.sizeH) it.sizeH = Math.round(it.sizeH * ratio);
      }
    }
    
    Core.markDirty('items');
    Core.markDirty('view');
    Core.resizeCanvas();
  };

  // ============================================================
  // CANVAS RESIZE & DPR
  // ============================================================
  Core.resizeCanvas = function() {
    if(!Core.canvas) {
      Core.canvas = Core.$('board');
      if(Core.canvas) {
        Core.ctx = Core.canvas.getContext('2d');
      }
    }
    
    if(!Core.canvas || !Core.ctx) return;
    
    Core.dpr = window.devicePixelRatio || 1;
    const cssW = Core.basePx;
    const cssH = Core.basePx;
    
    Core.canvas.style.width = cssW + 'px';
    Core.canvas.style.height = cssH + 'px';
    Core.canvas.width = cssW * Core.dpr;
    Core.canvas.height = cssH * Core.dpr;
    
    Core.ctx.scale(Core.dpr, Core.dpr);
    
    Core.markDirty('view');
    Core.markDirty('items');
    if(window.Draw && window.Draw.render) {
      window.Draw.render();
    }
  };

  // ============================================================
  // COORDINATE CONVERSIONS
  // ============================================================
  Core.evtRC = function(e) {
    const world = Core.screenToWorld(e.clientX, e.clientY);
    return Core.worldToRC(world.x, world.y);
  };

  Core.worldToRC = function(x, y) {
    const s = Core.cell();
    return {
      r: Math.floor(y / s),
      c: Math.floor(x / s)
    };
  };

  Core.screenToWorld = function(clientX, clientY) {
    if(!Core.canvas) return {x: 0, y: 0};
    
    const rect = Core.canvas.getBoundingClientRect();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    
    const worldX = (cssX - Core.pan.x) / Core.zoom;
    const worldY = (cssY - Core.pan.y) / Core.zoom;
    
    return {x: worldX, y: worldY};
  };

  // ============================================================
  // PAN CLAMPING
  // ============================================================
  Core.clampPan = function() {
    if(!Core.canvas) return;
    
    const rect = Core.canvas.getBoundingClientRect();
    const worldW = Core.basePx / Core.zoom;
    const worldH = Core.basePx / Core.zoom;
    
    const margin = 100;
    const maxPanX = rect.width - worldW * Core.zoom + margin;
    const maxPanY = rect.height - worldH * Core.zoom + margin;
    
    Core.pan.x = Math.max(-margin, Math.min(maxPanX, Core.pan.x));
    Core.pan.y = Math.max(-margin, Math.min(maxPanY, Core.pan.y));
  };

  // ============================================================
  // FIT VIEW
  // ============================================================
  Core.fitView = function() {
    if(!Core.canvas || Core.items.length === 0) {
      Core.zoom = 1;
      Core.pan = {x: 0, y: 0};
      Core.markDirty('view');
      if(window.Draw) window.Draw.render();
      return;
    }
    
    const s = Core.cell();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for(const it of Core.items) {
      const sizeW = it.sizeW !== undefined ? it.sizeW : Core.getSize(it);
      const sizeH = it.sizeH !== undefined ? it.sizeH : Core.getSize(it);
      
      const x1 = it.col * s;
      const y1 = it.row * s;
      const x2 = (it.col + sizeW) * s;
      const y2 = (it.row + sizeH) * s;
      
      minX = Math.min(minX, x1);
      minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2);
      maxY = Math.max(maxY, y2);
    }
    
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const rect = Core.canvas.getBoundingClientRect();
    
    const pad = 40;
    const zoomX = (rect.width - pad * 2) / contentW;
    const zoomY = (rect.height - pad * 2) / contentH;
    Core.zoom = Math.min(zoomX, zoomY, Core.getDynamicMaxZoom());
    Core.zoom = Math.max(0.4, Core.zoom);
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    Core.pan.x = rect.width / 2 - centerX * Core.zoom;
    Core.pan.y = rect.height / 2 - centerY * Core.zoom;
    
    Core.clampPan();
    Core.markDirty('view');
    if(window.Draw) window.Draw.render();
    
    Core._initView = true;
  };

  // ============================================================
  // GESTURE TRACKING & HANDLERS
  // ============================================================
  const Gestures = {
    pointers: new Map(),
    state: 'IDLE',
    dragData: null,
    lastMidCSS: null,
    pinchData: null,
    _renderScheduled: false
  };

  const GestureState = {
    IDLE: 'IDLE',
    DRAG: 'DRAG',
    PAINT: 'PAINT',
    LASSO: 'LASSO',
    PINCH: 'PINCH',
    PAN: 'PAN'
  };

  function getCanvas() {
    return Core.canvas || Core.$('board');
  }

  function getCore() {
    return window.Core;
  }

  function hitItemAtRC(rc) {
    if(!rc) return null;
    
    const candidates = Core.spatialIndex.query(rc.r, rc.c);
    
    for(let i = candidates.length - 1; i >= 0; i--) {
      const it = candidates[i];
      const sizeW = it.sizeW !== undefined ? it.sizeW : Core.getSize(it);
      const sizeH = it.sizeH !== undefined ? it.sizeH : Core.getSize(it);
      
      if(rc.r >= it.row && rc.r < it.row + sizeH &&
         rc.c >= it.col && rc.c < it.col + sizeW) {
        return it;
      }
    }
    
    return null;
  }

  // ============================================================
  // POINTER DOWN HANDLER
  // ============================================================
  function handlePointerDown(e) {
    e.preventDefault();
    
    // Check if measure tool is active and handle it
    if(window.Features && window.Features.Measure && window.Features.Measure.active) {
      const rc = Core.evtRC(e);
      const handled = window.Features.Measure.handleClick(rc, e.clientX, e.clientY);
      if(handled) return;
    }
    
    Gestures.pointers.set(e.pointerId, {
      id: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      button: e.button
    });

    if(e.button === 2) return;

    const pCount = Gestures.pointers.size;

    if(pCount === 2) {
      const vals = Array.from(Gestures.pointers.values());
      const midX = (vals[0].clientX + vals[1].clientX) / 2;
      const midY = (vals[0].clientY + vals[1].clientY) / 2;
      const dx = vals[1].clientX - vals[0].clientX;
      const dy = vals[1].clientY - vals[0].clientY;
      const dist = Math.hypot(dx, dy);

      Gestures.lastMidCSS = {x: midX, y: midY};
      Gestures.pinchData = {startDist: dist, startZoom: Core.zoom};
      Gestures.state = GestureState.PINCH;
      return;
    }

    if(pCount !== 1) return;

    const rc = Core.evtRC(e);
    const hit = hitItemAtRC(rc);
    const mode = Core.mode || 'draw';

    if(mode === 'draw') {
      Core.pushUndo(true);
      Core.lastPaintRC = rc;
      
      const existingHit = hitItemAtRC(rc);
      if(!existingHit) {
        Core.addBlock('X', rc.r, rc.c);
        if(window.Draw) window.Draw.render();
      }
      
      Gestures.state = GestureState.PAINT;
    }
    else if(mode === 'select') {
      if(hit) {
        if(!Core.selected.has(hit.id)) {
          if(!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            Core.selected.clear();
          }
          Core.selected.add(hit.id);
          Core.lastSelected = hit;
        }

        Gestures.dragData = {
          items: Array.from(Core.selected).map(id => {
            const it = Core.items.find(x => x.id === id);
            if(!it || it.locked) return null;
            return {
              id: it.id,
              startRow: it.row,
              startCol: it.col
            };
          }).filter(Boolean),
          startRC: rc
        };

        if(Gestures.dragData.items.length > 0) {
          Gestures.state = GestureState.DRAG;
          Core.pushUndo(true);
        } else {
          Gestures.dragData = null;
        }

        Core.markDirty('selection');
        if(window.Draw) window.Draw.render();
      } else {
        if(!e.shiftKey && !e.ctrlKey && !e.metaKey) {
          Core.selected.clear();
        }
        
        const world = Core.screenToWorld(e.clientX, e.clientY);
        Core.lassoStart = {x: world.x, y: world.y};
        Gestures.state = GestureState.LASSO;
        
        Core.markDirty('selection');
        if(window.Draw) window.Draw.render();
      }
    }
    else if(mode === 'view') {
      const world = Core.screenToWorld(e.clientX, e.clientY);
      Gestures.dragData = {
        startPanX: Core.pan.x,
        startPanY: Core.pan.y,
        startWorldX: world.x,
        startWorldY: world.y
      };
      Gestures.state = GestureState.PAN;
    }
  }

  // ============================================================
  // POINTER MOVE HANDLER
  // ============================================================
  function handlePointerMove(e) {
    e.preventDefault();

    const p = Gestures.pointers.get(e.pointerId);
    if(p) {
      p.clientX = e.clientX;
      p.clientY = e.clientY;
    }

    const world = Core.screenToWorld(e.clientX, e.clientY);
    Core._mouseW = world;

    if(Gestures.state === GestureState.PINCH && Gestures.pointers.size === 2) {
      const vals = Array.from(Gestures.pointers.values());
      const midX = (vals[0].clientX + vals[1].clientX) / 2;
      const midY = (vals[0].clientY + vals[1].clientY) / 2;
      const dx = vals[1].clientX - vals[0].clientX;
      const dy = vals[1].clientY - vals[0].clientY;
      const dist = Math.hypot(dx, dy);

      if(Gestures.pinchData && Gestures.lastMidCSS) {
        const ratio = dist / Gestures.pinchData.startDist;
        const dynamicMax = Core.getDynamicMaxZoom();
        const newZoom = Math.max(0.4, Math.min(dynamicMax, Gestures.pinchData.startZoom * ratio));

        const rect = Core.canvas.getBoundingClientRect();
        const anchorX = Gestures.lastMidCSS.x - rect.left;
        const anchorY = Gestures.lastMidCSS.y - rect.top;
        const worldPt = Core.screenToWorld(Gestures.lastMidCSS.x, Gestures.lastMidCSS.y);

        Core.zoom = newZoom;
        Core.pan.x = anchorX - worldPt.x * Core.zoom;
        Core.pan.y = anchorY - worldPt.y * Core.zoom;

        Core.clampPan();

        const panDX = midX - Gestures.lastMidCSS.x;
        const panDY = midY - Gestures.lastMidCSS.y;
        Core.pan.x += panDX;
        Core.pan.y += panDY;
        Core.clampPan();

        Gestures.lastMidCSS = {x: midX, y: midY};

        Core.markDirty('view');
        if(!Gestures._renderScheduled) {
          Gestures._renderScheduled = true;
          requestAnimationFrame(() => {
            if(window.Draw) window.Draw.render();
            Gestures._renderScheduled = false;
          });
        }
      }
      return;
    }

    if(Gestures.state === GestureState.PAINT) {
      const rc = Core.evtRC(e);
      if(!Core.lastPaintRC || rc.r !== Core.lastPaintRC.r || rc.c !== Core.lastPaintRC.c) {
        const existingHit = hitItemAtRC(rc);
        if(!existingHit) {
          Core.addBlock('X', rc.r, rc.c);
          if(window.Draw) window.Draw.render();
        }
        Core.lastPaintRC = rc;
      }
      return;
    }

    if(Gestures.state === GestureState.DRAG && Gestures.dragData) {
      const currentRC = Core.evtRC(e);
      const dr = currentRC.r - Gestures.dragData.startRC.r;
      const dc = currentRC.c - Gestures.dragData.startRC.c;

      for(const d of Gestures.dragData.items) {
        const it = Core.items.find(x => x.id === d.id);
        if(!it || it.locked) continue;

        const newR = d.startRow + dr;
        const newC = d.startCol + dc;

        const sizeW = it.sizeW !== undefined ? it.sizeW : Core.getSize(it);
        const sizeH = it.sizeH !== undefined ? it.sizeH : Core.getSize(it);

        if(newR >= 0 && newR + sizeH <= Core.GRID &&
           newC >= 0 && newC + sizeW <= Core.GRID &&
           !Core.isOccupied(newR, newC, {w: sizeW, h: sizeH}, it.id)) {
          it.row = newR;
          it.col = newC;
        }
      }

      Core.renumber();
      Core.markDirty('items');
      if(!Gestures._renderScheduled) {
        Gestures._renderScheduled = true;
        requestAnimationFrame(() => {
          if(window.Draw) window.Draw.render();
          Gestures._renderScheduled = false;
        });
      }
      return;
    }

    if(Gestures.state === GestureState.LASSO && Core.lassoStart) {
      Core.markDirty('selection');
      if(!Gestures._renderScheduled) {
        Gestures._renderScheduled = true;
        requestAnimationFrame(() => {
          if(window.Draw) window.Draw.render();
          Gestures._renderScheduled = false;
        });
      }
      return;
    }

    if(Gestures.state === GestureState.PAN && Gestures.dragData) {
      const world = Core.screenToWorld(e.clientX, e.clientY);
      const dx = world.x - Gestures.dragData.startWorldX;
      const dy = world.y - Gestures.dragData.startWorldY;

      Core.pan.x = Gestures.dragData.startPanX + dx * Core.zoom;
      Core.pan.y = Gestures.dragData.startPanY + dy * Core.zoom;

      Core.clampPan();
      Core.markDirty('view');
      if(!Gestures._renderScheduled) {
        Gestures._renderScheduled = true;
        requestAnimationFrame(() => {
          if(window.Draw) window.Draw.render();
          Gestures._renderScheduled = false;
        });
      }
      return;
    }
  }

  // ============================================================
  // POINTER UP HANDLER
  // ============================================================
  function handlePointerUp(e) {
    e.preventDefault();
    Gestures.pointers.delete(e.pointerId);

    if(Gestures.pointers.size === 0) {
      if(Gestures.state === GestureState.LASSO && Core.lassoStart) {
        const s = Core.cell();
        const x1 = Math.min(Core.lassoStart.x, Core._mouseW.x);
        const x2 = Math.max(Core.lassoStart.x, Core._mouseW.x);
        const y1 = Math.min(Core.lassoStart.y, Core._mouseW.y);
        const y2 = Math.max(Core.lassoStart.y, Core._mouseW.y);

        for (const it of Core.items) {
          const sz = Core.getSize(it);
          const xw1 = it.col * s;
          const yw1 = it.row * s;
          const xw2 = (it.col + (it.sizeW || sz)) * s;
          const yw2 = (it.row + (it.sizeH || sz)) * s;

          const tol = 1 / Core.zoom;
          const lx1 = Math.min(x1, x2) - tol;
          const lx2 = Math.max(x1, x2) + tol;
          const ly1 = Math.min(y1, y2) - tol;
          const ly2 = Math.max(x1, x2) + tol;

          const overlap = !(xw2 < lx1 || xw1 > lx2 || yw2 < ly1 || yw1 > ly2);
          if (overlap) Core.selected.add(it.id);
        }

        Core.lassoStart = null;
        Core.markDirty('selection');
        window.Draw.render();
      }

      Gestures.state = GestureState.IDLE;
      Gestures.dragData = null;
      Gestures.lastMidCSS = null;
      Gestures.pinchData = null;
      Core.lastPaintRC = null;
      Gestures._renderScheduled = false;
    }
  }

// ============================================================
// CONTEXT MENU HANDLER (FIXED - mode-aware: draw vs select)
// ============================================================
function handleContextMenu(e){
  e.preventDefault();
  const Core = getCore();
  const x = e.clientX, y = e.clientY;

  // Helper: selected counts
  const selectedCount = Core.selected ? Core.selected.size : 0;
  const getById = (id) => document.getElementById(id);

  // Compute hit item under cursor (grid-aware)
  const rc = Core.evtRC(e);
  const hit = hitItemAtRC(rc);

  // Determine modes (Core.mode is authoritative, fallback to selectionMode)
  const isSelect = (Core.mode === 'select') || Core.selectionMode === true;
  const isDraw   = (Core.mode === 'draw') && !isSelect;

  // If we're in Select mode and right-clicked an item, select it first
  if (isSelect && hit) {
    if (!Core.selected.has(hit.id)) {
      Core.selected.clear();
      Core.selected.add(hit.id);
      Core.lastSelected = hit;
      Core.markDirty('selection');
      if (window.Draw) window.Draw.render();
    }
  }

  // Compute point-related capabilities
  const selectedIds = Array.from(Core.selected || []);
  const selectedItems = selectedIds.map(id => Core.items.find(it => it.id === id)).filter(Boolean);
  const selectedPointsCount = selectedItems.filter(it => it.type === Core.TYPES.P).length;

  const canPaste = !!Core.clipboard && Core.clipboard.length > 0;
  const canAlign = selectedCount >= 2;

  // Edit Point is allowed when:
  // - right-click is on a Point, OR
  // - exactly one selected item and it's a Point
  const canEditPoint =
    (hit && hit.type === Core.TYPES.P) ||
    (selectedCount === 1 && selectedItems[0]?.type === Core.TYPES.P);

  // Lock/Light actions allowed when:
  // - right-click is on a Point, OR
  // - at least one selected Point
  const canTogglePointAction =
    (hit && hit.type === Core.TYPES.P) || (selectedPointsCount > 0);

  const items = [];

  // FIXED: Build proper menu based on mode
  if(isDraw) {
    // Draw mode menu: show element presets
    if(window.getElementMenuItems && typeof window.getElementMenuItems === 'function') {
      const elementItems = window.getElementMenuItems();
      items.push(...elementItems);
      
      if(elementItems.length > 0) {
        items.push('divider');
      }
    }
    
    // Add custom point option
    items.push({
      icon: '📍',
      label: 'Custom Point',
      action: () => {
        const btn = getById('add-point');
        if(btn) btn.click();
      }
    });
    
    items.push('divider');
    
    // Clear all option
    items.push({
      icon: '🗑️',
      label: 'Clear All',
      action: () => {
        const btn = getById('clear');
        if(btn) btn.click();
      }
    });
  } else {
    // Select mode menu (order exactly as requested)
    items.push(
      // First group
      { icon:'✖', label:'Delete',   action:()=>{ const b=getById('delete-selected'); if(b) b.click(); }, disabled: selectedCount === 0 },
      { icon:'📋', label:'Copy',     action:()=>{ const b=getById('copy-selected'); if(b) b.click(); },   disabled: selectedCount === 0 },
      { icon:'📄', label:'Paste',    action:()=>{ const b=getById('paste-selected'); if(b) b.click(); },  disabled: !canPaste },
      { icon:'🔲', label:'Select All', action:()=>{ const b=getById('select-all-btn'); if(b) b.click(); } },
      { icon:'🔳', label:'Deselect', action:()=>{ Core.selected.clear(); Core.markDirty('selection'); if(window.Draw) window.Draw.render(); }, disabled: selectedCount === 0 },

      'divider',

      // Align group
      { icon:'↔️', label:'Align Horizontal', action:()=>{ const b=getById('align-h'); if(b) b.click(); }, disabled: !canAlign },
      { icon:'↕️', label:'Align Vertical',   action:()=>{ const b=getById('align-v'); if(b) b.click(); }, disabled: !canAlign },

      'divider',

      // Point-specific actions
      { icon:'✏️', label:'Edit Point',    action:()=>{ const b=getById('edit-point'); if(b) b.click(); },    disabled: !canEditPoint },
      { icon:'🔒', label:'Lock/Unlock',   action:()=>{ const b=getById('toggle-lock'); if(b) b.click(); },    disabled: !canTogglePointAction },
      { icon:'💡', label:'Toggle Light',  action:()=>{ const b=getById('lights'); if(b) b.click(); },         disabled: !canTogglePointAction },

      'divider',

      // Always present
      { icon:'🗑️', label:'Clear All',     action:()=>{ const b=getById('clear'); if(b) b.click(); } }
    );
  }

  showDToolsContextMenu(x, y, items);
}

// ============================================================
// Helper function to add preset elements
// ============================================================
function addPresetElement(presetKey) {
  const EP = window.ElementPresets || {};
  const cfg = EP[presetKey];
  if (!cfg) {
    console.warn('Unknown preset:', presetKey);
    return;
  }
  
  // Get center of visible canvas area
  const rect = Core.canvas.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const world = Core.screenToWorld(rect.left + centerX, rect.top + centerY);
  const rc = Core.worldToRC(world.x, world.y);
  
  Core.pushUndo(true);
  Core.addPoint(Math.round(rc.r), Math.round(rc.c), cfg);
  Core.markDirty('items');
  if (window.Draw) window.Draw.render();
  if (window.UI?.Toast) window.UI.Toast.success(`${cfg.label || presetKey} added`);
}

// Make globally available for menu system
window.addPresetElementFromMenu = addPresetElement;

// ============================================================
// DTools context menu wrapper (reuses UI system)
// ============================================================
function showDToolsContextMenu(x, y, items) {
  if (window.UI && window.UI.showContextMenu) {
    window.UI.showContextMenu(x, y, items);
  }
}

  // ============================================================
  // INITIALIZE GESTURE HANDLERS
  // ============================================================
  function init(){
    const canvas=getCanvas(); 
    if(!canvas){
      setTimeout(init,100); 
      return;
    }
    canvas.addEventListener('pointerdown',handlePointerDown,{passive:false});
    canvas.addEventListener('pointermove',handlePointerMove,{passive:false});
    canvas.addEventListener('pointerup',handlePointerUp,{passive:false});
    canvas.addEventListener('pointercancel',handlePointerUp,{passive:false});
    canvas.addEventListener('contextmenu',handleContextMenu,{passive:false});
    console.log('Gestures ready');
  }
  
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
  
  window.Gestures=Gestures;
  
  // ============================================================
  // GLOBAL EXPORTS
  // ============================================================
  window.getCore = function() { return window.Core; };

  window.setZoomPct = function(pct, anchor) {
    const Core = window.Core;
    if (!Core || !Core.canvas) return;

    const dynamicMax = Core.getDynamicMaxZoom();
    const newZoom = Math.max(0.4, Math.min(dynamicMax, pct / 100));

    const rect = Core.canvas.getBoundingClientRect();
    const clientX = rect.left + anchor.x;
    const clientY = rect.top + anchor.y;
    const worldPt = Core.screenToWorld(clientX, clientY);

    Core.zoom = newZoom;
    Core.pan.x = anchor.x - worldPt.x * Core.zoom;
    Core.pan.y = anchor.y - worldPt.y * Core.zoom;
    if (Core.clampPan) Core.clampPan();
    Core.markDirty('view');
    if (window.Draw) window.Draw.render();
  };
  
  // ============================================================
  // IMAGE PRELOADER
  // ============================================================
  Core.preloadImages = function() {
    const imagePaths = [
      './images/alliance-center-s4.png',
      './images/lake-s4.png',
      './images/mountain-s4.png',
      './images/secret-task.png',
      './images/Stronghold.png',
      './images/TradePost.png'
    ];
    
    imagePaths.forEach(path => {
      const img = new Image();
      img.onload = () => {
        console.log('✓ Preloaded:', path);
      };
      img.onerror = () => {
        console.warn('✗ Failed to preload:', path);
      };
      img.src = path;
    });
  };

  // Preload images on startup
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Core.preloadImages());
  } else {
    Core.preloadImages();
  }

  // ============================================================
  // EXPORT TO GLOBAL SCOPE
  // ============================================================
  window.Core = Core;
  
})();
