// ============================================================
// CORE ENGINE - MapPlanner
// FIXED: Grid boundary, measure tool compatibility, and all bugs
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
      Core.setGridSize(snapshot.gridSize, {scale: false});
    }
    
    Core.items = snapshot.items || [];
    Core.idSeq = snapshot.idSeq || 1;
    Core.legendLabels = snapshot.legendLabels || {};
    
    Core.markDirty('items');
    Core.markDirty('legend');
    
    if(window.Draw) window.Draw.render();
    if(window.UI && window.UI.updateLegend) window.UI.updateLegend();
  };

  // ============================================================
  // COORDINATE TRANSFORMATIONS
  // ============================================================
  Core.worldToScreen = function(wx, wy) {
    return {
      x: wx * Core.zoom + Core.pan.x,
      y: wy * Core.zoom + Core.pan.y
    };
  };

  Core.screenToWorld = function(sx, sy) {
    const canvas = Core.canvas;
    const rect = canvas.getBoundingClientRect();
    const canvasX = sx - rect.left;
    const canvasY = sy - rect.top;
    
    return {
      x: (canvasX - Core.pan.x) / Core.zoom,
      y: (canvasY - Core.pan.y) / Core.zoom
    };
  };

  Core.worldToRC = function(wx, wy) {
    const s = Core.cell();
    return {
      r: Math.floor(wy / s),
      c: Math.floor(wx / s)
    };
  };

  Core.evtRC = function(e) {
    const world = Core.screenToWorld(e.clientX, e.clientY);
    return Core.worldToRC(world.x, world.y);
  };

  // ============================================================
  // ITEM PLACEMENT
  // ============================================================
  Core.placeX = function(rc) {
    Core.place('X', rc.r, rc.c);
  };

  Core.placeY = function(rc) {
    Core.place('Y', rc.r, rc.c);
  };

  Core.place = function(type, row, col, opts = {}) {
    const sz = opts.size || Core.SIZE[type] || 3;
    
    if(Core.collides(row, col, sz, sz)) {
      const alt = Core.findFreeSpot(row, col, sz, sz);
      if(alt) {
        row = alt.r;
        col = alt.c;
      } else {
        if(window.UI && window.UI.Toast) {
          window.UI.Toast.warning('No free space nearby');
        }
        return null;
      }
    }
    
    const item = {
      id: Core.idSeq++,
      type: type,
      row: row,
      col: col,
      size: sz,
      color: opts.color || Core.FILL[type] || '#888',
      order: opts.order || '',
      label: opts.label || '',
      locked: false,
      ...opts
    };
    
    Core.items.push(item);
    Core.markDirty('items');
    if(window.Draw) window.Draw.render();
    
    return item;
  };

  // ============================================================
  // COLLISION DETECTION
  // ============================================================
  Core.collides = function(row, col, sizeW, sizeH, ignoreId = null) {
    const candidates = Core.spatialIndex.query(row, col);
    
    for(const it of candidates) {
      if(it.id === ignoreId) continue;
      
      const itSizeW = it.sizeW || Core.getSize(it);
      const itSizeH = it.sizeH || Core.getSize(it);
      
      const overlapsH = !(col + sizeW <= it.col || col >= it.col + itSizeW);
      const overlapsV = !(row + sizeH <= it.row || row >= it.row + itSizeH);
      
      if(overlapsH && overlapsV) return true;
    }
    
    return false;
  };

  Core.findFreeSpot = function(centerR, centerC, sizeW, sizeH, maxRadius = 15) {
    for(let r = 1; r <= maxRadius; r++) {
      for(let dr = -r; dr <= r; dr++) {
        for(let dc = -r; dc <= r; dc++) {
          if(Math.abs(dr) < r && Math.abs(dc) < r) continue;
          
          const testR = Math.max(0, Math.min(Core.GRID - sizeH, centerR + dr));
          const testC = Math.max(0, Math.min(Core.GRID - sizeW, centerC + dc));
          
          if(!Core.collides(testR, testC, sizeW, sizeH)) {
            return {r: testR, c: testC};
          }
        }
      }
    }
    return null;
  };

  // ============================================================
  // ITEM DELETION
  // ============================================================
  Core.deleteItem = function(id) {
    const idx = Core.items.findIndex(it => it.id === id);
    if(idx !== -1) {
      Core.items.splice(idx, 1);
      Core.selected.delete(id);
      Core.markDirty('items');
      Core.markDirty('selection');
      if(window.Draw) window.Draw.render();
    }
  };

  Core.deleteSelected = function() {
    if(Core.selected.size === 0) return;
    
    Core.pushUndo(true);
    
    for(const id of Core.selected) {
      const idx = Core.items.findIndex(it => it.id === id);
      if(idx !== -1) Core.items.splice(idx, 1);
    }
    
    Core.selected.clear();
    Core.markDirty('items');
    Core.markDirty('selection');
    if(window.Draw) window.Draw.render();
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.success('Deleted selected items');
    }
  };

  // ============================================================
  // CLIPBOARD OPERATIONS
  // ============================================================
  Core.copySelected = function() {
    if(Core.selected.size === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('Nothing selected to copy');
      }
      return;
    }
    
    Core.clipboard = [];
    for(const id of Core.selected) {
      const it = Core.items.find(x => x.id === id);
      if(it) Core.clipboard.push({...it});
    }
    
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.success(`Copied ${Core.clipboard.length} item(s)`);
    }
  };

  Core.pasteClipboard = function() {
    if(Core.clipboard.length === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('Clipboard is empty');
      }
      return;
    }
    
    Core.pushUndo(true);
    Core.selected.clear();
    
    for(const orig of Core.clipboard) {
      const sizeW = orig.sizeW || Core.getSize(orig);
      const sizeH = orig.sizeH || Core.getSize(orig);
      
      let newR = orig.row + 2;
      let newC = orig.col + 2;
      
      if(Core.collides(newR, newC, sizeW, sizeH)) {
        const spot = Core.findFreeSpot(newR, newC, sizeW, sizeH);
        if(spot) {
          newR = spot.r;
          newC = spot.c;
        } else {
          continue;
        }
      }
      
      const newItem = {
        ...orig,
        id: Core.idSeq++,
        row: newR,
        col: newC
      };
      
      Core.items.push(newItem);
      Core.selected.add(newItem.id);
    }
    
    Core.markDirty('items');
    Core.markDirty('selection');
    if(window.Draw) window.Draw.render();
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.success(`Pasted ${Core.clipboard.length} item(s)`);
    }
  };

  // ============================================================
  // GRID SIZE MANAGEMENT
  // ============================================================
  Core.setGridSize = function(newSize, options = {}) {
    const oldSize = Core.GRID;
    Core.GRID = Math.max(20, Math.min(2000, newSize));
    
    if(options.scale !== false) {
      const ratio = Core.GRID / oldSize;
      for(const it of Core.items) {
        it.row = Math.round(it.row * ratio);
        it.col = Math.round(it.col * ratio);
        if(it.size) it.size = Math.max(1, Math.round(it.size * ratio));
        if(it.sizeW) it.sizeW = Math.max(1, Math.round(it.sizeW * ratio));
        if(it.sizeH) it.sizeH = Math.max(1, Math.round(it.sizeH * ratio));
        if(it.area) it.area = Math.max(0, Math.round(it.area * ratio));
      }
    }
    
    Core.markDirty('items');
    Core.markDirty('view');
    if(window.Draw) window.Draw.render();
  };

  // ============================================================
  // FIT VIEW
  // ============================================================
  Core.fitView = function() {
    if(Core.items.length === 0) {
      Core.zoom = 1;
      Core.pan = {x: 0, y: 0};
      Core.markDirty('view');
      if(window.Draw) window.Draw.render();
      return;
    }
    
    let minR = Infinity, minC = Infinity;
    let maxR = -Infinity, maxC = -Infinity;
    
    for(const it of Core.items) {
      const sizeW = it.sizeW || Core.getSize(it);
      const sizeH = it.sizeH || Core.getSize(it);
      
      minR = Math.min(minR, it.row);
      minC = Math.min(minC, it.col);
      maxR = Math.max(maxR, it.row + sizeH);
      maxC = Math.max(maxC, it.col + sizeW);
    }
    
    const s = Core.cell();
    const contentW = (maxC - minC) * s;
    const contentH = (maxR - minR) * s;
    
    const padding = 40;
    const availW = Core.basePx - padding * 2;
    const availH = Core.basePx - padding * 2;
    
    const zoomW = availW / contentW;
    const zoomH = availH / contentH;
    Core.zoom = Math.min(zoomW, zoomH, 8);
    
    const centerWorldX = (minC + maxC) * s / 2;
    const centerWorldY = (minR + maxR) * s / 2;
    
    Core.pan.x = Core.basePx / 2 - centerWorldX * Core.zoom;
    Core.pan.y = Core.basePx / 2 - centerWorldY * Core.zoom;
    
    const zoomSlider = document.getElementById('zoom-slider');
    const zoomLabel = document.getElementById('zoom-label');
    if(zoomSlider) zoomSlider.value = String(Math.round(Core.zoom * 100));
    if(zoomLabel) zoomLabel.textContent = Math.round(Core.zoom * 100) + '%';
    
    Core.markDirty('view');
    if(window.Draw) window.Draw.render();
  };

  // ============================================================
  // CANVAS RESIZE
  // ============================================================
  Core.resizeCanvas = function() {
    if(!Core.canvas) return;
    
    Core.dpr = window.devicePixelRatio || 1;
    const w = Core.basePx;
    const h = Core.basePx;
    
    Core.canvas.width = w * Core.dpr;
    Core.canvas.height = h * Core.dpr;
    Core.canvas.style.width = w + 'px';
    Core.canvas.style.height = h + 'px';
    
    if(Core.ctx) {
      Core.ctx.scale(Core.dpr, Core.dpr);
    }
    
    Core.markDirty('view');
    Core.markDirty('items');
    if(window.Draw) window.Draw.render();
  };

  // ============================================================
  // DYNAMIC MAX ZOOM (based on grid size)
  // ============================================================
  Core.getDynamicMaxZoom = function() {
    if(Core.GRID <= 100) return 8;
    if(Core.GRID <= 200) return 6;
    if(Core.GRID <= 500) return 4;
    return 3;
  };

  // ============================================================
  // UNDO/REDO FUNCTIONS
  // ============================================================
  Core.undo = function() {
    if(Core.history.undo.length === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('Nothing to undo');
      }
      return;
    }
    
    const current = Core.history.createSnapshot();
    const entry = Core.history.undo.pop();
    Core.history.redo.push({
      version: Core._stateVersion++,
      timestamp: Date.now(),
      action: {type: 'snapshot', data: current}
    });
    
    Core.restore(entry.action.data);
    
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.info('Undo');
    }
  };

  Core.redo = function() {
    if(Core.history.redo.length === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('Nothing to redo');
      }
      return;
    }
    
    const current = Core.history.createSnapshot();
    const entry = Core.history.redo.pop();
    Core.history.undo.push({
      version: Core._stateVersion++,
      timestamp: Date.now(),
      action: {type: 'snapshot', data: current}
    });
    
    Core.restore(entry.action.data);
    
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.info('Redo');
    }
  };

  // ============================================================
  // CLEAR ALL
  // ============================================================
  Core.clearAll = function() {
    if(Core.items.length === 0) return;
    
    Core.pushUndo(true);
    Core.items = [];
    Core.selected.clear();
    Core.markDirty('items');
    Core.markDirty('selection');
    if(window.Draw) window.Draw.render();
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.success('Cleared all items');
    }
  };

  // ============================================================
  // SELECT ALL
  // ============================================================
  Core.selectAll = function() {
    Core.selected.clear();
    for(const it of Core.items) {
      Core.selected.add(it.id);
    }
    Core.markDirty('selection');
    if(window.Draw) window.Draw.render();
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.info(`Selected ${Core.selected.size} items`);
    }
  };

  // ============================================================
  // ALIGNMENT FUNCTIONS
  // ============================================================
  Core.alignHorizontal = function(n, gap = 0) {
    if(Core.selected.size === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('No items selected');
      }
      return;
    }
    
    Core.pushUndo(true);
    
    const items = Array.from(Core.selected).map(id => 
      Core.items.find(it => it.id === id)
    ).filter(it => it && !it.locked);
    
    items.sort((a, b) => (a.row * Core.GRID + a.col) - (b.row * Core.GRID + b.col));
    
    let currentCol = 0;
    let currentRow = 0;
    let maxHeightInRow = 0;
    
    for(let i = 0; i < items.length; i++) {
      const it = items[i];
      const sizeW = it.sizeW || Core.getSize(it);
      const sizeH = it.sizeH || Core.getSize(it);
      
      if(i > 0 && i % n === 0) {
        currentRow += maxHeightInRow + gap;
        currentCol = 0;
        maxHeightInRow = 0;
      }
      
      it.row = currentRow;
      it.col = currentCol;
      
      currentCol += sizeW + gap;
      maxHeightInRow = Math.max(maxHeightInRow, sizeH);
    }
    
    Core.markDirty('items');
    if(window.Draw) window.Draw.render();
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.success('Aligned horizontally');
    }
  };

  Core.alignVertical = function(n, gap = 0) {
    if(Core.selected.size === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('No items selected');
      }
      return;
    }
    
    Core.pushUndo(true);
    
    const items = Array.from(Core.selected).map(id => 
      Core.items.find(it => it.id === id)
    ).filter(it => it && !it.locked);
    
    items.sort((a, b) => (a.row * Core.GRID + a.col) - (b.row * Core.GRID + b.col));
    
    let currentRow = 0;
    let currentCol = 0;
    let maxWidthInCol = 0;
    
    for(let i = 0; i < items.length; i++) {
      const it = items[i];
      const sizeW = it.sizeW || Core.getSize(it);
      const sizeH = it.sizeH || Core.getSize(it);
      
      if(i > 0 && i % n === 0) {
        currentCol += maxWidthInCol + gap;
        currentRow = 0;
        maxWidthInCol = 0;
      }
      
      it.row = currentRow;
      it.col = currentCol;
      
      currentRow += sizeH + gap;
      maxWidthInCol = Math.max(maxWidthInCol, sizeW);
    }
    
    Core.markDirty('items');
    if(window.Draw) window.Draw.render();
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.success('Aligned vertically');
    }
  };

  // ============================================================
  // EXPORT CORE
  // ============================================================
  window.Core = Core;
})();

// ============================================================
// DRAW ENGINE - Rendering System
// FIXED: Grid boundary stays fixed in world coordinates
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

  // ============================================================
  // FIXED: Grid with boundary rectangle in world coordinates
  // ============================================================
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

    // Calculate grid world size (working area)
    const gridWorldSize = GRID * s;

    // Calculate visible viewport in world coordinates
    const viewX1 = -Core.pan.x / Core.zoom;
    const viewY1 = -Core.pan.y / Core.zoom;
    const viewX2 = viewX1 + (Core.basePx / Core.zoom);
    const viewY2 = viewY1 + (Core.basePx / Core.zoom);

    // Draw background for entire visible area
    ctx.fillStyle = '#2a2f45';
    ctx.fillRect(viewX1, viewY1, viewX2 - viewX1, viewY2 - viewY1);

    // Draw grid lines across ENTIRE visible viewport (infinite grid)
    ctx.strokeStyle = '#404a78';
    ctx.lineWidth = 1 / Core.zoom;

    const startRow = Math.floor(viewY1 / s);
    const endRow = Math.ceil(viewY2 / s);
    const startCol = Math.floor(viewX1 / s);
    const endCol = Math.ceil(viewX2 / s);

    ctx.beginPath();
    // Horizontal lines - across entire viewport
    for(let i = startRow; i <= endRow; i++) {
      const p = i * s;
      ctx.moveTo(viewX1, p);
      ctx.lineTo(viewX2, p);
    }
    // Vertical lines - across entire viewport
    for(let i = startCol; i <= endCol; i++) {
      const p = i * s;
      ctx.moveTo(p, viewY1);
      ctx.lineTo(p, viewY2);
    }
    ctx.stroke();

    // FIXED: Draw boundary rectangle at FIXED world coordinates (0,0) to (gridWorldSize, gridWorldSize)
    // This rectangle will not move with pan/zoom - it stays anchored to the grid origin
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3 / Core.zoom;
    ctx.setLineDash([10 / Core.zoom, 5 / Core.zoom]);
    ctx.strokeRect(0, 0, gridWorldSize, gridWorldSize);
    ctx.setLineDash([]);
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
    
    // Enable CORS for images from same origin
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

    // Draw area effects
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

    // Draw ambient effects (Y type)
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

    // Draw blocks
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

      // Draw image if present
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

      // Draw border
      const isSelected = Core.selected.has(it.id);
      ctx.lineWidth = (isSelected ? 2 : 1) / Core.zoom;
      ctx.strokeStyle = isSelected ? BORDER_SEL : BORDER;
      ctx.strokeRect(x, y, w, h);

      // Draw labels
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
    if(!Core.lassoStart || !Core._mouseW) return;
    
    const {ctx} = Core;
    const x1 = Core.lassoStart.x;
    const y1 = Core.lassoStart.y;
    const x2 = Core._mouseW.x;
    const y2 = Core._mouseW.y;
    
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2 / Core.zoom;
    ctx.setLineDash([5 / Core.zoom, 3 / Core.zoom]);
    ctx.strokeRect(
      Math.min(x1, x2),
      Math.min(y1, y2),
      Math.abs(x2 - x1),
      Math.abs(y2 - y1)
    );
    ctx.setLineDash([]);
  }

  // ============================================================
  // MAIN RENDER FUNCTION
  // ============================================================
  Draw.render = function() {
    if(renderRequested) return;
    renderRequested = true;
    
    requestAnimationFrame(() => {
      Draw.renderImmediate();
      renderRequested = false;
    });
  };

  Draw.renderImmediate = function() {
    const Core = getCore();
    if(!Core || !Core.ctx) return;
    
    const now = performance.now();
    if(now - lastRenderTime < minFrameTime) {
      return;
    }
    lastRenderTime = now;
    
    const {ctx} = Core;
    
    ctx.save();
    ctx.clearRect(0, 0, Core.basePx, Core.basePx);
    
    // Apply transformations
    ctx.translate(Core.pan.x, Core.pan.y);
    ctx.scale(Core.zoom, Core.zoom);
    
    // Draw all layers
    drawGrid();
    drawItems();
    drawLasso();
    
    // FIXED: Draw measure tool line (if active)
    if(window.Features && window.Features.Measure && window.Features.Measure.enabled) {
      window.Features.Measure.draw(ctx);
    }
    
    ctx.restore();
    
    Core.clearDirtyFlags();
    
    // Update FPS counter
    if(window.Features && window.Features.FPS) {
      window.Features.FPS.tick();
    }
  };

  window.Draw = Draw;
})();

// ============================================================
// GESTURE & INPUT SYSTEM
// Handles all mouse, touch, and keyboard input
// ============================================================
(function(){
  const Gestures = {};
  
  const GestureState = {
    IDLE: 'IDLE',
    PANNING: 'PANNING',
    DRAWING: 'DRAWING',
    SELECTING: 'SELECTING',
    DRAGGING: 'DRAGGING',
    LASSO: 'LASSO',
    PINCHING: 'PINCHING'
  };
  
  Gestures.state = GestureState.IDLE;
  Gestures.pointers = new Map();
  Gestures.dragData = null;
  Gestures.pinchData = null;
  Gestures.lastMidCSS = null;
  Gestures._renderScheduled = false;

  let lastTapTime = 0;
  let lastTapId = null;

  function getCore() {
    return window.Core;
  }

  function getCanvas() {
    return document.getElementById('board');
  }

  function hitItemAtRC(rc) {
    const Core = getCore();
    const candidates = Core.spatialIndex.query(rc.r, rc.c);
    
    for(const it of candidates) {
      const sizeW = it.sizeW || Core.getSize(it);
      const sizeH = it.sizeH || Core.getSize(it);
      
      if(rc.r >= it.row && rc.r < it.row + sizeH &&
         rc.c >= it.col && rc.c < it.col + sizeW) {
        return it;
      }
    }
    return null;
  }

  function midpoint(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
  }

  function distance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function worldAtScreen(sx, sy) {
    const Core = getCore();
    const canvas = getCanvas();
    const rect = canvas.getBoundingClientRect();
    const canvasX = sx - rect.left;
    const canvasY = sy - rect.top;
    return {
      x: (canvasX - Core.pan.x) / Core.zoom,
      y: (canvasY - Core.pan.y) / Core.zoom
    };
  }

  function handlePointerDown(e) {
    const Core = getCore();
    
    // Right-click - context menu (select mode only)
    if(e.button === 2) {
      e.preventDefault();
      
      if(Core.mode === 'select') {
        const rc = Core.evtRC(e);
        const hit = hitItemAtRC(rc);
        
        if(hit) {
          if(!Core.selected.has(hit.id)) {
            Core.selected.clear();
            Core.selected.add(hit.id);
            Core.markDirty('selection');
            window.Draw.render();
          }
          
          if(window.UI && window.UI.showItemContextMenu) {
            window.UI.showItemContextMenu(e.clientX, e.clientY, hit);
          }
        }
      }
      
      return;
    }
    
    e.preventDefault();
    Gestures.pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});

    if(Gestures.pointers.size === 1) {
      const rc = Core.evtRC(e);
      const world = worldAtScreen(e.clientX, e.clientY);
      Core._mouseW = world;

      // FIXED: Check if measure tool is active
      if(window.Features && window.Features.Measure && window.Features.Measure.enabled) {
        // Let measure tool handle the click
        return;
      }

      if(Core.mode === 'view') {
        Gestures.lastMidCSS = {x: e.clientX, y: e.clientY};
        Gestures.state = GestureState.PANNING;
      }
      else if(Core.mode === 'draw') {
        const hit = hitItemAtRC(rc);
        if(hit) {
          if(!Core.selected.has(hit.id)) {
            Core.selected.clear();
            Core.selected.add(hit.id);
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
          for(const id of Gestures.dragData.ids) {
            const it = Core.items.find(x => x.id === id);
            if(it) Gestures.dragData.originals[id] = {row: it.row, col: it.col};
          }
          Gestures.state = GestureState.SELECTING;
          Core.lassoStart = null;

          return;
        }

        Core.pushUndo();
        Core.placeX(rc);
        Core.lastPaintRC = rc;
        Gestures.state = GestureState.DRAWING;
      }
      else if(Core.mode === 'select') {
        const hit = hitItemAtRC(rc);
        if(hit) {
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
          for(const id of Gestures.dragData.ids) {
            const it = Core.items.find(x => x.id === id);
            if(it) Gestures.dragData.originals[id] = {row: it.row, col: it.col};
          }
          Gestures.state = GestureState.SELECTING;
          Core.lassoStart = null;
        } else {
          Core.selected.clear();
          Core.markDirty('selection');
          window.Draw.render();
          Gestures.dragData = null;
          Core.lassoStart = {x: Core._mouseW.x, y: Core._mouseW.y};
          Gestures.state = GestureState.LASSO;
        }
      }
    } else if(Gestures.pointers.size === 2) {
      const [a, b] = [...Gestures.pointers.values()];
      const mid = midpoint(a, b);
      Gestures.pinchData = {
        startDist: distance(a, b),
        startZoom: Core.zoom,
        midCSS: mid,
        midWorld: worldAtScreen(mid.x, mid.y)
      };
      Gestures.state = GestureState.PINCHING;
    }
  }

  function handlePointerMove(e) {
    if(!Gestures.pointers.has(e.pointerId)) return;
    e.preventDefault();
    Gestures.pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
    const Core = getCore();
    const rc = Core.evtRC(e);

    if(Gestures.state === GestureState.PANNING && Gestures.lastMidCSS) {
      Core.pan.x += (e.clientX - Gestures.lastMidCSS.x);
      Core.pan.y += (e.clientY - Gestures.lastMidCSS.y);
      Core.markDirty('view');
      window.Draw.render();
      Gestures.lastMidCSS = {x: e.clientX, y: e.clientY};
      return;
    }

    if(Gestures.state === GestureState.PINCHING && Gestures.pointers.size === 2) {
      const [a, b] = [...Gestures.pointers.values()];
      const mid = midpoint(a, b);
      const dist = distance(a, b);
      const pinch = Gestures.pinchData;

      const distChange = Math.abs(dist - pinch.startDist);
      const scaleChange = dist / (pinch.startDist || dist);

      const isPan = (distChange / pinch.startDist) < 0.05;

      if(isPan) {
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
        if(sliderEl) sliderEl.max = String(Math.round(Core.getDynamicMaxZoom() * 100));
      }

      Gestures.lastMidCSS = mid;
      const pct = Math.round(Core.zoom * 100);
      const slider = document.getElementById('zoom-slider');
      const label = document.getElementById('zoom-label');
      if(slider) slider.value = String(pct);
      if(label) label.textContent = pct + '%';

      if(!Gestures._renderScheduled) {
        Gestures._renderScheduled = true;
        requestAnimationFrame(() => {
          Core.markDirty('view');
          window.Draw.render();
          Gestures._renderScheduled = false;
        });
      }
      return;
    }

    if(Gestures.state === GestureState.LASSO) {
      const world = worldAtScreen(e.clientX, e.clientY);
      Core._mouseW = world;
      window.Draw.render();
      return;
    }

    if(Gestures.state === GestureState.SELECTING && Gestures.dragData) {
      const dd = Gestures.dragData;
      const moveRC = rc;

      const movedEnough =
        Math.abs(moveRC.r - dd.anchorRC.r) >= 1 ||
        Math.abs(moveRC.c - dd.anchorRC.c) >= 1;
      if(movedEnough) Gestures.state = GestureState.DRAGGING;
    }

    if(Gestures.state === GestureState.DRAGGING && Gestures.dragData) {
      const Core = getCore();
      const dd = Gestures.dragData;
      const dr = rc.r - dd.anchorRC.r;
      const dc = rc.c - dd.anchorRC.c;

      if(!dd.didUndo) {
        Core.pushUndo(true);
        dd.didUndo = true;
      }

      const ignoreSet = new Set(dd.ids);
      const proposedPositions = [];
      let canMoveAll = true;

      for(const id of dd.ids) {
        const it = Core.items.find(x => x.id === id);
        if(!it || it.locked) {
          canMoveAll = false;
          break;
        }
        
        const orig = dd.originals[id];
        if(!orig) {
          canMoveAll = false;
          break;
        }

        const sizeW = it.sizeW || Core.getSize(it);
        const sizeH = it.sizeH || Core.getSize(it);

        const newRow = Math.max(0, Math.min(Core.GRID - sizeH, orig.row + dr));
        const newCol = Math.max(0, Math.min(Core.GRID - sizeW, orig.col + dc));

        proposedPositions.push({
          id: id,
          row: newRow,
          col: newCol,
          sizeW: sizeW,
          sizeH: sizeH
        });
      }

      if(canMoveAll) {
        for(let i = 0; i < proposedPositions.length; i++) {
          const pos = proposedPositions[i];
          let collision = false;
          
          for(const it of Core.items) {
            if(ignoreSet.has(it.id)) continue;
            
            const itSizeW = it.sizeW || Core.getSize(it);
            const itSizeH = it.sizeH || Core.getSize(it);
            
            const overlapsH = !(pos.col + pos.sizeW <= it.col || pos.col >= it.col + itSizeW);
            const overlapsV = !(pos.row + pos.sizeH <= it.row || pos.row >= it.row + itSizeH);
            
            if(overlapsH && overlapsV) {
              collision = true;
              break;
            }
          }
          
          if(collision) {
            canMoveAll = false;
            break;
          }
        }
      }

      if(canMoveAll) {
        for(const pos of proposedPositions) {
          const it = Core.items.find(x => x.id === pos.id);
          if(it) {
            it.row = pos.row;
            it.col = pos.col;
          }
        }
        
        Core.markDirty('items');
        window.Draw.render();
      }
    }

    if(Gestures.state === GestureState.DRAWING && Core.mode === 'draw') {
      const Core = getCore();
      const last = Core.lastPaintRC;
      if(!last || (last.r === rc.r && last.c === rc.c)) return;
      
      Core.placeX(rc);
      Core.lastPaintRC = rc;
    }
  }

  function handlePointerUp(e) {
    const Core = getCore();
    Gestures.pointers.delete(e.pointerId);

    if(Gestures.state === GestureState.LASSO && Core.lassoStart && Core._mouseW) {
      const x1 = Math.min(Core.lassoStart.x, Core._mouseW.x);
      const y1 = Math.min(Core.lassoStart.y, Core._mouseW.y);
      const x2 = Math.max(Core.lassoStart.x, Core._mouseW.x);
      const y2 = Math.max(Core.lassoStart.y, Core._mouseW.y);

      for(const it of Core.items) {
        const sizeW = it.sizeW || Core.getSize(it);
        const sizeH = it.sizeH || Core.getSize(it);
        const s = Core.cell();
        const itX1 = it.col * s;
        const itY1 = it.row * s;
        const itX2 = (it.col + sizeW) * s;
        const itY2 = (it.row + sizeH) * s;

        if(!(itX2 < x1 || itX1 > x2 || itY2 < y1 || itY1 > y2)) {
          Core.selected.add(it.id);
        }
      }

      Core.lassoStart = null;
      Core.markDirty('selection');
      window.Draw.render();
    }

    if(Gestures.pointers.size === 0) {
      Gestures.state = GestureState.IDLE;
      Gestures.dragData = null;
      Gestures.pinchData = null;
      Gestures.lastMidCSS = null;
      Core.lastPaintRC = null;
    }
  }

  function handleWheel(e) {
    e.preventDefault();
    const Core = getCore();
    
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    const oldZoom = Core.zoom;
    const dynamicMax = Core.getDynamicMaxZoom ? Core.getDynamicMaxZoom() : 8;
    Core.zoom = Math.max(0.4, Math.min(dynamicMax, oldZoom * delta));

    const canvas = getCanvas();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldX = (mouseX - Core.pan.x) / oldZoom;
    const worldY = (mouseY - Core.pan.y) / oldZoom;

    Core.pan.x = mouseX - worldX * Core.zoom;
    Core.pan.y = mouseY - worldY * Core.zoom;

    const pct = Math.round(Core.zoom * 100);
    const slider = document.getElementById('zoom-slider');
    const label = document.getElementById('zoom-label');
    if(slider) slider.value = String(pct);
    if(label) label.textContent = pct + '%';

    Core.markDirty('view');
    window.Draw.render();
  }

  function handleKeyDown(e) {
    const Core = getCore();
    
    // Ctrl/Cmd + Z = Undo
    if((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      Core.undo();
      return;
    }
    
    // Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z = Redo
    if((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      Core.redo();
      return;
    }
    
    // Delete/Backspace = Delete selected
    if((e.key === 'Delete' || e.key === 'Backspace') && Core.mode === 'select') {
      e.preventDefault();
      Core.deleteSelected();
      return;
    }
    
    // Ctrl/Cmd + A = Select all
    if((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      Core.selectAll();
      return;
    }
    
    // Ctrl/Cmd + C = Copy
    if((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      Core.copySelected();
      return;
    }
    
    // Ctrl/Cmd + V = Paste
    if((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      Core.pasteClipboard();
      return;
    }
    
    // F = Fit view
    if(e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      Core.fitView();
      return;
    }
    
    // Escape = Clear selection / Exit measure tool
    if(e.key === 'Escape') {
      if(window.Features && window.Features.Measure && window.Features.Measure.enabled) {
        const measureBtn = document.getElementById('measure-tool');
        if(measureBtn) {
          window.Features.Measure.toggle();
          measureBtn.classList.remove('active');
        }
      } else {
        Core.selected.clear();
        Core.markDirty('selection');
        window.Draw.render();
      }
      return;
    }
  }

  // ============================================================
  // INITIALIZE EVENT LISTENERS
  // ============================================================
  function initGestures() {
    const canvas = getCanvas();
    if(!canvas) {
      console.error('Canvas not found');
      return;
    }

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
    canvas.addEventListener('wheel', handleWheel, {passive: false});
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('keydown', handleKeyDown);
  }

  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGestures);
  } else {
    initGestures();
  }

  window.Gestures = Gestures;
})();
