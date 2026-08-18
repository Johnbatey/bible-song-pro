    (function enableObsIsolatedControlPanel() {
      const OBS_ISOLATED_MODE = (typeof isObsMode === 'function') ? isObsMode() : true;
      if (!OBS_ISOLATED_MODE) return;

      function run() {
        document.body.classList.add('obs-isolated');

        // Keep only Sidebar/Song/Bible/Setlist + Settings buttons in the activity bar.
        const allowedActivityIds = new Set(['ab-sidebar-toggle', 'ab-song', 'ab-bible', 'ab-schedule', 'ab-settings']);
        document.querySelectorAll('#activity-bar .ab-btn').forEach((btn) => {
          if (!allowedActivityIds.has(btn.id)) btn.style.display = 'none';
        });

        // Projection page only in OBS dock workflow.
        try {
          if (typeof switchAppPage === 'function') switchAppPage('projection');
        } catch (_) {}

        // Force supported startup tab only.
        let startupTab = 'bible';
        try {
          const saved = String(localStorage.getItem('activeWorkspaceTab') || '').toLowerCase();
          if (saved === 'song' || saved === 'songs') startupTab = 'songs';
          else if (saved === 'schedule' || saved === 'setlist') startupTab = 'schedule';
          else if (saved === 'media') startupTab = 'media';
        } catch (_) {}

        if (typeof setSidebarTab === 'function') setSidebarTab(startupTab);
        if (typeof updateBottomNavSidebarButtons === 'function') updateBottomNavSidebarButtons(startupTab);
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
      } else {
        run();
      }
    })();
