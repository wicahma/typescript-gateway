#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'site', 'dist');

if (!existsSync(DIST)) {
  console.error(`site/dist not found — run: cd site && npm run build`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

function resolves(pathname) {
  const clean = pathname.split('#')[0].split('?')[0];
  if (clean === '' || clean === '/') return existsSync(join(DIST, 'index.html'));
  const base = clean.endsWith('/') ? clean.slice(0, -1) : clean;
  const target = join(DIST, base.slice(1));
  if (existsSync(target) && statSync(target).isFile()) return true;
  return existsSync(join(target, 'index.html')) || existsSync(target + '.html');
}

const HREF_RE = /href="(\/[^"#][^"]*)"/g;
const broken = [];
let checked = 0;

for (const file of walk(DIST)) {
  const html = readFileSync(file, 'utf8');
  const page = '/' + relative(DIST, file).replace(/index\.html$/, '');
  for (const m of html.matchAll(HREF_RE)) {
    const href = m[1];
    if (href.startsWith('//')) continue;
    checked++;
    if (!resolves(href)) broken.push({ page, href });
  }
}

const unique = [...new Map(broken.map(b => [b.page + ' -> ' + b.href, b])).values()];

console.log(`checked ${checked} internal links across ${walk(DIST).length} pages`);
if (unique.length === 0) {
  console.log('OK: no broken internal links');
  process.exit(0);
}

console.error(`FAIL: ${unique.length} broken internal links`);
for (const b of unique.slice(0, 60)) console.error(`  ${b.page}  ->  ${b.href}`);
process.exit(1);
