# SharePoint-Online-Site als HTML, DOCX und PDF exportieren

Dieses Toolkit exportiert eine komplette SharePoint-Online-Website **rekursiv
inklusive aller Unterwebsites**:

| Schritt | Werkzeug | Ergebnis |
|---|---|---|
| 1 | `Export-SPSite.ps1` (PnP PowerShell) | eine **HTML**- und eine **DOCX**-Datei pro Seite (inkl. heruntergeladener Bilder) + `pages.json` (Seitenliste) |
| 2 | `export-pdf.mjs` (Playwright, headless Chromium) | ein layouttreues **PDF** pro Seite — so, wie die Seite im Browser aussieht, inkl. dynamischer Webparts |
| 3 | `merge-pdf.mjs` (optional) | alle Einzel-PDFs zu einem **Gesamtdokument.pdf** zusammengefügt |

## Voraussetzungen

- **PowerShell 7** (`winget install Microsoft.PowerShell`)
- **PnP.PowerShell**: `Install-Module PnP.PowerShell -Scope CurrentUser`
- **Pandoc** (für DOCX): https://pandoc.org/installing.html — z. B. `winget install JohnMacFarlane.Pandoc`
- **Node.js 18+** und einmalig im Ordner `sharepoint-export/`:
  ```
  npm install
  npx playwright install chromium
  ```
- **Entra-ID-App-Registrierung** (einmalig, seit Sept. 2024 von PnP PowerShell verlangt).
  Als Benutzer mit entsprechenden Rechten in PowerShell 7 ausführen:
  ```powershell
  Register-PnPEntraIDAppForInteractiveLogin -ApplicationName "SP-Export" -Tenant wmgr.onmicrosoft.com -Interactive
  ```
  Die ausgegebene **AppId (Client-ID)** notieren — sie wird unten als `-ClientId` übergeben.
  (Falls ihr keine Apps registrieren dürft: die IT bitten, das einmalig zu tun und
  die Client-ID mitzuteilen.)

Für den Export selbst genügt **Lesezugriff** auf die Site — es wird nichts verändert.

## Verwendung

Beispiel für die Site `https://wmgr.sharepoint.com/sites/msteams_4f6017_816048`:

```powershell
# 1) HTML + DOCX + Seitenliste (öffnet ein Login-Fenster, MFA-fähig)
./Export-SPSite.ps1 `
    -SiteUrl  "https://wmgr.sharepoint.com/sites/msteams_4f6017_816048" `
    -ClientId "<eure-App-Client-ID>" `
    -OutDir   ".\export"
```

```bash
# 2) Einmalig im Browser anmelden (Sitzung wird in .auth-profile gespeichert)
node export-pdf.mjs --login "https://wmgr.sharepoint.com/sites/msteams_4f6017_816048"

# 3) PDFs erzeugen (headless, nutzt die gespeicherte Sitzung)
node export-pdf.mjs export/pages.json

# 4) Optional: alle PDFs zu einem Gesamtdokument zusammenführen
node merge-pdf.mjs export
```

## Ergebnisstruktur

```
export/
├── pages.json               # Seitenliste (Web, Titel, URL, PDF-Pfad)
├── Gesamtdokument.pdf       # nach merge-pdf.mjs
├── root/                    # Seiten der Haupt-Site
│   ├── assets/              # heruntergeladene Bilder
│   ├── BiBox-und-E-Book+-Startseite.html
│   ├── BiBox-und-E-Book+-Startseite.docx
│   └── BiBox-und-E-Book+-Startseite.pdf
└── <unterwebsite>/          # je Unterwebsite ein Ordner, gleiche Struktur
    └── ...
```

## Nützliche Optionen

| Option | Wirkung |
|---|---|
| `-NoSubsites` | nur die angegebene Site, keine Unterwebsites |
| `-SkipDocx` | Pandoc/DOCX überspringen (nur HTML + Seitenliste) |
| `-OutDir <pfad>` | anderes Zielverzeichnis |

## Hinweise und Grenzen

- **HTML/DOCX** enthalten den *Inhalt* der Seiten (Text, Bilder). Dynamische
  Webparts (Nachrichten-Rollups, eingebettete Listen, Power-BI etc.) werden dort
  nicht gerendert — dafür ist der **PDF-Export** zuständig, der die Seiten im
  echten Browser lädt.
- „Unterseiten" im Sinne von *weiteren Seiten in der Websiteseiten-Bibliothek*
  werden immer alle exportiert; „Unterwebsites" (Subsites) über die Rekursion.
- Läuft die gespeicherte Browser-Sitzung ab (Meldung `Sitzung abgelaufen`),
  einfach `node export-pdf.mjs --login …` wiederholen.
- Fehlgeschlagene PDF-Seiten werden in `export/pdf-fehler.json` protokolliert;
  ein erneuter Lauf überschreibt vorhandene PDFs einfach.
- Klassische Wiki-Seiten (Feld `WikiField`) werden ebenfalls exportiert.
