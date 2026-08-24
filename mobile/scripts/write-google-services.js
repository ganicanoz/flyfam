#!/usr/bin/env node
/**
 * EAS Build: writes google-services.json from GOOGLE_SERVICES_JSON env to project root.
 * Path is resolved from script location so it works regardless of cwd.
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const outPath = path.join(projectRoot, 'google-services.json');
const json = process.env.GOOGLE_SERVICES_JSON;

if (json && json.trim()) {
  fs.writeFileSync(outPath, json.trim(), 'utf8');
  console.log('Wrote google-services.json to', outPath);
  process.exit(0);
}

if (fs.existsSync(outPath)) {
  console.log('google-services.json already exists at', outPath);
  process.exit(0);
}

console.error('GOOGLE_SERVICES_JSON is not set and google-services.json not found. Set EAS Secret GOOGLE_SERVICES_JSON for Android builds.');
process.exit(1);
