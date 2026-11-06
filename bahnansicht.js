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
  let up = viewUpBearing(t), ur = up*Math.PI/180, ref0 = ref;
  let U = { x:Math.sin(ur), y:Math.cos(ur) }, R = { x:Math.cos(ur), y:-Math.sin(ur) };
  let frame = p => { const l = toLocalXY(ref0, p); return { a: l.x*U.x + l.y*U.y, b: l.x*R.x + l.y*R.y }; };

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
  const padT = cvTopPad()*dpr, padB = 34*dpr, padL = 46*dpr, padR = 56*dpr;
  const iw = Math.max(40, W-padL-padR), ih = Math.max(40, H-padT-padB);
  let sc = Math.min(iw/(bMax-bMin), ih/(aMax-aMin)) * mapUserScale;
  let cx = padL + iw/2 - ((bMin+bMax)/2)*sc + mapUserOffset.x, cy = padT + ih/2 + ((aMin+aMax)/2)*sc + mapUserOffset.y;
  // Während man die Bahn zieht oder dreht, bleibt die Ansicht stehen – sonst liefe sie mit
  if(cvDrag && cvDrag.frozen){
    ({ ref:ref0, up, sc, cx, cy } = cvDrag.frozen); ur = up*Math.PI/180;
    U = { x:Math.sin(ur), y:Math.cos(ur) }; R = { x:Math.cos(ur), y:-Math.sin(ur) };
    frame = p => { const l = toLocalXY(ref0, p); return { a: l.x*U.x + l.y*U.y, b: l.x*R.x + l.y*R.y }; };
  }
  cvLast = { ref:ref0, up, sc, cx, cy, dpr, C:{ x: padL + iw/2, y: padT + ih/2 } };
  const toC = p => { const f = frame(p); return { cx: cx + f.b*sc, cy: cy - f.a*sc }; };

  // Dezente Windpfeile (Richtung aus der Windquelle, z. B. Internet), fließen mit dem Wind
  if(windRef!==null && windArrowsEnabled) drawCvWind(ctx, W, H, dpr, up);

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
      ctx.strokeStyle = k===0 ? cvGold() : (k%2===0 ? cvInk(0.24) : cvInk(0.10));
      ctx.lineWidth = (k===0 ? 2 : 1)*dpr;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      if(k!==0 && k%2===0){
        // Beschriftung am linken Bildrand
        const px = 6*dpr, dx = x2-x1, dy = y2-y1;
        if(Math.abs(dx) > 1){
          const tt = (px - x1)/dx, py = y1 + dy*tt;
          if(py > 100*dpr && py < H-40*dpr){
            ctx.fillStyle = cvInk(0.55); ctx.textAlign = 'left';
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
    // Startlinienvorteil: welches Ende liegt wie viele Meter weiter in Luv?
    if(windRef!==null){
      const wr = windRef*Math.PI/180, d = toLocalXY(lineBoat, linePin);
      const adv = d.x*Math.sin(wr) + d.y*Math.cos(wr);            // > 0: Pin liegt in Luv
      if(Math.abs(adv) >= 2){
        const fav = adv > 0 ? b : a, name = adv > 0 ? 'Pin' : 'Boot';
        const txt = `▲ ${name} ${Math.round(Math.abs(adv))} m in Luv`;
        ctx.font = `700 ${11*dpr}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const w = ctx.measureText(txt).width + 12*dpr, y = fav.cy + 20*dpr;
        ctx.fillStyle = 'rgba(29,185,84,0.9)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(fav.cx-w/2, y-10*dpr, w, 20*dpr, 8*dpr) : ctx.rect(fav.cx-w/2, y-10*dpr, w, 20*dpr); ctx.fill();
        ctx.fillStyle = '#071822'; ctx.fillText(txt, fav.cx, y);
      } else {
        ctx.font = `600 ${10.5*dpr}px Inter, sans-serif`; ctx.textAlign='center'; ctx.fillStyle = cvInk(0.7);
        ctx.fillText('Linie quadratisch zum Wind', (a.cx+b.cx)/2, (a.cy+b.cy)/2 + 18*dpr);
      }
    }
  }
  // Track
  if(showTrack && trackLog.length > 1){
    const maxSog = runMaxSog(trackLog);
    ctx.lineWidth = 3*dpr; ctx.lineCap = 'round';
    for(let i=1;i<trackLog.length;i++){
      const p0 = toC(trackLog[i-1]), p1 = toC(trackLog[i]);
      ctx.strokeStyle = speedToColor(((trackLog[i-1].sog||0)+(trackLog[i].sog||0))/2, maxSog);
      ctx.beginPath(); ctx.moveTo(p0.cx,p0.cy); ctx.lineTo(p1.cx,p1.cy); ctx.stroke();
    }
  }
  // Trimmskala um das Boot: hängt nur an Wind und Kurs, nicht an der Tonne
  const trim = pos ? trimState() : null;
  const trimR = Math.max(58*dpr, Math.min(96*dpr, Math.min(W,H)*0.15));
  if(trim) drawTrimRing(ctx, toC(pos), trimR, up, trim, dpr);
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
    ctx.strokeStyle = cvInk(0.6); ctx.lineWidth = 1.2*dpr; ctx.setLineDash([2*dpr,6*dpr]);
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
  if(trim) drawTrimPill(ctx, toC(pos), trimR, trim, dpr, H);
  // Windpfeil + Nordpfeil (oben links unter der Werkzeugleiste)
  const ox = W - 130*dpr, oy = H - 24*dpr;
  if(windRef!==null){
    ctx.save(); ctx.translate(ox, oy); ctx.rotate((windRef-up)*Math.PI/180); // Pfeil zeigt, wohin der Wind weht
    ctx.strokeStyle = '#3A86FF'; ctx.fillStyle = '#3A86FF'; ctx.lineWidth = 3*dpr;
    ctx.beginPath(); ctx.moveTo(0,-11*dpr); ctx.lineTo(0,8*dpr); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,13*dpr); ctx.lineTo(-5*dpr,5*dpr); ctx.lineTo(5*dpr,5*dpr); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  if(windRef!==null){
    ctx.fillStyle = cvInk(0.75); ctx.font = `600 ${10.5*dpr}px Inter, sans-serif`; ctx.textAlign='right'; ctx.textBaseline='middle';
    const src = windSource==='live' ? 'Internet' : windSource==='manual' ? 'manuell' : 'gepingt';
    ctx.fillText(`${Math.round(windRef)}° · ${Math.round(currentTWS())} kn · ${src}`, ox - 14*dpr, oy);
  }
  ctx.save(); ctx.translate(ox+30*dpr, oy); ctx.rotate(-up*Math.PI/180);
  ctx.fillStyle = cvInk(0.75); ctx.font = `700 ${10*dpr}px Inter, sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('N', 0, -9*dpr); ctx.beginPath(); ctx.moveTo(0,-3*dpr); ctx.lineTo(3.5*dpr,6*dpr); ctx.lineTo(-3.5*dpr,6*dpr); ctx.closePath(); ctx.fill();
  ctx.restore();

  // Bearbeiten: Griffe zum Verschieben (✥) und Drehen (⟳)
  if(mapToolMode==='bahn'){
    const c = courseCenter();
    if(c){
      // Drehgriff seitlich neben dem Mittelgriff – oben verdecken Werkzeugleiste und Ziel-Chip
      const m = toC(c), off = 104*dpr, r = { cx: m.cx + off > W - 70*dpr ? m.cx - off : m.cx + off, cy: m.cy };
      cvLast.handles = { move:m, rot:r };
      ctx.strokeStyle = 'rgba(255,183,3,0.8)'; ctx.lineWidth = 2*dpr; ctx.setLineDash([4*dpr,6*dpr]);
      ctx.beginPath(); ctx.moveTo(m.cx,m.cy); ctx.lineTo(r.cx,r.cy); ctx.stroke(); ctx.setLineDash([]);
      const knob = (q, col, fg, sym, rad)=>{ ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3*dpr; ctx.beginPath(); ctx.arc(q.cx,q.cy,rad*dpr,0,7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = fg; ctx.font = `800 ${rad*1.1*dpr}px Inter, sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(sym, q.cx, q.cy+1*dpr); };
      knob(m, 'rgba(255,183,3,0.95)', '#071822', '✥', 21);
      knob(r, 'rgba(58,134,255,0.95)', '#fff', '⟳', 18);
    }
  } else if(cvLast) cvLast.handles = null;

  drawScaleBar(sc, dpr, W, H);
}
/* ---------- Trimmskala um das Boot ----------
   Wie in der Regattakoje: ein Farbbogen um das Boot zeigt, in welchem Windwinkel
   man gerade wie schnell ist. Er nutzt dieselbe Zonenlogik wie die Trimm-Seite
   (classifyZone): Rot = zu dicht, Grün = Sweet Spot, Orange = zu tief usw.
   Der Bogen liegt auf dem Bug, auf dem man segelt (Wind von Steuerbord oder
   Backbord) und sitzt um den Soll-Winkel – am Wind um den Am-Wind-Winkel,
   sonst um den Vorwind-Winkel. Der weiße Strich ist der aktuelle Kurs. */
let trimRing = true, trimMode = 'up';
try{ trimRing = localStorage.getItem('segelcomp_trimRing') !== '0'; }catch(e){}
const TRIM_TEXT = { red:'#fff', purple:'#fff', blue:'#fff', green:'#071822', orange:'#071822', teal:'#071822' };

function trimState(){
  if(!trimRing || windRef===null || !pos) return null;
  const crs = effectiveCourse(); if(crs===null) return null;
  const twa = angleDiff(crs, windRef), aAbs = Math.abs(twa);
  // Umschalten Amwind ↔ Vorwind mit Hysterese, damit der Bogen bei ~100° nicht flackert
  if(trimMode==='up' && aAbs > 105) trimMode = 'down';
  else if(trimMode==='down' && aAbs < 95) trimMode = 'up';
  const ang = currentAngles();
  return { crs, twa, aAbs, s: twa<0 ? -1 : 1, opt: trimMode==='up' ? ang.up : ang.down, zone: classifyZone(aAbs) };
}
function drawTrimRing(ctx, c, R2, up, st, dpr){
  const R1 = R2*0.68;
  const a0 = Math.max(0, st.opt-32), a1 = Math.min(180, st.opt+32);
  const rad = b => (b - up - 90)*Math.PI/180;          // Peilung → Canvas-Winkel (Bild: oben = up)
  const sector = (x0, x1)=>{
    const t0 = rad(windRef + st.s*x0), t1 = rad(windRef + st.s*x1), lo = Math.min(t0,t1), hi = Math.max(t0,t1);
    ctx.beginPath(); ctx.arc(c.cx, c.cy, R2, lo, hi); ctx.arc(c.cx, c.cy, R1, hi, lo, true); ctx.closePath();
  };
  ctx.save();
  // Gleiche Zonen zu einem Stück zusammenfassen, damit keine Nähte entstehen
  ctx.globalAlpha = 0.8;
  let runStart = a0, runKey = classifyZone(a0+0.5).key;
  for(let a=a0+1; a<=a1+0.001; a+=1){
    const key = a < a1 ? classifyZone(a+0.5).key : null;
    if(key !== runKey){
      sector(runStart, Math.min(a, a1)); ctx.fillStyle = ZONE_COLORS[runKey]; ctx.fill();
      runStart = a; runKey = key;
    }
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = cvInk(0.35); ctx.lineWidth = 1*dpr;
  sector(a0, a1); ctx.stroke();
  // Soll-Winkel: dünner Strich quer durch den Bogen
  const line = (b, r0, r1)=>{ const t = rad(b); ctx.beginPath(); ctx.moveTo(c.cx + Math.cos(t)*r0, c.cy + Math.sin(t)*r0); ctx.lineTo(c.cx + Math.cos(t)*r1, c.cy + Math.sin(t)*r1); ctx.stroke(); };
  ctx.lineCap = 'round';
  ctx.strokeStyle = cvInk(0.9); ctx.lineWidth = 2*dpr; line(windRef + st.s*st.opt, R1 - 3*dpr, R2 + 3*dpr);
  // Aktueller Kurs: weißer Strich mit dunklem Rand, ragt über den Bogen hinaus
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 5.5*dpr; line(st.crs, R1 - 7*dpr, R2 + 7*dpr);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.8*dpr; line(st.crs, R1 - 7*dpr, R2 + 7*dpr);
  ctx.restore();
}
function drawTrimPill(ctx, c, R2, st, dpr, H){
  const z = st.zone;
  const txt = `${Math.round(st.aAbs)}° ${st.twa<0 ? 'STB' : 'BB'} · ${z.soll!==null ? 'Soll '+z.soll+'°' : z.pointOfSail}`;
  ctx.save();
  ctx.font = `700 ${11.5*dpr}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(txt).width + 18*dpr, h = 22*dpr;
  const y = Math.min(c.cy + R2 + 16*dpr, H - 60*dpr);
  ctx.fillStyle = ZONE_COLORS[z.key];
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(c.cx-w/2, y-h/2, w, h, 9*dpr) : ctx.rect(c.cx-w/2, y-h/2, w, h); ctx.fill();
  ctx.fillStyle = TRIM_TEXT[z.key] || '#071822'; ctx.fillText(txt, c.cx, y + 0.5*dpr);
  ctx.restore();
}
/* Text für den Navigations-Chip in der Bahnansicht */
function courseViewChipText(t, info){
  const wd = windwardDistance(t);
  let s = `→ ${t.name} ${Math.round(info.dist)} m`;
  if(wd!==null && (t.kind==='wind' || t.kind==='lee' || t.kind==='gate' || t.kind==='offset'))
  {
    const up = legUpwind(t), past = up ? wd < 0 : wd > 0;   // an der Tonne vorbei: Kreuz → Tonne in Lee, Vorwind → Tonne in Luv
    s += past ? ` · ÜBERSEGELT – Tonne ${Math.round(Math.abs(wd))} m ${wd>=0?'in Luv':'in Lee'}`
              : ` · ${Math.round(Math.abs(wd))} m ${wd>=0?'in Luv':'in Lee'} (${(Math.abs(wd)/LADDER_STEP).toFixed(1).replace('.',',')} Sprossen)`;
  }
  return s;
}
let cvLast = null, cvDrag = null;
/* Farben passend zum Anzeigemodus: auf „Hell (Sonne)“ dunkle, kräftigere Linien */
function cvTheme(){ return document.documentElement.dataset.theme || 'dunkel'; }
function cvInk(a){
  const t = cvTheme();
  if(t === 'hell') return `rgba(18,38,46,${Math.min(1, a*1.9)})`;
  if(t === 'nacht') return `rgba(255,107,107,${a})`;
  return `rgba(255,255,255,${a})`;
}
function cvGold(){ return cvTheme()==='hell' ? 'rgba(200,130,0,0.9)' : cvTheme()==='nacht' ? 'rgba(255,59,59,0.7)' : 'rgba(255,183,3,0.55)'; }
function cvWindInk(){ return cvTheme()==='hell' ? 'rgba(30,90,200,0.38)' : cvTheme()==='nacht' ? 'rgba(255,80,80,0.3)' : 'rgba(160,205,255,0.22)'; }
/* Platz oben, den Werkzeugleiste und Ziel-Chip belegen (CSS-Pixel) */
function cvTopPad(){
  const st = mapStageEl.getBoundingClientRect(); let bottom = 40;
  for(const id of ['mapToolbar','mapNavChip','mapCountdownOverlay']){
    const el = document.getElementById(id);
    if(!el || getComputedStyle(el).display === 'none') continue;
    const r = el.getBoundingClientRect(); if(r.height) bottom = Math.max(bottom, r.bottom - st.top);
  }
  return bottom + 18;
}
/* Fließende, dezente Windpfeile im gedrehten Bild */
function drawCvWind(ctx, W, H, dpr, up){
  const dir = (windRef + 180 - up) * Math.PI/180;                    // wohin der Wind weht, im Bild
  const vx = Math.sin(dir), vy = -Math.cos(dir);
  const sp = 96*dpr, speed = (10 + currentTWS()*1.6)*dpr;
  const ph = (performance.now()/1000*speed) % sp;
  const len = (10 + Math.min(14, currentTWS()*0.6))*dpr;
  ctx.save(); ctx.strokeStyle = cvWindInk(); ctx.lineWidth = 1.6*dpr; ctx.lineCap = 'round';
  for(let gx=-sp; gx<W+sp; gx+=sp){
    for(let gy=-sp; gy<H+sp; gy+=sp){
      const off = ((Math.floor(gy/sp)%2)+2)%2 * sp/2;                 // versetzte Reihen wirken ruhiger
      const x = gx + off + vx*ph, y = gy + vy*ph;
      const x0 = x - vx*len/2, y0 = y - vy*len/2, x1 = x + vx*len/2, y1 = y + vy*len/2;
      ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1);
      ctx.moveTo(x1,y1); ctx.lineTo(x1 - vx*5*dpr - vy*3.5*dpr, y1 - vy*5*dpr + vx*3.5*dpr);
      ctx.moveTo(x1,y1); ctx.lineTo(x1 - vx*5*dpr + vy*3.5*dpr, y1 - vy*5*dpr - vx*3.5*dpr);
      ctx.stroke();
    }
  }
  ctx.restore();
}
/* Bildpunkt → Position (Umkehrung der Ansicht) */
function cvToGeo(px, py){
  const L0 = cvLast; if(!L0) return null;
  const ur = L0.up*Math.PI/180, U = { x:Math.sin(ur), y:Math.cos(ur) }, R = { x:Math.cos(ur), y:-Math.sin(ur) };
  const b = (px - L0.cx)/L0.sc, a = (L0.cy - py)/L0.sc;
  return fromLocalXY(L0.ref, { x: a*U.x + b*R.x, y: a*U.y + b*R.y });
}
function cvPoint(e){
  const r = mapCanvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  return { x:(e.clientX - r.left)*d, y:(e.clientY - r.top)*d };
}
/* Bearbeiten direkt in der Lineal-Ansicht: Tonne setzen, messen, Bahn ziehen/drehen */
function wireCourseViewEditing(){
  mapCanvas.addEventListener('pointerdown', e=>{
    if(!courseView || !mapToolMode || !cvLast) return;
    e.stopImmediatePropagation(); e.preventDefault();
    try{ mapCanvas.setPointerCapture(e.pointerId); }catch(_){}
    const p = cvPoint(e), d = cvLast.dpr, h = cvLast.handles;
    const frozen = { ref:cvLast.ref, up:cvLast.up, sc:cvLast.sc, cx:cvLast.cx, cy:cvLast.cy };
    if(mapToolMode==='bahn' && h && Math.hypot(p.x-h.rot.cx, p.y-h.rot.cy) < 30*d){
      const c = courseCenter();
      cvDrag = { mode:'rot', frozen, c, a0: Math.atan2(p.x-h.move.cx, -(p.y-h.move.cy))*180/Math.PI };
    } else if(mapToolMode==='bahn' && h && Math.hypot(p.x-h.move.cx, p.y-h.move.cy) < 32*d){
      cvDrag = { mode:'move', frozen, last: cvToGeo(p.x, p.y) };
    } else cvDrag = { mode:'tap', frozen:null, x:p.x, y:p.y };
  }, true);
  mapCanvas.addEventListener('pointermove', e=>{
    if(!cvDrag || cvDrag.mode==='tap') return;
    e.stopImmediatePropagation();
    const p = cvPoint(e);
    if(cvDrag.mode==='move'){
      const g = cvToGeo(p.x, p.y); shiftCourse(g.lat - cvDrag.last.lat, g.lon - cvDrag.last.lon); cvDrag.last = g;
    } else {
      const m = cvLast.handles.move, a = Math.atan2(p.x-m.cx, -(p.y-m.cy))*180/Math.PI;
      rotateCourse(angleDiff(a, cvDrag.a0), cvDrag.c); cvDrag.a0 = a;
    }
  }, true);
  const end = e=>{
    if(!cvDrag) return;
    e.stopImmediatePropagation();
    const dr = cvDrag; cvDrag = null;
    if(dr.mode==='tap'){
      const p = cvPoint(e);
      if(Math.hypot(p.x-dr.x, p.y-dr.y) < 12*(window.devicePixelRatio||1)){ const g = cvToGeo(p.x, p.y); if(g) onMapTap(g.lat, g.lon); }
    } else finishCourseMove(dr.mode==='rot' ? 'rot' : 'move');
  };
  mapCanvas.addEventListener('pointerup', end, true);
  mapCanvas.addEventListener('pointercancel', e=>{ if(cvDrag && cvDrag.mode!=='tap') finishCourseMove(cvDrag.mode==='rot'?'rot':'move'); cvDrag = null; }, true);
}
function courseViewInit(){
  wireCourseViewEditing();
  document.getElementById('courseViewChip').classList.toggle('active', courseView);
  document.getElementById('courseViewChip').addEventListener('click', ()=>setCourseView(!courseView));
  // Schalter für die Trimmskala in der Werkzeugleiste (nur in dieser Ansicht sichtbar)
  const bar = document.getElementById('mapToolbar');
  if(bar){
    const chip = document.createElement('div');
    chip.className = 'chip' + (trimRing ? ' active' : ''); chip.id = 'toolTrim'; chip.textContent = '🎯 Trimm';
    chip.addEventListener('click', ()=>{
      trimRing = !trimRing; chip.classList.toggle('active', trimRing);
      try{ localStorage.setItem('segelcomp_trimRing', trimRing ? '1' : '0'); }catch(e){}
    });
    bar.appendChild(chip);
    const sync = ()=>{ chip.style.display = courseView ? '' : 'none'; };
    sync();
    document.getElementById('courseViewChip').addEventListener('click', ()=>setTimeout(sync, 0));
  }
}
