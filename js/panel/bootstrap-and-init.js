    function buildDefaultAppState() {
      return {
        version: 1,
        activeTab: 'bible',
        mode: { ratio: 'full', editor: 'btn' },
        selectedSongId: null,
        selectedBibleId: null,
        songNav: { cursorIndex: 0, lineCursor: 0, linesPerPage: 2 },
        bibleNav: { book: null, chapter: null, verseStart: null, verseEnd: null, versionId: null, index: 0, lineCursor: 0 },
        settings: null,
        live: { isLive: false, liveKind: null, livePointer: null, liveLineCursor: 0, lastLiveState: { kind: 'clear' } },
        schedule: [],
        presets: [],
        scenes: [],
        activeSceneId: null,
        sceneIdCounter: 0,
        sourceIdCounter: 0,
        audioMixer: {
          monitorMuted: true,
          monitorVolume: 1,
          monitorMode: 'monitor-off',
          mediaAvSyncMs: 0,
          ullEnabled: false,
          ullBuffer: '128',
          ullSampleRate: 'auto',
          ullBypassFx: true,
          ullUnderruns: 0,
          masterFx: [],
          masterVolume: 1,
          buses: []
        },
        currentAppPage: 'projection',
        ui: {
          language: 'en',
          searchText: { ...DEFAULT_SEARCH_QUERIES },
          bibleRecentRefs: [],
          biblePinnedRefs: [],
          songListScrollTop: 0,
          lyricButtonsScrollTop: 0,
          editorMode: 'btn',
          sidebarLayout: 'layout2',
          workspaceLayoutMode: 'focused',
          focusedWorkspaceControls: createDefaultFocusedWorkspaceControls()
        },
        host: {
          mode: HOST_MODE_OBS,
          vmix: { ...vmixState }
        }
      };
    }

    function getCurrentBibleNav() {
      const nav = {
        book: null,
        chapter: null,
        verseStart: null,
        verseEnd: null,
        versionId: activeBibleVersion || null,
        index: currentIndex,
        lineCursor
      };
      if (!currentItem || !getIsBibleItem(currentItem)) return nav;
      const extracted = extractBookAndChapter(currentItem);
      nav.book = extracted.book;
      nav.chapter = extracted.chap;
      const pages = getPagesFromItem(currentItem, true);
      const page = pages[lineCursor];
      if (page && page.raw) {
        const lines = page.raw.split('\n').map(l => l.trim()).filter(Boolean);
        const first = lines.find(l => /^\d+/.test(l));
        const last = [...lines].reverse().find(l => /^\d+/.test(l));
        const firstMatch = first ? first.match(/^(\d+)/) : null;
        const lastMatch = last ? last.match(/^(\d+)/) : null;
        nav.verseStart = firstMatch ? firstMatch[1] : null;
        nav.verseEnd = lastMatch ? lastMatch[1] : nav.verseStart;
      }
      return nav;
    }

    function normalizeFeedbackApiUrl(value) {
      const normalized = String(value || '').trim();
      if (!normalized || normalized === BSP_LEGACY_LOCAL_FEEDBACK_API_URL) {
        return BSP_DEFAULT_FEEDBACK_API_URL;
      }
      return normalized;
    }

    function syncAppStateFromUi() {
      if (!appState) appState = buildDefaultAppState();
      const searchInput = document.getElementById('song-search');
      if (searchInput) setSearchValueForTab(sidebarTab, searchInput.value);
      const songList = document.getElementById('song-list');
      const lyricButtons = document.getElementById('lyric-buttons');
      const isBible = getIsBibleItem(currentItem);
      const selectedSongId = (!isBible && currentItem) ? (currentItem.id || null) : null;
      const settings = getUiSnapshot();
      settings.feedbackApiUrl = normalizeFeedbackApiUrl(settings.feedbackApiUrl);
      // Sync source order from DOM before persisting
      saveCurrentSourceOrder();
      appState = {
        ...appState,
        version: 1,
        activeTab: sidebarTab,
        mode: { ratio: activeRatio, editor: editorMode },
        selectedSongId,
        selectedBibleId: activeBibleVersion || null,
        songNav: { cursorIndex: currentIndex, lineCursor, linesPerPage },
        bibleNav: getCurrentBibleNav(),
        settings,
        live: {
          ...(appState.live || {}),
          isLive,
          liveKind,
          livePointer,
          liveLineCursor,
          liveLinesPerPage,
          liveBackgroundState,
          liveRatio,
          liveTextTransformState,
          lastLiveState: lastLiveState || (appState.live ? appState.live.lastLiveState : { kind: 'clear' })
        },
        schedule: Array.isArray(schedule) ? schedule : [],
        presets: Array.isArray(presets) ? presets : [],
        scenes: _serializeScenes(),
        activeSceneId: _activeSceneId,
        sceneIdCounter: _sceneIdCounter,
        sourceIdCounter: _sourceIdCounter,
        audioMixer: {
          monitorMuted: !!_pgmMutedMonitor,
          monitorVolume: Math.max(0, Math.min(1, Number(_pgmMonitorVolume) || 1)),
          monitorMode: _pgmGetNormalizedMonitoringMode(_pgmMonitoringMode),
          mediaAvSyncMs: Math.max(-200, Math.min(400, Math.round(Number(_pgmMediaLocalAvSyncMs) || 0))),
          ullEnabled: !!_pgmUltraLowLatencyEnabled,
          ullBuffer: _pgmNormalizeUllBuffer(_pgmUltraLowLatencyBuffer),
          ullSampleRate: _pgmNormalizeUllSampleRate(_pgmUltraLowLatencySampleRate),
          ullBypassFx: !!_pgmUltraLowLatencyBypassFx,
          ullUnderruns: Math.max(0, Math.round(Number(_pgmUltraLowLatencyUnderruns) || 0)),
          masterFx: _promixMasterFx,
          masterVolume: _promixMasterVolume,
          buses: _promixBuses.map(b => ({
            id: b.id,
            name: b.name,
            fxChain: b.fxChain || [],
            volume: b.volume ?? 1,
            muted: !!b.muted
          }))
        },
        currentAppPage: currentAppPage || 'projection',
        ui: {
          language: currentLanguage,
          searchText: getSearchSnapshot(),
          bibleRecentRefs: sanitizeBibleRefEntries(bibleRecentRefs, MAX_BIBLE_RECENT_REFS),
          biblePinnedRefs: sanitizeBibleRefEntries(biblePinnedRefs, MAX_BIBLE_PINNED_REFS),
          songListScrollTop: songList ? songList.scrollTop : 0,
          lyricButtonsScrollTop: lyricButtons ? lyricButtons.scrollTop : 0,
          editorMode
        },
        host: {
          mode: getHostMode(),
          vmix: getVmixSettings()
        }
      };
    }

    function restoreSelectionFromState(state) {
      if (!state) return;
      const navSong = state.songNav || {};
      const navBible = state.bibleNav || {};
      if (sidebarTab === 'bible') {
        if (activeBibleVersion && bibles[activeBibleVersion]) {
          const idx = findBibleChapterIndex(
            activeBibleVersion,
            navBible.book,
            navBible.chapter,
            navBible.index
          );
          if (idx !== -1) {
            selectItem(idx, { preserveLineCursor: true, skipButtonView: true });
            if (navBible.verseStart) {
              setBibleGroupAnchor(navBible.verseStart, currentItem);
            }
            const pages = getPagesFromItem(currentItem, true);
            const verseStart = navBible.verseStart;
            let targetIdx = -1;
            if (verseStart) {
              targetIdx = pages.findIndex(p => matchesVerseStart(p.raw, verseStart));
            }
            if (targetIdx === -1) {
              targetIdx = Math.max(0, Math.min(navBible.lineCursor || 0, pages.length - 1));
            }
            lineCursor = targetIdx;
            updateButtonView({ preserveScroll: true, skipAutoScroll: true });
          }
        }
      } else if (sidebarTab === 'songs' || sidebarTab === 'schedule') {
        const targetId = state.selectedSongId;
        const idx = targetId ? songs.findIndex(s => s.id === targetId) : -1;
        if (idx !== -1) {
          selectItem(idx, { preserveLineCursor: true, skipButtonView: true });
          const pages = getPagesFromItem(currentItem, false);
          lineCursor = Math.max(0, Math.min(navSong.lineCursor || 0, pages.length - 1));
          updateButtonView({ preserveScroll: true, skipAutoScroll: true });
        }
      }
    }

    function bindSearchEnter() {
      const searchInput = document.getElementById('song-search');
      if (!searchInput || searchInput.dataset.enterBound) return;
      searchInput.dataset.enterBound = '1';
      searchInput.addEventListener('keydown', handleSearchEnter);
      searchInput.addEventListener('keydown', handleBibleSpaceToColon);

      // Wire up nav mirror search bar
      bindNavMirrorSearch();
      bindBibleReferenceSearchTools();
    }

    function bindNavMirrorSearch() {
      const mirror = document.getElementById('nav-mirror-search');
      const main = document.getElementById('song-search');
      const resultsBox = document.getElementById('nav-mirror-results');
      const mirrorPinBtn = document.getElementById('nav-mirror-ref-pin-current');
      const mirrorHistoryBtn = document.getElementById('nav-mirror-ref-history-btn');
      if (!mirror || !main || !resultsBox || mirror.dataset.mirrorBound) return;
      mirror.dataset.mirrorBound = '1';
      let mirrorResultIdx = -1;

      const hideMirrorResults = () => {
        resultsBox.style.display = 'none';
        resultsBox.replaceChildren();
        resultsBox._sourceItems = [];
        mirrorResultIdx = -1;
      };

      if (!resultsBox.dataset.eventsBound) {
        resultsBox.dataset.eventsBound = '1';
        resultsBox.addEventListener('mousedown', (e) => {
          const target = e.target.closest('.nav-mirror-result-item, .nav-mirror-close-btn');
          if (target && resultsBox.contains(target)) e.preventDefault();
        });
        resultsBox.addEventListener('click', (e) => {
          const closeBtn = e.target.closest('.nav-mirror-close-btn');
          if (closeBtn && resultsBox.contains(closeBtn)) {
            hideMirrorResults();
            return;
          }
          const row = e.target.closest('.nav-mirror-result-item');
          if (!row || !resultsBox.contains(row)) return;
          const sourceIndex = Number(row.dataset.navResultIndex);
          const sourceItems = Array.isArray(resultsBox._sourceItems) ? resultsBox._sourceItems : [];
          const srcItem = sourceItems[sourceIndex];
          if (!srcItem) return;
          if (typeof srcItem.activate === 'function') {
            srcItem.activate();
          } else if (srcItem.row) {
            srcItem.row.click();
          } else {
            return;
          }
          mirror.focus();
          hideMirrorResults();
        });
        resultsBox.addEventListener('contextmenu', (e) => {
          const row = e.target.closest('.nav-mirror-result-item');
          if (!row || !resultsBox.contains(row)) return;
          const sourceIndex = Number(row.dataset.navResultIndex);
          const sourceItems = Array.isArray(resultsBox._sourceItems) ? resultsBox._sourceItems : [];
          const srcItem = sourceItems[sourceIndex];
          if (!srcItem) return;
          e.preventDefault();
          e.stopPropagation();
          if (typeof srcItem.contextMenu === 'function') {
            srcItem.contextMenu(e.clientX, e.clientY);
          } else if (srcItem.row) {
            srcItem.row.dispatchEvent(new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: e.clientX,
              clientY: e.clientY,
              button: 2
            }));
          }
        });
      }

      const refreshNavMirrorResults = () => {
        if (document.activeElement !== mirror) {
          hideMirrorResults();
          return;
        }
        const q = (mirror.value || '').trim();
        if (!q) {
          hideMirrorResults();
          return;
        }
        const sourceList = document.getElementById('song-list');
        const sourceItems = sourceList && Array.isArray(sourceList._navMirrorItems)
          ? sourceList._navMirrorItems
          : Array.from(document.querySelectorAll('#song-list .song-item')).map((row) => ({
              row,
              title: row.querySelector('.search-title')?.textContent || row.querySelector('span')?.textContent?.trim() || row.textContent.trim(),
              snippet: row.querySelector('.search-snippet')?.textContent || '',
              active: row.classList.contains('active')
            }));
        if (!sourceItems.length) {
          hideMirrorResults();
          return;
        }
        const visibleItems = sourceItems.slice(0, 40);
        resultsBox._sourceItems = visibleItems;
        const frag = document.createDocumentFragment();
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'nav-mirror-close-btn';
        closeBtn.setAttribute('aria-label', 'Close search results');
        closeBtn.textContent = '×';
        frag.appendChild(closeBtn);
        visibleItems.forEach((srcItem, i) => {
          const row = document.createElement('div');
          row.className = 'song-item nav-mirror-result-item' + (srcItem.active ? ' active' : '');
          row.dataset.navResultIndex = String(i);
          const left = document.createElement('div');
          if (srcItem.snippet) {
            const title = document.createElement('span');
            title.className = 'search-title';
            title.textContent = srcItem.title || '';
            left.appendChild(title);
            const snippet = document.createElement('span');
            snippet.className = 'search-snippet';
            snippet.textContent = srcItem.snippet;
            left.appendChild(snippet);
          } else {
            left.textContent = srcItem.title || '';
          }
          row.appendChild(left);
          frag.appendChild(row);
        });
        resultsBox.replaceChildren(frag);
        resultsBox.style.display = resultsBox.children.length ? 'block' : 'none';
      };

      // Sync mirror → main on input
      mirror.addEventListener('input', () => {
        main.value = mirror.value;
        setMirrorBibleReferencePickerOpen(false);
        handleSearch();
        refreshNavMirrorResults();
      });

      mirror.addEventListener('focus', () => {
        refreshNavMirrorResults();
      });

      // Sync main → mirror on input
      main.addEventListener('input', () => {
        mirror.value = main.value;
        if (document.activeElement === mirror) refreshNavMirrorResults();
      });

      // Mirror Enter key for bible verse navigation
      mirror.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const items = Array.from(resultsBox.querySelectorAll('.nav-mirror-result-item'));
          if (resultsBox.style.display !== 'none' && mirrorResultIdx >= 0 && items[mirrorResultIdx]) {
            e.preventDefault();
            items[mirrorResultIdx].click();
            return;
          }
          // Temporarily set main value and trigger Enter handler
          main.value = mirror.value;
          handleSearchEnter({ key: 'Enter', preventDefault: () => e.preventDefault(), target: main });
        }
      });

      mirror.addEventListener('keydown', (e) => {
        const items = Array.from(resultsBox.querySelectorAll('.nav-mirror-result-item'));
        if (!items.length || resultsBox.style.display === 'none') return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          mirrorResultIdx = Math.min(mirrorResultIdx + 1, items.length - 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          mirrorResultIdx = Math.max(mirrorResultIdx - 1, 0);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          hideMirrorResults();
          return;
        } else {
          return;
        }
        items.forEach((el, i) => el.classList.toggle('ac-active', i === mirrorResultIdx));
        items[mirrorResultIdx]?.scrollIntoView({ block: 'nearest' });
      });
      mirror.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setMirrorBibleReferencePickerOpen(false);
      });

      // Mirror space-to-colon for bible
      mirror.addEventListener('keydown', (e) => {
        const isSpaceKey = (e.key === ' ' || e.key === 'Space' || e.key === 'Spacebar' || e.code === 'Space');
        if (isSpaceKey && sidebarTab === 'bible') {
          const cursorPos = mirror.selectionStart;
          const textBefore = mirror.value.substring(0, cursorPos);
          const textAfter = mirror.value.substring(cursorPos);
          const match = textBefore.match(/^([\p{L}1-3 ]+)\s+(\d+)$/u) ||
            textBefore.match(/^([\p{L}1-3 ]+?)(\d+)$/u);
          if (match) {
            let isValidBook = false;
            if (activeBibleVersion && bibles[activeBibleVersion]) {
              const bookCandidate = normalizeSearchText(match[1]).trim();
              const compactCandidate = bookCandidate.replace(/\s+/g, '');
              if (bookCandidate.length < 3) return;
              if (textAfter && !/^\s*$/.test(textAfter)) return;
              isValidBook = bibles[activeBibleVersion].some(c => {
                const bookPart = normalizeSearchText(c.title.split(' ').slice(0, -1).join(' '));
                const compactBookPart = bookPart.replace(/\s+/g, '');
                return bookPart === bookCandidate ||
                  (bookCandidate.length >= 3 && bookPart.startsWith(bookCandidate)) ||
                  compactBookPart === compactCandidate ||
                  (compactCandidate.length >= 3 && compactBookPart.startsWith(compactCandidate));
              });
              if (!isValidBook) {
                isValidBook = Object.values(BIBLE_BOOKS).some(b => {
                  const normalized = normalizeSearchText(b);
                  const compactNormalized = normalized.replace(/\s+/g, '');
                  return normalized === bookCandidate ||
                    (bookCandidate.length >= 3 && normalized.startsWith(bookCandidate)) ||
                    compactNormalized === compactCandidate ||
                    (compactCandidate.length >= 3 && compactNormalized.startsWith(compactCandidate));
                });
              }
            }
            if (isValidBook) {
              e.preventDefault();
              const after = mirror.value.substring(cursorPos);
              let displayBook = String(match[1] || '').trim().replace(/\s+/g, ' ');
              displayBook = displayBook.replace(/^([1-3])(?=\p{L})/u, '$1 ');
              const normalizedRefPrefix = `${displayBook} ${match[2]}`.trim();
              mirror.value = normalizedRefPrefix + ':' + after;
              mirror.selectionStart = mirror.selectionEnd = normalizedRefPrefix.length + 1;
              main.value = mirror.value;
              handleSearch();
              refreshNavMirrorResults();
            }
          }
        }
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('#nav-mirror-search') &&
            !e.target.closest('#nav-mirror-results') &&
            !e.target.closest('#nav-mirror-bible-ref-picker') &&
            !e.target.closest('#nav-mirror-ref-history-btn')) {
          hideMirrorResults();
          setMirrorBibleReferencePickerOpen(false);
        }
      });

      if (mirrorPinBtn) {
        mirrorPinBtn.onclick = () => {
          const ref = getCurrentBibleRefFromView();
          if (!ref) {
            showToast('No active Bible reference to pin');
            return;
          }
          pinBibleReference(ref);
          showToast(t('reference_pinned'));
        };
      }
      if (mirrorHistoryBtn) {
        mirrorHistoryBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          renderMirrorBibleReferencePicker();
          const picker = document.getElementById('nav-mirror-bible-ref-picker');
          const shouldOpen = !picker || picker.style.display === 'none';
          setMirrorBibleReferencePickerOpen(shouldOpen);
          if (shouldOpen) mirror.focus();
        };
      }

      window._refreshNavMirrorResults = refreshNavMirrorResults;
    }

    function bindLyricEditorShortcuts() {
      const editor = document.getElementById('lyric-editor');
      if (!editor || editor.dataset.shortcutsBound) return;
      editor.dataset.shortcutsBound = '1';
      // Ensure Ctrl/Cmd+A, C and V behave reliably inside the lyrics text area.
      // We prevent propagation (so the global handler doesn't run) and also
      // stop the default when we want to provide our own clipboard logic.
      editor.addEventListener('keydown', function(e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        const key = e.key.toLowerCase();
        if (key === 'a' || key === 'c' || key === 'v') {
          e.stopPropagation();
          // let the browser do the normal select/copy when possible; paste is
          // handled separately by the paste event listener below.  but to be
          // safe we also preventDefault so nothing else trips up.
          e.preventDefault();
        }
      });
      // Explicit paste via clipboardData for environments that block native paste
      editor.addEventListener('paste', function(e) {
        e.stopPropagation();
        const clipData = e.clipboardData || window.clipboardData;
        if (!clipData) return;
        const text = clipData.getData('text');
        if (!text) return;
        e.preventDefault();
        const start = this.selectionStart;
        const end = this.selectionEnd;
        this.value = this.value.substring(0, start) + text + this.value.substring(end);
        this.selectionStart = this.selectionEnd = start + text.length;
        saveCurrentItem();
      });
    }

    function bindTypingShortcutGuards() {
      const bindOne = (el) => {
        if (!el || el.dataset.typingShortcutGuardBound === '1') return;
        el.dataset.typingShortcutGuardBound = '1';
        el.addEventListener('keydown', (e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          const key = (e.key || '').toLowerCase();
          if (key === 'a' || key === 'c' || key === 'v' || key === 'x') {
            // Let native text editing shortcuts work; prevent global handlers from swallowing them.
            e.stopPropagation();
          }
        });
      };

      document.querySelectorAll('input, textarea, [contenteditable="true"]').forEach(bindOne);
      document.addEventListener('focusin', (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.matches('input, textarea, [contenteditable="true"]')) bindOne(t);
      });
    }

    function installNativeEditShortcutBypass() {
      if (window.__nativeEditShortcutBypassInstalled) return;
      window.__nativeEditShortcutBypassInstalled = true;
      window.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const key = String(e.key || '').toLowerCase();
        if (!(key === 'a' || key === 'c' || key === 'v' || key === 'x')) return;
        const t = e.target;
        if (!(t instanceof Element)) return;
        const isTypingTarget = !!(
          t.isContentEditable ||
          t.matches('input, textarea, [contenteditable="true"]') ||
          t.closest('input, textarea, [contenteditable="true"]')
        );
        if (!isTypingTarget) return;
        // In OBS Browser Source, some global keydown handlers can swallow native edit shortcuts.
        // Capture at window level and stop propagation so browser-native behavior still runs.
        if (key === 'a') {
          e.preventDefault();
          const activeEl = document.activeElement;
          if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
            try { activeEl.select(); } catch (_) {}
            return;
          }
          const ce = (activeEl instanceof Element && activeEl.isContentEditable)
            ? activeEl
            : (t instanceof Element ? t.closest('[contenteditable="true"]') : null);
          if (ce) {
            const sel = window.getSelection();
            if (sel) {
              const range = document.createRange();
              range.selectNodeContents(ce);
              sel.removeAllRanges();
              sel.addRange(range);
            }
            return;
          }
        }
        e.stopImmediatePropagation();
      }, true);
    }

    function _defaultBibleChapterIndex(versionId) {
      const list = (versionId && bibles[versionId]) ? bibles[versionId] : null;
      if (!Array.isArray(list) || !list.length) return -1;
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const parseChapter = (item) => {
        if (!item) return null;
        if (item.chapter != null && String(item.chapter).trim() !== '') {
          const n = parseInt(String(item.chapter), 10);
          if (!Number.isNaN(n)) return n;
        }
        const title = String(item.title || '').trim();
        const match = title.match(/(\d+)\s*$/);
        if (!match) return null;
        const n = parseInt(match[1], 10);
        return Number.isNaN(n) ? null : n;
      };
      const genesisAliases = new Set(['genesis', 'gen']);
      // Prefer Genesis 1 when present.
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (parseChapter(item) !== 1) continue;
        const bookName = norm(item.book || String(item.title || '').replace(/\s+\d+\s*$/, ''));
        if (!bookName) continue;
        if (genesisAliases.has(bookName) || bookName.startsWith('genesis ') || bookName.startsWith('gen ')) {
          return i;
        }
      }
      // Fallback to first chapter 1 (handles non-English imported Bibles).
      const chapterOneIdx = list.findIndex(item => parseChapter(item) === 1);
      if (chapterOneIdx !== -1) return chapterOneIdx;
      return 0;
    }

    function _updateAutocomplete() {
      const box = document.getElementById('search-autocomplete');
      const input = document.getElementById('song-search');
      if (!box || !input) return;
      if (sidebarTab !== 'bible' || !_acBooks.length) { box.style.display = 'none'; return; }
      const q = normalizeSearchText(input.value).trim();
      if (!q) {
        box.style.display = 'none';
        _acIdx = -1;
        return;
      }
      setBibleReferencePickerOpen(false);
      const referenceQuery = parseBibleReferenceQuery(q);
      if (referenceQuery) {
        if (!activeBibleVersion && Object.keys(bibles).length > 0) {
          activeBibleVersion = Object.keys(bibles)[0];
          renderVersionBar();
        }
        if (!activeBibleVersion || !bibles[activeBibleVersion]) {
          box.style.display = 'none';
          _acIdx = -1;
          return;
        }
        const verseMatches = findBibleReferenceMatches(referenceQuery, {
          versionId: activeBibleVersion
        });
        if (!verseMatches.length) {
          box.style.display = 'none';
          _acIdx = -1;
          return;
        }
        box.innerHTML = '';
        verseMatches.forEach((entry, i) => {
          const d = document.createElement('div');
          d.className = 'ac-item' + (i === _acIdx ? ' ac-active' : '');
          const text = document.createElement('span');
          text.className = 'ac-item-text';
          text.textContent = `${entry.book} ${entry.chapter}:${entry.verse}`;
          d.appendChild(text);
          d.title = entry.text || text.textContent;
          d.onmousedown = (e) => {
            e.preventDefault();
            input.value = `${entry.book} ${entry.chapter}:${entry.verse}`;
            box.style.display = 'none';
            _acIdx = -1;
            handleSearch();
            input.focus();
          };
          box.appendChild(d);
        });
        box.style.display = 'block';
        return;
      }
      const matches = _acBooks.filter(b => normalizeSearchText(b).startsWith(q));
      if (!matches.length || (matches.length === 1 && normalizeSearchText(matches[0]) === q)) {
        box.style.display = 'none'; _acIdx = -1; return;
      }
      box.innerHTML = '';
      matches.forEach((b, i) => {
        const d = document.createElement('div');
        d.className = 'ac-item' + (i === _acIdx ? ' ac-active' : '');
        const text = document.createElement('span');
        text.className = 'ac-item-text';
        text.textContent = b;
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'ac-item-pin';
        pin.textContent = 'P';
        pin.title = 'Pin this book';
        pin.onmousedown = (e) => e.preventDefault();
        pin.onclick = (e) => {
          e.stopPropagation();
          pinBibleReference({
            query: `${b} 1`,
            title: `${b} 1`,
            versionId: activeBibleVersion || null,
            ts: Date.now()
          });
          showToast('Pinned');
        };
        d.appendChild(text);
        d.appendChild(pin);
        d.onmousedown = (e) => {
          e.preventDefault();
          input.value = b + ' ';
          box.style.display = 'none';
          _acIdx = -1;
          handleSearch();
          input.focus();
        };
        box.appendChild(d);
      });
      box.style.display = 'block';
    }

    (function _initAcKeys() {
      document.addEventListener('keydown', (e) => {
        const box = document.getElementById('search-autocomplete');
        if (!box || box.style.display === 'none') return;
        const items = box.querySelectorAll('.ac-item');
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          _acIdx = Math.min(_acIdx + 1, items.length - 1);
          items.forEach((el, i) => el.classList.toggle('ac-active', i === _acIdx));
          items[_acIdx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          _acIdx = Math.max(_acIdx - 1, 0);
          items.forEach((el, i) => el.classList.toggle('ac-active', i === _acIdx));
          items[_acIdx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && _acIdx >= 0 && items[_acIdx]) {
          e.preventDefault();
          items[_acIdx].onmousedown(e);
        } else if (e.key === 'Escape') {
          box.style.display = 'none';
          setBibleReferencePickerOpen(false);
          _acIdx = -1;
        }
      });
      document.addEventListener('click', (e) => {
        const box = document.getElementById('search-autocomplete');
        const picker = document.getElementById('bible-ref-picker');
        if (box && !e.target.closest('.search-container')) {
          box.style.display = 'none';
          if (picker) picker.style.display = 'none';
          const historyBtn = document.getElementById('bible-ref-history-btn');
          if (historyBtn) historyBtn.classList.remove('active');
          _acIdx = -1;
        }
      });
    })();
    
    const THEME_ALIAS_MAP = Object.freeze({
      forest: 'neon-horizon',
      royal: 'midnight-bloom',
      daylight: 'paperlight',
      daylist: 'paperlight'
    });

    function normalizeThemeId(theme) {
      return THEME_ALIAS_MAP[theme] || theme;
    }

    function applyUiSnapshot(ui) {
      if (!ui) return;
      loadFocusedWorkspaceControlsFromUi(ui);
      loadProjectionSettingsProfilesFromUi(ui);
      applySetlistSettingsSnapshot(ui.setlistSettings);
      ltModeUserPresets = Array.isArray(ui.ltModeUserPresets)
        ? ui.ltModeUserPresets
            .filter((preset) => preset && typeof preset === 'object' && preset.values && typeof preset.values === 'object')
            .map((preset) => ({
              id: preset.id || `lt_preset_${Date.now()}`,
              name: String(preset.name || '').trim() || 'Untitled Preset',
              target: preset.target === 'songs' ? 'songs' : 'bible',
              values: (typeof normalizeLtPresetValues === 'function')
                ? normalizeLtPresetValues({
                    scalePct: 100,
                    ...preset.values
                  }, preset.target === 'songs' ? 'songs' : 'bible')
                : {
                    scalePct: 100,
                    ...preset.values
                  }
            }))
        : [];
      if (ui.hostMode) setHostMode(ui.hostMode, { silent: true });
      if (ui.vmix && typeof ui.vmix === 'object') {
        updateVmixSettings(ui.vmix, { silent: true });
      }
      if (ui.theme) {
        const themeSelect = document.getElementById('theme-select');
        const normalizedTheme = normalizeThemeId(ui.theme);
        if (themeSelect && themeSelect.value !== normalizedTheme) {
          themeSelect.value = normalizedTheme;
          handleThemeChange();
        }
      }
      if (ui.language) setLanguage(ui.language, { silent: true });
      applySidebarLayoutMode(ui.sidebarLayout || 'layout2', { persist: false });
      applyWorkspaceLayoutMode(ui.workspaceLayoutMode || 'focused', { persist: false });
      bibleRecentRefs = sanitizeBibleRefEntries(ui.bibleRecentRefs, MAX_BIBLE_RECENT_REFS);
      biblePinnedRefs = sanitizeBibleRefEntries(ui.biblePinnedRefs, MAX_BIBLE_PINNED_REFS);
      renderBibleReferencePicker();
      renderMirrorBibleReferencePicker();
      if (ui.fontFamily) document.getElementById('font-family').value = ui.fontFamily;
      if (ui.fontWeight) document.getElementById('font-weight').value = ui.fontWeight;
      // If there's an active bible and no explicit font set, suggest an appropriate font (fallback to CMGSans)
      if (!ui.fontFamily && activeBibleVersion && bibles[activeBibleVersion] && bibles[activeBibleVersion].length) {
        try {
          const sample = (bibles[activeBibleVersion][0] && bibles[activeBibleVersion][0].verseText) ? bibles[activeBibleVersion][0].verseText : (bibles[activeBibleVersion][0] && bibles[activeBibleVersion][0].text) ? bibles[activeBibleVersion][0].text : '';
          const suggested = detectScriptFromText(sample);
          if (suggested) {
            document.getElementById('font-family').value = suggested;
          } else {
            // No script-specific suggestion — prefer Montserrat by default
            document.getElementById('font-family').value = "'Montserrat',sans-serif";
          }
        } catch (e) {}
      }
      if (ui.fontSizeFull != null) document.getElementById('font-size-val').value = ui.fontSizeFull;
      if (typeof ui.fullTextTransform !== 'undefined') {
        updateFullTextTransformValue(ui.fullTextTransform);
      } else {
        updateFullTextTransformValue('uppercase');
      }
      ltFontSongs = (ui.ltFontSongs != null) ? ui.ltFontSongs : ltFontSongs;
      ltFontBible = (ui.ltFontBible != null) ? ui.ltFontBible : ltFontBible;
      ltFontCustom = (ui.ltFontCustom != null) ? ui.ltFontCustom : ltFontCustom;
      if (ui.refFontSize != null) document.getElementById('ref-font-size-val').value = ui.refFontSize;
      if (ui.refBgColor) {
        ltRefBgColor = ui.refBgColor;
        document.getElementById('ref-bg-color').value = ui.refBgColor;
        document.getElementById('ref-bg-color-hex').value = ui.refBgColor.toUpperCase();
      }
      if (ui.ltRefFontSize != null) {
        ltRefFontSize = Number(ui.ltRefFontSize) || ltRefFontSize;
        const ltRefInput = document.getElementById('ref-font-size-lt-val');
        if (ltRefInput) ltRefInput.value = ltRefFontSize;
      }
      if (typeof ui.ltTextTransform !== 'undefined') {
        ltTransformUserOverride = true;
        updateLtTextTransformValue(ui.ltTextTransform, { markUser: true });
      } else {
        ltTransformUserOverride = false;
        updateLtTextTransformValue('uppercase', { markUser: false });
      }
      if (ui.refBgEnabled != null) {
        setRefBgEnabled(!!ui.refBgEnabled, { silent: true });
      } else {
        setRefBgEnabled(true, { silent: true });
      }
      if (ui.referenceShadowEnabled != null) {
        setReferenceShadowEnabled(!!ui.referenceShadowEnabled, { silent: true });
      } else {
        setReferenceShadowEnabled(false, { silent: true });
      }
      if (ui.verseShadowEnabled != null) {
        setVerseShadowEnabled(!!ui.verseShadowEnabled, { silent: true });
      } else {
        setVerseShadowEnabled(false, { silent: true });
      }
      if (ui.referenceTextCapitalized != null) {
        setReferenceCapitalized(!!ui.referenceTextCapitalized, { silent: true });
      } else {
        setReferenceCapitalized(true, { silent: true });
      }
      fullHAlign = ui.hAlignFull || fullHAlign || 'center';
      fullRefHAlign = ui.hAlignFullRef || fullRefHAlign || 'center';
      fullVAlign = ui.vAlignFull || fullVAlign || 'middle';
      updateFullAlignButtons();
      if (ui.autoResizeFull) document.getElementById('auto-resize-full').value = ui.autoResizeFull;
      if (ui.autoResizeLT && document.getElementById('auto-resize-lt')) document.getElementById('auto-resize-lt').value = ui.autoResizeLT;
      if (ui.refPositionFull && document.getElementById('ref-position-full')) document.getElementById('ref-position-full').value = ui.refPositionFull;
      ltStyle = ui.ltStyle || ltStyle;
      autoAdjustLtHeight = ui.autoAdjustLtHeight !== undefined ? ui.autoAdjustLtHeight : autoAdjustLtHeight;
      document.getElementById('auto-adjust-lt-height').checked = autoAdjustLtHeight;
      if (ui.showVersion != null) document.getElementById('show-version').checked = ui.showVersion;
      if (ui.shortenBibleVersions != null) {
        document.getElementById('shorten-bible-versions').checked = ui.shortenBibleVersions;
      } else {
        document.getElementById('shorten-bible-versions').checked = true;
      }
      if (ui.shortenBibleBooks != null) document.getElementById('shorten-bible-books').checked = ui.shortenBibleBooks;
      const songSolfaToggle = document.getElementById('show-song-solfa-notes');
      if (songSolfaToggle) songSolfaToggle.checked = ui.showSongSolfaNotes !== false;
      const songCategoryToggle = document.getElementById('show-song-category-name');
      if (songCategoryToggle) songCategoryToggle.checked = ui.showSongCategoryName !== false;
      const songSectionToggle = document.getElementById('display-song-sections');
      if (songSectionToggle) songSectionToggle.checked = ui.displaySongSections === true;
      if (ui.showVerseNos != null) document.getElementById('show-verse-nos').checked = ui.showVerseNos;
    if (ui.versionSwitchUpdatesLive != null) {
      versionSwitchUpdatesLive = !!ui.versionSwitchUpdatesLive;
      const versionToggle = document.getElementById('version-switch-updates-live');
      if (versionToggle) versionToggle.checked = versionSwitchUpdatesLive;
    }
    if (ui.dualVersionModeEnabled != null) {
      setDualVersionModeEnabled(!!ui.dualVersionModeEnabled, { silent: true });
    }
    if (ui.dualVersionSecondaryId != null) {
      setDualVersionSecondaryId(ui.dualVersionSecondaryId, { silent: true });
    }
      if (ui.songTransitionType) document.getElementById('song-transition-type').value = ui.songTransitionType;
      if (ui.songTransitionDuration != null) document.getElementById('song-transition-duration').value = ui.songTransitionDuration;
      if (ui.animateBgTransitions != null) document.getElementById('animate-bg-transitions').checked = !!ui.animateBgTransitions;
      if (ui.ltStyles) {
        let incomingStyles = ui.ltStyles;
        if (typeof incomingStyles === 'string') {
          try {
            incomingStyles = JSON.parse(incomingStyles);
          } catch (e) {
            incomingStyles = null;
          }
        }
        if (incomingStyles && typeof incomingStyles === 'object') {
          ltStyles = Object.assign({}, ltStyles, incomingStyles);
        }
      }
      if (ltStyles.custom && !ltStyles.custom.nameKey) ltStyles.custom.nameKey = 'style_name_custom_green';
      if (ltStyles.default) delete ltStyles.default;
      if (!ltStyles[ltStyle]) ltStyle = 'custom';
      customFonts = Array.isArray(ui.customFonts) ? ui.customFonts : customFonts;
      customFonts.forEach(f => injectFontFace(f));
      document.getElementById('font-upload-hint').innerText = customFonts.length
        ? t(customFonts.length > 1 ? 'settings_custom_fonts_loaded_plural' : 'settings_custom_fonts_loaded').replace('{count}', String(customFonts.length))
        : t('settings_no_custom_font_loaded');
      renderFontFamilyOptions(ui.fontFamily || document.getElementById('font-family').value);
      if (ui.bgType) document.getElementById('bg-type').value = ui.bgType;
      if (ui.bgImageSource) document.getElementById('bg-image-source').value = ui.bgImageSource;
      if (ui.bgImageUrl != null) document.getElementById('bg-image-url').value = ui.bgImageUrl;
      if (ui.bgUploadDataUrl != null) bgUploadDataUrl = ui.bgUploadDataUrl;
      if (ui.bgVideoSource) document.getElementById('bg-video-source').value = ui.bgVideoSource;
      if (ui.bgVideoUrl != null) document.getElementById('bg-video-url').value = ui.bgVideoUrl;
      if (ui.bgVideoUploadDataUrl != null) bgVideoUploadDataUrl = ui.bgVideoUploadDataUrl;
      if (ui.bgVideoLoop != null) document.getElementById('bg-video-loop').checked = !!ui.bgVideoLoop;
      if (ui.bgVideoSpeed != null) document.getElementById('bg-video-speed').value = ui.bgVideoSpeed;
      if (ui.bgColor) document.getElementById('bg-color-quick').value = ui.bgColor;
      if (ui.bgGradientShadow) {
        bgGradientShadow = ui.bgGradientShadow;
        document.getElementById('bg-color-shadow').value = ui.bgGradientShadow;
      }
      if (ui.bgGradientHighlight) {
        bgGradientHighlight = ui.bgGradientHighlight;
        document.getElementById('bg-color-highlight').value = ui.bgGradientHighlight;
      }
      if (ui.bgMode) setBgMode(ui.bgMode, { silent: true });
      else updateBgModeUi();
      document.getElementById('bg-upload-hint').innerText = bgUploadDataUrl ? t('settings_image_selected') : t('settings_no_image_selected');
      document.getElementById('bg-video-upload-hint').innerText = bgVideoUploadDataUrl ? t('settings_video_selected') : t('settings_no_video_selected');
      if (ui.bgBlur != null) document.getElementById('bg-blur').value = ui.bgBlur;
      if (ui.bgEdgeFix) document.getElementById('bg-edge-fix').value = ui.bgEdgeFix;
      if (ui.bgOpacityFull != null) {
        const fullVal = parseInt(ui.bgOpacityFull, 10);
        if (!Number.isNaN(fullVal)) bgOpacityFull = Math.max(0, Math.min(100, fullVal));
      }
      if (ui.bgOpacityLT != null) {
        const ltVal = parseInt(ui.bgOpacityLT, 10);
        if (!Number.isNaN(ltVal)) bgOpacityLT = Math.max(0, Math.min(100, ltVal));
      }
      if (ui.bgOpacity != null && ui.bgOpacityFull == null && ui.bgOpacityLT == null) {
        const legacyVal = parseInt(ui.bgOpacity, 10);
        if (!Number.isNaN(legacyVal)) {
          const clamped = Math.max(0, Math.min(100, legacyVal));
          bgOpacityFull = clamped;
          bgOpacityLT = clamped;
        }
      }
      if (ui.bgY != null) document.getElementById('bg-y').value = ui.bgY;
      if (ui.textX != null) {
        const textXEl = document.getElementById('text-x');
        if (textXEl) textXEl.value = ui.textX;
      }
      if (ui.textY != null) {
        const textYEl = document.getElementById('text-y');
        if (textYEl) textYEl.value = ui.textY;
      }
      const padLrFullEl = document.getElementById('pad-lr-full');
      const padLrLtEl = document.getElementById('pad-lr-lt');
      if (ui.padLRFull != null) {
        if (padLrFullEl) padLrFullEl.value = ui.padLRFull;
      } else if (ui.padLR != null && padLrFullEl) {
        padLrFullEl.value = ui.padLR;
      }
      if (ui.padLRLT != null) {
        if (padLrLtEl) padLrLtEl.value = ui.padLRLT;
      } else if (ui.padLR != null && padLrLtEl) {
        padLrLtEl.value = ui.padLR;
      }
      if (ui.padB != null) {
        const padBEl = document.getElementById('pad-b');
        if (padBEl) padBEl.value = ui.padB;
      }
      if (ui.showVersion != null) document.getElementById('show-version').checked = ui.showVersion;
      if (ui.shortenBibleVersions != null) {
        document.getElementById('shorten-bible-versions').checked = ui.shortenBibleVersions;
      } else {
        document.getElementById('shorten-bible-versions').checked = true;
      }
      if (ui.shortenBibleBooks != null) document.getElementById('shorten-bible-books').checked = ui.shortenBibleBooks;
      populateSongTranslationLanguageOptions();
      document.getElementById('song-bilingual-enabled').checked = !!ui.songBilingualEnabled;
      document.getElementById('song-display-mode').value = String(ui.songDisplayMode || DEFAULT_SONG_BILINGUAL_SETTINGS.displayMode);
      document.getElementById('song-translation-mode').value = String(ui.songTranslationMode || DEFAULT_SONG_BILINGUAL_SETTINGS.translationMode);
      document.getElementById('song-auto-translate-import').checked = ui.songAutoTranslateOnImport !== false;
      document.getElementById('song-auto-translate-open').checked = ui.songAutoTranslateOnOpen !== false;
      document.getElementById('song-translation-language').value = String(ui.songTargetLanguage || DEFAULT_SONG_BILINGUAL_SETTINGS.targetLanguage);
      document.getElementById('song-translation-source-language').value = String(ui.songSourceLanguage || DEFAULT_SONG_BILINGUAL_SETTINGS.sourceLanguage);
      document.getElementById('song-secondary-font-scale').value = String(ui.songSecondaryFontScale || DEFAULT_SONG_BILINGUAL_SETTINGS.secondaryFontScale);
      document.getElementById('song-cache-translations').checked = ui.songCacheTranslationsLocally !== false;
      document.getElementById('song-free-translation-api-url').value = String(ui.songFreeTranslationApiUrl || DEFAULT_SONG_BILINGUAL_SETTINGS.freeTranslationApiUrl);
      document.getElementById('song-translation-api-url').value = String(ui.songTranslationApiUrl || DEFAULT_SONG_BILINGUAL_SETTINGS.translationApiUrl);
      document.getElementById('song-translation-api-key').value = String(ui.songTranslationApiKey || DEFAULT_SONG_BILINGUAL_SETTINGS.translationApiKey);
      updateSongTranslationModeUi();
      setSongTranslationProviderStatus('Not tested', 'muted');
      if (ui.showVerseNos != null) document.getElementById('show-verse-nos').checked = ui.showVerseNos;
      if (ui.textColor) {
        document.getElementById('text-color').value = ui.textColor;
        document.getElementById('text-color-hex').value = ui.textColor.toUpperCase();
      }
      if (ui.refColor) {
        document.getElementById('ref-color').value = ui.refColor;
        document.getElementById('ref-color-hex').value = ui.refColor.toUpperCase();
      }
      if (ui.linesPerPage != null) linesPerPage = ui.linesPerPage;
      if (ui.activeRatio) activeRatio = ui.activeRatio;
      if (activeRatio === 'custom') activeRatio = 'full';
      if (ui.lineHeightFull) document.getElementById('line-height-full').value = ui.lineHeightFull;
      if (ui.lineHeightLT) document.getElementById('line-height-lt').value = ui.lineHeightLT;
      if (ui.ltWidthPct != null) {
        const ltWidthEl = document.getElementById('lt-width-pct');
        if (ltWidthEl) ltWidthEl.value = ui.ltWidthPct;
        const ltWidthValueEl = document.getElementById('lt-width-pct-value');
        if (ltWidthValueEl) ltWidthValueEl.textContent = `${ui.ltWidthPct}%`;
      }
      if (ui.ltScalePct != null) {
        const ltScaleEl = document.getElementById('lt-scale-pct');
        if (ltScaleEl) ltScaleEl.value = ui.ltScalePct;
        const ltScaleValueEl = document.getElementById('lt-scale-pct-value');
        if (ltScaleValueEl) ltScaleValueEl.textContent = `${ui.ltScalePct}%`;
      }
      if (ui.ltOffsetY != null) {
        const ltOffsetEl = document.getElementById('lt-offset-y');
        if (ltOffsetEl) ltOffsetEl.value = ui.ltOffsetY;
      }
      if (ui.ltOffsetX != null) {
        const ltOffsetXEl = document.getElementById('lt-offset-x');
        if (ltOffsetXEl) ltOffsetXEl.value = ui.ltOffsetX;
      }
      if (ui.ltBorderRadius != null) {
        const ltRadiusEl = document.getElementById('lt-border-radius');
        if (ltRadiusEl) ltRadiusEl.value = ui.ltBorderRadius;
        const ltRadiusValueEl = document.getElementById('lt-border-radius-value');
        if (ltRadiusValueEl) ltRadiusValueEl.textContent = `${ui.ltBorderRadius}px`;
      }
      const hasBgToggle = (ui.bgToggle != null);
      if (hasBgToggle) document.getElementById('bg-toggle').checked = ui.bgToggle;
      updateBgModePicker();
      // Restore lower-third alignment settings (song vs bible)
      ltHAlignSongs = (ui.hAlignLTSongs != null) ? ui.hAlignLTSongs : ltHAlignSongs;
      ltVAlignSongs = (ui.vAlignLTSongs != null) ? ui.vAlignLTSongs : ltVAlignSongs;
      ltAnchorMode = (ui.ltAnchorMode === 'top') ? 'top' : 'bottom';
      ltHAlignBible = (ui.hAlignLTBible != null) ? ui.hAlignLTBible : ltHAlignBible;
      ltVAlignBible = (ui.vAlignLTBible != null) ? ui.vAlignLTBible : ltVAlignBible;
      ltHAlignBibleVerse = (ui.hAlignLTBibleVerse != null) ? ui.hAlignLTBibleVerse : ltHAlignBibleVerse;
      setLtFontInputValue(getEffectiveLtFont());
      updateLtAlignButtons();
      document.getElementById('font-size-custom-val').value = ltFontCustom;
      handleBgTypeChange();
      handleBgImageSourceChange();
      renderLtStylePicker();
      document.querySelectorAll('#line-picker .seg-btn').forEach(b => b.classList.toggle('active', b.id === 'line-' + linesPerPage));
      document.getElementById('ratio-full').classList.toggle('active', activeRatio === 'full');
      document.getElementById('ratio-lt').classList.toggle('active', activeRatio === '16-9');
      document.getElementById('ratio-custom').classList.toggle('active', activeRatio === 'custom');
      updateLinePickerAvailability();
      updateCustomModeAvailability();
      updateTextEditorModeAvailability();
      if (typeof updateWorkspaceFontSizeControl === 'function') updateWorkspaceFontSizeControl();
      updateSettingsTargetControl();
      applyProjectionSettingsProfileForTab(getEffectiveSettingsTargetTab(), { triggerChange: false });
      if (activeRatio === '16-9' && !hasBgToggle) applyLtBgDefaultForTab(sidebarTab);
      if (ui.remoteShowEnabled != null) {
        const toggle = document.getElementById('remote-show-toggle');
        if (toggle) toggle.checked = !!ui.remoteShowEnabled;
      }
      if (ui.remoteShowUseHostname != null) {
        const useHostname = document.getElementById('remote-show-use-hostname');
        if (useHostname) useHostname.checked = !!ui.remoteShowUseHostname;
      }
      if (ui.remoteShowHost != null) {
        const hostInput = document.getElementById('remote-show-host');
        if (hostInput) hostInput.value = ui.remoteShowHost;
      }
      if (ui.remoteShowPort != null) {
        const portInput = document.getElementById('remote-show-port');
        if (portInput) portInput.value = ui.remoteShowPort;
      }
      if (ui.remoteShowRelayHost != null) {
        const relayHostInput = document.getElementById('remote-show-relay-host');
        if (relayHostInput) relayHostInput.value = ui.remoteShowRelayHost;
      }
      if (ui.remoteShowRelayPort != null) {
        const relayPortInput = document.getElementById('remote-show-relay-port');
        if (relayPortInput) relayPortInput.value = ui.remoteShowRelayPort;
      }
      if (ui.remoteShowPairCode != null) {
        const pairCodeInput = document.getElementById('remote-show-pair-code');
        if (pairCodeInput) pairCodeInput.value = String(ui.remoteShowPairCode || '').slice(0, 32);
      }
      ensureRemoteShowCredentials();
      syncRemoteShowHostMode();
      updateRemoteShowDetails();
      connectRelay();
      restoreVmixSettingsUi();
      applyHostModeUi();
      handleDualFontOverrideState({ suppressLiveUpdate: true });
      syncBgOpacitySlider();
      renderVersionBar();
      renderSongs();
      enforceBibleModeRules();
      configureImportAccept();
      updateSearchPlaceholder();
      initializeAllSliders();
      updateLtBibleVerseAlignVisibility();
      updateSongTextTransformControl();
    }
    
    function setPresetPopoverOpen(nextOpen, opts = {}) {
      const pop = document.getElementById('preset-popover');
      const btn = document.getElementById('btn-preset');
      if (!pop || !btn) return;
      if (pop.parentElement !== document.body) document.body.appendChild(pop);
      presetPopoverOpen = !!nextOpen;
      pop.classList.toggle('open', presetPopoverOpen);
      if (presetPopoverOpen) {
        syncPresetPopoverHeight();
        positionPresetPopover();
      } else {
        pop.style.height = '';
        pop.style.minHeight = '';
        pop.style.maxHeight = '';
      }
      if (opts.persist !== false && typeof saveFocusedWorkspaceControlsForTab === 'function' && typeof isFocusedWorkspaceMode === 'function' && isFocusedWorkspaceMode()) {
        saveFocusedWorkspaceControlsForTab(sidebarTab);
        if (typeof saveToStorageDebounced === 'function') saveToStorageDebounced();
      }
    }

    function togglePresetPopover() {
      if (typeof updateWorkspaceStateLabels === 'function') updateWorkspaceStateLabels();
      setPresetPopoverOpen(!presetPopoverOpen);
    }

    function measureDualVersionPanelHeight() {
      const sourcePanel = document.getElementById('dual-version-panel');
      if (!sourcePanel) return null;
      const clone = sourcePanel.cloneNode(true);
      clone.id = '';
      clone.classList.add('open');
      clone.style.visibility = 'hidden';
      clone.style.pointerEvents = 'none';
      clone.style.left = '-9999px';
      clone.style.top = '-9999px';
      clone.style.display = 'flex';
      const sourceRow = document.getElementById('dual-version-select-row');
      const cloneRow = clone.querySelector('#dual-version-select-row');
      if (cloneRow) {
        cloneRow.id = '';
        cloneRow.style.display = 'flex';
      }
      const cloneToggle = clone.querySelector('#dual-version-mode-toggle');
      if (cloneToggle) {
        cloneToggle.id = '';
        cloneToggle.checked = true;
      }
      document.body.appendChild(clone);
      const measuredHeight = Math.ceil(clone.getBoundingClientRect().height);
      clone.remove();
      return measuredHeight || null;
    }

    function syncPresetPopoverHeight() {
      const pop = document.getElementById('preset-popover');
      if (!pop) return;
      pop.style.height = '';
      pop.style.minHeight = '';
      pop.style.maxHeight = '';
      const matchedHeight = measureDualVersionPanelHeight();
      if (matchedHeight) {
        pop.style.height = `${matchedHeight}px`;
        pop.style.minHeight = `${matchedHeight}px`;
        pop.style.maxHeight = `${matchedHeight}px`;
      }
    }

    function positionPresetPopover() {
      const pop = document.getElementById('preset-popover');
      const btn = document.getElementById('btn-preset');
      if (!pop || !btn) return;
      const rect = btn.getBoundingClientRect();
      const popWidth = pop.offsetWidth || 280;
      const viewportWidth = window.innerWidth;
      const center = rect.left + (rect.width / 2);
      const desiredLeft = center - (popWidth / 2);
      const leftPos = Math.min(Math.max(8, desiredLeft), Math.max(8, viewportWidth - popWidth - 8));
      pop.style.top = `${Math.round(rect.bottom + 8)}px`;
      pop.style.left = `${Math.round(leftPos)}px`;
    }

    function positionPopover(pop, btn) {
      if (!pop || !btn) return;
      const rect = btn.getBoundingClientRect();
      const popWidth = pop.offsetWidth || 320;
      const viewportWidth = window.innerWidth;
      const center = rect.left + (rect.width / 2);
      const desiredLeft = center - (popWidth / 2);
      const leftPos = Math.min(Math.max(8, desiredLeft), Math.max(8, viewportWidth - popWidth - 8));
      pop.style.top = `${rect.bottom + 6}px`;
      pop.style.left = `${leftPos}px`;
    }

    function renderOutputScreenPopover() {
      const host = document.getElementById('output-screen-list-popover');
      if (!host) return;
      const list = Array.isArray(outputScreenList) ? outputScreenList : [];
      if (!list.length) {
        host.innerHTML = '<div class="placeholder">No display found</div>';
        return;
      }
      host.innerHTML = '';
      list.forEach((screen) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'output-screen-option';
        const typeLabel = screen.isInternal ? 'Internal' : 'External';
        const primaryLabel = screen.isPrimary ? ' • Primary' : '';
        btn.innerHTML = `
          <strong>${screen.label || 'Display'}</strong>
          <span class="output-screen-meta">${typeLabel}${primaryLabel} • ${screen.width}x${screen.height}</span>
        `;
        btn.onclick = () => openStandaloneOutputOnScreen(screen.id);
        host.appendChild(btn);
      });
    }

    async function toggleOutputPopover() {
      const pop = document.getElementById('output-popover');
      const btn = document.getElementById('btn-open-standalone-output');
      if (!pop || !btn) return;
      if (outputPopoverOpen) {
        pop.classList.remove('open');
        outputPopoverOpen = false;
        return;
      }
      const host = document.getElementById('output-screen-list-popover');
      if (host) host.innerHTML = `<div class="placeholder">${esc(t('output_detecting_displays'))}</div>`;
      positionPopover(pop, btn);
      pop.classList.add('open');
      outputPopoverOpen = true;
      await refreshOutputScreenList({ forcePrompt: true }).catch(() => {});
      renderOutputScreenPopover();
      positionPopover(pop, btn);
    }

    async function openStandaloneOutputOnScreen(screenId) {
      const select = document.getElementById('output-screen-select');
      if (select && screenId) select.value = screenId;
      const chosen = (Array.isArray(outputScreenList) ? outputScreenList : []).find(s => s.id === screenId);
      if (outputLiveActive) {
        const opened = await openStandaloneOutputWindow({ moveAfterOpen: true });
        if (!opened) return;
        if (isLive && livePointer) pushLiveUpdate();
        showToast(chosen
          ? t('output_live_moved_to_display').replace('{display}', chosen.label || 'selected display')
          : t('output_live_moved'));
      } else {
        showToast(chosen
          ? t('output_selected_display').replace('{display}', chosen.label || 'output screen')
          : t('output_screen_selected'));
      }
      const pop = document.getElementById('output-popover');
      if (pop) pop.classList.remove('open');
      outputPopoverOpen = false;
    }
    
    function injectFontFace(font) {
      if (!font || !font.name || !font.dataUrl || loadedFontNames.has(font.name)) return;
      const style = document.createElement('style');
      style.innerHTML = `@font-face{font-family:'${font.name}';src:url('${font.dataUrl}') format('truetype');font-display:swap;}`;
      document.head.appendChild(style);
      loadedFontNames.add(font.name);
    }
    
    function renderCustomFontList() {
      const list = document.getElementById('custom-font-list');
      if (!list) return;
      list.innerHTML = '';
      if (!customFonts.length) {
        const empty = document.createElement('div');
        empty.style.color = 'var(--text-secondary)';
        empty.style.fontSize = '11px';
        empty.innerText = t('settings_no_custom_fonts_loaded');
        list.appendChild(empty);
        return;
      }
      customFonts.forEach(font => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.padding = '6px 0';
        row.style.fontSize = '12px';
        row.style.color = 'var(--text)';
        row.innerText = font.name;
        list.appendChild(row);
      });
    }
    
    function renderFontFamilyOptions(selectedValue) {
      const select = document.getElementById('font-family');
      if (!select) return;
      const current = selectedValue || select.value;
      select.innerHTML = '';
      [...baseFontOptions].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        select.appendChild(o);
      });
      customFonts.forEach(font => {
        const o = document.createElement('option');
        o.value = `'${font.name}',sans-serif`;
        o.textContent = font.name;
        select.appendChild(o);
      });
      if (current) select.value = current;
      if (!select.value && select.options.length) select.value = select.options[0].value;
      renderCustomFontList();
    }

    function saveState(label) {
      const state = {
        label: label || '',
        songs: JSON.parse(JSON.stringify(songs)),
        bibles: JSON.parse(JSON.stringify(bibles)),
        schedule: JSON.parse(JSON.stringify(schedule)),
        /* Scene / source state (guarded for early calls before scene system inits) */
        scenes: (typeof _serializeScenes === 'function' && typeof _scenes !== 'undefined') ? _serializeScenes() : null,
        activeSceneId: (typeof _activeSceneId !== 'undefined') ? _activeSceneId : null,
        sceneIdCounter: (typeof _sceneIdCounter !== 'undefined') ? _sceneIdCounter : 0,
        sourceIdCounter: (typeof _sourceIdCounter !== 'undefined') ? _sourceIdCounter : 0,
      };
      if (historyIndex < historyStates.length - 1) {
        historyStates = historyStates.slice(0, historyIndex + 1);
      }
      historyStates.push(state);
      if (historyStates.length > 50) {
        historyStates.shift();
        /* shift removed index 0, so historyIndex stays the same (the new item is now at the old last index) */
      } else {
        historyIndex++;
      }
    }

    function _undoRestoreScenes(state) {
      if (!state.scenes || typeof _restoreScenes !== 'function') return;
      try { _restoreScenes(state.scenes, state.activeSceneId, state.sceneIdCounter, state.sourceIdCounter); } catch (e) { console.warn('[Undo] scene restore error:', e); }
    }

    function undoAction() {
      if (historyIndex > 0) {
        historyIndex--;
        const state = historyStates[historyIndex];
        songs = JSON.parse(JSON.stringify(state.songs));
        bibles = JSON.parse(JSON.stringify(state.bibles));
        schedule = JSON.parse(JSON.stringify(state.schedule));
        _undoRestoreScenes(state);
        renderSongs();
        updateButtonView();
        saveToStorageDebounced();
        const msg = state.label ? t('common_undo_named').replace('{label}', state.label) : t('common_undo_successful');
        showToast(msg);
      } else {
        showToast(t('common_nothing_to_undo'));
      }
    }

    function redoAction() {
      if (historyIndex < historyStates.length - 1) {
        historyIndex++;
        const state = historyStates[historyIndex];
        songs = JSON.parse(JSON.stringify(state.songs));
        bibles = JSON.parse(JSON.stringify(state.bibles));
        schedule = JSON.parse(JSON.stringify(state.schedule));
        _undoRestoreScenes(state);
        renderSongs();
        updateButtonView();
        saveToStorageDebounced();
        const msg = state.label ? t('common_redo_named').replace('{label}', state.label) : t('common_redo_successful');
        showToast(msg);
      } else {
        showToast(t('common_nothing_to_redo'));
      }
    }

    function initializeDefaultStyles() {
      ltStyles['custom'] = {
        name: 'Signature',
        nameKey: 'style_name_custom_green',
        type: 'custom',
        deletable: false,
        refBox: {
          bgColor: '#00411C',
          borderColor: '#FFFFFF',
          borderRadius: 10,
          borderWidth: 2,
          width: 530,
          height: 95,
          x: 30,
          yOffset: -100,
          opacity: 0.95
        },
        mainBar: {
          gradientStart: '#AD0000',
          gradientEnd: '#000000',
          minHeight: 240,
          width: 1920,
          yOffset: 220,
          padding: 10,
          hAlign: 'left',
          vAlign: 'middle',
          opacity: 0.95
        },
        textPropsMain: {
          lineSpacing: 1.1,
          textTransform: 'none',
          textAlign: 'left',
          offsetX: 0,
          offsetY: 0,
          singleLine: false
        },
        textPropsRef: {
          lineSpacing: 1.2,
          textTransform: 'none',
          textAlign: 'center',
          offsetX: 0,
          offsetY: 0,
          singleLine: true
        },
        shadow: {
          color: '#000000',
          opacity: 0.8,
          blur: 8,
          offsetX: 2,
          offsetY: 2
        },
        autoResize: 'grow'
      };
    }

    function handleFontUpload(input) {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = () => {
          const baseName = (file.name || 'Custom Font').replace(/\.[^.]+$/, '') || 'Custom Font';
          let finalName = baseName;
          let suffix = 2;
          while (customFonts.some(f => f.name === finalName)) {
            finalName = `${baseName} (${suffix++})`;
          }
          const fontEntry = {
            id: `font_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: finalName,
            dataUrl: reader.result
          };
          customFonts.push(fontEntry);
          injectFontFace(fontEntry);
          renderFontFamilyOptions(`'${finalName}',sans-serif`);
          document.getElementById('font-upload-hint').innerText = `${customFonts.length} custom font${customFonts.length > 1 ? 's' : ''} loaded`;
          saveToStorageDebounced();
          showToast(t('font_loaded_named').replace('{name}', finalName));
        };
        reader.readAsDataURL(file);
      });
      input.value = '';
    }

    function syncTextColorFromPicker() {
      const v = document.getElementById('text-color').value;
      document.getElementById('text-color-hex').value = v.toUpperCase();
    }
    
    function syncTextColorFromHex() {
      const v = (document.getElementById('text-color-hex').value || "").trim();
      if (/^#([0-9a-fA-F]{6})$/.test(v)) {
        document.getElementById('text-color').value = v;
      }
    }
    
    function syncRefColorFromPicker() {
      const v = document.getElementById('ref-color').value;
      document.getElementById('ref-color-hex').value = v.toUpperCase();
    }
    
    function syncRefColorFromHex() {
      const v = (document.getElementById('ref-color-hex').value || "").trim();
      if (/^#([0-9a-fA-F]{6})$/.test(v)) {
        document.getElementById('ref-color').value = v;
      }
    }

    function syncRefBgColorFromPicker() {
      const v = document.getElementById('ref-bg-color').value;
      document.getElementById('ref-bg-color-hex').value = v.toUpperCase();
      ltRefBgColor = v;
    }
    
    function syncRefBgColorFromHex() {
      const v = (document.getElementById('ref-bg-color-hex').value || "").trim();
      if (/^#([0-9a-fA-F]{6})$/.test(v)) {
        document.getElementById('ref-bg-color').value = v;
        ltRefBgColor = v;
      }
    }

    // Detect predominant script in a sample text and return a suggested font-family value
    function detectScriptFromText(text) {
      if (!text || !text.length) return null;
      const t = String(text).trim();
      const ranges = {
        devanagari: /[\u0900-\u097F]/,
        bengali: /[\u0980-\u09FF]/,
        gurmukhi: /[\u0A00-\u0A7F]/,
        gujarati: /[\u0A80-\u0AFF]/,
        oriya: /[\u0B00-\u0B7F]/,
        tamil: /[\u0B80-\u0BFF]/,
        telugu: /[\u0C00-\u0C7F]/,
        kannada: /[\u0C80-\u0CFF]/,
        malayalam: /[\u0D00-\u0D7F]/,
        sinhala: /[\u0D80-\u0DFF]/,
        arabic: /[\u0600-\u06FF\u0750-\u077F]/,
        cjk: /[\u4E00-\u9FFF\u3400-\u4DBF]/
      };

      if (ranges.devanagari.test(t)) return "'Noto Sans Devanagari',sans-serif";
      if (ranges.bengali.test(t)) return "'Noto Sans Bengali',sans-serif";
      if (ranges.gurmukhi.test(t)) return "'Noto Sans Gurmukhi',sans-serif";
      if (ranges.gujarati.test(t)) return "'Noto Sans Gujarati',sans-serif";
      if (ranges.oriya.test(t)) return "'Noto Sans Oriya',sans-serif";
      if (ranges.tamil.test(t)) return "'Noto Sans Tamil',sans-serif";
      if (ranges.telugu.test(t)) return "'Noto Sans Telugu',sans-serif";
      if (ranges.kannada.test(t)) return "'Noto Sans Kannada',sans-serif";
      if (ranges.malayalam.test(t)) return "'Noto Sans Malayalam',sans-serif";
      if (ranges.sinhala.test(t)) return "'Noto Sans Sinhala',sans-serif";
      if (ranges.arabic.test(t)) return "'Noto Sans Arabic',sans-serif";
      if (ranges.cjk.test(t)) return "'Noto Sans SC',sans-serif";
      return null;
    }

    function detectFontForCurrentBible() {
      if (!activeBibleVersion || !bibles[activeBibleVersion] || !bibles[activeBibleVersion].length) {
        showToast(t('bible_no_version_loaded_detect'));
        return;
      }
      const sampleItem = bibles[activeBibleVersion].find(it => (it.text || it.verseText));
      const sample = sampleItem ? (sampleItem.verseText || sampleItem.text || '') : '';
      const suggested = detectScriptFromText(sample);
      if (suggested) {
        document.getElementById('font-family').value = suggested;
        showToast(t('bible_suggested_font').replace('{font}', suggested.replace(/,.+$/,'').replace(/'|\\'/g,'').trim()));
      } else {
        // Fallback to Montserrat when nothing specific found
        document.getElementById('font-family').value = "'Montserrat',sans-serif";
        showToast(t('bible_no_script_default_montserrat'));
      }
      onAnyControlChange();
      projectLive();
    }
    function updateStyleEditorMeta(style) {
      const kindEl = document.getElementById('style-editor-kind');
      if (kindEl) {
        const typeKey = `style_editor_type_${(style?.type || 'custom').toLowerCase()}`;
        const typeText = t(typeKey);
        if (typeText && typeText !== typeKey) {
          kindEl.innerText = typeText;
        } else {
          const typeLabel = t('style_editor_type_label');
          const typeValue = (style?.type || 'custom').toUpperCase();
          kindEl.innerText = typeLabel.replace('{type}', typeValue);
        }
      }
      const select = document.getElementById('style-editor-select');
      if (select && style) {
        const sid = style.id || editingStyleId || ltStyle;
        if (sid && ltStyles[sid]) select.value = sid;
      }
    }

    function openCurrentStyleEditor() {
      const target = (ltStyle && ltStyles[ltStyle]) ? ltStyle : 'custom';
      openStyleEditor(target);
    }

    function openStyleEditor(styleId) {
      const safeId = (styleId && ltStyles[styleId]) ? styleId : 'custom';
      editingStyleId = safeId;
      const baseStyle = ltStyles[safeId] || ltStyles['custom'] || {};
      const style = { ...baseStyle, id: safeId };
      renderStyleEditorSelect(safeId);
      updateStyleEditorMeta(style);
      // If a Bible verse is currently active, reflect it in the preview
      const previewRefTextEl = document.getElementById('previewRefText');
      const previewMainTextEl = document.getElementById('previewMainText');
      const previewVerseTextEl = document.getElementById('previewVerseText');
      let previewRef = t('preview_ref_default');
      let previewVer = t('preview_version_default');
      let previewBody = `<span class="preview-verse-sup">1</span>${t('preview_verse_default')}`;
      const loadFromLiveBible = () => {
        if (!isLive || !livePointer || livePointer.kind !== 'bible') return false;
        const bibleList = bibles[livePointer.version];
        if (!bibleList || bibleList.length === 0) return false;
        const item = bibleList[livePointer.index || 0];
        if (!item) return false;
        const pages = getPagesFromItem(item, true);
        if (!pages || !pages.length) return false;
        const pg = pages[Math.max(0, Math.min(liveLineCursor || 0, pages.length - 1))];
        const ref = getBibleRefForPage(item, pg.raw, pg.verseCount);
        previewRef = ref;
        previewVer = item.version || '';
        previewBody = pg.text || item.content || '';
        return true;
      };
      loadFromLiveBible();
      previewVer = formatBibleVersionLabel(previewVer);
      if (previewRefTextEl) previewRefTextEl.innerHTML = `${previewRef}${previewVer ? ' (' + previewVer + ')' : ''}`;
      if (previewMainTextEl) previewMainTextEl.innerHTML = previewBody;
      if (previewVerseTextEl) previewVerseTextEl.innerHTML = previewBody;
      styleCanvasState.sample = { ref: previewRef, version: previewVer, verseHtml: previewBody };
      
      const refBox = style.refBox || ltStyles['custom']?.refBox || {
        bgColor: '#00411C',
        borderColor: '#FFFFFF',
        borderRadius: 10,
        borderWidth: 2,
        width: 530,
        height: 95,
        x: 30,
        yOffset: -100,
        opacity: 0.95
      };
      // Helper for safe element value assignment
      const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

      const meta = style.meta || {};
      setVal('base-x', meta.baseX ?? 0);
      setVal('base-y', meta.baseY ?? 860);
      setVal('grid-size', meta.gridSize ?? 20);
      const gridToggle = document.getElementById('grid-toggle');
      if (gridToggle) gridToggle.checked = meta.showGrid ?? true;
      const safeToggle = document.getElementById('safe-toggle');
      if (safeToggle) safeToggle.checked = meta.showSafe ?? true;
      
      const refFillType = refBox.fillType || (refBox.gradientStart || refBox.gradientEnd ? 'gradient' : 'color');
      setVal('se-ref-fill-type', refFillType);
      toggleFillFields('refBox', refFillType);
      setVal('se-ref-bg-color', refBox.bgColor || '#00411C');
      setVal('se-ref-bg-hex', refBox.bgColor || '#00411C');
      setVal('se-ref-grad-start', refBox.gradientStart || refBox.bgColor || '#00411C');
      setVal('se-ref-grad-start-hex', refBox.gradientStart || refBox.bgColor || '#00411C');
      setVal('se-ref-grad-end', refBox.gradientEnd || refBox.gradientStart || refBox.bgColor || '#00411C');
      setVal('se-ref-grad-end-hex', refBox.gradientEnd || refBox.gradientStart || refBox.bgColor || '#00411C');
      setVal('se-ref-border-color', refBox.borderColor || '#FFFFFF');
      setVal('se-ref-border-hex', refBox.borderColor || '#FFFFFF');
      setVal('se-ref-radius', refBox.borderRadius ?? 10);
      setVal('se-ref-border-width', refBox.borderWidth ?? 2);
      setVal('se-ref-width', refBox.width ?? 530);
      setVal('se-ref-height', refBox.height ?? 95);
      setVal('se-ref-x', refBox.x ?? 30);
      setVal('se-ref-y', refBox.y ?? refBox.yOffset ?? 0);
      setVal('se-ref-pad-x', refBox.padX ?? refBox.paddingLeft ?? refBox.padding ?? 24);
      setVal('se-ref-pad-y', refBox.padY ?? refBox.paddingBottom ?? refBox.padding ?? 10);
      setVal('se-ref-h-align', refBox.hAlign || 'center');
      setVal('se-ref-v-align', refBox.vAlign || 'middle');
      setVal('se-ref-rotation', refBox.rotation ?? 0);
      setVal('se-ref-zindex', refBox.zIndex ?? 1);
      const refOpacityRaw = refBox.opacity ?? 0.95;
      const refOpacityVal = Math.round(refOpacityRaw > 1 ? refOpacityRaw : refOpacityRaw * 100);
      setVal('se-ref-opacity', refOpacityVal);
      setTxt('val-ref-opacity', refOpacityVal + '%');

      const mainBar = style.mainBar || ltStyles['custom']?.mainBar || {
        gradientStart: '#AD0000',
        gradientEnd: '#000000',
        minHeight: 240,
        x: 0,
        yOffset: 220,
        width: 1920,
        padding: 10,
        hAlign: 'left',
        vAlign: 'middle',
        opacity: 0.95
      };
      // Handle both old gradient-only and new fillType format
      const barFillType = mainBar.fillType || 'gradient';
      const seBarFillType = document.getElementById('se-bar-fill-type');
      if (seBarFillType) seBarFillType.value = barFillType;
      toggleFillFields('mainBar', barFillType);
      setVal('se-bar-grad-start', mainBar.gradientStart || '#AD0000');
      setVal('se-bar-grad-start-hex', mainBar.gradientStart || '#AD0000');
      setVal('se-bar-grad-end', mainBar.gradientEnd || '#000000');
      setVal('se-bar-grad-end-hex', mainBar.gradientEnd || '#000000');
      const seBarBgColor = document.getElementById('se-bar-bg-color');
      const seBarBgHex = document.getElementById('se-bar-bg-hex');
      if (seBarBgColor) seBarBgColor.value = mainBar.bgColor || mainBar.gradientStart || '#85142B';
      if (seBarBgHex) seBarBgHex.value = mainBar.bgColor || mainBar.gradientStart || '#85142B';
      setVal('se-bar-border-color', mainBar.borderColor || '#FFFFFF');
      setVal('se-bar-border-hex', mainBar.borderColor || '#FFFFFF');
      setVal('se-bar-border-width', mainBar.borderWidth ?? 0);
      setVal('se-bar-radius', mainBar.borderRadius ?? 0);
      setVal('se-bar-height', mainBar.height ?? mainBar.minHeight ?? 240);
      setVal('se-bar-width', mainBar.width ?? 1920);
      setVal('se-bar-x', mainBar.x ?? 0);
      const seBarY = document.getElementById('se-bar-y');
      if (seBarY) seBarY.value = mainBar.y ?? mainBar.yOffset ?? 0;
      const barPadding = mainBar.padding ?? mainBar.paddingLeft ?? mainBar.padX ?? 10;
      const seBarPadX = document.getElementById('se-bar-pad-x');
      const seBarPadY = document.getElementById('se-bar-pad-y');
      if (seBarPadX) seBarPadX.value = mainBar.padX ?? barPadding;
      if (seBarPadY) seBarPadY.value = mainBar.padY ?? barPadding;
      setVal('se-bar-h-align', mainBar.hAlign || 'left');
      setVal('se-bar-v-align', mainBar.vAlign || 'middle');
      setVal('se-bar-rotation', mainBar.rotation ?? 0);
      setVal('se-bar-zindex', mainBar.zIndex ?? 0);
      const barOpacityRaw = mainBar.opacity ?? 0.95;
      const barOpacityVal = Math.round(barOpacityRaw > 1 ? barOpacityRaw : barOpacityRaw * 100);
      setVal('se-bar-opacity', barOpacityVal);
      setTxt('val-bar-opacity', barOpacityVal + '%');

      const textMain = style.textPropsMain || style.textProps || {
        lineSpacing: 1.1,
        textTransform: 'none',
        textAlign: 'left',
        offsetX: 0,
        offsetY: 0,
        singleLine: false,
        fontFamily: '',
        fontSize: 40,
        fontWeight: 700,
        color: '#FFFFFF',
        hAlign: 'left',
        vAlign: 'middle',
        letterSpacing: 0,
        wordSpacing: 0,
        writingMode: 'horizontal-tb',
        textOrientation: 'mixed'
      };
      const textRef = style.textPropsRef || style.textProps || {
        lineSpacing: 1.2,
        textTransform: 'none',
        textAlign: 'center',
        offsetX: 0,
        offsetY: 0,
        singleLine: true,
        fontFamily: '',
        fontSize: 36,
        fontWeight: 700,
        color: '#FFFFFF',
        hAlign: 'center',
        vAlign: 'middle',
        letterSpacing: 0,
        wordSpacing: 0
      };
      const lsMain = textMain.lineSpacing ?? 1.1;
      setVal('se-main-line-spacing', lsMain);
      setTxt('val-main-line-spacing', lsMain);
      setVal('se-main-text-transform', textMain.textTransform || 'none');
      setVal('se-main-single-line', textMain.singleLine ? 'true' : 'false');
      setVal('se-main-offset-x', textMain.offsetX ?? 0);
      setVal('se-main-offset-y', textMain.offsetY ?? 0);
      // New Main Text properties
      const seMainTextFontFamily = document.getElementById('se-main-text-font-family');
      if (seMainTextFontFamily) seMainTextFontFamily.value = textMain.fontFamily || '';
      const seMainTextFontSize = document.getElementById('se-main-text-font-size');
      if (seMainTextFontSize) seMainTextFontSize.value = textMain.fontSize ?? 40;
      const seMainTextFontWeight = document.getElementById('se-main-text-font-weight');
      if (seMainTextFontWeight) seMainTextFontWeight.value = textMain.fontWeight ?? 700;
      const seMainTextColor = document.getElementById('se-main-text-color');
      const seMainTextColorHex = document.getElementById('se-main-text-color-hex');
      if (seMainTextColor) seMainTextColor.value = textMain.color || '#FFFFFF';
      if (seMainTextColorHex) seMainTextColorHex.value = textMain.color || '#FFFFFF';
      const seMainTextHAlign = document.getElementById('se-main-text-h-align');
      if (seMainTextHAlign) seMainTextHAlign.value = textMain.hAlign || 'left';
      const seMainTextVAlign = document.getElementById('se-main-text-v-align');
      if (seMainTextVAlign) seMainTextVAlign.value = textMain.vAlign || 'middle';
      const seMainTextLetterSpacing = document.getElementById('se-main-text-letter-spacing');
      if (seMainTextLetterSpacing) seMainTextLetterSpacing.value = textMain.letterSpacing ?? 0;
      const seMainTextWordSpacing = document.getElementById('se-main-text-word-spacing');
      if (seMainTextWordSpacing) seMainTextWordSpacing.value = textMain.wordSpacing ?? 0;
      const seMainTextWritingMode = document.getElementById('se-main-text-writing-mode');
      if (seMainTextWritingMode) seMainTextWritingMode.value = textMain.writingMode || 'horizontal-tb';
      const seMainTextOrientation = document.getElementById('se-main-text-orientation');
      if (seMainTextOrientation) seMainTextOrientation.value = textMain.textOrientation || 'mixed';
      const seMainTextX = document.getElementById('se-main-text-x');
      if (seMainTextX) seMainTextX.value = textMain.x ?? 0;
      const seMainTextY = document.getElementById('se-main-text-y');
      if (seMainTextY) seMainTextY.value = textMain.y ?? 0;
      const seMainTextWidth = document.getElementById('se-main-text-width');
      if (seMainTextWidth) seMainTextWidth.value = textMain.width ?? 0;
      const seMainTextHeight = document.getElementById('se-main-text-height');
      if (seMainTextHeight) seMainTextHeight.value = textMain.height ?? 0;
      const seMainTextRotation = document.getElementById('se-main-text-rotation');
      if (seMainTextRotation) seMainTextRotation.value = textMain.rotation ?? 0;
      const seMainTextOpacity = document.getElementById('se-main-text-opacity');
      if (seMainTextOpacity) seMainTextOpacity.value = textMain.opacity ?? 100;
      const seMainTextZIndex = document.getElementById('se-main-text-zindex');
      if (seMainTextZIndex) seMainTextZIndex.value = textMain.zIndex ?? 2;
      // Main Text shadow
      const mainShadow = textMain.shadow || { color: '#000000', opacity: 0, blur: 8, offsetX: 2 };
      const mainShadowOpacityVal = Math.round((mainShadow.opacity ?? 0) * 100);
      const seMainTextShadowColor = document.getElementById('se-main-text-shadow-color');
      const seMainTextShadowColorHex = document.getElementById('se-main-text-shadow-color-hex');
      const seMainTextShadowOpacity = document.getElementById('se-main-text-shadow-opacity');
      const seMainTextShadowBlur = document.getElementById('se-main-text-shadow-blur');
      const seMainTextShadowOffset = document.getElementById('se-main-text-shadow-offset');
      if (seMainTextShadowColor) seMainTextShadowColor.value = mainShadow.color || '#000000';
      if (seMainTextShadowColorHex) seMainTextShadowColorHex.value = mainShadow.color || '#000000';
      if (seMainTextShadowOpacity) seMainTextShadowOpacity.value = mainShadowOpacityVal;
      if (seMainTextShadowBlur) seMainTextShadowBlur.value = mainShadow.blur ?? 8;
      if (seMainTextShadowOffset) seMainTextShadowOffset.value = mainShadow.offsetX ?? 2;

      const lsRef = textRef.lineSpacing ?? 1.2;
      setVal('se-ref-line-spacing', lsRef);
      setTxt('val-ref-line-spacing', lsRef);
      setVal('se-ref-text-transform', textRef.textTransform || 'none');
      setVal('se-ref-single-line', textRef.singleLine ? 'true' : 'false');
      setVal('se-ref-offset-x', textRef.offsetX ?? 0);
      setVal('se-ref-offset-y', textRef.offsetY ?? 0);
      const seRefTextHAlign = document.getElementById('se-ref-text-h-align');
      if (seRefTextHAlign) seRefTextHAlign.value = textRef.hAlign || textRef.textAlign || 'center';
      const refTextColor = textRef.color || '#FFFFFF';
      setVal('se-ref-text-color', refTextColor);
      setVal('se-ref-text-color-hex', refTextColor);
      // New Reference Text properties
      const seRefTextFontFamily = document.getElementById('se-ref-text-font-family');
      if (seRefTextFontFamily) seRefTextFontFamily.value = textRef.fontFamily || '';
      const seRefTextFontSize = document.getElementById('se-ref-text-font-size');
      if (seRefTextFontSize) seRefTextFontSize.value = textRef.fontSize ?? 36;
      const seRefTextFontWeight = document.getElementById('se-ref-text-font-weight');
      if (seRefTextFontWeight) seRefTextFontWeight.value = textRef.fontWeight ?? 700;
      const seRefTextVAlign = document.getElementById('se-ref-text-v-align');
      if (seRefTextVAlign) seRefTextVAlign.value = textRef.vAlign || 'middle';
      const seRefTextLetterSpacing = document.getElementById('se-ref-text-letter-spacing');
      if (seRefTextLetterSpacing) seRefTextLetterSpacing.value = textRef.letterSpacing ?? 0;
      const seRefTextWordSpacing = document.getElementById('se-ref-text-word-spacing');
      if (seRefTextWordSpacing) seRefTextWordSpacing.value = textRef.wordSpacing ?? 0;
      const seRefTextX = document.getElementById('se-ref-text-x');
      if (seRefTextX) seRefTextX.value = textRef.x ?? 0;
      const seRefTextY = document.getElementById('se-ref-text-y');
      if (seRefTextY) seRefTextY.value = textRef.y ?? 0;
      const seRefTextWidth = document.getElementById('se-ref-text-width');
      if (seRefTextWidth) seRefTextWidth.value = textRef.width ?? 0;
      const seRefTextHeight = document.getElementById('se-ref-text-height');
      if (seRefTextHeight) seRefTextHeight.value = textRef.height ?? 0;
      const seRefTextRotation = document.getElementById('se-ref-text-rotation');
      if (seRefTextRotation) seRefTextRotation.value = textRef.rotation ?? 0;
      const seRefTextOpacity = document.getElementById('se-ref-text-opacity');
      if (seRefTextOpacity) seRefTextOpacity.value = textRef.opacity ?? 100;
      const seRefTextZIndex = document.getElementById('se-ref-text-zindex');
      if (seRefTextZIndex) seRefTextZIndex.value = textRef.zIndex ?? 2;
      // Reference Text shadow
      const refTextShadow = textRef.shadow || { color: '#000000', opacity: 0, blur: 8, offsetX: 2 };
      const refTextShadowOpacityVal = Math.round((refTextShadow.opacity ?? 0) * 100);
      const seRefTextShadowColor = document.getElementById('se-ref-text-shadow-color');
      const seRefTextShadowColorHex = document.getElementById('se-ref-text-shadow-color-hex');
      const seRefTextShadowOpacity = document.getElementById('se-ref-text-shadow-opacity');
      const seRefTextShadowBlur = document.getElementById('se-ref-text-shadow-blur');
      const seRefTextShadowOffset = document.getElementById('se-ref-text-shadow-offset');
      if (seRefTextShadowColor) seRefTextShadowColor.value = refTextShadow.color || '#000000';
      if (seRefTextShadowColorHex) seRefTextShadowColorHex.value = refTextShadow.color || '#000000';
      if (seRefTextShadowOpacity) seRefTextShadowOpacity.value = refTextShadowOpacityVal;
      if (seRefTextShadowBlur) seRefTextShadowBlur.value = refTextShadow.blur ?? 8;
      if (seRefTextShadowOffset) seRefTextShadowOffset.value = refTextShadow.offsetX ?? 2;

      // Shadow settings are now per-component, set defaults for all
      const shadow = style.shadow || { color: '#000000', opacity: 0, blur: 8, offsetX: 2 };
      const shadowOpacityVal = Math.round((shadow.opacity ?? 0) * 100);
      // Main bar shadow
      const seBarShadowColor = document.getElementById('se-bar-shadow-color');
      const seBarShadowColorHex = document.getElementById('se-bar-shadow-color-hex');
      const seBarShadowOpacity = document.getElementById('se-bar-shadow-opacity');
      const seBarShadowBlur = document.getElementById('se-bar-shadow-blur');
      const seBarShadowOffset = document.getElementById('se-bar-shadow-offset');
      if (seBarShadowColor) seBarShadowColor.value = shadow.color || '#000000';
      if (seBarShadowColorHex) seBarShadowColorHex.value = shadow.color || '#000000';
      if (seBarShadowOpacity) seBarShadowOpacity.value = shadowOpacityVal;
      if (seBarShadowBlur) seBarShadowBlur.value = shadow.blur ?? 8;
      if (seBarShadowOffset) seBarShadowOffset.value = shadow.offsetX ?? 2;
      // Ref box shadow
      const seRefShadowColor = document.getElementById('se-ref-shadow-color');
      const seRefShadowOpacity = document.getElementById('se-ref-shadow-opacity');
      const seRefShadowBlur = document.getElementById('se-ref-shadow-blur');
      const seRefShadowOffset = document.getElementById('se-ref-shadow-offset');
      if (seRefShadowColor) seRefShadowColor.value = shadow.color || '#000000';
      if (seRefShadowOpacity) seRefShadowOpacity.value = shadowOpacityVal;
      if (seRefShadowBlur) seRefShadowBlur.value = shadow.blur ?? 8;
      if (seRefShadowOffset) seRefShadowOffset.value = shadow.offsetX ?? 2;
      // Auto-resize is now per-component
      const autoResize = style.autoResize || 'grow';
      const seBarAutoResize = document.getElementById('se-bar-auto-resize');
      const seRefAutoResize = document.getElementById('se-ref-auto-resize');
      if (seBarAutoResize) seBarAutoResize.value = autoResize;
      if (seRefAutoResize) seRefAutoResize.value = autoResize;

      // Version Bar settings
      const versionBar = style.versionBar || ltStyles['custom']?.versionBar || {
        bgColor: '#1a1a2e',
        gradientStart: '#1a1a2e',
        gradientEnd: '#16213e',
        borderColor: '#FFFFFF',
        borderRadius: 8,
        borderWidth: 1,
        width: 200,
        height: 50,
        x: 560,
        y: -50,
        opacity: 0.95,
        fillType: 'color',
        zIndex: 2,
        padX: 12,
        padY: 8,
        hAlign: 'center',
        vAlign: 'middle'
      };
      const seVersionBarFillType = document.getElementById('se-version-bar-fill-type');
      if (seVersionBarFillType) {
        seVersionBarFillType.value = versionBar.fillType || 'color';
        toggleFillFields('versionBar', versionBar.fillType || 'color');
      }
      const seVersionBarBgColor = document.getElementById('se-version-bar-bg-color');
      const seVersionBarBgHex = document.getElementById('se-version-bar-bg-hex');
      if (seVersionBarBgColor) seVersionBarBgColor.value = versionBar.bgColor || '#1a1a2e';
      if (seVersionBarBgHex) seVersionBarBgHex.value = versionBar.bgColor || '#1a1a2e';
      const seVersionBarGradStart = document.getElementById('se-version-bar-grad-start');
      const seVersionBarGradStartHex = document.getElementById('se-version-bar-grad-start-hex');
      if (seVersionBarGradStart) seVersionBarGradStart.value = versionBar.gradientStart || '#1a1a2e';
      if (seVersionBarGradStartHex) seVersionBarGradStartHex.value = versionBar.gradientStart || '#1a1a2e';
      const seVersionBarGradEnd = document.getElementById('se-version-bar-grad-end');
      const seVersionBarGradEndHex = document.getElementById('se-version-bar-grad-end-hex');
      if (seVersionBarGradEnd) seVersionBarGradEnd.value = versionBar.gradientEnd || '#16213e';
      if (seVersionBarGradEndHex) seVersionBarGradEndHex.value = versionBar.gradientEnd || '#16213e';
      const seVersionBarBorderColor = document.getElementById('se-version-bar-border-color');
      const seVersionBarBorderHex = document.getElementById('se-version-bar-border-hex');
      if (seVersionBarBorderColor) seVersionBarBorderColor.value = versionBar.borderColor || '#FFFFFF';
      if (seVersionBarBorderHex) seVersionBarBorderHex.value = versionBar.borderColor || '#FFFFFF';
      const seVersionBarRadius = document.getElementById('se-version-bar-radius');
      if (seVersionBarRadius) seVersionBarRadius.value = versionBar.borderRadius ?? 8;
      const seVersionBarBorderWidth = document.getElementById('se-version-bar-border-width');
      if (seVersionBarBorderWidth) seVersionBarBorderWidth.value = versionBar.borderWidth ?? 1;
      const seVersionBarWidth = document.getElementById('se-version-bar-width');
      if (seVersionBarWidth) seVersionBarWidth.value = versionBar.width ?? 200;
      const seVersionBarHeight = document.getElementById('se-version-bar-height');
      if (seVersionBarHeight) seVersionBarHeight.value = versionBar.height ?? 50;
      const seVersionBarX = document.getElementById('se-version-bar-x');
      if (seVersionBarX) seVersionBarX.value = versionBar.x ?? 560;
      const seVersionBarY = document.getElementById('se-version-bar-y');
      if (seVersionBarY) seVersionBarY.value = versionBar.y ?? versionBar.yOffset ?? -50;
      const versionBarOpacityRaw = versionBar.opacity ?? 0.95;
      const versionBarOpacityVal = Math.round(versionBarOpacityRaw > 1 ? versionBarOpacityRaw : versionBarOpacityRaw * 100);
      const seVersionBarOpacity = document.getElementById('se-version-bar-opacity');
      if (seVersionBarOpacity) {
        seVersionBarOpacity.value = versionBarOpacityVal;
        const valVersionBarOpacity = document.getElementById('val-version-bar-opacity');
        if (valVersionBarOpacity) valVersionBarOpacity.innerText = versionBarOpacityVal + '%';
      }
      const seVersionBarZIndex = document.getElementById('se-version-bar-zindex');
      if (seVersionBarZIndex) seVersionBarZIndex.value = versionBar.zIndex ?? 2;
      const seVersionBarPadX = document.getElementById('se-version-bar-pad-x');
      if (seVersionBarPadX) seVersionBarPadX.value = versionBar.padX ?? 12;
      const seVersionBarPadY = document.getElementById('se-version-bar-pad-y');
      if (seVersionBarPadY) seVersionBarPadY.value = versionBar.padY ?? 8;
      const seVersionBarHAlign = document.getElementById('se-version-bar-h-align');
      if (seVersionBarHAlign) seVersionBarHAlign.value = versionBar.hAlign || 'center';
      const seVersionBarVAlign = document.getElementById('se-version-bar-v-align');
      if (seVersionBarVAlign) seVersionBarVAlign.value = versionBar.vAlign || 'middle';
      const seVersionBarRotation = document.getElementById('se-version-bar-rotation');
      if (seVersionBarRotation) seVersionBarRotation.value = versionBar.rotation ?? 0;
      // Version Bar shadow
      const seVersionBarShadowColor = document.getElementById('se-version-bar-shadow-color');
      const seVersionBarShadowOpacity = document.getElementById('se-version-bar-shadow-opacity');
      const seVersionBarShadowBlur = document.getElementById('se-version-bar-shadow-blur');
      const seVersionBarShadowOffset = document.getElementById('se-version-bar-shadow-offset');
      if (seVersionBarShadowColor) seVersionBarShadowColor.value = shadow.color || '#000000';
      if (seVersionBarShadowOpacity) seVersionBarShadowOpacity.value = shadowOpacityVal;
      if (seVersionBarShadowBlur) seVersionBarShadowBlur.value = shadow.blur ?? 8;
      if (seVersionBarShadowOffset) seVersionBarShadowOffset.value = shadow.offsetX ?? 2;
      // Version Bar auto-resize
      const seVersionBarAutoResize = document.getElementById('se-version-bar-auto-resize');
      if (seVersionBarAutoResize) seVersionBarAutoResize.value = autoResize;

      // Version Text settings
      const textVersion = style.textPropsVersion || {
        lineSpacing: 1.2,
        textTransform: 'none',
        textAlign: 'center',
        offsetX: 0,
        offsetY: 0,
        singleLine: true,
        fontFamily: '',
        fontSize: 24,
        fontWeight: 600,
        color: '#FFFFFF',
        hAlign: 'center',
        vAlign: 'middle',
        letterSpacing: 0,
        wordSpacing: 0,
        writingMode: 'horizontal-tb',
        textOrientation: 'mixed',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        opacity: 100,
        zIndex: 3,
        autoResize: 'grow'
      };
      const seVersionTextFontFamily = document.getElementById('se-version-text-font-family');
      if (seVersionTextFontFamily) seVersionTextFontFamily.value = textVersion.fontFamily || '';
      const seVersionTextFontSize = document.getElementById('se-version-text-font-size');
      if (seVersionTextFontSize) seVersionTextFontSize.value = textVersion.fontSize ?? 24;
      const seVersionTextFontWeight = document.getElementById('se-version-text-font-weight');
      if (seVersionTextFontWeight) seVersionTextFontWeight.value = textVersion.fontWeight ?? 600;
      const seVersionTextColor = document.getElementById('se-version-text-color');
      const seVersionTextColorHex = document.getElementById('se-version-text-color-hex');
      if (seVersionTextColor) seVersionTextColor.value = textVersion.color || '#FFFFFF';
      if (seVersionTextColorHex) seVersionTextColorHex.value = textVersion.color || '#FFFFFF';
      const lsVersion = textVersion.lineSpacing ?? 1.2;
      const seVersionLineSpacing = document.getElementById('se-version-line-spacing');
      if (seVersionLineSpacing) seVersionLineSpacing.value = lsVersion;
      const valVersionLineSpacing = document.getElementById('val-version-line-spacing');
      if (valVersionLineSpacing) valVersionLineSpacing.innerText = lsVersion;
      const seVersionTextTransform = document.getElementById('se-version-text-transform');
      if (seVersionTextTransform) seVersionTextTransform.value = textVersion.textTransform || 'none';
      const seVersionTextHAlign = document.getElementById('se-version-text-h-align');
      if (seVersionTextHAlign) seVersionTextHAlign.value = textVersion.hAlign || 'center';
      const seVersionTextVAlign = document.getElementById('se-version-text-v-align');
      if (seVersionTextVAlign) seVersionTextVAlign.value = textVersion.vAlign || 'middle';
      const seVersionTextX = document.getElementById('se-version-text-x');
      if (seVersionTextX) seVersionTextX.value = textVersion.x ?? 0;
      const seVersionTextY = document.getElementById('se-version-text-y');
      if (seVersionTextY) seVersionTextY.value = textVersion.y ?? 0;
      const seVersionTextWidth = document.getElementById('se-version-text-width');
      if (seVersionTextWidth) seVersionTextWidth.value = textVersion.width ?? 0;
      const seVersionTextHeight = document.getElementById('se-version-text-height');
      if (seVersionTextHeight) seVersionTextHeight.value = textVersion.height ?? 0;
      const seVersionTextRotation = document.getElementById('se-version-text-rotation');
      if (seVersionTextRotation) seVersionTextRotation.value = textVersion.rotation ?? 0;
      const seVersionTextOpacity = document.getElementById('se-version-text-opacity');
      if (seVersionTextOpacity) seVersionTextOpacity.value = textVersion.opacity ?? 100;
      const seVersionTextZIndex = document.getElementById('se-version-text-zindex');
      if (seVersionTextZIndex) seVersionTextZIndex.value = textVersion.zIndex ?? 3;
      const seVersionOffsetX = document.getElementById('se-version-offset-x');
      if (seVersionOffsetX) seVersionOffsetX.value = textVersion.offsetX ?? 0;
      const seVersionOffsetY = document.getElementById('se-version-offset-y');
      if (seVersionOffsetY) seVersionOffsetY.value = textVersion.offsetY ?? 0;
      const seVersionSingleLine = document.getElementById('se-version-single-line');
      if (seVersionSingleLine) seVersionSingleLine.value = textVersion.singleLine ? 'true' : 'false';
      const seVersionLetterSpacing = document.getElementById('se-version-text-letter-spacing');
      if (seVersionLetterSpacing) seVersionLetterSpacing.value = textVersion.letterSpacing ?? 0;
      const seVersionWordSpacing = document.getElementById('se-version-text-word-spacing');
      if (seVersionWordSpacing) seVersionWordSpacing.value = textVersion.wordSpacing ?? 0;
      const seVersionWritingMode = document.getElementById('se-version-text-writing-mode');
      if (seVersionWritingMode) seVersionWritingMode.value = textVersion.writingMode || 'horizontal-tb';
      const seVersionOrientation = document.getElementById('se-version-text-orientation');
      if (seVersionOrientation) seVersionOrientation.value = textVersion.textOrientation || 'mixed';
      const seVersionTextAutoResize = document.getElementById('se-version-text-auto-resize');
      if (seVersionTextAutoResize) seVersionTextAutoResize.value = textVersion.autoResize || 'grow';
      // Version Text shadow
      const versionTextShadow = textVersion.shadow || style.shadow || { color: '#000000', opacity: 0, blur: 8, offsetX: 2 };
      const versionTextShadowOpacityVal = Math.round((versionTextShadow.opacity ?? 0) * 100);
      const seVersionTextShadowColor = document.getElementById('se-version-text-shadow-color');
      const seVersionTextShadowColorHex = document.getElementById('se-version-text-shadow-color-hex');
      const seVersionTextShadowOpacity = document.getElementById('se-version-text-shadow-opacity');
      const seVersionTextShadowBlur = document.getElementById('se-version-text-shadow-blur');
      const seVersionTextShadowOffset = document.getElementById('se-version-text-shadow-offset');
      if (seVersionTextShadowColor) seVersionTextShadowColor.value = versionTextShadow.color || '#000000';
      if (seVersionTextShadowColorHex) seVersionTextShadowColorHex.value = versionTextShadow.color || '#000000';
      if (seVersionTextShadowOpacity) seVersionTextShadowOpacity.value = versionTextShadowOpacityVal;
      if (seVersionTextShadowBlur) seVersionTextShadowBlur.value = versionTextShadow.blur ?? 8;
      if (seVersionTextShadowOffset) seVersionTextShadowOffset.value = versionTextShadow.offsetX ?? 2;
      
      tempStyleChanges = null;
      openModal('styleEditorModal');
      setupStyleEditorCollapsibles();
      requestAnimationFrame(() => {
        initStyleEditorCanvas();
        styleCanvasState.preview.autoScale = true;
        fitStyleCanvasToWrap();
        updateStylePreview();
        requestAnimationFrame(() => {
          if (styleCanvasState.preview.autoScale) fitStyleCanvasToWrap();
          updateStylePreview();
        });
      });
    }

    function syncStyleColor(type) {
      const pairs = {
        'ref-bg': ['se-ref-bg-color', 'se-ref-bg-hex'],
        'ref-border': ['se-ref-border-color', 'se-ref-border-hex'],
        'ref-text': ['se-ref-text-color', 'se-ref-text-color-hex'],
        'ref-grad-start': ['se-ref-grad-start', 'se-ref-grad-start-hex'],
        'ref-grad-end': ['se-ref-grad-end', 'se-ref-grad-end-hex'],
        'ref-shadow': ['se-ref-shadow-color', 'se-ref-shadow-color-hex'],
        'ref-text-shadow': ['se-ref-text-shadow-color', 'se-ref-text-shadow-color-hex'],
        'bar-bg': ['se-bar-bg-color', 'se-bar-bg-hex'],
        'bar-start': ['se-bar-grad-start', 'se-bar-grad-start-hex'],
        'bar-end': ['se-bar-grad-end', 'se-bar-grad-end-hex'],
        'bar-border': ['se-bar-border-color', 'se-bar-border-hex'],
        'bar-shadow': ['se-bar-shadow-color', 'se-bar-shadow-color-hex'],
        'main-text': ['se-main-text-color', 'se-main-text-color-hex'],
        'main-text-shadow': ['se-main-text-shadow-color', 'se-main-text-shadow-color-hex'],
        'version-bar-bg': ['se-version-bar-bg-color', 'se-version-bar-bg-hex'],
        'version-bar-grad-start': ['se-version-bar-grad-start', 'se-version-bar-grad-start-hex'],
        'version-bar-grad-end': ['se-version-bar-grad-end', 'se-version-bar-grad-end-hex'],
        'version-bar-border': ['se-version-bar-border-color', 'se-version-bar-border-hex'],
        'version-bar-shadow': ['se-version-bar-shadow-color', 'se-version-bar-shadow-color-hex'],
        'version-text': ['se-version-text-color', 'se-version-text-color-hex'],
        'version-text-shadow': ['se-version-text-shadow-color', 'se-version-text-shadow-color-hex'],
        'shadow': ['se-shadow-color', 'se-shadow-color-hex']
      };
      const pair = pairs[type];
      if (!pair) return;
      const [colorId, hexId] = pair;
      const hexEl = document.getElementById(hexId);
      const colorEl = document.getElementById(colorId);
      if (!hexEl || !colorEl) return;
      const hexVal = hexEl.value;
      if (/^#[0-9A-Fa-f]{6}$/.test(hexVal)) {
        colorEl.value = hexVal;
        updateStylePreview();
      }
    }

    function toggleFillFields(prefix, fillType) {
      const bgField = document.getElementById(prefix + '-bgColor-field');
      const gradStartField = document.getElementById(prefix + '-gradientStart-field');
      const gradEndField = document.getElementById(prefix + '-gradientEnd-field');
      if (fillType === 'gradient') {
        if (bgField) bgField.style.display = 'none';
        if (gradStartField) gradStartField.style.display = '';
        if (gradEndField) gradEndField.style.display = '';
      } else {
        if (bgField) bgField.style.display = '';
        if (gradStartField) gradStartField.style.display = 'none';
        if (gradEndField) gradEndField.style.display = 'none';
      }
    }

    function hexToRgb(hex) {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 0, g: 0, b: 0 };
    }

    const styleCanvasBaseSize = { width: 1920, height: 1080 };
    const styleCanvasState = {
      preview: {
        scale: 0.45,
        autoScale: true,
        baseX: 0,
        baseY: 860,
        showGrid: true,
        gridSize: 20,
        showSafe: true
      },
      sample: {
        ref: '',
        version: '',
        verseHtml: ''
      }
    };
    let styleCanvasDomCache = null;
    let styleCanvasInitialized = false;

    function getStyleCanvasDom() {
      if (styleCanvasDomCache) return styleCanvasDomCache;
      const stage = document.getElementById('canvas-stage');
      if (!stage) return null;
      styleCanvasDomCache = {
        wrap: document.getElementById('style-canvas-wrap'),
        frame: document.getElementById('canvas-frame'),
        stage,
        grid: document.getElementById('canvas-grid'),
        safe: document.getElementById('canvas-safe'),
        baseline: document.getElementById('canvas-baseline'),
        layerWrap: document.getElementById('layer-wrap'),
        refBox: document.getElementById('previewRefBox'),
        refText: document.getElementById('previewRefText'),
        mainBar: document.getElementById('previewMainBar'),
        mainText: document.getElementById('previewMainText'),
        selectionBox: document.getElementById('selection-box')
      };
      return styleCanvasDomCache;
    }

    function styleCanvasClamp(value, min, max) {
      return Math.min(Math.max(value, min), max);
    }

    function styleCanvasNormalizeOpacity(value, fallback = 1) {
      if (value == null || value === '') return fallback;
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback;
      if (num > 1) return styleCanvasClamp(num / 100, 0, 1);
      return styleCanvasClamp(num, 0, 1);
    }

    function styleCanvasToRgba(color, opacity) {
      if (!color) return `rgba(0, 0, 0, ${opacity})`;
      const trimmed = String(color).trim();
      if (trimmed.startsWith('#')) {
        let hex = trimmed;
        if (hex.length === 4) {
          hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        const rgb = hexToRgb(hex);
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
      }
      return trimmed;
    }

    function styleCanvasReadControls() {
      const scaleInput = document.getElementById('canvas-scale');
      const baseXInput = document.getElementById('base-x');
      const baseYInput = document.getElementById('base-y');
      const gridToggle = document.getElementById('grid-toggle');
      const safeToggle = document.getElementById('safe-toggle');
      const gridSizeInput = document.getElementById('grid-size');
      const scaleValue = Number(scaleInput?.value || styleCanvasState.preview.scale || 0.45);
      styleCanvasState.preview.scale = styleCanvasClamp(scaleValue, 0.2, 2);
      styleCanvasState.preview.baseX = Number(baseXInput?.value || 0);
      styleCanvasState.preview.baseY = Number(baseYInput?.value || 860);
      styleCanvasState.preview.showGrid = gridToggle ? gridToggle.checked : true;
      styleCanvasState.preview.showSafe = safeToggle ? safeToggle.checked : true;
      const gridValue = Number(gridSizeInput?.value || 20);
      styleCanvasState.preview.gridSize = styleCanvasClamp(gridValue || 20, 5, 200);
    }

    function updateStyleCanvasStage() {
      const dom = getStyleCanvasDom();
      if (!dom) return;
      const preview = styleCanvasState.preview;
      const scale = preview.scale || 1;
      if (dom.frame) {
        dom.frame.style.width = `${styleCanvasBaseSize.width * scale}px`;
        dom.frame.style.height = `${styleCanvasBaseSize.height * scale}px`;
      }
      if (dom.stage) dom.stage.style.transform = `scale(${scale})`;
      if (dom.grid) {
        dom.grid.style.backgroundSize = `${preview.gridSize}px ${preview.gridSize}px`;
        dom.grid.style.display = preview.showGrid ? 'block' : 'none';
      }
      if (dom.safe) dom.safe.style.display = preview.showSafe ? 'block' : 'none';
      if (dom.baseline) dom.baseline.style.top = `${preview.baseY}px`;
      if (dom.wrap && dom.frame) {
        const needsZoom = dom.frame.offsetWidth > dom.wrap.clientWidth || dom.frame.offsetHeight > dom.wrap.clientHeight;
        dom.wrap.classList.toggle('zoomed', needsZoom);
      }
    }

    function fitStyleCanvasToWrap() {
      const dom = getStyleCanvasDom();
      if (!dom || !dom.wrap) return;
      const pad = 36;
      const width = Math.max(0, dom.wrap.clientWidth - pad);
      const height = Math.max(0, dom.wrap.clientHeight - pad);
      if (!width || !height) {
        requestAnimationFrame(() => fitStyleCanvasToWrap());
        return;
      }
      const scale = Math.min(width / styleCanvasBaseSize.width, height / styleCanvasBaseSize.height);
      styleCanvasState.preview.scale = styleCanvasClamp(scale, 0.2, 2);
      const scaleInput = document.getElementById('canvas-scale');
      if (scaleInput) scaleInput.value = styleCanvasState.preview.scale.toFixed(2);
    }

    function initStyleEditorCanvas() {
      if (styleCanvasInitialized) return;
      const dom = getStyleCanvasDom();
      if (!dom) return;
      styleCanvasInitialized = true;

      const scaleInput = document.getElementById('canvas-scale');
      if (scaleInput) {
        scaleInput.addEventListener('input', () => {
          styleCanvasState.preview.autoScale = false;
          updateStylePreview();
        });
      }
      const baseXInput = document.getElementById('base-x');
      if (baseXInput) baseXInput.addEventListener('input', () => updateStylePreview());
      const baseYInput = document.getElementById('base-y');
      if (baseYInput) baseYInput.addEventListener('input', () => updateStylePreview());
      const gridToggle = document.getElementById('grid-toggle');
      if (gridToggle) gridToggle.addEventListener('change', () => updateStylePreview());
      const safeToggle = document.getElementById('safe-toggle');
      if (safeToggle) safeToggle.addEventListener('change', () => updateStylePreview());
      const gridSizeInput = document.getElementById('grid-size');
      if (gridSizeInput) gridSizeInput.addEventListener('input', () => updateStylePreview());
      const fitBtn = document.getElementById('fit-scale');
      if (fitBtn) {
        fitBtn.addEventListener('click', (e) => {
          e.preventDefault();
          styleCanvasState.preview.autoScale = true;
          fitStyleCanvasToWrap();
          updateStylePreview();
        });
      }
      window.addEventListener('resize', () => {
        if (!styleCanvasState.preview.autoScale) return;
        if (window._styleResizeRaf) return;
        window._styleResizeRaf = requestAnimationFrame(() => {
          window._styleResizeRaf = 0;
          fitStyleCanvasToWrap();
          updateStylePreview();
        });
      });
    }

    function htmlToText(html) {
      if (!html) return '';
      const temp = document.createElement('div');
      temp.innerHTML = html;
      return temp.textContent || '';
    }

    function applyCategoryStateToLayer(layer, styleData) {
      if (!layer || !layer.category) return;
      const preview = styleCanvasState.preview;
      const baseX = preview.baseX || 0;
      const baseY = preview.baseY || 0;
      if (layer.category === 'main_bar') {
        layer.type = 'rect';
        const bar = styleData.mainBar || {};
        const height = bar.height ?? bar.minHeight ?? 240;
        const width = bar.width != null ? bar.width : styleCanvasBaseSize.width;
        const barMinWidth = bar.minWidth != null ? bar.minWidth : 0;
        const barExtraWidth = bar.extraWidth != null ? bar.extraWidth : 0;
        const finalWidth = Math.max(barMinWidth, width + barExtraWidth);
        layer.x = baseX + (bar.x || 0);
        layer.y = baseY + (bar.yOffset || 0) - height;
        layer.width = finalWidth;
        layer.height = height;
        layer.fill = bar.bgColor || bar.gradientStart || '#005E29';
        layer.gradientStart = bar.gradientStart || bar.bgColor || '#005E29';
        layer.gradientEnd = bar.gradientEnd || layer.gradientStart;
        layer.fillType = bar.fillType || 'gradient';
        layer.stroke = bar.borderColor || 'transparent';
        layer.strokeWidth = bar.borderWidth || 0;
        layer.radius = bar.borderRadius || 0;
        layer.padX = bar.padX != null ? bar.padX : bar.paddingLeft;
        layer.padY = bar.padY != null ? bar.padY : bar.paddingBottom;
        layer.minWidth = barMinWidth;
        layer.extraWidth = barExtraWidth;
        layer.hAlign = bar.hAlign || 'left';
        layer.vAlign = bar.vAlign || 'middle';
        layer.opacity = bar.opacity != null ? bar.opacity : 100;
      }
      if (layer.category === 'ref_box') {
        layer.type = 'rect';
        const box = styleData.refBox || {};
        layer.x = baseX + (box.x || 0);
        layer.y = baseY + (box.yOffset || 0);
        layer.width = box.width || 530;
        layer.height = box.height || 95;
        layer.fill = box.bgColor || '#00411C';
        layer.gradientStart = box.gradientStart || box.bgColor || '#00411C';
        layer.gradientEnd = box.gradientEnd || layer.gradientStart || box.bgColor || '#00411C';
        layer.fillType = box.fillType || 'color';
        layer.stroke = box.borderColor || '#FFFFFF';
        layer.strokeWidth = box.borderWidth || 0;
        layer.radius = box.borderRadius || 0;
        layer.padX = box.padX != null ? box.padX : 0;
        layer.padY = box.padY != null ? box.padY : 0;
        layer.minWidth = box.minWidth != null ? box.minWidth : 0;
        layer.extraWidth = box.extraWidth != null ? box.extraWidth : 0;
        layer.hAlign = box.hAlign || 'center';
        layer.vAlign = box.vAlign || 'middle';
        layer.opacity = box.opacity != null ? box.opacity : 100;
      }
      if (layer.category === 'main_text') {
        layer.type = 'text';
        const text = styleData.textPropsMain || {};
        layer.textAlign = text.textAlign || 'left';
        layer.lineHeight = text.lineSpacing || 1.1;
        layer.textTransform = text.textTransform || 'none';
        layer.offsetX = text.offsetX || 0;
        layer.offsetY = text.offsetY || 0;
        layer.letterSpacing = text.letterSpacing || 0;
        layer.wordSpacing = text.wordSpacing || 0;
        layer.singleLine = !!text.singleLine;
        layer.color = text.color || layer.color || '#ffffff';
        layer.fontFamily = text.fontFamily || layer.fontFamily;
        layer.fontSize = text.fontSize != null ? text.fontSize : layer.fontSize;
        layer.fontWeight = text.fontWeight != null ? text.fontWeight : layer.fontWeight;
        layer.writingMode = text.writingMode || layer.writingMode || 'horizontal-tb';
        layer.textOrientation = text.textOrientation || layer.textOrientation || 'mixed';
        layer.hAlign = text.hAlign || layer.hAlign || 'left';
        layer.vAlign = text.vAlign || layer.vAlign || 'middle';
        if (!layer.text) layer.text = htmlToText(styleCanvasState.sample.verseHtml);
      }
      if (layer.category === 'ref_text') {
        layer.type = 'text';
        const text = styleData.textPropsRef || {};
        layer.textAlign = text.textAlign || 'center';
        layer.lineHeight = text.lineSpacing || 1.2;
        layer.textTransform = text.textTransform || 'none';
        layer.offsetX = text.offsetX || 0;
        layer.offsetY = text.offsetY || 0;
        layer.letterSpacing = text.letterSpacing || 0;
        layer.wordSpacing = text.wordSpacing || 0;
        layer.singleLine = !!text.singleLine;
        layer.color = text.color || layer.color || '#ffffff';
        layer.fontFamily = text.fontFamily || layer.fontFamily;
        layer.fontSize = text.fontSize != null ? text.fontSize : layer.fontSize;
        layer.fontWeight = text.fontWeight != null ? text.fontWeight : layer.fontWeight;
        layer.writingMode = text.writingMode || layer.writingMode || 'horizontal-tb';
        layer.textOrientation = text.textOrientation || layer.textOrientation || 'mixed';
        layer.hAlign = text.hAlign || layer.hAlign || 'center';
        layer.vAlign = text.vAlign || layer.vAlign || 'middle';
        if (!layer.text) {
          const versionText = styleCanvasState.sample.version ? ` (${styleCanvasState.sample.version})` : '';
          layer.text = `${styleCanvasState.sample.ref}${versionText}`;
        }
      }
      if (layer.category === 'version_bar') {
        layer.type = 'rect';
        const bar = styleData.versionBar || {};
        layer.x = baseX + (bar.x || 0);
        layer.y = baseY + (bar.yOffset || 0);
        layer.width = bar.width || 200;
        layer.height = bar.height || 50;
        layer.fill = bar.bgColor || '#1a1a2e';
        layer.gradientStart = bar.gradientStart || bar.bgColor || '#1a1a2e';
        layer.gradientEnd = bar.gradientEnd || layer.gradientStart || '#16213e';
        layer.fillType = bar.fillType || 'color';
        layer.stroke = bar.borderColor || '#FFFFFF';
        layer.strokeWidth = bar.borderWidth != null ? bar.borderWidth : 1;
        layer.radius = bar.borderRadius != null ? bar.borderRadius : 8;
        layer.padX = bar.padX != null ? bar.padX : 12;
        layer.padY = bar.padY != null ? bar.padY : 8;
        layer.minWidth = bar.minWidth;
        layer.extraWidth = bar.extraWidth;
        layer.hAlign = bar.hAlign;
        layer.vAlign = bar.vAlign;
        layer.opacity = bar.opacity != null ? bar.opacity : 95;
      }
      if (layer.category === 'version_text') {
        layer.type = 'text';
        const text = styleData.textPropsVersion || {};
        layer.textAlign = text.textAlign || 'center';
        layer.lineHeight = text.lineSpacing || 1.2;
        layer.textTransform = text.textTransform || 'none';
        layer.offsetX = text.offsetX || 0;
        layer.offsetY = text.offsetY || 0;
        layer.letterSpacing = text.letterSpacing || 0;
        layer.wordSpacing = text.wordSpacing || 0;
        layer.singleLine = !!text.singleLine;
        layer.color = text.color || layer.color || '#ffffff';
        layer.fontFamily = text.fontFamily || layer.fontFamily;
        layer.fontSize = text.fontSize != null ? text.fontSize : (layer.fontSize || 24);
        layer.fontWeight = text.fontWeight != null ? text.fontWeight : (layer.fontWeight || 600);
        layer.writingMode = text.writingMode || layer.writingMode || 'horizontal-tb';
        layer.textOrientation = text.textOrientation || layer.textOrientation || 'mixed';
        layer.hAlign = text.hAlign || layer.hAlign || 'center';
        layer.vAlign = text.vAlign || layer.vAlign || 'middle';
        if (!layer.text) {
          layer.text = (styleCanvasState.sample.version || '').replace(/[()]/g, '');
        }
      }
    }

    function renderStyleCanvasLayers(styleData) {
      const dom = getStyleCanvasDom();
      if (!dom || !dom.layerWrap) return;
      dom.layerWrap.innerHTML = '';
      const rawLayers = Array.isArray(styleData.layers) ? styleData.layers : [];
      const layers = rawLayers.map(layer => JSON.parse(JSON.stringify(layer)));
      layers.forEach(layer => {
        applyCategoryStateToLayer(layer, styleData);
        if (layer.hidden) return;
        const el = document.createElement('div');
        el.className = `layer-item ${layer.type === 'text' ? 'text-layer' : ''}`;
        const baseWidth = Number(layer.width || 0);
        const minWidth = Number(layer.minWidth || 0);
        const extraWidth = Number(layer.extraWidth || 0);
        const finalWidth = Math.max(minWidth, baseWidth + extraWidth);
        const layerHeight = Number(layer.height || 0);
        if (finalWidth <= 0 || layerHeight <= 0) return;
        el.style.left = `${layer.x || 0}px`;
        el.style.top = `${layer.y || 0}px`;
        el.style.width = `${finalWidth}px`;
        el.style.height = `${layerHeight}px`;
        el.style.opacity = styleCanvasNormalizeOpacity(layer.opacity, 1);
        const offsetX = layer.offsetX || 0;
        const offsetY = layer.offsetY || 0;
        const scaleX = layer.scaleX != null ? layer.scaleX : 1;
        const scaleY = layer.scaleY != null ? layer.scaleY : 1;
        el.style.transform = `translate(${offsetX}px, ${offsetY}px) rotate(${layer.rotation || 0}deg) scale(${scaleX}, ${scaleY})`;
        el.style.zIndex = layer.zIndex != null ? layer.zIndex : 1;
        if (layer.type === 'circle') {
          el.style.borderRadius = '50%';
        } else if (layer.type === 'rect') {
          el.style.borderRadius = `${layer.radius || 0}px`;
        }
        if (layer.type === 'rect' || layer.type === 'circle' || layer.type === 'line') {
          const layerFillType = layer.fillType || ((layer.gradientStart || layer.gradientEnd) ? 'gradient' : 'color');
          if (layerFillType === 'gradient') {
            const gradStart = layer.gradientStart || layer.fill || '#ffffff';
            const gradEnd = layer.gradientEnd || gradStart;
            el.style.background = `linear-gradient(90deg, ${gradStart} 0%, ${gradEnd} 100%)`;
          } else {
            el.style.background = layer.fill || '#ffffff';
          }
          if (layer.strokeWidth) {
            el.style.border = `${layer.strokeWidth}px solid ${layer.stroke || '#000000'}`;
          }
          if (layer.padX != null || layer.padY != null) {
            const padX = layer.padX != null ? layer.padX : 0;
            const padY = layer.padY != null ? layer.padY : 0;
            el.style.padding = `${padY}px ${padX}px`;
          }
        }
        if (layer.type === 'text') {
          el.textContent = layer.text || '';
          el.style.color = layer.color || '#ffffff';
          if (layer.fontFamily) el.style.fontFamily = layer.fontFamily;
          if (layer.fontSize != null) el.style.fontSize = `${layer.fontSize}px`;
          if (layer.fontWeight != null) el.style.fontWeight = layer.fontWeight;
          el.style.textAlign = layer.textAlign || 'left';
          if (layer.lineHeight != null) el.style.lineHeight = layer.lineHeight;
          if (layer.textTransform) el.style.textTransform = layer.textTransform;
          if (layer.letterSpacing != null) el.style.letterSpacing = `${layer.letterSpacing}px`;
          if (layer.wordSpacing != null) el.style.wordSpacing = `${layer.wordSpacing}px`;
          el.style.whiteSpace = layer.singleLine ? 'nowrap' : 'normal';
          el.style.writingMode = layer.writingMode || 'horizontal-tb';
          el.style.textOrientation = layer.textOrientation || 'mixed';
          const hAlign = layer.hAlign || layer.textAlign || 'left';
          el.style.justifyContent = hAlign === 'center' ? 'center' : hAlign === 'right' ? 'flex-end' : hAlign === 'justify' ? 'space-between' : 'flex-start';
          const vAlign = layer.vAlign || 'top';
          el.style.alignItems = vAlign === 'bottom' ? 'flex-end' : vAlign === 'middle' ? 'center' : 'flex-start';
          if (layer.writingMode === 'vertical-rl') {
            el.style.direction = 'rtl';
            el.style.unicodeBidi = 'plaintext';
          } else if (layer.writingMode === 'vertical-lr') {
            el.style.direction = 'ltr';
            el.style.unicodeBidi = 'plaintext';
          } else {
            el.style.direction = '';
            el.style.unicodeBidi = '';
          }
        }
        if (layer.type === 'icon') {
          if (layer.color) el.style.color = layer.color;
          if (layer.src) {
            const img = document.createElement('img');
            img.src = layer.src;
            img.alt = layer.name || 'Icon';
            el.appendChild(img);
          } else if (layer.svg) {
            el.innerHTML = layer.svg;
          }
          el.style.mixBlendMode = layer.blendMode || 'normal';
        }
        dom.layerWrap.appendChild(el);
      });
    }

    function renderStyleCanvasRefBox(styleData) {
      const dom = getStyleCanvasDom();
      if (!dom || !dom.refBox || !dom.refText) return;
      const box = styleData.refBox || {};
      const preview = styleCanvasState.preview;
      const baseX = preview.baseX || 0;
      const baseY = preview.baseY || 0;
      const x = baseX + (box.x || 0);
      const y = baseY + (box.yOffset ?? box.y ?? 0);
      const padX = box.padX != null ? box.padX : (box.paddingLeft != null ? box.paddingLeft : (box.padding != null ? box.padding : 24));
      const padY = box.padY != null ? box.padY : (box.paddingBottom != null ? box.paddingBottom : (box.padding != null ? box.padding : 10));
      const minWidth = box.minWidth != null ? box.minWidth : 0;
      const extraWidth = box.extraWidth != null ? box.extraWidth : 0;
      const measured = dom.refText.scrollWidth || 0;
      const textWidth = measured + padX * 2 + extraWidth;
      const width = Math.max(minWidth, textWidth, box.width || 530);
      const height = box.height || 95;
      dom.refBox.style.display = width <= 0 || height <= 0 ? 'none' : 'flex';
      dom.refBox.style.left = `${x}px`;
      dom.refBox.style.top = `${y}px`;
      dom.refBox.style.width = `${width}px`;
      dom.refBox.style.height = `${height}px`;
      const refFillType = box.fillType || (box.gradientStart || box.gradientEnd ? 'gradient' : 'color');
      if (refFillType === 'gradient') {
        const refGradStart = box.gradientStart || box.bgColor || '#00411C';
        const refGradEnd = box.gradientEnd || refGradStart;
        dom.refBox.style.background = `linear-gradient(90deg, ${refGradStart} 0%, ${refGradEnd} 100%)`;
      } else {
        dom.refBox.style.background = box.bgColor || '#00411C';
      }
      dom.refBox.style.borderColor = box.borderColor || '#FFFFFF';
      dom.refBox.style.borderRadius = `${box.borderRadius || 0}px`;
      dom.refBox.style.borderWidth = `${box.borderWidth || 0}px`;
      dom.refBox.style.borderStyle = 'solid';
      dom.refBox.style.opacity = styleCanvasNormalizeOpacity(box.opacity, 1);
      if (box.rotation) {
        dom.refBox.style.transform = `rotate(${box.rotation}deg)`;
        dom.refBox.style.transformOrigin = 'top left';
      } else {
        dom.refBox.style.transform = '';
      }
      if (box.zIndex != null) dom.refBox.style.zIndex = box.zIndex;
      dom.refBox.style.padding = `${padY}px ${padX}px`;
      const textRef = styleData.textPropsRef || {};
      const refFontSize = textRef.fontSize != null ? textRef.fontSize : (box.fontSize || 36);
      const refFontWeight = textRef.fontWeight != null ? textRef.fontWeight : (box.fontWeight || 700);
      dom.refBox.style.fontSize = `${refFontSize}px`;
      dom.refBox.style.fontWeight = `${refFontWeight}`;
      if (textRef.fontFamily) {
        dom.refBox.style.fontFamily = textRef.fontFamily;
        dom.refText.style.fontFamily = textRef.fontFamily;
      } else {
        dom.refBox.style.fontFamily = '';
        dom.refText.style.fontFamily = '';
      }
      dom.refBox.style.color = textRef.color || '#FFFFFF';
      const hAlign = textRef.hAlign || box.hAlign || 'center';
      const vAlign = textRef.vAlign || box.vAlign || 'middle';
      dom.refBox.style.textAlign = textRef.textAlign || 'center';
      dom.refBox.style.alignItems = (hAlign === 'left') ? 'flex-start' : (hAlign === 'right') ? 'flex-end' : (hAlign === 'justify' ? 'stretch' : 'center');
      dom.refBox.style.justifyContent = (vAlign === 'top') ? 'flex-start' : (vAlign === 'bottom') ? 'flex-end' : 'center';
      dom.refBox.style.lineHeight = textRef.lineSpacing || 1.2;
      dom.refBox.style.letterSpacing = `${textRef.letterSpacing || 0}px`;
      dom.refBox.style.wordSpacing = `${textRef.wordSpacing || 0}px`;
      dom.refBox.style.textTransform = textRef.textTransform || 'none';
      const refSingleLine = !(textRef.singleLine === false || textRef.singleLine === 'false');
      dom.refText.style.whiteSpace = refSingleLine ? 'nowrap' : 'normal';
      const refTextRotation = textRef.rotation || 0;
      dom.refText.style.transform = `translate(${textRef.offsetX || 0}px, ${textRef.offsetY || 0}px) rotate(${refTextRotation}deg)`;
      dom.refText.style.writingMode = textRef.writingMode || 'horizontal-tb';
      dom.refText.style.textOrientation = textRef.textOrientation || 'mixed';
      if (textRef.opacity != null) {
        dom.refText.style.opacity = styleCanvasNormalizeOpacity(textRef.opacity, 1);
      } else {
        dom.refText.style.opacity = 1;
      }
      const refShadow = textRef.shadow || styleData.shadow || {};
      const refShadowOpacity = styleCanvasNormalizeOpacity(refShadow.opacity, 0);
      const refShadowX = refShadow.offsetX || 0;
      const refShadowY = refShadow.offsetY != null ? refShadow.offsetY : refShadowX;
      const refShadowBlur = refShadow.blur || 0;
      dom.refBox.style.textShadow = `${refShadowX}px ${refShadowY}px ${refShadowBlur}px ${styleCanvasToRgba(refShadow.color || '#000000', refShadowOpacity)}`;
    }

    function renderStyleCanvasMainBar(styleData) {
      const dom = getStyleCanvasDom();
      if (!dom || !dom.mainBar || !dom.mainText) return;
      const bar = styleData.mainBar || {};
      const preview = styleCanvasState.preview;
      const baseX = preview.baseX || 0;
      const baseY = preview.baseY || 0;
      const height = bar.height ?? bar.minHeight ?? 240;
      const width = bar.width != null ? bar.width : styleCanvasBaseSize.width;
      const x = baseX + (bar.x || 0);
      const top = baseY + (bar.yOffset ?? bar.y ?? 0) - height;
      const barMinWidth = bar.minWidth != null ? bar.minWidth : 0;
      const barExtraWidth = bar.extraWidth != null ? bar.extraWidth : 0;
      const finalWidth = Math.max(0, Math.max(barMinWidth, width + barExtraWidth));
      dom.mainBar.style.display = finalWidth <= 0 ? 'none' : 'flex';
      dom.mainBar.style.left = `${x}px`;
      dom.mainBar.style.top = `${top}px`;
      dom.mainBar.style.width = `${finalWidth}px`;
      dom.mainBar.style.height = `${height}px`;
      const padX = bar.padX != null ? bar.padX : (bar.paddingLeft != null ? bar.paddingLeft : (bar.padding != null ? bar.padding : 10));
      const padY = bar.padY != null ? bar.padY : (bar.paddingBottom != null ? bar.paddingBottom : (bar.padding != null ? bar.padding : 10));
      dom.mainBar.style.padding = `${padY}px ${padX}px`;
      dom.mainBar.style.borderColor = bar.borderColor || 'transparent';
      dom.mainBar.style.borderWidth = `${bar.borderWidth || 0}px`;
      dom.mainBar.style.borderRadius = `${bar.borderRadius || 0}px`;
      dom.mainBar.style.borderStyle = 'solid';
      const barOpacity = styleCanvasNormalizeOpacity(bar.opacity, 1);
      const barFillType = bar.fillType || (bar.gradientStart || bar.gradientEnd ? 'gradient' : 'color');
      if (barFillType === 'gradient') {
        const gradStart = bar.gradientStart || bar.bgColor || '#005E29';
        const gradEnd = bar.gradientEnd || gradStart;
        dom.mainBar.style.background = `linear-gradient(90deg, ${styleCanvasToRgba(gradStart, barOpacity)} 0%, ${styleCanvasToRgba(gradEnd, barOpacity)} 100%)`;
        dom.mainBar.style.opacity = 1;
      } else {
        const bg = bar.bgColor || '#005E29';
        dom.mainBar.style.background = styleCanvasToRgba(bg, barOpacity);
        dom.mainBar.style.opacity = 1;
      }
      if (bar.rotation) {
        dom.mainBar.style.transform = `rotate(${bar.rotation}deg)`;
        dom.mainBar.style.transformOrigin = 'top left';
      } else {
        dom.mainBar.style.transform = '';
      }
      if (bar.zIndex != null) dom.mainBar.style.zIndex = bar.zIndex;
      const textMain = styleData.textPropsMain || {};
      const mainFontSize = textMain.fontSize != null ? textMain.fontSize : 40;
      const mainFontWeight = textMain.fontWeight != null ? textMain.fontWeight : 700;
      dom.mainBar.style.fontSize = `${mainFontSize}px`;
      dom.mainBar.style.fontWeight = `${mainFontWeight}`;
      if (textMain.fontFamily) {
        dom.mainBar.style.fontFamily = textMain.fontFamily;
        dom.mainText.style.fontFamily = textMain.fontFamily;
      } else {
        dom.mainBar.style.fontFamily = '';
        dom.mainText.style.fontFamily = '';
      }
      dom.mainText.style.color = textMain.color || '#FFFFFF';
      dom.mainText.style.lineHeight = textMain.lineSpacing || 1.1;
      dom.mainText.style.textTransform = textMain.textTransform || 'none';
      dom.mainText.style.textAlign = textMain.textAlign || 'left';
      const mainSingleLine = textMain.singleLine === true || textMain.singleLine === 'true';
      dom.mainText.style.whiteSpace = mainSingleLine ? 'nowrap' : 'normal';
      const mainOffsetX = textMain.offsetX || 0;
      const mainOffsetY = textMain.offsetY || 0;
      const mainRotation = textMain.rotation || 0;
      dom.mainText.style.transform = `translate(${mainOffsetX}px, ${mainOffsetY}px) rotate(${mainRotation}deg)`;
      dom.mainText.style.letterSpacing = `${textMain.letterSpacing || 0}px`;
      dom.mainText.style.wordSpacing = `${textMain.wordSpacing || 0}px`;
      dom.mainText.style.writingMode = textMain.writingMode || 'horizontal-tb';
      dom.mainText.style.textOrientation = textMain.textOrientation || 'mixed';
      if (textMain.opacity != null) {
        dom.mainText.style.opacity = styleCanvasNormalizeOpacity(textMain.opacity, 1);
      } else {
        dom.mainText.style.opacity = 1;
      }
      const barVAlign = textMain.vAlign || bar.vAlign || 'middle';
      const barHAlign = textMain.hAlign || bar.hAlign || 'left';
      dom.mainBar.style.alignItems = barVAlign === 'top' ? 'flex-start' : barVAlign === 'bottom' ? 'flex-end' : 'center';
      dom.mainBar.style.justifyContent = barHAlign === 'center' ? 'center' : barHAlign === 'right' ? 'flex-end' : barHAlign === 'justify' ? 'space-between' : 'flex-start';
      const mainShadow = textMain.shadow || styleData.shadow || {};
      const shadowOpacity = styleCanvasNormalizeOpacity(mainShadow.opacity, 0);
      const shadowX = mainShadow.offsetX || 0;
      const shadowY = mainShadow.offsetY != null ? mainShadow.offsetY : shadowX;
      const shadowBlur = mainShadow.blur || 0;
      dom.mainBar.style.textShadow = `${shadowX}px ${shadowY}px ${shadowBlur}px ${styleCanvasToRgba(mainShadow.color || '#000000', shadowOpacity)}`;
    }

    function renderStyleCanvas(styleData) {
      const dom = getStyleCanvasDom();
      if (!dom || !dom.stage) return;
      const sample = styleCanvasState.sample || {};
      if (dom.refText && sample.ref) {
        const versionLabel = sample.version ? ` (${sample.version})` : '';
        dom.refText.textContent = `${sample.ref}${versionLabel}`;
      } else if (dom.refText && !dom.refText.textContent) {
        const fallbackRef = t('preview_ref_default');
        const fallbackVer = t('preview_version_default');
        dom.refText.textContent = `${fallbackRef}${fallbackVer ? ' (' + fallbackVer + ')' : ''}`;
      }
      if (dom.mainText && sample.verseHtml) {
        dom.mainText.innerHTML = sample.verseHtml;
      } else if (dom.mainText && !dom.mainText.innerHTML) {
        dom.mainText.innerHTML = `<span class="preview-verse-sup">1</span>${t('preview_verse_default')}`;
      }
      renderStyleCanvasRefBox(styleData);
      renderStyleCanvasMainBar(styleData);
      renderStyleCanvasLayers(styleData);
      updateStyleCanvasStage();
    }

    function updateStylePreview() {
      initStyleEditorCanvas();
      const dom = getStyleCanvasDom();
      if (!dom || !dom.refBox || !dom.mainBar || !dom.refText || !dom.mainText) return;

      styleCanvasReadControls();
      if (styleCanvasState.preview.autoScale) {
        fitStyleCanvasToWrap();
      }

      const baseStyle = (editingStyleId && ltStyles[editingStyleId]) ? ltStyles[editingStyleId] : (ltStyles['custom'] || {});
      const formData = collectStyleFormData();
      const styleData = {
        ...baseStyle,
        ...formData,
        refBox: { ...(baseStyle.refBox || {}), ...(formData.refBox || {}) },
        mainBar: { ...(baseStyle.mainBar || {}), ...(formData.mainBar || {}) },
        versionBar: { ...(baseStyle.versionBar || {}), ...(formData.versionBar || {}) },
        textPropsMain: { ...(baseStyle.textPropsMain || {}), ...(formData.textPropsMain || {}) },
        textPropsRef: { ...(baseStyle.textPropsRef || {}), ...(formData.textPropsRef || {}) },
        textPropsVersion: { ...(baseStyle.textPropsVersion || {}), ...(formData.textPropsVersion || {}) },
        shadow: { ...(baseStyle.shadow || {}), ...(formData.shadow || {}) },
        layers: Array.isArray(baseStyle.layers) ? baseStyle.layers : [],
        meta: baseStyle.meta || {}
      };

      renderStyleCanvas(styleData);

      const getVal = (id, def) => { const el = document.getElementById(id); return el ? el.value : def; };
      const syncHex = (colorId, hexId) => {
        const colorEl = document.getElementById(colorId);
        const hexEl = document.getElementById(hexId);
        if (colorEl && hexEl) hexEl.value = colorEl.value.toUpperCase();
      };
      syncHex('se-ref-bg-color', 'se-ref-bg-hex');
      syncHex('se-ref-border-color', 'se-ref-border-hex');
      syncHex('se-ref-text-color', 'se-ref-text-color-hex');
      const gradStart = getVal('se-bar-grad-start', '#AD0000');
      const gradEnd = getVal('se-bar-grad-end', '#000000');
      const seBarGradStartHex = document.getElementById('se-bar-grad-start-hex');
      if (seBarGradStartHex) seBarGradStartHex.value = gradStart.toUpperCase();
      const seBarGradEndHex = document.getElementById('se-bar-grad-end-hex');
      if (seBarGradEndHex) seBarGradEndHex.value = gradEnd.toUpperCase();
      const shadowColor = getVal('se-bar-shadow-color', '#000000');
      const seShadowColorHex = document.getElementById('se-shadow-color-hex');
      if (seShadowColorHex) seShadowColorHex.value = shadowColor.toUpperCase();
      scheduleStyleAutosave();
    }

    function collectStyleFormData() {
      // Helper for safe value access
      const getVal = (id, def) => { const el = document.getElementById(id); return el ? el.value : def; };
      const getNum = (id, def) => Number(getVal(id, def)) || def;
      
      const barPadX = getNum('se-bar-pad-x', 10);
      const barPadY = getNum('se-bar-pad-y', 10);
      return {
        refBox: {
          fillType: getVal('se-ref-fill-type', 'color'),
          bgColor: getVal('se-ref-bg-color', '#00411C'),
          gradientStart: getVal('se-ref-grad-start', '#00411C'),
          gradientEnd: getVal('se-ref-grad-end', '#00411C'),
          borderColor: getVal('se-ref-border-color', '#FFFFFF'),
          borderRadius: getNum('se-ref-radius', 10),
          borderWidth: getNum('se-ref-border-width', 2),
          width: getNum('se-ref-width', 530),
          height: getNum('se-ref-height', 95),
          x: getNum('se-ref-x', 30),
          y: getNum('se-ref-y', 0),
          yOffset: getNum('se-ref-y', 0),
          opacity: getNum('se-ref-opacity', 95) / 100,
          padX: getNum('se-ref-pad-x', 24),
          padY: getNum('se-ref-pad-y', 10),
          hAlign: getVal('se-ref-h-align', 'center'),
          vAlign: getVal('se-ref-v-align', 'middle'),
          rotation: getNum('se-ref-rotation', 0),
          zIndex: getNum('se-ref-zindex', 1)
        },
        mainBar: {
          fillType: getVal('se-bar-fill-type', 'gradient'),
          bgColor: getVal('se-bar-bg-color', null) || getVal('se-bar-grad-start', '#AD0000'),
          gradientStart: getVal('se-bar-grad-start', '#AD0000'),
          gradientEnd: getVal('se-bar-grad-end', '#000000'),
          borderColor: getVal('se-bar-border-color', '#FFFFFF'),
          borderRadius: getNum('se-bar-radius', 0),
          borderWidth: getNum('se-bar-border-width', 0),
          height: getNum('se-bar-height', 240),
          minHeight: getNum('se-bar-height', 240),
          x: getNum('se-bar-x', 0),
          y: getNum('se-bar-y', 0),
          yOffset: getNum('se-bar-y', 0),
          width: Math.max(0, getNum('se-bar-width', 1920)),
          padX: barPadX,
          padY: barPadY,
          padding: barPadX,
          paddingLeft: barPadX,
          paddingBottom: barPadY,
          hAlign: getVal('se-bar-h-align', 'left'),
          vAlign: getVal('se-bar-v-align', 'middle'),
          opacity: getNum('se-bar-opacity', 95) / 100,
          rotation: getNum('se-bar-rotation', 0),
          zIndex: getNum('se-bar-zindex', 0)
        },
        textPropsMain: {
          lineSpacing: getNum('se-main-line-spacing', 1.1),
          textTransform: getVal('se-main-text-transform', 'none'),
          textAlign: 'left',
          offsetX: getNum('se-main-offset-x', 0),
          offsetY: getNum('se-main-offset-y', 0),
          singleLine: getVal('se-main-single-line', 'false') === 'true',
          fontFamily: getVal('se-main-text-font-family', ''),
          fontSize: getNum('se-main-text-font-size', 40),
          fontWeight: getNum('se-main-text-font-weight', 700),
          color: getVal('se-main-text-color', '#FFFFFF'),
          hAlign: getVal('se-main-text-h-align', 'left'),
          vAlign: getVal('se-main-text-v-align', 'middle'),
          letterSpacing: getNum('se-main-text-letter-spacing', 0),
          wordSpacing: getNum('se-main-text-word-spacing', 0),
          writingMode: getVal('se-main-text-writing-mode', 'horizontal-tb'),
          textOrientation: getVal('se-main-text-orientation', 'mixed'),
          x: getNum('se-main-text-x', 0),
          y: getNum('se-main-text-y', 0),
          width: getNum('se-main-text-width', 0),
          height: getNum('se-main-text-height', 0),
          rotation: getNum('se-main-text-rotation', 0),
          opacity: getNum('se-main-text-opacity', 100),
          zIndex: getNum('se-main-text-zindex', 2),
          shadow: {
            color: getVal('se-main-text-shadow-color', '#000000'),
            opacity: getNum('se-main-text-shadow-opacity', 0) / 100,
            blur: getNum('se-main-text-shadow-blur', 8),
            offsetX: getNum('se-main-text-shadow-offset', 2)
          }
        },
        textPropsRef: {
          lineSpacing: getNum('se-ref-line-spacing', 1.2),
          color: getVal('se-ref-text-color', '#FFFFFF'),
          textTransform: getVal('se-ref-text-transform', 'none'),
          textAlign: getVal('se-ref-text-h-align', null) || getVal('se-ref-h-align', 'center'),
          offsetX: getNum('se-ref-offset-x', 0),
          offsetY: getNum('se-ref-offset-y', 0),
          singleLine: getVal('se-ref-single-line', 'true') === 'true',
          hAlign: getVal('se-ref-h-align', 'center'),
          vAlign: getVal('se-ref-v-align', 'middle'),
          fontFamily: getVal('se-ref-text-font-family', ''),
          fontSize: getNum('se-ref-text-font-size', 36),
          fontWeight: getNum('se-ref-text-font-weight', 700),
          letterSpacing: getNum('se-ref-text-letter-spacing', 0),
          wordSpacing: getNum('se-ref-text-word-spacing', 0),
          x: getNum('se-ref-text-x', 0),
          y: getNum('se-ref-text-y', 0),
          width: getNum('se-ref-text-width', 0),
          height: getNum('se-ref-text-height', 0),
          rotation: getNum('se-ref-text-rotation', 0),
          opacity: getNum('se-ref-text-opacity', 100),
          zIndex: getNum('se-ref-text-zindex', 2),
          shadow: {
            color: getVal('se-ref-text-shadow-color', '#000000'),
            opacity: getNum('se-ref-text-shadow-opacity', 0) / 100,
            blur: getNum('se-ref-text-shadow-blur', 8),
            offsetX: getNum('se-ref-text-shadow-offset', 2)
          }
        },
        shadow: {
          color: getVal('se-bar-shadow-color', '#000000'),
          opacity: getNum('se-bar-shadow-opacity', 0) / 100,
          blur: getNum('se-bar-shadow-blur', 8),
          offsetX: getNum('se-bar-shadow-offset', 2),
          offsetY: getNum('se-bar-shadow-offset', 2)
        },
        autoResize: getVal('se-bar-auto-resize', 'grow'),
        versionBar: {
          fillType: getVal('se-version-bar-fill-type', 'color'),
          bgColor: getVal('se-version-bar-bg-color', '#1a1a2e'),
          gradientStart: getVal('se-version-bar-grad-start', '#1a1a2e'),
          gradientEnd: getVal('se-version-bar-grad-end', '#16213e'),
          borderColor: getVal('se-version-bar-border-color', '#FFFFFF'),
          borderRadius: getNum('se-version-bar-radius', 8),
          borderWidth: getNum('se-version-bar-border-width', 1),
          width: getNum('se-version-bar-width', 200),
          height: getNum('se-version-bar-height', 50),
          x: getNum('se-version-bar-x', 560),
          y: getNum('se-version-bar-y', -50),
          yOffset: getNum('se-version-bar-y', -50),
          opacity: getNum('se-version-bar-opacity', 95) / 100,
          zIndex: getNum('se-version-bar-zindex', 2),
          padX: getNum('se-version-bar-pad-x', 12),
          padY: getNum('se-version-bar-pad-y', 8),
          hAlign: getVal('se-version-bar-h-align', 'center'),
          vAlign: getVal('se-version-bar-v-align', 'middle'),
          rotation: getNum('se-version-bar-rotation', 0)
        },
        textPropsVersion: {
          fontFamily: getVal('se-version-text-font-family', ''),
          fontSize: getNum('se-version-text-font-size', 24),
          fontWeight: getNum('se-version-text-font-weight', 600),
          color: getVal('se-version-text-color', '#FFFFFF'),
          lineSpacing: getNum('se-version-line-spacing', 1.2),
          textTransform: getVal('se-version-text-transform', 'none'),
          hAlign: getVal('se-version-text-h-align', 'center'),
          vAlign: getVal('se-version-text-v-align', 'middle'),
          offsetX: getNum('se-version-offset-x', 0),
          offsetY: getNum('se-version-offset-y', 0),
          singleLine: getVal('se-version-single-line', 'true') === 'true',
          letterSpacing: getNum('se-version-text-letter-spacing', 0),
          wordSpacing: getNum('se-version-text-word-spacing', 0),
          writingMode: getVal('se-version-text-writing-mode', 'horizontal-tb'),
          textOrientation: getVal('se-version-text-orientation', 'mixed'),
          x: getNum('se-version-text-x', 0),
          y: getNum('se-version-text-y', 0),
          width: getNum('se-version-text-width', 0),
          height: getNum('se-version-text-height', 0),
          rotation: getNum('se-version-text-rotation', 0),
          opacity: getNum('se-version-text-opacity', 100),
          zIndex: getNum('se-version-text-zindex', 3),
          shadow: {
            color: getVal('se-version-text-shadow-color', '#000000'),
            opacity: getNum('se-version-text-shadow-opacity', 0) / 100,
            blur: getNum('se-version-text-shadow-blur', 8),
            offsetX: getNum('se-version-text-shadow-offset', 2)
          },
          autoResize: getVal('se-version-text-auto-resize', 'grow')
        }
      };
    }

    function mergeStyleData(baseStyle, changes) {
      const base = baseStyle || {};
      const next = changes || {};
      return {
        ...base,
        ...next,
        refBox: { ...(base.refBox || {}), ...(next.refBox || {}) },
        mainBar: { ...(base.mainBar || {}), ...(next.mainBar || {}) },
        versionBar: { ...(base.versionBar || {}), ...(next.versionBar || {}) },
        textPropsMain: { ...(base.textPropsMain || {}), ...(next.textPropsMain || {}) },
        textPropsRef: { ...(base.textPropsRef || {}), ...(next.textPropsRef || {}) },
        textPropsVersion: { ...(base.textPropsVersion || {}), ...(next.textPropsVersion || {}) },
        shadow: { ...(base.shadow || {}), ...(next.shadow || {}) },
        meta: { ...(base.meta || {}), ...(next.meta || {}) },
        layers: Array.isArray(next.layers) ? next.layers : (Array.isArray(base.layers) ? base.layers : [])
      };
    }

    function shouldAutoPersistStyle(styleId) {
      if (!styleId || !ltStyles[styleId]) return false;
      if (styleId === 'custom') return true;
      return !!ltStyles[styleId].deletable;
    }

    function scheduleStyleAutosave() {
      if (!editingStyleId || !shouldAutoPersistStyle(editingStyleId)) return;
      if (isRestoringBackup) return;
      tempStyleChanges = collectStyleFormData();
      clearTimeout(styleAutosaveTimer);
      styleAutosaveTimer = setTimeout(() => {
        if (!editingStyleId || !ltStyles[editingStyleId]) return;
        ltStyles[editingStyleId] = mergeStyleData(ltStyles[editingStyleId], tempStyleChanges);
        saveToStorageDebounced();
        persistLtStyles();
      }, 600);
    }

    function flushStyleAutosave() {
      if (!editingStyleId || !shouldAutoPersistStyle(editingStyleId)) return;
      if (isRestoringBackup) return;
      clearTimeout(styleAutosaveTimer);
      tempStyleChanges = collectStyleFormData();
      ltStyles[editingStyleId] = mergeStyleData(ltStyles[editingStyleId], tempStyleChanges);
      saveToStorage();
      persistLtStyles();
    }

    function applyStyleChanges() {
      if (!editingStyleId || !ltStyles[editingStyleId]) return;
      
      tempStyleChanges = collectStyleFormData();
      ltStyle = editingStyleId;
      renderLtStylePicker();
      
      if (isLive && livePointer) {
        scheduleLiveUpdate();
        showToast(t('style_applied_to_output'));
      } else {
        showToast(t('style_ready_not_live'));
      }
    }

    function saveStyleEdits() {
      if (!editingStyleId || !ltStyles[editingStyleId]) return;
      
      const changes = tempStyleChanges || collectStyleFormData();
      
      ltStyles[editingStyleId] = mergeStyleData(ltStyles[editingStyleId], changes);
      
      tempStyleChanges = null;
      
      saveToStorageDebounced();
      saveToStorage();
      Promise.all([flushAppState(), persistLtStyles()]).finally(() => {
        closeModal('styleEditorModal');
        renderLtStylePicker();
        onAnyControlChange();
        showToast(t('style_saved_successfully'));
      });
    }

    function saveStyleAsTemplate() {
      const baseName = (ltStyles[editingStyleId || ltStyle]?.name || 'Custom Style') + ' Copy';
      showConfirm(t('style_save_new_template'), t('style_give_name_prompt'), (name) => {
        const finalName = (typeof name === 'string' && name.trim()) ? name.trim() : null;
        if (!finalName) {
          showToast(t('style_name_required_template'));
          return;
        }
        const newId = `custom_${Date.now()}`;
        const payload = collectStyleFormData();
        const baseStyle = ltStyles[editingStyleId || ltStyle] || {};
        const merged = mergeStyleData(baseStyle, payload);
        ltStyles[newId] = {
          ...merged,
          name: finalName,
          type: 'custom',
          deletable: true
        };
        ltStyle = newId;
        editingStyleId = newId;
        renderLtStylePicker();
        saveToStorageDebounced();
        saveToStorage();
        Promise.all([flushAppState(), persistLtStyles()]).finally(() => {
          updateStyleEditorMeta(ltStyles[newId]);
          showToast(t('style_saved_named').replace('{name}', finalName));
        });
      }, true);
      const input = document.getElementById('confirm-input');
      if (input) input.value = baseName;
    }

    function setPreviewScale(scale = 1) {
      const appliedScale = Number(scale) || 1;
      const container = document.getElementById('previewContainer');
      document.documentElement.style.setProperty('--preview-base-scale', appliedScale);
      if (container) {
        container.style.transform = `scale(${appliedScale})`;
        container.style.transformOrigin = 'top center';
      }
    }

    function getStyleName(style) {
      if (!style) return '';
      if (style.nameKey) {
        const translated = t(style.nameKey);
        if (translated && translated !== style.nameKey) return translated;
      }
      return style.name || '';
    }

    function renderLtStylePicker() {
      const container = document.getElementById('lt-style-container');
      container.innerHTML = '';
      
      Object.keys(ltStyles).forEach(styleId => {
        const style = ltStyles[styleId];
        const btn = document.createElement('button');
        btn.className = `lt-style-btn ${ltStyle === styleId ? 'active' : ''}`;
        btn.id = `lt-style-${styleId}`;
        btn.textContent = getStyleName(style) || styleId;
        btn.onclick = () => setLtStyle(styleId);
        
        if (style.type === 'custom' || style.deletable) {
          const editBtn = document.createElement('button');
          editBtn.className = 'lt-style-edit';
          editBtn.textContent = '✎';
          editBtn.onclick = (e) => {
            e.stopPropagation();
            openStyleEditor(styleId);
          };
          btn.appendChild(editBtn);
        }
        
        if (style.deletable) {
          const delBtn = document.createElement('button');
          delBtn.className = 'lt-style-delete';
          delBtn.textContent = '✕';
          delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteStyle(styleId);
          };
          btn.appendChild(delBtn);
        }
        
        container.appendChild(btn);
      });
      renderStyleEditorSelect();
    }

    function promptSavePreset() {
      showConfirm(t('preset_save_preset'), t('preset_enter_name'), (name) => {
        const finalName = (name || '').trim();
        if (!finalName) { showToast(t('preset_name_required')); return; }
        const exists = presets.find(p => p.name.toLowerCase() === finalName.toLowerCase());
        if (exists) {
          showConfirm(t('preset_replace_preset'), t('preset_exists_replace').replace('{name}', finalName), () => {
            savePreset(finalName, true);
          });
        } else {
          savePreset(finalName, false);
        }
      }, true);
    }

    function savePreset(name, replaceExisting) {
      const snapshot = getUiSnapshot();
      const payload = {
        id: replaceExisting && presets.find(p => p.name === name)?.id ? presets.find(p => p.name === name).id : `preset_${Date.now()}`,
        name,
        ui: snapshot
      };
      if (replaceExisting) {
        presets = presets.map(p => p.name === name ? payload : p);
      } else {
        presets.push(payload);
      }
      renderPresetList();
      saveToStorageDebounced();
      showToast(replaceExisting ? t('preset_replaced') : t('preset_saved'));
    }

    function applyPreset(id) {
      const p = presets.find(pr => pr.id === id);
      if (!p || !p.ui) return;
      applyUiSnapshot(p.ui);
      renderPresetList();
      onAnyControlChange();
      showToast(t('preset_applied_named').replace('{name}', p.name));
    }

    function deletePreset(id) {
      presets = presets.filter(p => p.id !== id);
      renderPresetList();
      saveToStorageDebounced();
      showToast(t('preset_deleted'));
    }

    function renderPresetList() {
      const list = document.getElementById('preset-list');
      if (!list) return;
      list.innerHTML = '';
      if (!presets.length) {
        const empty = document.createElement('div');
        empty.style.padding = '8px';
        empty.style.color = 'var(--text-secondary)';
        empty.style.fontSize = '12px';
        empty.innerText = t('common_no_presets_saved');
        list.appendChild(empty);
        return;
      }
      presets.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'preset-row';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.padding = '8px 10px';
        row.style.margin = '4px 0';
        row.style.background = 'rgba(255,255,255,0.04)';
        row.style.border = '1px solid var(--border)';
        row.style.borderRadius = '8px';
        row.draggable = true;
        row.dataset.index = idx;

        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '8px';

        const drag = document.createElement('span');
        drag.innerText = '≡';
        drag.style.cursor = 'grab';
        drag.style.color = 'var(--text-secondary)';
        drag.style.userSelect = 'none';
        left.appendChild(drag);

        const name = document.createElement('span');
        name.style.cursor = 'pointer';
        name.style.fontWeight = '700';
        name.innerText = p.name;
        name.onclick = () => applyPreset(p.id);
        left.appendChild(name);

        const del = document.createElement('button');
        del.className = 'btn';
        del.style.background = 'var(--danger)';
        del.style.padding = '6px 10px';
        del.style.minWidth = '44px';
        del.innerText = '🗑';
        del.onclick = (e) => { e.stopPropagation(); deletePreset(p.id); };

        row.appendChild(left);
        row.appendChild(del);

        row.addEventListener('dragstart', () => { row.classList.add('dragging'); row.style.opacity = '0.6'; });
        row.addEventListener('dragend', () => {
          row.classList.remove('dragging');
          row.style.opacity = '1';
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          const dragging = document.querySelector('.preset-row.dragging');
          if (!dragging) return;
          const draggingIdx = Number(dragging.dataset.index);
          const overIdx = Number(row.dataset.index);
          if (draggingIdx === overIdx) return;
          const item = presets.splice(draggingIdx, 1)[0];
          presets.splice(overIdx, 0, item);
          renderPresetList();
          saveToStorageDebounced();
        });

        list.appendChild(row);
      });
    }

    function ensureSamplePreset() {
      const exists = presets.some(p => (p.name || '').toLowerCase() === 'lyrics');
      if (exists) return;
      const snap = getUiSnapshot();
      snap.linesPerPage = 2;
      snap.activeRatio = '16-9';
      snap.songTransitionType = 'zoom-type';
      const sample = { id: 'preset_default_lyrics', name: 'Lyrics', ui: snap };
      presets.push(sample);
      renderPresetList();
      saveToStorageDebounced();
    }

    function renderStyleEditorSelect(selectedId) {
      const select = document.getElementById('style-editor-select');
      if (!select) return;
      const current = selectedId || editingStyleId || ltStyle;
      select.innerHTML = '';
      Object.keys(ltStyles).forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = getStyleName(ltStyles[id]) || id;
        select.appendChild(opt);
      });
      if (current && ltStyles[current]) {
        select.value = current;
      }
    }

    function handleStyleSelectChange(sel) {
      const id = sel.value;
      if (!id || !ltStyles[id]) return;
      openStyleEditor(id);
    }

    function setLtStyle(styleId) {
      ltStyle = styleId;
      renderLtStylePicker();
      onAnyControlChange();
    }

    function deleteStyle(styleId) {
      if (!ltStyles[styleId] || !ltStyles[styleId].deletable) return;
      showConfirm('Delete Style', `Delete style "${ltStyles[styleId].name}"?`, () => {
        delete ltStyles[styleId];
        if (ltStyle === styleId) ltStyle = 'custom';
        renderLtStylePicker();
        saveToStorageDebounced();
        Promise.all([flushAppState(), persistLtStyles()]).finally(() => {
          onAnyControlChange();
          showToast('Style deleted');
        });
      });
    }

    function exportCurrentStyle() {
      showConfirm('Export Style', 'Enter name for this style:', name => {
        if (!name) return;
        const currentStyleData = ltStyles[ltStyle] || {};
        const pendingChanges = (tempStyleChanges && editingStyleId === ltStyle) ? tempStyleChanges : null;
        const mergedStyle = pendingChanges ? mergeStyleData(currentStyleData, pendingChanges) : currentStyleData;
        const styleId = `saved_${Date.now()}`;
        ltStyles[styleId] = {
          name,
          type: 'custom',
          deletable: true,
          refBox: mergedStyle.refBox || {},
          mainBar: mergedStyle.mainBar || {},
          versionBar: mergedStyle.versionBar || {},
          textPropsMain: mergedStyle.textPropsMain || mergedStyle.textProps || {},
          textPropsRef: mergedStyle.textPropsRef || mergedStyle.textProps || {},
          textPropsVersion: mergedStyle.textPropsVersion || {},
          shadow: mergedStyle.shadow || {},
          autoResize: mergedStyle.autoResize || 'none',
          layers: Array.isArray(mergedStyle.layers) ? mergedStyle.layers : [],
          meta: mergedStyle.meta || {}
        };
        renderLtStylePicker();
        saveToStorageDebounced();
        Promise.all([flushAppState(), persistLtStyles()]).finally(() => {
          showToast('Style saved');
        });
      }, true);
    }

    function handleStyleImport(input) {
      const file = input.files && input.files[0];
      if (!file) {
        console.log('No file selected');
        return;
      }
      
      console.log('Importing style file:', file.name, file.type, file.size);
      
      const reader = new FileReader();
      reader.onerror = (err) => {
        console.error('FileReader error:', err);
        showToast('Error reading file');
      };
      reader.onload = () => {
        console.log('File loaded, parsing JSON...');
        try {
          const styleData = JSON.parse(reader.result);
          console.log('Parsed style data:', Object.keys(styleData));
          const styleId = `custom_${Date.now()}`;
          
          // Check if this is a Lower Third Designer export (has refBox/mainBar at top level)
          const isLowerThirdDesigner = styleData.refBox || styleData.mainBar || styleData.layers || 
            (styleData.meta && styleData.meta.app === 'Lower Third Designer');
          
          console.log('Is Lower Third Designer format:', isLowerThirdDesigner);
          
          if (styleData.template && !isLowerThirdDesigner) {
            // Legacy template format (.fstemplate)
            const item1 = styleData.template.items[0];
            const item2 = styleData.template.items[1] || item1;
            ltStyles[styleId] = {
              name: styleData.template.name || 'Imported Style',
              type: 'custom',
              deletable: true,
              refBox: parseStyleFromTemplate(item1.style, item1.lines[0]),
              mainBar: parseStyleFromTemplate(item2.style, item2.lines[0]),
              textPropsMain: { lineSpacing: 1.1, textAlign: 'left', textTransform: 'none', offsetX: 0, offsetY: 0, singleLine: false },
              textPropsRef: { lineSpacing: 1.2, textAlign: 'center', textTransform: 'none', offsetX: 0, offsetY: 0, singleLine: true },
              shadow: { color: '#000000', opacity: 0.8, blur: 8, offsetX: 2, offsetY: 2 },
              autoResize: 'none'
            };
          } else {
            // Lower Third Designer format (Index design.html export)
            // Deep clone layers to preserve all properties
            const importedLayers = Array.isArray(styleData.layers) 
              ? styleData.layers.map(layer => JSON.parse(JSON.stringify(layer))) 
              : [];
            
            ltStyles[styleId] = {
              name: styleData.name || 'Imported Style',
              type: 'custom',
              deletable: true,
              refBox: styleData.refBox ? JSON.parse(JSON.stringify(styleData.refBox)) : {},
              mainBar: styleData.mainBar ? JSON.parse(JSON.stringify(styleData.mainBar)) : {},
              versionBar: styleData.versionBar ? JSON.parse(JSON.stringify(styleData.versionBar)) : {},
              textPropsMain: styleData.textPropsMain ? JSON.parse(JSON.stringify(styleData.textPropsMain)) : (styleData.textProps ? JSON.parse(JSON.stringify(styleData.textProps)) : {}),
              textPropsRef: styleData.textPropsRef ? JSON.parse(JSON.stringify(styleData.textPropsRef)) : (styleData.textProps ? JSON.parse(JSON.stringify(styleData.textProps)) : {}),
              textPropsVersion: styleData.textPropsVersion ? JSON.parse(JSON.stringify(styleData.textPropsVersion)) : {},
              shadow: styleData.shadow ? JSON.parse(JSON.stringify(styleData.shadow)) : {},
              autoResize: styleData.autoResize || 'none',
              layers: importedLayers,
              meta: styleData.meta ? JSON.parse(JSON.stringify(styleData.meta)) : {}
            };
            
            console.log('Imported Lower Third Designer style:', styleData.name, ltStyles[styleId]);
          }
          
          renderLtStylePicker();
          saveToStorageDebounced();
          Promise.all([flushAppState(), persistLtStyles()]).finally(() => {
            showToast(`Style "${styleData.name || styleData.template?.name || 'Imported'}" imported successfully`);
          });
        } catch (e) {
          console.error('Style import error:', e);
          showToast('Invalid style file format: ' + e.message);
        }
      };
      reader.readAsText(file);
      input.value = '';
    }

    function parseStyleFromTemplate(styleStr, line) {
      const props = {};
      const bgMatch = styleStr.match(/background-color:([^;]+)/);
      if (bgMatch) props.bgColor = bgMatch[1].trim();
      const borderColorMatch = styleStr.match(/border-color:([^;]+)/);
      if (borderColorMatch) props.borderColor = borderColorMatch[1].trim();
      const borderRadiusMatch = styleStr.match(/border-radius:([0-9]+)px/);
      if (borderRadiusMatch) props.borderRadius = Number(borderRadiusMatch[1]);
      const borderWidthMatch = styleStr.match(/border-width:([0-9]+)px/);
      if (borderWidthMatch) props.borderWidth = Number(borderWidthMatch[1]);
      const widthMatch = styleStr.match(/width:([0-9]+)px/);
      if (widthMatch) props.width = Number(widthMatch[1]);
      const heightMatch = styleStr.match(/height:([0-9.]+)px/);
      if (heightMatch) props.height = Number(heightMatch[1]);
      const leftMatch = styleStr.match(/left:([0-9.]+)px/);
      if (leftMatch) props.x = Number(leftMatch[1]);
      const topMatch = styleStr.match(/top:([0-9.]+)px/);
      if (topMatch) props.yOffset = Number(topMatch[1]) - 860;
      props.opacity = 1;
      if (line && line.text && line.text[0]) {
        const gradStart = line.text[0].style.match(/color:([^;]+)/);
        if (gradStart) {
          props.gradientStart = gradStart[1].trim();
          props.gradientEnd = gradStart[1].trim();
        }
      }
      const paddingMatch = styleStr.match(/padding:[^;]*\s([0-9]+)px/);
      if (paddingMatch) {
        props.padding = Number(paddingMatch[1]);
        props.paddingLeft = props.padding;
        props.paddingBottom = props.padding;
      }
      const minHeightMatch = styleStr.match(/height:([0-9.]+)px/);
      if (minHeightMatch) {
        props.height = Number(minHeightMatch[1]);
        props.minHeight = Number(minHeightMatch[1]);
      }
      return props;
    }

    function saveToStorage() {
      if (!stateReady || isRestoringBackup) {
        pendingPersist = true;
        return;
      }
      syncAppStateFromUi();
      const updatedAt = Date.now();
      appStateUpdatedAt = updatedAt;
      const payload = { key: 'appState', value: appState, updatedAt };
      idbPut(STORE_STATE, payload).catch(() => {});
      persistBackgroundState();
      persistAnimationState();
      persistTypographyState();
      persistModeSettings();
      queueRelayStatePush();
    }

    function recoverLiveBiblePointerFromCurrentItem() {
      if (!currentItem || !getIsBibleItem(currentItem)) return false;
      const version = currentItem.version;
      const list = (version && bibles && Array.isArray(bibles[version])) ? bibles[version] : null;
      if (!list || !list.length) return false;
      let idx = list.indexOf(currentItem);
      if (idx === -1 && Number.isFinite(currentIndex) && currentIndex >= 0 && currentIndex < list.length) {
        const candidate = list[currentIndex];
        if (candidate && candidate.title === currentItem.title) idx = currentIndex;
      }
      if (idx === -1) {
        idx = list.findIndex(item => item && item.title === currentItem.title);
      }
      if (idx < 0) return false;
      liveKind = 'bible';
      livePointer = { kind: 'bible', version, index: idx, source: 'bible' };
      liveLineCursor = Math.max(0, Number(lineCursor) || 0);
      return true;
    }


    function setupPresetPopoverDismiss() {
      const repositionPresetIfOpen = () => {
        if (!presetPopoverOpen) return;
        positionPresetPopover();
      };
      window.addEventListener('resize', repositionPresetIfOpen);
      window.addEventListener('scroll', repositionPresetIfOpen, true);

      document.addEventListener('click', (e) => {
        const pop = document.getElementById('preset-popover');
        const btn = document.getElementById('btn-preset');
        if (pop && btn && presetPopoverOpen && !(pop.contains(e.target) || btn.contains(e.target))) {
          setPresetPopoverOpen(false);
        }

        const outputPop = document.getElementById('output-popover');
        const outputBtn = document.getElementById('btn-open-standalone-output');
        if (outputPop && outputBtn && outputPopoverOpen && !(outputPop.contains(e.target) || outputBtn.contains(e.target))) {
          outputPop.classList.remove('open');
          outputPopoverOpen = false;
        }
      });
      
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && presetPopoverOpen) {
          setPresetPopoverOpen(false);
        }
        if (e.key === 'Escape' && outputPopoverOpen) {
          const outputPop = document.getElementById('output-popover');
          if (outputPop) outputPop.classList.remove('open');
          outputPopoverOpen = false;
        }
      });
    }

    function setupScrollPersistence() {
      const list = document.getElementById('song-list');
      const buttons = document.getElementById('lyric-buttons');
      const handler = () => saveToStorageDebounced();
      if (list) list.addEventListener('scroll', handler, { passive: true });
      if (buttons) buttons.addEventListener('scroll', handler, { passive: true });
    }

    function bindEventsOnce() {
      if (window.__bspEventsBound) return;
      window.__bspEventsBound = true;
      installNativeEditShortcutBypass();
      setupKeyboardShortcuts();
      setupUrlPasteShortcuts();
      setupPresetPopoverDismiss();
      setupFooterBibleVersionPopover();
      setupSceneLayerContextMenu();
      setupScrollPersistence();
      setupSidebarQuickActions();
      setupSidebarResizePersistence();
      setupFocusedMainPanelEvents();
      setupCollapsibleSettings();
      setupExplicitTooltips();
      bindSearchEnter();
      bindLyricEditorShortcuts();
      bindTypingShortcutGuards();
      positionFooterPrimaryTabs();
      if (typeof ResizeObserver === 'function' && !window.__footerPrimaryTabsObserverBound) {
        window.__footerPrimaryTabsObserverBound = true;
        const footer = document.getElementById('page-nav-bar');
        const main = document.getElementById('main');
        const sidebar = document.getElementById('sidebar');
        const workspaceTop = document.getElementById('workspace-top');
        const ro = new ResizeObserver(() => positionFooterPrimaryTabs());
        [footer, main, sidebar, workspaceTop].forEach((el) => {
          if (el) ro.observe(el);
        });
      }
      const styleCloseBtn = document.getElementById('style-editor-close-btn');
      if (styleCloseBtn && !styleCloseBtn.dataset.bound) {
        styleCloseBtn.dataset.bound = '1';
        styleCloseBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeModal('styleEditorModal');
        });
      }
      window.addEventListener('beforeunload', () => {
        saveToStorage();
        persistLtStyles();
        persistBackgroundState();
        persistAnimationState();
        persistTypographyState();
        persistModeSettings();
        disconnectRelay();
      });
    }
    
    function setupSidebarResizePersistence() {
      const sidebar = document.getElementById('sidebar');
      const vHandle = document.getElementById('sidebar-resize-handle');
      const hHandle = document.getElementById('sidebar-width-handle');
      const main = document.getElementById('main');
      const programHandle = document.getElementById('program-width-handle');
      const leftWorkspace = document.getElementById('left-workspace');
      const workspaceTop = document.getElementById('workspace-top');
      const studioDock = document.getElementById('studio-dock');
      const workspaceHandle = document.getElementById('workspace-height-handle');
      if (!sidebar) return;
      const mq = window.matchMedia('(max-width: 768px)');
      const unifiedLeftWidthKey = 'leftPanelUnifiedWidth';
      const safeSetPointerCapture = (el, pointerId) => {
        try {
          if (el && typeof el.setPointerCapture === 'function' && pointerId != null) {
            el.setPointerCapture(pointerId);
          }
        } catch (e) {}
      };
      const safeReleasePointerCapture = (el, pointerId) => {
        try {
          if (el && typeof el.releasePointerCapture === 'function' && pointerId != null) {
            el.releasePointerCapture(pointerId);
          }
        } catch (e) {}
      };

      const dragOverlay = document.getElementById('resize-drag-overlay');
      function showDragOverlay(cursor) {
        if (dragOverlay) {
          dragOverlay.style.display = 'block';
          dragOverlay.style.cursor = cursor || 'ns-resize';
        }
      }
      function hideDragOverlay() {
        if (dragOverlay) dragOverlay.style.display = 'none';
      }

      function getLeftRailWidth() {
        return 0;
      }

      function getCurrentLeftPanelWidth() {
        return main ? main.offsetWidth : 0;
      }

      function getNarrowSidebarDefaultHeight() {
        const topbar = document.getElementById('app-topbar');
        const footer = document.getElementById('page-nav-bar');
        const topbarHeight = topbar ? topbar.offsetHeight : 36;
        const footerHeight = footer ? footer.offsetHeight : 36;
        const available = Math.max(100, window.innerHeight - topbarHeight - footerHeight);
        return available;
      }

      function applyUnifiedLeftPanelWidth(px) {
        // In OBS isolated mode the panel should always stretch to fill the
        // available width — skip any fixed/clamped sizing so the CSS
        // flex: 1 1 auto on #left-workspace and #main handles it.
        if (document.body.classList.contains('obs-isolated')) {
          if (leftWorkspace) { leftWorkspace.style.width = ''; leftWorkspace.style.flexBasis = ''; }
          if (main) { main.style.width = ''; main.style.maxWidth = ''; main.style.flexBasis = ''; }
          return;
        }
        if (!Number.isFinite(px) || px <= 0) return;
        const clampedTotal = Math.min(980, Math.max(560, px));
        if (main) {
          const mainW = Math.round(clampedTotal);
          const width = mainW + 'px';
          main.style.width = width;
          main.style.maxWidth = width;
          main.style.flexBasis = width;
          if (leftWorkspace) {
            leftWorkspace.style.width = '';
            leftWorkspace.style.flexBasis = '';
          }
        }
      }

      function saveUnifiedLeftPanelWidth() {
        try {
          localStorage.setItem(unifiedLeftWidthKey, Math.round(getCurrentLeftPanelWidth()) + 'px');
        } catch (e) {}
      }

      function restoreUnifiedLeftPanelWidth() {
        if (mq.matches) return;
        // In OBS isolated mode, never restore a fixed width — let flex fill.
        if (document.body.classList.contains('obs-isolated')) return;
        let saved = '';
        try { saved = localStorage.getItem(unifiedLeftWidthKey) || ''; } catch (e) {}
        const px = parseFloat(saved);
        if (Number.isFinite(px) && px > 0) {
          applyUnifiedLeftPanelWidth(px);
          return;
        }
        // Fallback migration from old keys (if present)
        try {
          const mainSaved = parseFloat(localStorage.getItem('mainPanelWidth') || '');
          const altSaved = parseFloat(localStorage.getItem('leftWorkspaceWidth') || '');
          if (Number.isFinite(mainSaved) && mainSaved > 0) {
            applyUnifiedLeftPanelWidth(mainSaved);
          } else if (Number.isFinite(altSaved) && altSaved > 0) {
            applyUnifiedLeftPanelWidth(altSaved);
          }
        } catch (e) {}
      }

      window._saveUnifiedLeftPanelWidth = saveUnifiedLeftPanelWidth;
      window._restoreUnifiedLeftPanelWidth = restoreUnifiedLeftPanelWidth;

      // === VERTICAL (top-mounted, ≤768px) ===
      function heightKey(tab) { return 'sidebarTopHeight_' + (tab || sidebarTab || 'bible'); }
      function restoreSidebarHeight() {
        if (!mq.matches) return;
        try {
          const saved = localStorage.getItem(heightKey());
          const savedPx = parseFloat(saved || '');
          const defaultHeight = getNarrowSidebarDefaultHeight();
          if (Number.isFinite(savedPx) && savedPx > 320) sidebar.style.height = saved;
          else sidebar.style.height = defaultHeight + 'px';
        } catch(e) {}
      }
      window._saveSidebarTabHeight = function(tab) {
        if (!mq.matches) return;
        try { localStorage.setItem(heightKey(tab), sidebar.style.height || sidebar.offsetHeight + 'px'); } catch(e) {}
      };
      window._restoreSidebarTabHeight = function() { restoreSidebarHeight(); };
      restoreSidebarHeight();
      if (vHandle) {
        let vDrag = false, vStartY = 0, vStartH = 0;
        vHandle.addEventListener('pointerdown', (e) => {
          if (!mq.matches) return;
          vDrag = true; vStartY = e.clientY; vStartH = sidebar.offsetHeight;
          sidebar.style.transition = 'none';
          safeSetPointerCapture(vHandle, e.pointerId);
          showDragOverlay('ns-resize');
          document.body.style.cursor = 'ns-resize';
          document.body.style.userSelect = 'none';
          e.preventDefault(); e.stopPropagation();
        });
        vHandle.addEventListener('pointermove', (e) => {
          if (!vDrag) return;
          const newH = Math.min(getNarrowSidebarDefaultHeight(), Math.max(100, vStartH + e.clientY - vStartY));
          sidebar.style.height = newH + 'px';
        });
        vHandle.addEventListener('pointerup', (e) => {
          if (!vDrag) return;
          vDrag = false; sidebar.style.transition = '';
          safeReleasePointerCapture(vHandle, e.pointerId);
          hideDragOverlay();
          document.body.style.cursor = ''; document.body.style.userSelect = '';
          try { localStorage.setItem(heightKey(), sidebar.style.height); } catch(e) {}
        });
        vHandle.addEventListener('pointercancel', () => {
          if (!vDrag) return;
          vDrag = false; sidebar.style.transition = '';
          hideDragOverlay();
          document.body.style.cursor = ''; document.body.style.userSelect = '';
        });
      }

      // === HORIZONTAL (side-mounted, >768px) ===
      function restoreSidebarWidth() {
        if (mq.matches) return;
        if (getComputedStyle(sidebar).position === 'fixed') {
          sidebar.style.width = '200px';
          sidebar.style.minWidth = '200px';
          sidebar.style.maxWidth = '200px';
          return;
        }
        try {
          const saved = localStorage.getItem('sidebarWidth');
          if (saved) { sidebar.style.width = saved; sidebar.style.minWidth = saved; }
        } catch(e) {}
      }
      restoreSidebarWidth();
      if (hHandle) {
        let hDrag = false, hStartX = 0, hStartW = 0;
        hHandle.addEventListener('pointerdown', (e) => {
          if (mq.matches) return;
          hDrag = true; hStartX = e.clientX; hStartW = sidebar.offsetWidth;
          sidebar.style.transition = 'none';
          safeSetPointerCapture(hHandle, e.pointerId);
          showDragOverlay('ew-resize');
          document.body.style.cursor = 'ew-resize';
          document.body.style.userSelect = 'none';
          e.preventDefault(); e.stopPropagation();
        });
        hHandle.addEventListener('pointermove', (e) => {
          if (!hDrag) return;
          const newW = Math.min(500, Math.max(150, hStartW + e.clientX - hStartX));
          sidebar.style.width = newW + 'px';
          sidebar.style.minWidth = newW + 'px';
        });
        hHandle.addEventListener('pointerup', (e) => {
          if (!hDrag) return;
          hDrag = false; sidebar.style.transition = '';
          safeReleasePointerCapture(hHandle, e.pointerId);
          hideDragOverlay();
          document.body.style.cursor = ''; document.body.style.userSelect = '';
          try { localStorage.setItem('sidebarWidth', sidebar.style.width); } catch(e) {}
        });
        hHandle.addEventListener('pointercancel', () => {
          if (!hDrag) return;
          hDrag = false; sidebar.style.transition = '';
          hideDragOverlay();
          document.body.style.cursor = ''; document.body.style.userSelect = '';
        });
      }

      // === MAIN/LEFT vs DISPLAY SPLIT (desktop, unified across tabs) ===
      restoreUnifiedLeftPanelWidth();
      if (programHandle && main) {
        let pDrag = false, pStartX = 0, pStartW = 0;
        programHandle.addEventListener('pointerdown', (e) => {
          if (mq.matches) return;
          pDrag = true; pStartX = e.clientX; pStartW = getCurrentLeftPanelWidth();
          if (leftWorkspace) leftWorkspace.style.transition = 'none';
          main.style.transition = 'none';
          safeSetPointerCapture(programHandle, e.pointerId);
          showDragOverlay('ew-resize');
          document.body.style.cursor = 'ew-resize';
          document.body.style.userSelect = 'none';
          e.preventDefault(); e.stopPropagation();
        });
        programHandle.addEventListener('pointermove', (e) => {
          if (!pDrag) return;
          applyUnifiedLeftPanelWidth(pStartW + e.clientX - pStartX);
        });
        programHandle.addEventListener('pointerup', (e) => {
          if (!pDrag) return;
          pDrag = false;
          if (leftWorkspace) leftWorkspace.style.transition = '';
          main.style.transition = '';
          saveUnifiedLeftPanelWidth();
          safeReleasePointerCapture(programHandle, e.pointerId);
          hideDragOverlay();
          document.body.style.cursor = ''; document.body.style.userSelect = '';
        });
        programHandle.addEventListener('pointercancel', () => {
          if (!pDrag) return;
          pDrag = false;
          if (leftWorkspace) leftWorkspace.style.transition = '';
          main.style.transition = '';
          hideDragOverlay();
          document.body.style.cursor = ''; document.body.style.userSelect = '';
        });
      }

      // === TOP vs DOCK SPLIT (desktop) ===
      function restoreStudioDockHeight() {
        if (mq.matches || !studioDock) return;
        try {
          const saved = localStorage.getItem('studioDockHeight');
          if (saved) studioDock.style.height = saved;
        } catch (e) {}
      }
      restoreStudioDockHeight();
      if (workspaceHandle && workspaceTop && studioDock) {
        let wDrag = false, wStartY = 0, wStartH = 0;
        const onWPointerDown = (e) => {
          if (mq.matches) return;
          wDrag = true; wStartY = e.clientY; wStartH = studioDock.offsetHeight;
          studioDock.style.transition = 'none';
          workspaceTop.style.transition = 'none';
          safeSetPointerCapture(workspaceHandle, e.pointerId);
          showDragOverlay('ns-resize');
          document.body.style.cursor = 'ns-resize';
          document.body.style.userSelect = 'none';
          e.preventDefault(); e.stopPropagation();
        };
        const onWPointerMove = (e) => {
          if (!wDrag) return;
          const container = studioDock.parentElement;
          const containerH = container ? container.offsetHeight : window.innerHeight;
          const minDock = 100;
          const maxDock = Math.max(200, Math.round(containerH * 0.6));
          const newH = Math.min(maxDock, Math.max(minDock, wStartH - (e.clientY - wStartY)));
          studioDock.style.height = newH + 'px';
        };
        const onWPointerUp = (e) => {
          if (!wDrag) return;
          wDrag = false;
          studioDock.style.transition = '';
          workspaceTop.style.transition = '';
          safeReleasePointerCapture(workspaceHandle, e.pointerId);
          hideDragOverlay();
          document.body.style.cursor = ''; document.body.style.userSelect = '';
          try { localStorage.setItem('studioDockHeight', studioDock.style.height); } catch(e) {}
        };
        const onWPointerCancel = () => {
          if (!wDrag) return;
          wDrag = false;
          studioDock.style.transition = '';
          workspaceTop.style.transition = '';
          hideDragOverlay();
          document.body.style.cursor = ''; document.body.style.userSelect = '';
        };
        workspaceHandle.addEventListener('pointerdown', onWPointerDown);
        workspaceHandle.addEventListener('pointermove', onWPointerMove);
        workspaceHandle.addEventListener('pointerup', onWPointerUp);
        workspaceHandle.addEventListener('pointercancel', onWPointerCancel);
        // Also listen on document for move/up in case pointer capture fails (Electron iframe bug)
        document.addEventListener('pointermove', onWPointerMove);
        document.addEventListener('pointerup', onWPointerUp);
      }

      // === MODE SWITCH CLEANUP ===
      const handleMqChange = () => {
        if (mq.matches) {
          restoreSidebarHeight();
          sidebar.style.width = ''; sidebar.style.minWidth = '';
          if (main) {
            main.style.width = '';
            main.style.maxWidth = '';
            main.style.flexBasis = '';
          }
          if (leftWorkspace) {
            leftWorkspace.style.width = '';
            leftWorkspace.style.flexBasis = '';
          }
          if (workspaceTop) workspaceTop.style.flex = '';
          if (studioDock) studioDock.style.height = '';
        } else {
          sidebar.style.height = '';
          restoreSidebarWidth();
          restoreUnifiedLeftPanelWidth();
          restoreStudioDockHeight();
        }
      };
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handleMqChange);
      else if (typeof mq.addListener === 'function') mq.addListener(handleMqChange);
    }

    /* ── Audio Buffer Size Setting ── */
    function _getAudioFxBufferCandidates(desired) {
      const allowed = [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
      const n = Number(desired);
      const target = Number.isFinite(n) ? n : 128;
      const up = allowed.filter(v => v >= target);
      const down = allowed.filter(v => v < target).reverse();
      return [...up, ...down, 0];
    }

    function _getAudioFxBufferSize() {
      try {
        const v = Number(localStorage.getItem('audioFxBufferSize'));
        if ([32, 64, 128, 256, 512, 1024, 2048, 4096].includes(v)) return v;
      } catch (e) {}
      return 128;
    }
    function handleAudioBufferSizeChange(val) {
      const n = Number(val);
      const v = [32, 64, 128, 256, 512, 1024, 2048, 4096].includes(n) ? n : 128;
      try { localStorage.setItem('audioFxBufferSize', String(v)); } catch (e) {}
    }
    function _restoreAudioBufferSizeSetting() {
      const sel = document.getElementById('audio-buffer-size-select');
      if (sel) sel.value = String(_getAudioFxBufferSize());
    }

    function _createFxScriptProcessorSafe(ctx, desiredSize, inChannels = 2, outChannels = 2) {
      const candidates = _getAudioFxBufferCandidates(desiredSize);
      for (const size of candidates) {
        try { return ctx.createScriptProcessor(size, inChannels, outChannels); }
        catch (_) {}
      }
      return ctx.createScriptProcessor(0, inChannels, outChannels);
    }

    /* ── Audio Latency Measurement ── */
    async function _audioLatencyRefresh() {
      const fmt = (ms) => {
        if (!Number.isFinite(ms)) return '—';
        if (ms < 1) return '<1 ms';
        return ms.toFixed(1) + ' ms';
      };
      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

      // 1) AudioContext base & output latency
      let baseMs = NaN, outputMs = NaN;
      const ctx = typeof _pgmAudioCtx !== 'undefined' && _pgmAudioCtx ? _pgmAudioCtx : null;
      if (ctx) {
        // baseLatency: minimum achievable latency (OS audio buffer)
        if (typeof ctx.baseLatency === 'number') baseMs = ctx.baseLatency * 1000;
        // outputLatency: current end-to-end output path latency
        if (typeof ctx.outputLatency === 'number') outputMs = ctx.outputLatency * 1000;
      }
      setEl('lat-val-base', fmt(baseMs));
      setEl('lat-val-output', fmt(outputMs));

      // 2) Input hardware latency — measure from active audio track settings
      let inputHwMs = NaN;
      try {
        const streams = typeof _activeStreams !== 'undefined' ? _activeStreams : {};
        for (const sid of Object.keys(streams)) {
          const stream = streams[sid];
          if (!stream || !stream.active) continue;
          const track = stream.getAudioTracks()[0];
          if (!track) continue;
          const settings = track.getSettings();
          // latency property (seconds) — reported by some browsers
          if (typeof settings.latency === 'number' && settings.latency > 0) {
            inputHwMs = settings.latency * 1000;
            break;
          }
        }
      } catch (e) {}
      // Fallback: use the AudioContext base latency as input estimate
      if (!Number.isFinite(inputHwMs) && Number.isFinite(baseMs)) inputHwMs = baseMs;
      setEl('lat-val-input-hw', fmt(inputHwMs));

      // 3) FX buffer contribution
      const fxBuf = typeof _getAudioFxBufferSize === 'function' ? _getAudioFxBufferSize() : 128;
      const sr = ctx ? (ctx.sampleRate || 48000) : 48000;
      const fxBufMs = (fxBuf / sr) * 1000;
      setEl('lat-val-fx-buf', fmt(fxBufMs));

      // 4) Estimated round-trip (input → processing → output)
      // Components: input HW buffer + FX buffer + base latency + output latency
      const inputPart = Number.isFinite(inputHwMs) ? inputHwMs : (Number.isFinite(baseMs) ? baseMs : 2.7);
      const basePart = Number.isFinite(baseMs) ? baseMs : 2.7;
      const outputPart = Number.isFinite(outputMs) ? outputMs : basePart;
      const roundTrip = inputPart + fxBufMs + outputPart;
      setEl('lat-val-roundtrip', fmt(roundTrip));

      // 5) Monitor output latency
      // When using default device with direct ctx.destination routing:
      //   monitor latency ≈ baseLatency (no MediaStream round-trip)
      // When using custom device with <audio>.setSinkId fallback:
      //   monitor latency ≈ baseLatency + one extra buffer (~5-21ms)
      const usingCustomDevice = typeof _pgmOutputDeviceId !== 'undefined' && !!_pgmOutputDeviceId;
      const ctxSinkSupported = !!(ctx && typeof ctx.setSinkId === 'function');
      const mode = typeof _pgmMonitoringMode !== 'undefined' ? _pgmMonitoringMode : 'monitor-off';
      let monitorMs = NaN;
      if (mode !== 'monitor-off') {
        if (usingCustomDevice && !ctxSinkSupported) {
          // MediaStreamDest → <audio> → setSinkId adds ~one buffer of overhead
          monitorMs = basePart + fxBufMs + (Number.isFinite(outputMs) ? outputMs : basePart) + 5;
        } else {
          // Direct ctx.destination path — minimal latency
          monitorMs = basePart + fxBufMs;
        }
      }
      if (_pgmUltraLowLatencyEnabled && ctx && _pgmUltraLowLatencyState === 'active') {
        const preferredRate = _pgmResolveSampleRate();
        if (Number.isFinite(preferredRate) && Math.abs((ctx.sampleRate || preferredRate) - preferredRate) > 1) {
          _pgmUltraLowLatencyState = 'degraded';
        }
      }
      const ullSuffix = _pgmUltraLowLatencyEnabled ? ` · ${_pgmGetUllStatusText()}` : '';
      setEl('lat-val-monitor', mode === 'monitor-off' ? 'Off' : `${fmt(monitorMs)}${ullSuffix}`);
      _pgmUpdateUllStatusUi();
    }

    function switchSettingsTab(tabId) {
      const targetItem = document.querySelector(`.sm-sidebar-item[data-sm-tab="${tabId}"]`);
      if (targetItem && targetItem.style.display === 'none') {
        return;
      }
      // Update sidebar active state
      document.querySelectorAll('.sm-sidebar-item').forEach(item => {
        item.classList.toggle('active', item.dataset.smTab === tabId);
      });
      // Update content panels
      document.querySelectorAll('.sm-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.smPanel === tabId);
      });
    }

    let feedbackSuccessOverlayTimer = null;

    function setFeedbackSuccessOverlay(message, opts = {}) {
      const overlayEl = document.getElementById('feedback-success-overlay');
      const messageEl = document.getElementById('feedback-success-message');
      if (!overlayEl || !messageEl) return;
      if (feedbackSuccessOverlayTimer) {
        clearTimeout(feedbackSuccessOverlayTimer);
        feedbackSuccessOverlayTimer = null;
      }
      const show = opts.show === true;
      messageEl.textContent = String(message || '');
      overlayEl.classList.toggle('visible', show);
      if (show) {
        const duration = Math.max(800, Number(opts.durationMs) || 2200);
        feedbackSuccessOverlayTimer = setTimeout(() => {
          overlayEl.classList.remove('visible');
          feedbackSuccessOverlayTimer = null;
        }, duration);
      }
    }

    function setFeedbackStatus(message, opts = {}) {
      const statusEl = document.getElementById('feedback-status');
      if (!statusEl) return;
      if (opts.success === true && !opts.error) {
        statusEl.textContent = '';
        statusEl.classList.remove('error', 'success');
        setFeedbackSuccessOverlay(message, { show: true, durationMs: opts.durationMs });
        return;
      }
      setFeedbackSuccessOverlay('', { show: false });
      statusEl.textContent = String(message || '');
      statusEl.classList.toggle('error', opts.error === true);
      statusEl.classList.remove('success');
    }

    function resetFeedbackForm(opts = {}) {
      const input = document.getElementById('feedback-message');
      if (input) input.value = '';
      if (opts.clearStatus !== false) setFeedbackStatus('');
    }

    function openFeedbackContact() {
      window.open(BSP_CONTACT_URL, '_blank', 'noopener,noreferrer');
    }

    function getFeedbackApiUrl() {
      return normalizeFeedbackApiUrl(appState?.settings?.feedbackApiUrl);
    }

    function buildFeedbackIssueDraft() {
      const input = document.getElementById('feedback-message');
      const message = String(input?.value || '').trim();
      if (!message) {
        setFeedbackStatus('Enter your feedback before sending.', { error: true });
        if (input) input.focus();
        return null;
      }
      const firstLine = message.split('\n').find(line => line.trim()) || 'Feedback';
      const title = `Feedback: ${firstLine.trim().slice(0, 72)}`;
      const body = [
        message,
        '',
        '---',
        'Submitted from Bible Song Pro',
        `Host mode: ${getHostMode()}`,
        `Workspace layout: ${workspaceLayoutMode}`,
        `Active tab: ${sidebarTab}`,
        `Timestamp: ${new Date().toISOString()}`
      ].join('\n');
      return { title, body };
    }

    async function submitFeedbackIssue() {
      const draft = buildFeedbackIssueDraft();
      if (!draft) return;
      const endpoint = getFeedbackApiUrl();
      if (!endpoint) {
        setFeedbackStatus('Feedback backend is not configured.', { error: true });
        return;
      }
      setFeedbackStatus('Sending feedback...');
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title: draft.title,
            body: draft.body,
            message: draft.body,
            app: 'Bible Song Pro',
            repoUrl: BSP_GITHUB_REPO_URL,
            issuesUrl: BSP_GITHUB_ISSUES_URL,
            context: {
              hostMode: getHostMode(),
              workspaceLayout: workspaceLayoutMode,
              activeTab: sidebarTab,
              timestamp: new Date().toISOString()
            }
          })
        });
        let payload = null;
        try {
          payload = await response.json();
        } catch (_) {}
        if (!response.ok) {
          const errorMessage = payload && payload.error
            ? String(payload.error)
            : `Feedback request failed (${response.status}).`;
          setFeedbackStatus(errorMessage, { error: true });
          return;
        }
        resetFeedbackForm({ clearStatus: false });
        setFeedbackStatus('Feedback sent to GitHub.', { success: true, durationMs: 2200 });
      } catch (error) {
        const message = error && error.message ? error.message : 'Unable to reach feedback backend.';
        setFeedbackStatus(message, { error: true });
      }
    }

    /* ---- Footer Status Bar ---- */
    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
      if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
      return (bytes / 1073741824).toFixed(1) + ' GB';
    }
    function formatUptime(seconds) {
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (d > 0) return d + 'd ' + h + 'h';
      if (h > 0) return h + 'h ' + m + 'm';
      return m + 'm';
    }
    function cpuBarColor(pct) {
      if (pct < 50) return '#4a86ff';
      if (pct < 80) return '#f59e0b';
      return '#f87171';
    }
    function memBarColor(pct) {
      if (pct < 60) return '#10b981';
      if (pct < 85) return '#f59e0b';
      return '#f87171';
    }

    let _fbNetPrevDown = 0, _fbNetPrevUp = 0, _fbNetPrevTime = 0;

    async function updateFooterBar() {
      // --- System stats from main process ---
      try {
        if (window.BSPDesktop && typeof window.BSPDesktop.getSystemStats === 'function') {
          const stats = await window.BSPDesktop.getSystemStats();
          if (stats) {
            const cpuText = document.getElementById('fb-cpu-text');
            const memText = document.getElementById('fb-mem-text');
            const uptimeText = document.getElementById('fb-uptime-text');
            const platformText = document.getElementById('fb-platform-text');

            if (cpuText) cpuText.textContent = 'CPU: ' + (stats.cpu?.percent ?? 0) + '%';
            if (memText) memText.textContent = 'MEM: ' + (stats.memory?.percent ?? 0) + '% (' + formatBytes(stats.memory?.used ?? 0) + ')';
            if (uptimeText) uptimeText.textContent = formatUptime(stats.uptime ?? 0);
            if (platformText) platformText.textContent = (stats.platform === 'darwin' ? 'macOS' : (stats.platform || '')) + ' · ' + (stats.arch || '');

            // CPU bar
            const cpuBar = document.getElementById('fb-cpu-bar-fill');
            if (cpuBar) {
              const cp = stats.cpu?.percent ?? 0;
              cpuBar.style.width = cp + '%';
              cpuBar.style.background = cpuBarColor(cp);
            }
            // Memory bar
            const memBar = document.getElementById('fb-mem-bar-fill');
            if (memBar) {
              const mp = stats.memory?.percent ?? 0;
              memBar.style.width = mp + '%';
              memBar.style.background = memBarColor(mp);
            }
            // Version
            const verText = document.getElementById('fb-version-text');
            if (verText && stats.electronVersion) verText.textContent = 'Electron ' + stats.electronVersion;

            // GPU
            const gpuText = document.getElementById('fb-gpu-text');
            if (gpuText && stats.gpu) {
              const name = stats.gpu.renderer || 'Unknown';
              const vram = stats.gpu.vram ? ' · ' + stats.gpu.vram : '';
              gpuText.textContent = name + vram;
              const gpuItem = document.getElementById('fb-gpu');
              if (gpuItem) gpuItem.title = 'GPU: ' + name + vram;
            }
          }
        } else {
          // Fallback: browser-only info
          const platformText = document.getElementById('fb-platform-text');
          if (platformText) platformText.textContent = navigator.platform || 'Browser';
          const cpuText = document.getElementById('fb-cpu-text');
          if (cpuText) cpuText.textContent = 'CPU: N/A';
          const memText = document.getElementById('fb-mem-text');
          if (memText && performance.memory) {
            const used = performance.memory.usedJSHeapSize;
            const total = performance.memory.totalJSHeapSize;
            const pct = total > 0 ? Math.round((used / total) * 100) : 0;
            memText.textContent = 'JS Heap: ' + pct + '% (' + formatBytes(used) + ')';
          } else if (memText) {
            memText.textContent = 'MEM: N/A';
          }
        }
      } catch (e) {
        console.warn('[footer-bar] stats error:', e);
      }

      // --- Network status ---
      try {
        const netText = document.getElementById('fb-net-text');
        const netDot = document.getElementById('fb-net-dot');
        const online = navigator.onLine;
        if (netDot) {
          netDot.className = 'fb-net-dot ' + (online ? 'online' : 'offline');
        }
        if (netText) {
          if (!online) {
            netText.textContent = 'Offline';
          } else {
            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (conn && conn.effectiveType) {
              const dl = conn.downlink ? conn.downlink.toFixed(1) + ' Mbps' : '';
              const type = conn.effectiveType.toUpperCase();
              netText.textContent = 'Online · ' + type + (dl ? ' · ↓' + dl : '');
            } else {
              netText.textContent = online ? 'Online' : 'Offline';
            }
          }
        }
      } catch (e) {
        const netText = document.getElementById('fb-net-text');
        if (netText) netText.textContent = navigator.onLine ? 'Online' : 'Offline';
      }
    }

    function initFooterBar() {
      // Inject mini progress bars next to CPU/MEM labels
      const cpuItem = document.getElementById('fb-cpu');
      if (cpuItem && !document.getElementById('fb-cpu-bar-fill')) {
        const bar = document.createElement('span');
        bar.className = 'fb-cpu-bar';
        bar.innerHTML = '<span class="fb-cpu-fill" id="fb-cpu-bar-fill"></span>';
        cpuItem.appendChild(bar);
      }
      const memItem = document.getElementById('fb-mem');
      if (memItem && !document.getElementById('fb-mem-bar-fill')) {
        const bar = document.createElement('span');
        bar.className = 'fb-mem-bar';
        bar.innerHTML = '<span class="fb-mem-fill" id="fb-mem-bar-fill"></span>';
        memItem.appendChild(bar);
      }
      // Inject net dot
      const netItem = document.getElementById('fb-net');
      if (netItem && !document.getElementById('fb-net-dot')) {
        const dot = document.createElement('span');
        dot.id = 'fb-net-dot';
        dot.className = 'fb-net-dot ' + (navigator.onLine ? 'online' : 'offline');
        netItem.insertBefore(dot, netItem.querySelector('.fb-icon').nextSibling);
      }
      // First update
      updateFooterBar();
      // Poll every 15 seconds (GPU info is cached in main process)
      setInterval(updateFooterBar, 15000);
      // Listen for online/offline events for instant updates
      window.addEventListener('online', updateFooterBar);
      window.addEventListener('offline', updateFooterBar);
    }

    function setupCollapsibleSettings() {
      // ── Settings modal drag ──
      (function bindSettingsModalDrag() {
        const titleBar = document.querySelector('#settingsModal .settings-modal-title');
        if (!titleBar) return;
        let _smDrag = { active: false, pointerId: null, startX: 0, startY: 0, baseX: 0, baseY: 0 };
        let _smOffset = { x: 0, y: 0 };

        function applyOffset() {
          const mc = document.querySelector('#settingsModal .modal-content');
          if (!mc) return;
          mc.style.setProperty('--settings-drag-x', Math.round(_smOffset.x) + 'px');
          mc.style.setProperty('--settings-drag-y', Math.round(_smOffset.y) + 'px');
        }
        function clampOffset(x, y) {
          const mc = document.querySelector('#settingsModal .modal-content');
          if (!mc) return { x, y };
          const margin = 14;
          const r = mc.getBoundingClientRect();
          const w = r.width, h = r.height;
          const maxX = Math.max(0, (window.innerWidth - w) / 2 - margin);
          const maxY = Math.max(0, (window.innerHeight - h) / 2 - margin);
          return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
        }
        // Reset position when the modal is opened
        const origOpen = window.openModal;
        window.openModal = function(id) {
          if (id === 'settingsModal') { _smOffset.x = 0; _smOffset.y = 0; applyOffset(); }
          return origOpen.apply(this, arguments);
        };
        titleBar.addEventListener('pointerdown', (ev) => {
          if (ev.button !== 0) return;
          if (ev.target && ev.target.closest('button,input,select,textarea,a,label')) return;
          _smDrag.active = true;
          _smDrag.pointerId = ev.pointerId;
          _smDrag.startX = ev.clientX;
          _smDrag.startY = ev.clientY;
          _smDrag.baseX = _smOffset.x;
          _smDrag.baseY = _smOffset.y;
          try { titleBar.setPointerCapture(ev.pointerId); } catch (_) {}
          ev.preventDefault();
        });
        titleBar.addEventListener('pointermove', (ev) => {
          if (!_smDrag.active || ev.pointerId !== _smDrag.pointerId) return;
          const c = clampOffset(
            _smDrag.baseX + (ev.clientX - _smDrag.startX),
            _smDrag.baseY + (ev.clientY - _smDrag.startY)
          );
          _smOffset.x = c.x;
          _smOffset.y = c.y;
          applyOffset();
        });
        const finish = (ev) => {
          if (!_smDrag.active) return;
          if (ev && ev.pointerId !== _smDrag.pointerId) return;
          try { titleBar.releasePointerCapture(_smDrag.pointerId); } catch (_) {}
          _smDrag.active = false;
          _smDrag.pointerId = null;
        };
        titleBar.addEventListener('pointerup', finish);
        titleBar.addEventListener('pointercancel', finish);
      })();

      // Settings modal now uses sidebar tabs — no collapsible categories needed for #settingsModal
      // Only set up collapsibles for settings-category elements OUTSIDE the settings modal (if any)
      document.querySelectorAll('.settings-category').forEach(cat => {
        if (cat.closest('#settingsModal')) return; // skip — handled by tab switching
        const title = cat.querySelector('.settings-category-title');
        if (!title) return;
        const content = cat.querySelector('.settings-category-content');
        cat.classList.add('collapsed');
        if (content) content.style.display = 'none';
        title.addEventListener('click', () => {
          const isCollapsed = cat.classList.toggle('collapsed');
          if (content) content.style.display = isCollapsed ? 'none' : 'block';
        });
      });
    }
    
    function setupStyleEditorCollapsibles() {
      document.querySelectorAll('#styleEditorModal .editor-section').forEach(sec => {
        const title = sec.querySelector('.editor-section-title');
        if (!title) return;
        const content = [...sec.children].filter(ch => !ch.classList.contains('editor-section-title'));
        sec.classList.add('collapsed');
        content.forEach(el => { el.style.display = 'none'; });
        const toggle = () => {
          const nowCollapsed = sec.classList.toggle('collapsed');
          content.forEach(el => {
            el.style.display = nowCollapsed ? 'none' : '';
          });
        };
        title.addEventListener('click', toggle);
      });
    }

    function applyLoadedState(stateValue, songRecords, bibleRecords, opts = {}) {
      const runInit = opts.runInit !== false;
      const bgSettingsValue = opts.bgSettingsValue;
      const bgSettingsUpdatedAt = opts.bgSettingsUpdatedAt || 0;
      const animationSettingsValue = opts.animationSettingsValue;
      const animationSettingsUpdatedAt = opts.animationSettingsUpdatedAt || 0;
      const typographySettingsValue = opts.typographySettingsValue;
      const typographySettingsUpdatedAt = opts.typographySettingsUpdatedAt || 0;
      const modeSettingsValue = opts.modeSettingsValue;
      const modeSettingsUpdatedAt = opts.modeSettingsUpdatedAt || 0;
      const stateUpdatedAt = opts.stateUpdatedAt || 0;
      initializeDefaultStyles();
      if (runInit && !hasInitialized) populateLanguageSelect();
      populateSongTranslationLanguageOptions();

      songs = songRecords.map(hydrateSongFromRecord);
      bibles = {};
      bibleRecords.forEach(record => {
        if (!record || !record.id) return;
        bibles[record.id] = Array.isArray(record.parsedData) ? record.parsedData : [];
      });

      appState = mergeAppStateWithDefaults(stateValue || {});
      const persistedHostMode = stateValue?.host?.mode || (appState.settings && appState.settings.hostMode) || HOST_MODE_OBS;
      const persistedVmix = stateValue?.host?.vmix || (appState.settings && appState.settings.vmix) || null;
      setHostMode(persistedHostMode, { silent: true });
      if (persistedVmix && typeof persistedVmix === 'object') {
        updateVmixSettings(persistedVmix, { silent: true });
      }
      let localPreferredLanguage = '';
      try { localPreferredLanguage = localStorage.getItem('bible_app_language') || ''; } catch (_) {}
      const hasLocalPreferredLanguage = LANGUAGES.some(entry => entry.code === localPreferredLanguage);
      const preferredLanguage = hasLocalPreferredLanguage
        ? localPreferredLanguage
        : ((appState.ui && appState.ui.language) ? appState.ui.language : currentLanguage);
      setLanguage(preferredLanguage, { silent: true });
      let ltStylesValue = opts.ltStylesValue;
      if (typeof ltStylesValue === 'string') {
        try {
          ltStylesValue = JSON.parse(ltStylesValue);
        } catch (e) {
          ltStylesValue = null;
        }
      }
      if (ltStylesValue && typeof ltStylesValue === 'object') {
        const existingLtStyles = (appState.settings && appState.settings.ltStyles) ? appState.settings.ltStyles : null;
        const mergedLtStyles = Object.assign({}, ltStylesValue, existingLtStyles || {});
        appState.settings = appState.settings || {};
        appState.settings.ltStyles = mergedLtStyles;
      }
      if (bgSettingsValue && typeof bgSettingsValue === 'object' && bgSettingsUpdatedAt >= stateUpdatedAt) {
        appState.settings = appState.settings || {};
        applyBackgroundSnapshot(appState.settings, bgSettingsValue);
      }
      if (animationSettingsValue && typeof animationSettingsValue === 'object' && animationSettingsUpdatedAt >= stateUpdatedAt) {
        appState.settings = appState.settings || {};
        applyAnimationSnapshot(appState.settings, animationSettingsValue);
      }
      if (typographySettingsValue && typeof typographySettingsValue === 'object' && typographySettingsUpdatedAt >= stateUpdatedAt) {
        appState.settings = appState.settings || {};
        applyTypographySnapshot(appState.settings, typographySettingsValue);
      }
      if (modeSettingsValue && typeof modeSettingsValue === 'object' && modeSettingsUpdatedAt >= stateUpdatedAt) {
        appState.settings = appState.settings || {};
        applyModeSettingsSnapshot(appState.settings, modeSettingsValue);
      }
      schedule = Array.isArray(appState.schedule) ? appState.schedule : [];
      schedule.forEach(entry => {
        if (entry && entry._metaKind === 'bible_verse') {
          const hint = getScheduleLineHint(entry);
          if (hint != null) entry.linesPerPage = hint;
        }
      });
      presets = Array.isArray(appState.presets) ? appState.presets : [];
      restoreSearchQueriesFromState(appState);

      sidebarTab = appState.activeTab || sidebarTab || 'bible';
      editorMode = (appState.ui && appState.ui.editorMode) ? appState.ui.editorMode : editorMode;
      lastLiveState = (appState.live && appState.live.lastLiveState) ? appState.live.lastLiveState : lastLiveState;
      if (appState.live) {
        isLive = !!appState.live.isLive;
        liveKind = appState.live.liveKind || null;
        livePointer = appState.live.livePointer || null;
        liveLineCursor = appState.live.liveLineCursor || 0;
        liveLinesPerPage = Math.max(1, Number(appState.live.liveLinesPerPage) || Number(liveLinesPerPage) || 1);
        liveBackgroundState = appState.live.liveBackgroundState || null;
        liveRatio = appState.live.liveRatio || liveRatio;
        liveTextTransformState = appState.live.liveTextTransformState || null;
      }
      if (appState.audioMixer) {
        const rawVol = Number(appState.audioMixer.monitorVolume);
        _pgmMonitorVolume = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : _pgmMonitorVolume;
        _pgmMutedMonitor = appState.audioMixer.monitorMuted !== false;
        _pgmMonitoringMode = _pgmGetNormalizedMonitoringMode(appState.audioMixer.monitorMode);
        const rawSync = Number(appState.audioMixer.mediaAvSyncMs);
        _pgmMediaLocalAvSyncMs = Number.isFinite(rawSync) ? Math.max(-200, Math.min(400, Math.round(rawSync))) : _pgmMediaLocalAvSyncMs;
        _pgmUltraLowLatencyEnabled = appState.audioMixer.ullEnabled === true;
        _pgmUltraLowLatencyBuffer = _pgmNormalizeUllBuffer(appState.audioMixer.ullBuffer);
        _pgmUltraLowLatencySampleRate = _pgmNormalizeUllSampleRate(appState.audioMixer.ullSampleRate);
        _pgmUltraLowLatencyBypassFx = appState.audioMixer.ullBypassFx !== false;
        _pgmUltraLowLatencyUnderruns = Math.max(0, Math.round(Number(appState.audioMixer.ullUnderruns) || 0));
        _pgmUltraLowLatencyState = _pgmUltraLowLatencyEnabled ? 'active' : 'inactive';
        // Restore master FX chain + volume
        if (Array.isArray(appState.audioMixer.masterFx)) {
          _promixMasterFx = appState.audioMixer.masterFx;
        }
        if (typeof appState.audioMixer.masterVolume === 'number') {
          _promixMasterVolume = Math.max(0, Math.min(1.5, appState.audioMixer.masterVolume));
        }
        // Restore bus definitions
        if (Array.isArray(appState.audioMixer.buses) && appState.audioMixer.buses.length) {
          _promixBuses = appState.audioMixer.buses.map(b => ({
            id: b.id || ('bus_' + Math.random().toString(36).slice(2, 8)),
            name: b.name || 'Bus',
            fxChain: Array.isArray(b.fxChain) ? b.fxChain : [],
            volume: typeof b.volume === 'number' ? b.volume : 1,
            muted: !!b.muted
          }));
        }
      }

      activeBibleVersion = appState.selectedBibleId || (appState.bibleNav ? appState.bibleNav.versionId : null);
      if (!activeBibleVersion || !bibles[activeBibleVersion]) {
        const versions = Object.keys(bibles);
        if (versions.length > 0) activeBibleVersion = versions[0];
      }

      if (appState.settings) {
        applyUiSnapshot(appState.settings);
      } else {
        applySidebarLayoutMode('layout2', { persist: false });
        applyWorkspaceLayoutMode('focused', { persist: false });
        ltFontSongs = 30; ltFontBible = 33;
        setLtFontInputValue(getEffectiveLtFont());
        ltRefFontSize = 30;
        const refInput = document.getElementById('ref-font-size-lt-val');
        if (refInput) refInput.value = String(ltRefFontSize);
      }
      restoreVmixSettingsUi();
      applyHostModeUi();

      handleBgTypeChange();
      handleBgImageSourceChange();
      handleBgVideoSourceChange();
      renderFontFamilyOptions();
      renderLtStylePicker();
      updateBgModeUi();
      document.querySelectorAll('#line-picker .seg-btn').forEach(b => b.classList.toggle('active', b.id === 'line-' + linesPerPage));
      document.getElementById('ratio-full').classList.toggle('active', activeRatio === 'full');
      document.getElementById('ratio-lt').classList.toggle('active', activeRatio === '16-9');
      document.getElementById('ratio-custom').classList.toggle('active', activeRatio === 'custom');
      const hasSavedBgToggle = appState.settings && appState.settings.bgToggle != null;
      if (activeRatio === '16-9' && !hasSavedBgToggle) applyLtBgDefaultForTab(sidebarTab);

      renderVersionBar();
      setSidebarTab(sidebarTab);
      refreshWorkspaceLayoutUi();
      configureImportAccept();
      renderBibleAutocomplete();
      renderPresetList();
      if (runInit) bindEventsOnce();
      if (runInit) restoreWorkspaceTabPreference();
      initializeAllSliders();
      updateFullAlignButtons();
      setPreviewScale(1);
      setLanguage(preferredLanguage, { silent: true });
      setEditorMode(editorMode);

      renderSongs();
      restoreSelectionFromState(appState);
      ensureSelectionFallback();

      const songList = document.getElementById('song-list');
      if (songList && appState.ui && appState.ui.songListScrollTop != null) {
        songList.scrollTop = appState.ui.songListScrollTop;
      }
      const lyricButtons = document.getElementById('lyric-buttons');
      if (lyricButtons && appState.ui && appState.ui.lyricButtonsScrollTop != null) {
        lyricButtons.scrollTop = appState.ui.lyricButtonsScrollTop;
      }

      if (isLive && livePointer && lastLiveState && lastLiveState.kind === 'update') {
        pushLiveUpdate();
        updateButtonView();
      }

      // Restore scenes & sources from persistence
      _restoreScenes(
        appState.scenes || [],
        appState.activeSceneId || null,
        appState.sceneIdCounter || 0,
        appState.sourceIdCounter || 0
      );
      _scenesInitialized = true;
      _pgmApplyMonitorGain();
      _pgmUpdateStreamVolLabel();
      _pgmSyncMonitoringModeUi();
      _pgmSyncMediaLocalAvSyncUi();
      _pgmUpdateUllStatusUi();
      const monitorBtn = document.getElementById('pgm-mute-monitor');
      if (monitorBtn) {
        monitorBtn.classList.toggle('muted', _pgmMutedMonitor);
        monitorBtn.title = _pgmMutedMonitor ? 'Unmute monitor output' : 'Mute monitor output';
      }

      // Restore app page (Projection, Livestreaming, etc.)
      if (appState.currentAppPage && appState.currentAppPage !== 'projection') {
        switchAppPage(appState.currentAppPage);
      }

      // Sidebar startup state depends on selected layout.
      if (isSidebarDockedLayoutActive()) setSidebarPopupOpen(true);
      else setSidebarPopupOpen(false);

      if (runInit && !hasInitialized) hasInitialized = true;
    }

    // ===== BUNDLED BIBLES =====
    const SEEDED_BIBLES_KEY = 'bsp_seeded_default_bibles';

    function getSeededDefaultBibles() {
      try {
        const raw = JSON.parse(localStorage.getItem(SEEDED_BIBLES_KEY) || '[]');
        return Array.isArray(raw) ? raw : [];
      } catch (_) {
        return [];
      }
    }

    function markDefaultBibleSeeded(version) {
      const seeded = getSeededDefaultBibles();
      if (seeded.includes(version)) return;
      seeded.push(version);
      try { localStorage.setItem(SEEDED_BIBLES_KEY, JSON.stringify(seeded)); } catch (_) {}
    }

    // Bibles shipped in the bibles/ folder next to this panel arrive by <script> tag,
    // not fetch(): as an OBS custom browser dock the panel runs on file://, where the
    // browser blocks reading a sibling file over fetch/XHR but still allows script tags.
    // The same path works in the desktop app and when served over http://localhost:5510.
    const bundledBibleXml = Object.create(null);
    window.BSP_REGISTER_BUNDLED_BIBLE = function (version, xmlText) {
      if (version && xmlText) bundledBibleXml[String(version)] = xmlText;
    };

    function loadBundledBibleScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.onload = () => { script.remove(); resolve(); };
        script.onerror = () => { script.remove(); reject(new Error(`Failed to load ${src}`)); };
        document.head.appendChild(script);
      });
    }

    // Installs the bundled bibles so a new user has scripture to present immediately.
    // A version is seeded at most once: if the user later deletes it, it stays deleted.
    async function seedDefaultBiblesIfNeeded() {
      try {
        await loadBundledBibleScript('bibles/manifest.js');
      } catch (_) {
        // No bibles/ folder alongside the panel — nothing to seed.
        return;
      }

      const available = Array.isArray(window.BSP_BUNDLED_BIBLES) ? window.BSP_BUNDLED_BIBLES : [];
      const seeded = getSeededDefaultBibles();
      const pending = available.filter(version => !seeded.includes(version) && !bibles[version]);
      if (!pending.length) return;

      let installed = 0;
      for (const version of pending) {
        try {
          await loadBundledBibleScript(`bibles/${version}.js`);
          const xmlText = bundledBibleXml[version];
          if (!xmlText) continue;

          const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
          const parsed = parseBible(xml, version);
          if (!parsed.length) continue;

          bibles[version] = parsed;
          clearBibleSearchCache(version);
          await idbPut(STORE_BIBLES, buildBibleRecord(version, parsed, { isNew: true }));
          markDefaultBibleSeeded(version);
          installed += 1;
          if (!activeBibleVersion || !bibles[activeBibleVersion]) {
            activeBibleVersion = version;
          }
        } catch (error) {
          console.error(`Bundled bibles: seeding ${version} failed`, error);
        } finally {
          // Release the raw XML; the parsed chapters are what we keep.
          delete bundledBibleXml[version];
        }
        // Yield so the panel stays responsive while the remaining versions parse.
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (!installed) return;
      renderVersionBar();
      updateBibleLists();
      renderSongs();
      ensureSelectionFallback();
      saveState();
      saveToStorageDebounced();
      sendSyncState();
    }

    // ===== INIT =====
    async function bootApp() {
      await openDb();
      const [stateEntry, songRecords, bibleRecords, ltStylesEntry, bgSettingsEntry, animationSettingsEntry, typographySettingsEntry, modeSettingsEntry] = await Promise.all([
        idbGet(STORE_STATE, 'appState'),
        idbGetAll(STORE_SONGS),
        idbGetAll(STORE_BIBLES),
        idbGet(STORE_STATE, 'ltStyles'),
        idbGet(STORE_STATE, 'bgSettings'),
        idbGet(STORE_STATE, 'animationSettings'),
        idbGet(STORE_STATE, 'typographySettings'),
        idbGet(STORE_STATE, 'modeSettings')
      ]);

      applyLoadedState(
        (stateEntry && stateEntry.value) ? stateEntry.value : null,
        songRecords,
        bibleRecords,
        {
          runInit: true,
          ltStylesValue: ltStylesEntry ? ltStylesEntry.value : null,
          bgSettingsValue: bgSettingsEntry ? bgSettingsEntry.value : null,
          bgSettingsUpdatedAt: bgSettingsEntry ? (bgSettingsEntry.updatedAt || 0) : 0,
          animationSettingsValue: animationSettingsEntry ? animationSettingsEntry.value : null,
          animationSettingsUpdatedAt: animationSettingsEntry ? (animationSettingsEntry.updatedAt || 0) : 0,
          typographySettingsValue: typographySettingsEntry ? typographySettingsEntry.value : null,
          typographySettingsUpdatedAt: typographySettingsEntry ? (typographySettingsEntry.updatedAt || 0) : 0,
          modeSettingsValue: modeSettingsEntry ? modeSettingsEntry.value : null,
          modeSettingsUpdatedAt: modeSettingsEntry ? (modeSettingsEntry.updatedAt || 0) : 0,
          stateUpdatedAt: stateEntry ? (stateEntry.updatedAt || 0) : 0
        }
      );

      appStateUpdatedAt = stateEntry ? (stateEntry.updatedAt || 0) : 0;
      stateReady = true;
      saveState();
      if (pendingHello) {
        pendingHello = false;
        if (typeof sendSyncState === 'function') sendSyncState();
      }
      if (pendingPersist) {
        pendingPersist = false;
        saveToStorage();
      }
      if (pendingBgPersist) {
        pendingBgPersist = false;
        persistBackgroundState();
      }
      if (pendingAnimationPersist) {
        pendingAnimationPersist = false;
        persistAnimationState();
      }
      if (pendingTypographyPersist) {
        pendingTypographyPersist = false;
        persistTypographyState();
      }
      if (pendingModePersist) {
        pendingModePersist = false;
        persistModeSettings();
      }
      sendSyncState();
      requestRelayState();
      // Not awaited: parsing the bundled bibles must not hold up startup.
      seedDefaultBiblesIfNeeded().catch(err => console.error('Bundled bibles: seeding failed', err));
      if (isVmixMode() && vmixState.enabled && vmixState.reconnectOnStartup !== false) {
        vmixReconnect().catch(() => {});
      }
    }

    function applyObsCompatibilityUi() {
      const obsSafeMode = typeof shouldUseObsBrowserSafeMode === 'function'
        ? shouldUseObsBrowserSafeMode()
        : false;
      document.body.classList.toggle('obs-browser-safe-mode', obsSafeMode);

      const hostModeSelect = document.getElementById('host-mode-select');
      const standaloneOption = hostModeSelect
        ? Array.from(hostModeSelect.options || []).find((opt) => opt.value === HOST_MODE_STANDALONE)
        : null;
      if (standaloneOption) {
        standaloneOption.disabled = obsSafeMode;
      }
      if (obsSafeMode && hostModeSelect && hostModeSelect.value === HOST_MODE_STANDALONE) {
        hostModeSelect.value = HOST_MODE_OBS;
        if (typeof setHostMode === 'function') {
          setHostMode(HOST_MODE_OBS, { silent: true });
        }
      }

      if (!obsSafeMode) return;

      outputPopoverOpen = false;
      const outputPopover = document.getElementById('output-popover');
      if (outputPopover) outputPopover.classList.remove('open');
      const streamOverlay = document.getElementById('pgm-stream-settings-overlay');
      if (streamOverlay) streamOverlay.classList.remove('open');
    }

    async function initControlPanel() {
      initStandaloneTools();
      _restoreAudioBufferSizeSetting();
      bindVmixSettingsInputs();
      applyObsCompatibilityUi();
      // Ensure CSS vars match the currently selected theme on cold startup.
      handleThemeChange();
      restoreVmixSettingsUi();
      applyHostModeUi();
      refreshLocalServerInfo().catch(() => {});
      // Preload camera/audio device lists so source properties open instantly.
      setTimeout(() => prewarmSourceDeviceCaches(), 50);
      await bootApp();
      applyObsCompatibilityUi();
    }

    setRefBgEnabled(true, { silent: true });
    setReferenceShadowEnabled(false, { silent: true });
    setVerseShadowEnabled(false, { silent: true });
    setReferenceCapitalized(true, { silent: true });
    setDualVersionModeEnabled(false, { silent: true });
    window.onload = initControlPanel;
