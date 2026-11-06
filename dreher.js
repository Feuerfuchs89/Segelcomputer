/* =====================================================================
   SegelComp – Winddreher aus dem eigenen Kurs
   ---------------------------------------------------------------------
   Statt Kurs gegen eine gespeicherte Richtung zu vergleichen, wird der
   Wind aus dem eigenen Kurs gemessen – getrennt nach Bug:
       Steuerbordbug (Wind von rechts):  Wind = Kurs + Soll-Winkel
       Backbordbug   (Wind von links):   Wind = Kurs − Soll-Winkel
   (am Wind mit dem Am-Wind-Winkel, vorm Wind mit dem Vorwind-Winkel).
   Bezug = Mittel der Messungen der letzten 10 Minuten aus beiden Bugen
   → Mitte der Pendelbewegung; Abdrift/Montagefehler heben sich auf.
   Gelifted/geheaded: Rechtsdreher liftet auf Steuerbord, headet auf
   Backbord – Linksdreher umgekehrt (am Wind wie vorm Wind).
   Die Windquelle (Pingen/Internet/Manuell) liefert nur den Startwert.
   ===================================================================== */
const DREHER_WINDOW_MS = 10*60*1000;
const DREHER = { samples:[], courseBuf:[], lastPush:0, lastManeuverT:0, state:null };

function dreherCircMean(degs){
  let x=0, y=0;
  for(const d of degs){ x += Math.cos(d*Math.PI/180); y += Math.sin(d*Math.PI/180); }
  return (Math.atan2(y,x)*180/Math.PI + 360) % 360;
}
function dreherNorm(d){ return ((d%360)+360)%360; }
function dreherNoteManeuver(){ DREHER.lastManeuverT = Date.now(); }
function dreherReset(){
  DREHER.samples = []; DREHER.lastPush = 0;
  showToast('Winddreher: Referenz zurückgesetzt – misst neu.');
}
/* Bezug: eigene Messung, sobald ≥ 1 Minute Daten da sind – sonst die Windquelle */
function dreherBase(){
  const s = DREHER.samples;
  const span = s.length ? s[s.length-1].t - s[0].t : 0;
  if(s.length >= 30 && span >= 60000) return { dir:dreherCircMean(s.map(x=>x.w)), src:'gemessen', min:span/60000 };
  if(windRef !== null) return { dir:windRef, src: windSource==='live' ? 'Internet' : windSource==='manual' ? 'manuell' : 'gepingt' };
  return null;
}
function dreherUpdate(course, sog){
  const now = Date.now();
  if(course !== null){ DREHER.courseBuf.push({ t:now, c:course }); }
  while(DREHER.courseBuf.length && now - DREHER.courseBuf[0].t > 8000) DREHER.courseBuf.shift();
  while(DREHER.samples.length && now - DREHER.samples[0].t > DREHER_WINDOW_MS) DREHER.samples.shift();

  const base = dreherBase();
  if(!base || course === null){ DREHER.state = { status:'nowind' }; return DREHER.state; }
  const twa = angleDiff(course, base.dir), a = Math.abs(twa);
  const tack = twa < 0 ? 'stb' : 'bb';
  const leg = a < 75 ? 'up' : a > 115 ? 'down' : 'reach';
  // Kursunruhe: größte Abweichung vom Mittel der letzten 8 s
  const cm = DREHER.courseBuf.length ? dreherCircMean(DREHER.courseBuf.map(b=>b.c)) : course;
  const spread = DREHER.courseBuf.reduce((m,b)=>Math.max(m, Math.abs(angleDiff(b.c, cm))), 0);

  let status = 'ok';
  if(leg === 'reach') status = 'reach';
  else if(sog === null || sog < 2) status = 'slow';
  else if(now - DREHER.lastManeuverT < 15000) status = 'maneuver';
  else if(spread > 8) status = 'unsteady';

  const ang = currentAngles(), opt = leg === 'up' ? ang.up : ang.down;
  if(status === 'ok' && now - DREHER.lastPush >= 1000){
    DREHER.samples.push({ t:now, w:dreherNorm(course - Math.sign(twa)*opt) });
    DREHER.lastPush = now;
  }
  // aktueller gemessener Wind = Mittel der letzten 12 s
  const recent = DREHER.samples.filter(x=>now - x.t <= 12000);
  const st = { status, tack, leg, base, twa };
  if(status === 'ok' && recent.length >= 3){
    st.cur = dreherCircMean(recent.map(x=>x.w));
    st.shift = angleDiff(st.cur, base.dir);
    const liftSign = tack === 'stb' ? 1 : -1;
    st.lift = Math.abs(st.shift) < 3 ? 'neutral' : (st.shift*liftSign > 0 ? 'lift' : 'head');
  }
  // Pendelbereich (10.–90. Perzentil) und grobe Periode über Nulldurchgänge
  if(base.src === 'gemessen'){
    const dev = DREHER.samples.map(x=>angleDiff(x.w, base.dir)).sort((p,q)=>p-q);
    const q = f => dev[Math.min(dev.length-1, Math.floor(f*dev.length))];
    st.range = [dreherNorm(base.dir + q(0.1)), dreherNorm(base.dir + q(0.9))];
    let cross = 0, side = 0;
    for(const x of DREHER.samples){
      const d = angleDiff(x.w, base.dir);
      const s = d > 2 ? 1 : d < -2 ? -1 : 0;
      if(s && side && s !== side) cross++;
      if(s) side = s;
    }
    if(cross >= 2) st.periodMin = 2*base.min/cross;
  }
  DREHER.state = st;
  return st;
}
/* Anzeige im Taktik-Tab */
function dreherRender(st){
  const valEl = document.getElementById('shiftVal'), flagEl = document.getElementById('shiftFlag'), infoEl = document.getElementById('shiftInfo');
  const flag = (bg, fg, txt)=>{ flagEl.style.background = bg; flagEl.style.color = fg; flagEl.textContent = txt; };
  const msgs = {
    nowind:   'Erst Wind setzen (Pingen, Internet oder Manuell)',
    reach:    'Dreher nur am Wind oder vorm Wind',
    slow:     'Zu langsam für die Messung (unter 2 kn)',
    maneuver: 'Manöver – Messung kurz pausiert',
    unsteady: 'Kurs unruhig – Messung pausiert'
  };
  if(st.status !== 'ok' || st.shift === undefined){
    valEl.textContent = '–';
    flag('var(--line)', 'var(--dim)', msgs[st.status] || 'Messe …');
  } else {
    const side = st.tack === 'stb' ? 'Steuerbordbug' : 'Backbordbug';
    const dirTxt = Math.abs(st.shift) < 1 ? 'Wind stabil' : `Wind ${Math.round(Math.abs(st.shift))}° ${st.shift > 0 ? 'rechts' : 'links'}`;
    if(st.lift === 'lift'){ valEl.textContent = 'GELIFTED ' + Math.round(Math.abs(st.shift)) + '°'; flag('var(--green)', 'var(--ink)', `${dirTxt} · ${side} · dranbleiben`); }
    else if(st.lift === 'head'){ valEl.textContent = 'GEHEADED ' + Math.round(Math.abs(st.shift)) + '°'; flag('var(--red)', '#fff', `${dirTxt} · ${side} · ${st.leg==='up'?'Wende':'Halse'} überlegen`); }
    else { valEl.textContent = 'NEUTRAL'; flag('var(--line)', 'var(--dim)', `${dirTxt} · ${side}`); }
  }
  if(infoEl){
    const b = st.base;
    if(!b) infoEl.textContent = '';
    else if(b.src === 'gemessen'){
      let t = `Bezug ${Math.round(b.dir)}° · gemessen über ${Math.round(b.min)} min`;
      if(st.range) t += ` · pendelt ${Math.round(st.range[0])}°–${Math.round(st.range[1])}°`;
      if(st.periodMin) t += ` · ca. alle ${Math.round(st.periodMin)} min`;
      infoEl.textContent = t;
    } else infoEl.textContent = `Bezug ${Math.round(b.dir)}° (${b.src}) – eigene Messung übernimmt nach 1 min am oder vorm Wind.`;
  }
}
