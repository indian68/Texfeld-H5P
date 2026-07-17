/**
 * Fuegt alle vom PDF-Export erzeugten Einzel-PDFs (Reihenfolge laut pages.json)
 * zu einem Gesamtdokument zusammen.
 *
 * Verwendung:
 *   node merge-pdf.mjs [exportOrdner]        # Standard: ./export
 *   -> erzeugt <exportOrdner>/Gesamtdokument.pdf
 */
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";

const outBase = path.resolve(process.argv[2] ?? "export");
const pagesFile = path.join(outBase, "pages.json");

if (!fs.existsSync(pagesFile)) {
  console.error(`Seitenliste nicht gefunden: ${pagesFile}`);
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(pagesFile, "utf8"));
const pages = Array.isArray(raw) ? raw : [raw];

const merged = await PDFDocument.create();
let count = 0;
for (const p of pages) {
  const pdfPath = path.join(outBase, p.pdf);
  if (!fs.existsSync(pdfPath)) {
    console.warn(`Uebersprungen (fehlt): ${p.pdf}`);
    continue;
  }
  const doc = await PDFDocument.load(fs.readFileSync(pdfPath));
  const copied = await merged.copyPages(doc, doc.getPageIndices());
  copied.forEach((pg) => merged.addPage(pg));
  count++;
}

if (count === 0) {
  console.error("Keine PDFs gefunden - zuerst export-pdf.mjs ausfuehren.");
  process.exit(1);
}

const outFile = path.join(outBase, "Gesamtdokument.pdf");
fs.writeFileSync(outFile, await merged.save());
console.log(`${count} PDFs zusammengefuehrt: ${outFile}`);
