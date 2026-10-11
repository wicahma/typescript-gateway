#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const EXPORT_RE =
  /^(export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|var|interface|type|enum)\s+[A-Za-z0-9_$]+[^\n{=;]*)/gm;

const files = walk(SRC).sort();
const byModule = new Map();

for (const file of files) {
  const rel = relative(ROOT, file);
  const moduleDir = rel.split('/').slice(0, -1).join('/');
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const entries = [];

  for (const m of source.matchAll(EXPORT_RE)) {
    const signature = m[1].trim().replace(/\s+/g, ' ');
    const lineNo = source.slice(0, m.index).split('\n').length;
    let doc = '';
    for (let i = lineNo - 2; i >= 0; i--) {
      const l = lines[i].trim();
      if (l.startsWith('*') || l.startsWith('/*') || l === '') doc = l.replace(/^\/?\*+\/?/, '').trim() + ' ' + doc;
      else break;
    }
    entries.push({ signature, line: lineNo, doc: doc.trim() });
  }

  if (entries.length === 0) continue;
  if (!byModule.has(moduleDir)) byModule.set(moduleDir, []);
  byModule.get(moduleDir).push({ file: rel, entries });
}

for (const [mod, groups] of [...byModule].sort()) {
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  console.log(`\n## ${mod}  (${groups.length} files, ${total} exports)`);
  for (const g of groups) {
    console.log(`\n### ${g.file}`);
    for (const e of g.entries) {
      console.log(`- \`${e.signature}\`${e.doc ? `  — ${e.doc.slice(0, 140)}` : ''}`);
    }
  }
}
