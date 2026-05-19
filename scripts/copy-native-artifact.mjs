#!/usr/bin/env node
// Copy a cargo build artifact into build/win/ so electron-builder can
// pick it up as an extraResource. Cross-platform (cmd / sh / PS).
//
// Usage: node scripts/copy-native-artifact.mjs <source> <destName>
//
// <source>    : path relative to the repo root, e.g.
//               tools/local-dat-redirect/target/release/axiam_local_dat_redirect.dll
// <destName>  : filename only, dropped into build/win/, e.g.
//               axiam_local_dat_redirect.dll

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , source, destName] = process.argv;
if (!source || !destName) {
  console.error('usage: copy-native-artifact.mjs <source> <destName>');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcAbs = resolve(repoRoot, source);
const destDir = resolve(repoRoot, 'build', 'win');
const destAbs = resolve(destDir, destName);

mkdirSync(destDir, { recursive: true });
copyFileSync(srcAbs, destAbs);
console.log(`copied ${srcAbs} → ${destAbs}`);
