// ============================================================
// FEATURES MODULE - MapPlanner
// Advanced features: Measure, AutoSave, Export, Theme, Stats
// PATCHED: Fixed measure tool click handler
// ============================================================

(function(){
  const Features = {};
  
  function $(id) { return document.getElementById(id); }
  function getCore() { return window.Core; }

  // ============================================================
  // MEASURE TOOL (WITH VISUAL LINE) - PATCHED
  // ============================================================
  Features.Measure = {
    enabled: false,
    active: false,  // Added to track active state
    firstPoint: null,
    firstWorld: null,
    currentWorld: null,
    mouseMoveHandler: null,
    clickHandler: null,
    previousMode: null, 
    
    toggle() {
      this.enabled = !this.enabled;
      this.active = this.enabled;  // Sync active state
      this.firstPoint = null;
      this.firstWorld = null;
      this.currentWorld = null;
      
      const Core = window.Core;
      
      if(this.enabled) {
        // Hide any open context menu
        if(window.UI && window.UI.hideContextMenu) {
          window.UI.hideContextMenu();
        }
        
        // Store current mode and switch to View mode
        this.previousMode = Core.mode || 'draw';
        if(window.setMode) {
          window.setMode('view');
        }
        
        window.UI.Toast.info('Measure tool enabled - Click two points. Right-click to exit.');
        document.getElementById('board').style.cursor = 'crosshair';
        this.setupListeners();
      } else {
        // Restore previous mode
        if(window.setMode && this.previousMode) {
          window.setMode(this.previousMode);
        }
        
        window.UI.Toast.info('Measure tool disabled');
        document.getElementById('board').style.cursor = 'default';
        this.removeListeners();
        window.Draw.render();
      }
    },
    
    setupListeners() {
      const canvas = document.getElementById('board');
      
      // Mouse move handler - shows the line as you move
      this.mouseMoveHandler = (e) => {
        if(!this.enabled || !this.firstPoint) return;
        
        const Core = getCore();
        const world = Core.screenToWorld(e.clientX, e.clientY);
        this.currentWorld = world;
        
        // Mark dirty and trigger immediate render to show the line
        Core.markDirty('view');
        if(window.Draw && window.Draw.renderImmediate) {
          window.Draw.renderImmediate();
        }
      };
      
      // Click handler - sets points (PATCHED)
      this.clickHandler = (e) => {
        if(!this.enabled) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        const Core = getCore();
        const rc = Core.evtRC(e);
        const world = Core.screenToWorld(e.clientX, e.clientY);
        
        if(!this.firstPoint) {
          // First click - set starting point
          this.firstPoint = rc;
          this.firstWorld = world;
          this.currentWorld = world;
          window.UI.Toast.info(`First point: Row ${rc.r}, Col ${rc.c}`);
        } else {
          // Second click - calculate and show distance
          const dr = Math.abs(rc.r - this.firstPoint.r);
          const dc = Math.abs(rc.c - this.firstPoint.c);
          const dist = Math.sqrt(dr * dr + dc * dc).toFixed(2);
          
          window.UI.Toast.success(`Distance: ${dist} tiles (${dr} rows, ${dc} cols)`, 'success', 5000);
          
          // Reset for next measurement
          this.firstPoint = null;
          this.firstWorld = null;
          this.currentWorld = null;
          window.Draw.render();
        }
      };
      
      canvas.addEventListener('mousemove', this.mouseMoveHandler);
      canvas.addEventListener('click', this.clickHandler);
    },
    
    removeListeners() {
      const canvas = document.getElementById('board');
      
      if(this.mouseMoveHandler) {
        canvas.removeEventListener('mousemove', this.mouseMoveHandler);
        this.mouseMoveHandler = null;
      }
      
      if(this.clickHandler) {
        canvas.removeEventListener('click', this.clickHandler);
        this.clickHandler = null;
      }
    },
    
    // PATCHED: Added handleClick method for compatibility
    handleClick(rc, clientX, clientY) {
      if(!this.enabled) return false;
      
      const Core = getCore();
      const world = Core.screenToWorld(clientX, clientY);
      
      if(!this.firstPoint) {
        // First click - set starting point
        this.firstPoint = rc;
        this.firstWorld = world;
        this.currentWorld = world;
        if(window.UI && window.UI.Toast) {
          window.UI.Toast.info(`First point: Row ${rc.r}, Col ${rc.c}`);
        }
        return true;
      } else {
        // Second click - calculate and show distance
        const dr = Math.abs(rc.r - this.firstPoint.r);
        const dc = Math.abs(rc.c - this.firstPoint.c);
        const dist = Math.sqrt(dr * dr + dc * dc).toFixed(2);
        
        if(window.UI && window.UI.Toast) {
          window.UI.Toast.success(`Distance: ${dist} tiles (${dr} rows, ${dc} cols)`, 'success', 5000);
        }
        
        // Reset for next measurement
        this.firstPoint = null;
        this.firstWorld = null;
        this.currentWorld = null;
        window.Draw.render();
        return true;
      }
    },
    
    // Draw the measurement line
    draw(ctx) {
      if(!this.enabled || !this.firstWorld || !this.currentWorld) return;
      
      const Core = getCore();
      
      ctx.save();
      
      // Draw line
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2 / Core.zoom;
      ctx.setLineDash([8 / Core.zoom, 4 / Core.zoom]);
      
      ctx.beginPath();
      ctx.moveTo(this.firstWorld.x, this.firstWorld.y);
      ctx.lineTo(this.currentWorld.x, this.currentWorld.y);
      ctx.stroke();
      
      // Draw start point
      ctx.fillStyle = '#00ff00';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(this.firstWorld.x, this.firstWorld.y, 4 / Core.zoom, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw end point (current mouse position)
      ctx.beginPath();
      ctx.arc(this.currentWorld.x, this.currentWorld.y, 4 / Core.zoom, 0, Math.PI * 2);
      ctx.fill();
      
      // Calculate and display distance on the line
      const rc1 = Core.worldToRC(this.firstWorld.x, this.firstWorld.y);
      const rc2 = Core.worldToRC(this.currentWorld.x, this.currentWorld.y);
      const dr = Math.abs(rc2.r - rc1.r);
      const dc = Math.abs(rc2.c - rc1.c);
      const dist = Math.sqrt(dr * dr + dc * dc).toFixed(2);
      
      // Draw text label in the middle of the line
      const midX = (this.firstWorld.x + this.currentWorld.x) / 2;
      const midY = (this.firstWorld.y + this.currentWorld.y) / 2;
      
      ctx.font = `${14 / Core.zoom}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      
      // Text background
      const text = `${dist} tiles`;
      const metrics = ctx.measureText(text);
      const padding = 4 / Core.zoom;
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(
        midX - metrics.width / 2 - padding,
        midY - 14 / Core.zoom - padding,
        metrics.width + padding * 2,
        14 / Core.zoom + padding * 2
      );
      
      // Text
      ctx.fillStyle = '#00ff00';
      ctx.fillText(text, midX, midY);
      
      ctx.restore();
    }
  };

  // ============================================================
  // AUTO-SAVE SYSTEM
  // ============================================================
  Features.AutoSave = {
    enabled: false,
    interval: null,
    lastSave: null,
    
    enable() {
      this.enabled = true;
      this.interval = setInterval(() => this.save(), 30000);
      window.UI.Toast.success('Auto-save enabled (every 30s)');
    },
    
    disable() {
      this.enabled = false;
      if(this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      window.UI.Toast.info('Auto-save disabled');
    },
    
    save() {
      const Core = getCore();
      const data = {
        items: Core.items,
        idSeq: Core.idSeq,
        legendLabels: Core.legendLabels,
        gridSize: Core.GRID,
        timestamp: Date.now()
      };
      
      try {
        localStorage.setItem('mapplanner_autosave', JSON.stringify(data));
        this.lastSave = new Date();
        console.log('Auto-saved at', this.lastSave.toLocaleTimeString());
      } catch(e) {
        console.error('Auto-save failed:', e);
        window.UI.Toast.error('Auto-save failed - storage full?');
      }
    },
    
    load() {
      try {
        const saved = localStorage.getItem('mapplanner_autosave');
        if(!saved) {
          window.UI.Toast.warning('No auto-save found');
          return false;
        }
        
        const data = JSON.parse(saved);
        const Core = getCore();
        
        if(Number.isFinite(data.gridSize)) {
          Core.setGridSize(data.gridSize, {scale: false});
        }
        
        Core.items = data.items || [];
        Core.idSeq = data.idSeq || 1;
        Core.legendLabels = data.legendLabels || {};
        
        Core.markDirty('items');
        Core.markDirty('legend');
        window.Draw.render();
        window.UI.updateLegend();
        Core.fitView();
        
        const time = new Date(data.timestamp).toLocaleString();
        window.UI.Toast.success(`Loaded auto-save from ${time}`);
        return true;
      } catch(err) {
        console.error('Failed to load auto-save:', err);
        window.UI.Toast.error('Failed to load auto-save');
        return false;
      }
    }
  };

  // ============================================================
  // EXPORT CSV
  // ============================================================
  Features.exportCSV = function() {
    const Core = getCore();
    
    const headers = ['ID', 'Type', 'Row', 'Col', 'Size', 'Label', 'Color', 'Order'];
    const rows = [headers];
    
    for(const item of Core.items) {
      const row = [
        item.id,
        item.type,
        item.row,
        item.col,
        Core.getSize(item),
        item.label || '',
        item.color || '',
        item.order || ''
      ];
      rows.push(row);
    }
    
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type: 'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `map-data-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    
    window.UI.Toast.success('CSV exported');
  };

  // ============================================================
  // THEME TOGGLE
  // ============================================================
  Features.Theme = {
    current: 'dark',
    
    toggle() {
      this.current = this.current === 'dark' ? 'light' : 'dark';
      
      if(this.current === 'light') {
        document.body.classList.add('light-theme');
        window.UI.Toast.info('Light theme enabled');
      } else {
        document.body.classList.remove('light-theme');
        window.UI.Toast.info('Dark theme enabled');
      }
      
      try {
        localStorage.setItem('mapplanner_theme', this.current);
      } catch(e) {
        console.warn('Could not save theme preference');
      }
    },
    
    init() {
      try {
        const saved = localStorage.getItem('mapplanner_theme');
        if(saved === 'light') {
          this.current = 'light';
          document.body.classList.add('light-theme');
        }
      } catch(e) {
        console.warn('Could not load theme preference');
      }
    }
  };

  // ============================================================
  // STATS DISPLAY
  // ============================================================
  Features.Stats = {
    update() {
      const Core = getCore();
      if(!Core) return;
      
      const statsDisplay = $('stats-display');
      if(!statsDisplay || statsDisplay.style.display === 'none') return;
      
      const xCount = Core.items.filter(i => i.type === 'X').length;
      const yCount = Core.items.filter(i => i.type === 'Y').length;
      const pCount = Core.items.filter(i => i.type === 'P').length;
      const total = Core.items.length;
      const selected = Core.selected.size;
      
      statsDisplay.innerHTML = `
        <div>FPS: <span id="fps-counter">${Features.FPS.current}</span></div>
        <div>Total: ${total}</div>
        <div>X: ${xCount} | Y: ${yCount} | P: ${pCount}</div>
        <div>Selected: ${selected}</div>
        <div>Zoom: ${Math.round(Core.zoom * 100)}%</div>
      `;
    }
  };

  // ============================================================
  // FPS COUNTER
  // ============================================================
  Features.FPS = {
    current: 60,
    frames: [],
    lastTime: performance.now(),
    
    tick() {
      const now = performance.now();
      const delta = now - this.lastTime;
      this.lastTime = now;
      
      this.frames.push(delta);
      if(this.frames.length > 60) this.frames.shift();
      
      const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
      this.current = Math.round(1000 / avg);
      
      const fpsEl = $('fps-counter');
      if(fpsEl) fpsEl.textContent = this.current;
    }
  };

  // ============================================================
  // PAN MODE (for 2-finger gestures)
  // ============================================================
  Features.PanMode = {
    enabled: true
  };

  // ============================================================
  // EXPORT FEATURES
  // ============================================================
  window.Features = Features;
  
  // Initialize theme on load
  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Features.Theme.init());
  } else {
    Features.Theme.init();
  }
})();
