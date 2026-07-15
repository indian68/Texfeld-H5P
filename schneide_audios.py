#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Automatisches Schneiden von MP3-Dateien laut Schnittliste.

Aufruf:
    python3 schneide_audios.py schnittliste.csv [--eingang ORDNER] [--ausgang ORDNER]

Die Schnittliste ist eine CSV-Datei (Trennzeichen: Komma ODER Semikolon) mit
zwei Spalten:

    datei,entfernen
    beispiel1.mp3,0:00-0:06
    beispiel2.mp3,0:12-0:15 1:03-1:10
    beispiel3.mp3,2:30-ende

- "entfernen" enthält einen oder mehrere Zeitbereiche (durch Leerzeichen
  getrennt), die aus dem Audio HERAUSGESCHNITTEN werden.
- Zeitangaben: M:SS, MM:SS, H:MM:SS oder Sekunden (auch mit Dezimalstellen,
  z.B. 6.5). "ende" steht für das Dateiende.
- Die geschnittenen Dateien landen im Ausgangsordner (Standard: "geschnitten")
  unter demselben Dateinamen. Die Originale bleiben unverändert.

Das Schneiden erfolgt verlustfrei (Stream-Copy, kein Neukodieren). Die
Schnittgenauigkeit liegt dadurch bei ca. einer MP3-Frame-Länge (~26 ms),
was für Sprach-/Lernaudios völlig ausreicht.

Voraussetzungen: Python 3 und ffmpeg/ffprobe im PATH.
"""

import argparse
import csv
import subprocess
import sys
import tempfile
from pathlib import Path


def parse_zeit(text, dauer):
    """Wandelt '1:23', '0:01:23', '83', '6.5' oder 'ende' in Sekunden um."""
    text = text.strip().lower()
    if text in ("ende", "end", "eof"):
        return dauer
    teile = text.split(":")
    if len(teile) > 3:
        raise ValueError(f"Ungültige Zeitangabe: {text!r}")
    sekunden = 0.0
    for teil in teile:
        sekunden = sekunden * 60 + float(teil.replace(",", "."))
    return sekunden


def audio_dauer(datei):
    """Ermittelt die Dauer der Datei in Sekunden via ffprobe."""
    ergebnis = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(datei)],
        capture_output=True, text=True, check=True,
    )
    return float(ergebnis.stdout.strip())


def behalte_bereiche(entfernen, dauer):
    """Berechnet aus den zu entfernenden Bereichen die zu behaltenden."""
    entfernen = sorted(entfernen)
    # Überlappende/angrenzende Bereiche zusammenfassen
    zusammengefasst = []
    for von, bis in entfernen:
        if zusammengefasst and von <= zusammengefasst[-1][1]:
            zusammengefasst[-1][1] = max(zusammengefasst[-1][1], bis)
        else:
            zusammengefasst.append([von, bis])
    behalten = []
    position = 0.0
    for von, bis in zusammengefasst:
        if von > position:
            behalten.append((position, von))
        position = max(position, bis)
    if position < dauer:
        behalten.append((position, dauer))
    return behalten


def schneide_datei(eingang, ausgang, entfernen):
    dauer = audio_dauer(eingang)
    bereiche = []
    for von_text, bis_text in entfernen:
        von = parse_zeit(von_text, dauer)
        bis = parse_zeit(bis_text, dauer)
        if bis <= von:
            raise ValueError(f"Bereich {von_text}-{bis_text}: Ende liegt vor Anfang.")
        if von >= dauer:
            raise ValueError(
                f"Bereich {von_text}-{bis_text} beginnt nach dem Dateiende "
                f"({dauer:.1f} s)."
            )
        bereiche.append((von, min(bis, dauer)))

    behalten = behalte_bereiche(bereiche, dauer)
    if not behalten:
        raise ValueError("Es würde nichts übrig bleiben – gesamte Datei entfernt?")

    ausgang.parent.mkdir(parents=True, exist_ok=True)

    if len(behalten) == 1:
        von, bis = behalten[0]
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-ss", f"{von:.3f}", "-to", f"{bis:.3f}", "-i", str(eingang),
             "-c", "copy", str(ausgang)],
            check=True,
        )
        return dauer, bis - von

    # Mehrere Teilstücke: einzeln kopieren und verlustfrei zusammensetzen
    with tempfile.TemporaryDirectory() as temp:
        temp = Path(temp)
        listendatei = temp / "teile.txt"
        zeilen = []
        for i, (von, bis) in enumerate(behalten):
            teil = temp / f"teil_{i}.mp3"
            subprocess.run(
                ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-ss", f"{von:.3f}", "-to", f"{bis:.3f}", "-i", str(eingang),
                 "-avoid_negative_ts", "make_zero", "-c", "copy", str(teil)],
                check=True,
            )
            zeilen.append(f"file '{teil}'")
        listendatei.write_text("\n".join(zeilen) + "\n", encoding="utf-8")
        ergebnis = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-f", "concat", "-safe", "0", "-i", str(listendatei),
             "-c", "copy", str(ausgang)],
            capture_output=True, text=True,
        )
        # MP3 hat keine Container-Zeitstempel; diese Warnung des Muxers ist
        # beim verlustfreien Zusammensetzen harmlos und wird unterdrückt.
        meldungen = [z for z in ergebnis.stderr.splitlines()
                     if "non monotonically increasing dts" not in z]
        if meldungen:
            print("\n".join(meldungen), file=sys.stderr)
        if ergebnis.returncode != 0:
            raise subprocess.CalledProcessError(ergebnis.returncode, ergebnis.args)
    return dauer, sum(bis - von for von, bis in behalten)


def lese_schnittliste(pfad):
    """Liest die CSV-Schnittliste; erkennt Komma oder Semikolon automatisch."""
    text = Path(pfad).read_text(encoding="utf-8-sig")
    trenner = ";" if text.splitlines()[0].count(";") >= text.splitlines()[0].count(",") else ","
    auftraege = []
    for zeile in csv.reader(text.splitlines(), delimiter=trenner):
        if not zeile or not zeile[0].strip():
            continue
        datei = zeile[0].strip()
        if datei.lower() in ("datei", "file", "dateiname"):  # Kopfzeile
            continue
        bereiche = []
        for feld in zeile[1:]:
            for bereich in feld.split():
                if "-" not in bereich:
                    raise ValueError(
                        f"{datei}: {bereich!r} ist kein Bereich (erwartet z.B. 0:00-0:06)."
                    )
                von, bis = bereich.split("-", 1)
                bereiche.append((von, bis))
        if not bereiche:
            raise ValueError(f"{datei}: keine Zeitbereiche angegeben.")
        auftraege.append((datei, bereiche))
    return auftraege


def main():
    parser = argparse.ArgumentParser(description="Schneidet MP3s laut Schnittliste.")
    parser.add_argument("schnittliste", help="CSV-Datei mit den Schnittangaben")
    parser.add_argument("--eingang", default=".", help="Ordner mit den Original-MP3s (Standard: aktueller Ordner)")
    parser.add_argument("--ausgang", default="geschnitten", help="Zielordner (Standard: geschnitten)")
    args = parser.parse_args()

    eingang = Path(args.eingang)
    ausgang = Path(args.ausgang)
    auftraege = lese_schnittliste(args.schnittliste)

    fehler = 0
    for datei, bereiche in auftraege:
        quelle = eingang / datei
        ziel = ausgang / datei
        if not quelle.exists():
            print(f"FEHLER  {datei}: Datei nicht gefunden in {eingang}/")
            fehler += 1
            continue
        try:
            dauer, neu = schneide_datei(quelle, ziel, bereiche)
        except (ValueError, subprocess.CalledProcessError) as e:
            print(f"FEHLER  {datei}: {e}")
            fehler += 1
            continue
        angaben = ", ".join(f"{von}-{bis}" for von, bis in bereiche)
        print(f"OK      {datei}: entfernt [{angaben}]  ({dauer:.1f} s -> {neu:.1f} s)")

    print(f"\nFertig: {len(auftraege) - fehler} von {len(auftraege)} Dateien geschnitten.")
    sys.exit(1 if fehler else 0)


if __name__ == "__main__":
    main()
