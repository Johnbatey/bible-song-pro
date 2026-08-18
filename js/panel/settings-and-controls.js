    function getSliderConfigs() {
      return [
        { id: 'line-height-full', suffix: '' },
        { id: 'line-height-lt', suffix: '' },
        { id: 'pad-lr-full', suffix: '%' },
        { id: 'pad-lr-lt', suffix: '%' },
        { id: 'lt-width-pct', suffix: '%' },
        { id: 'lt-scale-pct', suffix: '%' },
        { id: 'text-x', suffix: 'px' },
        { id: 'text-y', suffix: 'px' },
        { id: 'lt-border-radius', suffix: 'px' },
        { id: 'pad-b', suffix: '%' },
        { id: 'bg-blur', suffix: 'px' },
        { id: 'bg-opacity-full', suffix: '%' },
        { id: 'bg-opacity-lt', suffix: '%' },
        { id: 'bg-y', suffix: '' },
        { id: 'bg-video-speed', suffix: 'x' },
        { id: 'se-ref-radius', suffix: 'px' },
        { id: 'se-ref-border-width', suffix: 'px' },
        { id: 'se-ref-opacity', suffix: '%' },
        { id: 'se-bar-opacity', suffix: '%' },
        { id: 'se-main-line-spacing', suffix: '' },
        { id: 'se-main-word-spacing', suffix: 'px' },
        { id: 'se-main-letter-spacing', suffix: 'px' },
        { id: 'se-ref-line-spacing', suffix: '' },
        { id: 'se-ref-word-spacing', suffix: 'px' },
        { id: 'se-ref-letter-spacing', suffix: 'px' },
        { id: 'se-shadow-opacity', suffix: '%' },
        { id: 'se-shadow-blur', suffix: 'px' },
        { id: 'se-shadow-offset', suffix: 'px' },
        { id: 'song-transition-duration', suffix: 's' }
      ];
    }

    function refreshSliderPaint(ids = null) {
      const allowed = Array.isArray(ids) ? new Set(ids.map(id => String(id))) : null;
      getSliderConfigs().forEach((slider) => {
        if (allowed && !allowed.has(slider.id)) return;
        const element = document.getElementById(slider.id);
        if (!element) return;
        updateSliderValue(element, slider.suffix);
        updateSliderFill(element);
      });
    }

    function initializeAllSliders() {
      const sliders = getSliderConfigs();

      sliders.forEach(slider => {
        const element = document.getElementById(slider.id);
        if (element) {
          updateSliderValue(element, slider.suffix);
          if (!element.dataset.sliderBound) {
            element.dataset.sliderBound = '1';
            element.addEventListener('input', function() {
              updateSliderValue(this, slider.suffix);
              updateSliderFill(this);
              if (this.id === 'bg-opacity-full') {
                const val = parseInt(this.value, 10);
                if (!Number.isNaN(val)) {
                  bgOpacityFull = Math.max(0, Math.min(100, val));
                }
              } else if (this.id === 'bg-opacity-lt') {
                const val = parseInt(this.value, 10);
                if (!Number.isNaN(val)) {
                  bgOpacityLT = Math.max(0, Math.min(100, val));
                }
              }
            });
          }
          updateSliderFill(element);
        }
      });
      initializePositionOffsetControls();
      if (typeof renderLtPresetOptions === 'function') renderLtPresetOptions(document.getElementById('lt-preset-select')?.value || 'default');
      if (typeof setupLtPresetContextMenu === 'function') setupLtPresetContextMenu();
    }

    function updateSliderValue(slider, suffix = '') {
      const valueDisplay = document.getElementById(slider.id + '-value');
      if (valueDisplay) {
        valueDisplay.textContent = slider.value + suffix;
      }
    }

    function updateSliderFill(slider) {
      const value = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.setProperty('--slider-fill', `${value}%`);
    }

    function clampPositionOffsetValue(input) {
      if (!input) return 0;
      const min = Number(input.min);
      const max = Number(input.max);
      const fallback = Number(input.value) || 0;
      const next = Number.isFinite(fallback) ? fallback : 0;
      return Math.max(Number.isFinite(min) ? min : -1200, Math.min(Number.isFinite(max) ? max : 1200, next));
    }

    function syncPositionOffsetInput(input, opts = {}) {
      if (!input) return;
      const clamped = clampPositionOffsetValue(input);
      input.value = String(clamped);
      if (opts.triggerChange !== false) onAnyControlChange();
    }

    function initializePositionOffsetControls() {
      ['lt-offset-x', 'lt-offset-y'].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        if (!input.dataset.offsetBound) {
          input.dataset.offsetBound = '1';
          input.addEventListener('input', function() {
            syncPositionOffsetInput(this);
          });
          input.addEventListener('change', function() {
            syncPositionOffsetInput(this);
          });
        }
        syncPositionOffsetInput(input, { triggerChange: false });
      });
    }

    function stepPositionOffset(id, delta) {
      const input = document.getElementById(id);
      if (!input) return;
      const current = clampPositionOffsetValue(input);
      input.value = String(current + (Number(delta) || 0));
      syncPositionOffsetInput(input);
    }

    const LT_MODE_PRESETS = {
      'default': {
        id: 'default',
        name: 'Default',
        bible: {
          refFontSize: 30,
          contentFontSize: 33,
          refTextTransform: 'uppercase',
          autoResize: 'shrink',
          primaryXAlign: 'center',
          yAlign: 'middle',
          bibleVerseXAlign: 'center',
          lineSpacing: 1.1,
          sidePaddingPct: 5,
          widthPct: 100,
          scalePct: 100,
          borderRadius: 0,
          offsetX: 0,
          offsetY: 0,
          anchor: 'bottom',
          autoAdjustHeight: true
        },
        songs: {
          contentFontSize: 30,
          textTransform: 'uppercase',
          autoResize: 'shrink',
          primaryXAlign: 'center',
          yAlign: 'middle',
          lineSpacing: 1.1,
          sidePaddingPct: 5,
          widthPct: 60,
          scalePct: 100,
          borderRadius: 0,
          offsetX: 0,
          offsetY: 50,
          anchor: 'bottom',
          autoAdjustHeight: true
        }
      },
      'rounded-card': {
        id: 'rounded-card',
        name: 'Rounded Card',
        bible: {
          refFontSize: 30,
          contentFontSize: 33,
          refTextTransform: 'uppercase',
          autoResize: 'shrink',
          primaryXAlign: 'center',
          yAlign: 'middle',
          bibleVerseXAlign: 'center',
          lineSpacing: 1.1,
          sidePaddingPct: 5,
          widthPct: 100,
          scalePct: 80,
          borderRadius: 23,
          offsetX: 0,
          offsetY: 25,
          anchor: 'bottom',
          autoAdjustHeight: true
        },
        songs: {
          contentFontSize: 30,
          textTransform: 'uppercase',
          autoResize: 'shrink',
          primaryXAlign: 'center',
          yAlign: 'middle',
          lineSpacing: 1.1,
          sidePaddingPct: 5,
          widthPct: 80,
          scalePct: 100,
          borderRadius: 23,
          offsetX: 0,
          offsetY: 25,
          anchor: 'bottom',
          autoAdjustHeight: true
        }
      },
      'square-card': {
        id: 'square-card',
        name: 'Square Card',
        bible: {
          refFontSize: 30,
          contentFontSize: 33,
          refTextTransform: 'uppercase',
          autoResize: 'shrink',
          primaryXAlign: 'center',
          yAlign: 'middle',
          bibleVerseXAlign: 'center',
          lineSpacing: 1.1,
          sidePaddingPct: 5,
          widthPct: 80,
          scalePct: 100,
          borderRadius: 0,
          offsetX: 0,
          offsetY: 25,
          anchor: 'bottom',
          autoAdjustHeight: true
        }
      },
      'top-anchor': {
        id: 'top-anchor',
        name: 'Top Anchor',
        bible: {
          refFontSize: 30,
          contentFontSize: 33,
          refTextTransform: 'uppercase',
          autoResize: 'shrink',
          primaryXAlign: 'center',
          yAlign: 'middle',
          bibleVerseXAlign: 'center',
          lineSpacing: 1.1,
          sidePaddingPct: 5,
          widthPct: 100,
          scalePct: 100,
          borderRadius: 0,
          offsetX: 0,
          offsetY: 0,
          anchor: 'top',
          autoAdjustHeight: true
        },
        songs: {
          contentFontSize: 30,
          textTransform: 'uppercase',
          autoResize: 'shrink',
          primaryXAlign: 'center',
          yAlign: 'middle',
          lineSpacing: 1.1,
          sidePaddingPct: 5,
          widthPct: 100,
          scalePct: 100,
          borderRadius: 0,
          offsetX: 0,
          offsetY: 0,
          anchor: 'top',
          autoAdjustHeight: true
        }
      }
    };

    function normalizeLtPresetTarget(target = getEffectiveSettingsTargetTab()) {
      return target === 'songs' ? 'songs' : 'bible';
    }

    function getBuiltinLtPresetList(target = getEffectiveSettingsTargetTab()) {
      const presetTarget = normalizeLtPresetTarget(target);
      return Object.values(LT_MODE_PRESETS)
        .map((preset) => {
          const values = preset[presetTarget];
          if (!values) return null;
          return { id: preset.id, name: preset.name, builtin: true, target: presetTarget, values: normalizeLtPresetValues(values, presetTarget) };
        })
        .filter(Boolean);
    }

    function isBuiltinLtPresetId(id) {
      return !!LT_MODE_PRESETS[String(id || '')];
    }

    function normalizeLtPresetName(name) {
      return String(name || '').trim();
    }

    function cloneLtPresetValues(values) {
      return values ? { ...values } : null;
    }

    function normalizeLtPresetValues(values, target = getEffectiveSettingsTargetTab()) {
      const presetTarget = normalizeLtPresetTarget(target);
      const source = (values && typeof values === 'object') ? values : {};
      const shared = {
        autoResize: source.autoResize || 'shrink',
        primaryXAlign: source.primaryXAlign || 'center',
        yAlign: source.yAlign || 'middle',
        lineSpacing: Number(source.lineSpacing ?? 1.1),
        sidePaddingPct: Number(source.sidePaddingPct ?? source.padLR ?? 5),
        widthPct: Number(source.widthPct ?? 100),
        scalePct: Number(source.scalePct ?? 100),
        borderRadius: Number(source.borderRadius ?? 0),
        offsetX: Number(source.offsetX ?? 0),
        offsetY: Number(source.offsetY ?? 0),
        anchor: source.anchor === 'top' ? 'top' : 'bottom',
        autoAdjustHeight: source.autoAdjustHeight !== false
      };
      if (presetTarget === 'songs') {
        return {
          ...shared,
          contentFontSize: Number(source.contentFontSize ?? 36),
          textTransform: source.textTransform || 'uppercase'
        };
      }
      return {
        ...shared,
        refFontSize: Number(source.refFontSize ?? 30),
        contentFontSize: Number(source.contentFontSize ?? 33),
        refTextTransform: source.refTextTransform || 'uppercase',
        bibleVerseXAlign: source.bibleVerseXAlign || 'center'
      };
    }

    function getCurrentLtPresetValues(target = getEffectiveSettingsTargetTab()) {
      const presetTarget = normalizeLtPresetTarget(target);
      const base = {
        autoResize: document.getElementById('auto-resize-lt')?.value || 'shrink',
        primaryXAlign: presetTarget === 'songs' ? (ltHAlignSongs || 'center') : (ltHAlignBible || 'center'),
        yAlign: presetTarget === 'songs' ? (ltVAlignSongs || 'middle') : (ltVAlignBible || 'middle'),
        lineSpacing: Number(document.getElementById('line-height-lt')?.value || 1.1),
        sidePaddingPct: Number(document.getElementById('pad-lr-lt')?.value || 5),
        widthPct: Number(document.getElementById('lt-width-pct')?.value || 100),
        scalePct: Number(document.getElementById('lt-scale-pct')?.value || 100),
        borderRadius: Number(document.getElementById('lt-border-radius')?.value || 0),
        offsetX: Number(document.getElementById('lt-offset-x')?.value || 0),
        offsetY: Number(document.getElementById('lt-offset-y')?.value || 0),
        anchor: ltAnchorMode === 'top' ? 'top' : 'bottom',
        autoAdjustHeight: !!document.getElementById('auto-adjust-lt-height')?.checked
      };
      if (presetTarget === 'songs') {
        return {
          ...base,
          contentFontSize: Number(document.getElementById('font-size-lt-val')?.value || ltFontSongs || 30),
          textTransform: document.getElementById('lt-text-transform')?.value || ltTextTransform || 'uppercase'
        };
      }
      return {
        ...base,
        refFontSize: Number(document.getElementById('ref-font-size-lt-val')?.value || ltRefFontSize || 30),
        contentFontSize: Number(document.getElementById('font-size-lt-val')?.value || ltFontBible || 33),
        refTextTransform: document.getElementById('lt-ref-text-transform')?.value || ltRefTextTransform || 'uppercase',
        bibleVerseXAlign: ltHAlignBibleVerse || 'center'
      };
    }

    function ltPresetValuesEqual(a, b, target = getEffectiveSettingsTargetTab()) {
      if (!a || !b) return false;
      const presetTarget = normalizeLtPresetTarget(target);
      const sharedMatch =
        String(a.autoResize || 'shrink') === String(b.autoResize || 'shrink') &&
        String(a.primaryXAlign || 'center') === String(b.primaryXAlign || 'center') &&
        String(a.yAlign || 'middle') === String(b.yAlign || 'middle') &&
        Number(a.lineSpacing) === Number(b.lineSpacing) &&
        Number(a.sidePaddingPct ?? 5) === Number(b.sidePaddingPct ?? 5) &&
        Number(a.widthPct) === Number(b.widthPct) &&
        Number(a.scalePct ?? 100) === Number(b.scalePct ?? 100) &&
        Number(a.borderRadius) === Number(b.borderRadius) &&
        Number(a.offsetX) === Number(b.offsetX) &&
        Number(a.offsetY) === Number(b.offsetY) &&
        String(a.anchor || 'bottom') === String(b.anchor || 'bottom') &&
        !!a.autoAdjustHeight === !!b.autoAdjustHeight &&
        Number(a.contentFontSize) === Number(b.contentFontSize);
      if (!sharedMatch) return false;
      if (presetTarget === 'songs') {
        return String(a.textTransform || 'uppercase') === String(b.textTransform || 'uppercase');
      }
      return Number(a.refFontSize) === Number(b.refFontSize) &&
        String(a.refTextTransform || 'uppercase') === String(b.refTextTransform || 'uppercase') &&
        String(a.bibleVerseXAlign || 'center') === String(b.bibleVerseXAlign || 'center');
    }

    function getAllLtPresets(target = getEffectiveSettingsTargetTab()) {
      const presetTarget = normalizeLtPresetTarget(target);
      const custom = Array.isArray(ltModeUserPresets)
        ? ltModeUserPresets
            .filter((preset) => normalizeLtPresetTarget(preset?.target) === presetTarget)
            .map((preset) => ({ ...preset, builtin: false, values: normalizeLtPresetValues(preset.values, presetTarget) }))
        : [];
      return [...getBuiltinLtPresetList(presetTarget), ...custom];
    }

    function getLtPresetById(id, target = getEffectiveSettingsTargetTab()) {
      const key = String(id || '');
      const presetTarget = normalizeLtPresetTarget(target);
      if (isBuiltinLtPresetId(key)) {
        const preset = LT_MODE_PRESETS[key];
        const values = preset?.[presetTarget];
        return values ? { id: preset.id, name: preset.name, builtin: true, target: presetTarget, values: normalizeLtPresetValues(values, presetTarget) } : null;
      }
      const preset = (Array.isArray(ltModeUserPresets) ? ltModeUserPresets : []).find((item) => String(item.id) === key && normalizeLtPresetTarget(item.target) === presetTarget);
      return preset ? { ...preset, values: normalizeLtPresetValues(preset.values, presetTarget) } : null;
    }

    function findSimilarLtPreset(values, excludeId = '', target = getEffectiveSettingsTargetTab()) {
      const excluded = String(excludeId || '');
      return getAllLtPresets(target).find((preset) => String(preset.id) !== excluded && ltPresetValuesEqual(values, preset.values, target)) || null;
    }

    function renderLtPresetOptions(selectedId = null, target = getEffectiveSettingsTargetTab()) {
      const select = document.getElementById('lt-preset-select');
      if (!select) return;
      const current = selectedId != null ? String(selectedId) : String(select.value || 'default');
      const all = getAllLtPresets(target);
      select.innerHTML = all.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join('');
      const hasCurrent = all.some((preset) => String(preset.id) === current);
      select.value = hasCurrent ? current : 'default';
    }

    function setLtPresetSelection(id, target = getEffectiveSettingsTargetTab()) {
      const select = document.getElementById('lt-preset-select');
      if (!select) return;
      renderLtPresetOptions(id, target);
      select.value = String(id || 'default');
    }

    function syncLtPresetSelectionToCurrentValues(target = getEffectiveSettingsTargetTab()) {
      const select = document.getElementById('lt-preset-select');
      if (!select) return;
      const presetTarget = normalizeLtPresetTarget(target);
      const currentValues = getCurrentLtPresetValues(presetTarget);
      const matchingPreset = getAllLtPresets(presetTarget).find((preset) => ltPresetValuesEqual(currentValues, preset.values, presetTarget));
      renderLtPresetOptions(matchingPreset?.id || String(select.value || 'default'), presetTarget);
      if (matchingPreset) {
        select.value = matchingPreset.id;
      }
    }

    function setSliderControlValue(id, value, suffix = '') {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = String(value);
      updateSliderValue(el, suffix);
      updateSliderFill(el);
    }

    function updateLtPresetUpdateLiveState(checked = true) {
      const isOn = checked !== false;
      const input = document.getElementById('lt-preset-update-live');
      const onBtn = document.getElementById('lt-preset-update-live-on');
      const offBtn = document.getElementById('lt-preset-update-live-off');
      if (input) input.value = isOn ? 'true' : 'false';
      if (onBtn) onBtn.classList.toggle('active', isOn);
      if (offBtn) offBtn.classList.toggle('active', !isOn);
    }

    function isLtPresetUpdateLiveEnabled(target = getEffectiveSettingsTargetTab()) {
      if (target !== getEffectiveSettingsTargetTab()) {
        return getProjectionSettingsSnapshotForTab(target)?.ltPresetUpdatesLive !== false;
      }
      return document.getElementById('lt-preset-update-live')?.value !== 'false';
    }

    function handleLtPresetUpdateLiveToggle(checked) {
      updateLtPresetUpdateLiveState(checked);
      onAnyControlChange({ refreshLive: false });
    }

    function applyLtPreset(presetKey) {
      const target = getEffectiveSettingsTargetTab();
      const presetRecord = getLtPresetById(presetKey, target);
      if (!presetRecord) return;
      const preset = presetRecord.values || presetRecord;
      const presetTarget = normalizeLtPresetTarget(target);

      if (presetTarget === 'songs') {
        ltFontSongs = Number(preset.contentFontSize || ltFontSongs || 30);
        updateLtTextTransformValue(preset.textTransform || 'uppercase', { markUser: true });
        ltHAlignSongs = preset.primaryXAlign || 'center';
        ltVAlignSongs = preset.yAlign || 'middle';
      } else {
        ltFontBible = Number(preset.contentFontSize || ltFontBible || 33);
        ltRefFontSize = Number(preset.refFontSize || ltRefFontSize || 30);
        updateReferenceTextTransformValue('lt', preset.refTextTransform || 'uppercase');
        ltHAlignBible = preset.primaryXAlign || 'center';
        ltVAlignBible = preset.yAlign || 'middle';
        ltHAlignBibleVerse = preset.bibleVerseXAlign || 'center';
        const refFontEl = document.getElementById('ref-font-size-lt-val');
        if (refFontEl) refFontEl.value = String(ltRefFontSize);
      }

      const ltFontEl = document.getElementById('font-size-lt-val');
      if (ltFontEl) ltFontEl.value = String(presetTarget === 'songs' ? ltFontSongs : ltFontBible);
      const autoResizeEl = document.getElementById('auto-resize-lt');
      if (autoResizeEl) autoResizeEl.value = preset.autoResize || 'shrink';
      const autoAdjustEl = document.getElementById('auto-adjust-lt-height');
      if (autoAdjustEl) autoAdjustEl.checked = !!preset.autoAdjustHeight;
      autoAdjustLtHeight = !!preset.autoAdjustHeight;
      ltAnchorMode = preset.anchor === 'top' ? 'top' : 'bottom';

      setSliderControlValue('line-height-lt', Number(preset.lineSpacing ?? 1.1));
      setSliderControlValue('pad-lr-lt', Number(preset.sidePaddingPct ?? preset.padLR ?? 5), '%');
      setSliderControlValue('lt-width-pct', Number(preset.widthPct ?? 100), '%');
      setSliderControlValue('lt-scale-pct', Number(preset.scalePct ?? 100), '%');
      setSliderControlValue('lt-border-radius', Number(preset.borderRadius ?? 0), 'px');

      const offsetXEl = document.getElementById('lt-offset-x');
      if (offsetXEl) {
        offsetXEl.value = String(Number(preset.offsetX ?? 0));
        syncPositionOffsetInput(offsetXEl, { triggerChange: false });
      }
      const offsetYEl = document.getElementById('lt-offset-y');
      if (offsetYEl) {
        offsetYEl.value = String(Number(preset.offsetY ?? 0));
        syncPositionOffsetInput(offsetYEl, { triggerChange: false });
      }

      updateLtAlignButtons();
      updateLtBibleVerseAlignButtons();
      updateLtAnchorButtons();
      setLtFontInputValue(getEffectiveLtFont());
      setLtPresetSelection(presetRecord.id || presetKey, target);
      const shouldUpdateLive = isLtPresetUpdateLiveEnabled(target);
      onAnyControlChange({ refreshLive: shouldUpdateLive });
    }

    function upsertLtUserPreset(record, { replaceId = '' } = {}) {
      const normalizedName = normalizeLtPresetName(record?.name);
      const target = normalizeLtPresetTarget(record?.target);
      if (!normalizedName || !record?.values) return null;
      const replaceKey = String(replaceId || record.id || '');
      const next = {
        id: replaceKey || `lt_preset_${Date.now()}`,
        name: normalizedName,
        target,
        values: normalizeLtPresetValues(record.values, target)
      };
      const existingIdx = (Array.isArray(ltModeUserPresets) ? ltModeUserPresets : []).findIndex((preset) => String(preset.id) === String(next.id));
      if (existingIdx >= 0) {
        ltModeUserPresets.splice(existingIdx, 1, next);
      } else {
        ltModeUserPresets.push(next);
      }
      renderLtPresetOptions(next.id, target);
      saveToStorageDebounced();
      return next;
    }

    function promptSaveLtPreset() {
      const target = normalizeLtPresetTarget(getEffectiveSettingsTargetTab());
      const values = getCurrentLtPresetValues(target);
      showConfirm('Save LT Preset', 'Enter a name for this LT preset:', (name) => {
        const finalName = normalizeLtPresetName(name);
        if (!finalName) {
          showToast('Preset name is required');
          return;
        }
        if (getBuiltinLtPresetList(target).some((preset) => preset.name.toLowerCase() === finalName.toLowerCase())) {
          showToast(`"${finalName}" is a built-in preset name`);
          return;
        }
        const existingByName = (Array.isArray(ltModeUserPresets) ? ltModeUserPresets : []).find((preset) =>
          normalizeLtPresetTarget(preset?.target) === target &&
          String(preset.name || '').toLowerCase() === finalName.toLowerCase()
        );
        const similarPreset = findSimilarLtPreset(values, existingByName ? existingByName.id : '', target);

        const persistPreset = () => {
          if (existingByName) {
            upsertLtUserPreset({ id: existingByName.id, name: finalName, target, values }, { replaceId: existingByName.id });
            showToast(`LT preset "${finalName}" updated`);
          } else {
            const saved = upsertLtUserPreset({ name: finalName, target, values });
            if (saved) {
              setLtPresetSelection(saved.id, target);
              showToast(`LT preset "${finalName}" saved`);
            }
          }
        };

        if (similarPreset) {
          showConfirm(
            'Similar LT Preset',
            `This preset matches "${similarPreset.name}". Save anyway?`,
            () => {
              if (existingByName) {
                showConfirm('Replace LT Preset', `Replace the existing preset "${finalName}"?`, persistPreset);
              } else {
                persistPreset();
              }
            }
          );
          return;
        }

        if (existingByName) {
          showConfirm('Replace LT Preset', `Replace the existing preset "${finalName}"?`, persistPreset);
          return;
        }

        persistPreset();
      }, true);
    }

    function closeLtPresetContextMenu() {
      const menu = document.getElementById('lt-preset-context-menu');
      if (!menu) return;
      menu.classList.remove('open');
      menu.setAttribute('aria-hidden', 'true');
    }

    function renameLtPreset(presetId) {
      const target = normalizeLtPresetTarget(getEffectiveSettingsTargetTab());
      const preset = getLtPresetById(presetId, target);
      if (!preset || isBuiltinLtPresetId(preset.id)) return;
      showConfirm('Rename LT Preset', 'Enter a new preset name:', (name) => {
        const finalName = normalizeLtPresetName(name);
        if (!finalName) {
          showToast('Preset name is required');
          return;
        }
        if (getBuiltinLtPresetList(target).some((builtin) => builtin.name.toLowerCase() === finalName.toLowerCase())) {
          showToast(`"${finalName}" is a built-in preset name`);
          return;
        }
        const nameConflict = ltModeUserPresets.find((item) =>
          String(item.id) !== String(preset.id) &&
          normalizeLtPresetTarget(item?.target) === target &&
          String(item.name || '').toLowerCase() === finalName.toLowerCase()
        );
        if (nameConflict) {
          showToast(`A preset named "${finalName}" already exists`);
          return;
        }
        upsertLtUserPreset({ id: preset.id, name: finalName, target, values: preset.values }, { replaceId: preset.id });
        setLtPresetSelection(preset.id, target);
        showToast('LT preset renamed');
      }, true, preset.name || '');
    }

    function deleteLtPreset(presetId) {
      const target = normalizeLtPresetTarget(getEffectiveSettingsTargetTab());
      const preset = getLtPresetById(presetId, target);
      if (!preset || isBuiltinLtPresetId(preset.id)) return;
      showConfirm('Delete LT Preset', `Delete preset "${preset.name}"?`, () => {
        ltModeUserPresets = ltModeUserPresets.filter((item) => String(item.id) !== String(preset.id));
        renderLtPresetOptions('default', target);
        saveToStorageDebounced();
        showToast('LT preset deleted');
      });
    }

    function showLtPresetContextMenu(event) {
      const target = normalizeLtPresetTarget(getEffectiveSettingsTargetTab());
      const select = document.getElementById('lt-preset-select');
      const menu = document.getElementById('lt-preset-context-menu');
      if (!select || !menu) return;
      const presetId = String(select.value || '');
      if (!presetId || isBuiltinLtPresetId(presetId)) {
        closeLtPresetContextMenu();
        return;
      }
      event.preventDefault();
      const preset = getLtPresetById(presetId, target);
      if (!preset) return;
      menu.innerHTML = `
        <div class="sl-ctx-group-title">LT Preset</div>
        <button class="sl-ctx-item" type="button" onclick="closeLtPresetContextMenu(); renameLtPreset('${preset.id}')">Rename</button>
        <button class="sl-ctx-item danger" type="button" onclick="closeLtPresetContextMenu(); deleteLtPreset('${preset.id}')">Delete</button>
      `;
      menu.style.left = `${Math.min(window.innerWidth - 260, Math.max(8, event.clientX || 8))}px`;
      menu.style.top = `${Math.min(window.innerHeight - 120, Math.max(8, event.clientY || 8))}px`;
      menu.classList.add('open');
      menu.setAttribute('aria-hidden', 'false');
    }

    function setupLtPresetContextMenu() {
      if (document.body.dataset.ltPresetCtxBound === '1') return;
      document.body.dataset.ltPresetCtxBound = '1';
      document.addEventListener('click', (event) => {
        const menu = document.getElementById('lt-preset-context-menu');
        if (!menu || !menu.classList.contains('open')) return;
        if (menu.contains(event.target)) return;
        closeLtPresetContextMenu();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeLtPresetContextMenu();
      });
    }

    function stepNumericInput(id, direction) {
      const input = document.getElementById(id);
      if (!input) return;
      const step = Number(input.step);
      const min = Number(input.min);
      const max = Number(input.max);
      const current = Number(input.value);
      const base = Number.isFinite(current) ? current : (Number.isFinite(min) ? min : 0);
      let next = base + ((Number(direction) || 0) * (Number.isFinite(step) && step > 0 ? step : 1));
      if (Number.isFinite(min)) next = Math.max(min, next);
      if (Number.isFinite(max)) next = Math.min(max, next);
      if (Number.isFinite(step) && step > 0 && step < 1) {
        const decimals = ((String(step).split('.')[1] || '').length);
        input.value = next.toFixed(decimals).replace(/0+$/,'').replace(/\.$/, '');
      } else {
        input.value = String(Math.round(next));
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    let _stepperHoldTimeout = null;
    let _stepperHoldInterval = null;
    let _activeStepperButton = null;
    let _stepperHoldStartedRepeating = false;

    function clearStepperHoldTimers() {
      if (_stepperHoldTimeout) {
        clearTimeout(_stepperHoldTimeout);
        _stepperHoldTimeout = null;
      }
      if (_stepperHoldInterval) {
        clearInterval(_stepperHoldInterval);
        _stepperHoldInterval = null;
      }
      _activeStepperButton = null;
      _stepperHoldStartedRepeating = false;
    }

    function runStepperButtonAction(button) {
      if (!(button instanceof Element)) return;
      const onclick = button.getAttribute('onclick') || '';
      let match = onclick.match(/stepNumericInput\('([^']+)'\s*,\s*([-+]?\d+(?:\.\d+)?)\)/);
      if (match) {
        stepNumericInput(match[1], Number(match[2]));
        return;
      }
      match = onclick.match(/stepPositionOffset\('([^']+)'\s*,\s*([-+]?\d+(?:\.\d+)?)\)/);
      if (match) {
        stepPositionOffset(match[1], Number(match[2]));
      }
    }

    function beginStepperHold(button) {
      clearStepperHoldTimers();
      _activeStepperButton = button;
      _stepperHoldStartedRepeating = false;
      _stepperHoldTimeout = setTimeout(() => {
        _stepperHoldStartedRepeating = true;
        runStepperButtonAction(button);
        _stepperHoldInterval = setInterval(() => {
          runStepperButtonAction(button);
        }, 55);
      }, 260);
    }

    function bindStepperPressAndHold() {
      document.querySelectorAll('.numeric-stepper-buttons button, .position-offset-stepper button').forEach((button) => {
        if (button.dataset.holdBound === '1') return;
        button.dataset.holdBound = '1';
        button.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          button.dataset.suppressStepperClick = '0';
          beginStepperHold(button);
        });
        button.addEventListener('pointerup', () => {
          if (_activeStepperButton === button && _stepperHoldStartedRepeating) {
            button.dataset.suppressStepperClick = '1';
          }
          clearStepperHoldTimers();
        });
        button.addEventListener('pointercancel', clearStepperHoldTimers);
        button.addEventListener('pointerleave', clearStepperHoldTimers);
        button.addEventListener('blur', clearStepperHoldTimers);
        button.addEventListener('click', (event) => {
          if (button.dataset.suppressStepperClick === '1') {
            button.dataset.suppressStepperClick = '0';
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }, true);
      });
    }

    function saveToStorageDebounced() {
      schedulePersistAppState();
    }

    function setupExplicitTooltips() {
      const map = [
        ['full-h-left', 'tooltip_align_left'],
        ['full-h-center', 'tooltip_align_center'],
        ['full-h-right', 'tooltip_align_right'],
        ['full-h-justify', 'tooltip_align_justify'],
        ['full-v-top', 'tooltip_align_top'],
        ['full-v-middle', 'tooltip_align_middle'],
        ['full-v-bottom', 'tooltip_align_bottom'],
        ['se-ref-h-left', 'tooltip_align_left'],
        ['se-ref-h-center', 'tooltip_align_center'],
        ['se-ref-h-right', 'tooltip_align_right'],
        ['se-ref-h-justify', 'tooltip_align_justify'],
        ['se-ref-v-top', 'tooltip_align_top'],
        ['se-ref-v-middle', 'tooltip_align_middle'],
        ['se-ref-v-bottom', 'tooltip_align_bottom'],
        ['se-bar-h-left', 'tooltip_align_left'],
        ['se-bar-h-center', 'tooltip_align_center'],
        ['se-bar-h-right', 'tooltip_align_right'],
        ['se-bar-h-justify', 'tooltip_align_justify'],
        ['se-bar-v-top', 'tooltip_align_top'],
        ['se-bar-v-middle', 'tooltip_align_middle'],
        ['se-bar-v-bottom', 'tooltip_align_bottom']
      ];
      map.forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.title = t(key);
      });
      const addBtn = document.querySelector('.add-btn');
      if (addBtn) addBtn.title = (sidebarTab === 'media') ? 'Add Media' : 'Create New Song';
      updateSidebarToggleTooltip();
    }


    // ===== ACTIONS / HANDLERS =====
    function shouldRefreshLiveOutputForCurrentWorkspace() {
      if (!isLive || !livePointer || !livePointer.kind) return false;
      const panelKind = (typeof getCurrentPanelContentKind === 'function') ? getCurrentPanelContentKind() : null;
      return !!panelKind && livePointer.kind === panelKind;
    }

    function onAnyControlChange(opts = {}) {
      autoAdjustLtHeight = document.getElementById('auto-adjust-lt-height').checked;
      const versionToggle = document.getElementById('version-switch-updates-live');
      if (versionToggle) versionSwitchUpdatesLive = versionToggle.checked;
      if (isFocusedWorkspaceMode()) saveFocusedWorkspaceControlsForTab(sidebarTab);
      if (typeof saveProjectionSettingsProfileForTab === 'function') {
        saveProjectionSettingsProfileForTab(getEffectiveSettingsTargetTab());
      }
      setSongTranslationProviderStatus('Not tested', 'muted');
      updateBgModePicker();
      saveToStorageDebounced();
      schedulePersistBackground();
      schedulePersistAnimation();
      schedulePersistTypography();
      schedulePersistModeSettings();
      if (opts.refreshLive !== false && shouldRefreshLiveOutputForCurrentWorkspace()) {
        scheduleLiveUpdate();
      }
      updateButtonView();
      // Update gradient angle live if GB is enabled
      const bgType = document.getElementById('bg-type')?.value;
      if (bgType === 'gradient') {
        updateBackgroundGradientAngle();
      }
      scheduleSidebarQuickActionsRender();
    }

    // Update the background gradient angle live
    function updateBackgroundGradientAngle() {
      const angle = document.getElementById('bg-gradient-angle')?.value || 135;
      const bg = document.getElementById('main-bg');
      const shadowPreview = document.getElementById('bg-shadow-preview');
      // Use the current highlight and shadow colors
      const color1 = document.getElementById('bg-color-shadow')?.value || '#AD0000';
      const color2 = document.getElementById('bg-color-highlight')?.value || '#000000';
      if (bg) {
        bg.style.background = `linear-gradient(${angle}deg, ${color1}, ${color2})`;
      }
      if (shadowPreview) {
        shadowPreview.style.background = `linear-gradient(${angle}deg, ${color1}, ${color2})`;
      }
    }
