# ⛵ SegelComp – Regatta-Computer (Prototyp v4)

Ein mobiler Regatta- und Segel-Computer als installierbare Web-App (PWA) –
läuft direkt im Browser, ganz ohne App Store. Startzeit-Timer, Wind- &
Kompassanzeige, Startlinien-/Taktikhilfe, GPS-Tracklog und eine Offline-Karte
in einer einzigen `index.html`.

## Features

- **Start-Timer** mit Presets, akustischem & Vibrations-Alarm
- **Windanzeige** mit Kompass-Rose, TWA/AWA, Vollbildmodus per Doppel-Tap
- **Taktik-Ansicht** für Schifting/Lift-Erkennung
- **Startlinien-Hilfe** (Boot/Pin, Bias-Anzeige, Luvtonnen-Peilung)
- **GPS-Tracklog** mit farbcodierter Geschwindigkeit, Speicherung vergangener
  Läufe und Overlay-Vergleich
- **Karte**: echte OSM-Karte (Leaflet) oder Offline-Fallback-Canvas
- **Hell-/Dunkel-/Nachtrot-Modus**, Boots-/Wind-Profile, verschiedene
  Montage-Modi
- **Bootsprofile mit Polaren** aus der Regattakoje (Topcat K2, Kutter ZK 10,
  Kutter K6, Ixylon, Jolle, Optimist): Zielspeed, Leistung in %, Ziel-VMG,
  Soll-Winkel stufenlos über die Windstärke (`boote.js`)
- **Trainingsbahn** (`bahn.js`): Ufer aus OpenStreetMap laden, Up-and-Down /
  Leetor / Ablauftonne / Dreieck automatisch nach dem Wind ausrichten und mit
  Abstand zu Ufer und Inseln auf den See legen, Tonnen setzen/ziehen/löschen,
  Lineal, nächste Tonne mit Laylines und automatischer Rundungserkennung
- **Uhr als Fernbedienung** per Web Bluetooth (`uhr.js`, Chrome auf Android):
  Das Handy ist GPS-Empfänger und rechnet alles, die Uhr zeigt fertige Werte
  an und schickt Befehle (Timer, Pingen, Tonnen, Aufzeichnung, Sperren) –
  Protokoll in `UHR-PROTOKOLL.md`
- **Winddreher aus dem eigenen Kurs** (`dreher.js`): Wind je Bug gemessen,
  10-Minuten-Bezug, gelifted/geheaded, Pendelbereich
- **Taschenmodus** (`tasche.js`): schwarzer Sperrbildschirm, Display bleibt
  wach, Montage „In der Tasche“ (nur GPS-Kurs)
- **Anleitung** in der App (❓ oben rechts)
- Als **Progressive Web App (PWA)**: installierbar auf dem Homescreen,
  App-Shell wird per Service Worker gecacht und startet auch offline

## Live nutzen / installieren

### Auf dem Handy (empfohlen)

1. Repo per GitHub Pages veröffentlichen (siehe unten) oder die Datei
   direkt öffnen.
2. Seite im Browser öffnen (Safari auf iOS, Chrome auf Android).
3. **iOS (Safari):** Teilen-Symbol → „Zum Home-Bildschirm“.
   **Android (Chrome):** Menü (⋮) → „App installieren“ /
   „Zum Startbildschirm hinzufügen“.
4. Das SegelComp-Icon erscheint auf dem Homescreen und startet die App im
   Vollbildmodus – ganz ohne Browser-Leiste.

### Lokal testen

Da die App einen Service Worker registriert, muss sie über `http://` bzw.
`https://` ausgeliefert werden (nicht per Doppelklick als `file://`, da
Service Worker dort nicht funktionieren). Am einfachsten mit einem simplen
lokalen Server, z. B.:

```bash
# Python (im Projektordner ausführen)
python3 -m http.server 8080
# dann im Browser öffnen:
# http://localhost:8080
```

## Auf GitHub veröffentlichen (GitHub Pages)

```bash
git init
git add .
git commit -m "Initial commit: SegelComp Regatta-Computer"
git branch -M main
git remote add origin https://github.com/<dein-username>/<dein-repo>.git
git push -u origin main
```

Danach in den Repo-Einstellungen **Settings → Pages** aktivieren:
- Source: `Deploy from a branch`
- Branch: `main` / `/ (root)`

Nach ein bis zwei Minuten ist die App unter
`https://<dein-username>.github.io/<dein-repo>/` erreichbar.

## Projektstruktur

```
├── index.html               # App (Oberfläche + Hauptlogik)
├── boote.js                 # Bootspolaren (aus der Regattakoje)
├── bahn.js                  # Trainingsbahn, Tonnen, Lineal, Navigation
├── uhr.js                   # Bluetooth-Brücke zur Smartwatch
├── dreher.js                # Winddreher aus dem eigenen Kurs
├── tasche.js                # Taschenmodus
├── UHR-PROTOKOLL.md         # Nachrichtenformat für die Uhr-Firmware
├── favicon-16.png, favicon-32.png, apple-touch-icon.png
└── icon-192.png, icon-512.png, icon-maskable-512.png   # App-Icon (alles im Hauptordner, keine Unterordner)
├── manifest.webmanifest     # PWA-Manifest (Name, Icons, Farben)
├── sw.js                    # Service Worker für Offline-App-Shell
```

## Technik

- Kein Build-Prozess, keine Abhängigkeiten – reines HTML/CSS/JavaScript
- Externe Ressourcen (nur bei Online-Nutzung benötigt):
  [Leaflet](https://leafletjs.com/) für die echte Karte (CDN),
  [OpenStreetMap](https://www.openstreetmap.org/)-Kacheln,
  [Open-Meteo](https://open-meteo.com/) für Live-Winddaten,
  [Overpass-API](https://overpass-api.de/) für die Uferlinie (einmalig, dann lokal gespeichert),
  Google Fonts (Space Grotesk / Inter)
- Alle Nutzerdaten (Profile, gespeicherte Läufe, Referenzpunkte,
  Einstellungen) liegen ausschließlich lokal im `localStorage` des Geräts

## Hinweis

Dies ist ein **Prototyp** für den eigenen Gebrauch auf dem Wasser – ohne
Gewähr für Navigations- oder Regatta-Entscheidungen. Immer zusätzlich
gesunden Menschenverstand und offizielle Regeln/Instrumente verwenden.

## Lizenz

Siehe [LICENSE](LICENSE).
