/* =====================================================================
   SegelComp – Bluetooth-Brücke zur Uhr (LilyGo T-Watch S3 Plus)
   ---------------------------------------------------------------------
   Web Bluetooth (Chrome auf Android). Die Uhr ist BLE-Peripheral mit
   dem Nordic-UART-Service (NUS). Das Handy schreibt zeilenweise JSON
   ('\n'-terminiert, in 180-Byte-Stücken) auf RX, die Uhr antwortet per
   Notify auf TX. Protokoll: siehe UHR-PROTOKOLL.md.
   Rollen: Das Handy ist GPS-Empfänger und rechnet alles; die Uhr zeigt
   fertige Werte an und schickt Tastendrücke als Befehle zurück.
   Gesendet wird nur, was sich geändert hat (Diff je Nachrichtentyp).
   Diese Datei wird VOR dem Hauptskript geladen, uhrInit() danach.
   ===================================================================== */
const UHR_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UHR_RX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Handy → Uhr (write)
const UHR_TX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Uhr → Handy (notify)
const UHR_PROTO   = 2;
const UHR_CHUNK   = 180;

const uhr = { dev:null, rx:null, tx:null, connected:false, wantConnected:false, queue:[], busy:false,
              last:{}, lastSent:{}, inBuf:'', log:[], stat:null, retry:0 };

function uhrLog(dir, line){
  uhr.log.push((dir==='out'?'→ ':'← ') + line.slice(0,160));
  if(uhr.log.length > 14) uhr.log.shift();
  const el = document.getElementById('uhrLog');
  if(el && el.style.display !== 'none') el.textContent = uhr.log.join('\n');
}
function uhrUI(){
  const dot = document.getElementById('uhrDot'), chip = document.getElementById('uhrChip'), st = document.getElementById('uhrStatus');
  dot.classList.toggle('live', uhr.connected);
  dot.classList.toggle('warn', uhr.wantConnected && !uhr.connected);
  chip.textContent = uhr.connected ? '⌚ Trennen' : '⌚ Uhr verbinden';
  chip.classList.toggle('active', uhr.connected);
  let s = uhr.connected ? 'Verbunden mit '+(uhr.dev && uhr.dev.name || 'Uhr')
        : uhr.wantConnected ? 'Verbindung verloren – verbinde neu …' : 'Nicht verbunden';
  if(uhr.connected && uhr.stat){
    if(uhr.stat.bat!=null) s += ' · Akku '+uhr.stat.bat+' %';
  }
  st.textContent = s;
}

/* ---------- Verbinden / Trennen ---------- */
async function uhrConnect(){
  if(!('bluetooth' in navigator)){
    showToast('Web Bluetooth gibt es nur in Chrome (Android/Desktop). Auf iPhone nicht verfügbar.');
    return;
  }
  try{
    const dev = await navigator.bluetooth.requestDevice({
      filters:[ { services:[UHR_SERVICE] }, { namePrefix:'SegelUhr' }, { namePrefix:'T-Watch' } ],
      optionalServices:[UHR_SERVICE]
    });
    uhr.dev = dev; uhr.wantConnected = true;
    dev.addEventListener('gattserverdisconnected', uhrOnDisconnect);
    await uhrOpen();
  }catch(e){
    if(e && e.name !== 'NotFoundError') showToast('Uhr: '+e.message);
    uhrUI();
  }
}
async function uhrOpen(){
  const server = await uhr.dev.gatt.connect();
  const svc = await server.getPrimaryService(UHR_SERVICE);
  uhr.rx = await svc.getCharacteristic(UHR_RX);
  uhr.tx = await svc.getCharacteristic(UHR_TX);
  await uhr.tx.startNotifications();
  uhr.tx.addEventListener('characteristicvaluechanged', uhrOnNotify);
  uhr.connected = true; uhr.retry = 0; uhr.lastSent = {}; uhr.queue = [];
  uhrUI();
  showToast('⌚ Uhr verbunden – Daten werden übertragen.');
  vibrate(80);
  uhrSend({ t:'hello', v:UHR_PROTO, app:'SegelComp', now:Date.now(), tz:-new Date().getTimezoneOffset() });
  uhrTick(true);
}
function uhrDisconnect(){
  uhr.wantConnected = false;
  if(uhr.dev && uhr.dev.gatt.connected) uhr.dev.gatt.disconnect();
  uhr.connected = false; uhrUI();
}
function uhrOnDisconnect(){
  uhr.connected = false; uhr.rx = uhr.tx = null; uhrUI();
  if(!uhr.wantConnected) return;
  // Bereits gekoppelte Uhr: Neuverbindung geht ohne erneutes Antippen
  const wait = Math.min(15000, 1000 * Math.pow(2, uhr.retry++));
  setTimeout(()=>{ if(uhr.wantConnected && !uhr.connected) uhrOpen().catch(()=>uhrOnDisconnect()); }, wait);
}

/* ---------- Senden (seriell, gestückelt) ---------- */
function uhrSend(obj){
  if(!uhr.connected) return;
  const line = JSON.stringify(obj);
  uhr.queue.push(line);
  if(obj.t !== 'disp' || !uhr._dispLogged || Date.now() - uhr._dispLogged > 10000){ uhrLog('out', line); if(obj.t==='disp') uhr._dispLogged = Date.now(); }
  uhrPump();
}
async function uhrPump(){
  if(uhr.busy || !uhr.rx) return;
  uhr.busy = true;
  const enc = new TextEncoder();
  try{
    while(uhr.queue.length && uhr.rx){
      const bytes = enc.encode(uhr.queue.shift() + '\n');
      for(let i=0;i<bytes.length;i+=UHR_CHUNK){
        const part = bytes.slice(i, i+UHR_CHUNK);
        if(uhr.rx.writeValueWithResponse) await uhr.rx.writeValueWithResponse(part);
        else await uhr.rx.writeValue(part);
      }
    }
  }catch(e){ uhrLog('out', '! Schreibfehler: '+e.message); }
  uhr.busy = false;
}

/* ---------- Empfangen ---------- */
function uhrOnNotify(ev){
  uhr.inBuf += new TextDecoder().decode(ev.target.value);
  let i;
  while((i = uhr.inBuf.indexOf('\n')) >= 0){
    const line = uhr.inBuf.slice(0,i).trim(); uhr.inBuf = uhr.inBuf.slice(i+1);
    if(!line) continue;
    uhrLog('in', line);
    let m; try{ m = JSON.parse(line); }catch(e){ continue; }
    uhrHandle(m);
  }
}
/* Befehle von der Uhr: alles, was man auf dem Wasser braucht. Antwort ok/err,
   damit die Uhr eine Bestätigung anzeigen kann. */
function uhrReply(a, ok, msg){ uhrSend({ t: ok ? 'ok' : 'err', a, msg }); if(msg) showToast('⌚ '+msg); }
function uhrHandle(m){
  if(m.t==='stat'){ uhr.stat = m; uhrUI(); return; }
  if(m.t==='need'){ uhr.lastSent = {}; uhrTick(true); return; }
  if(m.t!=='btn') return;
  const a = m.a, needPos = ()=>{ if(!pos){ uhrReply(a, false, 'Kein GPS'); return false; } return true; };
  switch(a){
    case 'sync': case 'start':
      { const was = timerRunning; startStopTimer(); uhrReply(a, true, was ? 'Sync: '+formatTime(timerSeconds) : 'Timer gestartet'); } break;
    case 'preset':
      clearInterval(timerInterval); timerRunning=false; timerSeconds=(m.min||5)*60; renderTimer(); uhrReply(a, true, 'Timer '+(m.min||5)+' min'); break;
    case 'ping':
      if(referenceHeading()===null){ uhrReply(a, false, 'Kein Kurs'); break; }
      pingWind(); uhrReply(a, true, 'Wind '+Math.round(windRef)+'°'); break;
    case 'pingBoat': if(needPos()){ pingLineBoatOnly(); uhrReply(a, true, 'Boot-Ende gesetzt'); } break;
    case 'pingPin':  if(needPos()){ pingLinePinOnly();  uhrReply(a, true, 'Pin-Ende gesetzt'); } break;
    case 'pingMark': if(needPos()){ pingMark(); bahnRedraw(); uhrReply(a, true, 'Luvtonne gesetzt'); } break;
    case 'next': stepTarget(1);  { const t = activeTarget(); uhrReply(a, true, t ? 'Ziel: '+t.name : 'Bahn beendet'); } break;
    case 'prev': stepTarget(-1); { const t = activeTarget(); uhrReply(a, true, t ? 'Ziel: '+t.name : 'Keine Bahn'); } break;
    case 'realign':
      if(!course.seq.length){ uhrReply(a, false, 'Keine Bahn'); break; }
      autoCourse(true); uhrReply(a, true, 'Bahn auf '+Math.round(windRef)+'° gedreht'); break;
    case 'rec': setRecordingActive(!recordingActive); uhrReply(a, true, recordingActive ? 'Aufzeichnung läuft' : 'Aufzeichnung pausiert'); break;
    case 'shiftReset': dreherReset(); uhrReply(a, true, 'Dreher-Referenz neu'); break;
    case 'lock':   pocketEnter(true); uhrReply(a, true, 'Handy gesperrt'); break;
    case 'unlock': pocketExit();      uhrReply(a, true, 'Handy entsperrt'); break;
    default: uhrReply(a, false, 'Unbekannter Befehl');
  }
  uhrTick(false);
}

/* ---------- Nachrichten bauen: die Uhr bekommt fertige Anzeigewerte ---------- */
function r1(v){ return v==null || isNaN(v) ? null : Math.round(v*10)/10; }
function r0(v){ return v==null || isNaN(v) ? null : Math.round(v); }
function uhrMsgBoat(){ return { t:'boat', id:currentProfile().id, name:currentProfile().name }; }
function uhrMsgTimer(){
  return timerRunning ? { t:'timer', run:true, end:Math.round((Date.now() + timerSeconds*1000)/1000)*1000 }
                      : { t:'timer', run:false, sec:timerSeconds };
}
function uhrMsgDisp(){
  const sog = filteredSog(), cog = filteredCog(), course = effectiveCourse();
  const m = { t:'disp', gps: gpsOk ? 1 : 0, sog:r1(sog), cog:r0(cog), rec: recordingActive ? 1 : 0, lock: pocketOn ? 1 : 0 };
  if(windRef!==null){
    m.wind = { dir:r0(windRef), tws:r1(currentTWS()), src:windSource };
    if(course!==null){
      const twaS = angleDiff(course, windRef), twa = Math.abs(twaS), z = classifyZone(twa);
      m.twa = r0(twaS);
      m.zone = { k:z.key, c:ZONE_COLORS[z.key], l:z.label, poS:z.pointOfSail };
      m.soll = z.soll;
      const tgt = targetSpeed(twa);
      m.tgt = r1(tgt);
      if(tgt && sog!==null) m.perf = r0(sog/tgt*100);
      if(sog!==null){ const rad = twa*Math.PI/180; m.vmg = r1(Math.abs(sog*Math.cos(twa<100 ? rad : Math.PI-rad))); }
    }
  }
  const st = DREHER.state;
  if(st && st.status){
    m.shift = { s:st.status, tack:st.tack||null, d:r0(st.shift), l:st.lift||null };
  }
  const t = activeTarget();
  if(t){
    const info = targetInfo(t);
    m.nav = { n:t.name, i:course.act+1, of:course.seq.length };
    if(info) Object.assign(m.nav, { d:r0(info.dist), b:r0(info.brg), lay: info.diff!=null ? r0(info.diff) : null, up: info.upwind ? 1 : 0 });
  }
  if(lineBoat && linePin){
    m.line = {};
    if(pos) m.line.d = r0(Math.abs(crossTrackDist(lineBoat, linePin, pos)));
    if(windRef!==null){
      const bias = angleDiff(bearing(lineBoat, linePin), (windRef+90)%360);
      m.line.bias = r0(Math.abs(bias));
      m.line.fav = Math.abs(bias)<3 ? null : (bias>0 ? 'pin' : 'boot');
    }
  }
  return m;
}

/* Jede Sekunde: Anzeige schicken; Boot/Timer nur bei Änderung (force = alles) */
function uhrTick(force){
  if(!uhr.connected) return;
  const send = (key, msg, same)=>{
    const prev = uhr.lastSent[key];
    if(force || !prev || !same(prev, msg)){ uhr.lastSent[key] = msg; uhrSend(msg); }
  };
  send('boat', uhrMsgBoat(), (a,b)=>a.id===b.id);
  send('timer', uhrMsgTimer(), (a,b)=>a.run===b.run && (a.run ? Math.abs(a.end-b.end)<1500 : a.sec===b.sec));
  uhrSend(uhrMsgDisp());
}

function uhrInit(){
  document.getElementById('uhrChip').addEventListener('click', ()=>{ uhr.connected || uhr.wantConnected ? uhrDisconnect() : uhrConnect(); });
  document.getElementById('uhrLogChip').addEventListener('click', ()=>{
    const el = document.getElementById('uhrLog');
    const show = el.style.display === 'none';
    el.style.display = show ? 'block' : 'none';
    document.getElementById('uhrLogChip').classList.toggle('active', show);
    if(show) el.textContent = uhr.log.length ? uhr.log.join('\n') : '(noch nichts gesendet)';
  });
  document.getElementById('uhrHeader').addEventListener('click', ()=>{ uhr.connected ? showToast('Uhr verbunden') : uhrConnect(); });
  setInterval(()=>uhrTick(false), 1000);
  uhrUI();
}
