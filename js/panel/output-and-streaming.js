    function setProgramDisplayAspect(aspect) {
      const shell = document.getElementById('program-display-shell');
      if (!shell) return;
      const normalized = (aspect === '9:16') ? '9:16' : '16:9';
      shell.dataset.aspect = normalized;
      document.getElementById('program-aspect-16x9')?.classList.toggle('active', normalized === '16:9');
      document.getElementById('program-aspect-9x16')?.classList.toggle('active', normalized === '9:16');
      lsSyncProjectionLayoutFromProgramDisplay();
      requestAnimationFrame(() => {
        updateEmbeddedProgramDisplayScale();
        updateLsProjectionPreviewScale();
        syncEmbeddedProgramDisplay();
        syncStandaloneOutputDirect();
        syncLsProjectionPreview();
      });
      // Ensure projection preview iframe receives the refreshed payload after layout settles.
      setTimeout(() => syncLsProjectionPreview(), 120);
      setTimeout(() => syncLsProjectionPreview(), 320);
    }

    function clampProgramPreviewZoom(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return 0.82;
      return Math.max(0.5, Math.min(2, num));
    }

    function setProgramPreviewZoom(value, opts = {}) {
      programPreviewZoom = clampProgramPreviewZoom(value);
      const slider = document.getElementById('program-scale-slider');
      if (slider && opts.fromSlider !== true) slider.value = programPreviewZoom.toFixed(2);
      updateEmbeddedProgramDisplayScale();
      updateLsProjectionPreviewScale();
    }

    function updateProgramScaleUi(scale, baseW, baseH) {
      const zoomValue = document.getElementById('program-scale-value');
      const sizeValue = document.getElementById('program-scale-size');
      if (zoomValue) zoomValue.textContent = `${Math.round(programPreviewZoom * 100)}%`;
      if (sizeValue) {
        const w = Math.max(1, Math.round(baseW * scale));
        const h = Math.max(1, Math.round(baseH * scale));
        sizeValue.textContent = `Scaled (${w}x${h})`;
      }
    }

    function layoutProgramScaleControls() {
      const bar = document.getElementById('program-scale-controls');
      const leftBlock = bar ? bar.querySelector('.program-scale-left') : null;
      const goLiveGroup = bar ? bar.querySelector('.program-display-controls') : null;
      const outputBtn = document.getElementById('btn-open-standalone-output');
      if (!bar || !leftBlock || !goLiveGroup) return;

      const barW = bar.clientWidth || 0;
      const goW = goLiveGroup.offsetWidth || 0;
      if (!barW || !goW) return;

      const defaultLeft = (barW - goW) / 2;
      const leftBound = (leftBlock.offsetLeft || 0) + (leftBlock.offsetWidth || 0) + 8;

      let rightBound = barW - goW - 8;
      if (outputBtn && outputBtn.offsetParent === bar) {
        rightBound = Math.min(rightBound, (outputBtn.offsetLeft || barW) - goW - 12);
      }

      const clampedLeft = Math.max(leftBound, Math.min(defaultLeft, rightBound));
      goLiveGroup.style.left = `${Math.max(0, clampedLeft)}px`;
    }

    function applyProgramDisplaySource(source, opts = {}) {
      const frame = document.getElementById('program-display-frame');
      if (!frame) return;
      const normalized = 'lyrics';
      const nextSrc = getDisplayFileForTab(normalized, 'embedded');
      const forceReload = !!opts.forceReload;
      if (!forceReload && currentProgramDisplaySource === normalized && frame.getAttribute('src') === nextSrc) {
        return;
      }
      currentProgramDisplaySource = normalized;
      embeddedProgramDisplayReady = false;
      frame.setAttribute('src', nextSrc);

      // Projection streaming now captures from the Program Display directly,
      // so source switching is handled automatically. This call is a no-op
      // but kept for API compatibility.
      if (window.BSPDesktop && typeof window.BSPDesktop.switchStreamSource === 'function') {
        try { window.BSPDesktop.switchStreamSource(normalized); } catch (e) {}
      }
    }

    function getStandaloneOutputUrl() {
      return getDisplayFileForTab('lyrics', 'standalone');
    }

    function getEmbeddedDisplayViewport() {
      const shell = document.getElementById('program-display-shell');
      const isPortrait = shell?.dataset?.aspect === '9:16';
      return isPortrait
        ? { width: 1080, height: 1920 }
        : { width: 1920, height: 1080 };
    }

    function updateEmbeddedProgramDisplayScale() {
      const shell = document.getElementById('program-display-shell');
      const frame = document.getElementById('program-display-frame');
      const compositor = document.getElementById('source-compositor');
      const overlay = document.getElementById('transform-overlay');
      if (!shell || !frame || !compositor || !overlay) return;
      const shellW = shell.clientWidth || 0;
      const shellH = shell.clientHeight || 0;
      if (!shellW || !shellH) return;
      const isPortrait = shell.dataset.aspect === '9:16';
      const baseW = isPortrait ? 1080 : 1920;
      const baseH = isPortrait ? 1920 : 1080;
      // Use strict "contain" scaling so framing is never cropped in embedded preview.
      const fitScale = Math.min(1, Math.min(shellW / baseW, shellH / baseH));
      const scale = fitScale * programPreviewZoom;
      const scaledW = baseW * scale;
      const scaledH = baseH * scale;
      const offsetX = Math.round((shellW - scaledW) / 2);
      const offsetY = Math.round((shellH - scaledH) / 2);
      [compositor, overlay, frame].forEach((el) => {
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = '0';
        el.style.width = baseW + 'px';
        el.style.height = baseH + 'px';
        el.style.transformOrigin = 'top left';
        el.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
      });
      updateProgramScaleUi(scale, baseW, baseH);
    }

    function postMessageToEmbeddedProgramDisplay(message) {
      const frame = document.getElementById('program-display-frame');
      if (!frame || !frame.contentWindow || !embeddedProgramDisplayReady) return false;
      frame.contentWindow.postMessage(message, '*');
      return true;
    }

    function postMessageToStandaloneOutput(message) {
      if (window.BSPDesktop && typeof window.BSPDesktop.sendOutputMessage === 'function') {
        window.BSPDesktop.sendOutputMessage(message).catch(() => {});
        return true;
      }
      if (!standaloneDisplayWindow || standaloneDisplayWindow.closed) return false;
      try {
        standaloneDisplayWindow.postMessage(message, '*');
        return true;
      } catch (e) {
        return false;
      }
    }

    function syncStandaloneOutputDirect(burstSeq) {
      const viewport = getEmbeddedDisplayViewport();
      const sceneLayers = getOutputSceneLayers();
      const seq = burstSeq || nextSeq();
      if (currentProgramDisplaySource === 'lyrics' && embeddedProgramDisplayState.kind === 'media' && embeddedProgramDisplayState.payload) {
        postMessageToStandaloneOutput(embeddedProgramDisplayState.payload);
      } else if (currentProgramDisplaySource === 'lyrics' && embeddedProgramDisplayState.kind === 'update' && embeddedProgramDisplayState.payload) {
        // Full content sync — includes text, background, mode, AND scene layers
        postMessageToStandaloneOutput({
          type: 'PREVIEW_UPDATE',
          payload: {
            ...embeddedProgramDisplayState.payload,
            seq,
            sceneLayers,
            displayViewportWidth: viewport.width,
            displayViewportHeight: viewport.height
          }
        });
      } else {
        // Scene-only sync — update layers without touching text/background/mode
        postMessageToStandaloneOutput({
          type: 'SCENE_LAYERS_UPDATE',
          sceneLayers
        });
      }
    }

    function queueStandaloneSyncBurst() {
      standaloneSyncTimers.forEach(tid => clearTimeout(tid));
      standaloneSyncTimers = [];
      const burstSeq = nextSeq();
      // During active streaming, use fewer burst retries to reduce rendering
      // load — the offscreen capture window needs steady GPU/CPU time.
      const isStreaming = (typeof _lsState !== 'undefined') && _lsState.streaming;
      const delays = isStreaming ? [0, 300, 800] : [0, 120, 320, 700, 1200];
      delays.forEach((delay) => {
        const tid = setTimeout(() => syncStandaloneOutputDirect(burstSeq), delay);
        standaloneSyncTimers.push(tid);
      });
    }

    let _pgmMediaClockSyncLastTs = 0;
    function _postSceneLayersToLsProjectionPreview(sceneLayers) {
      // No-op — preview is now driven by backend capturePage thumbnails.
      // Scene layers are rendered by the actual Program Display window,
      // so the captured frames already include them.
    }

    function _pgmSyncMediaClockToOutputs(force = false) {
      const { src, vid } = _pgmGetPrimaryMediaVideo();
      if (!force) {
        if (!src || !vid || src.visible === false) return;
        if (_pgmMediaCtrlState.stopped || vid.paused || vid.ended) return;
      }
      const now = Date.now();
      // During streaming, widen the throttle window to reduce cross‐window
      // postMessage traffic that competes with the offscreen capture pipeline.
      const minInterval = (_lsState && _lsState.streaming) ? 400 : 220;
      if (!force && (now - _pgmMediaClockSyncLastTs) < minInterval) return;
      _pgmMediaClockSyncLastTs = now;
      const sceneLayersRaw = getOutputSceneLayers();
      const sceneLayers = Array.isArray(sceneLayersRaw) ? sceneLayersRaw : [];
      postMessageToStandaloneOutput({ type: 'SCENE_LAYERS_UPDATE', sceneLayers });
      if (currentProgramDisplaySource === 'lyrics') {
        postMessageToEmbeddedProgramDisplay({ type: 'SCENE_LAYERS_UPDATE', sceneLayers });
      }
      _postSceneLayersToLsProjectionPreview(sceneLayers);
    }

    function syncEmbeddedProgramDisplay() {
      if (currentProgramDisplaySource !== 'lyrics') return;
      if (!embeddedProgramDisplayReady) return;
      const viewport = getEmbeddedDisplayViewport();
      const sceneLayers = getOutputSceneLayers();
      if (embeddedProgramDisplayState.kind === 'media' && embeddedProgramDisplayState.payload) {
        postMessageToEmbeddedProgramDisplay(embeddedProgramDisplayState.payload);
      } else if (embeddedProgramDisplayState.kind === 'update' && embeddedProgramDisplayState.payload) {
        postMessageToEmbeddedProgramDisplay({
          type: 'PREVIEW_UPDATE',
          payload: {
            ...embeddedProgramDisplayState.payload,
            sceneLayers,
            displayViewportWidth: viewport.width,
            displayViewportHeight: viewport.height
          }
        });
      } else {
        postMessageToEmbeddedProgramDisplay({
          type: 'PREVIEW_CLEAR',
          sceneLayers
        });
      }
    }

    function initEmbeddedProgramDisplay() {
      const frame = document.getElementById('program-display-frame');
      const shell = document.getElementById('program-display-shell');
      if (!frame) return;
      const slider = document.getElementById('program-scale-slider');
      const zoomInBtn = document.getElementById('program-scale-in');
      const zoomOutBtn = document.getElementById('program-scale-out');
      const fitBtn = document.getElementById('program-scale-fit');
      embeddedProgramDisplayReady = false;
      if (slider && !slider.dataset.bound) {
        slider.dataset.bound = '1';
        slider.addEventListener('input', () => setProgramPreviewZoom(slider.value, { fromSlider: true }));
      }
      if (zoomInBtn && !zoomInBtn.dataset.bound) {
        zoomInBtn.dataset.bound = '1';
        zoomInBtn.addEventListener('click', () => setProgramPreviewZoom(programPreviewZoom + 0.05));
      }
      if (zoomOutBtn && !zoomOutBtn.dataset.bound) {
        zoomOutBtn.dataset.bound = '1';
        zoomOutBtn.addEventListener('click', () => setProgramPreviewZoom(programPreviewZoom - 0.05));
      }
      if (fitBtn && !fitBtn.dataset.bound) {
        fitBtn.dataset.bound = '1';
        fitBtn.addEventListener('click', () => setProgramPreviewZoom(1));
      }
      frame.addEventListener('load', () => {
        embeddedProgramDisplayReady = true;
        updateEmbeddedProgramDisplayScale();
        layoutProgramScaleControls();
        syncEmbeddedProgramDisplay();
      });
      applyProgramDisplaySource('lyrics', { forceReload: true });
      setProgramDisplayAspect('16:9');
      setProgramPreviewZoom(programPreviewZoom);
      layoutProgramScaleControls();
      if (shell && typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => {
          updateEmbeddedProgramDisplayScale();
          layoutProgramScaleControls();
        });
        ro.observe(shell);
      } else {
        window.addEventListener('resize', () => {
          updateEmbeddedProgramDisplayScale();
          layoutProgramScaleControls();
        });
      }
    }

    function buildStandaloneDisplayHtml(opts = {}) {
      const channelLiteral = JSON.stringify(CHANNEL_NAME);
      const isPreviewLiteral = opts.preview ? 'true' : 'false';
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Bible Song Pro - ${opts.preview ? 'Program Preview' : 'Standalone Output'}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; font-family: 'Segoe UI', system-ui, sans-serif; }
    #bg { position: fixed; inset: 0; z-index: 2; background: #000 center / cover no-repeat; transition: filter 220ms ease, opacity 220ms ease; }
    #bg-video { position: fixed; inset: 0; z-index: 2; width: 100%; height: 100%; object-fit: cover; display: none; }
    #scene-compositor { position: fixed; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; }
    #scene-compositor .src-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden; }
    #scene-compositor .src-layer video { width: 100%; height: 100%; object-fit: contain; display: block; }
    #scene-compositor .src-layer.media-source-layer video { object-fit: contain; }
    #scene-compositor .src-layer img { width: 100%; height: 100%; object-fit: contain; display: block; }
    #scene-compositor .src-layer .src-text-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 3vw; padding: 2vw; text-align: center; text-shadow: 0 0 12px rgba(0,0,0,0.7); }
    #scene-compositor .src-layer .src-placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.5); font-size: 12px; font-weight: 600; }
    #stage { position: fixed; inset: 0; z-index: 3; color: #fff; text-rendering: geometricPrecision; -webkit-font-smoothing: antialiased; display: flex; pointer-events: none; }
    #text-layer { width: 100%; word-break: break-word; }
    #stage.mode-full { align-items: center; justify-content: center; padding: 20px; }
    #stage.mode-full #text-layer { max-width: calc(100vw - 40px); text-align: center; }
    #stage.mode-lt { align-items: flex-end; justify-content: center; padding: 0; }
    #lt-wrap { width: 100%; display: none; padding: 12px 24px; background: linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0.0)); }
    #stage.mode-lt #lt-wrap { display: flex; align-items: center; justify-content: center; }
    #stage.mode-lt #text-layer { max-width: min(96vw, 1900px); text-align: center; }
    .jo-ref-line { margin-bottom: 8px; font-weight: 800; letter-spacing: 0.03em; display: inline-block; }
    .jo-body { font-weight: 700; }
    .dual-primary-block { margin-bottom: 20px; }
    .dual-secondary-wrapper { margin-top: 12px; opacity: 0.96; }
    #hud { position: fixed; right: 10px; top: 10px; z-index: 9; font-size: 11px; color: rgba(255,255,255,0.65); background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); border-radius: 7px; padding: 4px 8px; }
  </style>
</head>
<body>
  <div id="bg"></div>
  <video id="bg-video" muted autoplay playsinline></video>
  <div id="scene-compositor"></div>
  <div id="stage" class="mode-full">
    <div id="lt-wrap">
      <div id="text-layer"></div>
    </div>
    <div id="text-layer-full" style="display:none"></div>
  </div>
  <div id="hud">${opts.preview ? 'Program Preview' : 'Standalone Output'}</div>
  <script>
    (function () {
      const CHANNEL_NAME = ${channelLiteral};
      const IS_PREVIEW = ${isPreviewLiteral};
      const channel = IS_PREVIEW ? null : new BroadcastChannel(CHANNEL_NAME);
      const bg = document.getElementById('bg');
      const bgVideo = document.getElementById('bg-video');
      const sceneCompositor = document.getElementById('scene-compositor');
      const stage = document.getElementById('stage');
      const ltWrap = document.getElementById('lt-wrap');
      const ltText = document.getElementById('text-layer');
      const fullText = document.getElementById('text-layer-full');
      const hud = document.getElementById('hud');
      let lastSeq = 0;
      const outputStreams = Object.create(null);
      if (IS_PREVIEW && hud) hud.style.display = 'none';

      function stopOutputStream(id) {
        const existing = outputStreams[id];
        if (existing && existing.stream) {
          try { existing.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        }
        delete outputStreams[id];
      }

      function stopMissingOutputStreams(visibleIds) {
        Object.keys(outputStreams).forEach(function (id) {
          if (!visibleIds.has(id)) stopOutputStream(id);
        });
      }

      function applyLayerTransform(el, tf) {
        const x = Number(tf && tf.x != null ? tf.x : 0);
        const y = Number(tf && tf.y != null ? tf.y : 0);
        const w = Number(tf && tf.w != null ? tf.w : 100);
        const h = Number(tf && tf.h != null ? tf.h : 100);
        const rotation = Number(tf && tf.rotation != null ? tf.rotation : 0);
        const cT = Number(tf && tf.cropTop != null ? tf.cropTop : 0);
        const cR = Number(tf && tf.cropRight != null ? tf.cropRight : 0);
        const cB = Number(tf && tf.cropBottom != null ? tf.cropBottom : 0);
        const cL = Number(tf && tf.cropLeft != null ? tf.cropLeft : 0);
        el.style.left = x + '%';
        el.style.top = y + '%';
        el.style.width = w + '%';
        el.style.height = h + '%';
        el.style.transformOrigin = '50% 50%';
        var transforms = [];
        if (rotation) transforms.push('rotate(' + rotation + 'deg)');
        var flipH = tf && tf.flipH ? -1 : 1;
        var flipV = tf && tf.flipV ? -1 : 1;
        if (flipH === -1 || flipV === -1) transforms.push('scale(' + flipH + ', ' + flipV + ')');
        el.style.transform = transforms.length ? transforms.join(' ') : '';
        el.style.clipPath = (cT || cR || cB || cL) ? ('inset(' + cT + '% ' + cR + '% ' + cB + '% ' + cL + '%)') : '';
      }

      function normalizeFitMode(mode, fallback) {
        var key = String(mode || '').trim().toLowerCase();
        if (key === 'contain' || key === 'cover' || key === 'stretch' || key === 'pixel-1:1') return key;
        if (key === 'fill') return 'stretch';
        if (key === 'none') return 'pixel-1:1';
        var fb = String(fallback || 'contain').trim().toLowerCase();
        if (fb === 'cover' || fb === 'stretch' || fb === 'pixel-1:1') return fb;
        return 'contain';
      }

      function applyVisualFitMode(el, mode, opts) {
        if (!el) return;
        var cfg = opts || {};
        var normalized = normalizeFitMode(mode, 'contain');
        var mirror = !!cfg.mirror;
        el.style.position = 'absolute';
        el.style.display = 'block';
        el.style.transformOrigin = '50% 50%';
        el.style.maxWidth = 'none';
        el.style.maxHeight = 'none';
        if (normalized === 'pixel-1:1') {
          el.style.left = '50%';
          el.style.top = '50%';
          el.style.right = '';
          el.style.bottom = '';
          el.style.width = 'auto';
          el.style.height = 'auto';
          el.style.objectFit = 'none';
          el.style.transform = mirror ? 'translate(-50%, -50%) scaleX(-1)' : 'translate(-50%, -50%)';
        } else {
          el.style.left = '0';
          el.style.top = '0';
          el.style.right = '';
          el.style.bottom = '';
          el.style.width = '100%';
          el.style.height = '100%';
          el.style.objectFit = normalized === 'stretch' ? 'fill' : normalized;
          el.style.transform = mirror ? 'scaleX(-1)' : '';
        }
      }

      function bindVisualFit(videoEl, mode, opts) {
        if (!videoEl) return;
        var apply = function () { applyVisualFitMode(videoEl, mode, opts); };
        apply();
        if (videoEl.dataset.fitBound === '1') return;
        videoEl.dataset.fitBound = '1';
        videoEl.addEventListener('loadedmetadata', apply);
        videoEl.addEventListener('resize', apply);
      }

      function attachCameraStream(layerId, videoEl, deviceId) {
        const wantedDevice = String(deviceId || '');
        const existing = outputStreams[layerId];
        if (existing && existing.stream && existing.deviceId === wantedDevice) {
          videoEl.srcObject = existing.stream;
          videoEl.play().catch(function () {});
          return;
        }
        stopOutputStream(layerId);
        const constraints = wantedDevice
          ? { video: { deviceId: { exact: wantedDevice } }, audio: false }
          : { video: true, audio: false };
        navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
          outputStreams[layerId] = { stream: stream, deviceId: wantedDevice };
          videoEl.srcObject = stream;
          videoEl.play().catch(function () {});
        }).catch(function () {});
      }

      /* ---- media-source video caching & smooth sync ---- */
      var _sceneMediaEls = Object.create(null);   // layerId -> cached <video>
      var _lastSceneLayersSig = '';

      function _sceneLayersSig(layers) {
        if (!Array.isArray(layers)) return '';
        return layers.map(function (l) {
          if (!l) return '';
          var t = l.transform || {};
          var c = l.config || {};
          var dk = c.dataUrl ? String(c.dataUrl).slice(0, 64) : '';
          return [l.id||'', l.type||'', l.zIndex||0,
                  t.x||0, t.y||0, t.w||100, t.h||100, t.rotation||0,
                  t.cropTop||0, t.cropRight||0, t.cropBottom||0, t.cropLeft||0,
                  c.deviceId||'', c.text||'', dk, c.videoFilter||'', c.fitMode||'', c.fit||''].join('|');
        }).join('||');
      }

      function _syncMediaEl(vid, cfg) {
        if (!vid) return;
        var nextUrl = String(cfg.dataUrl || '');
        if (nextUrl && String(vid.dataset.mediaUrl || '') !== nextUrl) {
          vid.dataset.mediaUrl = nextUrl;
          vid.src = nextUrl;
        }
        vid.autoplay = true;
        vid.playsInline = true;
        vid.loop = cfg.mediaLoop !== false;
        var baseRate = Number(cfg.mediaPlaybackRate);
        var normalRate = (baseRate === baseRate && baseRate > 0) ? Math.max(0.25, Math.min(4, baseRate)) : 1;
        var vol = Number(cfg.mediaVolume);
        vid.volume = (vol === vol) ? Math.max(0, Math.min(1, vol)) : 1;
        vid.muted = !!cfg.mediaMuted;
        var target = Number(cfg.mediaCurrentTime);
        if (target === target && target >= 0) {
          vid.dataset.targetTime = String(target);
          var cur = Number(vid.currentTime || 0);
          var drift = cur - target;
          var absDrift = Math.abs(drift);
          if (absDrift > 1.0) {
            // Large drift (user seek / restart): hard seek
            try { vid.currentTime = Math.max(0, target); } catch (_) {}
            vid.playbackRate = normalRate;
          } else if (absDrift > 0.15) {
            // Medium drift: adjust playback rate to smoothly catch up / slow down
            vid.playbackRate = normalRate * (drift > 0 ? 0.95 : 1.05);
          } else {
            // Within tolerance: restore normal rate
            vid.playbackRate = normalRate;
          }
        } else {
          vid.playbackRate = normalRate;
        }
        var stopped = !!cfg.mediaStopped;
        var paused = cfg.mediaPaused === true;
        if (stopped || paused) {
          try { vid.pause(); } catch (_) {}
        } else {
          vid.play().catch(function () {});
        }
      }

      function _syncMediaStates(layers) {
        if (!Array.isArray(layers)) return;
        layers.forEach(function (ld) {
          if (!ld || ld.type !== 'media-source' || !ld.id) return;
          var lid = String(ld.id);
          var cfg = ld.config || {};
          var layerEl = sceneCompositor && sceneCompositor.querySelector('.src-layer[data-src-id="' + lid + '"]');
          if (layerEl) layerEl.style.visibility = cfg.mediaStopped ? 'hidden' : '';
          var vid = _sceneMediaEls[lid];
          if (vid) _syncMediaEl(vid, cfg);
        });
      }

      function _pruneMediaEls(visibleIds) {
        Object.keys(_sceneMediaEls).forEach(function (id) {
          if (visibleIds[id]) return;
          var v = _sceneMediaEls[id];
          try { v.pause(); } catch (_) {}
          try { v.removeAttribute('src'); v.load(); } catch (_) {}
          delete _sceneMediaEls[id];
        });
      }

      function renderSceneLayers(layers) {
        if (!sceneCompositor || !Array.isArray(layers)) return;

        /* Fast path: if only media state changed, sync without DOM rebuild */
        var sig = _sceneLayersSig(layers);
        if (sig && sig === _lastSceneLayersSig) {
          _syncMediaStates(layers);
          return;
        }
        _lastSceneLayersSig = sig;

        var visibleIds = new Set();
        sceneCompositor.innerHTML = '';
        layers.forEach(function (layerData) {
          if (!layerData || !layerData.id) return;
          var lid = String(layerData.id);
          visibleIds.add(lid);
          var layer = document.createElement('div');
          layer.className = 'src-layer';
          layer.dataset.srcId = lid;
          if (layerData.type === 'media-source') layer.classList.add('media-source-layer');
          layer.style.zIndex = String(Number(layerData.zIndex || 1));
          applyLayerTransform(layer, layerData.transform || {});
          var cfg = layerData.config || {};
          if (layerData.type === 'camera') {
            var vid = document.createElement('video');
            vid.autoplay = true;
            vid.muted = true;
            vid.playsInline = true;
            bindVisualFit(vid, cfg.fitMode || cfg.fit || 'contain', { mirror: !!cfg.mirror });
            layer.appendChild(vid);
            attachCameraStream(lid, vid, cfg.deviceId || '');
          } else if (layerData.type === 'ndi') {
            // NDI video feed via virtual camera device
            var ndiVid = document.createElement('video');
            ndiVid.autoplay = true;
            ndiVid.muted = true;
            ndiVid.playsInline = true;
            bindVisualFit(ndiVid, cfg.fitMode || cfg.fit || 'cover', { mirror: false });
            layer.appendChild(ndiVid);
            attachCameraStream(lid, ndiVid, cfg.cameraDeviceId || cfg.deviceId || '');
          } else if (layerData.type === 'image') {
            if (cfg.dataUrl) {
              var img = document.createElement('img');
              img.src = cfg.dataUrl;
              img.alt = layerData.name || '';
              applyVisualFitMode(img, cfg.fitMode || cfg.fit || 'contain', { mirror: false });
              if (cfg.opacity != null && cfg.opacity < 100) img.style.opacity = (cfg.opacity / 100).toFixed(2);
              layer.appendChild(img);
            }
          } else if (layerData.type === 'media-source') {
            var mvid = _sceneMediaEls[lid];
            if (!mvid) {
              mvid = document.createElement('video');
              applyVisualFitMode(mvid, cfg.fitMode || cfg.fit || 'contain', { mirror: false });
              mvid.addEventListener('loadedmetadata', function () {
                var t = Number(mvid.dataset.targetTime || '');
                if (t === t && t >= 0 && Math.abs((Number(mvid.currentTime)||0) - t) > 0.18) {
                  try { mvid.currentTime = Math.max(0, t); } catch (_) {}
                }
              });
              _sceneMediaEls[lid] = mvid;
            }
            if (cfg.dataUrl) {
              applyVisualFitMode(mvid, cfg.fitMode || cfg.fit || 'contain', { mirror: false });
              _syncMediaEl(mvid, cfg);
              layer.style.visibility = cfg.mediaStopped ? 'hidden' : '';
              layer.appendChild(mvid);
            }
          } else if (layerData.type === 'text') {
            var txt = document.createElement('div');
            txt.className = 'src-text-overlay';
            txt.textContent = cfg.text || layerData.name || '';
            if (cfg.fontFamily) txt.style.fontFamily = cfg.fontFamily;
            if (cfg.fontSize) txt.style.fontSize = cfg.fontSize + 'px';
            if (cfg.color) txt.style.color = cfg.color;
            if (cfg.align) txt.style.textAlign = cfg.align;
            if (cfg.wordWrap === false) txt.style.whiteSpace = 'nowrap';
            if (cfg.showBg) {
              txt.style.backgroundColor = cfg.bgColor || '#000';
              txt.style.padding = '0.2em 0.5em';
              txt.style.borderRadius = '6px';
            }
            layer.appendChild(txt);
          } else if (layerData.type === 'window-capture') {
            var wcPh = document.createElement('div');
            wcPh.className = 'src-placeholder';
            wcPh.textContent = cfg.windowName || 'Window Capture';
            layer.appendChild(wcPh);
          } else if (layerData.type === 'scene') {
            var scPh = document.createElement('div');
            scPh.className = 'src-placeholder';
            scPh.textContent = cfg.sceneName ? ('Scene: ' + cfg.sceneName) : 'Scene Source';
            layer.appendChild(scPh);
          }
          // Create SVG sharpen filters if needed (same DOM as control panel)
          if (cfg.sharpenDefs && cfg.sharpenDefs.length) {
            cfg.sharpenDefs.forEach(function(d) { _ensureSharpenFilter(d.filterId, d.amount, d.radius); });
          }
          // Apply pre-computed video FX CSS filter
          if (cfg.videoFilter) layer.style.filter = cfg.videoFilter;
          if (cfg.videoVignette) layer.style.boxShadow = cfg.videoVignette;
          sceneCompositor.appendChild(layer);
        });
        var visObj = {};
        visibleIds.forEach(function (id) { visObj[id] = true; });
        _pruneMediaEls(visObj);
        stopMissingOutputStreams(visibleIds);
      }

      function safeAlign(value, fallback) {
        const v = String(value || '').toLowerCase();
        if (v === 'left' || v === 'right' || v === 'center' || v === 'justify') return v;
        return fallback;
      }

      function safeVAlign(value, fallback) {
        const v = String(value || '').toLowerCase();
        if (v === 'top' || v === 'middle' || v === 'bottom') return v;
        return fallback;
      }

      function mapVAlign(value) {
        if (value === 'top') return 'flex-start';
        if (value === 'bottom') return 'flex-end';
        return 'center';
      }

      function sendHello() {
        if (!channel) return;
        channel.postMessage({ type: 'HELLO', proto: 1, sender: 'display', ts: Date.now() });
      }

      function respondPong() {
        if (!channel) return;
        channel.postMessage({ type: 'PONG', proto: 1, sender: 'display', ts: Date.now() });
      }

      function setBackground(data) {
        const enabled = !!data.bgEnabled;
        const bgType = String(data.bgType || 'color');
        const opacity = Math.max(0, Math.min(1, Number(data.bgOpacity == null ? 1 : data.bgOpacity)));
        const blurPx = Math.max(0, Math.min(40, Number(data.bgBlur || 0)));
        bg.style.opacity = enabled ? String(opacity) : '0';
        bg.style.filter = blurPx > 0 ? 'blur(' + blurPx + 'px)' : 'none';

        if (!enabled) {
          bg.style.background = '#000';
          bg.style.backgroundImage = 'none';
          bgVideo.pause();
          bgVideo.removeAttribute('src');
          bgVideo.style.display = 'none';
          return;
        }

        if (bgType === 'video' && data.bgVideo) {
          bg.style.background = '#000';
          bg.style.backgroundImage = 'none';
          try {
            if (bgVideo.src !== data.bgVideo) bgVideo.src = data.bgVideo;
            bgVideo.loop = !!data.bgVideoLoop;
            bgVideo.playbackRate = Math.max(0.25, Math.min(2.5, Number(data.bgVideoSpeed || 1)));
            bgVideo.style.display = 'block';
            bgVideo.play().catch(function () {});
          } catch (e) {}
          return;
        }

        bgVideo.pause();
        bgVideo.style.display = 'none';
        bgVideo.removeAttribute('src');

        if (bgType === 'image' && data.bgImage) {
          bg.style.background = '#000';
          bg.style.backgroundImage = 'url("' + String(data.bgImage).replace(/"/g, '\\"') + '")';
          return;
        }

        const mode = String(data.bgMode || 'solid');
        const angle = Number(data.bgGradientAngle || 135);
        const shadow = data.bgGradientShadow || '#111111';
        const highlight = data.bgGradientHighlight || '#000000';
        if (mode === 'gradient') {
          bg.style.backgroundImage = 'linear-gradient(' + angle + 'deg, ' + shadow + ', ' + highlight + ')';
        } else {
          bg.style.backgroundImage = 'none';
          bg.style.backgroundColor = data.bgColor || '#000000';
        }
      }

      function setTypography(data, target) {
        target.style.fontFamily = data.fontFamily || "'Segoe UI',sans-serif";
        target.style.fontWeight = String(data.fontWeight || '700');
        target.style.lineHeight = String(data.mode === 'full' ? (data.lineHeightFull || 1.1) : (data.lineHeightLT || 1.1));
        target.style.color = data.textColor || '#ffffff';
      }

      function setModeAndLayout(data) {
        const mode = String(data.mode || 'full');
        const isFull = mode === 'full';
        stage.classList.toggle('mode-full', isFull);
        stage.classList.toggle('mode-lt', !isFull);
        fullText.style.display = isFull ? 'block' : 'none';
        ltWrap.style.display = isFull ? 'none' : 'flex';

        if (isFull) {
          const hAlign = safeAlign(data.hAlignFull, 'center');
          const vAlign = safeVAlign(data.vAlignFull, 'middle');
          stage.style.justifyContent = (hAlign === 'left') ? 'flex-start' : (hAlign === 'right') ? 'flex-end' : 'center';
          stage.style.alignItems = mapVAlign(vAlign);
          fullText.style.textAlign = (hAlign === 'justify') ? 'left' : hAlign;
          fullText.style.fontSize = String(Math.max(10, Number(data.fontSizeFull || 40))) + 'pt';
          fullText.style.textTransform = String(data.fullTextTransform || 'none');
          setTypography(data, fullText);
        } else {
          const isBible = !!data.isBible;
          const hAlign = isBible ? safeAlign(data.hAlignLTBible || data.hAlignLT, 'center') : safeAlign(data.hAlignLT, 'center');
          const vAlign = isBible ? safeVAlign(data.vAlignLTBible || data.vAlignLT, 'middle') : safeVAlign(data.vAlignLT, 'middle');
          const ltHeightPct = Math.max(10, Math.min(92, Number(data.ltBgHeightPct || 24)));
          ltWrap.style.height = ltHeightPct + 'vh';
          ltWrap.style.alignItems = mapVAlign(vAlign);
          ltWrap.style.justifyContent = (hAlign === 'left') ? 'flex-start' : (hAlign === 'right') ? 'flex-end' : 'center';
          ltText.style.textAlign = (hAlign === 'justify') ? 'left' : hAlign;
          ltText.style.fontSize = String(Math.max(10, Number(data.fontSizeLT || 42))) + 'pt';
          ltText.style.textTransform = String(data.ltTextTransform || 'none');
          setTypography(data, ltText);
        }
      }

      function applyUpdate(data) {
        if (data.seq && data.seq <= lastSeq) return;
        if (data.seq) lastSeq = data.seq;
        renderSceneLayers(data.sceneLayers);
        setBackground(data);
        setModeAndLayout(data);
        if (String(data.mode || 'full') === 'full') {
          fullText.innerHTML = data.text || '';
        } else {
          ltText.innerHTML = data.text || '';
        }
      }

      function clearOutput() {
        fullText.innerHTML = '';
        ltText.innerHTML = '';
      }

      if (channel) {
        channel.onmessage = function (event) {
          const data = event.data || {};
          const type = data.type;
          if (type === 'PING') {
            respondPong();
            return;
          }
          if (type === 'HELLO') {
            sendHello();
            return;
          }
          if (type === 'SYNC_STATE') {
            if (data.state && data.state.kind === 'update' && data.state.payload) applyUpdate(data.state.payload);
            if (data.state && data.state.kind === 'clear') {
              if (Array.isArray(data.state.sceneLayers)) renderSceneLayers(data.state.sceneLayers);
              clearOutput();
            }
            return;
          }
          if (type === 'UPDATE') {
            applyUpdate(data);
            return;
          }
          if (type === 'CLEAR') {
            if (Array.isArray(data.sceneLayers)) renderSceneLayers(data.sceneLayers);
            clearOutput();
          }
          if (type === 'SCENE_LAYERS_UPDATE') {
            if (Array.isArray(data.sceneLayers)) renderSceneLayers(data.sceneLayers);
          }
        };
      }

      window.addEventListener('message', function (event) {
        const data = event.data || {};
        if (data && data.type === 'REQUEST_FULLSCREEN') {
          document.documentElement.requestFullscreen().catch(function () {});
          return;
        }
        if (data && data.type === 'PREVIEW_UPDATE' && data.payload) {
          applyUpdate(data.payload);
          return;
        }
        if (data && data.type === 'PREVIEW_CLEAR') {
          clearOutput();
          return;
        }
        if (data && data.type === 'SCENE_LAYERS_UPDATE') {
          renderSceneLayers(data.sceneLayers);
          return;
        }
      });

      window.addEventListener('beforeunload', function () {
        stopMissingOutputStreams(new Set());
        if (channel) {
          try { channel.close(); } catch (e) {}
        }
      });

      try {
        if (!IS_PREVIEW && window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'STANDALONE_READY' }, '*');
        }
      } catch (e) {}

      if (!IS_PREVIEW) {
        sendHello();
        setInterval(sendHello, 2000);
      }
    })();
  <\/script>
</body>
</html>`;
    }

    function getOutputBoundsFromSelection() {
      const select = document.getElementById('output-screen-select');
      const selected = String(select?.value || 'auto');
      const usable = Array.isArray(outputScreenList) ? outputScreenList : [];
      if (!usable.length) {
        return {
          left: window.screenX || 0,
          top: window.screenY || 0,
          width: window.screen.availWidth || window.screen.width || 1280,
          height: window.screen.availHeight || window.screen.height || 720
        };
      }
      if (selected && selected !== 'auto') {
        const matched = usable.find(s => s.id === selected);
        if (matched) return matched;
      }
      const preferred = usable.find(s => !s.isInternal && !s.isPrimary) ||
        usable.find(s => !s.isPrimary) ||
        usable.find(s => s.isPrimary) ||
        usable[0];
      return preferred;
    }

    function hasDesktopOutputBridge() {
      return !!(window.BSPDesktop && typeof window.BSPDesktop.openOutput === 'function');
    }

    function getStandaloneOutputSource() {
      return 'lyrics';
    }

    function getPreferredExternalScreen() {
      const usable = Array.isArray(outputScreenList) ? outputScreenList : [];
      return usable.find(s => !s.isInternal && !s.isPrimary) ||
        usable.find(s => !s.isInternal) ||
        null;
    }

    function setOutputLiveState(active) {
      outputLiveActive = !!active;
      const goBtns = document.querySelectorAll('#btn-output-go-live, #btn-output-go-live-panel');
      const endBtn = document.getElementById('btn-output-end-live');
      goBtns.forEach((btn) => btn.classList.toggle('live-active', outputLiveActive));
      if (endBtn) endBtn.classList.toggle('show', outputLiveActive);
      layoutProgramScaleControls();
      if (outputLiveWatcher) {
        clearInterval(outputLiveWatcher);
        outputLiveWatcher = null;
      }
      if (outputLiveActive) {
        outputLiveWatcher = setInterval(() => {
          if (hasDesktopOutputBridge()) {
            window.BSPDesktop.isOutputOpen().then((isOpen) => {
              if (!isOpen) setOutputLiveState(false);
            }).catch(() => {});
            return;
          }
          if (!standaloneDisplayWindow || standaloneDisplayWindow.closed) {
            setOutputLiveState(false);
          }
        }, 3000);
      }
    }

    function getWindowFeaturesForOutput(bounds) {
      const parsedLeft = Number(bounds.left);
      const parsedTop = Number(bounds.top);
      const left = Number.isFinite(parsedLeft) ? Math.round(parsedLeft) : Math.round(Number(window.screenX || 0));
      const top = Number.isFinite(parsedTop) ? Math.round(parsedTop) : Math.round(Number(window.screenY || 0));
      const width = Math.max(640, Math.round(Number(bounds.width || 1280)));
      const height = Math.max(360, Math.round(Number(bounds.height || 720)));
      return `popup=yes,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no,left=${left},top=${top},width=${width},height=${height}`;
    }

    function tryMoveStandaloneOutputWindow(bounds) {
      if (!standaloneDisplayWindow || standaloneDisplayWindow.closed) return;
      const left = Math.round(Number(bounds.left || 0));
      const top = Math.round(Number(bounds.top || 0));
      const width = Math.max(640, Math.round(Number(bounds.width || 1280)));
      const height = Math.max(360, Math.round(Number(bounds.height || 720)));
      try { standaloneDisplayWindow.moveTo(left, top); } catch (e) {}
      try { standaloneDisplayWindow.resizeTo(width, height); } catch (e) {}
    }

    async function refreshOutputScreenList(opts = {}) {
      const select = document.getElementById('output-screen-select');
      const meta = document.getElementById('output-screen-meta');
      const prevValue = select?.value || 'auto';
      outputScreenList = [];
      if (hasDesktopOutputBridge()) {
        try {
          const screens = await window.BSPDesktop.getDisplays();
          outputScreenList = Array.isArray(screens) ? screens.map((screen, idx) => ({
            id: String(screen.id || `screen_${idx}`),
            label: screen.label || ((screen.isPrimary ? 'Primary Display' : `Display ${idx + 1}`)),
            left: Number(screen.left || 0),
            top: Number(screen.top || 0),
            width: Number(screen.width || 1280),
            height: Number(screen.height || 720),
            isPrimary: !!screen.isPrimary,
            isInternal: !!screen.isInternal
          })) : [];
          if (meta) {
            const externals = outputScreenList.filter(s => !s.isInternal).length;
            meta.textContent = `${outputScreenList.length} display(s) detected, ${externals} external`;
          }
        } catch (err) {
          if (meta) {
            meta.textContent = `Desktop display detection failed: ${err && err.message ? err.message : 'unknown error'}.`;
          }
        }
        if (!outputScreenList.length) {
          outputScreenList = [{
            id: 'current',
            label: 'Current Screen',
            left: Number(window.screenX || 0),
            top: Number(window.screenY || 0),
            width: Number(window.screen.availWidth || window.screen.width || 1280),
            height: Number(window.screen.availHeight || window.screen.height || 720),
            isPrimary: true,
            isInternal: true
          }];
        }
        if (select) {
          const options = ['<option value="auto">Auto (prefer external display)</option>'];
          outputScreenList.forEach((screen, idx) => {
            const kind = screen.isInternal ? 'Internal' : 'External';
            const primary = screen.isPrimary ? ' (Primary)' : '';
            options.push(`<option value="${screen.id}">${screen.label || ('Display ' + (idx + 1))} - ${kind}${primary} (${screen.width}x${screen.height})</option>`);
          });
          select.innerHTML = options.join('');
          select.value = outputScreenList.some(s => s.id === prevValue) ? prevValue : 'auto';
        }
        if (outputPopoverOpen) {
          renderOutputScreenPopover();
        }
        return;
      }
      try {
        if (typeof window.getScreenDetails === 'function') {
          outputScreenDetails = await window.getScreenDetails();
          if (outputScreenDetails && !outputScreenDetailsBound) {
            outputScreenDetailsBound = true;
            const update = () => refreshOutputScreenList();
            outputScreenDetails.addEventListener('screenschange', update);
            outputScreenDetails.addEventListener('currentscreenchange', update);
          }
          const screens = Array.isArray(outputScreenDetails.screens) ? outputScreenDetails.screens : [];
          outputScreenList = screens.map((screen, idx) => ({
            id: `screen_${idx}`,
            label: screen.label || ((screen.isPrimary ? 'Primary Display' : `Display ${idx + 1}`)),
            left: Number(screen.left || 0),
            top: Number(screen.top || 0),
            width: Number(screen.availWidth || screen.width || 1280),
            height: Number(screen.availHeight || screen.height || 720),
            isPrimary: !!screen.isPrimary,
            isInternal: !!screen.isInternal
          }));
          if (meta) {
            const externals = outputScreenList.filter(s => !s.isInternal).length;
            meta.textContent = `${outputScreenList.length} display(s) detected, ${externals} external`;
          }
        } else {
          outputScreenList = [{
            id: 'current',
            label: 'Current Screen',
            left: Number(window.screenX || 0),
            top: Number(window.screenY || 0),
            width: Number(window.screen.availWidth || window.screen.width || 1280),
            height: Number(window.screen.availHeight || window.screen.height || 720),
            isPrimary: true,
            isInternal: true
          }];
          if (meta) {
            meta.textContent = 'Advanced multi-screen detection not supported in this browser. Using current screen.';
          }
        }
      } catch (err) {
        if (meta) {
          meta.textContent = `Display detection blocked: ${err && err.message ? err.message : 'permission denied'}.`;
        }
        outputScreenList = [{
          id: 'current',
          label: 'Current Screen',
          left: Number(window.screenX || 0),
          top: Number(window.screenY || 0),
          width: Number(window.screen.availWidth || window.screen.width || 1280),
          height: Number(window.screen.availHeight || window.screen.height || 720),
          isPrimary: true,
          isInternal: true
        }];
      }

      if (select) {
        const options = ['<option value="auto">Auto (prefer external display)</option>'];
        outputScreenList.forEach((screen, idx) => {
          const kind = screen.isInternal ? 'Internal' : 'External';
          const primary = screen.isPrimary ? ' (Primary)' : '';
          options.push(`<option value="${screen.id}">${screen.label || ('Display ' + (idx + 1))} - ${kind}${primary} (${screen.width}x${screen.height})</option>`);
        });
        select.innerHTML = options.join('');
        select.value = options.some(opt => opt.includes(`value="${prevValue}"`)) ? prevValue : 'auto';
      }
      if (opts.forcePrompt && typeof window.getScreenDetails !== 'function') {
        showToast(t('output_browser_no_screen_details'));
      }
      if (outputPopoverOpen) {
        renderOutputScreenPopover();
      }
    }

    async function openStandaloneOutputWindow(opts = {}) {
      if (hasDesktopOutputBridge()) {
        const select = document.getElementById('output-screen-select');
        const selectedId = String(select?.value || 'auto');
        const source = getStandaloneOutputSource();
        const shouldFullscreen = !!opts.requestFullscreen || outputLiveActive;
        const result = await window.BSPDesktop.openOutput({
          displayId: selectedId,
          source,
          requestFullscreen: shouldFullscreen,
          reposition: !!opts.moveAfterOpen,
          activate: !!opts.requestFullscreen
        }).catch(() => null);
        if (!result || !result.ok) {
          showToast(t('output_open_failed'));
          return false;
        }
        sendSyncState();
        queueStandaloneSyncBurst();
        return true;
      }
      const standaloneUrl = getStandaloneOutputUrl();
      const bounds = getOutputBoundsFromSelection();
      const features = getWindowFeaturesForOutput(bounds);
      standaloneDisplayWindow = window.open(standaloneUrl, 'bsp_standalone_output', features);
      if (!standaloneDisplayWindow) {
        showToast(t('output_popup_blocked'));
        return false;
      }
      try { standaloneDisplayWindow.focus(); } catch (e) {}
      if (opts.moveAfterOpen !== false) {
        tryMoveStandaloneOutputWindow(bounds);
        setTimeout(() => tryMoveStandaloneOutputWindow(bounds), 120);
        setTimeout(() => tryMoveStandaloneOutputWindow(bounds), 350);
      }
      if (opts.requestFullscreen) {
        requestStandaloneOutputFullscreen();
      }
      sendSyncState();
      queueStandaloneSyncBurst();
      return true;
    }

    async function openStandaloneOutputFromUi() {
      await refreshOutputScreenList({ forcePrompt: true }).catch(() => {});
      const preferredExternal = getPreferredExternalScreen();
      const select = document.getElementById('output-screen-select');
      if (preferredExternal && select) {
        select.value = preferredExternal.id;
      }
      const opened = await openStandaloneOutputWindow({ requestFullscreen: true });
      if (!opened) return;
      if (isLive && livePointer) pushLiveUpdate();
      if (preferredExternal) {
        showToast(t('output_sent_to_display').replace('{display}', preferredExternal.label || 'external display'));
      } else {
        showToast(t('output_no_external_detected_opened_current'));
      }
    }

    async function startOutputLive() {
      if (!hasDesktopOutputBridge()) {
        // Browser fallback: open immediately in the click gesture so popup placement stays allowed.
        const preOpened = await openStandaloneOutputWindow({ moveAfterOpen: false });
        if (!preOpened) return;
      }
      await refreshOutputScreenList({ forcePrompt: true }).catch(() => {});
      const select = document.getElementById('output-screen-select');
      const preferredExternal = getPreferredExternalScreen();
      if (select && (!select.value || select.value === 'auto') && preferredExternal) {
        select.value = preferredExternal.id;
      }
      const opened = await openStandaloneOutputWindow({ moveAfterOpen: true, requestFullscreen: true });
      if (!opened) return;
      setOutputLiveState(true);
      if (isLive && livePointer) {
        pushLiveUpdate();
      } else if (embeddedProgramDisplayState.kind === 'update' && embeddedProgramDisplayState.payload) {
        const viewport = getEmbeddedDisplayViewport();
        postMessageToStandaloneOutput({
          type: 'PREVIEW_UPDATE',
          payload: {
            ...embeddedProgramDisplayState.payload,
            sceneLayers: getOutputSceneLayers(),
            displayViewportWidth: viewport.width,
            displayViewportHeight: viewport.height
          }
        });
      } else {
        sendSyncState();
      }
      const chosenId = String(select?.value || '');
      const chosen = (Array.isArray(outputScreenList) ? outputScreenList : []).find(s => s.id === chosenId);
      showToast(chosen
        ? t('output_live_on_display').replace('{display}', chosen.label || 'selected display')
        : t('output_live_started'));
    }

    function endOutputLive() {
      if (hasDesktopOutputBridge()) {
        window.BSPDesktop.closeOutput().catch(() => {});
      }
      if (standaloneDisplayWindow && !standaloneDisplayWindow.closed) {
        try { standaloneDisplayWindow.close(); } catch (e) {}
      }
      standaloneDisplayWindow = null;
      setOutputLiveState(false);
      showToast(t('output_live_ended'));
    }

    const _PGM_STREAM_CONFIG_KEY = 'projection_stream_config_v1';
    const _PGM_STREAM_PLATFORM_DEFAULTS = {
      youtube: {
        name: 'YouTube',
        url: 'rtmps://a.rtmp.youtube.com/live2',
        help: 'In YouTube Studio: Go Live -> Stream -> copy Stream URL and Stream Key.'
      },
      facebook: {
        name: 'Facebook',
        url: 'rtmps://live-api-s.facebook.com:443/rtmp/',
        help: 'In Facebook Live Producer: choose Stream key -> copy Server URL and Stream Key.'
      },
      twitch: {
        name: 'Twitch',
        url: 'rtmp://live.twitch.tv/app/',
        help: 'In Twitch Dashboard: Settings -> Stream -> copy your Primary Stream Key.'
      },
      kick: {
        name: 'Kick',
        url: 'rtmp://fa723fc1b171.global-contribute.live-video.net/app/',
        help: 'In Kick Dashboard: Settings -> Stream -> copy Stream URL and Stream Key.'
      },
      instagram: {
        name: 'Instagram',
        url: 'rtmps://live-upload.instagram.com:443/rtmp/',
        help: 'In Instagram Live (Streaming software): copy Stream URL and Stream Key.'
      },
      custom: {
        name: 'Custom RTMP',
        url: '',
        help: 'Use the exact ingest URL and stream key provided by your platform.'
      }
    };
    const _pgmStreamState = {
      running: false,
      status: 'idle',
      starting: false,
      lastError: '',
      encoderReady: false,
      encoderPath: '',
	      config: {
	        platform: 'youtube',
	        url: 'rtmps://a.rtmp.youtube.com/live2',
	        key: '',
	        canvasResolution: '1920x1080',
	        resolution: '1920x1080',
	        fps: 30,
	        bitrateKbps: 4500
	      }
	    };
	    let _pgmStreamAudioCtx = null;
	    let _pgmStreamAudioSource = null;
	    let _pgmStreamAudioProcessor = null;
	    let _pgmStreamAudioSink = null;
	    let _pgmStreamAudioNullDest = null;

    function pgmStreamInferProtocol(url, fallback = 'rtmps') {
      const raw = String(url || '').trim().toLowerCase();
      if (raw.startsWith('srt://')) return 'srt';
      if (raw.startsWith('rtmps://')) return 'rtmps';
      if (raw.startsWith('rtmp://')) return 'rtmp';
      if (raw.startsWith('https://') || raw.startsWith('http://')) return 'whip';
      return fallback;
    }

	    function pgmStreamNormalizeUrl(platform, rawUrl) {
	      const value = String(rawUrl || '').trim();
	      if (!value) return '';
	      if (platform === 'youtube' && /^rtmp:\/\/a\.rtmp\.youtube\.com\/live2\/?$/i.test(value)) {
	        return 'rtmps://a.rtmp.youtube.com/live2';
	      }
	      return value;
	    }

	    function _pgmStreamPackS16leStereo(left, right) {
	      const frames = Math.min(left.length, right.length);
	      const out = new Uint8Array(frames * 4);
	      let o = 0;
	      for (let i = 0; i < frames; i++) {
	        const l = Math.max(-1, Math.min(1, Number(left[i]) || 0));
	        const r = Math.max(-1, Math.min(1, Number(right[i]) || 0));
	        const li = l < 0 ? Math.round(l * 0x8000) : Math.round(l * 0x7fff);
	        const ri = r < 0 ? Math.round(r * 0x8000) : Math.round(r * 0x7fff);
	        out[o++] = li & 0xff;
	        out[o++] = (li >> 8) & 0xff;
	        out[o++] = ri & 0xff;
	        out[o++] = (ri >> 8) & 0xff;
	      }
	      return out;
	    }

	    async function pgmStreamStartAudioPump() {
	      if (!(window.BSPDesktop && typeof window.BSPDesktop.pushStreamAudioChunk === 'function')) return false;
	      if (_pgmStreamAudioCtx) return true;
	      _pgmEnsureGraph();
	      _pgmApplyMonitoringModeRouting();
	      _pgmSyncSources();
	      const pgmStream = getPgmOutputStream();
	      if (!(pgmStream && typeof pgmStream.getAudioTracks === 'function' && pgmStream.getAudioTracks().length)) {
	        _pgmStreamState.lastError = 'Program mix audio unavailable.';
	        pgmStreamRenderState();
	        return false;
	      }
	      const Ctor = window.AudioContext || window.webkitAudioContext;
	      if (!Ctor) return false;
	      try {
	        _pgmStreamAudioCtx = new Ctor({ latencyHint: 'interactive', sampleRate: 48000 });
	      } catch (_) {
	        _pgmStreamAudioCtx = new Ctor();
	      }
	      try {
	        if (_pgmStreamAudioCtx.state === 'suspended') await _pgmStreamAudioCtx.resume();
	      } catch (_) {}

	      _pgmStreamAudioSource = _pgmStreamAudioCtx.createMediaStreamSource(pgmStream);
	      // 2048-sample buffer (~42ms @ 48kHz) balances stream latency against
	      // main-thread callback pressure. Lower than 4096 for tighter A/V sync.
	      _pgmStreamAudioProcessor = _pgmStreamAudioCtx.createScriptProcessor(2048, 2, 2);
	      _pgmStreamAudioSink = _pgmStreamAudioCtx.createGain();
	      _pgmStreamAudioSink.gain.value = 0;
	      _pgmStreamAudioNullDest = _pgmStreamAudioCtx.createMediaStreamDestination();
	      _pgmStreamAudioProcessor.onaudioprocess = (evt) => {
	        if (!(_pgmStreamState.running || _pgmStreamState.starting)) return;
	        const input = evt.inputBuffer;
	        if (!input) return;
	        const left = input.numberOfChannels > 0 ? input.getChannelData(0) : null;
	        const right = input.numberOfChannels > 1 ? input.getChannelData(1) : left;
	        if (!left || !right) return;
	        const pcm = _pgmStreamPackS16leStereo(left, right);
	        try { window.BSPDesktop.pushStreamAudioChunk(pcm); } catch (_) {}
	      };
	      _pgmStreamAudioSource.connect(_pgmStreamAudioProcessor);
	      _pgmStreamAudioProcessor.connect(_pgmStreamAudioSink);
	      // Keep the processor graph alive without routing to speakers.
	      _pgmStreamAudioSink.connect(_pgmStreamAudioNullDest);
	      return true;
	    }

	    function pgmStreamStopAudioPump() {
	      try {
	        if (window.BSPDesktop && typeof window.BSPDesktop.endStreamAudio === 'function') {
	          window.BSPDesktop.endStreamAudio();
	        }
	      } catch (_) {}
	      if (_pgmStreamAudioProcessor) {
	        try { _pgmStreamAudioProcessor.disconnect(); } catch (_) {}
	        _pgmStreamAudioProcessor.onaudioprocess = null;
	      }
	      if (_pgmStreamAudioSource) {
	        try { _pgmStreamAudioSource.disconnect(); } catch (_) {}
	      }
	      if (_pgmStreamAudioSink) {
	        try { _pgmStreamAudioSink.disconnect(); } catch (_) {}
	      }
	      if (_pgmStreamAudioNullDest) {
	        try { _pgmStreamAudioNullDest.disconnect(); } catch (_) {}
	      }
	      if (_pgmStreamAudioCtx) {
	        try { _pgmStreamAudioCtx.close(); } catch (_) {}
	      }
	      _pgmStreamAudioCtx = null;
	      _pgmStreamAudioSource = null;
	      _pgmStreamAudioProcessor = null;
	      _pgmStreamAudioSink = null;
	      _pgmStreamAudioNullDest = null;
	    }

    function pgmStreamPersistConfig() {
      try {
        localStorage.setItem(_PGM_STREAM_CONFIG_KEY, JSON.stringify(_pgmStreamState.config));
      } catch (e) {}
    }

    function pgmStreamLoadConfig() {
      try {
        const raw = localStorage.getItem(_PGM_STREAM_CONFIG_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        _pgmStreamState.config.platform = String(parsed.platform || _pgmStreamState.config.platform);
        _pgmStreamState.config.url = String(parsed.url || _pgmStreamState.config.url);
        _pgmStreamState.config.key = String(parsed.key || '');
	        _pgmStreamState.config.canvasResolution = String(parsed.canvasResolution || _pgmStreamState.config.canvasResolution);
	        _pgmStreamState.config.resolution = String(parsed.resolution || _pgmStreamState.config.resolution);
	        _pgmStreamState.config.fps = Math.max(15, Math.min(60, Number(parsed.fps) || _pgmStreamState.config.fps));
	        _pgmStreamState.config.bitrateKbps = Math.max(500, Math.min(20000, Number(parsed.bitrateKbps) || _pgmStreamState.config.bitrateKbps));
	      } catch (e) {}
      _pgmStreamState.config.url = pgmStreamNormalizeUrl(_pgmStreamState.config.platform, _pgmStreamState.config.url);
    }

    function pgmStreamRenderState() {
      const cfg = _pgmStreamState.config;
      const platform = _PGM_STREAM_PLATFORM_DEFAULTS[cfg.platform] || _PGM_STREAM_PLATFORM_DEFAULTS.custom;
      const pill = document.getElementById('pgm-stream-pill');
      const toggleBtn = document.getElementById('pgm-stream-toggle-btn');
      const settingsBtn = document.getElementById('pgm-stream-settings-btn');
      const platformEl = document.getElementById('pgm-stream-platform');
      const destinationEl = document.getElementById('pgm-stream-destination');
      const canvasInfoEl = document.getElementById('pgm-stream-canvas-info');
      const outputInfoEl = document.getElementById('pgm-stream-output-info');
      const audioInfoEl = document.getElementById('pgm-stream-audio-info');
      const encoderEl = document.getElementById('pgm-stream-encoder');
      const errEl = document.getElementById('pgm-stream-error');

      if (platformEl) platformEl.textContent = platform.name;
      if (destinationEl) destinationEl.textContent = cfg.url || 'No server URL';
	      if (canvasInfoEl) canvasInfoEl.textContent = (cfg.canvasResolution || '1920x1080').replace('x', '×');
	      if (outputInfoEl) outputInfoEl.textContent = (cfg.resolution || '1920x1080').replace('x', '×');
	      if (audioInfoEl) {
	        audioInfoEl.textContent = 'Program Mix';
	      }
      if (encoderEl) {
        if (_pgmStreamState.encoderReady) encoderEl.textContent = _pgmStreamState.encoderPath || 'Ready';
        else encoderEl.textContent = 'Unavailable';
      }
      if (errEl) errEl.textContent = _pgmStreamState.lastError || 'None';

      const live = _pgmStreamState.running;
      if (pill) {
        pill.classList.toggle('live', live);
        if (_pgmStreamState.starting) pill.textContent = 'STARTING';
        else pill.textContent = live ? 'LIVE' : 'OFFLINE';
      }
      if (toggleBtn) {
        toggleBtn.disabled = _pgmStreamState.starting || !_pgmStreamState.encoderReady;
        toggleBtn.classList.toggle('live', live);
        toggleBtn.textContent = _pgmStreamState.starting ? 'Starting...' : (live ? 'Stop Streaming' : 'Start Streaming');
      }
      if (settingsBtn) {
        settingsBtn.disabled = _pgmStreamState.starting || live;
      }
    }

    function pgmStreamHandlePlatformChange() {
      const platformSelect = document.getElementById('pgm-stream-platform-select');
      const urlInput = document.getElementById('pgm-stream-url-input');
      const help = document.getElementById('pgm-stream-help');
      const platform = String(platformSelect?.value || 'custom');
      const defaults = _PGM_STREAM_PLATFORM_DEFAULTS[platform] || _PGM_STREAM_PLATFORM_DEFAULTS.custom;
      if (help) help.textContent = defaults.help || '';
      if (urlInput && !String(urlInput.value || '').trim() && defaults.url) {
        urlInput.value = defaults.url;
      }
    }

    async function pgmStreamOpenSettings() {
      const overlay = document.getElementById('pgm-stream-settings-overlay');
      if (!overlay) return;

      const cfg = _pgmStreamState.config;
      const platformSelect = document.getElementById('pgm-stream-platform-select');
      const urlInput = document.getElementById('pgm-stream-url-input');
	      const keyInput = document.getElementById('pgm-stream-key-input');
	      const canvasSelect = document.getElementById('pgm-stream-canvas-select');
	      const resolutionSelect = document.getElementById('pgm-stream-resolution-select');
	      const fpsSelect = document.getElementById('pgm-stream-fps-select');
	      const bitrateInput = document.getElementById('pgm-stream-bitrate-input');

      if (platformSelect) platformSelect.value = cfg.platform || 'custom';
      if (urlInput) urlInput.value = cfg.url || '';
      if (keyInput) keyInput.value = cfg.key || '';
	      if (canvasSelect) canvasSelect.value = cfg.canvasResolution || '1920x1080';
	      if (resolutionSelect) resolutionSelect.value = cfg.resolution || '1920x1080';
	      if (fpsSelect) fpsSelect.value = String(cfg.fps || 30);
	      if (bitrateInput) bitrateInput.value = String(cfg.bitrateKbps || 4500);

      pgmStreamHandlePlatformChange();
      overlay.classList.add('open');
    }

    function pgmStreamCloseSettings() {
      const overlay = document.getElementById('pgm-stream-settings-overlay');
      if (overlay) overlay.classList.remove('open');
    }

    function pgmStreamSaveSettings() {
      const platformSelect = document.getElementById('pgm-stream-platform-select');
      const urlInput = document.getElementById('pgm-stream-url-input');
	      const keyInput = document.getElementById('pgm-stream-key-input');
	      const canvasSelect = document.getElementById('pgm-stream-canvas-select');
	      const resolutionSelect = document.getElementById('pgm-stream-resolution-select');
	      const fpsSelect = document.getElementById('pgm-stream-fps-select');
	      const bitrateInput = document.getElementById('pgm-stream-bitrate-input');
      const platform = String(platformSelect?.value || 'custom');
      const rawUrl = String(urlInput?.value || '').trim();
      const url = pgmStreamNormalizeUrl(platform, rawUrl);
      const key = String(keyInput?.value || '').trim();
      const protocol = pgmStreamInferProtocol(url, 'rtmps');
      if (!url) {
        showToast(t('stream_url_required'));
        return;
      }
      if (protocol !== 'srt' && !key) {
        showToast(t('stream_key_required'));
        return;
      }
      _pgmStreamState.config = {
        platform,
        url,
        key,
	        canvasResolution: String(canvasSelect?.value || '1920x1080'),
	        resolution: String(resolutionSelect?.value || '1920x1080'),
	        fps: Math.max(15, Math.min(60, Number(fpsSelect?.value || 30))),
	        bitrateKbps: Math.max(500, Math.min(20000, Number(bitrateInput?.value || 4500)))
	      };
      pgmStreamPersistConfig();
      pgmStreamRenderState();
      pgmStreamCloseSettings();
      showToast(t('stream_settings_saved'));
    }

    async function pgmStreamCheckReadiness() {
      if (!(window.BSPDesktop && typeof window.BSPDesktop.getStreamReadiness === 'function')) {
        _pgmStreamState.encoderReady = false;
        _pgmStreamState.encoderPath = '';
        pgmStreamRenderState();
        return false;
      }
      try {
        const ready = await window.BSPDesktop.getStreamReadiness();
        const ok = !!(ready && ready.ok !== false && ready.available !== false && ready.platformSupported !== false);
        _pgmStreamState.encoderReady = ok;
        _pgmStreamState.encoderPath = String(ready?.path || '');
        pgmStreamRenderState();
        return ok;
      } catch (e) {
        _pgmStreamState.encoderReady = false;
        _pgmStreamState.encoderPath = '';
        pgmStreamRenderState();
        return false;
      }
    }

    async function pgmStreamToggle() {
      if (_pgmStreamState.starting) return;
      if (!(window.BSPDesktop && typeof window.BSPDesktop.startStream === 'function')) {
        showToast(t('stream_backend_unavailable'));
        return;
      }

	      if (_pgmStreamState.running) {
	        _pgmStreamState.starting = true;
	        pgmStreamRenderState();
	        pgmStreamStopAudioPump();
	        await window.BSPDesktop.stopStream().catch(() => {});
	        _pgmStreamState.starting = false;
	        _pgmStreamState.running = false;
	        _pgmStreamState.status = 'idle';
	        pgmStreamRenderState();
        showToast(t('stream_projection_stopped'));
        return;
      }

      const ready = await pgmStreamCheckReadiness();
      if (!ready) {
        showToast(t('stream_encoder_not_ready'));
        return;
      }
      const cfg = _pgmStreamState.config;
      const url = pgmStreamNormalizeUrl(cfg.platform, cfg.url);
      const protocol = pgmStreamInferProtocol(url, 'rtmps');
      if (!url) {
        showToast(t('stream_configure_url'));
        return;
      }
      if (protocol !== 'srt' && !cfg.key) {
        showToast(t('stream_configure_key'));
        return;
      }
	      _pgmStreamState.starting = true;
	      _pgmStreamState.lastError = '';
	      pgmStreamRenderState();
	      const audioPumpOk = await pgmStreamStartAudioPump();
	      if (!audioPumpOk) {
	        _pgmStreamState.starting = false;
	        _pgmStreamState.running = false;
	        _pgmStreamState.status = 'error';
	        if (!_pgmStreamState.lastError) _pgmStreamState.lastError = 'Program mix audio not available.';
	        pgmStreamRenderState();
	        showToast(_pgmStreamState.lastError);
	        return;
	      }
	      try { syncStandaloneOutputDirect(); } catch (e) {}
	      try { queueStandaloneSyncBurst(); } catch (e) {}

      const payload = {
        sourceMode: 'projection',
        streamOwner: 'projection-extras',
        canvasResolution: cfg.canvasResolution || '1920x1080',
	        resolution: cfg.resolution || '1920x1080',
	        fps: Number(cfg.fps || 30),
	        bitrateKbps: Number(cfg.bitrateKbps || 4500),
	        audioFromRenderer: true,
	        streamProtocol: protocol,
	        targets: [{
          url,
          key: cfg.key || '',
          name: (_PGM_STREAM_PLATFORM_DEFAULTS[cfg.platform]?.name || 'Projection Stream'),
          protocol
        }]
      };

	      const resp = await window.BSPDesktop.startStream(payload).catch(() => ({ ok: false, error: 'Failed to start stream backend' }));
	      _pgmStreamState.starting = false;
	      if (!resp || !resp.ok) {
	        pgmStreamStopAudioPump();
	        _pgmStreamState.running = false;
	        _pgmStreamState.status = 'error';
	        _pgmStreamState.lastError = String(resp?.error || 'Failed to start stream');
        pgmStreamRenderState();
        showToast(`Streaming failed: ${_pgmStreamState.lastError}`);
        return;
      }
      _pgmStreamState.running = true;
      _pgmStreamState.status = 'starting';
      pgmStreamRenderState();
      showToast(t('stream_starting_projection'));
    }

    function pgmStreamHandleStatusEvent(status) {
      const st = status || {};
      _pgmStreamState.running = !!st.running && (st.status === 'starting' || st.status === 'live' || st.status === 'stopping');
      _pgmStreamState.status = String(st.status || (_pgmStreamState.running ? 'live' : 'idle'));
      if (st.ffmpegPath) {
        _pgmStreamState.encoderReady = true;
        _pgmStreamState.encoderPath = String(st.ffmpegPath || '');
      }
      if (st.ffmpegAvailable === false || st.platformSupported === false) {
        _pgmStreamState.encoderReady = false;
      }
      if (st.status === 'error' && st.lastError) {
        _pgmStreamState.lastError = String(st.lastError);
      } else if (st.status === 'idle') {
        _pgmStreamState.lastError = '';
      }
	      if (st.status !== 'starting') {
	        _pgmStreamState.starting = false;
	      }
	      if (!_pgmStreamState.running && st.status !== 'starting') {
	        pgmStreamStopAudioPump();
	      }
	      pgmStreamRenderState();
	    }

    async function initProjectionStreamingExtras() {
      pgmStreamLoadConfig();
      pgmStreamRenderState();
      await pgmStreamCheckReadiness();
      if (window.BSPDesktop && typeof window.BSPDesktop.onStreamStatus === 'function') {
        window.BSPDesktop.onStreamStatus((st) => {
          pgmStreamHandleStatusEvent(st);
        });
      }
      if (window.BSPDesktop && typeof window.BSPDesktop.getStreamStatus === 'function') {
        const st = await window.BSPDesktop.getStreamStatus().catch(() => null);
        if (st && st.ok) pgmStreamHandleStatusEvent(st);
      }
    }

    async function moveStandaloneOutputToSelectedScreen() {
      const opened = await openStandaloneOutputWindow({ moveAfterOpen: true });
      if (!opened) return;
      showToast(t('output_window_moved'));
    }

    function requestStandaloneOutputFullscreen() {
      if (hasDesktopOutputBridge()) {
        window.BSPDesktop.requestOutputFullscreen().catch(() => {});
        return;
      }
      if (!standaloneDisplayWindow || standaloneDisplayWindow.closed) {
        showToast(t('output_open_first'));
        return;
      }
      try {
        standaloneDisplayWindow.focus();
        standaloneDisplayWindow.postMessage({ type: 'REQUEST_FULLSCREEN' }, '*');
      } catch (e) {}
    }

    async function refreshCameraDevices() {
      const select = document.getElementById('camera-select');
      if (!select) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(d => d.kind === 'videoinput');
        if (!cameras.length) {
          select.innerHTML = '<option value="">No camera detected</option>';
          return;
        }
        const prev = select.value;
        select.innerHTML = cameras.map((cam, idx) =>
          `<option value="${cam.deviceId}">${esc(_sanitizeSourceDisplayLabel(cam.label, `Camera ${idx + 1}`))}</option>`
        ).join('');
        if (cameras.some(cam => cam.deviceId === prev)) select.value = prev;
      } catch (err) {
        select.innerHTML = '<option value="">Camera access unavailable</option>';
      }
    }

    async function startCameraPreview() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast(t('camera_preview_not_supported'));
        return;
      }
      const videoEl = document.getElementById('camera-preview');
      const select = document.getElementById('camera-select');
      const deviceId = select?.value || '';
      try {
        if (cameraPreviewStream) {
          cameraPreviewStream.getTracks().forEach(track => track.stop());
          cameraPreviewStream = null;
        }
        cameraPreviewStream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false
        });
        if (videoEl) {
          videoEl.srcObject = cameraPreviewStream;
          await videoEl.play().catch(() => {});
        }
        const btn = document.getElementById('camera-toggle-btn');
        if (btn) {
          btn.textContent = 'Stop Camera Preview';
          btn.style.background = 'var(--danger)';
        }
        await refreshCameraDevices();
      } catch (err) {
        showToast(t('camera_preview_failed').replace('{error}', err && err.message ? err.message : 'unknown error'));
      }
    }

    function stopCameraPreview() {
      const videoEl = document.getElementById('camera-preview');
      if (cameraPreviewStream) {
        cameraPreviewStream.getTracks().forEach(track => track.stop());
        cameraPreviewStream = null;
      }
      if (videoEl) videoEl.srcObject = null;
      const btn = document.getElementById('camera-toggle-btn');
      if (btn) {
        btn.textContent = 'Start Camera Preview';
        btn.style.background = '#1f2937';
      }
    }

    async function toggleCameraPreview() {
      if (cameraPreviewStream) {
        stopCameraPreview();
        return;
      }
      await startCameraPreview();
    }

    function initStandaloneTools() {
      initEmbeddedProgramDisplay();
      initProjectionStreamingExtras().catch(() => {});
      refreshOutputScreenList().catch(() => {});
      refreshPgmOutputDevices().catch(() => {});
      if (hasDesktopOutputBridge() && typeof window.BSPDesktop.onOutputClosed === 'function') {
        window.BSPDesktop.onOutputClosed(() => setOutputLiveState(false));
      }
      refreshCameraDevices().catch(() => {});
      if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
        navigator.mediaDevices.addEventListener('devicechange', () => {
          refreshCameraDevices().catch(() => {});
          refreshPgmOutputDevices().catch(() => {});
          refreshOutputScreenList().catch(() => {});
        });
      }
      window.addEventListener('message', (event) => {
        const data = event?.data || {};
        if (data.type === 'STANDALONE_READY') {
          queueStandaloneSyncBurst();
        }
      });
      window.addEventListener('beforeunload', () => {
        stopCameraPreview();
        if (outputLiveWatcher) {
          clearInterval(outputLiveWatcher);
          outputLiveWatcher = null;
        }
        if (standaloneDisplayWindow && !standaloneDisplayWindow.closed) {
          try { standaloneDisplayWindow.close(); } catch (e) {}
        }
        if (standaloneDisplayBlobUrl) {
          URL.revokeObjectURL(standaloneDisplayBlobUrl);
          standaloneDisplayBlobUrl = null;
        }
      }, { once: true });
    }
