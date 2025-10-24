// ============================================================
// UI MODULE - MapPlanner
// Button handlers, tooltips, menus, modals, and UI initialization
// COMPLETE VERSION - All functionality included
// ============================================================

(function(){
  const UI = {};
  
  function $(id) { 
    return document.getElementById(id); 
  }
  
  function getCore() { 
    return window.Core; 
  }

  // ============================================================
  // TOAST NOTIFICATION SYSTEM
  // ============================================================
  UI.Toast = {
    container: null,
    
    init() {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.style.cssText = `
        position: fixed;
        top: 70px;
        right: 20px;
        z-index: 10000;
        pointer-events: none;
      `;
      document.body.appendChild(this.container);
    },
    
    show(message, type = 'info', duration = 3000) {
      if (!this.container) {
        this.init();
      }
      
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;
      
      const bgColor = type === 'success' ? '#4caf50' : 
                      type === 'error' ? '#f44336' : 
                      type === 'warning' ? '#ff9800' : 
                      '#2196f3';
      
      toast.style.cssText = `
        background: ${bgColor};
        color: white;
        padding: 12px 20px;
        margin-bottom: 10px;
        border-radius: 4px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        pointer-events: auto;
        animation: slideIn 0.3s ease-out;
      `;
      
      this.container.appendChild(toast);
      
      setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },
    
    info(msg, duration) { 
      this.show(msg, 'info', duration); 
    },
    
    success(msg, duration) { 
      this.show(msg, 'success', duration); 
    },
    
    error(msg, duration) { 
      this.show(msg, 'error', duration); 
    },
    
    warning(msg, duration) { 
      this.show(msg, 'warning', duration); 
    }
  };

  // ============================================================
  // CONTEXT MENU
  // ============================================================
  UI.contextMenu = null;
  
  UI.showContextMenu = function(x, y, items) {
    UI.hideContextMenu();
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      background: #1e2439;
      border: 1px solid #404a78;
      border-radius: 4px;
      padding: 4px 0;
      min-width: 180px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      z-index: 10000;
    `;
    
    for (const item of items) {
      if (item === 'divider') {
        const divider = document.createElement('div');
        divider.style.cssText = 'height: 1px; background: #404a78; margin: 4px 0;';
        menu.appendChild(divider);
        continue;
      }
      
      const btn = document.createElement('button');
      btn.textContent = (item.icon ? item.icon + ' ' : '') + item.label;
      btn.disabled = item.disabled || false;
      
      btn.style.cssText = `
        width: 100%;
        text-align: left;
        padding: 8px 16px;
        border: none;
        background: transparent;
        color: ${item.disabled ? '#666' : '#e8eaf6'};
        cursor: ${item.disabled ? 'not-allowed' : 'pointer'};
        font-size: 14px;
      `;
      
      if (!item.disabled) {
        btn.onmouseenter = () => {
          btn.style.background = '#2d3550';
        };
        btn.onmouseleave = () => {
          btn.style.background = 'transparent';
        };
        btn.onclick = () => {
          item.action();
          UI.hideContextMenu();
        };
      }
      
      menu.appendChild(btn);
    }
    
    document.body.appendChild(menu);
    UI.contextMenu = menu;
    
    setTimeout(() => {
      document.addEventListener('click', UI.hideContextMenu, { once: true });
    }, 0);
  };
  
  UI.hideContextMenu = function() {
    if (UI.contextMenu) {
      UI.contextMenu.remove();
      UI.contextMenu = null;
    }
  };

  // ============================================================
  // LEGEND MANAGEMENT
  // ============================================================
  UI.updateLegend = function() {
    const Core = getCore();
    const container = $('legend-rows');
    if (!container) return;
    
    container.innerHTML = '';
    
    const colorMap = {};
    for (const it of Core.items) {
      if (!it.color) continue;
      if (!colorMap[it.color]) {
        colorMap[it.color] = {
          count: 0,
          label: Core.legendLabels[it.color] || ''
        };
      }
      colorMap[it.color].count++;
    }
    
    const colors = Object.keys(colorMap).sort();
    
    for (const color of colors) {
      const data = colorMap[color];
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.style.cssText = 'display: flex; align-items: center; margin: 8px 0; cursor: pointer;';
      
      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.style.cssText = `
        width: 24px;
        height: 24px;
        background: ${color};
        border: 2px solid #404a78;
        border-radius: 4px;
        margin-right: 10px;
      `;
      
      const label = document.createElement('span');
      label.textContent = data.label || color;
      label.style.cssText = 'flex: 1; color: #e8eaf6;';
      
      const count = document.createElement('span');
      count.textContent = data.count;
      count.style.cssText = 'color: #9fa8da; margin-left: 10px;';
      
      row.appendChild(swatch);
      row.appendChild(label);
      row.appendChild(count);
      
      row.onclick = () => UI.openLegendModal(color);
      
      container.appendChild(row);
    }
  };
  
  UI.openLegendModal = function(color) {
    const modal = $('legend-modal');
    const input = $('legend-modal-input');
    const swatch = $('legend-modal-swatch');
    
    if (!modal || !input || !swatch) return;
    
    const Core = getCore();
    swatch.style.background = color;
    input.value = Core.legendLabels[color] || '';
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'flex';
    input.focus();
    
    $('legend-modal-save').onclick = () => {
      Core.legendLabels[color] = input.value.trim();
      Core.markDirty('legend');
      UI.updateLegend();
      UI.closeLegendModal();
    };
    
    $('legend-modal-cancel').onclick = UI.closeLegendModal;
    $('legend-modal-backdrop').onclick = UI.closeLegendModal;
  };
  
  UI.closeLegendModal = function() {
    const modal = $('legend-modal');
    if (modal) {
      modal.setAttribute('aria-hidden', 'true');
      modal.style.display = 'none';
    }
  };

  // ============================================================
  // POINT EDIT MODAL
  // ============================================================
  UI.openPointModal = function(item) {
    const Core = getCore();
    const modal = $('point-modal');
    if (!modal) return;
    
    // Populate form with current values
    $('pm-label').value = item.label || '';
    $('pm-width').value = item.sizeW || 6;
    $('pm-height').value = item.sizeH || 6;
    $('pm-area').value = item.area || 12;
    $('pm-glow').checked = item.glow !== false;
    $('pm-color').value = item.color || '#ff66ff';
    $('pm-fill-alpha').value = item.fillAlpha || 100;
    $('pm-fill-alpha-val').textContent = (item.fillAlpha || 100) + '%';
    $('pm-border-color').value = item.borderColor || '#000000';
    $('pm-border-width').value = item.borderWidth || 1;
    $('pm-border-alpha').value = item.borderAlpha || 100;
    $('pm-border-alpha-val').textContent = (item.borderAlpha || 100) + '%';
    $('pm-area-color').value = item.areaColor || item.color || '#ff66ff';
    $('pm-area-alpha').value = item.areaAlpha || 30;
    $('pm-area-alpha-val').textContent = (item.areaAlpha || 30) + '%';
    $('pm-area-border-color').value = item.areaBorderColor || item.color || '#ff66ff';
    $('pm-area-border-width').value = item.areaBorderWidth || 2;
    $('pm-area-border-alpha').value = item.areaBorderAlpha || 100;
    $('pm-area-border-alpha-val').textContent = (item.areaBorderAlpha || 100) + '%';
    
    // Update alpha value displays on slider change
    $('pm-fill-alpha').oninput = (e) => {
      $('pm-fill-alpha-val').textContent = e.target.value + '%';
    };
    $('pm-border-alpha').oninput = (e) => {
      $('pm-border-alpha-val').textContent = e.target.value + '%';
    };
    $('pm-area-alpha').oninput = (e) => {
      $('pm-area-alpha-val').textContent = e.target.value + '%';
    };
    $('pm-area-border-alpha').oninput = (e) => {
      $('pm-area-border-alpha-val').textContent = e.target.value + '%';
    };
    
    // Handle image upload
    const imageFile = $('pm-image-file');
    imageFile.value = '';
    imageFile.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          item.image = evt.target.result;
          UI.Toast.success('Image uploaded');
        };
        reader.readAsDataURL(file);
      }
    };
    
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'flex';
    
    // Save button
    $('pm-save').onclick = () => {
      Core.pushUndo(true);
      
      item.label = $('pm-label').value.trim();
      item.sizeW = parseInt($('pm-width').value) || 6;
      item.sizeH = parseInt($('pm-height').value) || 6;
      item.area = parseInt($('pm-area').value) || 12;
      item.glow = $('pm-glow').checked;
      item.color = $('pm-color').value;
      item.fillAlpha = parseInt($('pm-fill-alpha').value);
      item.borderColor = $('pm-border-color').value;
      item.borderWidth = parseInt($('pm-border-width').value);
      item.borderAlpha = parseInt($('pm-border-alpha').value);
      item.areaColor = $('pm-area-color').value;
      item.areaAlpha = parseInt($('pm-area-alpha').value);
      item.areaBorderColor = $('pm-area-border-color').value;
      item.areaBorderWidth = parseInt($('pm-area-border-width').value);
      item.areaBorderAlpha = parseInt($('pm-area-border-alpha').value);
      
      Core.markDirty('items');
      window.Draw.render();
      UI.closePointModal();
      UI.Toast.success('Point updated');
    };
    
    // Cancel button
    $('pm-cancel').onclick = UI.closePointModal;
    
    // Backdrop click to close
    $('pm-backdrop').onclick = UI.closePointModal;
  };
  
  UI.closePointModal = function() {
    const modal = $('point-modal');
    if (modal) {
      modal.setAttribute('aria-hidden', 'true');
      modal.style.display = 'none';
    }
  };

  // ============================================================
  // MODE SWITCHING
  // ============================================================
  window.setMode = function(mode) {
    const Core = getCore();
    Core.mode = mode;
    
    // Update button states
    $('mode-draw').classList.toggle('active', mode === 'draw');
    $('mode-select').classList.toggle('active', mode === 'select');
    $('mode-view').classList.toggle('active', mode === 'view');
    
    // Update status message
    const status = $('status');
    if (status) {
      if (mode === 'draw') {
        status.textContent = 'Draw Mode - Click to place X';
      } else if (mode === 'select') {
        status.textContent = 'Select Mode - Click items to select';
      } else if (mode === 'view') {
        status.textContent = 'View Mode - Pan and zoom only';
      }
    }
    
    Core.markDirty('view');
    if (window.Draw) {
      window.Draw.render();
    }
  };


  // ============================================================
  // ADD PRESET ELEMENT FROM MENU
  // ============================================================
  window.addPresetElementFromMenu = function(presetKey) {
    const Core = getCore();
    
    if(!window.ElementPresets || !window.ElementPresets[presetKey]) {
      UI.Toast.error(`Preset "${presetKey}" not found`);
      return;
    }
    
    const preset = window.ElementPresets[presetKey];
    
    Core.pushUndo(true);
    
    // Find center of viewport
    const canvas = $('board');
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const world = Core.screenToWorld(cx, cy);
    const rc = Core.worldToRC(world.x, world.y);
    
    // Place the element
    const item = Core.place('P', Math.round(rc.r), Math.round(rc.c), {
      sizeW: preset.sizeW || 6,
      sizeH: preset.sizeH || 6,
      label: preset.label || presetKey,
      color: preset.color || '#ff66ff',
      image: preset.image || null,
      area: preset.area || 0,
      fillAlpha: preset.fillAlpha || 100,
      borderAlpha: preset.borderAlpha || 100,
      borderWidth: preset.borderWidth || 1,
      borderColor: preset.borderColor || '#000000',
      areaAlpha: preset.areaAlpha || 30,
      areaColor: preset.areaColor || preset.color || '#ff66ff',
      areaBorderAlpha: preset.areaBorderAlpha || 100,
      areaBorderWidth: preset.areaBorderWidth || 2,
      areaBorderColor: preset.areaBorderColor || preset.color || '#ff66ff',
      glow: preset.glow !== false
    });
    
    if(item) {
      UI.Toast.success(`Added ${preset.label || presetKey}`);
    }
  };
  

  // ============================================================
  // BUTTON INITIALIZATION
  // ============================================================
  function initButtons() {
    const Core = getCore();
    
    // ========== MODE BUTTONS ==========
    const modeDrawBtn = $('mode-draw');
    if (modeDrawBtn) {
      modeDrawBtn.addEventListener('click', () => {
        // Disable measure tool if active
        if (window.Features && window.Features.Measure && window.Features.Measure.enabled) {
          window.Features.Measure.toggle();
          const measureBtn = $('measure-tool');
          if (measureBtn) {
            measureBtn.classList.remove('active');
          }
        }
        window.setMode('draw');
      });
    }
    
    const modeSelectBtn = $('mode-select');
    if (modeSelectBtn) {
      modeSelectBtn.addEventListener('click', () => {
        // Disable measure tool if active
        if (window.Features && window.Features.Measure && window.Features.Measure.enabled) {
          window.Features.Measure.toggle();
          const measureBtn = $('measure-tool');
          if (measureBtn) {
            measureBtn.classList.remove('active');
          }
        }
        window.setMode('select');
      });
    }
    
    const modeViewBtn = $('mode-view');
    if (modeViewBtn) {
      modeViewBtn.addEventListener('click', () => {
        // Disable measure tool if active
        if (window.Features && window.Features.Measure && window.Features.Measure.enabled) {
          window.Features.Measure.toggle();
          const measureBtn = $('measure-tool');
          if (measureBtn) {
            measureBtn.classList.remove('active');
          }
        }
        window.setMode('view');
      });
    }
    
    // ========== UNDO/REDO BUTTONS ==========
    const undoBtn = $('undo');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => {
        if (Core.history.undo.length === 0) {
          UI.Toast.warning('Nothing to undo');
          return;
        }
        
        const state = Core.history.undo.pop();
        Core.history.redo.push(Core.history.createSnapshot());
        
        Core.items = JSON.parse(JSON.stringify(state.action.items || []));
        Core.idSeq = state.action.idSeq || 1;
        Core.legendLabels = {...(state.action.legendLabels || {})};
        
        if (Number.isFinite(state.action.gridSize)) {
          Core.setGridSize(state.action.gridSize, {scale: false});
        }
        
        Core.markDirty('items');
        Core.markDirty('legend');
        window.Draw.render();
        UI.updateLegend();
        UI.Toast.info('Undo');
      });
    }
    
    const redoBtn = $('redo');
    if (redoBtn) {
      redoBtn.addEventListener('click', () => {
        if (Core.history.redo.length === 0) {
          UI.Toast.warning('Nothing to redo');
          return;
        }
        
        const state = Core.history.redo.pop();
        Core.history.undo.push({
          version: Core._stateVersion++,
          timestamp: Date.now(),
          action: Core.history.createSnapshot()
        });
        
        Core.items = JSON.parse(JSON.stringify(state.items || []));
        Core.idSeq = state.idSeq || 1;
        Core.legendLabels = {...(state.legendLabels || {})};
        
        if (Number.isFinite(state.gridSize)) {
          Core.setGridSize(state.gridSize, {scale: false});
        }
        
        Core.markDirty('items');
        Core.markDirty('legend');
        window.Draw.render();
        UI.updateLegend();
        UI.Toast.info('Redo');
      });
    }
    
    // ========== COLOR PICKER BUTTON ==========
    const colorBtn = $('color-btn');
    if (colorBtn) {
      colorBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = Core._currentColor || '#4a7cff';
        input.onchange = (e) => {
          Core._currentColor = e.target.value;
          UI.Toast.success(`Color: ${e.target.value}`);
        };
        input.click();
      });
    }
    
    // ========== LEGEND TOGGLE ==========
    const legendToggleBtn = $('legend-toggle');
    if (legendToggleBtn) {
      legendToggleBtn.addEventListener('click', () => {
        const legend = $('legend');
        if (legend) {
          legend.classList.toggle('show');
        }
      });
    }
    
    const legendCloseBtn = $('legend-close');
    if (legendCloseBtn) {
      legendCloseBtn.addEventListener('click', () => {
        const legend = $('legend');
        if (legend) {
          legend.style.display = 'none';
        }
      });
    }
    
    // ========== MENU TOGGLES ==========
    const dtoolsToggleBtn = $('dtools-toggle');
    if (dtoolsToggleBtn) {
      dtoolsToggleBtn.addEventListener('click', () => {
        const menu = $('dtools');
        if (menu) {
          menu.classList.toggle('open');
        }
      });
    }
    
    const menuToggleBtn = $('menu-toggle');
    if (menuToggleBtn) {
      menuToggleBtn.addEventListener('click', () => {
        const menu = $('menu');
        if (menu) {
          menu.classList.toggle('open');
        }
      });
    }
    
    // ========== ZOOM CONTROLS ==========
    const zoomSlider = $('zoom-slider');
    if (zoomSlider) {
      zoomSlider.addEventListener('input', (e) => {
        const pct = parseInt(e.target.value);
        Core.zoom = pct / 100;
        const label = $('zoom-label');
        if (label) {
          label.textContent = pct + '%';
        }
        Core.markDirty('view');
        window.Draw.render();
      });
    }
    
    const fitViewBtn = $('fit-view');
    if (fitViewBtn) {
      fitViewBtn.addEventListener('click', () => {
        Core.fitView();
      });
    }
    
    // ========== DRAWING TOOLS ==========
    initDrawingTools();
    
    // ========== POINTS ==========
    initPoints();
    
    // ========== GRID AND EXPORT ==========
    initGridAndExport();
    
    // ========== DROPDOWN MENU ==========
    initDropdown();
    
    console.log('UI buttons initialized');
  }
  
  // ============================================================
  // DRAWING TOOLS INITIALIZATION
  // ============================================================
  function initDrawingTools() {
    const Core = getCore();
    
    // Delete selected
    const deleteBtn = $('delete-selected');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (Core.selected.size === 0) {
          UI.Toast.warning('No items selected');
          return;
        }
        Core.pushUndo(true);
        Core.items = Core.items.filter(it => !Core.selected.has(it.id));
        Core.selected.clear();
        Core.markDirty('items');
        window.Draw.render();
        UI.Toast.success('Deleted');
      });
    }
    
    // Copy selected
    const copyBtn = $('copy-selected');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        if (Core.selected.size === 0) {
          UI.Toast.warning('No items selected');
          return;
        }
        Core.clipboard = Core.items
          .filter(it => Core.selected.has(it.id))
          .map(it => ({...it}));
        UI.Toast.success(`Copied ${Core.clipboard.length} item(s)`);
      });
    }
    
    // Paste selected
    const pasteBtn = $('paste-selected');
    if (pasteBtn) {
      pasteBtn.addEventListener('click', () => {
        if (Core.clipboard.length === 0) {
          UI.Toast.warning('Clipboard empty');
          return;
        }
        Core.pushUndo(true);
        
        for (const it of Core.clipboard) {
          const newItem = {...it, id: Core.idSeq++};
          newItem.row = Math.min(
            Core.GRID - (newItem.sizeH || Core.getSize(newItem)), 
            newItem.row + 2
          );
          newItem.col = Math.min(
            Core.GRID - (newItem.sizeW || Core.getSize(newItem)), 
            newItem.col + 2
          );
          
          if (!Core.collides(newItem)) {
            Core.items.push(newItem);
          }
        }
        
        Core.markDirty('items');
        window.Draw.render();
        UI.Toast.success('Pasted');
      });
    }
    
    // Select all
    const selectAllBtn = $('select-all-btn');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        Core.selected.clear();
        Core.items.forEach(it => Core.selected.add(it.id));
        Core.markDirty('selection');
        window.Draw.render();
        UI.Toast.success(`Selected ${Core.items.length} items`);
      });
    }
    
    // Deselect
    const deselectBtn = $('deselect');
    if (deselectBtn) {
      deselectBtn.addEventListener('click', () => {
        Core.selected.clear();
        Core.markDirty('selection');
        window.Draw.render();
        UI.Toast.info('Deselected all');
      });
    }
    
    // Clear all
    const clearBtn = $('clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!confirm('Clear all items? This cannot be undone!')) {
          return;
        }
        Core.pushUndo(true);
        Core.items = [];
        Core.selected.clear();
        Core.markDirty('items');
        window.Draw.render();
        UI.Toast.success('Cleared');
      });
    }
    
    // Align horizontal
    const alignHBtn = $('align-h');
    if (alignHBtn) {
      alignHBtn.addEventListener('click', () => {
        if (Core.selected.size === 0) {
          UI.Toast.warning('No items selected');
          return;
        }
        
        Core.pushUndo(true);
        const gap = parseInt($('align-gap').value) || 0;
        
        const selected = Array.from(Core.selected)
          .map(id => Core.items.find(it => it.id === id))
          .filter(Boolean);
        selected.sort((a, b) => a.col - b.col || a.row - b.row);
        
        let col = selected[0].col;
        for (const it of selected) {
          it.col = col;
          col += (it.sizeW || Core.getSize(it)) + gap;
        }
        
        Core.markDirty('items');
        window.Draw.render();
        UI.Toast.success('Aligned horizontally');
      });
    }
    
    // Align vertical
    const alignVBtn = $('align-v');
    if (alignVBtn) {
      alignVBtn.addEventListener('click', () => {
        if (Core.selected.size === 0) {
          UI.Toast.warning('No items selected');
          return;
        }
        
        Core.pushUndo(true);
        const gap = parseInt($('align-gap').value) || 0;
        
        const selected = Array.from(Core.selected)
          .map(id => Core.items.find(it => it.id === id))
          .filter(Boolean);
        selected.sort((a, b) => a.row - b.row || a.col - b.col);
        
        let row = selected[0].row;
        for (const it of selected) {
          it.row = row;
          row += (it.sizeH || Core.getSize(it)) + gap;
        }
        
        Core.markDirty('items');
        window.Draw.render();
        UI.Toast.success('Aligned vertically');
      });
    }
  }
  
  // ============================================================
  // POINTS INITIALIZATION
  // ============================================================
  function initPoints() {
    const Core = getCore();
    
    // Add point
    const addPointBtn = $('add-point');
    if (addPointBtn) {
      addPointBtn.addEventListener('click', () => {
        Core.pushUndo(true);
        const canvas = $('board');
        const rect = canvas.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const world = Core.screenToWorld(cx, cy);
        const rc = Core.worldToRC(world.x, world.y);
        
        Core.addPoint(Math.round(rc.r), Math.round(rc.c));
        UI.Toast.success('Point added');
      });
    }
    
    // Edit point
    const editPointBtn = $('edit-point');
    if (editPointBtn) {
      editPointBtn.addEventListener('click', () => {
        if (Core.selected.size !== 1) {
          UI.Toast.warning('Select exactly one Point (P)');
          return;
        }
        
        const id = Array.from(Core.selected)[0];
        const item = Core.items.find(it => it.id === id);
        
        if (!item || item.type !== 'P') {
          UI.Toast.warning('Selected item is not a Point (P)');
          return;
        }
        
        UI.openPointModal(item);
      });
    }
    
    // Toggle lock
    const toggleLockBtn = $('toggle-lock');
    if (toggleLockBtn) {
      toggleLockBtn.addEventListener('click', () => {
        if (Core.selected.size === 0) {
          UI.Toast.warning('No items selected');
          return;
        }
        
        Core.pushUndo(true);
        let locked = 0;
        let unlocked = 0;
        
        for (const id of Core.selected) {
          const item = Core.items.find(it => it.id === id);
          if (item && item.type === 'P') {
            item.locked = !item.locked;
            if (item.locked) {
              locked++;
            } else {
              unlocked++;
            }
          }
        }
        
        Core.markDirty('items');
        window.Draw.render();
        UI.Toast.success(`Locked: ${locked}, Unlocked: ${unlocked}`);
      });
    }
    
    // Toggle lights
    const lightsBtn = $('lights');
    if (lightsBtn) {
      lightsBtn.addEventListener('click', () => {
        if (Core.selected.size === 0) {
          UI.Toast.warning('No items selected');
          return;
        }
        
        Core.pushUndo(true);
        let enabled = 0;
        let disabled = 0;
        
        for (const id of Core.selected) {
          const item = Core.items.find(it => it.id === id);
          if (item && (item.type === 'Y' || item.type === 'P')) {
            item.glow = !item.glow;
            if (item.glow) {
              enabled++;
            } else {
              disabled++;
            }
          }
        }
        
        Core.markDirty('items');
        window.Draw.render();
        UI.Toast.success(`Light on: ${enabled}, off: ${disabled}`);
      });
    }
  }
  
  // ============================================================
  // GRID AND EXPORT INITIALIZATION
  // ============================================================
  function initGridAndExport() {
    const Core = getCore();
    
    // Apply grid size
    const applyGridBtn = $('apply-grid');
    if (applyGridBtn) {
      applyGridBtn.addEventListener('click', () => {
        const size = parseInt($('grid-size').value);
        if (!size || size < 20 || size > 2000) {
          UI.Toast.error('Grid size must be between 20 and 2000');
          return;
        }
        
        Core.pushUndo(true);
        Core.setGridSize(size);
        UI.Toast.success(`Grid size: ${size}`);
      });
    }
    
    // Save JSON
    const saveJsonBtn = $('save-json');
    if (saveJsonBtn) {
      saveJsonBtn.addEventListener('click', () => {
        const data = {
          items: Core.items,
          idSeq: Core.idSeq,
          legendLabels: Core.legendLabels,
          gridSize: Core.GRID,
          timestamp: Date.now()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: 'application/json'
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `map-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        UI.Toast.success('JSON saved');
      });
    }
    
    // Load JSON
    const loadJsonBtn = $('load-json');
    if (loadJsonBtn) {
      loadJsonBtn.addEventListener('click', () => {
        $('json-file').click();
      });
    }
    
    const jsonFile = $('json-file');
    if (jsonFile) {
      jsonFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const data = JSON.parse(evt.target.result);
            
            if (Number.isFinite(data.gridSize)) {
              Core.setGridSize(data.gridSize, {scale: false});
            }
            
            Core.items = data.items || [];
            Core.idSeq = data.idSeq || 1;
            Core.legendLabels = data.legendLabels || {};
            
            Core.markDirty('items');
            Core.markDirty('legend');
            window.Draw.render();
            UI.updateLegend();
            Core.fitView();
            
            UI.Toast.success('JSON loaded');
          } catch (err) {
            console.error('Failed to load JSON:', err);
            UI.Toast.error('Failed to load JSON');
          }
        };
        reader.readAsText(file);
      });
    }
    
    // Export PNG
    const exportPngBtn = $('export-png');
    if (exportPngBtn) {
      exportPngBtn.addEventListener('click', () => {
        const canvas = $('board');
        canvas.toBlob((blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `map-${Date.now()}.png`;
          a.click();
          URL.revokeObjectURL(a.href);
          UI.Toast.success('PNG exported');
        });
      });
    }
  }
  
  // ============================================================
  // DROPDOWN MENU INITIALIZATION
  // ============================================================
  function initDropdown() {
    const pointsList = $('points-list');
    const dropdown = $('points-dropdown');
    
    if (pointsList && dropdown) {
      pointsList.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('overlay-open');
      });
      
      dropdown.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-preset]');
        if (btn) {
          const preset = btn.getAttribute('data-preset');
          if (window.addPresetElementFromMenu) {
            window.addPresetElementFromMenu(preset);
          }
          dropdown.classList.remove('overlay-open');
        }
      });
      
      document.addEventListener('click', () => {
        dropdown.classList.remove('overlay-open');
      });
    }
  }


  // FIXED: Auto-hide menus when clicking outside
  document.addEventListener('click', (e) => {
    // Don't hide if clicking menu buttons
    if(e.target.closest('#dtools-toggle') || e.target.closest('#menu-toggle')) {
      return;
    }
    
    // Don't hide if clicking inside menus
    if(e.target.closest('#dtools') || e.target.closest('#menu')) {
      return;
    }
    
    // Hide all menus
    const dtools = $('dtools');
    const menu = $('menu');
    if(dtools) dtools.classList.remove('open');
    if(menu) menu.classList.remove('open');
  });
  
  // ============================================================
  // KEYBOARD SHORTCUTS
  // ============================================================
  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      const Core = getCore();
      
      // Undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const undoBtn = $('undo');
        if (undoBtn) undoBtn.click();
      }
      
      // Redo
      if (e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const redoBtn = $('redo');
        if (redoBtn) redoBtn.click();
      }
      
      // Copy
      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        const copyBtn = $('copy-selected');
        if (copyBtn) copyBtn.click();
      }
      
      // Paste
      if (e.ctrlKey && e.key === 'v') {
        e.preventDefault();
        const pasteBtn = $('paste-selected');
        if (pasteBtn) pasteBtn.click();
      }
      
      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement.tagName !== 'INPUT' && 
            document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          const deleteBtn = $('delete-selected');
          if (deleteBtn) deleteBtn.click();
        }
      }
      
      // Select All
      if (e.ctrlKey && e.key === 'a') {
        e.preventDefault();
        const selectAllBtn = $('select-all-btn');
        if (selectAllBtn) selectAllBtn.click();
      }
      
      // Fit View
      if (e.key === 'f' || e.key === 'F') {
        if (document.activeElement.tagName !== 'INPUT' && 
            document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          Core.fitView();
        }
      }
      
      // Mode shortcuts
      if (e.key === '1') {
        if (document.activeElement.tagName !== 'INPUT' && 
            document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          const modeDrawBtn = $('mode-draw');
          if (modeDrawBtn) modeDrawBtn.click();
        }
      }
      
      if (e.key === '2') {
        if (document.activeElement.tagName !== 'INPUT' && 
            document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          const modeSelectBtn = $('mode-select');
          if (modeSelectBtn) modeSelectBtn.click();
        }
      }
      
      if (e.key === '3') {
        if (document.activeElement.tagName !== 'INPUT' && 
            document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          const modeViewBtn = $('mode-view');
          if (modeViewBtn) modeViewBtn.click();
        }
      }
      
      // Escape - deselect and close menus
      if (e.key === 'Escape') {
        Core.selected.clear();
        Core.markDirty('selection');
        window.Draw.render();
        UI.hideContextMenu();
        
        // Close measure tool if active
        if (window.Features && window.Features.Measure && window.Features.Measure.enabled) {
          window.Features.Measure.toggle();
          const measureBtn = $('measure-tool');
          if (measureBtn) {
            measureBtn.classList.remove('active');
          }
        }
      }
    });
    
    console.log('Keyboard shortcuts initialized');
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================
  function init() {
    UI.Toast.init();
    initButtons();
    initKeyboard();
    UI.updateLegend();
    
    console.log('UI module initialized');
  }

  // Export UI module
  window.UI = UI;
  
  // Initialize when ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
