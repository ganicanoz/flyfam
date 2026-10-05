let installPrompt;
const button = document.getElementById('install-app');
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; button.hidden = false;
});
button.addEventListener('click', async () => {
  if (!installPrompt) return;
  try { await installPrompt.prompt(); await installPrompt.userChoice; }
  finally { installPrompt = null; button.hidden = true; }
});
window.addEventListener('appinstalled', () => {
  installPrompt = null; button.hidden = true;
  document.getElementById('install-guide').hidden = true;
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'}).catch(() => {});
  });
}
