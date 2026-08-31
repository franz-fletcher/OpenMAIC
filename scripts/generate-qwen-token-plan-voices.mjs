#!/usr/bin/env node
/**
 * Downloads the Qwen Audio 3.0 TTS plus-model base-voice workbook published by
 * Alibaba Cloud and emits a deterministic, prettier-clean TypeScript data
 * module at lib/audio/data/qwen-token-plan-base-voices.ts.
 *
 * Scope note: batch 001 is plus-model only. The sibling model failed live
 * provisioning probes on 2026-08-31, so only the plus workbook is ingested.
 * The sibling may return in a later batch.
 *
 * No new repo dependencies: the workbook is a ZIP archive, so we locate
 * xl/worksheets/sheet1.xml by hand (central-directory parse) and decompress it
 * with node:zlib. Cell values are inline strings (<c t="inlineStr">) or numbers
 * (<c t="n">). There is no sharedStrings.xml.
 *
 * Layout (header row, 9 columns):
 *   A No. | B Name | C Voice Parameter | D Gender | E Age
 *   | F Voice Quality | G Applicable Scenario | H Language | I Preview Audio
 *
 * Pass --verify to regenerate to a temp file and compare semantic records and
 * count to the committed module (exits non-zero on drift).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(REPO_ROOT, 'lib', 'audio', 'data', 'qwen-token-plan-base-voices.ts');
const SHEET_PATH = 'xl/worksheets/sheet1.xml';

const SOURCES = [
  {
    url: 'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/en-US/20260723/ulextc/qwen-audio-3.0-tts-plus-base-voices-en.xlsx',
    model: 'qwen-audio-3.0-tts-plus',
  },
];

const GENDER_MAP = { Female: 'female', Male: 'male', 'N/A': 'neutral' };

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// --- minimal ZIP central-directory parse -------------------------------------
function parseZipEntries(buf) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP: end-of-central-directory record not found');

  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = {};

  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error(`ZIP: bad central-directory signature at ${pos}`);
    }
    const method = buf.readUInt16LE(pos + 10);
    const cmpSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const lfhOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

    const lfhNameLen = buf.readUInt16LE(lfhOffset + 26);
    const lfhExtraLen = buf.readUInt16LE(lfhOffset + 28);
    const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;

    entries[name] = { method, cmpSize, dataStart };
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractSheetXml(buf, entryPath) {
  const entries = parseZipEntries(buf);
  const entry = entries[entryPath];
  if (!entry) throw new Error(`ZIP: ${entryPath} not found`);
  const slice = buf.subarray(entry.dataStart, entry.dataStart + entry.cmpSize);
  const xml =
    entry.method === 0
      ? slice.toString('utf8')
      : entry.method === 8
        ? zlib.inflateRawSync(slice).toString('utf8')
        : null;
  if (xml === null) throw new Error(`ZIP: unsupported compression method ${entry.method}`);
  return xml;
}

// --- sheet XML -> row maps --------------------------------------------------
function parseRows(xml) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells = {};
    const cellRe = /<c r="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const col = cellMatch[1].replace(/\d+/, '');
      let val = '';
      const inlineStr = cellMatch[2].match(/<is><t>([\s\S]*?)<\/t><\/is>/);
      const number = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/);
      if (inlineStr) val = unescapeXml(inlineStr[1]);
      else if (number) val = unescapeXml(number[1]);
      cells[col] = val;
    }
    rows.push(cells);
  }
  return rows;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}) ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function buildRecords(rows, model) {
  // First row is the header; skip it.
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const id = (cells.C ?? '').trim();
    if (!id) continue;
    const genderRaw = (cells.D ?? '').trim();
    out.push({
      id,
      name: (cells.B ?? '').trim(),
      language: (cells.H ?? '').trim(),
      gender: GENDER_MAP[genderRaw] ?? 'neutral',
      compatibleModels: [model],
    });
  }
  return out;
}

function escapeStr(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function formatModule(records) {
  const lines = [];
  lines.push('/**');
  lines.push(' * Auto-generated by scripts/generate-qwen-token-plan-voices.mjs.');
  lines.push(' * Base-voice catalog for the Qwen Token Plan TTS provider.');
  lines.push(' *');
  lines.push(' * Sourced from the Alibaba Cloud Qwen Audio 3.0 TTS plus-model workbook.');
  lines.push(' * To regenerate, run:');
  lines.push(' *   node scripts/generate-qwen-token-plan-voices.mjs');
  lines.push(' *');
  lines.push(` * ${records.length} records, all for qwen-audio-3.0-tts-plus, sorted by id.`);
  lines.push(' */');
  lines.push('');
  lines.push("import type { TTSVoiceInfo } from '../types';");
  lines.push('');
  lines.push('export const qwenTokenPlanBaseVoices: TTSVoiceInfo[] = [');
  for (const r of records) {
    const cm = r.compatibleModels.map((m) => `'${m}'`).join(', ');
    lines.push(
      `  { id: '${escapeStr(r.id)}', name: '${escapeStr(r.name)}', language: '${escapeStr(r.language)}', gender: '${escapeStr(r.gender)}', compatibleModels: [${cm}] },`,
    );
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

function runPrettier(filePath) {
  const result = spawnSync('npx', ['prettier', '--write', filePath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`prettier failed: ${result.stderr || result.stdout || result.status}`);
  }
}

// --- verify mode: parse the committed module's records ----------------------
function parseCommittedRecords(text) {
  const start = text.indexOf('= [');
  const end = text.lastIndexOf('];');
  if (start < 0 || end < 0) throw new Error('verify: could not locate records array');
  const arr = text.slice(start + 3, end);
  const records = [];
  const objRe = /\{([^{}]*)\}/g;
  let m;
  while ((m = objRe.exec(arr))) {
    const body = m[1];
    const rec = {};
    const fieldRe = /(\w+):\s*'((?:[^'\\]|\\.)*)'/g;
    let f;
    while ((f = fieldRe.exec(body))) rec[f[1]] = f[2].replace(/\\'/g, "'");
    const cm = body.match(/compatibleModels:\s*\[([^\]]*)\]/);
    if (cm) {
      rec.compatibleModels = [...cm[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]);
    }
    records.push(rec);
  }
  return records;
}

function normalize(rec) {
  return [rec.id, rec.name, rec.language, rec.gender, [...rec.compatibleModels].sort().join(',')];
}

async function verify() {
  const fresh = [];
  for (const src of SOURCES) {
    const buf = await download(src.url);
    const xml = extractSheetXml(buf, SHEET_PATH);
    const rows = parseRows(xml);
    process.stderr.write(`${src.model}: ${rows.length - 1} data rows\n`);
    fresh.push(...buildRecords(rows, src.model));
  }
  fresh.sort((a, b) =>
    a.compatibleModels[0] === b.compatibleModels[0]
      ? a.id.localeCompare(b.id)
      : a.compatibleModels[0].localeCompare(b.compatibleModels[0]),
  );

  if (!fs.existsSync(OUT_PATH)) {
    console.error(`verify: committed file missing at ${OUT_PATH}`);
    process.exit(1);
  }
  const committedText = fs.readFileSync(OUT_PATH, 'utf8');
  const committed = parseCommittedRecords(committedText);

  const freshKey = fresh.map(normalize);
  const committedKey = committed.map(normalize);
  const a = JSON.stringify(freshKey);
  const b = JSON.stringify(committedKey);

  if (fresh.length !== committed.length || a !== b) {
    const freshIds = new Set(fresh.map((r) => r.id));
    const committedIds = new Set(committed.map((r) => r.id));
    const added = [...freshIds].filter((x) => !committedIds.has(x));
    const removed = [...committedIds].filter((x) => !freshIds.has(x));
    console.error(
      `verify FAILED: fresh=${fresh.length} committed=${committed.length} added=${added.length} removed=${removed.length}`,
    );
    process.exit(1);
  }
  console.error(`verify OK: ${fresh.length} records match the committed file`);
}

async function generate() {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const records = [];
  for (const src of SOURCES) {
    const buf = await download(src.url);
    const xml = extractSheetXml(buf, SHEET_PATH);
    const rows = parseRows(xml);
    process.stderr.write(`${src.model}: ${rows.length - 1} data rows\n`);
    records.push(...buildRecords(rows, src.model));
  }
  records.sort((a, b) =>
    a.compatibleModels[0] === b.compatibleModels[0]
      ? a.id.localeCompare(b.id)
      : a.compatibleModels[0].localeCompare(b.compatibleModels[0]),
  );
  fs.writeFileSync(OUT_PATH, formatModule(records), 'utf8');
  runPrettier(OUT_PATH);
  console.error(`wrote ${records.length} records to ${path.relative(REPO_ROOT, OUT_PATH)}`);
}

const verifyMode = process.argv.includes('--verify');
(verifyMode ? verify : generate)().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
