import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  AGENT_BLOCK_BEGIN,
  AGENT_BLOCK_END,
  ensureClaudeImport,
  upsertAgentBlock,
} from '../../src/utils/agent-files';

const TMP = join(__dirname, '../../.tmp-agent-files-test');
const AGENTS = join(TMP, 'AGENTS.md');
const CLAUDE = join(TMP, 'CLAUDE.md');

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('agent files', () => {
  it('creates AGENTS.md with the managed block', () => {
    upsertAgentBlock(AGENTS);
    const out = readFileSync(AGENTS, 'utf-8');
    expect(out).toContain(AGENT_BLOCK_BEGIN);
    expect(out).toContain(AGENT_BLOCK_END);
    expect(out).toContain('dist/docs/index.md');
  });

  it('preserves text outside the managed block and is idempotent', () => {
    writeFileSync(AGENTS, 'my own note\n');
    upsertAgentBlock(AGENTS);
    expect(readFileSync(AGENTS, 'utf-8')).toContain('my own note');
    const once = readFileSync(AGENTS, 'utf-8');
    upsertAgentBlock(AGENTS);
    expect(readFileSync(AGENTS, 'utf-8')).toBe(once);
  });

  it('replaces a stale managed block', () => {
    writeFileSync(AGENTS, `keep me\n\n${AGENT_BLOCK_BEGIN}\nOLD\n${AGENT_BLOCK_END}\ntail\n`);
    upsertAgentBlock(AGENTS);
    const out = readFileSync(AGENTS, 'utf-8');
    expect(out).toContain('keep me');
    expect(out).toContain('tail');
    expect(out).not.toContain('OLD');
    expect(out.match(/BEGIN:tsgate-agent-rules/g)).toHaveLength(1);
  });

  it('creates CLAUDE.md importing AGENTS.md', () => {
    ensureClaudeImport(CLAUDE);
    expect(readFileSync(CLAUDE, 'utf-8').trim()).toBe('@AGENTS.md');
  });

  it('prepends the import to an existing CLAUDE.md only once', () => {
    writeFileSync(CLAUDE, 'user instructions\n');
    ensureClaudeImport(CLAUDE);
    ensureClaudeImport(CLAUDE);
    const out = readFileSync(CLAUDE, 'utf-8');
    expect(out.startsWith('@AGENTS.md')).toBe(true);
    expect(out).toContain('user instructions');
    expect(out.match(/@AGENTS\.md/g)).toHaveLength(1);
  });
});
