/* =====================================================================
   SegelComp – Bahnansicht „Ziel oben“ mit Lineal (wie Regattakoje)
   ---------------------------------------------------------------------
   Eigene Kartenansicht, die sich nach dem aktuellen Schenkel dreht:
   das nächste Ziel ist immer oben (Kreuz: Luvtonne oben, Vorwind: Lee-
   tonne oben). Die Ausrichtung folgt der Schenkelachse (vorige Tonne →
   aktive Tonne) und bleibt dadurch ruhig, auch wenn man kreuzt.
   Lineal: Linien alle 50 m QUER ZUM WIND, verankert an der aktiven
   Tonne – wer auf derselben Linie liegt, ist gleich weit in Luv.
   Beschriftung = Abstand in Windrichtung zur Tonne.
   ===================================================================== */
const LADDER_STEP = 50;
let courseView = false;
try{ courseView = localStorage.getItem('segelcomp_courseView') === '1'; }catch(e){}

function setCourseView(v){
  courseView = v;
  try{ localStorage.setItem('segelcomp_courseView', v ? '1' : '0'); }catch(e){}
  document.getElementById('courseViewChip').classList.toggle('active', v);
  canvasResetView();
  applyMapMode();
}
/* Punkt, von dem der aktuelle Schenkel ausgeht */
function legStartPoint(){
  if(course.seq.length && course.act > 0){
    const p = seqTarget(course.seq[course.act-1]);
    if(p) return p;
  }
  if(lineBoat && linePin) return { lat:(lineBoat.lat+linePin.lat)/2, lon:(lineBoat.lon+linePin.lon)/2 };
  return null;
}
function viewTarget(){
  const t = activeTarget();
  if(t) return t;
  return markPos ? { lat:markPos.lat, lon:markPos.lon, name:'Luvtonne', kind:'wind' } : null;
}
/* Richtung, die oben liegt: Schenkelachse, sonst Wind, sonst Norden */
function viewUpBearing(t){
  const s = legStartPoint();
  if(t && s && haversineDist(s, t) > 30) return bearing(s, t);
  if(t && pos && windRef!==null) return targetInfo(t).upwind ? windRef : (windRef+180)%360;
  return windRef!==null ? windRef : 0;
}
/* Abstand zur Tonne in Windrichtung (positiv = Tonne liegt in Luv) */
function windwardDistance(t){
  if(!t || !pos || windRef===null) return null;
  const d = toLocalXY(pos, t), r = windRef*Math.PI/180;
  return d.x*Math.sin(r) + d.y*Math.cos(r);
}

function drawCourseView(){
  if(mapCanvas.width < 2 || mapCanvas.height < 2) resizeMapCanvas();
  const ctx = mapCtx, W = mapCanvas.width, H = mapCanvas.height;
  if(W < 2 || H < 2) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = themeColor('--panel-2', '#123040'); ctx.fillRect(0,0,W,H);

  const t = viewTarget();
  const ref = t || pos;
  if(!ref){
    ctx.fillStyle = themeColor('--dim','#6F98A3'); ctx.font = `${13*dpr}px Inter, sans-serif`; ctx.textAlign='center';
    ctx.fillText('Keine Bahn und keine Position', W/2, H/2); return;
  }
  const up = viewUpBearing(t), ur = up*Math.PI/180;
  const U = { x:Math.sin(ur), y:Math.cos(ur) }, R = { x:Math.cos(ur), y:-Math.sin(ur) };
  const frame = p => { const l = toLocalXY(ref, p); return { a: l.x*U.x + l.y*U.y, b: l.x*R.x + l.y*R.y }; };

  // Ausschnitt: Boot, Ziel, Schenkelstart (+ Startlinie) – Ziel bleibt oben
  const pts = [];
  if(t) pts.push(frame(t));
  if(pos) pts.push(frame(pos));
  const s0 = legStartPoint(); if(s0) pts.push(frame(s0));
  if(pts.length < 2) pts.push({ a:-200, b:0 });
  let aMin = Math.min(...pts.map(p=>p.a)), aMax = Math.max(...pts.map(p=>p.a));
  let bMin = Math.min(...pts.map(p=>p.b)), bMax = Math.max(...pts.map(p=>p.b));
  const half = Math.max(40, (aMax-aMin)*0.1);
  aMin -= half; aMax += half*0.3; bMin -= half; bMax += half;
  // Bildränder freihalten: oben Werkzeugleiste + Ziel-Chip, unten Maßstab, rechts Zoomknöpfe
  const padT = 96*dpr, padB = 34*dpr, padL = 46*dpr, padR = 56*dpr;
  const iw = Math.max(40, W-padL-padR), ih = Math.max(40, H-padT-padB);
  const sc = Math.min(iw/(bMax-bMin), ih/(aMax-aMin)) * mapUserScale;
  const cx = padL + iw/2 - ((bMin+bMax)/2)*sc + mapUserOffset.x, cy = padT + ih/2 + ((aMin+aMax)/2)*sc + mapUserOffset.y;
  const toC = p => { const f = frame(p); return { cx: cx + f.b*sc, cy: cy - f.a*sc }; };

  // Lineal quer zum Wind, verankert an der Tonne
  if(windRef!==null && t){
    const wr = windRef*Math.PI/180, Wv = { x:Math.sin(wr), y:Math.cos(wr) };
    const Wa = Wv.x*U.x + Wv.y*U.y, Wb = Wv.x*R.x + Wv.y*R.y;         // Windrichtung im Bild
    const Pa = -Wb, Pb = Wa;                                           // senkrecht dazu
    const T = frame(t), diag = Math.hypot(W,H)/sc;
    const kMax = Math.ceil(diag/LADDER_STEP)+2;
    ctx.save();
    ctx.font = `600 ${10*dpr}px Inter, sans-serif`; ctx.textBaseline = 'middle';
    for(let k=-kMax; k<=kMax; k++){
      const ca = T.a - Wa*k*LADDER_STEP, cb = T.b - Wb*k*LADDER_STEP;   // k>0 = Richtung Lee
      const x1 = cx + (cb - Pb*diag)*sc, y1 = cy - (ca - Pa*diag)*sc;
      const x2 = cx + (cb + Pb*diag)*sc, y2 = cy - (ca + Pa*diag)*sc;
      ctx.strokeStyle = k===0 ? 'rgba(255,183,3,0.55)' : (k%2===0 ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.10)');
      ctx.lineWidth = (k===0 ? 2 : 1)*dpr;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      if(k!==0 && k%2===0){
        // Beschriftung am linken Bildrand
        const px = 6*dpr, dx = x2-x1, dy = y2-y1;
        if(Math.abs(dx) > 1){
          const tt = (px - x1)/dx, py = y1 + dy*tt;
          if(py > 100*dpr && py < H-40*dpr){
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.textAlign = 'left';
            ctx.fillText((Math.abs(k)*LADDER_STEP)+' m', px, py-7*dpr);
          }
        }
      }
    }
    ctx.restore();
  }

  // See
  if(lake){
    ctx.strokeStyle = '#219EBC'; ctx.lineWidth = 1.5*dpr; ctx.setLineDash([4*dpr,4*dpr]);
    for(const ring of [lake.outer, ...(lake.inner||[])]){
      ctx.beginPath(); ring.forEach((p,i)=>{ const c = toC({lat:p[0],lon:p[1]}); i ? ctx.lineTo(c.cx,c.cy) : ctx.moveTo(c.cx,c.cy); }); ctx.closePath(); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // Laylines der aktiven Tonne
  if(t){
    ctx.strokeStyle = 'rgba(230,57,70,0.85)'; ctx.lineWidth = 1.6*dpr; ctx.setLineDash([8*dpr,6*dpr]);
    laylineRays(t).forEach(r=>{ const a=toC(r[0]), b=toC(r[1]); ctx.beginPath(); ctx.moveTo(a.cx,a.cy); ctx.lineTo(b.cx,b.cy); ctx.stroke(); });
    ctx.setLineDash([]);
  }
  // Startlinie
  if(lineBoat && linePin){
    const a = toC(lineBoat), b = toC(linePin);
    ctx.setLineDash([6*dpr,5*dpr]); ctx.strokeStyle = themeColor('--text','#EAF3F2'); ctx.lineWidth = 2*dpr;
    ctx.beginPath(); ctx.moveTo(a.cx,a.cy); ctx.lineTo(b.cx,b.cy); ctx.stroke(); ctx.setLineDash([]);
    drawMarker(ctx, a.cx, a.cy, '#3A86FF', 'Boot', dpr); drawMarker(ctx, b.cx, b.cy, '#3A86FF', 'Pin', dpr);
  }
  // Track
  if(trackLog.length > 1){
    const maxSog = runMaxSog(trackLog);
    ctx.lineWidth = 3*dpr; ctx.lineCap = 'round';
    for(let i=1;i<trackLog.length;i++){
      const p0 = toC(trackLog[i-1]), p1 = toC(trackLog[i]);
      ctx.strokeStyle = speedToColor(((trackLog[i-1].sog||0)+(trackLog[i].sog||0))/2, maxSog);
      ctx.beginPath(); ctx.moveTo(p0.cx,p0.cy); ctx.lineTo(p1.cx,p1.cy); ctx.stroke();
    }
  }
  // Tonnen
  const act = course.seq[course.act];
  if(markPos){ const c = toC(markPos); if(act==='wind'){ ctx.strokeStyle='#fff'; ctx.lineWidth=2*dpr; ctx.beginPath(); ctx.arc(c.cx,c.cy,9*dpr,0,7); ctx.stroke(); } drawMarker(ctx, c.cx, c.cy, '#FFB703', 'Luv', dpr); }
  course.marks.forEach(m=>{
    const c = toC(m), isAct = act===m.id || (act==='gate' && m.kind==='gate');
    if(isAct){ ctx.strokeStyle='#fff'; ctx.lineWidth=2*dpr; ctx.beginPath(); ctx.arc(c.cx,c.cy,9*dpr,0,7); ctx.stroke(); }
    drawMarker(ctx, c.cx, c.cy, MARK_COLORS[m.kind]||'#E63946', m.name, dpr);
  });
  // Peillinie Boot → Ziel
  if(pos && t){
    const a = toC(pos), b = toC(t);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2*dpr; ctx.setLineDash([2*dpr,6*dpr]);
    ctx.beginPath(); ctx.moveTo(a.cx,a.cy); ctx.lineTo(b.cx,b.cy); ctx.stroke(); ctx.setLineDash([]);
  }
  // Eigenes Boot
  if(pos){
    const b = toC(pos), hdg = referenceHeading();
    ctx.save(); ctx.translate(b.cx, b.cy); if(hdg!==null) ctx.rotate((hdg-up)*Math.PI/180);
    ctx.fillStyle = themeColor('--amber','#FFB703'); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1*dpr;
    ctx.beginPath(); ctx.moveTo(0,-11*dpr); ctx.lineTo(7*dpr,9*dpr); ctx.lineTo(-7*dpr,9*dpr); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // Windpfeil + Nordpfeil (oben links unter der Werkzeugleiste)
  const ox = W - 130*dpr, oy = H - 24*dpr;
  if(windRef!==null){
    ctx.save(); ctx.translate(ox, oy); ctx.rotate((windRef-up)*Math.PI/180); // Pfeil zeigt, wohin der Wind weht
    ctx.strokeStyle = '#3A86FF'; ctx.fillStyle = '#3A86FF'; ctx.lineWidth = 3*dpr;
    ctx.beginPath(); ctx.moveTo(0,-11*dpr); ctx.lineTo(0,8*dpr); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,13*dpr); ctx.lineTo(-5*dpr,5*dpr); ctx.lineTo(5*dpr,5*dpr); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.save(); ctx.translate(ox+30*dpr, oy); ctx.rotate(-up*Math.PI/180);
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = `700 ${10*dpr}px Inter, sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('N', 0, -9*dpr); ctx.beginPath(); ctx.moveTo(0,-3*dpr); ctx.lineTo(3.5*dpr,6*dpr); ctx.lineTo(-3.5*dpr,6*dpr); ctx.closePath(); ctx.fill();
  ctx.restore();

  drawScaleBar(sc, dpr, W, H);
}
/* Text für den Navigations-Chip in der Bahnansicht */
function courseViewChipText(t, info){
  const wd = windwardDistance(t);
  let s = `→ ${t.name} ${Math.round(info.dist)} m`;
  if(wd!==null && (t.kind==='wind' || t.kind==='lee' || t.kind==='gate' || t.kind==='offset'))
    s += ` · ${Math.round(Math.abs(wd))} m ${wd>=0?'in Luv':'in Lee'} (${(Math.abs(wd)/LADDER_STEP).toFixed(1).replace('.',',')} Sprossen)`;
  return s;
}
function courseViewInit(){
  document.getElementById('courseViewChip').classList.toggle('active', courseView);
  document.getElementById('courseViewChip').addEventListener('click', ()=>setCourseView(!courseView));
}
