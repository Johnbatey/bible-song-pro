    // ===== SYNC (BroadcastChannel) =====
    let connectionTimer = null;
    let syncMirrorDbPromise = null;
    let aiLastScriptureRef = '';
    let aiLastScriptureAt = 0;
    let aiPendingBookChapter = null;
    const AI_LEARNING_STORAGE_KEY = 'bsp-ai-scripture-learning-v1';
    const AI_LEARNING_MAX_ENTRIES = 300;
    const AI_PENDING_CONTEXT_WINDOW_MS = 20000;
    const AI_LIVE_SCRIPTURE_MAX_SUGGESTIONS = 5;
    const AI_LIVE_SONG_MAX_SUGGESTIONS = 5;
    const AI_LIVE_SCRIPTURE_STOPWORDS = new Set([
      'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'he', 'her', 'him', 'his', 'i', 'in', 'into',
      'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'she', 'that', 'the', 'their', 'them', 'there', 'they',
      'this', 'to', 'was', 'we', 'were', 'will', 'with', 'you', 'your'
    ]);
    let aiLearningEntries = [];
    let aiLiveVerseIndexCache = new Map();
    let aiLiveSongIndexCache = null;
    let aiLastSongKey = '';
    let aiLastSongAt = 0;
    let aiPendingSongPageSnapshot = null;
    let aiDebugState = {
      relay: 'idle',
      lastType: '-',
      transcript: '-',
      scripture: '-',
      action: 'waiting'
    };

    function aiDebugTrim(value, max = 90) {
      const text = String(value == null ? '' : value).trim();
      if (!text) return '-';
      return text.length > max ? `${text.slice(0, max - 1)}...` : text;
    }

    function renderAiRelayDebug() {
      const relayEl = document.getElementById('ai-debug-relay');
      const typeEl = document.getElementById('ai-debug-type');
      const transcriptEl = document.getElementById('ai-debug-transcript');
      const scriptureEl = document.getElementById('ai-debug-scripture');
      const actionEl = document.getElementById('ai-debug-action');
      if (relayEl) {
        relayEl.textContent = aiDebugState.relay || '-';
        relayEl.className = 'ai-debug-value' + ((/connected|open|ok|live/i).test(aiDebugState.relay) ? ' is-ok' : ((/error|fail|missing|not found|unresolved|closed/i).test(aiDebugState.relay) ? ' is-error' : ''));
      }
      if (typeEl) typeEl.textContent = aiDebugTrim(aiDebugState.lastType, 60);
      if (transcriptEl) transcriptEl.textContent = aiDebugTrim(aiDebugState.transcript, 120);
      if (scriptureEl) scriptureEl.textContent = aiDebugTrim(aiDebugState.scripture, 120);
      if (actionEl) {
        actionEl.textContent = aiDebugTrim(aiDebugState.action, 120);
        actionEl.className = 'ai-debug-value' + ((/live|selected|projected|connected|received/i).test(aiDebugState.action) ? ' is-ok' : ((/error|fail|missing|not found|unresolved|closed/i).test(aiDebugState.action) ? ' is-error' : ''));
      }
    }

    function updateAiRelayDebugState(patch = {}) {
      aiDebugState = { ...aiDebugState, ...patch };
      renderAiRelayDebug();
    }

    window.updateAiRelayDebugState = updateAiRelayDebugState;

    function openSyncMirrorDb() {
      if (syncMirrorDbPromise) return syncMirrorDbPromise;
      syncMirrorDbPromise = new Promise((resolve, reject) => {
        try {
          const req = indexedDB.open(SYNC_MIRROR_DB_NAME, SYNC_MIRROR_DB_VERSION);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(SYNC_MIRROR_STORE)) {
              db.createObjectStore(SYNC_MIRROR_STORE);
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error('Failed to open sync mirror DB'));
        } catch (err) {
          reject(err);
        }
      }).catch(err => {
        syncMirrorDbPromise = null;
        return Promise.reject(err);
      });
      return syncMirrorDbPromise;
    }

    function mirrorSyncMessage(msg) {
      if (!msg || (msg.type !== 'UPDATE' && msg.type !== 'CLEAR' && msg.type !== 'SYNC_STATE')) return;
      openSyncMirrorDb().then(db => new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(SYNC_MIRROR_STORE, 'readwrite');
          tx.objectStore(SYNC_MIRROR_STORE).put({
            ts: Date.now(),
            seq: Number(msg.seq || 0),
            msg
          }, SYNC_MIRROR_LAST_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed to mirror sync message'));
        } catch (err) {
          reject(err);
        }
      })).catch(() => {});
    }

    function markDisplayOnline() {
      const bar = document.getElementById('status-bar');
      bar.classList.add('connected');
      isDisplayOnline = true;
      updateAiRelayDebugState({ action: 'display ping/pong received' });
      updateStatusText();
      clearTimeout(connectionTimer);
      connectionTimer = setTimeout(() => {
        bar.classList.remove('connected');
        isDisplayOnline = false;
        updateStatusText();
      }, 3000);
    }

    function nextSeq() {
      messageSeq += 1;
      return messageSeq;
    }

    function sendSyncState() {
      const sceneLayers = getOutputSceneLayers();
      const hasActiveLiveState = !!(isLive && livePointer && lastLiveState && lastLiveState.kind === 'update');
      const state = hasActiveLiveState
        ? { kind: 'update', payload: { ...lastLiveState.payload, sceneLayers } }
        : { kind: 'clear', sceneLayers };
      const msg = {
        type: 'SYNC_STATE',
        proto: 1,
        sender: 'control',
        ts: Date.now(),
        seq: nextSeq(),
        state
      };
      broadcastMessage(msg);
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ source: 'bsp-panel-parent', message: msg }, '*');
        }
      } catch (_) {}
    }

    function replayDisplaySyncState(reason = 'display-sync') {
      if (!stateReady) {
        pendingHello = true;
        return;
      }
      updateAiRelayDebugState({ action: `display state replayed (${reason})` });
      sendSyncState();
    }

    window.bspReplayDisplaySyncState = replayDisplaySyncState;

    function getLibraryCounts() {
      const songCount = Array.isArray(songs) ? songs.length : 0;
      const bibleCount = bibles ? Object.keys(bibles).length : 0;
      return { songCount, bibleCount };
    }

    function queueRelayStatePush(opts = {}) {
      if (isRestoringBackup || isApplyingRemoteState || !stateReady) return;
      if (opts.includeSongs) relayStateIncludeSongs = true;
      if (opts.includeBibles) relayStateIncludeBibles = true;
      if (relayStateTimer) return;
      relayStateTimer = setTimeout(() => {
        relayStateTimer = null;
        sendRelayStatePush({
          includeSongs: relayStateIncludeSongs,
          includeBibles: relayStateIncludeBibles
        });
      }, 700);
    }

    function sendRelayStatePush({ includeSongs = false, includeBibles = false, bumpUpdatedAt = true } = {}) {
      if (!relaySocket || relaySocket.readyState !== WebSocket.OPEN) return false;
      if (isRestoringBackup || isApplyingRemoteState || !stateReady) return false;
      syncAppStateFromUi();
      const counts = getLibraryCounts();
      const updatedAt = bumpUpdatedAt ? Date.now() : (appStateUpdatedAt || Date.now());
      appStateUpdatedAt = Math.max(appStateUpdatedAt || 0, updatedAt);
      const payload = {
        type: 'STATE_PUSH',
        proto: 1,
        sender: 'control',
        clientId: relayClientId,
        ts: Date.now(),
        stateUpdatedAt: updatedAt,
        appState,
        songCount: counts.songCount,
        bibleCount: counts.bibleCount
      };
      if (includeSongs) {
        payload.songRecords = songs.map(song => buildSongRecord(song, { isNew: false }));
      }
      if (includeBibles) {
        payload.bibleRecords = Object.keys(bibles).map(name => buildBibleRecord(name, bibles[name] || [], { isNew: false }));
      }
      relaySend(payload);
      relayStateIncludeSongs = false;
      relayStateIncludeBibles = false;
      return true;
    }

    function requestRelayState() {
      if (!stateReady || isRestoringBackup) {
        relayStateRequestPending = true;
        return;
      }
      if (!relaySocket || relaySocket.readyState !== WebSocket.OPEN) {
        relayStateRequestPending = true;
        return;
      }
      relayStateRequestPending = false;
      const counts = getLibraryCounts();
      relaySend({
        type: 'STATE_REQUEST',
        proto: 1,
        sender: 'control',
        clientId: relayClientId,
        ts: Date.now(),
        forceSync: true,
        stateUpdatedAt: appStateUpdatedAt || 0,
        hasLibrary: (counts.songCount > 0 || counts.bibleCount > 0),
        songCount: counts.songCount,
        bibleCount: counts.bibleCount
      });
    }

    function flushRelayStateQueue() {
      if (relayStateIncludeSongs || relayStateIncludeBibles) {
        queueRelayStatePush({ includeSongs: relayStateIncludeSongs, includeBibles: relayStateIncludeBibles });
      }
      if (relayStateRequestPending) requestRelayState();
    }

    function handleRelayStateRequest(d) {
      if (!d || d.sender !== 'control') return;
      if (d.clientId && d.clientId === relayClientId) return;
      if (!stateReady || isRestoringBackup || isApplyingRemoteState) return;
      const counts = getLibraryCounts();
      const localHasLibrary = (counts.songCount > 0 || counts.bibleCount > 0);
      if (!localHasLibrary) return;
      if (d.forceSync) {
        sendRelayStatePush({
          includeSongs: counts.songCount > 0,
          includeBibles: counts.bibleCount > 0,
          bumpUpdatedAt: false
        });
        return;
      }
      const requesterHasLibrary = !!d.hasLibrary || Number(d.songCount || 0) > 0 || Number(d.bibleCount || 0) > 0;
      const requestUpdatedAt = Number(d.stateUpdatedAt || 0);
      const localUpdatedAt = Number(appStateUpdatedAt || 0);
      if (requestUpdatedAt && localUpdatedAt && requestUpdatedAt > localUpdatedAt) return;
      if (requesterHasLibrary && requestUpdatedAt && localUpdatedAt && requestUpdatedAt >= localUpdatedAt) return;
      sendRelayStatePush({
        includeSongs: counts.songCount > 0,
        includeBibles: counts.bibleCount > 0,
        bumpUpdatedAt: false
      });
    }

    function handleRelayStatePush(d) {
      if (!d || d.sender !== 'control') return;
      if (d.clientId && d.clientId === relayClientId) return;
      if (!stateReady || isRestoringBackup) {
        relayStateRequestPending = true;
        return;
      }
      if (!d.appState && !d.songRecords && !d.bibleRecords) return;
      const incomingUpdatedAt = Number(d.stateUpdatedAt || 0);
      const localUpdatedAt = Number(appStateUpdatedAt || 0);
      const incomingHasLibrary =
        (Array.isArray(d.songRecords) ? d.songRecords.length : 0) > 0 ||
        (Array.isArray(d.bibleRecords) ? d.bibleRecords.length : 0) > 0 ||
        Number(d.songCount || 0) > 0 ||
        Number(d.bibleCount || 0) > 0;
      const localCounts = getLibraryCounts();
      const localHasLibrary = localCounts.songCount > 0 || localCounts.bibleCount > 0;

      if (!incomingHasLibrary && !localHasLibrary) {
        requestRelayState();
        return;
      }
      if (!localHasLibrary && incomingHasLibrary) {
        applyRelayState(d);
        return;
      }
      if (incomingUpdatedAt && localUpdatedAt && incomingUpdatedAt <= localUpdatedAt) return;
      applyRelayState(d);
    }

    function applyRelayState(payload) {
      if (relayStateApplying) return;
      relayStateApplying = true;
      isApplyingRemoteState = true;
      if (payload.stateUpdatedAt) {
        appStateUpdatedAt = payload.stateUpdatedAt;
      }
      const stateValue = payload.appState || null;
      let songRecords = Array.isArray(payload.songRecords) ? payload.songRecords : null;
      let bibleRecords = Array.isArray(payload.bibleRecords) ? payload.bibleRecords : null;
      if (!songRecords) {
        songRecords = songs.map(song => buildSongRecord(song, { isNew: false }));
      }
      if (!bibleRecords) {
        bibleRecords = Object.keys(bibles).map(name => buildBibleRecord(name, bibles[name] || [], { isNew: false }));
      }
      applyLoadedState(stateValue, songRecords, bibleRecords, { runInit: false, stateUpdatedAt: payload.stateUpdatedAt || 0 });
      saveState();
      const tasks = [];
      if (stateValue) {
        tasks.push(dbSetAppState(stateValue, { updatedAt: payload.stateUpdatedAt || Date.now() }));
      }
      if (Array.isArray(payload.songRecords)) {
        tasks.push(dbClearStore(STORE_SONGS).then(() => dbPutMany(STORE_SONGS, songRecords)));
      }
      if (Array.isArray(payload.bibleRecords)) {
        tasks.push(dbClearStore(STORE_BIBLES).then(() => dbPutMany(STORE_BIBLES, bibleRecords)));
      }
      Promise.all(tasks).catch(() => {}).finally(() => {
        relayStateApplying = false;
        isApplyingRemoteState = false;
        if (payload.stateUpdatedAt) {
          appStateUpdatedAt = payload.stateUpdatedAt;
        } else if (!appStateUpdatedAt) {
          appStateUpdatedAt = Date.now();
        }
      });
    }

    function resolveBibleVersionFromAi(payload) {
      const versions = Object.keys(bibles || {});
      if (!versions.length) return null;
      const candidate = String(
        payload?.versionId ||
        payload?.version ||
        payload?.translation ||
        payload?.candidates?.[0]?.versionId ||
        payload?.candidates?.[0]?.version ||
        payload?.candidates?.[0]?.translation ||
        ''
      ).trim();
      if (!candidate) return activeBibleVersion && bibles[activeBibleVersion] ? activeBibleVersion : versions[0];
      const lc = candidate.toLowerCase();
      const direct = versions.find(v => String(v).toLowerCase() === lc);
      if (direct) return direct;
      const includes = versions.find(v => String(v).toLowerCase().includes(lc) || lc.includes(String(v).toLowerCase()));
      if (includes) return includes;
      return activeBibleVersion && bibles[activeBibleVersion] ? activeBibleVersion : versions[0];
    }

    function getAiScriptureRef(payload) {
      if (!payload || typeof payload !== 'object') return '';
      const c0 = payload.candidates && payload.candidates[0] ? payload.candidates[0] : null;
      return String(
        payload.ref ||
        payload.reference ||
        payload.scripture ||
        (c0 && (c0.ref || c0.reference || c0.scripture)) ||
        ''
      ).trim();
    }

    function normalizeAiLiveScriptureText(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function getPreferredAiLiveScriptureVersion(payload) {
      const resolved = resolveBibleVersionFromAi(payload || {});
      if (resolved) return resolved;
      const versions = Object.keys(bibles || {});
      return versions.length ? versions[0] : '';
    }

    function buildAiLiveScriptureVerseIndex(versionId) {
      const key = String(versionId || '');
      const list = (key && bibles && Array.isArray(bibles[key])) ? bibles[key] : [];
      const cached = aiLiveVerseIndexCache.get(key);
      if (cached && cached.size === list.length) return cached;

      const entries = [];
      const tokenMap = new Map();
      const exactMap = new Map();

      list.forEach((item, chapterIndex) => {
        const extracted = extractBookAndChapter(item);
        const lines = String(item && item.content || '').split('\n');
        lines.forEach((line) => {
          const match = String(line || '').trim().match(/^(\d+)\s+(.+)$/);
          if (!match) return;
          const verse = Number(match[1]);
          const text = String(match[2] || '').trim();
          const normalized = normalizeSearchText(normalizeAiLiveScriptureText(text));
          const tokens = normalized.split(/\s+/).filter((token) => token && !AI_LIVE_SCRIPTURE_STOPWORDS.has(token));
          const entry = {
            book: item.book || extracted.book || '',
            chapter: Number(item.chapter || extracted.chap || 0),
            verse,
            text,
            normalized,
            tokens,
            versionId: key,
            chapterIndex
          };
          const entryIndex = entries.push(entry) - 1;
          if (normalized) {
            const bucket = exactMap.get(normalized);
            if (bucket) bucket.push(entryIndex);
            else exactMap.set(normalized, [entryIndex]);
          }
          new Set(tokens).forEach((token) => {
            const bucket = tokenMap.get(token);
            if (bucket) bucket.push(entryIndex);
            else tokenMap.set(token, [entryIndex]);
          });
        });
      });

      const next = { entries, tokenMap, exactMap, size: list.length };
      aiLiveVerseIndexCache.set(key, next);
      return next;
    }

    function detectAiQuotedVerseCandidates(transcript, versionId, opts = {}) {
      if (!versionId || !bibles || !bibles[versionId]) return [];
      const index = buildAiLiveScriptureVerseIndex(versionId);
      const normalized = normalizeSearchText(normalizeAiLiveScriptureText(transcript));
      const tokens = normalized.split(/\s+/).filter((token) => token && !AI_LIVE_SCRIPTURE_STOPWORDS.has(token));
      const minTokens = Math.max(2, Number(opts.minTokens) || 6);
      const minScore = Number(opts.minScore) || 1.05;
      const allowPrefix = opts.allowPrefix !== false;
      const limit = Math.max(1, Number(opts.limit) || AI_LIVE_SCRIPTURE_MAX_SUGGESTIONS);

      const exactCandidates = index.exactMap.get(normalized) || [];
      if (exactCandidates.length) {
        const exactEntry = index.entries[exactCandidates[0]];
        if (exactEntry) {
          return [{
            book: exactEntry.book,
            chapter: exactEntry.chapter,
            verseStart: exactEntry.verse,
            verseEnd: null,
            versionId,
            reason: 'quoted-verse',
            confidence: 2,
            excerpt: exactEntry.text
          }];
        }
      }

      if (allowPrefix && tokens.length >= 2) {
        const prefixMatches = index.entries
          .filter((entry) => {
            if (!entry || !entry.normalized) return false;
            if (entry.normalized === normalized) return true;
            if (!entry.normalized.startsWith(normalized)) return false;
            const nextChar = entry.normalized.charAt(normalized.length);
            return !nextChar || nextChar === ' ';
          })
          .slice(0, limit)
          .map((entry) => ({
            book: entry.book,
            chapter: entry.chapter,
            verseStart: entry.verse,
            verseEnd: null,
            versionId,
            reason: 'quoted-verse',
            confidence: tokens.length <= 4 ? 1.75 : 1.55,
            excerpt: entry.text
          }));
        if (prefixMatches.length) return prefixMatches;
      }

      if (tokens.length < minTokens) return [];
      const scores = new Map();
      tokens.forEach((token) => {
        const bucket = index.tokenMap.get(token);
        if (!bucket) return;
        bucket.forEach((entryIndex) => {
          scores.set(entryIndex, (scores.get(entryIndex) || 0) + 1);
        });
      });

      return Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 18)
        .map(([entryIndex, overlap]) => {
          const entry = index.entries[entryIndex];
          const uniqueTokenCount = Math.max(1, new Set(tokens).size);
          const overlapRatio = overlap / uniqueTokenCount;
          const entryCoverage = overlap / Math.max(1, entry.tokens.length);
          const contained = normalized.includes(entry.normalized) ? 0.55 : 0;
          const startsWithContained = entry.normalized && normalized.startsWith(entry.normalized.slice(0, Math.min(entry.normalized.length, 42))) ? 0.1 : 0;
          const lengthRatio = Math.min(0.12, entry.tokens.length / Math.max(8, tokens.length * 3));
          return { entry, score: overlapRatio + entryCoverage + contained + startsWithContained + lengthRatio };
        })
        .sort((a, b) => b.score - a.score)
        .filter((candidate) => candidate.score >= minScore)
        .slice(0, limit)
        .map((candidate) => ({
          book: candidate.entry.book,
          chapter: candidate.entry.chapter,
          verseStart: candidate.entry.verse,
          verseEnd: null,
          versionId,
          reason: 'quoted-verse',
          confidence: Number(candidate.score.toFixed(3)),
          excerpt: candidate.entry.text
        }));
    }

    function formatAiMatchRef(match) {
      if (!match || !match.book || !Number(match.chapter) || !Number(match.verseStart)) return '';
      const versePart = `${match.verseStart}${match.verseEnd ? `-${match.verseEnd}` : ''}`;
      return `${match.book} ${match.chapter}:${versePart}`;
    }

    function normalizeAiSongText(value) {
      return normalizeSearchText(String(value || '')
        .replace(/\[[^[\]\n]{1,60}\]/g, ' ')
        .replace(/^(verse|chorus|bridge|refrain|pre[-\s]?chorus|intro|outro|tag|hook)\s*(\d+|[ivxlcdm]+)?\s*[:.\-]?/gim, ' ')
        .replace(/\s+/g, ' ')
        .trim());
    }

    function getAiSongIndexSignature() {
      return (Array.isArray(songs) ? songs : []).map((song, index) => {
        const title = String(song && song.title || '');
        const content = String(song && song.content || song && song.text || '');
        return `${index}:${song && song.id || ''}:${title.length}:${content.length}:${title}:${content.slice(0, 80)}:${content.slice(-80)}`;
      }).join('|');
    }

    function buildAiLiveSongIndex() {
      const list = Array.isArray(songs) ? songs : [];
      const signature = getAiSongIndexSignature();
      if (aiLiveSongIndexCache && aiLiveSongIndexCache.signature === signature) return aiLiveSongIndexCache;

      const entries = [];
      list.forEach((song, songIndex) => {
        if (!song) return;
        const title = String(song.title || '').trim();
        const content = String(song.content || song.text || '').trim();
        const normalizedTitle = normalizeAiSongText(title);
        const titleTokens = normalizedTitle.split(/\s+/).filter(Boolean);
        const pages = (typeof getPagesFromItem === 'function') ? getPagesFromItem(song, false) : [];
        const sourcePages = pages.length ? pages : [{ raw: content, tag: 'Lyrics' }];
        sourcePages.forEach((page, pageIndex) => {
          const raw = String(page && page.raw || '').trim();
          const pushEntry = (entryRaw, entryPageIndex, pageLabel, pageSnapshot = null) => {
            const normalized = normalizeAiSongText(`${title}\n${entryRaw}`);
            const lyricNormalized = normalizeAiSongText(entryRaw);
            const tokens = normalized.split(/\s+/).filter((token) => token && !AI_LIVE_SCRIPTURE_STOPWORDS.has(token));
            if (!normalized || !tokens.length) return;
            entries.push({
              kind: 'song',
              songIndex,
              pageIndex: entryPageIndex,
              title,
              songTitle: title,
              pageLabel,
              excerpt: String(entryRaw || '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 4).join(' / '),
              normalized,
              lyricNormalized,
              normalizedTitle,
              titleTokens,
              tokens,
              pageSnapshot
            });
          };
          const pageLabel = String(page && page.tag || `Part ${pageIndex + 1}`);
          pushEntry(raw, pageIndex, pageLabel);
          raw.split('\n').map(line => line.trim()).filter(Boolean).forEach((line) => {
            pushEntry(line, pageIndex, pageLabel, {
              text: line,
              raw: line,
              tag: pageLabel,
              verseCount: 1
            });
          });
        });
      });

      aiLiveSongIndexCache = { signature, entries };
      return aiLiveSongIndexCache;
    }

    function detectAiSongCandidates(transcript, opts = {}) {
      const index = buildAiLiveSongIndex();
      const normalized = normalizeAiSongText(transcript);
      if (!normalized) return [];
      const tokens = normalized.split(/\s+/).filter((token) => token && !AI_LIVE_SCRIPTURE_STOPWORDS.has(token));
      if (tokens.length < (opts.minTokens || 2) && normalized.length < 8) return [];
      const tokenSet = new Set(tokens);
      const minScore = Number(opts.minScore) || 0.85;
      const limit = Math.max(1, Number(opts.limit) || AI_LIVE_SONG_MAX_SUGGESTIONS);
      const bySong = new Map();

      index.entries.forEach((entry) => {
        let overlap = 0;
        const uniqueEntryTokens = new Set(entry.tokens);
        tokenSet.forEach((token) => {
          if (uniqueEntryTokens.has(token)) overlap += 1;
        });
        const overlapRatio = overlap / Math.max(1, tokenSet.size);
        const entryCoverage = overlap / Math.max(1, uniqueEntryTokens.size);
        const titleContained = entry.normalizedTitle && normalized.includes(entry.normalizedTitle) ? 0.8 : 0;
        const titlePrefix = entry.normalizedTitle && entry.normalizedTitle.startsWith(normalized) ? 0.55 : 0;
        const lyricContained = entry.lyricNormalized && (entry.lyricNormalized.includes(normalized) || normalized.includes(entry.lyricNormalized.slice(0, Math.min(60, entry.lyricNormalized.length)))) ? 0.45 : 0;
        const exactLineBoost = entry.pageSnapshot && entry.lyricNormalized && (entry.lyricNormalized.includes(normalized) || normalized.includes(entry.lyricNormalized)) ? 0.35 : 0;
        const score = overlapRatio + entryCoverage + titleContained + titlePrefix + lyricContained + exactLineBoost;
        if (score < minScore) return;
        const reason = titleContained || titlePrefix ? 'title-match' : (lyricContained ? 'phrase-match' : 'close-phrase');
        const candidate = {
          kind: 'song',
          songIndex: entry.songIndex,
          pageIndex: entry.pageIndex,
          title: entry.title,
          songTitle: entry.songTitle,
          pageLabel: entry.pageLabel,
          excerpt: entry.excerpt,
          reason,
          confidence: Number(score.toFixed(3)),
          pageSnapshot: entry.pageSnapshot || null
        };
        const existing = bySong.get(entry.songIndex);
        if (!existing || candidate.confidence > existing.confidence || (candidate.pageSnapshot && !existing.pageSnapshot && candidate.confidence >= existing.confidence - 0.25)) {
          bySong.set(entry.songIndex, candidate);
        }
      });

      return Array.from(bySong.values())
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, limit);
    }

    function getAiSongMatchKey(match) {
      if (!match) return '';
      return `${match.songIndex}:${match.pageIndex}:${match.title || ''}`;
    }

    function applyAiSongSelection(match, opts = {}) {
      if (!match || !Array.isArray(songs)) return false;
      const songIndex = Number(match.songIndex);
      if (!Number.isInteger(songIndex) || songIndex < 0 || songIndex >= songs.length) return false;
      setSidebarTab('songs');
      buttonContextTab = 'songs';
      selectItem(songIndex, { skipButtonView: true });
      const pages = getPagesFromItem(currentItem, false);
      const pageIndex = Math.max(0, Math.min(pages.length - 1, Number(match.pageIndex) || 0));
      lineCursor = pageIndex;
      updateButtonView();
      if (opts.suppressLiveProject) return true;
      aiPendingSongPageSnapshot = match.pageSnapshot ? { songIndex, pageSnapshot: match.pageSnapshot } : null;
      projectLive(true);
      aiPendingSongPageSnapshot = null;
      showToast(`Song live: ${match.title || 'Selected song'}`);
      return true;
    }

    function handleAiSongTranscript(d) {
      const transcriptText = String(d.text || '');
      const isFinal = !!d.isFinal;
      const suggestions = detectAiSongCandidates(transcriptText, {
        minTokens: isFinal ? 3 : 2,
        minScore: isFinal ? 0.82 : 1.05,
        limit: AI_LIVE_SONG_MAX_SUGGESTIONS
      });
      const bestHit = suggestions[0] || null;
      const hudPayload = {
        mode: 'song',
        transcript: transcriptText,
        isFinal
      };
      if (bestHit) {
        hudPayload.bestHit = bestHit;
        hudPayload.suggestions = suggestions;
      }
      updateAiLiveScriptureHud(hudPayload);
      if (!bestHit) {
        if (isFinal) updateAiRelayDebugState({ action: 'transcript received but no song inferred' });
        return;
      }
      const settings = getAiHudSettings();
      const matchKey = getAiSongMatchKey(bestHit);
      const now = Date.now();
      const shouldProject = settings.autoProject !== false && (isFinal || bestHit.confidence >= 1.4);
      updateAiRelayDebugState({
        scripture: bestHit.title || '-',
        action: shouldProject ? 'song inferred from transcript' : 'song detected - auto project OFF'
      });
      if (!shouldProject || !matchKey || (matchKey === aiLastSongKey && (now - aiLastSongAt) < 6000)) return;
      aiLastSongKey = matchKey;
      aiLastSongAt = now;
      applyAiSongSelection(bestHit);
    }

    window.bspLsHudProjectSongMatch = function (matchJson) {
      try {
        const match = typeof matchJson === 'string' ? JSON.parse(matchJson) : matchJson;
        const settings = getAiHudSettings();
        applyAiSongSelection(match, { suppressLiveProject: settings.autoProject === false });
      } catch (_) {}
    };

    function extractAiVerseExcerpt(item, verseStart) {
      if (!item || !Number.isFinite(Number(verseStart))) return '';
      const target = Number(verseStart);
      const line = String(item.content || '').split('\n').find((raw) => {
        const m = String(raw || '').trim().match(/^(\d+)\s+(.+)$/);
        return m && Number(m[1]) === target;
      });
      const hit = String(line || '').trim().match(/^(\d+)\s+(.+)$/);
      return hit ? String(hit[2] || '').trim() : '';
    }

    function buildAiDirectMatchFromRef(ref, versionId, reason = 'direct-reference') {
      const cleanRef = String(ref || '').trim();
      if (!cleanRef || !versionId || !bibles || !bibles[versionId]) return null;
      const parsed = parseBibleReferenceQuery(cleanRef);
      if (!parsed) return null;
      const chapterMatch = findBibleReferenceChapter(versionId, parsed);
      if (!chapterMatch) return null;
      const chapterItem = bibles[versionId][chapterMatch.chapterIndex];
      const hasExplicitVerse = !!parsed.versePrefix;
      const verseStart = hasExplicitVerse ? Number(parsed.versePrefix) : null;
      const book = chapterMatch.parsed?.book || parsed.book;
      const chapter = chapterMatch.parsed?.chapter || parsed.chapter;
      return {
        book,
        chapter,
        ref: hasExplicitVerse ? `${book} ${chapter}:${verseStart}` : `${book} ${chapter}`,
        verseStart,
        verseEnd: null,
        versionId,
        reason,
        confidence: 1,
        excerpt: hasExplicitVerse ? extractAiVerseExcerpt(chapterItem, verseStart) : ''
      };
    }

    function getAiHudSettings() {
      if (typeof window.bspGetLiveScriptureHudSettings === 'function') {
        try {
          const hud = window.bspGetLiveScriptureHudSettings();
          return {
            autoProject: hud && hud.autoProject !== false,
            autoProjectQuoted: !!(hud && hud.autoProjectQuoted),
            aiMode: hud && hud.aiMode === 'song' ? 'song' : 'bible'
          };
        } catch (_) {}
      }
      return { autoProject: true, autoProjectQuoted: false, aiMode: 'bible' };
    }

    function updateAiLiveScriptureHud(payload = {}) {
      if (typeof window.bspLiveScriptureHudUpdate !== 'function') return;
      try { window.bspLiveScriptureHudUpdate(payload); } catch (_) {}
    }

    window.bspLsHudProjectMatch = function (matchJson) {
      try {
        const match = typeof matchJson === 'string' ? JSON.parse(matchJson) : matchJson;
        if (!match || !match.book || !match.chapter || !match.verseStart) return;
        const ref = String(match.book) + ' ' + String(match.chapter) + ':' + String(match.verseStart)
          + (match.verseEnd ? ('-' + String(match.verseEnd)) : '');
        applyAiScriptureSelection({ ref, versionId: match.versionId || '' });
      } catch (_) {}
    };

    function normalizeRefBook(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/^first\s+/i, '1 ')
        .replace(/^second\s+/i, '2 ')
        .replace(/^third\s+/i, '3 ')
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function normalizeAiLearningKey(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/([a-z])\s*-\s*([a-z])/g, '$1 $2')
        .replace(/\bromance\b/g, 'romans')
        .replace(/\bvasthen\b/g, 'verse ten')
        .replace(/\b(verstain|bastain|basten)\b/g, 'verse ten')
        .replace(/\b(v[ae]s+t?s?|vess|ves|versus)\b/g, 'verse')
        .replace(/\b(?:and\s+)?that'?s\s+([a-z0-9\- ]+)$/g, 'verse $1')
        .replace(/[()\[\],;!?.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function isNumberOnlyPhrase(raw) {
      const tokenSynonyms = {
        won: 'one', wan: 'one', on: 'one',
        to: 'two', too: 'two', tu: 'two',
        seek: 'six', seeks: 'six',
        fight: 'five', fights: 'five',
        ate: 'eight', eights: 'eight', eighth: 'eight', eigth: 'eight'
      };
      const units = new Set([
        'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
        'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
        'seventeen', 'eighteen', 'nineteen'
      ]);
      const tens = new Set(['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']);
      const tokens = String(raw || '')
        .toLowerCase()
        .replace(/[^a-z0-9\- ]+/g, ' ')
        .replace(/-/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => tokenSynonyms[token] || token);
      if (!tokens.length) return false;
      return tokens.every((token) => {
        if (/^\d+$/.test(token)) return true;
        if (units.has(token) || tens.has(token) || token === 'hundred') return true;
        return token === 'and' || token === 'the' || token === 'verse' || token === 'chapter';
      });
    }

    function loadAiLearningEntries() {
      try {
        const raw = window.localStorage.getItem(AI_LEARNING_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .map((entry) => ({
            key: normalizeAiLearningKey(entry && entry.key),
            ref: String((entry && entry.ref) || '').trim(),
            hits: Math.max(1, Number((entry && entry.hits) || 1)),
            ts: Number((entry && entry.ts) || Date.now())
          }))
          .filter((entry) => entry.key && entry.ref && !isNumberOnlyPhrase(entry.key))
          .slice(0, AI_LEARNING_MAX_ENTRIES);
      } catch (_) {
        return [];
      }
    }

    function saveAiLearningEntries() {
      try {
        window.localStorage.setItem(AI_LEARNING_STORAGE_KEY, JSON.stringify(aiLearningEntries.slice(0, AI_LEARNING_MAX_ENTRIES)));
      } catch (_) {}
    }

    function getLearnedAiRef(transcript) {
      const key = normalizeAiLearningKey(transcript);
      if (isNumberOnlyPhrase(key)) return '';
      if (!key || !aiLearningEntries.length) return '';
      const hit = aiLearningEntries.find((entry) => entry.key === key);
      return hit ? hit.ref : '';
    }

    function teachAiLearning(transcript, ref) {
      const key = normalizeAiLearningKey(transcript);
      const cleanRef = String(ref || '').trim();
      if (isNumberOnlyPhrase(key)) return;
      if (!key || !cleanRef) return;
      const existing = aiLearningEntries.find((entry) => entry.key === key);
      if (existing) {
        existing.ref = cleanRef;
        existing.hits = Math.max(1, Number(existing.hits || 1) + 1);
        existing.ts = Date.now();
      } else {
        aiLearningEntries.unshift({ key, ref: cleanRef, hits: 1, ts: Date.now() });
      }
      aiLearningEntries.sort((a, b) => {
        const hitDiff = Number(b.hits || 0) - Number(a.hits || 0);
        if (hitDiff !== 0) return hitDiff;
        return Number(b.ts || 0) - Number(a.ts || 0);
      });
      aiLearningEntries = aiLearningEntries.slice(0, AI_LEARNING_MAX_ENTRIES);
      saveAiLearningEntries();
    }

    function buildBibleBookAliasMap() {
      const aliases = new Map();
      const push = (alias, canonical) => {
        const key = normalizeRefBook(alias);
        if (key) aliases.set(key, canonical);
      };
      getBibleBookCandidates().forEach((book) => push(book, book));
      [
        ['gen', 'Genesis'], ['exo', 'Exodus'], ['ex', 'Exodus'], ['lev', 'Leviticus'], ['num', 'Numbers'],
        ['deut', 'Deuteronomy'], ['detronome', 'Deuteronomy'], ['ditaronomy', 'Deuteronomy'], ['ditronomy', 'Deuteronomy'],
        ['josh', 'Joshua'], ['judg', 'Judges'], ['psalm', 'Psalms'], ['ps', 'Psalms'],
        ['salm', 'Psalms'], ['saam', 'Psalms'], ['prov', 'Proverbs'], ['eccl', 'Ecclesiastes'],
        ['ecclesia sees', 'Ecclesiastes'], ['ectilestiasthesis', 'Ecclesiastes'], ['ecclessiastes', 'Ecclesiastes'],
        ['song', 'Song of Solomon'], ['sos', 'Song of Solomon'], ['isa', 'Isaiah'], ['jer', 'Jeremiah'],
        ['jerry maya', 'Jeremiah'], ['jerry mayaw', 'Jeremiah'], ['jerry mayer', 'Jeremiah'],
        ['ezek', 'Ezekiel'], ['dan', 'Daniel'], ['hos', 'Hosea'], ['obad', 'Obadiah'], ['hab', 'Habakkuk'],
        ['abaco', 'Habakkuk'], ['abacu', 'Habakkuk'], ['abacuk', 'Habakkuk'], ['ababkuk', 'Habakkuk'],
        ['abraco', 'Habakkuk'], ['abracu', 'Habakkuk'], ['abracul', 'Habakkuk'],
        ['abacouk', 'Habakkuk'], ['abacog', 'Habakkuk'], ['abacogue', 'Habakkuk'], ['abacuum', 'Habakkuk'],
        ['ziphaniah', 'Zephaniah'], ['zi fania', 'Zephaniah'], ['ziffanai', 'Zephaniah'],
        ['fill him on', 'Philemon'], ['file a month', 'Philemon'], ['philimon', 'Philemon'], ['fylemon', 'Philemon'], ['file him on', 'Philemon'],
        ['zech', 'Zechariah'], ['mal', 'Malachi'], ['matt', 'Matthew'], ['mathew', 'Matthew'],
        ['mathieu', 'Matthew'], ['matt s you', 'Matthew'], ['jhon', 'John'], ['lukee', 'Luke'], ['marke', 'Mark'],
        ['routes', 'Ruth'], ['roots', 'Ruth'], ['root', 'Ruth'],
        ['rev', 'Revelation'], ['revelations', 'Revelation'], ['romance', 'Romans'], ['corinthians', '1 Corinthians'],
        ['thesalonians', '1 Thessalonians'], ['thessalonia', '1 Thessalonians'], ['tesalonia', '1 Thessalonians'],
        ['1 corinthians', '1 Corinthians'], ['first corinthians', '1 Corinthians'],
        ['2 corinthians', '2 Corinthians'], ['second corinthians', '2 Corinthians'],
        ['1 thessalonians', '1 Thessalonians'], ['first thessalonians', '1 Thessalonians'],
        ['2 thessalonians', '2 Thessalonians'], ['second thessalonians', '2 Thessalonians'],
        ['1 timothy', '1 Timothy'], ['first timothy', '1 Timothy'], ['2 timothy', '2 Timothy'], ['second timothy', '2 Timothy'],
        ['timoti', 'Timothy'],
        ['1 peter', '1 Peter'], ['first peter', '1 Peter'], ['2 peter', '2 Peter'], ['second peter', '2 Peter'],
        ['1 john', '1 John'], ['first john', '1 John'], ['2 john', '2 John'], ['second john', '2 John'],
        ['3 john', '3 John'], ['third john', '3 John']
      ].forEach(([alias, canonical]) => push(alias, canonical));
      return aliases;
    }

    function buildBibleBookPhoneticKey(value) {
      return normalizeRefBook(value)
        .replace(/\bps(?=alm)/g, 's')
        .replace(/\bph/g, 'f')
        .replace(/\bkn/g, 'n')
        .replace(/\bwr/g, 'r')
        .replace(/kh/g, 'k')
        .replace(/[aeiou]/g, '')
        .replace(/(.)\1+/g, '$1')
        .trim();
    }

    function getLevenshteinDistance(a, b) {
      const left = String(a || '');
      const right = String(b || '');
      if (!left) return right.length;
      if (!right) return left.length;
      const rows = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
      for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
      for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;
      for (let i = 1; i <= left.length; i += 1) {
        for (let j = 1; j <= right.length; j += 1) {
          const cost = left[i - 1] === right[j - 1] ? 0 : 1;
          rows[i][j] = Math.min(
            rows[i - 1][j] + 1,
            rows[i][j - 1] + 1,
            rows[i - 1][j - 1] + cost
          );
        }
      }
      return rows[left.length][right.length];
    }

    function findPhoneticBibleBookMatch(rawBook) {
      const phraseKey = buildBibleBookPhoneticKey(rawBook);
      if (!phraseKey) return '';
      const aliases = buildBibleBookAliasMap();
      let bestCanonical = '';
      let bestScore = -Infinity;
      const seen = new Set();
      for (const [aliasKey, canonical] of aliases.entries()) {
        const marker = canonical + '|' + aliasKey;
        if (seen.has(marker)) continue;
        seen.add(marker);
        const aliasPhonetic = buildBibleBookPhoneticKey(aliasKey);
        if (!aliasPhonetic) continue;
        const distance = getLevenshteinDistance(phraseKey, aliasPhonetic);
        const maxLen = Math.max(phraseKey.length, aliasPhonetic.length, 1);
        let score = 1 - (distance / maxLen);
        if (aliasPhonetic.startsWith(phraseKey) || phraseKey.startsWith(aliasPhonetic)) score += 0.12;
        if (distance === 0) score += 0.2;
        if (score > bestScore) {
          bestScore = score;
          bestCanonical = canonical;
        }
      }
      return bestScore >= 0.58 ? bestCanonical : '';
    }

    function getBibleBookCandidates() {
      const set = new Set();
      if (typeof BIBLE_BOOKS === 'object' && BIBLE_BOOKS) {
        Object.values(BIBLE_BOOKS).forEach((book) => {
          const b = String(book || '').trim();
          if (b) set.add(b);
        });
      }
      Object.keys(bibles || {}).forEach((versionId) => {
        const list = bibles[versionId] || [];
        list.forEach((item) => {
          const extracted = extractBookAndChapter(item);
          const b = String(item?.book || extracted.book || '').trim();
          if (b) set.add(b);
        });
      });
      return Array.from(set);
    }

    function resolveBibleBookName(rawBook) {
      const needle = normalizeRefBook(rawBook);
      if (!needle) return '';
      if (isNumberOnlyPhrase(needle)) return '';
      const books = getBibleBookCandidates();
      if (!books.length) return '';
      const variants = [];
      const pushVariant = (value) => {
        const normalized = normalizeRefBook(value);
        if (!normalized || variants.includes(normalized) || isNumberOnlyPhrase(normalized)) return;
        variants.push(normalized);
      };
      pushVariant(needle);
      const needleWords = needle.split(' ').filter(Boolean);
      for (let i = 0; i < needleWords.length; i += 1) {
        const suffix = needleWords.slice(i).join(' ');
        pushVariant(suffix);
        if (suffix.startsWith('book of ')) pushVariant(suffix.slice('book of '.length));
      }
      const aliases = buildBibleBookAliasMap();
      for (const candidate of variants) {
        const aliasHit = aliases.get(candidate);
        if (aliasHit) return aliasHit;
        let best = books.find((b) => normalizeRefBook(b) === candidate);
        if (best) return best;
        best = books.find((b) => normalizeRefBook(b).startsWith(candidate));
        if (best) return best;
        best = books.find((b) => candidate.startsWith(normalizeRefBook(b)));
        if (best) return best;
        if (candidate.length >= 3) {
          const phonetic = findPhoneticBibleBookMatch(candidate);
          if (phonetic) return phonetic;
        }
      }
      return '';
    }

    function getAiNavigationCommand(transcript) {
      const normalized = normalizeRefBook(transcript);
      if (!normalized) return '';
      if (/(^|\s)next verse(\s|$)/.test(normalized)) return 'next';
      if (/(^|\s)(?:previous|prev) verse(\s|$)/.test(normalized)) return 'previous';
      if (/(^|\s)last verse(\s|$)/.test(normalized)) return 'last';
      if (/(^|\s)first verse(\s|$)/.test(normalized)) return 'first';
      return '';
    }

    function navigateAiScriptureCommand(command) {
      const cmd = String(command || '').toLowerCase();
      if (!cmd) return false;
      let versionId = '';
      let chapterIndex = -1;
      let item = null;
      let pageIndex = 0;

      if (isLive && livePointer && livePointer.kind === 'bible') {
        versionId = String(livePointer.version || '');
        chapterIndex = Number(livePointer.index);
        item = (bibles && bibles[versionId] && bibles[versionId][chapterIndex]) ? bibles[versionId][chapterIndex] : null;
        pageIndex = Math.max(0, Number(liveLineCursor) || 0);
      } else if (sidebarTab === 'bible' && currentItem) {
        versionId = String(currentItem.version || activeBibleVersion || '');
        chapterIndex = Number(currentIndex);
        item = currentItem;
        pageIndex = Math.max(0, Number(lineCursor) || 0);
      }
      if (!versionId || !item || chapterIndex < 0) {
        showToast('Project a Bible verse first');
        return false;
      }

      const pages = getPagesFromItem(item, true);
      if (!Array.isArray(pages) || !pages.length) return false;
      pageIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
      let targetIndex = pageIndex;
      if (cmd === 'next') targetIndex = Math.min(pages.length - 1, pageIndex + 1);
      else if (cmd === 'previous') targetIndex = Math.max(0, pageIndex - 1);
      else if (cmd === 'first') targetIndex = 0;
      else if (cmd === 'last') targetIndex = pages.length - 1;
      else return false;

      if (targetIndex === pageIndex) {
        if (cmd === 'next' || cmd === 'last') showToast('Already at the last verse of this chapter');
        else showToast('Already at the first verse of this chapter');
        return false;
      }

      setSidebarTab('bible');
      buttonContextTab = 'bible';
      if (activeBibleVersion !== versionId) {
        activeBibleVersion = versionId;
        renderVersionBar();
      }
      selectItem(chapterIndex, { skipButtonView: true });
      lineCursor = targetIndex;
      updateButtonView();
      projectLive(true);
      showToast(`Scripture ${cmd} verse`);
      return true;
    }

    function parseSpokenNumber(raw) {
      const text = String(raw || '').trim().toLowerCase();
      if (!text) return NaN;
      if (/^\d+$/.test(text)) return Number(text);
      const units = {
        zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
        ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
        seventeen: 17, eighteen: 18, nineteen: 19
      };
      const tens = {
        twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
      };
      const tokenSynonyms = {
        won: 'one', wan: 'one', on: 'one',
        to: 'two', too: 'two', tu: 'two',
        seek: 'six', seeks: 'six',
        fight: 'five', fights: 'five',
        ate: 'eight', eights: 'eight', eighth: 'eight', eigth: 'eight'
      };
      const tokens = text
        .replace(/[^a-z0-9\- ]+/g, ' ')
        .replace(/-/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => tokenSynonyms[token] || token);
      if (!tokens.length) return NaN;
      let value = 0;
      let current = 0;
      let consumedNumberToken = false;
      for (const token of tokens) {
        if (token === 'and' || token === 'the' || token === 'verse' || token === 'chapter') continue;
        if (Object.prototype.hasOwnProperty.call(units, token)) {
          current += units[token];
          consumedNumberToken = true;
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(tens, token)) {
          current += tens[token];
          consumedNumberToken = true;
          continue;
        }
        if (token === 'hundred') {
          current = (current || 1) * 100;
          consumedNumberToken = true;
          continue;
        }
        return NaN;
      }
      if (!consumedNumberToken) return NaN;
      value += current;
      return Number.isFinite(value) ? value : NaN;
    }

    function buildCurrentBibleChapterRef(verse) {
      if (!Number.isFinite(verse)) return '';
      let item = null;
      if (isLive && livePointer && livePointer.kind === 'bible') {
        const versionId = String(livePointer.version || '');
        const chapterIndex = Number(livePointer.index);
        item = (bibles && bibles[versionId] && bibles[versionId][chapterIndex]) ? bibles[versionId][chapterIndex] : null;
      } else if (sidebarTab === 'bible' && currentItem) {
        item = currentItem;
      }
      if (!item) return '';
      const extracted = extractBookAndChapter(item);
      const book = resolveBibleBookName(extracted.book || item.book || '');
      const chapter = Number(extracted.chap);
      if (!book || !Number.isFinite(chapter)) return '';
      return `${book} ${chapter}:${verse}`;
    }

    function rememberPendingBookChapter(normalizedText, ts) {
      const chapterOnly = normalizedText.match(/([1-3]?\s*[A-Za-z]+(?:\s+[A-Za-z]+){0,4})\s+chapter\s+([A-Za-z0-9\- ]+)$/i);
      if (chapterOnly) {
        const book = resolveBibleBookName(chapterOnly[1]);
        const chapter = parseSpokenNumber(chapterOnly[2]);
        if (book && Number.isFinite(chapter)) {
          aiPendingBookChapter = { book, chapter, ts };
          return;
        }
      }
      const compact = normalizedText.match(/([1-3]?\s*[A-Za-z]+(?:\s+[A-Za-z]+){0,4})\s+([A-Za-z0-9\- ]+)$/i);
      if (!compact) return;
      if (/\bverse\b/i.test(normalizedText)) return;
      const book = resolveBibleBookName(compact[1]);
      const chapter = parseSpokenNumber(compact[2]);
      if (book && Number.isFinite(chapter)) {
        aiPendingBookChapter = { book, chapter, ts };
      }
    }

    function extractScriptureRefFromTranscript(payload) {
      const text = String(payload?.text || '').trim();
      if (!text) return '';
      const ts = Number(payload?.ts || Date.now());
      if (aiPendingBookChapter && (ts - Number(aiPendingBookChapter.ts || 0) > AI_PENDING_CONTEXT_WINDOW_MS)) {
        aiPendingBookChapter = null;
      }

      const normalized = text
        .replace(/([A-Za-z])\s*-\s*([A-Za-z])/g, '$1 $2')
        .replace(/\bromance\b/gi, 'romans')
        .replace(/\bvasthen\b/gi, 'verse ten')
        .replace(/\b(verstain|bastain|basten)\b/gi, 'verse ten')
        .replace(/\b(v[ae]s+t?s?|vess|ves)\b/gi, 'verse')
        .replace(/\bversus\b/gi, 'verse')
        .replace(/\b(?:and\s+)?that'?s\s+([A-Za-z0-9\- ]+)$/i, ' verse $1')
        .replace(/[()\[\],;!?.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Do not let learned shortcuts override explicit chapter/verse speech.
      const learnedRef = getLearnedAiRef(text);
      if (learnedRef && !/\bverse\b/i.test(normalized)) {
        aiPendingBookChapter = null;
        return learnedRef;
      }

      const numericPattern = /([1-3]?\s*[A-Za-z]+(?:\s+[A-Za-z]+){0,4})\s+(\d{1,3})\s*[:.\-]\s*(\d{1,3})/;
      const numericMatch = normalized.match(numericPattern);
      if (numericMatch) {
        const book = resolveBibleBookName(numericMatch[1]);
        const chapter = Number(numericMatch[2]);
        const verse = Number(numericMatch[3]);
        if (book) {
          if (chapter >= 1 && verse >= 1) {
            aiPendingBookChapter = null;
            return `${book} ${chapter}:${verse}`;
          }
        }
      }

      const chapterVersePattern = /([1-3]?\s*[A-Za-z]+(?:\s+[A-Za-z]+){0,4})\s+chapter\s+([A-Za-z0-9\- ]+?)\s+verse\s+([A-Za-z0-9\- ]+)/i;
      const chapterVerseMatch = normalized.match(chapterVersePattern);
      if (chapterVerseMatch) {
        const book = resolveBibleBookName(chapterVerseMatch[1]);
        const chapter = parseSpokenNumber(chapterVerseMatch[2]);
        const verse = parseSpokenNumber(chapterVerseMatch[3]);
        if (book && Number.isFinite(chapter) && Number.isFinite(verse) && chapter >= 1 && verse >= 1) {
          aiPendingBookChapter = null;
          return `${book} ${chapter}:${verse}`;
        }
      }

      const chapterOnlyPattern = /([1-3]?\s*[A-Za-z]+(?:\s+[A-Za-z]+){0,4})\s+(\d{1,3})\s+verse\s+(\d{1,3})/i;
      const chapterOnlyMatch = normalized.match(chapterOnlyPattern);
      if (chapterOnlyMatch) {
        const book = resolveBibleBookName(chapterOnlyMatch[1]);
        const chapter = Number(chapterOnlyMatch[2]);
        const verse = Number(chapterOnlyMatch[3]);
        if (book) {
          if (chapter >= 1 && verse >= 1) {
            aiPendingBookChapter = null;
            return `${book} ${chapter}:${verse}`;
          }
        }
      }

      const spokenCompact = normalized.match(/([1-3]?\s*[A-Za-z]+(?:\s+[A-Za-z]+){0,4})\s+([A-Za-z0-9\- ]+?)\s+([A-Za-z0-9\- ]+)$/i);
      if (spokenCompact) {
        const book = resolveBibleBookName(spokenCompact[1]);
        const chapter = parseSpokenNumber(spokenCompact[2]);
        const verse = parseSpokenNumber(spokenCompact[3]);
        if (book && Number.isFinite(chapter) && Number.isFinite(verse) && chapter >= 1 && verse >= 1) {
          aiPendingBookChapter = null;
          return `${book} ${chapter}:${verse}`;
        }
      }

      const chapterOnlySpoken = normalized.match(/([1-3]?\s*[A-Za-z]+(?:\s+[A-Za-z]+){0,4})\s+([A-Za-z0-9\-]+)$/i);
      if (chapterOnlySpoken && !/\bverse\b/i.test(normalized)) {
        const book = resolveBibleBookName(chapterOnlySpoken[1]);
        const chapter = parseSpokenNumber(chapterOnlySpoken[2]);
        if (book && Number.isFinite(chapter) && chapter >= 1) {
          aiPendingBookChapter = { book, chapter, ts };
          return `${book} ${chapter}`;
        }
      }

      const verseOnly = normalized.match(/(?:^|\s)verse\s+([A-Za-z0-9\- ]+)$/i);
      if (verseOnly) {
        const verse = parseSpokenNumber(verseOnly[1]);
        if (Number.isFinite(verse) && verse >= 1) {
          if (aiPendingBookChapter && aiPendingBookChapter.chapter >= 1 && (ts - Number(aiPendingBookChapter.ts || 0) <= AI_PENDING_CONTEXT_WINDOW_MS)) {
            const ref = `${aiPendingBookChapter.book} ${aiPendingBookChapter.chapter}:${verse}`;
            aiPendingBookChapter = null;
            return ref;
          }
          const fallbackRef = buildCurrentBibleChapterRef(verse);
          if (fallbackRef) {
            aiPendingBookChapter = null;
            return fallbackRef;
          }
        }
      }

      rememberPendingBookChapter(normalized, ts);

      return '';
    }

    function applyAiScriptureSelection(payload) {
      const ref = getAiScriptureRef(payload);
      if (!ref) {
        updateAiRelayDebugState({ action: 'scripture ignored: empty ref' });
        return false;
      }
      const versionId = resolveBibleVersionFromAi(payload);
      updateAiRelayDebugState({ scripture: ref, action: `scripture received (${versionId || 'no version'})` });
      if (!versionId || !bibles[versionId]) {
        updateAiRelayDebugState({ action: `scripture failed: version missing (${versionId || 'none'})` });
        return false;
      }
      const parsed = parseBibleReferenceQuery(ref);
      if (!parsed) {
        updateAiRelayDebugState({ action: `scripture failed: parse error (${ref})` });
        return false;
      }
      const chapterMatch = findBibleReferenceChapter(versionId, parsed);
      if (!chapterMatch) {
        updateAiRelayDebugState({ action: `scripture failed: verse not found (${ref})` });
        return false;
      }

      const suppressLiveProject = !!(payload && payload.suppressLiveProject);
      setSidebarTab('bible');
      buttonContextTab = 'bible';
      if (activeBibleVersion !== versionId) {
        activeBibleVersion = versionId;
        renderVersionBar();
      }

      const verseStart = parsed.versePrefix || null;
      const idx = chapterMatch.chapterIndex;
      selectItem(idx, { skipButtonView: true });
      if (verseStart) {
        setBibleGroupAnchor(verseStart, currentItem);
        const pages = getPagesFromItem(currentItem, true);
        const pageIdx = pages.findIndex(p => matchesVerseStart(p.raw, verseStart));
        if (pageIdx !== -1) lineCursor = pageIdx;
      }
      updateButtonView();
      if (!suppressLiveProject) {
        projectLive(true);
      }

      if (currentItem) {
        const extracted = extractBookAndChapter(currentItem);
        addBibleRecentReference(buildBibleRefEntry(extracted.book, extracted.chap, verseStart, null, activeBibleVersion));
      }
      if (suppressLiveProject) {
        updateAiRelayDebugState({ action: `scripture staged (awaiting verse) (${ref})` });
      } else {
        updateAiRelayDebugState({ action: `scripture live projected (${ref})` });
        showToast(`Scripture live: ${ref}`);
      }
      return true;
    }

    function handleSyncMessage(d) {
      if (!d) return;
      updateAiRelayDebugState({ lastType: d.type || 'unknown' });
      if (d.type === 'PING') {
        if (d.__remoteMeta && d.__remoteMeta.viaRelay) {
          relaySend({ type: 'PONG', ts: Date.now() });
        }
        if (d.sender === 'display') {
          replayDisplaySyncState('display ping');
        }
        return;
      }
      if (d.type === 'PONG' || d.type === 'HELLO') {
        markDisplayOnline();
        if (d.type === 'PONG' && d.__remoteMeta && d.__remoteMeta.viaRelay) {
          remoteShowPendingPingAt = 0;
          remoteShowLastHeartbeatAt = Date.now();
          setRemoteShowConnectionState('connected');
          updateRelayUi();
        }
        if (d.type === 'HELLO' && (!d.sender || d.sender === 'display')) {
          if (!stateReady) {
            pendingHello = true;
          } else {
            replayDisplaySyncState('display hello');
          }
        }
        return;
      }
      if (d.type === 'STATE_REQUEST') {
        updateAiRelayDebugState({ action: 'state request received' });
        handleRelayStateRequest(d);
        return;
      }
      if (d.type === 'STATE_PUSH') {
        updateAiRelayDebugState({ action: `state push received (${Number(d.songCount || 0)} songs / ${Number(d.bibleCount || 0)} bibles)` });
        handleRelayStatePush(d);
        return;
      }
      if (d.type === 'ai:status') {
        const running = !!d.running;
        updateAiRelayDebugState({ action: running ? 'ai helper running' : 'ai helper stopped' });
        if (typeof window.bspSetAiHelperRunning === 'function') {
          try { window.bspSetAiHelperRunning(running); } catch (_) {}
        }
        return;
      }
      if (d.type === 'ai:scripture') {
        if (getAiHudSettings().aiMode === 'song') {
          updateAiLiveScriptureHud({ mode: 'song', transcript: String(d.text || '') });
          updateAiRelayDebugState({ action: 'scripture message ignored while AI song mode is active' });
          return;
        }
        const ref = getAiScriptureRef(d);
        const versionId = getPreferredAiLiveScriptureVersion(d);
        const parsedRef = ref ? parseBibleReferenceQuery(ref) : null;
        const refHasVerse = !!(parsedRef && parsedRef.versePrefix);
        const bestHit = buildAiDirectMatchFromRef(ref, versionId, 'direct-reference');
        if (ref) {
          aiLastScriptureRef = ref;
          aiLastScriptureAt = Date.now();
        }
        const suggestions = [];
        if (bestHit) suggestions.push(bestHit);
        const hudPayload = {
          transcript: String(d.text || ''),
          isFinal: true
        };
        if (bestHit) {
          hudPayload.bestHit = bestHit;
          hudPayload.suggestions = suggestions;
        }
        updateAiLiveScriptureHud(hudPayload);
        const settings = getAiHudSettings();
        updateAiRelayDebugState({
          scripture: ref || '-',
          action: (settings.autoProject && refHasVerse)
            ? 'ai:scripture received (auto project ON)'
            : (refHasVerse ? 'ai:scripture received (auto project OFF)' : 'ai:scripture chapter received (staged)')
        });
        if (ref && !refHasVerse) {
          applyAiScriptureSelection({
            ...d,
            suppressLiveProject: true
          });
        } else if (settings.autoProject) {
          applyAiScriptureSelection(d);
        }
        return;
      }
      if (d.type === 'ai:scripture-nav') {
        if (getAiHudSettings().aiMode === 'song') return;
        const nav = String(d.command || '');
        updateAiRelayDebugState({ action: `scripture nav command received (${nav || 'none'})` });
        navigateAiScriptureCommand(nav);
        return;
      }
      if (d.type === 'ai:transcript') {
        const transcriptText = String(d.text || '');
        const isFinal = !!d.isFinal;
        updateAiRelayDebugState({ transcript: transcriptText || '-', action: isFinal ? 'final transcript received' : 'partial transcript received' });
        if (getAiHudSettings().aiMode === 'song') {
          handleAiSongTranscript(d);
          return;
        }

        const versionId = getPreferredAiLiveScriptureVersion(d);
        let bestHit = null;
        let suggestions = [];

        const inferredRef = extractScriptureRefFromTranscript(d);
        if (inferredRef) {
          bestHit = buildAiDirectMatchFromRef(inferredRef, versionId, 'direct-reference');
          if (bestHit) suggestions = [bestHit];
        } else {
          const quotedCandidates = detectAiQuotedVerseCandidates(transcriptText, versionId, {
            minTokens: isFinal ? 6 : 2,
            minScore: isFinal ? 1.05 : 1.18,
            allowPrefix: !isFinal,
            limit: AI_LIVE_SCRIPTURE_MAX_SUGGESTIONS
          });
          suggestions = quotedCandidates;
          bestHit = quotedCandidates[0] || null;
        }

        const hudPayload = {
          transcript: transcriptText,
          isFinal
        };
        if (bestHit) {
          hudPayload.bestHit = bestHit;
          hudPayload.suggestions = suggestions;
        } else if (suggestions.length) {
          hudPayload.suggestions = suggestions;
        }
        updateAiLiveScriptureHud(hudPayload);

        // Auto-project direct references immediately (real-time) when autoProject is ON,
        // even on partial transcripts — so display is in sync with the HUD best hit arrival.
        if (bestHit && !String(bestHit.reason || '').startsWith('quoted-verse')) {
          const settingsEarly = getAiHudSettings();
          if (settingsEarly.autoProject) {
            const nowEarly = Date.now();
            const earlyRef = formatAiMatchRef(bestHit);
            const stageRef = earlyRef || String(bestHit.ref || '').trim();
            if (stageRef && !(stageRef === aiLastScriptureRef && (nowEarly - aiLastScriptureAt) < 6000)) {
              aiLastScriptureRef = stageRef;
              aiLastScriptureAt = nowEarly;
              applyAiScriptureSelection({
                ref: stageRef,
                versionId: bestHit.versionId || d.versionId || d.version || d.translation || null,
                suppressLiveProject: !earlyRef
              });
              if (!isFinal && earlyRef) teachAiLearning(d.text || '', earlyRef);
            }
          }
        }

        // Auto-project quoted/paraphrase matches in real-time when confidence is very high
        // and autoProjectQuoted is ON — mirrors real-time behaviour of direct references.
        const AI_QUOTED_REALTIME_THRESHOLD = 1.5;
        if (bestHit && String(bestHit.reason || '').startsWith('quoted-verse')) {
          const settingsQuoted = getAiHudSettings();
          if (settingsQuoted.autoProjectQuoted && typeof bestHit.confidence === 'number' && bestHit.confidence >= AI_QUOTED_REALTIME_THRESHOLD) {
            const nowQuoted = Date.now();
            const quotedRef = formatAiMatchRef(bestHit);
            if (quotedRef && !(quotedRef === aiLastScriptureRef && (nowQuoted - aiLastScriptureAt) < 6000)) {
              aiLastScriptureRef = quotedRef;
              aiLastScriptureAt = nowQuoted;
              applyAiScriptureSelection({ ref: quotedRef, versionId: bestHit.versionId || d.versionId || d.version || d.translation || null });
            }
          }
        }

        if (!isFinal) return;
        const navCommand = getAiNavigationCommand(d.text || '');
        if (navCommand) {
          updateAiRelayDebugState({ action: `scripture nav inferred (${navCommand})` });
          navigateAiScriptureCommand(navCommand);
          return;
        }
        if (!bestHit) {
          updateAiRelayDebugState({ action: 'transcript received but no scripture inferred' });
          return;
        }
        const now = Date.now();
        const bestRef = formatAiMatchRef(bestHit);
        const stageRef = bestRef || String(bestHit.ref || '').trim();
        if (stageRef && stageRef === aiLastScriptureRef && (now - aiLastScriptureAt) < 6000) return;
        aiLastScriptureRef = stageRef;
        aiLastScriptureAt = now;
        const isQuoted = String(bestHit.reason || '').startsWith('quoted-verse');
        const settings = getAiHudSettings();
        const shouldAutoProject = isQuoted ? settings.autoProjectQuoted : settings.autoProject;
        updateAiRelayDebugState({
          scripture: stageRef || '-',
          action: shouldAutoProject
            ? `scripture inferred from transcript (${isQuoted ? 'quoted' : 'direct'})`
            : `scripture detected (${isQuoted ? 'quoted' : 'direct'}) - auto project OFF`
        });
        if (!stageRef) return;
        if (!bestRef) {
          applyAiScriptureSelection({
            ref: stageRef,
            versionId: bestHit.versionId || d.versionId || d.version || d.translation || null,
            suppressLiveProject: true
          });
          return;
        }
        if (!shouldAutoProject) return;
        const applied = applyAiScriptureSelection({
          ref: stageRef,
          versionId: bestHit.versionId || d.versionId || d.version || d.translation || null
        });
        if (applied && !isQuoted) teachAiLearning(d.text || '', bestRef);
      }
    }

    function broadcastMessage(msg) {
      if (!isVmixMode() && channel) channel.postMessage(msg);
      relaySend(msg);
      if (isVmixMode() && window.BSPDesktop && typeof window.BSPDesktop.sendVmixOutputMessage === 'function') {
        window.BSPDesktop.sendVmixOutputMessage(msg).catch(() => {});
      }
      if (isVmixMode() && channel) channel.postMessage(msg);
      mirrorSyncMessage(msg);
    }

    function pingDisplays() {
      if (channel) channel.postMessage({ type: 'PING' });
      relaySend({ type: 'PING' });
    }

    if (channel) {
      channel.onmessage = (e) => {
        handleSyncMessage(e.data || {});
      };
    }
    aiLearningEntries = loadAiLearningEntries();
    setInterval(pingDisplays, 5000);
    setTimeout(renderAiRelayDebug, 0);

    function showToast(msg) {
      const toast = document.getElementById('toast');
      if (!toast) return;
      toast.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function scheduleLiveUpdate() {
      if (isRestoringBackup) return;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!isLive || !livePointer) return;
        if (pushLiveUpdate()) return;
        // If tab/context switches made the pointer stale, recover from loaded Bible item.
        if (livePointer.kind === 'bible' && recoverLiveBiblePointerFromCurrentItem()) {
          pushLiveUpdate();
        }
      });
    }

    function postUpdate(payload) {
      if (isRestoringBackup) return;
      const viewport = getEmbeddedDisplayViewport();
      const msg = {
        type: 'UPDATE',
        proto: 1,
        sender: 'control',
        ts: Date.now(),
        seq: nextSeq(),
        sceneLayers: getOutputSceneLayers(),
        displayViewportWidth: viewport.width,
        displayViewportHeight: viewport.height,
        ...payload
      };
      broadcastMessage(msg);
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ source: 'bsp-panel-parent', message: msg }, '*');
        }
      } catch (_) {}
      embeddedProgramDisplayState = { kind: 'update', payload: msg };
      syncEmbeddedProgramDisplay();
      syncStandaloneOutputDirect();
      syncLsProjectionPreview();
      lastLiveState = { kind: 'update', payload: msg };
      if (appState && appState.live) appState.live.lastLiveState = lastLiveState;
      schedulePersistAppState();
    }

    function postClear(opts = {}) {
      if (isRestoringBackup) return;
      const msg = {
        type: 'CLEAR',
        proto: 1,
        sender: 'control',
        ts: Date.now(),
        seq: nextSeq(),
        sceneLayers: getOutputSceneLayers()
      };
      if (opts.transitionDuration != null) msg.transitionDuration = opts.transitionDuration;
      if (opts.fade != null) msg.fade = !!opts.fade;
      broadcastMessage(msg);
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ source: 'bsp-panel-parent', message: msg }, '*');
        }
      } catch (_) {}
      embeddedProgramDisplayState = { kind: 'clear' };
      syncEmbeddedProgramDisplay();
      syncStandaloneOutputDirect();
      syncLsProjectionPreview();
      lastLiveState = { kind: 'clear' };
      if (appState && appState.live) appState.live.lastLiveState = lastLiveState;
      schedulePersistAppState();
    }


    function captureLiveRenderUiSnapshot() {
      const liveSettingsTab = (livePointer && livePointer.kind === 'songs') ? 'songs' : 'bible';
      const liveProjection = (typeof getProjectionSettingsSnapshotForTab === 'function')
        ? getProjectionSettingsSnapshotForTab(liveSettingsTab)
        : {};
      const pickNumber = (value, fallback) => {
        if (value == null || value === '') return Number(fallback);
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : Number(fallback);
      };
      return {
        fontFamily: liveProjection.fontFamily || document.getElementById('font-family')?.value || '',
        fontWeight: liveProjection.fontWeight || document.getElementById('font-weight')?.value || '700',
        fontSizeFull: pickNumber(liveProjection.fontSizeFull, document.getElementById('font-size-val')?.value || DEFAULT_SONG_FULL_FONT),
        lineHeightFull: pickNumber(liveProjection.lineHeightFull, document.getElementById('line-height-full')?.value || 1.1),
        lineHeightLT: pickNumber(liveProjection.lineHeightLT, document.getElementById('line-height-lt')?.value || 1.1),
        fullRefTextTransform: liveProjection.fullRefTextTransform || document.getElementById('full-ref-text-transform')?.value || fullRefTextTransform || 'uppercase',
        ltRefTextTransform: liveProjection.ltRefTextTransform || document.getElementById('lt-ref-text-transform')?.value || ltRefTextTransform || 'uppercase',
        refFontSize: pickNumber(liveProjection.refFontSize, document.getElementById('ref-font-size-val')?.value || 32),
        refPositionFull: liveProjection.refPositionFull || document.getElementById('ref-position-full')?.value || 'top',
        fullOffsetX: pickNumber(liveProjection.fullOffsetX, document.getElementById('full-offset-x')?.value || 0),
        fullOffsetY: pickNumber(liveProjection.fullOffsetY, document.getElementById('full-offset-y')?.value || 0),
        transitionType: document.getElementById('song-transition-type')?.value || 'fade',
        animateBgTransitions: !!document.getElementById('animate-bg-transitions')?.checked,
        showVersion: liveProjection.showVersion != null ? !!liveProjection.showVersion : !!document.getElementById('show-version')?.checked,
        textColor: liveProjection.textColor || document.getElementById('text-color')?.value || '#ffffff',
        refColor: liveProjection.refColor || document.getElementById('ref-color')?.value || '#ffffff',
        refBgColor: liveProjection.refBgColor || document.getElementById('ref-bg-color')?.value || '#FFD500',
        showVerseNos: liveProjection.showVerseNos != null ? !!liveProjection.showVerseNos : !!document.getElementById('show-verse-nos')?.checked,
        autoResizeFull: liveProjection.autoResizeFull || document.getElementById('auto-resize-full')?.value || 'shrink',
        autoResizeLT: liveProjection.autoResizeLT || document.getElementById('auto-resize-lt')?.value || 'shrink',
        ltWidthPct: pickNumber(liveProjection.ltWidthPct, document.getElementById('lt-width-pct')?.value || 100),
        ltScalePct: pickNumber(liveProjection.ltScalePct, document.getElementById('lt-scale-pct')?.value || 100),
        ltOffsetX: pickNumber(liveProjection.ltOffsetX, document.getElementById('lt-offset-x')?.value || 0),
        ltOffsetY: pickNumber(liveProjection.ltOffsetY, document.getElementById('lt-offset-y')?.value || 0),
        ltBorderRadius: pickNumber(liveProjection.ltBorderRadius, document.getElementById('lt-border-radius')?.value || 0),
        padLR: pickNumber(document.getElementById('pad-lr-lt')?.value, 5),
        padLRFull: pickNumber(document.getElementById('pad-lr-full')?.value, 5),
        padLRLT: pickNumber(document.getElementById('pad-lr-lt')?.value, 5)
      };
    }

    function pushLiveUpdate() {
      if (!isLive || !livePointer) return false;
      const effectiveLiveLinesPerPage = Math.max(1, Number(liveLinesPerPage) || Number(linesPerPage) || 1);
      const liveBgState = getEffectiveLiveBackgroundState();
      const effectiveLiveRatio = liveRatio || activeRatio || 'full';
      const liveTextTransforms = getEffectiveLiveTextTransformState();
      const ui = captureLiveRenderUiSnapshot();
      const activeFullRefTextTransform = ui.fullRefTextTransform || 'uppercase';
      const activeLtRefTextTransform = ui.ltRefTextTransform || 'uppercase';
      let liveItem = null;
      if (livePointer.source === 'schedule') {
        liveItem = schedule[livePointer.index];
      } else if (livePointer.kind === 'bible') {
        liveItem = (bibles[livePointer.version] ? bibles[livePointer.version][livePointer.index] : null);
      } else {
        liveItem = songs[livePointer.index];
      }
      if (!liveItem) return false;
      const pendingSongSnapshot = (livePointer.kind === 'songs' && aiPendingSongPageSnapshot &&
        aiPendingSongPageSnapshot.songIndex === livePointer.index)
        ? aiPendingSongPageSnapshot.pageSnapshot
        : null;
      if (pendingSongSnapshot) livePointer.pageSnapshot = pendingSongSnapshot;
      const livePageSnapshot = livePointer.pageSnapshot || null;
      const pages = livePageSnapshot
        ? [livePageSnapshot]
        : getPagesFromItem(liveItem, livePointer.kind === 'bible', effectiveLiveLinesPerPage);
      if (!pages.length) return false;
      liveLineCursor = Math.max(0, Math.min(liveLineCursor, pages.length - 1));
      const p = pages[liveLineCursor]; if (!p) return false;
      const mode = effectiveLiveRatio;
      const fontFamily = ui.fontFamily;
      const fontWeight = ui.fontWeight;
      const scheduleFontOverride = (livePointer.source === 'schedule' && liveItem && Number.isFinite(liveItem.fontSizeSnapshot))
        ? Number(liveItem.fontSizeSnapshot)
        : null;
      let fontSizeFull = (scheduleFontOverride != null)
        ? scheduleFontOverride
        : ui.fontSizeFull;
      const fontSizeLT = (mode === 'custom') ? ltFontCustom : ((liveKind === 'bible') ? ltFontBible : ltFontSongs);
      const lineHeightFull = ui.lineHeightFull;
      const lineHeightLT = ui.lineHeightLT;
      const refFontSize = ui.refFontSize;
      const refPositionFull = ui.refPositionFull;
      const refAlignFull = fullRefHAlign || 'center';
      const verseAlignFull = fullHAlign || 'center';
      const bgEnabled = !!liveBgState.bgEnabled;
      const bgType = liveBgState.bgType || 'color';
      const bgOpacity = Number.isFinite(liveBgState.bgOpacity) ? liveBgState.bgOpacity : 1;
      const bgY = Number(liveBgState.bgY || 0);
      const bgColor = liveBgState.bgColor || '#111CB0';
      bgGradientShadow = liveBgState.bgGradientShadow || '#AD0000';
      bgGradientHighlight = liveBgState.bgGradientHighlight || '#000000';
      const bgModeValue = liveBgState.bgMode || bgMode;
      const bgImage = liveBgState.bgImage || null;
      const bgVideo = liveBgState.bgVideo || null;
      const bgVideoLoop = !!liveBgState.bgVideoLoop;
      const bgVideoSpeed = Number.isFinite(liveBgState.bgVideoSpeed) ? liveBgState.bgVideoSpeed : 1;
      const bgBlur = Number.isFinite(liveBgState.bgBlur) ? liveBgState.bgBlur : 0;
      const bgEdgeFix = !!liveBgState.bgEdgeFix;
      const transitionType = ui.transitionType;
      const transitionDuration = getCurrentTransitionDuration();
      const animateBgTransitions = ui.animateBgTransitions;
      const textXRaw = 0;
      const textYRaw = 1080;
      const padLRFullRaw = Number.isFinite(ui.padLRFull) ? ui.padLRFull : (Number.isFinite(ui.padLR) ? ui.padLR : 5);
      const padLRLTRaw = Number.isFinite(ui.padLRLT) ? ui.padLRLT : (Number.isFinite(ui.padLR) ? ui.padLR : 5);
      const padBRaw = 0;
      const showVersion = ui.showVersion;
      const textColor = ui.textColor;
      const refColor = ui.refColor;
      const refBgColor = ui.refBgColor;
      const verseShadowStyle = verseShadowEnabled ?
        'text-shadow:0 10px 28px rgba(0,0,0,0.55);' :
        'text-shadow:none;';
      const showVerseNos = ui.showVerseNos;
      let verseRaw = p.text;
      // console.log('Original verse text:', verseRaw);
      if (!showVerseNos) {
        verseRaw = verseRaw.replace(/<span class="jo-verse-sup">.*?<\/span>\s*/g, '');
      }
      // let verseHtml = convertHighlightsToHtml(verseRaw.toUpperCase()); // convert all output text to uppercase
      let verseHtml = convertHighlightsToHtml(verseRaw);
      
      let fontSizeAdjusted = fontSizeLT;
      let lineHeightAdjusted = lineHeightLT;
      let fontSizeFullAdjusted = fontSizeFull;
      let lineHeightFullAdjusted = lineHeightFull;
      const useCustomStyle = effectiveLiveRatio === 'custom';
      const baseStyle = ltStyles[ltStyle] || ltStyles['custom'] || {};
      const pendingChanges = (tempStyleChanges && editingStyleId === ltStyle) ? tempStyleChanges : null;
      const styleData = useCustomStyle
        ? (pendingChanges ? { ...baseStyle, ...pendingChanges } : baseStyle)
        : (ltStyles['custom'] || {});
      const autoResize = (useCustomStyle && styleData.autoResize) ? styleData.autoResize : 'none';
      const autoResizeFull = ui.autoResizeFull;
      const autoResizeLT = ui.autoResizeLT;
      const textX = useCustomStyle ? 0 : textXRaw;
      const textY = useCustomStyle ? 860 : textYRaw;
      const padLRFull = useCustomStyle ? 0 : padLRFullRaw;
      const padLRLT = useCustomStyle ? 0 : padLRLTRaw;
      const padLR = mode === 'full' ? padLRFull : padLRLT;
      const padB = useCustomStyle ? 0 : padBRaw;
      const verseCount = p.verseCount || 1;
      const longVerseSourceFontSize = scheduleFontOverride ?? fontSizeFull;
      const primaryRawText = p.raw || '';
      let dynamicHeight = getLtBgHeightPct(verseCount);
      let dualSecondaryRaw = '';
      const storedDualSnapshot = (liveItem && liveItem.dualSnapshot) ? liveItem.dualSnapshot : null;
      const globalDualActive = dualVersionModeEnabled && !!dualVersionSecondaryId && !useCustomStyle &&
        livePointer.kind === 'bible';
      const isStoredDualActive = !!storedDualSnapshot;
      const dualActive = isStoredDualActive || globalDualActive;
      const shouldAutoReduceForDual = globalDualActive && !isStoredDualActive && livePointer.source !== 'schedule';
      const dualMeasurementRaw = shouldAutoReduceForDual
        ? resolveDualSecondaryRawForMeasurement(storedDualSnapshot, dualVersionSecondaryId, livePointer, liveLineCursor, liveItem)
        : '';
      const prefitDualSecondaryRaw = dualMeasurementRaw || (storedDualSnapshot ? (storedDualSnapshot.raw || '') : '');
      const singleBibleFullMaxFont = (typeof SINGLE_BIBLE_FULL_MAX_FONT === 'number') ? SINGLE_BIBLE_FULL_MAX_FONT : 60;
      const singleBibleLtMaxFont = (typeof SINGLE_BIBLE_LT_MAX_FONT === 'number') ? SINGLE_BIBLE_LT_MAX_FONT : 30;
      const dualBibleFullMaxFont = (typeof DUAL_BIBLE_FULL_MAX_FONT === 'number') ? DUAL_BIBLE_FULL_MAX_FONT : 37;
      const dualBibleLtMaxFont = (typeof DUAL_BIBLE_LT_MAX_FONT === 'number') ? DUAL_BIBLE_LT_MAX_FONT : 23;
      const ltRefSize = ltRefFontSize || refFontSize;
      const allowLtRefBg = true;
      const ltRefAlignValue = (ltHAlignBible === 'justify')
        ? 'left'
        : (['left', 'right', 'center'].includes(ltHAlignBible) ? ltHAlignBible : 'center');
      
      if (autoResize !== 'none' && mode !== 'full') {
        const lines = (p.raw || "").split('\n').length;
        if (autoResize === 'shrink' && lines > 2) {
          fontSizeAdjusted = Math.max(24, fontSizeLT - (lines - 2) * 3);
          lineHeightAdjusted = Math.max(1.0, lineHeightLT - (lines - 2) * 0.1);
        } else if (autoResize === 'grow' && lines < 2) {
          fontSizeAdjusted = Math.min(80, fontSizeLT + (2 - lines) * 5);
        }
      }

      if (mode !== 'full' && livePointer.kind === 'bible') {
        const bibleLtMaxFont = dualActive ? dualBibleLtMaxFont : singleBibleLtMaxFont;
        fontSizeAdjusted = Math.min(fontSizeAdjusted, bibleLtMaxFont);
      }

      const isBibleLtVerse = livePointer && livePointer.kind === 'bible';
      const activeBibleContent = getIsBibleItem(currentItem) || (livePointer && livePointer.kind === 'bible');
      const shouldAutoExpandBibleLtHeight = !useCustomStyle &&
        mode !== 'full' &&
        effectiveLiveLinesPerPage <= 4 &&
        isBibleLtVerse &&
        activeBibleContent;
      if (shouldAutoExpandBibleLtHeight) {
        const baseWidth = (styleCanvasBaseSize && styleCanvasBaseSize.width) ? styleCanvasBaseSize.width : 1920;
        const padValue = Number.isFinite(ui.padLRLT) ? ui.padLRLT : ui.padLR;
        const sidePadPct = Math.max(0, Math.min(45, padValue));
        const textWidthPx = Math.max(240, (baseWidth * (1 - (2 * (sidePadPct / 100)))) - 20);
        const displayLines = estimateWrappedLineCount(getAutoResizeMeasureText(p.raw, true), textWidthPx, fontSizeAdjusted, fontFamily, fontWeight);
        const targetLines = Math.max(effectiveLiveLinesPerPage, displayLines);
        dynamicHeight = Math.max(dynamicHeight, calculateLtHeightPctFromLines(targetLines));
      }
      if (dualActive && mode !== 'full' && prefitDualSecondaryRaw) {
        const dualLines = getDualModeLineTarget(primaryRawText, prefitDualSecondaryRaw);
        const dualHeightPct = calculateLtHeightPctFromLines(dualLines, 2);
        dynamicHeight = Math.max(dynamicHeight, dualHeightPct);
      }
      if (!useCustomStyle && mode !== 'full' && autoResizeLT !== 'none') {
        const baseWidth = (styleCanvasBaseSize && styleCanvasBaseSize.width) ? styleCanvasBaseSize.width : 1920;
        const baseHeight = (styleCanvasBaseSize && styleCanvasBaseSize.height) ? styleCanvasBaseSize.height : 1080;
        const isBibleLT = livePointer.kind === 'bible';
        const ltText = getAutoResizeMeasureText(p.raw, isBibleLT);
        const sidePadPct = isBibleLT ? (padLRLT || 0) : (padLRLT || 5);
        const maxWidthPx = Math.max(240, (baseWidth * (1 - (2 * sidePadPct / 100))) - 20);
        const ltHeightPx = Math.max(120, baseHeight * (dynamicHeight / 100));
        const availableHeightPx = Math.max(120, ltHeightPx - 20);
        const minSize = 18;
        const maxSize = isBibleLT
          ? (dualActive ? dualBibleLtMaxFont : singleBibleLtMaxFont)
          : 120;
        const fitsAt = (sizePt) => {
          const lines = estimateWrappedLineCount(ltText, maxWidthPx, sizePt, fontFamily, fontWeight);
          const height = estimateFullTextHeightPx(lines, sizePt, lineHeightAdjusted, isBibleLT, refFontSize);
          return height <= availableHeightPx;
        };
        if (autoResizeLT === 'shrink') {
          if (!fitsAt(fontSizeAdjusted)) {
            let lo = minSize;
            let hi = Math.max(minSize, Math.floor(fontSizeAdjusted));
            let best = null;
            while (lo <= hi) {
              const mid = Math.floor((lo + hi) / 2);
              if (fitsAt(mid)) {
                best = mid;
                lo = mid + 1;
              } else {
                hi = mid - 1;
              }
            }
            fontSizeAdjusted = Math.max(minSize, best != null ? best : minSize);
          }
        } else if (autoResizeLT === 'grow') {
          let lo = minSize;
          let hi = Math.floor(maxSize);
          let best = null;
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (fitsAt(mid)) {
              best = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          if (best != null) {
            fontSizeAdjusted = Math.max(minSize, best);
          } else {
            fontSizeAdjusted = minSize;
          }
        }
      }
      
      const isBibleFull = (mode === 'full') && livePointer.kind === 'bible';
      const longVerseFullKey = isBibleFull ? `${livePointer.version}#${liveLineCursor}` : null;
      if (mode === 'full') {
        const baseWidth = (styleCanvasBaseSize && styleCanvasBaseSize.width) ? styleCanvasBaseSize.width : 1920;
        const baseHeight = (styleCanvasBaseSize && styleCanvasBaseSize.height) ? styleCanvasBaseSize.height : 1080;
        const baseFullFontSize = (isBibleFull && typeof getLongVerseFullFontBaseSize === 'function')
          ? getLongVerseFullFontBaseSize(fontSizeFull)
          : Number(fontSizeFull || DEFAULT_BIBLE_FULL_FONT);
        const fullText = getAutoResizeMeasureText(p.raw, isBibleFull);
        const dualFullText = dualMeasurementRaw
          || ((storedDualSnapshot && storedDualSnapshot.raw) ? getAutoResizeMeasureText(storedDualSnapshot.raw, true) : '');
        // Match the 20px horizontal margins used in full-screen HTML.
        const maxWidthPx = Math.max(320, baseWidth - 40);
        handleLongVerseFullFontState(false, longVerseFullKey, 0.8, baseFullFontSize);
        fontSizeFull = baseFullFontSize;
        if (isBibleFull) {
          const bibleFullMaxFont = dualActive ? dualBibleFullMaxFont : singleBibleFullMaxFont;
          fontSizeFull = Math.min(fontSizeFull, bibleFullMaxFont);
        }
        fontSizeFullAdjusted = fontSizeFull;
        const availableHeightPx = Math.max(200, baseHeight - 40);
        const minSize = 24;
        const maxSize = isBibleFull
          ? (dualActive ? dualBibleFullMaxFont : singleBibleFullMaxFont)
          : 200;
        const isDualFull = !!(dualActive && dualFullText);
        const measureFullHeightAt = (sizePt) => {
          const primaryLines = estimateWrappedLineCount(fullText, maxWidthPx, sizePt, fontFamily, fontWeight);
          const primaryHeight = estimateFullTextHeightPx(primaryLines, sizePt, lineHeightFull, isBibleFull, refFontSize);
          if (!isDualFull) return primaryHeight;
          const secondaryLines = estimateWrappedLineCount(dualFullText, maxWidthPx, sizePt, fontFamily, fontWeight);
          const secondaryHeight = estimateFullTextHeightPx(secondaryLines, sizePt, lineHeightFull, true, refFontSize);
          const dualSeparatorHeightPx = Math.max(24, sizePt * (96 / 72) * 0.9);
          return primaryHeight + secondaryHeight + dualSeparatorHeightPx;
        };
        if (autoResizeFull === 'shrink') {
          const fitsAt = (sizePt) => {
            return measureFullHeightAt(sizePt) <= availableHeightPx;
          };
          if (!fitsAt(fontSizeFull)) {
            let lo = minSize;
            let hi = Math.floor(fontSizeFull);
            let best = null;
            while (lo <= hi) {
              const mid = Math.floor((lo + hi) / 2);
              if (fitsAt(mid)) {
                best = mid;
                lo = mid + 1;
              } else {
                hi = mid - 1;
              }
            }
            fontSizeFullAdjusted = Math.max(minSize, best != null ? best : minSize);
          }
        } else if (autoResizeFull === 'grow') {
          const fitsAt = (sizePt) => {
            return measureFullHeightAt(sizePt) <= availableHeightPx;
          };
          let lo = minSize;
          let hi = Math.floor(maxSize);
          let best = null;
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (fitsAt(mid)) {
              best = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          if (best != null) {
            fontSizeFullAdjusted = Math.max(minSize, best);
          } else {
            fontSizeFullAdjusted = minSize;
          }
        }
      } else {
        handleLongVerseFullFontState(false, longVerseFullKey);
      }
    
      let bibleVer = '';
      let songTextPair = null;
      if (livePointer.kind === 'bible') {
        let bibleRef = getBibleRefForPage(liveItem, p.raw, p.verseCount);
        bibleVer = formatBibleVersionLabel(liveItem.version || "");
        if (livePointer.source === 'schedule' && liveItem && typeof liveItem.title === 'string') {
          const suffix = liveItem.version ? ` (${formatBibleVersionLabel(liveItem.version)})` : '';
          const baseTitle = liveItem.title.replace(/\s*\([^)]*\)\s*$/, '');
          bibleRef = baseTitle.trim() || bibleRef;
          if (suffix && bibleRef.endsWith(suffix)) {
            bibleVer = '';
          }
        }
        const verText = (showVersion && bibleVer) ? ` (${bibleVer})` : "";
        const referenceLabel = `${bibleRef}${verText}`;
        const ltRefSize = ltRefFontSize || refFontSize;
        const allowLtRefBg = true;
        const ltRefAlignValue = (ltHAlignBible === 'justify')
          ? 'left'
          : (['left', 'right', 'center'].includes(ltHAlignBible) ? ltHAlignBible : 'center');
        
        let primarySegment = '';
        if (mode === 'full') {
          primarySegment = buildFullBibleSegment({
            referenceLabel,
            verseHtml,
            refSize: refFontSize,
            refColor,
            refBgColor,
            verseAlign: verseAlignFull,
            refAlign: refAlignFull,
            verseShadowStyle,
            refPosition: refPositionFull,
            refTextTransform: activeFullRefTextTransform
          });
        } else if (useCustomStyle) {
          primarySegment = `<div class="jo-body" style="padding-left:60px;${verseShadowStyle}">${verseHtml}</div>`;
        } else {
          primarySegment = buildLtBibleSegment({
            referenceLabel,
            verseHtml,
            refSize: ltRefSize,
            refColor,
            refBgColor,
            alignValue: ltRefAlignValue,
            verseShadowStyle,
            allowBackground: allowLtRefBg,
            padding: '3px 16px',
            borderRadius: '5px',
            refTextTransform: activeLtRefTextTransform
          });
        }
        outHtml = primarySegment;
      } else {
        songTextPair = livePointer.pageSnapshot
          ? { primaryHtml: verseHtml, secondaryHtml: '', bilingualEnabled: false, renderMode: 'ai-line' }
          : getProjectedSongTextPair(liveItem, liveLineCursor, effectiveLiveLinesPerPage);
        const songPrimaryHtml = songTextPair.primaryHtml || verseHtml;
        const songSecondaryHtml = songTextPair.secondaryHtml || '';
        const bilingualSettings = getSongBilingualSettings();
        if (mode !== 'full' && useCustomStyle) {
          outHtml = `<div class="jo-body" style="padding-left:60px;${verseShadowStyle}">${songPrimaryHtml}</div>`;
        } else if (mode === 'full') {
          outHtml = `<div class="jo-body" style="text-align:center;${verseShadowStyle}">${songPrimaryHtml}</div>`;
        } else {
          outHtml = `<div class="jo-body" style="${verseShadowStyle}">${songPrimaryHtml}</div>`;
        }
        if (songTextPair.bilingualEnabled && songSecondaryHtml) {
          outHtml = buildStackedSongBilingualHtml(outHtml, songSecondaryHtml, bilingualSettings.secondaryFontScale);
        }
      }
      let dualSectionHtml = '';
      if (dualActive) {
        let secondarySegment = '';
        if (storedDualSnapshot) {
          dualSecondaryRaw = storedDualSnapshot.raw || '';
          const secondaryLabel = storedDualSnapshot.referenceLabel || '';
          const secondaryText = storedDualSnapshot.text || '';
          secondarySegment = (mode === 'full')
            ? buildFullBibleSegment({
              referenceLabel: secondaryLabel,
              verseHtml: secondaryText,
              refSize: refFontSize,
              refColor,
              refBgColor,
              verseAlign: verseAlignFull,
              refAlign: refAlignFull,
              verseShadowStyle,
              refPosition: refPositionFull,
              refTextTransform: activeFullRefTextTransform
            })
            : buildLtBibleSegment({
              referenceLabel: secondaryLabel,
              verseHtml: secondaryText,
              refSize: ltRefSize,
              refColor,
              refBgColor,
              alignValue: ltRefAlignValue,
              verseShadowStyle,
              allowBackground: allowLtRefBg,
              padding: '3px 16px',
              borderRadius: '5px',
              refTextTransform: activeLtRefTextTransform
            });
        } else {
          const secondaryList = bibles[dualVersionSecondaryId];
          const chapterIndexForSecondary = getDualBibleChapterIndex(liveItem, livePointer);
          const secondaryItem = (secondaryList && chapterIndexForSecondary != null)
            ? secondaryList[chapterIndexForSecondary]
            : (secondaryList ? secondaryList[livePointer.index] : null);
          if (secondaryItem) {
            const secondaryPages = getPagesFromItem(secondaryItem, true, effectiveLiveLinesPerPage);
            const secondaryPage = secondaryPages[Math.min(liveLineCursor, Math.max(0, secondaryPages.length - 1))] || secondaryPages[0];
            if (secondaryPage) {
              dualSecondaryRaw = secondaryPage.raw || '';
              let secondText = secondaryPage.text;
              if (!showVerseNos) {
                secondText = secondText.replace(/<span class="jo-verse-sup">.*?<\/span>\s*/g, '');
              }
              secondText = convertHighlightsToHtml(secondText);
              const secondaryRef = getBibleRefForPage(secondaryItem, secondaryPage.raw, secondaryPage.verseCount);
              const secondaryVersionLabel = formatBibleVersionLabel(secondaryItem.version || "");
              const secondaryVerText = (showVersion && secondaryVersionLabel) ? ` (${secondaryVersionLabel})` : "";
              const secondaryLabel = `${secondaryRef}${secondaryVerText}`;
              secondarySegment = (mode === 'full')
                ? buildFullBibleSegment({
                  referenceLabel: secondaryLabel,
                  verseHtml: secondText,
                  refSize: refFontSize,
                  refColor,
                  refBgColor,
                  verseAlign: verseAlignFull,
                  refAlign: refAlignFull,
                  verseShadowStyle,
                  refPosition: refPositionFull,
                  refTextTransform: activeFullRefTextTransform
                })
                : buildLtBibleSegment({
                  referenceLabel: secondaryLabel,
                  verseHtml: secondText,
                  refSize: ltRefSize,
                  refColor,
                  refBgColor,
                  alignValue: ltRefAlignValue,
                  verseShadowStyle,
                  allowBackground: allowLtRefBg,
                  padding: '3px 16px',
                  borderRadius: '5px',
                  refTextTransform: activeLtRefTextTransform
                });
            }
          }
        }
        if (secondarySegment) {
          dualSectionHtml = (mode === 'full')? `<div class="dual-secondary-wrapper">${secondarySegment}</div>` : `<div class="dual-secondary-wrapper-lt" style="width:50%;height:100%;">${secondarySegment}</div>`;
        }
      }

      if (dualSectionHtml) {
        outHtml = (mode === 'full')? `<div class="dual-primary-block">${outHtml}</div>${dualSectionHtml}` : `<div style="width:100%;height:100%;display:flex;flex-direction:row;"><div class="dual-primary-block" style="width:50%;height:100%;">${outHtml}</div>${dualSectionHtml}</div>`;
      }
      const payload = {
        text: outHtml,
        mode,
        isBible: livePointer.kind === 'bible',
        fontFamily,
        fontWeight,
        fontSizeFull: fontSizeFullAdjusted,
        fontSizeLT: fontSizeAdjusted,
        fullRefFontSize: refFontSize,
        ltRefFontSize: ltRefSize,
        lineHeightFull: lineHeightFullAdjusted,
        lineHeightLT: lineHeightAdjusted,
        ltWidthPct: ui.ltWidthPct,
        ltScalePct: ui.ltScalePct,
        ltOffsetX: ui.ltOffsetX,
        ltOffsetY: ui.ltOffsetY,
        ltBorderRadius: ui.ltBorderRadius,
        linesPerPage: effectiveLiveLinesPerPage,
        ltBgHeightPct: dynamicHeight,
        bgEnabled,
        bgType,
        bgColor,
        bgMode: bgModeValue,
        bgGradientShadow,
        bgGradientHighlight,
        bgGradientAngle: liveBgState.bgGradientAngle || 135,
        bgImage,
        bgVideo,
        bgVideoLoop,
        bgVideoSpeed,
        bgOpacity,
        bgBlur,
        bgEdgeFix,
        bgY,
        textX,
        textY,
        padLR,
        padLRFull,
        padLRLT,
        padB,
        fullTextTransform: liveTextTransforms.full || 'uppercase',
        ltTextTransform: liveTextTransforms.lt || 'uppercase',
        ltStyle: useCustomStyle ? ltStyle : 'custom',
        styleData: useCustomStyle ? styleData : null,
        customFonts,
        transitionType,
        transitionDuration,
        animateBgTransitions,
        textColor,
        bibleRef: livePointer.kind === 'bible' ? getBibleRefForPage(liveItem, p.raw, p.verseCount) : '',
        bibleVersion: (showVersion && livePointer.kind === 'bible') ? bibleVer : '',
        verseCount: p.verseCount || 0,
        lineCount: (p.raw || "").split('\n').length,
        autoAdjustLtHeight: autoAdjustLtHeight,
        hAlignFull: fullHAlign,
        vAlignFull: fullVAlign,
        // Lower third alignment (songs and bible variants)
        hAlignLT: ltHAlignSongs,
        vAlignLT: ltVAlignSongs,
        ltAnchorMode,
        hAlignLTBible: ltHAlignBible,
        vAlignLTBible: ltVAlignBible,
        hAlignLTBibleVerse: ltHAlignBibleVerse,
        autoResizeFull: ui.autoResizeFull || 'none',
        refPositionFull: refPositionFull,
        fullOffsetX: ui.fullOffsetX,
        fullOffsetY: ui.fullOffsetY,
        autoResizeLT: autoResizeLT,
        dualVersionMode: !!dualSectionHtml,
        dualVersionSecondaryId: dualVersionSecondaryId || null,
        dualVersionPrimaryId: (livePointer.kind === 'bible') ? livePointer.version : null,
        bilingualEnabled: livePointer.kind === 'songs' && !!(songTextPair &&
          songTextPair.bilingualEnabled),
        translatedText: livePointer.kind === 'songs' ? ((songTextPair && songTextPair.secondaryHtml) || '') : '',
        secondaryFontScale: getSongBilingualSettings().secondaryFontScale
      };
      postUpdate(payload);
      return true;
    }
