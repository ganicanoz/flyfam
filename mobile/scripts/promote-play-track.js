#!/usr/bin/env node
/**
 * Promote an existing versionCode to a Play Console track via Android Publisher API.
 * Usage:
 *   node scripts/promote-play-track.js --track alpha --version-code 36
 *   GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/key.json node scripts/promote-play-track.js ...
 */
const fs = require('fs');
const path = require('path');

const PACKAGE = 'com.flyfam.app';
const DEFAULT_KEY = path.join(__dirname, '../../docs/flyfam-7a504-firebase-adminsdk-fbsvc-be34ce78bb.json');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const track = arg('--track', 'alpha');
  const versionCode = String(arg('--version-code', '36'));
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || DEFAULT_KEY;

  if (!fs.existsSync(keyPath)) {
    console.error('Service account JSON not found:', keyPath);
    process.exit(1);
  }

  const { google } = await import('googleapis');
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const androidpublisher = google.androidpublisher({ version: 'v3', auth });

  const editRes = await androidpublisher.edits.insert({ packageName: PACKAGE });
  const editId = editRes.data.id;
  console.log('Edit created:', editId);

  const tracksRes = await androidpublisher.edits.tracks.list({
    packageName: PACKAGE,
    editId,
  });
  const tracks = tracksRes.data.tracks || [];
  console.log(
    'Current tracks:',
    tracks.map((t) => `${t.track} -> ${(t.releases || []).flatMap((r) => r.versionCodes || []).join(',')}`).join(' | '),
  );

  await androidpublisher.edits.tracks.update({
    packageName: PACKAGE,
    editId,
    track,
    requestBody: {
      track,
      releases: [
        {
          name: `FlyFam 1.3.0 (${versionCode})`,
          status: 'completed',
          versionCodes: [Number(versionCode)],
        },
      ],
    },
  });
  console.log(`Assigned versionCode ${versionCode} to track "${track}"`);

  const commitRes = await androidpublisher.edits.commit({ packageName: PACKAGE, editId });
  console.log('Committed edit:', commitRes.data.id || editId);
  console.log('Done. Play may take a few minutes to propagate.');
}

main().catch((err) => {
  console.error(err.response?.data || err.message || err);
  process.exit(1);
});
