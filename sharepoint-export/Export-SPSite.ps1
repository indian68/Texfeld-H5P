<#
.SYNOPSIS
    Exportiert eine SharePoint-Online-Website rekursiv (inkl. aller Unterwebsites)
    als HTML- und DOCX-Dateien und erzeugt eine Seitenliste (pages.json) fuer den
    layouttreuen PDF-Export mit export-pdf.mjs (Playwright).

.DESCRIPTION
    Das Skript verbindet sich interaktiv (Browser-Login, MFA-faehig) mit der
    angegebenen Site, sammelt die Root-Site und alle Unterwebsites ein und liest
    aus jeder "Websiteseiten"-Bibliothek (Site Pages) den Seiteninhalt aus
    (Feld CanvasContent1 bei modernen Seiten, WikiField bei klassischen
    Wiki-Seiten). Referenzierte Bilder werden heruntergeladen und lokal
    eingebunden, damit HTML und DOCX auch offline vollstaendig sind.

    DOCX wird mit Pandoc erzeugt (https://pandoc.org). Ist Pandoc nicht
    installiert, wird die DOCX-Erzeugung uebersprungen und ein Hinweis
    ausgegeben.

.PARAMETER SiteUrl
    URL der Site, z. B. https://wmgr.sharepoint.com/sites/msteams_4f6017_816048

.PARAMETER ClientId
    App-ID (Client-ID) einer Entra-ID-App-Registrierung fuer PnP PowerShell.
    Seit September 2024 verlangt PnP PowerShell eine eigene App-Registrierung.
    Einmalig anlegen mit:
        Register-PnPEntraIDAppForInteractiveLogin -ApplicationName "SP-Export" -Tenant <tenant>.onmicrosoft.com -Interactive
    Die dabei ausgegebene AppId hier uebergeben.

.PARAMETER OutDir
    Zielordner fuer den Export (Standard: .\export)

.PARAMETER SkipDocx
    DOCX-Erzeugung ueberspringen (nur HTML + pages.json).

.PARAMETER NoSubsites
    Nur die angegebene Site exportieren, Unterwebsites ignorieren.

.EXAMPLE
    ./Export-SPSite.ps1 -SiteUrl "https://wmgr.sharepoint.com/sites/msteams_4f6017_816048" -ClientId "00000000-0000-0000-0000-000000000000"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SiteUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [string]$OutDir = ".\export",

    [switch]$SkipDocx,

    [switch]$NoSubsites
)

$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name PnP.PowerShell)) {
    throw "Das Modul 'PnP.PowerShell' fehlt. Installation: Install-Module PnP.PowerShell -Scope CurrentUser (PowerShell 7 erforderlich)"
}
Import-Module PnP.PowerShell

$pandoc = Get-Command pandoc -ErrorAction SilentlyContinue
if (-not $SkipDocx -and -not $pandoc) {
    Write-Warning "Pandoc wurde nicht gefunden - DOCX-Erzeugung wird uebersprungen. Installation: https://pandoc.org/installing.html"
    $SkipDocx = $true
}

$OutDir = (New-Item -ItemType Directory -Path $OutDir -Force).FullName
$siteUri = [Uri]$SiteUrl
$tenantBase = "$($siteUri.Scheme)://$($siteUri.Host)"

# Ungueltige Zeichen aus Datei-/Ordnernamen entfernen
function Get-SafeName([string]$name) {
    $invalid = [IO.Path]::GetInvalidFileNameChars() -join ''
    $safe = $name -replace "[$([Regex]::Escape($invalid))]", "_"
    return $safe.Trim()
}

# Bilder aus dem HTML herunterladen, lokal ablegen und src-Pfade umschreiben
function Save-ImagesAndRewrite {
    param(
        [string]$Html,
        [string]$AssetsDir,
        [string]$HtmlDir
    )
    $result = $Html
    $srcMatches = [Regex]::Matches($Html, 'src="([^"]+)"')
    foreach ($m in $srcMatches) {
        $src = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
        if ($src -match '^data:') { continue }

        # Server-relative URL bestimmen
        if ($src -match '^https?://') {
            $u = [Uri]$src
            if ($u.Host -ne $siteUri.Host) { continue }   # Fremde Hosts nicht anfassen
            $serverRel = $u.AbsolutePath
        }
        elseif ($src.StartsWith('/')) {
            $serverRel = ($src -split '\?')[0]
        }
        else { continue }

        $serverRel = [Uri]::UnescapeDataString(($serverRel -split '\?')[0])
        $fileName = Get-SafeName ([IO.Path]::GetFileName($serverRel))
        if ([string]::IsNullOrWhiteSpace($fileName)) { continue }

        # Namenskollisionen verschiedener Pfade vermeiden
        $hash = [BitConverter]::ToString([System.Security.Cryptography.MD5]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($serverRel))).Replace('-', '').Substring(0, 8)
        $localName = "$hash`_$fileName"
        $localPath = Join-Path $AssetsDir $localName

        if (-not (Test-Path $localPath)) {
            try {
                Get-PnPFile -Url $serverRel -Path $AssetsDir -FileName $localName -AsFile -Force | Out-Null
            }
            catch {
                Write-Verbose "Bild konnte nicht geladen werden: $serverRel ($_)"
                continue
            }
        }
        $relFromHtml = [IO.Path]::GetRelativePath($HtmlDir, $localPath).Replace('\', '/')
        $result = $result.Replace($m.Groups[1].Value, $relFromHtml)
    }
    return $result
}

Write-Host "Verbinde mit $SiteUrl ..." -ForegroundColor Cyan
Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId

# Root-Web + alle Unterwebsites einsammeln
$rootWeb = Get-PnPWeb
$webs = @($rootWeb)
if (-not $NoSubsites) {
    $webs += Get-PnPSubWeb -Recurse
}
Write-Host "$($webs.Count) Website(s) gefunden." -ForegroundColor Cyan

$pageIndex = [System.Collections.Generic.List[object]]::new()
$rootServerRel = $rootWeb.ServerRelativeUrl.TrimEnd('/')

foreach ($web in $webs) {
    $webUrl = "$tenantBase$($web.ServerRelativeUrl)"
    Write-Host "`n=== $($web.Title) ($webUrl) ===" -ForegroundColor Yellow
    Connect-PnPOnline -Url $webUrl -Interactive -ClientId $ClientId

    # Websiteseiten-Bibliothek: BaseTemplate 119 (funktioniert sprachunabhaengig)
    $lists = Get-PnPList | Where-Object { $_.BaseTemplate -eq 119 }
    if (-not $lists) {
        Write-Host "  Keine Seitenbibliothek vorhanden - uebersprungen."
        continue
    }

    # Unterordner je Web relativ zur Root-Site
    $webRel = $web.ServerRelativeUrl.TrimEnd('/')
    $subPath = if ($webRel -eq $rootServerRel) { "root" } else { Get-SafeName ($webRel.Substring($rootServerRel.Length).Trim('/').Replace('/', '_')) }
    $webOutDir = (New-Item -ItemType Directory -Path (Join-Path $OutDir $subPath) -Force).FullName
    $assetsDir = (New-Item -ItemType Directory -Path (Join-Path $webOutDir "assets") -Force).FullName

    foreach ($list in $lists) {
        $items = Get-PnPListItem -List $list -PageSize 200
        foreach ($item in $items) {
            $leaf = $item["FileLeafRef"]
            if (-not $leaf -or $leaf -notmatch '\.aspx$') { continue }

            $title = if ($item["Title"]) { $item["Title"] } else { [IO.Path]::GetFileNameWithoutExtension($leaf) }
            $baseName = Get-SafeName ([IO.Path]::GetFileNameWithoutExtension($leaf))
            Write-Host "  Seite: $title"

            # Moderner Seiteninhalt bzw. klassische Wiki-Seite
            $content = $item["CanvasContent1"]
            if (-not $content) { $content = $item["WikiField"] }
            if (-not $content) {
                $content = "<p><em>Diese Seite enthaelt keinen exportierbaren Textinhalt (z. B. reine Webpart-Seite). Fuer die vollstaendige Darstellung bitte den PDF-Export (export-pdf.mjs) verwenden.</em></p>"
            }

            $content = Save-ImagesAndRewrite -Html $content -AssetsDir $assetsDir -HtmlDir $webOutDir
            $fileRef = $item["FileRef"]

            $htmlDoc = @"
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>$([System.Net.WebUtility]::HtmlEncode($title))</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; max-width: 900px; margin: 2rem auto; line-height: 1.5; color: #222; }
  img { max-width: 100%; height: auto; }
  h1.export-title { border-bottom: 2px solid #0078d4; padding-bottom: .3rem; }
  .export-meta { color: #666; font-size: .85rem; margin-bottom: 1.5rem; }
</style>
</head>
<body>
<h1 class="export-title">$([System.Net.WebUtility]::HtmlEncode($title))</h1>
<p class="export-meta">Quelle: $tenantBase$fileRef &middot; exportiert am $(Get-Date -Format "yyyy-MM-dd HH:mm")</p>
$content
</body>
</html>
"@
            $htmlPath = Join-Path $webOutDir "$baseName.html"
            [IO.File]::WriteAllText($htmlPath, $htmlDoc, [Text.UTF8Encoding]::new($false))

            if (-not $SkipDocx) {
                $docxPath = Join-Path $webOutDir "$baseName.docx"
                & pandoc $htmlPath -o $docxPath --resource-path=$webOutDir 2>&1 | ForEach-Object { Write-Verbose $_ }
                if ($LASTEXITCODE -ne 0) { Write-Warning "  Pandoc-Fehler bei $baseName" }
            }

            $pageIndex.Add([pscustomobject]@{
                web   = $web.Title
                title = $title
                url   = "$tenantBase$fileRef"
                pdf   = "$subPath/$baseName.pdf"
            })
        }
    }
}

# Seitenliste fuer den Playwright-PDF-Export
$pagesJson = Join-Path $OutDir "pages.json"
$pageIndex | ConvertTo-Json -Depth 4 | Set-Content -Path $pagesJson -Encoding UTF8

Write-Host "`nFertig." -ForegroundColor Green
Write-Host "  HTML/DOCX : $OutDir"
Write-Host "  Seitenliste: $pagesJson ($($pageIndex.Count) Seiten)"
Write-Host "`nNaechster Schritt fuer layouttreue PDFs:" -ForegroundColor Cyan
Write-Host "  node export-pdf.mjs --login          # einmalig anmelden"
Write-Host "  node export-pdf.mjs $pagesJson       # PDFs erzeugen"
Write-Host "  node merge-pdf.mjs $OutDir           # optional: Gesamt-PDF"
