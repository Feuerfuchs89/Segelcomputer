/* =====================================================================
   SegelComp – Trainingsbahn, virtuelle Tonnen & Lineal
   ---------------------------------------------------------------------
   • Ufer des Sees aus OpenStreetMap (Overpass-API) laden, lokal cachen
   • Regattabahn wie in der Regattakoje automatisch nach dem Wind
     ausrichten und so auf den See legen, dass alle Tonnen möglichst
     weit vom Ufer und von Inseln entfernt liegen
   • Tonnen frei setzen / verschieben / löschen, Lineal
   • Navigation zur nächsten Tonne mit Laylines und Rundungserkennung
   Startschiff, Pin und Luvtonne sind weiterhin lineBoat / linePin /
   markPos aus dem Hauptprogramm – Bias, Linienabstand und Layline
   funktionieren dadurch ohne Umbau auch für die virtuelle Bahn.
   Diese Datei wird VOR dem Hauptskript geladen; sie greift erst zur
   Laufzeit (nach bahnInit()) auf dessen Variablen zu.
   ===================================================================== */

let lake = null;          // {name, ref:{lat,lon}, outer:[[lat,lon]..], inner:[[[lat,lon]..]..]}
let lakeXY = null;        // dieselben Ringe in Metern um lake.ref
let course = { type:'wl', leg:450, laps:2, fleet:6, axis:null, marks:[], seq:[], act:0, ruler:[] };
let mapToolMode = null;   // 'tonne' | 'lineal' | null
let roundState = { inside:false, minDist:1e9 };
let lastFinishSide = null;
let windShiftWarned = false;

const COURSE_NAMES = { wl:'Up-and-Down', gate:'Up-and-Down mit Leetor', offset:'Up-and-Down mit Ablauftonne', tri:'Dreieck' };
const MARK_COLORS = { wind:'#FFB703', lee:'#F77F00', gate:'#F77F00', offset:'#FFD166', wing:'#FFD166', frei:'#E63946', start:'#3A86FF' };

/* ---------------- Speicherung ---------------- */
function persistCourse(){ try{ localStorage.setItem('segelcomp_course', JSON.stringify(course)); }catch(e){} }
function persistLake(){ try{ localStorage.setItem('segelcomp_lake', JSON.stringify(lake)); }catch(e){} }
function loadCourseAndLake(){
  try{ const c = JSON.parse(localStorage.getItem('segelcomp_course')||'null'); if(c && Array.isArray(c.marks)) course = Object.assign(course, c); }catch(e){}
  try{ const l = JSON.parse(localStorage.getItem('segelcomp_lake')||'null'); if(l && l.outer) setLake(l, false); }catch(e){}
}

/* ---------------- Geometrie ---------------- */
function setLake(l, save){
  lake = l;
  lakeXY = l ? { outer: l.outer.map(p=>toLocalXY(l.ref, {lat:p[0],lon:p[1]})),
                 inner: (l.inner||[]).map(r=>r.map(p=>toLocalXY(l.ref, {lat:p[0],lon:p[1]}))) } : null;
  if(save) persistLake();
}
function ringInside(R, x, y){
  let c=false;
  for(let i=0,j=R.length-1;i<R.length;j=i++){
    const a=R[i], b=R[j];
    if(((a.y>y)!==(b.y>y)) && (x < (b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)) c=!c;
  }
  return c;
}
function segDist(px,py,ax,ay,bx,by){
  const dx=bx-ax, dy=by-ay, l=dx*dx+dy*dy||1;
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l));
  return Math.hypot(px-ax-dx*t, py-ay-dy*t);
}
function ringDist(R, x, y){
  let d=1e9;
  for(let i=0,j=R.length-1;i<R.length;j=i++) d=Math.min(d, segDist(x,y,R[j].x,R[j].y,R[i].x,R[i].y));
  return d;
}
/* Abstand zum nächsten Ufer/Insel; negativ = an Land bzw. auf einer Insel */
function waterClearance(x, y){
  if(!lakeXY) return 1e9;
  let d = ringDist(lakeXY.outer, x, y);
  if(!ringInside(lakeXY.outer, x, y)) return -d;
  for(const r of lakeXY.inner){
    const di = ringDist(r, x, y);
    if(ringInside(r, x, y)) return -di;
    d = Math.min(d, di);
  }
  return d;
}

/* ---------------- See aus OpenStreetMap laden ---------------- */
function llKey(p){ return p[0].toFixed(7)+','+p[1].toFixed(7); }
function joinWays(ways){
  const segs = ways.map(w=>w.slice()), rings = [];
  while(segs.length){
    let ring = segs.shift();
    let guard = 0;
    while(llKey(ring[0]) !== llKey(ring[ring.length-1]) && guard++ < 5000){
      const end = llKey(ring[ring.length-1]);
      const i = segs.findIndex(s=>llKey(s[0])===end || llKey(s[s.length-1])===end);
      if(i<0) break;
      let s = segs.splice(i,1)[0];
      if(llKey(s[0])!==end) s = s.reverse();
      ring = ring.concat(s.slice(1));
    }
    if(ring.length >= 4) rings.push(ring);
  }
  return rings;
}
function simplifyRing(ring, ref, minM){
  const out = [ring[0]];
  let last = toLocalXY(ref, {lat:ring[0][0], lon:ring[0][1]});
  for(let i=1;i<ring.length;i++){
    const q = toLocalXY(ref, {lat:ring[i][0], lon:ring[i][1]});
    if(Math.hypot(q.x-last.x, q.y-last.y) >= minM){ out.push(ring[i]); last = q; }
  }
  return out.map(p=>[Math.round(p[0]*1e6)/1e6, Math.round(p[1]*1e6)/1e6]);
}
function ringAreaM2(ring, ref){
  const xy = ring.map(p=>toLocalXY(ref,{lat:p[0],lon:p[1]}));
  let A=0; for(let i=0,j=xy.length-1;i<xy.length;j=i++) A += xy[j].x*xy[i].y - xy[i].x*xy[j].y;
  return Math.abs(A)/2;
}
async function loadLakeHere(){
  // Bei Planung an Land: Kartenmitte nutzen, sonst die eigene Position
  let c = pos;
  if(leafletMap && realMapActive() && (!c || mapToolMode)){ const m = leafletMap.getCenter(); c = {lat:m.lat, lon:m.lng}; }
  if(!c){ showToast('Keine Position – GPS einschalten oder Karte auf den See schieben.'); return; }
  setCourseHint('Lade Uferlinie aus OpenStreetMap …');
  const q = `[out:json][timeout:25];(way["natural"="water"](around:300,${c.lat},${c.lon});relation["natural"="water"](around:300,${c.lat},${c.lon}););out geom;`;
  try{
    const res = await fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q));
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    const cands = [];
    for(const el of (data.elements||[])){
      const name = (el.tags && (el.tags.name || el.tags['name:de'])) || 'Gewässer';
      if(el.type==='way' && el.geometry && el.geometry.length>3){
        const r = el.geometry.map(g=>[g.lat,g.lon]);
        if(llKey(r[0])===llKey(r[r.length-1])) cands.push({ name, outer:[r], inner:[] });
      } else if(el.type==='relation' && el.members){
        const outs = el.members.filter(m=>m.type==='way' && m.geometry && m.role!=='inner').map(m=>m.geometry.map(g=>[g.lat,g.lon]));
        const ins  = el.members.filter(m=>m.type==='way' && m.geometry && m.role==='inner').map(m=>m.geometry.map(g=>[g.lat,g.lon]));
        const oR = joinWays(outs), iR = joinWays(ins);
        oR.forEach(o=>cands.push({ name, outer:[o], inner:iR }));
      }
    }
    if(!cands.length) throw new Error('kein Gewässer in 300 m Umkreis');
    // Bevorzugt: Polygon, in dem die Position liegt – sonst das nächstgelegene
    let best=null, bestScore=-1e12;
    for(const k of cands){
      const R = k.outer[0].map(p=>toLocalXY(c,{lat:p[0],lon:p[1]}));
      const inside = ringInside(R, 0, 0);
      const area = ringAreaM2(k.outer[0], c);
      const s = inside ? 1e9 + area : -ringDist(R,0,0);
      if(s > bestScore){ bestScore = s; best = k; }
    }
    // Referenzpunkt = Mitte der Bounding-Box, Ringe vereinfachen (±4 m)
    const lats = best.outer[0].map(p=>p[0]), lons = best.outer[0].map(p=>p[1]);
    const ref = { lat:(Math.min(...lats)+Math.max(...lats))/2, lon:(Math.min(...lons)+Math.max(...lons))/2 };
    const outer = simplifyRing(best.outer[0], ref, 4);
    const inner = best.inner
      .filter(r=>{ const R=outer.map(p=>toLocalXY(ref,{lat:p[0],lon:p[1]})); const q=toLocalXY(ref,{lat:r[0][0],lon:r[0][1]}); return ringInside(R,q.x,q.y); })
      .map(r=>simplifyRing(r, ref, 3)).filter(r=>r.length>=3);
    setLake({ name:best.name, ref, outer, inner, loaded:Date.now() }, true);
    const km2 = (ringAreaM2(outer, ref)/1e6).toFixed(2);
    setCourseHint(`Ufer geladen: ${best.name} · ${km2} km² · ${inner.length} Insel(n) – offline gespeichert.`);
    bahnRedraw();
    if(leafletMap) leafletMap.fitBounds(L.latLngBounds(outer), { padding:[16,16] });
  }catch(e){
    setCourseHint('Uferlinie nicht geladen ('+e.message+'). Internet nötig – oder Karte direkt auf das Wasser schieben und erneut versuchen.');
  }
}

/* ---------------- Bahn erzeugen (wie Regattakoje) ---------------- */
function boatLen(){ const bp = currentPolar(); return bp ? bp.len : 4.7; }
/* Lokale Bahnkoordinaten: x = nach rechts (Blick in den Wind), y = in den Wind */
function courseShape(type, leg, fleet, laps){
  const Lb = Math.max(boatLen(), 3.5);
  const lineLen = Math.max(60, (fleet+1)*Lb*1.9);
  const pts = { pin:[-lineLen/2,0], cb:[lineLen/2,0], wind:[0,leg] };
  const marks = [];
  if(type==='gate'){ const hw = Math.max(10, Lb*2.2); marks.push({id:'gateL',kind:'gate',name:'Leetor L',xy:[-hw,-75]},{id:'gateR',kind:'gate',name:'Leetor R',xy:[hw,-75]}); }
  else marks.push({id:'lee',kind:'lee',name:'Leetonne',xy:[0,-75]});
  if(type==='offset') marks.push({id:'offset',kind:'offset',name:'Ablauftonne',xy:[-Math.max(55,Lb*4), leg-10]});
  if(type==='tri') marks.push({id:'wing',kind:'wing',name:'Raumtonne',xy:[-leg*0.45, leg*0.5]});
  const seq = [];
  for(let l=1;l<=laps;l++){
    seq.push('wind');
    if(type==='offset') seq.push('offset');
    if(type==='tri') seq.push('wing');
    if(l<laps) seq.push(type==='gate'?'gate':'lee');
  }
  seq.push('finish');
  // Prüfpunkte: Linie inkl. Platz davor/dahinter, Tonnen mit Rundungsraum, Kreuzachse
  const probe = [];
  for(const s of [-1,-0.5,0,0.5,1]) probe.push([s*(lineLen/2+30),-110],[s*(lineLen/2+30),0]);
  probe.push([0,leg+40],[-30,leg+30],[30,leg+30],[0,-95]);
  for(let y=50;y<leg;y+=60) probe.push([0,y]);
  marks.forEach(m=>probe.push([m.xy[0]+(m.xy[0]<0?-30:m.xy[0]>0?30:0), m.xy[1]]));
  if(type==='tri') for(let k=1;k<4;k++){ probe.push([-leg*0.45*k/4, leg*0.5*k/4], [-leg*0.45*k/4, leg-leg*0.5*k/4]); }
  return { lineLen, pts, marks, seq, probe };
}
function axisVectors(windFrom){
  const r = windFrom*Math.PI/180;
  const U = [Math.sin(r), Math.cos(r)];   // Ost/Nord-Einheitsvektor in den Wind
  const R = [U[1], -U[0]];                 // rechts, wenn man in den Wind schaut
  return { U, R };
}
function shapeToEN(xy, ax, o){ return { x:o.x + xy[0]*ax.R[0] + xy[1]*ax.U[0], y:o.y + xy[0]*ax.R[1] + xy[1]*ax.U[1] }; }
function scoreAt(shape, ax, o, posXY){
  let m = 1e9;
  for(const p of shape.probe){
    const q = shapeToEN(p, ax, o);
    const d = waterClearance(q.x, q.y);
    if(d < 25) return -1;
    if(d < m) m = d;
  }
  if(posXY) m -= 0.03*Math.hypot(o.x-posXY.x, o.y-posXY.y); // lieber in deiner Nähe
  return m;
}
function searchPlacement(shape, ax, posXY){
  const xs = lakeXY.outer.map(p=>p.x), ys = lakeXY.outer.map(p=>p.y);
  const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
  const step = Math.max(30, Math.max(x1-x0, y1-y0)/70);
  let best=-2, bo=null;
  for(let x=x0;x<=x1;x+=step) for(let y=y0;y<=y1;y+=step){
    const s = scoreAt(shape, ax, {x,y}, posXY); if(s>best){ best=s; bo={x,y}; }
  }
  if(!bo) return null;
  for(const st of [step/3, step/9]){
    const c = {...bo};
    for(let dx=-3;dx<=3;dx++) for(let dy=-3;dy<=3;dy++){
      const o = {x:c.x+dx*st, y:c.y+dy*st}; const s = scoreAt(shape, ax, o, posXY);
      if(s>best){ best=s; bo=o; }
    }
  }
  return { o:bo, score:best };
}
function applyShape(shape, ax, o, ref){
  const ll = xy=>fromLocalXY(ref, shapeToEN(xy, ax, o));
  lineBoat = ll(shape.pts.cb); linePin = ll(shape.pts.pin); markPos = ll(shape.pts.wind);
  course.marks = shape.marks.map(m=>Object.assign({ id:m.id, kind:m.kind, name:m.name }, ll(m.xy)));
  course.seq = shape.seq; course.act = 0; course.axis = windRef;
  roundState = { inside:false, minDist:1e9 }; lastFinishSide = null; windShiftWarned = false;
  lastLaylineState = null;
  persistRefPoints(); persistCourse(); updateLineStepLabel();
}
function readCourseForm(){
  course.type = document.getElementById('crsType').value;
  course.leg = Math.max(100, Math.min(1500, parseInt(document.getElementById('crsLeg').value,10)||450));
  course.laps = Math.max(1, Math.min(5, parseInt(document.getElementById('crsLaps').value,10)||2));
  course.fleet = Math.max(1, Math.min(60, parseInt(document.getElementById('crsFleet').value,10)||6));
}
function autoCourse(keepCenter){
  readCourseForm();
  // Gespeicherter See weit weg vom echten Standort? Dann nicht dort auslegen.
  if(lake && lake.ref && pos && !demoMode && haversineDist(pos, lake.ref) > 3000){
    setLake(null, true);
    showToast('Gespeicherter See ist weit weg – Bahn wird ab deinem Standort ausgelegt („See laden“ für Uferprüfung).');
  }
  if(windRef===null){ showToast('Erst Wind setzen: Quelle „Internet“, „Manuell“ oder Wind pingen.'); return; }
  const ax = axisVectors(windRef);
  const ref = lake ? lake.ref : (pos || (leafletMap ? {lat:leafletMap.getCenter().lat, lon:leafletMap.getCenter().lng} : null));
  if(!ref){ showToast('Keine Position – GPS einschalten.'); return; }
  const posXY = pos ? toLocalXY(ref, pos) : null;
  if(keepCenter && lineBoat && linePin){
    const a = toLocalXY(ref, lineBoat), b = toLocalXY(ref, linePin);
    const o = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
    const shape = courseShape(course.type, course.leg, course.fleet, course.laps);
    const ok = !lakeXY || scoreAt(shape, ax, o, null) > 0;
    const keepAct = course.act;
    applyShape(shape, ax, o, ref); course.act = Math.min(keepAct, course.seq.length-1); persistCourse();
    setCourseHint(`Bahn um die Startlinie auf ${Math.round(windRef)}° gedreht.` + (ok ? '' : ' ⚠️ Teile der Bahn liegen jetzt zu nah am Ufer – besser „automatisch auslegen“.'));
  } else if(lakeXY){
    let leg = course.leg, res = null, shape = null;
    for(let k=0;k<12;k++){
      shape = courseShape(course.type, leg, course.fleet, course.laps);
      res = searchPlacement(shape, ax, posXY && waterClearance(posXY.x,posXY.y)>0 ? posXY : null);
      if(res && res.score > 0) break;
      leg = Math.round(leg*0.88/10)*10;
      if(leg < 120) break;
    }
    if(!res || res.score <= 0){ setCourseHint('Diese Bahn passt bei dieser Windrichtung nicht auf den See – Kreuz kürzer oder weniger Boote wählen.'); return; }
    applyShape(shape, ax, res.o, ref);
    const clear = Math.round(scoreAt(shape, ax, res.o, null));
    const shortened = leg !== course.leg;
    setCourseHint(`${COURSE_NAMES[course.type]} · Kreuz ${leg} m · Wind ${Math.round(windRef)}° · min. ${clear} m Abstand zu Ufer/Inseln` + (shortened ? ` (von ${course.leg} m gekürzt, damit sie auf den See passt)` : ''));
    if(shortened){ course.leg = leg; document.getElementById('crsLeg').value = leg; persistCourse(); }
  } else {
    // Ohne Uferlinie: Startlinie 60 m in Lee deiner Position, Kreuz in den Wind
    const shape = courseShape(course.type, course.leg, course.fleet, course.laps);
    const p0 = posXY || {x:0,y:0};
    applyShape(shape, ax, { x:p0.x - ax.U[0]*60, y:p0.y - ax.U[1]*60 }, ref);
    setCourseHint('Bahn ab deiner Position ausgelegt (ohne Uferprüfung – „See laden“ für automatische Platzierung).');
  }
  bahnRedraw();
  fitCourse();
  beep(900,90);
}
function clearCourse(){
  course.marks = []; course.seq = []; course.act = 0; course.axis = null; course.ruler = [];
  lineBoat = null; linePin = null; markPos = null; lastLaylineState = null;
  persistRefPoints(); persistCourse(); updateLineStepLabel();
  bahnRedraw(); setCourseHint('Bahn gelöscht.');
}

/* ---------------- Ziel & Navigation ---------------- */
function seqTarget(entry){
  if(entry==='wind') return markPos ? { lat:markPos.lat, lon:markPos.lon, name:'Luvtonne', kind:'wind' } : null;
  if(entry==='finish'){
    if(!lineBoat || !linePin) return null;
    return { lat:(lineBoat.lat+linePin.lat)/2, lon:(lineBoat.lon+linePin.lon)/2, name:'Ziel (Startlinie)', kind:'finish' };
  }
  if(entry==='gate'){
    const a = course.marks.find(m=>m.id==='gateL'), b = course.marks.find(m=>m.id==='gateR');
    if(!a || !b) return null;
    return { lat:(a.lat+b.lat)/2, lon:(a.lon+b.lon)/2, name:'Leetor', kind:'gate', half: haversineDist(a,b)/2 };
  }
  const m = course.marks.find(x=>x.id===entry);
  return m ? { lat:m.lat, lon:m.lon, name:m.name, kind:m.kind } : null;
}
function activeTarget(){
  if(!course.seq.length) return null;
  course.act = Math.max(0, Math.min(course.act, course.seq.length-1));
  return seqTarget(course.seq[course.act]);
}
function stepTarget(d){
  if(!course.seq.length) return;
  course.act = Math.max(0, Math.min(course.seq.length-1, course.act+d));
  roundState = { inside:false, minDist:1e9 }; lastFinishSide = null;
  persistCourse(); bahnRedraw(); bahnTick();
}
function roundRadius(){ return Math.max(15, boatLen()*3); }
/* Ist der Schenkel zu dieser Tonne eine Kreuz (true) oder ein Vorwind-Schenkel (false)?
   Entscheidend ist die Rolle der Tonne bzw. die Schenkelrichtung – NICHT die aktuelle
   Bootsposition. Sonst kippen die Laylines um, sobald man die Luvtonne übersegelt hat
   (Boot liegt dann in Luv der Tonne) und zeigen fälschlich die Vorwind-Laylines. */
function legUpwind(t){
  if(windRef===null || !t) return true;
  if(t.kind==='wind' || t.kind==='offset') return true;
  if(t.kind==='lee' || t.kind==='gate') return false;
  const s = (typeof legStartPoint==='function') ? legStartPoint() : null;
  if(s && haversineDist(s, t) > 30) return Math.abs(angleDiff(bearing(s, t), windRef)) < 90;
  if(pos) return Math.abs(angleDiff(bearing(pos, t), windRef)) < 90;
  return true;
}
/* Laylines & Kursinfo zur aktiven Tonne */
function targetInfo(t){
  if(!t || !pos) return null;
  const dist = haversineDist(pos, t), brg = bearing(pos, t);
  if(windRef===null) return { dist, brg };
  const rel = angleDiff(brg, windRef), relAbs = Math.abs(rel);
  const a = currentAngles();
  const upwind = legUpwind(t); // Kreuz oder Vorwind hängt vom Schenkel ab, nicht davon, wo das Boot gerade ist
  const opt = upwind ? a.up : a.down;
  // Einheitlich: <0 noch nicht an der Layline, ≈0 Layline, >0 übersegelt.
  // Kreuz: Tonne direkt in Luv (0°) → weit weg von der Layline.
  // Vorwind: Tonne direkt in Lee (180°) → ebenfalls noch nicht an der Layline.
  const diff = upwind ? relAbs - opt : opt - relAbs;
  return { dist, brg, rel, upwind, opt, diff };
}
function bahnTick(){
  const t = activeTarget();
  const navEl = document.getElementById('navTarget'), navSub = document.getElementById('navSub'), chip = document.getElementById('mapNavChip');
  if(!t){
    if(navEl){ navEl.textContent = course.seq.length ? 'Bahn beendet' : 'Keine Bahn'; navSub.textContent = 'Auf der Karte eine Bahn auslegen oder Tonnen setzen.'; }
    if(chip) chip.style.display = 'none';
    checkWindShift();
    return;
  }
  const info = targetInfo(t);
  const label = `${course.act+1}/${course.seq.length} · ${t.name}`;
  if(navEl) navEl.textContent = label;
  if(info){
    let lay = '';
    if(info.diff!==undefined){
      const what = info.upwind ? 'Wende' : 'Halse';
      if(Math.abs(info.diff) <= 3) lay = `LAYLINE – jetzt ${what}`;
      else if(info.diff < 0) lay = `noch ${Math.round(-info.diff)}° bis zur ${info.upwind?'Wende':'Halse'}-Layline`;
      else lay = `${Math.round(info.diff)}° übersegelt`;
    }
    const sub = `${Math.round(info.dist)} m · Peilung ${Math.round(info.brg)}°` + (lay ? ' · '+lay : '');
    if(navSub) navSub.textContent = sub;
    if(chip){ chip.style.display = 'block'; chip.textContent = (courseView ? courseViewChipText(t, info) : `→ ${t.name} ${Math.round(info.dist)} m`) + (info.diff!==undefined && Math.abs(info.diff)<=3 ? ' · LAYLINE' : ''); }
    detectRounding(t, info.dist);
  }
  checkWindShift();
}
function detectRounding(t, dist){
  if(t.kind==='finish'){
    if(!lineBoat || !linePin || !pos) return;
    const side = Math.sign(crossTrackDist(lineBoat, linePin, pos));
    const a = toLocalXY(lineBoat, linePin), b = toLocalXY(lineBoat, pos);
    const tt = (a.x*b.x + a.y*b.y)/(a.x*a.x + a.y*a.y);
    if(lastFinishSide!==null && side!==lastFinishSide && tt>=-0.05 && tt<=1.05 && dist < 400){
      beep(1800,500); vibrate(400); showToast('🏁 Im Ziel!');
      course.act = course.seq.length; persistCourse(); bahnRedraw();
    }
    lastFinishSide = side;
    return;
  }
  const r = roundRadius() + (t.half||0);
  if(dist < r){ roundState.inside = true; roundState.minDist = Math.min(roundState.minDist, dist); }
  else if(roundState.inside && dist > r*1.4){
    const done = t.name;
    course.act++;
    roundState = { inside:false, minDist:1e9 }; lastFinishSide = null;
    persistCourse(); bahnRedraw();
    const n = activeTarget();
    beep(1100,120); setTimeout(()=>beep(1400,120),160); vibrate(250);
    showToast(`${done} gerundet → ${n ? n.name : 'fertig'}`);
  }
}
function checkWindShift(){
  const el = document.getElementById('crsShift');
  if(!el) return;
  if(course.axis===null || windRef===null || !course.seq.length){ el.style.display='none'; return; }
  const d = angleDiff(windRef, course.axis);
  if(Math.abs(d) >= 10){
    el.style.display = 'block';
    el.textContent = `Wind hat seit dem Auslegen um ${Math.round(Math.abs(d))}° nach ${d>0?'rechts':'links'} gedreht – Bahn neu ausrichten?`;
    if(!windShiftWarned){ windShiftWarned = true; vibrate(150); }
  } else { el.style.display = 'none'; windShiftWarned = false; }
}

/* ---------------- Lineal ---------------- */
function rulerSummary(){
  const R = course.ruler; if(R.length<2) return null;
  let tot = 0; for(let i=1;i<R.length;i++) tot += haversineDist(R[i-1], R[i]);
  const brg = bearing(R[R.length-2], R[R.length-1]);
  let s = `${Math.round(tot)} m · ${Math.round(brg)}°`;
  if(windRef!==null){
    const twa = Math.abs(angleDiff(brg, windRef));
    s += ` · ${Math.round(twa)}° zum Wind (${twa<70?'Kreuz':twa<110?'Halbwind':twa<150?'Raum':'Vorwind'})`;
    const tg = targetSpeed(twa < 45 ? currentAngles().up : twa);
    if(tg){
      // Kreuz/Vorwind: Zeit mit VMG, sonst direkt
      const a = currentAngles();
      let v = tg, dist = tot;
      if(twa < a.up){ v = targetSpeed(a.up)*Math.cos(a.up*Math.PI/180); dist = tot*Math.cos(twa*Math.PI/180); }
      else if(twa > a.down){ v = targetSpeed(a.down)*Math.cos((180-a.down)*Math.PI/180); dist = tot*Math.cos((180-twa)*Math.PI/180); }
      if(v>0.2){ const sec = Math.round(dist/(v*0.5144)); s += ` · ≈ ${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')} min`; }
    }
  }
  return s;
}

/* ---------------- Werkzeuge ---------------- */
function setMapTool(mode){
  mapToolMode = (mapToolMode===mode) ? null : mode;
  document.getElementById('toolMark').classList.toggle('active', mapToolMode==='tonne');
  document.getElementById('toolRuler').classList.toggle('active', mapToolMode==='lineal');
  document.getElementById('toolMove').classList.toggle('active', mapToolMode==='bahn');
  const hint = document.getElementById('mapToolHint');
  hint.style.display = mapToolMode ? 'block' : 'none';
  hint.textContent = mapToolMode==='tonne' ? 'Tippe auf die Karte, um eine Tonne zu setzen. Tonnen lassen sich ziehen; Tippen auf eine Tonne → löschen / als Ziel.'
                   : mapToolMode==='lineal' ? 'Tippe Punkte auf die Karte – Distanz, Peilung, Winkel zum Wind und Zeit laut Polare.'
                   : mapToolMode==='bahn' ? 'Ganze Bahn: am ✥ ziehen = verschieben, am ⟳ ziehen = drehen, auf die Karte tippen = Bahn springt dorthin.' : '';
  if(mapToolMode==='bahn' && !allCoursePoints().length){ showToast('Noch keine Bahn – erst „Automatisch auslegen“ oder Tonnen setzen.'); }
  bahnDrawMoveHandle();
  if(mapToolMode==='lineal' && course.ruler.length>=2){ course.ruler = []; persistCourse(); bahnRedraw(); }
  if(mapToolMode && !realMapActive() && !courseView) showToast('Bearbeiten geht auf der Echtkarte (🌐) oder in „Ziel oben + Lineal“.');
}
function onMapTap(lat, lon){
  if(mapToolMode==='bahn'){
    const c = courseCenter(); if(!c) return;
    shiftCourse(lat - c.lat, lon - c.lon); finishCourseMove('move'); return;
  }
  if(mapToolMode==='tonne'){
    const n = course.marks.filter(m=>m.kind==='frei').length + 1;
    const m = { id:'f'+Date.now(), kind:'frei', name:'Tonne '+n, lat, lon };
    course.marks.push(m);
    const fi = course.seq.indexOf('finish');
    if(fi>=0) course.seq.splice(fi,0,m.id); else course.seq.push(m.id);
    persistCourse(); bahnRedraw(); beep(800,60);
  } else if(mapToolMode==='lineal'){
    course.ruler.push({lat, lon}); persistCourse(); bahnRedraw();
  }
}
function removeMark(id){
  course.marks = course.marks.filter(m=>m.id!==id);
  course.seq = course.seq.filter(e=>e!==id && !(e==='gate' && (id==='gateL'||id==='gateR')));
  persistCourse(); bahnRedraw();
}
function targetMark(id){
  const i = course.seq.indexOf(id);
  if(i>=0){ course.act = i; roundState = { inside:false, minDist:1e9 }; persistCourse(); bahnRedraw(); bahnTick(); }
}
function setCourseHint(t){ const el = document.getElementById('crsHint'); if(el) el.textContent = t; }

/* ---------------- Ganze Bahn verschieben ---------------- */
function allCoursePoints(){
  const pts = [lineBoat, linePin, markPos].filter(Boolean);
  course.marks.forEach(m=>pts.push(m));
  return pts;
}
function courseCenter(){
  const pts = allCoursePoints(); if(!pts.length) return null;
  return { lat: pts.reduce((a,p)=>a+p.lat,0)/pts.length, lon: pts.reduce((a,p)=>a+p.lon,0)/pts.length };
}
/* Alle Bahnpunkte um denselben Versatz schieben (bei < 2 km reicht Grad-Addition) */
function shiftCourse(dLat, dLon){
  const mv = p=>{ if(p){ p.lat += dLat; p.lon += dLon; } };
  mv(lineBoat); mv(linePin); mv(markPos);
  course.marks.forEach(mv);
}
/* Nach dem Verschieben: speichern, neu zeichnen, Abstand zum Ufer prüfen */
/* Ganze Bahn um einen Punkt drehen (deg > 0 = im Uhrzeigersinn). Die Bahnachse
   (course.axis) dreht mit – so zeigt die App danach, wie schief Bahn und Wind zueinander stehen. */
function rotateCourse(deg, c){
  const t = deg*Math.PI/180, cs = Math.cos(t), sn = Math.sin(t);
  const rot = p=>{ if(!p) return; const l = toLocalXY(c, p); const q = fromLocalXY(c, { x: l.x*cs + l.y*sn, y: -l.x*sn + l.y*cs }); p.lat = q.lat; p.lon = q.lon; };
  rot(lineBoat); rot(linePin); rot(markPos);
  course.marks.forEach(rot);
  if(course.axis!==null && course.axis!==undefined) course.axis = (course.axis + deg + 360) % 360;
  else if(lineBoat && markPos) course.axis = bearing({ lat:(lineBoat.lat+(linePin||lineBoat).lat)/2, lon:(lineBoat.lon+(linePin||lineBoat).lon)/2 }, markPos);
}
function axisInfoText(){
  if(course.axis===null || course.axis===undefined || windRef===null) return '';
  const d = angleDiff(course.axis, windRef);
  if(Math.abs(d) < 3) return ` · Achse ${Math.round(course.axis)}° passt zum Wind`;
  // Achse rechts vom Wind → Bahn nach rechts gedreht → Wind kommt von links: linke Seite/Pin bevorzugt
  return ` · Achse ${Math.round(course.axis)}°, Wind ${Math.round(windRef)}° → ${Math.round(Math.abs(d))}° schief, ${d>0?'linke Seite & Pin-Ende':'rechte Seite & Startschiff'} bevorzugt`;
}
function finishCourseMove(kind){
  const what = kind==='rot' ? 'gedreht' : 'verschoben';
  lastLaylineState = null; roundState = { inside:false, minDist:1e9 }; lastFinishSide = null; windShiftWarned = false;
  persistRefPoints(); persistCourse(); redrawLeafletStatics(); bahnRedraw(); bahnDrawMoveHandle();
  if(!lakeXY){ setCourseHint(`Bahn ${what}${axisInfoText()} (kein Ufer geladen – keine Uferprüfung).`); return; }
  const named = [[lineBoat,'Startschiff'],[linePin,'Pin'],[markPos,'Luvtonne'], ...course.marks.map(m=>[m,m.name])].filter(x=>x[0]);
  let worst = null;
  for(const [p,n] of named){
    const q = toLocalXY(lake.ref, p), d = waterClearance(q.x, q.y);
    if(!worst || d < worst.d) worst = { d, n };
  }
  if(worst.d < 0){ setCourseHint(`⚠️ ${worst.n} liegt an Land oder auf einer Insel – Bahn weiter aufs Wasser schieben.`); vibrate(200); }
  else if(worst.d < 30) setCourseHint(`⚠️ ${worst.n} nur ${Math.round(worst.d)} m vom Ufer – knapp.${axisInfoText()}`);
  else setCourseHint(`Bahn ${what} · alle Tonnen auf dem Wasser · min. ${Math.round(worst.d)} m Abstand${axisInfoText()}`);
}
/* Griff zum Drehen: hinter der Luvtonne, auf der Linie Bahnmitte → Luvtonne */
function rotateHandlePos(c){
  const tip = markPos || (course.marks[0] || null);
  if(!tip) return fromLocalXY(c, { x:0, y:150 });
  const l = toLocalXY(c, tip), d = Math.hypot(l.x, l.y) || 1, k = (d + Math.max(40, d*0.18)) / d;
  return fromLocalXY(c, { x:l.x*k, y:l.y*k });
}
let llMoveHandle = null, llRotHandle = null, llRotLine = null;
function bahnDrawMoveHandle(){
  if(!leafletMap) return;
  [llMoveHandle, llRotHandle, llRotLine].forEach(l=>{ if(l) leafletMap.removeLayer(l); });
  llMoveHandle = llRotHandle = llRotLine = null;
  if(mapToolMode!=='bahn') return;
  const c = courseCenter(); if(!c) return;
  // Drehgriff ⟳ – dreht die ganze Bahn um ihre Mitte
  const rp = rotateHandlePos(c);
  llRotLine = L.polyline([[c.lat,c.lon],[rp.lat,rp.lon]], { color:'#FFB703', weight:2, dashArray:'4,6', opacity:0.8, interactive:false }).addTo(leafletMap);
  llRotHandle = L.marker([rp.lat, rp.lon], { draggable:true, autoPan:true, zIndexOffset:1000,
    icon:L.divIcon({ className:'move-wrap', iconSize:[40,40], iconAnchor:[20,20], html:'<div class="move-handle rot">⟳</div>' }) }).addTo(leafletMap);
  let bPrev = null;
  llRotHandle.on('dragstart', ()=>{ const q = llRotHandle.getLatLng(); bPrev = bearing(c, { lat:q.lat, lon:q.lng }); });
  llRotHandle.on('drag', ()=>{
    const q = llRotHandle.getLatLng(), b = bearing(c, { lat:q.lat, lon:q.lng });
    rotateCourse(angleDiff(b, bPrev), c); bPrev = b;
    llRotLine.setLatLngs([[c.lat,c.lon],[q.lat,q.lng]]);
    redrawLeafletStatics(); bahnDrawLeaflet();
  });
  llRotHandle.on('dragend', ()=>finishCourseMove('rot'));
  llMoveHandle = L.marker([c.lat, c.lon], { draggable:true, autoPan:true, zIndexOffset:1000,
    icon:L.divIcon({ className:'move-wrap', iconSize:[46,46], iconAnchor:[23,23], html:'<div class="move-handle">✥</div>' }) }).addTo(leafletMap);
  let last = null;
  llMoveHandle.on('dragstart', ()=>{ const q = llMoveHandle.getLatLng(); last = { lat:q.lat, lon:q.lng }; });
  llMoveHandle.on('drag', ()=>{
    const q = llMoveHandle.getLatLng();
    shiftCourse(q.lat - last.lat, q.lng - last.lon); last = { lat:q.lat, lon:q.lng };
    redrawLeafletStatics(); bahnDrawLeaflet();
  });
  llMoveHandle.on('dragend', ()=>finishCourseMove('move'));
}

/* ---------------- Zeichnen: Leaflet ---------------- */
let llBahn = null, llBahnDyn = null;
function buoyIcon(color, label, active){
  return L.divIcon({ className:'buoy-wrap', iconSize:[18,18], iconAnchor:[9,9],
    html:`<div class="buoy${active?' active':''}" style="background:${color}"></div><span class="buoy-lbl">${label}</span>` });
}
/* Ziehbarer Marker – auch für Startschiff/Pin/Luvtonne des Hauptprogramms */
function llDragMark(p, color, label, active, onMove, onClick){
  const m = L.marker([p.lat,p.lon], { icon:buoyIcon(color,label,active), draggable:true, autoPan:true, zIndexOffset:active?600:400 });
  m.on('dragend', ()=>{ const q = m.getLatLng(); onMove({lat:q.lat, lon:q.lng}); });
  if(onClick) m.on('click', onClick);
  return m;
}
function legacyMove(which){
  return (q)=>{
    if(which==='boat') lineBoat = q; else if(which==='pin') linePin = q; else markPos = q;
    lastLaylineState = null; persistRefPoints(); redrawLeafletStatics(); bahnRedraw();
  };
}
function bahnDrawLeaflet(){
  if(!leafletMap) return;
  if(!llBahn) llBahn = L.layerGroup().addTo(leafletMap);
  llBahn.clearLayers();
  if(lake){
    L.polygon([lake.outer, ...(lake.inner||[])], { color:'#219EBC', weight:1.5, fill:false, dashArray:'4,4', interactive:false }).addTo(llBahn);
  }
  const act = course.seq[course.act];
  course.marks.forEach(m=>{
    const isAct = act===m.id || (act==='gate' && m.kind==='gate');
    const mk = llDragMark(m, MARK_COLORS[m.kind]||'#E63946', m.name, isAct, q=>{ m.lat=q.lat; m.lon=q.lon; persistCourse(); bahnRedraw(); });
    const inSeq = course.seq.includes(m.id) || (m.kind==='gate' && course.seq.includes('gate'));
    const box = document.createElement('div');
    box.className = 'llPopup';
    box.innerHTML = `<b>${m.name}</b><br>`;
    if(inSeq){ const b1 = document.createElement('button'); b1.textContent = 'Als nächstes Ziel'; b1.onclick = ()=>{ targetMark(m.kind==='gate'?'gate':m.id); leafletMap.closePopup(); }; box.appendChild(b1); }
    const b2 = document.createElement('button'); b2.textContent = 'Löschen'; b2.className='del'; b2.onclick = ()=>{ leafletMap.closePopup(); removeMark(m.id); };
    box.appendChild(b2);
    mk.bindPopup(box);
    mk.addTo(llBahn);
  });
  if(course.marks.some(m=>m.id==='gateL') && course.marks.some(m=>m.id==='gateR')){
    const a = course.marks.find(m=>m.id==='gateL'), b = course.marks.find(m=>m.id==='gateR');
    L.polyline([[a.lat,a.lon],[b.lat,b.lon]], { color:'#F77F00', weight:1.5, dashArray:'3,5', interactive:false }).addTo(llBahn);
  }
  // Lineal
  const R = course.ruler;
  if(R.length){
    R.forEach(p=>L.circleMarker([p.lat,p.lon], { radius:4, color:'#fff', weight:2, fillColor:'#8338EC', fillOpacity:1, interactive:false }).addTo(llBahn));
    if(R.length>1){
      L.polyline(R.map(p=>[p.lat,p.lon]), { color:'#8338EC', weight:3, interactive:false }).addTo(llBahn);
      const s = rulerSummary();
      L.marker([R[R.length-1].lat, R[R.length-1].lon], { opacity:0, interactive:false, icon:L.divIcon({className:'', html:''}) })
        .bindTooltip(s, { permanent:true, direction:'top', offset:[0,-6], className:'llTooltip ruler-tip' }).addTo(llBahn);
    }
  }
}
/* Dynamisch (jeder Frame): Laylines an der aktiven Tonne + Peillinie */
function bahnDrawLeafletDyn(){
  if(!leafletMap) return;
  if(!llBahnDyn) llBahnDyn = L.layerGroup().addTo(leafletMap);
  llBahnDyn.clearLayers();
  const t = activeTarget();
  if(!t) return;
  if(pos) L.polyline([[pos.lat,pos.lon],[t.lat,t.lon]], { color:'#ffffff', weight:1.2, opacity:0.7, dashArray:'2,6', interactive:false }).addTo(llBahnDyn);
  laylineRays(t).forEach(r=>L.polyline(r.map(p=>[p.lat,p.lon]), { color:'#E63946', weight:1.6, opacity:0.85, dashArray:'8,6', interactive:false }).addTo(llBahnDyn));
}
function laylineRays(t){
  if(windRef===null || !t || t.kind==='finish') return [];
  const info = pos ? targetInfo(t) : null;
  const a = currentAngles();
  const upwind = legUpwind(t);
  const opt = upwind ? a.up : a.down;
  const len = Math.min(900, Math.max(150, course.leg*0.9));
  const rays = [];
  for(const s of [1,-1]){
    const b = (windRef + 180 + s*opt + 360) % 360; // vom Ziel zurück zum Boot
    const ref = { lat:t.lat, lon:t.lon };
    const end = fromLocalXY(ref, { x:Math.sin(b*Math.PI/180)*len, y:Math.cos(b*Math.PI/180)*len });
    rays.push([ref, end]);
  }
  return rays;
}

/* ---------------- Zeichnen: Offline-Canvas ---------------- */
function bahnExtentPoints(){
  const pts = course.marks.map(m=>({lat:m.lat, lon:m.lon}));
  course.ruler.forEach(p=>pts.push(p));
  return pts;
}
function bahnDrawCanvas(ctx, toCanvas, dpr){
  if(lake){
    ctx.strokeStyle = '#219EBC'; ctx.lineWidth = 1.5*dpr; ctx.setLineDash([4*dpr,4*dpr]);
    for(const ring of [lake.outer, ...(lake.inner||[])]){
      ctx.beginPath();
      ring.forEach((p,i)=>{ const c = toCanvas({lat:p[0],lon:p[1]}); if(i) ctx.lineTo(c.cx,c.cy); else ctx.moveTo(c.cx,c.cy); });
      ctx.closePath(); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  const t = activeTarget();
  if(t){
    ctx.strokeStyle = 'rgba(230,57,70,0.85)'; ctx.lineWidth = 1.6*dpr; ctx.setLineDash([8*dpr,6*dpr]);
    laylineRays(t).forEach(r=>{ const a=toCanvas(r[0]), b=toCanvas(r[1]); ctx.beginPath(); ctx.moveTo(a.cx,a.cy); ctx.lineTo(b.cx,b.cy); ctx.stroke(); });
    ctx.setLineDash([]);
  }
  const act = course.seq[course.act];
  course.marks.forEach(m=>{
    const c = toCanvas(m);
    const isAct = act===m.id || (act==='gate' && m.kind==='gate');
    if(isAct){ ctx.strokeStyle='#fff'; ctx.lineWidth=2*dpr; ctx.beginPath(); ctx.arc(c.cx,c.cy,9*dpr,0,Math.PI*2); ctx.stroke(); }
    drawMarker(ctx, c.cx, c.cy, MARK_COLORS[m.kind]||'#E63946', m.name, dpr);
  });
  const R = course.ruler;
  if(R.length>1){
    ctx.strokeStyle = '#8338EC'; ctx.lineWidth = 3*dpr; ctx.beginPath();
    R.forEach((p,i)=>{ const c=toCanvas(p); if(i) ctx.lineTo(c.cx,c.cy); else ctx.moveTo(c.cx,c.cy); });
    ctx.stroke();
    const c = toCanvas(R[R.length-1]);
    ctx.fillStyle = themeColor('--text','#EAF3F2'); ctx.font = `700 ${11*dpr}px Inter, sans-serif`; ctx.textAlign='left';
    ctx.fillText(rulerSummary(), c.cx+8*dpr, c.cy-10*dpr);
  }
}

function bahnRedraw(){
  bahnDrawLeaflet(); bahnTick();
  const rc = document.getElementById('toolRulerClear'); if(rc) rc.style.display = course.ruler.length ? '' : 'none';
}
function fitCourse(){
  if(!leafletMap) return;
  const pts = [];
  [lineBoat, linePin, markPos].forEach(p=>{ if(p) pts.push([p.lat,p.lon]); });
  course.marks.forEach(m=>pts.push([m.lat,m.lon]));
  if(pts.length>1) leafletMap.fitBounds(L.latLngBounds(pts), { padding:[30,30] });
}

/* ---------------- Initialisierung (vom Hauptskript aufgerufen) ---------------- */
function bahnInit(){
  loadCourseAndLake();
  document.getElementById('crsType').value = course.type;
  document.getElementById('crsLeg').value = course.leg;
  document.getElementById('crsLaps').value = course.laps;
  document.getElementById('crsFleet').value = course.fleet;
  ['crsType','crsLeg','crsLaps','crsFleet'].forEach(id=>document.getElementById(id).addEventListener('change', ()=>{ readCourseForm(); persistCourse(); }));
  document.getElementById('crsLoadLake').addEventListener('click', loadLakeHere);
  document.getElementById('crsAuto').addEventListener('click', ()=>autoCourse(false));
  document.getElementById('crsRealign').addEventListener('click', ()=>autoCourse(true));
  document.getElementById('crsShift').addEventListener('click', ()=>autoCourse(true));
  document.getElementById('crsClear').addEventListener('click', function(){
    if(this.dataset.armed==='1'){ this.dataset.armed='0'; this.textContent='🗑 Bahn löschen'; clearCourse(); }
    else { this.dataset.armed='1'; this.textContent='Nochmal tippen = löschen'; setTimeout(()=>{ this.dataset.armed='0'; this.textContent='🗑 Bahn löschen'; }, 3500); }
  });
  document.getElementById('toolMark').addEventListener('click', ()=>setMapTool('tonne'));
  document.getElementById('toolRuler').addEventListener('click', ()=>setMapTool('lineal'));
  document.getElementById('toolMove').addEventListener('click', ()=>setMapTool('bahn'));
  document.getElementById('toolRulerClear').addEventListener('click', ()=>{ course.ruler = []; persistCourse(); bahnRedraw(); });
  document.getElementById('navPrev').addEventListener('click', ()=>stepTarget(-1));
  document.getElementById('navNext').addEventListener('click', ()=>stepTarget(1));
  if(lake) setCourseHint(`Ufer gespeichert: ${lake.name}` + (course.seq.length ? ` · ${COURSE_NAMES[course.type]} ausgelegt` : ''));
}
/* Leaflet-Karte existiert: Tap-Handler + Ebenen */
function bahnAttachLeaflet(){
  leafletMap.on('click', e=>{ if(mapToolMode) onMapTap(e.latlng.lat, e.latlng.lng); });
  bahnDrawLeaflet();
}
