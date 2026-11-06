# SegelComp ↔ Uhr – Bluetooth-Protokoll v2

Für die Firmware der LilyGo T-Watch S3 Plus.

**Rollenverteilung:** Das Handy liegt wasserdicht verpackt an Bord. Es ist GPS-Empfänger, holt den Wind aus dem Internet und rechnet alles: Polaren, Winddreher, Bahn, Laylines und Timer. Die Uhr **zeigt die fertigen Werte nur an** und **schickt Tastendrücke als Befehle** zurück. Sie braucht kein eigenes GPS und keine Segellogik.

## Verbindung

- Die Uhr ist **BLE-Peripheral** mit dem **Nordic UART Service (NUS)**:
  - Service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
  - RX `6e400002-…` (write): **Handy → Uhr**
  - TX `6e400003-…` (notify): **Uhr → Handy**
- Gerätename mit `SegelUhr` beginnen (z. B. `SegelUhr-Micha`).
- Die App (Chrome auf Android, Web Bluetooth) verbindet sich nach einem Abbruch von selbst neu.

## Format

- Eine Nachricht = **eine Zeile JSON + `\n`**.
- Das Handy schreibt in Stücken von **≤ 180 Byte**. Die Uhr sammelt bis `\n` und parst dann (z. B. mit ArduinoJson). Puffer 1 KB.
- Winkel in ° (wahr), Speed in kn, Distanz in m. `null` = kein Wert (Anzeige „–“).

## Handy → Uhr

### `hello` – nach dem Verbinden
`{"t":"hello","v":2,"app":"SegelComp","now":<Unix-ms>,"tz":60}`. Damit stellt die Uhr ihre Zeit.

### `boat` – beim Verbinden und bei Bootswechsel
`{"t":"boat","id":"zk10","name":"Kutter ZK 10"}`

### `timer` – bei Start, Sync, Preset
- läuft: `{"t":"timer","run":true,"end":<Unix-ms des Starts>}`. Die Uhr zählt selbst flüssig herunter (negativ = seit dem Start).
- steht: `{"t":"timer","run":false,"sec":300}`

### `disp` – jede Sekunde, alles zum Anzeigen

| Feld | Bedeutung |
|---|---|
| `gps` | 1 = Handy hat GPS-Fix |
| `sog`, `cog` | Speed und Kurs über Grund (gefiltert) |
| `wind` | `{dir, tws, src}`: Windrichtung (aus), Windstärke, Quelle `ping`/`live`/`manual` |
| `twa` | Windwinkel mit Vorzeichen (− = Wind von Steuerbord) |
| `zone` | `{k, c, l, poS}`: Zonenschlüssel, **Farbe als Hex** für den Hintergrund, Text („Sweet Spot – Amwind“), Kurs („Amwind“) |
| `soll` | Soll-TWA (nur am/vorm Wind, sonst `null`) |
| `tgt`, `perf` | Zielspeed laut Polare und Leistung in % |
| `vmg` | VMG (kn) |
| `shift` | Winddreher `{s, tack, d, l}`: `s` Status (`ok`, `nowind`, `reach`, `slow`, `maneuver`, `unsteady`), `tack` `stb`/`bb`, `d` Dreher in ° (+ = rechts), `l` `lift`/`head`/`neutral` |
| `nav` | Nächste Tonne `{n, i, of, d, b, lay, up, luv}`: Name, Nummer i von `of`, Distanz, Peilung, Layline-Abstand (< 0 noch nicht, ≈ 0 Layline, > 0 übersegelt), `up` 1 = Kreuz, `luv` Abstand zur Tonne in Windrichtung (m, + = Tonne in Luv) – „Lineal“-Wert zum Vergleich mit anderen Booten |
| `line` | Startlinie `{d, bias, fav}`: Abstand zur Linie, Linienvorteil in °, bevorzugtes Ende `boot`/`pin`/`null` |
| `rec` | 1 = Aufzeichnung läuft |
| `lock` | 1 = Handy im Taschenmodus |

Beispiel:
```
{"t":"disp","gps":1,"sog":4.6,"cog":193,"rec":0,"lock":1,"wind":{"dir":240,"tws":12.4,"src":"live"},"twa":-47,"zone":{"k":"green","c":"#1DB954","l":"Sweet Spot – Amwind","poS":"Amwind"},"soll":49,"tgt":4.1,"perf":112,"vmg":3.1,"shift":{"s":"ok","tack":"stb","d":6,"l":"lift"},"nav":{"n":"Luvtonne","i":1,"of":6,"d":412,"b":228,"lay":-18,"up":1},"line":{"d":85,"bias":4,"fav":"pin"}}
```

### `ok` / `err` – Antwort auf jeden Befehl
`{"t":"ok","a":"pingMark","msg":"Luvtonne gesetzt"}` bzw. `{"t":"err","a":"pingMark","msg":"Kein GPS"}`. Die Uhr zeigt `msg` kurz an und vibriert.

## Uhr → Handy (notify)

### `btn` – Befehle

| `a` | Wirkung |
|---|---|
| `sync` (= `start`) | Timer starten; läuft er, auf die nächste volle Minute ziehen |
| `preset` + `min` | Timer auf X Minuten stellen (gestoppt) |
| `ping` | Wind pingen (aktueller Kurs) |
| `pingBoat` / `pingPin` | Boot- bzw. Pin-Ende der Startlinie an der aktuellen Position setzen |
| `pingMark` | Luvtonne an der aktuellen Position setzen |
| `next` / `prev` | nächste/vorige Tonne als Ziel |
| `realign` | Trainingsbahn um die Startlinie auf den aktuellen Wind drehen |
| `rec` | Aufzeichnung an/aus |
| `shiftReset` | Winddreher-Referenz neu messen |
| `lock` / `unlock` | Taschenmodus am Handy an/aus |

Beispiel: `{"t":"btn","a":"preset","min":5}`

### `stat` – etwa alle 30 s
`{"t":"stat","bat":87}`: Akkustand der Uhr, wird am Handy angezeigt.

### `need`
Die Uhr bittet um den kompletten Stand (z. B. nach einem Neustart). Das Handy schickt `boat`, `timer` und `disp` sofort.

## Hinweise für die Firmware

- Kommt länger als 3 s kein `disp`, Werte grau oder als „–“ zeigen und „Handy?“ einblenden.
- Den Timer aus `end` und der eigenen Uhrzeit rechnen, nicht aus `disp`. So läuft er flüssig, auch wenn mal eine Nachricht fehlt.
- Vibrationsmuster bei `shift.l` lift → head, bei `nav.lay` um 0 (Layline) und beim Timer (3:00, 1:00, 0:30, letzte 5 s, Start).
