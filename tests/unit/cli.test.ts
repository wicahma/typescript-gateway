import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';

const CLI = join(__dirname, '../../dist/cli.js');
const TMP = join(__dirname, '../../.tmp-cli-test');

describe('tsgate CLI', () => {
  it('prints usage on unknown command', () => {
    try {
      execFileSync('node', [CLI, 'nope'], { encoding: 'utf-8', stdio: 'pipe' });
      expect.unreachable();
    } catch (e: unknown) {
      const err = e as { stdout: string };
      expect(err.stdout).toContain('tsgate init');
    }
  });

  it('init scaffolds config, package.json, and a plugin', () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    execFileSync('node', [CLI, 'init', TMP], { encoding: 'utf-8' });
    expect(existsSync(join(TMP, 'gateway.config.json'))).toBe(true);
    expect(existsSync(join(TMP, 'package.json'))).toBe(true);
    expect(existsSync(join(TMP, 'plugins', 'hello.ts'))).toBe(true);
    const cfg = JSON.parse(readFileSync(join(TMP, 'gateway.config.json'), 'utf-8'));
    expect(cfg.routes.length).toBeGreaterThan(0);
    expect(cfg.upstreams.length).toBeGreaterThan(0);
    rmSync(TMP, { recursive: true, force: true });
  });

  it('validate accepts the scaffolded config', () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    execFileSync('node', [CLI, 'init', TMP], { encoding: 'utf-8' });
    const out = execFileSync('node', [CLI, 'validate', '-c', join(TMP, 'gateway.config.json')], { encoding: 'utf-8' });
    expect(out).toContain('OK:');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('validate rejects a malformed config', () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    const bad = join(TMP, 'bad.json');
    require('fs').writeFileSync(bad, '{ not json');
    try {
      execFileSync('node', [CLI, 'validate', '-c', bad], { encoding: 'utf-8', stdio: 'pipe' });
      expect.unreachable();
    } catch {
      expect(true).toBe(true);
    }
    rmSync(TMP, { recursive: true, force: true });
  });
});
