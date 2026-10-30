// Maakt van de webversie een app voor het beginscherm (iPhone en andere telefoons):
// schermvullend zonder browserbalk, met eigen naam en icoon.
// Gebruik: node scripts/pwa.mjs <map met de gebouwde site> [basispad, bijv. /sellout-radar]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const base = (process.argv[3] ?? '').replace(/\/$/, '');
if (!dir) throw new Error('Gebruik: node scripts/pwa.mjs <map> [basispad]');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

fs.copyFileSync(path.join(root, 'assets/icon.png'), path.join(dir, 'app-icon.png'));
// Service worker voor meldingen (Web Push); staat in de hoofdmap van de site, zodat hij overal geldt.
fs.copyFileSync(path.join(root, 'scripts/sw.js'), path.join(dir, 'sw.js'));
const manifest = {
  name: 'Sellout Radar',
  short_name: 'Sellout Radar',
  start_url: `${base}/`,
  scope: `${base}/`,
  display: 'standalone',
  background_color: '#0B0F14',
  theme_color: '#0B0F14',
  icons: [{ src: `${base}/app-icon.png`, sizes: '1024x1024', type: 'image/png', purpose: 'any' }],
};
fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

const tags = [
  `<link rel="manifest" href="${base}/manifest.webmanifest">`,
  `<link rel="apple-touch-icon" href="${base}/app-icon.png">`,
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<meta name="apple-mobile-web-app-title" content="Sellout Radar">',
].join('\n');
for (const f of ['index.html', '404.html']) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) continue;
  let html = fs.readFileSync(p, 'utf8');
  if (html.includes('apple-mobile-web-app-capable')) continue;
  html = html.replace('</head>', `${tags}\n</head>`);
  fs.writeFileSync(p, html);
}
console.log(`Beginscherm-app klaar in ${dir} (basispad "${base || '/'}")`);
