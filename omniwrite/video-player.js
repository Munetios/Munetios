(() => {
    'use strict';
    const players = new WeakMap();
    const live = new Set();
    const t = key => typeof _t === 'function' ? _t(key) : key;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const frameStyle = document.createElement('style');
    frameStyle.textContent = `
        .omni-video-frame.omni-shadow-video,.omni-audio-frame{display:block;position:relative;max-width:100%;padding:0;margin:12px 0;overflow:visible!important;background:transparent!important;border:0!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;container-type:normal;line-height:0}
        .omni-shadow-mini{position:fixed;right:16px;bottom:16px;width:min(420px,calc(100vw - 24px));z-index:10050;background:#080611;border:1px solid rgba(167,92,255,.30);border-radius:20px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.35);font-family:'Google Sans Flex',sans-serif;font-feature-settings:'ss01' 1}
        .omni-shadow-mini header{display:flex;align-items:center;gap:10px;padding:6px 12px;color:#fff;cursor:move;touch-action:none}
        .omni-shadow-mini header span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
        .omni-shadow-mini header button{width:36px;height:36px;padding:0;border:0;border-radius:50%;background:rgba(115,61,185,.35);color:#fff;cursor:pointer}
        .omni-shadow-mini .omni-video-frame{width:100%!important;margin:0;border-radius:0}
        .omni-video-upload-fields{display:grid;gap:12px;margin-top:16px}.omni-video-upload-fields .media-option-card{width:100%;min-width:0}.omni-video-upload-fields .media-option-card span{overflow-wrap:anywhere}.omni-video-upload-fields>button{min-height:44px}
    `;
    document.head.appendChild(frameStyle);
    const { css, sheet } = window.MunetiosMediaPlayerStyles;
    if (!customElements.get('omni-video-player')) customElements.define('omni-video-player', class extends HTMLElement {});
    if (!customElements.get('omni-audio-player')) customElements.define('omni-audio-player', class extends HTMLElement {});

    function parseCaptions(source) {
        const lines = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
        const cues = [];
        function seconds(value) {
            const parts = value.trim().replace(',', '.').split(':').map(Number);
            if (parts.length < 2 || parts.length > 3 || parts.some(number => !Number.isFinite(number) || number < 0)) return NaN;
            return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
        }
        for (let index = 0; index < lines.length; index++) {
            if (/^(NOTE(?:\s|$)|STYLE\s*$|REGION\s*$)/.test(lines[index])) { while (index < lines.length && lines[index].trim()) index++; continue; }
            if (!lines[index].includes('-->')) continue;
            const [from, to] = lines[index].split('-->');
            const start = seconds(from), end = seconds(to.trim().split(/\s+/)[0]);
            const payload = [];
            while (++index < lines.length && lines[index].trim()) payload.push(lines[index]);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
            const holder = document.createElement('div');
            holder.innerHTML = payload.join('\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '');
            const text = holder.textContent.trim();
            if (text) cues.push({ start, end, text });
        }
        cues.sort((a, b) => a.start - b.start || a.end - b.end);
        if (!cues.length) throw new Error(t('video_caption_error'));
        return cues;
    }
    async function readCaptions(file) {
        return { version: 1, label: file.name, lang: document.documentElement.lang || 'en', cues: parseCaptions(await file.text()) };
    }
    function captionsFromText(value) {
        const text = String(value).trim();
        if (!text) return null;
        const timed = text.includes('-->') || /^WEBVTT\b/.test(text);
        return { version: 1, label: t('video_captions'), lang: document.documentElement.lang || 'en', wholeVideo: !timed, cues: timed ? parseCaptions(text) : [{ start: 0, end: null, text }] };
    }
    function captionsToText(data) {
        if (!data?.cues?.length) return '';
        if (data.wholeVideo) return data.cues.map(cue => cue.text).join('\n');
        const timestamp = seconds => {
            const milliseconds = Math.max(0, Math.round(seconds * 1000));
            return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
        };
        return data.cues.map((cue, index) => `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}`).join('\n\n');
    }
    function save(video) {
        const editor = video.closest('.editor-surface, .document-page-editor, .split-editor');
        if (editor && typeof saveEditorSurfaceContent === 'function') saveEditorSurfaceContent(editor);
    }
    function formatTime(value) {
        const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
        const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
        return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
    }
    let mini = null;
    function closeMini(resume = true) {
        if (!mini) return;
        const { element, video, original } = mini;
        if (document.fullscreenElement && element.contains(document.fullscreenElement)) document.exitFullscreen().catch(() => {});
        const wasPlaying = !video.paused;
        video.pause();
        try { original.currentTime = video.currentTime; } catch {}
        original.volume = video.volume;
        original.muted = video.muted;
        original.playbackRate = video.playbackRate;
        original.defaultPlaybackRate = video.playbackRate;
        original.loop = video.loop;
        for (const [key, value] of Object.entries(video.dataset)) if (key.startsWith('omni')) original.dataset[key] = value;
        delete original.dataset.omniMiniActive;
        const player = players.get(original);
        if (player) {
            player.changePitch = original.dataset.omniChangePitch === 'true';
            original.preservesPitch = !player.changePitch;
            player.pitch.setAttribute('aria-checked', String(player.changePitch));
        }
        player?.reloadCaptions();
        player?.sync();
        element.remove();
        mini = null;
        save(original);
        if (resume && wasPlaying && original.isConnected && original.getClientRects().length) original.play().catch(() => {});
    }
    function openMini(original) {
        if (original.closest('#omniShadowMiniPlayer')) { closeMini(); return; }
        closeMini(false);
        const wasPlaying = !original.paused;
        const at = original.currentTime;
        original.dataset.omniMiniActive = 'true';
        const element = document.createElement('section');
        element.id = 'omniShadowMiniPlayer';
        element.className = 'omni-shadow-mini';
        element.setAttribute('aria-label', t('mini_player'));
        const header = document.createElement('header');
        const title = document.createElement('span');
        title.textContent = original.title || t('mini_player');
        const close = document.createElement('button');
        close.type = 'button'; close.setAttribute('aria-label', t('close_mini_player')); close.textContent = '×';
        close.onclick = () => closeMini();
        header.append(title, close);
        const video = original.cloneNode(true);
        video.removeAttribute('id'); delete video.dataset.omniMiniActive;
        video.volume = original.volume; video.muted = original.muted; video.playbackRate = original.playbackRate;
        element.append(header, video);
        document.body.appendChild(element);
        mini = { element, video, original };
        original.pause();
        const restore = () => { try { video.currentTime = at; } catch {} if (wasPlaying) video.play().catch(() => {}); };
        video.addEventListener('loadedmetadata', restore, { once: true });
        if (video.readyState >= 1) restore();
        upgrade(element);
        let drag = null;
        header.addEventListener('pointerdown', event => {
            if (event.target.closest('button')) return;
            const rect = element.getBoundingClientRect(); drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            header.setPointerCapture(event.pointerId);
        });
        header.addEventListener('pointermove', event => {
            if (!drag) return;
            element.style.right = 'auto'; element.style.bottom = 'auto';
            element.style.left = clamp(event.clientX - drag.x, 0, innerWidth - element.offsetWidth) + 'px';
            element.style.top = clamp(event.clientY - drag.y, 0, innerHeight - element.offsetHeight) + 'px';
        });
        for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) header.addEventListener(event, () => { drag = null; });
    }

    class Player {
        constructor(video) {
            this.video = video;
            this.isAudio = video.localName === 'audio';
            this.abort = new AbortController();
            this.timer = 0;
            this.keyboardFocus = false;
            this.interacting = false;
            this.openPanel = null;
            this.cues = [];
            const tag = this.isAudio ? 'omni-audio-player' : 'omni-video-player';
            if (this.isAudio && video.nextElementSibling?.matches('.custom-audio-controls')) video.nextElementSibling.remove();
            const old = video.closest(this.isAudio ? '.omni-audio-frame' : '.omni-video-frame');
            let host = old?.localName === tag ? old : document.createElement(tag);
            if (host !== old) {
                host.className = old?.className || (this.isAudio ? 'omni-audio-frame' : 'omni-video-frame');
                host.style.cssText = old?.style.cssText || '';
                if (old) { old.before(host); host.appendChild(video); old.remove(); }
                else { video.before(host); host.appendChild(video); }
            }
            host.classList.remove('liquid-glass');
            if (this.isAudio) { host.classList.add('omni-audio-frame'); host.dataset.mediaType = 'audio'; }
            else host.classList.add('omni-video-frame', 'omni-shadow-video');
            host.contentEditable = 'false';
            host.setAttribute(this.isAudio ? 'data-omni-audio-frame' : 'data-omni-video-frame', 'true');
            if (!host.style.width) host.style.width = video.style.width && video.style.width !== '100%' ? video.style.width : 'min(100%, 760px)';
            this.host = host;
            this.root = host.shadowRoot || host.attachShadow({ mode: 'open' });
            if (sheet) this.root.adoptedStyleSheets = [sheet];
            else { const style = document.createElement('style'); style.textContent = css; this.root.appendChild(style); }
            this.root.innerHTML += '<div class="surface"><slot></slot><div class="captions" hidden tabindex="0"></div><div class="controls"></div><div class="notice liquid-glass" hidden role="status"></div></div>';
            if (this.isAudio) {
                const heading = document.createElement('div'); heading.className = 'audio-title';
                const icon = document.createElement('icon'); icon.textContent = 'music_note'; icon.setAttribute('aria-hidden', 'true');
                const label = document.createElement('span');
                if (video.title) { label.textContent = video.title; label.title = video.title; }
                else label.dataset.textKey = 'audio_player';
                heading.append(icon, label); this.root.querySelector('.surface').prepend(heading);
            }
            this.controls = this.root.querySelector('.controls');
            this.caption = this.root.querySelector('.captions');
            this.caption.dir = 'auto';
            this.notice = this.root.querySelector('.notice');
            video.controls = false; video.removeAttribute('controls'); video.setAttribute('playsinline', ''); video.contentEditable = 'false';
            video.style.margin = '0'; video.style.borderRadius = 'inherit';
            this.changePitch = video.dataset.omniChangePitch === 'true';
            video.preservesPitch = !this.changePitch;
            const storedRate = Number(video.dataset.omniPlaybackRate);
            if (storedRate >= .25 && storedRate <= 16) { try { video.defaultPlaybackRate = storedRate; video.playbackRate = storedRate; } catch {} }
            this.build();
            this.reloadCaptions();
            this.bind();
            this.sync();
            if (typeof ResizeObserver !== 'undefined') {
                this.resizeObserver = new ResizeObserver(() => this.adaptControls());
                this.resizeObserver.observe(host);
            }
            document.fonts?.ready.then(() => { if (!this.destroyed) this.adaptControls(); });
            this.reveal();
        }
        on(target, name, callback, options = {}) { target.addEventListener(name, callback, { ...options, signal: this.abort.signal }); }
        iconButton(name, key, action, glass = false) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'button' + (glass ? ' liquid-glass' : ''); button.dataset.labelKey = key;
            button.innerHTML = `<icon aria-hidden="true">${name}</icon>`;
            this.on(button, 'click', event => { event.stopPropagation(); action(event); this.reveal(); });
            return button;
        }
        range(min, max, step, key) {
            const input = document.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.dataset.labelKey = key;
            return input;
        }
        panel(key) {
            const panel = document.createElement('section'); panel.className = 'panel liquid-glass'; panel.hidden = true; panel.dataset.panelKey = key;
            panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', t(key));
            if ('showPopover' in panel) panel.setAttribute('popover', 'manual');
            this.root.appendChild(panel); return panel;
        }
        toggleRow(key, checked, action, iconName) {
            const row = document.createElement('button'); row.type = 'button'; row.className = 'row'; row.setAttribute('role', 'switch'); row.setAttribute('aria-checked', String(checked));
            const label = document.createElement('span'); label.dataset.textKey = key;
            const title = document.createElement('span'); title.className = 'row-label';
            if (iconName) { const icon = document.createElement('icon'); icon.textContent = iconName; icon.setAttribute('aria-hidden', 'true'); title.appendChild(icon); }
            title.appendChild(label);
            const toggle = document.createElement('span'); toggle.className = 'switch'; toggle.setAttribute('aria-hidden', 'true'); row.append(title, toggle);
            this.on(row, 'click', () => { const next = row.getAttribute('aria-checked') !== 'true'; row.setAttribute('aria-checked', String(next)); action(next); });
            return row;
        }
        build() {
            const video = this.video;
            this.play = this.iconButton('play_arrow', 'play', () => this.togglePlay(), true);
            const volume = document.createElement('div'); volume.className = 'volume'; this.volumeGroup = volume;
            this.volumeButton = this.iconButton('volume_up', 'volume', () => {
                if (matchMedia('(hover:none)').matches && !volume.classList.contains('expanded')) volume.classList.add('expanded');
                else if (video.muted || !video.volume) { if (!video.volume) video.volume = this.lastVolume || 1; video.muted = false; }
                else video.muted = true;
            }, true);
            const tray = document.createElement('div'); tray.className = 'volume-tray liquid-glass';
            this.volume = this.range(0, 1, .01, 'volume'); tray.appendChild(this.volume); volume.append(this.volumeButton, tray);
            const timeline = document.createElement('div'); timeline.className = 'timeline liquid-glass';
            this.seek = this.range(0, 1000, 1, 'video_seek'); timeline.appendChild(this.seek);
            this.time = document.createElement('button'); this.time.type = 'button'; this.time.className = 'timestamp liquid-glass';
            this.on(this.time, 'click', () => { video.dataset.omniTimeRemaining = String(video.dataset.omniTimeRemaining !== 'true'); this.sync(); save(video); this.reveal(); });
            const right = document.createElement('div'); right.className = 'right liquid-glass';
            this.settingsButton = this.iconButton('settings', 'settings', () => this.showPanel(this.settings, this.settingsButton));
            this.settingsButton.setAttribute('aria-haspopup', 'dialog'); this.settingsButton.setAttribute('aria-expanded', 'false');
            this.miniButton = this.iconButton('picture_in_picture_alt', 'mini_player', () => openMini(video));
            this.miniButton.hidden = !!video.closest('#omniMediaMiniPlayer');
            this.fullscreenButton = this.iconButton('fullscreen', 'fullscreen', async () => {
                try { if (document.fullscreenElement) await document.exitFullscreen(); else if (this.host.requestFullscreen) await this.host.requestFullscreen(); else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); } catch {}
            });
            this.fullscreenButton.hidden = this.isAudio;
            this.miniButton.hidden ||= this.isAudio;
            right.append(this.settingsButton, this.miniButton, this.fullscreenButton);
            this.controls.append(this.play, volume, this.time, timeline, right);
            this.timeline = timeline;
            this.right = right;
            this.settings = this.panel('settings');
            const title = document.createElement('h3'); title.dataset.textKey = 'settings'; this.settings.appendChild(title);
            this.loop = this.toggleRow('video_loop', video.loop, value => { video.loop = value; save(video); }, 'repeat');
            this.pitch = this.toggleRow('video_change_pitch', this.changePitch, value => { this.changePitch = value; video.preservesPitch = !value; video.dataset.omniChangePitch = String(value); save(video); }, 'graphic_eq');
            this.speedButton = document.createElement('button'); this.speedButton.type = 'button'; this.speedButton.className = 'row';
            const speedTitleLabel = document.createElement('span'); speedTitleLabel.className = 'row-label';
            const speedIcon = document.createElement('icon'); speedIcon.textContent = 'speed'; speedIcon.setAttribute('aria-hidden', 'true');
            const speedLabel = document.createElement('span'); speedLabel.dataset.textKey = 'video_speed'; speedTitleLabel.append(speedIcon, speedLabel);
            this.rateLabel = document.createElement('span'); this.speedButton.append(speedTitleLabel, this.rateLabel);
            this.captionToggle = this.toggleRow('video_captions', video.dataset.omniCaptionsEnabled !== 'false', value => { video.dataset.omniCaptionsEnabled = String(value); this.syncCaptions(); save(video); }, 'closed_caption');
            this.captionUpload = document.createElement('button'); this.captionUpload.type = 'button'; this.captionUpload.className = 'row'; this.captionUpload.dataset.textKey = 'video_caption_optional';
            this.on(this.captionUpload, 'click', () => {
                const input = document.createElement('input'); input.type = 'file'; input.accept = '.vtt,.srt,text/vtt,application/x-subrip,text/plain';
                input.onchange = async () => { const file = input.files[0]; if (!file) return; try { this.setCaptions(await readCaptions(file)); } catch { this.message('video_caption_error'); } };
                input.click();
            });
            this.captionEdit = document.createElement('button'); this.captionEdit.type = 'button'; this.captionEdit.className = 'row';
            this.captionEdit.innerHTML = '<span class="row-label"><icon aria-hidden="true">edit_note</icon><span data-text-key="video_caption_type"></span></span>';
            this.settings.append(this.loop, this.pitch, this.speedButton, this.captionToggle, this.captionEdit, this.captionUpload);
            this.captionEdit.hidden = this.isAudio;
            this.captionUpload.hidden = this.isAudio;
            this.volumeSettings = document.createElement('div'); this.volumeSettings.className = 'volume-setting'; this.volumeSettings.hidden = true;
            const volumeHeading = document.createElement('div'); volumeHeading.className = 'row-label';
            const mute = this.iconButton('volume_up', 'volume', () => {
                if (video.muted || !video.volume) { if (!video.volume) video.volume = this.lastVolume || 1; video.muted = false; }
                else video.muted = true;
                this.sync();
            });
            this.settingsMute = mute;
            const volumeLabel = document.createElement('span'); volumeLabel.dataset.textKey = 'volume'; volumeHeading.append(mute, volumeLabel);
            this.settingsVolume = this.range(0, 1, .01, 'volume'); this.volumeSettings.append(volumeHeading, this.settingsVolume);
            this.miniSettings = document.createElement('button'); this.miniSettings.type = 'button'; this.miniSettings.className = 'row'; this.miniSettings.hidden = true;
            this.miniSettings.innerHTML = '<span class="row-label"><icon aria-hidden="true">picture_in_picture_alt</icon><span data-text-key="mini_player"></span></span>';
            this.on(this.miniSettings, 'click', () => { this.closePanels(); openMini(video); });
            this.settings.insertBefore(this.miniSettings, this.loop);
            this.settings.insertBefore(this.volumeSettings, this.miniSettings);
            this.captionPanel = this.panel('video_caption_type');
            const captionHeading = document.createElement('header');
            const captionBack = this.iconButton('arrow_back', 'settings', () => this.showPanel(this.settings, this.settingsButton));
            const captionTitle = document.createElement('h3'); captionTitle.dataset.textKey = 'video_caption_type'; captionHeading.append(captionBack, captionTitle);
            this.captionInput = document.createElement('textarea'); this.captionInput.dataset.labelKey = 'video_captions'; this.captionInput.setAttribute('aria-describedby', 'typedCaptionHint');
            const hint = document.createElement('p'); hint.id = 'typedCaptionHint'; hint.className = 'hint'; hint.dataset.textKey = 'video_caption_type_hint';
            const captionSave = document.createElement('button'); captionSave.type = 'button'; captionSave.className = 'row'; captionSave.innerHTML = '<span class="row-label"><icon aria-hidden="true">check</icon><span data-text-key="save"></span></span>';
            const captionError = document.createElement('p'); captionError.className = 'hint'; captionError.setAttribute('role', 'status');
            this.captionPanel.append(captionHeading, hint, this.captionInput, captionSave, captionError);
            this.on(this.captionEdit, 'click', () => {
                try { this.captionInput.value = captionsToText(JSON.parse(video.dataset.omniCaptions || 'null')); } catch { this.captionInput.value = ''; }
                captionError.textContent = '';
                this.showPanel(this.captionPanel, this.settingsButton);
                this.captionInput.focus({ preventScroll: true });
            });
            this.on(captionSave, 'click', () => {
                try { this.setCaptions(captionsFromText(this.captionInput.value)); this.showPanel(this.settings, this.settingsButton); }
                catch { captionError.textContent = t('video_caption_error'); }
            });
            this.speedPanel = this.panel('video_speed');
            const heading = document.createElement('header');
            const back = this.iconButton('arrow_back', 'settings', () => this.showPanel(this.settings, this.settingsButton));
            const speedTitle = document.createElement('h3'); speedTitle.dataset.textKey = 'video_speed'; heading.append(back, speedTitle);
            this.speedOutput = document.createElement('output'); this.speedOutput.className = 'speed-value';
            this.speedSlider = this.range(0, 1000, 1, 'video_speed');
            const limits = document.createElement('div'); limits.className = 'speed-limits'; limits.innerHTML = '<span>0.25×</span><span>16×</span>';
            const presets = document.createElement('div'); presets.className = 'presets';
            for (const rate of [.25, .5, .75, 1, 1.25, 1.5, 2, 3, 4, 8, 16]) {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'preset'; button.dataset.rate = String(rate); button.textContent = rate + '×';
                this.on(button, 'click', () => this.setRate(rate)); presets.appendChild(button);
            }
            this.speedPanel.append(heading, this.speedOutput, this.speedSlider, limits, presets);
            this.on(this.speedButton, 'click', () => this.showPanel(this.speedPanel, this.settingsButton));
            this.translate();
        }
        translate() {
            this.root.querySelectorAll('[data-label-key]').forEach(node => { const label = t(node.dataset.labelKey); node.setAttribute('aria-label', label); node.title = label; });
            this.root.querySelectorAll('[data-text-key]').forEach(node => { node.textContent = t(node.dataset.textKey); });
            if (this.isAudio) { this.host.setAttribute('role', 'group'); this.host.setAttribute('aria-label', this.video.title || t('audio_player')); }
            this.caption.setAttribute('aria-label', t('video_caption_move'));
            this.sync();
        }
        fill(input) { input.style.setProperty('--fill', ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100) + '%'); }
        adaptControls() {
            if (this.destroyed || !this.settingsVolume || !this.controls.clientWidth) return;
            const style = element => getComputedStyle(element);
            const number = value => parseFloat(value) || 0;
            const controlsStyle = style(this.controls), rightStyle = style(this.right), timeStyle = style(this.time);
            const gap = number(controlsStyle.columnGap);
            const playWidth = number(style(this.play).width);
            const volumeWidth = number(style(this.volumeButton).width);
            const settingsWidth = number(style(this.settingsButton).width), fullWidth = this.isAudio ? 0 : number(style(this.fullscreenButton).width);
            const miniEligible = !this.isAudio && !this.video.closest('#omniMediaMiniPlayer');
            const miniWidth = miniEligible ? number(style(this.miniButton).width) : 0;
            const rightPadding = number(rightStyle.paddingLeft) + number(rightStyle.paddingRight) + number(rightStyle.borderLeftWidth) + number(rightStyle.borderRightWidth);
            const rightGap = number(rightStyle.columnGap);
            const rightWidth = settingsWidth + fullWidth + miniWidth + rightPadding + rightGap * (this.isAudio ? 0 : miniEligible ? 2 : 1);
            this.measureContext ||= document.createElement('canvas').getContext('2d');
            if (this.measureContext) this.measureContext.font = timeStyle.font;
            const textWidth = this.measureContext ? this.measureContext.measureText(this.time.textContent).width : this.time.textContent.length * number(timeStyle.fontSize);
            const timeWidth = textWidth + number(timeStyle.paddingLeft) + number(timeStyle.paddingRight) + number(timeStyle.borderLeftWidth) + number(timeStyle.borderRightWidth);
            const seekWidth = Math.max(84, number(style(this.timeline).minWidth));
            const available = this.controls.clientWidth;
            const hideTime = playWidth + volumeWidth + timeWidth + seekWidth + rightWidth + gap * 4 > available;
            const moveToMenu = hideTime && playWidth + volumeWidth + seekWidth + rightWidth + gap * 3 > available;
            const active = this.root.activeElement;
            if ((hideTime && active === this.time) || (moveToMenu && (this.volumeGroup.contains(active) || active === this.miniButton)) || (!moveToMenu && (this.volumeSettings.contains(active) || active === this.miniSettings))) this.settingsButton.focus({ preventScroll: true });
            const hide = (element, hidden) => { if (element.hidden !== hidden) element.hidden = hidden; };
            hide(this.time, hideTime);
            hide(this.volumeGroup, moveToMenu);
            hide(this.miniButton, !miniEligible || moveToMenu);
            hide(this.volumeSettings, !moveToMenu);
            hide(this.miniSettings, !miniEligible || !moveToMenu);
            const layout = moveToMenu ? 'menu' : hideTime ? 'no-time' : 'full';
            if (this.host.dataset.controlLayout !== layout) {
                this.host.dataset.controlLayout = layout;
                this.positionCaptions();
                if (this.openPanel) this.positionPanel(this.openPanel);
            }
        }
        setRate(rate) {
            try {
                this.video.playbackRate = clamp(Number(rate), .25, 16);
                this.video.defaultPlaybackRate = this.video.playbackRate;
                this.video.preservesPitch = !this.changePitch;
                this.video.dataset.omniPlaybackRate = String(this.video.playbackRate);
                this.sync(); save(this.video);
            } catch { this.sync(); this.message('video_rate_error'); }
        }
        togglePlay() { if (this.video.paused) this.video.play().catch(() => this.message(this.isAudio ? 'audio_play_error' : 'video_play_error')); else this.video.pause(); }
        message(key) { this.notice.textContent = t(key); this.notice.hidden = false; clearTimeout(this.messageTimer); this.messageTimer = setTimeout(() => { this.notice.hidden = true; }, 4000); }
        showPanel(panel, anchor) {
            const closing = this.openPanel === panel;
            this.closePanels();
            if (closing) return;
            this.openPanel = panel; panel.hidden = false;
            if (panel.showPopover) { try { panel.showPopover(); } catch {} }
            this.positionPanel(panel, anchor);
            this.settingsButton.setAttribute('aria-expanded', 'true');
            [...panel.querySelectorAll('button, input, textarea')].find(control => !control.disabled && control.getClientRects().length)?.focus({ preventScroll: true });
        }
        positionPanel(panel, anchor = this.settingsButton) {
            const rect = anchor.getBoundingClientRect(); const v = window.visualViewport;
            const x = v?.offsetLeft || 0, y = v?.offsetTop || 0, width = v?.width || innerWidth, height = v?.height || innerHeight;
            panel.style.maxHeight = Math.max(0, height - 24) + 'px';
            panel.style.left = clamp(rect.right - panel.offsetWidth, x + 8, Math.max(x + 8, x + width - panel.offsetWidth - 8)) + 'px';
            panel.style.top = clamp(rect.top - panel.offsetHeight - 10, y + 8, Math.max(y + 8, y + height - panel.offsetHeight - 8)) + 'px';
        }
        closePanels() {
            for (const panel of [this.settings, this.speedPanel, this.captionPanel]) {
                if (!panel) continue;
                if (panel.hidePopover) { try { panel.hidePopover(); } catch {} }
                panel.hidden = true;
            }
            this.openPanel = null;
            this.settingsButton?.setAttribute('aria-expanded', 'false');
            if (!this.video.paused) this.reveal();
        }
        reveal() {
            if (this.destroyed) return;
            this.host.setAttribute('data-controls-visible', '');
            clearTimeout(this.timer);
            if (this.isAudio) return;
            this.timer = setTimeout(() => {
                if (!this.video.paused && !this.openPanel && !this.keyboardFocus && !this.interacting) {
                    this.host.removeAttribute('data-controls-visible');
                    this.volumeGroup.classList.remove('expanded');
                }
            }, 3000);
        }
        reloadCaptions() {
            try {
                const data = JSON.parse(this.video.dataset.omniCaptions || 'null');
                this.cues = (data?.cues || []).map(cue => ({ ...cue, end: data.wholeVideo && cue.end === null ? (Number.isFinite(this.video.duration) && this.video.duration > 0 ? this.video.duration : Number.MAX_VALUE) : cue.end })).filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && typeof cue.text === 'string').sort((a, b) => a.start - b.start);
            } catch { this.cues = []; }
            this.maxEnds = []; let maximum = 0;
            for (const cue of this.cues) { maximum = Math.max(maximum, cue.end); this.maxEnds.push(maximum); }
            this.captionToggle.hidden = this.isAudio || !this.cues.length;
            this.captionToggle.setAttribute('aria-checked', String(this.video.dataset.omniCaptionsEnabled !== 'false'));
            this.positionCaptions(); this.syncCaptions();
        }
        setCaptions(data) { this.video.dataset.omniCaptions = JSON.stringify(data); this.video.dataset.omniCaptionsEnabled = 'true'; this.reloadCaptions(); save(this.video); }
        positionCaptions() {
            const width = this.host.clientWidth, height = this.host.clientHeight;
            const halfX = width ? Math.min(45, this.caption.offsetWidth / width * 50) : 5;
            const halfY = height ? Math.min(45, this.caption.offsetHeight / height * 50) : 5;
            const defaultY = height ? (height - this.controls.offsetHeight - 20 - (this.caption.offsetHeight || 24) / 2) / height * 100 : 70;
            this.caption.style.left = clamp(Number(this.video.dataset.omniCaptionX) || 50, Math.max(5, halfX), Math.min(95, 100 - halfX)) + '%';
            this.caption.style.top = clamp(Number(this.video.dataset.omniCaptionY) || defaultY, Math.max(5, halfY), Math.min(95, 100 - halfY)) + '%';
        }
        syncCaptions() {
            const time = this.video.currentTime; let low = 0, high = this.cues.length;
            while (low < high) { const mid = (low + high) >>> 1; if (this.cues[mid].start <= time) low = mid + 1; else high = mid; }
            const lines = [];
            for (let index = low - 1; index >= 0 && this.maxEnds[index] > time; index--) if (this.cues[index].end > time) lines.unshift(this.cues[index].text);
            const text = lines.join('\n');
            if (this.caption.textContent !== text) this.caption.textContent = text;
            this.caption.hidden = !text || this.video.dataset.omniCaptionsEnabled === 'false';
            if (!this.caption.hidden) this.positionCaptions();
        }
        sync() {
            const video = this.video;
            if (!this.seek) return;
            const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
            this.seek.disabled = !duration;
            this.seek.value = String(duration ? video.currentTime / duration * 1000 : 0); this.fill(this.seek);
            const remaining = video.dataset.omniTimeRemaining === 'true';
            this.time.replaceChildren(document.createTextNode((remaining ? '−' : '') + formatTime(remaining ? Math.max(0, duration - video.currentTime) : video.currentTime)));
            const total = document.createElement('span'); total.className = 'duration'; total.textContent = ' / ' + formatTime(duration); this.time.appendChild(total);
            this.time.title = t(remaining ? 'video_time_remaining' : 'video_time_elapsed');
            this.time.setAttribute('aria-label', this.time.title + ': ' + this.time.textContent);
            this.time.setAttribute('aria-pressed', String(remaining));
            this.play.querySelector('icon').textContent = video.paused ? 'play_arrow' : 'pause'; this.play.setAttribute('aria-label', t(video.paused ? 'play' : 'pause')); this.play.title = this.play.getAttribute('aria-label');
            this.volume.value = String(video.muted ? 0 : video.volume); this.fill(this.volume);
            this.settingsVolume.value = this.volume.value; this.fill(this.settingsVolume);
            if (video.volume > 0) this.lastVolume = video.volume;
            this.volumeButton.querySelector('icon').textContent = video.muted || !video.volume ? 'volume_off' : 'volume_up';
            this.settingsMute.querySelector('icon').textContent = this.volumeButton.querySelector('icon').textContent;
            this.rateLabel.textContent = video.playbackRate + '×'; this.speedOutput.value = video.playbackRate + '×';
            this.speedSlider.value = String(Math.log2(video.playbackRate / .25) / 6 * 1000); this.fill(this.speedSlider);
            this.speedSlider.setAttribute('aria-valuetext', video.playbackRate + '×');
            this.root.querySelectorAll('[data-rate]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.rate) === video.playbackRate)));
            this.loop.setAttribute('aria-checked', String(video.loop));
            this.syncCaptions();
            this.adaptControls();
        }
        bind() {
            const video = this.video;
            for (const event of ['timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'ratechange', 'play', 'pause', 'ended']) this.on(video, event, () => { if (event === 'loadedmetadata' || event === 'durationchange') this.reloadCaptions(); this.sync(); if (video.paused || event === 'play') this.reveal(); });
            this.on(video, 'click', () => { if (!(matchMedia('(hover:none)').matches && !this.host.hasAttribute('data-controls-visible'))) this.togglePlay(); this.reveal(); });
            this.on(this.host, 'pointermove', () => { this.keyboardFocus = false; this.reveal(); });
            this.on(this.host, 'pointerdown', () => { this.keyboardFocus = false; this.reveal(); }, { capture: true });
            this.on(this.host, 'focusin', () => { this.keyboardFocus = !!this.root.activeElement?.matches(':focus-visible'); this.reveal(); });
            this.on(this.host, 'focusout', () => { queueMicrotask(() => { if (!this.root.activeElement) this.keyboardFocus = false; this.reveal(); }); });
            this.on(this.root, 'pointerdown', event => { if (event.target.matches?.('input[type="range"]')) this.interacting = true; });
            this.on(window, 'pointerup', () => { if (this.interacting) { this.interacting = false; this.reveal(); } });
            this.on(window, 'pointercancel', () => { if (this.interacting) { this.interacting = false; this.reveal(); } });
            this.on(this.volume, 'input', () => { video.volume = Number(this.volume.value); video.muted = !video.volume; this.sync(); });
            this.on(this.settingsVolume, 'input', () => { video.volume = Number(this.settingsVolume.value); video.muted = !video.volume; this.sync(); });
            this.on(this.seek, 'input', () => { if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Number(this.seek.value) / 1000 * video.duration; this.sync(); });
            this.on(this.speedSlider, 'input', () => this.setRate(Math.round(.25 * 2 ** (Number(this.speedSlider.value) / 1000 * 6) * 100) / 100));
            for (const event of ['mousedown', 'click', 'beforeinput', 'input', 'keydown', 'keyup', 'keypress', 'compositionstart', 'compositionupdate', 'compositionend', 'pointerdown']) this.on(this.root, event, e => { if (e.target.closest?.('.controls, .panel, .captions')) e.stopPropagation(); });
            this.on(document, 'pointerdown', event => {
                if (!event.composedPath().includes(this.host)) { this.closePanels(); this.volumeGroup.classList.remove('expanded'); }
            });
            this.on(this.root, 'keydown', event => {
                this.keyboardFocus = true;
                this.reveal();
                if (event.key === 'Escape') { this.closePanels(); this.settingsButton.focus(); event.preventDefault(); }
            });
            this.on(window, 'resize', () => { this.adaptControls(); if (this.openPanel) this.positionPanel(this.openPanel); });
            if (window.visualViewport) {
                for (const event of ['resize', 'scroll']) this.on(window.visualViewport, event, () => { if (this.openPanel) this.positionPanel(this.openPanel); }, { passive: true });
            }
            this.on(window, 'scroll', event => { if (this.openPanel && !event.composedPath().includes(this.openPanel)) this.positionPanel(this.openPanel); }, { capture: true, passive: true });
            let drag = null;
            this.on(this.caption, 'pointerdown', event => {
                event.preventDefault(); event.stopPropagation();
                const rect = this.caption.getBoundingClientRect(); drag = { x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) };
                this.caption.setPointerCapture(event.pointerId);
            });
            this.on(this.caption, 'pointermove', event => {
                if (!drag) return;
                const rect = this.host.getBoundingClientRect();
                const halfX = Math.min(45, this.caption.offsetWidth / rect.width * 50), halfY = Math.min(45, this.caption.offsetHeight / rect.height * 50);
                const x = clamp((event.clientX - drag.x - rect.left) / rect.width * 100, halfX, 100 - halfX);
                const y = clamp((event.clientY - drag.y - rect.top) / rect.height * 100, halfY, 100 - halfY);
                video.dataset.omniCaptionX = String(x); video.dataset.omniCaptionY = String(y); this.positionCaptions();
            });
            for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) this.on(this.caption, event, () => { if (drag) { drag = null; save(video); } });
            this.on(this.caption, 'keydown', event => {
                const directions = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] };
                const delta = directions[event.key]; if (!delta) return;
                event.preventDefault(); video.dataset.omniCaptionX = String(clamp((Number(video.dataset.omniCaptionX) || 50) + delta[0], 5, 95)); video.dataset.omniCaptionY = String(clamp((Number(video.dataset.omniCaptionY) || 78) + delta[1], 5, 95)); this.positionCaptions(); save(video);
            });
        }
        destroy() { this.destroyed = true; this.resizeObserver?.disconnect(); clearTimeout(this.timer); clearTimeout(this.messageTimer); this.closePanels(); this.abort.abort(); }
    }
    function upgrade(scope = document) {
        const videos = [...(scope.matches?.('video, audio') ? [scope] : []), ...scope.querySelectorAll('video, audio')];
        for (const video of videos) {
            if (players.has(video)) { video.controls = false; video.removeAttribute('controls'); continue; }
            if (!video.isConnected) continue;
            const player = new Player(video); players.set(video, player); live.add(player);
        }
    }
    let scheduled = false;
    const observer = new MutationObserver(mutations => {
        if (scheduled || !mutations.some(mutation => mutation.addedNodes.length || mutation.removedNodes.length)) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            for (const player of live) if (!player.host.isConnected) { player.destroy(); live.delete(player); players.delete(player.video); }
            upgrade();
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    new MutationObserver(() => { for (const player of live) player.translate(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    window.addEventListener('keydown', event => { if (event.key === 'Escape' && mini && !document.fullscreenElement) closeMini(); });
    window.addEventListener('pagehide', event => {
        closeMini(false);
        for (const player of live) {
            if (event.persisted) { player.closePanels(); clearTimeout(player.timer); player.video.pause(); }
            else player.destroy();
        }
    });
    window.addEventListener('pageshow', event => {
        if (event.persisted) for (const player of live) { player.sync(); player.reveal(); }
    });
    window.OmniVideoPlayer = { upgrade, readCaptions, parseCaptions, captionsFromText, setCaptions: (video, data) => { upgrade(video); players.get(video)?.setCaptions(data); } };
    window.OmniAudioPlayer = { upgrade };
    upgrade();
})();
