// ============================================================
// ELEMENT MENU AUTO-GENERATOR
// Automatically builds menus from elements-config.js
// ============================================================
(function(){
  
  function init() {
    if (!window.ElementPresets) {
      console.error('ElementPresets not loaded! Make sure elements-config.js is loaded first.');
      return;
    }
    
    buildDropdownMenu();
    console.log('Element menus auto-generated from config!');
  }
  
  function buildDropdownMenu() {
    const dropdown = document.getElementById('points-dropdown');
    if (!dropdown) {
      console.warn('Dropdown menu not found');
      return;
    }
    
    dropdown.innerHTML = '';
    
    for (const [key, config] of Object.entries(window.ElementPresets)) {
      const btn = document.createElement('button');
      btn.setAttribute('data-preset', key);
      btn.textContent = (config.icon ? config.icon + ' ' : '') + (config.menuLabel || config.label);
      dropdown.appendChild(btn);
    }
  }
  
  window.getElementMenuItems = function() {
    if (!window.ElementPresets) return [];
    
    const items = [];
    
    for (const [key, config] of Object.entries(window.ElementPresets)) {
      items.push({
        icon: config.icon || '📍',
        label: config.menuLabel || config.label,
        action: () => {
          if (window.addPresetElementFromMenu) {
            window.addPresetElementFromMenu(key);
          }
        }
      });
    }
    
    return items;
  };
  
  // ============================================================
  // AUTO-PRELOAD IMAGES FROM CONFIG
  // ============================================================
  function preloadConfigImages() {
    if (!window.ElementPresets) return;
    
    console.log('Preloading element images from config...');
    
    for (const [key, config] of Object.entries(window.ElementPresets)) {
      if (config.image) {
        const img = new Image();
        img.onload = () => {
          console.log(`✓ Preloaded: ${config.label} (${config.image})`);
        };
        img.onerror = () => {
          console.warn(`✗ Failed to preload: ${config.label} (${config.image})`);
        };
        img.src = config.image;
      }
    }
  }
  
  // Initialize everything (SINGLE init call)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      preloadConfigImages();
    });
  } else {
    init();
    preloadConfigImages();
  }
  
})();