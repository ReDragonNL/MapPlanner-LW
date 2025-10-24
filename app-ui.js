// ============================================================
// UI COMPONENTS - MapPlanner
// Toast notifications, shortcuts, context menus, modals
// All bugs fixed: DTools auto-hide, dropdown, grid size, etc.
// PATCHED: Improved context menu handling
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
  const Toast = {
    container: null,
    
    init() {
      if(this.container) return;
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      `;
      document.body.appendChild(this.container);
    },
    
    show(message, type = 'info', duration = 3000) {
      this.init();
      
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      
      const colors = {
        success: '#2e7d32',
        error: '#c62828',
        warning: '#f57c00',
        info: '#1976d2'
      };
      
      toast.style.cssText = `
        background: ${colors[type] || colors.info};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        font-size: 14px;
        min-width: 200px;
        max-width: 400px;
        pointer-events: auto;
        animation: slideIn 0.3s ease-out;
        opacity: 0.95;
      `;
      
      toast.textContent = message;
      this.container.appendChild(toast);
      
      setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },
    
    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error'); },
    warning(msg) { this.show(msg, 'warning'); },
    info(msg) { this.show(msg, 'info'); }
  };

  // ============================================================
  // CSS ANIMATIONS FOR TOASTS
  // ============================================================
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to   { transform: translateX(0);      opacity: 0.95; }
    }
    @keyframes slideOut {
      from { transform: translateX(0);      opacity: 0.95; }
      to   { transform: translateX(400px);  opacity: 0; }
    }

    .tooltip {
      position: absolute;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 13px;
      pointer-events: none;
      z-index: 10000;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .tooltip.show { opacity: 1; }

    .context-menu {
      position: fixed;
      background: #1c2248;
      border: 1px solid #2b3160;
      border-radius: 8px;
      padding: 6px;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      min-width: 180px;
    }
    .context-menu-item {
      padding: 8px 12px;
      cursor: pointer;
      border-radius: 4px;
      font-size: 14px;
      color: white;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .context-menu-item:hover { background: #2a335f; }
    .context-menu-item.disabled { opacity: 0.4; cursor: not-allowed; }
    .context-menu-divider { height: 1px; margin: 6px 4px; background: #313a6f; }
  `;
  document.head.appendChild(style);

  // ============================================================
  // KEYBOARD SHORTCUTS MANAGER
  // ============================================================
  const Shortcuts = {
    shortcuts: new Map(),
    
    register(key, handler, description) {
      this.shortcuts.set(key.toLowerCase(), {handler, description});
    },
    
    handle(e) {
      const tag = (e.target.tagName || '').toUpperCase();
      if(tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      
      let key = e.key.toLowerCase();
      if(e.ctrlKey) key = 'ctrl+' + key;
      if(e.shiftKey && e.ctrlKey) key = 'ctrl+shift+' + key;
      if(e.altKey) key = 'alt+' + key;
      
      const shortcut = this.shortcuts.get(key);
      if(shortcut) {
        e.preventDefault();
        shortcut.handler(e);
        return true;
      }
      return false;
    },
    
    getAll() {
      return Array.from(this.shortcuts.entries()).map(([key, data]) => ({
        key,
        description: data.description
      }));
    }
  };

  // ============================================================
  // CONTEXT MENU SYSTEM
  // ============================================================
  let contextMenu = null;
  
  function showContextMenu(x, y, items) {
    hideContextMenu();
    
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    
    items.forEach(item => {
      if(item === 'divider') {
        const divider = document.createElement('div');
        divider.className = 'context-menu-divider';
        contextMenu.appendChild(divider);
        return;
      }
      
      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu-item';
      if(item.disabled) menuItem.classList.add('disabled');
      menuItem.innerHTML = `${item.icon || ''} ${item.label}`;
      
      if(!item.disabled && item.action) {
        menuItem.onclick = () => {
          try {
            item.action();
            hideContextMenu();
          } catch(err) {
            console.error('Menu item action error:', err);
            hideContextMenu();
          }
        };
      }
      
      contextMenu.appendChild(menuItem);
    });
    
    document.body.appendChild(contextMenu);
    
    const rect = contextMenu.getBoundingClientRect();
    if(rect.right > window.innerWidth) {
      contextMenu.style.left = (x - rect.width) + 'px';
    }
    if(rect.bottom > window.innerHeight) {
      contextMenu.style.top = (y - rect.height) + 'px';
    }
  }
  
  function hideContextMenu() {
    if(contextMenu) {
      contextMenu.remove();
      contextMenu = null;
    }
  }

  // ============================================================
  // AUTO-HIDE CONTEXT MENU
  // ============================================================
  document.addEventListener('click', (e) => {
    const inFlyout = e.target.closest('[data-ctx-flyout="points"]');
    if (contextMenu && !(contextMenu.contains(e.target) || inFlyout)) {
      hideContextMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
    }
  });

  document.addEventListener('contextmenu', (e) => {
    const isOnCanvas = e.target.id === 'board';
    if (!isOnCanvas) hideContextMenu();
  });

  // ============================================================
  // MENU TOGGLE HANDLER
  // ============================================================
  const menu = $('menu');
  const canvas = $('board');
  
  if($('menu-toggle')) {
    $('menu-toggle').onclick = (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
      
      if(menu.classList.contains('open')) {
        const dtools = $('dtools');
        const legend = $('legend');
        if(dtools) dtools.classList.remove('open');
        if(legend) legend.classList.remove('show');
      }
    };
  }

  // ============================================================
  // DTOOLS TOGGLE HANDLER (FIXED - AUTO-HIDE)
  // ============================================================
  const dtoolsBtn = document.getElementById('dtools-toggle');
  const dtoolsPanel = document.getElementById('dtools');
  const menuPanel = document.getElementById('menu');
  const legendPanel = document.getElementById('legend');

  if (dtoolsBtn && dtoolsPanel) {
    dtoolsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dtoolsPanel.classList.toggle('open');

      if (dtoolsPanel.classList.contains('open')) {
        menuPanel?.classList.remove('open');
        legendPanel?.classList.remove('show');
      }
    });
  }

  document.getElementById('dtools')?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.addEventListener('click', (e) => {
    const dtools = document.getElementById('dtools');
    const menu = document.getElementById('menu');
    const dtoolsBtn = document.getElementById('dtools-toggle');
    const menuBtn = document.getElementById('menu-toggle');
    
    if (dtools && dtools.classList.contains('open')) {
      if (!dtools.contains(e.target) && !dtoolsBtn?.contains(e.target)) {
        dtools.classList.remove('open');
      }
    }
    
    if (menu && menu.classList.contains('open')) {
      if (!menu.contains(e.target) && !menuBtn?.contains(e.target)) {
        menu.classList.remove('open');
      }
    }
  });
  
  // ============================================================
  // "+ Element ▼" overlay dropdown (floating submenu)
  // FIXED: Prevent immediate close and handle clicks properly
  // ============================================================
  (function(){
    const dropdownBtn = document.getElementById('points-list');
    const dropdownContent = document.getElementById('points-dropdown');

    if (dropdownBtn && dropdownContent) {
      console.log('Dropdown elements found:', dropdownBtn, dropdownContent);
      
      const originalParent = dropdownContent.parentElement;
      const originalNext = dropdownContent.nextSibling;
      let isOpen = false;

      dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('Dropdown button clicked, isOpen:', isOpen);

        if (isOpen) {
          closeDropdown();
          return;
        }

        const rect = dropdownBtn.getBoundingClientRect();
        dropdownContent.style.position = 'fixed';
        dropdownContent.style.left = rect.left + 'px';
        dropdownContent.style.top = (rect.bottom + 4) + 'px';
        dropdownContent.style.display = 'flex';
        dropdownContent.style.flexDirection = 'column';
        dropdownContent.style.zIndex = '10001';
        dropdownContent.style.opacity = '1';
        dropdownContent.style.transform = 'translateY(0)';
        dropdownContent.classList.add('overlay-open');
        isOpen = true;

        console.log('Dropdown opened, styles applied:', dropdownContent.style.cssText);

        document.body.appendChild(dropdownContent);

        setTimeout(() => {
          document.addEventListener('click', outsideClickHandler);
        }, 100);
      });

      dropdownContent.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-preset]');
        if (!btn) return;

        e.stopPropagation();
        console.log('Preset clicked:', btn.dataset.preset);
        
        const Core = getCore();
        const preset = btn.dataset.preset;
        
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

        closeDropdown();
      });

      function outsideClickHandler(e) {
        if (!dropdownContent.contains(e.target) && e.target !== dropdownBtn) {
          closeDropdown();
        }
      }

      function closeDropdown() {
        if (!isOpen) return;
        
        console.log('Closing dropdown');
        document.removeEventListener('click', outsideClickHandler);
        dropdownContent.classList.remove('overlay-open');
        dropdownContent.style.position = '';
        dropdownContent.style.left = '';
        dropdownContent.style.top = '';
        dropdownContent.style.display = 'none';
        dropdownContent.style.zIndex = '';
        dropdownContent.style.opacity = '';
        dropdownContent.style.transform = '';
        isOpen = false;

        if (originalParent) {
          if (originalNext) {
            originalParent.insertBefore(dropdownContent, originalNext);
          } else {
            originalParent.appendChild(dropdownContent);
          }
        }
      }
    } else {
      console.error('Dropdown elements NOT found - check HTML IDs');
    }
  })();

  // ============================================================
  // COLOR PICKER (NATIVE)
  // ============================================================
  function setupColorPicker() {
    const Core = getCore();
    const colorBtn = $('color-btn');
    if (!colorBtn) return;

    let picker = document.createElement('input');
    picker.type = 'color';
    picker.style.position = 'absolute';
    picker.style.opacity = '0';
    picker.style.pointerEvents = 'none';
    picker.style.zIndex = '9999';
    picker.style.width = '1px';
    picker.style.height = '1px';
    document.body.appendChild(picker);

    picker.addEventListener('input', (e) => {
      const color = e.target.value;
      if (!Core.selected.size) {
        Toast.warning('Select items first');
        return;
      }
      let count = 0;
      for (const id of Core.selected) {
        const it = Core.items.find(x => x.id === id);
        if (!it) continue;
        if (it.type === Core.TYPES.X || it.type === Core.TYPES.Y) {
          it.color = color;
          count++;
        }
      }
      if (count > 0) {
        Core.markDirty('items');
        Core.markDirty('legend');
        window.Draw.render();
        UI.updateLegend();
        Toast.success(`Color applied to ${count} item${count > 1 ? 's' : ''}`);
      } else {
        Toast.warning('No X or Y blocks selected');
      }
    });

    colorBtn.onclick = (e) => {
      const rect = colorBtn.getBoundingClientRect();
      picker.style.left = `${rect.left + rect.width / 2}px`;
      picker.style.top = `${rect.bottom + 5}px`;
      requestAnimationFrame(() => picker.click());
    };
  }

  setupColorPicker();

  // ============================================================
  // LEGEND POPUP CONTROLS
  // ============================================================
  (function legendPopupSetup(){
    const legend   = $('legend');
    const toggleBtn= $('legend-toggle');
    const closeBtn = $('legend-close');
    if (!legend || !toggleBtn || !closeBtn) return;
    
    legend.style.display = '';

    function setLegendVisible(visible){
      if (visible) {
        legend.classList.add('show');
        toggleBtn.textContent = 'Close Legend';
      } else {
        legend.classList.remove('show');
        toggleBtn.textContent = 'Open Legend';
      }
    }

    toggleBtn.textContent = legend.classList.contains('show') ? 'Close Legend' : 'Open Legend';

    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wantOpen = !legend.classList.contains('show');
      setLegendVisible(wantOpen);
    });

    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setLegendVisible(false);
    });

    document.addEventListener('click', (e) => {
      if (!legend.classList.contains('show')) return;
      if (legend.contains(e.target) || (toggleBtn && toggleBtn.contains(e.target))) return;
      setLegendVisible(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && legend.classList.contains('show')) {
        setLegendVisible(false);
      }
    });
  })();

  // ============================================================
  // LEGEND MANAGEMENT
  // ============================================================
  let editingColor = null;
  
  UI.usedColors = () => {
    const Core = getCore();
    return [...new Set(
      Core.items
        .filter(i => (i.type === Core.TYPES.X || i.type === Core.TYPES.Y) && i.color)
        .map(i => i.color)
    )];
  };

  UI.updateLegend = function() {
    const Core = getCore();
    const legendRows = $('legend-rows');
    const legend = $('legend');
    
    if(!legendRows || !legend) return;
    
    legendRows.innerHTML = "";
    const used = UI.usedColors();
    
    used.forEach(c => {
      const row = document.createElement('div');
      row.className = "legend-row";
      
      const sw = document.createElement('div');
      sw.className = 'sw';
      sw.style.background = c;
      
      const txt = document.createElement('div');
      txt.className = 'txt';
      txt.textContent = Core.legendLabels[c] || c;
      
      row.appendChild(sw);
      row.appendChild(txt);
      row.onclick = () => openLegendModal(c);
      
      legendRows.appendChild(row);
    });
    
    legend.style.display = '';
    if (used.length === 0) {
      legend.classList.remove('show');
      const toggleBtn = $('legend-toggle');
      if (toggleBtn) toggleBtn.textContent = 'Open Legend';
    }
  };

  // ============================================================
  // LEGEND MODAL CONTROLS
  // ============================================================
  function openLegendModal(color) {
    const Core = getCore();
    const modal = $('legend-modal');
    const modalSwatch = $('legend-modal-swatch');
    const modalInput = $('legend-modal-input');
    
    if(!modal || !modalSwatch || !modalInput) return;
    
    editingColor = color;
    modalSwatch.style.background = color;
    modalInput.value = Core.legendLabels[color] || '';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    canvas.style.pointerEvents = 'none';
    
    setTimeout(() => {
      modalInput.focus();
      modalInput.select();
    }, 30);
  }

  function closeLegendModal() {
    const modal = $('legend-modal');
    if(!modal) return;
    
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    canvas.style.pointerEvents = 'auto';
    editingColor = null;
  }

  if($('legend-modal-backdrop')) {
    $('legend-modal-backdrop').addEventListener('click', closeLegendModal);
  }
  
  if($('legend-modal-cancel')) {
    $('legend-modal-cancel').addEventListener('click', closeLegendModal);
  }

  if($('legend-modal-save')) {
    $('legend-modal-save').addEventListener('click', (e) => {
      e.stopPropagation();
      const Core = getCore();
      const modalInput = $('legend-modal-input');
      
      if (editingColor && modalInput) {
        Core.legendLabels[editingColor] = modalInput.value;
        Core.markDirty('legend');
        UI.updateLegend();
        Toast.success('Legend label updated');
      }

      const modal = $('legend-modal');
      if (modal) {
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
      }

      const canvas = $('board');
      if (canvas) canvas.style.pointerEvents = 'auto';

      editingColor = null;
    });
  }
  
  // ============================================================
  // KEYBOARD SHORTCUTS REGISTRATION
  // ============================================================
  Shortcuts.register('ctrl+z', () => {
    if($('undo')) $('undo').click();
  }, 'Undo');

  Shortcuts.register('ctrl+y', () => {
    if($('redo')) $('redo').click();
  }, 'Redo');

  Shortcuts.register('ctrl+c', () => {
    if($('copy-selected')) $('copy-selected').click();
  }, 'Copy');

  Shortcuts.register('ctrl+v', () => {
    if($('paste-selected')) $('paste-selected').click();
  }, 'Paste');

  Shortcuts.register('delete', () => {
    if($('delete-selected')) $('delete-selected').click();
  }, 'Delete');

  Shortcuts.register('backspace', () => {
    if($('delete-selected')) $('delete-selected').click();
  }, 'Delete');

  Shortcuts.register('f', () => {
    getCore().fitView();
    Toast.info('Fit to view');
  }, 'Fit View');

  Shortcuts.register('escape', () => {
    const Core = getCore();
    Core.selected.clear();
    Core.markDirty('selection');
    window.Draw.render();
  }, 'Deselect');

  Shortcuts.register('ctrl+a', () => {
    const Core = getCore();
    Core.selected.clear();
    for(const it of Core.items) {
      Core.selected.add(it.id);
    }
    Core.markDirty('selection');
    window.Draw.render();
    Toast.info(`Selected ${Core.items.length} items`);
  }, 'Select All');

  Shortcuts.register('ctrl+shift+c', () => {
    if($('clear')) $('clear').click();
  }, 'Clear All');

  Shortcuts.register('?', () => {
    const helpOverlay = $('help-overlay');
    if(helpOverlay) helpOverlay.classList.toggle('show');
  }, 'Show Help');

  document.addEventListener('keydown', (e) => {
    Shortcuts.handle(e);
  });

  // ============================================================
  // MOUSE WHEEL ZOOM
  // ============================================================
  window.addEventListener('wheel', e => {
    const t = (e.target.tagName || '').toUpperCase();
    if (t === 'INPUT' || t === 'TEXTAREA') return;
    
    const helpOverlay = document.getElementById('help-overlay');
    const helpCard = document.querySelector('.help-card');
    if (helpOverlay && helpOverlay.classList.contains('show')) {
      if (helpCard && helpCard.contains(e.target)) {
        return;
      }
    }
    
    const modalCard = e.target.closest('.modal-card');
    if (modalCard) {
      return;
    }
    
    const Core = getCore();
    if (!Core || !Core.canvas) return;
    e.preventDefault();
    const rect = Core.canvas.getBoundingClientRect();
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const current = Math.round(Core.zoom * 100);
    const step = e.ctrlKey ? 30 : 20;
    const dir = e.deltaY < 0 ? 1 : -1;
    const next = Math.max(40, current + dir * step);
    setZoomPct(next, anchor);
  }, { passive: false });
  
  // ============================================================
  // SHOW ELEMENTS DROPDOWN AS FLYOUT (FOR CONTEXT MENU)
  // ============================================================
  UI.showElementsDropdownAt = function(x, y) {
    const Core = getCore();
    hideContextMenu();
    
    const items = [];
    
    if (window.ElementPresets) {
      for (const [key, config] of Object.entries(window.ElementPresets)) {
        items.push({
          icon: config.icon || '📍',
          label: config.menuLabel || config.label,
          action: () => {
            const canvas = document.getElementById('board');
            const rect = canvas.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const world = Core.screenToWorld(cx, cy);
            const rc = Core.worldToRC(world.x, world.y);

            Core.pushUndo(true);
            Core.addPoint(Math.round(rc.r), Math.round(rc.c), config);
            
            if (window.UI && window.UI.Toast) {
              window.UI.Toast.success(`${config.label} added`);
            }
            Core.markDirty('items');
            if (window.Draw) window.Draw.render();
          }
        });
      }
    }
    
    showContextMenu(x, y, items);
  };

  // ============================================================
  // EXPORT UI OBJECT
  // ============================================================
  UI.Toast = Toast;
  UI.Shortcuts = Shortcuts;
  UI.showContextMenu = showContextMenu;
  UI.hideContextMenu = hideContextMenu;
  
  window.UI = UI;
})();

// ============================================================
// BUTTON HANDLERS - MapPlanner
// All UI button click handlers with fixes
// ============================================================

if (!window.UI) window.UI = { 
  Toast: { 
    success: console.log, 
    error: console.error, 
    warning: console.warn, 
    info: console.log 
  }, 
  updateLegend: ()=>{} 
};

(function(){
  function $(id) {
    return document.getElementById(id);
  }
  
  function getCore() {
    return window.Core;
  }
  
  const autoClose = () => {
    const menu = $('menu');
    const dtools = $('dtools');
    if(menu) menu.classList.remove('open');
    if(dtools) dtools.classList.remove('open');
  };

  window.autoClose = autoClose;

  // ============================================================
  // UNDO / REDO
  // ============================================================
  if($('undo')) {
    $('undo').onclick = () => {
      const Core = getCore();
      if(!Core.history.undo.length) {
        window.UI.Toast.warning('Nothing to undo');
        return;
      }
      
      const current = Core.history.createSnapshot();
      Core.history.redo.push({action: {type: 'snapshot', data: current}});
      
      const prev = Core.history.undo.pop();
      Core.restore(prev.action.data);
      
      window.UI.updateLegend();
      window.UI.Toast.success('Undo');
    };
  }

  if($('redo')) {
    $('redo').onclick = () => {
      const Core = getCore();
      if(!Core.history.redo.length) {
        window.UI.Toast.warning('Nothing to redo');
        return;
      }
      
      const current = Core.history.createSnapshot();
      Core.history.undo.push({action: {type: 'snapshot', data: current}});
      
      const next = Core.history.redo.pop();
      Core.restore(next.action.data);
      
      window.UI.updateLegend();
      window.UI.Toast.success('Redo');
    };
  }
 
  // ============================================================
  // ZOOM SLIDER
  // ============================================================
  (function(){
    const slider = document.getElementById('zoom-slider');
    const Core   = getCore();
    if (!slider || !Core) return;

    slider.addEventListener('input', e => {
      const pct = parseInt(e.target.value);
      const Core = getCore();
      const anchor = Core.getDrawingCenter();
      slider.max = String(Math.round(Core.getDynamicMaxZoom() * 100));
      setZoomPct(pct, anchor);
    });
  })();

  // ============================================================
  // ADD POINT BUTTON
  // ============================================================
  if($('add-point')) {
    $('add-point').onclick = () => {
      const Core = getCore();
      const canvas = $('board');
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const world = Core.screenToWorld(cx, cy);
      const rc = Core.worldToRC(world.x, world.y);
      const size = Core.SIZE.P;
      const centerR = Math.round(rc.r);
      const centerC = Math.round(rc.c);
      const startR = Math.max(0, Math.min(Core.GRID - size, centerR - Math.floor(size / 2)));
      const startC = Math.max(0, Math.min(Core.GRID - size, centerC - Math.floor(size / 2)));
      
      Core.pushUndo(true);
      Core.addPoint(startR, startC, {size: size, color: Core.FILL.P});
      window.UI.Toast.success('Point added');
      autoClose();
    };
  }

  // ============================================================
  // POINT EDIT MODAL
  // ============================================================
  let editingPointId = null;

  function toColor(v) {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = v;
    const s = ctx.fillStyle;
    if(/^#[0-9a-f]{6}$/i.test(s)) return s;
    if(/^rgb\(/i.test(s)) {
      const nums = s.replace(/rgb\(|\)/g, '').split(',').map(x => parseInt(x.trim(), 10));
      const hex = '#' + nums.map(n => n.toString(16).padStart(2, '0')).join('');
      return hex;
    }
    return '#ff66ff';
  }

  function openPointModal(it) {
    const Core = getCore();
    const canvas = $('board');
    
    editingPointId = it.id;
    $('pm-label').value = it.label || 'P';
    
    const wv = Number.isFinite(it.sizeW) ? it.sizeW : (Number.isFinite(it.size) ? it.size : Core.SIZE.P);
    const hv = Number.isFinite(it.sizeH) ? it.sizeH : (Number.isFinite(it.size) ? it.size : Core.SIZE.P);
    
    if($('pm-width')) $('pm-width').value = String(wv);
    if($('pm-height')) $('pm-height').value = String(hv);
    
    $('pm-area').value = String(Number.isFinite(it.area) ? it.area : 12);
    $('pm-color').value = toColor(it.color || '#ff66ff');
    $('pm-area-color').value = toColor(it.areaColor || it.color || '#ff66ff');
    $('pm-glow').checked = it.glow !== false;
    $('pm-alpha').value = Number.isFinite(it.areaAlpha) ? it.areaAlpha : 30;

    $('pm-fill-alpha').value = Number.isFinite(it.fillAlpha) ? it.fillAlpha : 100;
    $('pm-border-color').value = it.borderColor || '#000000';
    $('pm-border-alpha').value = Number.isFinite(it.borderAlpha) ? it.borderAlpha : 100;
    $('pm-border-width').value = Number.isFinite(it.borderWidth) ? it.borderWidth : 1;

    $('pm-area-border-color').value = it.areaBorderColor || (it.areaColor || '#ff66ff');
    $('pm-area-border-alpha').value = Number.isFinite(it.areaBorderAlpha) ? it.areaBorderAlpha : 100;
    $('pm-area-border-width').value = Number.isFinite(it.areaBorderWidth) ? it.areaBorderWidth : 2;
    
    $('point-modal').classList.add('show');
    $('point-modal').setAttribute('aria-hidden', 'false');
    canvas.style.pointerEvents = 'none';
  }
  
  window.openPointModal = openPointModal;

  function closePointModal() {
    const canvas = $('board');
    $('point-modal').classList.remove('show');
    $('point-modal').setAttribute('aria-hidden', 'true');
    canvas.style.pointerEvents = 'auto';
    editingPointId = null;
  }

  if($('pm-cancel')) {
    $('pm-cancel').addEventListener('click', closePointModal);
  }
  
  if($('point-modal-backdrop')) {
    $('point-modal-backdrop').addEventListener('click', closePointModal);
  }

  if($('pm-save')) {
    $('pm-save').addEventListener('click', () => {
      if(editingPointId == null) return;
      
      const Core = getCore();
      const it = Core.items.find(x => x.id === editingPointId);
      if(!it) return;
      
      Core.pushUndo(true);
      it.label = $('pm-label').value || 'P';
      
      if(it.type === Core.TYPES.P) {
        const oldW = Number.isFinite(it.sizeW) ? it.sizeW : (Number.isFinite(it.size) ? it.size : Core.SIZE.P);
        const oldH = Number.isFinite(it.sizeH) ? it.sizeH : (Number.isFinite(it.size) ? it.size : Core.SIZE.P);
        const newW = Math.max(1, Math.min(Core.GRID, parseInt($('pm-width').value) || oldW));
        const newH = Math.max(1, Math.min(Core.GRID, parseInt($('pm-height').value) || oldH));
        const dW = newW - oldW, dH = newH - oldH;
        
        it.row = Math.max(0, Math.min(Core.GRID - newH, it.row - Math.floor(dH / 2)));
        it.col = Math.max(0, Math.min(Core.GRID - newW, it.col - Math.floor(dW / 2)));
        it.sizeW = newW;
        it.sizeH = newH;
        
        if($('pm-image-file').files && $('pm-image-file').files[0]) {
          if(it.image && it.image.startsWith('blob:')) {
            URL.revokeObjectURL(it.image);
          }
          it.image = URL.createObjectURL($('pm-image-file').files[0]);
        }
      }
      
      it.area = Math.max(0, Math.min(Core.GRID, parseInt($('pm-area').value) || 12));
      it.color = $('pm-color').value || it.color;
      it.areaColor = $('pm-area-color').value || it.areaColor || it.color;
      it.glow = !!$('pm-glow').checked;

      let areaAlphaVal = parseInt($('pm-alpha').value);
      it.areaAlpha = isNaN(areaAlphaVal) ? 30 : Math.max(0, Math.min(100, areaAlphaVal));

      let fillVal = parseInt($('pm-fill-alpha').value);
      it.fillAlpha = isNaN(fillVal) ? 100 : Math.max(0, Math.min(100, fillVal));

      it.borderColor = $('pm-border-color').value || '#000000';

      let borderVal = parseInt($('pm-border-alpha').value);
      it.borderAlpha = isNaN(borderVal) ? 100 : Math.max(0, Math.min(100, borderVal));

      let borderW = parseInt($('pm-border-width').value);
      it.borderWidth = isNaN(borderW) ? 1 : Math.max(1, Math.min(10, borderW));

      it.areaBorderColor = $('pm-area-border-color').value || (it.areaColor || '#ff66ff');

      let areaBorderAlphaVal = parseInt($('pm-area-border-alpha').value);
      it.areaBorderAlpha = isNaN(areaBorderAlphaVal) ? 100 : Math.max(0, Math.min(100, areaBorderAlphaVal));

      let areaBorderW = parseInt($('pm-area-border-width').value);
      it.areaBorderWidth = isNaN(areaBorderW) ? 2 : Math.max(1, Math.min(10, areaBorderW));
      
      Core.markDirty('items');
      window.Draw.render();
      window.UI.updateLegend();
      window.UI.Toast.success('Point updated');
      closePointModal();
    });
  }

  // ============================================================
  // SLIDER LABEL BINDINGS
  // ============================================================
  function bindSliderWithLabel(sliderId, labelId) {
    const slider = document.getElementById(sliderId);
    const label = document.getElementById(labelId);
    if (slider && label) {
      slider.addEventListener('input', () => {
        label.textContent = slider.value + '%';
      });
      label.textContent = slider.value + '%';
    }
  }

  bindSliderWithLabel('pm-fill-alpha', 'pm-fill-alpha-val');
  bindSliderWithLabel('pm-border-alpha', 'pm-border-alpha-val');
  bindSliderWithLabel('pm-alpha', 'pm-alpha-val');
  bindSliderWithLabel('pm-area-border-alpha', 'pm-area-border-alpha-val');

  // ============================================================
  // EDIT POINT BUTTON
  // ============================================================
  if($('edit-point')) {
    $('edit-point').onclick = () => {
      const Core = getCore();
      if(!Core.selected.size) {
        window.UI.Toast.warning('Select a point first');
        autoClose();
        return;
      }
      
      const ids = Array.from(Core.selected);
      const pts = ids.map(id => Core.items.find(x => x.id === id)).filter(it => it && it.type === Core.TYPES.P);
      
      if(pts.length === 1) {
        openPointModal(pts[0]);
      } else if(pts.length === 0) {
        window.UI.Toast.warning('No points selected');
      } else {
        window.UI.Toast.warning('Select exactly one point to edit');
      }
      autoClose();
    };
  }

  // ============================================================
  // TOGGLE LOCK BUTTON
  // ============================================================
  if($('toggle-lock')) {
    $('toggle-lock').onclick = () => {
      const Core = getCore();
      if(!Core.selected.size) {
        window.UI.Toast.warning('Select points first');
        autoClose();
        return;
      }
      
      Core.pushUndo(true);
      const ids = Array.from(Core.selected);
      let count = 0;
      
      ids.forEach(id => {
        const it = Core.items.find(x => x.id === id);
        if(it && it.type === Core.TYPES.P) {
          it.locked = !it.locked;
          count++;
        }
      });
      
      Core.markDirty('items');
      window.Draw.render();
      
      if(count > 0) {
        window.UI.Toast.success(`Toggled lock on ${count} point${count > 1 ? 's' : ''}`);
      } else {
        window.UI.Toast.warning('No points selected');
      }
      autoClose();
    };
  }

  // ============================================================
  // LIGHTS TOGGLE (X/Y SWITCH)
  // ============================================================
  if($('lights')) {
    $('lights').onclick = () => {
      const Core = getCore();
      if(!Core.selected.size) {
        window.UI.Toast.warning('Select blocks first');
        autoClose();
        return;
      }
      
      Core.pushUndo(true);
      let count = 0;
      
      for(const id of Core.selected) {
        const it = Core.items.find(x => x.id === id);
        if(it && (it.type === Core.TYPES.X || it.type === Core.TYPES.Y)) {
          it.type = (it.type === Core.TYPES.X) ? Core.TYPES.Y : Core.TYPES.X;
          count++;
        }
      }
      
      Core.markDirty('items');
      window.Draw.render();
      window.UI.updateLegend();
      
      if(count > 0) {
        window.UI.Toast.success(`Toggled ${count} block${count > 1 ? 's' : ''}`);
      } else {
        window.UI.Toast.warning('No X or Y blocks selected');
      }
      autoClose();
    };
  }

  // ============================================================
  // DELETE SELECTED
  // ============================================================
  if($('delete-selected')) {
    $('delete-selected').onclick = () => {
      const Core = getCore();
      if(!Core.selected.size) {
        window.UI.Toast.warning('Nothing selected');
        autoClose();
        return;
      }
      
      const count = Core.selected.size;
      Core.pushUndo(true);
      Core.items = Core.items.filter(i => !Core.selected.has(i.id));
      Core.selected.clear();
      
      Core.markDirty('items');
      window.Draw.render();
      window.UI.updateLegend();
      window.UI.Toast.success(`Deleted ${count} item${count > 1 ? 's' : ''}`);
      autoClose();
    };
  }

  // ============================================================
  // COPY/PASTE
  // ============================================================
  if($('copy-selected')) {
    $('copy-selected').onclick = () => {
      const Core = getCore();
      if(!Core.selected.size) {
        window.UI.Toast.warning('Nothing selected');
        return;
      }
      
      Core.clipboard = Array.from(Core.selected).map(id => {
        const it = Core.items.find(x => x.id === id);
        if(it) return JSON.parse(JSON.stringify(it));
        return null;
      }).filter(Boolean);
      
      window.UI.Toast.success(`Copied ${Core.clipboard.length} item${Core.clipboard.length > 1 ? 's' : ''}`);
      autoClose();
    };
  }

  if($('paste-selected')) {
    $('paste-selected').onclick = () => {
      const Core = getCore();
      if(!Core.clipboard.length) {
        window.UI.Toast.warning('Clipboard is empty');
        return;
      }
      
      Core.pushUndo(true);
      Core.selected.clear();
      const offset = 2;
      let count = 0;
      
      Core.clipboard.forEach(base => {
        const newItem = {...base, id: Core.idSeq++};
        const size = Number.isFinite(newItem.size) ? newItem.size : Core.SIZE[newItem.type];
        newItem.row = Math.min(Core.GRID - size, Math.max(0, base.row + offset));
        newItem.col = Math.min(Core.GRID - size, Math.max(0, base.col + offset));
        Core.items.push(newItem);
        Core.selected.add(newItem.id);
        count++;
      });
      
      Core.markDirty('items');
      window.Draw.render();
      window.UI.updateLegend();
      window.UI.Toast.success(`Pasted ${count} item${count > 1 ? 's' : ''}`);
      autoClose();
    };
  }

  // ============================================================
  // DESELECT
  // ============================================================
  if($('deselect')) {
    $('deselect').onclick = () => {
      const Core = getCore();
      Core.selected.clear();
      Core.markDirty('selection');
      window.Draw.render();
      autoClose();
    };
  }

  // ============================================================
  // SELECT ALL
  // ============================================================
  if($('select-all-btn')) {
    $('select-all-btn').onclick = () => {
      const Core = getCore();
      Core.selected.clear();
      for(const it of Core.items) {
        Core.selected.add(it.id);
      }
      Core.markDirty('selection');
      window.Draw.render();
      window.UI.Toast.info(`Selected ${Core.items.length} items`);
      autoClose();
    };
  }

  // ============================================================
  // ALIGNMENT FUNCTIONS
  // ============================================================
  function getAlignTargets() {
    const Core = getCore();
    const allX = Core.items.filter(i => i.type === Core.TYPES.X);
    if(Core.selected.size) {
      const sel = allX.filter(i => Core.selected.has(i.id));
      if(sel.length) return sel;
    }
    return allX;
  }

  function align(n, vertical, gapTiles) {
    const Core = getCore();
    Core.pushUndo(true);
    const targets = getAlignTargets().slice()
      .sort((a, b) => a.row - b.row || a.col - b.col || a.id - b.id);
    
    if(!targets.length) {
      window.UI.Toast.warning('No X blocks to align');
      autoClose();
      return;
    }
    
    const step = Core.SIZE.X + Math.max(0, gapTiles | 0);
    const minR = targets.reduce((m, i) => Math.min(m, i.row), Infinity);
    const minC = targets.reduce((m, i) => Math.min(m, i.col), Infinity);
    let r = minR, c = minC, count = 0;
    
    for(const x of targets) {
      x.row = r;
      x.col = c;
      count++;
      if(vertical) {
        r += step;
        if(count % n === 0) {
          r = minR;
          c += step;
        }
      } else {
        c += step;
        if(count % n === 0) {
          c = minC;
          r += step;
        }
      }
    }
    
    Core.markDirty('items');
    window.Draw.render();
    window.UI.Toast.success(`Aligned ${targets.length} blocks`);
    autoClose();
  }

  if($('align-h')) {
    $('align-h').onclick = () => {
      const n = Math.max(1, Math.min(getCore().GRID, parseInt($('align-n').value) || 1));
      const gap = Math.max(0, Math.min(20, parseInt($('align-gap').value) || 0));
      align(n, false, gap);
    };
  }

  if($('align-v')) {
    $('align-v').onclick = () => {
      const n = Math.max(1, Math.min(getCore().GRID, parseInt($('align-n').value) || 1));
      const gap = Math.max(0, Math.min(20, parseInt($('align-gap').value) || 0));
      align(n, true, gap);
    };
  }
  
  // ============================================================
  // CLEAR ALL
  // ============================================================
  if($('clear')) {
    $('clear').onclick = () => {
      if(!confirm("Clear all X/Y/P and reset view? This cannot be undone.")) {
        return;
      }
      
      const Core = getCore();
      Core.pushUndo(true);
      Core.items = [];
      Core.selected.clear();
      Core._initView = false;
      
      Core.markDirty('items');
      Core.markDirty('view');
      Core.resizeCanvas();
      window.Draw.render();
      window.UI.updateLegend();
      window.UI.Toast.success('Cleared all items');
      autoClose();
    };
  }

  // ============================================================
  // GRID SIZE APPLY (FIXED)
  // ============================================================
  if ($('apply-grid')) {
    $('apply-grid').onclick = () => {
      const Core = getCore();
      const val = parseInt($('grid-size').value, 10);

      if (isNaN(val) || val < 20 || val > 2000) {
        window.UI.Toast.error('Grid size must be between 20 and 2000');
        return;
      }

      Core.setGridSize(val, { scale: false });

      const slider = document.getElementById('zoom-slider');
      if (slider && Core.getDynamicMaxZoom) {
        slider.max = String(Math.round(Core.getDynamicMaxZoom() * 100));
      }

      const rect = Core.canvas.getBoundingClientRect();
      const anchor = { x: rect.width / 2, y: rect.height / 2 };
      window.setZoomPct(Math.round(Core.zoom * 100), anchor);

      window.Draw.render();
      window.UI.Toast.success(`Grid size set to ${val}`);
      autoClose();
    };
  }

  // ============================================================
  // FIT VIEW
  // ============================================================
  if($('fit-view')) {
    $('fit-view').onclick = () => {
      getCore().fitView();
      window.UI.Toast.info('Fit to view');
    };
  }

  // ============================================================
  // SAVE/LOAD JSON
  // ============================================================
  if($('save-json')) {
    $('save-json').onclick = () => {
      const Core = getCore();
      const data = {
        items: Core.items,
        idSeq: Core.idSeq,
        legendLabels: Core.legendLabels,
        gridSize: Core.GRID
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `map-plan-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      
      window.UI.Toast.success('Plan saved');
      autoClose();
    };
  }

  if($('load-json')) {
    $('load-json').onclick = () => {
      $('json-file').click();
      autoClose();
    };
  }

  if($('json-file')) {
    $('json-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if(!f) return;
      
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          
          if(!Array.isArray(d.items)) {
            throw new Error('Invalid format: items must be an array');
          }
          
          const Core = getCore();
          
          if(Number.isFinite(d.gridSize)) {
            Core.setGridSize(d.gridSize, {scale: false});
          }
          
          Core.items = d.items;
          Core.items.forEach(it => {
            if(it.type === Core.TYPES.P && typeof it.locked !== 'boolean') {
              it.locked = false;
            }
          });
          
          Core.idSeq = Number.isFinite(d.idSeq) ? d.idSeq : 1;
          Core.legendLabels = d.legendLabels || {};
          
          Core.markDirty('items');
          Core.markDirty('legend');
          window.Draw.render();
          window.UI.updateLegend();
          Core.fitView();
          
          window.UI.Toast.success('Plan loaded successfully');
        } catch(err) {
          window.UI.Toast.error(`Failed to load: ${err.message}`);
          console.error('Load error:', err);
        }
      };
      
      r.onerror = () => {
        window.UI.Toast.error('Failed to read file');
      };
      
      r.readAsText(f);
      e.target.value = '';
    });
  }

// ============================================================
// EXPORT PNG
// ============================================================
if($('export-png')) {
  $('export-png').onclick = () => {
    const Core = getCore();
    const legendColors = window.UI.usedColors();
    const legendLabels = legendColors.map(c => ({
      color: c,
      label: Core.legendLabels[c] || c
    }));

    const rowH = 28;  // Increased for better spacing
    const pad = 20;
    const headerH = legendLabels.length ? 30 : 0;
    const legendHeight = legendLabels.length ? (headerH + legendLabels.length * rowH + pad) : 0;

    // Get the canvas display size (CSS pixels)
    const rect = Core.canvas.getBoundingClientRect();
    const displayWidth = Math.round(rect.width);
    const displayHeight = Math.round(rect.height);
    
    const out = document.createElement('canvas');
    out.width = displayWidth;
    out.height = displayHeight + legendHeight;
    const ctx = out.getContext('2d');

    // Fill background
    ctx.fillStyle = '#2a2f45';
    ctx.fillRect(0, 0, out.width, out.height);
    
    // Save Core context and temporarily replace it
    const tempCtx = Core.ctx;
    const tempCanvas = Core.canvas;
    const tempDpr = Core.dpr;
    
    // Create temporary canvas for rendering
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = displayWidth;
    renderCanvas.height = displayHeight;
    const renderCtx = renderCanvas.getContext('2d');
    
    Core.ctx = renderCtx;
    Core.dpr = 1; // Use 1:1 pixel ratio for export
    
    // Clear and setup transform
    renderCtx.clearRect(0, 0, renderCanvas.width, renderCanvas.height);
    renderCtx.setTransform(
      Core.zoom, 0, 0, 
      Core.zoom, 
      Core.pan.x, 
      Core.pan.y
    );
    
    // Draw grid
    const s = Core.cell();
    const GRID = Core.GRID;
    const gridWorldSize = GRID * s;
    
    renderCtx.fillStyle = '#2a2f45';
    renderCtx.fillRect(0, 0, gridWorldSize, gridWorldSize);
    
    renderCtx.strokeStyle = '#404a78';
    renderCtx.lineWidth = 1 / Core.zoom;
    
    const viewX1 = -Core.pan.x / Core.zoom;
    const viewY1 = -Core.pan.y / Core.zoom;
    const viewX2 = viewX1 + (displayWidth / Core.zoom);
    const viewY2 = viewY1 + (displayHeight / Core.zoom);
    
    const startRow = Math.max(0, Math.floor(viewY1 / s));
    const endRow = Math.min(GRID, Math.ceil(viewY2 / s));
    const startCol = Math.max(0, Math.floor(viewX1 / s));
    const endCol = Math.min(GRID, Math.ceil(viewX2 / s));
    
    renderCtx.beginPath();
    for(let i = startRow; i <= endRow; i++) {
      const p = i * s;
      renderCtx.moveTo(0, p);
      renderCtx.lineTo(gridWorldSize, p);
    }
    for(let i = startCol; i <= endCol; i++) {
      const p = i * s;
      renderCtx.moveTo(p, 0);
      renderCtx.lineTo(p, gridWorldSize);
    }
    renderCtx.stroke();
    
    // Draw items (without images to avoid CORS)
    const TYPES = Core.TYPES;
    const FILL = Core.FILL;
    const BORDER = Core.BORDER;
    const BORDER_SEL = Core.BORDER_SEL;
    
    for(const it of Core.items) {
      const sz = Core.getSize(it);
      const w = (it.sizeW || sz) * s;
      const h = (it.sizeH || sz) * s;
      const x = it.col * s;
      const y = it.row * s;
      
      if(x + w < viewX1 || x > viewX2 || y + h < viewY1 || y > viewY2) continue;
      
      // Draw area glow for P types
      if(it.type === TYPES.P && it.glow && it.area > 0) {
        const sizeW = it.sizeW || sz;
        const sizeH = it.sizeH || sz;
        const r0 = it.row - it.area;
        const c0 = it.col - it.area;
        const r1 = it.row + sizeH + it.area;
        const c1 = it.col + sizeW + it.area;
        const areaColor = it.areaColor || it.color || FILL.P;
        const alpha = (Number.isFinite(it.areaAlpha) ? it.areaAlpha : 22) / 100;
        
        renderCtx.save();
        renderCtx.fillStyle = areaColor;
        renderCtx.globalAlpha = alpha;
        renderCtx.fillRect(c0 * s, r0 * s, (c1 - c0) * s, (r1 - r0) * s);
        renderCtx.restore();
        
        const aBorderAlpha = (Number.isFinite(it.areaBorderAlpha) ? it.areaBorderAlpha : 100) / 100;
        renderCtx.strokeStyle = hexToRgba(it.areaBorderColor || areaColor, aBorderAlpha);
        renderCtx.lineWidth = (Number.isFinite(it.areaBorderWidth) ? it.areaBorderWidth : 2) / Core.zoom;
        renderCtx.strokeRect(c0 * s, r0 * s, (c1 - c0) * s, (r1 - r0) * s);
      }
      
      // Draw Y ambient light
      if(it.type === TYPES.Y) {
        const half = Math.floor(sz / 2);
        const centerR = it.row + half;
        const centerC = it.col + half;
        const r0 = centerR - 11, c0 = centerC - 11;
        const r1 = centerR + 12, c1 = centerC + 12;
        const xx = c0 * s, yy = r0 * s;
        const ww = (c1 - c0) * s, hh = (r1 - r0) * s;
        
        renderCtx.save();
        renderCtx.globalAlpha = 0.18;
        renderCtx.fillStyle = 'rgba(255,216,74,0.18)';
        renderCtx.fillRect(xx, yy, ww, hh);
        renderCtx.restore();
        
        renderCtx.strokeStyle = 'rgba(249,228,106,0.9)';
        renderCtx.lineWidth = 2 / Core.zoom;
        renderCtx.strokeRect(xx, yy, ww, hh);
      }
      
      // Draw main fill
      if(it.type === TYPES.P) {
        const fillAlpha = (Number.isFinite(it.fillAlpha) ? it.fillAlpha : 100) / 100;
        if(fillAlpha > 0) {
          renderCtx.save();
          renderCtx.globalAlpha = fillAlpha;
          renderCtx.fillStyle = it.areaColor || it.color || FILL.P;
          renderCtx.fillRect(x, y, w, h);
          renderCtx.restore();
        }
        
        const borderAlpha = (Number.isFinite(it.borderAlpha) ? it.borderAlpha : 100) / 100;
        if(borderAlpha > 0.001) {
          renderCtx.save();
          renderCtx.globalAlpha = borderAlpha;
          renderCtx.strokeStyle = it.borderColor || it.color || '#000000';
          const bw = (Number.isFinite(it.borderWidth) ? it.borderWidth : 1.5);
          renderCtx.lineWidth = bw / Core.zoom;
          const offset = bw / (2 * Core.zoom);
          renderCtx.strokeRect(x + offset, y + offset, w - bw / Core.zoom, h - bw / Core.zoom);
          renderCtx.restore();
        }
        renderCtx.globalAlpha = 1;
      } else {
        renderCtx.fillStyle = it.color || FILL[it.type] || '#888';
        renderCtx.fillRect(x, y, w, h);
      }
      
      // Draw border
      const isSelected = Core.selected.has(it.id);
      renderCtx.lineWidth = (isSelected ? 2 : 1) / Core.zoom;
      renderCtx.strokeStyle = isSelected ? BORDER_SEL : BORDER;
      renderCtx.strokeRect(x, y, w, h);
      
      // Draw labels
      if(Core.zoom > 0.3) {
        renderCtx.fillStyle = '#fff';
        renderCtx.textAlign = 'center';
        renderCtx.textBaseline = 'middle';
        
        if(it.type === TYPES.P) {
          renderCtx.font = `${s * 1.4}px sans-serif`;
          renderCtx.fillText(it.label || 'P', x + w / 2, y + h / 2);
          if(it.locked) {
            renderCtx.font = `${s * 1.0}px sans-serif`;
            renderCtx.fillText('🔒', x + w / 2, y + h - s * 0.7);
          }
        } else {
          renderCtx.font = `${s * 1.5}px sans-serif`;
          renderCtx.fillText(it.order || '', x + w / 2, y + h / 2);
        }
      }
    }
    
    // Restore original context
    Core.ctx = tempCtx;
    Core.dpr = tempDpr;
    
    // Copy rendered canvas to output
    ctx.drawImage(renderCanvas, 0, 0);
    
    // Draw legend with proper spacing
    if(legendLabels.length) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
      const y0 = displayHeight;
      
      // Legend background
      ctx.fillStyle = '#171c39';
      ctx.fillRect(0, y0, out.width, legendHeight);
      
      // Legend title
      ctx.font = 'bold 18px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#fff';
      ctx.fillText('Legend', 15, y0 + 8);
      
      // Legend items
      ctx.font = '14px sans-serif';
      ctx.textBaseline = 'middle';
      
      legendLabels.forEach((row, i) => {
        const y = y0 + headerH + (i * rowH) + (rowH / 2);
        
        // Color swatch
        ctx.fillStyle = row.color;
        ctx.fillRect(15, y - 10, 20, 20);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(15, y - 10, 20, 20);
        
        // Label text
        ctx.fillStyle = '#fff';
        ctx.fillText(row.label, 45, y);
      });
    }

    // Export
    const dataURL = out.toDataURL('image/png');
    const a = document.createElement('a');
    a.download = `map-snapshot-${Date.now()}.png`;
    a.href = dataURL;
    a.click();
    
    window.UI.Toast.info('PNG exported (without background images)');
    autoClose();
  };
}
  // ============================================================
  // MODE SWITCHING (FIXED)
  // ============================================================
  window.setMode = function(mode) {
    const Core = getCore();
    if (!Core) return;
    
    const allowed = ['draw', 'select', 'view'];
    if (!allowed.includes(mode)) return;
    
    Core.mode = mode;
    Core.selectionMode = (mode === 'select');
    
    const buttons = [
      ['mode-draw', 'draw'],
      ['mode-select', 'select'],
      ['mode-view', 'view']
    ];
    
    buttons.forEach(([id, m]) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', m === mode);
    });
    
    if (window.UI && window.UI.Toast) {
      window.UI.Toast.info(mode.charAt(0).toUpperCase() + mode.slice(1) + ' mode');
    }
    
    Core.markDirty('view');
    if (window.Draw) window.Draw.render();
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('mode-draw')?.addEventListener('click', () => setMode('draw'));
    document.getElementById('mode-select')?.addEventListener('click', () => setMode('select'));
    document.getElementById('mode-view')?.addEventListener('click', () => setMode('view'));
  });
  
  window.UI = Object.assign(window.UI || {}, UI);

})();
