    function updateSearchPlaceholder() {
      const inp = document.getElementById('song-search');
      const mirror = document.getElementById('nav-mirror-search');
      if (!inp) return;
      if (sidebarTab === 'bible') inp.placeholder = t('ui_search_bible');
      else if (sidebarTab === 'schedule') inp.placeholder = t('ui_search_setlist');
      else if (sidebarTab === 'media') inp.placeholder = 'Search media...';
      else inp.placeholder = t('ui_search_songs');
      updateBibleSearchToolsVisibility();
      if (mirror) mirror.placeholder = inp.placeholder;
      restoreSearchInputForCurrentTab();
    }


    function ensureSelectionFallback() {
      const isBibleCurrent = !!(currentItem && getIsBibleItem(currentItem));
      if (sidebarTab === 'bible' && activeBibleVersion && bibles[activeBibleVersion] && bibles[activeBibleVersion].length) {
        const bibleList = bibles[activeBibleVersion];
        const hasValidBibleSelection = isBibleCurrent &&
          currentItem.version === activeBibleVersion &&
          bibleList.includes(currentItem);
        if (!hasValidBibleSelection) {
          const idx = _defaultBibleChapterIndex(activeBibleVersion);
          selectItem(idx >= 0 ? idx : 0);
        }
        return;
      }
      if (sidebarTab === 'songs' && songs.length) {
        const hasValidSongSelection = !!(currentItem && !isBibleCurrent && songs.includes(currentItem));
        if (!hasValidSongSelection) selectItem(0);
        return;
      }
      if (sidebarTab === 'schedule' && schedule.length) {
        const hasValidScheduleSelection = !!(currentItem && schedule.includes(currentItem));
        if (!hasValidScheduleSelection) selectItem(0);
      }
    }
    
    // ===== UI RENDER =====
    let _acBooks = [];
    let _acIdx = -1;
    function renderBibleAutocomplete() {
      let sourceBooks = [];
      if (activeBibleVersion && bibles[activeBibleVersion]) {
        sourceBooks = [...new Set(bibles[activeBibleVersion].map(c => c.book).filter(Boolean))];
      } else {
        sourceBooks = [...new Set(Object.values(BIBLE_BOOKS))];
      }
      _acBooks = sourceBooks;
    }


    function renderVersionBar() {
      const bar = document.getElementById('version-bar');
      if (!bar) return;
      bar.innerHTML = '';
      const verKeys = Object.keys(bibles);
      const mid = Math.ceil(verKeys.length / 2);
      const rows = [verKeys.slice(0, mid), verKeys.slice(mid)];
      rows.forEach(rowVers => {
        if (!rowVers.length) return;
        const row = document.createElement('div');
        row.className = 'version-row';
        rowVers.forEach(ver => {
          const i = verKeys.indexOf(ver);
          const wrapper = document.createElement('div');
          wrapper.className = `version-wrapper ${activeBibleVersion === ver ? 'active' : ''}`;
          const color = VERSION_COLORS[i % VERSION_COLORS.length];
          if (activeBibleVersion !== ver) {
            wrapper.style.borderLeftColor = color;
            wrapper.style.borderLeftWidth = '2px';
          }
          const btn = document.createElement('button');
          btn.className = 'version-btn';
          btn.innerText = ver;
          btn.onclick = () => changeActiveBibleVersion(ver);
          const del = document.createElement('button');
          del.className = 'version-del';
          del.innerText = '\u2715';
          del.onclick = (e) => {
            e.stopPropagation();
            delete bibles[ver];
            clearBibleSearchCache(ver);
            if (activeBibleVersion === ver) activeBibleVersion = null;
            idbDelete(STORE_BIBLES, ver).catch(() => {});
            saveState();
            saveToStorageDebounced();
            renderVersionBar();
            renderSongs();
            updateBibleLists();
            if (isLive) scheduleLiveUpdate();
          };
          wrapper.appendChild(btn);
          wrapper.appendChild(del);
          row.appendChild(wrapper);
        });
        bar.appendChild(row);
      });
      updateBibleLists();
      updateDualVersionSelects();
      updateDualVersionAvailability();
      renderFooterBibleVersionPopover();
      if (footerBibleVersionPopoverOpen) {
        requestAnimationFrame(positionFooterBibleVersionPopover);
      }
    }

    function extractBookAndChapter(item) {
      if (!item) return { book: null, chap: null };
      const book = item.book || null;
      const chap = item.chapter || null;
      if (book && chap) return { book, chap };
      const title = item.title || "";
      const parts = title.split(' ');
      if (parts.length < 2) return { book: null, chap: null };
      const last = parts.pop();
      if (!/^\d+$/.test(last)) return { book: title, chap: null };
      return { book: parts.join(' '), chap: last };
    }

    const bibleBookOrderCache = new Map();

    function normalizeBookName(name) {
      return normalizeSearchText(name).replace(/\s+/g, ' ').trim();
    }

    function getBibleBookOrder(version) {
      const list = (version && bibles[version]) ? bibles[version] : [];
      const firstTitle = list[0]?.title || '';
      const lastTitle = list[list.length - 1]?.title || '';
      const cacheKey = `${version || ''}|${list.length}|${firstTitle}|${lastTitle}`;
      const cached = bibleBookOrderCache.get(version);
      if (cached && cached.key === cacheKey) return cached.order;
      const seen = new Set();
      const order = [];
      list.forEach(item => {
        const book = item?.book || extractBookAndChapter(item).book;
        const key = normalizeBookName(book);
        if (!key || seen.has(key)) return;
        seen.add(key);
        order.push(book);
      });
      bibleBookOrderCache.set(version, { key: cacheKey, order });
      return order;
    }

    function findBibleChapterIndex(version, bookName, chap, fallbackIndex) {
      const list = (version && bibles[version]) ? bibles[version] : [];
      if (!list.length) return -1;
      const chapStr = (chap == null) ? null : String(chap);
      const bookKey = normalizeBookName(bookName);
      let idx = -1;

      if (bookKey && chapStr) {
        idx = list.findIndex(item => {
          const itemBook = normalizeBookName(item?.book || extractBookAndChapter(item).book);
          const itemChap = String(item?.chapter || extractBookAndChapter(item).chap || "");
          return itemBook === bookKey && itemChap === chapStr;
        });
      }

      if (idx === -1 && typeof fallbackIndex === 'number' && fallbackIndex >= 0 && fallbackIndex < list.length) {
        idx = fallbackIndex;
      }
      return idx;
    }

    function changeActiveBibleVersion(ver) {
      const previousPrimary = activeBibleVersion;
      let targetVerse = null;
      let targetLineCursor = lineCursor;
      let targetBook = null;
      let targetChap = null;
      let targetBookIndex = null;

      if (sidebarTab === 'bible' && currentItem) {
        const currentPages = getPagesFromItem(currentItem, true);
        const curPage = currentPages[lineCursor];
        if (curPage && curPage.raw) {
          const firstLine = (curPage.raw.split('\n').find(l => l.trim()) || '').trim();
          const matchVerse = firstLine.match(/^(\d+)/);
          if (matchVerse) targetVerse = matchVerse[1];
        }
        const extracted = extractBookAndChapter(currentItem);
        targetBook = extracted.book;
        targetChap = extracted.chap;
        if (targetBook && activeBibleVersion) {
          const order = getBibleBookOrder(activeBibleVersion);
          const foundIdx = order.findIndex(name => normalizeBookName(name) === normalizeBookName(targetBook));
          if (foundIdx !== -1) targetBookIndex = foundIdx;
        }
      }

      if (activeBibleVersion === ver) {
        activeBibleVersion = null;
        renderVersionBar();
        renderSongs();
        updateBibleLists();
        return;
      }
      activeBibleVersion = ver;
      if (dualVersionModeEnabled && dualVersionSecondaryId && activeBibleVersion && dualVersionSecondaryId === activeBibleVersion) {
        const fallbackSecondary = (previousPrimary && previousPrimary !== activeBibleVersion) ? previousPrimary : null;
        setDualVersionSecondaryId(fallbackSecondary, { silent: true });
      }
      renderVersionBar();
      updateBibleLists();
      if (sidebarTab === 'bible') {
        if (bibles[activeBibleVersion]) {
          const order = getBibleBookOrder(activeBibleVersion);
          const resolvedBook = (targetBookIndex != null && order[targetBookIndex]) ? order[targetBookIndex] : targetBook;
          const idx = findBibleChapterIndex(activeBibleVersion, resolvedBook, targetChap, currentIndex);
          if (idx !== -1) {
            selectItem(idx, { preserveLineCursor: true, skipButtonView: true });
            const newItem = bibles[activeBibleVersion][idx];
            const newPages = getPagesFromItem(newItem, true);
            let nextLineCursor = Math.min(targetLineCursor, Math.max(0, newPages.length - 1));
            if (targetVerse) {
              const foundIdx = newPages.findIndex(p => (p.raw || '').split('\n').some(line => line.trim().startsWith(`${targetVerse} `)));
              if (foundIdx !== -1) nextLineCursor = foundIdx;
            }
            if (lineCursor !== nextLineCursor) {
              lineCursor = nextLineCursor;
            }
            updateButtonView({ preserveScroll: true, skipAutoScroll: true });
            if (versionSwitchUpdatesLive && isLive && livePointer && livePointer.kind === 'bible') {
              livePointer = { kind: 'bible', version: activeBibleVersion, index: idx };
              liveLineCursor = lineCursor;
              pushLiveUpdate();
            }
            saveToStorageDebounced();
            return;
          }
        }
        ensureSelectionFallback();
      } else {
        renderSongs();
      }
      saveToStorageDebounced();
    }

    function updateBibleLists() {
      const bookSelect = document.getElementById('bible-book-select');
      const chapSelect = document.getElementById('bible-chap-select');
      
      if (!bookSelect || !chapSelect) return;
      
      bookSelect.innerHTML = `<option value="">${esc(t('ui_select_book'))}</option>`;
      chapSelect.innerHTML = `<option value="">${esc(t('ui_chapter_short'))}</option>`;
      chapSelect.disabled = true;
      
      if (!activeBibleVersion || !bibles[activeBibleVersion]) return;
      
      const uniqueBooks = [...new Set(bibles[activeBibleVersion].map(c => {
        const parts = c.title.split(' ');
        return parts.slice(0, -1).join(' ');
      }))];
      
      uniqueBooks.forEach(book => {
        const opt = document.createElement('option');
        opt.value = book;
        opt.textContent = book;
        bookSelect.appendChild(opt);
      });
    }

    function resetBibleDropdowns() {
      const bookSelect = document.getElementById('bible-book-select');
      const chapSelect = document.getElementById('bible-chap-select');
      if (bookSelect) {
        bookSelect.value = '';
      }
      if (chapSelect) {
        chapSelect.innerHTML = `<option value="">${esc(t('ui_chapter_short'))}</option>`;
        chapSelect.disabled = true;
      }
    }

    function handleBookSelect() {
      const bookSelect = document.getElementById('bible-book-select');
      const chapSelect = document.getElementById('bible-chap-select');
      const book = bookSelect.value;
      
      chapSelect.innerHTML = `<option value="">${esc(t('ui_chapter_short'))}</option>`;
      
      if (!book || !activeBibleVersion || !bibles[activeBibleVersion]) {
        chapSelect.disabled = true;
        return;
      }
      
      chapSelect.disabled = false;
      
      const chapters = bibles[activeBibleVersion]
        .filter(c => {
          const bookPart = c.title.split(' ').slice(0, -1).join(' ');
          return bookPart === book;
        })
        .map(c => c.title.split(' ').pop());
      
      const uniqueChaps = [...new Set(chapters)].sort((a, b) => parseInt(a) - parseInt(b));
      uniqueChaps.forEach(chap => {
        const opt = document.createElement('option');
        opt.value = chap;
        opt.textContent = chap;
        chapSelect.appendChild(opt);
      });
      renderBibleAutocomplete();
      renderSongs();
    }

    function handleChapterSelect() {
      const bookSelect = document.getElementById('bible-book-select');
      const chapSelect = document.getElementById('bible-chap-select');
      const book = bookSelect.value;
      const chap = chapSelect.value;
      
      if (!book || !chap || !activeBibleVersion || !bibles[activeBibleVersion]) return;
      
      const idx = bibles[activeBibleVersion].findIndex(c => {
        const bookPart = c.title.split(' ').slice(0, -1).join(' ');
        const chapPart = c.title.split(' ').pop();
        return bookPart === book && chapPart === chap;
      });
      
      if (idx !== -1) selectItem(idx);
      if (idx !== -1) {
        const picked = bibles[activeBibleVersion][idx];
        const extracted = extractBookAndChapter(picked);
        addBibleRecentReference(buildBibleRefEntry(extracted.book, extracted.chap, null, null, activeBibleVersion));
      }
    }

    let dragIndex = null;

    function renderBibleSearchResults(qRaw) {
      const list = document.getElementById('song-list');
      const normalizedQuery = normalizeSearchText(qRaw || '').trim();
      if (normalizedQuery !== lastBibleSearchQuery) currentSearchPos = null;
      lastBibleSearchQuery = normalizedQuery;
      list.innerHTML = '';
      if (!activeBibleVersion && Object.keys(bibles).length > 0) {
        activeBibleVersion = Object.keys(bibles)[0];
        renderVersionBar();
      }
      if (!activeBibleVersion || !bibles[activeBibleVersion]) return;
      const selectedBook = document.getElementById('bible-book-select')?.value || '';
      const referenceQuery = parseBibleReferenceQuery(qRaw);
      const results = referenceQuery
        ? findBibleReferenceMatches(referenceQuery, {
            versionId: activeBibleVersion,
            book: selectedBook
          })
        : findBibleKeywordMatches(qRaw, {
            versionId: activeBibleVersion,
            book: selectedBook,
            maxResults: 200
          });
      if (currentSearchPos != null && (currentSearchPos < 0 || currentSearchPos >= results.length)) {
        currentSearchPos = null;
      }
      if (!results.length) {
        const empty = document.createElement('div');
        empty.className = 'song-item';
        empty.style.cursor = 'default';
        empty.style.opacity = '0.7';
        empty.innerText = 'No matches found';
        list.appendChild(empty);
        list._navMirrorItems = [];
        return;
      }
      const bibleList = (activeBibleVersion && bibles[activeBibleVersion]) ? bibles[activeBibleVersion] : [];
      list._navMirrorItems = results.map((entry, resultIndex) => {
        const sourceItem = bibleList[entry.chapterIndex] || null;
        return {
          title: `${entry.book} ${entry.chapter}:${entry.verse}`,
          snippet: entry.text || '',
          active: currentSearchPos === resultIndex,
          activate: () => {
            currentSearchPos = resultIndex;
            activateBibleSearchResult(entry.chapterIndex, entry.verse);
          },
          contextMenu: (clientX, clientY) => {
            if (typeof window._openSidebarContextMenu !== 'function' || !sourceItem) return;
            window._openSidebarContextMenu('bible', sourceItem, entry.chapterIndex, resultIndex, clientX, clientY, { bibleVerse: entry.verse });
          }
        };
      });
      results.forEach((entry, resultIndex) => {
        const div = document.createElement('div');
        div.className = 'song-item';
        if (currentSearchPos === resultIndex) div.classList.add('active');
        div.dataset.index = String(entry.chapterIndex);
        div.dataset.chapterIndex = String(entry.chapterIndex);
        div.dataset.verse = String(entry.verse);
        div.dataset.pos = String(resultIndex);
        const left = document.createElement('div');
        const title = document.createElement('span');
        title.className = 'search-title';
        title.textContent = `${entry.book} ${entry.chapter}:${entry.verse}`;
        const snippet = document.createElement('span');
        snippet.className = 'search-snippet';
        snippet.textContent = entry.text;
        left.appendChild(title);
        left.appendChild(snippet);
        div.appendChild(left);
        div.onclick = () => {
          currentSearchPos = resultIndex;
          activateBibleSearchResult(entry.chapterIndex, entry.verse);
        };
        div.ondblclick = () => {
          currentSearchPos = resultIndex;
          activateBibleSearchResult(entry.chapterIndex, entry.verse);
          projectLive(true);
        };
        div.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window._openSidebarContextMenu !== 'function') return;
          const bibleList = (activeBibleVersion && bibles[activeBibleVersion]) ? bibles[activeBibleVersion] : [];
          const sourceItem = bibleList[entry.chapterIndex];
          if (!sourceItem) return;
          window._openSidebarContextMenu(
            'bible',
            sourceItem,
            entry.chapterIndex,
            resultIndex,
            e.clientX,
            e.clientY,
            { bibleVerse: entry.verse }
          );
        });
        list.appendChild(div);
      });
    }

    function activateBibleSearchResult(chapterIndex, verse) {
      selectItem(chapterIndex, { preserveLineCursor: true, skipButtonView: true });
      setBibleGroupAnchor(verse, currentItem);
      const pages = getPagesFromItem(currentItem, true);
      const vIdx = pages.findIndex(p => matchesVerseStart(p.raw, verse));
      if (vIdx !== -1) lineCursor = vIdx;
      updateButtonView();
      if (currentItem) {
        const extracted = extractBookAndChapter(currentItem);
        addBibleRecentReference(buildBibleRefEntry(extracted.book, extracted.chap, verse, null, activeBibleVersion));
      }
    }

    function navigateSidebar(delta) {
      const list = document.getElementById('song-list');
      if (!list) return;
      const items = Array.from(list.querySelectorAll('.song-item'));
      if (!items.length) return;
      const usePos = items.some(item => item.dataset.pos != null);
      let currentIdx = -1;
      if (usePos && currentSearchPos != null) {
        currentIdx = items.findIndex(item => item.dataset.pos === String(currentSearchPos));
      } else if (currentItem && currentIndex != null) {
        currentIdx = items.findIndex(item => Number(item.dataset.index) === currentIndex);
      }
      if (currentIdx === -1) {
        const activeEl = list.querySelector('.song-item.active');
        if (activeEl) currentIdx = items.indexOf(activeEl);
      }
      let nextIdx = (currentIdx === -1) ? (delta > 0 ? 0 : items.length - 1) : currentIdx + delta;
      nextIdx = Math.max(0, Math.min(items.length - 1, nextIdx));
      const target = items[nextIdx];
      if (!target) return;
      const idx = Number(target.dataset.index);
      if (!Number.isFinite(idx)) return;
      if (usePos) {
        const pos = Number(target.dataset.pos);
        if (Number.isFinite(pos)) currentSearchPos = pos;
        const verse = Number(target.dataset.verse);
        if (Number.isFinite(verse)) {
          activateBibleSearchResult(idx, verse);
        } else {
          selectItem(idx);
        }
      } else {
        currentSearchPos = null;
        selectItem(idx);
      }
      requestAnimationFrame(() => {
        ensureSidebarItemVisible(idx, usePos ? currentSearchPos : null);
      });
    }

    function ensureSidebarItemVisible(idx, pos = null) {
      const list = document.getElementById('song-list');
      if (!list || list.clientHeight === 0) return;
      let item = null;
      if (pos != null) item = list.querySelector(`.song-item[data-pos="${pos}"]`);
      if (!item) item = list.querySelector(`.song-item[data-index="${idx}"]`);
      if (!item) return;
      const listRect = list.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const pad = 6;
      const topDelta = itemRect.top - (listRect.top + pad);
      const bottomDelta = itemRect.bottom - (listRect.bottom - pad);
      if (topDelta < 0) list.scrollTop += topDelta;
      else if (bottomDelta > 0) list.scrollTop += bottomDelta;
    }

    /* ══════════════════════════════════════════════
       Sidebar Context Menu (Song / Bible / Setlist)
       ══════════════════════════════════════════════ */
    (function _initSidebarContextMenu() {
      const menu = document.getElementById('sidebar-context-menu');
      if (!menu) return;
      if (menu.parentElement !== document.body) document.body.appendChild(menu);

      function close() {
        menu.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
        menu.innerHTML = '';
      }

      document.addEventListener('mousedown', (e) => {
        if (!menu.classList.contains('open')) return;
        const t = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
        if (t && typeof t.closest === 'function' && t.closest('#sidebar-context-menu')) return;
        close();
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      window.addEventListener('resize', close);
      window.addEventListener('scroll', close, true);

      window._openSidebarContextMenu = function(tab, item, itemIndex, arrayIndex, x, y, contextMeta) {
        close();
        const isBible = (tab === 'bible');
        const isSong = (tab === 'songs');
        const isSchedule = (tab === 'schedule');
        const items = [];

        /* ── Common actions ── */
        if (!isSchedule) {
          items.push({ label: t('common_add_to_setlist'), icon: '+', action: () => {
            const list = isSong ? songs : (activeBibleVersion ? bibles[activeBibleVersion] : []);
            if (list[itemIndex]) {
              insertIntoSchedule({ ...list[itemIndex] }, {
                successMessage: t('setlist_added'),
                duplicateMessage: t('setlist_duplicate_moved_top')
              });
            }
            close();
          }});
        }

        if (isBible) {
          items.push({ label: t('common_project_live'), icon: '▶', action: () => {
            buttonContextTab = 'bible';
            const verseFromSearch = contextMeta && contextMeta.bibleVerse != null
              ? String(contextMeta.bibleVerse).trim()
              : '';
            if (verseFromSearch) {
              activateBibleSearchResult(itemIndex, verseFromSearch);
            } else {
              selectItem(itemIndex);
            }
            projectLive(true);
            close();
          }});
        }

        if (isSong) {
          items.push({ label: t('common_project_live'), icon: '▶', action: () => {
            buttonContextTab = 'songs';
            selectItem(itemIndex);
            projectLive(true);
            close();
          }});
          items.push({ label: t('common_rename_song'), icon: '✎', action: () => {
            const target = songs[itemIndex];
            if (!target) { close(); return; }
            showConfirm(t('common_rename_song'), t('common_enter_new_song_title'), (inputValue) => {
              renameSongTitle(itemIndex, inputValue);
            }, true, target.title || '');
            close();
          }});
        }

        if (!isSchedule) {
          items.push({ type: 'sep' });
          items.push({
            label: t('common_edit'),
            icon: '✎',
            disabled: isBible,
            action: () => {
              if (isBible) { close(); return; }
              buttonContextTab = tab;
              selectItem(itemIndex);
              close();
            }
          });
        }

        if (isSchedule) {
          items.push({ label: t('common_project_live'), icon: '▶', action: () => {
            scheduleReturnTarget = buildScheduleRestoreTarget(item);
            buttonContextTab = 'schedule';
            selectItem(arrayIndex);
            projectLive(true);
            close();
          }});
          items.push({ type: 'sep' });
          items.push({ label: t('common_move_to_top'), icon: '↑', action: () => {
            if (arrayIndex > 0) {
              const moved = schedule.splice(arrayIndex, 1)[0];
              schedule.unshift(moved);
              saveState(); saveToStorageDebounced(); renderSongs();
            }
            close();
          }});
          items.push({ label: t('common_move_to_bottom'), icon: '↓', action: () => {
            if (arrayIndex < schedule.length - 1) {
              const moved = schedule.splice(arrayIndex, 1)[0];
              schedule.push(moved);
              saveState(); saveToStorageDebounced(); renderSongs();
            }
            close();
          }});
          items.push({ type: 'sep' });
          items.push({ label: t('common_remove_from_setlist'), icon: '✕', danger: true, action: () => {
            schedule.splice(arrayIndex, 1);
            saveState(); saveToStorageDebounced(); renderSongs();
            showToast(t('setlist_removed'));
            close();
          }});
        }

        if (!isSchedule) {
          items.push({
            label: t('common_delete'),
            icon: '✕',
            danger: true,
            disabled: isBible,
            action: () => {
              if (isBible) { close(); return; }
              deleteItem(itemIndex, new MouseEvent('click'));
              close();
            }
          });
        }

        /* ── Build menu DOM ── */
        const groupTitle = document.createElement('div');
        groupTitle.className = 'sl-ctx-group-title';
        groupTitle.textContent = (item.title || 'Item').substring(0, 40);
        menu.appendChild(groupTitle);

        items.forEach(it => {
          if (it.type === 'sep') {
            const sep = document.createElement('div');
            sep.className = 'sl-ctx-sep';
            menu.appendChild(sep);
            return;
          }
          const btn = document.createElement('button');
          btn.className = 'sl-ctx-item' + (it.danger ? ' danger' : '');
          btn.textContent = it.label;
          btn.disabled = !!it.disabled;
          btn.onclick = it.action;
          menu.appendChild(btn);
        });

        /* ── Position ── */
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');
        const rect = menu.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 8;
        const maxY = window.innerHeight - rect.height - 8;
        menu.style.left = Math.max(4, Math.min(x, maxX)) + 'px';
        menu.style.top = Math.max(4, Math.min(y, maxY)) + 'px';
      };
    })();

    function renderSongs() {
      const list = document.getElementById('song-list');
      if (!list) return;
      const qRaw = document.getElementById('song-search').value || "";
      const q = normalizeSearchText(qRaw);
      list.replaceChildren();
      list._navMirrorItems = [];
      if (sidebarTab === 'bible' && qRaw.trim().length >= 2 && !isBibleReferenceQuery(qRaw)) {
        renderBibleSearchResults(qRaw);
        return;
      }
      currentSearchPos = null;
      let displayList = getButtonContextList();
      let displayIndices = null;
      if (buttonContextTab === 'bible' && sidebarTab === 'bible') {
        const selectedBook = document.getElementById('bible-book-select')?.value || '';
        const bookKey = normalizeBookName(selectedBook);
        if (bookKey) {
          const filtered = [];
          const indices = [];
          displayList.forEach((item, idx) => {
            const itemBook = item?.book || extractBookAndChapter(item).book;
            if (normalizeBookName(itemBook) === bookKey) {
              filtered.push(item);
              indices.push(idx);
            }
          });
          displayList = filtered;
          displayIndices = indices;
        }
      }
      const frag = document.createDocumentFragment();
      const navMirrorItems = [];
      displayList.forEach((s, i) => {
        if (q && !getItemSearchableText(s).includes(q)) return;
        const itemIndex = (sidebarTab === 'bible' && displayIndices) ? displayIndices[i] : i;
        const div = document.createElement('div');
        div.className = 'song-item' + (currentItem === s ? ' active' : '');
        div.dataset.index = String(itemIndex);
        const left = document.createElement('span');
        left.textContent = s.title;
        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.alignItems = 'center';
        const isScheduleUi = (sidebarTab === 'schedule' && buttonContextTab === 'schedule');
        if (isScheduleUi) {
          const handle = document.createElement('span');
          handle.className = 'drag-handle'; handle.textContent = '☰';
          right.appendChild(handle);
          const del = document.createElement('span');
          del.style.cursor = 'pointer'; del.style.marginLeft = '12px'; del.textContent = '✕';
          del.onclick = (e) => { e.stopPropagation(); removeFromSet(i, e) };
          right.appendChild(del);
          div.draggable = true;
          div.addEventListener('dragstart', (e) => { dragIndex = i; div.classList.add('dragging') });
          div.addEventListener('dragend', () => { dragIndex = null; div.classList.remove('dragging'); [...list.children].forEach(ch => ch.classList.remove('drop-target')) });
          div.addEventListener('dragover', (e) => { e.preventDefault(); div.classList.add('drop-target') });
          div.addEventListener('dragleave', () => div.classList.remove('drop-target'));
          div.addEventListener('drop', (e) => { e.preventDefault(); div.classList.remove('drop-target'); if (dragIndex == null || dragIndex === i) return; const item = schedule.splice(dragIndex, 1)[0]; schedule.splice(i, 0, item); saveState(); saveToStorageDebounced(); renderSongs() });
        } else {
          const add = document.createElement('span');
          add.style.color = 'var(--success)'; add.style.marginRight = '12px'; add.style.cursor = 'pointer'; add.textContent = '+';
          add.onclick = (e) => addToSet(itemIndex, e);
          right.appendChild(add);
          if (sidebarTab !== 'bible') {
            const del = document.createElement('span');
            del.style.cursor = 'pointer'; del.textContent = '✕';
            del.onclick = (e) => deleteItem(itemIndex, e);
            right.appendChild(del);
          }
        }
        div.appendChild(left);
        div.appendChild(right);
        if (sidebarTab === 'schedule' && buttonContextTab === 'schedule') {
          const scheduleTarget = buildScheduleRestoreTarget(s);
          div.onclick = () => {
            scheduleReturnTarget = scheduleTarget;
            buttonContextTab = 'schedule';
            selectItem(itemIndex);
            const setlistBehavior = (typeof getSetlistSettingsSnapshot === 'function')
              ? getSetlistSettingsSnapshot()
              : DEFAULT_SETLIST_SETTINGS;
            if (setlistBehavior.autoGoLiveOnSelect) {
              projectLive(true);
            }
          };
          div.ondblclick = () => {
            scheduleReturnTarget = scheduleTarget;
            buttonContextTab = 'schedule';
            selectItem(itemIndex);
            projectLive(true);
          };
        } else {
          div.onclick = () => {
            buttonContextTab = sidebarTab;
            selectItem(itemIndex);
          };
        }
        /* ── Right-click context menu ── */
        div.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window._openSidebarContextMenu !== 'function') return;
          window._openSidebarContextMenu(sidebarTab, s, itemIndex, i, e.clientX, e.clientY);
        });
        navMirrorItems.push({
          row: div,
          title: s.title || '',
          snippet: '',
          active: currentItem === s,
          activate: () => {
            if (sidebarTab === 'schedule' && buttonContextTab === 'schedule') {
              scheduleReturnTarget = buildScheduleRestoreTarget(s);
              buttonContextTab = 'schedule';
              selectItem(itemIndex);
              return;
            }
            buttonContextTab = sidebarTab;
            selectItem(itemIndex);
          },
          contextMenu: (clientX, clientY) => {
            if (typeof window._openSidebarContextMenu !== 'function') return;
            window._openSidebarContextMenu(sidebarTab, s, itemIndex, i, clientX, clientY);
          }
        });
        frag.appendChild(div);
      });
      list.appendChild(frag);
      list._navMirrorItems = navMirrorItems;
      if (typeof window._refreshNavMirrorResults === 'function') {
        window._refreshNavMirrorResults();
      }
      renderFocusedMainPanel();
    }

    function configureImportAccept() {
      const input = document.getElementById('import-file');
      if (!input) return;
      // OBS/CEF has inconsistent behavior with mixed extension filters.
      // Show all files in picker, then enforce allowed extensions in handleImport().
      input.accept = '';
    }

    function triggerImport() {
      if ((typeof sidebarTab !== 'undefined' && sidebarTab === 'media') || document.body.dataset.sidebarTab === 'media') {
        if (window.bspMedia && typeof window.bspMedia.openFilePicker === 'function') {
          window.bspMedia.openFilePicker();
        } else {
          const mediaInput = document.getElementById('media-file-input');
          if (mediaInput) mediaInput.click();
        }
        return;
      }
      configureImportAccept();
      document.getElementById('import-file').click();
    }

    async function handleImport(input) {
      let importedAnyBible = false;
      let importedCount = 0;
      let skippedUnsupported = 0;
      let hadImportError = false;
      let hadBiblePersistError = false;
      for (const file of input.files) {
        try {
          const name = file.name.toLowerCase();
          const text = await file.text();
          if (name.endsWith('.xml')) {
            const xml = new DOMParser().parseFromString(text, "text/xml");
            const bibleRoot = xml.querySelector('bible');
            const xmlBibleRoot = xml.querySelector('XMLBIBLE') || xml.querySelector('xmlbible');
            const verName = bibleRoot?.getAttribute('translation') ||
                           bibleRoot?.getAttribute('name') ||
                           bibleRoot?.getAttribute('n') ||
                           xmlBibleRoot?.getAttribute('biblename') ||
                           xmlBibleRoot?.getAttribute('name') ||
                           file.name.split('.')[0].toUpperCase();
            const parsed = parseBible(xml, verName);
            if (bibles[verName]) {
              showConfirm('Version Exists', `Version "${verName}" already exists. Replace?`, async () => {
                bibles[verName] = parsed;
                clearBibleSearchCache(verName);
                if (!activeBibleVersion || !bibles[activeBibleVersion]) {
                  activeBibleVersion = verName;
                }
                saveState();
                renderVersionBar();
                updateBibleLists();
                renderSongs();
                ensureSelectionFallback();
                saveToStorageDebounced();
                try {
                  await idbPut(STORE_BIBLES, buildBibleRecord(verName, parsed, { isNew: false }));
                  await flushAppState();
                  showToast(t('bible_version_imported'));
                } catch (e) {
                  console.error('Bible import persist failed', e);
                  showToast(t('bible_import_persist_failed'));
                }
              });
              return;
            }
            bibles[verName] = parsed;
            clearBibleSearchCache(verName);
            if (!activeBibleVersion || !bibles[activeBibleVersion]) {
              activeBibleVersion = verName;
            }
            try {
              await idbPut(STORE_BIBLES, buildBibleRecord(verName, parsed, { isNew: true }));
            } catch (e) {
              hadBiblePersistError = true;
              console.error('Bible import persist failed', e);
            }
            importedAnyBible = true;
            importedCount += 1;
            renderVersionBar();
            updateBibleLists();
          } else if (name.endsWith('.txt')) {
            const title = file.name.split('.')[0];
            const newSong = {
              id: createId('song', title),
              title,
              content: text,
              text,
              translatedLyrics: '',
              translationLanguage: getSongBilingualSettings().targetLanguage,
              translationStatus: 'idle',
              translationLocked: false,
              translatedAt: 0,
              translationHash: computeTranslationHash(text, getSongBilingualSettings().targetLanguage),
              searchableText: normalizeSearchText(`${title}\n${text}`),
              createdAt: Date.now(),
              updatedAt: Date.now()
            };
            songs.push(newSong);
            idbPut(STORE_SONGS, buildSongRecord(newSong, { isNew: true })).catch(() => {});
            maybeTranslateImportedSong(newSong);
            importedCount += 1;
          } else {
            skippedUnsupported += 1;
            continue;
          }
        } catch (e) {
          hadImportError = true;
          console.error('Import failed for file', file && file.name ? file.name : '(unknown file)', e);
        }
      }
      saveState();
      saveToStorageDebounced();
      if (importedAnyBible) {
        try { await flushAppState(); } catch (_) {}
      }
      if (hadBiblePersistError) {
        showToast(t('bible_import_persist_failed'));
      }
      if (hadImportError) {
        showToast(t('import_failed'));
      }
      if (skippedUnsupported > 0) {
        showToast(t('import_skipped_unsupported').replace('{count}', String(skippedUnsupported)));
      }
      renderSongs();
      ensureSelectionFallback();
      input.value = "";
      if (importedCount > 0) {
        showToast(importedCount === 1
          ? t('import_file_imported')
          : t('import_files_imported').replace('{count}', String(importedCount)));
      } else if (!skippedUnsupported) {
        showToast(t('common_no_file_selected'));
      }
    }

    function formatBackupFilename(date) {
      const d = date || new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
      return `BibleSongPro_Backup_${stamp}.json`;
    }

    function mergeAppStateWithDefaults(raw) {
      const base = buildDefaultAppState();
      const next = (raw && typeof raw === 'object') ? raw : {};
      const nextUi = next.ui || {};
      const nextSearchText = nextUi.searchText;
      const mergedSearchText = { ...DEFAULT_SEARCH_QUERIES };
      if (nextSearchText && typeof nextSearchText === 'object' && !Array.isArray(nextSearchText)) {
        SEARCH_TABS.forEach(tab => {
          if (nextSearchText[tab] != null) mergedSearchText[tab] = String(nextSearchText[tab]);
        });
      } else if (typeof nextSearchText === 'string') {
        SEARCH_TABS.forEach(tab => {
          mergedSearchText[tab] = nextSearchText;
        });
      }
      const mergedUi = {
        ...base.ui,
        ...nextUi,
        searchText: mergedSearchText,
        bibleRecentRefs: sanitizeBibleRefEntries(nextUi.bibleRecentRefs, MAX_BIBLE_RECENT_REFS),
        biblePinnedRefs: sanitizeBibleRefEntries(nextUi.biblePinnedRefs, MAX_BIBLE_PINNED_REFS),
        focusedWorkspaceControls: nextUi.focusedWorkspaceControls || base.ui.focusedWorkspaceControls
      };
      return {
        ...base,
        ...next,
        mode: { ...base.mode, ...(next.mode || {}) },
        songNav: { ...base.songNav, ...(next.songNav || {}) },
        bibleNav: { ...base.bibleNav, ...(next.bibleNav || {}) },
        live: { ...base.live, ...(next.live || {}) },
        audioMixer: { ...base.audioMixer, ...(next.audioMixer || {}) },
        ui: mergedUi
      };
    }

    function coerceSongRecord(raw) {
      if (!raw) return null;
      const text = raw.text || raw.content || '';
      const seed = {
        id: raw.id,
        title: raw.title || raw.name || '',
        text,
        content: text,
        translatedLyrics: raw.translatedLyrics || '',
        translationLanguage: raw.translationLanguage || '',
        translationStatus: raw.translationStatus || 'idle',
        translationLocked: !!raw.translationLocked,
        translatedAt: raw.translatedAt || 0,
        translationHash: raw.translationHash || '',
        bilingualEnabled: !!raw.bilingualEnabled,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt
      };
      if (!seed.title && !seed.text) return null;
      const record = buildSongRecord(seed, { isNew: false });
      if (raw.searchableText) record.searchableText = raw.searchableText;
      if (Array.isArray(raw.normalizedLines)) record.normalizedLines = raw.normalizedLines;
      if (raw.createdAt) record.createdAt = raw.createdAt;
      if (raw.updatedAt) record.updatedAt = raw.updatedAt;
      return record;
    }

    function coerceBibleRecord(raw) {
      if (!raw) return null;
      const id = raw.id || raw.name;
      if (!id) return null;
      if (Array.isArray(raw.parsedData)) {
        return {
          id,
          name: raw.name || id,
          parsedData: raw.parsedData,
          searchableText: raw.searchableText || normalizeSearchText(raw.name || id),
          createdAt: raw.createdAt || Date.now(),
          updatedAt: raw.updatedAt || Date.now()
        };
      }
      if (raw.xmlText) {
        try {
          const xml = new DOMParser().parseFromString(raw.xmlText, "text/xml");
          const parsed = parseBible(xml, raw.name || id);
          return buildBibleRecord(raw.name || id, parsed, { isNew: false, createdAt: raw.createdAt || null });
        } catch (e) {
          return null;
        }
      }
      return null;
    }

    function normalizeSongRecords(raw) {
      if (Array.isArray(raw)) return raw.map(coerceSongRecord).filter(Boolean);
      if (raw && typeof raw === 'object') {
        return Object.values(raw).map(coerceSongRecord).filter(Boolean);
      }
      return [];
    }

    function normalizeBibleRecords(raw) {
      if (Array.isArray(raw)) return raw.map(coerceBibleRecord).filter(Boolean);
      if (raw && typeof raw === 'object') {
        const out = [];
        Object.entries(raw).forEach(([id, value]) => {
          if (Array.isArray(value)) {
            out.push(buildBibleRecord(id, value, { isNew: false }));
          } else if (value && typeof value === 'object') {
            out.push(coerceBibleRecord({ id, ...value }));
          }
        });
        return out.filter(Boolean);
      }
      return [];
    }

    function safeStringify(value) {
      try {
        return JSON.stringify(value, null, 2);
      } catch (e) {
        return JSON.stringify(value, (key, val) => {
          if (typeof val === 'function') return undefined;
          if (val && val.nodeType) return undefined;
          if (typeof val === 'bigint') return val.toString();
          if (val instanceof Map) return Array.from(val.entries());
          if (val instanceof Set) return Array.from(val.values());
          return val;
        }, 2);
      }
    }

    function showObsBackupOverlay(filename, json) {
      const isObsBrowserSource = !!window.obsstudio;
      const existing = document.getElementById('obs-backup-overlay');
      if (existing) existing.remove();
      const overlay = document.createElement('div');
      overlay.id = 'obs-backup-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;padding:16px;';
      const panel = document.createElement('div');
      panel.style.cssText = 'width:min(980px,96vw);max-height:92vh;background:#0f1117;border:1px solid rgba(255,255,255,0.16);border-radius:10px;display:flex;flex-direction:column;overflow:hidden;';
      const header = document.createElement('div');
      header.style.cssText = 'padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.12);display:flex;align-items:center;gap:8px;color:#e8ecf5;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
      header.textContent = t('backup_json_title').replace('{filename}', filename);
      const btnWrap = document.createElement('div');
      btnWrap.style.cssText = 'margin-left:auto;display:flex;gap:8px;';
      const btnCopy = document.createElement('button');
      btnCopy.type = 'button';
      btnCopy.textContent = 'Copy';
      btnCopy.style.cssText = 'padding:6px 10px;font-size:11px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:#1b2030;color:#fff;cursor:pointer;';
      const btnSave = document.createElement('button');
      btnSave.type = 'button';
      btnSave.textContent = 'Save .json';
      btnSave.style.cssText = btnCopy.style.cssText;
      const btnClose = document.createElement('button');
      btnClose.type = 'button';
      btnClose.textContent = 'Close';
      btnClose.style.cssText = 'padding:6px 10px;font-size:11px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:#2a1520;color:#fff;cursor:pointer;';
      btnWrap.appendChild(btnCopy);
      btnWrap.appendChild(btnSave);
      btnWrap.appendChild(btnClose);
      header.appendChild(btnWrap);
      const body = document.createElement('div');
      body.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:8px;';
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#c7d2ea;font:500 11px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
      hint.textContent = isObsBrowserSource
        ? t('backup_overlay_obs_hint')
        : t('backup_overlay_save_hint');
      const ta = document.createElement('textarea');
      ta.readOnly = true;
      ta.value = json;
      ta.style.cssText = 'width:100%;height:min(72vh,640px);resize:vertical;background:#080b12;color:#eaf0ff;border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:10px;font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;';
      body.appendChild(hint);
      body.appendChild(ta);
      panel.appendChild(header);
      panel.appendChild(body);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      ta.focus();
      ta.select();

      const close = () => overlay.remove();
      btnClose.onclick = close;
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      btnCopy.onclick = async () => {
        let ok = false;
        if (navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(json);
            ok = true;
          } catch (_) {}
        }
        if (!ok) {
          try {
            ta.focus();
            ta.select();
            ok = !!document.execCommand('copy');
          } catch (_) {}
        }
        showToast(ok ? 'Backup copied to clipboard' : t('common_copy_failed'));
      };
      btnSave.onclick = async () => {
        try {
          const payload = ta && typeof ta.value === 'string' ? ta.value : json;
          if (typeof window.showSaveFilePicker === 'function') {
            try {
              const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                  description: 'JSON Backup',
                  accept: { 'application/json': ['.json'] }
                }]
              });
              if (handle && typeof handle.createWritable === 'function') {
                const writable = await handle.createWritable();
                const encoded = new TextEncoder().encode(payload);
                await writable.write(encoded);
                await writable.close();
                if (typeof handle.getFile === 'function') {
                  const savedFile = await handle.getFile();
                  if (!savedFile || !savedFile.size) {
                    throw new Error('Saved file is empty');
                  }
                }
                showToast(t('backup_saved'));
                return;
              }
            } catch (pickerErr) {
              if (pickerErr && (pickerErr.name === 'AbortError' || pickerErr.code === 20)) return;
              console.warn('Backup overlay: save picker failed, falling back', pickerErr);
            }
          }
          let saved = false;
          try {
            const dataUrl = 'data:application/octet-stream;charset=utf-8,' + encodeURIComponent(payload);
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            saved = true;
          } catch (dataErr) {
            console.warn('Backup overlay: data URI download failed', dataErr);
          }
          if (!saved) {
            try {
              const blob = new Blob([payload], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = filename;
              document.body.appendChild(link);
              link.click();
              link.remove();
              setTimeout(() => URL.revokeObjectURL(url), 30000);
              saved = true;
            } catch (blobErr) {
              console.warn('Backup overlay: blob download failed', blobErr);
            }
          }
          if (saved) {
            showToast(t('backup_save_triggered_downloads'));
          } else {
            let copied = false;
            if (navigator.clipboard?.writeText) {
              try { await navigator.clipboard.writeText(payload); copied = true; } catch (_) {}
            }
            showToast(copied ? t('backup_save_failed_clipboard_fallback') : t('backup_save_failed'));
          }
        } catch (_) {
          showToast(t('backup_save_failed'));
        }
      };
    }

    async function exportBackup() {
      try {
        const filename = formatBackupFilename(new Date());
        let saveHandle = null;
        const isObsBrowserSource = !!(window.obsstudio && !(window.BSPDesktop && typeof window.BSPDesktop.saveRecordingFile === 'function'));
        if (typeof window.showSaveFilePicker === 'function') {
          try {
            saveHandle = await window.showSaveFilePicker({
              suggestedName: filename,
              types: [{
                description: 'JSON Backup',
                accept: { 'application/json': ['.json'] }
              }]
            });
          } catch (pickErr) {
            // User-cancel should not show a failure toast.
            if (pickErr && (pickErr.name === 'AbortError' || pickErr.code === 20)) return;
            console.warn('Backup export: save picker unavailable/fallback', pickErr);
          }
        }
        let dbOk = true;
        await openDb().catch(err => {
          console.error('Backup export: openDb failed', err);
          dbPromise = null;
          dbOk = false;
        });
        let songRecords = [];
        let bibleRecords = [];
        let stateEntry = null;
        if (dbOk) {
          try {
            const results = await Promise.all([
              dbGetAll(STORE_SONGS),
              dbGetAll(STORE_BIBLES),
              idbGet(STORE_STATE, 'appState')
            ]);
            songRecords = results[0] || [];
            bibleRecords = results[1] || [];
            stateEntry = results[2] || null;
          } catch (e) {
            console.error('Backup export: IndexedDB read failed', e);
            dbOk = false;
          }
        }
        if (!dbOk) {
          console.warn('Backup export: falling back to in-memory data');
        }
        if (!songRecords.length && songs.length) {
          songRecords = songs.map(coerceSongRecord).filter(Boolean);
        }
        if (!bibleRecords.length && Object.keys(bibles).length) {
          bibleRecords = Object.keys(bibles).map(name => buildBibleRecord(name, bibles[name] || [], { isNew: false })).filter(Boolean);
        }
        if (stateReady && appState) {
          syncAppStateFromUi();
        }
        const stateValue = appState || ((stateEntry && stateEntry.value) ? stateEntry.value : buildDefaultAppState());
        const settings = (stateValue.settings && typeof stateValue.settings === 'object') ? stateValue.settings : {};
        if (bgUploadDataUrl != null) settings.bgUploadDataUrl = bgUploadDataUrl;
        if (bgVideoUploadDataUrl != null) settings.bgVideoUploadDataUrl = bgVideoUploadDataUrl;
        const backup = {
          app: 'Bible Song Pro',
          backupVersion: 1,
          exportedAt: new Date().toISOString(),
          data: {
            songs: songRecords,
            bibles: bibleRecords,
            appState: stateValue,
            settings,
            ltStyles: settings.ltStyles || ltStyles,
            customFonts: settings.customFonts || customFonts,
            presets: Array.isArray(stateValue.presets) ? stateValue.presets : presets,
            extra: {
              backgroundUploads: {
                bgUploadDataUrl: bgUploadDataUrl || '',
                bgVideoUploadDataUrl: bgVideoUploadDataUrl || ''
              }
            }
          }
        };
        const json = safeStringify(backup);
        if (!json) throw new Error('Backup stringify failed');
        if (saveHandle) {
          try {
            const writable = await saveHandle.createWritable();
            const encoded = new TextEncoder().encode(json);
            await writable.write(encoded);
            await writable.close();
            if (typeof saveHandle.getFile === 'function') {
              const savedFile = await saveHandle.getFile();
              if (!savedFile || !savedFile.size) {
                throw new Error('Saved file is empty');
              }
            }
            showToast(t('backup_exported'));
            return;
          } catch (saveErr) {
            console.error('Backup export: save picker write failed, falling back', saveErr);
          }
        }
        if (isObsBrowserSource) {
          let copied = false;
          if (navigator.clipboard?.writeText) {
            try {
              await navigator.clipboard.writeText(json);
              copied = true;
            } catch (clipErr) {
              console.error('Backup export: OBS clipboard fallback failed', clipErr);
            }
          }
          showObsBackupOverlay(filename, json);
          if (copied) {
            showToast(t('backup_ready_viewer_opened_copied'));
            return;
          }
          showToast(t('backup_ready_viewer_opened'));
          return;
        }

        let downloadSucceeded = false;
        try {
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 400);
          downloadSucceeded = true;
        } catch (err) {
          console.error('Backup export: blob download failed', err);
        }
        if (!downloadSucceeded) {
          try {
            const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            downloadSucceeded = true;
          } catch (err) {
            console.error('Backup export: data URL fallback failed', err);
          }
        }
        if (!downloadSucceeded && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(json).catch(() => {});
          showToast(t('backup_export_fallback_clipboard'));
          return;
        }
        if (!downloadSucceeded) throw new Error('Backup download failed');
        showToast(t('backup_exported_named').replace('{filename}', filename));
      } catch (e) {
        console.error('Backup export failed', e);
        showToast(t('backup_export_failed'));
      }
    }

    function triggerBackupImport() {
      const input = document.getElementById('backup-import-file');
      if (input) input.click();
    }

    async function handleBackupImport(input) {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || parsed.app !== 'Bible Song Pro') {
          showToast(t('backup_invalid_file'));
          return;
        }
        if (parsed.backupVersion && parsed.backupVersion > 1) {
          showToast(t('backup_unsupported_version'));
          return;
        }
        pendingBackupData = parsed;
        showConfirm(t('settings_backup_import'), t('backup_import_overwrite_confirm'), (ok) => {
          if (!ok) return;
          applyBackupImport(pendingBackupData);
        });
      } catch (e) {
        showToast(t('backup_invalid_file'));
      }
    }

    async function applyBackupImport(backup) {
      const data = backup && backup.data ? backup.data : {};
      const songRecords = normalizeSongRecords(data.songs);
      const bibleRecords = normalizeBibleRecords(data.bibles);
      const mergedState = mergeAppStateWithDefaults(data.appState);
      const settings = (mergedState.settings && typeof mergedState.settings === 'object') ? { ...mergedState.settings } : {};
      if (data.settings && typeof data.settings === 'object') Object.assign(settings, data.settings);
      if (data.ltStyles && typeof data.ltStyles === 'object') settings.ltStyles = data.ltStyles;
      if (Array.isArray(data.customFonts)) settings.customFonts = data.customFonts;
      if (data.extra && data.extra.backgroundUploads) {
        const uploads = data.extra.backgroundUploads || {};
        if (uploads.bgUploadDataUrl != null) settings.bgUploadDataUrl = uploads.bgUploadDataUrl;
        if (uploads.bgVideoUploadDataUrl != null) settings.bgVideoUploadDataUrl = uploads.bgVideoUploadDataUrl;
      }
      if (Object.keys(settings).length) mergedState.settings = settings;
      if (Array.isArray(data.presets)) mergedState.presets = data.presets;
      const bgSnapshot = extractBackgroundSnapshot(mergedState.settings);
      const animationSnapshot = extractAnimationSnapshot(mergedState.settings);
      const typographySnapshot = extractTypographySnapshot(mergedState.settings);
      const modeSnapshot = extractModeSettingsSnapshot(mergedState.settings);

      isRestoringBackup = true;
      stateReady = false;
      try {
        ltStyles = {};
        customFonts = [];
        loadedFontNames.clear();
        await openDb();
        await Promise.all([
          dbClearStore(STORE_SONGS),
          dbClearStore(STORE_BIBLES),
          dbClearStore(STORE_STATE)
        ]);
        await Promise.all([
          dbPutMany(STORE_SONGS, songRecords),
          dbPutMany(STORE_BIBLES, bibleRecords),
          dbSetAppState(mergedState),
          (mergedState.settings && mergedState.settings.ltStyles) ? idbPut(STORE_STATE, { key: 'ltStyles', value: mergedState.settings.ltStyles, updatedAt: Date.now() }) : Promise.resolve(true),
          bgSnapshot ? idbPut(STORE_STATE, { key: 'bgSettings', value: bgSnapshot, updatedAt: Date.now() }) : Promise.resolve(true),
          animationSnapshot ? idbPut(STORE_STATE, { key: 'animationSettings', value: animationSnapshot, updatedAt: Date.now() }) : Promise.resolve(true),
          typographySnapshot ? idbPut(STORE_STATE, { key: 'typographySettings', value: typographySnapshot, updatedAt: Date.now() }) : Promise.resolve(true),
          modeSnapshot ? idbPut(STORE_STATE, { key: 'modeSettings', value: modeSnapshot, updatedAt: Date.now() }) : Promise.resolve(true)
        ]);

        applyLoadedState(mergedState, songRecords, bibleRecords, { runInit: false });
        stateReady = true;
        saveState();
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
        showToast(t('backup_imported_successfully'));
      } catch (e) {
        showToast(t('backup_import_failed'));
      } finally {
        isRestoringBackup = false;
      }
    }

    function detectBibleLanguage(xml, verName) {
      const root = xml.querySelector('bible') || xml.querySelector('XMLBIBLE') || xml.querySelector('xmlbible');
      const hintRaw = (root?.getAttribute('translation') || root?.getAttribute('language') || root?.getAttribute('lang') || root?.getAttribute('biblename') || verName || "").toLowerCase();
      const langTests = [
        { key: 'afrikaans', patterns: ['afrikaans', 'afr '] },
        { key: 'arabic', patterns: ['arabic', 'عرب', 'عربي'] },
        { key: 'albanian', patterns: ['albanian', 'shqip'] },
        { key: 'armenian', patterns: ['armenian', 'հայ'] },
        { key: 'amharic', patterns: ['amharic', 'አማርኛ'] },
        { key: 'azerbaijani', patterns: ['azerbaijani', 'azerbaijan', 'azeri', 'azərbaycan'] },
        { key: 'basque', patterns: ['basque', 'euskara', 'euskera'] },
        { key: 'bengali', patterns: ['bengali', 'bangla', 'বাংলা'] },
        { key: 'bulgarian', patterns: ['bulgarian', 'български'] },
        { key: 'burmese', patterns: ['burmese', 'myanmar', 'မြန်မာ'] },
        { key: 'catalan', patterns: ['catalan', 'català'] },
        { key: 'cebuano', patterns: ['cebuano', 'bisaya', 'binisaya'] },
        { key: 'chechen', patterns: ['chechen', 'чечен', 'нохч'] },
        { key: 'chewa', patterns: ['chewa', 'chichewa', 'nyanja'] },
        { key: 'chhattisgarhi', patterns: ['chhattisgarhi', 'chattisgarhi', 'छत्तीसगढ़ी'] },
        { key: 'chinese_traditional', patterns: ['traditional chinese', '繁體', '繁体', 'zh-tw', 'zh_tw', 'zh-hk', 'zh_hk'] },
        { key: 'chinese', patterns: ['chinese', '中文', '简体', 'simplified', 'zh-cn', 'zh_cn'] },
        { key: 'chuvash', patterns: ['chuvash', 'чуваш'] },
        { key: 'croatian', patterns: ['croatian', 'hrvatski'] },
        { key: 'czech', patterns: ['czech', 'čeština', 'cesky'] },
        { key: 'danish', patterns: ['danish', 'dansk'] },
        { key: 'dinka', patterns: ['dinka'] },
        { key: 'dutch', patterns: ['dutch', 'nederlands'] },
        { key: 'ewe', patterns: ['ewe'] },
        { key: 'esperanto', patterns: ['esperanto'] },
        { key: 'estonian', patterns: ['estonian', 'eesti'] },
        { key: 'finnish', patterns: ['finnish', 'suomi'] },
        { key: 'bavarian', patterns: ['bavarian', 'bairisch'] },
        { key: 'belarusian', patterns: ['belarusian', 'беларуск'] },
        { key: 'bemba', patterns: ['bemba'] },
        { key: 'berber', patterns: ['berber', 'amazigh', 'tamazight'] },
        { key: 'bhilali', patterns: ['bhilali'] },
        { key: 'bundeli', patterns: ['bundeli', 'बुंदेली', 'बुन्देली'] },
        { key: 'bodo', patterns: ['bodo'] },
        { key: 'coptic', patterns: ['coptic', 'copte'] },
        { key: 'dagbani', patterns: ['dagbani'] },
        { key: 'bosnian', patterns: ['bosnian', 'bosanski'] },
        { key: 'braj', patterns: ['braj'] },
        { key: 'bugis', patterns: ['bugis', 'buginese'] },
        { key: 'fon', patterns: ['fon'] },
        { key: 'fulfulde', patterns: ['fulfulde', 'fufulde', 'fulani'] },
        { key: 'gaelic', patterns: ['gaelic', 'gàidhlig', 'gaeilge'] },
        { key: 'galician', patterns: ['galician', 'galego'] },
        { key: 'garhwali', patterns: ['garhwali'] },
        { key: 'georgian', patterns: ['georgian', 'ქართული'] },
        { key: 'german', patterns: ['german', 'deutsch'] },
        { key: 'ghomala', patterns: ['ghomala'] },
        { key: 'greek', patterns: ['greek', 'ελλην'] },
        { key: 'guarani', patterns: ['guarani'] },
        { key: 'gujarati', patterns: ['gujarati', 'ગુજરાતી'] },
        { key: 'gussi', patterns: ['gussi'] },
        { key: 'hadiyya', patterns: ['hadiyya'] },
        { key: 'haitian', patterns: ['haitian', 'kreyol', 'créole', 'creole'] },
        { key: 'haryanvi', patterns: ['haryanvi', 'हरियाणवी'] },
        { key: 'hausa', patterns: ['hausa'] },
        { key: 'hebrew', patterns: ['hebrew', 'עברית'] },
        { key: 'ika', patterns: ['ika'] },
        { key: 'ilokano', patterns: ['ilokano', 'ilocano'] },
        { key: 'ilonggo', patterns: ['ilonggo', 'hiligaynon'] },
        { key: 'indonesian', patterns: ['indonesian', 'bahasa indonesia'] },
        { key: 'irish', patterns: ['irish', 'gaeilge'] },
        { key: 'italian', patterns: ['italian', 'italiano'] },
        { key: 'dogri', patterns: ['dogri', 'डोगरी'] },
        { key: 'dyula', patterns: ['dyula', 'jula'] },
        { key: 'edo', patterns: ['edo', 'bini'] },
        { key: 'hmong', patterns: ['hmong'] },
        { key: 'hungarian', patterns: ['hungarian', 'magyar'] },
        { key: 'iban', patterns: ['iban'] },
        { key: 'ibibio', patterns: ['ibibio'] },
        { key: 'icelandic', patterns: ['icelandic', 'íslenska'] },
        { key: 'igbo', patterns: ['igbo'] },
        { key: 'ika', patterns: ['ika'] },
        { key: 'ilokano', patterns: ['ilokano', 'ilocano'] },
        { key: 'ilonggo', patterns: ['ilonggo', 'hiligaynon'] },
        { key: 'indonesian', patterns: ['indonesian', 'bahasa indonesia'] },
        { key: 'irish', patterns: ['irish', 'gaeilge'] },
        { key: 'italian', patterns: ['italian', 'italiano'] },
        { key: 'iu_mien', patterns: ['iu mien', 'iumien', 'mien'] },
        { key: 'jamaican', patterns: ['jamaican'] },
        { key: 'japanese', patterns: ['japanese', '日本語', '日本'] },
        { key: 'javanese', patterns: ['javanese', 'jawa'] },
        { key: 'kabardian', patterns: ['kabardian'] },
        { key: 'kabyle', patterns: ['kabyle', 'taqbaylit'] },
        { key: 'kachin', patterns: ['kachin'] },
        { key: 'kalenjin', patterns: ['kalenjin'] },
        { key: 'kamba', patterns: ['kamba'] },
        { key: 'kangri', patterns: ['kangri'] },
        { key: 'kannada', patterns: ['kannada', 'ಕನ್ನಡ'] },
        { key: 'karakalpak', patterns: ['karakalpak'] },
        { key: 'kazakh', patterns: ['kazakh', 'қазақ'] },
        { key: 'kiche', patterns: ["k\\'iche", 'kiche'] },
        { key: 'kikuyu', patterns: ['kikuyu'] },
        { key: 'kikwango', patterns: ['kikwango'] },
        { key: 'kimbundu', patterns: ['kimbundu'] },
        { key: 'kimiiru', patterns: ['kimiiru'] },
        { key: 'kinyarwanda', patterns: ['kinyarwanda'] },
        { key: 'kirundi', patterns: ['kirundi'] },
        { key: 'kituba', patterns: ['kituba'] },
        { key: 'konkani', patterns: ['konkani', 'कोंकणी', 'ಕೋಂಕಣಿ'] },
        { key: 'korean', patterns: ['korean', '한국어', '조선어'] },
        { key: 'koya', patterns: ['koya'] },
        { key: 'krio', patterns: ['krio'] },
        { key: 'kumaoni', patterns: ['kumaoni'] },
        { key: 'kurdish', patterns: ['kurdish', 'kurdî'] },
        { key: 'kurukh', patterns: ['kurukh'] },
        { key: 'kyrgyz', patterns: ['kyrgyz', 'кыргыз'] },
        { key: 'khmer', patterns: ['khmer', 'ភាសាខ្មែរ'] },
        { key: 'lahu', patterns: ['lahu'] },
        { key: 'lambadi', patterns: ['lambadi'] },
        { key: 'lango', patterns: ['lango'] },
        { key: 'lao', patterns: ['lao', 'ລາວ'] },
        { key: 'latin', patterns: ['latin', 'latina', 'vulgate'] },
        { key: 'latvian', patterns: ['latvian', 'latviešu', 'latviesu'] },
        { key: 'liberian_kreyol', patterns: ['liberian kreyol', 'liberian', 'liberia'] },
        { key: 'lingala', patterns: ['lingala'] },
        { key: 'lithuanian', patterns: ['lithuanian', 'lietuvi', 'lietuvių', 'lietuviu'] },
        { key: 'lomwe', patterns: ['lomwe'] },
        { key: 'luganda', patterns: ['luganda'] },
        { key: 'lugbara', patterns: ['lugbara'] },
        { key: 'luguru', patterns: ['luguru'] },
        { key: 'luo', patterns: ['luo'] },
        { key: 'maasai', patterns: ['maasai'] },
        { key: 'macedonian', patterns: ['macedonian', 'македон'] },
        { key: 'madurese', patterns: ['madurese'] },
        { key: 'maithili', patterns: ['maithili'] },
        { key: 'makhuwa', patterns: ['makhuwa'] },
        { key: 'makonde', patterns: ['makonde'] },
        { key: 'malagasy', patterns: ['malagasy'] },
        { key: 'malayalam', patterns: ['malayalam', 'മലയാളം'] },
        { key: 'malaysian', patterns: ['malaysian', 'bahasa melayu', 'malay'] },
        { key: 'maori', patterns: ['maori', 'māori'] },
        { key: 'marathi', patterns: ['marathi', 'मराठी'] },
        { key: 'marwari', patterns: ['marwari', 'मारवाड़ी', 'मारवाड़ी'] },
        { key: 'marshallese', patterns: ['marshallese'] },
        { key: 'mauritian_creole', patterns: ['mauritian creole', 'mauritian', 'morisyen'] },
        { key: 'mazanderani', patterns: ['mazanderani', 'mazandarani', 'مازندرانی'] },
        { key: 'meitei', patterns: ['meitei', 'manipuri'] },
        { key: 'mende', patterns: ['mende'] },
        { key: 'meru', patterns: ['meru'] },
        { key: 'msl', patterns: ['msl'] },
        { key: 'minangkabau', patterns: ['minangkabau'] },
        { key: 'miskito', patterns: ['miskito'] },
        { key: 'mixtec', patterns: ['mixtec'] },
        { key: 'moore', patterns: ['moore', 'moré', 'more'] },
        { key: 'more', patterns: ['moré', 'more'] },
        { key: 'mortlockese', patterns: ['mortlockese'] },
        { key: 'motu', patterns: ['motu'] },
        { key: 'mundari', patterns: ['mundari'] },
        { key: 'mushunguli', patterns: ['mushunguli'] },
        { key: 'myanmar', patterns: ['myanmar'] },
        { key: 'nama', patterns: ['nama'] },
        { key: 'nauruan', patterns: ['nauruan', 'nauru'] },
        { key: 'ndau', patterns: ['ndau'] },
        { key: 'ndonga', patterns: ['ndonga'] },
        { key: 'nepali', patterns: ['nepali', 'नेपाली'] },
        { key: 'ngambay', patterns: ['ngambay'] },
        { key: 'nigerian_pidgin', patterns: ['nigerian pidgin', 'pidgin'] },
        { key: 'niuean', patterns: ['niuean'] },
        { key: 'northern_sotho', patterns: ['northern sotho', 'sepedi', 'sesotho sa lebowa'] },
        { key: 'norwegian', patterns: ['norwegian', 'norsk'] },
        { key: 'nyanja', patterns: ['nyanja'] },
        { key: 'nyankore', patterns: ['nyankore'] },
        { key: 'nyoro', patterns: ['nyoro'] },
        { key: 'occitan', patterns: ['occitan'] },
        { key: 'odia', patterns: ['odia', 'oriya', 'ଓଡିଆ'] },
        { key: 'oromo', patterns: ['oromo', 'afaan oromo'] },
        { key: 'ossetian', patterns: ['ossetian', 'ossetic'] },
        { key: 'pangasinan', patterns: ['pangasinan'] },
        { key: 'papiamento', patterns: ['papiamento'] },
        { key: 'pashto', patterns: ['pashto', 'پشتو'] },
        { key: 'pedi', patterns: ['pedi'] },
        { key: 'persian', patterns: ['persian', 'farsi', 'فارسی'] },
        { key: 'polish', patterns: ['polish', 'polski'] },
        { key: 'portuguese', patterns: ['portuguese', 'português', 'portugues'] },
        { key: 'punjabi', patterns: ['punjabi', 'ਪੰਜਾਬੀ'] },
        { key: 'quechua', patterns: ['quechua'] },
        { key: 'romanian', patterns: ['romanian', 'română', 'romana'] },
        { key: 'romansh', patterns: ['romansh', 'rumantsch'] },
        { key: 'romany', patterns: ['romany', 'roma'] },
        { key: 'russian', patterns: ['russian', 'русский'] },
        { key: 'samoan', patterns: ['samoan'] },
        { key: 'sango', patterns: ['sango'] },
        { key: 'sanskrit', patterns: ['sanskrit', 'संस्कृत'] },
        { key: 'santali', patterns: ['santali'] },
        { key: 'scots_gaelic', patterns: ['scots gaelic', 'gàidhlig', 'gaidhlig'] },
        { key: 'serbian', patterns: ['serbian', 'српски'] },
        { key: 'sesotho', patterns: ['sesotho', 'sotho'] },
        { key: 'shona', patterns: ['shona'] },
        { key: 'sindhi', patterns: ['sindhi', 'सिन्धी', 'سنڌي'] },
        { key: 'sinhala', patterns: ['sinhala', 'sinhalese', 'සිංහල'] },
        { key: 'slovak', patterns: ['slovak', 'slovenčina', 'slovencina'] },
        { key: 'slovenian', patterns: ['slovenian', 'slovenski'] },
        { key: 'somali', patterns: ['somali', 'somalia'] },
        { key: 'southern_sotho', patterns: ['southern sotho'] },
        { key: 'spanish', patterns: ['spanish', 'español', 'espanol'] },
        { key: 'sundanese', patterns: ['sundanese'] },
        { key: 'swahili', patterns: ['swahili', 'kiswahili'] },
        { key: 'swati', patterns: ['swati', 'siswati'] },
        { key: 'swedish', patterns: ['swedish', 'svenska'] },
        { key: 'tagalog', patterns: ['tagalog', 'filipino'] },
        { key: 'tahitian', patterns: ['tahitian'] },
        { key: 'tajik', patterns: ['tajik', 'тоҷик'] },
        { key: 'tamazight', patterns: ['tamazight', 'amazigh'] },
        { key: 'tamil', patterns: ['tamil', 'தமிழ்'] },
        { key: 'tatar', patterns: ['tatar'] },
        { key: 'telugu', patterns: ['telugu', 'తెలుగు'] },
        { key: 'tetum', patterns: ['tetum'] },
        { key: 'thai', patterns: ['thai', 'ไทย'] },
        { key: 'tibetan', patterns: ['tibetan', 'བོད་ཡིག'] },
        { key: 'tigrinya', patterns: ['tigrinya', 'ትግርኛ'] },
        { key: 'tiv', patterns: ['tiv'] },
        { key: 'tok_pisin', patterns: ['tok pisin'] },
        { key: 'tongan', patterns: ['tongan'] },
        { key: 'tsonga', patterns: ['tsonga'] },
        { key: 'tswana', patterns: ['tswana'] },
        { key: 'tumbuka', patterns: ['tumbuka'] },
        { key: 'turkish', patterns: ['turkish', 'türkçe', 'turkce'] },
        { key: 'turkmen', patterns: ['turkmen'] },
        { key: 'tuvaluan', patterns: ['tuvaluan'] },
        { key: 'twi', patterns: ['twi'] },
        { key: 'ukrainian', patterns: ['ukrainian', 'україн'] },
        { key: 'umbundu', patterns: ['umbundu'] },
        { key: 'urdu', patterns: ['urdu', 'اردو'] },
        { key: 'uzbek', patterns: ['uzbek', 'oʻzbek'] },
        { key: 'vietnamese', patterns: ['vietnamese', 'tiếng việt', 'tieng viet'] },
        { key: 'waray', patterns: ['waray'] },
        { key: 'welsh', patterns: ['welsh', 'cymraeg'] },
        { key: 'wolof', patterns: ['wolof'] },
        { key: 'xhosa', patterns: ['xhosa'] },
        { key: 'yiddish', patterns: ['yiddish', 'ייִדיש'] },
        { key: 'yoruba', patterns: ['yoruba'] },
        { key: 'zulu', patterns: ['zulu', 'isizulu'] },
        { key: 'fr', patterns: ['french', 'français', 'francais', 'fr '] },
        { key: 'hi', patterns: ['hindi', 'हिंदी', 'हिन्दी'] }
      ];
      for (const entry of langTests) {
        if (entry.patterns.some(p => hintRaw.includes(p))) return entry.key;
      }
      return null;
    }

    function parseBible(xml, verName) {
      const result = [];
      const detectedLang = detectBibleLanguage(xml, verName);
      const translationMap = detectedLang ? BIBLE_BOOK_TRANSLATIONS[detectedLang] : null;
      const getAttr = (node, keys) => {
        if (!node || typeof node.getAttribute !== 'function') return null;
        for (const k of keys) {
          const val = node.getAttribute(k);
          if (val) return val;
        }
        return null;
      };
      const books = [
        ...xml.querySelectorAll('book, b, bible>b, testament>book'),
        ...Array.from(xml.getElementsByTagName('BIBLEBOOK'))
      ];
      
      books.forEach(b => {
        const bNum = getAttr(b, ['number', 'n', 'bnumber']);
        const bNumKey = bNum ? String(parseInt(bNum, 10)) : null;
        let bName = (bNumKey && translationMap ? translationMap[bNumKey] : null) ||
                    getAttr(b, ['name', 'n', 'bname']) ||
                    (bNumKey ? BIBLE_BOOKS[bNumKey] : null) ||
                    "Unknown";
        
        const chapters = [
          ...b.querySelectorAll('chapter, c, book>chapter'),
          ...Array.from(b.getElementsByTagName('CHAPTER'))
        ];
        
        chapters.forEach(c => {
          const cNum = getAttr(c, ['number', 'n', 'cnumber']) || "1";
          let content = `[${bName} ${cNum}]\n`;
          
          const verses = [
            ...c.querySelectorAll('verse, v, chapter>verse'),
            ...Array.from(c.getElementsByTagName('VERS'))
          ];
          
          verses.forEach(v => {
            const vn = getAttr(v, ['number', 'n', 'vnumber']) || "1";
            content += `${vn} ${v.textContent.trim()}\n`;
          });
          
          result.push({
            title: `${bName} ${cNum}`,
            content,
            version: verName,
            book: bName,
            chapter: cNum
          });
        });
      });
      
      if (result.length === 0) {
        const allChapters = [
          ...xml.querySelectorAll('c'),
          ...Array.from(xml.getElementsByTagName('CHAPTER'))
        ];
        allChapters.forEach(c => {
          const parent = c.parentNode || {};
          const parentNum = getAttr(parent, ['number', 'n', 'bnumber']);
          const parentNumKey = parentNum ? String(parseInt(parentNum, 10)) : null;
          const bName = (parentNumKey && translationMap ? translationMap[parentNumKey] : null) ||
                        getAttr(parent, ['n', 'bname', 'name']) ||
                        (parentNumKey ? BIBLE_BOOKS[parentNumKey] : null) ||
                        "Unknown";
          const cNum = getAttr(c, ['n', 'cnumber', 'number']) || "1";
          let content = `[${bName} ${cNum}]\n`;
          
          const verses = [
            ...c.querySelectorAll('v'),
            ...Array.from(c.getElementsByTagName('VERS'))
          ];
          verses.forEach(v => {
            const vn = getAttr(v, ['n', 'vnumber', 'number']) || "1";
            content += `${vn} ${v.textContent.trim()}\n`;
          });
          
          result.push({
            title: `${bName} ${cNum}`,
            content,
            version: verName,
            book: bName,
            chapter: cNum
          });
        });
      }
      
      return result;
    }

    function handleSearch() {
      const qRaw = (document.getElementById('song-search').value || "");
      if (sidebarTab === 'bible' && qRaw.trim()) {
        resetBibleDropdowns();
      }
      const currentTab = sidebarTab;
      setSearchValueForTab(currentTab, qRaw);
      saveToStorageDebounced();
      clearTimeout(searchTimer);
      if (currentTab === 'bible' && parseBibleReferenceQuery(qRaw)) {
        handleSearchImmediate(qRaw, currentTab);
        return;
      }
      searchTimer = setTimeout(() => handleSearchImmediate(qRaw, currentTab), 120);
    }

    function handleSearchImmediate(qRaw, tabAtInput) {
      const targetTab = getSearchTabKey(tabAtInput || sidebarTab);
      if (sidebarTab !== targetTab) return;
      let q = normalizeSearchText(qRaw || "");
      // Normalize "Book chapter verse" to "Book chapter:verse" (space as colon)
      if (targetTab === 'bible' && !q.includes(':')) {
        const spaceVerseMatch = q.match(/^([\p{L}1-3 ]+\s+\d+)\s+(\d+(?:-\d+)?)$/u);
        if (spaceVerseMatch) q = spaceVerseMatch[1] + ':' + spaceVerseMatch[2];
      }
      if (targetTab === 'bible' && parseBibleReferenceQuery(q)) {
        renderBibleSearchResults(q);
        return;
      }
      renderSongs();
    }

    function escapeRegex(value) {
      return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function handleBibleSpaceToColon(e) {
      const isSpaceKey = (e.key === ' ' || e.key === 'Space' || e.key === 'Spacebar' || e.code === 'Space');
      if (!isSpaceKey || sidebarTab !== 'bible') return;
      const input = e.target;
      const cursorPos = input.selectionStart;
      const textBeforeCursor = input.value.substring(0, cursorPos);
      const textAfterCursor = input.value.substring(cursorPos);
      // Check if text before cursor matches: bookName chapterNumber (e.g. "Esther 8")
      const match = textBeforeCursor.match(/^([\p{L}1-3 ]+)\s+(\d+)$/u) ||
        textBeforeCursor.match(/^([\p{L}1-3 ]+?)(\d+)$/u);
      if (!match) return;
      // Only auto-convert when typing at the end or before whitespace.
      if (textAfterCursor && !/^\s*$/.test(textAfterCursor)) return;
      const bookCandidate = normalizeSearchText(match[1]).trim();
      const compactCandidate = bookCandidate.replace(/\s+/g, '');
      // Ignore very short prefixes to avoid false positives like "a 1".
      if (bookCandidate.length < 3) return;
      // Validate against loaded Bible books
      let isValidBook = false;
      if (activeBibleVersion && bibles[activeBibleVersion]) {
        isValidBook = bibles[activeBibleVersion].some(c => {
          const bookPart = normalizeSearchText(c.title.split(' ').slice(0, -1).join(' '));
          const compactBookPart = bookPart.replace(/\s+/g, '');
          return bookPart === bookCandidate ||
            (bookCandidate.length >= 3 && bookPart.startsWith(bookCandidate)) ||
            compactBookPart === compactCandidate ||
            (compactCandidate.length >= 3 && compactBookPart.startsWith(compactCandidate));
        });
      }
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
      if (!isValidBook) return;
      // Insert colon instead of space
      e.preventDefault();
      const after = input.value.substring(cursorPos);
      let displayBook = String(match[1] || '').trim().replace(/\s+/g, ' ');
      displayBook = displayBook.replace(/^([1-3])(?=\p{L})/u, '$1 ');
      const normalizedRefPrefix = `${displayBook} ${match[2]}`.trim();
      input.value = normalizedRefPrefix + ':' + after;
      input.selectionStart = input.selectionEnd = normalizedRefPrefix.length + 1;
      handleSearch();
    }

    function handleSearchEnter(e) {
      if (e.key !== 'Enter') return;
      const qRaw = (document.getElementById('song-search').value || "");
      let q = normalizeSearchText(qRaw).trim();
      if (sidebarTab !== 'bible') return;
      // Normalize "Book chapter verse" to "Book chapter:verse" (space as colon)
      if (!q.includes(':')) {
        const spaceVerseMatch = q.match(/^([\p{L}1-3 ]+\s+\d+)\s+(\d+(?:-\d+)?)$/u);
        if (spaceVerseMatch) q = spaceVerseMatch[1] + ':' + spaceVerseMatch[2];
      }
      if (!q.includes(':')) return;
      e.preventDefault();
      const parsed = parseBibleReferenceQuery(q);
      if (!parsed || !parsed.versePrefix) { handleSearch(); return; }
      const verseStart = parsed.versePrefix;
      const verseEnd = null;
      if (!activeBibleVersion && Object.keys(bibles).length > 0) {
        activeBibleVersion = Object.keys(bibles)[0];
        renderVersionBar();
      }
      if (!activeBibleVersion || !bibles[activeBibleVersion]) return;
      const chapterMatch = findBibleReferenceChapter(activeBibleVersion, parsed);
      if (!chapterMatch) return;
      const idx = chapterMatch.chapterIndex;
      selectItem(idx, { skipButtonView: true });
      setBibleGroupAnchor(verseStart, currentItem);
      const pages = getPagesFromItem(currentItem, true);
      const pageIdx = pages.findIndex(p => matchesVerseStart(p.raw, verseStart));
      if (pageIdx !== -1) {
        lineCursor = pageIdx;
        updateButtonView();
        projectLive(true);
      }
      const picked = bibles[activeBibleVersion][idx];
      const extracted = extractBookAndChapter(picked);
      addBibleRecentReference(buildBibleRefEntry(extracted.book, extracted.chap, verseStart, verseEnd, activeBibleVersion));
    }

    function getIsBibleItem(item) { return !!(item && item.version) }

    function getButtonContextList() {
      if (buttonContextTab === 'songs') return songs;
      if (buttonContextTab === 'schedule') return schedule;
      return (activeBibleVersion && bibles[activeBibleVersion]) ? (bibles[activeBibleVersion] || []) : [];
    }

    function selectItem(i, opts = {}) {
      const preserveLineCursor = !!opts.preserveLineCursor;
      const preserveButtonScroll = !!opts.preserveButtonScroll;
      const skipButtonView = !!opts.skipButtonView;
      let list = getButtonContextList();
      currentIndex = i; currentItem = list[i] || null;
      if (!currentItem) return;
      if (!getIsBibleItem(currentItem)) normalizeSongTranslationState(currentItem);
      document.getElementById('lyric-editor').value = currentItem.content || "";
      refreshSongTranslationPanel(currentItem);
      if (!preserveLineCursor) lineCursor = 0;
      const isBibleEntry = getIsBibleItem(currentItem);
      if (isBibleEntry) {
        bibleGroupAnchorKey = getBibleItemKey(currentItem);
        if (!preserveLineCursor) {
          bibleGroupAnchorVerse = null;
        }
      }
      if (sidebarTab === 'schedule' && isBibleEntry) {
        const scheduleLines = getScheduleLineHint(currentItem);
        if (scheduleLines != null && linesPerPage !== scheduleLines) {
          setLines(scheduleLines, { silent: true });
        }
      }
      renderSongs();
      if (!skipButtonView) {
        updateButtonView({ preserveScroll: preserveButtonScroll, skipAutoScroll: preserveButtonScroll });
      }
      enforceBibleModeRules();
      maybeTranslateCurrentSongOnOpen();
      if (!preserveButtonScroll && !skipButtonView) scrollButtonsToTop();
      saveToStorageDebounced();
    }

    function focusActiveSongInSidebar() {
      const list = document.getElementById('song-list');
      if (!list) return;
      const active = list.querySelector('.song-item.active');
      if (!active) return;
      active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
