#!/usr/bin/env node
/**
 * Automatische Screenshots von Webseiten.
 *
 * Aufruf:
 *     node website_screenshots.js adressen.txt [--ausgang ORDNER] [--breite PX]
 *     node website_screenshots.js "https://example.org/" "https://example.com/"
 *
 * Die Adressliste ist eine Textdatei mit einer Adresse pro Zeile:
 *
 *     # Kommentare und Leerzeilen werden ignoriert
 *     https://player2.zav.westermann.de/player/v1/ui?preview=true&...
 *     https://example.org/seite | eigener-dateiname
 *
 * Hinter einem "|" kann optional ein eigener Dateiname stehen. Ohne Angabe
 * wird der Name aus der Adresse abgeleitet (bevorzugt aus sequenceId /
 * contentId / id, sonst aus Hostname und Pfad).
 *
 * Aufgenommen wird ausschliesslich der Seiteninhalt: Der Browser laeuft
 * unsichtbar im Hintergrund, das Bild enthaelt also weder Adressleiste noch
 * Taskleiste. Die Seite wird zunaechst in voller Groesse (Standard:
 * 1280x800, doppelte Aufloesung) gerendert und danach proportional auf die
 * Zielbreite verkleinert - dadurch bleibt das verkleinerte Bild scharf.
 *
 * Voraussetzungen: Node.js und Playwright inkl. Chromium
 *     npm install -g playwright && npx playwright install chromium
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --------------------------------------------------------------------------
// Playwright laden (lokal oder global installiert)
// --------------------------------------------------------------------------

function ladePlaywright() {
  const versuche = ['playwright', 'playwright-core'];
  for (const name of versuche) {
    try {
      return require(name);
    } catch (fehler) {
      if (fehler.code !== 'MODULE_NOT_FOUND') throw fehler;
    }
  }
  try {
    const globalerOrdner = execSync('npm root -g', { encoding: 'utf8' }).trim();
    for (const name of versuche) {
      const pfad = path.join(globalerOrdner, name);
      if (fs.existsSync(pfad)) return require(pfad);
    }
  } catch (fehler) {
    /* npm nicht auffindbar - unten kommt die verstaendliche Meldung */
  }
  console.error(
    'Fehler: Playwright ist nicht installiert.\n' +
    '  npm install -g playwright && npx playwright install chromium'
  );
  process.exit(2);
}

// --------------------------------------------------------------------------
// Argumente
// --------------------------------------------------------------------------

const STANDARD = {
  ausgang: 'screenshots',
  breite: 210,
  fenster: '1280x800',
  warten: 3000,
  wartenAuf: null,
  ganzeSeite: false,
  zeitlimit: 60000,
  parallel: 3,
  aufloesung: 2,
  nummerieren: false,
};

const HILFE = `
Automatische Screenshots von Webseiten als PNG in fester Breite.

  node website_screenshots.js adressen.txt
  node website_screenshots.js "https://example.org/" "https://example.com/"

Optionen:
  --ausgang ORDNER    Zielordner (Standard: ${STANDARD.ausgang})
  --breite PX         Breite des fertigen PNG (Standard: ${STANDARD.breite})
  --fenster BxH       Renderflaeche des Browsers (Standard: ${STANDARD.fenster})
  --ganze-seite       gesamte scrollbare Seite statt nur der ersten Ansicht
  --warten MS         zusaetzliche Wartezeit nach dem Laden (Standard: ${STANDARD.warten})
  --warten-auf SEL    zusaetzlich auf ein CSS-Element warten, z.B. ".h5p-content"
  --zeitlimit MS      Zeitlimit je Adresse (Standard: ${STANDARD.zeitlimit})
  --parallel N        gleichzeitig geoeffnete Seiten (Standard: ${STANDARD.parallel})
  --aufloesung N      Aufnahme-Aufloesung vor dem Verkleinern (Standard: ${STANDARD.aufloesung})
  --nummerieren       Dateinamen mit laufender Nummer versehen (01_, 02_, ...)
  --hilfe             diese Uebersicht
`.trim();

function ganzeZahl(text, name) {
  const zahl = Number(text);
  if (!Number.isFinite(zahl) || zahl <= 0) {
    console.error(`Fehler: --${name} erwartet eine positive Zahl (erhalten: ${text}).`);
    process.exit(2);
  }
  return zahl;
}

function leseArgumente(argv) {
  const einstellungen = { ...STANDARD };
  const eingaben = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const wert = () => {
      if (i + 1 >= argv.length) {
        console.error(`Fehler: ${arg} erwartet einen Wert.`);
        process.exit(2);
      }
      return argv[++i];
    };

    switch (arg) {
      case '--hilfe': case '--help': case '-h':
        console.log(HILFE); process.exit(0); break;
      case '--ausgang': einstellungen.ausgang = wert(); break;
      case '--breite': einstellungen.breite = ganzeZahl(wert(), 'breite'); break;
      case '--fenster': einstellungen.fenster = wert(); break;
      case '--ganze-seite': einstellungen.ganzeSeite = true; break;
      case '--warten': einstellungen.warten = ganzeZahl(wert(), 'warten'); break;
      case '--warten-auf': einstellungen.wartenAuf = wert(); break;
      case '--zeitlimit': einstellungen.zeitlimit = ganzeZahl(wert(), 'zeitlimit'); break;
      case '--parallel': einstellungen.parallel = ganzeZahl(wert(), 'parallel'); break;
      case '--aufloesung': einstellungen.aufloesung = ganzeZahl(wert(), 'aufloesung'); break;
      case '--nummerieren': einstellungen.nummerieren = true; break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Fehler: unbekannte Option ${arg}. Uebersicht mit --hilfe.`);
          process.exit(2);
        }
        eingaben.push(arg);
    }
  }

  const treffer = /^(\d+)x(\d+)$/.exec(einstellungen.fenster);
  if (!treffer) {
    console.error(`Fehler: --fenster erwartet die Form BREITExHOEHE, z.B. 1280x800 (erhalten: ${einstellungen.fenster}).`);
    process.exit(2);
  }
  einstellungen.fensterBreite = Number(treffer[1]);
  einstellungen.fensterHoehe = Number(treffer[2]);

  return { einstellungen, eingaben };
}

// --------------------------------------------------------------------------
// Adressliste einlesen
// --------------------------------------------------------------------------

function istAdresse(text) {
  return /^https?:\/\//i.test(text) || /^file:\/\//i.test(text);
}

function leseListe(datei) {
  let inhalt;
  try {
    inhalt = fs.readFileSync(datei, 'utf8');
  } catch (fehler) {
    console.error(`Fehler: Adressliste "${datei}" nicht lesbar (${fehler.message}).`);
    process.exit(2);
  }
  const eintraege = [];
  inhalt.split(/\r?\n/).forEach((zeile, nummer) => {
    const text = zeile.trim();
    if (!text || text.startsWith('#')) return;
    const trenner = text.indexOf('|');
    const adresse = (trenner === -1 ? text : text.slice(0, trenner)).trim();
    const name = trenner === -1 ? null : text.slice(trenner + 1).trim() || null;
    if (!istAdresse(adresse)) {
      console.error(`Hinweis: Zeile ${nummer + 1} in "${datei}" ist keine Adresse und wird uebersprungen: ${text}`);
      return;
    }
    eintraege.push({ adresse, name });
  });
  return eintraege;
}

function sammleEintraege(eingaben) {
  if (eingaben.length === 0) {
    console.error('Fehler: keine Adressliste und keine Adressen angegeben. Uebersicht mit --hilfe.');
    process.exit(2);
  }
  const eintraege = [];
  for (const eingabe of eingaben) {
    if (istAdresse(eingabe)) eintraege.push({ adresse: eingabe, name: null });
    else eintraege.push(...leseListe(eingabe));
  }
  return eintraege;
}

// --------------------------------------------------------------------------
// Dateinamen
// --------------------------------------------------------------------------

function saeubere(text) {
  const sauber = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return sauber || 'seite';
}

function nameAusAdresse(adresse) {
  let url;
  try {
    url = new URL(adresse);
  } catch (fehler) {
    return saeubere(adresse);
  }
  for (const schluessel of ['sequenceId', 'contentId', 'contentid', 'id']) {
    const wert = url.searchParams.get(schluessel);
    if (wert) return saeubere(wert);
  }
  let letzterTeil = url.pathname.split('/').filter(Boolean).pop();
  // Endungen wie .html gehoeren nicht in den Namen der Bilddatei.
  if (letzterTeil) letzterTeil = letzterTeil.replace(/\.(html?|php|aspx?|jsp)$/i, '');
  return saeubere(letzterTeil ? `${url.hostname}-${letzterTeil}` : url.hostname);
}

function vergebeDateinamen(eintraege, nummerieren) {
  const vergeben = new Set();
  const stellen = String(eintraege.length).length;
  return eintraege.map((eintrag, index) => {
    let basis = saeubere(eintrag.name || nameAusAdresse(eintrag.adresse));
    if (nummerieren) {
      basis = `${String(index + 1).padStart(stellen, '0')}_${basis}`;
    }
    let name = basis;
    let zaehler = 2;
    while (vergeben.has(name.toLowerCase())) name = `${basis}-${zaehler++}`;
    vergeben.add(name.toLowerCase());
    return { ...eintrag, dateiname: `${name}.png` };
  });
}

// --------------------------------------------------------------------------
// Verkleinern (im Browser per Canvas - so wird keine Bildbibliothek benoetigt)
// --------------------------------------------------------------------------

async function verkleinere(hilfsseite, bilddaten, zielbreite) {
  const base64 = await hilfsseite.evaluate(async ({ quelle, zielbreite }) => {
    const bild = new Image();
    bild.src = 'data:image/png;base64,' + quelle;
    await bild.decode();

    let aktuell = bild;
    let breite = bild.naturalWidth;
    let hoehe = bild.naturalHeight;

    // Schrittweises Halbieren vermeidet Treppchen und Flimmern beim
    // starken Verkleinern.
    const zeichne = (zielBreite, zielHoehe, vorlage) => {
      const flaeche = document.createElement('canvas');
      flaeche.width = Math.max(1, zielBreite);
      flaeche.height = Math.max(1, zielHoehe);
      const stift = flaeche.getContext('2d');
      stift.imageSmoothingEnabled = true;
      stift.imageSmoothingQuality = 'high';
      stift.drawImage(vorlage, 0, 0, flaeche.width, flaeche.height);
      return flaeche;
    };

    while (Math.round(breite / 2) > zielbreite) {
      const neueBreite = Math.round(breite / 2);
      const neueHoehe = Math.round(hoehe / 2);
      aktuell = zeichne(neueBreite, neueHoehe, aktuell);
      breite = aktuell.width;
      hoehe = aktuell.height;
    }

    const endBreite = Math.min(zielbreite, breite);
    const endHoehe = Math.round((hoehe * endBreite) / breite);
    const fertig = zeichne(endBreite, endHoehe, aktuell);
    return fertig.toDataURL('image/png').split(',')[1];
  }, { quelle: bilddaten.toString('base64'), zielbreite });

  return Buffer.from(base64, 'base64');
}

// --------------------------------------------------------------------------
// Eine Adresse aufnehmen
// --------------------------------------------------------------------------

async function nimmAuf(kontext, hilfsseite, eintrag, einstellungen) {
  const seite = await kontext.newPage();
  seite.setDefaultTimeout(einstellungen.zeitlimit);
  try {
    await seite.goto(eintrag.adresse, {
      waitUntil: 'domcontentloaded',
      timeout: einstellungen.zeitlimit,
    });

    // Nachladende Inhalte abwarten - schlaegt bei Seiten mit dauerhafter
    // Verbindung (Websockets, Video) fehl, das ist unkritisch.
    await seite.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    if (einstellungen.wartenAuf) {
      await seite.waitForSelector(einstellungen.wartenAuf, {
        state: 'visible',
        timeout: einstellungen.zeitlimit,
      });
    }

    if (einstellungen.warten > 0) {
      await seite.waitForTimeout(einstellungen.warten);
    }

    // Bildlaufleisten wuerden im verkleinerten Bild nur als Streifen stoeren.
    await seite.addStyleTag({
      content: '::-webkit-scrollbar { width: 0 !important; height: 0 !important; }',
    }).catch(() => {});

    const rohbild = await seite.screenshot({
      type: 'png',
      fullPage: einstellungen.ganzeSeite,
      scale: 'device',
      animations: 'disabled',
      timeout: einstellungen.zeitlimit,
    });

    const fertig = await verkleinere(hilfsseite, rohbild, einstellungen.breite);
    const ziel = path.join(einstellungen.ausgang, eintrag.dateiname);
    fs.writeFileSync(ziel, fertig);
    return { ok: true, ziel, groesse: fertig.length };
  } finally {
    await seite.close().catch(() => {});
  }
}

// --------------------------------------------------------------------------
// Ablauf
// --------------------------------------------------------------------------

async function arbeiteAb(aufgaben, parallel, arbeiter) {
  let naechste = 0;
  const laeufer = Array.from({ length: Math.min(parallel, aufgaben.length) }, async () => {
    while (naechste < aufgaben.length) {
      const index = naechste++;
      await arbeiter(aufgaben[index], index);
    }
  });
  await Promise.all(laeufer);
}

async function main() {
  const { einstellungen, eingaben } = leseArgumente(process.argv.slice(2));
  const eintraege = vergebeDateinamen(sammleEintraege(eingaben), einstellungen.nummerieren);

  if (eintraege.length === 0) {
    console.error('Fehler: keine gueltige Adresse gefunden.');
    process.exit(2);
  }

  fs.mkdirSync(einstellungen.ausgang, { recursive: true });

  const { chromium } = ladePlaywright();
  const browser = await chromium.launch({ args: ['--hide-scrollbars'] });
  const kontext = await browser.newContext({
    viewport: { width: einstellungen.fensterBreite, height: einstellungen.fensterHoehe },
    deviceScaleFactor: einstellungen.aufloesung,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });

  let erfolge = 0;
  const fehler = [];

  try {
    const hilfsseiten = [];
    for (let i = 0; i < Math.min(einstellungen.parallel, eintraege.length); i++) {
      const hilfsseite = await kontext.newPage();
      await hilfsseite.goto('about:blank');
      hilfsseiten.push(hilfsseite);
    }
    let naechsteHilfsseite = 0;

    await arbeiteAb(eintraege, einstellungen.parallel, async (eintrag) => {
      const hilfsseite = hilfsseiten[naechsteHilfsseite++ % hilfsseiten.length];
      try {
        const ergebnis = await nimmAuf(kontext, hilfsseite, eintrag, einstellungen);
        erfolge++;
        console.log(`OK      ${eintrag.dateiname}  (${(ergebnis.groesse / 1024).toFixed(1)} kB)  <- ${eintrag.adresse}`);
      } catch (problem) {
        const meldung = (problem && problem.message ? problem.message : String(problem)).split('\n')[0];
        fehler.push({ eintrag, meldung });
        console.log(`FEHLER  ${eintrag.dateiname}: ${meldung}  <- ${eintrag.adresse}`);
      }
    });
  } finally {
    await kontext.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  console.log(
    `\nFertig: ${erfolge} von ${eintraege.length} Screenshots erstellt ` +
    `(Breite ${einstellungen.breite} px, Ordner "${einstellungen.ausgang}").`
  );
  process.exit(fehler.length > 0 ? 1 : 0);
}

main().catch((fehler) => {
  console.error(`Abbruch: ${fehler && fehler.stack ? fehler.stack : fehler}`);
  process.exit(2);
});
