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
