# Audio-Schnitt: MP3s automatisch laut Schnittliste schneiden

Mit `schneide_audios.py` lassen sich beliebig viele MP3-Dateien in einem
Durchlauf schneiden. Was herausgeschnitten werden soll, steht in einer
einfachen Tabelle (CSV), z.B. „schneide Minute 0:00–0:06 raus".

Das Schneiden erfolgt **verlustfrei** (kein Neukodieren, keine
Qualitätsverschlechterung). Die Originaldateien bleiben unverändert; die
geschnittenen Versionen landen in einem eigenen Ordner.

## Voraussetzungen

- Python 3 (ohne Zusatzpakete)
- [ffmpeg](https://ffmpeg.org/) (inkl. ffprobe) im PATH
  - Windows: `winget install ffmpeg` oder von ffmpeg.org laden
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

## Schnittliste anlegen

Eine Textdatei `schnittliste.csv` (Komma **oder** Semikolon als Trennzeichen —
Excel-Export funktioniert direkt) mit zwei Spalten:

```csv
datei,entfernen
lektion01.mp3,0:00-0:06
lektion02.mp3,0:12-0:15 1:03-1:10
lektion03.mp3,2:30-ende
```

- **datei**: Dateiname der MP3 (liegt im Eingangsordner)
- **entfernen**: ein oder mehrere Zeitbereiche, die herausgeschnitten werden.
  Mehrere Bereiche einfach mit Leerzeichen trennen.
- Zeitformate: `M:SS`, `H:MM:SS`, reine Sekunden (`6` oder `6.5`) sowie
  das Schlüsselwort `ende` für das Dateiende.

## Ausführen

Alle MP3s und die `schnittliste.csv` in einen Ordner legen, dort:

```bash
python3 schneide_audios.py schnittliste.csv
```

Die geschnittenen Dateien liegen danach unter `geschnitten/` mit unverändertem
Dateinamen. Optional:

```bash
python3 schneide_audios.py schnittliste.csv --eingang originale/ --ausgang fertig/
```

## Beispielausgabe

```
OK      lektion01.mp3: entfernt [0:00-0:06]  (30.0 s -> 24.0 s)
OK      lektion02.mp3: entfernt [0:12-0:15, 1:03-1:10]  (90.0 s -> 80.0 s)

Fertig: 2 von 2 Dateien geschnitten.
```

Fehler (Datei fehlt, ungültige Zeitangabe …) werden pro Datei gemeldet;
die übrigen Dateien werden trotzdem verarbeitet.

## Hinweis zur Genauigkeit

Beim verlustfreien Schneiden wird an MP3-Frame-Grenzen getrennt. Die
Genauigkeit liegt daher bei ca. 26 Millisekunden — für Sprach- und
Lernaudios praktisch nicht wahrnehmbar.

---

# Website-Screenshots: Seiten automatisch als PNG sichern

Mit `website_screenshots.js` lassen sich beliebig viele Webadressen in einem
Durchlauf aufrufen und jeweils die erste Seite als PNG in fester Breite
(Standard: **210 px**) speichern — z.B. als Vorschaubilder für H5P-Sequenzen.

Aufgenommen wird **nur der Seiteninhalt**: Der Browser läuft unsichtbar im
Hintergrund, im Bild ist also weder Adressleiste noch Taskleiste zu sehen.

Die Seite wird zuerst in voller Größe gerendert (Standard: 1280×800 bei
doppelter Auflösung) und danach proportional auf die Zielbreite verkleinert.
Durch dieses Verkleinern in mehreren Schritten bleibt das kleine Bild scharf
und ruhig — deutlich besser, als den Browser direkt auf 210 px zu quetschen.

## Voraussetzungen

- [Node.js](https://nodejs.org/) 18 oder neuer
- Playwright inkl. Chromium:

```bash
npm install -g playwright
npx playwright install chromium
```

Eine Bildbearbeitung (ImageMagick o.ä.) wird **nicht** benötigt; das
Verkleinern übernimmt der Browser selbst.

## Adressliste anlegen

Eine Textdatei `adressen.txt` mit einer Adresse pro Zeile:

```text
# Kommentare und Leerzeilen werden ignoriert
https://player2.zav.westermann.de/player/v1/ui?preview=true&consumerId=...&sequenceId=68527352a7109f6182c5fee9&type=sequence&reda=true
https://example.org/seite | urlaub-in-oesterreich
```

Hinter einem `|` lässt sich optional ein eigener Dateiname angeben (ohne
`.png`). Ohne Angabe wird der Name aus der Adresse abgeleitet: bevorzugt aus
`sequenceId`, `contentId` oder `id`, sonst aus Hostname und Pfad. Gleiche
Namen werden automatisch mit `-2`, `-3` … unterschieden.

## Ausführen

```bash
node website_screenshots.js adressen.txt
```

Die Bilder liegen danach unter `screenshots/`. Einzelne Adressen gehen auch
direkt:

```bash
node website_screenshots.js "https://example.org/" "https://example.com/"
```

## Optionen

| Option | Bedeutung |
| --- | --- |
| `--ausgang ORDNER` | Zielordner (Standard: `screenshots`) |
| `--breite PX` | Breite des fertigen PNG (Standard: `210`) |
| `--fenster BxH` | Renderfläche des Browsers (Standard: `1280x800`) |
| `--ganze-seite` | gesamte scrollbare Seite statt nur der ersten Ansicht |
| `--warten MS` | zusätzliche Wartezeit nach dem Laden (Standard: `3000`) |
| `--warten-auf SEL` | zusätzlich auf ein CSS-Element warten, z.B. `.h5p-content` |
| `--zeitlimit MS` | Zeitlimit je Adresse (Standard: `60000`) |
| `--parallel N` | gleichzeitig geöffnete Seiten (Standard: `3`) |
| `--aufloesung N` | Aufnahme-Auflösung vor dem Verkleinern (Standard: `2`) |
| `--nummerieren` | Dateinamen mit laufender Nummer versehen (`01_`, `02_`, …) |

Das Seitenverhältnis ergibt sich aus `--fenster`: 1280×800 ergibt bei 210 px
Breite ein Bild von 210×131 px.

## Beispielausgabe

```
OK      68527352a7109f6182c5fee9.png  (31.1 kB)  <- https://player2.zav.westermann.de/player/v1/ui?...
OK      urlaub-in-oesterreich.png  (28.4 kB)  <- https://example.org/seite
FEHLER  beispiel.png: page.goto: net::ERR_CONNECTION_REFUSED  <- http://beispiel.invalid/

Fertig: 2 von 3 Screenshots erstellt (Breite 210 px, Ordner "screenshots").
```

Fehlerhafte Adressen werden einzeln gemeldet; alle übrigen werden trotzdem
verarbeitet.

## Tipps für H5P-Inhalte

H5P-Seiten laden ihre Inhalte per JavaScript nach. Wenn das Bild leer oder
nur halb aufgebaut wirkt, hilft mehr Wartezeit oder ein gezieltes Warten auf
ein Element:

```bash
node website_screenshots.js adressen.txt --warten 8000
node website_screenshots.js adressen.txt --warten-auf ".h5p-content"
```
