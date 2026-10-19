// ================================================================
// ENEMIES — TIER IV "The Champion's Crown": the bosses.
// Hill Giant · Fire Giant · Lich · Demon · Red Dragon
//
// Each boss is a small rig. Key poses hold joint targets; half wind-ups
// blend from idle toward the cocked pose. The upper body is posed with
// a shear/scale transform pivoting at the hips, arms are solved with
// two-bone IK toward screen-space hand targets so every wind-up tell
// sits exactly where the player needs to read it (left / overhead /
// right), and the painter works back to front.
// ================================================================
(() => {
  const P = DW.pal, U = DW.util;
  const EN = DW.art.enemies;
  const R = P.ramps;
  const clamp = U.clamp;
  const lerp = (a, b, t) => a + (b - a) * t;
  const D2R = Math.PI / 180;

  // ---------------------------------------------------------------
  // Pose decoding & key-pose interpolation
  // ---------------------------------------------------------------
  const decode = p => {
    p = p || {};
    const hu = !!p.hurt, st = !hu && !!p.strike;
    const w = (!hu && !st && p.wind > 0) ? (p.wind >= 0.75 ? 1 : 0.5) : 0;
    const idle = !hu && !st && !w;
    const f = idle ? (((p.f | 0) % 4) + 4) % 4 : 0;
    const dir = p.dir < 0 ? -1 : p.dir > 0 ? 1 : 0;
    return { idle, f, dir, w, st, hu };
  };

  const lerpObj = (a, b, t) => {
    const o = {};
    for (const k in b) {
      const va = a[k], vb = b[k];
      if (typeof vb === 'number' && typeof va === 'number') o[k] = lerp(va, vb, t);
      else if (Array.isArray(vb) && Array.isArray(va)) o[k] = vb.map((v, i) => (typeof v === 'number' && typeof va[i] === 'number' ? lerp(va[i], v, t) : v));
      else o[k] = t < 0.5 && va !== undefined ? va : vb;
    }
    for (const k in a) if (!(k in o)) o[k] = a[k];
    return o;
  };

  // keys: { idle(f) -> obj, wl, wh, wr, sl, sh, sr, hurt, and optional wl5/wh5/wr5 overrides }
  const resolve = (keys, q) => {
    const base = keys.idle(0);
    let p;
    if (q.hu) p = keys.hurt;
    else if (q.st) p = keys[['sl', 'sh', 'sr'][q.dir + 1]];
    else if (q.w) {
      const n = ['wl', 'wh', 'wr'][q.dir + 1];
      if (q.w >= 1) p = keys[n];
      else {
        const half = lerpObj(base, keys[n], 0.5);
        p = keys[n + '5'] ? lerpObj(half, Object.assign({}, half, keys[n + '5']), 1) : half;
      }
    } else p = keys.idle(q.f);
    return lerpObj(base, p, 1);
  };

  // Upper-body transform: shear (lean) above the hip pivot, scale about the anchor.
  const mkT = (p, ax, ay, py) => {
    const s = p.s || 1, lean = p.lean || 0, dx = p.dx || 0, dy = p.dy || 0;
    const X = (x, y) => ax + (x - ax + Math.max(0, py - y) * lean) * s + dx;
    const Y = (x, y) => ay + (y - ay) * s + dy;
    return { s, X, Y, P: (x, y) => [X(x, y), Y(x, y)] };
  };

  // Primitives in model space through a transform.
  const wrap = (S, T) => {
    const s = T.s;
    const g = o => (o && o.grad ? Object.assign({}, o, { grad: [T.X(o.grad[0], o.grad[1]), T.Y(o.grad[0], o.grad[1]), T.X(o.grad[2], o.grad[3]), T.Y(o.grad[2], o.grad[3]), o.grad[4], o.grad[5]] }) : o);
    return {
      ball: (x, y, rx, ry, r, o) => S.ball(T.X(x, y), T.Y(x, y), rx * s, ry * s, r, o),
      cap: (x1, y1, x2, y2, r1, r2, r, o) => S.capsule(T.X(x1, y1), T.Y(x1, y1), T.X(x2, y2), T.Y(x2, y2), r1 * s, r2 * s, r, o),
      horn: (x0, y0, cx, cy, x1, y1, r0, r1, r, o) => S.horn(T.X(x0, y0), T.Y(x0, y0), T.X(cx, cy), T.Y(cx, cy), T.X(x1, y1), T.Y(x1, y1), r0 * s, r1 * s, r, o),
      poly: (pts, r, o) => S.poly(pts.map(([x, y]) => [T.X(x, y), T.Y(x, y)]), r, g(o)),
      line: (x0, y0, x1, y1, c) => S.line(T.X(x0, y0), T.Y(x0, y0), T.X(x1, y1), T.Y(x1, y1), c),
      px: (x, y, c) => S.px(T.X(x, y), T.Y(x, y), c),
    };
  };

  // Two-bone IK: elbow for shoulder (sx,sy) reaching (hx,hy). bend ±1 picks the side.
  const ik = (sx, sy, hx, hy, l1, l2, bend) => {
    let dx = hx - sx, dy = hy - sy, d = Math.hypot(dx, dy) || 0.001;
    const maxd = l1 + l2 - 0.3;
    if (d > maxd) { hx = sx + dx / d * maxd; hy = sy + dy / d * maxd; dx = hx - sx; dy = hy - sy; d = maxd; }
    const dd = Math.max(d, Math.abs(l1 - l2) + 0.5);
    const a = Math.acos(clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1));
    const base = Math.atan2(dy, dx) + a * bend;
    return { ex: sx + Math.cos(base) * l1, ey: sy + Math.sin(base) * l1, hx, hy };
  };

  // Crisper shading: dither only across the middle of each ramp step (flat
  // colour clusters with dithered transitions). contrast > 1 carves form.
  const crisp = (S, zone = 0.5, contrast = 1) => {
    S.shadePx = function (x, y, ramp, I, o = {}) {
      ramp = P.ramp(ramp);
      const lo = o.lo !== undefined ? o.lo : 0, hi = o.hi !== undefined ? o.hi : ramp.length - 1;
      if (contrast !== 1 && o.tone === undefined && !o.flat) I = 0.55 + (I - 0.55) * contrast;
      const v = lo + clamp(I, 0, 1.2) * (hi - lo), n = ramp.length - 1;
      if (v <= 0) { this.set(x, y, ramp[0]); return; }
      if (v >= n) { this.set(x, y, ramp[n]); return; }
      const i = Math.floor(v);
      let f = v - i;
      if (o.dither === false) f = f < 0.5 ? 0 : 1;
      else f = clamp((f - (0.5 - zone / 2)) / zone, 0, 1);
      this.set(x, y, ramp[f > P.thresh(x, y) ? i + 1 : i]);
    };
    return S;
  };

  // ---------------------------------------------------------------
  // Pixel helpers
  // ---------------------------------------------------------------
  const idxCache = new WeakMap();
  const rmap = ramp => {
    let m = idxCache.get(ramp);
    if (!m) { m = new Map(); ramp.forEach((c, i) => { if (!m.has(P.toInt(c))) m.set(P.toInt(c), i); }); idxCache.set(ramp, m); }
    return m;
  };
  const inRamp = (S, x, y, ramp) => { const v = S.get(x, y); return v ? rmap(ramp).get(v) : undefined; };
  const nudge = (S, x, y, ramp, d) => {
    const i = inRamp(S, x, y, ramp);
    if (i === undefined) return false;
    S.set(x, y, ramp[clamp(i + d, 0, ramp.length - 1)]);
    return true;
  };
  const hash2 = (x, y) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  // Darken/lighten pixels of `ramp` inside an ellipse (blotches, scars, muscle grooves).
  const spotAt = (S, ramp, cx, cy, rx, ry, d, minI = 2) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const ex = (x + 0.5 - cx) / rx, ey = (y + 0.5 - cy) / ry;
        if (ex * ex + ey * ey > 1) continue;
        const i = inRamp(S, x, y, ramp);
        if (i === undefined || i < minI) continue;
        S.set(x, y, ramp[clamp(i + d, 0, ramp.length - 1)]);
      }
    }
  };
  const spotList = (seed, n, x0, y0, w, h, r0 = 0.9, r1 = 1.1) => {
    const r = U.rng(seed), a = [];
    for (let i = 0; i < n; i++) a.push([x0 + r() * w, y0 + r() * h, r0 + r() * r1, (r0 + r() * r1) * 0.75]);
    return a;
  };
  // Nudge pixels of `ramp` along a line (creases, grooves, cracks that follow the shading).
  const crease = (S, ramp, x0, y0, x1, y1, d) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    let lx = null, ly = null;
    for (let i = 0; i <= n; i++) {
      const x = Math.round(lerp(x0, x1, i / n)), y = Math.round(lerp(y0, y1, i / n));
      if (x === lx && y === ly) continue;
      lx = x; ly = y;
      nudge(S, x, y, ramp, d);
    }
  };

  // Soft dithered glow painted only on empty pixels (auras behind the body)
  // or over everything (o.over). cols run from faint (outer) to strong (inner).
  const aura = (S, cx, cy, rx, ry, cols, o = {}) => {
    const n = cols.length, k = o.k || 1;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      if (y < 1 || y > S.h - 2) continue;
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (x < 1 || x > S.w - 2) continue;
        const ex = (x + 0.5 - cx) / rx, ey = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(ex * ex + ey * ey);
        if (d >= 1) continue;
        if (!o.over && S.opaque(x, y)) continue;
        if (o.only && !o.only(x, y)) continue;
        const v = Math.pow(1 - d, o.pow || 1) * k;
        if (v < P.thresh(x, y) * 0.999) continue;
        S.set(x, y, cols[Math.min(n - 1, Math.floor(v * n))]);
      }
    }
  };

  // Motion swoosh along a Catmull-Rom path: bright leading edge dithering away
  // across its width. o.behind: only paint empty pixels.
  const swoosh = (S, pts, wMax, cols, o = {}) => {
    const n = cols.length, side = o.side || 1;
    const P0 = [pts[0]].concat(pts, [pts[pts.length - 1]]);
    const samples = [];
    for (let i = 1; i < P0.length - 2; i++) {
      const [p0, p1, p2, p3] = [P0[i - 1], P0[i], P0[i + 1], P0[i + 2]];
      for (let k = 0; k < 16; k++) {
        const t = k / 16, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        samples.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    samples.push(pts[pts.length - 1]);
    const N = samples.length - 1;
    const nrm = samples.map((pt, i) => {
      const a = samples[Math.max(0, i - 1)], b = samples[Math.min(N, i + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
      return [-ty / tl * side, tx / tl * side];
    });
    const rad = samples.map((pt, i) => wMax * Math.pow(Math.sin(Math.PI * clamp((i / N) * 1.04, 0, 1)), 0.6));
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of samples) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    x0 = Math.max(1, Math.floor(x0 - wMax - 1)); y0 = Math.max(1, Math.floor(y0 - wMax - 1));
    x1 = Math.min(S.w - 2, Math.ceil(x1 + wMax + 1)); y1 = Math.min(S.h - 2, Math.ceil(y1 + wMax + 1));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      if (o.behind && S.opaque(px, py) && !(o.over && o.over(px, py))) continue;
      const cx = px + 0.5, cy = py + 0.5;
      let best = 1e9, bi = 0;
      for (let i = 0; i <= N; i++) { const d = (samples[i][0] - cx) ** 2 + (samples[i][1] - cy) ** 2; if (d < best) { best = d; bi = i; } }
      const [sx, sy] = samples[bi], [nx, ny] = nrm[bi];
      const along = (cx - sx) * nx + (cy - sy) * ny;
      const r = rad[bi];
      if (along < -0.6 || along > r || r < 0.5) continue;
      const t = bi / N;
      const lvl = (0.45 + 0.55 * t) * (1 - Math.pow(Math.max(0, along) / (r + 0.8), 1.2));
      if (lvl < P.thresh(px, py) * 0.9) continue;
      S.set(px, py, cols[Math.min(n - 1, Math.floor(lvl * n))]);
    }
  };

  // Clean-up after outline: remove single isolated outline pixels (no opaque
  // non-ink neighbour in 4 directions) that the outline pass may leave.
  const INK = P.toInt('#101');

  // Shaggy fringe: pixels of `ramp` bordering pixels that are empty (or of
  // `over` ramp) sprout tufts there, decided by a stable hash of (x, y) offset
  // by `key` so the fringe does not boil between frames of a moving body.
  const shag = (S, ramp, x0, y0, x1, y1, p, o = {}) => {
    const m = rmap(ramp), om = o.over ? rmap(o.over) : null;
    const w = S.w, h = S.h, src = S.data.slice();
    const kx = o.kx || 0, ky = o.ky || 0;
    const dirs = o.dirs || [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1]];
    for (let y = Math.max(1, y0); y <= Math.min(h - 2, y1); y++) for (let x = Math.max(1, x0); x <= Math.min(w - 2, x1); x++) {
      const v = src[y * w + x];
      if (!v || !m.has(v)) continue;
      dirs.forEach(([ox, oy], di) => {
        const nx = x + ox, ny = y + oy;
        if (nx < 1 || ny < 1 || nx > w - 2 || ny > h - 2) return;
        const nv = src[ny * w + nx];
        if (nv && (!om || !om.has(nv))) return;
        if (nv && m.has(nv)) return;
        if (hash2((x - kx) * 7 + di, (y - ky) * 13 - di) < p * (oy > 0 ? 1.4 : oy < 0 ? 0.5 : 1)) S.set(nx, ny, ramp[Math.max(1, m.get(v) - 1)]);
      });
    }
  };
  // Hair/fur strokes: short lines nudged darker along a ramp (with a light tip).
  const strokes = (S, ramp, list, minI = 2, d = -1) => {
    for (const [x, y, len, sl] of list) {
      const i0 = inRamp(S, x, y, ramp);
      if (i0 === undefined || i0 < minI) continue;
      for (let t = 0; t < len; t++) nudge(S, Math.round(x + sl * t), Math.round(y + t), ramp, d);
      nudge(S, Math.round(x - sl), Math.round(y - 1), ramp, 1);
    }
  };
  const strokeList = (seed, n, x0, y0, w, h, l0 = 3, l1 = 3, slant = 0.9) => {
    const r = U.rng(seed), a = [];
    for (let i = 0; i < n; i++) a.push([x0 + r() * w, y0 + r() * h, l0 + Math.floor(r() * l1), (r() - 0.5) * slant]);
    return a;
  };

  // Paint fn(L) into a fresh layer, then composite it over S with an
  // internal contour: body pixels just outside the layer's silhouette are
  // darkened, so an overlapping limb separates crisply from what is behind.
  // o.k: contour strength on the shadow side (bottom/right), o.kl on the lit side.
  const layer = (S, fn, o = {}) => {
    const L = DW.kit.create(S.w, S.h);
    L.shadePx = S.shadePx;
    fn(L);
    const w = S.w, h = S.h, ld = L.data, sd = S.data;
    const k = o.k !== undefined ? o.k : 0.55, kl = o.kl !== undefined ? o.kl : 0.3;
    if (k > 0 || kl > 0) {
      const mark = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!ld[y * w + x]) continue;
        // neighbours outside the layer: right/below are shadow side, left/above lit
        const nb = [[1, 0, k], [0, 1, k], [-1, 0, kl], [0, -1, kl]];
        for (const [ox, oy, a] of nb) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const i = ny * w + nx;
          if (ld[i] || !sd[i]) continue;
          if (a > mark[i]) mark[i] = a;
        }
      }
      for (let i = 0; i < w * h; i++) if (mark[i] > 0) sd[i] = P.toInt(P.mix(P.fromInt(sd[i]), '#101', mark[i]));
    }
    for (let i = 0; i < w * h; i++) if (ld[i]) sd[i] = ld[i];
    return L;
  };

  // Luminous halo hugging the silhouette: empty pixels within `rad` px of
  // an opaque pixel get a dithered glow that fades with distance.
  // cols run faint → strong. o.test(x,y) limits which source pixels emit.
  const halo = (S, cols, rad, k = 1, o = {}) => {
    const w = S.w, h = S.h, src = S.data;
    const n = cols.length;
    const emit = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (src[y * w + x] && (!o.test || o.test(x, y))) emit[y * w + x] = 1;
    const out = [];
    const R2 = rad * rad;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (src[y * w + x]) continue;
      let best = R2 + 1;
      for (let j = -rad; j <= rad; j++) {
        const yy = y + j; if (yy < 0 || yy >= h) continue;
        for (let i = -rad; i <= rad; i++) {
          const xx = x + i; if (xx < 0 || xx >= w) continue;
          if (!emit[yy * w + xx]) continue;
          const d = i * i + j * j; if (d < best) best = d;
        }
      }
      if (best > R2) continue;
      const v = (1 - Math.sqrt(best) / (rad + 0.5)) * k;
      if (v < P.thresh(x, y) * 0.999) continue;
      out.push([x, y, cols[Math.min(n - 1, Math.floor(v * n))]]);
    }
    for (const [x, y, c] of out) S.set(x, y, c);
  };

  // Final safety pass: clear any non-outline pixel left in the 1px border
  // ring so nothing reads as clipped by the canvas edge.
  const clearRing = S => {
    const w = S.w, h = S.h, d = S.data;
    for (let x = 0; x < w; x++) { if (d[x] !== INK) d[x] = 0; const i = (h - 1) * w + x; if (d[i] !== INK) d[i] = 0; }
    for (let y = 0; y < h; y++) { const i = y * w, j = y * w + w - 1; if (d[i] !== INK) d[i] = 0; if (d[j] !== INK) d[j] = 0; }
  };

  // ===============================================================
  // HILL GIANT — huge, crude, slope-browed brute, hunched so the small
  // head sinks between mountainous shoulders. Club: an uprooted oak.
  // g = grip (screen), ca = angle (deg) from grip toward the root ball,
  // cl = grip→root length, ck = root-ball scale (foreshortening).
  // hL = screen-left hand target when it is free; two = both hands on the
  // trunk (the screen-left hand grips cl2 px further up the trunk).
  // ===============================================================
  const HG_SKIN = ['#100', '#200', '#301', '#411', '#522', '#732', '#943', '#a54', '#c75', '#d96'];
  const HG_HAIR = ['#100', '#110', '#211', '#321', '#422', '#532', '#643', '#754', '#976'];
  const BEARD = ['#100', '#110', '#211', '#321', '#432', '#543', '#654', '#765', '#987', '#ba9'];
  const BARK = ['#100', '#110', '#211', '#321', '#432', '#543', '#654', '#765', '#987'];
  const EARTH = ['#100', '#200', '#310', '#421', '#531', '#642', '#753', '#864'];
  const PELT = ['#101', '#111', '#211', '#322', '#433', '#544', '#665', '#887', '#aa9'];
  const HIDE = ['#100', '#200', '#310', '#421', '#532', '#643', '#754', '#865', '#a86'];
  const MOUTH = ['#100', '#200', '#301', '#502', '#713', '#934'];

  const hgKeys = {
    idle: f => {
      const br = [0, 1, 2, 1][f], sw = [0, 1, 0, -1][f];
      return {
        lean: 0, dx: 0, dy: 0, s: 1 + br * 0.009, hx: sw * 0.5, hy: br * 0.4, tilt: 0, mo: 0.2 + br * 0.08, shut: 0,
        g: [90, 83 - br * 0.3], ca: 70 - br * 0.6, cl: 22, ck: 1.15, hL: [19 - sw * 0.6, 94 - br * 0.3], two: 0, cl2: 9,
        bL: -1, bR: 1, cb: 0, leaf: f, bs: sw * 0.8,
      };
    },
    // oak hauled up over the screen-left shoulder, both fists on the trunk
    wl: { lean: -0.22, dx: -4, dy: -2, hx: -5, hy: 0, mo: 0.7, g: [35, 38], ca: 226, cl: 28, ck: 1.05, two: 1, cl2: 10, bL: 1, bR: -1, cb: 1, bs: -2 },
    wl5: { g: [42, 56], ca: 210, cl: 23, two: 0, hL: [22, 80], cb: 0, bR: 1, bL: -1 },
    // straight up over the head, body stretched tall
    wh: { lean: 0, dx: 0, dy: -1, hx: 0, hy: 2, mo: 0.9, g: [60, 25], ca: 270, cl: 11, ck: 1.0, two: 1, cl2: 6, bL: -1, bR: 1, cb: 1, tilt: 0.5, flank: 1 },
    wh5: { dy: 3, s: 0.99, g: [60, 29], ca: 270, cl: 12, ck: 0.95, two: 1, cl2: 6, cb: 1, bL: -1, bR: 1, mo: 0.5, tilt: 0.2, flank: 1 },
    // up over the screen-right shoulder
    wr: { lean: 0.22, dx: 4, dy: -2, hx: 5, hy: 0, mo: 0.7, g: [85, 38], ca: -46, cl: 28, ck: 1.05, two: 1, cl2: 10, bL: 1, bR: -1, cb: 1, bs: 2 },
    wr5: { g: [86, 56], ca: -30, cl: 22, two: 0, hL: [24, 86], cb: 0 },
    // strikes: the root ball smashes down in front, toward the viewer
    sl: { lean: 0.12, dx: 3, dy: 5, s: 1.04, hx: 3, hy: 2, mo: 1, g: [56, 78], ca: 124, cl: 22, ck: 1.45, two: 1, cl2: 9, bL: 1, bR: -1, cb: 0, bs: 2 },
    sh: { lean: 0, dx: 0, dy: 6, s: 1.04, hx: 0, hy: 3, mo: 1, g: [60, 72], ca: 90, cl: 21, ck: 1.55, two: 1, cl2: 9, bL: 1, bR: -1, cb: 0 },
    sr: { lean: -0.12, dx: -3, dy: 5, s: 1.04, hx: -3, hy: 2, mo: 1, g: [64, 78], ca: 56, cl: 22, ck: 1.45, two: 1, cl2: 9, bL: 1, bR: -1, cb: 0, bs: -2 },
    hurt: { lean: 0.14, dx: 3, dy: -1, s: 0.98, hx: 6, hy: -1, tilt: 1, mo: 1, shut: 1, g: [95, 86], ca: 70, cl: 14, two: 0, hL: [14, 66], bL: 1, bR: 1, bs: 3 },
  };

  const HG_SPOTS = spotList(77, 18, 40, 56, 40, 34, 0.9, 1.3);
  const HG_PELT_STROKES = strokeList(13, 90, 18, 40, 40, 32, 2, 3, 0.7);

  // Clod of earth torn up with the oak: lumpy soil, stones, thick gnarled
  // roots splaying away from the trunk, thin rootlets dangling under gravity.
  function rootBall(S, rx, ry, a, k, lo = 0, tw = 5) {
    const rr = 9.5 * k;
    const r = U.rng(23);
    const ca = Math.cos(a * D2R), sa = Math.sin(a * D2R), na = -sa, nb = ca;
    // thin wiggly rootlets trailing from the far side
    for (let i = 0; i < 9; i++) {
      const ang = a * D2R + (-80 + i * 20 + (r() - 0.5) * 12) * D2R;
      let x = rx + Math.cos(ang) * rr * 0.75, y = ry + Math.sin(ang) * rr * 0.75;
      const L = rr * (0.4 + r() * 0.45);
      let dx = Math.cos(ang), dy = Math.sin(ang);
      for (let t = 0; t < L; t++) {
        dx += (r() - 0.5) * 0.6; dy += (r() - 0.5) * 0.6 + 0.12;
        const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
        x += dx; y += dy;
        S.px(x, y, t < L * 0.5 ? BARK[3] : BARK[2]);
      }
    }
    // torn root ends poking out of the far side (behind the clod)
    for (const [da, L] of [[-50, 0.5], [-5, 0.45], [40, 0.5], [80, 0.35]]) {
      const ang = a * D2R + da * D2R;
      const bx = rx + Math.cos(ang) * rr * 0.6, by = ry + Math.sin(ang) * rr * 0.6;
      const ex = rx + Math.cos(ang) * rr * (1 + L), ey = ry + Math.sin(ang) * rr * (1 + L) + 1;
      S.capsule(bx, by, ex, ey, 2 * k, 1 * k, BARK, { lo: lo + 0.5, hi: 5.5 });
      S.px(ex, ey, '#865');
    }
    // the clod: an irregular lump of soil
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const ang = i / 12 * Math.PI * 2, rad = rr * (0.84 + r() * 0.28);
      pts.push([rx + Math.cos(ang) * rad, ry + Math.sin(ang) * rad]);
    }
    S.poly(pts, EARTH, { grad: [rx - rr * 0.7, ry - rr * 0.8, rx + rr * 0.6, ry + rr * 0.8, 0.8, 0.12], lo: lo });
    S.ball(rx - rr * 0.25, ry - rr * 0.25, rr * 0.62, rr * 0.52, EARTH, { lo: lo + 1, spec: 0.15 });
    S.ball(rx + rr * 0.35, ry + rr * 0.35, rr * 0.5, rr * 0.4, EARTH, { lo: lo, hi: 5 });
    S.ball(rx - rr * 0.5, ry + rr * 0.35, rr * 0.4, rr * 0.35, EARTH, { lo: lo + 0.5, hi: 6 });
    S.speckle(Math.floor(rx - rr), Math.floor(ry - rr), Math.ceil(rr * 2), Math.ceil(rr * 2), 0.25, h => (h === '#642' ? '#531' : h === '#753' ? '#642' : h === '#421' ? '#531' : h === '#531' ? '#421' : h), 5);
    for (let i = 0; i < 3; i++) {
      const sx = rx + (r() - 0.5) * rr * 1.1, sy = ry + (r() - 0.1) * rr * 0.8;
      S.ball(sx, sy, (1.2 + r()) * k, (1 + r() * 0.6) * k, R.stone, { lo: 2, hi: 7, spec: 0.5 });
    }
    // root flare: the trunk widens into ridged roots that dive into the clod
    const fb = 1.55, fe = 0.25, w0 = tw, w1 = rr * 0.72;
    const f0 = [rx - ca * rr * fb, ry - sa * rr * fb], f1 = [rx - ca * rr * fe, ry - sa * rr * fe];
    S.poly([[f0[0] + na * w0, f0[1] + nb * w0], [f1[0] + na * w1, f1[1] + nb * w1], [f1[0] - na * w1, f1[1] - nb * w1], [f0[0] - na * w0, f0[1] - nb * w0]], BARK,
      { grad: [f1[0] + na * w1 - ca * 3, f1[1] + nb * w1 - sa * 3, f1[0] - na * w1, f1[1] - nb * w1, 0.75, 0.2], lo: lo + 1, hi: 7 });
    for (const t of [-0.7, -0.25, 0.2, 0.65]) {
      crease(S, BARK, f0[0] + na * w0 * t, f0[1] + nb * w0 * t, f1[0] + na * w1 * t * 1.1, f1[1] + nb * w1 * t * 1.1, -2);
    }
    // dirt clinging over the flare's lower edge
    for (const [i, up, sz] of [[-1.6, 0.5, 1.1], [-0.5, -1.5, 0.8], [0.6, 1, 1.25], [1.7, -0.5, 0.7]]) {
      const cx = f1[0] + na * i * w1 * 0.42 + ca * up, cy = f1[1] + nb * i * w1 * 0.42 + sa * up;
      S.ball(cx, cy, 2.3 * k * sz, 1.8 * k * sz, EARTH, { lo: lo + 1, hi: 7, spec: 0.1 });
    }
  }

  // The uprooted oak: snapped crown fork with leaves at the grip end,
  // trunk swelling into the root flare and the clod at the striking end.
  function oakClub(S, gx, gy, a, len, k = 1, leaf = 0, lo = 0) {
    const c = Math.cos(a * D2R), s = Math.sin(a * D2R);
    const nx = -s, ny = c;
    const top = 15;
    const tx = gx - c * top, ty = gy - s * top;
    const rx = gx + c * len, ry = gy + s * len;
    const kk = Math.min(k, 1.3);
    // snapped fork at the crown end + leafy twig
    const stub = (t, side, L) => {
      const bx = gx - c * t, by = gy - s * t;
      const ex = bx + (nx * side * 0.7 - c * 0.75) * L, ey = by + (ny * side * 0.7 - s * 0.75) * L;
      S.capsule(bx, by, ex, ey, 2.4, 1.8, BARK, { lo: 1 + lo, hi: 7 });
      S.ball(ex, ey, 1.8, 1.6, R.wood, { lo: 4, hi: 7, tone: 0.9 });
      return [ex, ey];
    };
    const twigEnd = (() => {
      const bx = gx - c * 9, by = gy - s * 9;
      const ex = bx + (nx * 1 - c * 0.3) * 9, ey = by + (ny * 1 - s * 0.3) * 9;
      S.horn(bx, by, bx + nx * 5 - c * 1, by + ny * 5 - s * 1 - 1, ex, ey, 1.2, 0.6, BARK, { lo: 1 + lo, hi: 6 });
      return [ex, ey];
    })();
    const leaves = (x, y, n, seed, sz = 1) => {
      const r = U.rng(seed);
      for (let i = 0; i < n; i++) {
        const ox = (r() - 0.5) * 8 * sz, oy = (r() - 0.5) * 7 * sz;
        const jig = ((leaf + i) % 4 === 1) ? 1 : 0;
        S.ball(x + ox + jig * 0.6, y + oy - jig * 0.6, 2.3, 1.5, R.leaf, { rot: r() * 3, lo: 1.5 + lo, hi: 7, spec: 0.25 });
      }
      for (let i = 0; i < 2; i++) S.ball(x + (r() - 0.5) * 8 * sz, y + (r() - 0.5) * 7 * sz, 1.6, 1.2, R.olive, { lo: 3 + lo, hi: 7 });
    };
    leaves(twigEnd[0], twigEnd[1], 7, 11, 1.1);
    stub(top - 1, 1, 6);
    stub(top - 3, -1, 8);
    // trunk
    const fl = len - 9.5 * k * 1.5;
    S.capsule(tx, ty, gx + c * fl, gy + s * fl, 4, 4.8 * kk, BARK, { lo: 1 + lo, hi: 7.5, spec: 0.15, rim: 0.2 });
    // bark grooves follow the trunk
    for (const off of [-2.2, -0.2, 1.8]) {
      const r0 = U.rng(Math.round(off * 10) + 50);
      let t0 = -top + 2;
      while (t0 < len * 0.72) {
        const t1 = t0 + 3 + r0() * 6;
        const w0 = off * (1 + Math.max(0, t0) / len * 0.5), w1 = off * (1 + Math.max(0, t1) / len * 0.5);
        crease(S, BARK, gx + c * t0 + nx * w0, gy + s * t0 + ny * w0, gx + c * t1 + nx * w1, gy + s * t1 + ny * w1, -2);
        t0 = t1 + 1 + r0() * 2;
      }
    }
    // knot hole
    const kx = gx + c * len * 0.25 - nx * 1.5, ky = gy + s * len * 0.25 - ny * 1.5;
    S.ball(kx, ky, 1.7, 1.3, BARK, { tone: 0.02 });
    S.px(kx - nx, ky - ny, BARK[6]);
    // snapped crown face: pale splintered heartwood
    S.ball(tx, ty, 3.4, 3, R.wood, { lo: 4, hi: 7, tone: 0.9 });
    S.px(tx - c * 0.5, ty - s * 0.5, '#dca'); S.px(tx - c * 2 + nx, ty - s * 2 + ny, '#b85');
    S.line(tx - c * 1 - nx * 2, ty - s * 1 - ny * 2, tx - c * 3 - nx * 1, ty - s * 3 - ny * 1, '#963');
    rootBall(S, rx, ry, a, k, lo, 4.8 * kk);
  }

  // Front-facing head, sunk low. (x, y) = centre of the face.
  function hgHead(S, x, y, o = {}) {
    const k = o.k || 1, tl = o.tilt || 0, shut = o.shut;
    const sk = HG_SKIN, hair = HG_HAIR;
    const ty = y - tl * 2 * k;
    // shaggy mane behind the head, falling to the shoulders
    S.ball(x, ty - 1 * k, 13 * k, 11 * k, hair, { lo: 1, hi: 5 });
    for (let i = 0; i < 11; i++) {
      const a = (-180 + i * 18) * D2R;
      const bx = x + Math.cos(a) * 10 * k, by = ty - 1 * k + Math.sin(a) * 8 * k;
      const L = (5 + (i % 3) * 1.5) * k;
      const ex = bx + Math.cos(a) * L + (i % 2 ? 1.5 : -1.5), ey = by + Math.sin(a) * L * 0.6 + 4;
      const px = -Math.sin(a) * 2.8 * k, py = Math.cos(a) * 2.8 * k;
      S.poly([[bx + px, by + py], [ex, ey], [bx - px, by - py]], hair, { grad: [bx, by, ex, ey, 0.55, 0.15] });
    }
    // ears
    S.ball(x - 10.5 * k, ty + 1.5 * k, 2.6 * k, 3.6 * k, sk, { lo: 1, hi: 8 });
    S.ball(x + 10.5 * k, ty + 1.5 * k, 2.6 * k, 3.6 * k, sk, { lo: 1, hi: 6.5 });
    S.px(x - 10.5 * k, ty + 2 * k, sk[3]); S.px(x + 10.5 * k, ty + 2 * k, sk[2]);
    // skull: low, wide, heavy jaw
    S.ball(x, ty + 0.5 * k, 10 * k, 9.5 * k, sk, { lo: 1, spec: 0.15, rim: 0.3 });
    S.ball(x, ty + 6 * k, 10.5 * k, 5.5 * k, sk, { lo: 1, hi: 8 });
    // low hairline: greasy fringe right down onto the sloping brow
    S.ball(x, ty - 7.5 * k, 10.5 * k, 4.5 * k, hair, { lo: 1.5, hi: 7, spec: 0.15 });
    for (let i = -4; i <= 4; i++) {
      const fx = x + i * 2.3 * k, fy = ty - 5 * k + Math.abs(i) * 0.25;
      S.tri([fx - 1.7, fy - 2], [fx + 1.7, fy - 2], [fx + (i % 2 ? 0.7 : -0.7), fy + 2 + (i % 3 === 0 ? 1 : 0)], hair, { tone: 0.55 - Math.abs(i) * 0.05 });
    }
    // heavy brow ridge in a permanent scowl
    S.ball(x, ty - 1 * k, 9.5 * k, 2.5 * k, sk, { lo: 2.5, spec: 0.4 });
    S.line(x - 8 * k, ty - 0.5 * k, x - 1.5 * k, ty + 1.2 * k, sk[2]);
    S.line(x + 1.5 * k, ty + 1.2 * k, x + 8 * k, ty - 0.5 * k, sk[2]);
    // eyes: small, deep-set, mean, under the shadow of the brow
    const eye = (ex, side) => {
      ex = Math.round(ex); const ey = Math.round(ty + 2 * k);
      S.rect(ex - 1, ey, 3, 1, '#200');
      S.px(ex - side * 2, ey, sk[3]);
      if (shut) { S.rect(ex - 1, ey, 3, 1, sk[3]); S.px(ex - 1, ey + 1, '#200'); S.px(ex, ey + 1, '#200'); S.px(ex + 1, ey + 1, '#200'); return; }
      S.px(ex + side * 0, ey, '#ffd'); S.px(ex - side, ey, '#cb8');
    };
    eye(x - 4 * k, -1); eye(x + 4 * k, 1);
    // nose: big, bulbous, flushed
    S.ball(x, ty + 4 * k, 3 * k, 2.8 * k, sk, { lo: 3.5, spec: 0.6 });
    S.px(x - 1, ty + 5.4 * k, sk[1]); S.px(x + 1, ty + 5.4 * k, sk[1]);
    S.px(x - 6.5 * k, ty + 5 * k, '#b54'); S.px(x - 5.5 * k, ty + 5 * k, '#a43'); S.px(x + 6.5 * k, ty + 5 * k, '#933');
  }

  // Bushy beard over the chest, built from hanging clumps; mouth inside it.
  function hgBeard(S, x, y, o = {}) {
    const k = o.k || 1, mo = o.mo || 0, sway = o.sway || 0;
    const bd = BEARD;
    // jaw mass
    S.ball(x, y + 4 * k, 11.5 * k, 7 * k, bd, { lo: 1.5, hi: 8.5, spec: 0.1, rim: 0.3 });
    // clumps hanging in tiers, outer ones shorter
    const clumps = [[-10, 6, 3.6], [10, 6, 3.4], [-7.5, 10, 4], [7.5, 10, 3.8], [-3.5, 13, 4.2], [3.5, 13, 4], [0, 16, 3.6]];
    clumps.forEach(([ox, oy, r0], i) => {
      const cx = x + (ox + sway * oy / 16) * k, cy = y + oy * k;
      S.ball(cx, cy, r0 * 0.85 * k, r0 * 1.15 * k, bd, { lo: 1, hi: 9, spec: 0.15, rim: 0.3 });
      // pointed tip of the clump
      S.tri([cx - r0 * 0.7 * k, cy + 1], [cx + r0 * 0.7 * k, cy + 1], [cx + sway * 0.4 + (i % 2 ? 0.6 : -0.6), cy + (r0 + 2.5) * k], bd, { tone: 0.42 - (oy / 40) });
    });
    // strands
    const r = U.rng(31);
    for (let i = 0; i < 26; i++) {
      const sx = x + (r() - 0.5) * 20 * k, sy = y + 2 + r() * 14 * k, L = 2 + r() * 4;
      const d = i % 3 === 0 ? 2 : -2;
      for (let t = 0; t < L; t++) nudge(S, Math.round(sx + sway * t * 0.15 + (sx - x) * t * 0.04), Math.round(sy + t), bd, d);
    }
    // grey streak
    for (let t = 0; t < 7; t++) { const px = Math.round(x - 4 * k + t * 0.1), py = Math.round(y + 5 * k + t); if (inRamp(S, px, py, bd) !== undefined) S.px(px, py, t % 3 ? '#998' : '#aa9'); }
    // moustache drooping over the mouth
    S.ball(x - 3.6 * k, y + 1.2 * k, 4.6 * k, 2.1 * k, bd, { lo: 3, hi: 9, rot: 0.3, spec: 0.25 });
    S.ball(x + 3.6 * k, y + 1.2 * k, 4.6 * k, 2.1 * k, bd, { lo: 3, hi: 8.5, rot: -0.3, spec: 0.1 });
    // mouth: crooked, gap-toothed
    const mh = Math.round(mo * 4.5 * k);
    if (mh > 0) {
      S.ball(x, y + 3.2 * k + mh * 0.45, 4 * k, 1 + mh * 0.6, MOUTH, { tone: 0.25 });
      S.px(x - 2, y + 2.6 * k, '#ccb'); S.px(x - 1, y + 2.6 * k, '#ddc'); S.px(x + 2, y + 2.6 * k, '#bba');
      S.px(x - 2, y + 2.6 * k + mh, '#aa9'); S.px(x + 1, y + 2.6 * k + mh, '#bba');
      if (mh >= 2) S.px(x, y + 3.6 * k + mh * 0.5, '#813');
    } else {
      S.line(x - 3 * k, y + 3.2 * k, x + 3 * k, y + 3.2 * k, '#100');
      S.px(x - 1, y + 3.2 * k, '#bba');
    }
  }

  function drawHillGiant(S, pose) {
    crisp(S, 0.5, 1.25);
    const q = decode(pose);
    const p = resolve(hgKeys, q);
    const T = mkT(Object.assign({}, p, { s: (p.s || 1) * 1.1 }), 60, 118, 82), W = wrap(S, T), s = T.s;
    const sk = HG_SKIN;

    const shL = T.P(36, 54), shR = T.P(84, 54);
    const head = T.P(60 + p.hx, 41 + p.hy);
    const hipL = T.P(49, 84), hipR = T.P(71, 84);
    const footL = [38, 115], footR = [82, 115];

    const c = Math.cos(p.ca * D2R), sn = Math.sin(p.ca * D2R);
    const g = p.g, g2 = [g[0] - c * p.cl2, g[1] - sn * p.cl2];
    const club = L => oakClub(L, g[0], g[1], p.ca, p.cl, p.ck, p.leaf || 0, 0);

    if (p.cb > 0.5) club(S);

    // ---- legs: thick pillars; bare shins, rag-wrapped feet ----
    const leg = (L, hip, foot, side, lo) => {
      const kx = lerp(hip[0], foot[0], 0.52) + side * 2.5, ky = lerp(hip[1], foot[1], 0.52);
      L.capsule(hip[0], hip[1], kx, ky, 9.5 * s, 7, sk, { lo: lo + 1, rim: 0.3 });
      L.ball(kx - side * 0.8, ky + 6, 5.6, 6.5, sk, { lo: lo + 1, hi: 8.5, spec: 0.1 });       // calf
      L.capsule(kx, ky, foot[0], foot[1] - 5, 6.4, 5, sk, { lo: lo + 1, rim: 0.3 });
      L.ball(kx + side * 0.5, ky - 0.5, 5.2, 4.4, sk, { lo: lo + 1.5, spec: 0.3 });             // knee
      crease(L, sk, kx - 4, ky + 3, kx + 3, ky + 4, -1);
      for (let i = 0; i < 3; i++) L.capsule(foot[0] - 6.5, foot[1] - 6 - i * 2.4 + i * side * 0.5, foot[0] + 6.5, foot[1] - 5 - i * 2.4 - i * side * 0.5, 1.4, 1.4, HIDE, { lo: lo + 1, hi: 7 });
      L.ball(foot[0] + side * 1.5, foot[1] - 1.5, 9, 3.8, sk, { lo: lo + 1, spec: 0.2 });
      for (let i = -2; i <= 2; i++) L.ball(foot[0] + side * 1.5 + i * 3.2 - side * 0.5, foot[1] + 0.6, 1.8, 1.3, sk, { lo: lo + 2, spec: 0.35 });
      L.line(foot[0] - 6, foot[1] - 4, foot[0] + 7, foot[1] - 4, HIDE[2]);
    };
    leg(S, hipR, footR, 1, 0.5);
    layer(S, L => leg(L, hipL, footL, -1, 0));

    // ---- torso: barrel chest over a pot belly, hunched traps ----
    W.ball(60, 62, 27, 13.5, sk, { lo: 1, rim: 0.35 });
    W.ball(60, 76, 21, 13, sk, { lo: 1, spec: 0.12, rim: 0.4 });
    layer(S, L => {
      const WL = wrap(L, T);
      WL.ball(48, 62, 11, 7, sk, { lo: 1.5, spec: 0.15 });
      WL.ball(72, 62, 11, 7, sk, { lo: 1.2, rim: 0.4 });
    }, { k: 0.45, kl: 0 });
    for (const [sx, sy, rx, ry] of HG_SPOTS) spotAt(S, sk, T.X(sx, sy), T.Y(sx, sy), rx * s, ry * s, -1, 5);
    W.line(60, 63, 60, 69, sk[4]);
    crease(S, sk, T.X(44, 80), T.Y(44, 80), T.X(52, 84), T.Y(52, 84), -2);
    crease(S, sk, T.X(76, 80), T.Y(76, 80), T.X(68, 84), T.Y(68, 84), -2);
    W.px(60, 76, sk[2]); W.px(60, 77, sk[3]);
    const rh = U.rng(5);
    for (let i = 0; i < 22; i++) { const hx = 51 + rh() * 18, hy = 61 + rh() * 12 + (rh() < 0.3 ? 6 : 0); nudge(S, Math.round(T.X(hx, hy)), Math.round(T.Y(hx, hy)), sk, -2); }
    W.ball(60, 52, 21, 7.5, sk, { lo: 1.5, hi: 8.5, rim: 0.3, spec: 0.1 });

    // ---- hide kilt and belt ----
    W.poly([[39, 82], [81, 82], [85, 97], [79, 95], [75, 100], [69, 96], [63, 101], [57, 96], [51, 100], [46, 95], [39, 98], [35, 94]], HIDE, { grad: [52, 82, 66, 100, 0.75, 0.2] });
    for (const lx of [47, 56, 66, 75]) W.line(lx, 85, lx + (lx - 60) * 0.12, 95, HIDE[2]);
    W.poly([[38, 78], [82, 78], [82, 84], [38, 84]], HIDE, { grad: [60, 78, 60, 84, 0.6, 0.15] });
    W.line(38, 80, 82, 80, HIDE[2]);
    for (let i = 0; i < 6; i++) W.px(42 + i * 8, 82, HIDE[6]);
    W.ball(60, 81, 3.8, 3.4, 'bone', { lo: 2, spec: 0.4 });
    W.px(59, 81, '#110'); W.px(61, 81, '#110'); W.px(60, 83, '#554');

    // ---- head + beard, sunk between the shoulders ----
    layer(S, L => {
      hgHead(L, head[0], head[1], { k: s, mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt });
      hgBeard(L, head[0], head[1] + 7 * s - p.tilt * 2, { k: s, mo: p.mo, sway: p.bs || 0 });
    }, { k: 0.5, kl: 0.25 });

    // ---- wolf pelt mantle over the screen-left shoulder ----
    const pelt = L => {
      const WL = wrap(L, T);
      WL.poly([[20, 58], [24, 48], [33, 43], [44, 43], [51, 48], [55, 55], [56, 62], [53, 61], [51, 67], [47, 64], [44, 70], [40, 66], [36, 71], [32, 66], [27, 69], [24, 63]], PELT, { grad: [26, 42, 52, 68, 0.9, 0.25] });
      WL.ball(36, 50, 12, 7.5, PELT, { lo: 1.5, spec: 0.2 });
      for (const [x, y, len, sl] of HG_PELT_STROKES) {
        const X = Math.round(T.X(x, y)), Y = Math.round(T.Y(x, y));
        if (inRamp(L, X, Y, PELT) === undefined) continue;
        for (let t = 0; t < len; t++) nudge(L, Math.round(X + sl * t), Math.round(Y + t), PELT, -2);
        nudge(L, Math.round(X - sl), Math.round(Y - 1), PELT, 2);
      }
      // bone clasp at the throat
      WL.horn(52, 54, 55, 52, 57, 55, 1.3, 0.8, 'bone', { lo: 3, spec: 0.4 });
    };

    // ---- arms: long and heavy; deltoid, biceps, gorilla forearms, big hands ----
    const arm = (L, sh, hand, bend, lo) => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], 22 * s, 21 * s, bend);
      const o = { lo: lo + 1, rim: 0.35 };
      const ua = Math.atan2(j.ey - sh[1], j.ex - sh[0]), fa = Math.atan2(j.hy - j.ey, j.hx - j.ex);
      const ux = Math.cos(ua), uy = Math.sin(ua), fx = Math.cos(fa), fy = Math.sin(fa);
      L.capsule(sh[0], sh[1], j.ex, j.ey, 6 * s, 4.4 * s, sk, o);
      L.ball(lerp(sh[0], j.ex, 0.48), lerp(sh[1], j.ey, 0.48), 7.5 * s, 5.4 * s, sk, Object.assign({ rot: ua, spec: 0.2 }, o));
      L.capsule(j.ex, j.ey, j.hx, j.hy, 4.8 * s, 3.8 * s, sk, o);
      L.ball(lerp(j.ex, j.hx, 0.3), lerp(j.ey, j.hy, 0.3), 7.5 * s, 5.6 * s, sk, Object.assign({ rot: fa, spec: 0.15 }, o));
      // biceps / forearm muscle splits
      crease(L, sk, lerp(sh[0], j.ex, 0.3) - uy * 2.5, lerp(sh[1], j.ey, 0.3) + ux * 2.5, lerp(sh[0], j.ex, 0.75) - uy * 1.5, lerp(sh[1], j.ey, 0.75) + ux * 1.5, -2);
      crease(L, sk, lerp(j.ex, j.hx, 0.12) + fy * 2, lerp(j.ey, j.hy, 0.12) - fx * 2, lerp(j.ex, j.hx, 0.55) + fy * 0.5, lerp(j.ey, j.hy, 0.55) - fx * 0.5, -2);
      // hide bracer, rope-bound
      const bx = lerp(j.ex, j.hx, 0.8), by = lerp(j.ey, j.hy, 0.8);
      L.ball(bx, by, 3.6 * s, 5.2 * s, HIDE, { lo: lo + 1, rot: fa, spec: 0.15 });
      L.line(bx - fy * 4.5, by + fx * 4.5, bx + fy * 4.5, by - fx * 4.5, HIDE[2]);
      return j;
    };
    // a huge clenched hand: palm, knuckle ridge, thumb wrapped across
    const fist = (L, j, lo) => {
      const fa = Math.atan2(j.hy - j.ey, j.hx - j.ex), fx = Math.cos(fa), fy = Math.sin(fa);
      const hx = j.hx + fx * 1.5, hy = j.hy + fy * 1.5;
      L.ball(hx, hy, 6.2 * s, 5.6 * s, sk, { lo: lo + 1.5, spec: 0.25, rot: fa });
      for (let i = -1.5; i <= 1.5; i++) {
        const kx = hx + fx * 3.6 - fy * i * 2.3, ky = hy + fy * 3.6 + fx * i * 2.3;
        L.ball(kx, ky, 1.6 * s, 1.5 * s, sk, { lo: lo + 2, spec: 0.3 });
      }
      for (let i = -1; i <= 1; i++) {
        const kx = hx + fx * 2.2 - fy * i * 2.3 - fy * 1.15, ky = hy + fy * 2.2 + fx * i * 2.3 + fx * 1.15;
        nudge(L, Math.round(kx), Math.round(ky), sk, -2);
      }
      L.capsule(hx - fy * 3.5 - fx * 1, hy + fx * 3.5 - fy * 1, hx + fx * 1.5 - fy * 0.5, hy + fy * 1.5 + fx * 0.5, 1.6, 1.4, sk, { lo: lo + 2, spec: 0.3 });
    };
    const both = p.two > 0.5;
    const fl = (p.flank || 0) > 0.5;
    const hRt = fl ? [g[0] + 6, g[1] + 1] : g, hLt = fl ? [g[0] - 6, g[1] + 1] : both ? g2 : p.hL;
    let jL, jR;
    const armR = () => layer(S, L => {
      jR = arm(L, shR, hRt, p.bR, 0.6);
      L.ball(shR[0], shR[1], 10 * s, 9 * s, sk, { lo: 1.5, rim: 0.45, spec: 0.12 });
      crease(L, sk, shR[0] - 6, shR[1] + 5, shR[0] + 2, shR[1] + 8, -1);
    });
    const armL = () => layer(S, L => {
      jL = arm(L, shL, hLt, p.bL, 0);
      L.ball(shL[0], shL[1], 10 * s, 9 * s, sk, { lo: 1.5, spec: 0.15 });
      pelt(L);
    });
    if (p.cb > 0.5) {
      if (hRt[0] < 60) { armL(); armR(); } else { armR(); armL(); }
      if (fl) layer(S, L => { fist(L, jL, 0); fist(L, jR, 0.5); });
      else if (Math.abs(sn) > 0.9) layer(S, L => { fist(L, jL, -0.6); fist(L, jR, 0.4); });
      else layer(S, L => { fist(L, jL, 0); fist(L, jR, 0.6); });
    } else {
      armR(); armL();
      layer(S, L => club(L));
      layer(S, L => { fist(L, jR, 0.6); if (both) fist(L, jL, 0); });
      if (!both) layer(S, L => fist(L, jL, 0));
    }

    // clods of earth flying off the smash
    if (q.st) {
      const rx = g[0] + c * p.cl, ry = g[1] + sn * p.cl;
      const r = U.rng(90 + q.dir);
      for (let i = 0; i < 12; i++) {
        const a = (-170 + r() * 160) * D2R, d = 15 + r() * 10;
        const x = rx + Math.cos(a) * d, y = ry + Math.sin(a) * d * 0.8;
        if (x < 3 || x > S.w - 4 || y < 3 || S.opaque(x, y)) continue;
        S.ball(x, y, 1 + r() * 0.9, 0.9 + r() * 0.6, EARTH, { lo: 2, hi: 7 });
      }
    }

    S.outline();

    if (q.st) {
      const cols = ['#432', '#654', '#987', '#cba'];
      if (q.dir < 0) swoosh(S, [[24, 3], [8, 28], [6, 62], [16, 90], [32, 108]], 9, cols, { behind: true, side: -1 });
      else if (q.dir > 0) swoosh(S, [[96, 3], [112, 28], [114, 62], [104, 90], [88, 108]], 9, cols, { behind: true, side: 1 });
      else {
        swoosh(S, [[52, 2], [34, 12], [22, 38], [22, 68]], 7, cols, { behind: true, side: -1 });
        swoosh(S, [[68, 2], [86, 12], [98, 38], [98, 68]], 7, cols, { behind: true, side: 1 });
      }
    }
    clearRing(S);
  }

  function hgPortrait(S) {
    crisp(S, 0.5, 1.15);
    S.ball(12, 31, 17, 11, HG_SKIN, { lo: 1, rim: 0.3 });
    S.ball(2, 24, 7, 6, PELT, { lo: 1, spec: 0.15 });
    hgHead(S, 12, 10, { k: 0.85, mo: 0.6 });
    hgBeard(S, 12, 16, { k: 0.85, mo: 0.6 });
    S.outline();
  }

  EN['Hill Giant'] = { w: 120, h: 120, anchor: [60, 118], center: [60, 64], mouth: [60, 44], draw: drawHillGiant, portrait: hgPortrait };

  // ===============================================================
  // FIRE GIANT — a regal warlord of the forge: coal-black skin split by
  // glowing ember cracks, black iron plate with molten seams, hair and
  // beard of living flame (bands cycle up the tongues across idle frames),
  // and a greatsword glowing orange-hot.
  // g = sword grip (screen), sa = blade angle (deg, grip→tip), sl = blade
  // length, sw = blade width scale (foreshortening).
  // ===============================================================
  const COAL = ['#000', '#100', '#101', '#201', '#211', '#311', '#322', '#433', '#543', '#654'];
  const IRON = ['#000', '#101', '#111', '#112', '#212', '#223', '#323', '#434', '#556', '#889'];
  const HOT = ['#200', '#400', '#710', '#a20', '#d40', '#f70', '#fa2', '#fd6', '#ffb', '#fff'];
  const FLAME = ['#300', '#610', '#a20', '#d40', '#f70', '#fa2', '#fd5', '#ffb', '#fff'];
  const SEAM = ['#610', '#a20', '#e50', '#f92', '#fd6'];
  const CAPE = ['#100', '#200', '#301', '#401', '#502', '#612', '#723', '#834'];

  const fgKeys = {
    idle: f => {
      const br = [0, 1, 2, 1][f];
      return {
        lean: 0, dx: 0, dy: 0, s: 1 + br * 0.008, hx: 0, hy: br * 0.3, tilt: 0, mo: 0.15, shut: 0,
        g: [60, 63 + br * 0.2], sa: 90, sl: 46, sw: 1, gap: 6, bL: 1, bR: -1, sb: 0, flare: 0, f,
      };
    },
    // blade cocked high over the screen-left shoulder
    wl: { lean: -0.2, dx: -3, dy: -2, hx: -4, hy: 0, mo: 0.5, g: [42, 40], sa: 222, sl: 41, sw: 1, gap: 6, bL: 1, bR: -1, sb: 1, flare: 0.5 },
    wl5: { g: [44, 54], sa: 206, sl: 37, sb: 0, bL: 1, bR: -1, lean: -0.1 },
    // blade raised straight up over the crown, foreshortened as it tilts back
    // overhead: blade held level above the flaming hair (no headroom for it upright)
    wh: { lean: 0, dx: 0, dy: -3, hx: 0, hy: 1, mo: 0.6, g: [40, 14], sa: 0, sl: 40, sw: 1.25, gap: 6, bL: -1, bR: 1, sb: 1, flare: -0.45, tilt: 0.4 },
    wh5: { dy: 2, s: 0.99, g: [42, 24], sa: 0, sl: 36, sw: 1.15, gap: 6, bL: -1, bR: 1, sb: 1, flare: -0.25, mo: 0.4 },
    // blade cocked high over the screen-right shoulder
    wr: { lean: 0.2, dx: 3, dy: -2, hx: 4, hy: 0, mo: 0.5, g: [78, 40], sa: -42, sl: 41, sw: 1, gap: 6, bL: 1, bR: -1, sb: 1, flare: 0.5 },
    wr5: { g: [76, 54], sa: -26, sl: 37, sb: 0, bL: 1, bR: -1, lean: 0.1 },
    // strikes: blade hewn down toward the viewer
    sl: { lean: 0.12, dx: 3, dy: 5, s: 1.05, hx: 3, hy: 2, mo: 1, g: [66, 74], sa: 126, sl: 42, sw: 1.15, gap: 6, bL: 1, bR: -1, sb: 0, flare: 1 },
    sh: { lean: 0, dx: 0, dy: 7, s: 1.06, hx: 0, hy: 3, mo: 1, g: [60, 70], sa: 90, sl: 36, sw: 1.35, gap: 6, bL: 1, bR: -1, sb: 0, flare: 1 },
    sr: { lean: -0.12, dx: -3, dy: 5, s: 1.05, hx: -3, hy: 2, mo: 1, g: [54, 74], sa: 54, sl: 42, sw: 1.15, gap: 6, bL: 1, bR: -1, sb: 0, flare: 1 },
    hurt: { lean: 0.14, dx: 3, dy: -1, s: 0.98, hx: 5, hy: -1, tilt: 1, mo: 1, shut: 1, g: [92, 78], sa: 72, sl: 32, sw: 1, gap: 0, hL: [20, 58], bL: 1, bR: -1, sb: 0, flare: 1 },
  };

  // One tongue of flame along a quadratic bezier, painted as nested layers
  // (dark red rim → orange → yellow core → white-hot root). Bulges travel up
  // the tongue with `ph` so successive frames read as palette-cycled fire.
  function flameTongue(S, x0, y0, cx, cy, x1, y1, w, ph, o = {}) {
    const n = Math.max(6, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.2));
    const layers = o.layers || [[1.12, 1.02, 2], [1, 0.95, 3], [0.8, 0.85, 4], [0.6, 0.72, 5], [0.4, 0.55, 6], [0.2, 0.32, 7]];
    const only = o.only;
    for (const [wk, lk, ci] of layers) {
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (t > lk) break;
        const it = 1 - t;
        const x = it * it * x0 + 2 * it * t * cx + t * t * x1;
        const y = it * it * y0 + 2 * it * t * cy + t * t * y1;
        const tt = t / lk;
        let r = w * wk * Math.pow(1 - tt, 0.8) * (1 + 0.22 * Math.sin(t * 11 - ph * Math.PI / 2));
        if (r < 0.45) continue;
        for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
          const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
          if (d > r) continue;
          if (xx < 1 || yy < 1 || xx > S.w - 2 || yy > S.h - 2) continue;
          if (only && !only(xx, yy)) continue;
          // dither only the outermost (darkest) rim for a soft licking edge
          if (ci <= 2 && d > r - 1.2 && P.thresh(xx, yy) > 0.45) continue;
          S.set(xx, yy, FLAME[Math.min(FLAME.length - 1, ci + (tt < 0.15 ? 1 : 0))]);
        }
      }
    }
  }

  // Glowing crack network on coal skin (model-space polylines through T).
  const crackList = (seed, n, x0, y0, w, h) => {
    const r = U.rng(seed), out = [];
    for (let i = 0; i < n; i++) {
      let x = x0 + r() * w, y = y0 + r() * h;
      const pts = [[x, y]];
      let a = r() * Math.PI * 2;
      const L = 4 + Math.floor(r() * 4);
      for (let j = 0; j < L; j++) { a += (r() - 0.5) * 1.2; x += Math.cos(a) * 1.5; y += Math.sin(a) * 1.5; pts.push([x, y]); }
      out.push(pts);
    }
    return out;
  };
  const drawCracks = (S, list, map, test, hot = 0) => {
    for (const pts of list) {
      for (let j = 1; j < pts.length; j++) {
        const [ax, ay] = map(pts[j - 1][0], pts[j - 1][1]), [bx, by] = map(pts[j][0], pts[j][1]);
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
        for (let k = 0; k <= steps; k++) {
          const x = Math.round(lerp(ax, bx, k / steps)), y = Math.round(lerp(ay, by, k / steps));
          if (!test(x, y)) continue;
          S.set(x, y, j === 1 || j === pts.length - 1 ? SEAM[1 + hot] : SEAM[2 + hot]);
        }
      }
    }
  };
  const isCoal = (S, x, y) => inRamp(S, x, y, COAL) !== undefined;

  // The greatsword. (gx,gy) grip centre, a = angle toward the tip.
  function greatsword(S, gx, gy, a, len, wk, glowPh = 0) {
    const c = Math.cos(a * D2R), s = Math.sin(a * D2R), nx = -s, ny = c;
    const cgx = gx + c * 6, cgy = gy + s * 6;                    // crossguard
    const tipx = cgx + c * len, tipy = cgy + s * len;
    const bw = 4.4 * wk;
    // pommel + grip
    S.ball(gx - c * 6.5, gy - s * 6.5, 2.6, 2.6, IRON, { lo: 2, spec: 0.6 });
    S.px(gx - c * 6.5 - 0.5, gy - s * 6.5 - 0.5, SEAM[3]);
    S.capsule(gx - c * 5, gy - s * 5, cgx, cgy, 1.7, 1.7, R.wood, { lo: 0, hi: 4 });
    for (let i = -4; i <= 4; i += 2) S.px(gx + c * i, gy + s * i, '#100');
    // blade: hot steel, white-hot along the edge, glowing fuller
    const blade = [[cgx + nx * bw, cgy + ny * bw], [cgx + c * len * 0.85 + nx * bw * 0.8, cgy + s * len * 0.85 + ny * bw * 0.8], [tipx, tipy],
      [cgx + c * len * 0.85 - nx * bw * 0.8, cgy + s * len * 0.85 - ny * bw * 0.8], [cgx - nx * bw, cgy - ny * bw]];
    S.poly(blade, HOT, { grad: [cgx + nx * bw, cgy + ny * bw, cgx - nx * bw, cgy - ny * bw, 0.78, 0.38] });
    // heat bands pulsing along the blade
    const n = Math.ceil(len);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const x = cgx + c * i, y = cgy + s * i;
      const pulse = 0.5 + 0.5 * Math.sin(t * 9 - glowPh * Math.PI / 2);
      S.px(x, y, pulse > 0.6 ? '#fff' : '#ffb');                          // white-hot fuller
      if (t < 0.85) S.px(x - nx * bw * 0.55, y - ny * bw * 0.55, pulse > 0.75 ? '#fa2' : '#e60');
      if (t < 0.8) S.px(x + nx * bw * 0.75, y + ny * bw * 0.75, '#fd6');    // lit edge
    }
    // forge-blackened ricasso near the guard
    S.poly([[cgx + nx * bw, cgy + ny * bw], [cgx + c * 5 + nx * bw, cgy + s * 5 + ny * bw], [cgx + c * 5 - nx * bw, cgy + s * 5 - ny * bw], [cgx - nx * bw, cgy - ny * bw]], IRON, { grad: [cgx, cgy, cgx + c * 5, cgy + s * 5, 0.5, 0.25] });
    S.px(cgx + c * 2.5, cgy + s * 2.5, SEAM[3]);
    // crossguard: black iron with flared, molten-edged quillons
    S.capsule(cgx + nx * 8, cgy + ny * 8, cgx - nx * 8, cgy - ny * 8, 1.7, 1.7, IRON, { lo: 1, spec: 0.6 });
    S.horn(cgx + nx * 7, cgy + ny * 7, cgx + nx * 9, cgy + ny * 9, cgx + nx * 10 + c * 2.5, cgy + ny * 10 + s * 2.5, 1.7, 0.6, IRON, { lo: 1, spec: 0.5 });
    S.horn(cgx - nx * 7, cgy - ny * 7, cgx - nx * 9, cgy - ny * 9, cgx - nx * 10 + c * 2.5, cgy - ny * 10 + s * 2.5, 1.7, 0.6, IRON, { lo: 1, spec: 0.5 });
    S.ball(cgx, cgy, 2.2, 2.2, IRON, { lo: 2, spec: 0.5 });
    S.px(cgx, cgy, SEAM[4]);
    return { tipx, tipy, cgx, cgy };
  }
  // Heat shimmer around the blade: dithered glow on empty pixels only.
  function bladeGlow(S, gx, gy, a, len, wk) {
    const c = Math.cos(a * D2R), s = Math.sin(a * D2R);
    const cgx = gx + c * 6, cgy = gy + s * 6;
    const n = Math.ceil(len / 3);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      aura(S, cgx + c * len * t * 0.95, cgy + s * len * t * 0.95, 6.5 * wk * (1 - t * 0.5), 6.5 * wk * (1 - t * 0.5), ['#410', '#710', '#a20'], { k: 0.55 });
    }
  }

  // Head: coal skull, burning eyes. (x, y) = face centre.
  function fgHead(S, x, y, o = {}) {
    const k = o.k || 1, tl = o.tilt || 0, shut = o.shut, mo = o.mo || 0;
    const ty = y - tl * 2 * k;
    S.ball(x, ty, 9.5 * k, 10.5 * k, COAL, { lo: 1, spec: 0.25, rim: 0.5 });
    S.ball(x, ty + 5 * k, 9.5 * k, 5.5 * k, COAL, { lo: 1, hi: 8 });              // heavy jaw
    S.ball(x - 9.5 * k, ty + 1 * k, 2 * k, 3 * k, COAL, { lo: 2, hi: 8 });        // ears
    S.ball(x + 9.5 * k, ty + 1 * k, 2 * k, 3 * k, COAL, { lo: 1, hi: 6 });
    // cheekbones and brow: hard planes catching the light
    S.ball(x, ty - 2 * k, 8.5 * k, 2.6 * k, COAL, { lo: 3, spec: 0.5 });
    S.line(x - 7.5 * k, ty - 1 * k, x - 1.5 * k, ty + 0.8 * k, COAL[1]);
    S.line(x + 1.5 * k, ty + 0.8 * k, x + 7.5 * k, ty - 1 * k, COAL[1]);
    S.ball(x - 5 * k, ty + 4 * k, 2.6 * k, 1.6 * k, COAL, { lo: 3, spec: 0.4 });  // cheekbones
    S.ball(x + 5 * k, ty + 4 * k, 2.6 * k, 1.6 * k, COAL, { lo: 2, hi: 7 });
    // eyes: white-hot under the brow
    const eye = (ex, side) => {
      ex = Math.round(ex); const ey = Math.round(ty + 1.5 * k);
      if (shut) { S.rect(ex - 1, ey, 3, 1, SEAM[1]); S.px(ex + side, ey - 1, SEAM[0]); return; }
      S.rect(ex - 2, ey, 4, 1, '#e60'); S.rect(ex - 1, ey, 2, 1, '#fd5'); S.px(ex - (side < 0 ? 0 : 1), ey, '#fff');
      S.px(ex - 1, ey - 1, '#a20'); S.px(ex, ey - 1, '#a20');
    };
    eye(x - 3.4 * k, -1); eye(x + 4.4 * k, 1);
    // nose ridge
    S.ball(x, ty + 3.6 * k, 1.8 * k, 2.4 * k, COAL, { lo: 3, spec: 0.4 });
    // mouth: furnace glow inside
    const mh = Math.round(mo * 3.5 * k);
    if (mh > 0) {
      S.ball(x, ty + 7 * k + mh * 0.3, 3.4 * k, 0.9 + mh * 0.55, HOT, { tone: 0.62 });
      S.px(x, ty + 7 * k + mh * 0.3, '#ffb');
      S.line(x - 2, ty + 6.4 * k, x + 2, ty + 6.4 * k, '#ccb');
    } else {
      S.line(x - 3 * k, ty + 7 * k, x + 3 * k, ty + 7 * k, SEAM[1]);
    }
    // ember cracks across the face
    S.line(x - 6 * k, ty - 5 * k, x - 4 * k, ty - 3 * k, SEAM[1]);
    S.px(x + 5 * k, ty + 4 * k, SEAM[1]); S.px(x + 6 * k, ty + 5 * k, SEAM[2]);
    S.px(x - 5.5 * k, ty + 4.5 * k, SEAM[1]);
  }

  // Flame hair (behind) and beard (in front). f cycles the bands.
  function fireHair(S, x, y, f, k = 1, flare = 0, only, o2) {
    const L = (1 + flare * 0.3) * k;
    // [base dx, base dy, ctrl dx, ctrl dy, tip dx, tip dy, width]
    const tongues = [
      [-9, 4, -19, -2, -16, -15, 4.5], [9, 4, 19, -3, 19, -17, 4.5],
      [-6, -2, -13, -12, -5, -24, 5.5], [6, -2, 13, -13, 10, -26, 5.5],
      [0, -4, -5, -17, 3, -32, 6],
    ];
    tongues.forEach(([ax, ay, bx, by, cx, cy, w], i) => {
      const wob = Math.sin((f + i * 1.3) * Math.PI / 2) * 1.8;
      flameTongue(S, x + ax * k, y + ay * k, x + (bx - wob * 0.8) * L, y + by * L, x + (cx + wob) * L, y + (cy - (i + f) % 2) * L, w * k, f + i, { only });
    });
    // flames burning over the scalp (in front of the head, above the brow)
    if (o2 && o2.scalp) {
      const hl = o2.scalp;
      // arched hairline: higher at the brow's centre, sideburns at the temples
      const clip = (xx, yy) => yy < hl + Math.max(0, Math.abs(xx + 0.5 - x) - 2) * 0.45;
      for (let i = -3; i <= 3; i++) {
        const bx = x + i * 2.9 * k, by = y + (6 + Math.abs(i) * 1.2) * k;
        const wob = Math.sin((f + i) * Math.PI / 2) * 1;
        flameTongue(S, bx, by, bx + i * 1.3 * k + wob, by - 7 * k, bx + i * 1.8 * k - wob + 1, by - (12 + (3 - Math.abs(i)) * 2.5) * L, 3 * k, f + i,
          { only: clip, layers: [[1, 1, 3], [0.75, 0.85, 4], [0.5, 0.7, 5], [0.28, 0.45, 6]] });
      }
    }
    // small licks breaking off the tips
    const lk = [[-12, -24], [13, -26], [-3, -38], [4, -35]];
    lk.forEach(([lx, ly], i) => {
      if ((f + i) % 4 === 3) return;
      const yy = y + (ly - ((f + i) % 4) * 1.5) * L, xx = x + lx * L + Math.sin(f + i) * 1.5;
      flameTongue(S, xx, yy + 3, xx - 1, yy, xx + 0.5, yy - 3, 1.6 * k, f, { only, layers: [[1, 1, 3], [0.5, 0.6, 5]] });
    });
  }
  function fireBeard(S, x, y, f, k = 1, flare = 0) {
    // a flame mass along the jaw, splitting into licking points below
    const tongues = [[-7, -2, -10, 4, -9, 10, 2.6], [-3.5, -1, -5, 8, -3, 15, 3.2], [0.5, 0, 1, 10, 0.5, 18 + flare * 2, 3.4], [4.5, -1, 6, 8, 5, 14, 3], [8, -2, 10.5, 4, 10, 9, 2.4]];
    tongues.forEach(([ax, ay, bx, by, cx, cy, w], i) => {
      const wob = Math.sin((f + i * 1.7) * Math.PI / 2) * 1.2;
      flameTongue(S, x + ax * k, y + ay * k, x + (bx + wob * 0.5) * k, y + by * k, x + (cx + wob) * k, y + (cy + flare) * k, w * k, f + i * 2,
        { layers: [[1.1, 1, 2], [0.9, 0.92, 4], [0.65, 0.75, 5], [0.4, 0.55, 6], [0.2, 0.3, 7]] });
    });
    // white-hot root along the jaw
    for (let i = -6; i <= 6; i++) {
      const xx = Math.round(x + i * k), yy = Math.round(y - 1.5 * k + Math.abs(i) * 0.12);
      S.set(xx, yy, Math.abs(i) < 4 ? '#fd5' : '#fa2');
    }
  }

  // Firelight: tint opaque, non-flame pixels near flame pixels toward orange.
  const FLAME_SET = new Set(FLAME.map(c => P.toInt(c)));
  function firelight(S, x0, y0, x1, y1, amt = 0.4) {
    const w = S.w, src = S.data.slice();
    for (let y = Math.max(1, y0); y <= Math.min(S.h - 2, y1); y++) for (let x = Math.max(1, x0); x <= Math.min(w - 2, x1); x++) {
      const v = src[y * w + x];
      if (!v || FLAME_SET.has(v)) continue;
      let n = 0;
      for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (FLAME_SET.has(src[(y + j) * w + x + i])) n++;
      if (n) S.data[y * w + x] = P.toInt(P.mix(P.fromInt(v), v === INK ? '#610' : '#f70', v === INK ? 0.6 : amt));
    }
  }

  const FG_CRACKS_ARM = crackList(61, 3, -4, -1, 8, 2);

  function drawFireGiant(S, pose) {
    crisp(S, 0.5, 1.2);
    const q = decode(pose);
    const p = resolve(fgKeys, q);
    const T = mkT(p, 60, 118, 80), W = wrap(S, T), s = T.s;
    const f = q.idle ? q.f : (q.st ? 2 : q.hu ? 3 : 1);

    const shL = T.P(37, 49), shR = T.P(83, 49);
    const head = T.P(60 + p.hx, 35 + p.hy);
    const hipL = T.P(51, 82), hipR = T.P(69, 82);
    const footL = [44, 115], footR = [76, 115];

    const c = Math.cos(p.sa * D2R), sn = Math.sin(p.sa * D2R);
    const g = p.g;
    const hand1 = [g[0] + c * 1.5, g[1] + sn * 1.5], hand2 = [g[0] - c * (p.gap - 1.5), g[1] - sn * (p.gap - 1.5)];
    const sword = L => greatsword(L, g[0], g[1], p.sa, p.sl, p.sw, f);
    // ---- singed cape behind the body, hem smouldering ----
    const hem = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, x = lerp(20, 100, t);
      hem.push([x + (i % 2 ? 1.5 : -1), 107 + (i % 3 === 1 ? 4 : i % 2 ? -2 : 1) + Math.sin(t * 7 + (p.f || 0) * 0.8) * 1.2]);
    }
    W.poly([[38, 44], [82, 44], [92, 70]].concat(hem.slice().reverse()).concat([[28, 70]]), CAPE, { grad: [24, 50, 96, 104, 0.85, 0.15] });
    for (const fx of [34, 46, 74, 86]) crease(S, CAPE, T.X(lerp(60, fx, 0.4), 60), T.Y(lerp(60, fx, 0.4), 60), fx + (fx - 60) * 0.25, 104, -2);
    for (const fx of [40, 80]) crease(S, CAPE, T.X(lerp(60, fx, 0.4), 62), T.Y(lerp(60, fx, 0.4), 62), fx + (fx - 60) * 0.3, 102, 1);
    for (let i = 0; i < hem.length - 1; i++) {
      const [ax, ay] = hem[i], [bx, by] = hem[i + 1];
      S.line(ax, ay - 1, bx, by - 1, i % 3 ? SEAM[1] : SEAM[2]);
      if (i % 2) S.px(lerp(ax, bx, 0.5), lerp(ay, by, 0.5) - 1, SEAM[3]);
    }
    if (p.sb > 0.5) sword(S);

    // ---- legs: iron greaves over coal ----
    const leg = (L, hip, foot, side, lo) => {
      const kx = lerp(hip[0], foot[0], 0.5) + side * 1.5, ky = lerp(hip[1], foot[1], 0.5);
      L.capsule(hip[0], hip[1], kx, ky, 8 * s, 6.5, COAL, { lo: lo + 1, rim: 0.4 });
      L.capsule(kx, ky, foot[0], foot[1] - 5, 6.5, 5.5, IRON, { lo: lo + 1, spec: 0.5, rim: 0.3 });
      L.ball(kx, ky - 0.5, 5.2, 4.6, IRON, { lo: lo + 2, spec: 0.7 });                // poleyn
      L.px(kx - 1, ky - 2, SEAM[3]); L.line(kx - 4, ky + 3, kx + 4, ky + 3, SEAM[1]);
      // sabaton
      L.poly([[foot[0] - 8, foot[1] + 1], [foot[0] - 6, foot[1] - 5], [foot[0] + 6, foot[1] - 5], [foot[0] + 8 + side, foot[1] + 1]], IRON, { grad: [foot[0] - 6, foot[1] - 5, foot[0] + 6, foot[1] + 1, 0.75, 0.25] });
      L.line(foot[0] - 7, foot[1] - 2, foot[0] + 7, foot[1] - 2, IRON[1]);
      L.line(foot[0] - 6, foot[1] - 1, foot[0] + 6, foot[1] - 1, SEAM[0]);
      // shin seam
      L.line(lerp(kx, foot[0], 0.2), lerp(ky, foot[1], 0.2) + 2, lerp(kx, foot[0], 0.75), lerp(ky, foot[1], 0.75), IRON[6]);
    };
    leg(S, hipR, footR, 1, 0.5);
    layer(S, L => leg(L, hipL, footL, -1, 0));

    // ---- mail skirt and tassets ----
    W.poly([[44, 74], [76, 74], [80, 94], [40, 94]], IRON, { grad: [44, 74, 76, 94, 0.45, 0.15] });
    for (let y = 76; y < 94; y += 2) for (let x = 42; x < 79; x += 2) { const X = Math.round(T.X(x + (y % 4 ? 1 : 0), y)), Y = Math.round(T.Y(x, y)); if (inRamp(S, X, Y, IRON) !== undefined) S.set(X, Y, IRON[5]); }
    for (const [x0, x1, lo] of [[40, 52, 0.15], [53, 67, 0.08], [68, 80, 0]]) {
      W.poly([[x0, 76], [x1, 76], [x1 + (x1 > 60 ? 2 : 0), 90], [x0 - (x0 < 60 ? 2 : 0), 90]], IRON, { grad: [x0, 76, x1, 90, 0.7 - lo, 0.25 - lo] });
      W.line(x0 + 1, 83, x1 - 1, 83, SEAM[0]);
      W.px((x0 + x1) / 2, 83, SEAM[2]);
    }
    // belt with a molten rune buckle
    W.poly([[42, 70], [78, 70], [78, 76], [42, 76]], IRON, { grad: [60, 70, 60, 76, 0.6, 0.2] });
    W.ball(60, 73, 4, 3.6, IRON, { lo: 2, spec: 0.6 });
    W.line(58, 72, 62, 74, SEAM[3]); W.line(62, 72, 58, 74, SEAM[3]); W.px(60, 73, '#fff');

    // ---- torso: breastplate over coal ----
    W.ball(60, 60, 22, 16, IRON, { lo: 1, hi: 8, spec: 0.5, rim: 0.4 });
    W.ball(60, 69, 15, 6, IRON, { lo: 1, hi: 7 });
    // plate lines: central ridge, pectoral plates, faulds with molten seams
    W.line(60, 47, 60, 66, IRON[7]);
    W.line(61, 48, 61, 66, IRON[3]);
    for (const [y0, w0] of [[64, 17], [68, 15]]) {
      W.line(60 - w0, y0, 60 + w0, y0, SEAM[1]);
      W.line(60 - w0 + 3, y0, 60 + w0 - 3, y0, SEAM[2]);
    }
    W.line(43, 55, 52, 60, SEAM[1]); W.line(77, 55, 68, 60, SEAM[1]);
    // rivets
    for (const [rx, ry] of [[45, 52], [75, 52], [44, 61], [76, 61]]) { W.px(rx, ry, IRON[8]); W.px(rx + 1, ry + 1, IRON[1]); }
    // gorget
    W.ball(60, 45, 11, 4.5, IRON, { lo: 1.5, spec: 0.6 });
    W.line(51, 46, 69, 46, SEAM[0]);

    // ---- head, flame hair behind it, flame beard in front ----
    layer(S, L => fgHead(L, head[0], head[1], { k: s, mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt }), { k: 0.5, kl: 0.2 });
    const beardAt = [head[0], head[1] + 8.5 * s - p.tilt * 2];

    // ---- pauldrons + arms ----
    const pauldron = (L, sh, side, lo) => {
      // two lames under the dome
      for (let i = 2; i >= 1; i--) {
        const px = sh[0] + side * (2 + i * 1.2), py = sh[1] + i * 3.6;
        L.poly([[px - 9 + i, py - 2], [px + 9 - i, py - 2 + side * 2], [px + 8 - i, py + 2.5 + side * 2], [px - 8 + i, py + 2.5]], IRON, { grad: [px - 8, py - 2, px + 8, py + 3, 0.62 - i * 0.08 - lo * 0.2, 0.2] });
        L.line(px - 8 + i, py + 2.5, px + 8 - i, py + 2.5 + side * 2, SEAM[i === 1 ? 1 : 0]);
      }
      // the dome
      L.ball(sh[0] + side * 1, sh[1] - 1.5, 10.5 * s, 7 * s, IRON, { lo: lo + 1, hi: 8, spec: 0.55, rim: 0.4, rot: side * 0.3 });
      // raised rim along the lower edge, molten seam under it
      for (let t = -1; t <= 1; t += 0.1) {
        const a = t * 1.25 + Math.PI / 2 + side * 0.3;
        const x = sh[0] + side * 1 + Math.cos(a) * 10 * s, y = sh[1] - 1.5 + Math.sin(a) * 6.5 * s;
        L.px(x, y, IRON[7]);
        L.px(x, y + 1, SEAM[1]);
      }
      // an upswept horn-spike
      const bx = sh[0] + side * 3, by = sh[1] - 6;
      L.horn(bx, by, bx + side * 2, by - 6, bx + side * 6, by - 11, 2.8, 0.5, IRON, { lo: lo + 1, hi: 8, spec: 0.5 });
      L.px(bx + side * 1, by - 2, SEAM[1]);
    };
    const arm = (L, sh, hand, bend, lo) => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], 19 * s, 18 * s, bend);
      const o = { lo: lo + 1, rim: 0.45, spec: 0.3 };
      const ua = Math.atan2(j.ey - sh[1], j.ex - sh[0]), fa = Math.atan2(j.hy - j.ey, j.hx - j.ex);
      L.capsule(sh[0], sh[1], j.ex, j.ey, 6 * s, 5 * s, COAL, o);
      L.ball(lerp(sh[0], j.ex, 0.5), lerp(sh[1], j.ey, 0.5), 6.8 * s, 5.4 * s, COAL, Object.assign({ rot: ua }, o));
      // iron vambrace with a molten seam
      L.capsule(j.ex, j.ey, j.hx, j.hy, 5.4 * s, 4.4 * s, IRON, { lo: lo + 1, spec: 0.6, rim: 0.3 });
      L.ball(j.ex, j.ey, 4.6 * s, 4.4 * s, IRON, { lo: lo + 1.5, spec: 0.6 });
      const mx = lerp(j.ex, j.hx, 0.55), my = lerp(j.ey, j.hy, 0.55);
      L.line(mx - Math.sin(fa) * 4.5, my + Math.cos(fa) * 4.5, mx + Math.sin(fa) * 4.5, my - Math.cos(fa) * 4.5, SEAM[1]);
      // ember cracks on the upper arm
      drawCracks(L, FG_CRACKS_ARM, (u, v) => [lerp(sh[0], j.ex, 0.3 + (u + 4) * 0.06) + Math.sin(ua) * v * 2, lerp(sh[1], j.ey, 0.3 + (u + 4) * 0.06) - Math.cos(ua) * v * 2], (x, y) => isCoal(L, x, y));
      return j;
    };
    const fist = (L, j, lo) => {
      const fa = Math.atan2(j.hy - j.ey, j.hx - j.ex);
      L.ball(j.hx, j.hy, 4.8 * s, 4.4 * s, COAL, { lo: lo + 1.5, spec: 0.4, rot: fa, rim: 0.4 });
      L.line(j.hx - Math.sin(fa) * 3, j.hy + Math.cos(fa) * 3, j.hx + Math.sin(fa) * 3, j.hy - Math.cos(fa) * 3, SEAM[1]);
      L.px(j.hx + Math.cos(fa) * 2, j.hy + Math.sin(fa) * 2, SEAM[2]);
    };
    const hLt = p.hL && p.gap === 0 ? p.hL : hand2;
    let jL, jR;
    const armR = () => layer(S, L => { jR = arm(L, shR, hand1, p.bR, 0.5); pauldron(L, shR, 1, 0.3); });
    const armL = () => layer(S, L => { jL = arm(L, shL, hLt, p.bL, 0); pauldron(L, shL, -1, 0); });
    if (p.sb > 0.5) {
      if (g[0] < 60) { armL(); armR(); } else { armR(); armL(); }
      layer(S, L => { fist(L, jL, 0); fist(L, jR, 0.5); });
    } else {
      armR(); armL();
      layer(S, L => sword(L));
      layer(S, L => { fist(L, jR, 0.5); if (p.gap) fist(L, jL, 0); });
      if (!p.gap) layer(S, L => fist(L, jL, 0));
    }

    S.outline();

    // ---- emissive layers (no ink outline): hair behind the head, beard,
    // the blade's heat shimmer, embers ----
    const hb = U.rng(7);
    fireHair(S, head[0], head[1] - 7 * s - p.tilt * 2, f, s, p.flare, (x, y) => !S.opaque(x, y), { scalp: head[1] - 4 * s - p.tilt * 2 });
    fireBeard(S, beardAt[0], beardAt[1], f, s, p.flare);
    firelight(S, Math.floor(head[0] - 30), Math.floor(head[1] - 40), Math.ceil(head[0] + 30), Math.ceil(head[1] + 35), 0.45);
    bladeGlow(S, g[0], g[1], p.sa, p.sl, p.sw);
    // drifting embers
    for (let i = 0; i < 7; i++) {
      const ex = 20 + hb() * 80, ey = 4 + ((hb() * 60 - f * 5 + 60) % 60);
      if (!S.opaque(ex, ey)) S.px(ex, ey, i % 3 ? '#e50' : '#fd5');
    }

    if (q.st) {
      const cols = ['#710', '#d40', '#fa2', '#ffb'];
      if (q.dir < 0) swoosh(S, [[22, 3], [8, 28], [6, 62], [16, 90], [34, 110]], 9, cols, { behind: true, side: -1 });
      else if (q.dir > 0) swoosh(S, [[98, 3], [112, 28], [114, 62], [104, 90], [86, 110]], 9, cols, { behind: true, side: 1 });
      else {
        swoosh(S, [[52, 2], [34, 12], [22, 38], [22, 70]], 7, cols, { behind: true, side: -1 });
        swoosh(S, [[68, 2], [86, 12], [98, 38], [98, 70]], 7, cols, { behind: true, side: 1 });
      }
    }
    clearRing(S);
  }

  function fgPortrait(S) {
    crisp(S, 0.5, 1.2);
    S.ball(12, 31, 15, 10, IRON, { lo: 1, hi: 8, spec: 0.5, rim: 0.4 });
    S.ball(0, 24, 6, 5, IRON, { lo: 1, hi: 8, spec: 0.6 });
    S.ball(24, 24, 6, 5, IRON, { lo: 1, hi: 8, spec: 0.6 });
    fgHead(S, 12, 13, { k: 0.85, mo: 0.5 });
    S.outline();
    fireHair(S, 12, 7.5, 1, 0.42, -0.2, (x, y) => !S.opaque(x, y), { scalp: 9.5 });
    fireBeard(S, 12, 20.5, 1, 0.42, -3);
    firelight(S, 0, 0, 23, 23, 0.45);
  }

  EN['Fire Giant'] = { w: 120, h: 120, anchor: [60, 118], center: [60, 62], mouth: [60, 42], draw: drawFireGiant, portrait: fgPortrait };

  // ===============================================================
  // LICH — an ancient sorcerer who cheated death. Floats above the
  // floor inside a violet aura; a flared collar frames a crowned skull
  // with green-violet eyes; ribs show through the parted robe; the staff
  // carries the phylactery. Wind-ups raise the staff to that side while
  // magic gathers around the gem; overhead lifts the staff crosswise
  // above the crown with a soul-fire orb swelling between the hands.
  // st = staff hand (-1 screen-left, 1 screen-right), sg = staff grip
  // (screen), sa = staff angle (deg, grip→gem), fh = free hand target.
  // ===============================================================
  const ROBE = R.arcane;
  const SOUL = ['#021', '#032', '#063', '#2a5', '#5d7', '#9fb', '#dfe', '#fff'];
  const VIO = ['#102', '#203', '#315', '#527', '#73a', '#a6d', '#c9f'];
  const LBONE = ['#111', '#221', '#332', '#554', '#776', '#998', '#bba', '#ddc', '#ffe'];
  const STAFFW = ['#100', '#101', '#211', '#312', '#322', '#433', '#544'];

  const lichKeys = {
    idle: f => {
      const bob = [0, -1, -2, -1][f], sw = [0, 1, 0, -1][f];
      return {
        lean: 0, dx: 0, dy: bob, s: 1, hx: 0, hy: 0, tilt: 0, mo: 0, shut: 0,
        st: 1, sg: [69, 49 + bob], sa: -92, sl: 29, sb: 0.74, fh: [19 + sw * 0.5, 54 + bob], bS: 1, bF: -1,
        glow: 0.35 + (f % 2) * 0.1, orb: 0, gem: 0.5, flare: 0, f, cast: 0,
      };
    },
    // staff hoisted high on the screen-left, gem blazing, body leaning in
    wl: { lean: -0.16, dx: -3, dy: -2, hx: -3, st: -1, sg: [17, 30], sa: -112, sl: 24, sb: 1.1, fh: [62, 40], bS: -1, bF: 1, glow: 1, gem: 1, flare: 0.6, mo: 0.6, cast: -1 },
    wl5: { st: -1, sg: [21, 42], sa: -104, sl: 26, fh: [60, 50], bS: -1, bF: 1, glow: 0.7, gem: 0.8, lean: -0.08, cast: -1 },
    // staff crosswise over the crown, soul-orb swelling between the hands
    wh: { lean: 0, dx: 0, dy: -2, hx: 0, hy: 1, tilt: 0.4, st: 0, sg: [44, 10], sa: 0, sl: 26, sb: 26, fh: [44, 10], bS: 1, bF: -1, glow: 0.9, gem: 0.9, orb: 1, flare: 0.6, mo: 0.6, cast: 0 },
    wh5: { st: 0, sg: [44, 18], sa: 0, sl: 22, sb: 22, fh: [44, 18], dy: 0, orb: 0.55, glow: 0.6, gem: 0.7, cast: 0 },
    // staff hoisted high on the screen-right
    wr: { lean: 0.16, dx: 3, dy: -2, hx: 3, st: 1, sg: [71, 30], sa: -68, sl: 24, sb: 1.1, fh: [26, 40], bS: 1, bF: -1, glow: 1, gem: 1, flare: 0.6, mo: 0.6, cast: 1 },
    wr5: { st: 1, sg: [67, 42], sa: -76, sl: 26, fh: [28, 50], bS: 1, bF: -1, glow: 0.7, gem: 0.8, lean: 0.08, cast: 1 },
    // strikes: the staff stabs toward the viewer, a blast of soul-fire bursts out
    sl: { lean: 0.08, dx: 2, dy: 4, s: 1.06, hx: 2, st: -1, sg: [31, 64], sa: -150, sl: 16, sb: 1.6, fh: [62, 44], bS: -1, bF: 1, glow: 1, gem: 1, flare: 1, mo: 1, cast: -1 },
    sh: { lean: 0, dx: 0, dy: 5, s: 1.07, st: 1, sg: [50, 60], sa: -100, sl: 16, sb: 0.95, fh: [36, 56], bS: 1, bF: -1, glow: 1, gem: 1, orb: 0, flare: 1, mo: 1, cast: 0 },
    sr: { lean: -0.08, dx: -2, dy: 4, s: 1.06, hx: -2, st: 1, sg: [57, 64], sa: -30, sl: 16, sb: 1.6, fh: [26, 44], bS: 1, bF: -1, glow: 1, gem: 1, flare: 1, mo: 1, cast: 1 },
    hurt: { lean: 0.14, dx: 3, dy: -3, s: 0.97, hx: 4, hy: -1, tilt: 1, shut: 1, mo: 1, st: 1, sg: [70, 58], sa: -66, sl: 24, sb: 0.95, fh: [16, 36], bS: 1, bF: -1, glow: 0.15, gem: 0.2, flare: 1, cast: 0 },
  };

  // Phylactery: a faceted soul-gem caged in gold claws.
  function phylactery(S, x, y, k, lit, ang = -90) {
    const c = Math.cos(ang * D2R), s = Math.sin(ang * D2R);
    // claws of the cage
    for (const side of [-1, 1]) {
      const bx = x - c * 4 * k + (-s) * side * 2 * k, by = y - s * 4 * k + c * side * 2 * k;
      S.horn(bx, by, x + (-s) * side * 5 * k - c * 1, y + c * side * 5 * k - s * 1, x + c * 4 * k + (-s) * side * 1.5 * k, y + s * 4 * k + c * side * 1.5 * k, 1.2 * k, 0.4, R.gold, { lo: 2, spec: 0.5 });
    }
    S.ball(x, y, 3.6 * k, 4.4 * k, SOUL, { lo: 1 + lit, rot: (ang + 90) * D2R, spec: 0.9 });
    S.ball(x - 1, y - 1, 1.2 * k, 1.6 * k, SOUL, { tone: 1, lo: 5 });
    S.px(x - 1, y - 1.5, '#fff');
    // front claw over the gem
    S.horn(x - c * 4.5 * k, y - s * 4.5 * k, x - c * 1 * k + s * 1, y - s * 1 * k - c * 1, x + c * 1.5 * k, y + s * 1.5 * k, 1, 0.4, R.gold, { lo: 3, spec: 0.6 });
  }

  // Skull with a gaunt, tall gold crown. (x, y) = skull centre.
  function lichSkull(S, x, y, o = {}) {
    const k = o.k || 1, tl = o.tilt || 0, shut = o.shut, mo = o.mo || 0, eg = o.eye !== undefined ? o.eye : 1;
    const ty = y - tl * 1.5 * k;
    // cranium + cheekbones + narrow jaw
    S.ball(x, ty - 1 * k, 7.2 * k, 7.4 * k, LBONE, { lo: 2, spec: 0.35, rim: 0.3 });
    S.ball(x - 4 * k, ty + 2.5 * k, 2.8 * k, 2.2 * k, LBONE, { lo: 3, spec: 0.4 });
    S.ball(x + 4 * k, ty + 2.5 * k, 2.8 * k, 2.2 * k, LBONE, { lo: 2, hi: 7 });
    const jy = ty + 6 * k + mo * 2.5 * k;
    S.ball(x, jy, 4.6 * k, 2.6 * k, LBONE, { lo: 2, hi: 7, spec: 0.2 });
    // temples hollowed
    S.px(x - 6 * k, ty + 1 * k, LBONE[2]); S.px(x + 6 * k, ty + 1 * k, LBONE[1]);
    // nasal cavity
    S.tri([x - 1.2, ty + 2.6 * k], [x + 1.2, ty + 2.6 * k], [x, ty + 0.4 * k], '#000', { tone: 0 });
    S.set(Math.round(x - 1), Math.round(ty + 2.6 * k), '#101'); S.set(Math.round(x), Math.round(ty + 2.6 * k), '#101');
    // teeth: upper row on the skull, lower on the jaw
    const uy = Math.round(ty + 4.5 * k);
    for (let i = -2; i <= 2; i++) { S.px(x + i, uy, i % 2 ? LBONE[6] : LBONE[8]); S.px(x + i, uy + 1, '#111'); }
    if (mo > 0.2) {
      S.rect(Math.round(x - 2), uy + 1, 5, Math.max(1, Math.round(mo * 2.5 * k)), '#000');
      const ly = Math.round(jy - 1.5 * k);
      for (let i = -2; i <= 2; i++) S.px(x + i, ly, i % 2 ? LBONE[5] : LBONE[7]);
    } else for (let i = -2; i <= 2; i++) S.px(x + i, uy + 2, i % 2 ? LBONE[5] : LBONE[7]);
    // deep sockets, a soul-light burning in each
    const sock = (ex, side) => {
      S.ball(ex, ty - 0.2 * k, 2.4 * k, 2.1 * k, '#000', { tone: 0 });
      S.px(ex - side * 2, ty - 1.8 * k, LBONE[3]);
      if (shut) { S.px(ex, ty, '#315'); S.px(ex + side, ty, '#203'); return; }
      if (eg > 0.5) { S.px(ex - 1, ty, '#5d7'); S.px(ex + 1, ty, '#2a5'); S.px(ex, ty - 1, '#a6d'); S.px(ex, ty + 1, '#73a'); }
      S.px(ex, ty, eg > 0.5 ? '#efe' : '#5d7');
    };
    sock(x - 3 * k, -1); sock(x + 3 * k, 1);
    // brow ridge & cracks
    S.line(x - 5 * k, ty - 2.8 * k, x - 1.5 * k, ty - 2 * k, LBONE[4]);
    S.line(x + 1.5 * k, ty - 2 * k, x + 5 * k, ty - 2.8 * k, LBONE[3]);
    S.line(x + 2 * k, ty - 7 * k, x + 3 * k, ty - 5 * k, LBONE[3]); S.px(x + 4 * k, ty - 4.5 * k, LBONE[3]);
    // crown: a thin band with tall gaunt spikes, gems at the base
    const cy = ty - 5.5 * k;
    S.capsule(x - 7 * k, cy + 0.6 * k, x + 7 * k, cy + 0.6 * k, 1.5 * k, 1.5 * k, R.gold, { lo: 2, spec: 0.6 });
    const spikes = [[-6.5, 5, -1], [-3.4, 8.5, -0.5], [0, 12, 0], [3.4, 8.5, 0.5], [6.5, 5, 1]];
    spikes.forEach(([sx, h, lean], i) => {
      const bx = x + sx * k, by = cy;
      S.poly([[bx - 1.3 * k, by], [bx + 1.3 * k, by], [bx + lean * 1.5 * k, by - h * k]], R.gold, { grad: [bx - 1.5, by, bx + 1.5, by, 0.85, 0.35] });
      S.px(bx + lean * 1.5 * k, by - h * k, R.gold[7]);
      // a hooked barb half-way up
      if (i !== 2) S.px(bx + lean * 0.8 * k - Math.sign(lean || 1) * 1, by - h * 0.55 * k, R.gold[4]);
    });
    S.px(x, cy - 3 * k, '#a6d'); S.px(x, cy - 2 * k, '#73a');
    for (const gx of [-5, 5]) S.px(x + gx * k, cy + 0.5 * k, '#5d7');
    S.px(x, cy + 0.5 * k, '#c9f');
  }

  // Skeletal hand: palm bones + splayed finger bones. ang = direction the fingers point.
  function boneHand(S, x, y, ang, k, splay = 1, lo = 0) {
    const c = Math.cos(ang * D2R), s = Math.sin(ang * D2R), nx = -s, ny = c;
    S.ball(x, y, 2.4 * k, 2.1 * k, LBONE, { lo: 2 + lo, spec: 0.3 });
    for (let i = -1.5; i <= 1.5; i++) {
      const bx = x + c * 1.8 * k + nx * i * 1.3 * k, by = y + s * 1.8 * k + ny * i * 1.3 * k;
      const a2 = (ang + i * 14 * splay) * D2R;
      const L = (4.4 - Math.abs(i) * 0.6) * k;
      const mx = bx + Math.cos(a2) * L * 0.55, my = by + Math.sin(a2) * L * 0.55;
      const ex = bx + Math.cos(a2 + 0.35) * L, ey = by + Math.sin(a2 + 0.35) * L;
      S.line(bx, by, mx, my, LBONE[6 - Math.round(lo)]);
      S.line(mx, my, ex, ey, LBONE[5 - Math.round(lo)]);
    }
    // thumb
    const ta = (ang - 70) * D2R;
    S.line(x + nx * -1.6 * k, y + ny * -1.6 * k, x + nx * -1.6 * k + Math.cos(ta) * 3 * k, y + ny * -1.6 * k + Math.sin(ta) * 3 * k, LBONE[6 - Math.round(lo)]);
  }

  // Curling wisps of soul-smoke (emissive, painted on empty pixels).
  function wisps(S, cx, cy, f, n, rad, cols, seed) {
    const r = U.rng(seed);
    for (let i = 0; i < n; i++) {
      const a0 = r() * Math.PI * 2 + f * 0.5, len = 10 + r() * 10, rr = rad * (0.7 + r() * 0.5);
      const yk = 0.35 + r() * 0.25;
      for (let t = 0; t < len; t++) {
        const a = a0 + t * 0.12;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * yk - t * 0.25;
        if (S.opaque(x, y) || x < 1 || y < 1 || x > S.w - 2 || y > S.h - 2) continue;
        const v = (t / len);
        if (v < 0.2 && P.thresh(x, y) > v * 5) continue;
        S.set(x, y, cols[Math.min(cols.length - 1, Math.floor((1 - Math.abs(v - 0.6)) * cols.length))]);
      }
    }
  }

  function drawLich(S, pose) {
    crisp(S, 0.5, 1.15);
    const q = decode(pose);
    const p = resolve(lichKeys, q);
    const T = mkT(Object.assign({}, p, { dy: (p.dy || 0) - 3 }), 44, 86, 70), W = wrap(S, T), s = T.s;
    const f = q.idle ? q.f : (q.st ? 2 : q.hu ? 3 : 1);

    const head = T.P(44 + p.hx, 26 + p.hy);
    const shL = T.P(33, 39), shR = T.P(55, 39);

    // ---- staff geometry ----
    const ca = Math.cos(p.sa * D2R), sa = Math.sin(p.sa * D2R);
    const sg = p.sg;
    let gemAt, staffBot, staffTop;
    if (p.st === 0) {
      // crosswise overhead: sg = centre, sl = half length to the gem end (screen-right), sb = half length to the butt
      gemAt = [sg[0] + p.sl, sg[1] - 1];
      staffTop = gemAt;
      staffBot = [sg[0] - p.sb, sg[1] + 1];
    } else {
      gemAt = [sg[0] + ca * p.sl, sg[1] + sa * p.sl];
      staffTop = gemAt;
      staffBot = [sg[0] - ca * p.sl * 1.9 * p.sb, sg[1] - sa * p.sl * 1.9 * p.sb];
    }
    const staff = L => {
      L.capsule(staffBot[0], staffBot[1], staffTop[0], staffTop[1], 1.5, 1.4, STAFFW, { lo: 1, spec: 0.4 });
      // gold bands + a bone finial at the butt
      for (const t of [0.12, 0.55, 0.88]) {
        const bx = lerp(staffBot[0], staffTop[0], t), by = lerp(staffBot[1], staffTop[1], t);
        L.ball(bx, by, 1.9, 1.9, R.gold, { lo: 2, spec: 0.6 });
      }
      L.ball(staffBot[0], staffBot[1], 1.8, 1.8, LBONE, { lo: 2, spec: 0.4 });
      const ang = Math.atan2(staffTop[1] - staffBot[1], staffTop[0] - staffBot[0]) / D2R;
      phylactery(L, gemAt[0], gemAt[1], 1.05, p.gem, ang);
    };


    // ---- the high collar, flared behind the skull ----
    const collar = (side) => {
      const bx = 44 + side * 8;
      W.poly([[bx, 40], [44 + side * 22, 12 - p.flare * 2], [44 + side * 19, 20], [44 + side * 16, 30], [44 + side * 12, 36]], ROBE,
        { grad: [44 + side * 10, 38, 44 + side * 22, 14, side < 0 ? 0.55 : 0.4, side < 0 ? 0.2 : 0.12] });
      // inner face ribs
      W.line(bx, 38, 44 + side * 20, 15, ROBE[side < 0 ? 5 : 4]);
      W.line(bx + side * 2, 38, 44 + side * 17, 24, ROBE[3]);
      // gold edging
      W.line(44 + side * 22, 12 - p.flare * 2, 44 + side * 19, 20, R.gold[5]);
      W.line(44 + side * 19, 20, 44 + side * 16, 30, R.gold[4]);
      W.line(44 + side * 16, 30, 44 + side * 12, 36, R.gold[4]);
    };
    collar(-1); collar(1);

    // staff behind when hoisted overhead crosswise
    if (p.st === 0) staff(S);

    // ---- robe: narrow shoulders flowing into a tattered, floating hem ----
    const hemY = 80;
    const hem = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, x = lerp(21, 67, t);
      const wav = Math.sin(t * 9 + f * 1.4) * 1.2 + (i % 2 ? 2.5 : 0) + (i % 3 === 0 ? 1.5 : 0);
      hem.push([x - p.flare * (t - 0.5) * 8, hemY + wav + p.flare * 1.5]);
    }
    W.poly([[37, 35], [51, 35], [56, 38], [59, 52], [65, 70]].concat(hem.slice().reverse().map(([x, y]) => [x, y])).concat([[23, 70], [29, 52], [32, 38]]), ROBE,
      { grad: [26, 40, 64, 84, 0.55, 0.08] });
    // ghostly tatters trailing below the hem, thinning to nothing
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.5) / 9, x0 = lerp(24, 64, t) - p.flare * (t - 0.5) * 8;
      const L = 7 + ((i * 7) % 5) + Math.sin(f * 1.57 + i) * 1.5, wv = (i % 2 ? 1 : -1);
      for (let y = 0; y < L; y++) {
        const yy = hemY + 1 + y, xx = T.X(x0 + Math.sin((y + f + i) * 0.7) * 1.2 * wv, yy);
        const wdt = 2.2 * (1 - y / L);
        for (let dx = -wdt; dx <= wdt; dx++) {
          const px = Math.round(xx + dx);
          if (y / L > 0.45 && P.thresh(px, yy) < (y / L - 0.45) * 1.8) continue;
          S.set(px, yy, ROBE[dx < 0 ? 2 : 1]);
        }
      }
    }
    // folds
    for (const [x0, x1, d] of [[38, 30, -2], [44, 42, -1], [50, 58, -2], [41, 36, 1], [53, 61, -1]]) crease(S, ROBE, T.X(x0, 52), T.Y(x0, 52), x1, 79, d);
    // gold trim down the front opening and along the hem
    for (let y = 37; y < 79; y++) {
      const t = (y - 37) / 42, wx = 4 + t * 5;
      W.px(44 - wx, y, R.gold[y % 4 ? 5 : 7]); W.px(44 + wx, y, R.gold[y % 4 ? 4 : 6]);
    }
    for (let i = 0; i < hem.length - 1; i++) {
      const [ax, ay] = hem[i], [bx, by] = hem[i + 1];
      S.line(T.X(ax, ay - 2), ay - 2, T.X(bx, by - 2), by - 2, R.gold[i % 2 ? 4 : 5]);
    }
    // inner robe (darker) inside the opening
    W.poly([[40.5, 54], [47.5, 54], [52, 79], [36, 79]], ROBE, { grad: [40, 54, 50, 79, 0.36, 0.1] });
    // exposed ribcage, a sick green soul-light inside
    W.poly([[38, 37], [50, 37], [48, 54], [40, 54]], ['#000', '#101', '#102', '#203'], { grad: [44, 37, 44, 54, 0.7, 0.2] });
    W.ball(44, 46, 3.5, 4, SOUL, { tone: 0.25 + p.glow * 0.1 });
    for (let i = 0; i < 5; i++) {
      const y = 39 + i * 3, w = 5 - i * 0.4;
      W.line(44 - w, y + 1, 43, y, LBONE[6 - (i > 2 ? 1 : 0)]);
      W.line(45, y, 44 + w, y + 1, LBONE[5 - (i > 2 ? 1 : 0)]);
    }
    for (let y = 38; y < 54; y++) W.px(44, y, y % 2 ? LBONE[7] : LBONE[5]);       // spine/sternum
    // sash with a gold clasp
    W.poly([[33, 54], [55, 54], [55, 57], [33, 57]], ROBE, { grad: [44, 54, 44, 57, 0.75, 0.4] });
    W.ball(44, 55.5, 2.4, 2.2, R.gold, { lo: 2, spec: 0.6 });
    W.px(44, 55, '#5d7');

    // ---- mantle: two shoulder caps with scalloped gold hems, parted at the ribs ----
    for (const side of [-1, 1]) {
      const pts = [[44 + side * 5, 34], [44 + side * 9, 34]];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, a = side < 0 ? Math.PI * (1 - t * 0.5) : Math.PI * (0.5 - t * 0.5);
        pts.push([44 + side * 3 + Math.cos(a) * 14 * (side < 0 ? 1 : 1), 41 + Math.sin(a) * 6 + (i % 2 ? 1.5 : 0)]);
      }
      const ord = side < 0 ? pts : pts;
      W.poly(ord, ROBE, { grad: [44 + side * 16, 34, 44 + side * 6, 48, side < 0 ? 0.75 : 0.5, 0.25] });
      for (let i = 2; i < pts.length - 1; i++) W.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], R.gold[i % 2 ? 4 : 6]);
      W.line(44 + side * 5, 34, pts[pts.length - 1][0], pts[pts.length - 1][1], R.gold[side < 0 ? 6 : 4]);
    }
    W.ball(44, 36, 2, 1.8, R.gold, { lo: 2, spec: 0.6 });
    W.px(44, 36, '#a6d');

    // ---- arms: bell sleeves, skeletal hands ----
    const holdR = p.st === 1, holdL = p.st === -1;
    const tR = p.st === 0 ? [sg[0] + 17, sg[1] + 1] : holdR ? sg : p.fh;
    const tL = p.st === 0 ? [sg[0] - 17, sg[1] + 1] : holdL ? sg : p.fh;
    const sleeve = (L, sh, hand, bend, lo, grip) => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], 15 * s, 14 * s, bend);
      const fa = Math.atan2(j.hy - j.ey, j.hx - j.ex);
      L.capsule(sh[0], sh[1] + 1, j.ex, j.ey, 3.4 * s, 3 * s, ROBE, { lo: lo + 1, hi: 6.5, rim: 0.3 });
      // bell sleeve flaring toward the wrist (hangs down under gravity)
      const wx = lerp(j.ex, j.hx, 0.82), wy = lerp(j.ey, j.hy, 0.82);
      const nx = -Math.sin(fa), ny = Math.cos(fa);
      const hang = 3.5;
      L.poly([[j.ex + nx * 3, j.ey + ny * 3], [j.ex - nx * 3, j.ey - ny * 3], [wx - nx * 5.5, wy - ny * 5.5 + hang], [wx + nx * 5.5, wy + ny * 5.5 + hang]], ROBE,
        { grad: [j.ex - nx * 3, j.ey - ny * 3, wx + nx * 5.5, wy + ny * 5.5, 0.55 - lo * 0.1, 0.12] });
      L.line(wx - nx * 5.5, wy - ny * 5.5 + hang, wx + nx * 5.5, wy + ny * 5.5 + hang, R.gold[5]);
      // bony wrist + hand
      L.line(wx, wy, j.hx, j.hy, LBONE[5]);
      const ha = grip ? fa + (bend > 0 ? -60 : 60) * D2R : fa;
      boneHand(L, j.hx, j.hy, ha / D2R, 1, grip ? 0.4 : 1.3, lo);
      return j;
    };

    // ---- skull + crown (in front of collar, behind raised staff) ----
    layer(S, L => lichSkull(L, head[0], head[1], { k: s, mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt, eye: q.hu ? 0 : 1 }), { k: 0.5, kl: 0.2 });

    if (p.st === 0) {
      layer(S, L => sleeve(L, shR, tR, 1, 0.5, true));
      layer(S, L => sleeve(L, shL, tL, -1, 0, true));
    } else {
      const drawStaffArm = () => layer(S, L => { sleeve(L, holdR ? shR : shL, sg, p.bS, holdR ? 0.5 : 0, true); });
      const drawFreeArm = () => layer(S, L => { sleeve(L, holdR ? shL : shR, p.fh, p.bF, holdR ? 0 : 0.5, false); });
      layer(S, L => staff(L));
      drawStaffArm();
      drawFreeArm();
    }

    S.outline();
    halo(S, ['#315', '#527', '#73a', '#a6d'], 4, 0.85 + p.glow * 0.25 - (q.hu ? 0.35 : 0));

    // ---- emissive: gem glow, gathering magic, wisps, blast ----
    const gk = p.gem;
    aura(S, gemAt[0], gemAt[1], 5 + gk * 6, 5 + gk * 6, ['#032', '#063', '#2a5', '#5d7'], { k: 0.4 + gk * 0.6 });
    if (p.cast && !q.st) {
      // motes spiralling into the gem
      const r = U.rng(5 + p.cast);
      for (let i = 0; i < 10 * gk; i++) {
        const a = r() * Math.PI * 2, d = 7 + r() * 9;
        const x = gemAt[0] + Math.cos(a) * d, y = gemAt[1] + Math.sin(a) * d;
        if (!S.opaque(x, y)) { S.px(x, y, i % 3 ? '#a6d' : '#9fb'); if (i % 2 && !S.opaque(x - Math.cos(a), y - Math.sin(a))) S.px(x - Math.cos(a), y - Math.sin(a), '#527'); }
      }
    }
    if (p.orb > 0) {
      const ox = sg[0], oy = sg[1] - 1 - p.orb * 1;
      aura(S, ox, oy, 6 + p.orb * 5, 6 + p.orb * 5, ['#315', '#527', '#a6d', '#c9f'], { k: 0.9 });
      S.ball(ox, oy, 2.5 + p.orb * 1.5, 2.5 + p.orb * 1.5, SOUL, { tone: 0.95, lo: 3 });
      S.px(ox - 1, oy - 1, '#fff');
    }
    // soul wisps curling around the hem and down to the floor
    wisps(S, T.X(44, 80), T.Y(44, 80) + 4, f, 6, 22, ['#315', '#527', '#73a', '#5d7'], 17);

    if (q.st) {
      // a blast of soul-fire erupting from the gem toward the viewer
      const bx = gemAt[0], by = gemAt[1];
      aura(S, bx, by, 15, 15, ['#203', '#527', '#a6d', '#5d7', '#9fb'], { k: 1, over: true, only: (x, y) => !S.opaque(x, y) || Math.hypot(x - bx, y - by) < 7 });
      S.ball(bx, by, 4, 4, SOUL, { tone: 1, lo: 5 });
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2 + 0.3, r0 = 6, r1 = 13 + (i % 3) * 3;
        S.line(bx + Math.cos(a) * r0, by + Math.sin(a) * r0, bx + Math.cos(a) * r1, by + Math.sin(a) * r1, i % 2 ? '#9fb' : '#c9f');
      }
      const cols = ['#315', '#527', '#a6d', '#dbf'];
      if (q.dir < 0) swoosh(S, [[16, 2], [5, 22], [5, 46], [14, 66], [24, 80]], 6, cols, { behind: true, side: -1 });
      else if (q.dir > 0) swoosh(S, [[72, 2], [83, 22], [83, 46], [74, 66], [64, 80]], 6, cols, { behind: true, side: 1 });
      else {
        swoosh(S, [[36, 2], [22, 10], [14, 30], [14, 54]], 5, cols, { behind: true, side: -1 });
        swoosh(S, [[52, 2], [66, 10], [74, 30], [74, 54]], 5, cols, { behind: true, side: 1 });
      }
    }
    clearRing(S);
  }

  function lichPortrait(S) {
    crisp(S, 0.5, 1.15);
    for (const side of [-1, 1]) S.poly([[12 + side * 4, 24], [12 + side * 13, 1], [12 + side * 11, 12], [12 + side * 8, 20]], ROBE, { grad: [12, 24, 12 + side * 12, 2, 0.5, 0.15] });
    S.poly([[1, 24], [23, 24], [20, 19], [4, 19]], ROBE, { grad: [4, 19, 20, 24, 0.5, 0.1] });
    S.line(8, 19, 10, 24, R.gold[5]); S.line(16, 19, 14, 24, R.gold[4]);
    lichSkull(S, 12, 14, { k: 1.05 });
    S.outline();
    halo(S, ['#315', '#527'], 2, 0.6);
  }

  EN['Lich'] = { w: 88, h: 96, anchor: [44, 94], center: [44, 44], mouth: [44, 29], draw: drawLich, portrait: lichPortrait };

  // ---------------------------------------------------------------
  // Bat/dragon wing: an arm bone (root → elbow → wrist) carrying long
  // finger bones; membrane panels hang between the finger tips with a
  // scalloped trailing edge, dark at the bones and lighter (thinner,
  // translucent) toward the scallops; the last panel joins the body.
  // o: { root, elbow, wrist, tips:[[x,y]...], body:[x,y], memb, bone,
  //      lo (darker for the far wing), scallop (depth 0..1), claw }
  // ---------------------------------------------------------------
  function batWing(S, o) {
    const { root, elbow, wrist, tips, body } = o;
    const memb = o.memb, bone = o.bone, lo = o.lo || 0, sc = o.scallop !== undefined ? o.scallop : 0.22;
    const edge = (a, b, n = 8) => {
      // scalloped trailing edge from a to b, bowing toward the wrist
      const pts = [];
      for (let i = 1; i < n; i++) {
        const t = i / n, x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t);
        const d = Math.sin(Math.PI * t) * sc;
        pts.push([lerp(x, wrist[0], d), lerp(y, wrist[1], d)]);
      }
      return pts;
    };
    const panels = [];
    for (let i = 0; i < tips.length - 1; i++) panels.push([wrist, tips[i]].concat(edge(tips[i], tips[i + 1])).concat([tips[i + 1]]));
    panels.push([wrist, tips[tips.length - 1]].concat(edge(tips[tips.length - 1], body, 10)).concat([body, root, elbow]));
    panels.forEach((pg, i) => {
      const last = i === panels.length - 1;
      const mid = last ? [lerp(tips[tips.length - 1][0], body[0], 0.5), lerp(tips[tips.length - 1][1], body[1], 0.5)] : [lerp(tips[i][0], tips[i + 1][0], 0.5), lerp(tips[i][1], tips[i + 1][1], 0.5)];
      const t0 = 0.2 - lo * 0.08, t1 = (o.light !== undefined ? o.light : 0.62) - lo * 0.12 - i * 0.03;
      S.poly(pg, memb, { grad: [wrist[0], wrist[1], mid[0], mid[1], t0, t1] });
    });
    // veins fanning into each panel from the wrist
    if (o.veins !== false) {
      for (let i = 0; i < tips.length - 1; i++) {
        const mx = lerp(tips[i][0], tips[i + 1][0], 0.5), my = lerp(tips[i][1], tips[i + 1][1], 0.5);
        crease(S, memb, lerp(wrist[0], mx, 0.15), lerp(wrist[1], my, 0.15), lerp(wrist[0], mx, 0.7), lerp(wrist[1], my, 0.7), -1);
      }
    }
    // finger bones
    tips.forEach((t, i) => {
      const kx = lerp(wrist[0], t[0], 0.45) + (o.knuckle ? o.knuckle[0] : 0), ky = lerp(wrist[1], t[1], 0.45) + (o.knuckle ? o.knuckle[1] : 0);
      S.horn(wrist[0], wrist[1], kx, ky, t[0], t[1], (o.fw || 1.4), 0.5, bone, { lo: lo + 1, hi: (o.boneHi || 7) - lo, spec: 0.3 });
    });
    // arm: humerus + forearm, a hooked thumb-claw at the wrist
    S.capsule(root[0], root[1], elbow[0], elbow[1], o.aw || 3, (o.aw || 3) * 0.8, bone, { lo: lo + 1, hi: (o.boneHi || 7.5) - lo, spec: 0.3, rim: 0.3 });
    S.capsule(elbow[0], elbow[1], wrist[0], wrist[1], (o.aw || 3) * 0.75, (o.aw || 3) * 0.6, bone, { lo: lo + 1, hi: (o.boneHi || 7.5) - lo, spec: 0.35, rim: 0.3 });
    S.ball(wrist[0], wrist[1], (o.aw || 3) * 0.8, (o.aw || 3) * 0.8, bone, { lo: lo + 1.5, hi: (o.boneHi || 8) - lo, spec: 0.4 });
    if (o.claw) {
      const dx = wrist[0] - elbow[0], dy = wrist[1] - elbow[1], d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      const cx = wrist[0] + ux * 4, cy = wrist[1] + uy * 4;
      S.horn(wrist[0], wrist[1], cx - uy * 2 * o.claw, cy + ux * 2 * o.claw, cx + ux * 2 + uy * 1.5 * o.claw, cy + uy * 2 - ux * 1.5 * o.claw, 1.3, 0.3, o.clawRamp || LBONE, { lo: 2, hi: 7, spec: 0.5 });
    }
  }

  // ===============================================================
  // DEMON — summoned from the abyss, it exists only to destroy. Crimson
  // hide over slabs of muscle, ram horns, bat wings spread wide, burning
  // yellow eyes over a fanged maw, goat legs on cloven hooves, a spade
  // tail and the broken chains of its summoning still on its wrists.
  // hL / hR: claw targets; wl / wr: wing lift (0..1); roar: mouth open.
  // ===============================================================
  const DSKIN = ['#000', '#100', '#201', '#301', '#401', '#602', '#812', '#a22', '#c33', '#e54'];
  const DWING = ['#000', '#101', '#102', '#202', '#203', '#303', '#413', '#423', '#534'];
  const DHORN = ['#000', '#100', '#110', '#211', '#321', '#432', '#543', '#765', '#987'];
  const DFUR = ['#000', '#100', '#200', '#300', '#310', '#411', '#521', '#632', '#743'];
  const HOOF = ['#000', '#101', '#111', '#212', '#323', '#434', '#556'];
  const MAW = ['#100', '#300', '#610', '#a20', '#e50', '#fa2', '#fd6'];

  const demonKeys = {
    idle: f => {
      const br = [0, 1, 2, 1][f], sw = [0, 1, 0, -1][f];
      return {
        lean: 0, dx: 0, dy: 0, s: 1 + br * 0.008, hx: 0, hy: br * 0.3, tilt: 0, roar: 0.25 + br * 0.08, shut: 0,
        hL: [25 - sw * 0.5, 82 - br * 0.4], hR: [95 + sw * 0.5, 82 - br * 0.4], bL: -1, bR: 1, spL: 0.6, spR: 0.6,
        wl: br * 0.25, wr: br * 0.25, tail: sw, f,
      };
    },
    // screen-left claw raised high, body twisting into it, left wing flared
    wl: { lean: -0.2, dx: -3, dy: -2, hx: -4, roar: 0.8, hL: [15, 14], hR: [84, 66], bL: 1, bR: 1, spL: 1.3, spR: 0.4, wl: 1.6, wr: -0.4, tail: -2 },
    wl5: { hL: [20, 40], hR: [90, 74], bL: 1, spL: 1, wl: 0.9, lean: -0.1, roar: 0.6 },
    // both claws high over the horns, wings flared up, roaring
    wh: { lean: 0, dx: 0, dy: -3, hx: 0, hy: 1, tilt: 0.5, roar: 1, hL: [32, 13], hR: [88, 13], bL: 1, bR: -1, spL: 1.3, spR: 1.3, wl: 1.6, wr: 1.6, tail: 0 },
    wh5: { hL: [32, 30], hR: [88, 30], bL: 1, bR: -1, spL: 1, spR: 1, wl: 0.9, wr: 0.9, roar: 0.7, dy: 1 },
    // screen-right claw raised high
    wr: { lean: 0.2, dx: 3, dy: -2, hx: 4, roar: 0.8, hL: [36, 66], hR: [105, 14], bL: -1, bR: -1, spL: 0.4, spR: 1.3, wl: -0.4, wr: 1.6, tail: 2 },
    wr5: { hL: [30, 74], hR: [100, 40], bR: -1, spR: 1, wr: 0.9, lean: 0.1, roar: 0.6 },
    // strikes: talons rake down toward the viewer
    sl: { lean: 0.1, dx: 2, dy: 5, s: 1.06, hx: 3, hy: 2, roar: 1, hL: [56, 92], hR: [92, 64], bL: 1, bR: 1, spL: 1.4, spR: 0.5, wl: 0.4, wr: 0.2, tail: 2 },
    sh: { lean: 0, dx: 0, dy: 7, s: 1.07, hy: 3, roar: 1, hL: [44, 94], hR: [76, 94], bL: 1, bR: -1, spL: 1.4, spR: 1.4, wl: 0.3, wr: 0.3, tail: 0 },
    sr: { lean: -0.1, dx: -2, dy: 5, s: 1.06, hx: -3, hy: 2, roar: 1, hL: [28, 64], hR: [64, 92], bL: -1, bR: -1, spL: 0.5, spR: 1.4, wl: 0.2, wr: 0.4, tail: -2 },
    hurt: { lean: 0.14, dx: 3, dy: -2, s: 0.98, hx: 5, hy: -1, tilt: 1, roar: 1, shut: 1, hL: [12, 52], hR: [104, 70], bL: 1, bR: 1, spL: 1.2, spR: 1, wl: 1.2, wr: 0.6, tail: 3 },
  };

  const D_SPOTS = spotList(41, 34, 42, 46, 36, 32, 0.7, 0.8);

  // A ram horn: rises, sweeps back and curls down and forward around the ear.
  function ramHorn(S, x, y, side, k, lo) {
    const sx = side;
    // rises off the brow, sweeps back and out, curls down past the ear and
    // flares its tip outward
    const pts = [[0, 0], [2.5, -7], [9, -11], [16, -10], [20, -4], [19, 3], [15, 6], [16, 10], [22, 9]];
    const rads = [4.6, 4.4, 4.1, 3.7, 3.2, 2.7, 2.1, 1.5, 0.6];
    const P2 = pts.map(([a, b]) => [x + sx * a * k, y + b * k]);
    for (let i = 0; i < P2.length - 1; i++) {
      S.capsule(P2[i][0], P2[i][1], P2[i + 1][0], P2[i + 1][1], rads[i] * k, rads[i + 1] * k, DHORN, { lo: lo + 1, hi: 8, spec: 0.4, rim: 0.3 });
    }
    // growth ridges across the horn
    for (let i = 0; i < P2.length - 2; i++) {
      for (let t = 0.25; t < 1; t += 0.5) {
        const cx = lerp(P2[i][0], P2[i + 1][0], t), cy = lerp(P2[i][1], P2[i + 1][1], t);
        const dx = P2[i + 1][0] - P2[i][0], dy = P2[i + 1][1] - P2[i][1], d = Math.hypot(dx, dy) || 1;
        const r = lerp(rads[i], rads[i + 1], t) * k * 0.9;
        crease(S, DHORN, cx - dy / d * r, cy + dx / d * r, cx + dy / d * r, cy - dx / d * r, -2);
      }
    }
    S.px(P2[P2.length - 1][0], P2[P2.length - 1][1], DHORN[8]);
  }

  function demonHead(S, x, y, o = {}) {
    const k = o.k || 1, tl = o.tilt || 0, roar = o.roar || 0, shut = o.shut;
    const ty = y - tl * 2 * k;
    const sk = DSKIN;
    // pointed ears behind the horns
    S.tri([x - 7 * k, ty - 1 * k], [x - 14 * k, ty - 4 * k], [x - 7 * k, ty + 3 * k], sk, { tone: 0.45 });
    S.tri([x + 7 * k, ty - 1 * k], [x + 14 * k, ty - 4 * k], [x + 7 * k, ty + 3 * k], sk, { tone: 0.3 });
    // skull: broad cranium, heavy jaw
    S.ball(x, ty - 1 * k, 8 * k, 8 * k, sk, { lo: 1, spec: 0.2, rim: 0.35 });
    const jy = ty + 6 * k + roar * 3 * k;
    // open maw: furnace-glow throat between the jaws
    if (roar > 0.15) S.poly([[x - 5 * k, ty + 3.5 * k], [x + 5 * k, ty + 3.5 * k], [x + 4 * k, jy + 1 * k], [x - 4 * k, jy + 1 * k]], MAW, { grad: [x, ty + 3 * k, x, jy + 2 * k, 0.15, 0.75] });
    S.ball(x, jy + 1.5 * k, 6 * k, 3 * k, sk, { lo: 1, hi: 8, spec: 0.15 });                // lower jaw
    // fangs: long upper canines, lower tusks
    for (const sd of [-1, 1]) {
      S.tri([x + sd * 3.6 * k - 0.8, ty + 3.6 * k], [x + sd * 3.6 * k + 0.8, ty + 3.6 * k], [x + sd * 3.4 * k, ty + 3.6 * k + (2.5 + roar * 2) * k], LBONE, { tone: 0.85 });
      S.tri([x + sd * 4.6 * k - 0.8, jy + 0.5], [x + sd * 4.6 * k + 0.8, jy + 0.5], [x + sd * 5 * k, jy - 2.5 * k], LBONE, { tone: 0.75 });
    }
    for (let i = -2; i <= 2; i++) S.px(x + i * 1.3 * k, ty + 3.8 * k, LBONE[7]);
    // muzzle & broad nose, nostrils
    S.ball(x, ty + 2 * k, 4 * k, 2.4 * k, sk, { lo: 2, spec: 0.3 });
    S.px(x - 1.5, ty + 2.5 * k, sk[1]); S.px(x + 1.5, ty + 2.5 * k, sk[1]);
    // brow: heavy V scowl
    S.ball(x - 3.5 * k, ty - 3 * k, 4 * k, 2 * k, sk, { lo: 2, spec: 0.4, rot: 0.35 });
    S.ball(x + 3.5 * k, ty - 3 * k, 4 * k, 2 * k, sk, { lo: 2, hi: 8.5, rot: -0.35 });
    S.line(x - 7 * k, ty - 4.5 * k, x - 1 * k, ty - 1.5 * k, sk[2]);
    S.line(x + 1 * k, ty - 1.5 * k, x + 7 * k, ty - 4.5 * k, sk[2]);
    S.line(x, ty - 6 * k, x, ty - 3 * k, sk[3]);
    // burning eyes under the brow
    const eye = (ex, side) => {
      ex = Math.round(ex); const ey = Math.round(ty - 1 * k);
      if (shut) { S.rect(ex - 1, ey, 3, 1, sk[1]); S.px(ex - side, ey - 1, sk[1]); return; }
      S.rect(ex - 1, ey, 3, 1, '#fd4'); S.px(ex + (side < 0 ? 0 : 0), ey, '#ffe'); S.px(ex + side, ey, '#f92');
      S.px(ex - side, ey - 1, '#a40');
    };
    eye(x - 3.4 * k, -1); eye(x + 3.4 * k, 1);
  }

  // Clawed hand: a heavy palm with long hooked talons; sp = splay.
  function demonClaw(S, x, y, ang, k, sp, lo) {
    const c = Math.cos(ang), s = Math.sin(ang), nx = -s, ny = c;
    S.ball(x, y, 4.4 * k, 3.8 * k, DSKIN, { lo: lo + 1.5, spec: 0.25, rot: ang, rim: 0.3 });
    for (let i = -1.5; i <= 1.5; i++) {
      const a = ang + i * 0.32 * sp;
      const bx = x + c * 3 * k + nx * i * 2 * k, by = y + s * 3 * k + ny * i * 2 * k;
      const mx = bx + Math.cos(a) * 3.5 * k, my = by + Math.sin(a) * 3.5 * k;
      S.capsule(bx, by, mx, my, 1.4 * k, 1.1 * k, DSKIN, { lo: lo + 1.5, hi: 8.5, spec: 0.2 });
      const ca = a + 0.5 * Math.sign(i || 1) * -0.3;
      S.horn(mx, my, mx + Math.cos(a) * 2.5 * k, my + Math.sin(a) * 2.5 * k, mx + Math.cos(ca + 0.6) * 4.5 * k, my + Math.sin(ca + 0.6) * 4.5 * k, 1.1 * k, 0.3, DHORN, { lo: 3, hi: 8, spec: 0.5 });
    }
    // thumb
    const ta = ang - 1.2;
    S.horn(x - nx * 3 * k, y - ny * 3 * k, x - nx * 4 * k + Math.cos(ta) * 3 * k, y - ny * 4 * k + Math.sin(ta) * 3 * k, x - nx * 2 * k + Math.cos(ta) * 5.5 * k, y - ny * 2 * k + Math.sin(ta) * 5.5 * k, 1.3 * k, 0.4, DSKIN, { lo: lo + 1.5, hi: 8 });
  }

  // Iron manacle with a few links of broken chain swinging below.
  function manacle(S, x, y, ang, k, swing) {
    const c = Math.cos(ang), s = Math.sin(ang), nx = -s, ny = c;
    S.capsule(x - nx * 4.5 * k, y - ny * 4.5 * k, x + nx * 4.5 * k, y + ny * 4.5 * k, 2.2 * k, 2.2 * k, IRON, { lo: 2, hi: 9, spec: 0.7 });
    S.px(x - nx * 1, y - ny * 1, IRON[9]);
    let lx = x + nx * 3 * k + c * 1, ly = y + ny * 3 * k + s * 1 + 2;
    for (let i = 0; i < 4; i++) {
      const vert = i % 2 === 0;
      const nx2 = lx + swing * 0.6, ny2 = ly + 3;
      if (vert) S.ellipse(nx2, ny2, 1.2, 2, IRON[6]); else S.ellipse(nx2, ny2, 2, 1.2, IRON[7]);
      S.px(nx2, ny2, IRON[1]);
      lx = nx2; ly = ny2;
    }
    // jagged broken end
    S.px(lx + 1, ly + 2, IRON[8]); S.px(lx - 1, ly + 2, IRON[5]);
  }

  function drawDemon(S, pose) {
    crisp(S, 0.5, 1.3);
    const q = decode(pose);
    const p = resolve(demonKeys, q);
    const T = mkT(p, 60, 118, 80), W = wrap(S, T), s = T.s;
    const sk = DSKIN;
    const f = p.f || 0;

    const shL = T.P(41, 47), shR = T.P(79, 47);
    const head = T.P(60 + p.hx, 31 + p.hy);
    const hipL = T.P(50, 80), hipR = T.P(70, 80);

    // ---- wings (behind everything) ----
    const wing = (side, lift, lo) => {
      const rt = T.P(60 + side * 9, 44);
      const L = lift;
      const elbow = [rt[0] + side * 14, Math.max(16, rt[1] - 14 - L * 3)];
      const wrist = [rt[0] + side * 30 + side * L * 2, Math.max(8, rt[1] - 34 - L * 6)];
      const tips = [
        [60 + side * 58 - side * Math.max(0, L) * 2, 22 - L * 12],
        [60 + side * 58, 48 - L * 9],
        [60 + side * 52, 70 - L * 6],
        [60 + side * 40, 84 - L * 3],
      ].map(([x, y]) => [clamp(x, 2, 117), clamp(y, 2, 116)]);
      const body = T.P(60 + side * 14, 74);
      batWing(S, { root: rt, elbow, wrist, tips, body, memb: DWING, bone: DSKIN, lo, scallop: 0.2, claw: 1, clawRamp: DHORN, aw: 3.2, fw: 1.5, boneHi: 7, light: 0.7 });
    };
    wing(1, p.wr, 0.6);
    wing(-1, p.wl, 0);

    // ---- tail: from behind the hips, out to the screen-right, spade tip ----
    const tw = p.tail || 0;
    const tb = T.P(66, 84);
    S.horn(tb[0], tb[1], 96 + tw, 112, 104 + tw * 1.5, 90 - tw * 0.5, 3, 1.4, sk, { lo: 1, hi: 7, rim: 0.3 });
    const tx = 104 + tw * 1.5, ty = 90 - tw * 0.5;
    S.poly([[tx - 3.5, ty + 1], [tx + 0.5 + tw * 0.3, ty - 7], [tx + 4, ty + 1], [tx + 0.5, ty - 1]], sk, { grad: [tx - 3, ty - 6, tx + 3, ty + 1, 0.75, 0.25] });

    // ---- goat legs: shaggy fur thighs, backward hock, cloven hooves ----
    const FUR_STROKES = strokeList(19, 40, -8, 0, 16, 30, 2, 3, 0.6);
    const leg = (L, hip, side, lo) => {
      const knee = [hip[0] + side * 4, hip[1] + 15];
      const hock = [hip[0] + side * 2, hip[1] + 27];
      const hoof = [hip[0] + side * 4, 115];
      // heavy shaggy thigh
      L.capsule(hip[0], hip[1], knee[0], knee[1], 9 * s, 5.5, DFUR, { lo: lo + 1, rim: 0.4, spec: 0.1 });
      L.ball(lerp(hip[0], knee[0], 0.45) + side * 1.5, lerp(hip[1], knee[1], 0.45), 8.5, 9, DFUR, { lo: lo + 1.2, spec: 0.15, rim: 0.3 });
      // slim shin angling back to the hock
      L.capsule(knee[0], knee[1], hock[0], hock[1], 4, 2.6, DFUR, { lo: lo + 1, rim: 0.3 });
      // hock tuft, slender pastern
      L.ball(hock[0], hock[1] + 1, 3.4, 3.4, DFUR, { lo: lo + 1, hi: 7 });
      L.capsule(hock[0], hock[1], hoof[0], hoof[1] - 3, 2.2, 2, DFUR, { lo: lo + 1, hi: 7 });
      for (const [x, y, len, sl] of FUR_STROKES) {
        const X = Math.round(hip[0] + x * side), Y = Math.round(hip[1] + y);
        if (inRamp(L, X, Y, DFUR) === undefined) continue;
        for (let t = 0; t < len; t++) nudge(L, Math.round(X + sl * t), Math.round(Y + t), DFUR, -2);
        nudge(L, Math.round(X - sl), Math.round(Y - 1), DFUR, 2);
      }
      shag(L, DFUR, Math.floor(hip[0] - 14), Math.floor(hip[1] - 2), Math.ceil(hip[0] + 14), 112, 0.95, { kx: Math.round(hip[0]), ky: 0, dirs: [[0, 1], [-1, 0], [1, 0], [-1, 1], [1, 1]] });
      // hoof: black, cloven, glinting
      L.poly([[hoof[0] - 4.5, hoof[1] + 1], [hoof[0] - 3, hoof[1] - 4], [hoof[0] + 3, hoof[1] - 4], [hoof[0] + 4.5, hoof[1] + 1]], HOOF, { grad: [hoof[0] - 4, hoof[1] - 4, hoof[0] + 4, hoof[1] + 1, 0.85, 0.2] });
      L.line(hoof[0], hoof[1] - 2, hoof[0], hoof[1] + 1, '#000');
      L.px(hoof[0] - 2, hoof[1] - 3, HOOF[6]);
    };
    leg(S, hipR, 1, 0.5);
    layer(S, L => leg(L, hipL, -1, 0));

    // ---- torso: V-shaped slab of muscle ----
    W.ball(60, 78, 13, 6, DFUR, { lo: 1, hi: 6 });                      // fur at the loins
    W.ball(60, 68, 12, 11, sk, { lo: 1, hi: 8.5, rim: 0.4 });           // abdomen
    W.ball(60, 54, 21, 11, sk, { lo: 1, hi: 8.5, rim: 0.4, spec: 0.1 }); // chest
    layer(S, L => {
      const WL = wrap(L, T);
      WL.ball(51, 54, 9.5, 7, sk, { lo: 1.5, spec: 0.25 });
      WL.ball(69, 54, 9.5, 7, sk, { lo: 1.2, rim: 0.4, spec: 0.1 });
    }, { k: 0.5, kl: 0 });
    // abs: three rows of blocks, centre line
    for (let r = 0; r < 3; r++) for (const sd of [-1, 1]) {
      const bx = 60 + sd * 3.6, by = 63 + r * 4.5;
      W.ball(bx, by, 3.2, 2.1, sk, { lo: 2, hi: 9, spec: 0.3 });
    }
    W.line(60, 61, 60, 75, sk[3]);
    crease(S, sk, T.X(47, 64), T.Y(47, 64), T.X(51, 74), T.Y(51, 74), -2);   // obliques
    crease(S, sk, T.X(73, 64), T.Y(73, 64), T.X(69, 74), T.Y(69, 74), -2);
    for (const [sx, sy, rx, ry] of D_SPOTS) spotAt(S, sk, T.X(sx, sy), T.Y(sx, sy), rx * s, ry * s, -1, 5);
    // traps rising to the thick neck
    W.ball(60, 43, 14, 6, sk, { lo: 1.5, hi: 8.5, rim: 0.3 });
    // fur ruff at the loins
    shag(S, DFUR, Math.floor(T.X(44, 74)), Math.floor(T.Y(44, 74)), Math.ceil(T.X(76, 84)), Math.ceil(T.Y(76, 84)), 0.6, { over: sk, kx: Math.round(T.X(60, 80) - 60), ky: 0 });

    // ---- head with ram horns ----
    layer(S, L => {
      demonHead(L, head[0], head[1], { k: s * 1.05, roar: p.roar, shut: p.shut > 0.5, tilt: p.tilt });
      const hy = head[1] - 5 * s - p.tilt * 2;
      ramHorn(L, head[0] - 4 * s, hy, -1, s * 0.95, 0);
      ramHorn(L, head[0] + 4 * s, hy, 1, s * 0.95, 0.5);
    }, { k: 0.5, kl: 0.2 });

    // ---- arms: deltoid, biceps, corded forearm, claws, manacles ----
    const arm = (L, sh, hand, bend, lo, sp) => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], 19 * s, 18 * s, bend);
      const o = { lo: lo + 1, rim: 0.4 };
      const ua = Math.atan2(j.ey - sh[1], j.ex - sh[0]), fa = Math.atan2(j.hy - j.ey, j.hx - j.ex);
      L.capsule(sh[0], sh[1], j.ex, j.ey, 5.6 * s, 4.4 * s, sk, o);
      L.ball(lerp(sh[0], j.ex, 0.5), lerp(sh[1], j.ey, 0.5), 7 * s, 5 * s, sk, Object.assign({ rot: ua, spec: 0.25 }, o));
      L.capsule(j.ex, j.ey, j.hx, j.hy, 4.6 * s, 3.4 * s, sk, o);
      L.ball(lerp(j.ex, j.hx, 0.3), lerp(j.ey, j.hy, 0.3), 6.4 * s, 4.6 * s, sk, Object.assign({ rot: fa, spec: 0.2 }, o));
      crease(L, sk, lerp(sh[0], j.ex, 0.25) - Math.sin(ua) * 2, lerp(sh[1], j.ey, 0.25) + Math.cos(ua) * 2, lerp(sh[0], j.ex, 0.75) - Math.sin(ua) * 1.5, lerp(sh[1], j.ey, 0.75) + Math.cos(ua) * 1.5, -2);
      crease(L, sk, lerp(j.ex, j.hx, 0.1) + Math.sin(fa) * 2, lerp(j.ey, j.hy, 0.1) - Math.cos(fa) * 2, lerp(j.ex, j.hx, 0.6), lerp(j.ey, j.hy, 0.6), -2);
      L.ball(sh[0], sh[1], 7.5 * s, 6.5 * s, sk, { lo: lo + 1.5, spec: 0.3, rim: 0.4 });          // deltoid
      manacle(L, lerp(j.ex, j.hx, 0.82), lerp(j.ey, j.hy, 0.82), fa, s, Math.sin(f * 1.57) * 1.2);
      demonClaw(L, j.hx, j.hy, fa, s * 1.05, sp, lo);
      return j;
    };
    const order = p.hL[0] > 52 ? ['R', 'L'] : p.hR[0] < 68 ? ['L', 'R'] : ['R', 'L'];
    for (const o of order) {
      if (o === 'L') layer(S, L => arm(L, shL, p.hL, p.bL, 0, p.spL));
      else layer(S, L => arm(L, shR, p.hR, p.bR, 0.5, p.spR));
    }

    S.outline();

    // ---- emissive: eyes' glow, ember breath, strike rakes ----
    const eyeY = head[1] - 1 * s - p.tilt * 2;
    if (!(p.shut > 0.5)) {
      for (const sd of [-1, 1]) aura(S, head[0] + sd * 3.4 * s, eyeY, 3.5, 2.5, ['#a40', '#f92'], { k: 0.5, over: true, only: (x, y) => inRamp(S, x, y, DSKIN) !== undefined && inRamp(S, x, y, DSKIN) < 5 });
    }
    if (q.st) {
      // three talon rakes slashing toward the viewer
      const cols = ['#610', '#c32', '#f86', '#fdb'];
      const overWing = (x, y) => inRamp(S, x, y, DWING) !== undefined;
      const rake = (pts, side) => {
        for (let i = -1; i <= 1; i++) swoosh(S, pts.map(([x, y]) => [x + i * 5, y + Math.abs(i) * 2]), 3.5, cols, { behind: true, side, over: overWing });
      };
      if (q.dir < 0) rake([[14, 8], [10, 34], [18, 62], [34, 86], [50, 104]], -1);
      else if (q.dir > 0) rake([[106, 8], [110, 34], [102, 62], [86, 86], [70, 104]], 1);
      else {
        rake([[38, 4], [30, 30], [34, 60], [42, 92]], -1);
        rake([[82, 4], [90, 30], [86, 60], [78, 92]], 1);
      }
    }
    clearRing(S);
  }

  function demonPortrait(S) {
    crisp(S, 0.5, 1.2);
    S.poly([[-2, 24], [-2, 6], [6, 14]], DWING, { grad: [-2, 6, 6, 20, 0.3, 0.6] });
    S.poly([[26, 24], [26, 6], [18, 14]], DWING, { grad: [26, 6, 18, 20, 0.25, 0.5] });
    S.ball(12, 30, 14, 9, DSKIN, { lo: 1, hi: 8.5, rim: 0.4 });
    demonHead(S, 12, 15, { k: 0.85, roar: 0.7 });
    ramHorn(S, 9.5, 10.5, -1, 0.45, 0);
    ramHorn(S, 14.5, 10.5, 1, 0.45, 0.5);
    S.outline();
  }

  EN['Demon'] = { w: 120, h: 120, anchor: [60, 118], center: [60, 60], mouth: [60, 37], draw: drawDemon, portrait: demonPortrait };

  // ===============================================================
  // RED DRAGON — the apex predator and the final boss. Sits up on its
  // haunches facing the champion, wings spread across the whole arena,
  // long neck rising in an S to a horned head that glares down; fire
  // smoulders in its throat and smoke curls from its nostrils.
  //   wind left/right: a huge foreclaw raised on that side
  //   wind overhead:   neck reared high, jaws parting, fire building
  //   strike overhead: the breath — a torrent of flame toward the viewer
  // Keys: hp = head position (screen), hk = head scale, jo = jaw open,
  // tg = throat glow, cL / cR = foreclaw targets, spL / spR = talon splay,
  // wl / wr = wing lift, tail = tail sway, ns = neck sway.
  // ===============================================================
  const SCALE = ['#100', '#200', '#301', '#401', '#602', '#802', '#a12', '#b22', '#d33', '#e64', '#f97'];
  const BELLY = R.gold;
  const DRW = ['#100', '#200', '#301', '#401', '#502', '#612', '#723', '#834', '#a45'];
  const IVORY = ['#110', '#221', '#432', '#654', '#876', '#a98', '#cba', '#edc', '#ffe'];
  const SMOKE = ['#334', '#556', '#889', '#aab'];

  const drKeys = {
    idle: f => {
      const br = [0, 1, 2, 1][f], sw = [0, 1, 0, -1][f];
      return {
        lean: 0, dx: 0, dy: 0, s: 1 + br * 0.006, hp: [84 + sw * 0.6, 27 + br * 0.4], hk: 1.12, jo: 0.06, tilt: 0, shut: 0, tg: 0.35 + br * 0.12,
        cL: [70, 116], cR: [98, 116], bL: 1, bR: -1, spL: 0.5, spR: 0.5, liftL: 0, liftR: 0,
        wl: br * 0.6, wr: br * 0.6, tail: sw * 2.5, ns: -9 + sw * 1, fire: 0, f,
      };
    },
    // the screen-left foreclaw reared high, body twisting into it
    wl: { lean: -0.12, dx: -3, dy: -3, hp: [96, 26], jo: 0.5, tg: 0.5, cL: [28, 30], cR: [99, 113], bL: 1, spL: 1.5, liftL: 1, wl: 2.6, wr: 0.4, tail: -5, ns: -12 },
    wl5: { cL: [42, 62], hp: [91, 27], spL: 1.1, liftL: 0.6, wl: 1.6, lean: -0.06, jo: 0.3, ns: -11 },
    // neck reared high and straight, jaws wide, fire building in the throat
    wh: { lean: 0, dx: 0, dy: -4, s: 1, hp: [84, 17], hk: 1.05, jo: 1, tg: 1, cL: [46, 92], cR: [122, 92], bL: 1, bR: -1, spL: 1.3, spR: 1.3, liftL: 0.6, liftR: 0.6, wl: 3, wr: 3, tail: 0, ns: 0 },
    wh5: { hp: [84, 22], jo: 0.6, tg: 0.8, cL: [52, 100], cR: [116, 100], liftL: 0.45, liftR: 0.45, wl: 1.8, wr: 1.8, dy: -2, ns: -3 },
    // the screen-right foreclaw reared high
    wr: { lean: 0.12, dx: 3, dy: -3, hp: [72, 26], jo: 0.5, tg: 0.5, cL: [69, 113], cR: [140, 30], bR: -1, spR: 1.5, liftR: 1, wl: 0.4, wr: 2.6, tail: 5, ns: 6 },
    wr5: { cR: [126, 62], hp: [77, 27], spR: 1.1, liftR: 0.6, wr: 1.6, lean: 0.06, jo: 0.3, ns: 0 },
    // claw rakes down toward the viewer
    sl: { lean: 0.08, dx: 2, dy: 3, s: 1.05, hp: [80, 31], jo: 0.75, tg: 0.5, cL: [62, 108], cR: [100, 111], bL: 1, spL: 1.6, liftL: 0.7, wl: 1, wr: 0.4, tail: 3, ns: -4 },
    // the breath: head lunges down at the viewer, flame pours out
    sh: { lean: 0, dx: 0, dy: 3, s: 1.04, hp: [84, 38], hk: 1.3, jo: 1, tg: 1, cL: [66, 117], cR: [102, 117], spL: 0.8, spR: 0.8, wl: 1.6, wr: 1.6, tail: 0, ns: 0, fire: 1 },
    sr: { lean: -0.08, dx: -2, dy: 3, s: 1.05, hp: [88, 31], jo: 0.75, tg: 0.5, cL: [68, 111], cR: [106, 108], bR: -1, spR: 1.6, liftR: 0.7, wl: 0.4, wr: 1, tail: -3, ns: -12 },
    hurt: { lean: 0.1, dx: 3, dy: -2, s: 0.98, hp: [100, 24], hk: 1.05, jo: 0.8, tg: 0.2, tilt: 1, shut: 1, cL: [54, 92], cR: [99, 113], spL: 1.3, liftL: 0.5, wl: 2.4, wr: 1.8, tail: 6, ns: 4 },
  };

  // Scale texture in a primitive's own frame (so it moves with the body).
  // Darkens the lower rim of each scale and catches a glint on its crown.
  function scaly(S, ramp, cx, cy, rx, ry, rot, cw = 3.2, ch = 2.6, minI = 3) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const R0 = Math.max(rx, ry) + 1;
    for (let y = Math.floor(cy - R0); y <= Math.ceil(cy + R0); y++) for (let x = Math.floor(cx - R0); x <= Math.ceil(cx + R0); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      if ((lx / rx) ** 2 + (ly / ry) ** 2 > 1) continue;
      const i0 = inRamp(S, x, y, ramp);
      if (i0 === undefined || i0 < minI) continue;
      const row = Math.floor(ly / ch + 100), fy = ly / ch + 100 - row;
      const off = (row & 1) * 0.5;
      const fx = (lx / cw + off + 100) % 1;
      const d = Math.abs(fx - 0.5);
      if (i0 > 7) continue;
      if (fy > 0.78 - d * d * 1.4) S.set(x, y, ramp[Math.max(0, i0 - 1)]);
      else if (fy < 0.22 && d < 0.12 && i0 >= 5 && i0 < 7) S.set(x, y, ramp[i0 + 1]);
    }
  }
  const scalyCap = (S, ramp, x1, y1, x2, y2, r, cw, ch) => {
    const L = Math.hypot(x2 - x1, y2 - y1);
    scaly(S, ramp, (x1 + x2) / 2, (y1 + y2) / 2, L / 2 + r, r, Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2 * 0, cw, ch);
  };

  // Dragon foreclaw: scaled hand, four hooked ivory talons.
  function dragonClaw(S, x, y, ang, k, sp, lo) {
    const c = Math.cos(ang), s = Math.sin(ang), nx = -s, ny = c;
    S.ball(x, y, 5.2 * k, 4.6 * k, SCALE, { lo: lo + 2, hi: 8.5, spec: 0.3, rot: ang, rim: 0.3 });
    for (let i = -1.5; i <= 1.5; i++) {
      const a = ang + i * 0.34 * sp;
      const bx = x + c * 3.5 * k + nx * i * 2.3 * k, by = y + s * 3.5 * k + ny * i * 2.3 * k;
      const mx = bx + Math.cos(a) * 4 * k, my = by + Math.sin(a) * 4 * k;
      S.capsule(bx, by, mx, my, 1.7 * k, 1.3 * k, SCALE, { lo: lo + 2, hi: 8.5, spec: 0.25 });
      const ca = a + 0.75;
      S.horn(mx, my, mx + Math.cos(a) * 3 * k, my + Math.sin(a) * 3 * k, mx + Math.cos(ca) * 5.5 * k, my + Math.sin(ca) * 5.5 * k, 1.4 * k, 0.3, IVORY, { lo: 2, hi: 8, spec: 0.6 });
    }
    const ta = ang - 1.3;
    S.horn(x - nx * 3.5 * k, y - ny * 3.5 * k, x - nx * 5 * k + Math.cos(ta) * 3 * k, y - ny * 5 * k + Math.sin(ta) * 3 * k, x - nx * 3 * k + Math.cos(ta) * 6.5 * k, y - ny * 3 * k + Math.sin(ta) * 6.5 * k, 1.4 * k, 0.4, IVORY, { lo: 2, hi: 7.5, spec: 0.5 });
  }

  // Front-facing dragon head. (x, y) = eye line centre. jo = jaw open (0..1).
  function dragonHead(S, x, y, o = {}) {
    const k = o.k || 1, jo = o.jo || 0, tg = o.tg || 0, shut = o.shut, tl = o.tilt || 0;
    const X = dx => x + dx * k;
    const roll = tl * 0.1;                                     // hurt: head cocked
    const RY = (dx, dy) => y + dy * k + dx * k * roll;
    const Y = dy => y + dy * k;
    // great horns sweeping back and out, curling up at the tips
    for (const sd of [-1, 1]) {
      const lo = sd > 0 ? 0.6 : 0;
      S.horn(X(sd * 7), RY(sd * 7, -5), X(sd * 17), RY(sd * 17, -9), X(sd * 23), RY(sd * 23, -13), 3.8 * k, 2.2 * k, IVORY, { lo: lo + 1, hi: 7.5, spec: 0.45, rim: 0.3 });
      S.horn(X(sd * 23), RY(sd * 23, -13), X(sd * 28), RY(sd * 28, -14), X(sd * 29), RY(sd * 29, -19), 2.2 * k, 0.5, IVORY, { lo: lo + 1.5, hi: 8, spec: 0.5 });
      // ridges on the horn
      for (let i = 1; i < 5; i++) {
        const t = i / 5, hx = lerp(X(sd * 7), X(sd * 23), t), hy = lerp(RY(sd * 7, -5), RY(sd * 23, -13), t) - Math.sin(t * Math.PI) * 1.5 * k;
        S.line(hx - sd * 0.5, hy - 2.5 * k * (1 - t * 0.4), hx + sd * 0.8, hy + 2.5 * k * (1 - t * 0.4), IVORY[2 + Math.round(lo)]);
      }
      // cheek frills: spikes fanning out from the jaw hinge
      for (let i = 0; i < 3; i++) {
        const bx = X(sd * 10), by = RY(sd * 10, 3 + i * 3);
        S.horn(bx, by, X(sd * (15 + i)), RY(sd * (15 + i), 3 + i * 3.4), X(sd * (19 - i * 1.2)), RY(sd * (19 - i * 1.2), 5 + i * 4.6), (2 - i * 0.35) * k, 0.4, SCALE, { lo: 1 + lo, hi: 7, spec: 0.3 });
      }
    }
    // lower jaw (drops when open), mouth interior, fire in the throat
    const jy = jo * 12;
    if (jo > 0.1) {
      S.poly([[X(-8), RY(-8, 7)], [X(8), RY(8, 7)], [X(6), RY(6, 13 + jy)], [X(-6), RY(-6, 13 + jy)]], ['#100', '#200', '#401', '#702'], { grad: [x, Y(7), x, Y(13 + jy), 0.9, 0.35] });
      const fr = (2 + jo * 3.8) * (0.55 + tg * 0.6);
      S.ball(x, Y(10.5 + jy * 0.5), fr * 1.2 * k, fr * k, FLAME, { tone: 0.3 + tg * 0.5 });
      S.ball(x, Y(11 + jy * 0.5), fr * 0.62 * k, fr * 0.55 * k, FLAME, { tone: 0.72 + tg * 0.28 });
      if (tg > 0.6) { S.px(x, Y(11 + jy * 0.5), '#fff'); S.px(x - 1, Y(11 + jy * 0.5), '#ffb'); }
    }
    S.poly([[X(-10), RY(-10, 4)], [X(10), RY(10, 4)], [X(7), RY(7, 12 + jy)], [X(3), RY(3, 15.5 + jy)], [X(-3), RY(-3, 15.5 + jy)], [X(-7), RY(-7, 12 + jy)]], SCALE,
      { grad: [X(-9), Y(5), X(7), Y(15 + jy), 0.6, 0.15] });
    S.poly([[X(-4.5), RY(-4.5, 13.5 + jy)], [X(4.5), RY(4.5, 13.5 + jy)], [X(2.5), RY(2.5, 15.5 + jy)], [X(-2.5), RY(-2.5, 15.5 + jy)]], BELLY, { grad: [x, Y(13 + jy), x, Y(15.5 + jy), 0.4, 0.15], lo: 1, hi: 6 });
    for (const tx of [-5.5, -3.5, 3.5, 5.5]) S.tri([X(tx) - 0.8, RY(tx, 12.4 + jy)], [X(tx) + 0.8, RY(tx, 12.4 + jy)], [X(tx * 0.95), RY(tx, 12.4 + jy - 2.2 - (Math.abs(tx) > 5 ? 1.2 : 0))], IVORY, { tone: 0.8 });
    // cheekbones and the broad skull
    for (const sd of [-1, 1]) S.ball(X(sd * 8.5), RY(sd * 8.5, 2.5), 4.5 * k, 4.6 * k, SCALE, { lo: 1.5, hi: sd < 0 ? 8 : 7, spec: 0.25, rim: 0.3 });
    S.ball(x, RY(0, -3.5), 11.5 * k, 6.5 * k, SCALE, { lo: 1, hi: 7.5, spec: 0.3, rim: 0.3 });
    // muzzle narrowing toward the viewer, a ridge of plates down its crest
    S.poly([[X(-7.5), RY(-7.5, 0)], [X(7.5), RY(7.5, 0)], [X(6), RY(6, 10)], [X(4.5), RY(4.5, 13)], [X(-4.5), RY(-4.5, 13)], [X(-6), RY(-6, 10)]], SCALE,
      { grad: [X(-6), Y(0), X(6), Y(13), 0.82, 0.3] });
    S.poly([[X(-4.5), RY(-4.5, 9)], [X(4.5), RY(4.5, 9)], [X(4), RY(4, 12.5)], [X(-4), RY(-4, 12.5)]], SCALE, { grad: [X(-4), Y(9), X(4), Y(12.5), 0.7, 0.35] });
    for (let i = 0; i < 4; i++) S.ball(x, RY(0, -6 + i * 3.2), 1.6 * k, 1.3 * k, SCALE, { lo: 3, hi: 9, spec: 0.5 });
    for (let i = 0; i < 3; i++) { S.px(X(-3.5), RY(-3.5, 3 + i * 2.6), SCALE[7]); S.px(X(3.5), RY(3.5, 3 + i * 2.6), SCALE[4]); }
    // upper teeth along the lip, long fangs at the corners
    for (const tx of [-4, -2, 2, 4]) S.tri([X(tx) - 0.7, RY(tx, 12.6)], [X(tx) + 0.7, RY(tx, 12.6)], [X(tx), RY(tx, 14.4)], IVORY, { tone: 0.85 });
    for (const sd of [-1, 1]) S.tri([X(sd * 6.3) - 1, RY(sd * 6.3, 10.5)], [X(sd * 6.3) + 1, RY(sd * 6.3, 10.5)], [X(sd * 6.1), RY(sd * 6.1, 15.5 + jo * 2)], IVORY, { tone: 0.9 });
    // nostrils: dark slits, embers glowing inside
    for (const sd of [-1, 1]) {
      S.px(X(sd * 2.5), RY(sd * 2.5, 11), '#100'); S.px(X(sd * 3.2), RY(sd * 3.2, 10.3), '#100');
      S.px(X(sd * 2.5), RY(sd * 2.5, 10), tg > 0.5 ? '#fd5' : '#e50');
    }
    // heavy brow ridges in a deep scowl, spiked
    for (const sd of [-1, 1]) {
      S.ball(X(sd * 5.6), RY(sd * 5.6, -3), 5.4 * k, 2.3 * k, SCALE, { lo: 2, hi: sd < 0 ? 9 : 7.5, spec: 0.6, rot: sd * 0.45 });
      S.line(X(sd * 10), RY(sd * 10, -5), X(sd * 1.5), RY(sd * 1.5, -1), SCALE[1]);
      S.horn(X(sd * 8), RY(sd * 8, -5), X(sd * 10.5), RY(sd * 10.5, -8), X(sd * 13), RY(sd * 13, -8.5), 1.4 * k, 0.4, IVORY, { lo: 3, hi: 8 });
    }
    // eyes: molten gold, slit pupils, deep under the brow
    for (const sd of [-1, 1]) {
      const ex = Math.round(X(sd * 5.4)), ey = Math.round(RY(sd * 5.4, -0.5));
      S.rect(ex - 3, ey - 1, 7, 3, '#100');
      S.line(ex - 3 - (sd > 0 ? 0 : 0), ey - 2, ex + 3, ey - 2 + sd * 0, SCALE[1]);
      if (shut) { S.line(ex - 2, ey, ex + 2, ey, SCALE[3]); S.px(ex + sd * 2, ey - 1, SCALE[2]); continue; }
      S.rect(ex - 2, ey, 5, 1, '#c50'); S.rect(ex - 1, ey, 3, 1, '#fd4');
      S.px(ex - 1, ey - 1, '#e70'); S.px(ex, ey - 1, '#fd4'); S.px(ex + 1, ey - 1, '#e70');
      S.px(ex, ey, '#100'); S.px(ex, ey - 1, '#410');
      S.px(ex - sd * 1, ey, '#ffe');
    }
  }

  // Nostril smoke: solid little shaded puffs (lit top-left) that swing wide
  // of the eyes as they rise, swell, and erode away with a dither as they age.
  const SMOKE5 = ['#334', '#445', '#667', '#889', '#aab'];
  function smoke(S, x, y, f, k = 1, len = 1) {
    const n = 3;
    const sky = (xx, yy) => !S.opaque(xx, yy) || inRamp(S, xx, yy, DRW) !== undefined;
    for (let i = 0; i < n; i++) {
      for (const sd of [-1, 1]) {
        const a = ((f + i * 4 / n + (sd > 0 ? 2 : 0)) % 4) / 4 * len;
        const px = x + sd * (4 * k + a * 30), py = y - 2 - a * 20 - a * a * 6;
        const r = 1.5 + a * 3;
        const fade = 1.3 - a * 1.1;
        const first = a < 0.15;
        for (let yy = Math.floor(py - r); yy <= Math.ceil(py + r); yy++) for (let xx = Math.floor(px - r); xx <= Math.ceil(px + r); xx++) {
          const ex = (xx + 0.5 - px) / r, ey = (yy + 0.5 - py) / r, d2 = ex * ex + ey * ey;
          if (d2 > 1 || xx < 1 || yy < 1 || xx > S.w - 2) continue;
          if (!first && !sky(xx, yy)) continue;
          if (fade < 1 && fade < P.thresh(xx, yy) + (1 - fade) * d2 * 0.3) continue;
          const lit = clamp(0.55 - ex * 0.45 - ey * 0.55 + Math.sqrt(1 - d2) * 0.2, 0, 1);
          S.set(xx, yy, SMOKE5[clamp(Math.round(lit * 4 - a * 1.2), 0, 4)]);
        }
      }
    }
  }

  // The breath: a billowing cone of flame from the jaws toward the viewer,
  // white-hot along its axis, licking red at its ragged edges.
  function breath(S, mx, my, f) {
    const base = S.h - 2, H = base - my;
    for (let y = Math.ceil(my); y <= base; y++) {
      const t = Math.max(0, (y - my) / H);
      for (let x = Math.floor(mx - 70); x <= Math.ceil(mx + 70); x++) {
        if (x < 1 || x > S.w - 2) continue;
        const dx = x + 0.5 - mx;
        // billowing lobes rolling down the stream
        const lobe = 0.22 * Math.sin(t * 14 - f * 1.7 + Math.sign(dx) * 0.8) + 0.1 * Math.sin(y * 0.55 + dx * 0.25 + f);
        const hw = (3 + Math.pow(t, 0.85) * 50) * (1 + lobe);
        const d = Math.abs(dx) / hw;
        if (d > 1) continue;
        let v = (1 - Math.pow(d, 1.4)) * (1 - t * 0.45) + (t < 0.12 ? 0.3 : 0);
        v += 0.14 * Math.sin(t * 19 - f * 2.2 + d * 5) - 0.1 * (1 - Math.abs(Math.sin(dx * 0.31 + t * 6)));
        if (v < 0.08) { if (P.thresh(x, y) > v * 6) continue; v = 0.08; }
        const n = FLAME.length - 1;
        S.set(x, y, P.rampColor(FLAME, clamp(v * n * 1.1, 0, n), x, y));
      }
    }
    const r = U.rng(9);
    for (let i = 0; i < 26; i++) {
      const t = r(), side = r() < 0.5 ? -1 : 1, hw = 3 + Math.pow(t, 0.85) * 50;
      const x = mx + side * (hw + 3 + r() * 10), y = my + t * H - r() * 6;
      if (x > 1 && x < S.w - 2 && y > 1 && !S.opaque(x, y)) S.px(x, y, r() < 0.5 ? '#fd5' : '#f70');
    }
  }

  const DR_NECK_SPINE = [0.15, 0.3, 0.45, 0.6, 0.75];

  function drawDragon(S, pose) {
    crisp(S, 0.5, 1.3);
    const q = decode(pose);
    const p = resolve(drKeys, q);
    const T = mkT(p, 84, 134, 110), W = wrap(S, T), s = T.s;
    const f = p.f || 0;
    const sk = SCALE;

    const shL = T.P(67, 79), shR = T.P(101, 79);
    const neckBase = T.P(84, 72);
    const hp = p.hp, hk = p.hk || 1;

    // ---------------- wings ----------------
    const wing = (side, lift, lo) => {
      const rt = T.P(84 + side * 11, 68);
      const L = lift;
      const elbow = [rt[0] + side * 20 + side * L, rt[1] - 26 - L * 4];
      const wrist = [84 + side * 50 + side * L * 1.5, 15 - L * 4];
      const tips = [
        [84 + side * 81, Math.max(4, 14 - L * 6)],
        [84 + side * 82, 44 - L * 6],
        [84 + side * 77, 70 - L * 5],
        [84 + side * 63, 92 - L * 4],
        [84 + side * 46, 104 - L * 2],
      ].map(([x, y]) => [clamp(x, 2, 165), clamp(y, 2, 132)]);
      const body = T.P(84 + side * 17, 98);
      batWing(S, { root: rt, elbow, wrist: [clamp(wrist[0], 4, 163), clamp(wrist[1], 8, 130)], tips, body, memb: DRW, bone: SCALE, lo, scallop: 0.16, claw: 1.3, clawRamp: IVORY, aw: 4, fw: 1.6, boneHi: 6.5, light: 0.6, knuckle: [0, -2] });
    };
    wing(1, p.wr, 0.7);
    wing(-1, p.wl, 0);
    // spines along the wing's leading edge
    for (const side of [-1, 1]) {
      const L = side < 0 ? p.wl : p.wr;
      const wx = 84 + side * 50 + side * L * 1.5, wy = Math.max(8, 15 - L * 4);
      S.horn(wx, wy, wx + side * 2, wy - 5, wx + side * 6, wy - 8, 2.2, 0.4, IVORY, { lo: 2, hi: 7.5, spec: 0.5 });
    }

    // ---------------- tail (behind the right haunch) ----------------
    const tw = p.tail || 0;
    const tb = T.P(100, 118);
    const tpath = [tb, [128, 127], [152, 124], [161 + tw * 0.3, 111], [157 + tw, 97 - Math.abs(tw) * 0.3]];
    const trad = [7, 5.5, 4.2, 3, 1.8];
    for (let i = 0; i < tpath.length - 1; i++) {
      S.capsule(tpath[i][0], tpath[i][1], tpath[i + 1][0], tpath[i + 1][1], trad[i], trad[i + 1], sk, { lo: 1, hi: 7.5, rim: 0.3, spec: 0.15 });
      scalyCap(S, sk, tpath[i][0], tpath[i][1], tpath[i + 1][0], tpath[i + 1][1], trad[i], 3, 2.6);
      // dorsal spikes along the top of the tail
      const mx = lerp(tpath[i][0], tpath[i + 1][0], 0.5), my = lerp(tpath[i][1], tpath[i + 1][1], 0.5);
      const dx = tpath[i + 1][0] - tpath[i][0], dy = tpath[i + 1][1] - tpath[i][1], d = Math.hypot(dx, dy) || 1;
      const nx = dy / d, ny = -dx / d;
      const rr = lerp(trad[i], trad[i + 1], 0.5);
      if (i > 0) S.tri([mx - dx / d * 2, my - dy / d * 2], [mx + dx / d * 2, my + dy / d * 2], [mx + nx * (rr + 3), my + ny * (rr + 3)], IVORY, { tone: 0.55 });
    }
    // spade tip
    const tt = tpath[tpath.length - 1];
    S.poly([[tt[0] - 4, tt[1] + 2], [tt[0] - 1 + tw * 0.2, tt[1] - 7], [tt[0] + 4, tt[1] + 1], [tt[0], tt[1] - 1]], IVORY, { grad: [tt[0] - 4, tt[1] - 6, tt[0] + 4, tt[1] + 2, 0.8, 0.3] });

    // ---------------- haunches + hind feet ----------------
    const hind = (L, side, lo) => {
      const hx = 84 + side * 25, hy = 112;
      const H = T.P(hx, hy);
      L.ball(H[0], H[1], 15.5 * s, 14 * s, sk, { lo: lo + 1, hi: 8, rim: 0.4, spec: 0.15 });
      scaly(L, sk, H[0], H[1], 15.5 * s, 14 * s, 0, 4, 3.2);
      crease(L, sk, H[0] - side * 2, H[1] - 12, H[0] + side * 9, H[1] + 2, -1);
      // shin down to a foot splayed on the ground
      const fx = 84 + side * 31, fy = 129;
      L.capsule(H[0] + side * 4, H[1] + 6, fx, fy - 3, 6.5, 4.5, sk, { lo: lo + 1, rim: 0.3 });
      L.ball(fx, fy - 1, 7, 3.6, sk, { lo: lo + 1.5, spec: 0.2 });
      for (let i = -1.5; i <= 1.5; i++) {
        const tx = fx + i * 3.4 - side * 0.5, ty = fy + 0.5;
        L.horn(tx, ty - 1, tx + i * 0.6, ty + 0.5, tx + i * 1 - side * 0.5, ty + 2.5, 1.4, 0.3, IVORY, { lo: 2, hi: 8, spec: 0.5 });
      }
    };
    hind(S, 1, 0.6);
    layer(S, L => hind(L, -1, 0), { k: 0.45, kl: 0.2 });

    // ---------------- torso: chest & belly with golden plates ----------------
    W.ball(84, 102, 22, 20, sk, { lo: 1, hi: 8, rim: 0.45, spec: 0.1 });
    W.ball(84, 82, 23, 15, sk, { lo: 1, hi: 8, rim: 0.4, spec: 0.12 });
    scaly(S, sk, T.X(84, 94), T.Y(84, 94), 26 * s, 32 * s, 0, 4, 3.2);
    // plated belly: a stack of overlapping bronze-gold scutes, rounded with the belly
    for (let i = 0; i < 11; i++) {
      const y0 = 75 + i * 4.4, w = (i < 4 ? 8 + i * 1.3 : 13 - (i - 4) * 0.85);
      const pts = [];
      for (let j = 0; j <= 6; j++) { const t = j / 6; pts.push([84 - w + t * 2 * w, y0 + Math.sin(t * Math.PI) * 1.2]); }
      for (let j = 6; j >= 0; j--) { const t = j / 6; pts.push([84 - w + 1 + t * (2 * w - 2), y0 + 4.6 + Math.sin(t * Math.PI) * 1.2]); }
      W.poly(pts, BELLY, { grad: [84 - w, y0, 84 + w, y0 + 3, 0.78 - i * 0.02, 0.2], lo: 1, hi: 7.5 });
      for (let j = 0; j < 6; j++) { const t = (j + 0.5) / 6; W.px(84 - w + 1 + t * (2 * w - 2), y0 + 4.4 + Math.sin(t * Math.PI) * 1.2, BELLY[1]); }
      W.line(84 - w + 2, y0 + 0.8, 84 - 2, y0 + 1.9, BELLY[7]);
    }

    // ---------------- neck: an S rising from the chest to the head ----------------
    const nb = neckBase, ctl = [lerp(nb[0], hp[0], 0.4) + (p.ns || 0), lerp(nb[1], hp[1], 0.5)];
    const neckAt = t => {
      const it = 1 - t;
      return [it * it * nb[0] + 2 * it * t * ctl[0] + t * t * hp[0], it * it * nb[1] + 2 * it * t * ctl[1] + t * t * (hp[1] + 7 * hk)];
    };
    const NR = t => lerp(10, 6.5, t);
    const nsteps = 9;
    // spines down the back of the neck show past its silhouette
    for (const t of DR_NECK_SPINE) {
      const [cx, cy] = neckAt(t), r = NR(t);
      for (const sd of [-1, 1]) S.horn(cx + sd * (r - 2), cy, cx + sd * (r + 2), cy - 3, cx + sd * (r + 4.5), cy - 6, 1.8, 0.4, IVORY, { lo: sd > 0 ? 1.5 : 2, hi: 7 });
    }
    layer(S, L => {
      for (let i = 0; i < nsteps; i++) {
        const t0 = i / nsteps, t1 = (i + 1) / nsteps;
        const a = neckAt(t0), b = neckAt(t1);
        L.capsule(a[0], a[1], b[0], b[1], NR(t0), NR(t1), sk, { lo: 1, hi: 8, rim: 0.4, spec: 0.15 });
      }
      for (let i = 0; i < nsteps; i++) {
        const a = neckAt(i / nsteps), b = neckAt((i + 1) / nsteps);
        scalyCap(L, sk, a[0], a[1], b[0], b[1], NR(i / nsteps), 3, 2.4);
      }
      // throat plates: gold scutes up the front of the neck, heat glowing through
      for (let i = 0; i < 8; i++) {
        const t = 0.06 + i * 0.115, [cx, cy] = neckAt(t), [c2x, c2y] = neckAt(t + 0.1);
        const w = NR(t) * 0.5;
        const ang = Math.atan2(c2y - cy, c2x - cx), nx = -Math.sin(ang), ny = Math.cos(ang);
        const glow = p.tg * (0.4 + t * 0.6);
        L.poly([[cx + nx * w, cy + ny * w], [cx - nx * w, cy - ny * w], [c2x - nx * w * 0.9, c2y - ny * w * 0.9], [c2x + nx * w * 0.9, c2y + ny * w * 0.9]], BELLY,
          { grad: [cx + nx * w, cy + ny * w, cx - nx * w, cy - ny * w, 0.3, 0.75], lo: 1, hi: 7.5 });
        L.line(cx + nx * w, cy + ny * w, cx - nx * w, cy - ny * w, BELLY[1]);
        if (glow > 0.3) {
          const gx = lerp(cx, c2x, 0.5), gy = lerp(cy, c2y, 0.5);
          L.line(gx - nx * w * 0.5, gy - ny * w * 0.5, gx + nx * w * 0.5, gy + ny * w * 0.5, glow > 0.8 ? '#fd5' : glow > 0.5 ? '#fa2' : '#c50');
        }
      }
    }, { k: 0.5, kl: 0.15 });

    // ---------------- head ----------------
    layer(S, L => dragonHead(L, hp[0], hp[1], { k: hk, jo: p.jo, tg: p.tg, shut: p.shut > 0.5, tilt: p.tilt }), { k: 0.55, kl: 0.2 });

    // ---------------- forelegs ----------------
    const fore = (L, sh, claw, bend, lo, sp, lift) => {
      const j = ik(sh[0], sh[1], claw[0], claw[1], 24 * s, 23 * s, bend);
      const ua = Math.atan2(j.ey - sh[1], j.ex - sh[0]), fa = Math.atan2(j.hy - j.ey, j.hx - j.ex);
      L.ball(sh[0], sh[1], 8.5 * s, 8 * s, sk, { lo: lo + 1, hi: 8, rim: 0.4, spec: 0.25 });
      L.capsule(sh[0], sh[1], j.ex, j.ey, 7.5 * s, 5.8 * s, sk, { lo: lo + 1, hi: 8, rim: 0.45, spec: 0.2 });
      L.capsule(j.ex, j.ey, j.hx, j.hy, 5.8 * s, 4.4 * s, sk, { lo: lo + 1, hi: 8, rim: 0.45, spec: 0.2 });
      scalyCap(L, sk, sh[0], sh[1], j.ex, j.ey, 7.5 * s, 3.4, 2.7);
      scalyCap(L, sk, j.ex, j.ey, j.hx, j.hy, 5.8 * s, 3.2, 2.5);
      crease(L, sk, lerp(sh[0], j.ex, 0.2) + Math.sin(ua) * 4, lerp(sh[1], j.ey, 0.2) - Math.cos(ua) * 4, lerp(sh[0], j.ex, 0.85) + Math.sin(ua) * 3, lerp(sh[1], j.ey, 0.85) - Math.cos(ua) * 3, -1);
      // elbow spur
      L.horn(j.ex, j.ey, j.ex - Math.cos(fa) * 3, j.ey - Math.sin(fa) * 3 - 1, j.ex - Math.cos(fa) * 6 + Math.cos(ua) * 1, j.ey - Math.sin(fa) * 6 - 2, 1.6, 0.4, IVORY, { lo: 2, hi: 7.5 });
      const ck = 1.25 + lift * 0.35;
      dragonClaw(L, j.hx, j.hy, lift > 0.3 ? fa - 0.2 * Math.sign(Math.cos(fa) || 1) : Math.PI / 2, ck * s, sp, lo);
      return j;
    };
    const raisedL = p.liftL > 0.3, raisedR = p.liftR > 0.3;
    // a raised claw is drawn last, in front of the head
    const order = raisedL && !raisedR ? ['R', 'L'] : raisedR && !raisedL ? ['L', 'R'] : ['R', 'L'];
    for (const o of order) {
      if (o === 'L') layer(S, L => fore(L, shL, p.cL, p.bL, 0, p.spL, p.liftL));
      else layer(S, L => fore(L, shR, p.cR, p.bR, 0.6, p.spR, p.liftR));
    }

    S.outline();

    // ---------------- emissive: eyes, throat, smoke, fire ----------------
    const eyeY = hp[1] - 1 * hk;
    if (!(p.shut > 0.5)) {
      for (const sd of [-1, 1]) aura(S, hp[0] + sd * 5 * hk, eyeY, 4, 3, ['#610', '#c40'], { k: 0.5, only: (x, y) => !S.opaque(x, y) || inRamp(S, x, y, SCALE) !== undefined && inRamp(S, x, y, SCALE) < 4 });
    }
    const nostril = [hp[0], hp[1] + 10 * hk];
    if (!q.st && !q.hu) smoke(S, nostril[0], nostril[1], f, hk, q.w ? 0.6 : 1);
    for (const sd of [-1, 1]) aura(S, nostril[0] + sd * 2.5 * hk, nostril[1] - 1, 2.5, 2, ['#a20', '#f70'], { k: 0.35 + p.tg * 0.4, over: true, only: (x, y) => inRamp(S, x, y, SCALE) !== undefined });
    if (p.tg > 0.7 && !q.st) {
      // embers and heat spilling from the parted jaws
      const mx = hp[0], my = hp[1] + (13 + p.jo * 7) * hk;
      aura(S, mx, my, 9, 7, ['#610', '#a20', '#e50'], { k: 0.7 });
      const r = U.rng(31);
      for (let i = 0; i < 8; i++) {
        const ex = mx + (r() - 0.5) * 22, ey = my - r() * 16;
        if (!S.opaque(ex, ey)) S.px(ex, ey, i % 3 ? '#fa2' : '#fd5');
      }
    }
    if (p.fire > 0) breath(S, hp[0], hp[1] + (11 + p.jo * 6) * hk, 2);

    if (q.st && q.dir !== 0) {
      const cols = ['#610', '#c32', '#f86', '#fdb'];
      const overWing = (x, y) => inRamp(S, x, y, DRW) !== undefined;
      const rake = (pts, side) => {
        for (let i = -1; i <= 1; i++) swoosh(S, pts.map(([x, y]) => [x + i * 6, y + Math.abs(i) * 2]), 4, cols, { behind: true, side, over: overWing });
      };
      if (q.dir < 0) rake([[24, 6], [16, 36], [24, 70], [44, 100], [62, 122]], -1);
      else rake([[144, 6], [152, 36], [144, 70], [124, 100], [106, 122]], 1);
    }
    clearRing(S);
  }

  function dragonPortrait(S) {
    crisp(S, 0.5, 1.2);
    S.poly([[-2, 24], [-2, 4], [8, 16]], DRW, { grad: [-2, 4, 8, 20, 0.25, 0.6] });
    S.poly([[26, 24], [26, 4], [16, 16]], DRW, { grad: [26, 4, 16, 20, 0.2, 0.5] });
    S.capsule(12, 30, 12, 18, 8, 6, SCALE, { lo: 1, rim: 0.4 });
    S.poly([[9, 19], [15, 19], [16, 25], [8, 25]], BELLY, { grad: [9, 19, 15, 25, 0.8, 0.35] });
    dragonHead(S, 12, 9.5, { k: 0.66, jo: 0.35, tg: 0.8 });
    S.outline();
  }

  EN['Red Dragon'] = { w: 168, h: 136, anchor: [84, 134], center: [84, 82], mouth: [84, 38], draw: drawDragon, portrait: dragonPortrait };

})();
