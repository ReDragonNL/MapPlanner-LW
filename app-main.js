// ============================================================
// APP BOOTSTRAP - MapPlanner
// Initializes the application and sets up event listeners
// ============================================================

(function(){
  if (window.__appBooted) return;
  window.__appBooted = true;

  document.addEventListener('DOMContentLoaded', () => {
    // ============================================================
    // FORCE INITIAL RESIZE & RENDER
    // ============================================================
    if (window.Core) {
      window.Core.markDirty('items');
      window.Core.markDirty('view');
      window.Core.markDirty('legend');
      window.Core.resizeCanvas();
      
      window.addEventListener('resize', window.Core.resizeCanvas);
      window.addEventListener('orientationchange', window.Core.resizeCanvas);
      
      if (window.Draw && window.Draw.renderImmediate) {
        window.Draw.renderImmediate();
      }
      
      if (window.Core.fitView) {
        window.Core.fitView();
      }
    }
    
    // ============================================================
    // SET DEFAULT MODE
    // ============================================================
    if (window.setMode) {
      window.setMode(window.Core?.mode || 'draw');
    }
    
    console.log('MapPlanner initialized successfully');
  });
})();