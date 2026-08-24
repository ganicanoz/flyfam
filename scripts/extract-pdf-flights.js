#!/usr/bin/env node
/**
 * Extract text from a PDF and run the same flight parsing logic as the app.
 * Usage: node scripts/extract-pdf-flights.js <path-to.pdf>
 */
const fs = require('fs');
const path = require('path');

const pdfPath = process.argv[2] || '/Users/mineoz/Downloads/19.03.26-19.04.26.pdf';
if (!fs.existsSync(pdfPath)) {
  console.error('File not found:', pdfPath);
  process.exit(1);
}

const MONTH_THY = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

// Pegasus: DD.MM.YY and "PC 291", date carried across lines.
function parsePegasus(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  const dateRe = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/g;
  const flightRe = /\b([A-Z]{2,3})\s*(\d{2,4})\b/g;
  let lastDateIso = null;
  for (const line of lines) {
    const dates = [];
    let m;
    dateRe.lastIndex = 0;
    while ((m = dateRe.exec(line)) !== null) {
      let y = m[3];
      if (y.length === 2) y = '20' + y;
      dates.push({ d: m[1].padStart(2, '0'), m: m[2].padStart(2, '0'), y });
    }
    if (dates.length) lastDateIso = dates[0].y + '-' + dates[0].m + '-' + dates[0].d;
    const numbers = [];
    flightRe.lastIndex = 0;
    while ((m = flightRe.exec(line)) !== null) {
      if (m[2].length >= 3) numbers.push((m[1] + m[2]).toUpperCase());
    }
    const iso = lastDateIso;
    if (iso && numbers.length) {
      for (const fn of numbers) out.push({ flight_number: fn, flight_date: iso });
    }
  }
  return out;
}

// THY/AJet etc.: lines with TK, VF, or any XX#### and date DDMMMYYYY.
function parseTHY(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  const flightRe = /\b([A-Z]{2,3}\d{2,4})\b/g;
  const dateRe = /(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})/gi;
  for (const line of lines) {
    const numbers = [];
    flightRe.lastIndex = 0;
    let m;
    while ((m = flightRe.exec(line)) !== null) numbers.push(m[1].toUpperCase());
    const dates = [];
    dateRe.lastIndex = 0;
    while ((m = dateRe.exec(line)) !== null) {
      const mon = (m[2] || '').toUpperCase();
      const mm = MONTH_THY[mon] || '01';
      dates.push(m[3] + '-' + mm + '-' + (m[1] || '').padStart(2, '0'));
    }
    if (numbers.length && dates.length) {
      const iso = dates[0];
      for (const fn of numbers) out.push({ flight_number: fn, flight_date: iso });
    }
  }
  return out;
}

// Same logic as in AddFlight.tsx. Pegasus + THY, merged and deduped.
function parseFlightsFromPdfText(text) {
  const seen = new Set();
  const out = [];
  for (const f of [...parsePegasus(text), ...parseTHY(text)]) {
    const key = f.flight_date + '|' + f.flight_number;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  }
  out.sort((a, b) => a.flight_date.localeCompare(b.flight_date));
  return out;
}

async function main() {
  let text;
  try {
    const { PDFParse } = require('pdf-parse');
    const dataBuffer = fs.readFileSync(pdfPath);
    const parser = new PDFParse({ data: dataBuffer });
    const result = await parser.getText();
    text = result.text || (typeof result === 'string' ? result : '');
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.error('Run: npm install pdf-parse (in project root or mobile)');
      process.exit(1);
    }
    throw e;
  }

  console.log('--- Extracted text (first 2000 chars) ---');
  console.log(text.slice(0, 2000));
  console.log('\n--- Parsed flights (same logic as app) ---');
  const flights = parseFlightsFromPdfText(text);
  flights.forEach((f, i) => console.log(`${i + 1}. ${f.flight_date} ${f.flight_number}`));
  console.log('\nTotal:', flights.length, 'flights');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
