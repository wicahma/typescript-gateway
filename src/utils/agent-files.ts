import { existsSync, readFileSync, writeFileSync } from 'fs';

export const AGENT_BLOCK_BEGIN = '<!-- BEGIN:tsgate-agent-rules -->';
export const AGENT_BLOCK_END = '<!-- END:tsgate-agent-rules -->';

export const AGENT_RULES = `${AGENT_BLOCK_BEGIN}
# This is NOT the TypeScript Gateway you know

This version may have breaking changes - APIs, config keys, and plugin hooks may differ from your training data. Read the version-matched docs bundled in \`node_modules/typescript-gateway/dist/docs/\` (resolved from this file's directory; in monorepos the package may not be visible from the repo root) before writing any code.

Start with \`node_modules/typescript-gateway/dist/docs/index.md\` for the full list of bundled guides and references. Heed deprecation notices.

This block is written and re-added by \`tsgate init\` and \`tsgate start\`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.
${AGENT_BLOCK_END}`;

const CLAUDE_IMPORT = '@AGENTS.md';

export function upsertAgentBlock(path: string): void {
  if (!existsSync(path)) {
    writeFileSync(path, AGENT_RULES + '\n');
    return;
  }
  const existing = readFileSync(path, 'utf-8');
  const start = existing.indexOf(AGENT_BLOCK_BEGIN);
  const end = existing.indexOf(AGENT_BLOCK_END);
  if (start >= 0 && end > start) {
    writeFileSync(
      path,
      existing.slice(0, start) + AGENT_RULES + existing.slice(end + AGENT_BLOCK_END.length)
    );
    return;
  }
  const body = existing.replace(/\s+$/, '');
  writeFileSync(path, body ? body + '\n\n' + AGENT_RULES + '\n' : AGENT_RULES + '\n');
}

export function ensureClaudeImport(path: string): void {
  if (!existsSync(path)) {
    writeFileSync(path, CLAUDE_IMPORT + '\n');
    return;
  }
  const existing = readFileSync(path, 'utf-8');
  if (existing.split('\n').some(line => line.trim() === CLAUDE_IMPORT)) return;
  writeFileSync(path, CLAUDE_IMPORT + '\n\n' + existing.replace(/^\n+/, ''));
}
