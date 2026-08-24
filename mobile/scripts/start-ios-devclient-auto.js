#!/usr/bin/env node

const { spawn, execFileSync } = require('node:child_process');

const SCHEME = process.env.IOS_DEV_CLIENT_SCHEME || 'com.flyfam.app';
const PORT = process.env.EXPO_DEV_PORT || '8082';
const HOST = process.env.EXPO_DEV_HOST || '127.0.0.1';
const METRO_URL = `http://${HOST}:${PORT}`;
const DEEP_LINK = `${SCHEME}://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`;

function listAvailableIphoneSimulators() {
  try {
    const json = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(json);
    const devicesByRuntime = parsed.devices || {};
    const out = [];
    for (const list of Object.values(devicesByRuntime)) {
      if (!Array.isArray(list)) continue;
      for (const d of list) {
        if (!d?.isAvailable || !d.udid) continue;
        const name = d.name || '';
        if (!/iPhone/i.test(name)) continue;
        out.push({
          udid: d.udid,
          name,
          state: d.state || '',
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function isUdidAvailable(udid) {
  return listAvailableIphoneSimulators().some((d) => d.udid === udid);
}

function resolveDefaultIphoneSimulatorUdid() {
  const list = listAvailableIphoneSimulators();
  if (list.length === 0) return null;
  const booted = list.find((c) => c.state === 'Booted');
  return (booted || list[0]).udid;
}

function resolveDeviceId() {
  const fromEnv = process.env.IOS_SIMULATOR_UDID?.trim();
  if (fromEnv) {
    if (isUdidAvailable(fromEnv)) return fromEnv;
    console.warn(
      `IOS_SIMULATOR_UDID=${fromEnv} bu makinede "available" bir simülatör değil; yok sayılıyor.\n` +
        'Geçerli cihazlar: xcrun simctl list devices available | grep iPhone\n'
    );
  }
  const auto = resolveDefaultIphoneSimulatorUdid();
  if (auto) return auto;
  console.error(
    'Kullanılabilir iPhone simülatörü bulunamadı.\n' +
      '• Xcode → Settings → Platforms (veya Components): iOS Simulator runtime kur.\n' +
      '• Xcode → Window → Devices and Simulators: bir iPhone simülatörü oluştur.\n' +
      '• Sonra: xcrun simctl list devices available\n' +
      'İstersen: IOS_SIMULATOR_UDID=<udid> npm run ios:devclient:auto\n'
  );
  process.exit(1);
}

const DEVICE_ID = resolveDeviceId();

function runSimctl(args) {
  execFileSync('xcrun', ['simctl', ...args], { stdio: 'pipe' });
}

function ensureSimulatorReady() {
  try {
    runSimctl(['boot', DEVICE_ID]);
  } catch (_) {
    // Device may already be booted; ignore boot errors.
  }

  try {
    execFileSync('open', ['-a', 'Simulator'], { stdio: 'pipe' });
  } catch (_) {
    // Simulator app may already be open.
  }
}

function openDevClientUrl() {
  runSimctl(['openurl', DEVICE_ID, DEEP_LINK]);
  process.stdout.write(`Using simulator ${DEVICE_ID}\nOpened dev client URL on simulator: ${METRO_URL}\n`);
}

function startExpoAndLink() {
  // --offline: avoids Expo CLI startup fetches (telemetry / update checks) that can
  // ETIMEDOUT on flaky networks and crash the process before Metro is ready.
  const useOffline = process.env.EXPO_START_ONLINE !== '1';
  const args = [
    'expo',
    'start',
    '--dev-client',
    '--clear',
    '--port',
    String(PORT),
  ];
  // --offline conflicts with --host/--lan/--localhost in newer Expo CLI.
  if (useOffline) {
    args.push('--offline');
  } else {
    args.push('--host', 'localhost');
  }

  const expo = spawn('npx', args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      REACT_NATIVE_PACKAGER_HOSTNAME: HOST,
      EXPO_NO_TELEMETRY: process.env.EXPO_NO_TELEMETRY ?? '1',
    },
  });

  let deepLinkSent = false;
  const onData = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (!deepLinkSent && (text.includes('Waiting on') || text.includes('Metro waiting on') || text.includes(`:${PORT}`))) {
      deepLinkSent = true;
      try {
        openDevClientUrl();
      } catch (error) {
        process.stderr.write(`Failed to open deep link: ${error.message}\n`);
      }
    }
  };

  expo.stdout.on('data', onData);
  expo.stderr.on('data', (chunk) => process.stderr.write(chunk.toString()));

  expo.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

ensureSimulatorReady();
startExpoAndLink();
