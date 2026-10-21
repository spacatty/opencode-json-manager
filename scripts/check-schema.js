#!/usr/bin/env node
'use strict';

// Compares the live OpenCode config schema with the bundled snapshot in
// schema/opencode-config.schema.json and reports what changed.
//   npm run check-schema    -> report only, exit 1 if changed
//   npm run update-schema   -> report and overwrite the snapshot

const fs = require('fs');
const { SCHEMA_URL, BUNDLED_SCHEMA } = require('../src/discover');

// Definitions the UI relies on directly (Providers tab writes these shapes).
const WATCHED = [
  ['properties', 'provider'],
  ['properties', 'providers'],
  ['properties', 'model'],
  ['properties', 'small_model'],
  ['$defs', 'ProviderConfig'],
  ['$defs', 'Config.ProviderEncoded'],
  ['$defs', 'Config.ModelEncoded'],
];

const get = (o, p) => p.reduce((a, k) => (a == null ? a : a[k]), o);
const keys = (o) => new Set(Object.keys(o || {}));

function diffKeys(label, a, b, out) {
  const ka = keys(a);
  const kb = keys(b);
  const added = [...kb].filter((k) => !ka.has(k));
  const removed = [...ka].filter((k) => !kb.has(k));
  const changed = [...kb].filter((k) => ka.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  if (added.length) out.push(`${label}: added ${added.join(', ')}`);
  if (removed.length) out.push(`${label}: removed ${removed.join(', ')}`);
  return changed;
}

async function main() {
  const update = process.argv.includes('--update');
  const res = await fetch(SCHEMA_URL);
  if (!res.ok) throw new Error(`Failed to fetch ${SCHEMA_URL}: HTTP ${res.status}`);
  const live = await res.json();
  const bundled = fs.existsSync(BUNDLED_SCHEMA) ? JSON.parse(fs.readFileSync(BUNDLED_SCHEMA, 'utf8')) : {};

  const out = [];
  const changedProps = diffKeys('top-level properties', bundled.properties, live.properties, out);
  const changedDefs = diffKeys('$defs', bundled.$defs, live.$defs, out);
  if (changedProps.length) out.push(`top-level properties changed: ${changedProps.join(', ')}`);
  if (changedDefs.length) out.push(`$defs changed: ${changedDefs.join(', ')}`);

  const watched = [];
  for (const p of WATCHED) {
    const a = get(bundled, p);
    const b = get(live, p);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const label = p.join('.');
    watched.push(label);
    const sub = [];
    diffKeys(`  ${label}.properties`, a?.properties, b?.properties, sub);
    const legacyModels = (s) => s?.properties?.models?.additionalProperties?.properties;
    if (legacyModels(a) || legacyModels(b)) diffKeys(`  ${label} model fields`, legacyModels(a), legacyModels(b), sub);
    if (a?.deprecated !== b?.deprecated) sub.push(`  ${label}: deprecated ${a?.deprecated} -> ${b?.deprecated}`);
    out.push(`WATCHED ${label} changed`, ...sub);
  }

  if (!out.length) {
    console.log('Schema snapshot is up to date.');
    return;
  }
  console.log(`Live schema differs from the bundled snapshot:\n\n${out.join('\n')}\n`);
  if (watched.length) console.log('⚠ Definitions used by the Providers tab changed. Review src/discover.js (buildSuggestion) and public/app.js (modelEditor, addSelected).\n');
  if (update) {
    fs.writeFileSync(BUNDLED_SCHEMA, JSON.stringify(live, null, 2) + '\n');
    console.log(`Snapshot updated: ${BUNDLED_SCHEMA}`);
  } else {
    console.log('Run `npm run update-schema` to refresh the snapshot after reviewing.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
