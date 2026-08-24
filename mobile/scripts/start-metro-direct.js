#!/usr/bin/env node
/**
 * Metro'yu Expo CLI olmadan başlatır (file notifier takılmasını atlar).
 * .env dosyasını yükleyip Metro'yu aynı process env ile çalıştırır.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const i = trimmed.indexOf('=');
    if (i <= 0) return;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    process.env[key] = val;
  });
}

const metroCli = path.join(projectRoot, 'node_modules', 'metro', 'src', 'cli.js');
const metroConfig = path.join(projectRoot, 'metro.config.js');

// Dosya izleyici takılmasını azaltmak için polling kullan
const env = {
  ...process.env,
  CHOKIDAR_USEPOLLING: 'true',
  WATCHPACK_POLLING: 'true',
};

console.log('Metro başlatılıyor (polling modu)...');

/** Bare Metro çoğu zaman bundle gelene kadar ekstra log basmaz; kullanıcıya net geri bildirim. */
function logWhenMetroReady(port = 8081, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  const tick = () => {
    const req = http.get(`http://127.0.0.1:${port}/status`, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        console.log(
          `Metro ayakta: http://127.0.0.1:${port} — Simülatör / dev client bu porta bağlanır. İlk yüklemede BUNDLE satırları görünür.`
        );
        return;
      }
      retry();
    });
    req.on('error', retry);
    function retry() {
      if (Date.now() >= deadline) {
        console.warn(
          'Metro /status yanıt vermedi (süre doldu). Port çakışması veya başlatma hatası olabilir; süreç çıktısına bakın.'
        );
        return;
      }
      setTimeout(tick, 400);
    }
  };
  setTimeout(tick, 300);
}
logWhenMetroReady();

const child = spawn(
  process.execPath,
  [metroCli, 'start', '--config', metroConfig, '--reset-cache'],
  {
    cwd: projectRoot,
    stdio: 'inherit',
    env,
  }
);

child.on('exit', (code) => process.exit(code != null ? code : 0));
