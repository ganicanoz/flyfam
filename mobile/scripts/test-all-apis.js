#!/usr/bin/env node
/**
 * Launcher: Proje kökündeki scripts/test-all-apis.js'i çalıştırır.
 * mobile/ içinden: node scripts/test-all-apis.js PC2381 [date]
 * Kökten:           node scripts/test-all-apis.js PC2381 [date]  veya  npm run test-all-apis -- PC2381
 */
const path = require('path');
const { spawnSync } = require('child_process');

const rootScript = path.resolve(__dirname, '..', '..', 'scripts', 'test-all-apis.js');
const node = process.execPath;
const args = [rootScript, ...process.argv.slice(2)];
const result = spawnSync(node, args, { stdio: 'inherit', cwd: path.resolve(__dirname, '..', '..') });
process.exit(result.status ?? 1);
