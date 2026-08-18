    function switchAppPage(page) {
      const allowedPages = new Set(['projection']);
      if (!allowedPages.has(page)) page = 'projection';
      if (page === currentAppPage) return;
      const prevPage = currentAppPage;
      currentAppPage = page;
      const keepMountedPair = _isProjectionLivePair(prevPage, page);
      const prevEl = document.getElementById('page-' + prevPage);

      // Clear any prior keep-mounted overrides before applying fresh page classes.
      _resetKeepMountedPageStyle(document.getElementById('page-projection'));

      document.querySelectorAll('.page-nav-btn[data-page]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
      });
      // Show/hide page content containers
      document.querySelectorAll('.app-page').forEach(p => {
        p.classList.toggle('active', p.id === 'page-' + page);
      });
      if (keepMountedPair && prevEl) {
        _keepPageMountedHidden(prevEl);
      }
      if (page === 'projection') {
        requestAnimationFrame(() => {
          updateEmbeddedProgramDisplayScale();
        });
      }
    }

    function updateBottomNavSidebarButtons(tab) {
      document.querySelectorAll('#page-nav-bar .page-nav-btn[data-side-tab]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.sideTab === tab);
      });
    }

    function switchBottomNavSidebarTab(tab) {
      setSidebarTab(tab);
      updateBottomNavSidebarButtons(tab);
    }


    function setDockSceneTab(tabId) {
      activeWorkspaceTab = tabId;
      saveWorkspaceTabPreference(tabId);
      if (tabId === 'song') {
        updateDockSceneTabUi('song');
        setSidebarTab('songs');
        return;
      }
      if (tabId === 'bible') {
        updateDockSceneTabUi('bible');
        setSidebarTab('bible');
        return;
      }
      if (tabId === 'schedule') {
        setSidebarTab('schedule');
        updateActivityBarUi('schedule');
        return;
      }
      updateDockSceneTabUi('bible');
      setSidebarTab('bible');
    }

    function setSidebarTab(tab) {
      const prevTab = sidebarTab;
      saveProjectionSettingsProfileForTab(getEffectiveSettingsTargetTab());
      const useFocusedWorkspaceControls = isFocusedWorkspaceMode();
      if (useFocusedWorkspaceControls && FOCUSED_WORKSPACE_TABS.includes(prevTab)) {
        saveFocusedWorkspaceControlsForTab(prevTab);
      }
      activeWorkspaceTab = (tab === 'songs') ? 'song' : ((tab === 'schedule') ? 'schedule' : ((tab === 'media') ? 'media' : 'bible'));
      saveWorkspaceTabPreference(activeWorkspaceTab);
      document.body.dataset.sidebarTab = tab;
      if (tab === 'songs') updateDockSceneTabUi('song');
      if (tab === 'bible') updateDockSceneTabUi('bible');
      if (tab === 'schedule') updateActivityBarUi('schedule');
      if (tab === 'media') updateActivityBarUi(activeWorkspaceTab || 'media');
      if (prevTab === 'bible') {
        lastBibleWorkspaceSelection = captureCurrentBibleSelection();
      } else if (prevTab === 'songs') {
        lastSongWorkspaceSelection = captureCurrentSongSelection();
      }
      // save outgoing tab's sidebar height before switching
      if (window._saveSidebarTabHeight) window._saveSidebarTabHeight(prevTab);
      sidebarTab = tab;
      buttonContextTab = tab;
      if (typeof updateWorkspaceStateLabels === 'function') updateWorkspaceStateLabels(tab);
      scheduleSidebarQuickActionsRender({ immediate: sidebarQuickActionsOpen, forceRender: sidebarQuickActionsOpen });
      if (normalizeSettingsTargetTab(settingsTargetTab) === 'follow' && typeof setMediaSettingsTargetActive === 'function') {
        setMediaSettingsTargetActive(tab === 'media');
      }
      if (tab !== 'media' && normalizeSettingsTargetTab(settingsTargetTab) === 'follow') {
        applyProjectionSettingsProfileForTab(tab, { triggerChange: false });
        updateSettingsTargetControl();
      }
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));
      updateBottomNavSidebarButtons(tab);
      const bNav = document.getElementById('bible-nav');
      const vBar = document.getElementById('version-bar');
      const bibleVersionBtn = document.getElementById('footer-bible-version-btn');
      const getLyricsBtn = document.getElementById('main-get-lyrics-btn');
      let pendingBibleSelection = null;
      if (useFocusedWorkspaceControls) {
        applyFocusedWorkspaceControlsForTab(tab, { render: false });
      }
      if (tab === 'schedule') {
        if (prevTab === 'bible') {
          lastBibleSelectionBeforeSchedule = captureCurrentBibleSelection();
        }
        scheduleReturnTarget = null;
      }
      if (tab === 'bible') {
        if (!activeBibleVersion && Object.keys(bibles).length > 0) {
          activeBibleVersion = Object.keys(bibles)[0];
        }
        if (prevTab === 'schedule') {
          pendingBibleSelection = (scheduleReturnTarget && scheduleReturnTarget.kind === 'bible')
            ? scheduleReturnTarget
            : lastBibleSelectionBeforeSchedule;
          if (scheduleReturnTarget && scheduleReturnTarget.kind === 'bible') {
            scheduleReturnTarget = null;
          }
          if (pendingBibleSelection && pendingBibleSelection.version) {
            activeBibleVersion = pendingBibleSelection.version;
          }
        }
        const bgToggle = document.getElementById('bg-toggle');
        if (prevTab === 'songs' && activeRatio === '16-9' && bgToggle && !bgToggle.checked) {
          delayBibleBgUntilVerse = true;
        }
      }
      const keepLiveDisplay = isLive && livePointer;
      if (tab === 'bible') {
        bNav.style.display = 'flex';
        vBar.style.display = 'flex';
        if (bibleVersionBtn) bibleVersionBtn.style.display = '';
        if (getLyricsBtn) getLyricsBtn.style.display = 'none';
        if (!keepLiveDisplay) {
          const keepLiveSongProjection = isLive && livePointer && livePointer.kind === 'songs';
          if (!useFocusedWorkspaceControls) {
            setLines(1, { silent: keepLiveSongProjection });
          }
        }
        updateBibleLists();
      } else {
        bNav.style.display = 'none';
        vBar.style.display = 'none';
        if (bibleVersionBtn) bibleVersionBtn.style.display = 'none';
        if (getLyricsBtn) getLyricsBtn.style.display = (tab === 'songs') ? '' : 'none';
        toggleFooterBibleVersionPopover(false);
      }
      enforceBibleModeRules();
      updateSearchPlaceholder();
      if (tab === 'media') {
        if (window._restoreSidebarTabHeight) window._restoreSidebarTabHeight();
        positionSidebarQuickActions();
        refreshWorkspaceLayoutUi();
        if (typeof window.bspMediaTabActivated === 'function') window.bspMediaTabActivated();
        saveToStorageDebounced();
        return;
      }
      renderVersionBar();
      if (tab !== 'media') renderSongs();
      let restoredButtonState = false;
      const restoredFocusedSelection = isFocusedWorkspaceMode()
        ? restoreWorkspaceSelectionForTab(tab, pendingBibleSelection)
        : false;
      restoredButtonState = restoredFocusedSelection;
      if (!restoredFocusedSelection && pendingBibleSelection) {
        restoreBibleSelectionFromSnapshot(pendingBibleSelection);
        updateButtonView({
          preserveScroll: true,
          skipAutoScroll: true,
          scrollTop: Number.isFinite(pendingBibleSelection.lyricButtonsScrollTop) ? pendingBibleSelection.lyricButtonsScrollTop : 0
        });
        restoredButtonState = true;
        if (pendingBibleSelection === lastBibleSelectionBeforeSchedule) {
          lastBibleSelectionBeforeSchedule = null;
        }
      }
      if (!restoredButtonState && tab !== 'media') {
        updateButtonView();
      }
      if (tab !== 'media') configureImportAccept();
      setLtFontInputValue(getEffectiveLtFont());
      updateLtBibleVerseAlignVisibility();
      updateLtAlignButtons();
      handleDualFontOverrideState();
      updateLinePickerAvailability();
      updateCustomModeAvailability();
      updateTextEditorModeAvailability();
      if (typeof updateWorkspaceFontSizeControl === 'function') updateWorkspaceFontSizeControl();
      const bgToggle = document.getElementById('bg-toggle');
      const shouldPreserveLtBg = prevTab === 'bible' &&
        tab === 'songs' &&
        activeRatio === '16-9' &&
        bgToggle && bgToggle.checked;
      preserveLtBgWhenSwitchingToSongs = useFocusedWorkspaceControls ? false : shouldPreserveLtBg;
      let allowBgAutoApply = activeRatio === '16-9';
      if (delayBibleBgUntilVerse && tab === 'bible') {
        allowBgAutoApply = false;
      }
      if (useFocusedWorkspaceControls) allowBgAutoApply = false;
      if (allowBgAutoApply) {
        if (applyLtBgDefaultForTab(tab)) onAnyControlChange();
      } else {
        if (!bgToggle || !bgToggle.checked) preserveLtBgWhenSwitchingToSongs = false;
      }
      if (tab !== 'bible' || useFocusedWorkspaceControls) delayBibleBgUntilVerse = false;
      updateSongTextTransformControl();
      handleSongFullFontState();
      // restore sidebar height for the new tab
      if (window._restoreSidebarTabHeight) window._restoreSidebarTabHeight();
      positionSidebarQuickActions();
      refreshWorkspaceLayoutUi();
      saveToStorageDebounced();
    }

    function captureCurrentBibleSelection() {
      if (sidebarTab !== 'bible' || !currentItem || !currentItem.version) return null;
      const lyricButtons = document.getElementById('lyric-buttons');
      return {
        version: activeBibleVersion,
        chapterIndex: Number.isFinite(currentIndex) ? currentIndex : null,
        lineCursor: Number.isFinite(lineCursor) ? lineCursor : null,
        anchorVerse: bibleGroupAnchorVerse || null,
        lyricButtonsScrollTop: lyricButtons ? lyricButtons.scrollTop : 0
      };
    }

    function captureCurrentSongSelection() {
      if (!currentItem || getIsBibleItem(currentItem)) return null;
      const lyricButtons = document.getElementById('lyric-buttons');
      return {
        songId: currentItem.id || null,
        index: Number.isFinite(currentIndex) ? currentIndex : null,
        lineCursor: Number.isFinite(lineCursor) ? lineCursor : 0,
        lyricButtonsScrollTop: lyricButtons ? lyricButtons.scrollTop : 0
      };
    }

    function clearMainWorkspaceSelection() {
      currentItem = null;
      currentIndex = -1;
      lineCursor = 0;
      const editor = document.getElementById('lyric-editor');
      if (editor) editor.value = '';
      refreshSongTranslationPanel(null);
      renderSongs();
      updateButtonView();
      updateFocusedEditorBanner();
    }

    function restoreSongSelectionFromSnapshot(snapshot) {
      const list = Array.isArray(songs) ? songs : [];
      if (!list.length) return false;
      let idx = -1;
      if (snapshot && snapshot.songId) {
        idx = list.findIndex(song => song && song.id === snapshot.songId);
      }
      if (idx === -1 && snapshot && snapshot.title && snapshot.content) {
        idx = list.findIndex(song =>
          song &&
          String(song.title || '') === String(snapshot.title || '') &&
          String(song.content || song.text || '') === String(snapshot.content || '')
        );
      }
      if (idx === -1 && snapshot && Number.isFinite(snapshot.index) && snapshot.index >= 0 && snapshot.index < list.length) {
        idx = snapshot.index;
      }
      if (idx === -1) idx = 0;
      selectItem(idx, { preserveLineCursor: true, skipButtonView: true });
      const pages = getPagesFromItem(currentItem, false);
      lineCursor = Math.max(0, Math.min((snapshot && Number.isFinite(snapshot.lineCursor) ? snapshot.lineCursor : 0), Math.max(0, pages.length - 1)));
      updateButtonView({
        preserveScroll: true,
        skipAutoScroll: true,
        scrollTop: (snapshot && Number.isFinite(snapshot.lyricButtonsScrollTop)) ? snapshot.lyricButtonsScrollTop : 0
      });
      return true;
    }

    function restoreWorkspaceSelectionForTab(tab, pendingBibleSelection = null) {
      if (tab === 'songs') {
        let pendingSongSelection = null;
        if (scheduleReturnTarget && scheduleReturnTarget.kind === 'songs') {
          pendingSongSelection = scheduleReturnTarget;
          scheduleReturnTarget = null;
        }
        if (pendingSongSelection && restoreSongSelectionFromSnapshot(pendingSongSelection)) return true;
        if (restoreSongSelectionFromSnapshot(lastSongWorkspaceSelection)) return true;
        clearMainWorkspaceSelection();
        return false;
      }
      if (tab === 'bible') {
        const scheduleBibleSelection = (scheduleReturnTarget && scheduleReturnTarget.kind === 'bible')
          ? scheduleReturnTarget
          : null;
        if (scheduleBibleSelection) scheduleReturnTarget = null;
        const snapshot = pendingBibleSelection || scheduleBibleSelection || lastBibleWorkspaceSelection;
        if (snapshot && restoreBibleSelectionFromSnapshot(snapshot)) {
          updateButtonView({
            preserveScroll: true,
            skipAutoScroll: true,
            scrollTop: Number.isFinite(snapshot.lyricButtonsScrollTop) ? snapshot.lyricButtonsScrollTop : 0
          });
          return true;
        }
        if (activeBibleVersion && bibles[activeBibleVersion] && bibles[activeBibleVersion].length) {
          selectItem(0, { preserveLineCursor: true, skipButtonView: true });
          updateButtonView({
            preserveScroll: true,
            skipAutoScroll: true,
            scrollTop: 0
          });
          return true;
        }
        clearMainWorkspaceSelection();
        return false;
      }
      return false;
    }

    function buildScheduleSelectionTarget(entry) {
      if (!entry || !entry.version) return null;
      const version = entry.version;
      const list = bibles[version];
      if (!Array.isArray(list) || !list.length) return null;
      let chapterIndex = (Number.isFinite(entry.chapterIndex)) ? entry.chapterIndex : null;
      if (chapterIndex == null) {
        const extracted = extractBookAndChapter(entry);
        chapterIndex = findBibleChapterIndex(version, extracted.book, extracted.chap, 0);
      }
      if (!Number.isFinite(chapterIndex) || chapterIndex < 0 || chapterIndex >= list.length) return null;
      const pageIdx = (Number.isFinite(entry.pageIndex)) ? entry.pageIndex : 0;
      return {
        version,
        chapterIndex,
        lineCursor: pageIdx,
        anchorVerse: entry.anchorVerse || null
      };
    }

    function buildScheduleRestoreTarget(entry) {
      if (!entry) return null;
      if (entry.version) {
        const target = buildScheduleSelectionTarget(entry);
        return target ? { kind: 'bible', ...target } : null;
      }
      return {
        kind: 'songs',
        songId: entry.id || null,
        title: entry.title || '',
        content: entry.content || entry.text || '',
        index: Array.isArray(songs)
          ? songs.findIndex(song =>
              song &&
              (
                (entry.id && song.id === entry.id) ||
                (
                  String(song.title || '') === String(entry.title || '') &&
                  String(song.content || song.text || '') === String(entry.content || entry.text || '')
                )
              )
            )
          : null,
        lineCursor: Number.isFinite(lineCursor)
          ? lineCursor
          : (Number.isFinite(entry.pageIndex) ? entry.pageIndex : 0)
      };
    }

    function restoreBibleSelectionFromSnapshot(snapshot) {
      if (!snapshot || !snapshot.version) return false;
      const list = bibles[snapshot.version];
      if (!Array.isArray(list) || !list.length) return false;
      const targetIndex = Number.isFinite(snapshot.chapterIndex)
        ? Math.max(0, Math.min(list.length - 1, snapshot.chapterIndex))
        : 0;
      activeBibleVersion = snapshot.version;
      selectItem(targetIndex, { preserveLineCursor: true, skipButtonView: true });
      if (Number.isFinite(snapshot.lineCursor)) {
        const pages = getPagesFromItem(currentItem, true);
        lineCursor = Math.max(0, Math.min((pages.length || 1) - 1, snapshot.lineCursor));
      }
      if (snapshot.anchorVerse) {
        setBibleGroupAnchor(snapshot.anchorVerse, currentItem);
      }
      return true;
    }

    function enforceBibleModeRules() {
      const modeTextBtn = document.getElementById('mode-text');
      const customModeBtn = document.getElementById('ratio-custom');
      if (!modeTextBtn || !customModeBtn) return;
      const bibleContent = isBibleContentActive();
      if (bibleContent) {
        modeTextBtn.disabled = true;
        setEditorMode('btn');
      } else {
        modeTextBtn.disabled = false;
      }
      customModeBtn.disabled = (sidebarTab === 'bible');
    }


    let sidebarQuickActionsOpen = false;
    let sidebarQuickActionsRenderPending = false;
    let sidebarQuickActionsNeedsRender = false;

    function isSidebarQuickActionsVisible() {
      const main = document.getElementById('main');
      if (!main) return false;
      const style = getComputedStyle(main);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = main.getBoundingClientRect();
      return rect.width > 120 && rect.height > 120;
    }

    function scheduleSidebarQuickActionsRender(opts = {}) {
      const panel = document.getElementById('sidebar-quick-actions-panel');
      if (!panel) return;
      const immediate = !!opts.immediate;
      const forceRender = !!opts.forceRender;
      if (immediate) {
        sidebarQuickActionsRenderPending = false;
        sidebarQuickActionsNeedsRender = false;
        renderSidebarQuickActionsPanel();
        return;
      }
      sidebarQuickActionsNeedsRender = true;
      if (sidebarQuickActionsRenderPending) return;
      sidebarQuickActionsRenderPending = true;
      requestAnimationFrame(() => {
        sidebarQuickActionsRenderPending = false;
        if (!isSidebarQuickActionsVisible()) {
          positionSidebarQuickActions();
          return;
        }
        if (sidebarQuickActionsOpen || forceRender) {
          sidebarQuickActionsNeedsRender = false;
          renderSidebarQuickActionsPanel();
          return;
        }
        positionSidebarQuickActions();
      });
    }

    function setMirroredSidebarToggle(targetId, nextChecked) {
      const input = document.getElementById(targetId);
      if (!input) return;
      input.checked = !!nextChecked;
      if (typeof input.onchange === 'function') input.onchange();
      else if (typeof onAnyControlChange === 'function') onAnyControlChange();
      scheduleSidebarQuickActionsRender();
    }

    function setMirroredSidebarSelect(targetId, nextValue) {
      const input = document.getElementById(targetId);
      if (!input) return;
      input.value = nextValue;
      if (typeof input.onchange === 'function') input.onchange();
      else if (typeof onAnyControlChange === 'function') onAnyControlChange();
      scheduleSidebarQuickActionsRender();
    }

    function getSidebarQuickActionValue(item) {
      if (item && typeof item.getValue === 'function') return item.getValue();
      if (!item || !item.id) return '';
      const input = document.getElementById(item.id);
      if (!input) return '';
      if (item.type === 'select') return input.value;
      return !!input.checked;
    }

    function setSidebarQuickActionValue(item, nextValue) {
      if (item && typeof item.onChange === 'function') {
        item.onChange(nextValue);
        scheduleSidebarQuickActionsRender();
        return;
      }
      if (!item || !item.id) return;
      if (item.type === 'select') {
        setMirroredSidebarSelect(item.id, nextValue);
      } else {
        setMirroredSidebarToggle(item.id, nextValue);
      }
    }

    function renderSidebarQuickActionsPanel() {
      const panel = document.getElementById('sidebar-quick-actions-panel');
      if (!panel) return;
      sidebarQuickActionsNeedsRender = false;
      panel.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'sidebar-qa-header';
      header.innerHTML = `<div class="sidebar-qa-title">${t('ui_quick_actions')}</div>`;
      panel.appendChild(header);

      const groups = (() => {
        if (sidebarTab === 'songs') {
          return SIDEBAR_QUICK_ACTION_GROUPS.filter((group) => group.titleKey === 'settings_song_options');
        }
        if (sidebarTab === 'bible') {
          return SIDEBAR_QUICK_ACTION_GROUPS.filter((group) => group.titleKey === 'settings_bible_options');
        }
        if (sidebarTab === 'schedule') {
          return SIDEBAR_QUICK_ACTION_GROUPS;
        }
        return SIDEBAR_QUICK_ACTION_GROUPS;
      })();

      groups.forEach((group) => {
        const section = document.createElement('div');
        section.className = 'sidebar-qa-group';
        const title = document.createElement('div');
        title.className = 'sidebar-qa-group-title';
        title.textContent = t(group.titleKey);
        section.appendChild(title);

        group.items.forEach((item) => {
          const row = document.createElement('div');
          row.className = 'sidebar-qa-item';

          const label = document.createElement('span');
          const itemLabel = item.label || t(item.labelKey);
          label.textContent = itemLabel;

          row.appendChild(label);
          if (item.type === 'select') {
            const selectWrap = document.createElement('div');
            selectWrap.className = 'sidebar-qa-select-wrap';
            const select = document.createElement('select');
            select.className = 'sidebar-qa-select';
            (item.options || []).forEach((optionDef) => {
              const option = document.createElement('option');
              option.value = optionDef.value;
              option.textContent = optionDef.label || t(optionDef.labelKey);
              select.appendChild(option);
            });
            select.value = getSidebarQuickActionValue(item) || item.options?.[0]?.value || 'none';
            select.title = itemLabel;
            select.onchange = () => setSidebarQuickActionValue(item, select.value);
            selectWrap.appendChild(select);
            if (item.badgeKey) {
              const badge = document.createElement('span');
              badge.className = 'sidebar-qa-select-badge';
              const badgeText = t(item.badgeKey);
              badge.textContent = (item.badgeKey === 'mode_full') ? 'FS' : badgeText;
              selectWrap.appendChild(badge);
            }
            row.appendChild(selectWrap);
          } else {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'sidebar-qa-toggle';
            const checked = !!getSidebarQuickActionValue(item);
            toggle.classList.toggle('active', checked);
            toggle.setAttribute('aria-pressed', checked ? 'true' : 'false');
            toggle.title = itemLabel;
            toggle.onclick = () => setSidebarQuickActionValue(item, !checked);
            row.appendChild(toggle);
          }
          section.appendChild(row);
        });

        panel.appendChild(section);
      });

      positionSidebarQuickActions();
    }

    function positionSidebarQuickActions() {
      const sidebar = document.getElementById('sidebar');
      const main = document.getElementById('main');
      const btn = document.getElementById('sidebar-quick-actions-btn');
      const panel = document.getElementById('sidebar-quick-actions-panel');
      if (!sidebar || !main || !btn || !panel) return;

      const visible = isSidebarQuickActionsVisible();
      if (!visible) {
        btn.style.display = 'none';
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
        sidebarQuickActionsOpen = false;
        return;
      }

      const sidebarRect = sidebar.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const gap = 0;
      const anchorLeft = Math.round(mainRect.left);
      const top = Math.max(64, sidebarRect.top + 110);
      btn.style.display = 'flex';
      btn.style.left = `${anchorLeft}px`;
      btn.style.top = `${Math.round(top)}px`;
      btn.classList.toggle('active', sidebarQuickActionsOpen);

      if (!sidebarQuickActionsOpen) return;

      panel.classList.add('open');
      panel.setAttribute('aria-hidden', 'false');
      panel.style.left = `${Math.round(anchorLeft + btn.offsetWidth + gap + 6)}px`;
      panel.style.top = `${Math.round(Math.max(56, Math.min(top - 10, window.innerHeight - panel.offsetHeight - 14)))}px`;
    }

    function toggleSidebarQuickActions(forceOpen) {
      const nextOpen = (typeof forceOpen === 'boolean') ? forceOpen : !sidebarQuickActionsOpen;
      sidebarQuickActionsOpen = nextOpen;
      scheduleSidebarQuickActionsRender({ immediate: true, forceRender: nextOpen });
      const panel = document.getElementById('sidebar-quick-actions-panel');
      const btn = document.getElementById('sidebar-quick-actions-btn');
      if (panel) {
        panel.classList.toggle('open', nextOpen);
        panel.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
      }
      if (btn) btn.classList.toggle('active', nextOpen);
      positionSidebarQuickActions();
    }

    function setupSidebarQuickActions() {
      const btn = document.getElementById('sidebar-quick-actions-btn');
      const panel = document.getElementById('sidebar-quick-actions-panel');
      if (!btn || !panel || btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      scheduleSidebarQuickActionsRender({ immediate: true });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      panel.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      window.addEventListener('resize', positionSidebarQuickActions);
      window.addEventListener('scroll', positionSidebarQuickActions, true);
      document.addEventListener('click', (e) => {
        if (!sidebarQuickActionsOpen) return;
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.closest('#sidebar-quick-actions-btn') || t.closest('#sidebar-quick-actions-panel')) return;
        toggleSidebarQuickActions(false);
      });
    }
