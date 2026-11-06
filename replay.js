/* =====================================================================
   SegelComp – Replay (replay.js)
   Spielt einen gespeicherten Lauf als Animation ab: Track, Boot,
   Windpfeil, SOG, TWA und Leistung in % (SOG / Polare).
   Windpfeil nur bei Läufen mit gespeicherter Windrichtung (wd).
   ===================================================================== */
(function(){
  const SPEEDS = [5, 20, 60];
  let ov, cv, ctx, bar, slider, playBtn, spdBtn;
  let pts, ts, t0, t1, pt, playing, spdI, raf, last, P, run;

  function build(){
    ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#071822;display:none;flex-direction:column;color:#fff;font:600 14px system-ui,sans-serif;padding-top:env(safe-area-inset-top,0)';
    ov.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;gap:10px">
        <span id="rpTitle" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis"></span>
        <span id="rpClose" style="padding:6px 14px;border:1px solid #567;border-radius:8px">✕</span></div>
      <canvas id="rpCv" style="flex:1;min-height:0;width:100%"></canvas>
      <div id="rpBar" style="padding:8px 14px;text-align:center;min-height:20px"></div>
      <div style="display:flex;align-items:center;gap:12px;padding:6px 14px calc(14px + env(safe-area-inset-bottom,0))">
        <span id="rpPlay" style="padding:8px 16px;border:1px solid #567;border-radius:8px;min-width:24px;text-align:center">▶</span>
        <input id="rpSl" type="range" min="0" max="1000" value="0" style="flex:1">
        <span id="rpSpd" style="padding:8px 12px;border:1px solid #567;border-radius:8px"></span></div>`;
    document.body.appendChild(ov);
    cv = ov.querySelector('#rpCv'); ctx = cv.getContext('2d'); bar = ov.querySelector('#rpBar');
    slider = ov.querySelector('#rpSl'); playBtn = ov.querySelector('#rpPlay'); spdBtn = ov.querySelector('#rpSpd');
    ov.querySelector('#rpClose').onclick = close;
    playBtn.onclick = ()=> setPlay(!playing);
    spdBtn.onclick = ()=>{ spdI = (spdI+1)%SPEEDS.length; spdBtn.textContent = '×'+SPEEDS[spdI]; };
    slider.oninput = ()=>{ pt = t0 + (t1-t0)*slider.value/1000; draw(); };
    window.addEventListener('resize', ()=>{ if(ov.style.display!=='none') fit(); });
  }

  function fit(){
    const r = cv.getBoundingClientRect(), d = window.devicePixelRatio||1;
    cv.width = r.width*d; cv.height = r.height*d; ctx.setTransform(d,0,0,d,0,0);
    const lat0 = pts.reduce((s,p)=>s+p.lat,0)/pts.length, lon0 = pts[0].lon, k = Math.cos(lat0*Math.PI/180);
    const xy = pts.map(p=>[(p.lon-lon0)*k, -(p.lat-lat0)]);
    const xs = xy.map(a=>a[0]), ys = xy.map(a=>a[1]);
    const mnx=Math.min(...xs), mxx=Math.max(...xs), mny=Math.min(...ys), mxy=Math.max(...ys);
    const pad = 30, sc = Math.min((r.width-2*pad)/Math.max(mxx-mnx,1e-6), (r.height-2*pad)/Math.max(mxy-mny,1e-6));
    P = { xy, f:(i)=>[pad+(xy[i][0]-mnx)*sc + (r.width-2*pad-(mxx-mnx)*sc)/2, pad+(xy[i][1]-mny)*sc + (r.height-2*pad-(mxy-mny)*sc)/2],
          k, lat0, lon0, mnx, mny, sc, w:r.width, h:r.height, pad, ox:(r.width-2*pad-(mxx-mnx)*sc)/2, oy:(r.height-2*pad-(mxy-mny)*sc)/2 };
    draw();
  }
  function scr(lat, lon){ return [P.pad+((lon-P.lon0)*P.k-P.mnx)*P.sc+P.ox, P.pad+(-(lat-P.lat0)-P.mny)*P.sc+P.oy]; }

  function idxAt(t){ let lo=0, hi=ts.length-1; while(lo<hi){ const m=(lo+hi+1)>>1; if(ts[m]<=t) lo=m; else hi=m-1; } return lo; }

  function draw(){
    if(!P) return;
    ctx.clearRect(0,0,P.w,P.h);
    const i = idxAt(pt), maxS = Math.max(4, ...pts.map(p=>p.sog||0));
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.beginPath();
    pts.forEach((p,j)=>{ const [x,y]=P.f(j); j?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.stroke();
    ctx.lineWidth = 4; ctx.lineCap = 'round';
    for(let j=1;j<=i;j++){
      const a=P.f(j-1), b=P.f(j), s=((pts[j].sog||0)+(pts[j-1].sog||0))/2;
      ctx.strokeStyle = (typeof speedToColor==='function') ? speedToColor(s, maxS) : 'hsl('+Math.round(220-s/maxS*180)+',90%,55%)';
      ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
    }
    const p = pts[i], q = pts[Math.min(i+1,pts.length-1)];
    const f = q.t!==p.t ? Math.min(1,(pt-ts[i])/(ts[Math.min(i+1,ts.length-1)]-ts[i]||1)) : 0;
    const [x,y] = scr(p.lat+(q.lat-p.lat)*f, p.lon+(q.lon-p.lon)*f);
    ctx.save(); ctx.translate(x,y); ctx.rotate((p.cog||0)*Math.PI/180);
    ctx.fillStyle='#FFB300'; ctx.beginPath(); ctx.moveTo(0,-11); ctx.lineTo(7,9); ctx.lineTo(-7,9); ctx.closePath(); ctx.fill(); ctx.restore();
    if(p.wd!=null){   // Windpfeil: zeigt, wohin der Wind weht
      ctx.save(); ctx.translate(40,44); ctx.rotate((p.wd+180)*Math.PI/180);
      ctx.strokeStyle='#4aa3ff'; ctx.fillStyle='#4aa3ff'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(0,-20); ctx.lineTo(0,18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,22); ctx.lineTo(-7,10); ctx.lineTo(7,10); ctx.closePath(); ctx.fill(); ctx.restore();
      ctx.fillStyle='#9bb'; ctx.font='600 12px system-ui'; ctx.fillText(Math.round(p.wd)+'°'+(p.tws!=null?' · '+p.tws+' kn':''), 12, 84);
    }
    const bp = (typeof currentPolar==='function') ? currentPolar() : null;
    const tgt = (bp && p.twa!=null && p.tws!=null) ? polarSpeed(bp, p.tws, p.twa, p.twa>=110) : null;
    const el = Math.round((pt-t0)/1000), mm = String(Math.floor(el/60)).padStart(2,'0'), ss = String(el%60).padStart(2,'0');
    bar.textContent = mm+':'+ss+'  ·  SOG '+(p.sog!=null?p.sog.toFixed(1):'–')+' kn'
      + (p.twa!=null ? '  ·  TWA '+p.twa+'°' : '') + (tgt>0.3 && p.sog!=null ? '  ·  '+Math.round(p.sog/tgt*100)+' %' : '');
    slider.value = Math.round((pt-t0)/Math.max(1,t1-t0)*1000);
  }

  function setPlay(on){
    playing = on; playBtn.textContent = on ? '⏸' : '▶'; cancelAnimationFrame(raf);
    if(!on) return;
    if(pt >= t1) pt = t0;
    last = performance.now();
    const step = (now)=>{ pt = Math.min(t1, pt + (now-last)*SPEEDS[spdI]); last = now; draw(); if(pt>=t1) return setPlay(false); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }
  function close(){ setPlay(false); ov.style.display = 'none'; }

  window.replayOpen = function(id){
    const r = (typeof getSavedRuns==='function' ? getSavedRuns() : []).find(x=>x.id===id);
    if(!r || r.track.length < 2){ if(typeof showToast==='function') showToast('Zu wenig Trackpunkte für ein Replay.'); return; }
    if(!ov) build();
    run = r; pts = r.track; ts = pts.map(p=>Date.parse(p.t)); t0 = ts[0]; t1 = ts[ts.length-1]; pt = t0; spdI = 0;
    spdBtn.textContent = '×'+SPEEDS[0]; ov.querySelector('#rpTitle').textContent = r.name;
    ov.style.display = 'flex'; fit(); setPlay(true);
  };
  document.addEventListener('click', e=>{
    const b = e.target.closest && e.target.closest('[data-action="replay-run"]');
    if(b) replayOpen(b.dataset.id);
  });
})();
