    function clearOutput(opts = {}) {
      isLive = false;
      liveKind = null;
      livePointer = null;
      liveLineCursor = 0;
      liveLinesPerPage = linesPerPage;
      liveBackgroundState = null;
      liveRatio = activeRatio;
      liveTextTransformState = null;
      applyProgramDisplaySource('lyrics');
      postClear({
        fade: opts.fade !== false,
        transitionDuration: opts.transitionDuration != null ? opts.transitionDuration : getCurrentTransitionDuration()
      });
      saveToStorageDebounced();
      updateButtonView();
      setLtFontInputValue(getEffectiveLtFont());
      handleSongFullFontState();
      if (isVmixMode()) {
        vmixAfterClear().catch((error) => {
          vmixConnectionState = 'error';
          vmixLastError = error && error.message ? error.message : 'vMix clear failed';
          updateVmixStatusUi();
        });
      }
    }
    
    function clearSearch() {
      const input = document.getElementById('song-search');
      const mirror = document.getElementById('nav-mirror-search');
      if (input) {
        input.value = '';
        setSearchValueForTab(sidebarTab, '');
      }
      if (mirror) mirror.value = '';
      renderSongs();
      saveToStorageDebounced();
    }
    
    function resetLTPosition() {
      const textXEl = document.getElementById('text-x');
      const textYEl = document.getElementById('text-y');
      const ltOffsetYEl = document.getElementById('lt-offset-y');
      const ltOffsetXEl = document.getElementById('lt-offset-x');
      if (textXEl) textXEl.value = 0;
      if (textYEl) textYEl.value = 860;
      if (ltOffsetYEl) ltOffsetYEl.value = 0;
      if (ltOffsetXEl) ltOffsetXEl.value = 0;
      const padLrFullEl = document.getElementById('pad-lr-full');
      const padLrLtEl = document.getElementById('pad-lr-lt');
      const padBEl = document.getElementById('pad-b');
      if (padLrFullEl) padLrFullEl.value = 5;
      if (padLrLtEl) padLrLtEl.value = 5;
      if (padBEl) padBEl.value = 10;
      initializeAllSliders();
      onAnyControlChange();
      showToast(t('settings_position_reset_default'));
    }
    
    function confirmReset() {
      showConfirm(t('settings_reset_plugin'), t('settings_reset_plugin_confirm'), () => {
        resetAppData();
      });
    }

    async function resetAppData() {
      stateReady = false;
      isRestoringBackup = true;
      try {
        try { localStorage.clear(); } catch (_) {}
        try { sessionStorage.clear(); } catch (_) {}

        await openDb();
        await Promise.all([
          dbClearStore(STORE_SONGS),
          dbClearStore(STORE_BIBLES),
          dbClearStore(STORE_STATE)
        ]);
        showToast(t('settings_plugin_reset_complete'));
        setTimeout(() => {
          try {
            window.location.reload();
          } catch (_) {
            window.location.href = window.location.href;
          }
        }, 120);
      } catch (e) {
        isRestoringBackup = false;
        stateReady = true;
        console.error('Reset failed', e);
        showToast(t('common_reset_failed'));
      }
    }
    
    function showConfirm(title, message, callback, showInput = false, initialInput = '') {
      document.getElementById('confirm-title').innerText = title;
      document.getElementById('confirm-message').innerText = message;
      const input = document.getElementById('confirm-input');
      input.style.display = showInput ? 'block' : 'none';
      input.value = showInput ? String(initialInput || '') : '';
      const btn = document.getElementById('confirm-btn');
      btn.onclick = () => {
        closeModal('confirmModal');
        callback(showInput ? input.value : true);
      };
      openModal('confirmModal');
      if (showInput) {
        setTimeout(() => {
          try {
            input.focus();
            input.setSelectionRange(0, input.value.length);
          } catch (_) {}
        }, 10);
      }
    }
    
    function createNewItem() {
      const input = document.getElementById('new-song-title');
      const artistInput = document.getElementById('new-song-artist');
      const title = (input.value || '').trim();
      const artist = (artistInput?.value || '').trim();
      if (!title) return;
      const lookupKey = getNewSongLookupKey(title, artist);
      const fetchedLyrics = (lookupKey === newSongFetchedLookupKey) ? newSongFetchedLyrics : '';
      const initialContent = fetchedLyrics || '';
      const newSong = {
        id: createId('song', title),
        title,
        content: initialContent,
        text: initialContent,
        translatedLyrics: '',
        translationLanguage: getSongBilingualSettings().targetLanguage,
        translationStatus: 'idle',
        translationLocked: false,
        translatedAt: 0,
        translationHash: computeTranslationHash(initialContent, getSongBilingualSettings().targetLanguage),
        searchableText: normalizeSearchText(`${title}\n${initialContent}`),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      songs.push(newSong);
      idbPut(STORE_SONGS, buildSongRecord(newSong, { isNew: true })).catch(() => {});
      maybeTranslateImportedSong(newSong);
      setSidebarTab('songs');
      const searchInput = document.getElementById('song-search');
      if (searchInput) searchInput.value = '';
      setSearchValueForTab('songs', '');
      selectItem(songs.length - 1);
      setEditorMode('text');
      document.getElementById('lyric-editor').focus();
      requestAnimationFrame(() => {
        focusActiveSongInSidebar();
      });
      input.value = "";
      if (artistInput) artistInput.value = "";
      closeModal('newSongModal');
      saveState();
      saveToStorageDebounced();
      showToast(fetchedLyrics ? t('song_created_with_fetched_lyrics') : t('song_created'));
    }
    
    function setupKeyboardShortcuts() {
      document.addEventListener('keydown', (e) => {
        const target = e.target;
        const tag = (target && target.tagName) ? target.tagName.toLowerCase() : '';
        const isTypingTarget = !!(target && (
          target.isContentEditable ||
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          (typeof target.closest === 'function' && target.closest('[contenteditable="true"]'))
        ));

        const isMod = e.ctrlKey || e.metaKey;
        const keyLower = (e.key || '').toLowerCase();
        if (isMod && (keyLower === 'a' || keyLower === 'c' || keyLower === 'v')) {
          const editor = document.getElementById('lyric-editor');
          if (!editor) return;

          // keep URL quick‑paste inputs working without hijack
          if (keyLower === 'v') {
            const bgType = document.getElementById('bg-type')?.value;
            const bgInput = (bgType === 'video') ? document.getElementById('bg-video-url') :
                            (bgType === 'image') ? document.getElementById('bg-image-url') : null;
            if (bgInput && bgInput.offsetParent !== null) return;
          }

          // We always want these three modifiers to operate on the lyric editor
          // regardless of where focus currently is, so do *not* bail out simply
          // because the user happens to be typing somewhere else.  (The
          // exception is when a background-URL field is active, handled above.)
          e.preventDefault();
          if (editorMode !== 'text') setEditorMode('text');
          editor.focus();

          if (keyLower === 'a') {
            editor.select();
            return;
          }

          if (keyLower === 'c') {
            const selected = editor.value.slice(editor.selectionStart || 0, editor.selectionEnd || 0);
            const textToCopy = selected || editor.value || '';
            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(textToCopy).catch(() => {});
            } else {
              // fallback for environments without the async clipboard API
              try {
                const ta = document.createElement('textarea');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                ta.value = textToCopy;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
              } catch (err) {}
            }
            return;
          }

          // keyLower === 'v'
          if (navigator.clipboard?.readText) {
            navigator.clipboard.readText().then((text) => {
              if (typeof text !== 'string' || !text.length) return;
              const start = editor.selectionStart || 0;
              const end = editor.selectionEnd || 0;
              editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
              const nextPos = start + text.length;
              editor.selectionStart = nextPos;
              editor.selectionEnd = nextPos;
              saveCurrentItem();
            }).catch(() => {});
          } else {
            // allow default paste behaviour as last resort
            try { document.execCommand('paste'); } catch (_) {}
          }
          return;
        }

        if (isMod && keyLower === 'b' && !e.altKey) {
          e.preventDefault();
          toggleSidebar();
          return;
        }
        if (isTypingTarget) return;
        if (!isMod && !e.altKey && !e.shiftKey && keyLower === 's') {
          e.preventDefault();
          toggleSidebar();
          return;
        }
        if (!isMod && !e.altKey && !e.shiftKey && keyLower === 'a') {
          e.preventDefault();
          if (typeof setAnnotateMode === 'function') {
            const nextAnnotateState = !(typeof annotateMode !== 'undefined' && annotateMode);
            setAnnotateMode(nextAnnotateState);
            if (nextAnnotateState && typeof positionAnnotateToolbar === 'function') positionAnnotateToolbar();
          }
          return;
        }
        if (!isMod && !e.altKey && !e.shiftKey && keyLower === 'd') {
          e.preventDefault();
          const panel = document.getElementById('dual-version-panel');
          if (panel) {
            const willOpen = !panel.classList.contains('open');
            panel.classList.toggle('open', willOpen);
            if (willOpen && typeof positionDualVersionPanel === 'function') positionDualVersionPanel();
          }
          return;
        }
        if (!isMod && !e.altKey && !e.shiftKey && keyLower === 'i') {
          e.preventDefault();
          if (typeof triggerImport === 'function') triggerImport();
          return;
        }
        if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          const footerTabs = ['bible', 'songs', 'schedule'];
          const idx = Math.max(0, footerTabs.indexOf(sidebarTab));
          const direction = e.shiftKey ? -1 : 1;
          const next = footerTabs[(idx + direction + footerTabs.length) % footerTabs.length];
          switchBottomNavSidebarTab(next);
          return;
        }
        if (e.key === 'ArrowRight') { e.preventDefault(); nextSlide(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); prevSlide(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); navigateSidebar(1); }
        if (e.key === 'ArrowUp') { e.preventDefault(); navigateSidebar(-1); }
        if (e.key === 'Enter') { e.preventDefault(); projectLive(true); }
        // Number keys 1-6: set lines in main panel
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 6 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const max = getMaxLinesForCurrentTab(sidebarTab);
          if (num <= max) {
            e.preventDefault();
            setLines(num);
          }
        }
      });
    }

    function setupUrlPasteShortcuts() {
      document.addEventListener('keydown', (e) => {
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        const key = (e.key || '').toLowerCase();
        if (key !== 'v' || !(e.ctrlKey || e.metaKey)) return;
        const bgType = document.getElementById('bg-type')?.value;
        const input = (bgType === 'video') ? document.getElementById('bg-video-url') :
                      (bgType === 'image') ? document.getElementById('bg-image-url') : null;
        if (!input || input.offsetParent === null) return;
        if (!navigator.clipboard || !navigator.clipboard.readText) return;
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (typeof text !== 'string') return;
          input.value = text.trim();
          input.focus();
          onAnyControlChange();
        }).catch(() => {});
      });
    }
    
