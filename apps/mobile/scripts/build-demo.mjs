// Bouwt een losse webdemo: één HTML-bestand met alle code erin, plus snapshot.json ernaast.
// Gebruik: npm run build:demo  (schrijft naar apps/mobile/demo/)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist-demo');
const out = path.join(root, 'demo');
execSync(`npx expo export --platform web --output-dir ${dist} --clear`, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_DEMO_ROOT_FIX: '1', EXPO_PUBLIC_SNAPSHOT_URL: '', EXPO_OFFLINE: '1', CI: '1' },
});
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)" defer><\/script>/g)].map((m) => m[1]);
html = html.replace(/<script src="[^"]+" defer><\/script>/g, '');
html = html.replace(/<link rel="icon"[^>]*>/, '');
html = html.replace('<html lang="en">', '<html lang="nl">');
const inline = scripts
  .map((src) => fs.readFileSync(path.join(dist, src.replace(/^\//, '')), 'utf8').replace(/<\/script/gi, '<\\/script'))
  .map((code) => `<script>${code}</script>`)
  .join('\n');
html = html.replace('</body>', () => `${inline}\n</body>`);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);

// Variant voor publicatie als artifact: zonder eigen <html>/<head>/<body> (die levert de host),
// met een achtergrond die het lichte/donkere thema van de host volgt.
const headEnd = html.indexOf('</head>');
const head = html.slice(0, headEnd);
const bodyStart = html.indexOf('<body>', headEnd) + '<body>'.length;
const bodyEnd = html.lastIndexOf('</body>');
const title = head.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Sellout Radar</title>';
const reset = head.match(/<style id="expo-reset">[\s\S]*?<\/style>/)?.[0] ?? '';
const hostStyle = `<style id="sr-host">
  :root { --sr-bg: #F5F6F8; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --sr-bg: #0B0F14; color-scheme: dark; } }
  :root[data-theme="dark"] { --sr-bg: #0B0F14; color-scheme: dark; }
  body { background: var(--sr-bg); }
</style>`;
fs.writeFileSync(path.join(out, 'artifact.html'), `${title}\n${reset}\n${hostStyle}\n${html.slice(bodyStart, bodyEnd)}`);
fs.copyFileSync(path.resolve(root, '../../data/snapshot.json'), path.join(out, 'snapshot.json'));
fs.rmSync(dist, { recursive: true, force: true });
console.log(`Demo klaar: ${out} (${Math.round(fs.statSync(path.join(out, 'index.html')).size / 1024)} kB)`);
