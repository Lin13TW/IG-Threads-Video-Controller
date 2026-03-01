// Threads Video Pro - Content Script v12.3
// v12.2 Fixes (kept):
//  [BUG1] IG: ctrl position fixed to use viewport coords
//  [BUG2] IG: Blocker full-width
//  [BUG3] No duplicate event listeners (WeakSet)
//  [BUG4] Threads: bottom offset 70px clears nav bar
//  [BUG5] Threads: SPA reset via MutationObserver
//  [BUG6] Threads: Blocker prevents click-through
// v12.3 New:
//  [FIX7] Hide IG/Threads native player controls more aggressively (controls attribute removal + CSS shadow-dom pierce)
//  [ADD1] Rotate button added to controller (cycles 0 → 90 → 180 → 270 → 0)

(function() {
  if (window.TVP_INSTANCE) return;
  window.TVP_INSTANCE = true;
  console.log('Threads Video Pro v12.3: Loaded');

  let isEnabled = true;
  const isInstagram = window.location.hostname.includes('instagram.com');
  const isThreads = window.location.hostname.includes('threads');

  // --- 0. CSS: Hide Native Controls aggressively ---
  // FIX7: Also target the wrapper/container elements IG/Threads use around <video>
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    video::-webkit-media-controls,
    video::-webkit-media-controls-enclosure,
    video::-webkit-media-controls-panel,
    video::-webkit-media-controls-overlay-play-button,
    video::-webkit-media-controls-play-button,
    video::-webkit-media-controls-timeline,
    video::-webkit-media-controls-current-time-display,
    video::-webkit-media-controls-time-remaining-display,
    video::-webkit-media-controls-mute-button,
    video::-webkit-media-controls-volume-slider,
    video::-webkit-media-controls-fullscreen-button {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        width: 0 !important;
        height: 0 !important;
    }
  `;
  (document.documentElement || document.head).appendChild(styleEl);

  // --- 1. Host Setup ---
  const host = document.createElement('div');
  host.id = 'tvp-host-v12';
  host.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; z-index:2147483647; pointer-events:none;';
  (document.documentElement).appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // --- 2. Styles ---
  const style = document.createElement('style');
  style.textContent = `
    :host { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }

    #footer-blocker {
      position: fixed;
      background: transparent;
      cursor: default;
      pointer-events: auto;
      display: none;
      z-index: 1000;
    }

    #ctrl {
      position: fixed;
      background: rgba(10, 10, 10, 0.9);
      backdrop-filter: blur(10px);
      padding: 0 18px;
      height: 46px;
      border-radius: 999px;

      display: flex;
      align-items: center;
      gap: 14px;

      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 8px 32px rgba(0,0,0,0.7);

      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: auto;
      user-select: none;
      visibility: hidden;
      z-index: 2000;
    }

    #ctrl.show {
      opacity: 1;
      visibility: visible;
    }

    button {
      background: transparent;
      border: none;
      color: #ddd;
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    button:hover { background: rgba(255, 255, 255, 0.2); color: #fff; }
    button:active { transform: scale(0.9); }

    /* ADD1: Rotate button active state shows current rotation */
    #btn-rotate.rotated { color: #fff; }

    .time {
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: #bbb;
      min-width: 38px;
      text-align: center;
      font-weight: 500;
    }

    .slider-box {
      width: 180px;
      height: 46px;
      display: flex;
      align-items: center;
      position: relative;
    }

    input[type=range] {
      -webkit-appearance: none;
      width: 100%;
      height: 4px;
      background: rgba(255,255,255,0.25);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
      transition: height 0.2s;
    }
    input[type=range]:hover { height: 6px; }

    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
      margin-top: 0;
    }
    input[type=range]:hover::-webkit-slider-thumb { transform: scale(1.3); }

    select {
      background: rgba(255,255,255,0.1);
      color: #eee;
      border: none;
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      font-weight: bold;
      outline: none;
      cursor: pointer;
      height: 24px;
    }
    select:hover { background: rgba(255,255,255,0.3); color: #fff; }
    select option { background: #111; color: #fff; }
  `;
  shadow.appendChild(style);

  // --- 3. UI Template ---
  const svgs = {
    play:   '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause:  '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
    vol:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>',
    mute:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>',
    // ADD1: Rotate CW icon
    rotate: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11c-.17-1.39-.72-2.73-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47H19.93zm-3.04 6.47c1.16-.9 1.92-2.17 2.17-3.47h-2.02c-.2.87-.63 1.67-1.17 2.28l1.02 1.19zm.93-10.92l-1.42 1.42-.03.03c.52.68.87 1.46 1.02 2.26H19c-.17-1.3-.7-2.52-1.46-3.52l.28.19-.94-.38z"/></svg>'
  };

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div id="footer-blocker"></div>
    <div id="ctrl">
        <button id="btn-play">${svgs.play}</button>
        <div class="time" id="lbl-time">0:00</div>
        <div class="slider-box">
          <input type="range" id="inp-seek" min="0" max="100" step="0.1" value="0">
        </div>
        <select id="sel-rate">
          <option value="0.5">0.5x</option>
          <option value="1" selected>1x</option>
          <option value="1.5">1.5x</option>
          <option value="2">2x</option>
          <option value="3">3x</option>
        </select>
        <button id="btn-vol">${svgs.vol}</button>
        <button id="btn-rotate" title="旋轉畫面">${svgs.rotate}</button>
    </div>
  `;
  shadow.appendChild(wrapper);

  // --- 4. Logic & State ---
  const $ = (id) => shadow.getElementById(id);
  const ui = {
    blocker: $('footer-blocker'),
    ctrl:    $('ctrl'),
    play:    $('btn-play'),
    time:    $('lbl-time'),
    seek:    $('inp-seek'),
    rate:    $('sel-rate'),
    vol:     $('btn-vol'),
    rotate:  $('btn-rotate')   // ADD1
  };

  let activeVideo = null;
  let isDragging  = false;
  let hideTimeout = null;

  // ADD1: rotation state per video element
  const videoRotation = new WeakMap(); // video → degrees (0/90/180/270)

  // BUG3: guard against duplicate listeners
  const boundVideos = new WeakSet();

  function checkConfig(settings) {
      if(isInstagram)   isEnabled = settings.enableInstagram !== false;
      else if(isThreads) isEnabled = settings.enableThreads  !== false;
      host.style.display = isEnabled ? 'block' : 'none';
      if(!isEnabled) hideAll();
  }

  chrome.storage.sync.get(['enableThreads', 'enableInstagram'], checkConfig);
  chrome.runtime.onMessage.addListener((msg) => {
      if(msg.type === 'SETTINGS_UPDATE') checkConfig(msg.settings);
  });

  // --- 5. Event Handling ---
  const stop = (e) => {
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type === 'mousedown' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
    }
  };

  ui.blocker.onclick     = stop;
  ui.blocker.onmousedown = stop;
  ui.blocker.onmouseup   = stop;
  ui.blocker.ondblclick  = stop;

  ui.ctrl.onmouseenter = () => clearTimeout(hideTimeout);
  ui.ctrl.onmouseleave = () => startHide(500);

  ui.play.onclick = (e) => {
      stop(e);
      if(activeVideo) {
          activeVideo.paused ? activeVideo.play() : activeVideo.pause();
          updateState();
      }
  };

  ui.vol.onclick = (e) => {
      stop(e);
      if(activeVideo) {
          const m = activeVideo.muted || activeVideo.volume === 0;
          if(m) { activeVideo.muted = false; activeVideo.volume = 1; }
          else  { activeVideo.muted = true; }
          updateState();
      }
  };

  ui.rate.onchange  = (e) => { if(activeVideo) activeVideo.playbackRate = parseFloat(e.target.value); };
  ui.rate.onmousedown = (e) => e.stopPropagation();

  ui.seek.oninput = (e) => {
      isDragging = true;
      if(activeVideo && activeVideo.duration)
          activeVideo.currentTime = (parseFloat(e.target.value) / 100) * activeVideo.duration;
  };
  ui.seek.onchange  = () => { isDragging = false; if(activeVideo) activeVideo.play(); };
  ui.seek.onmousedown = (e) => { stop(e); if(activeVideo) activeVideo.pause(); };

  // ADD1: Rotate button — cycles 0 → 90 → 180 → 270 → 0
  ui.rotate.onclick = (e) => {
      stop(e);
      if(!activeVideo) return;
      const cur = videoRotation.get(activeVideo) || 0;
      const next = (cur + 90) % 360;
      videoRotation.set(activeVideo, next);
      applyRotation(activeVideo, next);
      // Show active state when not at 0°
      ui.rotate.classList.toggle('rotated', next !== 0);
  };

  function applyRotation(video, deg) {
      // We need to rotate the video visually.
      // For 90/270 we also swap apparent width/height so it fills the same box.
      const r = video.getBoundingClientRect();
      let transform = `rotate(${deg}deg)`;
      if(deg === 90 || deg === 270) {
          // Scale to fit: swap axes
          const scale = Math.min(r.width / r.height, r.height / r.width);
          transform = `rotate(${deg}deg) scale(${scale})`;
      }
      video.style.transform       = transform;
      video.style.transformOrigin = 'center center';
  }

  // --- 6. Video Detection ---
  document.addEventListener('mousemove', (e) => {
      if(!isEnabled) return;
      const mx = e.clientX, my = e.clientY;
      const videos = document.getElementsByTagName('video');
      let found = null;

      for(let i = 0; i < videos.length; i++) {
          const v = videos[i];
          if(v.offsetParent === null) continue;
          const r = v.getBoundingClientRect();
          if(mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) {
              if(r.width > 100 && r.height > 100) { found = v; break; }
          }
      }

      if(found) {
          if(activeVideo !== found) {
              activeVideo = found;
              if(!boundVideos.has(activeVideo)) {
                  activeVideo.addEventListener('play',         updateState);
                  activeVideo.addEventListener('pause',        updateState);
                  activeVideo.addEventListener('volumechange', updateState);
                  boundVideos.add(activeVideo);
              }
              showAll();
          } else {
              showAll();
          }
      } else {
          startHide(500);
      }
  }, { passive: true });

  // BUG5: SPA reset
  const videoObserver = new MutationObserver(() => {
      if(activeVideo && !document.contains(activeVideo)) {
          activeVideo = null;
          hideAll();
      }
  });
  videoObserver.observe(document.documentElement, { childList: true, subtree: true });

  // --- 7. showAll / hide / updateState ---
  function showAll() {
      if(!activeVideo) return;
      clearTimeout(hideTimeout);

      const r = activeVideo.getBoundingClientRect();

      if(isThreads) {
          ui.ctrl.style.bottom    = '70px';
          ui.ctrl.style.left      = '50%';
          ui.ctrl.style.transform = 'translateX(-50%)';
          ui.ctrl.style.top       = '';
          ui.ctrl.classList.add('show');

          ui.blocker.style.display = 'block';
          ui.blocker.style.width   = r.width + 'px';
          ui.blocker.style.height  = '55px';
          ui.blocker.style.bottom  = '60px';
          ui.blocker.style.top     = '';
          ui.blocker.style.left    = r.left + 'px';
      } else {
          ui.blocker.style.display = 'block';
          ui.blocker.style.width   = r.width + 'px';
          ui.blocker.style.height  = '50px';
          ui.blocker.style.top     = (r.bottom - 60) + 'px';
          ui.blocker.style.left    = r.left + 'px';

          ui.ctrl.style.top        = (r.bottom - 70) + 'px';
          ui.ctrl.style.bottom     = '';
          ui.ctrl.style.left       = (r.left + r.width / 2) + 'px';
          ui.ctrl.style.transform  = 'translateX(-50%)';
          ui.ctrl.classList.add('show');
      }

      // ADD1: sync rotate button highlight with current video's rotation
      const deg = videoRotation.get(activeVideo) || 0;
      ui.rotate.classList.toggle('rotated', deg !== 0);

      updateState();
  }

  function startHide(delay) {
      if(isDragging) return;
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(hideAll, delay);
  }

  function hideAll() {
      ui.ctrl.classList.remove('show');
      ui.blocker.style.display = 'none';
  }

  function updateState() {
      if(!activeVideo) return;
      ui.play.innerHTML = activeVideo.paused ? svgs.play : svgs.pause;
      const isMuted = activeVideo.muted || activeVideo.volume === 0;
      ui.vol.innerHTML = isMuted ? svgs.mute : svgs.vol;
  }

  // --- 8. RAF Loop ---
  function loop() {
      if(isEnabled && activeVideo && ui.ctrl.classList.contains('show')) {

          // FIX7: Continuously strip `controls` attribute so native player never reappears
          if(activeVideo.hasAttribute('controls')) activeVideo.removeAttribute('controls');

          if(isThreads) {
              const r = activeVideo.getBoundingClientRect();
              ui.blocker.style.left  = r.left + 'px';
              ui.blocker.style.width = r.width + 'px';
          } else {
              const r = activeVideo.getBoundingClientRect();
              ui.blocker.style.top   = (r.bottom - 60) + 'px';
              ui.blocker.style.left  = r.left + 'px';
              ui.blocker.style.width = r.width + 'px';

              ui.ctrl.style.top  = (r.bottom - 70) + 'px';
              ui.ctrl.style.left = (r.left + r.width / 2) + 'px';
          }

          if(activeVideo.duration && !isDragging) {
              const pct = (activeVideo.currentTime / activeVideo.duration) * 100;
              ui.seek.value = pct;
              ui.seek.style.background = `linear-gradient(to right, #fff ${pct}%, rgba(255,255,255,0.25) ${pct}%)`;
              const m = Math.floor(activeVideo.currentTime / 60);
              const s = Math.floor(activeVideo.currentTime % 60);
              ui.time.innerText = `${m}:${s.toString().padStart(2, '0')}`;
          }
      }
      requestAnimationFrame(loop);
  }
  loop();

})();
