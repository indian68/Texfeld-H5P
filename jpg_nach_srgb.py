#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stapelverarbeitung: JPG-Dateien in den Farbraum sRGB umwandeln.

Aufruf:
    python3 jpg_nach_srgb.py EINGANGSORDNER [--ausgang ORDNER] [--unterordner]
                             [--qualitaet 92] [--intent perzeptiv]
                             [--ohne-profil-annehmen PROFIL.icc]

Für jedes Bild wird das eingebettete ICC-Farbprofil (z.B. Adobe RGB,
ProPhoto RGB, Display P3, CMYK/FOGRA, Graustufen) ausgelesen und die Farben
werden farbgetreu nach sRGB umgerechnet. Das Ergebnis enthält ein
eingebettetes sRGB-Profil; EXIF-Daten (Aufnahmedatum, Ausrichtung …) bleiben
erhalten.

- Bilder, die bereits sRGB sind, werden unverändert (bitgenau) kopiert –
  es gibt also keinen unnötigen Qualitätsverlust durch erneutes Speichern.
- Bilder ohne eingebettetes Profil gelten als sRGB (so verhalten sich auch
  Browser). Mit --ohne-profil-annehmen kann stattdessen ein anderes Profil
  vorgegeben werden, z.B. AdobeRGB1998.icc.
- Die Ergebnisse landen im Ausgangsordner (Standard: "srgb") unter demselben
  Dateinamen. Die Originale bleiben unverändert.
- Die Bilder werden parallel auf allen CPU-Kernen verarbeitet.

Voraussetzungen: Python 3 und Pillow (pip install Pillow).
"""

import argparse
import io
import os
import shutil
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

try:
    from PIL import Image, ImageCms
except ImportError:
    sys.exit("Fehler: Pillow fehlt. Bitte installieren mit:  pip install Pillow")

ENDUNGEN = {".jpg", ".jpeg", ".jpe", ".jfif"}

INTENTS = {
    "perzeptiv": ImageCms.Intent.PERCEPTUAL,
    "relativ": ImageCms.Intent.RELATIVE_COLORIMETRIC,
    "saettigung": ImageCms.Intent.SATURATION,
    "absolut": ImageCms.Intent.ABSOLUTE_COLORIMETRIC,
}

SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
SRGB_BYTES = SRGB.tobytes()


def ist_srgb(profil):
    """Erkennt gängige sRGB-Profile anhand ihrer Beschreibung."""
    beschreibung = (ImageCms.getProfileDescription(profil) or "").lower()
    kompakt = beschreibung.replace(" ", "").replace("-", "")
    return "srgb" in kompakt or "iec6196621" in kompakt


def passt_zu_modus(profil_bytes, modus):
    """Prüft, ob der Farbraum des Profils (RGB/CMYK/Grau) zum Bildmodus passt."""
    farbraum = ImageCms.ImageCmsProfile(io.BytesIO(profil_bytes)).profile.xcolor_space
    return {"RGB": "RGB ", "CMYK": "CMYK", "L": "GRAY"}.get(modus) == farbraum


def wandle_um(quelle, ziel, qualitaet, intent, standard_profil_bytes):
    """Wandelt eine Datei um. Gibt eine kurze Statusmeldung zurück."""
    with Image.open(quelle) as bild:
        icc = bild.info.get("icc_profile")
        exif = bild.info.get("exif")
        dpi = bild.info.get("dpi")
        modus = bild.mode

        if icc:
            quell_profil = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            herkunft = ImageCms.getProfileDescription(quell_profil).strip()
        elif standard_profil_bytes and passt_zu_modus(standard_profil_bytes, modus):
            quell_profil = ImageCms.ImageCmsProfile(io.BytesIO(standard_profil_bytes))
            herkunft = ImageCms.getProfileDescription(quell_profil).strip() + " (angenommen)"
        else:
            quell_profil = None
            herkunft = "ohne Profil"

        # Bereits sRGB (oder ohne Profil = sRGB) und RGB: unverändert kopieren.
        if modus == "RGB" and (quell_profil is None or ist_srgb(quell_profil)):
            shutil.copy2(quelle, ziel)
            return "KOPIE", f"bereits sRGB ({herkunft}), unverändert kopiert"

        if quell_profil is not None:
            if modus not in ("RGB", "CMYK", "L"):
                bild = bild.convert("RGB")
            ergebnis = ImageCms.profileToProfile(
                bild, quell_profil, SRGB,
                renderingIntent=intent, outputMode="RGB",
            )
        else:
            # Kein Profil: CMYK/Graustufen etc. einfach nach RGB umrechnen.
            ergebnis = bild.convert("RGB")

        optionen = {
            "quality": qualitaet,
            "optimize": True,
            "icc_profile": SRGB_BYTES,
            "subsampling": "4:4:4" if qualitaet >= 90 else "4:2:0",
        }
        if exif:
            optionen["exif"] = exif
        if dpi:
            optionen["dpi"] = dpi

        temp = ziel.with_name(ziel.name + ".tmp")
        try:
            ergebnis.save(temp, "JPEG", **optionen)
            os.replace(temp, ziel)
        finally:
            temp.unlink(missing_ok=True)
        return "OK", f"{herkunft} ({modus}) -> sRGB"


def arbeit(aufgabe):
    quelle, ziel, qualitaet, intent, standard_profil_bytes = aufgabe
    try:
        ziel.parent.mkdir(parents=True, exist_ok=True)
        status, text = wandle_um(quelle, ziel, qualitaet, intent, standard_profil_bytes)
    except Exception as fehler:  # pro Datei melden, Rest weiterverarbeiten
        status, text = "FEHLER", f"{type(fehler).__name__}: {fehler}"
    return quelle, status, text


def finde_jpgs(ordner, rekursiv):
    muster = ordner.rglob("*") if rekursiv else ordner.glob("*")
    return sorted(p for p in muster if p.is_file() and p.suffix.lower() in ENDUNGEN)


def main():
    parser = argparse.ArgumentParser(
        description="Wandelt viele JPG-Dateien farbgetreu nach sRGB um.")
    parser.add_argument("eingang", type=Path, help="Ordner mit den JPG-Dateien")
    parser.add_argument("--ausgang", type=Path, default=None,
                        help='Zielordner (Standard: Unterordner "srgb" im Eingangsordner)')
    parser.add_argument("--unterordner", action="store_true",
                        help="auch Unterordner durchsuchen (Ordnerstruktur bleibt erhalten)")
    parser.add_argument("--qualitaet", type=int, default=92,
                        help="JPEG-Qualität 1–100 (Standard: 92)")
    parser.add_argument("--intent", choices=INTENTS, default="perzeptiv",
                        help="Rendering-Intent der Umrechnung (Standard: perzeptiv)")
    parser.add_argument("--ohne-profil-annehmen", type=Path, metavar="PROFIL.icc",
                        help="ICC-Profil für Bilder ohne eingebettetes Profil "
                             "(Standard: diese gelten als sRGB)")
    parser.add_argument("--prozesse", type=int, default=os.cpu_count() or 1,
                        help="Anzahl paralleler Prozesse (Standard: alle CPU-Kerne)")
    args = parser.parse_args()

    eingang = args.eingang
    if not eingang.is_dir():
        sys.exit(f"Fehler: Ordner nicht gefunden: {eingang}")
    if not 1 <= args.qualitaet <= 100:
        sys.exit("Fehler: --qualitaet muss zwischen 1 und 100 liegen.")
    ausgang = args.ausgang or (eingang / "srgb")

    standard_profil_bytes = None
    if args.ohne_profil_annehmen:
        standard_profil_bytes = args.ohne_profil_annehmen.read_bytes()
        ImageCms.ImageCmsProfile(io.BytesIO(standard_profil_bytes))  # prüfen

    ausgang_abs = ausgang.resolve()
    dateien = [p for p in finde_jpgs(eingang, args.unterordner)
               if ausgang_abs not in p.resolve().parents]
    if not dateien:
        sys.exit(f"Keine JPG-Dateien in {eingang} gefunden.")

    intent = INTENTS[args.intent]
    aufgaben = [(p, ausgang / p.relative_to(eingang), args.qualitaet, intent,
                 standard_profil_bytes) for p in dateien]

    print(f"{len(dateien)} JPG-Dateien gefunden, Ziel: {ausgang}\n")
    zaehler = {"OK": 0, "KOPIE": 0, "FEHLER": 0}
    with ProcessPoolExecutor(max_workers=max(1, args.prozesse)) as pool:
        futures = [pool.submit(arbeit, a) for a in aufgaben]
        for nr, future in enumerate(as_completed(futures), 1):
            quelle, status, text = future.result()
            zaehler[status] += 1
            print(f"[{nr}/{len(dateien)}] {status:<7} {quelle.relative_to(eingang)}: {text}",
                  flush=True)

    print(f"\nFertig: {zaehler['OK']} umgewandelt, {zaehler['KOPIE']} waren bereits sRGB, "
          f"{zaehler['FEHLER']} Fehler.")
    return 1 if zaehler["FEHLER"] else 0


if __name__ == "__main__":
    sys.exit(main())
