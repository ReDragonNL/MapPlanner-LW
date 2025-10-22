// ============================================================
// CORE ENGINE - MapPlanner v4
// Complete with: Mobile zoom/pan fixes + Rectangular area + Auto-menus
// PATCHED: Right-click context menu improvements
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
  Core.canvas = Core.$('board');
  Core.ctx = Core.canvas ? Core.canvas.getContext('2d') : null;

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
  Core.mode = 'draw';

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
  // CANVAS TRANSFORM MANAGEMENT
  // ============================================================
  Core.setTransform = function() {
    Core.ctx.setTransform(
      Core.dpr * Core.zoom, 0, 0, 
      Core.dpr * Core.zoom, 
      Core.dpr * Core.pan.x, 
      Core.dpr * Core.pan.y
    );
  };

  Core.clearCanvas = function() {
    Core.ctx.setTransform(1, 0, 0, 1, 0, 0);
    Core.ctx.clearRect(0, 0, Core.canvas.width, Core.canvas.height);
  };

  // ============================================================
  // CANVAS RESIZING & INITIALIZATION
  // ============================================================
Core.resizeCanvas = function () {
  Core.dpr = window.devicePixelRatio || 1;

  // compute available rectangle (full screen minus top bar & a small pad)
  const top = document.querySelector('.topbar');
  const footer = document.querySelector('footer');
  const topH   = top ? Math.ceil(top.getBoundingClientRect().height) : 0;
  const footH  = footer ? Math.ceil(footer.getBoundingClientRect().height) : 0;
  const pad    = 10;

  const cssW = Math.floor(window.innerWidth  - pad * 2);
  const cssH = Math.floor(window.innerHeight - topH - footH - pad * 2);

  // 1) set CSS size (what you see) -> full screen area
  Core.canvas.style.width  = cssW + 'px';
  Core.canvas.style.height = cssH + 'px';

  // 2) set backing store size in device pixels (prevents blur)
  Core.canvas.width  = Math.round(cssW * Core.dpr);
  Core.canvas.height = Math.round(cssH * Core.dpr);

  // keep cells square: basePx drives Core.cell() = basePx / Core.GRID
  // using min dimension preserves square grid cells while canvas fills screen
  Core.basePx = Math.min(cssW, cssH);

  // update zoom slider/label
  const slider = Core.$('zoom-slider');
  const label  = Core.$('zoom-label');
  if (slider) {
    slider.value = String(Math.round(Core.zoom * 100));
    if (Core.getDynamicMaxZoom) {
      slider.max = String(Math.round(Core.getDynamicMaxZoom() * 100));
    }
  }
  if (label) label.textContent = Math.round(Core.zoom * 100) + '%';

  // make drawing crisp
  if (Core.ctx) {
    Core.ctx.imageSmoothingEnabled = false;
  }

  Core.markDirty('view');
  if (window.Draw) window.Draw.render();
};

  // ============================================================
  // COORDINATE TRANSFORMATIONS
  // ============================================================
  Core.screenToWorld = function(clientX, clientY) {
    const rect = Core.canvas.getBoundingClientRect();
    const xCSS = clientX - rect.left;
    const yCSS = clientY - rect.top;
    const xDev = xCSS * (Core.canvas.width / rect.width);
    const yDev = yCSS * (Core.canvas.height / rect.height);
    const xW = (xDev / Core.dpr - Core.pan.x) / Core.zoom;
    const yW = (yDev / Core.dpr - Core.pan.y) / Core.zoom;
    return {x: xW, y: yW};
  };

  Core.worldToRC = function(xW, yW) {
    const s = Core.cell();
    return {r: Math.floor(yW / s), c: Math.floor(xW / s)};
  };

  Core.worldToCanvas = function(xW, yW) {
    const x = xW * Core.zoom + Core.pan.x;
    const y = yW * Core.zoom + Core.pan.y;
    return { x, y };
  };

  Core.evtRC = function(e) {
    const pt = Core.screenToWorld(e.clientX, e.clientY);
    Core._mouseW = pt;
    return Core.worldToRC(pt.x, pt.y);
  };

  // ============================================================
  // COLLISION DETECTION
  // ============================================================
  Core.overlap = function(a, b) {
    const aSizeW = a.sizeW || Core.getSize(a);
    const aSizeH = a.sizeH || Core.getSize(a);
    const bSizeW = b.sizeW || Core.getSize(b);
    const bSizeH = b.sizeH || Core.getSize(b);
    
    return !(a.row + aSizeH <= b.row || 
             b.row + bSizeH <= a.row || 
             a.col + aSizeW <= b.col || 
             b.col + bSizeW <= a.col);
  };

  Core.collides = function(candidate, ignoreSet) {
    const candSizeW = candidate.sizeW || Core.getSize(candidate);
    const candSizeH = candidate.sizeH || Core.getSize(candidate);
    
    const candidates = Core.spatialIndex.query(candidate.row, candidate.col);
    
    const maxRow = candidate.row + candSizeH - 1;
    const maxCol = candidate.col + candSizeW - 1;
    const nearbyItems = new Set([
      ...candidates,
      ...Core.spatialIndex.query(maxRow, candidate.col),
      ...Core.spatialIndex.query(candidate.row, maxCol),
      ...Core.spatialIndex.query(maxRow, maxCol)
    ]);
    
    for(const it of nearbyItems) {
      if(ignoreSet && ignoreSet.has(it.id)) continue;
      if(it.id === candidate.id) continue;
      if(Core.overlap(candidate, it)) return true;
    }
    return false;
  };

  // ============================================================
  // ITEM PLACEMENT FUNCTIONS
  // ============================================================
  Core.placeX = function(rc) {
    const baseR = rc.r - 1;
    const baseC = rc.c - 1;
    const size = Core.SIZE.X;
    const obj = {
      id: Core.idSeq++,
      type: Core.TYPES.X,
      row: Math.max(0, Math.min(Core.GRID - size, baseR)),
      col: Math.max(0, Math.min(Core.GRID - size, baseC))
    };
    
    if(!Core.collides(obj)) {
      Core.items.push(obj);
      Core.markDirty('items');
      if(window.Draw) window.Draw.render();
      return obj.id;
    } else {
      Core.idSeq--;
      return null;
    }
  };

  Core.addPoint = function(row, col, opts = {}) {
    const sizeW = opts.sizeW || Math.max(1, Math.min(Core.GRID, Number(opts.size) || Core.SIZE.P));
    const sizeH = opts.sizeH || Math.max(1, Math.min(Core.GRID, Number(opts.size) || Core.SIZE.P));
    
    const obj = {
      id: Core.idSeq++,
      type: Core.TYPES.P,
      row: Math.max(0, Math.min(Core.GRID - sizeH, row)),
      col: Math.max(0, Math.min(Core.GRID - sizeW, col)),
      sizeW: sizeW,
      sizeH: sizeH,
      area: Math.max(0, Math.min(Core.GRID, Number(opts.area) || 12)),
      color: opts.color || Core.FILL.P,
      areaColor: opts.areaColor || (opts.color || Core.FILL.P),
      glow: opts.glow !== undefined ? !!opts.glow : true,
      areaAlpha: Number.isFinite(opts.areaAlpha) ? opts.areaAlpha : 22,
      label: (opts.label ?? 'P') + '',
      image: opts.image || null,
      locked: !!opts.locked,
      fillAlpha: Number.isFinite(opts.fillAlpha) ? opts.fillAlpha : 100,
      borderColor: opts.borderColor || '#000000',
      borderAlpha: Number.isFinite(opts.borderAlpha) ? opts.borderAlpha : 100,
      borderWidth: Number.isFinite(opts.borderWidth) ? opts.borderWidth : 1,
      areaBorderColor: opts.areaBorderColor || (opts.areaColor || Core.FILL.P),
      areaBorderAlpha: Number.isFinite(opts.areaBorderAlpha) ? opts.areaBorderAlpha : 100,
      areaBorderWidth: Number.isFinite(opts.areaBorderWidth) ? opts.areaBorderWidth : 2
    };
    
    if(Core.collides(obj)) {
      let near = Core.nearestFreeCell(obj.row, obj.col, true, sizeW, sizeH);
      if(!near) near = Core.nearestFreeCell(obj.row, obj.col, false, sizeW, sizeH);
      
      if(near) {
        obj.row = near.row;
        obj.col = near.col;
        
        if(Core.collides(obj)) {
          Core.idSeq--;
          console.warn('Could not find free space for point');
          return null;
        }
      } else {
        Core.idSeq--;
        console.warn('Could not find free space for point');
        return null;
      }
    }
    
    Core.items.push(obj);
    Core.markDirty('items');
    if(window.Draw) window.Draw.render();
    return obj.id;
  };
  
  // ============================================================
  // HIT DETECTION
  // ============================================================
  Core.hitAtRC = function(rc) {
    const candidates = Core.spatialIndex.query(rc.r, rc.c);
    
    for(let i = candidates.length - 1; i >= 0; i--) {
      const it = candidates[i];
      const sz = Core.getSize(it);
      if(rc.r >= it.row && rc.r < it.row + sz && 
         rc.c >= it.col && rc.c < it.col + sz) {
        return it;
      }
    }
    return null;
  };

  // ============================================================
  // GRID SIZE MANAGEMENT
  // ============================================================
  Core.setGridSize = function(n, opts) {
    const newGrid = Math.max(20, Math.min(2000, n | 0));
    if (newGrid === Core.GRID) return;

    if (opts && opts.scale) {
      const oldGrid = Core.GRID;
      const scale = newGrid / oldGrid;
      Core.items.forEach(it => {
        it.row = Math.round(it.row * scale);
        it.col = Math.round(it.col * scale);
        if (it.type === Core.TYPES.P) {
          if (Number.isFinite(it.size)) it.size = Math.max(1, Math.round(it.size * scale));
          if (Number.isFinite(it.area)) it.area = Math.max(0, Math.round(it.area * scale));
        }
      });
    }

    Core.GRID = newGrid;
    Core._initView = false;
    Core.markDirty('items');
    Core.markDirty('view');
    Core.resizeCanvas();
    Core.fitView();
  };
  
  // ============================================================
  // VIEW MANAGEMENT
  // ============================================================
  Core.getDrawingCenter = function() {
    if (!Core.items.length) return { x: Core.basePx / 2, y: Core.basePx / 2 };

    let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
    for (const it of Core.items) {
      const s = Core.getSize(it);
      minR = Math.min(minR, it.row);
      minC = Math.min(minC, it.col);
      maxR = Math.max(maxR, it.row + s);
      maxC = Math.max(maxC, it.col + s);
    }

    const s = Core.cell();
    const worldCenterX = ((minC + maxC) / 2) * s;
    const worldCenterY = ((minR + maxR) / 2) * s;

    return { 
      x: worldCenterX * Core.zoom + Core.pan.x,
      y: worldCenterY * Core.zoom + Core.pan.y
    };
  };

  Core.fitView = function() {
    if(!Core.items.length) {
      Core.pan.x = 0;
      Core.pan.y = 0;
      Core.zoom = 1;
      Core.markDirty('view');
      if(window.Draw) window.Draw.render();
      return;
    }
	
    let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
    
    for(const it of Core.items) {
      const s = Core.getSize(it);
      minR = Math.min(minR, it.row);
      minC = Math.min(minC, it.col);
      maxR = Math.max(maxR, it.row + s);
      maxC = Math.max(maxC, it.col + s);
    }
    
    const marginR = Math.ceil((maxR - minR) * 0.05) + 1;
    const marginC = Math.ceil((maxC - minC) * 0.05) + 1;
    minR = Math.max(0, minR - marginR);
    minC = Math.max(0, minC - marginC);
    maxR = Math.min(Core.GRID, maxR + marginR);
    maxC = Math.min(Core.GRID, maxC + marginC);

    const s = Core.cell();
    const boxW = (maxC - minC) * s;
    const boxH = (maxR - minR) * s;
    const availPx = Core.basePx;

    const targetZoom = Math.min(availPx / boxW, availPx / boxH);
    const centerX = ((minC + maxC) / 2) * s;
    const centerY = ((minR + maxR) / 2) * s;
    
    Core.pan.x = (availPx / 2) - targetZoom * centerX;
    Core.pan.y = (availPx / 2) - targetZoom * centerY;
    Core.zoom = targetZoom;

    Core.markDirty('view');
    if(window.Draw) window.Draw.render();
  };

  Core.clampPan = function () {
    const s = Core.cell();
    const worldW = Core.GRID * s * Core.zoom;
    const worldH = Core.GRID * s * Core.zoom;
    const limit = Core.basePx;

    Core.pan.x = Math.min(limit * 0.2, Math.max(limit - worldW * 1.2, Core.pan.x));
    Core.pan.y = Math.min(limit * 0.2, Math.max(limit - worldH * 1.2, Core.pan.y));
  };

  Core.centerView = function() {
    if(!Core.items.length) {
      Core.pan.x = 0;
      Core.pan.y = 0;
      Core.markDirty('view');
      if(window.Draw) window.Draw.render();
      return;
    }
    
    let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
    
    for(const it of Core.items) {
      const s = Core.getSize(it);
      minR = Math.min(minR, it.row);
      minC = Math.min(minC, it.col);
      maxR = Math.max(maxR, it.row + s);
      maxC = Math.max(maxC, it.col + s);
    }
    
    minR = Math.max(0, minR - 1);
    minC = Math.max(0, minC - 1);
    maxR = Math.min(Core.GRID, maxR + 1);
    maxC = Math.min(Core.GRID, maxC + 1);

    const s = Core.cell();
    const centerX = ((minC + maxC) / 2) * s;
    const centerY = ((minR + maxR) / 2) * s;

    const availPx = Core.basePx;
    Core.pan.x = (availPx / 2) - Core.zoom * centerX;
    Core.pan.y = (availPx / 2) - Core.zoom * centerY;

    Core.markDirty('view');
    if(window.Draw) window.Draw.render();
  };

  Core.moveItemSafe = function(it, newRow, newCol) {
    const oldR = it.row, oldC = it.col;
    it.row = newRow;
    it.col = newCol;
    
    const ignoreSet = new Set([it.id]);
    if(Core.collides(it, ignoreSet)) {
      it.row = oldR;
      it.col = oldC;
      return false;
    }
    
    Core.markDirty('items');
    return true;
  };

  Core.nearestFreeCell = function(row, col, visibleOnly, itemWidth = 1, itemHeight = 1) {
    const maxRadius = Core.GRID;
    const s = Core.cell();
    const viewX1 = -Core.pan.x / Core.zoom / Core.dpr;
    const viewY1 = -Core.pan.y / Core.zoom / Core.dpr;
    const viewX2 = viewX1 + (Core.canvas.width / Core.dpr) / Core.zoom;
    const viewY2 = viewY1 + (Core.canvas.height / Core.dpr) / Core.zoom;
    
    function isVisible(r, c) {
      return (r * s >= viewY1 && r * s <= viewY2 && c * s >= viewX1 && c * s <= viewX2);
    }
    
    function isFree(r, c) {
      if(r < 0 || c < 0 || r + itemHeight > Core.GRID || c + itemWidth > Core.GRID) {
        return false;
      }
      
      for(const it of Core.items) {
        const itW = it.sizeW || Core.getSize(it);
        const itH = it.sizeH || Core.getSize(it);
        
        if(!(r + itemHeight <= it.row || 
             it.row + itH <= r || 
             c + itemWidth <= it.col || 
             it.col + itW <= c)) {
          return false;
        }
      }
      return true;
    }
    
    for(let rad = 0; rad < maxRadius; rad++) {
      for(let dr = -rad; dr <= rad; dr++) {
        for(let dc = -rad; dc <= rad; dc++) {
          if(Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
          const nr = row + dr;
          const nc = col + dc;
          
          if(isFree(nr, nc)) {
            if(!visibleOnly || isVisible(nr, nc)) {
              return {row: nr, col: nc};
            }
          }
        }
      }
    }
    
    return null;
  };

  window.Core = Core;

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

    const slider = document.getElementById('zoom-slider');
    const label = document.getElementById('zoom-label');
    if (slider) {
      slider.value = String(Math.round(Core.zoom * 100));
      slider.max = String(Math.round(dynamicMax * 100));
    }
    if (label) label.textContent = Math.round(Core.zoom * 100) + '%';

    Core.markDirty('view');
    Core.clampPan();
    if (window.Draw) window.Draw.render();
  };
})();

// ============================================================
// DRAW ENGINE - Rendering System
// ============================================================
function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

(function(){
  const Draw = {};
  
  const renderCache = {
    cellSize: null,
    gridSize: null,
    imageCache: {},
    lastZoom: null,
    lastPan: null,
    gridPattern: null,
    needsFullRedraw: true
  };

  let renderRequested = false;
  let lastRenderTime = 0;
  const minFrameTime = 1000 / 60;

  function getCore() {
    return window.Core;
  }

  function drawGrid() {
    const Core = getCore();
    const {ctx, cell, GRID} = Core;
    const s = cell();
    
    if(renderCache.cellSize !== s || renderCache.gridSize !== GRID || 
       renderCache.lastZoom !== Core.zoom) {
      renderCache.cellSize = s;
      renderCache.gridSize = GRID;
      renderCache.lastZoom = Core.zoom;
      renderCache.needsFullRedraw = true;
    }

    // Calculate grid world size
    const gridWorldSize = GRID * s;

    // Draw background
    ctx.fillStyle = '#2a2f45';
    ctx.fillRect(0, 0, gridWorldSize, gridWorldSize);

    // Draw grid lines
    ctx.strokeStyle = '#404a78';
    ctx.lineWidth = 1 / Core.zoom;

    const viewX1 = -Core.pan.x / Core.zoom;
    const viewY1 = -Core.pan.y / Core.zoom;
    const viewX2 = viewX1 + (Core.basePx / Core.zoom);
    const viewY2 = viewY1 + (Core.basePx / Core.zoom);

    const startRow = Math.max(0, Math.floor(viewY1 / s));
    const endRow = Math.min(GRID, Math.ceil(viewY2 / s));
    const startCol = Math.max(0, Math.floor(viewX1 / s));
    const endCol = Math.min(GRID, Math.ceil(viewX2 / s));

    ctx.beginPath();
    // Horizontal lines - extend to viewport edges
    for(let i = startRow; i <= endRow; i++) {
      const p = i * s;
      ctx.moveTo(Math.max(0, viewX1), p);
      ctx.lineTo(Math.min(gridWorldSize, viewX2), p);
    }
    // Vertical lines - extend to viewport edges
    for(let i = startCol; i <= endCol; i++) {
      const p = i * s;
      ctx.moveTo(p, Math.max(0, viewY1));
      ctx.lineTo(p, Math.min(gridWorldSize, viewY2));
    }
    ctx.stroke();
  }

function loadImage(src, callback) {
  if(!src) return null;
  
  if(renderCache.imageCache[src]) {
    const img = renderCache.imageCache[src];
    if(img.complete && img.naturalWidth > 0) {
      return img;
    }
  }
  
  const img = new Image();
  
  // Enable CORS for images from same origin (GitHub Pages)
  if(window.location.protocol !== 'file:') {
    img.crossOrigin = 'anonymous';
  }
  
  img.onload = () => {
    renderCache.imageCache[src] = img;
    console.log('Image loaded:', src);
    if(window.Draw && window.Draw.render) {
      window.Draw.render();
    }
    if(callback) callback();
  };
  
  img.onerror = () => {
    console.warn('Failed to load image:', src);
    delete renderCache.imageCache[src];
  };
  
  img.src = src;
  renderCache.imageCache[src] = img;
  return img;
}

  function drawItems() {
    const Core = getCore();
    const {ctx, cell, SIZE, TYPES, FILL, BORDER, BORDER_SEL} = Core;
    const s = cell();

    const viewX1 = -Core.pan.x / Core.zoom;
    const viewY1 = -Core.pan.y / Core.zoom;
    const viewX2 = viewX1 + (Core.basePx / Core.zoom);
    const viewY2 = viewY1 + (Core.basePx / Core.zoom);

    const layers = {
      areas: [],
      ambients: [],
      blocks: []
    };

    for(const it of Core.items) {
      const sz = Core.getSize(it);
      const x = it.col * s;
      const y = it.row * s;
      const w = (it.sizeW || sz) * s;
      const h = (it.sizeH || sz) * s;

      if(x + w < viewX1 || x > viewX2 || y + h < viewY1 || y > viewY2) {
        continue;
      }

      layers.blocks.push(it);
      
      if(it.type === TYPES.P && it.glow && it.area > 0) {
        layers.areas.push(it);
      }
      if(it.type === TYPES.Y) {
        layers.ambients.push(it);
      }
    }

    for(const it of layers.areas) {
      const sizeW = it.sizeW || Core.getSize(it);
      const sizeH = it.sizeH || Core.getSize(it);
      const r0 = it.row - it.area;
      const c0 = it.col - it.area;
      const r1 = it.row + sizeH + it.area;
      const c1 = it.col + sizeW + it.area;
      const areaColor = it.areaColor || it.color || FILL.P;
      const alpha = (Number.isFinite(it.areaAlpha) ? it.areaAlpha : 22) / 100;

      ctx.save();
      ctx.shadowColor = areaColor;
      ctx.shadowBlur = 18 / Core.zoom;
      ctx.fillStyle = areaColor;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillRect(c0 * s, r0 * s, (c1 - c0) * s, (r1 - r0) * s);
      ctx.restore();

      const aBorderAlpha = (Number.isFinite(it.areaBorderAlpha) ? it.areaBorderAlpha : 100) / 100;
      ctx.strokeStyle = hexToRgba(it.areaBorderColor || areaColor, aBorderAlpha);
      ctx.lineWidth = (Number.isFinite(it.areaBorderWidth) ? it.areaBorderWidth : 2) / Core.zoom;
      ctx.strokeRect(c0 * s, r0 * s, (c1 - c0) * s, (r1 - r0) * s);
    }

    for(const it of layers.ambients) {
      const sz = Core.getSize(it);
      const half = Math.floor(sz / 2);
      const centerR = it.row + half;
      const centerC = it.col + half;
      const r0 = centerR - 11, c0 = centerC - 11;
      const r1 = centerR + 12, c1 = centerC + 12;
      const xx = c0 * s, yy = r0 * s;
      const ww = (c1 - c0) * s, hh = (r1 - r0) * s;

      ctx.save();
      ctx.shadowColor = 'rgba(249,228,106,0.9)';
      ctx.shadowBlur = 18 / Core.zoom;
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = 'rgba(255,216,74,0.18)';
      ctx.fillRect(xx, yy, ww, hh);
      ctx.restore();

      ctx.strokeStyle = 'rgba(249,228,106,0.9)';
      ctx.lineWidth = 2 / Core.zoom;
      ctx.strokeRect(xx, yy, ww, hh);
    }

    for(const it of layers.blocks) {
      const sz = Core.getSize(it);
      const w = (it.sizeW || sz) * s;
      const h = (it.sizeH || sz) * s;
      const x = it.col * s;
      const y = it.row * s;

      if (it.type === TYPES.P) {
        const fillAlpha = (Number.isFinite(it.fillAlpha) ? it.fillAlpha : 100) / 100;

        if (fillAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = fillAlpha;
          ctx.fillStyle = it.areaColor || it.color || FILL.P;
          ctx.fillRect(x, y, w, h);
          ctx.restore();
        }

        const borderAlpha = (Number.isFinite(it.borderAlpha) ? it.borderAlpha : 100) / 100;
        if (borderAlpha > 0.001) {
          ctx.save();
          ctx.globalAlpha = borderAlpha;
          ctx.strokeStyle = it.borderColor || it.color || '#000000';

          const bw = (Number.isFinite(it.borderWidth) ? it.borderWidth : 1.5);
          ctx.lineWidth = bw / Core.zoom;

          const offset = bw / (2 * Core.zoom);
          ctx.strokeRect(
            x + offset,
            y + offset,
            w - bw / Core.zoom,
            h - bw / Core.zoom
          );

          ctx.restore();
        }

        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = it.color || FILL[it.type] || '#888';
        ctx.fillRect(x, y, w, h);
      }

      if (it.image) {
        const img = loadImage(it.image);
        if (img) {
          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, x, y, w, h);
          } else {
            if (!img._hooked) {
              img._hooked = true;
              img.addEventListener(
                'load',
                () => {
                  if (window.Draw) window.Draw.render();
                },
                { once: true }
              );
            }
          }
        }
      }

      const isSelected = Core.selected.has(it.id);
      ctx.lineWidth = (isSelected ? 2 : 1) / Core.zoom;
      ctx.strokeStyle = isSelected ? BORDER_SEL : BORDER;
      ctx.strokeRect(x, y, w, h);

      if(Core.zoom > 0.3) {
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        if(it.type === TYPES.P) {
          ctx.font = `${s * 1.4}px sans-serif`;
          ctx.fillText(it.label || 'P', x + w / 2, y + h / 2);
          
          if(it.locked) {
            ctx.font = `${s * 1.0}px sans-serif`;
            ctx.fillText('🔒', x + w / 2, y + h - s * 0.7);
          }
        } else {
          ctx.font = `${s * 1.5}px sans-serif`;
          ctx.fillText(it.order || '', x + w / 2, y + h / 2);
        }
      }
    }
  }

  function drawLasso() {
    const Core = getCore();
    const {ctx, selectionMode, lassoStart, _mouseW} = Core;
    
    if(selectionMode && lassoStart) {
      ctx.strokeStyle = '#00e5ff';
      ctx.setLineDash([4 / Core.zoom, 2 / Core.zoom]);
      ctx.lineWidth = 1 / Core.zoom;
      ctx.strokeRect(
        lassoStart.x, lassoStart.y,
        _mouseW.x - lassoStart.x, _mouseW.y - lassoStart.y
      );
      ctx.setLineDash([]);
    }
  }

  function drawMeasureLine() {
    const Core = getCore();
    if(window.Features && window.Features.Measure) {
      window.Features.Measure.draw(Core.ctx);
    }
  }

  function requestRender() {
    if(renderRequested) return;
    
    renderRequested = true;
    requestAnimationFrame(() => {
      const now = performance.now();
      if(now - lastRenderTime >= minFrameTime) {
        renderNow();
        lastRenderTime = now;
      }
      renderRequested = false;
    });
  }

  function renderNow() {
    const Core = getCore();
    if(!Core || !Core.ctx) return;

    if(Core._dirtyFlags.items) {
      Core.renumber();
    }

    Core.clearCanvas();
    Core.setTransform();
    
    drawGrid();
    drawItems();
    drawLasso();
    drawMeasureLine();

    const zoomPct = Math.round(Core.zoom * 100);
    const zoomLabel = Core.$('zoom-label');
    if(zoomLabel) zoomLabel.textContent = zoomPct + '%';

    const activeMode = Core.selectionMode ? "Mode: Selection" : "Mode: Draw";
    const status = Core.$('status');
    if(status) {
      const xCount = Core.items.filter(i => i.type === 'X').length;
      const yCount = Core.items.filter(i => i.type === 'Y').length;
      const pCount = Core.items.filter(i => i.type === 'P').length;
      status.innerHTML = `Bases: ${xCount} | Y: ${yCount} | P: ${pCount}`;
    }

    const modeEl = Core.$('active-mode');
    if(modeEl) modeEl.textContent = activeMode;

    if(Core._dirtyFlags.legend && window.UI && window.UI.updateLegend) {
      window.UI.updateLegend();
    }

    Core.clearDirtyFlags();
  }

  Draw.render = requestRender;
  Draw.renderImmediate = renderNow;
  Draw.clearCache = function() {
    renderCache.cellSize = null;
    renderCache.gridSize = null;
    renderCache.lastZoom = null;
    renderCache.needsFullRedraw = true;
  };

  window.Draw = Draw;
})();

// ============================================================
// GESTURES - Input Handler (FIXED: Mobile zoom/pan)
// ============================================================
(function(){
  const GestureState = {
    IDLE: 'idle', 
    DRAWING: 'drawing', 
    PANNING: 'panning', 
    SELECTING: 'selecting',
    DRAGGING: 'dragging', 
    LASSO: 'lasso', 
    PINCHING: 'pinching'
  };

  const Gestures = {
    state: GestureState.IDLE,
    pointers: new Map(),
    dragData: null,
    pinchData: null,
    lastMidCSS: null,
    panButton: 1,
    _renderScheduled: false
  };

  let lastTapTime = 0;
  let lastTapId = null;

  function $(id){ return document.getElementById(id); }
  function getCore(){ return window.Core; }
  function getCanvas(){ return window.Core.canvas; }
  
  function distance(a,b){
    const dx=a.x-b.x, dy=a.y-b.y; 
    return Math.hypot(dx,dy);
  }
  
  function midpoint(a,b){ 
    return {x:(a.x+b.x)/2, y:(a.y+b.y)/2};
  }
  
  function worldAtScreen(xCSS,yCSS){
    const Core=getCore(), canvas=getCanvas(), rect=canvas.getBoundingClientRect();
    const xDev=(xCSS-rect.left)*(canvas.width/rect.width);
    const yDev=(yCSS-rect.top)*(canvas.height/rect.height);
    return {
      x:(xDev/Core.dpr - Core.pan.x)/Core.zoom,
      y:(yDev/Core.dpr - Core.pan.y)/Core.zoom
    };
  }
  
  function hitItemAtRC(rc){
    const Core=getCore(), rr=rc.r, cc=rc.c;
    for(let i=Core.items.length-1;i>=0;--i){
      const it=Core.items[i], sz=Core.getSize(it);
      if(rr>=it.row && rr<it.row+sz && cc>=it.col && cc<it.col+sz) return it;
    }
    return null;
  }

  function handlePointerDown(e){
    if(e.pointerType==='mouse' && e.button===0 && e.width===0 && e.height===0) return;

    if(e.button === 2) {
      return;
    }

    e.preventDefault();
    const canvas=getCanvas(), Core=getCore();
    canvas.setPointerCapture(e.pointerId);
    Gestures.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});

    if(e.button===Gestures.panButton){
      Gestures.state=GestureState.PANNING;
      Gestures.lastMidCSS={x:e.clientX,y:e.clientY};
      return;
    }
  
    if(Gestures.pointers.size===1){
      const rc=Core.evtRC(e);
    
      if(window.Features && window.Features.Measure && window.Features.Measure.enabled) {
        if(window.Features.Measure.handleClick) {
          window.Features.Measure.handleClick(rc, e.clientX, e.clientY);
          return;
        }
      }

      if(Core.mode==='view'){
        Gestures.state=GestureState.PANNING;
        Gestures.lastMidCSS={x:e.clientX,y:e.clientY};
        return;
      }

      if(Core.mode==='draw'){
        const hit = hitItemAtRC(rc);
        if (hit) {
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            if (Core.selected.has(hit.id)) Core.selected.delete(hit.id);
            else Core.selected.add(hit.id);
          } else {
            if (!Core.selected.has(hit.id)) {
              Core.selected.clear();
              Core.selected.add(hit.id);
            }
          }
          Core.lastSelected = hit;
          Core.markDirty('selection');
          window.Draw.render();

          Gestures.dragData = {
            id: hit.id,
            ids: Array.from(Core.selected),
            anchorRC: rc,
            originals: {},
            didUndo: false
          };
          for (const id of Gestures.dragData.ids) {
            const it = Core.items.find(x => x.id === id);
            if (it) Gestures.dragData.originals[id] = { row: it.row, col: it.col };
          }
          Gestures.state = GestureState.SELECTING;
          Core.lassoStart = null;

          return;
        }

        Core.pushUndo(); 
        Core.placeX(rc); 
        Core.lastPaintRC=rc; 
        Gestures.state=GestureState.DRAWING;
      }
      else if(Core.mode==='select'){
        const hit=hitItemAtRC(rc);
        if(hit){
          const now = Date.now();
          if(hit.type === Core.TYPES.P && now - lastTapTime < 300 && lastTapId === hit.id) {
            if(window.openPointModal) {
              window.openPointModal(hit);
            }
            lastTapTime = 0;
            lastTapId = null;
            return;
          }
          lastTapTime = now;
          lastTapId = hit.id;
        
          if(!Core.selected.has(hit.id)) { 
            Core.selected.clear(); 
            Core.selected.add(hit.id); 
          }
          Core.lastSelected=hit;
          Core.markDirty('selection'); 
          window.Draw.render();
        
          Gestures.dragData={
            id:hit.id,
            ids:Array.from(Core.selected),
            anchorRC:rc,
            originals:{},
            didUndo:false
          };
          for(const id of Gestures.dragData.ids){
            const it=Core.items.find(x=>x.id===id);
            if(it) Gestures.dragData.originals[id]={row:it.row,col:it.col};
          }
          Gestures.state=GestureState.SELECTING;
          Core.lassoStart=null;
        }else{
          Core.selected.clear(); 
          Core.markDirty('selection'); 
          window.Draw.render();
          Gestures.dragData=null; 
          Core.lassoStart={x:Core._mouseW.x,y:Core._mouseW.y};
          Gestures.state=GestureState.LASSO;
        }
      }
    } else if(Gestures.pointers.size===2){
      const [a,b]=[...Gestures.pointers.values()], mid=midpoint(a,b);
      Gestures.pinchData={
        startDist:distance(a,b), 
        startZoom:Core.zoom, 
        midCSS:mid,
        midWorld:worldAtScreen(mid.x,mid.y)
      };
      Gestures.state=GestureState.PINCHING;
    }
  }
	
	
	function handlePointerMove(e) {
    if (!Gestures.pointers.has(e.pointerId)) return;
    e.preventDefault();
    Gestures.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const Core = getCore();
    const rc = Core.evtRC(e);

    if (Gestures.state === GestureState.PANNING && Gestures.lastMidCSS) {
      Core.pan.x += (e.clientX - Gestures.lastMidCSS.x);
      Core.pan.y += (e.clientY - Gestures.lastMidCSS.y);
      Core.markDirty('view');
      window.Draw.render();
      Gestures.lastMidCSS = { x: e.clientX, y: e.clientY };
      return;
    }

    if (Gestures.state === GestureState.PINCHING && Gestures.pointers.size === 2) {
      const [a, b] = [...Gestures.pointers.values()];
      const mid = midpoint(a, b);
      const dist = distance(a, b);
      const pinch = Gestures.pinchData;

      const distChange = Math.abs(dist - pinch.startDist);
      const scaleChange = dist / (pinch.startDist || dist);

      const isPan = (distChange / pinch.startDist) < 0.05;

      if (isPan) {
        Core.pan.x += (mid.x - pinch.midCSS.x);
        Core.pan.y += (mid.y - pinch.midCSS.y);
        pinch.midCSS = mid;
      } else {
        const dynamicMax = Core.getDynamicMaxZoom ? Core.getDynamicMaxZoom() : 8;
        const targetZoom = pinch.startZoom * scaleChange;
        const oldZoom = Core.zoom;
        Core.zoom = Math.max(0.4, Math.min(dynamicMax, targetZoom));
        
        const canvas = getCanvas();
        const rect = canvas.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const centerWorldX = (centerX - Core.pan.x) / oldZoom;
        const centerWorldY = (centerY - Core.pan.y) / oldZoom;
        
        Core.pan.x = centerX - centerWorldX * Core.zoom;
        Core.pan.y = centerY - centerWorldY * Core.zoom;

        const sliderEl = document.getElementById('zoom-slider');
        if (sliderEl) sliderEl.max = String(Math.round(Core.getDynamicMaxZoom() * 100));
      }

      Gestures.lastMidCSS = mid;
      const pct = Math.round(Core.zoom * 100);
      const slider = document.getElementById('zoom-slider');
      const label = document.getElementById('zoom-label');
      if (slider) slider.value = String(pct);
      if (label) label.textContent = pct + '%';

      if (!Gestures._renderScheduled) {
        Gestures._renderScheduled = true;
        requestAnimationFrame(() => {
          Core.markDirty('view');
          window.Draw.render();
          Gestures._renderScheduled = false;
        });
      }
      return;
    }

    if (Gestures.state === GestureState.LASSO) {
      window.Draw.render();
      return;
    }

    if (Gestures.state === GestureState.SELECTING && Gestures.dragData) {
      const dd = Gestures.dragData;
      const moveRC = rc;

      const movedEnough =
        Math.abs(moveRC.r - dd.anchorRC.r) >= 1 ||
        Math.abs(moveRC.c - dd.anchorRC.c) >= 1;
      if (movedEnough) Gestures.state = GestureState.DRAGGING;
    }

    if (Gestures.state === GestureState.DRAGGING && Gestures.dragData) {
      const Core = getCore();
      const dd = Gestures.dragData;
      const dr = rc.r - dd.anchorRC.r;
      const dc = rc.c - dd.anchorRC.c;

      if (!dd.didUndo) {
        Core.pushUndo(true);
        dd.didUndo = true;
      }

      const ignoreSet = new Set(dd.ids);
      const proposedPositions = [];
      let canMoveAll = true;

      for(const id of dd.ids) {
        const it = Core.items.find(x => x.id === id);
        if (!it || it.locked) {
          canMoveAll = false;
          break;
        }
        
        const orig = dd.originals[id];
        if (!orig) {
          canMoveAll = false;
          break;
        }

        const sizeW = it.sizeW || Core.getSize(it);
        const sizeH = it.sizeH || Core.getSize(it);

        const newRow = Math.max(0, Math.min(Core.GRID - sizeH, orig.row + dr));
        const newCol = Math.max(0, Math.min(Core.GRID - sizeW, orig.col + dc));

        proposedPositions.push({ 
          id, 
          row: newRow, 
          col: newCol,
          sizeW: sizeW,
          sizeH: sizeH
        });
      }

      if (canMoveAll) {
        for (const proposed of proposedPositions) {
          const it = Core.items.find(x => x.id === proposed.id);
          if (!it) {
            canMoveAll = false;
            break;
          }

          const testObj = {
            id: it.id,
            row: proposed.row,
            col: proposed.col,
            sizeW: proposed.sizeW,
            sizeH: proposed.sizeH,
            type: it.type
          };

          if (Core.collides(testObj, ignoreSet)) {
            canMoveAll = false;
            break;
          }
        }
      }

      if (canMoveAll && proposedPositions.length > 0) {
        for (const pos of proposedPositions) {
          const it = Core.items.find(x => x.id === pos.id);
          if (it) {
            it.row = pos.row;
            it.col = pos.col;
          }
        }
        Core.markDirty('items');
        window.Draw.render();
      }
      
      return;
    }

    if (Gestures.state === GestureState.DRAWING) {
      if (!Core.lastPaintRC || rc.r !== Core.lastPaintRC.r || rc.c !== Core.lastPaintRC.c) {
        Core.placeX(rc);
        Core.lastPaintRC = rc;
      }
    }
  }

  function handlePointerUp(e){
    e.preventDefault();
    const canvas = getCanvas(), Core = getCore();
    canvas.releasePointerCapture(e.pointerId);
    Gestures.pointers.delete(e.pointerId);

    Core.evtRC(e);

    if (Gestures.pointers.size === 0) {
      if (Gestures.state === GestureState.LASSO && Core.lassoStart) {
        Core.selected.clear();
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
          const ly2 = Math.max(y1, y2) + tol;

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

  function handleContextMenu(e){
    e.preventDefault();
    
    // PRIORITY: If measure tool is active, show stop menu
    if(window.Features && window.Features.Measure && window.Features.Measure.enabled) {
      const items = [
        { 
          icon:'ℹ️', 
          label:'Stop Measure Tool', 
          action: () => {
            window.Features.Measure.toggle();
          }
        }
      ];
      showDToolsContextMenu(e.clientX, e.clientY, items);
      return;
    }
    
    const Core = getCore();
    const x = e.clientX, y = e.clientY;
    const selectedCount = Core.selected ? Core.selected.size : 0;
    const getById = (id) => document.getElementById(id);
    const rc = Core.evtRC(e);
    const hit = hitItemAtRC(rc);
    const isSelect = (Core.mode === 'select') || Core.selectionMode === true;
    const isDraw   = (Core.mode === 'draw') && !isSelect;
    
    if (isSelect && hit) {
      if (!Core.selected.has(hit.id)) {
        Core.selected.clear();
        Core.selected.add(hit.id);
        Core.lastSelected = hit;
        Core.markDirty('selection');
        if (window.Draw) window.Draw.render();
      }
    }

    const selectedIds = Array.from(Core.selected || []);
    const selectedItems = selectedIds.map(id => Core.items.find(it => it.id === id)).filter(Boolean);
    const selectedPointsCount = selectedItems.filter(it => it.type === Core.TYPES.P).length;

    const canPaste = !!Core.clipboard && Core.clipboard.length > 0;
    const canAlign = selectedCount >= 2;

    const canEditPoint =
      (hit && hit.type === Core.TYPES.P) ||
      (selectedCount === 1 && selectedItems[0]?.type === Core.TYPES.P);

    const canTogglePointAction =
      (hit && hit.type === Core.TYPES.P) || (selectedPointsCount > 0);

    const items = [];

    if (isDraw) {
      items.push(
        { icon:'➕', label:'Add Custom Point', action:()=>{ const b=document.getElementById('add-point'); if(b) b.click(); } },
        'divider'
      );
      
      if (window.ElementPresets) {
        for (const [key, config] of Object.entries(window.ElementPresets)) {
          items.push({
            icon: config.icon || '📍',
            label: config.menuLabel || config.label,
            action: () => addPresetElement(key)
          });
        }
      }
      
      items.push(
        'divider',
        { icon:'🔲', label:'Select All', action:()=>{ const b=getById('select-all-btn'); if(b) b.click(); } },
        { icon:'🗑️', label:'Clear All', action:()=>{ const b=document.getElementById('clear'); if(b) b.click(); } }
      );

      showDToolsContextMenu(x, y, items);
      return;
    }

    function addPresetElement(preset) {
      const Core = getCore();
      const canvas = document.getElementById('board');
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const world = Core.screenToWorld(cx, cy);
      const rc = Core.worldToRC(world.x, world.y);

      Core.pushUndo(true);

      const config = window.ElementPresets ? window.ElementPresets[preset] : null;
      
      if (config) {
        Core.addPoint(Math.round(rc.r), Math.round(rc.c), config);
        if (window.UI && window.UI.Toast) {
          window.UI.Toast.success(`${config.label} added`);
        }
        Core.markDirty('items');
        if (window.Draw) window.Draw.render();
      }
    }

    items.push(
      { icon:'✖', label:'Delete',   action:()=>{ const b=getById('delete-selected'); if(b) b.click(); }, disabled: selectedCount === 0 },
      { icon:'📋', label:'Copy',     action:()=>{ const b=getById('copy-selected'); if(b) b.click(); },   disabled: selectedCount === 0 },
      { icon:'📄', label:'Paste',    action:()=>{ const b=getById('paste-selected'); if(b) b.click(); },  disabled: !canPaste },
      { icon:'🔲', label:'Select All', action:()=>{ const b=getById('select-all-btn'); if(b) b.click(); } },
      { icon:'🔳', label:'Deselect', action:()=>{ Core.selected.clear(); Core.markDirty('selection'); if(window.Draw) window.Draw.render(); }, disabled: selectedCount === 0 },

      'divider',

      { icon:'↔️', label:'Align Horizontal', action:()=>{ const b=getById('align-h'); if(b) b.click(); }, disabled: !canAlign },
      { icon:'↕️', label:'Align Vertical',   action:()=>{ const b=getById('align-v'); if(b) b.click(); }, disabled: !canAlign },

      'divider',

      { icon:'✏️', label:'Edit Point',    action:()=>{ const b=getById('edit-point'); if(b) b.click(); },    disabled: !canEditPoint },
      { icon:'🔒', label:'Lock/Unlock',   action:()=>{ const b=getById('toggle-lock'); if(b) b.click(); },    disabled: !canTogglePointAction },
      { icon:'💡', label:'Toggle Light',  action:()=>{ const b=getById('lights'); if(b) b.click(); },         disabled: !canTogglePointAction },

      'divider',

      { icon:'🗑️', label:'Clear All',     action:()=>{ const b=getById('clear'); if(b) b.click(); } }
    );

    showDToolsContextMenu(x, y, items);
  }

  function showDToolsContextMenu(x, y, items) {
    if (window.UI && window.UI.showContextMenu) {
      window.UI.showContextMenu(x, y, items);
    }
  }

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
  window.getCore = function() { return window.Core; };

  window.addPresetElementFromMenu = function(preset) {
    const Core = getCore();
    const canvas = document.getElementById('board');
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const world = Core.screenToWorld(cx, cy);
    const rc = Core.worldToRC(world.x, world.y);

    Core.pushUndo(true);

    const config = window.ElementPresets ? window.ElementPresets[preset] : null;
    
    if (config) {
      Core.addPoint(Math.round(rc.r), Math.round(rc.c), config);
      if (window.UI && window.UI.Toast) {
        window.UI.Toast.success(`${config.label} added`);
      }
      Core.markDirty('items');
      if (window.Draw) window.Draw.render();
    }
  };
  
})();
