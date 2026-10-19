#!/usr/bin/env node
// Render Darkwood art previews (or any expression) to a PNG with headless Chromium.
//
//   node tools/shot.mjs --out sheet.png --zoom 3 --eval "DW.preview.enemy('Goblin')"
//   node tools/shot.mjs --out town.png --zoom 2 --eval "DW.preview.scene('town', 234, 300, 1.5)"
//
// Every src/*.js file is loaded in order (the game itself is not started), then
// tools/preview.js, then the --eval expression runs with (ctx, w, h) in scope.
// Preview helpers may resize the canvas; the PNG matches its final size × zoom.
// Script errors from any file are printed so broken art is easy to spot.
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import url from 'url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { args[a.slice(2)] = process.argv[i + 1]; i++; }
}
const out = path.resolve(args.out || 'shot.png');
const w = parseInt(args.w || '480', 10), h = parseInt(args.h || '320', 10);
const zoom = parseInt(args.zoom || '3', 10);
const code = args.eval || 'DW.preview.palette()';

const srcDir = path.join(root, 'src');
let files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();
if (args.files) files = args.files.split(',').map(s => path.basename(s.trim()));
// --own a.js,b.js : load only the foundation (00-06) plus these files
if (args.own) files = files.filter(f => /^0[0-6]_/.test(f)).concat(args.own.split(',').map(s => path.basename(s.trim())));
const scripts = files.map(f => `<script src="${url.pathToFileURL(path.join(srcDir, f)).href}"></script>`).join('\n');
const previewSrc = url.pathToFileURL(path.join(here, 'preview.js')).href;

const html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#000">
<canvas id="shot" width="${w}" height="${h}"></canvas>
<script>window.DW_NO_START = true; window.__errors = [];
window.addEventListener('error', e => __errors.push(e.message + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno));</script>
${scripts}
<script src="${previewSrc}"></script>
</body></html>`;

const tmp = path.join(os.tmpdir(), `dw-shot-${process.pid}-${Date.now()}.html`);
fs.writeFileSync(tmp, html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto(url.pathToFileURL(tmp).href);
  const result = await page.evaluate(({ w, h, code }) => {
    const c = document.getElementById('shot');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    DW.gfx.canvas = c; DW.gfx.ctx = ctx; DW.gfx.w = w; DW.gfx.h = h;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    let ret;
    try { ret = (new Function('ctx', 'w', 'h', 'return (' + code + ')'))(ctx, w, h); }
    catch (e) { window.__errors.push('[eval] ' + e.message + '\n' + e.stack); }
    return { errors: window.__errors, ret: ret === undefined ? null : String(ret).slice(0, 2000), cw: c.width, ch: c.height };
  }, { w, h, code });
  await page.evaluate(({ zoom }) => {
    const c = document.getElementById('shot');
    c.style.width = c.width * zoom + 'px';
    c.style.height = c.height * zoom + 'px';
    c.style.imageRendering = 'pixelated';
    c.style.display = 'block';
  }, { zoom });
  await page.setViewportSize({ width: Math.max(100, result.cw * zoom), height: Math.max(100, result.ch * zoom) });
  await page.locator('#shot').screenshot({ path: out });
  for (const e of result.errors) console.log('ERROR:', e);
  for (const l of logs) console.log(l);
  if (result.ret) console.log('returned:', result.ret);
  console.log(`wrote ${out} (${result.cw}x${result.ch} @${zoom}x)`);
} finally {
  await browser.close();
  fs.unlinkSync(tmp);
}
