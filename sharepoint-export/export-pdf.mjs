/**
 * Layouttreuer PDF-Export von SharePoint-Online-Seiten mit Playwright.
 *
 * Verwendung:
 *   1. Einmalig anmelden (oeffnet ein Browserfenster, MFA moeglich):
 *        node export-pdf.mjs --login [ersteSeitenUrl]
 *      Die Sitzung wird im Ordner .auth-profile gespeichert.
 *
 *   2. PDFs erzeugen (headless, nutzt die gespeicherte Sitzung):
 *        node export-pdf.mjs export/pages.json
 *
 * pages.json wird von Export-SPSite.ps1 erzeugt:
 *   [ { "web": "...", "title": "...", "url": "https://.../SitePages/Seite.aspx", "pdf": "root/Seite.pdf" }, ... ]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const PROFILE_DIR = path.resolve(".auth-profile");
const args = process.argv.slice(2);

// Optional: vorhandenes Chromium nutzen statt des von Playwright verwalteten
// (z. B. PW_CHROMIUM_PATH=/usr/bin/chromium oder ein anderer Browser-Pfad)
const launchOptions = (headless) => ({
  headless,
  viewport: { width: 1280, height: 900 },
  ...(process.env.PW_CHROMIUM_PATH
    ? { executablePath: process.env.PW_CHROMIUM_PATH }
    : {}),
});

// SharePoint-Chrome (Navigation, Kommandoleiste) im PDF ausblenden
const HIDE_CHROME_CSS = `
  #SuiteNavWrapper, #spSiteHeader nav, [data-automationid="pageCommandBar"],
  #sp-appBar, #spCommandBar, .commandBarWrapper, #O365_NavHeader,
  [role="banner"] .od-TopBar, #sp-appBarPlaceholder { display: none !important; }
`;

async function login(startUrl) {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions(false));
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(startUrl);
  console.log("Bitte im Browserfenster anmelden (inkl. MFA).");
  console.log("Warte, bis eine SharePoint-Seite geladen ist ...");
  await page.waitForURL(/\.sharepoint\.com\//, { timeout: 5 * 60 * 1000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  console.log("Anmeldung gespeichert. Fenster kann geschlossen werden.");
  await context.close();
}

async function exportPdfs(pagesFile) {
  if (!fs.existsSync(pagesFile)) {
    console.error(`Seitenliste nicht gefunden: ${pagesFile}`);
    console.error("Zuerst Export-SPSite.ps1 ausfuehren.");
    process.exit(1);
  }
  if (!fs.existsSync(PROFILE_DIR)) {
    console.error("Keine gespeicherte Anmeldung gefunden. Zuerst ausfuehren:");
    console.error("  node export-pdf.mjs --login <SeitenUrl>");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(pagesFile, "utf8"));
  const pages = Array.isArray(raw) ? raw : [raw]; // ConvertTo-Json liefert bei 1 Element ein Objekt
  const outBase = path.dirname(path.resolve(pagesFile));

  // page.pdf() funktioniert nur headless
  const context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions(true));
  const page = await context.newPage();

  let ok = 0;
  const failed = [];
  for (const [i, p] of pages.entries()) {
    const outPath = path.join(outBase, p.pdf);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    process.stdout.write(`[${i + 1}/${pages.length}] ${p.title} ... `);
    try {
      await page.goto(p.url, { waitUntil: "networkidle", timeout: 90_000 });
      if (page.url().includes("login.microsoftonline.com")) {
        throw new Error("Sitzung abgelaufen - bitte erneut mit --login anmelden.");
      }
      await page.addStyleTag({ content: HIDE_CHROME_CSS }).catch(() => {});
      await page.waitForTimeout(1500); // Nachladende Webparts (News, Listen) abwarten
      await page.pdf({
        path: outPath,
        format: "A4",
        printBackground: true,
        margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" },
      });
      ok++;
      console.log("OK");
    } catch (err) {
      failed.push({ ...p, error: String(err.message ?? err) });
      console.log(`FEHLER: ${err.message ?? err}`);
      if (String(err.message).includes("--login")) break; // Ohne Sitzung ist alles Weitere zwecklos
    }
  }
  await context.close();

  console.log(`\nFertig: ${ok}/${pages.length} PDFs unter ${outBase}`);
  if (failed.length) {
    const failFile = path.join(outBase, "pdf-fehler.json");
    fs.writeFileSync(failFile, JSON.stringify(failed, null, 2));
    console.log(`Fehlgeschlagene Seiten: ${failFile}`);
    process.exitCode = 1;
  }
}

if (args[0] === "--login") {
  const url = args[1] ?? "https://login.microsoftonline.com";
  await login(url);
} else {
  await exportPdfs(args[0] ?? path.join("export", "pages.json"));
}
