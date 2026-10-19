// ================================================================
// GFX — the low-res screen and immediate drawing on it.
// The canvas backing store is the logical resolution (≈240 px wide);
// CSS scales it by a whole number of *device* pixels so every game
// pixel is a crisp square on any phone.
// ================================================================
(() => {
  const P = DW.pal;
  const G = DW.gfx = {};

  G.TARGET_W = 240;   // preferred logical width
  G.MAX_W = 288;      // never wider than this (keeps a portrait column on desktop)
  G.MIN_H = 400;      // layouts assume at least this much logical height
  G.w = 240; G.h = 480; G.scale = 1;
  G.canvas = null; G.ctx = null;
  G.sizeVersion = 0;  // bumps on resize so size-dependent caches can refresh

  // container (optional): the element whose content box the screen must fit
  // (lets CSS safe-area padding keep the game clear of notches).
  G.init = (canvas, container) => {
    G.canvas = canvas;
    G.container = container || null;
    G.ctx = canvas.getContext('2d', { alpha: false });
    G.resize();
    window.addEventListener('resize', G.resize);
    window.addEventListener('orientationchange', () => setTimeout(G.resize, 120));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', G.resize);
  };

  G.resize = () => {
    const c = G.canvas;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    let availW, availH;
    if (G.container) {
      const cs = getComputedStyle(G.container);
      availW = G.container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      availH = G.container.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    } else {
      const vv = window.visualViewport;
      availW = vv ? vv.width : window.innerWidth;
      availH = vv ? vv.height : window.innerHeight;
    }
    const cssH = Math.floor(availH);
    const cssW = Math.min(Math.floor(availW), Math.round(cssH * 0.66));
    const devW = Math.floor(cssW * dpr), devH = Math.floor(cssH * dpr);
    let s = Math.max(1, Math.min(Math.round(devW / G.TARGET_W), Math.floor(devH / G.MIN_H)));
    let w = Math.floor(devW / s), h = Math.floor(devH / s);
    if (w > G.MAX_W) w = G.MAX_W;
    if (w === G.w && h === G.h && s === G.scale && c.width === w) return;
    G.w = w; G.h = h; G.scale = s;
    c.width = w; c.height = h;
    c.style.width = (w * s / dpr) + 'px';
    c.style.height = (h * s / dpr) + 'px';
    G.ctx.imageSmoothingEnabled = false;
    G.sizeVersion++;
  };

  // ---------------------------------------------------------------
  // Offscreen canvases & caching
  // ---------------------------------------------------------------
  G.offscreen = (w, h) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, w | 0); canvas.height = Math.max(1, h | 0);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return { canvas, ctx };
  };

  const cache = new Map();
  // Memoise an expensive drawing. fn(ctx, w, h) draws into a fresh w×h canvas.
  G.cache = (key, w, h, fn) => {
    let c = cache.get(key);
    if (!c) {
      const o = G.offscreen(w, h);
      fn(o.ctx, w, h, o.canvas);
      c = o.canvas;
      cache.set(key, c);
    }
    return c;
  };
  G.cacheGet = key => cache.get(key);
  G.cacheSet = (key, canvas) => cache.set(key, canvas);
  G.cacheDrop = prefix => { for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k); };

  // ---------------------------------------------------------------
  // Primitives — all integer logical coordinates.
  // Each takes an optional ctx as the last argument (defaults to screen).
  // ---------------------------------------------------------------
  const C = c => c || G.ctx;

  G.clear = (col = '#000', ctx) => { ctx = C(ctx); ctx.fillStyle = col; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); };

  G.rect = (x, y, w, h, col, ctx) => {
    if (w <= 0 || h <= 0) return;
    ctx = C(ctx); ctx.fillStyle = col; ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  };

  G.px = (x, y, col, ctx) => { ctx = C(ctx); ctx.fillStyle = col; ctx.fillRect(x | 0, y | 0, 1, 1); };

  G.hline = (x1, x2, y, col, ctx) => { if (x2 < x1) [x1, x2] = [x2, x1]; G.rect(x1, y, x2 - x1 + 1, 1, col, ctx); };
  G.vline = (x, y1, y2, col, ctx) => { if (y2 < y1) [y1, y2] = [y2, y1]; G.rect(x, y1, 1, y2 - y1 + 1, col, ctx); };

  G.frame = (x, y, w, h, col, ctx) => {
    G.rect(x, y, w, 1, col, ctx); G.rect(x, y + h - 1, w, 1, col, ctx);
    G.rect(x, y, 1, h, col, ctx); G.rect(x + w - 1, y, 1, h, col, ctx);
  };

  G.line = (x0, y0, x1, y1, col, ctx) => {
    ctx = C(ctx); ctx.fillStyle = col;
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };

  // Filled pixel circle / ellipse.
  G.ellipse = (cx, cy, rx, ry, col, ctx) => {
    ctx = C(ctx); ctx.fillStyle = col;
    for (let y = -ry; y <= ry; y++) {
      const k = 1 - (y * y) / ((ry + 0.5) * (ry + 0.5));
      if (k < 0) continue;
      const half = Math.floor((rx + 0.5) * Math.sqrt(k));
      ctx.fillRect((cx - half) | 0, (cy + y) | 0, half * 2 + 1, 1);
    }
  };
  G.circle = (cx, cy, r, col, ctx) => G.ellipse(cx, cy, r, r, col, ctx);

  // ---------------------------------------------------------------
  // Dither patterns: fill with a mix of colours A and B at level 0..16
  // (0 = all A, 16 = all B) using the Bayer matrix.
  // ---------------------------------------------------------------
  const patCache = new Map();
  G.pattern = (a, b, level, ctx) => {
    ctx = C(ctx);
    level = Math.max(0, Math.min(16, Math.round(level)));
    const key = a + b + level;
    let pat = patCache.get(key);
    if (!pat) {
      const o = G.offscreen(4, 4);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const t = P.bayer4[y * 4 + x];
        const col = t < level ? b : a;
        if (col) { o.ctx.fillStyle = col; o.ctx.fillRect(x, y, 1, 1); }
      }
      pat = o.canvas;
      patCache.set(key, pat);
    }
    return ctx.createPattern(pat, 'repeat');
  };

  // a or b may be null for transparency (dithered fade over what's beneath).
  G.dither = (x, y, w, h, a, b, level, ctx) => {
    if (w <= 0 || h <= 0) return;
    ctx = C(ctx);
    ctx.save();
    ctx.fillStyle = G.pattern(a, b, level, ctx);
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
    ctx.restore();
  };

  // Copper-bar style vertical gradient through a list of colours.
  // Each colour gets a solid band; boundaries are dithered over `soft` rows.
  G.copper = (x, y, w, h, cols, ctx, soft = 4) => {
    ctx = C(ctx);
    const n = cols.length;
    if (n === 1) { G.rect(x, y, w, h, cols[0], ctx); return; }
    for (let row = 0; row < h; row++) {
      const f = (row / Math.max(1, h - 1)) * (n - 1);
      const i = Math.min(n - 2, Math.floor(f));
      const frac = f - i;
      const bandH = h / (n - 1);
      const edge = soft / bandH;           // fraction of band that's dithered
      let level;
      if (frac < 0.5 - edge / 2) level = 0;
      else if (frac > 0.5 + edge / 2) level = 16;
      else level = ((frac - (0.5 - edge / 2)) / Math.max(0.0001, edge)) * 16;
      if (level <= 0) G.rect(x, y + row, w, 1, cols[i], ctx);
      else if (level >= 16) G.rect(x, y + row, w, 1, cols[i + 1], ctx);
      else G.dither(x, y + row, w, 1, cols[i], cols[i + 1], level, ctx);
    }
  };

  // ---------------------------------------------------------------
  // Blitting sprites (canvases) with optional flash / flip / fade.
  // ---------------------------------------------------------------
  const silCache = new WeakMap();
  // A solid-colour silhouette of a sprite (hit flashes, locked enemies, shadows).
  G.silhouette = (img, col) => {
    let m = silCache.get(img);
    if (!m) { m = new Map(); silCache.set(img, m); }
    let s = m.get(col);
    if (!s) {
      const o = G.offscreen(img.width, img.height);
      o.ctx.drawImage(img, 0, 0);
      o.ctx.globalCompositeOperation = 'source-in';
      o.ctx.fillStyle = col;
      o.ctx.fillRect(0, 0, img.width, img.height);
      s = o.canvas;
      m.set(col, s);
    }
    return s;
  };

  // Dither-fade a sprite out: level 0 = intact, 16 = gone. Cached per level.
  const fadeCache = new WeakMap();
  G.faded = (img, level) => {
    level = Math.max(0, Math.min(16, Math.round(level)));
    if (level === 0) return img;
    let m = fadeCache.get(img);
    if (!m) { m = new Map(); fadeCache.set(img, m); }
    let s = m.get(level);
    if (!s) {
      const o = G.offscreen(img.width, img.height);
      o.ctx.drawImage(img, 0, 0);
      o.ctx.globalCompositeOperation = 'destination-out';
      o.ctx.fillStyle = G.pattern(null, '#000', level, o.ctx);
      o.ctx.fillRect(0, 0, img.width, img.height);
      s = o.canvas;
      m.set(level, s);
    }
    return s;
  };

  // opts: { flipX, flash: colour, fade: 0..16, alpha, ctx }
  G.blit = (img, x, y, opts = {}) => {
    if (!img) return;
    const ctx = C(opts.ctx);
    let src = img;
    if (opts.fade) src = G.faded(src, opts.fade);
    if (opts.flash) src = G.silhouette(src, opts.flash);
    if (opts.alpha !== undefined && opts.alpha < 1) { ctx.save(); ctx.globalAlpha = opts.alpha; }
    if (opts.flipX) {
      ctx.save();
      ctx.translate((x | 0) + src.width, y | 0);
      ctx.scale(-1, 1);
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(src, x | 0, y | 0);
    }
    if (opts.alpha !== undefined && opts.alpha < 1) ctx.restore();
  };

  G.clip = (x, y, w, h, fn, ctx) => {
    ctx = C(ctx);
    ctx.save();
    ctx.beginPath(); ctx.rect(x | 0, y | 0, w | 0, h | 0); ctx.clip();
    try { fn(); } finally { ctx.restore(); }
  };
})();
