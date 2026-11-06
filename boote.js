/* =====================================================================
   SegelComp – Bootsprofile mit Polaren
   ---------------------------------------------------------------------
   Die Polardaten stammen 1:1 aus der Regattakoje (Seesport-Trainer,
   index.html → CLASSES / polarSpeed / opt). Gleiche Struktur, damit
   beide Programme später eine gemeinsame boote.json lesen können.

   pol[i]   = Faktor auf vRef bei TWA = POL_A[i]
   vRef     = Bootsspeed (kn) bei 10 kn TWS und TWA 75–90°
   vExp     = Exponent für die Windabhängigkeit: v ~ (TWS/10)^vExp
   spiA/spiM= Spinnaker-/Gennaker-Faktor je TWA (nur wenn spi gesetzt)
   turn     = Wende-/Halsedauer im Spiel (s) – hier Info für Laylines
   ACHTUNG: Spielphysik = Schätzwerte, nicht gemessen. Vor Regatten mit
   eigenen Messfahrten kalibrieren.
   ===================================================================== */
const POL_A = [0,25,32,38,45,52,60,75,90,110,125,140,155,170,180];
const SPI_A = [0,60,75,90,110,130,150,165,180];

const BOAT_POLARS = {
  k2:   { name:'Topcat K2 (Kat)', key:'topcat', len:5.18, vRef:8.4, vExp:0.6, spi:'genn',
          pol:[0,0.02,0.18,0.5,0.75,0.87,0.94,1.0,1.05,1.06,1.0,0.9,0.76,0.62,0.56],
          spiM:[0.5,0.6,0.88,1.06,1.16,1.2,1.12,1.02,0.97], turn:[7,12] },
  zk10: { name:'Kutter ZK 10', key:'zk10', len:7.5, vRef:4.6, vExp:0.55, spi:'spi',
          pol:[0,0.03,0.3,0.6,0.8,0.9,0.96,1.0,1.02,1.02,0.98,0.92,0.85,0.8,0.78],
          spiM:[0.5,0.55,0.8,1.04,1.15,1.22,1.25,1.22,1.18], turn:[6,8] },
  k6:   { name:'Kutter K6', key:'k6', len:5.5, vRef:4.5, vExp:0.55, spi:'spi',
          pol:[0,0.03,0.32,0.62,0.81,0.9,0.96,1.0,1.02,1.02,0.98,0.92,0.85,0.8,0.78],
          spiM:[0.5,0.55,0.8,1.04,1.15,1.22,1.25,1.22,1.18], turn:[8,10] },
  ixy:  { name:'Ixylon', key:'ixylon', len:5.1, vRef:5.0, vExp:0.5, spi:'spi',
          pol:[0,0.05,0.37,0.69,0.85,0.93,0.97,1.0,1.02,1.02,0.97,0.9,0.82,0.76,0.74],
          spiM:[0.5,0.55,0.8,1.04,1.15,1.21,1.24,1.21,1.17], turn:[11,15] },
  jolle:{ name:'Zweimann-Jolle (470-ähnlich)', key:'jolle', len:4.7, vRef:5.4, vExp:0.5, spi:'spi',
          pol:[0,0.05,0.38,0.70,0.86,0.93,0.97,1.0,1.02,1.02,0.97,0.90,0.82,0.76,0.74],
          spiM:[0.5,0.55,0.8,1.05,1.17,1.24,1.27,1.24,1.2], turn:[13,17] },
  opti: { name:'Optimist', key:'opti', len:2.31, vRef:3.3, vExp:0.42, spi:null,
          pol:[0,0.05,0.4,0.72,0.88,0.94,0.97,1.0,1.0,0.98,0.95,0.92,0.89,0.86,0.85], turn:[22,18] }
};

function polInterp(xs, ys, x){
  if(x <= xs[0]) return ys[0];
  for(let i=1;i<xs.length;i++){
    if(x <= xs[i]){ const t=(x-xs[i-1])/(xs[i]-xs[i-1]); return ys[i-1]+(ys[i]-ys[i-1])*t; }
  }
  return ys[ys.length-1];
}
function polClamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

/* Zielgeschwindigkeit (kn) – identisch zur Regattakoje-Formel */
function polarSpeed(bp, tws, twa, useSpi){
  const aa = Math.abs(twa);
  let v = bp.vRef * Math.pow(polClamp(tws,1,30)/10, bp.vExp);
  if(bp.key==='opti') v *= 1 - polClamp((tws-14)/24, 0, 0.2);
  const f = polInterp(POL_A, bp.pol, aa);
  const sm = (bp.spi && useSpi) ? polInterp(SPI_A, bp.spiM, aa) : 1;
  return v * f * sm;
}

/* Optimale VMG-Winkel je Windstärke (gecacht) */
const _optCache = new Map();
function polarOpt(bp, tws){
  const tw = Math.round(polClamp(tws,1,30)*2)/2;
  const k = bp.key+'|'+tw;
  let r = _optCache.get(k);
  if(!r){
    let up=45, vu=-1, down=160, vd=-1;
    for(let a=30;a<=70;a++){ const v=polarSpeed(bp,tw,a,false)*Math.cos(a*Math.PI/180); if(v>vu){vu=v;up=a;} }
    for(let a=110;a<=180;a++){ const v=-polarSpeed(bp,tw,a,true)*Math.cos(a*Math.PI/180); if(v>vd){vd=v;down=a;} }
    r = { up, down, vmgUp:vu, vmgDown:vd, vUp:polarSpeed(bp,tw,up,false), vDown:polarSpeed(bp,tw,down,true) };
    _optCache.set(k, r);
  }
  return r;
}

/* Kompakte Tabelle für die Uhr: Zielspeed je TWS × TWA + optimale Winkel */
const WATCH_TWS = [4,6,8,10,12,14,16,20,25];
function polarTableForWatch(bp){
  return {
    tws: WATCH_TWS,
    twa: POL_A,
    spd: WATCH_TWS.map(t=>POL_A.map(a=>Math.round(polarSpeed(bp,t,a,a>=110)*100)/100)),
    up:  WATCH_TWS.map(t=>polarOpt(bp,t).up),
    down:WATCH_TWS.map(t=>polarOpt(bp,t).down)
  };
}
