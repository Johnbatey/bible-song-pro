(() => {
  'use strict';

  const AUTOSAVE_KEY = 'bsp_media_workspace_autosave_v1';
  const SETTINGS_KEY = 'bsp_media_settings_v1';
  const DEFAULT_SETTINGS = {
    fit: 'contain',
    transition: 'fade',
    easing: 'ease',
    bgColor: '#000000',
    volume: 0.8,
    loop: false,
    restoreSession: true
  };
  const $ = (id) => document.getElementById(id);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  let mediaSettings = { ...DEFAULT_SETTINGS };
  let slides = [];
  let currentIndex = -1;
  let selectedIndex = -1;
  let lastOutputIndex = -1;
  let undoStack = [];
  let redoStack = [];
  let outputVolume = 0.8;
  let isLooping = false;
  let previewMuted = false;
  let previewMediaEl = null;
  let scrubTimer = null;
  let coverPos = { x: 50, y: 50 };
  let coverDrag = null;

  function showToast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isMediaTab() {
    return document.body.dataset.sidebarTab === 'media';
  }

  const currentFit = () => $('media-fit')?.value || mediaSettings.fit;
  const currentTransition = () => $('media-transition')?.value || mediaSettings.transition;
  const currentEasing = () => $('media-easing')?.value || mediaSettings.easing;
  const currentBgColor = () => $('media-bg-color')?.value || mediaSettings.bgColor;

  function pushUndo() {
    undoStack.push(JSON.stringify({ slides, currentIndex, outputVolume, isLooping, coverPos }));
    if (undoStack.length > 40) undoStack.shift();
    redoStack = [];
  }

  function restoreSnapshot(raw) {
    try {
      const data = JSON.parse(raw);
      slides = Array.isArray(data.slides) ? data.slides : [];
      currentIndex = Number.isFinite(data.currentIndex) ? data.currentIndex : (slides.length ? 0 : -1);
      outputVolume = Number.isFinite(data.outputVolume) ? clamp(data.outputVolume, 0, 1) : 0.8;
      isLooping = !!data.isLooping;
      coverPos = data.coverPos && Number.isFinite(data.coverPos.x) && Number.isFinite(data.coverPos.y)
        ? { x: clamp(data.coverPos.x, 0, 100), y: clamp(data.coverPos.y, 0, 100) }
        : { x: 50, y: 50 };
      selectedIndex = currentIndex;
      render();
      setPreview(currentIndex);
      autosave();
    } catch (_) {}
  }

  function autosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ slides, currentIndex, outputVolume, isLooping, coverPos }));
    } catch (_) {}
  }

  function loadAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) restoreSnapshot(raw);
    } catch (_) {}
  }

  function normalizeSettings(raw) {
    const source = (raw && typeof raw === 'object') ? raw : {};
    const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
    return {
      fit: oneOf(source.fit, ['contain', 'cover', 'blur'], DEFAULT_SETTINGS.fit),
      transition: oneOf(source.transition, ['fade', 'cut', 'slide', 'zoom'], DEFAULT_SETTINGS.transition),
      easing: oneOf(source.easing, ['ease', 'linear', 'ease-in', 'ease-out'], DEFAULT_SETTINGS.easing),
      bgColor: /^#[0-9a-f]{6}$/i.test(String(source.bgColor || '')) ? String(source.bgColor) : DEFAULT_SETTINGS.bgColor,
      volume: Number.isFinite(Number(source.volume)) ? clamp(Number(source.volume), 0, 1) : DEFAULT_SETTINGS.volume,
      loop: source.loop === true,
      restoreSession: source.restoreSession !== false
    };
  }

  function loadSettings() {
    try {
      mediaSettings = normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
    } catch (_) {
      mediaSettings = { ...DEFAULT_SETTINGS };
    }
    return mediaSettings;
  }

  function persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(mediaSettings));
    } catch (_) {}
  }

  // Seeds the toolbar popovers and playback state from the saved Media defaults.
  function applySettingsDefaults() {
    const fit = $('media-fit');
    const transition = $('media-transition');
    const easing = $('media-easing');
    const bgColor = $('media-bg-color');
    if (fit) fit.value = mediaSettings.fit;
    if (transition) transition.value = mediaSettings.transition;
    if (easing) easing.value = mediaSettings.easing;
    if (bgColor) bgColor.value = mediaSettings.bgColor;
    outputVolume = mediaSettings.volume;
    isLooping = mediaSettings.loop;
    const vol = $('media-vol-ui');
    if (vol) vol.value = String(outputVolume);
  }

  // Mirrors saved values into the Settings > Media panel inputs.
  function syncSettingsForm() {
    const map = {
      'media-set-fit': mediaSettings.fit,
      'media-set-transition': mediaSettings.transition,
      'media-set-easing': mediaSettings.easing,
      'media-set-bg-color': mediaSettings.bgColor,
      'media-set-volume': String(mediaSettings.volume)
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = $(id);
      if (el) el.value = value;
    });
    const loop = $('media-set-loop');
    if (loop) loop.checked = mediaSettings.loop;
    const restore = $('media-set-restore-session');
    if (restore) restore.checked = mediaSettings.restoreSession;
    const volLabel = $('media-set-volume-value');
    if (volLabel) volLabel.textContent = `${Math.round(mediaSettings.volume * 100)}%`;
  }

  function onSettingsChange() {
    mediaSettings = normalizeSettings({
      fit: $('media-set-fit')?.value,
      transition: $('media-set-transition')?.value,
      easing: $('media-set-easing')?.value,
      bgColor: $('media-set-bg-color')?.value,
      volume: $('media-set-volume')?.value,
      loop: !!$('media-set-loop')?.checked,
      restoreSession: !!$('media-set-restore-session')?.checked
    });
    persistSettings();
    syncSettingsForm();
    applySettingsDefaults();
    drawPreview();
    syncLiveOutput();
    updateTransportUi();
    autosave();
  }

  function dataUrlFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  function arrayBufferFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  function canvasToDataUrl(canvas, quality = 0.86) {
    try {
      return canvas.toDataURL('image/jpeg', quality);
    } catch (_) {
      return canvas.toDataURL('image/png');
    }
  }

  function makeTextSlide(title, body, opts = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.bg || '#0b101a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = opts.accent || '#4a86ff';
    ctx.fillRect(0, 0, 10, canvas.height);
    ctx.fillStyle = '#e8f0ff';
    ctx.font = '700 46px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    ctx.fillText(title || 'Media', 54, 92);
    ctx.fillStyle = '#aab7cc';
    ctx.font = '400 30px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    const words = String(body || '').replace(/\s+/g, ' ').trim().split(' ');
    let line = '';
    let y = 160;
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > 1160) {
        ctx.fillText(line, 54, y);
        y += 42;
        line = word;
      } else {
        line = next;
      }
    });
    if (line) ctx.fillText(line, 54, y);
    return canvasToDataUrl(canvas);
  }

  function makeAudioThumb(name) {
    return makeTextSlide('Audio', name || 'Audio file', { bg: '#07111f', accent: '#34d399' });
  }

  function makeVideoThumb(name) {
    return makeTextSlide('Video', name || 'Video file', { bg: '#0e1020', accent: '#8b7bff' });
  }

  async function makeVideoPoster(src, name) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';
      video.src = src;
      const done = (fallback) => {
        video.removeAttribute('src');
        video.load();
        resolve(fallback || makeVideoThumb(name));
      };
      video.onloadeddata = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 360;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          done(canvasToDataUrl(canvas));
        } catch (_) {
          done();
        }
      };
      video.onerror = () => done();
      setTimeout(() => done(), 1600);
    });
  }

  async function importPdf(file, baseName) {
    if (!window.pdfjsLib) {
      showToast('PDF engine unavailable.');
      return;
    }
    const buffer = await arrayBufferFromFile(file);
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: 1.65 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const src = canvasToDataUrl(canvas);
      slides.push({ type: 'img', src, thumb: src, name: `${baseName} (P${pageNo})`, enabled: true });
    }
  }

  async function importPptx(file, baseName) {
    if (!window.JSZip) {
      showToast('PPTX engine unavailable.');
      return;
    }
    const zip = await window.JSZip.loadAsync(await arrayBufferFromFile(file));
    const paths = [];
    zip.forEach((path) => {
      if (/^ppt\/slides\/slide\d+\.xml$/i.test(path)) paths.push(path);
    });
    paths.sort((a, b) => Number((a.match(/slide(\d+)/i) || [0, 0])[1]) - Number((b.match(/slide(\d+)/i) || [0, 0])[1]));
    if (!paths.length) {
      const src = makeTextSlide(baseName, 'No slides found in this PPTX file.');
      slides.push({ type: 'img', src, thumb: src, name: `${baseName} (PPTX)`, enabled: true });
      return;
    }
    for (let i = 0; i < paths.length; i += 1) {
      const xml = await zip.file(paths[i]).async('text');
      const text = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
        .map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
        .join(' ');
      const src = makeTextSlide(`${baseName} (P${i + 1})`, text || 'PowerPoint slide');
      slides.push({ type: 'img', src, thumb: src, name: `${baseName} (P${i + 1})`, enabled: true });
    }
  }

  async function importDocx(file, baseName) {
    if (!window.JSZip) {
      showToast('DOCX engine unavailable.');
      return;
    }
    const zip = await window.JSZip.loadAsync(await arrayBufferFromFile(file));
    const doc = zip.file('word/document.xml');
    if (!doc) {
      const src = makeTextSlide(baseName, 'No readable document body found.');
      slides.push({ type: 'img', src, thumb: src, name: `${baseName} (DOCX)`, enabled: true });
      return;
    }
    const xml = await doc.async('text');
    const paragraphs = Array.from(xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g))
      .map((p) => Array.from(p[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)).map((m) => m[1]).join(''))
      .map((s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())
      .filter(Boolean);
    const chunkSize = 9;
    for (let i = 0; i < Math.max(1, Math.ceil(paragraphs.length / chunkSize)); i += 1) {
      const body = paragraphs.slice(i * chunkSize, (i + 1) * chunkSize).join('  ');
      const src = makeTextSlide(`${baseName} (P${i + 1})`, body || 'Word document');
      slides.push({ type: 'img', src, thumb: src, name: `${baseName} (P${i + 1})`, enabled: true });
    }
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    pushUndo();
    for (const file of files) {
      const name = file.name || 'Media';
      const baseName = name.replace(/\.[^.]+$/, '');
      const lower = name.toLowerCase();
      try {
        if (file.type.startsWith('image/')) {
          const src = await dataUrlFromFile(file);
          slides.push({ type: 'img', src, thumb: src, name, enabled: true });
        } else if (file.type.startsWith('video/')) {
          const src = await dataUrlFromFile(file);
          const thumb = await makeVideoPoster(src, name);
          slides.push({ type: 'video', src, thumb, name, enabled: true });
        } else if (file.type.startsWith('audio/')) {
          const src = await dataUrlFromFile(file);
          const thumb = makeAudioThumb(name);
          slides.push({ type: 'audio', src, thumb, name, enabled: true });
        } else if (lower.endsWith('.pdf')) {
          await importPdf(file, baseName);
        } else if (lower.endsWith('.pptx')) {
          await importPptx(file, baseName);
        } else if (lower.endsWith('.docx')) {
          await importDocx(file, baseName);
        } else if (lower.endsWith('.deck')) {
          await importDeck(file);
        } else {
          const src = makeTextSlide(name, 'Unsupported media type.');
          slides.push({ type: 'img', src, thumb: src, name: `${name} (unsupported)`, enabled: true });
        }
      } catch (err) {
        console.warn('Media import failed:', err);
        const src = makeTextSlide(name, 'Import failed.');
        slides.push({ type: 'img', src, thumb: src, name: `${name} (import error)`, enabled: true });
      }
    }
    if (currentIndex < 0 && slides.length) currentIndex = findNextEnabled(-1, 1);
    selectedIndex = currentIndex;
    render();
    setPreview(currentIndex);
    autosave();
  }

  function importDeck(file) {
    return new Promise((resolve) => {
      if (!file) return resolve();
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result || '{}'));
          if (!Array.isArray(data.slides)) throw new Error('Invalid deck');
          pushUndo();
          slides = data.slides.filter((slide) => slide && slide.src);
          currentIndex = slides.length ? 0 : -1;
          selectedIndex = currentIndex;
          render();
          setPreview(currentIndex);
          autosave();
        } catch (_) {
          showToast('Could not open deck.');
        }
        resolve();
      };
      reader.readAsText(file);
    });
  }

  function exportDeck() {
    const blob = new Blob([JSON.stringify({ slides, currentIndex, outputVolume, isLooping, coverPos }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bsp-media.deck';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function render() {
    const list = $('media-thumb-list');
    if (!list) return;
    const query = String($('media-search-in')?.value || '').toLowerCase();
    const zoom = clamp(Number($('media-zoom')?.value) || 95, 30, 100);
    list.style.setProperty('--media-thumb-scale', `${zoom}%`);
    list.innerHTML = '';
    slides.forEach((slide, index) => {
      if (query && !String(slide.name || '').toLowerCase().includes(query)) return;
      const item = document.createElement('div');
      item.className = `media-thumb${index === currentIndex ? ' active' : ''}${slide.enabled === false ? ' disabled' : ''}`;
      item.dataset.index = String(index);
      item.innerHTML = `
        <span class="media-thumb-enabled">${slide.enabled === false ? 'OFF' : 'ON'}</span>
        <span class="media-thumb-num">${index + 1}</span>
        <img src="${esc(slide.thumb || slide.src)}" alt="">
        <div class="media-thumb-title">${esc(slide.name || `Media ${index + 1}`)}</div>
      `;
      item.onclick = () => setPreview(index);
      item.ondblclick = () => project();
      item.oncontextmenu = (event) => {
        event.preventDefault();
        setPreview(index);
        openContextMenu(index, event.clientX, event.clientY);
      };
      list.appendChild(item);
    });
    updateTransportUi();
  }

  function setPreview(index) {
    if (!Number.isFinite(index) || index < 0 || index >= slides.length) {
      currentIndex = -1;
      selectedIndex = -1;
      drawPreview();
      render();
      return;
    }
    currentIndex = index;
    selectedIndex = index;
    drawPreview();
    render();
    autosave();
  }

  function drawPreview() {
    stopScrubTimer();
    const frame = $('media-preview-frame');
    if (!frame) return;
    previewMediaEl = null;
    const slide = slides[currentIndex];
    const fit = currentFit();
    frame.classList.toggle('media-fit-cover', fit === 'cover');
    frame.classList.toggle('media-fit-blur', fit === 'blur');
    frame.innerHTML = '';
    updatePanOverlay();
    if (!slide) {
      frame.innerHTML = '<div class="media-preview-placeholder">Add media to begin.</div>';
      updateTransportUi();
      return;
    }
    if (fit === 'blur' && slide.type !== 'audio') {
      const bg = document.createElement('img');
      bg.className = 'media-preview-bg';
      bg.src = slide.thumb || slide.src;
      frame.appendChild(bg);
    }
    if (slide.type === 'video') {
      const video = document.createElement('video');
      video.src = slide.src;
      video.controls = false;
      video.loop = isLooping;
      video.muted = previewMuted;
      video.volume = outputVolume;
      video.style.objectPosition = `${coverPos.x}% ${coverPos.y}%`;
      frame.appendChild(video);
      previewMediaEl = video;
      startScrubTimer();
    } else if (slide.type === 'audio') {
      const card = document.createElement('div');
      card.className = 'media-preview-audio-card';
      card.innerHTML = `<img src="${esc(slide.thumb || makeAudioThumb(slide.name))}" alt=""><div>${esc(slide.name || 'Audio')}</div>`;
      const audio = document.createElement('audio');
      audio.src = slide.src;
      audio.loop = isLooping;
      audio.muted = previewMuted;
      audio.volume = outputVolume;
      card.appendChild(audio);
      frame.appendChild(card);
      previewMediaEl = audio;
      startScrubTimer();
    } else {
      const img = document.createElement('img');
      img.src = slide.src;
      img.style.objectPosition = `${coverPos.x}% ${coverPos.y}%`;
      frame.appendChild(img);
    }
    updateTransportUi();
  }

  function compactSlide(slide) {
    if (!slide) return null;
    if (slide.type === 'audio') return { type: 'audio', src: slide.src, thumb: slide.thumb, name: slide.name };
    if (slide.type === 'video') return { type: 'video', src: slide.src, name: slide.name };
    return { type: 'img', src: slide.src, name: slide.name };
  }

  function computeDirForIndex(targetIndex) {
    if (lastOutputIndex < 0) return 1;
    return targetIndex < lastOutputIndex ? -1 : 1;
  }

  function project() {
    const slide = slides[currentIndex];
    if (!slide || slide.enabled === false) return;
    const payload = {
      slide: compactSlide(slide),
      fit: currentFit(),
      transition: currentTransition(),
      easing: currentEasing(),
      bgColor: currentBgColor(),
      isLooping,
      volume: outputVolume,
      coverPos: { x: coverPos.x, y: coverPos.y },
      dir: computeDirForIndex(currentIndex)
    };
    if (typeof window.bspPostMediaLoad === 'function') {
      window.bspPostMediaLoad(payload);
    }
    lastOutputIndex = currentIndex;
    autosave();
  }

  function clearOutput() {
    if (typeof window.bspPostMediaClear === 'function') window.bspPostMediaClear();
    lastOutputIndex = -1;
    autosave();
  }

  function postRemote(cmd, value) {
    if (typeof window.bspPostMediaRemote === 'function') {
      window.bspPostMediaRemote({ cmd, val: value, volume: outputVolume, isLooping });
    }
  }

  function postCoverPos() {
    if (typeof window.bspPostMediaCoverPos === 'function') {
      window.bspPostMediaCoverPos({ x: coverPos.x, y: coverPos.y });
    }
  }

  function findNextEnabled(from, dir) {
    if (!slides.length) return -1;
    let index = from;
    for (let step = 0; step < slides.length; step += 1) {
      index += dir;
      if (index < 0 || index >= slides.length) return -1;
      if (slides[index] && slides[index].enabled !== false) return index;
    }
    return -1;
  }

  function nav(dir, send) {
    const next = findNextEnabled(currentIndex, dir);
    if (next !== -1) {
      setPreview(next);
      if (send) project();
    }
  }

  function toggleEnabledSelected() {
    if (selectedIndex < 0 || !slides[selectedIndex]) return;
    pushUndo();
    slides[selectedIndex].enabled = slides[selectedIndex].enabled === false;
    render();
    autosave();
  }

  function deleteSelected() {
    if (selectedIndex < 0 || !slides[selectedIndex]) return;
    pushUndo();
    slides.splice(selectedIndex, 1);
    currentIndex = Math.min(currentIndex, slides.length - 1);
    if (currentIndex < 0 && slides.length) currentIndex = 0;
    selectedIndex = currentIndex;
    render();
    setPreview(currentIndex);
    autosave();
  }

  function duplicateSelected() {
    if (selectedIndex < 0 || !slides[selectedIndex]) return;
    pushUndo();
    const copy = { ...slides[selectedIndex], name: `${slides[selectedIndex].name || 'Media'} (Copy)` };
    slides.splice(selectedIndex + 1, 0, copy);
    setPreview(selectedIndex + 1);
  }

  function renameSelected() {
    if (selectedIndex < 0 || !slides[selectedIndex]) return;
    const next = prompt('Rename media', slides[selectedIndex].name || `Media ${selectedIndex + 1}`);
    if (next == null) return;
    pushUndo();
    slides[selectedIndex].name = String(next).trim() || slides[selectedIndex].name;
    render();
    autosave();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify({ slides, currentIndex, outputVolume, isLooping, coverPos }));
    restoreSnapshot(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify({ slides, currentIndex, outputVolume, isLooping, coverPos }));
    restoreSnapshot(redoStack.pop());
  }

  function clearAll() {
    if (!slides.length) return;
    if (!confirm('Clear all media from this workspace?')) return;
    pushUndo();
    slides = [];
    currentIndex = -1;
    selectedIndex = -1;
    render();
    setPreview(-1);
    autosave();
  }

  function toggleLoop() {
    isLooping = !isLooping;
    if (previewMediaEl) previewMediaEl.loop = isLooping;
    postRemote('loop', isLooping);
    updateTransportUi();
    autosave();
  }

  function togglePreviewMute() {
    previewMuted = !previewMuted;
    if (previewMediaEl) previewMediaEl.muted = previewMuted;
    updateTransportUi();
  }

  function vAction(cmd, value) {
    if (cmd === 'volume') {
      outputVolume = clamp(Number(value), 0, 1);
      if (previewMediaEl) previewMediaEl.volume = outputVolume;
      const main = $('media-vol-ui');
      const mini = $('media-vol-ui-sb');
      if (main) main.value = String(outputVolume);
      if (mini) mini.value = String(outputVolume);
      postRemote('volume', outputVolume);
      autosave();
      return;
    }
    if (cmd === 'loop') {
      toggleLoop();
      return;
    }
    if (cmd === 'seek') {
      if (previewMediaEl) {
        try { previewMediaEl.currentTime = 0; } catch (_) {}
      }
      postRemote('seek', 0);
      return;
    }
    if (cmd === 'toggle') {
      if (previewMediaEl) {
        if (previewMediaEl.paused) previewMediaEl.play().catch(() => {});
        else previewMediaEl.pause();
      }
      postRemote('toggle');
    }
  }

  function startScrub(event) {
    if (!previewMediaEl || !previewMediaEl.duration || !isFinite(previewMediaEl.duration)) return;
    const box = event.currentTarget;
    const rect = box.getBoundingClientRect();
    const pct = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    try { previewMediaEl.currentTime = pct * previewMediaEl.duration; } catch (_) {}
    if (typeof window.bspPostMediaRemote === 'function') {
      window.bspPostMediaRemote({ cmd: 'scrub', val: pct, volume: outputVolume, isLooping });
    }
  }

  function startScrubTimer() {
    stopScrubTimer();
    scrubTimer = setInterval(() => {
      const pct = previewMediaEl && previewMediaEl.duration && isFinite(previewMediaEl.duration)
        ? (previewMediaEl.currentTime / previewMediaEl.duration) * 100
        : 0;
      ['media-scrub-progress', 'media-scrub-progress-sb'].forEach((id) => {
        const el = $(id);
        if (el) el.style.width = `${clamp(pct, 0, 100)}%`;
      });
    }, 250);
  }

  function stopScrubTimer() {
    if (scrubTimer) clearInterval(scrubTimer);
    scrubTimer = null;
  }

  function resetCoverPosition() {
    coverPos = { x: 50, y: 50 };
    drawPreview();
    postCoverPos();
    autosave();
  }

  function updatePanOverlay() {
    const overlay = $('media-pan-overlay');
    if (overlay) overlay.classList.toggle('open', currentFit() === 'cover' && isMediaTab());
  }

  function bindPanOverlay() {
    const overlay = $('media-pan-overlay');
    if (!overlay || overlay.dataset.bound) return;
    overlay.dataset.bound = '1';
    overlay.addEventListener('pointerdown', (event) => {
      coverDrag = { x: event.clientX, y: event.clientY, ox: coverPos.x, oy: coverPos.y };
      overlay.setPointerCapture(event.pointerId);
    });
    overlay.addEventListener('pointermove', (event) => {
      if (!coverDrag) return;
      const rect = overlay.getBoundingClientRect();
      coverPos.x = clamp(coverDrag.ox + ((event.clientX - coverDrag.x) / Math.max(1, rect.width)) * 100, 0, 100);
      coverPos.y = clamp(coverDrag.oy + ((event.clientY - coverDrag.y) / Math.max(1, rect.height)) * 100, 0, 100);
      drawPreview();
      postCoverPos();
      autosave();
    });
    overlay.addEventListener('pointerup', () => { coverDrag = null; });
    overlay.addEventListener('wheel', (event) => {
      event.preventDefault();
      coverPos.y = clamp(coverPos.y + (event.deltaY > 0 ? 2 : -2), 0, 100);
      drawPreview();
      postCoverPos();
      autosave();
    }, { passive: false });
  }

  function updateTransportUi() {
    const slide = slides[currentIndex];
    const isMedia = !!slide && (slide.type === 'video' || slide.type === 'audio');
    document.querySelectorAll('.media-mini-controls').forEach((el) => el.classList.toggle('open', isMedia));
    document.querySelectorAll('.media-scrub').forEach((el) => el.classList.toggle('open', isMedia));
    document.querySelectorAll('[data-media-loop]').forEach((el) => el.classList.toggle('active', isLooping));
    const mute = $('media-preview-mute');
    if (mute) mute.classList.toggle('active', previewMuted);
  }

  function closeMediaPopovers(except) {
    ['media-fx-popover', 'media-fit-popover'].forEach((id) => {
      if (id === except) return;
      $(id)?.classList.remove('open');
    });
    if (except !== 'media-fx-popover') $('btn-media-fx')?.classList.remove('active');
    if (except !== 'media-fit-popover') $('btn-media-fit')?.classList.remove('active');
  }

  // Same anchoring as positionPresetPopover: centred under its toolbar button, clamped to
  // the viewport.
  function placeMediaPopover(popover, button) {
    if (!popover || !button) return;
    const rect = button.getBoundingClientRect();
    const width = popover.offsetWidth || 280;
    const desiredLeft = rect.left + (rect.width / 2) - (width / 2);
    const left = Math.min(Math.max(8, desiredLeft), Math.max(8, window.innerWidth - width - 8));
    popover.style.top = `${Math.round(rect.bottom + 8)}px`;
    popover.style.left = `${Math.round(left)}px`;
  }

  function togglePopover(popoverId, buttonId, event) {
    if (event) event.stopPropagation();
    const popover = $(popoverId);
    const button = $(buttonId);
    if (!popover) return;
    const open = !popover.classList.contains('open');
    closeMediaPopovers(open ? popoverId : null);
    if (open) {
      // position:fixed resolves against a filtered/transformed ancestor, not the viewport,
      // so the popover has to live on <body> to anchor correctly — same as #preset-popover.
      if (popover.parentElement !== document.body) document.body.appendChild(popover);
      placeMediaPopover(popover, button);
    }
    popover.classList.toggle('open', open);
    button?.classList.toggle('active', open);
  }

  // Pushes the current fit/transition/easing/volume/loop state to a slide that is already live.
  function syncLiveOutput() {
    if (previewMediaEl) {
      previewMediaEl.volume = outputVolume;
      previewMediaEl.loop = isLooping;
    }
    postRemote('volume', outputVolume);
    postRemote('loop', isLooping);
    // Re-send only when the slide on screen is the one that is live, so changing an
    // option never projects whatever happens to be selected in preview.
    if (lastOutputIndex >= 0 && lastOutputIndex === currentIndex) project();
  }

  function onOutputOptionChange() {
    drawPreview();
    syncLiveOutput();
    autosave();
  }

  function openContextMenu(index, x, y) {
    const menu = $('media-context-menu');
    if (!menu) return;
    const slide = slides[index];
    menu.innerHTML = `
      <button type="button" data-action="project">Project Live</button>
      <button type="button" data-action="toggle">${slide && slide.enabled === false ? 'Enable' : 'Disable'}</button>
      <button type="button" data-action="duplicate">Duplicate</button>
      <button type="button" data-action="rename">Rename</button>
      <button type="button" class="danger" data-action="delete">Delete</button>
    `;
    menu.classList.add('open');
    menu.style.left = `${Math.min(x, window.innerWidth - 230)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 220)}px`;
    menu.onclick = (event) => {
      const action = event.target && event.target.dataset ? event.target.dataset.action : '';
      if (action === 'project') project();
      if (action === 'toggle') toggleEnabledSelected();
      if (action === 'duplicate') duplicateSelected();
      if (action === 'rename') renameSelected();
      if (action === 'delete') deleteSelected();
      closeContextMenu();
    };
  }

  function closeContextMenu() {
    const menu = $('media-context-menu');
    if (menu) menu.classList.remove('open');
  }

  function init() {
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
    }
    bindPanOverlay();
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!target.closest || !target.closest('#media-context-menu')) closeContextMenu();
      if (!target.closest || !target.closest('.media-popover')) closeMediaPopovers();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMediaPopovers();
    });
    window.addEventListener('resize', () => {
      if ($('media-fx-popover')?.classList.contains('open')) placeMediaPopover($('media-fx-popover'), $('btn-media-fx'));
      if ($('media-fit-popover')?.classList.contains('open')) placeMediaPopover($('media-fit-popover'), $('btn-media-fit'));
    });
    loadSettings();
    applySettingsDefaults();
    syncSettingsForm();
    if (mediaSettings.restoreSession) loadAutosave();
    render();
    drawPreview();
  }

  window.bspMedia = {
    handleFiles,
    importDeck,
    exportDeck,
    render,
    redraw: drawPreview,
    setPreview,
    project,
    clearOutput,
    nav,
    vAction,
    startScrub,
    undo,
    redo,
    clearAll,
    toggleEnabledSelected,
    togglePreviewMute,
    resetCoverPosition,
    openFilePicker: () => $('media-file-input')?.click(),
    openDeckPicker: () => $('media-deck-input')?.click(),
    toggleFxPopover: (event) => togglePopover('media-fx-popover', 'btn-media-fx', event),
    toggleFitPopover: (event) => togglePopover('media-fit-popover', 'btn-media-fit', event),
    closePopovers: () => closeMediaPopovers(),
    onOutputOptionChange,
    onSettingsChange,
    syncSettingsForm,
    getSettings: () => ({ ...mediaSettings })
  };

  // The toolbar "+" is shared with Songs: on the Media tab it adds media instead.
  window.handleToolbarAddClick = () => {
    if (isMediaTab()) {
      $('media-file-input')?.click();
      return;
    }
    if (typeof window.openModal === 'function') window.openModal('newSongModal');
  };

  window.bspMediaTabActivated = () => {
    render();
    drawPreview();
    updatePanOverlay();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
