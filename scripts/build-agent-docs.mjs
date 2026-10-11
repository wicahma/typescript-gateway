import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'site', 'src', 'content', 'docs', 'docs');
const dest = join(root, 'dist', 'docs');

if (!existsSync(src)) {
  console.error(`bundled docs source not found: ${src}`);
  process.exit(1);
}

const walk = dir =>
  readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.md') ? [full] : [];
  });

rmSync(dest, { recursive: true, force: true });
const files = walk(src);
for (const file of files) {
  const target = join(dest, relative(src, file));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(file, target);
}

const listing = files
  .map(file => relative(src, file))
  .sort()
  .map(rel => `- [${rel}](./${rel})`)
  .join('\n');

writeFileSync(
  join(dest, 'index.md'),
  `# TypeScript Gateway - bundled docs\n\nVersion-matched documentation for the installed \`typescript-gateway\` package. Read these before writing code.\n\n${listing}\n`
);

console.log(`bundled docs: ${files.length} files -> dist/docs`);
