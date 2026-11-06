/* =====================================================================
   SegelComp – Taschenmodus
   ---------------------------------------------------------------------
   Handy wasserdicht verpackt = GPS-Empfänger, die Uhr zeigt an und
   steuert. Damit Chrome GPS und Bluetooth nicht anhält, muss der
   Bildschirm an bleiben (Wake Lock). Ein schwarzer Sperrbildschirm
   fängt Berührungen durch die Tasche ab und spart bei OLED Strom.
   Entsperren: 2 s gedrückt halten – oder über die Uhr.
   ===================================================================== */
let pocketOn = false;
let pocketHoldTimer = null, pocketHoldStart = 0, pocketRaf = null;

function setMount(m){
  const chip = document.querySelector(`[data-mount="${m}"]`);
  if(chip) chip.click();
}
async function pocketEnter(fromWatch){
  if(pocketOn) return;
  pocketOn = true;
  document.getElementById('pocketOverlay').style.display = 'flex';
  if(mountMode === 'boot'){ setMount('tasche'); }
  wakeLockDesired = true;
  if(!wakeLockSentinel) await acquireWakeLock();
  updateWakeUI();
  try{ const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch(()=>{}); }catch(e){}
  pocketStatus();
  if(!fromWatch) vibrate(60);
}
function pocketExit(){
  if(!pocketOn) return;
  pocketOn = false;
  document.getElementById('pocketOverlay').style.display = 'none';
  try{ if(document.fullscreenElement === document.documentElement) document.exitFullscreen().catch(()=>{}); }catch(e){}
  vibrate(60);
}
function pocketStatus(){
  if(!pocketOn) return;
  const t = new Date().toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });
  const parts = [t, gpsOk ? 'GPS ✓' : 'GPS sucht', uhr.connected ? 'Uhr ✓' : 'Uhr –', wakeLockSentinel ? 'Display wach ✓' : 'Display-Sperre fehlt!'];
  document.getElementById('pocketInfo').textContent = parts.join(' · ');
}
function pocketHoldDown(e){
  e.preventDefault();
  pocketHoldStart = Date.now();
  const ring = document.getElementById('pocketRing');
  const step = ()=>{
    const p = Math.min(1, (Date.now()-pocketHoldStart)/2000);
    ring.style.background = `conic-gradient(#555 ${p*360}deg, transparent 0)`;
    if(p >= 1){ pocketHoldUp(); pocketExit(); return; }
    pocketRaf = requestAnimationFrame(step);
  };
  pocketRaf = requestAnimationFrame(step);
}
function pocketHoldUp(){
  cancelAnimationFrame(pocketRaf); pocketRaf = null;
  const ring = document.getElementById('pocketRing'); if(ring) ring.style.background = 'transparent';
}
function pocketInit(){
  const ov = document.getElementById('pocketOverlay');
  ov.addEventListener('pointerdown', pocketHoldDown);
  ['pointerup','pointercancel','pointerleave'].forEach(ev=>ov.addEventListener(ev, pocketHoldUp));
  ov.addEventListener('contextmenu', e=>e.preventDefault());
  document.getElementById('pocketBtn').addEventListener('click', ()=>pocketEnter(false));
  setInterval(pocketStatus, 5000);
}
