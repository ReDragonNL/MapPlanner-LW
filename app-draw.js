// ============================================================
// DRAW MODULE - MapPlanner
// Handles all canvas rendering: grid, items, selection, etc.
// ============================================================

(function(){
  const Draw = {};
  
  function getCore() {
    return window.Core;
  }
  
  // ============================================================
  // MAIN RENDER FUNCTION
  // ============================================================
  Draw.render = function() {
    const Core = getCore();
    if(!Core || !Core.ctx || !Core.canvas) return;
    
    requestAnimationFrame(() => Draw.renderImmediate());
  };
  
  Draw.renderImmediate = function() {
    const Core = getCore();
    if(!Core || !Core.ctx || !Core.canvas) return;
    
    const ctx = Core.ctx;
    const canvas = Core.canvas;
    
    // Clear canvas
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    
    // Apply pan and zoom transform
    ctx.save();
    ctx.translate(Core.pan.x, Core.pan.y);
    ctx.scale(Core.zoom, Core.zoom);
    
    // Draw grid
    Draw.drawGrid(ctx);
    
    // Draw items
    Draw.drawItems(ctx);
    
    // Draw selection highlights
    Draw.drawSelection(ctx);
    
    // Draw lasso if active
    if(Core.lassoStart && Core._mouseW) {
      Draw.drawLasso(ctx);
    }
    
    // Draw measure tool if active
    if(window.Features && window.Features.Measure) {
      window.Features.Measure.draw(ctx);
    }
    
    ctx.restore();
    
    // Update FPS counter if available
    if(window.Features && window.Features.FPS) {
      window.Features.FPS.tick();
    }
    
    // Clear dirty flags
    Core.clearDirtyFlags();
    Core._lastRenderVersion = Core._stateVersion;
  };
  
  // ============================================================
  // DRAW GRID
  // ============================================================
  Draw.drawGrid = function(ctx) {
    const Core = getCore();
    const cell = Core.cell();
    const gridSize = Core.GRID;
    
    ctx.strokeStyle = Core.BORDER;
    ctx.lineWidth = 1 / Core.zoom;
    
    // Vertical lines
    for(let c = 0; c <= gridSize; c++) {
      const x = c * cell;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridSize * cell);
      ctx.stroke();
    }
    
    // Horizontal lines
    for(let r = 0; r <= gridSize; r++) {
      const y = r * cell;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(gridSize * cell, y);
      ctx.stroke();
    }
    
    // Draw border around entire grid
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 / Core.zoom;
    ctx.strokeRect(0, 0, gridSize * cell, gridSize * cell);
  };
  
  // ============================================================
  // DRAW ITEMS
  // ============================================================
  Draw.drawItems = function(ctx) {
    const Core = getCore();
    const cell = Core.cell();
    
    for(const item of Core.items) {
      if(item.type === Core.TYPES.P) {
        Draw.drawPoint(ctx, item, cell);
      } else {
        Draw.drawBlock(ctx, item, cell);
      }
    }
  };
  
  // ============================================================
  // DRAW BLOCK (X/Y)
  // ============================================================
  Draw.drawBlock = function(ctx, item, cell) {
    const Core = getCore();
    const size = Core.getSize(item);
    const x = item.col * cell;
    const y = item.row * cell;
    const w = size * cell;
    const h = size * cell;
    
    // Draw fill
    ctx.fillStyle = item.color || Core.FILL[item.type];
    ctx.fillRect(x, y, w, h);
    
    // Draw border
    ctx.strokeStyle = Core.BORDER;
    ctx.lineWidth = 1 / Core.zoom;
    ctx.strokeRect(x, y, w, h);
    
    // Draw label (order number)
    if(item.order) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(12, 16 / Core.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.order, x + w / 2, y + h / 2);
      ctx.restore();
    }
  };
  
  // ============================================================
  // DRAW POINT (P) WITH IMAGES
  // ============================================================
  Draw.drawPoint = function(ctx, item, cell) {
    const Core = getCore();
    const sizeW = item.sizeW || item.size || Core.SIZE.P;
    const sizeH = item.sizeH || item.size || Core.SIZE.P;
    const x = item.col * cell;
    const y = item.row * cell;
    const w = sizeW * cell;
    const h = sizeH * cell;
    
    ctx.save();
    
    // Draw glow effect if enabled
    if(item.glow) {
      ctx.shadowColor = item.color || Core.FILL.P;
      ctx.shadowBlur = 15 / Core.zoom;
    }
    
    // Draw area circle if area > 0
    if(item.area && item.area > 0) {
      const centerX = x + w / 2;
      const centerY = y + h / 2;
      const radius = item.area * cell;
      
      // Area fill
      if(item.areaAlpha > 0) {
        const areaColor = item.areaColor || item.color || Core.FILL.P;
        const alpha = item.areaAlpha / 100;
        ctx.fillStyle = hexToRgba(areaColor, alpha);
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Area border
      if(item.areaBorderAlpha > 0) {
        ctx.strokeStyle = hexToRgba(item.borderColor || '#000000', item.areaBorderAlpha / 100);
        ctx.lineWidth = (item.areaBorderWidth || 2) / Core.zoom;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    
    // Draw image if available
    if(item.image) {
      const img = new Image();
      img.src = item.image;
      if(img.complete) {
        const alpha = item.fillAlpha !== undefined ? item.fillAlpha / 100 : 1;
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, x, y, w, h);
        ctx.globalAlpha = 1;
      }
    } else {
      // Draw colored rectangle if no image
      const alpha = item.fillAlpha !== undefined ? item.fillAlpha / 100 : 1;
      ctx.fillStyle = hexToRgba(item.color || Core.FILL.P, alpha);
      ctx.fillRect(x, y, w, h);
    }
    
    // Draw border
    if(item.borderAlpha > 0) {
      ctx.strokeStyle = hexToRgba(item.borderColor || '#000000', item.borderAlpha / 100);
      ctx.lineWidth = (item.borderWidth || 2) / Core.zoom;
      ctx.strokeRect(x, y, w, h);
    }
    
    // Draw label
    if(item.label) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3 / Core.zoom;
      ctx.font = `bold ${Math.max(10, 14 / Core.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const textY = y - 4 / Core.zoom;
      ctx.strokeText(item.label, x + w / 2, textY);
      ctx.fillText(item.label, x + w / 2, textY);
    }
    
    // Draw lock icon if locked
    if(item.locked) {
      ctx.fillStyle = '#ff0000';
      ctx.font = `${Math.max(12, 16 / Core.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', x + w / 2, y + h / 2);
    }
    
    ctx.restore();
  };
  
  // ============================================================
  // DRAW SELECTION HIGHLIGHTS
  // ============================================================
  Draw.drawSelection = function(ctx) {
    const Core = getCore();
    const cell = Core.cell();
    
    if(!Core.selected || Core.selected.size === 0) return;
    
    ctx.strokeStyle = Core.BORDER_SEL;
    ctx.lineWidth = 3 / Core.zoom;
    ctx.setLineDash([8 / Core.zoom, 4 / Core.zoom]);
    
    for(const id of Core.selected) {
      const item = Core.items.find(it => it.id === id);
      if(!item) continue;
      
      const sizeW = item.sizeW !== undefined ? item.sizeW : Core.getSize(item);
      const sizeH = item.sizeH !== undefined ? item.sizeH : Core.getSize(item);
      const x = item.col * cell;
      const y = item.row * cell;
      const w = sizeW * cell;
      const h = sizeH * cell;
      
      ctx.strokeRect(x - 2 / Core.zoom, y - 2 / Core.zoom, 
                     w + 4 / Core.zoom, h + 4 / Core.zoom);
    }
    
    ctx.setLineDash([]);
  };
  
  // ============================================================
  // DRAW LASSO SELECTION
  // ============================================================
  Draw.drawLasso = function(ctx) {
    const Core = getCore();
    if(!Core.lassoStart || !Core._mouseW) return;
    
    const x1 = Core.lassoStart.x;
    const y1 = Core.lassoStart.y;
    const x2 = Core._mouseW.x;
    const y2 = Core._mouseW.y;
    
    ctx.strokeStyle = '#00ff00';
    ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
    ctx.lineWidth = 2 / Core.zoom;
    ctx.setLineDash([6 / Core.zoom, 3 / Core.zoom]);
    
    const w = x2 - x1;
    const h = y2 - y1;
    
    ctx.fillRect(x1, y1, w, h);
    ctx.strokeRect(x1, y1, w, h);
    
    ctx.setLineDash([]);
  };
  
  // ============================================================
  // HELPER: Convert hex color to rgba
  // ============================================================
  function hexToRgba(hex, alpha = 1) {
    // Handle already rgba colors
    if(hex.startsWith('rgba') || hex.startsWith('rgb')) {
      return hex;
    }
    
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Handle shorthand hex (e.g., #fff)
    if(hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  
  // ============================================================
  // EXPORT TO GLOBAL SCOPE
  // ============================================================
  window.Draw = Draw;
  
  console.log('Draw module loaded');
  
})();
