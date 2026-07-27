// Extrait de index.html (juillet 2026) — permet une Content-Security-Policy stricte côté
// serveur (script-src 'self' sans 'unsafe-inline'), voir backend/server.js. Un script
// inline dans le HTML aurait forcé à autoriser 'unsafe-inline' pour script-src, ce qui
// affaiblit sensiblement la protection anti-XSS que la CSP est censée apporter.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
