/**
 * Exportiert alle Seiten einer SharePoint-Online-Site (inkl. Unterwebsites)
 * als HTML und DOCX - OHNE PnP PowerShell und OHNE Entra-App-Registrierung.
 *
 * Die Anmeldung laeuft ueber die normale Browser-Sitzung (wie beim PDF-Export):
 *
 *   1. Einmalig anmelden:   node export-pdf.mjs --login <SiteUrl>
 *   2. HTML + DOCX:         node export-pages.mjs <SiteUrl> [Zielordner]
 *   3. PDFs:                node export-pdf.mjs <Zielordner>/pages.json
 *   4. Gesamt-PDF:          node merge-pdf.mjs <Zielordner>
 *
 * DOCX wird mit Pandoc erzeugt (https://pandoc.org). Ohne Pandoc werden nur
 * HTML-Dateien geschrieben.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROFILE_DIR = path.resolve(".auth-profile");

const launchOptions = {
  headless: true,
  ...(process.env.PW_CHROMIUM_PATH
    ? { executablePath: process.env.PW_CHROMIUM_PATH }
    : {}),
};

const siteUrl = process.argv[2]?.replace(/\/+$/, "");
const outBase = path.resolve(process.argv[3] ?? "export");
if (!siteUrl || !/^https?:\/\//.test(siteUrl)) {
  console.error("Verwendung: node export-pages.mjs <SiteUrl> [Zielordner]");
  console.error('Beispiel:   node export-pages.mjs "https://wmgr.sharepoint.com/sites/msteams_4f6017_816048"');
  process.exit(1);
}
if (!fs.existsSync(PROFILE_DIR)) {
  console.error("Keine gespeicherte Anmeldung gefunden. Zuerst ausfuehren:");
  console.error(`  node export-pdf.mjs --login "${siteUrl}"`);
  process.exit(1);
}

const origin = new URL(siteUrl).origin;

let pandocOk = true;
try {
  execFileSync("pandoc", ["-v"], { stdio: "ignore" });
} catch {
  pandocOk = false;
  console.warn("Hinweis: Pandoc nicht gefunden - es werden nur HTML-Dateien erzeugt (kein DOCX).");
  console.warn("Installation: https://pandoc.org/installing.html\n");
}

const safeName = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();

const context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions);
const api = context.request;

async function getJson(url) {
  const res = await api.get(url, {
    headers: { Accept: "application/json;odata=nometadata" },
  });
  const ct = res.headers()["content-type"] ?? "";
  if (!res.ok() || !ct.includes("json")) {
    if (ct.includes("html") || res.url().includes("login.microsoftonline.com")) {
      throw new Error(
        `Nicht angemeldet oder Sitzung abgelaufen. Bitte zuerst: node export-pdf.mjs --login "${siteUrl}"`
      );
    }
    throw new Error(`HTTP ${res.status()} bei ${url}`);
  }
  return res.json();
}

// Root-Web + alle Unterwebsites rekursiv einsammeln
async function collectWebs(webUrl, acc) {
  const web = await getJson(`${webUrl}/_api/web?$select=Title,ServerRelativeUrl`);
  acc.push({ url: webUrl, title: web.Title, serverRel: web.ServerRelativeUrl.replace(/\/+$/, "") });
  const subs = await getJson(`${webUrl}/_api/web/webs?$select=ServerRelativeUrl`);
  for (const sub of subs.value ?? []) {
    await collectWebs(origin + sub.ServerRelativeUrl, acc);
  }
  return acc;
}

// Alle Elemente einer Liste inkl. Paginierung laden
async function getAllItems(webUrl, listId, fields) {
  let url = `${webUrl}/_api/web/lists(guid'${listId}')/items?$select=${fields.join(",")}&$top=100`;
  const items = [];
  while (url) {
    const data = await getJson(url);
    items.push(...(data.value ?? []));
    url = data["odata.nextLink"] ?? data["__next"] ?? null;
  }
  return items;
}

// Bilder herunterladen und src-Pfade auf lokale Kopien umschreiben
async function saveImagesAndRewrite(html, assetsDir, htmlDir) {
  let result = html;
  for (const m of html.matchAll(/src="([^"]+)"/g)) {
    const rawSrc = m[1];
    const src = rawSrc.replace(/&amp;/g, "&").replace(/&#58;/g, ":");
    if (src.startsWith("data:")) continue;

    let abs;
    try {
      abs = new URL(src, origin);
    } catch {
      continue;
    }
    if (abs.origin !== origin) continue; // Fremde Hosts nicht anfassen

    const serverRel = decodeURIComponent(abs.pathname);
    const fileName = safeName(path.posix.basename(serverRel));
    if (!fileName) continue;

    const hash = crypto.createHash("md5").update(serverRel).digest("hex").slice(0, 8);
    const localPath = path.join(assetsDir, `${hash}_${fileName}`);

    if (!fs.existsSync(localPath)) {
      try {
        const res = await api.get(abs.href);
        if (!res.ok() || (res.headers()["content-type"] ?? "").includes("text/html")) continue;
        fs.writeFileSync(localPath, await res.body());
      } catch {
        continue;
      }
    }
    const relFromHtml = path.relative(htmlDir, localPath).split(path.sep).join("/");
    result = result.replaceAll(rawSrc, relFromHtml);
  }
  return result;
}

const htmlEscape = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrapHtml(title, sourceUrl, content) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${htmlEscape(title)}</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; max-width: 900px; margin: 2rem auto; line-height: 1.5; color: #222; }
  img { max-width: 100%; height: auto; }
  h1.export-title { border-bottom: 2px solid #0078d4; padding-bottom: .3rem; }
  .export-meta { color: #666; font-size: .85rem; margin-bottom: 1.5rem; }
</style>
</head>
<body>
<h1 class="export-title">${htmlEscape(title)}</h1>
<p class="export-meta">Quelle: ${htmlEscape(sourceUrl)} &middot; exportiert am ${new Date().toISOString().slice(0, 16).replace("T", " ")}</p>
${content}
</body>
</html>
`;
}

console.log(`Sammle Websites unter ${siteUrl} ...`);
const webs = await collectWebs(siteUrl, []);
console.log(`${webs.length} Website(s) gefunden.`);

const rootServerRel = webs[0].serverRel;
const pageIndex = [];

for (const web of webs) {
  console.log(`\n=== ${web.title} (${web.url}) ===`);

  // Websiteseiten-Bibliothek: BaseTemplate 119 (sprachunabhaengig)
  const lists = await getJson(
    `${web.url}/_api/web/lists?$filter=BaseTemplate eq 119&$select=Title,Id`
  );
  if (!lists.value?.length) {
    console.log("  Keine Seitenbibliothek vorhanden - uebersprungen.");
    continue;
  }

  const subPath =
    web.serverRel === rootServerRel
      ? "root"
      : safeName(web.serverRel.slice(rootServerRel.length).replace(/^\/+/, "").replaceAll("/", "_"));
  const webOutDir = path.join(outBase, subPath);
  const assetsDir = path.join(webOutDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  for (const list of lists.value) {
    // CanvasContent1 existiert nur bei modernen Seitenbibliotheken -
    // bei klassischen Wiki-Bibliotheken auf WikiField zurueckfallen
    let items;
    try {
      items = await getAllItems(web.url, list.Id, ["Id", "Title", "FileLeafRef", "FileRef", "CanvasContent1", "WikiField"]);
    } catch {
      try {
        items = await getAllItems(web.url, list.Id, ["Id", "Title", "FileLeafRef", "FileRef", "WikiField"]);
      } catch {
        items = await getAllItems(web.url, list.Id, ["Id", "Title", "FileLeafRef", "FileRef"]);
      }
    }

    for (const item of items) {
      const leaf = item.FileLeafRef;
      if (!leaf || !leaf.toLowerCase().endsWith(".aspx")) continue;

      const title = item.Title || leaf.replace(/\.aspx$/i, "");
      const baseName = safeName(leaf.replace(/\.aspx$/i, ""));
      console.log(`  Seite: ${title}`);

      let content = item.CanvasContent1 || item.WikiField;
      if (!content) {
        content =
          "<p><em>Diese Seite enthaelt keinen exportierbaren Textinhalt (z. B. reine Webpart-Seite). " +
          "Fuer die vollstaendige Darstellung bitte den PDF-Export (export-pdf.mjs) verwenden.</em></p>";
      }

      content = await saveImagesAndRewrite(content, assetsDir, webOutDir);

      const sourceUrl = origin + item.FileRef;
      const htmlPath = path.join(webOutDir, `${baseName}.html`);
      fs.writeFileSync(htmlPath, wrapHtml(title, sourceUrl, content), "utf8");

      if (pandocOk) {
        try {
          execFileSync("pandoc", [htmlPath, "-o", path.join(webOutDir, `${baseName}.docx`)], {
            cwd: webOutDir,
            stdio: "ignore",
          });
        } catch {
          console.warn(`  Pandoc-Fehler bei ${baseName} - DOCX uebersprungen.`);
        }
      }

      pageIndex.push({
        web: web.title,
        title,
        url: sourceUrl,
        pdf: `${subPath}/${baseName}.pdf`,
      });
    }
  }
}

await context.close();

fs.mkdirSync(outBase, { recursive: true });
const pagesJson = path.join(outBase, "pages.json");
fs.writeFileSync(pagesJson, JSON.stringify(pageIndex, null, 2), "utf8");

console.log(`\nFertig.`);
console.log(`  HTML${pandocOk ? "/DOCX" : ""} : ${outBase}`);
console.log(`  Seitenliste: ${pagesJson} (${pageIndex.length} Seiten)`);
console.log(`\nNaechster Schritt fuer layouttreue PDFs:`);
console.log(`  node export-pdf.mjs ${path.relative(process.cwd(), pagesJson)}`);
console.log(`  node merge-pdf.mjs ${path.relative(process.cwd(), outBase)}`);
