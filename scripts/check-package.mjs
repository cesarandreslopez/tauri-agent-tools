#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert.equal(lock.version, pkg.version, 'Lockfile version must match package.json');
assert.equal(lock.packages[''].version, pkg.version, 'Root lockfile package version must match');
const skills = ['tauri-agent-tools', 'tauri-bridge-setup', 'tauri-debug-quickstart'];
const skillFiles = skills.map(name => `.agents/skills/${name}/SKILL.md`);
for (const file of skillFiles) {
  const version = readFileSync(file, 'utf8').match(/^version:\s*(\S+)$/m)?.[1];
  assert.equal(version, pkg.version, `${file} version must match package.json`);
}

const args = ['pack', '--dry-run', '--json', '--ignore-scripts'];
const npmPath = process.env.npm_execpath;
const packed = JSON.parse(execFileSync(npmPath ? process.execPath : 'npm', npmPath ? [npmPath, ...args] : args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
}))[0];
assert.equal(packed.version, pkg.version);
const paths = new Set(packed.files.map(file => file.path));
for (const file of [
  'dist/cli.js', 'README.md', 'LICENSE', 'AGENTS.md', 'rust-bridge/README.md', ...skillFiles,
  'examples/tauri-bridge/Cargo.toml', 'examples/tauri-bridge/Cargo.lock',
  'examples/tauri-bridge/build.rs', 'examples/tauri-bridge/tauri.conf.json',
  'examples/tauri-bridge/src/dev_bridge.rs', 'examples/tauri-bridge/src/main.rs',
  'examples/tauri-bridge/icons/icon.png', 'examples/frontend-stub/index.html',
]) assert(paths.has(file), `Missing required package file: ${file}`);
const forbidden = [...paths].filter(file => /(?:^|\/)(?:target|gen|node_modules)\//.test(file));
assert.deepEqual(forbidden, [], 'Build artifacts must not be published');
console.log(`Package v${packed.version}: ${packed.entryCount} files, ${packed.unpackedSize} unpacked bytes; versions and contents verified.`);
