# SharePoint-Online-Site als HTML, DOCX und PDF exportieren

Dieses Toolkit exportiert eine komplette SharePoint-Online-Website **rekursiv
inklusive aller Unterwebsites**:

| Werkzeug | Ergebnis |
|---|---|
| `export-pages.mjs` | eine **HTML**- und eine **DOCX**-Datei pro Seite (inkl. heruntergeladener Bilder) + `pages.json` (Seitenliste) — **ohne App-Registrierung**, Anmeldung per Browser |
| `export-pdf.mjs` | ein layouttreues **PDF** pro Seite — so, wie die Seite im Browser aussieht, inkl. dynamischer Webparts |
| `merge-pdf.mjs` | alle Einzel-PDFs zu einem **Gesamtdokument.pdf** zusammengefügt |
| `Export-SPSite.ps1` | Alternative zu `export-pages.mjs` auf Basis von PnP PowerShell (benötigt eine Entra-ID-App-Registrierung, siehe unten) |

## Voraussetzungen

- **Node.js 18+** (`winget install OpenJS.NodeJS.LTS`)
- **Pandoc** (für DOCX): `winget install JohnMacFarlane.Pandoc` — https://pandoc.org/installing.html
- Einmalig im Ordner `sharepoint-export/`:
  ```
  npm install
  npx playwright install chromium
  ```

Für den Export genügt **Lesezugriff** auf die Site — es wird nichts verändert.

## Verwendung (empfohlener Weg, ohne App-Registrierung)

Beispiel für die Site `https://wmgr.sharepoint.com/sites/msteams_4f6017_816048`:

```bash
# 1) Einmalig im Browser anmelden (MFA-fähig; Sitzung wird in .auth-profile gespeichert)
node export-pdf.mjs --login "https://wmgr.sharepoint.com/sites/msteams_4f6017_816048"

# 2) HTML + DOCX + Seitenliste (nutzt die gespeicherte Browser-Sitzung)
node export-pages.mjs "https://wmgr.sharepoint.com/sites/msteams_4f6017_816048"

# 3) Layouttreue PDFs erzeugen
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

## Alternative: Export-SPSite.ps1 (PnP PowerShell)

Gleicher Funktionsumfang wie `export-pages.mjs`, aber über PnP PowerShell.
Zusätzliche Voraussetzungen:

- **PowerShell 7** (`winget install Microsoft.PowerShell`)
- **PnP.PowerShell**: `Install-Module PnP.PowerShell -Scope CurrentUser`
- **Entra-ID-App-Registrierung** (einmalig, seit Sept. 2024 von PnP PowerShell verlangt).
  Als Benutzer mit entsprechenden Rechten:
  ```powershell
  Register-PnPEntraIDAppForInteractiveLogin -ApplicationName "SP-Export" -Tenant wmgr.onmicrosoft.com -Interactive
  ```
  Die ausgegebene **AppId (Client-ID)** als `-ClientId` übergeben. Falls ihr keine
  Apps registrieren dürft, muss das die IT einmalig tun — oder ihr nutzt einfach
  den empfohlenen Weg oben, der ganz ohne App-Registrierung auskommt.

```powershell
./Export-SPSite.ps1 `
    -SiteUrl  "https://wmgr.sharepoint.com/sites/msteams_4f6017_816048" `
    -ClientId "<eure-App-Client-ID>" `
    -OutDir   ".\export"
```

Optionen: `-NoSubsites` (keine Unterwebsites), `-SkipDocx` (kein Pandoc/DOCX),
`-OutDir <pfad>` (anderes Zielverzeichnis).

## Hinweise und Grenzen

- **HTML/DOCX** enthalten den *Inhalt* der Seiten (Text, Bilder). Dynamische
  Webparts (Nachrichten-Rollups, eingebettete Listen, Power-BI etc.) werden dort
  nicht gerendert — dafür ist der **PDF-Export** zuständig, der die Seiten im
  echten Browser lädt.
- „Unterseiten" im Sinne von *weiteren Seiten in der Websiteseiten-Bibliothek*
  werden immer alle exportiert; „Unterwebsites" (Subsites) über die Rekursion.
- Läuft die gespeicherte Browser-Sitzung ab (Meldung `Sitzung abgelaufen` bzw.
  `Nicht angemeldet`), einfach `node export-pdf.mjs --login …` wiederholen.
- Fehlgeschlagene PDF-Seiten werden in `export/pdf-fehler.json` protokolliert;
  ein erneuter Lauf überschreibt vorhandene PDFs einfach.
- Klassische Wiki-Seiten (Feld `WikiField`) werden ebenfalls exportiert.
- Ist Pandoc nicht installiert, erzeugt `export-pages.mjs` nur HTML und weist
  darauf hin.
