// ============================================================
// CORE ENGINE - MapPlanner
// FIXED VERSION - All 7 issues resolved:
// 1. Canvas stretched vertically - FIXED
// 2. Right-click menu - FIXED
// 3. Pan in draw/select modes - FIXED
// 4. Align functions - FIXED
// 5. Stats showing - FIXED
// 6. Color applying to X - FIXED
// 7. Element dropdown positioning - FIXED
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
  Core._currentColor = null;

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
  Core.canvasW = 600;  // FIXED: Track actual canvas width
  Core.canvasH = 600;  // FIXED: Track actual canvas height
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
    
    hash(r, c) {
      const hr = Math.floor(r / this.cellSize);
      const hc = Math.floor(c / this.cellSize);
      return `${hr},${hc}`;
    },
    
    add(item) {
      const sizeW = item.sizeW || Core.getSize(item);
      const sizeH = item.sizeH || Core.getSize(item);
      
      for(let r = item.row; r < item.row + sizeH; r++) {
        for(let c = item.col; c < item.col + sizeW; c++) {
          const key = this.hash(r, c);
          if(!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(item.id);
        }
      }
    },
    
    remove(item) {
      const sizeW = item.sizeW || Core.getSize(item);
      const sizeH = item.sizeH || Core.getSize(item);
      
      for(let r = item.row; r < item.row + sizeH; r++) {
        for(let c = item.col; c < item.col + sizeW; c++) {
          const key = this.hash(r, c);
          const arr = this.grid.get(key);
          if(arr) {
            const idx = arr.indexOf(item.id);
            if(idx >= 0) arr.splice(idx, 1);
            if(arr.length === 0) this.grid.delete(key);
          }
        }
      }
    },
    
    query(r, c, w = 1, h = 1) {
      const items = new Set();
      for(let row = r; row < r + h; row++) {
        for(let col = c; col < c + w; col++) {
          const key = this.hash(row, col);
          const arr = this.grid.get(key);
          if(arr) arr.forEach(id => items.add(id));
        }
      }
      return items;
    },
    
    clear() {
      this.grid.clear();
    },
    
    rebuild() {
      this.clear();
      for(const item of Core.items) {
        this.add(item);
      }
    }
  };

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================
  Core.markDirty = function(flag) {
    if(flag === 'all') {
      Object.keys(Core._dirtyFlags).forEach(k => Core._dirtyFlags[k] = true);
    } else if(Core._dirtyFlags.hasOwnProperty(flag)) {
      Core._dirtyFlags[flag] = true;
    }
  };

  Core.cell = function() {
    return Core.basePx / Core.GRID;
  };

  Core.getSize = function(item) {
    return Core.SIZE[item.type] || item.sizeW || 3;
  };

  Core.snapshot = function() {
    return Core.history.createSnapshot();
  };

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
  // ITEM PLACEMENT - FIXED: Auto-increment order numbers
  // ============================================================
  Core._nextOrder = 1;

  Core.placeX = function(rc) {
    // FIXED: Apply current color to X items
    const item = Core.place('X', rc.r, rc.c, {
      order: Core._nextOrder++,
      color: Core._currentColor || Core.FILL.X
    });
    return item;
  };

  Core.placeY = function(rc) {
    const item = Core.place('Y', rc.r, rc.c, {
      order: Core._nextOrder++
    });
    return item;
  };

  Core.place = function(type, row, col, opts = {}) {
    const sizeW = opts.sizeW || opts.size || Core.SIZE[type] || 3;
    const sizeH = opts.sizeH || opts.size || Core.SIZE[type] || 3;
    
    // Check if placement is within grid bounds
    if(row < 0 || col < 0 || row + sizeH > Core.GRID || col + sizeW > Core.GRID) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('Cannot place outside grid bounds');
      }
      return null;
    }
    
    if(Core.collides(row, col, sizeW, sizeH)) {
      const alt = Core.findFreeSpot(row, col, sizeW, sizeH);
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
      sizeW: sizeW,
      sizeH: sizeH,
      locked: opts.locked || false,
      ...opts
    };
    
    Core.items.push(item);
    Core.spatialIndex.add(item);
    Core.markDirty('items');
    Core.markDirty('legend');
    
    if(window.Draw) window.Draw.render();
    if(window.UI && window.UI.updateLegend) window.UI.updateLegend();
    
    return item;
  };

  // ============================================================
  // COLLISION DETECTION
  // ============================================================
  Core.collides = function(row, col, sizeW, sizeH, excludeId = null) {
    const nearby = Core.spatialIndex.query(row, col, sizeW, sizeH);
    
    for(const id of nearby) {
      if(id === excludeId) continue;
      
      const item = Core.items.find(it => it.id === id);
      if(!item) continue;
      
      const itemW = item.sizeW || Core.getSize(item);
      const itemH = item.sizeH || Core.getSize(item);
      
      if(!(row + sizeH <= item.row ||
           row >= item.row + itemH ||
           col + sizeW <= item.col ||
           col >= item.col + itemW)) {
        return true;
      }
    }
    
    return false;
  };

  Core.findFreeSpot = function(startRow, startCol, sizeW, sizeH, maxDist = 10) {
    for(let dist = 1; dist <= maxDist; dist++) {
      for(let dr = -dist; dr <= dist; dr++) {
        for(let dc = -dist; dc <= dist; dc++) {
          if(Math.abs(dr) < dist && Math.abs(dc) < dist) continue;
          
          const nr = startRow + dr;
          const nc = startCol + dc;
          
          if(nr < 0 || nc < 0 || nr + sizeH > Core.GRID || nc + sizeW > Core.GRID) {
            continue;
          }
          
          if(!Core.collides(nr, nc, sizeW, sizeH)) {
            return {r: nr, c: nc};
          }
        }
      }
    }
    
    return null;
  };

  // ============================================================
  // ITEM MANIPULATION
  // ============================================================
  Core.deleteSelected = function() {
    if(Core.selected.size === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('No items selected');
      }
      return;
    }
    
    Core.pushUndo();
    
    Core.items = Core.items.filter(it => !Core.selected.has(it.id));
    Core.spatialIndex.rebuild();
    Core.selected.clear();
    
    Core.markDirty('items');
    Core.markDirty('selection');
    Core.markDirty('legend');
    
    if(window.Draw) window.Draw.render();
    if(window.UI && window.UI.updateLegend) window.UI.updateLegend();
  };

  Core.copySelected = function() {
    if(Core.selected.size === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('No items selected');
      }
      return;
    }
    
    Core.clipboard = Core.items
      .filter(it => Core.selected.has(it.id))
      .map(it => ({...it}));
    
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.success(`Copied ${Core.clipboard.length} item(s)`);
    }
  };

  Core.pasteSelected = function() {
    if(Core.clipboard.length === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('Nothing to paste');
      }
      return;
    }
    
    Core.pushUndo();
    
    let minRow = Infinity;
    let minCol = Infinity;
    for(const it of Core.clipboard) {
      minRow = Math.min(minRow, it.row);
      minCol = Math.min(minCol, it.col);
    }
    
    const offsetR = 5;
    const offsetC = 5;
    
    Core.selected.clear();
    
    for(const orig of Core.clipboard) {
      const newRow = orig.row - minRow + offsetR;
      const newCol = orig.col - minCol + offsetC;
      const sizeW = orig.sizeW || Core.getSize(orig);
      const sizeH = orig.sizeH || Core.getSize(orig);
      
      if(newRow < 0 || newCol < 0 || 
         newRow + sizeH > Core.GRID || newCol + sizeW > Core.GRID) {
        continue;
      }
      
      const item = {
        ...orig,
        id: Core.idSeq++,
        row: newRow,
        col: newCol
      };
      
      if(!Core.collides(item.row, item.col, sizeW, sizeH)) {
        Core.items.push(item);
        Core.spatialIndex.add(item);
        Core.selected.add(item.id);
      }
    }
    
    Core.markDirty('items');
    Core.markDirty('selection');
    Core.markDirty('legend');
    
    if(window.Draw) window.Draw.render();
    if(window.UI && window.UI.updateLegend) window.UI.updateLegend();
  };

  Core.selectAll = function() {
    Core.selected.clear();
    for(const it of Core.items) {
      Core.selected.add(it.id);
    }
    Core.markDirty('selection');
    if(window.Draw) window.Draw.render();
  };

  Core.deselectAll = function() {
    Core.selected.clear();
    Core.markDirty('selection');
    if(window.Draw) window.Draw.render();
  };

  Core.clearAll = function() {
    if(!confirm('Clear all items? This cannot be undone after saving.')) {
      return;
    }
    
    Core.pushUndo();
    Core.items = [];
    Core.selected.clear();
    Core.spatialIndex.clear();
    Core._nextOrder = 1;
    
    Core.markDirty('items');
    Core.markDirty('selection');
    Core.markDirty('legend');
    
    if(window.Draw) window.Draw.render();
    if(window.UI && window.UI.updateLegend) window.UI.updateLegend();
  };

  // ============================================================
  // CANVAS RESIZE - FIXED: Use full available width
  // ============================================================
  Core.resizeCanvas = function() {
    if(!Core.canvas) return;
    
    Core.dpr = window.devicePixelRatio || 1;
    
    // FIXED: Calculate available space properly
    const topbar = document.querySelector('.topbar');
    const footer = document.querySelector('footer');
    const topH = topbar ? topbar.getBoundingClientRect().height : 0;
    const footH = footer ? footer.getBoundingClientRect().height : 0;
    
    // Account for padding and margins
    const pad = 32;
    const availW = window.innerWidth - 2 * pad;
    const availH = window.innerHeight - topH - footH - 2 * pad - 80;
    
    // FIXED: Use minimum of available dimensions to keep square
    const size = Math.min(availW, availH);
    Core.basePx = Math.max(320, Math.floor(size));
    
    // FIXED: Store actual canvas dimensions
    Core.canvasW = Core.basePx;
    Core.canvasH = Core.basePx;
    
    Core.canvas.width = Core.basePx * Core.dpr;
    Core.canvas.height = Core.basePx * Core.dpr;
    Core.canvas.style.width = Core.basePx + 'px';
    Core.canvas.style.height = Core.basePx + 'px';
    
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
      action: current
    });
    
    Core.restore(entry.action);
    
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.info('Undone');
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
      action: current
    });
    
    Core.restore(entry.action);
    
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.info('Redone');
    }
  };

  Core.pushUndo = function(withSpatialRebuild = false) {
    const snapshot = Core.history.createSnapshot();
    Core.history.push(snapshot);
    
    if(withSpatialRebuild) {
      Core.spatialIndex.rebuild();
    }
  };

  // ============================================================
  // ALIGNMENT FUNCTIONS - FIXED
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
    
    if(items.length === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('All selected items are locked');
      }
      return;
    }
    
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
      
      // FIXED: Remove from spatial index before moving
      Core.spatialIndex.remove(it);
      
      it.row = currentRow;
      it.col = currentCol;
      
      // FIXED: Re-add to spatial index after moving
      Core.spatialIndex.add(it);
      
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
    
    if(items.length === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('All selected items are locked');
      }
      return;
    }
    
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
      
      // FIXED: Remove from spatial index before moving
      Core.spatialIndex.remove(it);
      
      it.row = currentRow;
      it.col = currentCol;
      
      // FIXED: Re-add to spatial index after moving
      Core.spatialIndex.add(it);
      
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
  // TOGGLE LOCK/UNLOCK
  // ============================================================
  Core.toggleLock = function() {
    if(Core.selected.size === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('No items selected');
      }
      return;
    }
    
    Core.pushUndo();
    
    const items = Core.items.filter(it => Core.selected.has(it.id));
    const allLocked = items.every(it => it.locked);
    
    for(const it of items) {
      it.locked = !allLocked;
    }
    
    Core.markDirty('items');
    if(window.Draw) window.Draw.render();
    
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.success(allLocked ? 'Items unlocked' : 'Items locked');
    }
  };

  // ============================================================
  // LIGHT BASE (Toggle Y color between yellow and cyan)
  // ============================================================
  Core.lightBase = function() {
    if(Core.selected.size === 0) {
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.warning('No items selected');
      }
      return;
    }
    
    Core.pushUndo();
    
    for(const it of Core.items) {
      if(Core.selected.has(it.id) && it.type === 'Y') {
        it.color = it.color === '#00e5ff' ? 
          'rgba(255,216,74,0.5)' : '#00e5ff';
      }
    }
    
    Core.markDirty('items');
    if(window.Draw) window.Draw.render();
  };

  // ============================================================
  // FIT VIEW - FIXED: Use actual canvas dimensions
  // ============================================================
  Core.fitView = function() {
    if(Core.items.length === 0) {
      Core.zoom = 1;
      Core.pan = {
        x: Core.canvasW / 2 - (Core.basePx / 2),
        y: Core.canvasH / 2 - (Core.basePx / 2)
      };
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
    
    const pad = 40;
    const zoomW = (Core.canvasW - pad) / contentW;
    const zoomH = (Core.canvasH - pad) / contentH;
    Core.zoom = Math.min(zoomW, zoomH, Core.getDynamicMaxZoom());
    
    const worldCenterX = ((minC + maxC) * s) / 2;
    const worldCenterY = ((minR + maxR) * s) / 2;
    
    Core.pan.x = Core.canvasW / 2 - worldCenterX * Core.zoom;
    Core.pan.y = Core.canvasH / 2 - worldCenterY * Core.zoom;
    
    Core.markDirty('view');
    if(window.Draw) window.Draw.render();
  };

  // ============================================================
  // GRID SIZE SETTER
  // ============================================================
  Core.setGridSize = function(newSize, opts = {}) {
    const oldSize = Core.GRID;
    Core.GRID = Math.max(20, Math.min(2000, newSize));
    
    if(opts.scale !== false && Core.items.length > 0) {
      const ratio = Core.GRID / oldSize;
      for(const it of Core.items) {
        it.row = Math.floor(it.row * ratio);
        it.col = Math.floor(it.col * ratio);
        
        if(it.sizeW) it.sizeW = Math.max(1, Math.floor(it.sizeW * ratio));
        if(it.sizeH) it.sizeH = Math.max(1, Math.floor(it.sizeH * ratio));
      }
      
      Core.spatialIndex.rebuild();
    }
    
    Core.markDirty('view');
    Core.markDirty('items');
    if(window.Draw) window.Draw.render();
    
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.success(`Grid size set to ${Core.GRID}`);
    }
  };

  // ============================================================
  // EXPORT FUNCTIONS
  // ============================================================
  Core.exportJSON = function() {
    const data = {
      version: '1.0',
      timestamp: Date.now(),
      gridSize: Core.GRID,
      items: Core.items,
      legendLabels: Core.legendLabels
    };
    
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `map-data-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    
    if(window.UI && window.UI.Toast) {
      window.UI.Toast.success('JSON exported');
    }
  };

  Core.importJSON = function(file) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        
        if(Number.isFinite(data.gridSize)) {
          Core.setGridSize(data.gridSize, {scale: false});
        }
        
        Core.items = data.items || [];
        Core.legendLabels = data.legendLabels || {};
        Core.idSeq = Math.max(...Core.items.map(it => it.id), 0) + 1;
        
        Core.spatialIndex.rebuild();
        Core.selected.clear();
        
        Core.markDirty('items');
        Core.markDirty('legend');
        
        if(window.Draw) window.Draw.render();
        if(window.UI && window.UI.updateLegend) window.UI.updateLegend();
        Core.fitView();
        
        if(window.UI && window.UI.Toast) {
          window.UI.Toast.success(`Loaded ${Core.items.length} items`);
        }
      } catch(err) {
        console.error('Import failed:', err);
        if(window.UI && window.UI.Toast) {
          window.UI.Toast.error('Failed to load JSON');
        }
      }
    };
    
    reader.readAsText(file);
  };

  Core.exportPNG = function() {
    const tempZoom = Core.zoom;
    const tempPan = {...Core.pan};
    
    Core.fitView();
    
    setTimeout(() => {
      const link = document.createElement('a');
      link.download = `map-${Date.now()}.png`;
      link.href = Core.canvas.toDataURL();
      link.click();
      
      Core.zoom = tempZoom;
      Core.pan = tempPan;
      Core.markDirty('view');
      if(window.Draw) window.Draw.render();
      
      if(window.UI && window.UI.Toast) {
        window.UI.Toast.success('PNG exported');
      }
    }, 100);
  };

  // ============================================================
  // EXPOSE CORE
  // ============================================================
  window.Core = Core;
})();


// ============================================================
// DRAW MODULE
// ============================================================
(function(){
  const Draw = {};
  
  function getCore() { 
    return window.Core; 
  }

  let _rafId = null;

  Draw.render = function() {
    if(_rafId) return;
    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      Draw.renderImmediate();
    });
  };

  Draw.renderImmediate = function() {
    const Core = getCore();
    if(!Core || !Core.ctx) return;

    const ctx = Core.ctx;
    const canvas = Core.canvas;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // Draw grid
    const s = Core.cell();
    const gridWorld = Core.basePx;

    ctx.strokeStyle = Core.BORDER;
    ctx.lineWidth = 1;

    for(let r = 0; r <= Core.GRID; r++) {
      const wy = r * s;
      const {x: sx1, y: sy1} = Core.worldToScreen(0, wy);
      const {x: sx2, y: sy2} = Core.worldToScreen(gridWorld, wy);
      
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.stroke();
    }

    for(let c = 0; c <= Core.GRID; c++) {
      const wx = c * s;
      const {x: sx1, y: sy1} = Core.worldToScreen(wx, 0);
      const {x: sx2, y: sy2} = Core.worldToScreen(wx, gridWorld);
      
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.stroke();
    }

    // Draw work area boundary
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    const {x: bx1, y: by1} = Core.worldToScreen(0, 0);
    const {x: bx2, y: by2} = Core.worldToScreen(gridWorld, gridWorld);
    ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);

    // Draw items
    for(const it of Core.items) {
      const sizeW = it.sizeW || Core.getSize(it);
      const sizeH = it.sizeH || Core.getSize(it);
      const wx = it.col * s;
      const wy = it.row * s;
      const ww = sizeW * s;
      const wh = sizeH * s;

      const {x: sx, y: sy} = Core.worldToScreen(wx, wy);
      const sw = ww * Core.zoom;
      const sh = wh * Core.zoom;

      // Draw image if available
      if(it.image && window.ElementImages && window.ElementImages[it.image]) {
        const img = window.ElementImages[it.image];
        if(img.complete) {
          ctx.globalAlpha = (it.fillAlpha !== undefined ? it.fillAlpha : 100) / 100;
          ctx.drawImage(img, sx, sy, sw, sh);
          ctx.globalAlpha = 1;
        }
      } else {
        // Draw filled rect
        ctx.fillStyle = it.color || Core.FILL[it.type] || '#ff66ff';
        ctx.fillRect(sx, sy, sw, sh);
      }

      // Draw border
      ctx.strokeStyle = it.borderColor || '#000000';
      ctx.lineWidth = (it.borderWidth || 1) * Core.zoom;
      ctx.globalAlpha = (it.borderAlpha !== undefined ? it.borderAlpha : 100) / 100;
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.globalAlpha = 1;

      // Draw area circle if defined
      if(it.area > 0) {
        const centerX = sx + sw / 2;
        const centerY = sy + sh / 2;
        const radius = (it.area * s * Core.zoom) / 2;

        ctx.strokeStyle = it.areaBorderColor || it.areaColor || '#ff66ff';
        ctx.lineWidth = (it.areaBorderWidth || 2) * Core.zoom;
        ctx.globalAlpha = (it.areaBorderAlpha !== undefined ? it.areaBorderAlpha : 100) / 100;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = it.areaColor || '#ff66ff';
        ctx.globalAlpha = (it.areaAlpha !== undefined ? it.areaAlpha : 30) / 100;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Draw glow effect
      if(it.glow) {
        ctx.shadowColor = it.color || '#ff66ff';
        ctx.shadowBlur = 20 * Core.zoom;
        ctx.strokeStyle = it.color || '#ff66ff';
        ctx.lineWidth = 2 * Core.zoom;
        ctx.strokeRect(sx, sy, sw, sh);
        ctx.shadowBlur = 0;
      }

      // Draw label
      if(it.label) {
        const fontSize = Math.max(10, 12 * Core.zoom);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(it.label, sx + sw / 2, sy + sh / 2);
      }

      // Draw order number for X/Y
      if((it.type === 'X' || it.type === 'Y') && it.order) {
        const fontSize = Math.max(8, 10 * Core.zoom);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(it.order, sx + 2, sy + 2);
      }

      // Highlight selection
      if(Core.selected.has(it.id)) {
        ctx.strokeStyle = Core.BORDER_SEL;
        ctx.lineWidth = 3 * Core.zoom;
        ctx.strokeRect(sx, sy, sw, sh);
      }

      // Show lock icon
      if(it.locked) {
        const lockSize = Math.max(12, 16 * Core.zoom);
        ctx.font = `${lockSize}px sans-serif`;
        ctx.fillStyle = '#ff0000';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('🔒', sx + sw - 2, sy + 2);
      }
    }

    // Draw lasso selection
    if(Core.lassoStart && Core._mouseW) {
      const {x: sx1, y: sy1} = Core.worldToScreen(Core.lassoStart.x, Core.lassoStart.y);
      const {x: sx2, y: sy2} = Core.worldToScreen(Core._mouseW.x, Core._mouseW.y);
      
      ctx.strokeStyle = '#00e5ff';
      ctx.fillStyle = 'rgba(0, 229, 255, 0.1)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      
      const w = sx2 - sx1;
      const h = sy2 - sy1;
      
      ctx.fillRect(sx1, sy1, w, h);
      ctx.strokeRect(sx1, sy1, w, h);
      ctx.setLineDash([]);
    }

    // Draw measure tool line
    if(window.Features && window.Features.Measure && window.Features.Measure.enabled) {
      window.Features.Measure.draw(ctx);
    }

    ctx.restore();
    
    // FIXED: Update stats if visible
    if(window.Features && window.Features.Stats) {
      window.Features.Stats.update();
    }
  };

  window.Draw = Draw;
})();


// ============================================================
// GESTURES MODULE - FIXED: Pan working in all modes
// ============================================================
(function(){
  const Gestures = {
    pointers: new Map(),
    state: 'idle',
    lastMidCSS: null,
    pinchData: null,
    dragData: null
  };

  const GestureState = {
    IDLE: 'idle',
    DRAWING: 'drawing',
    SELECTING: 'selecting',
    DRAGGING: 'dragging',
    LASSO: 'lasso',
    PANNING: 'panning',
    PINCHING: 'pinching'
  };

  let lastTapTime = 0;
  let lastTapId = null;

  function getCore() { 
    return window.Core; 
  }
  
  function getCanvas() { 
    return document.getElementById('board'); 
  }

  function worldAtScreen(sx, sy) {
    const Core = getCore();
    return Core.screenToWorld(sx, sy);
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

  function hitItemAtRC(rc) {
    const Core = getCore();
    const nearby = Core.spatialIndex.query(rc.r, rc.c, 1, 1);
    
    for(const id of nearby) {
      const item = Core.items.find(it => it.id === id);
      if(!item) continue;
      
      const sizeW = item.sizeW || Core.getSize(item);
      const sizeH = item.sizeH || Core.getSize(item);
      
      if(rc.r >= item.row && rc.r < item.row + sizeH &&
         rc.c >= item.col && rc.c < item.col + sizeW) {
        return item;
      }
    }
    
    return null;
  }

  // FIXED: Right-click handler that works properly
  function handlePointerDown(e) {
    const Core = getCore();
    
    // Right-click - context menu
    if(e.button === 2) {
      e.preventDefault();
      
      // FIXED: Show context menu in draw mode too
      if(Core.mode === 'draw') {
        if(window.UI && window.UI.showDrawContextMenu) {
          window.UI.showDrawContextMenu(e.clientX, e.clientY);
        }
        return;
      }
      
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
        } else {
          // Show general context menu on empty space
          if(window.UI && window.UI.showSelectContextMenu) {
            window.UI.showSelectContextMenu(e.clientX, e.clientY);
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

      // Check if measure tool is active
      if(window.Features && window.Features.Measure && window.Features.Measure.enabled) {
        return;
      }

      // FIXED: View mode panning
      if(Core.mode === 'view') {
        Gestures.lastMidCSS = {x: e.clientX, y: e.clientY};
        Gestures.state = GestureState.PANNING;
        document.getElementById('board').style.cursor = 'grabbing';
        return;
      }
      
      // FIXED: Allow panning with middle mouse button in any mode
      if(e.button === 1) {
        Gestures.lastMidCSS = {x: e.clientX, y: e.clientY};
        Gestures.state = GestureState.PANNING;
        document.getElementById('board').style.cursor = 'grabbing';
        return;
      }
      
      if(Core.mode === 'draw') {
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

        // Place single item on click
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
    const world = worldAtScreen(e.clientX, e.clientY);
    Core._mouseW = world;

    if(Gestures.state === GestureState.PANNING) {
      const curr = {x: e.clientX, y: e.clientY};
      const dx = curr.x - Gestures.lastMidCSS.x;
      const dy = curr.y - Gestures.lastMidCSS.y;
      
      Core.pan.x += dx;
      Core.pan.y += dy;
      
      Gestures.lastMidCSS = curr;
      Core.markDirty('view');
      window.Draw.render();
    }
    else if(Gestures.state === GestureState.DRAWING) {
      const rc = Core.evtRC(e);
      
      if(!Core.lastPaintRC || rc.r !== Core.lastPaintRC.r || rc.c !== Core.lastPaintRC.c) {
        Core.placeX(rc);
        Core.lastPaintRC = rc;
      }
    }
    else if(Gestures.state === GestureState.SELECTING || Gestures.state === GestureState.DRAGGING) {
      if(!Gestures.dragData) return;
      
      const rc = Core.evtRC(e);
      const dr = rc.r - Gestures.dragData.anchorRC.r;
      const dc = rc.c - Gestures.dragData.anchorRC.c;
      
      if(dr === 0 && dc === 0) return;
      
      if(!Gestures.dragData.didUndo) {
        Core.pushUndo(true);
        Gestures.dragData.didUndo = true;
      }
      
      Gestures.state = GestureState.DRAGGING;
      
      for(const id of Gestures.dragData.ids) {
        const it = Core.items.find(x => x.id === id);
        if(!it || it.locked) continue;
        
        const orig = Gestures.dragData.originals[id];
        if(!orig) continue;
        
        const newRow = orig.row + dr;
        const newCol = orig.col + dc;
        const sizeW = it.sizeW || Core.getSize(it);
        const sizeH = it.sizeH || Core.getSize(it);
        
        if(newRow < 0 || newCol < 0 || 
           newRow + sizeH > Core.GRID || newCol + sizeW > Core.GRID) {
          continue;
        }
        
        if(!Core.collides(newRow, newCol, sizeW, sizeH, it.id)) {
          Core.spatialIndex.remove(it);
          it.row = newRow;
          it.col = newCol;
          Core.spatialIndex.add(it);
        }
      }
      
      Core.markDirty('items');
      window.Draw.render();
    }
    else if(Gestures.state === GestureState.LASSO) {
      Core.markDirty('view');
      window.Draw.render();
    }
    else if(Gestures.state === GestureState.PINCHING && Gestures.pointers.size === 2) {
      const [a, b] = [...Gestures.pointers.values()];
      const currDist = distance(a, b);
      const zoomDelta = currDist / Gestures.pinchData.startDist;
      
      const newZoom = Math.max(0.2, Math.min(
        Core.getDynamicMaxZoom(),
        Gestures.pinchData.startZoom * zoomDelta
      ));
      
      const wfx = Gestures.pinchData.midWorld.x;
      const wfy = Gestures.pinchData.midWorld.y;
      const oldScreenX = wfx * Core.zoom + Core.pan.x;
      const oldScreenY = wfy * Core.zoom + Core.pan.y;
      
      Core.zoom = newZoom;
      
      const newScreenX = wfx * Core.zoom + Core.pan.x;
      const newScreenY = wfy * Core.zoom + Core.pan.y;
      
      Core.pan.x += (oldScreenX - newScreenX);
      Core.pan.y += (oldScreenY - newScreenY);
      
      Core.markDirty('view');
      window.Draw.render();
    }
  }

  function handlePointerUp(e) {
    const Core = getCore();
    
    if(Gestures.state === GestureState.LASSO && Core.lassoStart) {
      const s = Core.cell();
      const minX = Math.min(Core.lassoStart.x, Core._mouseW.x);
      const maxX = Math.max(Core.lassoStart.x, Core._mouseW.x);
      const minY = Math.min(Core.lassoStart.y, Core._mouseW.y);
      const maxY = Math.max(Core.lassoStart.y, Core._mouseW.y);
      
      Core.selected.clear();
      
      for(const it of Core.items) {
        const sizeW = it.sizeW || Core.getSize(it);
        const sizeH = it.sizeH || Core.getSize(it);
        const itemX = it.col * s;
        const itemY = it.row * s;
        const itemW = sizeW * s;
        const itemH = sizeH * s;
        
        if(itemX + itemW >= minX && itemX <= maxX &&
           itemY + itemH >= minY && itemY <= maxY) {
          Core.selected.add(it.id);
        }
      }
      
      Core.lassoStart = null;
      Core.markDirty('selection');
      window.Draw.render();
    }
    
    if(Gestures.state === GestureState.PANNING) {
      document.getElementById('board').style.cursor = 'default';
    }
    
    Gestures.pointers.delete(e.pointerId);
    
    if(Gestures.pointers.size === 0) {
      Gestures.state = GestureState.IDLE;
      Gestures.dragData = null;
      Core.lastPaintRC = null;
    } else if(Gestures.pointers.size === 1) {
      Gestures.state = GestureState.IDLE;
      Gestures.pinchData = null;
    }
  }

  function handleWheel(e) {
    e.preventDefault();
    
    const Core = getCore();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = Core.zoom;
    const newZoom = Math.max(0.2, Math.min(
      Core.getDynamicMaxZoom(),
      oldZoom * delta
    ));
    
    if(newZoom === oldZoom) return;
    
    const rect = Core.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    const wx = (mx - Core.pan.x) / oldZoom;
    const wy = (my - Core.pan.y) / oldZoom;
    
    Core.zoom = newZoom;
    
    Core.pan.x = mx - wx * newZoom;
    Core.pan.y = my - wy * newZoom;
    
    Core.markDirty('view');
    window.Draw.render();
  }

  function handleKeyDown(e) {
    const Core = getCore();
    
    if(e.ctrlKey || e.metaKey) {
      if(e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if(e.shiftKey) {
          Core.redo();
        } else {
          Core.undo();
        }
        return;
      }
      
      if(e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        Core.redo();
        return;
      }
      
      if(e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        Core.selectAll();
        return;
      }
      
      if(e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        if(e.shiftKey) {
          Core.clearAll();
        } else {
          Core.copySelected();
        }
        return;
      }
      
      if(e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        Core.pasteSelected();
        return;
      }
    }
    
    if(e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      Core.deleteSelected();
      return;
    }
    
    if(e.key === '1') {
      e.preventDefault();
      if(window.setMode) window.setMode('draw');
      return;
    }
    
    if(e.key === '2') {
      e.preventDefault();
      if(window.setMode) window.setMode('select');
      return;
    }
    
    if(e.key === '3') {
      e.preventDefault();
      if(window.setMode) window.setMode('view');
      return;
    }
    
    if(e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      Core.fitView();
      return;
    }
    
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
