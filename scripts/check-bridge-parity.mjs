#!/usr/bin/env node

/**
 * Bridge protocol parity linter for tauri-agent-tools.
 *
 * The bridge protocol is defined twice: the Rust reference bridge
 * (examples/tauri-bridge/src/dev_bridge.rs) declares BRIDGE_VERSION and the
 * endpoint list served by /version, while the TypeScript client
 * (src/bridge/client.ts) declares ENDPOINT_MIN_VERSION for feature-detecting
 * version-gated endpoints. Nothing else keeps those literals in sync — this
 * script does, by regex-parsing both sources and asserting:
 *
 *   1. Every non-base endpoint in the bridge's `endpoints: vec![...]` has an
 *      ENDPOINT_MIN_VERSION entry (missing → fail).
 *   2. ENDPOINT_MIN_VERSION has no entries for endpoints the bridge does not
 *      serve (extra → fail).
 *   3. Every min-version is <= BRIDGE_VERSION by semver comparison — NOT
 *      strict equality, so entries for endpoints introduced in older protocol
 *      versions keep passing after BRIDGE_VERSION bumps.
 *
 * Base endpoints (/eval, /logs, /describe, /version) exist on every bridge
 * version and must NOT appear in ENDPOINT_MIN_VERSION; same-path capability
 * additions (e.g. cursor-mode /logs) are feature-detected by response shape,
 * not by min-version gating.
 *
 * Usage:
 *   node scripts/check-bridge-parity.mjs
 *
 * Env overrides (used by tests to point at fixtures):
 *   TAURI_AGENT_TOOLS_BRIDGE_PATH — path to dev_bridge.rs
 *   TAURI_AGENT_TOOLS_CLIENT_PATH — path to client.ts
 *
 * Exit codes:
 *   0 — parity ok
 *   1 — parity violations (or unparseable sources)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BASE_BRIDGE_ENDPOINTS = new Set(['/eval', '/logs', '/describe', '/version']);

const paths = {
  bridge:
    process.env.TAURI_AGENT_TOOLS_BRIDGE_PATH ??
    path.join(repoRoot, 'examples', 'tauri-bridge', 'src', 'dev_bridge.rs'),
  client:
    process.env.TAURI_AGENT_TOOLS_CLIENT_PATH ?? path.join(repoRoot, 'src', 'bridge', 'client.ts'),
};

if (!checkEndpointMinVersionParity()) process.exit(1);

function checkEndpointMinVersionParity() {
  let bridgeVersion;
  let endpoints;
  let minVersions;
  try {
    const bridgeSource = read(paths.bridge);
    bridgeVersion = parseBridgeVersion(bridgeSource);
    endpoints = parseStringArray(
      bridgeSource,
      /endpoints:\s*vec!\[([\s\S]*?)\]/,
      'reference bridge endpoints',
    );
    minVersions = parseEndpointMinVersions(read(paths.client));
  } catch (error) {
    console.error(errorMessage(error));
    return false;
  }

  const versionedEndpoints = endpoints.filter((endpoint) => !BASE_BRIDGE_ENDPOINTS.has(endpoint));
  const minVersionEndpoints = Object.keys(minVersions);

  const missing = versionedEndpoints.filter((endpoint) => minVersions[endpoint] == null);
  const extra = minVersionEndpoints.filter((endpoint) => !versionedEndpoints.includes(endpoint));
  const mismatched = versionedEndpoints.filter(
    (endpoint) =>
      minVersions[endpoint] != null && compareSemver(minVersions[endpoint], bridgeVersion) > 0,
  );

  if (missing.length > 0) {
    console.error(`missing ENDPOINT_MIN_VERSION entries: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    console.error(`extra ENDPOINT_MIN_VERSION entries: ${extra.join(', ')}`);
  }
  if (mismatched.length > 0) {
    console.error(
      `ENDPOINT_MIN_VERSION entries newer than bridge ${bridgeVersion}: ${mismatched
        .map((endpoint) => `${endpoint}=${minVersions[endpoint]}`)
        .join(', ')}`,
    );
  }
  if (missing.length > 0 || extra.length > 0 || mismatched.length > 0) return false;

  console.log('Endpoint min-version parity ok.');
  return true;
}

function parseStringArray(source, pattern, label) {
  const match = source.match(pattern);
  if (match == null) throw new Error(`Could not find ${label}.`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

function parseBridgeVersion(source) {
  const match = source.match(/BRIDGE_VERSION:\s*&str\s*=\s*"([^"]+)"/);
  if (match == null) throw new Error('Could not find reference bridge BRIDGE_VERSION.');
  return match[1];
}

function parseEndpointMinVersions(source) {
  const match = source.match(/const\s+ENDPOINT_MIN_VERSION:[\s\S]*?=\s*\{([\s\S]*?)\};/);
  if (match == null) throw new Error('Could not find ENDPOINT_MIN_VERSION.');
  const entries = {};
  for (const item of match[1].matchAll(/['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g)) {
    entries[item[1]] = item[2];
  }
  return entries;
}

function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (match == null) throw new Error(`Invalid semver version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
