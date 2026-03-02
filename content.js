// Threads Video Pro - Content Script v14.3
//
// ROOT CAUSE of IG expanded post showing no controller:
//   v14.2 hides controller whenever cursor is inside ANY [role="dialog"].
//   But IG's expanded post view IS a dialog — the video is inside it.
//   So we were hiding the controller exactly when the user is watching the video.
//
// Fix:
//   Distinguish between two kinds of modals:
//     A) Small share/action sheet (< 500px wide) → hide controller (cursor is on UI, not video)
//     B) Large expanded post view (≥ 500px wide) → do NOT hide; let pickVideo() run normally
//
// Also removed the no-src filter from pickVideo() — IG videos use blob URLs
// which appear as non-empty currentSrc but the attribute v.src may be empty.

(function () {
  if (window.TVP_INSTANCE) return;
  window.TVP_INSTANCE = true;

  const IS_IG      = location.hostname.includes('instagram.com');
  const IS_THREADS = location.hostname.includes('threads');
  let   enabled    = true;

  // ── Hide native controls ─────────────────────────────────────────────────────
  document.documentElement.appendChild(
    Object.assign(document.createElement('style'), { textContent: `
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
        display:none!important; opacity:0!important;
        visibility:hidden!important; pointer-events:none!important;
        width:0!important; height:0!important;
      }`
    })
  );

  // ── Shadow host ──────────────────────────────────────────────────────────────
  const host = document.createElement('div');
  Object.assign(host.style, {
    position:'fixed', top:'0', left:'0',
    width:'0', height:'0', overflow:'visible',
    zIndex:'2147483647', pointerEvents:'none',
  });
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode:'open' });

  // ── Styles ───────────────────────────────────────────────────────────────────
  shadow.appendChild(Object.assign(document.createElement('style'), { textContent:`
    * { box-sizing:border-box; }
    :host { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    #ctrl {
      position:fixed; display:flex; align-items:center; gap:10px;
      padding:0 14px; height:42px; border-radius:999px;
      background:rgba(8,8,8,0.90); backdrop-filter:blur(14px);
      border:1px solid rgba(255,255,255,0.14);
      box-shadow:0 6px 28px rgba(0,0,0,0.65);
      pointer-events:auto; user-select:none; z-index:9999;
      opacity:0; visibility:hidden; transition:opacity 0.15s,visibility 0.15s;
    }
    #ctrl.on { opacity:1; visibility:visible; }
    button {
      flex-shrink:0; width:26px; height:26px;
      display:flex; align-items:center; justify-content:center;
      background:none; border:none; color:#ccc; cursor:pointer;
      border-radius:50%; padding:0; transition:background 0.1s,color 0.1s;
    }
    button:hover  { background:rgba(255,255,255,0.18); color:#fff; }
    button:active { transform:scale(0.88); }
    button svg    { width:17px; height:17px; }
    .lbl {
      flex-shrink:0; font-size:11px; font-weight:500;
      font-variant-numeric:tabular-nums; color:#aaa; min-width:30px; text-align:center;
    }
    .trk { flex:1; min-width:40px; height:42px; display:flex; align-items:center; }
    input[type=range] {
      -webkit-appearance:none; width:100%; height:3px;
      background:rgba(255,255,255,0.22); border-radius:2px; outline:none; cursor:pointer;
    }
    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance:none; width:11px; height:11px;
      border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.5);
    }
    select {
      flex-shrink:0; background:rgba(255,255,255,0.09); color:#ddd;
      border:none; border-radius:4px; padding:1px 4px;
      font-size:11px; font-weight:700; height:22px; cursor:pointer; outline:none;
    }
    select:hover { background:rgba(255,255,255,0.22); }
    select option { background:#111; color:#fff; }
  `}));

  // ── SVGs ─────────────────────────────────────────────────────────────────────
  const S = {
    play:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`,
    vol:   `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`,
    mute:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`,
    rot:   `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45z"/></svg>`,
  };
  const mkBtn = (id,k) => Object.assign(document.createElement('button'), {id, innerHTML:S[k]});

  // ── Build UI ──────────────────────────────────────────────────────────────────
  const ctrl  = Object.assign(document.createElement('div'), {id:'ctrl'});
  const bPlay = mkBtn('bPlay','play');
  const lTime = Object.assign(document.createElement('div'), {className:'lbl', textContent:'0:00'});
  const trkW  = Object.assign(document.createElement('div'), {className:'trk'});
  const seek  = Object.assign(document.createElement('input'),
    {type:'range', min:'0', max:'100', step:'0.1', value:'0'});
  trkW.appendChild(seek);
  const selR = document.createElement('select');
  [['0.5','0.5x'],['1','1x'],['1.5','1.5x'],['2','2x'],['3','3x']].forEach(([v,t])=>{
    const o = Object.assign(document.createElement('option'), {value:v, textContent:t});
    if(v==='1') o.selected=true; selR.appendChild(o);
  });
  const bVol = mkBtn('bVol','vol');
  const bRot = mkBtn('bRot','rot');
  [bPlay,lTime,trkW,selR,bVol,bRot].forEach(el=>ctrl.appendChild(el));
  shadow.appendChild(ctrl);

  // ── State ─────────────────────────────────────────────────────────────────────
  let vid=null, dragging=false, hideTimer=null;
  let cursorX=0, cursorY=0, onCtrl=false, lastFoundVid=null;
  let savedMuted=false, savedVol=1;
  const rotMap=new WeakMap(), bound=new WeakSet();
  const HIDE_MS=750;

  // ── Settings ──────────────────────────────────────────────────────────────────
  function applySettings(s) {
    enabled = IS_IG ? s.enableInstagram!==false : s.enableThreads!==false;
    host.style.display = enabled ? '' : 'none';
    if(!enabled) doHide();
  }
  chrome.storage.sync.get(['enableThreads','enableInstagram'], applySettings);
  chrome.runtime.onMessage.addListener(m=>{ if(m.type==='SETTINGS_UPDATE') applySettings(m.settings); });

  // ── Show / Hide ───────────────────────────────────────────────────────────────
  function doShow(v) {
    clearTimeout(hideTimer);
    if(vid!==v) {
      vid=v;
      if(!bound.has(vid)) {
        vid.addEventListener('play', syncUI);
        vid.addEventListener('pause', syncUI);
        vid.addEventListener('volumechange', syncUI);
        bound.add(vid);
      }
    }
    place(); ctrl.classList.add('on'); syncUI();
  }
  function doHide() { ctrl.classList.remove('on'); }
  function schedHide() {
    if(dragging) return;
    clearTimeout(hideTimer);
    hideTimer=setTimeout(doHide, HIDE_MS);
  }
  ctrl.addEventListener('mouseenter',()=>{ onCtrl=true;  clearTimeout(hideTimer); });
  ctrl.addEventListener('mouseleave',()=>{ onCtrl=false; schedHide(); });

  // ── Placement ─────────────────────────────────────────────────────────────────
  const MAX_W=400, SIDE_IN=20, BOT_OFF=10;
  function place() {
    if(!vid) return;
    const r=vid.getBoundingClientRect();
    const vw=window.innerWidth, vh=window.innerHeight;
    let w=r.width-SIDE_IN*2;
    if(w>MAX_W) w=MAX_W;
    if(w<120) w=Math.min(r.width,MAX_W);
    const cx=r.left+r.width/2;
    const left=Math.max(4,Math.min(vw-4-w,cx-w/2));
    const bot=Math.max(4,vh-r.bottom+BOT_OFF);
    Object.assign(ctrl.style,{left:left+'px',width:w+'px',bottom:bot+'px',top:''});
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────────
  // Returns a small share/action sheet that cursor is inside, or null.
  // We IGNORE large expanded-post dialogs (they contain the video we want to control).
  const SMALL_MODAL_MAX_W = 500; // px — share sheets are narrow; post views are wide

  function smallModalAtCursor() {
    const modals = document.querySelectorAll('[role="dialog"],[aria-modal="true"]');
    for(const m of modals) {
      const r = m.getBoundingClientRect();
      if(r.width===0||r.height===0) continue;
      if(r.width >= SMALL_MODAL_MAX_W) continue; // large = expanded post, skip
      if(cursorX>=r.left&&cursorX<=r.right&&cursorY>=r.top&&cursorY<=r.bottom) return m;
    }
    return null;
  }

  // Is any modal open (regardless of size)? Used to skip carousel slide check.
  function anyModalOpen() {
    const modals = document.querySelectorAll('[role="dialog"],[aria-modal="true"]');
    for(const m of modals) {
      const r = m.getBoundingClientRect();
      if(r.width>0&&r.height>0) return true;
    }
    return false;
  }

  // ── IG carousel photo slide check ────────────────────────────────────────────
  // Only applies when NO modal is open (expanded post has its own full layout).
  function isIGPhotoSlide(mx, my) {
    if(!IS_IG) return false;
    if(anyModalOpen()) return false; // modal handles its own content
    try {
      const els = document.elementsFromPoint(mx, my);
      for(const el of els) {
        const role = el.getAttribute('role');
        if(el.tagName==='LI' && (role==='presentation'||role==='tabpanel')) {
          if(!el.querySelector('video')) return true;
        }
      }
    } catch(e){}
    return false;
  }

  // ── Threads carousel thumb filter ────────────────────────────────────────────
  const TH_THUMB_MAX_W = 280;
  function isThreadsThumb(v) {
    if(!IS_THREADS) return false;
    return v.getBoundingClientRect().width < TH_THUMB_MAX_W;
  }

  // ── Pick best video under cursor ──────────────────────────────────────────────
  function pickVideo(mx, my) {
    const hits=[];
    for(const v of document.getElementsByTagName('video')) {
      const r=v.getBoundingClientRect();
      if(r.width<80||r.height<60) continue;
      if(r.bottom<0||r.top>window.innerHeight) continue;
      if(r.right<0||r.left>window.innerWidth) continue;
      if(mx<r.left||mx>r.right||my<r.top||my>r.bottom) continue;
      if(isThreadsThumb(v)) continue;
      // Removed no-src check — IG uses blob URLs, v.src attribute may be empty
      hits.push({v, area:r.width*r.height});
    }
    if(!hits.length) return null;
    const playing=hits.filter(h=>!h.v.paused&&h.v.currentTime>0);
    if(playing.length===1) return playing[0].v;
    if(playing.length>1)   return playing.sort((a,b)=>b.area-a.area)[0].v;
    const played=hits.filter(h=>h.v.currentTime>0);
    if(played.length>0)    return played.sort((a,b)=>b.area-a.area)[0].v;
    const hasDur=hits.filter(h=>h.v.duration>0);
    if(hasDur.length>0)    return hasDur.sort((a,b)=>b.area-a.area)[0].v;
    return hits.sort((a,b)=>b.area-a.area)[0].v;
  }

  // ── Mouse tracking ────────────────────────────────────────────────────────────
  document.addEventListener('mousemove', e=>{
    cursorX=e.clientX; cursorY=e.clientY;
    if(!enabled||dragging) return;

    // Cursor inside a SMALL modal (share sheet) → hide
    if(smallModalAtCursor()) {
      if(lastFoundVid!==null){ lastFoundVid=null; schedHide(); }
      return;
    }

    // IG carousel photo slide → hide
    if(isIGPhotoSlide(cursorX,cursorY)) {
      if(lastFoundVid!==null){ lastFoundVid=null; schedHide(); }
      return;
    }

    const found=pickVideo(cursorX,cursorY);
    if(found) {
      lastFoundVid=found;
      doShow(found);
    } else {
      if(lastFoundVid!==null) {
        lastFoundVid=null;
        if(!onCtrl) schedHide();
      }
    }
  },{passive:true});

  // SPA cleanup
  new MutationObserver(()=>{
    if(vid&&!document.contains(vid)){ vid=null; doHide(); }
  }).observe(document.documentElement,{childList:true,subtree:true});

  // ── Buttons ───────────────────────────────────────────────────────────────────
  ctrl.addEventListener('mousedown',  e=>{ e.stopPropagation(); e.stopImmediatePropagation(); });
  ctrl.addEventListener('click',      e=>{ e.stopPropagation(); e.stopImmediatePropagation(); });
  ctrl.addEventListener('pointerdown',e=>{ e.stopPropagation(); e.stopImmediatePropagation(); });

  bPlay.addEventListener('click', e=>{
    e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
    if(!vid) return;
    vid.paused ? vid.play() : vid.pause(); syncUI();
  });
  bVol.addEventListener('click', e=>{
    e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
    if(!vid) return;
    if(vid.muted||vid.volume===0){ vid.muted=false; vid.volume=savedVol>0?savedVol:1; }
    else { savedVol=vid.volume; vid.muted=true; }
    syncUI();
  });
  selR.addEventListener('mousedown', e=>e.stopPropagation());
  selR.addEventListener('change', e=>{ if(vid) vid.playbackRate=parseFloat(e.target.value); });
  bRot.addEventListener('click', e=>{
    e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
    if(!vid) return;
    const deg=((rotMap.get(vid)||0)+90)%360; rotMap.set(vid,deg);
    const r=vid.getBoundingClientRect();
    let t=`rotate(${deg}deg)`;
    if(deg===90||deg===270){ const sc=Math.min(r.width/r.height,r.height/r.width); t=`rotate(${deg}deg) scale(${sc})`; }
    vid.style.transform=t; vid.style.transformOrigin='center center';
  });

  // ── Seek drag ─────────────────────────────────────────────────────────────────
  // IG forces muted=true whenever pause() is called — unfixable via muted setter.
  // Final solution: never pause() at all. Just update currentTime while playing.
  // No pause = no IG mute intervention. Video keeps its exact audio state throughout.

  function scrubTo(e) {
    if(!vid?.duration) return;
    const r   = seek.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    vid.currentTime = pct * vid.duration;
    seek.value      = pct * 100;
    fillTrack(pct * 100);
  }

  function endDrag() {
    if(!dragging || !vid) return;
    dragging = false;
    syncUI();
  }

  seek.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
    if(!vid) return;
    dragging = true;
    scrubTo(e);
    seek.setPointerCapture(e.pointerId);
    clearTimeout(hideTimer);
  });

  seek.addEventListener('pointermove', e => {
    if(!dragging) return;
    scrubTo(e);
  });

  seek.addEventListener('pointerup',     endDrag);
  seek.addEventListener('pointercancel', endDrag);

  // ── UI ────────────────────────────────────────────────────────────────────────
  function fillTrack(pct){ seek.style.background=`linear-gradient(to right,#fff ${pct}%,rgba(255,255,255,.22) ${pct}%)`; }
  function syncUI(){
    if(!vid) return;
    bPlay.innerHTML=S[vid.paused?'play':'pause'];
    let m; try{m=vid.muted;}catch(e){m=savedMuted;}
    bVol.innerHTML=S[(m||vid.volume===0)?'mute':'vol'];
  }

  // ── RAF ───────────────────────────────────────────────────────────────────────
  (function loop(){
    if(enabled&&vid&&ctrl.classList.contains('on')){
      if(vid.hasAttribute('controls')) vid.removeAttribute('controls');
      place();
      if(vid.duration&&!dragging){
        const pct=(vid.currentTime/vid.duration)*100;
        seek.value=pct; fillTrack(pct);
        const mm=Math.floor(vid.currentTime/60), ss=Math.floor(vid.currentTime%60);
        lTime.textContent=`${mm}:${ss.toString().padStart(2,'0')}`;
      }
    }
    requestAnimationFrame(loop);
  })();

})();
