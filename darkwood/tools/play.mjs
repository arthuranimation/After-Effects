#!/usr/bin/env node
// Drive the real game in a phone-sized headless Chromium and take screenshots.
//
//   node tools/play.mjs --scenario tools/scenarios/tour.mjs --out /tmp/shots [--size 390x844] [--dpr 3] [--page index.html|dev.html]
//
// A scenario module exports `default async function (api)` where api has:
//   shot(name)            screenshot of the page at device resolution
//   tap(x, y)             tap at LOGICAL game coordinates (top-left of the canvas = 0,0)
//   key(k)                press a key
//   wait(ms)              let the game run
//   eval(fn, arg)         run fn(arg) in the page (DW is global) and return the result
//   size()                → { w, h } logical size of the game screen
//   errors                array of page errors seen so far
import { createRequire } from 'module';
import fs from 'fs';
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
const [vw, vh] = (args.size || '390x844').split('x').map(Number);
const dpr = parseFloat(args.dpr || '3');
const out = path.resolve(args.out || 'shots');
fs.mkdirSync(out, { recursive: true });
const pageFile = path.join(root, args.page || 'index.html');   // test the real single-file build by default
const scenario = (await import(url.pathToFileURL(path.resolve(args.scenario)).href)).default;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
await page.goto(url.pathToFileURL(pageFile).href);
await page.waitForTimeout(400);

let shotNo = 0;
const api = {
  errors,
  page,
  async shot(name) {
    const file = path.join(out, `${String(++shotNo).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file });
    console.log('shot', file);
    return file;
  },
  async size() { return page.evaluate(() => ({ w: DW.gfx.w, h: DW.gfx.h })); },
  async tap(x, y) {
    const box = await page.evaluate(() => {
      const r = DW.gfx.canvas.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height, w: DW.gfx.w, h: DW.gfx.h };
    });
    const cx = box.left + (x + 0.5) * box.width / box.w, cy = box.top + (y + 0.5) * box.height / box.h;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(120);
  },
  async key(k) { await page.keyboard.press(k); await page.waitForTimeout(80); },
  async wait(ms) { await page.waitForTimeout(ms); },
  async eval(fn, arg) { return page.evaluate(fn, arg); },
};

try {
  await scenario(api);
} catch (e) {
  errors.push('[scenario] ' + e.message + '\n' + e.stack);
}
await browser.close();
if (errors.length) { console.log('\nERRORS:'); for (const e of errors) console.log(e); process.exitCode = 1; }
else console.log('\nno page errors');
