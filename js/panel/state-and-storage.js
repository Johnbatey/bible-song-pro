
    // ===== DB =====
    function openDb() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_SONGS)) {
            db.createObjectStore(STORE_SONGS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_BIBLES)) {
            db.createObjectStore(STORE_BIBLES, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_STATE)) {
            db.createObjectStore(STORE_STATE, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }

    function idbGet(storeName, key) {
      return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      }));
    }

    function idbGetAll(storeName) {
      return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      }));
    }

    function idbPut(storeName, value) {
      if (storeName === STORE_SONGS) queueRelayStatePush({ includeSongs: true });
      if (storeName === STORE_BIBLES) queueRelayStatePush({ includeBibles: true });
      return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(value);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }));
    }

    function idbDelete(storeName, key) {
      return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }));
    }

    function dbGetAll(storeName) {
      return idbGetAll(storeName);
    }

    function dbPutMany(storeName, records) {
      const items = Array.isArray(records) ? records : [];
      if (!items.length) return Promise.resolve(true);
      if (storeName === STORE_SONGS) queueRelayStatePush({ includeSongs: true });
      if (storeName === STORE_BIBLES) queueRelayStatePush({ includeBibles: true });
      return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        items.forEach(item => store.put(item));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }));
    }

    function dbClearStore(storeName) {
      if (storeName === STORE_SONGS) queueRelayStatePush({ includeSongs: true });
      if (storeName === STORE_BIBLES) queueRelayStatePush({ includeBibles: true });
      return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }));
    }

    function dbSetAppState(nextState, opts = {}) {
      const updatedAt = opts.updatedAt || Date.now();
      appStateUpdatedAt = updatedAt;
      const payload = { key: 'appState', value: nextState, updatedAt };
      return idbPut(STORE_STATE, payload);
    }

    function persistLtStyles() {
      if (isRestoringBackup) return Promise.resolve(false);
      const json = safeStringify(ltStyles);
      const payload = { key: 'ltStyles', value: json, format: 'json', updatedAt: Date.now() };
      return idbPut(STORE_STATE, payload).catch(() => false);
    }

    function flushAppState() {
      if (isRestoringBackup) return Promise.resolve(false);
      syncAppStateFromUi();
      const updatedAt = isApplyingRemoteState ? (appStateUpdatedAt || Date.now()) : Date.now();
      appStateUpdatedAt = updatedAt;
      const payload = { key: 'appState', value: appState, updatedAt };
      return idbPut(STORE_STATE, payload).catch(() => false);
    }

    // ===== UTILITIES / SEARCH =====
    function normalizeSearchText(value) {
      return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g, '')
        .replace(/[\u2018\u2019]/g, "'")
        .toLowerCase()
        // Keep ":" for chapter:verse refs; normalize other separators/punctuation.
        .replace(/[^\p{L}\p{N}:]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function getItemSearchableText(item) {
      if (!item) return '';
      if (item.version) return normalizeSearchText(item.title || '');
      if (item.searchableText) return item.searchableText;
      const base = `${item.title || ''}\n${item.content || item.text || ''}`;
      return normalizeSearchText(base);
    }

    const bibleSearchCache = new Map();

    function clearBibleSearchCache(versionId) {
      if (versionId) bibleSearchCache.delete(versionId);
      else bibleSearchCache.clear();
    }

    function buildBibleSearchIndex(versionId) {
      const list = (versionId && bibles[versionId]) ? bibles[versionId] : [];
      const entries = [];
      list.forEach((item, chapterIndex) => {
        const extracted = extractBookAndChapter(item);
        const book = item?.book || extracted.book || '';
        const chap = item?.chapter || extracted.chap || '';
        const lines = String(item?.content || '').split('\n');
        lines.forEach((line) => {
          const match = line.match(/^(\d+)\s+(.+)/);
          if (!match) return;
          const verse = match[1];
          const text = match[2];
          const searchText = normalizeSearchText(`${book} ${chap}:${verse} ${text}`);
          entries.push({ chapterIndex, book, chapter: chap, verse, text, searchText });
        });
      });
      return { entries, size: list.length };
    }

    function getBibleSearchIndex(versionId) {
      const list = (versionId && bibles[versionId]) ? bibles[versionId] : [];
      const cached = bibleSearchCache.get(versionId);
      if (cached && cached.size === list.length) return cached.entries;
      const built = buildBibleSearchIndex(versionId);
      bibleSearchCache.set(versionId, built);
      return built.entries;
    }

    function parseBibleReferenceQuery(raw) {
      const q = normalizeSearchText(raw).trim();
      if (!q) return null;
      const match = q.match(/^([\p{L}1-3 ]+)\s+(\d+)(?::(\d*))?$/u);
      if (!match) return null;
      const [, bookRaw, chapterRaw, versePrefixRaw] = match;
      const book = normalizeSearchText(bookRaw).trim();
      const chapter = String(chapterRaw || '').trim();
      const versePrefix = String(versePrefixRaw || '');
      const hasColon = q.includes(':');
      return {
        raw,
        normalizedQuery: q,
        book,
        chapter,
        versePrefix,
        hasColon,
        isChapterQuery: !hasColon || !versePrefix,
        isVersePrefixQuery: hasColon && !!versePrefix
      };
    }

    function isBibleReferenceQuery(raw) {
      return !!parseBibleReferenceQuery(raw);
    }

    function findBibleReferenceChapter(versionId, query, opts = {}) {
      const parsed = (query && typeof query === 'object' && query.chapter)
        ? query
        : parseBibleReferenceQuery(query);
      if (!parsed) return null;
      const list = (versionId && bibles[versionId]) ? bibles[versionId] : [];
      if (!list.length) return null;
      const selectedBookKey = normalizeBookName(opts.book || '');
      const bookNeedle = normalizeBookName(parsed.book);
      const compactBookNeedle = bookNeedle.replace(/\s+/g, '');
      let chapterIndex = -1;
      let chapterItem = null;

      for (let index = 0; index < list.length; index += 1) {
        const item = list[index];
        const extracted = extractBookAndChapter(item);
        const itemBook = item?.book || extracted.book || '';
        const itemBookKey = normalizeBookName(itemBook);
        const itemCompactBookKey = itemBookKey.replace(/\s+/g, '');
        const itemChapter = String(item?.chapter || extracted.chap || '').trim();
        if (!itemBookKey || !itemChapter) continue;
        if (selectedBookKey && itemBookKey !== selectedBookKey) continue;
        if (itemChapter !== parsed.chapter) continue;
        const bookMatches =
          itemBookKey === bookNeedle ||
          itemBookKey.startsWith(bookNeedle) ||
          itemCompactBookKey === compactBookNeedle ||
          itemCompactBookKey.startsWith(compactBookNeedle);
        if (!bookMatches) continue;
        chapterIndex = index;
        chapterItem = item;
        break;
      }

      if (chapterIndex === -1 || !chapterItem) return null;
      return { chapterIndex, chapterItem, parsed };
    }

    function findBibleReferenceMatches(query, opts = {}) {
      const parsed = (query && typeof query === 'object' && query.chapter)
        ? query
        : parseBibleReferenceQuery(query);
      if (!parsed) return [];
      const versionId = opts.versionId || activeBibleVersion;
      if (!versionId || !bibles[versionId]) return [];
      const chapterMatch = findBibleReferenceChapter(versionId, parsed, opts);
      if (!chapterMatch) return [];
      const { chapterIndex, chapterItem } = chapterMatch;
      const results = [];
      String(chapterItem.content || '').split('\n').forEach((line) => {
        const match = String(line || '').match(/^(\d+)\s+(.+)/);
        if (!match) return;
        const verse = match[1];
        if (parsed.versePrefix && !verse.startsWith(parsed.versePrefix)) return;
        results.push({
          chapterIndex,
          book: chapterItem.book || extractBookAndChapter(chapterItem).book,
          chapter: parsed.chapter,
          verse,
          text: match[2]
        });
      });
      return results;
    }

    function findBibleKeywordMatches(query, opts = {}) {
      const q = normalizeSearchText(query).trim();
      if (!q || q.length < 2) return [];
      const tokens = q.split(/\s+/).filter(Boolean);
      if (!tokens.length) return [];
      const maxResults = opts.maxResults || 200;
      const versionId = opts.versionId || activeBibleVersion;
      if (!versionId || !bibles[versionId]) return [];
      const selectedBook = opts.book || '';
      const bookKey = normalizeBookName(selectedBook);
      const entries = getBibleSearchIndex(versionId);
      const results = [];
      for (const entry of entries) {
        if (bookKey && normalizeBookName(entry.book) !== bookKey) continue;
        if (!tokens.every(t => entry.searchText.includes(t))) continue;
        results.push(entry);
        if (results.length >= maxResults) break;
      }
      return results;
    }

    function slugify(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    function createId(prefix, value) {
      const base = slugify(value).slice(0, 32) || 'item';
      return `${prefix}_${base}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function buildSongRecord(song, { isNew = false } = {}) {
      const now = Date.now();
      const id = song.id || createId('song', song.title);
      const text = song.text || song.content || '';
      const searchableText = normalizeSearchText(`${song.title || ''}\n${text}`);
      const normalizedLines = text.split('\n');
      return {
        id,
        title: song.title || '',
        text,
        translatedLyrics: String(song.translatedLyrics || ''),
        translationLanguage: String(song.translationLanguage || ''),
        translationStatus: String(song.translationStatus || 'idle'),
        translationLocked: !!song.translationLocked,
        translatedAt: Number(song.translatedAt || 0),
        translationHash: String(song.translationHash || ''),
        bilingualEnabled: !!song.bilingualEnabled,
        normalizedLines,
        searchableText,
        createdAt: isNew ? now : (song.createdAt || now),
        updatedAt: now
      };
    }

    function hydrateSongFromRecord(record) {
      return normalizeSongTranslationState({
        id: record.id,
        title: record.title || '',
        content: record.text || '',
        text: record.text || '',
        translatedLyrics: String(record.translatedLyrics || ''),
        translationLanguage: String(record.translationLanguage || ''),
        translationStatus: String(record.translationStatus || 'idle'),
        translationLocked: !!record.translationLocked,
        translatedAt: Number(record.translatedAt || 0),
        translationHash: String(record.translationHash || ''),
        bilingualEnabled: !!record.bilingualEnabled,
        searchableText: record.searchableText || normalizeSearchText(`${record.title || ''}\n${record.text || ''}`),
        createdAt: record.createdAt || Date.now(),
        updatedAt: record.updatedAt || Date.now()
      });
    }

    function scheduleSongPersist(song) {
      if (!song) return;
      clearTimeout(songSaveTimer);
      songSaveTimer = setTimeout(() => {
        const record = buildSongRecord(song);
        song.id = record.id;
        song.searchableText = record.searchableText;
        song.createdAt = record.createdAt;
        song.updatedAt = record.updatedAt;
        idbPut(STORE_SONGS, record).catch(() => {});
      }, 400);
    }

    function buildBibleRecord(name, parsedData, { isNew = false, createdAt = null } = {}) {
      const now = Date.now();
      const id = name;
      const searchableText = normalizeSearchText(name);
      const createdAtValue = createdAt || (isNew ? now : now);
      return {
        id,
        name,
        parsedData: Array.isArray(parsedData) ? parsedData : [],
        searchableText,
        createdAt: createdAtValue,
        updatedAt: now
      };
    }

    function persistBibleVersion(name) {
      const data = bibles[name] || [];
      const record = buildBibleRecord(name, data);
      return idbPut(STORE_BIBLES, record);
    }

    function schedulePersistAppState() {
      if (!stateReady || isRestoringBackup) {
        pendingPersist = true;
        return;
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveToStorage();
      }, 500);
    }

    function getBackgroundSnapshot() {
      const bgTypeEl = document.getElementById('bg-type');
      if (!bgTypeEl) return null;
      const snapshot = {
        bgType: bgTypeEl.value,
        bgImageSource: document.getElementById('bg-image-source')?.value,
        bgImageUrl: document.getElementById('bg-image-url')?.value,
        bgUploadDataUrl,
        bgVideoSource: document.getElementById('bg-video-source')?.value,
        bgVideoUrl: document.getElementById('bg-video-url')?.value,
        bgVideoUploadDataUrl,
        bgVideoLoop: document.getElementById('bg-video-loop')?.checked,
        bgVideoSpeed: document.getElementById('bg-video-speed')?.value,
        bgMode,
        bgColor: document.getElementById('bg-color-quick')?.value,
        bgGradientShadow: document.getElementById('bg-color-shadow')?.value,
        bgGradientHighlight: document.getElementById('bg-color-highlight')?.value,
        bgBlur: document.getElementById('bg-blur')?.value,
        bgEdgeFix: document.getElementById('bg-edge-fix')?.value,
        bgOpacity: getActiveBgOpacityValue(),
        bgOpacityFull,
        bgOpacityLT,
        bgY: document.getElementById('bg-y')?.value,
        bgToggle: document.getElementById('bg-toggle')?.checked,
        animateBgTransitions: document.getElementById('animate-bg-transitions')?.checked,
        bgGradientAngle: document.getElementById('bg-gradient-angle')?.value || 135
      };
      return snapshot;
    }

    function applyBackgroundSnapshot(target, snapshot) {
      if (!target || !snapshot) return;
      BG_SETTINGS_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
          target[key] = snapshot[key];
        }
      });
    }

    function extractBackgroundSnapshot(settings) {
      if (!settings || typeof settings !== 'object') return null;
      const snapshot = {};
      BG_SETTINGS_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(settings, key)) {
          snapshot[key] = settings[key];
        }
      });
      return Object.keys(snapshot).length ? snapshot : null;
    }

    function getAnimationSnapshot() {
      const typeEl = document.getElementById('song-transition-type');
      if (!typeEl) return null;
      return {
        songTransitionType: typeEl.value,
        songTransitionDuration: document.getElementById('song-transition-duration')?.value,
        animateBgTransitions: document.getElementById('animate-bg-transitions')?.checked
      };
    }

    function applyAnimationSnapshot(target, snapshot) {
      if (!target || !snapshot) return;
      ANIMATION_SETTINGS_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
          target[key] = snapshot[key];
        }
      });
    }

    function extractAnimationSnapshot(settings) {
      if (!settings || typeof settings !== 'object') return null;
      const snapshot = {};
      ANIMATION_SETTINGS_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(settings, key)) {
          snapshot[key] = settings[key];
        }
      });
      return Object.keys(snapshot).length ? snapshot : null;
    }

    function persistAnimationState() {
      if (!stateReady || isRestoringBackup) {
        pendingAnimationPersist = true;
        return;
      }
      const snapshot = getAnimationSnapshot();
      if (!snapshot) return;
      const payload = { key: 'animationSettings', value: snapshot, updatedAt: Date.now() };
      idbPut(STORE_STATE, payload).catch(() => {});
    }

    function schedulePersistAnimation() {
      if (!stateReady || isRestoringBackup) {
        pendingAnimationPersist = true;
        return;
      }
      clearTimeout(animationSaveTimer);
      animationSaveTimer = setTimeout(() => {
        persistAnimationState();
      }, 500);
    }

    function getTypographySnapshot() {
      const familyEl = document.getElementById('font-family');
      if (!familyEl) return null;
      return {
        fontFamily: familyEl.value,
        fontWeight: document.getElementById('font-weight')?.value,
        fontSizeFull: document.getElementById('font-size-val')?.value,
        fullTextTransform,
        ltFontSongs,
        ltFontBible,
        ltFontCustom,
        refFontSize: document.getElementById('ref-font-size-val')?.value,
        lineHeightFull: document.getElementById('line-height-full')?.value,
        lineHeightLT: document.getElementById('line-height-lt')?.value,
        textColor: document.getElementById('text-color')?.value,
        refColor: document.getElementById('ref-color')?.value,
        refBgColor: document.getElementById('ref-bg-color')?.value,
        dualVersionModeEnabled,
        dualVersionSecondaryId
      };
    }

    function applyTypographySnapshot(target, snapshot) {
      if (!target || !snapshot) return;
      TYPOGRAPHY_SETTINGS_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
          target[key] = snapshot[key];
        }
      });
    }

    function extractTypographySnapshot(settings) {
      if (!settings || typeof settings !== 'object') return null;
      const snapshot = {};
      TYPOGRAPHY_SETTINGS_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(settings, key)) {
          snapshot[key] = settings[key];
        }
      });
      return Object.keys(snapshot).length ? snapshot : null;
    }

    function persistTypographyState() {
      if (!stateReady || isRestoringBackup) {
        pendingTypographyPersist = true;
        return;
      }
      const snapshot = getTypographySnapshot();
      if (!snapshot) return;
      const payload = { key: 'typographySettings', value: snapshot, updatedAt: Date.now() };
      idbPut(STORE_STATE, payload).catch(() => {});
    }

    function schedulePersistTypography() {
      if (!stateReady || isRestoringBackup) {
        pendingTypographyPersist = true;
        return;
      }
      clearTimeout(typographySaveTimer);
      typographySaveTimer = setTimeout(() => {
        persistTypographyState();
      }, 500);
    }

    function getModeSettingsSnapshot() {
      const fullSizeEl = document.getElementById('font-size-val');
      if (!fullSizeEl) return null;
      return {
        fontSizeFull: fullSizeEl.value,
        lineHeightFull: document.getElementById('line-height-full')?.value,
        fullTextTransform: document.getElementById('full-text-transform')?.value || fullTextTransform,
        autoResizeFull: document.getElementById('auto-resize-full')?.value,
        autoResizeLT: document.getElementById('auto-resize-lt')?.value,
        refPositionFull: document.getElementById('ref-position-full')?.value,
        hAlignFullRef: fullRefHAlign,
        hAlignFull: fullHAlign,
        vAlignFull: fullVAlign,
        ltFontSongs,
        ltFontBible,
        ltFontCustom,
        lineHeightLT: document.getElementById('line-height-lt')?.value,
        hAlignLTSongs: ltHAlignSongs,
        vAlignLTSongs: ltVAlignSongs,
        ltAnchorMode,
        hAlignLTBible: ltHAlignBible,
        vAlignLTBible: ltVAlignBible,
        hAlignLTBibleVerse: ltHAlignBibleVerse,
        autoAdjustLtHeight: document.getElementById('auto-adjust-lt-height')?.checked,
        refBgColor: document.getElementById('ref-bg-color')?.value,
        refBgEnabled: refBgEnabled,
        ltRefFontSize: document.getElementById('ref-font-size-lt-val')?.value,
        referenceShadowEnabled: referenceShadowEnabled,
        verseShadowEnabled: verseShadowEnabled,
        referenceTextCapitalized: document.getElementById('capitalize-ref-text')?.checked,
        showVersion: document.getElementById('show-version')?.checked,
        shortenBibleVersions: document.getElementById('shorten-bible-versions')?.checked,
        shortenBibleBooks: document.getElementById('shorten-bible-books')?.checked,
        showVerseNos: document.getElementById('show-verse-nos')?.checked,
        versionSwitchUpdatesLive: document.getElementById('version-switch-updates-live')?.checked,
        dualVersionModeEnabled: dualVersionModeEnabled,
        dualVersionSecondaryId: dualVersionSecondaryId
      };
    }

    function applyModeSettingsSnapshot(target, snapshot) {
      if (!target || !snapshot) return;
      MODE_SETTINGS_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
          target[key] = snapshot[key];
        }
      });
    }

    function extractModeSettingsSnapshot(settings) {
      if (!settings || typeof settings !== 'object') return null;
      const snapshot = {};
      MODE_SETTINGS_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(settings, key)) {
          snapshot[key] = settings[key];
        }
      });
      return Object.keys(snapshot).length ? snapshot : null;
    }

    const PROJECTION_SETTINGS_PROFILE_KEYS = Array.from(new Set([
      'fontFamily',
      'fontWeight',
      'fontSizeFull',
      'fullTextTransform',
      'ltFontSongs',
      'ltFontBible',
      'ltFontCustom',
      'refFontSize',
      'lineHeightFull',
      'lineHeightLT',
      'textColor',
      'refColor',
      'refBgColor',
      'bgType',
      'bgImageSource',
      'bgImageUrl',
      'bgUploadDataUrl',
      'bgVideoSource',
      'bgVideoUrl',
      'bgVideoUploadDataUrl',
      'bgVideoLoop',
      'bgVideoSpeed',
      'bgMode',
      'bgColor',
      'bgGradientShadow',
      'bgGradientHighlight',
      'bgBlur',
      'bgEdgeFix',
      'bgOpacity',
      'bgOpacityFull',
      'bgOpacityLT',
      'bgY',
      'bgToggle',
      'animateBgTransitions',
      'bgGradientAngle',
      'ltRefFontSize',
      'linesPerPage',
      'activeRatio',
      'ltTextTransform',
      'fullRefTextTransform',
      'ltRefTextTransform',
      'showVersion',
      'showVerseNos',
      'shortenBibleVersions',
      'shortenBibleBooks',
      'autoAdjustLtHeight',
      'autoResizeFull',
      'autoResizeLT',
      'refPositionFull',
      'ltWidthPct',
      'ltScalePct',
      'ltOffsetX',
      'ltOffsetY',
      'ltBorderRadius',
      'padLRFull',
      'padLRLT',
      'hAlignFullRef',
      'hAlignFull',
      'vAlignFull',
      'hAlignLTSongs',
      'vAlignLTSongs',
      'ltAnchorMode',
      'hAlignLTBible',
      'vAlignLTBible',
      'hAlignLTBibleVerse',
      'referenceShadowEnabled',
      'verseShadowEnabled',
      'referenceTextCapitalized',
      'refBgEnabled',
      'ltPresetSelection',
      'ltPresetUpdatesLive',
      'dualVersionModeEnabled',
      'dualVersionSecondaryId'
    ]));
    const SETTINGS_TARGET_TABS = ['bible', 'songs', 'schedule'];
    // Media is a settings target but not a projection-settings profile: it keeps its own
    // defaults (see media-workspace.js) and must not read or write typography profiles.
    const MEDIA_SETTINGS_TABS = new Set(['media', 'presets', 'themes', 'updates', 'feedback']);
    let mediaSettingsTargetActive = false;

    function normalizeSettingsTargetTab(value) {
      return (value === 'follow' || SETTINGS_TARGET_TABS.includes(value)) ? value : 'follow';
    }

    function getEffectiveSettingsTargetTab(target = settingsTargetTab) {
      const normalized = normalizeSettingsTargetTab(target);
      return normalized === 'follow' ? (sidebarTab || 'bible') : normalized;
    }

    function captureProjectionSettingsSnapshot() {
      return {
        ...(getTypographySnapshot() || {}),
        ...(getBackgroundSnapshot() || {}),
        fontSizeFull: document.getElementById('font-size-val')?.value,
        ltFontSongs, ltFontBible, ltFontCustom,
        refFontSize: document.getElementById('ref-font-size-val')?.value,
        ltRefFontSize: document.getElementById('ref-font-size-lt-val')?.value,
        lineHeightFull: document.getElementById('line-height-full')?.value,
        lineHeightLT: document.getElementById('line-height-lt')?.value,
        textColor: document.getElementById('text-color')?.value,
        refColor: document.getElementById('ref-color')?.value,
        refBgColor: document.getElementById('ref-bg-color')?.value,
        linesPerPage, activeRatio,
        fullTextTransform: document.getElementById('full-text-transform')?.value || fullTextTransform,
        ltTextTransform: document.getElementById('lt-text-transform')?.value || ltTextTransform || 'uppercase',
        fullRefTextTransform: document.getElementById('full-ref-text-transform')?.value || fullRefTextTransform || 'uppercase',
        ltRefTextTransform: document.getElementById('lt-ref-text-transform')?.value || ltRefTextTransform || 'uppercase',
        showVersion: document.getElementById('show-version')?.checked,
        showVerseNos: document.getElementById('show-verse-nos')?.checked,
        shortenBibleVersions: document.getElementById('shorten-bible-versions')?.checked,
        shortenBibleBooks: document.getElementById('shorten-bible-books')?.checked,
        autoAdjustLtHeight: document.getElementById('auto-adjust-lt-height')?.checked,
        autoResizeFull: document.getElementById('auto-resize-full')?.value,
        autoResizeLT: document.getElementById('auto-resize-lt')?.value,
        refPositionFull: document.getElementById('ref-position-full')?.value,
        ltPresetSelection: document.getElementById('lt-preset-select')?.value || 'default',
        ltPresetUpdatesLive: document.getElementById('lt-preset-update-live')?.value !== 'false',
        ltWidthPct: document.getElementById('lt-width-pct')?.value,
        ltScalePct: document.getElementById('lt-scale-pct')?.value,
        ltOffsetX: document.getElementById('lt-offset-x')?.value,
        ltOffsetY: document.getElementById('lt-offset-y')?.value,
        ltBorderRadius: document.getElementById('lt-border-radius')?.value,
        padLRFull: document.getElementById('pad-lr-full')?.value ?? 5,
        padLRLT: document.getElementById('pad-lr-lt')?.value ?? 5,
        hAlignFullRef: fullRefHAlign, hAlignFull: fullHAlign, vAlignFull: fullVAlign,
        hAlignLTSongs: ltHAlignSongs, vAlignLTSongs: ltVAlignSongs, ltAnchorMode,
        hAlignLTBible: ltHAlignBible, vAlignLTBible: ltVAlignBible, hAlignLTBibleVerse: ltHAlignBibleVerse,
        referenceShadowEnabled, verseShadowEnabled,
        referenceTextCapitalized: document.getElementById('capitalize-ref-text')?.checked,
        refBgEnabled, dualVersionModeEnabled, dualVersionSecondaryId
      };
    }

    function normalizeProjectionSettingsSnapshot(raw, fallback = {}) {
      const next = { ...fallback };
      const source = (raw && typeof raw === 'object') ? raw : {};
      PROJECTION_SETTINGS_PROFILE_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(source, key) && source[key] != null) next[key] = source[key];
      });
      return next;
    }

    function createDefaultProjectionSettingsProfiles(seed = null) {
      const base = normalizeProjectionSettingsSnapshot(seed || captureProjectionSettingsSnapshot(), {});
      return {
        bible: {
          ...base,
          ltPresetSelection: 'rounded-card',
          autoResizeLT: 'shrink',
          lineHeightLT: 1.1,
          padLRLT: 5,
          ltWidthPct: 100,
          ltScalePct: 80,
          ltOffsetX: 0,
          ltOffsetY: 25,
          ltBorderRadius: 23,
          autoAdjustLtHeight: true,
          hAlignLTBible: 'center',
          vAlignLTBible: 'middle',
          hAlignLTBibleVerse: 'center',
          ltAnchorMode: 'bottom',
          bgOpacityFull: 100,
          bgOpacityLT: 100
        },
        songs: {
          ...base,
          ltWidthPct: 60,
          ltOffsetX: 0,
          ltOffsetY: 50,
          bgOpacityFull: 100,
          bgOpacityLT: 100
        },
        schedule: { ...base }
      };
    }

    function ensureProjectionSettingsProfiles(seed = null) {
      if (!projectionSettingsProfilesByTab || typeof projectionSettingsProfilesByTab !== 'object') {
        projectionSettingsProfilesByTab = createDefaultProjectionSettingsProfiles(seed);
      }
      const defaults = createDefaultProjectionSettingsProfiles(seed);
      SETTINGS_TARGET_TABS.forEach((tab) => {
        projectionSettingsProfilesByTab[tab] = normalizeProjectionSettingsSnapshot(projectionSettingsProfilesByTab[tab], defaults[tab]);
      });
      return projectionSettingsProfilesByTab;
    }

    function loadProjectionSettingsProfilesFromUi(ui) {
      const seed = normalizeProjectionSettingsSnapshot(ui || {}, captureProjectionSettingsSnapshot());
      projectionSettingsProfilesByTab = createDefaultProjectionSettingsProfiles(seed);
      const source = (ui && ui.projectionSettingsProfiles && typeof ui.projectionSettingsProfiles === 'object') ? ui.projectionSettingsProfiles : {};
      SETTINGS_TARGET_TABS.forEach((tab) => {
        projectionSettingsProfilesByTab[tab] = normalizeProjectionSettingsSnapshot(source[tab], projectionSettingsProfilesByTab[tab]);
      });
      settingsTargetTab = normalizeSettingsTargetTab(ui?.settingsTargetTab);
      return projectionSettingsProfilesByTab;
    }

    function saveProjectionSettingsProfileForTab(tab = getEffectiveSettingsTargetTab()) {
      if (!SETTINGS_TARGET_TABS.includes(tab)) return null;
      const profiles = ensureProjectionSettingsProfiles();
      profiles[tab] = normalizeProjectionSettingsSnapshot(captureProjectionSettingsSnapshot(), profiles[tab]);
      return profiles[tab];
    }

    function getProjectionSettingsSnapshotForTab(tab = getEffectiveSettingsTargetTab()) {
      if (!SETTINGS_TARGET_TABS.includes(tab)) return normalizeProjectionSettingsSnapshot(captureProjectionSettingsSnapshot(), {});
      const profiles = ensureProjectionSettingsProfiles();
      return normalizeProjectionSettingsSnapshot(profiles[tab], captureProjectionSettingsSnapshot());
    }

    function applyProjectionRuntimeSnapshot(profile) {
      const next = normalizeProjectionSettingsSnapshot(profile, captureProjectionSettingsSnapshot());
      if (typeof next.fullTextTransform !== 'undefined') fullTextTransform = next.fullTextTransform;
      if (typeof next.ltTextTransform !== 'undefined') ltTextTransform = next.ltTextTransform;
      if (typeof next.fullRefTextTransform !== 'undefined') fullRefTextTransform = next.fullRefTextTransform;
      if (typeof next.ltRefTextTransform !== 'undefined') ltRefTextTransform = next.ltRefTextTransform;
      if (next.ltFontSongs != null) ltFontSongs = Number(next.ltFontSongs);
      if (next.ltFontBible != null) ltFontBible = Number(next.ltFontBible);
      if (next.ltFontCustom != null) ltFontCustom = Number(next.ltFontCustom);
      if (next.ltRefFontSize != null) ltRefFontSize = Number(next.ltRefFontSize);
      if (next.linesPerPage != null) linesPerPage = Math.max(1, Math.min(getMaxLinesForCurrentTab(sidebarTab), Number(next.linesPerPage) || 1));
      if (next.activeRatio) activeRatio = next.activeRatio === '16-9' ? '16-9' : 'full';
      if (next.autoAdjustLtHeight != null) autoAdjustLtHeight = !!next.autoAdjustLtHeight;
      fullRefHAlign = next.hAlignFullRef || fullRefHAlign;
      fullHAlign = next.hAlignFull || fullHAlign;
      fullVAlign = next.vAlignFull || fullVAlign;
      ltHAlignSongs = next.hAlignLTSongs || ltHAlignSongs;
      ltVAlignSongs = next.vAlignLTSongs || ltVAlignSongs;
      ltAnchorMode = next.ltAnchorMode === 'top' ? 'top' : 'bottom';
      ltHAlignBible = next.hAlignLTBible || ltHAlignBible;
      ltVAlignBible = next.vAlignLTBible || ltVAlignBible;
      ltHAlignBibleVerse = next.hAlignLTBibleVerse || ltHAlignBibleVerse;
      if (next.refBgEnabled != null) refBgEnabled = !!next.refBgEnabled;
      if (next.referenceShadowEnabled != null) referenceShadowEnabled = !!next.referenceShadowEnabled;
      if (next.verseShadowEnabled != null) verseShadowEnabled = !!next.verseShadowEnabled;
      if (next.referenceTextCapitalized != null) referenceTextCapitalized = !!next.referenceTextCapitalized;
      if (next.dualVersionModeEnabled != null) dualVersionModeEnabled = !!next.dualVersionModeEnabled;
      if (Object.prototype.hasOwnProperty.call(next, 'dualVersionSecondaryId')) dualVersionSecondaryId = next.dualVersionSecondaryId || null;
    }

    function updateSettingsTargetControl() {
      const value = normalizeSettingsTargetTab(settingsTargetTab);
        const activeKey = mediaSettingsTargetActive
          ? 'media'
          : (value === 'follow' ? getEffectiveSettingsTargetTab(value) : value);
        ['follow', 'bible', 'songs', 'schedule', 'media'].forEach((key) => {
        const btn = document.getElementById(`settings-target-${key}`);
          if (btn) btn.classList.toggle('active', key === activeKey);
      });
      if (typeof refreshSettingsTabVisibility === 'function') {
        refreshSettingsTabVisibility(getEffectiveSettingsTargetTab());
      }
    }

    function refreshMediaSettingsTabVisibility() {
      document.querySelectorAll('.sm-sidebar-item[data-sm-tab]').forEach((item) => {
        const tabId = item.dataset.smTab;
        item.style.display = MEDIA_SETTINGS_TABS.has(tabId) ? '' : 'none';
      });
      const activeTabId = document.querySelector('.sm-sidebar-item.active[data-sm-tab]')?.dataset?.smTab;
      switchSettingsTab(MEDIA_SETTINGS_TABS.has(activeTabId) ? activeTabId : 'media');
      if (window.bspMedia && typeof window.bspMedia.syncSettingsForm === 'function') {
        window.bspMedia.syncSettingsForm();
      }
    }

    function refreshSettingsTabVisibility(targetTab = getEffectiveSettingsTargetTab()) {
      if (mediaSettingsTargetActive) {
        refreshMediaSettingsTabVisibility();
        return;
      }
      const effectiveTarget = SETTINGS_TARGET_TABS.includes(targetTab) ? targetTab : 'bible';
      const tabSpecificMap = {
        song: 'songs',
        bible: 'bible',
        setlist: 'schedule'
      };
      const setlistHiddenTabs = new Set(['fullscreen', 'lowerthird', 'typography', 'background']);
      document.querySelectorAll('.sm-sidebar-item[data-sm-tab]').forEach((item) => {
        const tabId = item.dataset.smTab;
        if (tabId === 'media') {
          item.style.display = 'none';
          return;
        }
        if (effectiveTarget === 'schedule' && setlistHiddenTabs.has(tabId)) {
          item.style.display = 'none';
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(tabSpecificMap, tabId)) {
          if (tabId !== 'customstyle') item.style.display = '';
          return;
        }
        item.style.display = (tabSpecificMap[tabId] === effectiveTarget) ? '' : 'none';
      });
      const activeSidebarItem = document.querySelector('.sm-sidebar-item.active[data-sm-tab]');
      const activeTabId = activeSidebarItem?.dataset?.smTab || document.querySelector('.sm-tab-panel.active')?.dataset?.smPanel || 'fullscreen';
      const visibleSidebarItems = Array.from(document.querySelectorAll('.sm-sidebar-item[data-sm-tab]'))
        .filter((item) => item.style.display !== 'none');
      const nextTabId = visibleSidebarItems.some((item) => item.dataset.smTab === activeTabId)
        ? activeTabId
        : (visibleSidebarItems[0]?.dataset?.smTab || 'fullscreen');
      const isBibleTarget = effectiveTarget === 'bible';
      const isSongsTarget = effectiveTarget === 'songs';
      const setDisplay = (id, show) => {
        const el = document.getElementById(id);
        if (el) el.style.display = show ? '' : 'none';
      };
      const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      setDisplay('full-ref-font-field', isBibleTarget);
      setDisplay('full-ref-align-field', isBibleTarget);
      setDisplay('full-ref-position-field', isBibleTarget);
      setDisplay('lt-ref-font-field', isBibleTarget);
      setDisplay('lt-bible-verse-align-row', isBibleTarget);
      setDisplay('ref-color-field', !isSongsTarget);
      setDisplay('ref-shadow-field', !isSongsTarget);
      setDisplay('ref-bg-toggle-row', !isSongsTarget);
      setDisplay('ref-bg-color-row', !isSongsTarget);
      setDisplay('full-song-transform-field', isSongsTarget);
      setDisplay('lt-song-transform-field', isSongsTarget);
      setDisplay('full-ref-transform-field', isBibleTarget);
      setDisplay('lt-ref-transform-field', isBibleTarget);
      setText('full-content-font-label', isBibleTarget ? 'Verse Font Size (pt)' : (isSongsTarget ? 'Song Font Size (pt)' : 'Font Size (pt)'));
      setText('lt-content-font-label', isBibleTarget ? 'Verse Font Size (pt)' : (isSongsTarget ? 'Song Font Size (pt)' : 'Font Size (pt)'));
      setText('lt-primary-align-label', isBibleTarget ? 'Ref. X Align' : (isSongsTarget ? 'Text X Align' : 'X Align'));
      setText('full-content-align-label', isBibleTarget ? 'Verse X Align' : 'Text X Align');
      setText('verse-shadow-label', isBibleTarget ? 'Verse Shadow' : (isSongsTarget ? 'Song Shadow' : 'Verse/Song Shadow'));
      if (nextTabId) switchSettingsTab(nextTabId);
    }

    function applyProjectionSettingsSnapshot(profile, opts = {}) {
      const targetTab = SETTINGS_TARGET_TABS.includes(opts.tab) ? opts.tab : sidebarTab;
      const next = normalizeProjectionSettingsSnapshot(profile, captureProjectionSettingsSnapshot());
      if (next.fontFamily) {
        const fontFamilyEl = document.getElementById('font-family');
        if (fontFamilyEl) fontFamilyEl.value = next.fontFamily;
        if (typeof renderFontFamilyOptions === 'function') renderFontFamilyOptions(next.fontFamily);
      }
      if (next.fontWeight && document.getElementById('font-weight')) document.getElementById('font-weight').value = next.fontWeight;
      if (next.fontSizeFull != null && document.getElementById('font-size-val')) document.getElementById('font-size-val').value = next.fontSizeFull;
      if (typeof next.fullTextTransform !== 'undefined') updateFullTextTransformValue(next.fullTextTransform);
      if (typeof next.fullRefTextTransform !== 'undefined') updateReferenceTextTransformValue('full', next.fullRefTextTransform);
      ltFontSongs = (next.ltFontSongs != null) ? Number(next.ltFontSongs) : ltFontSongs;
      ltFontBible = (next.ltFontBible != null) ? Number(next.ltFontBible) : ltFontBible;
      ltFontCustom = (next.ltFontCustom != null) ? Number(next.ltFontCustom) : ltFontCustom;
      if (next.refFontSize != null && document.getElementById('ref-font-size-val')) document.getElementById('ref-font-size-val').value = next.refFontSize;
      if (next.ltRefFontSize != null && document.getElementById('ref-font-size-lt-val')) document.getElementById('ref-font-size-lt-val').value = next.ltRefFontSize;
      ltRefFontSize = Number(next.ltRefFontSize || ltRefFontSize);
      if (next.lineHeightFull != null && document.getElementById('line-height-full')) document.getElementById('line-height-full').value = next.lineHeightFull;
      if (next.lineHeightLT != null && document.getElementById('line-height-lt')) document.getElementById('line-height-lt').value = next.lineHeightLT;
      if (next.padLRFull != null && document.getElementById('pad-lr-full')) {
        document.getElementById('pad-lr-full').value = next.padLRFull;
      } else if (next.padLR != null && document.getElementById('pad-lr-full')) {
        document.getElementById('pad-lr-full').value = next.padLR;
      }
      if (next.padLRLT != null && document.getElementById('pad-lr-lt')) {
        document.getElementById('pad-lr-lt').value = next.padLRLT;
      } else if (next.padLR != null && document.getElementById('pad-lr-lt')) {
        document.getElementById('pad-lr-lt').value = next.padLR;
      }
      if (next.textColor && document.getElementById('text-color')) document.getElementById('text-color').value = next.textColor;
      if (next.textColor && document.getElementById('text-color-hex')) document.getElementById('text-color-hex').value = String(next.textColor).toUpperCase();
      if (next.refColor && document.getElementById('ref-color')) document.getElementById('ref-color').value = next.refColor;
      if (next.refColor && document.getElementById('ref-color-hex')) document.getElementById('ref-color-hex').value = String(next.refColor).toUpperCase();
      if (next.refBgColor && document.getElementById('ref-bg-color')) document.getElementById('ref-bg-color').value = next.refBgColor;
      if (next.refBgColor && document.getElementById('ref-bg-color-hex')) document.getElementById('ref-bg-color-hex').value = String(next.refBgColor).toUpperCase();
      if (next.linesPerPage != null) linesPerPage = Math.max(1, Math.min(getMaxLinesForCurrentTab(targetTab), Number(next.linesPerPage) || 1));
      if (next.activeRatio) activeRatio = next.activeRatio === '16-9' ? '16-9' : 'full';
      if (typeof next.ltTextTransform !== 'undefined') updateLtTextTransformValue(next.ltTextTransform, { markUser: true });
      if (typeof next.ltRefTextTransform !== 'undefined') updateReferenceTextTransformValue('lt', next.ltRefTextTransform);
      if (next.showVersion != null && document.getElementById('show-version')) document.getElementById('show-version').checked = !!next.showVersion;
      if (next.showVerseNos != null && document.getElementById('show-verse-nos')) document.getElementById('show-verse-nos').checked = !!next.showVerseNos;
      if (next.shortenBibleVersions != null && document.getElementById('shorten-bible-versions')) document.getElementById('shorten-bible-versions').checked = !!next.shortenBibleVersions;
      if (next.shortenBibleBooks != null && document.getElementById('shorten-bible-books')) document.getElementById('shorten-bible-books').checked = !!next.shortenBibleBooks;
      autoAdjustLtHeight = next.autoAdjustLtHeight != null ? !!next.autoAdjustLtHeight : autoAdjustLtHeight;
      if (document.getElementById('auto-adjust-lt-height')) document.getElementById('auto-adjust-lt-height').checked = autoAdjustLtHeight;
      if (next.autoResizeFull && document.getElementById('auto-resize-full')) document.getElementById('auto-resize-full').value = next.autoResizeFull;
      if (next.autoResizeLT && document.getElementById('auto-resize-lt')) document.getElementById('auto-resize-lt').value = next.autoResizeLT;
      if (next.refPositionFull && document.getElementById('ref-position-full')) document.getElementById('ref-position-full').value = next.refPositionFull;
      if (typeof renderLtPresetOptions === 'function') renderLtPresetOptions(next.ltPresetSelection || 'default', targetTab);
      if (typeof updateLtPresetUpdateLiveState === 'function') {
        updateLtPresetUpdateLiveState(next.ltPresetUpdatesLive !== false);
      }
      if (next.ltWidthPct != null && document.getElementById('lt-width-pct')) document.getElementById('lt-width-pct').value = next.ltWidthPct;
      if (next.ltWidthPct != null && document.getElementById('lt-width-pct-value')) document.getElementById('lt-width-pct-value').textContent = `${next.ltWidthPct}%`;
      if (next.ltScalePct != null && document.getElementById('lt-scale-pct')) document.getElementById('lt-scale-pct').value = next.ltScalePct;
      if (next.ltScalePct != null && document.getElementById('lt-scale-pct-value')) document.getElementById('lt-scale-pct-value').textContent = `${next.ltScalePct}%`;
      if (next.ltOffsetX != null && document.getElementById('lt-offset-x')) document.getElementById('lt-offset-x').value = next.ltOffsetX;
      if (next.ltOffsetY != null && document.getElementById('lt-offset-y')) document.getElementById('lt-offset-y').value = next.ltOffsetY;
      if (next.ltBorderRadius != null && document.getElementById('lt-border-radius')) document.getElementById('lt-border-radius').value = next.ltBorderRadius;
      if (next.ltBorderRadius != null && document.getElementById('lt-border-radius-value')) document.getElementById('lt-border-radius-value').textContent = `${next.ltBorderRadius}px`;
      if (next.bgType && document.getElementById('bg-type')) document.getElementById('bg-type').value = next.bgType;
      if (next.bgImageSource && document.getElementById('bg-image-source')) document.getElementById('bg-image-source').value = next.bgImageSource;
      if (Object.prototype.hasOwnProperty.call(next, 'bgImageUrl') && document.getElementById('bg-image-url')) document.getElementById('bg-image-url').value = next.bgImageUrl || '';
      if (Object.prototype.hasOwnProperty.call(next, 'bgUploadDataUrl')) bgUploadDataUrl = next.bgUploadDataUrl || null;
      if (next.bgVideoSource && document.getElementById('bg-video-source')) document.getElementById('bg-video-source').value = next.bgVideoSource;
      if (Object.prototype.hasOwnProperty.call(next, 'bgVideoUrl') && document.getElementById('bg-video-url')) document.getElementById('bg-video-url').value = next.bgVideoUrl || '';
      if (Object.prototype.hasOwnProperty.call(next, 'bgVideoUploadDataUrl')) bgVideoUploadDataUrl = next.bgVideoUploadDataUrl || null;
      if (next.bgVideoLoop != null && document.getElementById('bg-video-loop')) document.getElementById('bg-video-loop').checked = !!next.bgVideoLoop;
      if (next.bgVideoSpeed != null && document.getElementById('bg-video-speed')) document.getElementById('bg-video-speed').value = next.bgVideoSpeed;
      if (next.bgColor && document.getElementById('bg-color-quick')) document.getElementById('bg-color-quick').value = next.bgColor;
      if (next.bgGradientShadow && document.getElementById('bg-color-shadow')) {
        bgGradientShadow = next.bgGradientShadow;
        document.getElementById('bg-color-shadow').value = next.bgGradientShadow;
      }
      if (next.bgGradientHighlight && document.getElementById('bg-color-highlight')) {
        bgGradientHighlight = next.bgGradientHighlight;
        document.getElementById('bg-color-highlight').value = next.bgGradientHighlight;
      }
      if (typeof next.bgMode !== 'undefined' && typeof setBgMode === 'function') {
        setBgMode(next.bgMode, { silent: true });
      } else if (typeof updateBgModeUi === 'function') {
        updateBgModeUi();
      }
      if (next.bgBlur != null && document.getElementById('bg-blur')) document.getElementById('bg-blur').value = next.bgBlur;
      if (next.bgEdgeFix != null && document.getElementById('bg-edge-fix')) document.getElementById('bg-edge-fix').value = next.bgEdgeFix ? 'on' : 'off';
      if (next.bgOpacityFull != null) bgOpacityFull = Math.max(0, Math.min(100, Number(next.bgOpacityFull) || 0));
      if (next.bgOpacityLT != null) bgOpacityLT = Math.max(0, Math.min(100, Number(next.bgOpacityLT) || 0));
      if (next.bgY != null && document.getElementById('bg-y')) document.getElementById('bg-y').value = next.bgY;
      if (next.bgToggle != null && document.getElementById('bg-toggle')) document.getElementById('bg-toggle').checked = !!next.bgToggle;
      if (next.animateBgTransitions != null && document.getElementById('animate-bg-transitions')) document.getElementById('animate-bg-transitions').checked = !!next.animateBgTransitions;
      if (next.bgGradientAngle != null && document.getElementById('bg-gradient-angle')) document.getElementById('bg-gradient-angle').value = next.bgGradientAngle;
      if (document.getElementById('bg-upload-hint')) {
        document.getElementById('bg-upload-hint').innerText = bgUploadDataUrl ? t('settings_image_selected') : t('settings_no_image_selected');
      }
      if (document.getElementById('bg-video-upload-hint')) {
        document.getElementById('bg-video-upload-hint').innerText = bgVideoUploadDataUrl ? t('settings_video_selected') : t('settings_no_video_selected');
      }
      if (typeof handleBgTypeChange === 'function') handleBgTypeChange();
      if (typeof syncBgOpacitySlider === 'function') syncBgOpacitySlider();
      fullRefHAlign = next.hAlignFullRef || fullRefHAlign;
      fullHAlign = next.hAlignFull || fullHAlign;
      fullVAlign = next.vAlignFull || fullVAlign;
      ltHAlignSongs = next.hAlignLTSongs || ltHAlignSongs;
      ltVAlignSongs = next.vAlignLTSongs || ltVAlignSongs;
      ltAnchorMode = next.ltAnchorMode === 'top' ? 'top' : 'bottom';
      ltHAlignBible = next.hAlignLTBible || ltHAlignBible;
      ltVAlignBible = next.vAlignLTBible || ltVAlignBible;
      ltHAlignBibleVerse = next.hAlignLTBibleVerse || ltHAlignBibleVerse;
      if (next.refBgEnabled != null) setRefBgEnabled(!!next.refBgEnabled, { silent: true });
      if (next.referenceShadowEnabled != null) setReferenceShadowEnabled(!!next.referenceShadowEnabled, { silent: true });
      if (next.verseShadowEnabled != null) setVerseShadowEnabled(!!next.verseShadowEnabled, { silent: true });
      if (next.referenceTextCapitalized != null) setReferenceCapitalized(!!next.referenceTextCapitalized, { silent: true });
      if (next.dualVersionModeEnabled != null) setDualVersionModeEnabled(!!next.dualVersionModeEnabled, { silent: true });
      if (Object.prototype.hasOwnProperty.call(next, 'dualVersionSecondaryId')) setDualVersionSecondaryId(next.dualVersionSecondaryId || null, { silent: true });
      setLtFontInputValue(getEffectiveLtFont());
      updateFullAlignButtons();
      updateLtAlignButtons();
      if (typeof refreshSliderPaint === 'function') {
        refreshSliderPaint([
          'line-height-full',
          'line-height-lt',
          'pad-lr-full',
          'pad-lr-lt',
          'lt-width-pct',
          'lt-scale-pct',
          'lt-border-radius',
          'bg-blur',
          'bg-opacity-full',
          'bg-opacity-lt',
          'bg-y',
          'bg-gradient-angle',
          'bg-video-speed'
        ]);
      }
      if (typeof syncLtPresetSelectionToCurrentValues === 'function') {
        syncLtPresetSelectionToCurrentValues(targetTab);
      }
      document.querySelectorAll('#line-picker .seg-btn').forEach((b) => b.classList.toggle('active', b.id === 'line-' + linesPerPage));
      document.getElementById('ratio-full')?.classList.toggle('active', activeRatio === 'full');
      document.getElementById('ratio-lt')?.classList.toggle('active', activeRatio === '16-9');
      document.getElementById('ratio-custom')?.classList.toggle('active', false);
      updateLinePickerAvailability();
      updateCustomModeAvailability();
      updateTextEditorModeAvailability();
      if (opts.triggerChange && typeof onAnyControlChange === 'function') onAnyControlChange();
    }

    function applyProjectionSettingsProfileForTab(tab, opts = {}) {
      if (!SETTINGS_TARGET_TABS.includes(tab)) return false;
      applyProjectionSettingsSnapshot(getProjectionSettingsSnapshotForTab(tab), { ...opts, tab });
      return true;
    }

    function setMediaSettingsTargetActive(active) {
      const next = !!active;
      if (next === mediaSettingsTargetActive) return;
      if (next) saveProjectionSettingsProfileForTab(getEffectiveSettingsTargetTab());
      mediaSettingsTargetActive = next;
      updateSettingsTargetControl();
    }

    function setSettingsTargetTab(target, opts = {}) {
      saveProjectionSettingsProfileForTab(getEffectiveSettingsTargetTab());
      mediaSettingsTargetActive = false;
      settingsTargetTab = normalizeSettingsTargetTab(target);
      updateSettingsTargetControl();
      applyProjectionSettingsProfileForTab(getEffectiveSettingsTargetTab(), { triggerChange: !!opts.triggerChange });
      const isLockedInactiveTarget = settingsTargetTab !== 'follow' && getEffectiveSettingsTargetTab() !== sidebarTab;
      if (isLockedInactiveTarget) {
        applyProjectionRuntimeSnapshot(getProjectionSettingsSnapshotForTab(sidebarTab));
      }
      if (!opts.silent) saveToStorageDebounced();
    }

    function handleSettingsTargetChange(target) {
      if (target === 'media') {
        setMediaSettingsTargetActive(true);
        return;
      }
      setSettingsTargetTab(target || 'bible');
    }

    function getSetlistSettingsSnapshot() {
      const autoGoLiveToggle = document.getElementById('setlist-auto-go-live');
      const advancePreviewToggle = document.getElementById('setlist-advance-preview');
      return {
        autoGoLiveOnSelect: autoGoLiveToggle ? !!autoGoLiveToggle.checked : !!setlistSettings.autoGoLiveOnSelect,
        advancePreviewAfterLive: advancePreviewToggle ? !!advancePreviewToggle.checked : !!setlistSettings.advancePreviewAfterLive
      };
    }

    function applySetlistSettingsSnapshot(raw) {
      const source = (raw && typeof raw === 'object') ? raw : {};
      setlistSettings = {
        autoGoLiveOnSelect: source.autoGoLiveOnSelect === true,
        advancePreviewAfterLive: source.advancePreviewAfterLive !== false
      };
      const autoGoLiveToggle = document.getElementById('setlist-auto-go-live');
      if (autoGoLiveToggle) autoGoLiveToggle.checked = !!setlistSettings.autoGoLiveOnSelect;
      const advancePreviewToggle = document.getElementById('setlist-advance-preview');
      if (advancePreviewToggle) advancePreviewToggle.checked = !!setlistSettings.advancePreviewAfterLive;
      return { ...setlistSettings };
    }


    // ===== STATE =====
    function getUiSnapshot() {
      if (isFocusedWorkspaceMode()) {
        saveFocusedWorkspaceControlsForTab(sidebarTab);
      }
      saveProjectionSettingsProfileForTab(getEffectiveSettingsTargetTab());
      return {
        language: currentLanguage,
        fontFamily: document.getElementById('font-family').value,
        fontWeight: document.getElementById('font-weight').value,
        fontSizeFull: document.getElementById('font-size-val').value,
        ltFontSongs, ltFontBible, ltFontCustom,
        refFontSize: document.getElementById('ref-font-size-val').value,
        refBgColor: document.getElementById('ref-bg-color').value,
        autoAdjustLtHeight: document.getElementById('auto-adjust-lt-height').checked,
        ltStyle,
        songTransitionType: document.getElementById('song-transition-type').value,
        songTransitionDuration: document.getElementById('song-transition-duration').value,
        animateBgTransitions: document.getElementById('animate-bg-transitions').checked,
        ltStyles,
        customFonts,
        bgType: document.getElementById('bg-type').value,
        bgImageSource: document.getElementById('bg-image-source').value,
        bgImageUrl: document.getElementById('bg-image-url').value,
        bgUploadDataUrl,
        bgVideoSource: document.getElementById('bg-video-source').value,
        bgVideoUrl: document.getElementById('bg-video-url').value,
        bgVideoUploadDataUrl,
        bgVideoLoop: document.getElementById('bg-video-loop').checked,
        bgVideoSpeed: document.getElementById('bg-video-speed').value,
        bgMode,
        bgColor: document.getElementById('bg-color-quick').value,
        bgGradientShadow: document.getElementById('bg-color-shadow').value,
        bgGradientHighlight: document.getElementById('bg-color-highlight').value,
        bgBlur: document.getElementById('bg-blur').value,
        bgEdgeFix: document.getElementById('bg-edge-fix').value,
        bgOpacity: getActiveBgOpacityValue(),
        bgOpacityFull,
        bgOpacityLT,
        bgY: document.getElementById('bg-y').value,
        bgGradientAngle: document.getElementById('bg-gradient-angle')?.value || 135,
        textX: document.getElementById('text-x')?.value ?? 0,
        textY: document.getElementById('text-y')?.value ?? 860,
        padLR: document.getElementById('pad-lr-lt')?.value ?? 5,
        padLRFull: document.getElementById('pad-lr-full')?.value ?? 5,
        padLRLT: document.getElementById('pad-lr-lt')?.value ?? 5,
        padB: document.getElementById('pad-b')?.value ?? 0,
        fullTextTransform: document.getElementById('full-text-transform')?.value || fullTextTransform,
        ltTextTransform: document.getElementById('lt-text-transform')?.value || 'uppercase',
        showVersion: document.getElementById('show-version').checked,
        shortenBibleVersions: document.getElementById('shorten-bible-versions')?.checked,
        shortenBibleBooks: document.getElementById('shorten-bible-books')?.checked,
        showSongSolfaNotes: document.getElementById('show-song-solfa-notes')?.checked !== false,
        showSongCategoryName: document.getElementById('show-song-category-name')?.checked !== false,
        displaySongSections: document.getElementById('display-song-sections')?.checked === true,
        songBilingualEnabled: document.getElementById('song-bilingual-enabled')?.checked === true,
        songDisplayMode: document.getElementById('song-display-mode')?.value || DEFAULT_SONG_BILINGUAL_SETTINGS.displayMode,
        songTranslationMode: document.getElementById('song-translation-mode')?.value || DEFAULT_SONG_BILINGUAL_SETTINGS.translationMode,
        songAutoTranslateOnImport: document.getElementById('song-auto-translate-import')?.checked !== false,
        songAutoTranslateOnOpen: document.getElementById('song-auto-translate-open')?.checked !== false,
        songTargetLanguage: (document.getElementById('song-translation-language')?.value || DEFAULT_SONG_BILINGUAL_SETTINGS.targetLanguage).trim(),
        songSourceLanguage: (document.getElementById('song-translation-source-language')?.value || DEFAULT_SONG_BILINGUAL_SETTINGS.sourceLanguage).trim(),
        songSecondaryFontScale: document.getElementById('song-secondary-font-scale')?.value || DEFAULT_SONG_BILINGUAL_SETTINGS.secondaryFontScale,
        songCacheTranslationsLocally: document.getElementById('song-cache-translations')?.checked !== false,
        songFreeTranslationApiUrl: (document.getElementById('song-free-translation-api-url')?.value || DEFAULT_SONG_BILINGUAL_SETTINGS.freeTranslationApiUrl).trim(),
        songTranslationApiUrl: (document.getElementById('song-translation-api-url')?.value || '').trim(),
        songTranslationApiKey: document.getElementById('song-translation-api-key')?.value || '',
        showVerseNos: document.getElementById('show-verse-nos').checked,
        versionSwitchUpdatesLive: document.getElementById('version-switch-updates-live').checked,
        textColor: document.getElementById('text-color').value,
        refColor: document.getElementById('ref-color').value,
        linesPerPage,
        activeRatio,
        lineHeightFull: document.getElementById('line-height-full').value,
        lineHeightLT: document.getElementById('line-height-lt').value,
        ltWidthPct: document.getElementById('lt-width-pct')?.value || 100,
        ltScalePct: document.getElementById('lt-scale-pct')?.value || 100,
        ltOffsetY: document.getElementById('lt-offset-y')?.value || 0,
        ltOffsetX: document.getElementById('lt-offset-x')?.value || 0,
        ltBorderRadius: document.getElementById('lt-border-radius')?.value || 0,
        bgToggle: document.getElementById('bg-toggle').checked,
        hAlignFullRef: fullRefHAlign,
        hAlignFull: fullHAlign,
        vAlignFull: fullVAlign,
        hAlignLTSongs: ltHAlignSongs,
        vAlignLTSongs: ltVAlignSongs,
        ltAnchorMode,
        hAlignLTBible: ltHAlignBible,
        vAlignLTBible: ltVAlignBible,
        hAlignLTBibleVerse: ltHAlignBibleVerse,
        autoResizeFull: document.getElementById('auto-resize-full').value,
        autoResizeLT: document.getElementById('auto-resize-lt')?.value,
        refPositionFull: document.getElementById('ref-position-full')?.value,
        remoteShowEnabled: document.getElementById('remote-show-toggle')?.checked,
        remoteShowUseHostname: document.getElementById('remote-show-use-hostname')?.checked,
        remoteShowHost: document.getElementById('remote-show-host')?.value,
        remoteShowPort: document.getElementById('remote-show-port')?.value,
        remoteShowRelayHost: document.getElementById('remote-show-relay-host')?.value,
        remoteShowRelayPort: document.getElementById('remote-show-relay-port')?.value,
        remoteShowPairCode: document.getElementById('remote-show-pair-code')?.value,
        feedbackApiUrl: normalizeFeedbackApiUrl(appState?.settings?.feedbackApiUrl),
        hostMode: getHostMode(),
        vmix: getVmixSettings(),
        theme: document.getElementById('theme-select')?.value || 'skyline',
        sidebarLayout: document.getElementById('sidebar-layout-select')?.value || sidebarLayoutMode || 'layout2',
        workspaceLayoutMode: document.getElementById('workspace-layout-mode-select')?.value || workspaceLayoutMode || 'focused',
        focusedWorkspaceControls: ensureFocusedWorkspaceControlsState(),
        projectionSettingsProfiles: ensureProjectionSettingsProfiles(),
        settingsTargetTab: normalizeSettingsTargetTab(settingsTargetTab),
        setlistSettings: getSetlistSettingsSnapshot(),
        ltModeUserPresets: Array.isArray(ltModeUserPresets)
          ? ltModeUserPresets.map((preset) => ({
              ...preset,
              values: preset && preset.values ? { ...preset.values } : null
            }))
          : []
      };
    }
