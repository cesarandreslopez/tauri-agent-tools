import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'check-bridge-parity.mjs');
const realBridgePath = path.join(repoRoot, 'examples', 'tauri-bridge', 'src', 'dev_bridge.rs');
const realClientPath = path.join(repoRoot, 'src', 'bridge', 'client.ts');

describe('bridge parity check', () => {
  let tempRoot: string | null = null;

  afterEach(() => {
    if (tempRoot != null) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  it('passes on the real tree', () => {
    const result = runCheck();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Endpoint min-version parity ok.');
  });

  it('fails when ENDPOINT_MIN_VERSION omits a bridge endpoint', () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'bridge-parity-missing-'));
    const clientPath = writeTempSource(
      'client.ts',
      readFileSync(realClientPath, 'utf8').replace(/^\s*'\/health':\s*'[^']+',\n/m, ''),
    );

    const result = runCheck({ TAURI_AGENT_TOOLS_CLIENT_PATH: clientPath });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing ENDPOINT_MIN_VERSION entries: /health');
  });

  it('allows min-versions below the current bridge version', () => {
    // With strict-equality checking this would fail on every BRIDGE_VERSION
    // bump; the semver <= rule keeps legacy entries valid.
    tempRoot = mkdtempSync(path.join(tmpdir(), 'bridge-parity-semver-'));
    const bridgePath = writeTempSource(
      'dev_bridge.rs',
      readFileSync(realBridgePath, 'utf8').replace(
        /BRIDGE_VERSION:\s*&str\s*=\s*"[^"]+";/,
        'BRIDGE_VERSION: &str = "9.9.9";',
      ),
    );

    const result = runCheck({ TAURI_AGENT_TOOLS_BRIDGE_PATH: bridgePath });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Endpoint min-version parity ok.');
  });

  it('fails when a min-version exceeds the bridge version', () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'bridge-parity-newer-'));
    const clientPath = writeTempSource(
      'client.ts',
      readFileSync(realClientPath, 'utf8').replace(
        /'\/health':\s*'[^']+',/,
        "'/health': '9.9.9',",
      ),
    );

    const result = runCheck({ TAURI_AGENT_TOOLS_CLIENT_PATH: clientPath });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ENDPOINT_MIN_VERSION entries newer than bridge');
    expect(result.stderr).toContain('/health=9.9.9');
  });

  it('fails on entries for endpoints the bridge does not serve', () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'bridge-parity-extra-'));
    const clientPath = writeTempSource(
      'client.ts',
      readFileSync(realClientPath, 'utf8').replace(
        /('\/health':\s*'[^']+',)/,
        "$1\n  '/nonexistent': '0.7.0',",
      ),
    );

    const result = runCheck({ TAURI_AGENT_TOOLS_CLIENT_PATH: clientPath });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('extra ENDPOINT_MIN_VERSION entries: /nonexistent');
  });

  function writeTempSource(name: string, source: string): string {
    if (tempRoot == null) throw new Error('tempRoot not initialized');
    const filePath = path.join(tempRoot, name);
    writeFileSync(filePath, source);
    return filePath;
  }
});

function runCheck(env: Record<string, string> = {}): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}
