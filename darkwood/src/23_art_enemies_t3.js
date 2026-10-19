// ================================================================
// ENEMIES — TIER III "The Iron Ring"
// Ogre · Troll · Basilisk · Werewolf · Vampire
//
// Each creature is a small rig posed from key poses (idle loop, three
// wind-ups, three strikes, hurt); half wind-ups blend idle toward the
// full cocked pose. The upper body is sheared/scaled about the hips,
// limbs are solved with two-bone IK toward screen-space targets so the
// wind-up tell lands exactly where the player needs to read it.
// ================================================================
(() => {
  const K = DW.kit, P = DW.pal, U = DW.util;
  const EN = DW.art.enemies;
  const R = P.ramps;
  const clamp = U.clamp;
  const lerp = (a, b, t) => a + (b - a) * t;
  const D2R = Math.PI / 180;

  // ---------------------------------------------------------------
  // Pose decoding & key-pose blending
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
      else if (Array.isArray(vb) && Array.isArray(va)) o[k] = vb.map((v, i) => (typeof v === 'number' ? lerp(va[i], v, t) : v));
      else o[k] = vb;
    }
    for (const k in a) if (!(k in o)) o[k] = a[k];
    return o;
  };

  // keys: { idle(f), wl, wh, wr, sl, sh, sr, hurt, wl5?, wh5?, wr5? }
  // A '5' key overrides the plain halfway blend for wind 0.5.
  const resolve = (keys, q) => {
    const base = keys.idle(0);
    let p;
    if (q.hu) p = keys.hurt;
    else if (q.st) p = keys[['sl', 'sh', 'sr'][q.dir + 1]];
    else if (q.w) {
      const n = ['wl', 'wh', 'wr'][q.dir + 1];
      p = q.w >= 1 ? keys[n] : lerpObj(lerpObj(base, keys[n], 0.5), keys[n + '5'] || {}, 1);
    } else p = keys.idle(q.f);
    return lerpObj(base, p, 1);
  };

  // Upper-body transform: shear (lean) above the hip pivot py, scale about the anchor.
  const mkT = (p, ax, ay, py) => {
    const s = p.s || 1, lean = p.lean || 0, dx = p.dx || 0, dy = p.dy || 0;
    const X = (x, y) => ax + (x - ax + Math.max(0, py - y) * lean) * s + dx;
    const Y = (x, y) => ay + (y - ay) * s + dy;
    return { s, X, Y, P: (x, y) => [X(x, y), Y(x, y)] };
  };

  // Primitives in model space through transform T.
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

  // Crisper shading: flat colour clusters, dithered only across the middle of
  // each ramp step. contrast > 1 steepens the light falloff (carves form).
  const crisp = (S, zone = 0.5, contrast = 1) => {
    S.shadePx = function (x, y, ramp, I, o = {}) {
      ramp = P.ramp(ramp);
      const lo = o.lo !== undefined ? o.lo : 0, hi = o.hi !== undefined ? o.hi : ramp.length - 1;
      if (contrast !== 1 && o.tone === undefined) I = 0.55 + (I - 0.55) * contrast;
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

  // Shift ramp pixels inside an ellipse by d steps (spots, stripes, shadow pools).
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
  // Re-map pixels of ramp A inside an ellipse to the same index of ramp B (mottling).
  const mottleAt = (S, A, B, cx, cy, rx, ry, dIdx = 0) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const ex = (x + 0.5 - cx) / rx, ey = (y + 0.5 - cy) / ry;
        if (ex * ex + ey * ey > 1) continue;
        const i = inRamp(S, x, y, A);
        if (i === undefined) continue;
        S.set(x, y, B[clamp(i + dIdx, 0, B.length - 1)]);
      }
    }
  };
  const spotList = (seed, n, x0, y0, w, h, r0 = 0.9, r1 = 1.1) => {
    const r = U.rng(seed), a = [];
    for (let i = 0; i < n; i++) a.push([x0 + r() * w, y0 + r() * h, r0 + r() * r1, (r0 + r() * r1) * 0.75]);
    return a;
  };
  // Deterministic points along a limb segment (move with the limb).
  const limbPts = (x1, y1, x2, y2, rad, n, seed) => {
    const r = U.rng(seed);
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const a = [];
    for (let i = 0; i < n; i++) {
      const t = 0.1 + r() * 0.8, o = (r() - 0.5) * 1.4 * rad;
      a.push([x1 + dx * t + nx * o, y1 + dy * t + ny * o, 0.9 + r() * 1.1, 0.8 + r() * 0.7]);
    }
    return a;
  };
  // A wart / pustule: lit cap, dark underside.
  const wart = (S, ramp, x, y, big) => {
    x = Math.round(x); y = Math.round(y);
    const i = inRamp(S, x, y, ramp);
    if (i === undefined) return;
    const up = clamp(i + 2, 0, ramp.length - 1), dn = clamp(i - 2, 0, ramp.length - 1);
    S.set(x, y, ramp[up]);
    if (big) { S.set(x + 1, y, ramp[clamp(i + 1, 0, ramp.length - 1)]); S.set(x, y + 1, ramp[dn]); S.set(x + 1, y + 1, ramp[dn]); }
    else S.set(x, y + 1, ramp[dn]);
  };

  // Deterministic shaggy fur edge: tufts keyed to body-relative coords so fur doesn't boil.
  const shagD = (S, ramp, key, p = 0.35, test) => {
    const m = rmap(ramp), src = S.data.slice(), w = S.w, h = S.h;
    const dirs = [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1]];
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const v = src[y * w + x];
      if (!v || !m.has(v)) continue;
      if (test && !test(x, y)) continue;
      const [kx, ky] = key(x, y);
      dirs.forEach(([ox, oy], di) => {
        const nx = x + ox, ny = y + oy;
        if (nx < 2 || ny < 2 || nx > w - 3 || ny > h - 3 || src[ny * w + nx]) return;
        if (hash2(kx * 7 + di, ky * 13 - di) < p * (oy > 0 ? 1.3 : oy < 0 ? 0.6 : 1)) S.set(nx, ny, ramp[Math.max(1, m.get(v) - 1)]);
      });
    }
  };

  // Motion swoosh along a Catmull-Rom path: bright leading edge dithering away
  // across its width. side ±1 picks the side the band grows on.
  // o.behind: only paint transparent pixels (trails behind the body).
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
      if (o.behind && S.opaque(px, py)) continue;
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

  // Rake marks: n parallel thin crescents (claw slashes) along a path, offset sideways.
  const rake = (S, pts, n, gap, cols, o = {}) => {
    const dx = pts[pts.length - 1][0] - pts[0][0], dy = pts[pts.length - 1][1] - pts[0][1];
    const L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * gap;
      swoosh(S, pts.map(([x, y]) => [x + nx * off, y + ny * off]), o.w || 2.2, cols, { behind: o.behind, side: o.side || 1 });
    }
  };

  // Smooth 2D value noise (two octaves), deterministic.
  const vnoise = (x, y, seed = 0) => {
    const one = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const h = (a, b) => hash2(a + seed * 101, b - seed * 37);
      const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
      return lerp(lerp(h(xi, yi), h(xi + 1, yi), sx), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), sx), sy);
    };
    return one(x, y) * 0.65 + one(x * 2.1 + 17, y * 2.1 - 5) * 0.35;
  };
  // Mottle every ramp-A pixel with ramp B where body-space noise is high; the
  // blotch edges are Bayer-dithered. inv(x,y) maps screen -> body space so the
  // pattern rides on the body instead of boiling between frames.
  const mottleField = (S, A, B, inv, scale, th, seed, test) => {
    const m = rmap(A);
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      const v = S.data[y * S.w + x];
      if (!v) continue;
      const i = m.get(v);
      if (i === undefined) continue;
      if (test && !test(x, y)) continue;
      const [mx, my] = inv(x, y);
      const n = vnoise(mx / scale, my / scale, seed);
      if (n > th + (P.thresh(x, y) - 0.5) * 0.06) S.data[y * S.w + x] = P.toInt(B[Math.min(i, B.length - 1)]);
    }
  };
  // Pores / grain: darken a sparse, body-keyed set of mid-tone pixels.
  const grain = (S, A, inv, density, seed, d = -1, minI = 3) => {
    const m = rmap(A);
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      const v = S.data[y * S.w + x];
      if (!v) continue;
      const i = m.get(v);
      if (i === undefined || i < minI) continue;
      const [mx, my] = inv(x, y);
      if (hash2(Math.round(mx) + seed, Math.round(my) * 3 - seed) < density) S.data[y * S.w + x] = P.toInt(A[clamp(i + d, 0, A.length - 1)]);
    }
  };
  // Inverse of mkT (screen -> body space).
  const invT = (p, ax, ay, py) => {
    const s = p.s || 1, lean = p.lean || 0, dx = p.dx || 0, dy = p.dy || 0;
    return (x, y) => {
      const my = (y - ay - dy) / s + ay;
      return [(x - ax - dx) / s + ax - Math.max(0, py - my) * lean, my];
    };
  };
  // Paint fn into its own layer, give it a soft dark rim (separates overlapping
  // forms, as a pixel artist would), then composite it.
  const layer = (S, fn, darken = 0.35) => {
    const L = K.create(S.w, S.h);
    L.shadePx = S.shadePx;
    fn(L);
    L.outline(null, { selective: true, darken });
    S.stamp(L, 0, 0);
    return L;
  };

  // Rim light: brighten ramp pixels on the silhouette's right edge (back-light).
  const rimLight = (S, ramp, steps = 2, test) => {
    const m = rmap(ramp), src = S.data.slice(), w = S.w;
    for (let y = 1; y < S.h - 1; y++) for (let x = 1; x < w - 2; x++) {
      const v = src[y * w + x];
      if (!v) continue;
      const i = m.get(v);
      if (i === undefined) continue;
      if (test && !test(x, y)) continue;
      const d = !src[y * w + x + 1] ? steps : !src[y * w + x + 2] ? steps - 1 : 0;
      if (d > 0 && (src[(y - 1) * w + x] || src[(y + 1) * w + x])) S.data[y * w + x] = P.toInt(ramp[Math.min(ramp.length - 1, i + d)]);
    }
  };

  // Shared colours
  const MOUTH = ['#100', '#200', '#301', '#502', '#713', '#934'];
  const IRON = ['#000', '#101', '#112', '#223', '#334', '#445', '#667', '#889', '#aab'];
  const HIDE = ['#100', '#200', '#310', '#321', '#432', '#643', '#754', '#865'];
  const SWISH = ['#334', '#667', '#aab', '#eef'];

  // ===============================================================
  // OGRE — enormous, stupid, a fat-bellied brute whose boulder fists
  // are its weapons. Small head sunk between huge shoulders, tiny eyes,
  // tusked underbite, topknot. Belt of skulls, broken arena manacles.
  // fL/fR = fist targets (screen), kL/kR = fist scale, bL/bR = elbow bend.
  // front: -1/1 = that arm crosses in front (strike), 2 = arms over the head, 3 = slam.
  // ===============================================================
  const OGRE = ['#101', '#211', '#221', '#321', '#331', '#442', '#552', '#663', '#774', '#885', '#9a6', '#bb8'];
  const RUDDY = ['#101', '#201', '#211', '#321', '#431', '#532', '#643', '#753', '#864', '#975', '#a86', '#cb8'];
  const OG_HAIR = ['#000', '#101', '#111', '#212', '#322', '#433'];

  const ogreKeys = {
    idle: f => {
      const br = [0, 1, 2, 1][f], sw = [0, 1, 0, -1][f];
      return {
        lean: 0, dx: 0, dy: [0, 0, 1, 0][f], s: 1, hx: 0, hy: [0, 0, 1, 1][f], tilt: 0, mo: 0.45, shut: 0,
        belly: br, fL: [17 + sw, 92 + (br >> 1)], fR: [103 + sw, 92 + (br >> 1)], kL: 1, kR: 1, bL: 1, bR: -1, front: 0,
      };
    },
    // left fist hauled up high over the screen-left shoulder; torso twists left
    wl: { lean: -0.13, dx: -3, dy: -2, hx: -4, hy: -1, mo: 0.9, fL: [20, 17], fR: [82, 84], kL: 1.12, bL: -1, bR: -1, aL: 0.7, belly: 1 },
    wl5: { fL: [18, 40], bL: -1, fR: [92, 88], bR: -1, aL: 0.85 },
    // both fists raised high above the head for a slam
    wh: { lean: 0, dx: 0, dy: -4, hx: 0, hy: 2, mo: 1, fL: [45, 14], fR: [75, 14], kL: 1.12, kR: 1.12, bL: -1, bR: 1, belly: 2, front: 2 },
    wh5: { fL: [24, 36], fR: [96, 36], bL: -1, bR: 1, front: 2 },
    // right fist hauled up high over the screen-right shoulder
    wr: { lean: 0.13, dx: 3, dy: -2, hx: 4, hy: -1, mo: 0.9, fR: [100, 17], fL: [38, 84], kR: 1.12, bR: 1, bL: 1, aR: 0.7, belly: 1 },
    wr5: { fR: [102, 40], bR: 1, fL: [28, 88], bL: 1, aR: 0.85 },
    // strikes: the fist comes through in front of the belly toward the viewer
    sl: { lean: 0.1, dx: 4, dy: 6, s: 1.05, hx: 5, hy: 2, mo: 1, fL: [68, 88], kL: 1.5, fR: [98, 92], bL: 1, bR: -1, front: -1 },
    sh: { lean: 0, dx: 0, dy: 8, s: 1.06, hx: 0, hy: 3, mo: 1, fL: [49, 98], fR: [71, 98], kL: 1.4, kR: 1.4, bL: 1, bR: -1, front: 3 },
    sr: { lean: -0.1, dx: -4, dy: 6, s: 1.05, hx: -5, hy: 2, mo: 1, fR: [52, 88], kR: 1.5, fL: [22, 92], bL: 1, bR: -1, front: 1 },
    hurt: { lean: 0.1, dx: 3, dy: -1, s: 0.97, hx: 4, hy: -4, tilt: 1, mo: 1, shut: 1, fL: [16, 78], fR: [104, 70], bL: 1, bR: -1, aL: 0.85, aR: 0.8, belly: 0 },
  };

  // Fist. (ux,uy) = direction the knuckles lead (along the forearm). front: knuckles to the viewer.
  function ogreFist(S, x, y, ux, uy, k, lo, front) {
    const o = { lo, hi: 11, spec: 0.1, rim: 0.3 };
    if (front) {
      S.ball(x, y + 0.5 * k, 10.5 * k, 9.5 * k, OGRE, o);
      // curled fingers: four fat segments across the front
      for (let i = 0; i < 4; i++) {
        const fx = x + (-5.6 + i * 3.7) * k, fy = y + 1.5 * k;
        S.ball(fx, fy, 2.2 * k, 3.6 * k, OGRE, { lo: lo + 0.5, hi: 11, spec: 0.2 });
      }
      // knuckle ridge on top
      for (let i = 0; i < 4; i++) {
        const fx = x + (-5.6 + i * 3.7) * k, fy = y - 3.8 * k;
        S.ball(fx, fy, 2.3 * k, 2 * k, OGRE, { lo: lo + 1, hi: 11, spec: 0.4 });
      }
      for (let i = 0; i < 3; i++) { const lx = x + (-3.7 + i * 3.7) * k; S.line(lx, y - 1 * k, lx, y + 4.5 * k, OGRE[2]); }
      // thumb clamped across the fingers
      S.capsule(x - 9 * k, y + 4.5 * k, x - 0.5 * k, y + 6.5 * k, 2.7 * k, 2.4 * k, OGRE, { lo: lo + 0.5, hi: 10.5, spec: 0.2 });
      S.px(x - 1 * k, y + 6 * k, '#998');
      return;
    }
    const nx = -uy, ny = ux;
    S.ball(x, y, 9.5 * k, 9 * k, OGRE, o);
    for (let i = -1.5; i <= 1.5; i += 1) {
      const kx = x + ux * 5.6 * k + nx * i * 4 * k, ky = y + uy * 5.6 * k + ny * i * 4 * k;
      S.ball(kx, ky, 2.8 * k, 2.6 * k, OGRE, { lo: lo + 0.5, hi: 11, spec: 0.3 });
    }
    for (let i = -1; i <= 1; i++) {
      const cx = x + ux * 3 * k + nx * i * 4 * k, cy = y + uy * 3 * k + ny * i * 4 * k;
      S.line(cx, cy, cx + ux * 4.5 * k, cy + uy * 4.5 * k, OGRE[2]);
    }
    const tx = x - ux * 1 * k + nx * 4.5 * k, ty = y - uy * 1 * k + ny * 4.5 * k;
    S.capsule(tx, ty, tx + ux * 4 * k - nx * 3 * k, ty + uy * 4 * k - ny * 3 * k, 2.6 * k, 2.2 * k, OGRE, { lo: lo + 0.5, hi: 10.5 });
  }

  // Iron manacle with a broken chain dangling from it.
  function manacle(S, x, y, ux, uy, k, swing) {
    const nx = -uy, ny = ux;
    S.capsule(x - nx * 7 * k, y - ny * 7 * k, x + nx * 7 * k, y + ny * 7 * k, 2.8 * k, 2.8 * k, IRON, { lo: 1, spec: 0.8 });
    S.line(x - nx * 6 * k + ux * 1.5, y - ny * 6 * k + uy * 1.5, x + nx * 6 * k + ux * 1.5, y + ny * 6 * k + uy * 1.5, IRON[2]);
    for (const t of [-0.6, 0.6]) S.px(x + nx * 7 * t * k, y + ny * 7 * t * k, IRON[8]);
    // chain: three links hanging under gravity from the low side
    const lowSide = ny > 0 ? 1 : -1;
    let cx = x + nx * 5 * k * lowSide, cy = y + ny * 5 * k * lowSide + 2;
    for (let i = 0; i < 3; i++) {
      const lx = Math.round(cx + swing * (i + 1) * 0.4), ly = Math.round(cy + 2);
      if (i % 2 === 0) { S.rect(lx - 1, ly - 1, 3, 4, IRON[3]); S.px(lx, ly, null); S.px(lx, ly + 1, null); S.px(lx - 1, ly - 1, IRON[7]); S.px(lx - 1, ly, IRON[6]); }
      else { S.rect(lx, ly - 1, 1, 4, IRON[6]); S.px(lx, ly - 1, IRON[8]); }
      cx = lx; cy = ly + 2.5;
    }
  }

  function ogreHead(S, x, y, o = {}) {
    const k = o.k || 1, mo = o.mo || 0, tl = o.tilt || 0;
    // small cauliflower ears
    S.ball(x - 10.5 * k, y + 1 * k, 3 * k, 4 * k, OGRE, { lo: 1, hi: 9 });
    S.ball(x + 10.5 * k, y + 1 * k, 3 * k, 4 * k, OGRE, { lo: 1, hi: 8 });
    S.px(x - 10 * k, y + 1 * k, OGRE[3]); S.px(x + 10 * k, y + 1 * k, OGRE[2]);
    // greasy topknot: a bound tuft flopping to one side, splayed at the end
    const tx = x + 1 * k, ty = y - 11 * k;
    if (o.knot !== false) S.horn(tx, ty, tx + 1 * k, ty - 6 * k, tx + 6 * k, ty - 7 * k + tl, 3.4 * k, 1.8 * k, OG_HAIR, { lo: 1, spec: 0.6 });
    if (o.knot !== false) {
      S.horn(tx + 5 * k, ty - 7 * k + tl, tx + 8 * k, ty - 7 * k + tl, tx + 10 * k, ty - 3 * k + tl, 1.6 * k, 0.5, OG_HAIR, { lo: 1, spec: 0.4 });
      S.horn(tx + 5 * k, ty - 7 * k + tl, tx + 9 * k, ty - 9 * k + tl, tx + 11 * k, ty - 7 * k + tl, 1.3 * k, 0.5, OG_HAIR, { lo: 1, spec: 0.4 });
    }
    // skull (narrow, small) and heavy jowls
    S.ball(x, y - 1.5 * k, 10 * k, 10.5 * k, OGRE, { lo: 1, hi: 11, spec: 0.18, rim: 0.3 });
    S.ball(x, y + 4 * k, 11 * k, 6.5 * k, OGRE, { lo: 1, hi: 10, rim: 0.3 });
    if (o.knot !== false) S.capsule(tx - 2.5 * k, ty + 0.5, tx + 2.5 * k, ty - 0.5, 1.2 * k, 1.2 * k, R.bone, { lo: 3, hi: 8, spec: 0.4 });
    // brow: a thick shelf hiding the eyes, with a dark band of shadow under it
    S.ball(x, y - 3 * k + tl * 0.5, 10 * k, 3.6 * k, OGRE, { lo: 2, hi: 11, spec: 0.25 });
    const ey = Math.round(y + 0.6 * k + tl * 0.5);
    S.rect(Math.round(x - 7 * k), ey, Math.round(14 * k) + 1, 2, OGRE[2]);
    for (const sd of [-1, 1]) {
      const ex = Math.round(x + sd * 4 * k - 0.5);
      S.rect(ex - 1, ey, 3, 2, '#101');
      if (o.shut) { S.line(ex - 2, ey - 1, ex + 1, ey + 1, OGRE[5]); continue; }
      S.px(ex + (sd < 0 ? 1 : 0), ey, '#ff8'); S.px(ex + (sd < 0 ? 0 : 1), ey, '#c70');
    }
    // flat, wide, broken nose
    S.ball(x - 0.5 * k, y + 3.6 * k, 4.2 * k, 3 * k, OGRE, { lo: 2, hi: 11, spec: 0.3 });
    S.px(x - 2 * k, y + 5.2 * k, '#101'); S.px(x + 1.5 * k, y + 5.2 * k, '#101');
    // mouth: the underbite jaw juts forward and drops when it gapes
    const jd = mo * 3.2 * k;
    const my = y + 7.5 * k;
    if (mo > 0.2) {
      S.ellipse(x, my + jd * 0.5, 7.5 * k, 1.2 + jd * 0.55, MOUTH[1]);
      S.ellipse(x + 1, my + jd * 0.75, 3.5 * k, 0.8 + jd * 0.3, MOUTH[4]);
    }
    // underbite: the lower jaw is wider than the face and juts out under it
    S.ball(x, my + 3.2 * k + jd, 11.5 * k, 5 * k, OGRE, { lo: 1, hi: 10.5, spec: 0.15, rim: 0.3 });
    S.line(x - 9 * k, my + jd, x + 9 * k, my + jd, OGRE[1]);
    S.line(x - 7 * k, my + 1 + jd, x + 7 * k, my + 1 + jd, OGRE[8]);
    // a few stubby lower teeth over the lip
    for (const i of [-1.6, 1.6]) {
      const tx2 = Math.round(x + i * 1.7 * k), ty2 = Math.round(my + jd - 1);
      S.px(tx2, ty2, '#ccb'); S.px(tx2, ty2 + 1, '#887');
    }
    // stubby boar tusks from the jaw corners, curving up and out past the lip
    const TUSK = ['#110', '#221', '#432', '#654', '#875', '#a97', '#cb9', '#dda'];
    for (const sd of [-1, 1]) {
      const bx = x + sd * 6.5 * k, by = my + 1.5 * k + jd;
      S.horn(bx, by, bx + sd * 3 * k, by - 1.5 * k, bx + sd * 2.5 * k, by - 6.5 * k - jd * 0.3, 2.4 * k, 0.8, TUSK, { lo: 2, spec: 0.4 });
    }
    // warts, a scalp scar
    wart(S, OGRE, x - 5 * k, y - 8 * k, true); wart(S, OGRE, x + 7 * k, y - 5 * k, false); wart(S, OGRE, x + 5 * k, y + 10 * k, false);
    S.line(x + 2 * k, y - 9 * k, x + 6 * k, y - 6 * k, OGRE[3]);
  }

  function drawOgre(S, pose) {
    crisp(S, 0.5, 1.25);
    const q = decode(pose);
    const p = resolve(ogreKeys, q);
    const T = mkT(p, 60, 117, 88), W = wrap(S, T), s = T.s;
    const inv = invT(p, 60, 117, 88);
    const bl = p.belly || 0;

    const shL = T.P(33, 45), shR = T.P(87, 45);
    const head = T.P(60 + p.hx, 29 + p.hy);
    const hipL = T.P(48, 92), hipR = T.P(72, 92);
    const footL = [42, 114], footR = [78, 114];

    // ---- legs: short tree trunks, knees bowed out ----
    const leg = (hip, foot, sd, lo) => {
      const kx = lerp(hip[0], foot[0], 0.45) + sd * 3, ky = lerp(hip[1], foot[1], 0.5);
      S.capsule(hip[0], hip[1], kx, ky, 10 * s, 8.5, OGRE, { lo, hi: 10, rim: 0.3 });
      S.capsule(kx, ky, foot[0], foot[1] - 3, 8.5, 7, OGRE, { lo, hi: 10, rim: 0.3 });
      S.ball(kx + sd * 0.5, ky, 6, 5, OGRE, { lo: lo + 0.5, hi: 10.5, spec: 0.2 });
      // foot: flat, splayed, thick yellow toenails
      S.ball(foot[0] + sd * 2, foot[1], 10, 4.5, OGRE, { lo, hi: 9.5 });
      for (let i = 0; i < 4; i++) {
        const tx = Math.round(foot[0] + sd * 2 - 7 + i * 4.5), ty = foot[1] + 2;
        S.rect(tx, ty, 2, 1, '#bb9'); S.px(tx + 1, ty, '#887');
      }
    };
    leg(hipL, footL, -1, 0.5);
    leg(hipR, footR, 1, 0.2);

    // ---- torso ----
    W.ball(60, 38, 26, 11, OGRE, { lo: 1, hi: 9 });                       // traps hump
    W.ball(60, 52, 31, 15, OGRE, { lo: 0.5, hi: 10, rim: 0.4 });           // chest
    W.ball(60, 72 - bl * 0.3, 29 + bl * 0.4, 22 + bl * 0.3, OGRE, { lo: 0.5, hi: 11, spec: 0.12, rim: 0.4 }); // belly
    W.ball(47, 52, 12, 8.5, OGRE, { lo: 1, hi: 11, spec: 0.12 });          // pecs
    W.ball(73, 52, 12, 8.5, OGRE, { lo: 1, hi: 10, rim: 0.3 });
    W.line(37, 59, 50, 61, OGRE[3]); W.line(70, 61, 83, 59, OGRE[2]);
    W.line(38, 60, 49, 62, OGRE[5]);
    // belly: navel, sparse hair, overhang shadow over the belt
    W.ball(60, 80, 2, 1.5, OGRE, { lo: 0, hi: 3 });
    W.px(60, 79, OGRE[8]);
    for (const [hx, hy] of [[58, 72], [62, 74], [60, 69], [57, 76], [63, 77], [60, 84], [58, 87], [62, 86], [61, 65], [59, 62]]) W.px(hx, hy, OGRE[3]);
    W.poly([[36, 86], [84, 86], [76, 91], [44, 91]], OGRE, { tone: 0.1 });
    // old whip scars across the chest (the Iron Ring's mark)
    W.line(43, 48, 50, 54, RUDDY[3]); W.line(44, 48, 51, 54, RUDDY[9]);
    for (const t of [0.25, 0.6]) W.line(lerp(43, 50, t) - 1, lerp(48, 54, t) + 1.5, lerp(43, 50, t) + 1.5, lerp(48, 54, t) - 1, RUDDY[3]);
    W.line(70, 58, 76, 54, RUDDY[3]); W.line(70, 59, 76, 55, RUDDY[8]);

    // ---- belt of skulls & loincloth ----
    W.poly([[47, 90], [73, 90], [76, 108], [70, 105], [65, 110], [59, 106], [53, 110], [48, 105], [44, 108]], HIDE, { grad: [60, 90, 60, 110, 0.65, 0.12] });
    W.line(54, 93, 52, 104, '#200'); W.line(66, 93, 68, 104, '#200');
    const belt = t => T.P(lerp(34, 86, t), 87 + Math.sin(t * Math.PI) * 4);
    let prev = belt(0);
    for (let i = 1; i <= 16; i++) {
      const pt = belt(i / 16);
      S.capsule(prev[0], prev[1], pt[0], pt[1], 1.7 * s, 1.7 * s, R.wood, { lo: 1, hi: 6, spec: 0.3 });
      prev = pt;
    }
    for (let i = 0; i < 5; i++) {
      const pt = belt(0.14 + i * 0.18);
      const sx = pt[0], sy = pt[1] + 3.2 * s, k = (i === 2 ? 1.2 : 1) * s;
      S.ball(sx, sy, 3.6 * k, 3.4 * k, R.bone, { lo: 2, spec: 0.35 });
      S.ball(sx, sy + 2.6 * k, 2.2 * k, 1.4 * k, R.bone, { lo: 2, hi: 7 });
      S.px(sx - 1.4 * k, sy, '#101'); S.px(sx + 1.2 * k, sy, '#101');
      S.px(sx - 1.4 * k, sy + 0.8, '#211'); S.px(sx + 1.2 * k, sy + 0.8, '#211');
      S.px(sx, sy + 1.8 * k, '#432');
      S.px(sx - 1, sy + 3.5 * k, '#554'); S.px(sx + 1, sy + 3.5 * k, '#554');
    }

    // ---- arms (each in its own outlined layer) ----
    const L1 = 25, L2 = 24;
    const sw = q.idle ? [0, 1, 0, -1][q.f] : (q.dir || 0);
    const doArm = (sh, hand, bend, lo, k, front, fs = 1) => layer(S, A => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], L1 * s * fs, L2 * s * fs, bend);
      const o = { lo, hi: 10.5, rim: 0.35 };
      A.ball(sh[0], sh[1], 12 * s, 11 * s, OGRE, { lo, hi: 11, spec: 0.12, rim: 0.3 });   // deltoid
      A.capsule(sh[0], sh[1], j.ex, j.ey, 9 * s, 7 * s, OGRE, o);
      A.ball(j.ex, j.ey, 6.5 * s, 6.5 * s, OGRE, { lo: lo - 0.3, hi: 9.5 });
      const mx = lerp(j.ex, j.hx, 0.42), my = lerp(j.ey, j.hy, 0.42);
      A.capsule(j.ex, j.ey, mx, my, 7 * s, 9 * s, OGRE, o);
      A.capsule(mx, my, j.hx, j.hy, 9 * s, 7 * s, OGRE, o);
      const dx = j.hx - j.ex, dy = j.hy - j.ey, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      // forearm hair
      for (let i = 0; i < 5; i++) A.px(lerp(j.ex, j.hx, 0.25 + i * 0.12) + (i % 2 ? 2 : -2), lerp(j.ey, j.hy, 0.25 + i * 0.12) - 2, OGRE[3]);
      manacle(A, lerp(j.hx, j.ex, 0.3), lerp(j.hy, j.ey, 0.3), ux, uy, s * Math.min(k, 1.15), sw);
      ogreFist(A, j.hx + ux * 2, j.hy + uy * 2, ux, uy, k * s, lo, !!front);
    });
    const doL = fr => doArm(shL, p.fL, p.bL, 0.5, p.kL, fr, p.aL || 1);
    const doR = fr => doArm(shR, p.fR, p.bR, 0.2, p.kR, fr, p.aR || 1);
    if (p.front === -1) { doR(); doL(1); }
    else if (p.front === 1) { doL(); doR(1); }
    else if (p.front === 3) { doL(1); doR(1); }
    else if (p.front !== 2) { doL(); doR(); }

    // ---- head (sunk between the shoulders) ----
    ogreHead(S, head[0], head[1], { k: s, mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt * 2 });
    if (q.idle) {   // drool string swinging from the jaw
      const dl = [2, 4, 6, 3][q.f];
      const dx0 = Math.round(head[0] + 4), dy0 = Math.round(head[1] + 15);
      for (let i = 0; i < dl; i++) S.px(dx0, dy0 + i, i === dl - 1 ? '#bdd' : '#8aa');
    }
    // overhead: both arms raised past the head
    if (p.front === 2) { doL(); doR(); }

    // ---- skin: ruddy blotches over olive, pores ----
    mottleField(S, OGRE, RUDDY, inv, 7, 0.56, 3);

    S.outline();

    // ---- swooshes ----
    if (q.st) {
      if (q.dir < 0) swoosh(S, [[22, 4], [8, 26], [6, 56], [18, 82], [42, 104]], 8, SWISH, { behind: true, side: -1 });
      else if (q.dir > 0) swoosh(S, [[98, 4], [112, 26], [114, 56], [102, 82], [78, 104]], 8, SWISH, { behind: true, side: 1 });
      else {
        swoosh(S, [[50, 2], [36, 12], [26, 40], [28, 70]], 6, SWISH, { behind: true, side: -1 });
        swoosh(S, [[70, 2], [84, 12], [94, 40], [92, 70]], 6, SWISH, { behind: true, side: 1 });
      }
    }
  }

  function ogrePortrait(S) {
    crisp(S, 0.5, 1.25);
    S.ball(12, 23, 13, 6, OGRE, { lo: 1, hi: 9, rim: 0.3 });          // traps
    S.ball(0, 21, 9, 8, OGRE, { lo: 1, hi: 10.5, spec: 0.12 });         // shoulders
    S.ball(24, 21, 9, 8, OGRE, { lo: 0.5, hi: 9.5, rim: 0.3 });
    ogreHead(S, 12, 12, { k: 0.82, mo: 0.55, knot: false });
    mottleField(S, OGRE, RUDDY, (x, y) => [x * 1.5, y * 1.5], 7, 0.56, 3);
    S.outline();
  }

  EN['Ogre'] = { w: 120, h: 120, anchor: [60, 117], center: [60, 64], mouth: [60, 40], draw: drawOgre, portrait: ogrePortrait };

  // ===============================================================
  // TROLL — tall, lanky, hunched; arms hang nearly to the ground.
  // Warty grey-green hide, wild black hair, long hooked nose, horn
  // claws. A wound on its chest knits shut under a pulsing green glow.
  // hL/hR = claw targets (screen), kL/kR = hand scale, hunch 1..0.
  // ===============================================================
  const TROLL = ['#001', '#011', '#112', '#122', '#232', '#243', '#353', '#464', '#575', '#686', '#8a7', '#ab8'];
  const TROLL_B = ['#001', '#011', '#111', '#122', '#222', '#233', '#343', '#454', '#565', '#676', '#887', '#a98'];
  const T_HAIR = ['#000', '#001', '#101', '#111', '#112', '#122', '#233', '#344'];
  const CLAW = ['#100', '#210', '#321', '#432', '#543', '#765', '#987', '#ba9', '#dcb'];
  const WOUND = ['#100', '#200', '#301', '#502', '#813', '#a34', '#c56'];

  const trollKeys = {
    idle: f => {
      const br = [0, 1, 1, 0][f], sw = [0, 1, 0, -1][f];
      return {
        lean: 0, dx: 0, dy: br, s: 1, hx: sw * 0.5, hy: [0, 1, 1, 0][f], hunch: 1, mo: 0.35, shut: 0, tilt: 0,
        hL: [24 + sw, 104], hR: [96 + sw, 104], kL: 1, kR: 1, bL: 1, bR: -1, aL: 1, aR: 1, front: 0, hair: [0, 1, 0, -1][f],
      };
    },
    // claw flung up high over the screen-left shoulder; torso twists left
    wl: { lean: -0.2, dx: -3, dy: -3, hx: -5, hy: 0, hunch: 0.6, mo: 1, hL: [15, 22], hR: [90, 98], kL: 1.15, bL: -1, bR: -1, aL: 0.6, hair: -2 },
    wl5: { hL: [21, 44], bL: -1, aL: 0.75, hunch: 0.8 },
    // straightens up tall, both claws raised overhead
    wh: { lean: 0, dx: 0, dy: -5, hx: 0, hy: 5, hunch: 0, mo: 1, hL: [29, 20], hR: [91, 20], kL: 1.1, kR: 1.1, bL: -1, bR: 1, aL: 0.62, aR: 0.62, front: 2, hair: 0 },
    wh5: { hL: [20, 26], hR: [100, 26], aL: 0.8, aR: 0.8, hunch: 0.5, front: 2 },
    // claw flung up high over the screen-right shoulder
    wr: { lean: 0.2, dx: 3, dy: -3, hx: 5, hy: 0, hunch: 0.6, mo: 1, hR: [105, 22], hL: [30, 98], kR: 1.15, bR: 1, bL: 1, aR: 0.6, hair: 2 },
    wr5: { hR: [99, 44], bR: 1, aR: 0.75, hunch: 0.8 },
    // strikes: the claw rakes down through the middle toward the viewer
    sl: { lean: 0.12, dx: 4, dy: 7, s: 1.05, hx: 5, hy: 5, hunch: 1, mo: 1, hL: [70, 96], kL: 1.5, hR: [102, 100], bL: 1, bR: -1, front: -1, hair: 2 },
    sh: { lean: 0, dx: 0, dy: 9, s: 1.06, hx: 0, hy: 6, hunch: 1, mo: 1, hL: [46, 95], hR: [74, 95], kL: 1.4, kR: 1.4, bL: 1, bR: -1, front: 3, hair: 0 },
    sr: { lean: -0.12, dx: -4, dy: 7, s: 1.05, hx: -5, hy: 5, hunch: 1, mo: 1, hR: [50, 96], kR: 1.5, hL: [18, 100], bL: 1, bR: -1, front: 1, hair: -2 },
    hurt: { lean: 0.12, dx: 3, dy: -2, s: 0.97, hx: 5, hy: -3, hunch: 0.5, tilt: 1, mo: 1, shut: 1, hL: [13, 72], hR: [104, 64], aR: 0.8, bL: 1, bR: -1, hair: 3 },
  };

  const TR_WARTS = spotList(31, 26, 42, 40, 36, 46);

  // Long-fingered claw. (ux,uy) = direction the fingers reach. spread = finger fan (radians).
  function trollClaw(S, x, y, ux, uy, k, lo, spread = 0.5) {
    const base = Math.atan2(uy, ux);
    S.ball(x, y, 5 * k, 4.6 * k, TROLL, { lo, hi: 11, rim: 0.3 });
    for (let i = 0; i < 4; i++) {
      const a = base + (i - 1.5) * spread * 0.55;
      const c = Math.cos(a), s = Math.sin(a);
      const bx = x + c * 3.5 * k, by = y + s * 3.5 * k;
      const jx = bx + c * 6 * k, jy = by + s * 6 * k;
      S.capsule(bx, by, jx, jy, 1.8 * k, 1.4 * k, TROLL, { lo: lo + 0.5, hi: 11 });
      S.ball(jx, jy, 1.6 * k, 1.6 * k, TROLL, { lo: lo + 0.5, hi: 10.5 });
      // hooked horn claw, curling toward the palm side
      const cx = jx + c * 3 * k, cy = jy + s * 3 * k;
      S.horn(jx, jy, cx, cy, cx - s * 1.8 * k * (i < 2 ? 1 : -1) + c * 1.5 * k, cy + c * 1.8 * k * (i < 2 ? 1 : -1) + s * 1.5 * k, 1.4 * k, 0.4, CLAW, { lo: 2, spec: 0.5 });
    }
    // thumb claw
    const ta = base + spread * 1.4;
    S.capsule(x, y, x + Math.cos(ta) * 6 * k, y + Math.sin(ta) * 6 * k, 1.8 * k, 1.3 * k, TROLL, { lo: lo + 0.5, hi: 10.5 });
    S.horn(x + Math.cos(ta) * 6 * k, y + Math.sin(ta) * 6 * k, x + Math.cos(ta) * 8 * k, y + Math.sin(ta) * 8 * k, x + Math.cos(ta - 0.6) * 10 * k, y + Math.sin(ta - 0.6) * 10 * k, 1.2 * k, 0.4, CLAW, { lo: 2, spec: 0.5 });
  }

  // Wild black hair: strands radiating from the crown and falling to the shoulders.
  function trollHair(S, x, y, k, sway, back) {
    const r = U.rng(back ? 71 : 72);
    const n = back ? 15 : 6;
    for (let i = 0; i < n; i++) {
      let a, L, w;
      if (back) { a = (-200 + i * (220 / (n - 1))) * D2R; L = (11 + r() * 8) * k; w = 3 * k; }
      else { a = (-150 + i * 22 + r() * 8) * D2R; L = (6 + r() * 4) * k; w = 2.2 * k; }
      const bx = x + Math.cos(a) * 6 * k, by = y - 3 * k + Math.sin(a) * 6 * k;
      // strands below the horizon fall downward (gravity), the rest bristle
      const down = Math.sin(a) > -0.3;
      const ex = bx + Math.cos(a) * L + sway * 1.5, ey = by + (down ? L * 1.1 : Math.sin(a) * L);
      const cx = bx + Math.cos(a) * L * 0.6, cy = by + Math.sin(a) * L * 0.5 - (down ? 2 : 1);
      S.horn(bx, by, cx, cy, ex, Math.max(3, ey), w, 0.5, T_HAIR, { lo: 1, spec: 0.5 });
    }
  }

  function trollHead(S, x, y, o = {}) {
    const k = o.k || 1, mo = o.mo || 0, tl = o.tilt || 0, sw = o.sway || 0;
    trollHair(S, x, y, k, sw, true);
    // long pointed ears drooping out sideways
    S.horn(x - 7 * k, y - 1 * k, x - 14 * k, y - 4 * k, x - 19 * k, y + 1 * k, 3 * k, 0.6, TROLL, { lo: 1, hi: 10.5 });
    S.horn(x + 7 * k, y - 1 * k, x + 14 * k, y - 4 * k, x + 19 * k, y + 1 * k, 3 * k, 0.6, TROLL, { lo: 1, hi: 9.5 });
    S.line(x - 9 * k, y - 1 * k, x - 15 * k, y - 1 * k, TROLL[3]); S.line(x + 9 * k, y - 1 * k, x + 15 * k, y - 1 * k, TROLL[2]);
    // lank locks hanging down beside the face
    for (const sd of [-1, 1]) for (let i = 0; i < 2; i++) {
      const bx = x + sd * (5 + i * 2.5) * k, by = y - 7 * k;
      S.horn(bx, by, bx + sd * (5 + i * 2) * k, by + 6 * k, bx + sd * (4 + i * 3) * k + sw, by + (17 + i * 3) * k, 2 * k, 0.5, T_HAIR, { lo: 1, spec: 0.5 });
    }
    // long gaunt face, jutting chin
    S.ball(x, y, 8.5 * k, 11 * k, TROLL, { lo: 1, hi: 11, spec: 0.15, rim: 0.3 });
    S.ball(x, y + 10 * k + mo * 2 * k, 6.5 * k, 4.5 * k, TROLL, { lo: 1, hi: 10, rim: 0.3 });
    // cheekbones, sunken cheeks
    S.ball(x - 5 * k, y + 1 * k, 3 * k, 2 * k, TROLL, { lo: 3, hi: 11 });
    spotAt(S, TROLL, x - 5 * k, y + 4.5 * k, 2 * k, 2.5 * k, -2);
    spotAt(S, TROLL, x + 5 * k, y + 4.5 * k, 2 * k, 2.5 * k, -2);
    // furrowed brow & deep-set burning eyes
    S.ball(x, y - 3.5 * k + tl * 0.5, 8 * k, 2.6 * k, TROLL, { lo: 2, hi: 11, spec: 0.2 });
    S.line(x - 1, y - 5 * k, x - 1, y - 2.5 * k, TROLL[3]);
    const ey = Math.round(y - 1 * k + tl * 0.5);
    for (const sd of [-1, 1]) {
      const ex = Math.round(x + sd * 3.6 * k - 0.5);
      S.rect(ex - 1, ey - 1, 3, 3, TROLL[1]);
      if (o.shut) { S.line(ex - 1, ey, ex + 1, ey, TROLL[6]); continue; }
      S.px(ex, ey, '#fd5'); S.px(ex + sd, ey, '#e52'); S.px(ex - sd, ey, '#a20');
    }
    // mouth: a wide jagged slash under the nose
    const my = Math.round(y + 9 * k);
    const mh = Math.round(1 + mo * 3.5 * k);
    S.rect(Math.round(x - 5 * k), my, Math.round(10 * k) + 1, mh, MOUTH[1]);
    if (mh > 2) S.rect(Math.round(x - 3 * k), my + mh - 2, Math.round(6 * k), 2, MOUTH[4]);
    for (let i = -2; i <= 2; i++) {
      const tx = Math.round(x + i * 2.2 * k);
      S.px(tx, my, i % 2 ? '#bb9' : '#ddb');
      if (mh > 2) S.px(tx + 1, my + mh - 1, '#bb9');
    }
    // snaggle tusks from the lower jaw
    S.horn(x - 4.5 * k, my + mh, x - 5 * k, my + mh - 2, x - 4 * k, my - 2, 1.2 * k, 0.5, CLAW, { lo: 4 });
    S.horn(x + 4.5 * k, my + mh, x + 5 * k, my + mh - 2, x + 4 * k, my - 2, 1.2 * k, 0.5, CLAW, { lo: 3 });
    // long hooked nose drooping over the upper lip
    S.horn(x - 0.5 * k, y - 3.5 * k, x + 3.5 * k, y + 2 * k, x + 1 * k, y + 9 * k, 1.7 * k, 2.8 * k, TROLL, { lo: 2, hi: 11, spec: 0.3 });
    S.ball(x + 1 * k, y + 8.5 * k, 2.8 * k, 2.6 * k, TROLL, { lo: 2.5, hi: 11, spec: 0.5 });
    S.line(x - 1 * k, y + 10.5 * k, x + 3 * k, y + 10.5 * k, TROLL[2]);
    wart(S, TROLL, x + 1.5 * k, y + 5 * k, false);
    wart(S, TROLL, x - 6 * k, y + 7 * k, false); wart(S, TROLL, x + 5 * k, y - 6 * k, true);
    // fringe of hair over the forehead
    trollHair(S, x, y - 1 * k, k * 0.9, sw, false);
  }

  // Wound on the chest: three gashes knitting shut under a pulsing green glow.
  function regenWound(S, x, y, f, glow) {
    const r = [4, 6, 8, 6][f] * glow;
    // faint green glow: tint pixels toward green with a dithered falloff
    if (r > 0) {
      for (let j = -Math.ceil(r); j <= Math.ceil(r); j++) for (let i = -Math.ceil(r * 1.3); i <= Math.ceil(r * 1.3); i++) {
        const d = Math.hypot(i / 1.3, j) / r;
        if (d >= 1) continue;
        const hex = S.getHex(x + i, y + j);
        if (!hex) continue;
        if (d < 0.5 || (1 - d) * 1.6 > P.thresh(x + i, y + j)) S.set(x + i, y + j, P.mix(hex, d < 0.4 ? '#8f8' : '#4b5', d < 0.4 ? 0.45 : 0.35));
      }
    }
    // the gashes, shorter as they close
    const close = [0, 0.25, 0.5, 0.25][f] * glow;
    for (let g = 0; g < 3; g++) {
      const gx = x - 4 + g * 3, gy = y - 3 + g;
      const len = 7 - close * 4;
      const x0 = gx - len * 0.35, y0 = gy - len * 0.25, x1 = gx + len * 0.55, y1 = gy + len * 0.45;
      S.line(x0, y0 + 1, x1, y1 + 1, WOUND[5]);
      S.line(x0, y0, x1, y1, WOUND[2]);
      // knitting strands of new flesh
      if (glow > 0) for (let t = 0.2; t < 0.9; t += 0.3) if (hash2(g * 7 + Math.round(t * 10), f) < 0.5 + close) S.px(lerp(x0, x1, t), lerp(y0, y1, t), '#bfa');
    }
    // motes drifting up from the wound
    if (glow > 0) for (let m = 0; m < 3; m++) {
      const mx = x - 5 + m * 5 + (f & 1), my = y - 7 - ((f + m * 2) % 4) * 3;
      S.px(mx, my, m === 1 ? '#bfa' : '#6d6');
    }
  }

  function drawTroll(S, pose) {
    crisp(S, 0.5, 1.25);
    const q = decode(pose);
    const p = resolve(trollKeys, q);
    const T = mkT(p, 60, 117, 76), W = wrap(S, T), s = T.s;
    const inv = invT(p, 60, 117, 76);
    const hu = p.hunch;

    const shL = T.P(35, 35 + hu * 3), shR = T.P(85, 35 + hu * 3);
    const head = T.P(60 + p.hx, 28 + hu * 11 + p.hy);
    const hipL = T.P(51, 76), hipR = T.P(69, 76);
    const footL = [38, 114], footR = [82, 114];

    // ---- back: hair mass spilling over the hunched shoulders, hump ----
    W.ball(47, 33 + hu * 3, 13, 8, TROLL, { lo: 0.5, hi: 8.5 });           // trapezius
    W.ball(73, 33 + hu * 3, 13, 8, TROLL, { lo: 0.5, hi: 7.5 });
    for (let i = 0; i < 4; i++) W.ball(60, 27 + hu * 4 + i * 2.4, 2.2, 1.6, TROLL, { lo: 1, hi: 9, spec: 0.3 });  // spine knobs

    // ---- legs: long, bent at the knee, big clawed feet ----
    const leg = (hip, foot, sd, lo) => {
      const kx = lerp(hip[0], foot[0], 0.5) + sd * 7, ky = lerp(hip[1], foot[1], 0.5);
      S.capsule(hip[0], hip[1], kx, ky, 6.5 * s, 4.5, TROLL, { lo, hi: 10, rim: 0.3 });
      S.capsule(kx, ky, foot[0], foot[1] - 4, 4.5, 3.5, TROLL, { lo, hi: 10, rim: 0.3 });
      S.ball(kx, ky, 4.8, 4.4, TROLL, { lo: lo + 0.5, hi: 10.5, spec: 0.25 });
      S.ball(foot[0] + sd * 2, foot[1] - 1, 8, 3.5, TROLL, { lo, hi: 9.5 });
      for (let i = 0; i < 3; i++) {
        const tx = foot[0] + sd * 2 - 6 + i * 6, ty = foot[1] + 1;
        S.horn(tx, ty - 1, tx - 1, ty + 1, tx - 2.5, ty + 1.5, 1.3, 0.4, CLAW, { lo: 2 });
      }
    };
    leg(hipL, footL, -1, 0.5);
    leg(hipR, footR, 1, 0.2);

    // ---- torso: narrow, ribby, a sagging pot belly ----
    W.ball(60, 76, 13, 6, TROLL, { lo: 0.5, hi: 9 });                     // pelvis
    W.ball(60, 52 + hu * 2, 18, 15, TROLL, { lo: 0.5, hi: 10.5, rim: 0.4 });   // ribcage
    W.ball(60, 67, 12, 9, TROLL_B, { lo: 1, hi: 10.5, spec: 0.1 });         // belly
    W.ball(50, 44 + hu * 2, 9, 6, TROLL, { lo: 1, hi: 11, spec: 0.12 });     // pecs
    W.ball(70, 44 + hu * 2, 9, 6, TROLL, { lo: 1, hi: 10, rim: 0.3 });
    for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) {
      const ry = 51 + hu * 2 + i * 3.2;
      W.line(60 + sd * (6 + i), ry, 60 + sd * (15 - i * 0.5), ry - 1.5, TROLL[2]);
      W.line(60 + sd * (6 + i), ry + 1, 60 + sd * (15 - i * 0.5), ry - 0.5, TROLL[sd < 0 ? 8 : 6]);
    }
    W.line(60, 48, 60, 60, TROLL[3]);

    // ---- loincloth: a ragged pelt on a rope ----
    W.poly([[48, 74], [72, 74], [74, 90], [69, 87], [66, 94], [61, 88], [56, 95], [52, 88], [46, 91]], HIDE, { grad: [60, 74, 60, 94, 0.55, 0.12] });
    W.line(55, 77, 53, 88, '#200'); W.line(64, 77, 66, 89, '#200');
    W.cap(47, 74, 73, 74, 1.5, 1.5, R.wood, { lo: 1, hi: 5, spec: 0.3 });
    // fetish: a tooth & bone charm on the rope
    const ch = T.P(67, 75);
    S.horn(ch[0], ch[1], ch[0] + 1, ch[1] + 3, ch[0], ch[1] + 6, 1.4, 0.4, R.bone, { lo: 3, spec: 0.4 });

    // ---- the regenerating wound ----
    const wc = T.P(49, 60);
    regenWound(S, Math.round(wc[0]), Math.round(wc[1]), q.idle ? q.f : 1, q.idle ? 1 : q.hu ? 1.2 : 0.5);

    // ---- arms (outlined layers) ----
    const L1 = 27, L2 = 29;
    const doArm = (sh, hand, bend, lo, k, side, fs) => layer(S, A => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], L1 * s * fs, L2 * s * fs, bend);
      const o = { lo, hi: 10.5, rim: 0.35 };
      A.ball(sh[0], sh[1], 7.5 * s, 7 * s, TROLL, { lo, hi: 11, spec: 0.15, rim: 0.3 });
      A.capsule(sh[0], sh[1], j.ex, j.ey, 5.4 * s, 4 * s, TROLL, o);
      A.ball(j.ex, j.ey, 4.6 * s, 4.4 * s, TROLL, { lo: lo + 0.3, hi: 10.5, spec: 0.3 });   // knobby elbow
      const mx = lerp(j.ex, j.hx, 0.35), my = lerp(j.ey, j.hy, 0.35);
      A.capsule(j.ex, j.ey, mx, my, 4.2 * s, 5 * s, TROLL, o);
      A.capsule(mx, my, j.hx, j.hy, 5 * s, 3.4 * s, TROLL, o);
      for (const [wx, wy] of limbPts(sh[0], sh[1], j.ex, j.ey, 4, 3, 41 + side)) wart(A, TROLL, wx, wy, false);
      for (const [wx, wy] of limbPts(j.ex, j.ey, j.hx, j.hy, 4, 4, 51 + side)) wart(A, TROLL, wx, wy, side > 0);
      const dx = j.hx - j.ex, dy = j.hy - j.ey, d = Math.hypot(dx, dy) || 1;
      trollClaw(A, j.hx + dx / d * 2, j.hy + dy / d * 2, dx / d, dy / d, k * s, lo, k > 1.3 ? 0.9 : 0.55);
    });
    const doL = () => doArm(shL, p.hL, p.bL, 0.5, p.kL, 0, p.aL);
    const doR = () => doArm(shR, p.hR, p.bR, 0.2, p.kR, 1, p.aR);
    if (p.front === -1) { doR(); doL(); }
    else if (p.front !== 2) { doL(); doR(); }

    // ---- head, thrust forward ----
    trollHead(S, head[0], head[1], { k: s * 1.15, mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt * 2, sway: p.hair });
    if (p.front === 2) { doL(); doR(); }

    // ---- hide: greyer blotches & warts ----
    mottleField(S, TROLL, TROLL_B, inv, 6, 0.6, 5);
    for (const [wx, wy] of TR_WARTS) { const pt = T.P(wx, wy); wart(S, TROLL, pt[0], pt[1], hash2(wx, wy) < 0.3); }

    S.outline();

    // ---- claw rakes ----
    if (q.st) {
      const cols = ['#244', '#6a8', '#bdc', '#eff'];
      if (q.dir < 0) rake(S, [[16, 6], [12, 34], [22, 66], [44, 96]], 3, 5, cols, { behind: true, side: -1, w: 3 });
      else if (q.dir > 0) rake(S, [[104, 6], [108, 34], [98, 66], [76, 96]], 3, 5, cols, { behind: true, side: 1, w: 3 });
      else {
        rake(S, [[40, 2], [28, 26], [26, 56], [32, 84]], 3, 4, cols, { behind: true, side: -1, w: 2.5 });
        rake(S, [[80, 2], [92, 26], [94, 56], [88, 84]], 3, 4, cols, { behind: true, side: 1, w: 2.5 });
      }
    }
  }

  function trollPortrait(S) {
    crisp(S, 0.5, 1.25);
    S.ball(12, 25, 14, 6, TROLL, { lo: 0.5, hi: 9, rim: 0.3 });
    S.ball(1, 22, 7, 6, TROLL, { lo: 1, hi: 10.5, spec: 0.15 });
    S.ball(23, 22, 7, 6, TROLL, { lo: 0.5, hi: 9.5, rim: 0.3 });
    trollHead(S, 12, 11, { k: 0.78, mo: 0.6 });
    S.outline();
  }

  EN['Troll'] = { w: 120, h: 120, anchor: [60, 117], center: [60, 60], mouth: [62, 46], draw: drawTroll, portrait: trollPortrait };

  // ===============================================================
  // BASILISK — a giant six-legged lizard, low and wide, coming head-on.
  // Scaly teal hide, pale belly, a frilled crest fanned behind the head
  // (painted with false eyes), and huge glowing petrifying eyes. Side
  // wind-ups swing the gaping head out to that side; overhead rears up
  // on the hind legs with the frill flared.
  // rear 0..1 morphs the body from sprawling to upright.
  // ===============================================================
  const BAS = ['#001', '#011', '#012', '#112', '#122', '#133', '#244', '#255', '#366', '#477', '#598', '#7ba', '#9dc'];
  const BAS_D = ['#001', '#001', '#011', '#011', '#012', '#122', '#133', '#144', '#255', '#366', '#477', '#598', '#7a9'];
  const BBELLY = ['#011', '#122', '#233', '#344', '#465', '#687', '#8a9', '#bcb', '#dec'];
  const FRILL = ['#001', '#011', '#122', '#133', '#244', '#365', '#586', '#9a6', '#cb6', '#ed8'];
  const BCLAW = ['#110', '#221', '#432', '#654', '#876', '#a98', '#cba'];
  const BEYE = '#fd4';

  const basKeys = {
    idle: f => ({
      rear: 0, hx: 0, hy: [0, 0, 1, 1][f], hk: 1.12, mo: [0.1, 0.3, 0.38, 0.2][f], tongue: [0, 0.55, 0.8, 0.3][f], frill: [0.45, 0.5, 0.55, 0.5][f],
      turn: 0, tail: [0, 1, 2, 1][f], br: [0, 1, 1, 0][f], shut: 0, eye: [1, 1, 2, 1][f], neck: 0, lunge: 0,
    }),
    // head swung out high to the screen-left, jaws agape, frill flared
    wl: { hx: -30, hy: -26, hk: 1.05, mo: 1, tongue: 1, frill: 1, turn: -1, tail: 3, eye: 2, neck: 1 },
    wl5: { hx: -16, hy: -12, mo: 0.6, frill: 0.75, turn: -0.5, neck: 0.6 },
    // rears up on its hind legs, frill fully flared
    wh: { rear: 1, hy: 0, hk: 0.95, mo: 1, tongue: 1, frill: 1.05, eye: 2, tail: 1 },
    wh5: { rear: 0.5, mo: 0.6, frill: 0.8 },
    // head swung out high to the screen-right
    wr: { hx: 30, hy: -26, hk: 1.05, mo: 1, tongue: 1, frill: 1, turn: 1, tail: -1, eye: 2, neck: 1 },
    wr5: { hx: 16, hy: -12, mo: 0.6, frill: 0.75, turn: 0.5, neck: 0.6 },
    // strikes: the head lunges at the viewer, huge, jaws snapping
    sl: { hx: -10, hy: -8, hk: 1.45, mo: 1, tongue: 0, frill: 0.35, turn: 0.4, eye: 2, neck: 1, lunge: 1, tail: 2 },
    sh: { rear: 0.08, hx: 0, hy: -8, hk: 1.5, mo: 1, tongue: 0, frill: 0.9, eye: 2, neck: 0, lunge: 1, tail: 0 },
    sr: { hx: 10, hy: -8, hk: 1.45, mo: 1, tongue: 0, frill: 0.35, turn: -0.4, eye: 2, neck: 1, lunge: 1, tail: 0 },
    hurt: { hx: 3, hy: -15, hk: 0.86, mo: 0.8, tongue: 0, frill: 0.15, turn: 0.3, eye: 0, shut: 1, neck: 0.6, tail: -2 },
  };

  // Fish-scale texture: offset rows of U-shaped scale edges with a lit cap.
  const scaleTex = (S, ramp, key, sx = 6, sy = 5, test) => {
    const m = rmap(ramp);
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      const v = S.data[y * S.w + x];
      if (!v) continue;
      const i = m.get(v);
      if (i === undefined || i < 3) continue;
      if (test && !test(x, y)) continue;
      const [u, w] = key(x, y);
      const row = Math.floor(w / sy), off = (row & 1) * sx / 2;
      const col = Math.floor((u + off) / sx);
      const cx = (u + off) - (col + 0.5) * sx, cy = w - row * sy;
      const d = Math.hypot(cx, cy * 0.95), r = sx * 0.5;
      if (cy > 0.5 && Math.abs(d - r) < 0.55) S.data[y * S.w + x] = P.toInt(ramp[Math.max(0, i - 2)]);
      else if (cy < 2 && cx < 0 && cx > -2 && i < ramp.length - 1) S.data[y * S.w + x] = P.toInt(ramp[i + 1]);
    }
  };

  // Frill: a fan of spines with a scalloped membrane, radial gradient and false eyes.
  function basFrill(S, cx, cy, R0, a0, a1, amt, k) {
    if (amt <= 0.05) return;
    const n = 9, R1 = R0 * (0.5 + 0.5 * amt);
    const tipR = i => R1 * (0.94 + 0.1 * Math.sin(i * 2.3));
    const edge = a => {
      const t = (a - a0) / (a1 - a0) * (n - 1), i = Math.floor(t), f = t - i;
      return lerp(tipR(i), tipR(Math.min(n - 1, i + 1)), f) - Math.sin(f * Math.PI) * R1 * 0.14;
    };
    const R = Math.ceil(R1 + 2);
    for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (x < 2 || x > S.w - 3 || y < 2) continue;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      let a = Math.atan2(dy, dx);
      while (a < a0) a += Math.PI * 2;
      if (a > a1) continue;
      const r = Math.hypot(dx, dy), e = edge(a);
      if (r > e || r < 3) continue;
      const t = r / e;
      const sp = (a - a0) / (a1 - a0) * (n - 1), ribs = Math.abs(sp - Math.round(sp));
      let I = 0.22 + t * 0.45 + (t > 0.8 ? 0.28 : 0) - dx / R1 * 0.1 - dy / R1 * 0.06 - (ribs > 0.35 ? 0.08 : 0);
      I *= 0.7 + 0.3 * Math.min(1, amt);
      S.shadePx(x, y, FRILL, I, {});
    }
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * i / (n - 1), c = Math.cos(a), s = Math.sin(a);
      const L = tipR(i) + 2.5 * k;
      const ex = clamp(cx + c * L, 2, S.w - 3), ey = Math.max(2, cy + s * L);
      S.capsule(cx + c * 4, cy + s * 4, ex, ey, 1.3 * k, 0.5, BCLAW, { lo: 2, spec: 0.4 });
    }
    if (amt > 0.6) for (const f of [0.2, 0.8]) {
      const a = a0 + (a1 - a0) * f, ex = cx + Math.cos(a) * R1 * 0.64, ey = cy + Math.sin(a) * R1 * 0.64;
      S.ellipse(ex, ey, 3 * k, 2.6 * k, FRILL[1]);
      S.ellipse(ex, ey, 2 * k, 1.7 * k, '#ec4');
      S.px(ex, ey, '#100'); S.px(ex, ey - 1, '#100'); S.px(ex - 1, ey - 1, '#ffd');
    }
  }

  // Chunky lizard leg: shoulder -> elbow (out to the side) -> planted foot.
  function basLeg(S, sx, sy, ex, ey, fx, fy, k, lo, ramp, up) {
    S.capsule(sx, sy, ex, ey, 8 * k, 6.5 * k, ramp, { lo, hi: ramp.length - 2, rim: 0.3 });
    S.ball(ex, ey, 6.5 * k, 6 * k, ramp, { lo: lo + 0.3, hi: ramp.length - 1.5, spec: 0.2 });
    S.capsule(ex, ey, fx, fy - 2 * k, 6 * k, 4.5 * k, ramp, { lo, hi: ramp.length - 2, rim: 0.3 });
    const side = Math.sign(fx - sx) || 1;
    const base = up ? -Math.PI / 2 - side * 0.3 : Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const a = base + (i - 1.5) * 0.5 + (up ? 0 : side * 0.15);
      const c = Math.cos(a), s = Math.sin(a);
      const tx = fx + c * 5.5 * k, ty = fy + s * 3 * k;
      S.capsule(fx, fy - 1, tx, ty, 2.2 * k, 1.7 * k, ramp, { lo: lo + 0.3, hi: ramp.length - 2 });
      S.horn(tx, ty, tx + c * 2.2 * k, ty + s * 2 * k, tx + c * 2.8 * k, ty + s * 3.4 * k + (up ? 0 : 0.5), 1.2 * k, 0.3, BCLAW, { lo: 2, spec: 0.5 });
    }
    S.ball(fx, fy - 1.5 * k, 4.6 * k, 3.4 * k, ramp, { lo: lo + 0.3, hi: ramp.length - 2 });
  }

  function basHead(S, x, y, o = {}) {
    const k = o.k || 1, mo = o.mo || 0, tn = o.turn || 0, ts = tn * 2.5 * k;
    // cheek spikes swept back from the jaw hinges
    for (const sd of [-1, 1]) {
      S.horn(x + sd * 15 * k, y + 2 * k, x + sd * 21 * k, y - 1 * k, x + sd * 25 * k, y - 6 * k, 2.4 * k, 0.5, BCLAW, { lo: 2, spec: 0.4 });
      S.horn(x + sd * 14 * k, y + 6 * k, x + sd * 20 * k, y + 6 * k, x + sd * 23 * k, y + 2 * k, 1.8 * k, 0.4, BCLAW, { lo: 2 });
    }
    // lower jaw (drops when it gapes)
    const jy = y + (8 + mo * 10) * k;
    S.ball(x + ts * 0.5, jy, 14.5 * k, 5.5 * k, BAS, { lo: 1, hi: 9.5, rim: 0.3 });
    S.ball(x + ts * 0.5, jy + 1.5 * k, 10 * k, 3.5 * k, BBELLY, { lo: 1, hi: 6 });
    if (mo > 0.1) {
      S.ball(x + ts * 0.6, y + (7 + mo * 5) * k, 13 * k, (2 + mo * 5.5) * k, MOUTH, { tone: 0.35 });
      S.ball(x + ts * 0.8, y + (8 + mo * 6) * k, 6.5 * k, (1 + mo * 3) * k, MOUTH, { tone: 0.04 });
      for (let i = -4; i <= 4; i++) {         // lower teeth jutting up
        const t = i / 4.5, tx = x + ts * 0.5 + t * 12 * k, ly = jy - 4.5 * k;
        S.px(tx, ly, '#ddc'); S.px(tx, ly - 1, i % 2 ? '#998' : '#eed');
      }
      if (o.tongue > 0) {                     // forked tongue flicking out
        const tl = o.tongue * 12 * k, bx = x + ts, by = y + (9 + mo * 5) * k, wg = (o.wig || 0) * 1.5;
        S.capsule(bx, by, bx + wg, by + tl, 1.6 * k, 1.1 * k, R.blood, { lo: 2, spec: 0.4 });
        S.line(bx + wg, by + tl, bx + wg - 2.5 * k, by + tl + 3 * k, R.blood[4]);
        S.line(bx + wg, by + tl, bx + wg + 2.5 * k, by + tl + 3 * k, R.blood[4]);
      }
    }
    // skull: broad, flat, spade-shaped, with a blunt snout
    S.ball(x + ts * 0.3, y - 1 * k, 17 * k, 9.5 * k, BAS, { lo: 1, hi: 12, spec: 0.15, rim: 0.3 });
    S.poly([[x - 16 * k + ts * 0.3, y + 1 * k], [x + 16 * k + ts * 0.3, y + 1 * k], [x + 11 * k + ts, y + 7.5 * k], [x - 11 * k + ts, y + 7.5 * k]], BAS, { grad: [x - 8 * k, y, x + 8 * k, y + 8 * k, 0.75, 0.3] });
    S.ball(x + ts, y + 4 * k, 11 * k, 4 * k, BAS, { lo: 2, hi: 12, spec: 0.25 });
    // crocodile teeth over the lip
    for (let i = -5; i <= 5; i++) {
      if (i === 0) continue;
      const t = i / 5.5, tx = x + ts * 0.8 + t * 11 * k, ty = y + 7.5 * k - Math.abs(t) * 0.5 * k;
      S.px(tx, ty, '#eed'); if (Math.abs(i) === 2 || Math.abs(i) === 5) { S.px(tx, ty + 1, '#ccb'); S.px(tx, ty + 2, '#998'); }
    }
    // nostrils
    S.px(x - 3 * k + ts * 1.2, y + 3 * k, '#001'); S.px(x + 3 * k + ts * 1.2, y + 3 * k, '#001');
    S.px(x - 3 * k + ts * 1.2, y + 2 * k, BAS[10]); S.px(x + 3 * k + ts * 1.2, y + 2 * k, BAS[8]);
    // horned forehead plate
    S.poly([[x - 3 * k + ts * 0.4, y - 3 * k], [x + ts * 0.4, y - 10 * k], [x + 3 * k + ts * 0.4, y - 3 * k]], BCLAW, { grad: [x - 3 * k, y - 12 * k, x + 3 * k, y - 4 * k, 0.8, 0.35] });
    // eyes: huge, glowing, slit-pupilled, under scowling brow ridges
    for (const sd of [-1, 1]) {
      const ex = x + sd * 9.5 * k + ts * (sd === Math.sign(tn) ? 0.3 : 1.1), ey = y - 3 * k;
      S.ellipse(ex, ey, 5 * k, 4 * k, '#001');
      if (o.shut) { S.line(ex - 4 * k, ey, ex + 4 * k, ey + 0.5, BAS[8]); S.line(ex - 4 * k, ey - 1, ex + 4 * k, ey - 0.5, BAS[10]); }
      else {
        if (o.eye > 1) for (let j = -7; j <= 7; j++) for (let i = -8; i <= 8; i++) {   // petrifying glow halo
          const d = Math.hypot(i / (6.5 * k), j / (5.5 * k));
          if (d < 0.75 || d > 1.15) continue;
          const px = Math.round(ex + i), py = Math.round(ey + j);
          if (S.opaque(px, py) && (1.15 - d) * 1.6 > P.thresh(px, py)) S.set(px, py, P.mix(S.getHex(px, py), BEYE, 0.45));
        }
        S.ellipse(ex, ey, 4.1 * k, 3.2 * k, '#c70');
        S.ellipse(ex, ey - 0.3, 3.4 * k, 2.6 * k, BEYE);
        S.ellipse(ex - 0.8 * k, ey - 0.8 * k, 1.8 * k, 1.3 * k, '#ffb');
        S.rect(Math.round(ex), Math.round(ey - 2.6 * k), 1, Math.round(5.2 * k) + 1, '#100');
        if (o.eye > 0) S.px(ex - 2 * k, ey - 1.4 * k, '#fff');
      }
      // brow ridge: a heavy scowl slanting down to the centre
      S.capsule(ex - sd * 1 * k + sd * 5 * k, ey - 5.5 * k, ex - sd * 5 * k, ey - 3 * k, 2.2 * k, 1.8 * k, BAS, { lo: 3, hi: 12, spec: 0.35 });
    }
  }

  function drawBasilisk(S, pose) {
    crisp(S, 0.5, 1.2);
    const q = decode(pose);
    const p = resolve(basKeys, q);
    const r = clamp(p.rear || 0, 0, 1), br = p.br || 0;
    const lg = p.lunge || 0;
    const hk = p.hk;

    // body: a low broad mound (sprawl) -> a tall pear-shaped torso (rear)
    const bcx = 60, bcy = lerp(78, 64, r) + lg * 2, brx = lerp(42, 22, r), bry = lerp(19, 32, r) + br * 0.5;
    const head = [60 + p.hx, lerp(90, 25, r) + p.hy];

    // ---- tail ----
    const ta = p.tail || 0;
    const tailKey = [];
    if (r < 0.6) {
      const tb = [76, bcy - bry * 0.55], tm = [104 + ta, bcy - bry - 16], tt = [94 + ta * 3, bcy - bry - 32 + Math.abs(ta)];
      S.horn(tb[0], tb[1], tm[0], tm[1], tt[0], tt[1], 9, 2.4, BAS_D, { lo: 0.3, hi: 11, rim: 0.4 });
      S.horn(tt[0], tt[1], tt[0] - 3, tt[1] - 4, tt[0] - 8 - ta, tt[1] - 2, 2.4, 0.6, BAS_D, { lo: 0.3, hi: 11 });
      for (let i = 0; i < 5; i++) {
        const t = 0.12 + i * 0.17, it = 1 - t;
        const qx = it * it * tb[0] + 2 * it * t * tm[0] + t * t * tt[0], qy = it * it * tb[1] + 2 * it * t * tm[1] + t * t * tt[1];
        S.tri([qx - 2.5, qy], [qx - 4 - (1 - t) * 2, qy - 4.5 - (1 - t) * 2.5], [qx + 1, qy - 1.5], BCLAW, { tone: 0.6 });
      }
    } else {
      S.horn(72, 106, 100, 117, 112, 100 - ta * 2, 9, 2, BAS_D, { lo: 0.3, hi: 11, rim: 0.4 });
    }

    // ---- legs at three depths: hind (far, high), middle, front (near, low) ----
    const L3 = (a, b) => [lerp(a[0], b[0], r), lerp(a[1], b[1], r)];
    const leg = (sd, S0, E0, F0, S1, E1, F1, k, lo, ramp, upAt) => {
      const s0 = L3(S0, S1), e0 = L3(E0, E1), f0 = L3(F0, F1);
      basLeg(S, 60 + sd * s0[0], s0[1], 60 + sd * e0[0], e0[1], 60 + sd * f0[0], f0[1], k, sd < 0 ? lo + 0.3 : lo, ramp, r > upAt);
    };
    const hind = sd => leg(sd, [17, 64], [34, 52], [43, 77], [13, 90], [27, 97], [26, 111], lerp(0.68, 1.05, r), 0.1, r > 0.5 ? BAS : BAS_D, 2);
    const mid = sd => leg(sd, [22, 76], [42, 66], [50, 94], [17, 72], [31, 76], [35, 91], 0.86, 0.2, r > 0.5 ? BAS_D : BAS, 2);
    const front = sd => leg(sd, [24, 89], [41, 89], [41, 110], [15, 50], [30, 42], [38, 22], 1.08 + lg * 0.08, 0.3, BAS, 0.5);
    const seg = (c0, c1, rx0, rx1, ry0, ry1, lo) => {
      const c = L3(c0, c1);
      S.ball(c[0], c[1] + br * 0.4, lerp(rx0, rx1, r), lerp(ry0, ry1, r), BAS, { lo, hi: 11, rim: 0.4 });
      S.ball(c[0] - 3, c[1] - lerp(ry0, ry1, r) * 0.3, lerp(rx0, rx1, r) * 0.6, lerp(ry0, ry1, r) * 0.5, BAS, { lo: lo + 0.5, hi: 12, spec: 0.1 });
    };

    if (r <= 0.5) { hind(-1); hind(1); }
    seg([60, 62], [60, 88], 19, 21, 10, 12, 0.2);          // hips
    mid(-1); mid(1);
    seg([60, 72], [60, 70], 25, 19, 12, 17, 0.4);          // mid body
    if (r > 0.5) { hind(-1); hind(1); }
    // dark bands & dorsal plates receding along the back
    if (r < 0.5) {
      for (const [bx, by] of [[46, 70], [74, 70], [52, 62], [68, 62]]) spotAt(S, BAS, bx, by, 4, 2.4, -2, 3);
      for (let i = 0; i < 5; i++) {
        const sx = 60 + (i - 2) * 0.4, sy = 53 + i * 5, h = 5 + i * 0.9;
        S.tri([sx - 2.5 - i * 0.3, sy + 2], [sx, sy - h], [sx + 2.5 + i * 0.3, sy + 2], BCLAW, { tone: 0.5 + i * 0.05 });
      }
    }
    // ---- front legs, chest ----
    layer(S, A => { const S0 = S; S = A; front(-1); front(1); S = S0; }, 0.4);
    seg([60, 84], [60, 52], 27, 17, 11, 13, 0.6);          // chest
    if (r > 0.05) {   // pale belly with transverse scutes
      const bc = L3([60, 92], [60, 66]);
      S.ball(bc[0], bc[1], lerp(16, 13, r), lerp(4, 27, r), BBELLY, { lo: 1, hi: 8.5, rim: 0.2 });
      // scute seams, only on the belly itself
      const bry2 = lerp(4, 27, r);
      for (let yy = Math.round(bc[1] - bry2 + 3); yy < bc[1] + bry2 - 2; yy += 5) for (let xx = bc[0] - 12; xx <= bc[0] + 12; xx++) {
        const yv = Math.round(yy + (xx - bc[0]) * 0.03);
        if (inRamp(S, xx, yv, BBELLY) !== undefined) S.set(xx, yv, BBELLY[2]);
      }
    }

    // ---- frill (behind the head) & neck ----
    const fopen = p.frill > 0.8 ? 1 : 0;
    const fa0 = lerp(155, 150, fopen) * D2R, fa1 = lerp(385, 390, fopen) * D2R;
    const fc = [head[0] - (p.turn || 0) * 2, head[1] - 1 * hk];
    basFrill(S, fc[0], fc[1], lerp(30, 21, r) * hk, fa0, fa1, p.frill, hk);
    if (p.neck > 0.05 || r > 0.3) {
      const nb = [bcx + Math.sign(p.hx) * 12, bcy + (r > 0.3 ? -bry * 0.5 : 2)];
      layer(S, A => {
        A.capsule(nb[0], nb[1], head[0], head[1] + 5 * hk, 12, 9.5 * hk, BAS, { lo: 0.5, hi: 11, rim: 0.3 });
        A.capsule(nb[0], nb[1] + 4, head[0], head[1] + 9 * hk, 6, 5 * hk, BBELLY, { lo: 1, hi: 6.5 });
      }, 0.4);
    }

    // ---- the head ----
    layer(S, A => basHead(A, head[0], head[1], { k: hk, mo: p.mo, turn: p.turn, tongue: p.tongue, wig: q.idle ? [0, 1, -1, 0][q.f] : 0, eye: Math.round(p.eye || 0), shut: p.shut > 0.5 }), 0.4);

    // ---- scales over the hide ----
    scaleTex(S, BAS, (x, y) => [x, y], 6, 5);
    scaleTex(S, BAS_D, (x, y) => [x, y], 5, 4);

    S.outline();

    if (q.st) {
      // the head whips in from that side: the arc is drawn over the legs
      if (q.dir < 0) swoosh(S, [[16, 22], [6, 46], [12, 72], [28, 90]], 8, SWISH, { side: -1 });
      else if (q.dir > 0) swoosh(S, [[104, 22], [114, 46], [108, 72], [92, 90]], 8, SWISH, { side: 1 });
      else {
        swoosh(S, [[46, 4], [30, 16], [22, 42], [24, 70]], 7, SWISH, { behind: true, side: -1 });
        swoosh(S, [[74, 4], [90, 16], [98, 42], [96, 70]], 7, SWISH, { behind: true, side: 1 });
      }
    }
  }

  function basPortrait(S) {
    crisp(S, 0.5, 1.2);
    basFrill(S, 12, 12, 13, 150 * D2R, 390 * D2R, 1, 0.5);
    basHead(S, 12, 12, { k: 0.5, mo: 0.5, tongue: 0.7, eye: 1 });
    S.outline();
  }

  EN['Basilisk'] = { w: 120, h: 120, anchor: [60, 117], center: [60, 80], mouth: [60, 100], draw: drawBasilisk, portrait: basPortrait };

  // ===============================================================
  // WEREWOLF — a hulking wolf-man crouched to pounce: dark grey fur,
  // heavy shoulders, digitigrade legs, snarling fanged snout, ragged
  // trouser remains, long claws, a bushy tail lashing behind.
  // hL/hR = claw targets (screen), tail = tail swing, mo = jaw open.
  // ===============================================================
  const WFUR = ['#000', '#101', '#111', '#112', '#212', '#223', '#323', '#334', '#434', '#545', '#655', '#876', '#a98'];
  const WFUR2 = ['#101', '#112', '#222', '#323', '#433', '#544', '#655', '#766', '#877', '#998', '#bba'];
  const TROU = ['#001', '#101', '#112', '#213', '#224', '#335', '#346', '#457'];
  const WCLAW = ['#110', '#221', '#432', '#654', '#987', '#bba', '#ddc', '#ffe'];
  const WRAKE = ['#412', '#a56', '#edd', '#fff'];

  const wolfKeys = {
    idle: f => {
      const br = [0, 1, 2, 1][f], sw = [0, 1, 0, -1][f];
      return {
        lean: 0.06, dx: 0, dy: br, s: 1, hx: 0, hy: [0, 0, 1, 1][f], tilt: 0, mo: [0.55, 0.65, 0.75, 0.6][f], shut: 0,
        hL: [15, 67 + br], hR: [78, 57 + br], kL: 1, kR: 1, bL: 1, bR: -1, aL: 1, aR: 1, front: 0, tail: [0, 1, 2, 1][f], up: 0,
      };
    },
    // claw cocked high on the screen-left; body coils left, snarling up at it
    wl: { lean: -0.12, dx: -2, dy: -2, hx: -3, hy: -2, mo: 1, hL: [13, 17], hR: [62, 66], kL: 1.15, bL: -1, bR: -1, aL: 0.85, tail: -2, up: 0.5 },
    wl5: { hL: [14, 40], bL: -1, aL: 0.9 },
    // rears up tall, both claws high over the head
    wh: { lean: 0, dx: 0, dy: -5, hx: 0, hy: 1, mo: 1, hL: [18, 19], hR: [70, 19], kL: 1.1, kR: 1.1, bL: -1, bR: 1, aL: 0.85, aR: 0.85, front: 2, tail: 3, up: 1 },
    wh5: { hL: [12, 32], hR: [76, 32], aL: 0.9, aR: 0.9, front: 2, up: 0.5 },
    // claw cocked high on the screen-right
    wr: { lean: 0.12, dx: 2, dy: -2, hx: 3, hy: -2, mo: 1, hR: [73, 18], hL: [26, 66], kR: 1.15, bR: 1, bL: 1, aR: 0.85, tail: 3, up: 0.5 },
    wr5: { hR: [72, 40], bR: 1, aR: 0.9 },
    // strikes: pounce at the viewer, claw ripping down through the middle
    sl: { lean: 0.14, dx: 3, dy: 5, s: 1.07, hx: 3, hy: 4, mo: 1, hL: [54, 70], kL: 1.45, hR: [68, 66], bL: 1, bR: -1, aR: 0.85, front: -1, tail: 3 },
    sh: { lean: 0.06, dx: 0, dy: 7, s: 1.08, hx: 0, hy: 4, mo: 1, hL: [35, 74], hR: [55, 74], kL: 1.35, kR: 1.35, bL: 1, bR: -1, front: 3, tail: 2 },
    sr: { lean: -0.02, dx: -3, dy: 5, s: 1.07, hx: -3, hy: 4, mo: 1, hR: [34, 70], kR: 1.45, hL: [20, 66], bL: 1, bR: -1, aL: 0.85, front: 1, tail: -1 },
    hurt: { lean: 0.16, dx: 3, dy: -2, s: 0.97, hx: 5, hy: -4, tilt: 1, mo: 0.9, shut: 1, hL: [12, 46], hR: [76, 40], bL: 1, bR: -1, tail: -3, up: 0.3 },
  };

  // Fur texture: short staggered dark dashes keyed to body space.
  const furTex = (S, ramp, inv, dens = 0.28, minI = 3) => {
    const m = rmap(ramp);
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      const v = S.data[y * S.w + x];
      if (!v) continue;
      const i = m.get(v);
      if (i === undefined || i < minI) continue;
      const [mx, my] = inv(x, y);
      const col = Math.floor(mx / 2), off = hash2(col, 7) * 4;
      const row = Math.floor((my + off) / 4);
      if (hash2(col, row) < dens && ((my + off) % 4 + 4) % 4 < 2) S.data[y * S.w + x] = P.toInt(ramp[i - 1]);
      else if (hash2(col + 3, row) < dens * 0.4 && ((my + off) % 4 + 4) % 4 < 1) S.data[y * S.w + x] = P.toInt(ramp[Math.min(ramp.length - 1, i + 1)]);
    }
  };

  // Clawed hand: four curved claws fanning in the reach direction.
  function wolfClaw(S, x, y, ux, uy, k, lo, spread = 0.5) {
    const base = Math.atan2(uy, ux);
    S.ball(x, y, 4.6 * k, 4.2 * k, WFUR, { lo, hi: 10.5, rim: 0.3 });
    for (let i = 0; i < 4; i++) {
      const a = base + (i - 1.5) * spread * 0.55;
      const c = Math.cos(a), s = Math.sin(a);
      const bx = x + c * 3 * k, by = y + s * 3 * k;
      const jx = bx + c * 3.4 * k, jy = by + s * 3.4 * k;
      S.capsule(bx, by, jx, jy, 1.6 * k, 1.3 * k, WFUR, { lo: lo + 0.5, hi: 10 });
      const cx = jx + c * 3.5 * k, cy = jy + s * 3.5 * k, hk = i < 2 ? 1 : -1;
      S.horn(jx, jy, cx, cy, cx + c * 1.5 * k - s * 2 * k * hk, cy + s * 1.5 * k + c * 2 * k * hk, 1.2 * k, 0.3, WCLAW, { lo: 2, spec: 0.6 });
    }
  }

  function wolfHead(S, x, y, o = {}) {
    const k = o.k || 1, mo = o.mo || 0, tl = o.tilt || 0, up = o.up || 0;
    const fur = WFUR;
    // far ear (screen-right), then skull & cheek ruff
    S.poly([[x + 2 * k, y - 6 * k], [x + 9 * k, y - 18 * k + tl], [x + 9 * k, y - 3 * k]], fur, { tone: 0.3 });
    S.poly([[x + 4.5 * k, y - 6 * k], [x + 8.5 * k, y - 14 * k + tl], [x + 8 * k, y - 5 * k]], WFUR2, { tone: 0.15 });
    S.ball(x + 4 * k, y + 4 * k, 7 * k, 6 * k, fur, { lo: 1, hi: 8, rim: 0.4 });
    S.ball(x + 1 * k, y - 0.5 * k, 8 * k, 7.5 * k, fur, { lo: 1, hi: 11, spec: 0.1, rim: 0.4 });
    for (let i = 0; i < 5; i++) {   // cheek ruff tufts
      const a = (20 + i * 28) * D2R, bx = x + 2 * k + Math.cos(a) * 6 * k, by = y + 3 * k + Math.sin(a) * 5 * k;
      S.tri([bx - 2 * k, by - 1], [bx + Math.cos(a) * 5 * k, by + Math.sin(a) * 4 * k + 1], [bx + 2 * k, by + 1], fur, { tone: 0.35 + i * 0.06 });
    }
    // near ear (screen-left), pinned back a little in rage
    S.poly([[x - 7.5 * k, y - 3 * k], [x - 9.5 * k, y - 17 * k + tl], [x - 1.5 * k, y - 7 * k]], fur, { tone: 0.72 });
    S.poly([[x - 6.5 * k, y - 5 * k], [x - 8.5 * k, y - 14 * k + tl], [x - 3.5 * k, y - 7 * k]], ['#101', '#201', '#312', '#423'], { tone: 0.5 });
    // muzzle: long, pointing down-left at the viewer; jaws gape with mo
    const tipx = x - 13 * k, tipy = y + (8 - up * 3) * k;
    const jx = tipx + 2.5 * k, jy = tipy + (2 + mo * 5) * k;
    S.capsule(x + 1 * k, y + 6 * k, jx, jy, 3.2 * k, 2.2 * k, WFUR2, { lo: 1, hi: 7 });       // lower jaw
    if (mo > 0.15) {
      S.poly([[x + 1.5 * k, y + 3 * k], [tipx + 1 * k, tipy + 1.5 * k], [jx - 0.5, jy - 0.8], [x + 0.5 * k, y + 7.5 * k]], MOUTH, { grad: [x, y + 3 * k, x, y + 8 * k, 0.65, 0.05] });
      // lower fangs & teeth
      for (let i = 0; i < 4; i++) {
        const t = 0.2 + i * 0.25, tx = lerp(x + 1 * k, jx, t), ty = lerp(y + 6 * k, jy, t) - 2.2 * k;
        S.px(tx, ty, '#eed'); if (i === 3) { S.px(tx, ty - 1, '#ffe'); S.px(tx, ty - 2, '#bba'); }
      }
      S.ball(lerp(x, jx, 0.5), lerp(y + 6 * k, jy, 0.5) - 1, 1.8 * k, 1 * k, R.blood, { lo: 3, hi: 6 });   // tongue
    }
    S.capsule(x - 0.5 * k, y + 1 * k, tipx, tipy, 4.6 * k, 3.2 * k, fur, { lo: 1, hi: 11, spec: 0.15 });     // snout bridge
    S.capsule(lerp(x, tipx, 0.4), lerp(y + 2 * k, tipy, 0.4) + 1, tipx + 0.5, tipy + 1, 3 * k, 2.8 * k, WFUR2, { lo: 2, hi: 10, spec: 0.2 });
    // snarl wrinkles along the bridge
    for (let i = 0; i < 3; i++) S.line(lerp(x - 2 * k, tipx, 0.3 + i * 0.15) - 1, lerp(y - 1 * k, tipy, 0.3 + i * 0.15) - 2, lerp(x - 2 * k, tipx, 0.3 + i * 0.15) + 1, lerp(y - 1 * k, tipy, 0.3 + i * 0.15) - 1, fur[3]);
    // curled upper lip: dark gum line with big fangs hanging down
    const ul = t => [lerp(x + 2 * k, tipx + 1.5 * k, t), lerp(y + 4.5 * k, tipy + 2.5 * k, t)];
    for (let i = 0; i <= 6; i++) { const [lx, ly] = ul(i / 6); S.px(lx, ly, i % 2 ? '#312' : '#523'); }
    for (const [t, L] of [[0.3, 4], [0.85, 4.5]]) {
      const [fx, fy] = ul(t);
      S.horn(fx, fy, fx - 0.5, fy + L * 0.5 * k, fx + 0.3, fy + L * k, 1.1 * k, 0.4, WCLAW, { lo: 3, spec: 0.6 });
    }
    for (let i = 1; i < 6; i++) if (i !== 2 && i !== 5) { const [tx, ty] = ul(i / 6.5); S.px(tx, ty + 1, '#ccb'); }
    // nose
    S.ball(tipx - 0.5 * k, tipy - 0.5 * k, 2.4 * k, 1.9 * k, ['#000', '#101', '#112', '#223', '#445', '#778'], { spec: 1.2 });
    // eyes: burning yellow, slanted under a scowling brow
    S.line(x - 7 * k, y - 4.5 * k + tl, x - 2 * k, y - 2 * k + tl, fur[2]);
    S.line(x + 1 * k, y - 2.5 * k + tl, x + 6 * k, y - 4.5 * k + tl, fur[2]);
    const eye = (ex, ey, sd) => {
      ex = Math.round(ex); ey = Math.round(ey);
      S.px(ex - 1, ey, '#101'); S.px(ex + 1, ey, '#101'); S.px(ex, ey + 1, '#101');
      if (o.shut) { S.px(ex, ey, '#101'); S.px(ex + sd, ey - 1, fur[2]); return; }
      S.px(ex, ey, '#ff6'); S.px(ex + sd, ey, '#fb2'); S.px(ex - sd, ey, '#c60'); S.px(ex, ey - 1, '#a40');
    };
    eye(x - 4.5 * k, y - 1.2 * k + tl * 0.5, -1);
    eye(x + 3.5 * k, y - 1.8 * k + tl * 0.5, 1);
  }

  function drawWerewolf(S, pose) {
    crisp(S, 0.5, 1.2);
    const q = decode(pose);
    const p = resolve(wolfKeys, q);
    const T = mkT(p, 44, 94, 62), W = wrap(S, T), s = T.s;
    const inv = invT(p, 44, 94, 62);
    const fur = WFUR;

    const shL = T.P(25, 39), shR = T.P(63, 37);
    const head = T.P(41 + p.hx, 31 + p.hy - (p.up || 0) * 4);
    const hipL = T.P(36, 63), hipR = T.P(52, 63);
    const footL = [24, 92], footR = [64, 92];

    // ---- tail: a bushy brush lashing behind the legs ----
    const ta = p.tail || 0;
    const tb = T.P(52, 64);
    const t1 = [tb[0] + 16, tb[1] + 8 - ta], t2 = [Math.min(81, tb[0] + 26 + ta * 0.3), tb[1] + 7 - ta * 5];
    S.horn(tb[0], tb[1], t1[0], t1[1], t2[0], t2[1], 3.5, 4.5, fur, { lo: 0.5, hi: 8 });
    S.ball(t2[0] - 1, t2[1] - 1, 4, 5, fur, { lo: 0.5, hi: 9, rot: 0.4 });
    S.ball(t2[0], t2[1] - 3.5, 2.6, 2.8, WFUR2, { lo: 1, hi: 8 });

    // ---- legs: digitigrade, trousers torn off at the knee ----
    const leg = (hip, foot, sd, lo) => {
      const kx = hip[0] + sd * 9, ky = hip[1] + 11;
      const hkx = foot[0] + sd * 2, hky = foot[1] - 10;
      S.capsule(kx, ky, hkx, hky, 4.2, 3, fur, { lo, hi: 10, rim: 0.3 });          // shin
      S.capsule(hkx, hky, foot[0], foot[1] - 2, 3, 2.6, fur, { lo, hi: 10, rim: 0.3 });  // long foot
      S.ball(hkx, hky, 2.8, 2.6, fur, { lo: lo + 0.5, hi: 10 });                   // hock
      S.ball(foot[0] - sd, foot[1] - 1.5, 5, 2.8, fur, { lo, hi: 9.5 });           // paw
      for (let i = -1; i <= 1; i++) {
        const cx = foot[0] - sd + i * 2.6;
        S.horn(cx, foot[1], cx - 0.5, foot[1] + 1, cx - 1.2, foot[1] + 1.6, 0.9, 0.3, WCLAW, { lo: 3 });
      }
      // trousers: thigh in rags, a torn hem at the knee
      S.capsule(hip[0], hip[1], kx, ky, 8 * s, 5.8, TROU, { lo: lo + 0.5, hi: 7, rim: 0.3 });
      const hx0 = kx - 5, hx1 = kx + 5;
      S.poly([[hx0, ky - 2], [hx1, ky - 2], [hx1, ky + 2], [kx + 2.5, ky + 4], [kx + 1, ky + 1.5], [kx - 1, ky + 5], [kx - 2.5, ky + 2], [hx0, ky + 3]], TROU, { tone: 0.35 });
      S.line(lerp(hip[0], kx, 0.3) - 2, lerp(hip[1], ky, 0.3), lerp(hip[0], kx, 0.7) - 1, lerp(hip[1], ky, 0.7), TROU[1]);
      S.px(kx - sd * 2, ky - 4, TROU[6]); S.px(kx - sd * 3, ky - 3, TROU[6]);
      // fur bursting out under the hem
      for (let i = 0; i < 3; i++) S.tri([kx - 4 + i * 3, ky + 2], [kx - 3 + i * 3 - sd, ky + 7], [kx - 2 + i * 3, ky + 2], fur, { tone: 0.45 });
    };
    leg(hipR, footR, 1, 0.2);
    leg(hipL, footL, -1, 0.5);

    // ---- torso: barrel chest, heavy shoulders, narrow waist ----
    W.ball(44, 30, 20, 9, fur, { lo: 0.5, hi: 8 });                     // traps / hackles
    W.ball(44, 56, 11, 9, fur, { lo: 0.5, hi: 9, rim: 0.4 });           // waist
    W.ball(44, 44, 18, 13, fur, { lo: 0.5, hi: 10, rim: 0.4 });         // chest
    W.ball(36, 41, 9, 7, fur, { lo: 1, hi: 11, spec: 0.1 });            // pecs
    W.ball(52, 41, 9, 7, fur, { lo: 1, hi: 10, rim: 0.3 });
    // pale fur running down the chest & belly, abs shaded beneath
    W.poly([[36, 40], [52, 40], [49, 50], [47, 60], [41, 60], [39, 50]], WFUR2, { grad: [38, 40, 50, 60, 0.75, 0.3] });
    W.line(29, 46, 36, 49, fur[2]); W.line(36, 49, 43, 48, fur[2]);
    W.line(45, 48, 52, 49, fur[2]); W.line(52, 49, 59, 46, fur[2]);
    for (const yy of [52, 56]) { W.line(40, yy, 43, yy + 1, WFUR2[3]); W.line(45, yy + 1, 48, yy, WFUR2[2]); }
    // waistband remnant & sagging rope belt
    W.poly([[31, 59], [57, 59], [58, 65], [30, 65]], TROU, { grad: [44, 59, 44, 65, 0.6, 0.3] });
    for (let i = 0; i < 8; i++) {
      const a = T.P(lerp(30, 58, i / 8), 60 + Math.sin(i / 8 * Math.PI) * 2), b = T.P(lerp(30, 58, (i + 1) / 8), 60 + Math.sin((i + 1) / 8 * Math.PI) * 2);
      S.capsule(a[0], a[1], b[0], b[1], 1.1, 1.1, R.wood, { lo: 1, hi: 6, spec: 0.3 });
    }
    const kn = T.P(36, 61.5);
    S.horn(kn[0], kn[1], kn[0] - 1, kn[1] + 3, kn[0] + 0.5, kn[1] + 6, 1, 0.6, R.wood, { lo: 1, hi: 5 });
    // chest ruff: a shaggy V of pale fur under the jaw
    for (let i = 0; i < 7; i++) {
      const bx = 34 + i * 3.4, by = 33 + Math.abs(i - 3) * -0.8;
      W.poly([[bx - 2.5, by], [bx + 2.5, by], [bx + (i - 3) * 0.5, by + 9 - Math.abs(i - 3) * 1.6]], WFUR2, { tone: 0.55 - Math.abs(i - 3) * 0.05 + (i < 3 ? 0.08 : 0) });
    }

    // ---- arms (outlined layers) ----
    const L1 = 17, L2 = 17;
    const doArm = (sh, hand, bend, lo, k, fs) => layer(S, A => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], L1 * s * fs, L2 * s * fs, bend);
      const o = { lo, hi: 10.5, rim: 0.35 };
      A.ball(sh[0], sh[1], 8.5 * s, 8 * s, fur, { lo, hi: 11, spec: 0.1, rim: 0.3 });
      A.capsule(sh[0], sh[1], j.ex, j.ey, 6.4 * s, 4.6 * s, fur, o);
      const mx = lerp(j.ex, j.hx, 0.4), my = lerp(j.ey, j.hy, 0.4);
      A.capsule(j.ex, j.ey, mx, my, 4.6 * s, 5.2 * s, fur, o);
      A.capsule(mx, my, j.hx, j.hy, 5.2 * s, 3.4 * s, fur, o);
      // elbow tuft
      const ex = j.ex - (j.hx - j.ex) * 0.15, ey = j.ey - (j.hy - j.ey) * 0.15;
      A.tri([ex - 2, ey - 2], [ex + (bend > 0 ? -5 : 5) * (sh[0] < 44 ? 1 : -1) * 0 + (j.ex - sh[0]) * 0.25, ey + 4], [ex + 2, ey + 2], fur, { tone: 0.4 });
      const dx = j.hx - j.ex, dy = j.hy - j.ey, d = Math.hypot(dx, dy) || 1;
      wolfClaw(A, j.hx + dx / d * 1.5, j.hy + dy / d * 1.5, dx / d, dy / d, k * s, lo, k > 1.3 ? 0.95 : 0.65);
    });
    const doL = () => doArm(shL, p.hL, p.bL, 0.5, p.kL, p.aL || 1);
    const doR = () => doArm(shR, p.hR, p.bR, 0.2, p.kR, p.aR || 1);
    if (p.front === -1) { doR(); doL(); }
    else { doL(); doR(); }

    // ---- head, thrust low and forward (in front of raised arms too) ----
    wolfHead(S, head[0], head[1], { k: s * 1.2, mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt * 2, up: p.up });

    // ---- fur: texture strokes & shaggy edges ----
    furTex(S, fur, inv);
    furTex(S, WFUR2, inv, 0.2);
    shagD(S, fur, (x, y) => { const m = inv(x, y); return [Math.round(m[0]), Math.round(m[1])]; }, 0.3);
    rimLight(S, fur, 2);

    S.outline();

    if (q.st) {
      if (q.dir < 0) rake(S, [[12, 6], [6, 30], [14, 56], [34, 80]], 3, 4.5, WRAKE, { behind: true, side: -1, w: 2.6 });
      else if (q.dir > 0) rake(S, [[76, 6], [82, 30], [74, 56], [54, 80]], 3, 4.5, WRAKE, { behind: true, side: 1, w: 2.6 });
      else {
        rake(S, [[30, 2], [20, 20], [17, 44], [22, 66]], 3, 3.6, WRAKE, { behind: true, side: -1, w: 2.2 });
        rake(S, [[58, 2], [68, 20], [71, 44], [66, 66]], 3, 3.6, WRAKE, { behind: true, side: 1, w: 2.2 });
      }
    }
  }

  // Portrait: a frontal snarl reads far better than the 3/4 snout at 24 px.
  function wolfPortrait(S) {
    crisp(S, 0.5, 1.2);
    S.ball(12, 26, 14, 7, WFUR, { lo: 0.5, hi: 9, rim: 0.3 });                      // shoulders
    for (const sd of [-1, 1]) {                                                         // ears
      S.poly([[12 + sd * 3, 6], [12 + sd * 8, -1], [12 + sd * 10, 10]], WFUR, { tone: sd < 0 ? 0.7 : 0.35 });
      S.poly([[12 + sd * 5, 6], [12 + sd * 7.5, 2], [12 + sd * 8.5, 8]], ['#101', '#201', '#312', '#423'], { tone: 0.5 });
      S.poly([[12 + sd * 6, 11], [12 + sd * 12, 14], [12 + sd * 7, 17]], WFUR, { tone: sd < 0 ? 0.55 : 0.3 });   // cheek ruff
      S.poly([[12 + sd * 6, 15], [12 + sd * 11, 20], [12 + sd * 5, 19]], WFUR, { tone: sd < 0 ? 0.45 : 0.25 });
    }
    S.ball(12, 11, 7.5, 6.5, WFUR, { lo: 1, hi: 11, spec: 0.1, rim: 0.3 });           // skull
    S.ball(12, 19.5, 4.6, 2.6, MOUTH, { tone: 0.3 });                                  // snarling mouth
    S.capsule(12, 9, 12, 15.5, 2.4, 3.6, WFUR2, { lo: 2, hi: 10, spec: 0.2 });         // muzzle
    for (const sd of [-1, 1]) {                                                         // fangs
      S.px(12 + sd * 3, 18, '#ffe'); S.px(12 + sd * 3, 19, '#ffe'); S.px(12 + sd * 3, 20, '#bba');
      S.px(12 + sd * 2, 21, '#ddc'); S.px(12 + sd * 4, 21, '#bba');
    }
    S.px(12, 21, '#a13');
    S.ball(12, 16, 2.2, 1.5, ['#000', '#101', '#112', '#223', '#445', '#778'], { spec: 1.2 });   // nose
    S.px(11, 12, WFUR[4]); S.px(13, 12, WFUR[4]); S.px(12, 13, WFUR[5]);              // snarl wrinkles
    for (const sd of [-1, 1]) {                                                         // eyes & scowl
      const ex = 12 + sd * 4;
      S.line(ex - sd * 2, 9, ex + sd * 2, 7, WFUR[2]);
      S.px(ex, 10, '#ff6'); S.px(ex + sd, 10, '#fb2'); S.px(ex - sd, 10, '#c60'); S.px(ex, 11, '#a40');
    }
    furTex(S, WFUR, (x, y) => [x * 1.3, y * 1.3], 0.18);
    S.outline();
  }

  EN['Werewolf'] = { w: 88, h: 96, anchor: [44, 94], center: [44, 48], mouth: [32, 40], draw: drawWerewolf, portrait: wolfPortrait };

  // ===============================================================
  // VAMPIRE — an aristocrat of the night: pale grey-white skin, slicked
  // black hair with a widow's peak, burning red eyes, fangs, a doublet
  // with gold buttons and a lace jabot, and a high-collared black cape
  // lined in crimson. The cape flares open like a bat wing on the side
  // he strikes from. hL/hR = hand targets, wL/wR = cape flare 0..1.
  // ===============================================================
  const CAPE = ['#000', '#001', '#101', '#102', '#112', '#213', '#223', '#334', '#445'];
  const LINING = R.crimson;
  const DOUB = ['#000', '#101', '#201', '#202', '#302', '#312', '#413', '#524', '#634'];
  const VSKIN = ['#101', '#212', '#323', '#434', '#656', '#878', '#a9a', '#cbc', '#dde', '#eef'];
  const VHAIR = ['#000', '#001', '#101', '#112', '#123', '#234', '#356'];
  const NAIL = ['#000', '#101', '#201', '#302', '#503', '#714'];
  const VRAKE = ['#301', '#a12', '#f86', '#fdc'];

  const vampKeys = {
    idle: f => {
      const br = [0, 0, 1, 1][f];
      return {
        lean: 0.02, dx: 0, dy: br, s: 1, hx: 0, hy: 0, tilt: 0, mo: 0.2, shut: 0, eye: [0, 1, 2, 1][f],
        hL: [37, 47 + br], hR: [60, 60 + br + [0, -2, -3, -1][f]], kL: 1, kR: 1, bL: 1, bR: -1, aL: 1, aR: 1, wL: 0.1, wR: 0.32, sway: [0, 2, 3, 1][f], front: 0,
      };
    },
    // claw raised high on the screen-left, cape flung open there like a wing
    wl: { lean: -0.12, dx: -2, dy: -2, hx: -2, hy: -1, mo: 0.8, eye: 2, hL: [13, 14], hR: [55, 58], bL: -1, bR: -1, aL: 0.9, wL: 1, wR: 0.15, kL: 1.15, sway: -2 },
    wl5: { hL: [16, 34], bL: -1, wL: 0.6 },
    // rises tall: both claws high, the cape spread wide behind like bat wings
    wh: { lean: 0, dx: 0, dy: -3, hx: 0, hy: -1, mo: 1, eye: 2, hL: [17, 13], hR: [71, 13], bL: -1, bR: 1, aL: 0.9, aR: 0.9, wL: 1, wR: 1, kL: 1.1, kR: 1.1, sway: 0, front: 2 },
    wh5: { hL: [20, 32], hR: [68, 32], wL: 0.6, wR: 0.6, front: 2 },
    // claw raised high on the screen-right, cape flung open there
    wr: { lean: 0.12, dx: 2, dy: -2, hx: 2, hy: -1, mo: 0.8, eye: 2, hR: [75, 14], hL: [33, 58], bR: 1, bL: 1, aR: 0.9, wR: 1, wL: 0.1, kR: 1.15, sway: 2 },
    wr5: { hR: [72, 34], bR: 1, wR: 0.6 },
    // strikes: a gliding lunge, claws raking through toward the viewer
    sl: { lean: 0.16, dx: 4, dy: 6, s: 1.1, hx: 4, hy: 3, mo: 1, eye: 2, hL: [58, 64], kL: 1.55, hR: [70, 58], bL: 1, bR: -1, wL: 1, wR: 0.3, cL: [9, 22], front: -1, sway: 4 },
    sh: { lean: 0, dx: 0, dy: 7, s: 1.1, hx: 0, hy: 4, mo: 1, eye: 2, hL: [36, 68], hR: [52, 68], kL: 1.45, kR: 1.45, bL: 1, bR: -1, wL: 1, wR: 1, cL: [8, 26], cR: [80, 26], front: 3, sway: 0 },
    sr: { lean: -0.16, dx: -4, dy: 6, s: 1.1, hx: -4, hy: 3, mo: 1, eye: 2, hR: [30, 64], kR: 1.55, hL: [18, 58], bL: 1, bR: -1, wR: 1, wL: 0.3, cR: [79, 22], front: 1, sway: -4 },
    // recoils, shielding the face with a forearm, hissing
    hurt: { lean: 0.12, dx: 3, dy: -1, s: 0.97, hx: 3, hy: -2, tilt: 1, mo: 1, shut: 1, eye: 0, hL: [41, 21], hR: [70, 50], bL: 1, bR: -1, wL: 0.25, wR: 0.75, sway: 3 },
  };

  // Long pale fingers ending in dark talons.
  function vampHand(S, x, y, ux, uy, k, spread = 0.5) {
    const base = Math.atan2(uy, ux);
    S.ball(x, y, 2.8 * k, 2.5 * k, VSKIN, { lo: 1.5, hi: 9, rim: 0.3 });
    for (let i = 0; i < 4; i++) {
      const a = base + (i - 1.5) * spread * 0.5;
      const c = Math.cos(a), s = Math.sin(a);
      const bx = x + c * 2 * k, by = y + s * 2 * k;
      const jx = bx + c * (4.2 - Math.abs(i - 1.5) * 0.6) * k, jy = by + s * (4.2 - Math.abs(i - 1.5) * 0.6) * k;
      S.capsule(bx, by, jx, jy, 0.95 * k, 0.8 * k, VSKIN, { lo: 2, hi: 9 });
      const hk = i < 2 ? 1 : -1;
      S.horn(jx, jy, jx + c * 2 * k, jy + s * 2 * k, jx + c * 3 * k - s * 1.2 * k * hk, jy + s * 3 * k + c * 1.2 * k * hk, 0.9 * k, 0.3, NAIL, { lo: 1, spec: 0.8 });
    }
    const ta = base + spread * 1.5;
    S.capsule(x, y, x + Math.cos(ta) * 3.5 * k, y + Math.sin(ta) * 3.5 * k, 1 * k, 0.8 * k, VSKIN, { lo: 2, hi: 8.5 });
  }

  function vampHead(S, x, y, o = {}) {
    const k = o.k || 1, mo = o.mo || 0, tl = o.tilt || 0;
    // pointed ears
    S.tri([x - 5.5 * k, y - 1 * k], [x - 9.5 * k, y - 5 * k], [x - 5.5 * k, y + 3 * k], VSKIN, { tone: 0.62 });
    S.tri([x + 5.5 * k, y - 1 * k], [x + 9.5 * k, y - 5 * k], [x + 5.5 * k, y + 3 * k], VSKIN, { tone: 0.38 });
    // long narrow face, pointed chin
    S.ball(x, y, 6.2 * k, 7.6 * k, VSKIN, { lo: 1, hi: 9, spec: 0.25, rim: 0.3 });
    S.ball(x, y + 5 * k, 4 * k, 3.6 * k, VSKIN, { lo: 1, hi: 8.5, rim: 0.2 });
    // hollow cheeks under high cheekbones
    spotAt(S, VSKIN, x - 4 * k, y + 3 * k, 1.5 * k, 2.4 * k, -2, 2);
    spotAt(S, VSKIN, x + 4 * k, y + 3 * k, 1.5 * k, 2.4 * k, -2, 2);
    // slicked-back black hair with a sharp widow's peak
    S.poly([[x - 7 * k, y - 1 * k], [x - 7 * k, y - 6 * k], [x - 3 * k, y - 9.5 * k], [x + 3 * k, y - 9.5 * k], [x + 7 * k, y - 6 * k], [x + 7 * k, y - 1 * k],
            [x + 5.6 * k, y - 4 * k], [x + 2 * k, y - 5.2 * k], [x, y - 2.6 * k], [x - 2 * k, y - 5.2 * k], [x - 5.6 * k, y - 4 * k]], VHAIR, { grad: [x - 5 * k, y - 9 * k, x + 4 * k, y - 2 * k, 0.9, 0.15] });
    S.line(x - 4 * k, y - 8.5 * k, x - 1 * k, y - 4.6 * k, VHAIR[6]);
    S.line(x - 5.5 * k, y - 6.5 * k, x - 3.5 * k, y - 4.4 * k, VHAIR[5]);
    // arched brows slanting down to the nose
    S.line(x - 4.5 * k, y - 2.5 * k + tl, x - 1 * k, y - 1.2 * k + tl, VSKIN[2]);
    S.line(x + 1 * k, y - 1.2 * k + tl, x + 4.5 * k, y - 2.5 * k + tl, VSKIN[1]);
    // burning red eyes in shadowed sockets
    const ey = Math.round(y - 0.2 * k + tl * 0.5);
    for (const sd of [-1, 1]) {
      const ex = Math.round(x + sd * 2.6 * k - 0.5);
      S.px(ex - 1, ey, VSKIN[3]); S.px(ex + 1, ey, VSKIN[3]);
      if (o.shut) { S.line(ex - 1, ey, ex + 1, ey + (sd < 0 ? 1 : 0), VSKIN[1]); continue; }
      S.px(ex, ey, o.eye > 1 ? '#fff' : '#f86'); S.px(ex + sd, ey, '#e22'); S.px(ex - sd, ey, '#a12');
      if (o.eye > 0) { S.px(ex, ey - 1, '#e22'); if (o.eye > 1) S.px(ex, ey + 1, '#a12'); }
    }
    // long straight nose
    S.line(x, y - 1 * k, x, y + 2.5 * k, VSKIN[7]);
    S.px(x + 1, y + 2.5 * k, VSKIN[3]);
    // mouth: thin cruel lips; fangs; a hiss when it opens
    const my = Math.round(y + 4.6 * k);
    if (mo > 0.4) {
      const mh = Math.round(1 + mo * 2.2 * k);
      S.rect(Math.round(x - 2.2 * k), my, Math.round(4.4 * k) + 1, mh, MOUTH[1]);
      S.px(x - 1.5 * k, my, '#ffe'); S.px(x - 1.5 * k, my + 1, '#ccb');
      S.px(x + 1.5 * k, my, '#ffe'); S.px(x + 1.5 * k, my + 1, '#ccb');
      S.px(x - 1.5 * k, my + mh - 1, '#ccb'); S.px(x + 1.5 * k, my + mh - 1, '#ccb');
      S.line(x - 2 * k, my - 1, x + 2 * k, my - 1, '#612');
    } else {
      S.line(x - 2 * k, my, x + 2 * k, my, '#612');
      S.px(x - 1.5 * k, my + 1, '#ffe'); S.px(x + 1.5 * k, my + 1, '#ffe');
    }
  }

  function drawVampire(S, pose) {
    crisp(S, 0.5, 1.2);
    const q = decode(pose);
    const p = resolve(vampKeys, q);
    const T = mkT(p, 44, 94, 64), W = wrap(S, T), s = T.s;
    const sway = p.sway || 0;

    const shL = T.P(34, 33), shR = T.P(54, 33);
    const head = T.P(44 + p.hx, 20 + p.hy);
    const hipL = T.P(40, 64), hipR = T.P(48, 64);
    const footL = [38, 92], footR = [51, 92];

    // ---- cape geometry: per side, closed (black outside) -> flared (crimson lining) ----
    const panel = (sd, w, hand) => {
      const sh = T.P(44 + sd * 11, 32);
      const H = hand;
      const closed = [sh, T.P(44 + sd * 16, 46), T.P(44 + sd * 20, 64), [44 + sd * 25 + sway * 0.5, 82], [44 + sd * 28 + sway, 92]];
      // flared: a bat wing — tips flung out past the hand, scalloped between
      const tipX = clamp(H[0] + sd * 10, 3, 85), tip2X = clamp(lerp(H[0], 44 + sd * 30, 0.5) + sd * 9, 3, 85);
      const flared = [sh, H, [tipX, H[1] + 21], [tip2X, lerp(H[1], 92, 0.6)], [44 + sd * 27 + sway, 92]];
      const outer = closed.map((c, i) => [lerp(c[0], flared[i][0], w), lerp(c[1], flared[i][1], w)]);
      const inner = [T.P(44 + sd * 3, 30), T.P(44 + sd * 5, 44), T.P(44 + sd * 6.5, 62), [44 + sd * 8 + sway * 0.3, 80], [44 + sd * 9 + sway * 0.3, 92]];
      return { outer, inner, w, sd, H };
    };
    const pL = panel(-1, p.wL, p.cL || p.hL), pR = panel(1, p.wR, p.cR || p.hR);
    // scalloped bat-wing edge between two points (bulging toward the body)
    const scallop = (a, b, sd, depth) => {
      const pts = [];
      for (let i = 1; i < 4; i++) {
        const t = i / 4, bump = Math.sin(t * Math.PI) * depth;
        pts.push([lerp(a[0], b[0], t) - sd * bump, lerp(a[1], b[1], t)]);
      }
      return pts;
    };
    const paintPanel = pn => {
      const { outer, inner, w, sd, H } = pn;
      const oEdge = [outer[0], outer[1]];
      for (let i = 1; i < outer.length - 1; i++) oEdge.push(...(w > 0.4 ? scallop(outer[i], outer[i + 1], sd, (i === 1 ? 3 : 7) * w) : []), outer[i + 1]);
      const hemIn = inner[inner.length - 1];
      // crimson lining
      S.poly(oEdge.concat(inner.slice().reverse()), LINING, { grad: [outer[2][0], outer[2][1], inner[2][0], inner[3][1], 0.92, 0.22], hi: 6.8 });
      if (w > 0.35) {   // bat-wing ribs: folds running from the hand to each wing tip
        for (const e of [outer[2], outer[3]]) {
          S.line(H[0], H[1] + 2, lerp(e[0], 44, 0.12), e[1] - 1, LINING[2]);
          S.line(H[0] - sd, H[1] + 3, lerp(e[0], 44, 0.12) - sd, e[1] - 1, LINING[5]);
        }
      }
      // black outside: whole panel when closed, a turned-back rim when flared
      const bt = w * 0.8;
      const bandIn = inner.map((c, i) => [lerp(c[0], outer[i][0], bt), lerp(c[1], outer[i][1], bt * (i === 0 ? 1 : 0.8))]);
      S.poly(oEdge.concat(bandIn.slice().reverse()), CAPE, { grad: [44 - sd * 10, 30, 44 + sd * 20, 92, 0.75, 0.15] });
      if (w < 0.6) {    // satin folds
        for (const t of [0.3, 0.62]) {
          const top = [lerp(inner[0][0], outer[0][0], t), lerp(inner[0][1], outer[0][1], t) + 3];
          const bot = [lerp(bandIn[4][0], outer[4][0], t), 90];
          S.line(top[0], top[1], bot[0], bot[1], CAPE[sd < 0 ? 6 : 4]);
          S.line(top[0] + sd, top[1] + 1, bot[0] + sd, bot[1], CAPE[1]);
        }
      }
    };

    // ---- high collar behind the head: crimson inside, black rim ----
    for (const sd of [-1, 1]) {
      const base = T.P(44 + sd * 3, 31), tip = T.P(44 + sd * 15, 6 + (sd > 0 ? 1 : 0)), mid = T.P(44 + sd * 13, 24);
      const neck = T.P(44 + sd * 9, 31);
      S.poly([base, [tip[0] - sd * 3, tip[1] + 2], tip, mid, neck], CAPE, { tone: sd < 0 ? 0.55 : 0.3 });
      S.poly([T.P(44 + sd * 4, 30), [tip[0] - sd * 2, tip[1] + 5], [mid[0] - sd * 2, mid[1]], T.P(44 + sd * 8, 30)], LINING, { grad: [tip[0], tip[1], base[0], base[1], sd < 0 ? 0.75 : 0.5, 0.15] });
    }

    // ---- back of the cape: shadowed lining seen between the panels ----
    S.poly([T.P(33, 32), T.P(55, 32), [pR.outer[4][0] - 4, 91], [44, 89], [pL.outer[4][0] + 4, 91]], LINING, { tone: 0.12 });

    // ---- legs: slim black breeches, polished boots ----
    const leg = (hip, foot, sd, lo) => {
      const kx = lerp(hip[0], foot[0], 0.5) + sd * 0.5, ky = lerp(hip[1], foot[1], 0.5);
      S.capsule(hip[0], hip[1], kx, ky, 3.6 * s, 3, DOUB, { lo, hi: 6 });
      S.capsule(kx, ky, foot[0], foot[1] - 2, 3.2, 2.6, CAPE, { lo, hi: 8, spec: 0.8 });
      S.ball(foot[0] + sd * 1.5, foot[1] - 1, 3.8, 2, CAPE, { lo, hi: 8, spec: 0.8 });
      S.line(kx - 3, ky + 1, kx + 3, ky + 1, CAPE[6]);
    };
    leg(hipR, footR, 1, 0.3);
    leg(hipL, footL, -1, 0.8);

    // ---- doublet: slim waist, gold buttons, lace jabot, ruby brooch ----
    W.poly([[35, 31], [53, 31], [52, 52], [50, 64], [38, 64], [36, 52]], DOUB, { grad: [36, 30, 54, 60, 0.75, 0.2] });
    W.ball(44, 41, 9, 10, DOUB, { lo: 1, hi: 8, rim: 0.3 });
    W.line(38, 56, 50, 56, R.gold[3]); W.line(38, 57, 50, 57, DOUB[1]);
    W.poly([[38, 57], [50, 57], [52, 66], [36, 66]], DOUB, { tone: 0.35 });
    for (let i = 0; i < 5; i++) { const b = T.P(44, 41 + i * 3.5); S.px(b[0], b[1], R.gold[6]); S.px(b[0] + 1, b[1] + 1, R.gold[3]); }
    for (let i = 0; i < 4; i++) W.ball(44 + (i % 2 ? 1 : -1) * 0.8, 32.5 + i * 2.2, 3.2 - i * 0.35, 1.4, R.bone, { lo: 3, spec: 0.3 });
    const br = T.P(44, 32);
    S.ball(br[0], br[1], 1.8, 1.6, R.gold, { lo: 2, spec: 0.6 });
    S.px(br[0], br[1], '#e22'); S.px(br[0] - 1, br[1] - 1, '#f86');

    // ---- arms: black sleeves, lace cuffs, pale clawed hands ----
    const L1 = 14, L2 = 14;
    const armOf = (sh, hand, bend, lo, k, fs, pn) => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], L1 * s * fs, L2 * s * fs, bend);
      const dx = j.hx - j.ex, dy = j.hy - j.ey, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const sleeve = () => layer(S, A => {
        A.ball(sh[0], sh[1], 4.5 * s, 4 * s, DOUB, { lo, hi: 7.5, rim: 0.3 });
        A.capsule(sh[0], sh[1], j.ex, j.ey, 3.4 * s, 2.8 * s, DOUB, { lo, hi: 7.5, rim: 0.3 });
        A.capsule(j.ex, j.ey, j.hx - ux * 2, j.hy - uy * 2, 2.8 * s, 2.3 * s, DOUB, { lo, hi: 7.5, rim: 0.3 });
      });
      const hand2 = () => layer(S, A => {
        A.ball(j.hx - ux * 2, j.hy - uy * 2, 2.6 * k, 2.4 * k, R.bone, { lo: 3, spec: 0.3 });   // lace cuff
        vampHand(A, j.hx + ux * 0.5, j.hy + uy * 0.5, ux, uy, k * s, k > 1.3 ? 1 : 0.6);
      }, 0.25);
      return { sleeve, hand2 };
    };
    const aL = armOf(shL, p.hL, p.bL, 0.5, p.kL, p.aL || 1), aR = armOf(shR, p.hR, p.bR, 0.3, p.kR, p.aR || 1);
    const side = (pn, a) => {
      if (pn.w >= 0.5 || pn.free) { paintPanel(pn); a.sleeve(); }
      else { a.sleeve(); paintPanel(pn); }
    };
    if (p.front === -1) { side(pR, aR); aR.hand2(); side(pL, aL); }
    else if (p.front === 1) { side(pL, aL); aL.hand2(); side(pR, aR); }
    else { side(pL, aL); side(pR, aR); }

    // ---- head ----
    vampHead(S, head[0], head[1], { k: s * 1.1, mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt * 2, eye: Math.round(p.eye || 0) });
    // hands last: in front of cape and face
    if (p.front === -1) aL.hand2();
    else if (p.front === 1) aR.hand2();
    else { aL.hand2(); aR.hand2(); }

    S.outline();

    if (q.st) {
      // the slash is drawn over the cape: it comes at the viewer
      if (q.dir < 0) rake(S, [[8, 14], [12, 36], [28, 54], [48, 62]], 3, 4, VRAKE, { side: -1, w: 2.2 });
      else if (q.dir > 0) rake(S, [[80, 14], [76, 36], [60, 54], [40, 62]], 3, 4, VRAKE, { side: 1, w: 2.2 });
      else {
        rake(S, [[22, 8], [20, 28], [24, 50], [32, 64]], 3, 3.4, VRAKE, { side: -1, w: 2 });
        rake(S, [[66, 8], [68, 28], [64, 50], [56, 64]], 3, 3.4, VRAKE, { side: 1, w: 2 });
      }
    }
  }

  function vampPortrait(S) {
    crisp(S, 0.5, 1.2);
    // collar wings, cape shoulders, jabot
    for (const sd of [-1, 1]) {
      S.poly([[12 + sd * 2, 20], [12 + sd * 11, 2], [12 + sd * 12, 16], [12 + sd * 7, 21]], CAPE, { tone: sd < 0 ? 0.55 : 0.3 });
      S.poly([[12 + sd * 3, 20], [12 + sd * 10, 5], [12 + sd * 10.5, 15], [12 + sd * 6, 20]], LINING, { grad: [12 + sd * 10, 5, 12, 20, 0.75, 0.15] });
    }
    S.poly([[0, 24], [0, 19], [7, 17], [17, 17], [24, 19], [24, 24]], CAPE, { grad: [0, 17, 24, 24, 0.7, 0.2] });
    S.poly([[8, 17], [16, 17], [14, 24], [10, 24]], DOUB, { tone: 0.4 });
    S.ball(12, 19, 2.6, 1.4, R.bone, { lo: 3, spec: 0.3 }); S.ball(12, 21, 2.2, 1.3, R.bone, { lo: 3 });
    S.px(12, 23, '#e22');
    vampHead(S, 12, 10, { k: 1.05, mo: 0.6, eye: 2 });
    S.outline();
  }

  EN['Vampire'] = { w: 88, h: 96, anchor: [44, 94], center: [44, 46], mouth: [44, 26], draw: drawVampire, portrait: vampPortrait };
})();
