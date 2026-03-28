#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;
    const key = match[1];
    let value = match[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
};

loadEnvFile(path.join(rootDir, '.env'));

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const outputDirName = packageJson?.build?.directories?.output || 'dist_out';
const outputDir = path.join(rootDir, outputDirName);
if (fs.existsSync(outputDir)) {
  fs.rmSync(outputDir, { recursive: true, force: true });
}

const buildAll = process.env.AXIAM_BUILD_ALL === '1';
const platformArgs = buildAll
  ? ['--linux', '--win']
  : process.platform === 'win32'
    ? ['--win']
    : process.platform === 'linux'
      ? ['--linux']
      : ['--win'];
const args = ['electron-builder', ...platformArgs, '--publish', 'never'];
const runEnv = { ...process.env };
if (
  process.platform === 'win32' &&
  !runEnv.CSC_LINK &&
  !runEnv.WIN_CSC_LINK &&
  !runEnv.CSC_NAME &&
  !runEnv.WIN_CSC_NAME &&
  !runEnv.CSC_IDENTITY_AUTO_DISCOVERY
) {
  // Keep local Windows builds unsigned without trying cert auto-discovery/signing helpers.
  runEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}
const isWin = process.platform === 'win32';
const result = isWin
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', `npx ${args.join(' ')}`], { stdio: 'inherit', env: runEnv })
  : spawnSync('npx', args, { stdio: 'inherit', env: runEnv });

if (result.error) {
  console.error(`[run-electron-builder] failed to start: ${result.error.message}`);
  process.exit(1);
}

if ((result.status ?? 1) !== 0) {
  console.error(`[run-electron-builder] electron-builder failed with exit code ${result.status ?? 1}`);
}

process.exit(result.status ?? 1);
