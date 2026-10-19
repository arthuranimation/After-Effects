// ================================================================
// ENEMIES — TIER II "The Blood Sands"
// Gnoll · Hobgoblin · Ghoul · Bugbear · Wight
//
// Each creature is posed from a small set of key poses (idle, three
// wind-ups, three strikes, hurt). Half wind-ups are interpolated from
// idle toward the full cocked pose. The upper body is posed with a
// shear/scale transform pivoting at the hips; arms are solved with
// two-bone IK toward screen-space hand targets so wind-up tells are
// placed exactly where the player needs to read them.
// ================================================================
(() => {
  const K = DW.kit, P = DW.pal, U = DW.util;
  const EN = DW.art.enemies;
  const R = P.ramps;
  const clamp = U.clamp;
  const lerp = (a, b, t) => a + (b - a) * t;
  const D2R = Math.PI / 180;

  // ---------------------------------------------------------------
  // Extra ramps (12-bit, hue-shifted: cool darks, warm lights)
  // ---------------------------------------------------------------
  const MANE = ['#100', '#101', '#211', '#311', '#421', '#532', '#643'];
  const MUZ = ['#101', '#201', '#211', '#312', '#422', '#532', '#643', '#754'];
  const GFUR = ['#101', '#211', '#312', '#422', '#532', '#643', '#853', '#a74', '#c95', '#db7', '#ec9'];
  const HIDE = ['#100', '#200', '#310', '#321', '#432', '#643', '#754', '#865'];
  const MOUTH = ['#100', '#200', '#301', '#502', '#713', '#934'];

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
      else if (Array.isArray(vb) && Array.isArray(va)) o[k] = vb.map((v, i) => (typeof v === 'number' ? lerp(va[i], v, t) : v));
      else o[k] = vb;
    }
    for (const k in a) if (!(k in o)) o[k] = a[k];
    return o;
  };

  // keys: { idle(f) -> obj, wl, wh, wr, sl, sh, sr, hurt, wl5?, wh5?, wr5? }
  const resolve = (keys, q) => {
    const base = keys.idle(0);
    let p;
    if (q.hu) p = keys.hurt;
    else if (q.st) p = keys[['sl', 'sh', 'sr'][q.dir + 1]];
    else if (q.w) {
      const n = ['wl', 'wh', 'wr'][q.dir + 1];
      p = q.w >= 1 ? keys[n] : (keys[n + '5'] ? lerpObj(lerpObj(base, keys[n], 0.5), keys[n + '5'], 1) : lerpObj(base, keys[n], 0.5));
    } else p = keys.idle(q.f);
    return lerpObj(base, p, 1);
  };

  // Upper-body transform: shear (lean) above the hip pivot, scale about the anchor.
  const mkT = (p, ax = 44, ay = 94, py = 64) => {
    const s = p.s || 1, lean = p.lean || 0, dx = p.dx || 0, dy = p.dy || 0;
    const X = (x, y) => ax + (x - ax + Math.max(0, py - y) * lean) * s + dx;
    const Y = (x, y) => ay + (y - ay) * s + dy;
    return { s, X, Y, P: (x, y) => [X(x, y), Y(x, y)] };
  };

  // Wrap a Sprite so primitives take model-space coordinates.
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

  // Two-bone IK: elbow position for shoulder (sx,sy) reaching (hx,hy). bend ±1 picks the side.
  const ik = (sx, sy, hx, hy, l1, l2, bend) => {
    let dx = hx - sx, dy = hy - sy, d = Math.hypot(dx, dy) || 0.001;
    const maxd = l1 + l2 - 0.3;
    if (d > maxd) { hx = sx + dx / d * maxd; hy = sy + dy / d * maxd; dx = hx - sx; dy = hy - sy; d = maxd; }
    const dd = Math.max(d, Math.abs(l1 - l2) + 0.5);
    const a = Math.acos(clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1));
    const base = Math.atan2(dy, dx) + a * bend;
    return { ex: sx + Math.cos(base) * l1, ey: sy + Math.sin(base) * l1, hx, hy };
  };

  // Crisper shading for this file's sprites: dither only across the middle of
  // each ramp step (flat colour clusters with dithered transitions) instead of
  // dithering everywhere. Installed per Sprite instance; the kit is untouched.
  // contrast > 1 steepens the light falloff around mid-tone (carves form).
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
  // Shift a pixel d steps along its ramp (only if it belongs to that ramp).
  const nudge = (S, x, y, ramp, d) => {
    const i = inRamp(S, x, y, ramp);
    if (i === undefined) return false;
    S.set(x, y, ramp[clamp(i + d, 0, ramp.length - 1)]);
    return true;
  };

  // Deterministic shaggy edge: tufts decided by a hash of body-relative coords
  // (keyX/keyY map a screen pixel to a stable key) so the fur doesn't boil.
  const hash2 = (x, y) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
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
  // Fur strokes at model-space positions (list of [x, y, len, slant]) through transform T.
  const strokeList = (seed, n, x0, y0, w, h) => {
    const r = U.rng(seed), a = [];
    for (let i = 0; i < n; i++) a.push([x0 + r() * w, y0 + r() * h, 3 + Math.floor(r() * 3), (r() - 0.5) * 0.9]);
    return a;
  };
  const furStrokes = (S, ramp, list, T, minI = 3) => {
    for (const [x, y, len, sl] of list) {
      const X = T ? T.X(x, y) : x, Y = T ? T.Y(x, y) : y;
      const i0 = inRamp(S, X, Y, ramp);
      if (i0 === undefined || i0 < minI) continue;
      for (let t = 0; t < len; t++) nudge(S, Math.round(X + sl * t), Math.round(Y + t), ramp, -1);
      nudge(S, Math.round(X - sl), Math.round(Y - 1), ramp, 1);
    }
  };
  const limbStrokes = (S, ramp, x1, y1, x2, y2, rad, n, seed) => {
    const r = U.rng(seed);
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const list = [];
    for (let i = 0; i < n; i++) {
      const t = 0.05 + r() * 0.9, o = (r() - 0.5) * 1.6 * rad;
      list.push([x1 + dx * t + nx * o, y1 + dy * t + ny * o, 2 + Math.floor(r() * 2), (r() - 0.5) * 0.8]);
    }
    furStrokes(S, ramp, list, null);
  };

  // Motion swoosh along a Catmull-Rom path through pts: a crescent band whose
  // path edge is bright and which dithers away across its width (side ±1 picks
  // which side of the path the band grows on); brighter toward the leading end.
  // o.behind: only paint transparent pixels so it trails behind the body.
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
    // per-sample normals & radii
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
      const along = (cx - sx) * nx + (cy - sy) * ny;     // signed distance across the band
      const r = rad[bi];
      if (along < -0.6 || along > r || r < 0.5) continue;
      const t = bi / N;
      const lvl = (0.45 + 0.55 * t) * (1 - Math.pow(Math.max(0, along) / (r + 0.8), 1.2));
      if (lvl < P.thresh(px, py) * 0.9) continue;
      S.set(px, py, cols[Math.min(n - 1, Math.floor(lvl * n))]);
    }
  };

  // Precomputed spot list in model space (so spots stick to the body between frames).
  const spotList = (seed, n, x0, y0, w, h, r0 = 0.9, r1 = 1.1) => {
    const r = U.rng(seed), a = [];
    for (let i = 0; i < n; i++) a.push([x0 + r() * w, y0 + r() * h, r0 + r() * r1, (r0 + r() * r1) * 0.75]);
    return a;
  };
  const spotAt = (S, ramp, cx, cy, rx, ry, d, minI = 3) => {
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
  // Spots scattered along a limb segment (deterministic per seed, moves with the limb).
  const limbSpots = (S, ramp, x1, y1, x2, y2, rad, n, seed, d = -2) => {
    const r = U.rng(seed);
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    for (let i = 0; i < n; i++) {
      const t = 0.1 + r() * 0.8, o = (r() - 0.5) * 1.3 * rad;
      spotAt(S, ramp, x1 + dx * t + nx * o, y1 + dy * t + ny * o, 0.9 + r() * 0.8, 0.8 + r() * 0.5, d);
    }
  };

  // ---------------------------------------------------------------
  // Weapons
  // ---------------------------------------------------------------
  // Bone-studded war club. (gx,gy) grip, a = angle (deg) toward the head, len, k = head scale.
  function boneClub(S, gx, gy, a, len, k = 1, seed = 3) {
    const c = Math.cos(a * D2R), s = Math.sin(a * D2R);
    const nx = -s, ny = c;
    const bx = gx - c * 5, by = gy - s * 5;            // pommel
    const tx = gx + c * len, ty = gy + s * len;        // head end
    // haft swelling toward the head
    S.capsule(bx, by, gx + c * len * 0.55, gy + s * len * 0.55, 2.2, 3.2 * k, 'wood', { lo: 1 });
    S.capsule(gx + c * len * 0.45, gy + s * len * 0.45, tx, ty, 3.2 * k, 5 * k, 'wood', { lo: 1, spec: 0.2 });
    // knots / grain
    S.ball(gx + c * len * 0.7 + nx * 2 * k, gy + s * len * 0.7 + ny * 2 * k, 1.6 * k, 1.2 * k, 'wood', { lo: 0, hi: 4 });
    // leather grip wrap
    for (let i = -2; i <= 3; i += 2) {
      const px = gx + c * i, py = gy + s * i;
      S.line(px + nx * 2.2, py + ny * 2.2, px - nx * 2.2, py - ny * 2.2, '#211');
    }
    // bone studs: spikes driven through the head
    const studs = [[0.62, 1], [0.74, -1], [0.84, 1], [0.93, -1], [1.0, 1], [0.78, 1], [0.9, -1]];
    const r = U.rng(seed);
    for (const [t, side] of studs) {
      const sx = gx + c * len * t, sy = gy + s * len * t;
      const rr = (3.4 + 1.6 * t) * k;
      const ox = sx + nx * side * rr * 0.7, oy = sy + ny * side * rr * 0.7;
      const L = (3.2 + r() * 1.5) * k;
      const ex = ox + (nx * side * 0.9 + c * 0.35) * L, ey = oy + (ny * side * 0.9 + s * 0.35) * L;
      S.capsule(ox, oy, ex, ey, 1.2 * k, 0.4, 'bone', { lo: 2, spec: 0.3 });
    }
    // tip spike (a big tooth)
    S.horn(tx, ty, tx + c * 3 * k + nx * 1.5, ty + s * 3 * k + ny * 1.5, tx + c * 6 * k - nx * 0.5, ty + s * 6 * k - ny * 0.5, 1.8 * k, 0.4, 'bone', { lo: 2, spec: 0.3 });
  }

  // ===============================================================
  // GNOLL — hyena-headed marauder, bone-studded club, bone necklace
  // Hunched: the head juts forward in front of a maned hump.
  // g1 = lower grip (pommel side), g2 = upper grip. a1/a2 = which grip each arm
  // takes (1/2, 0 = free). b1/b2 = elbow bend sides.
  // ===============================================================
  const gnollKeys = {
    idle: f => {
      const br = [0, 1, 1, 0][f], hb = [0, 0, 1, 1][f], sw = [0, 1, 0, -1][f];
      return {
        lean: 0, dx: 0, dy: br, s: 1, hx: 0, hy: hb, tilt: 0, mo: 0.5 + 0.25 * sw, shut: 0,
        g1: [20, 67 + br], wa: 115 + sw * 2, wl: 21, wk: 1, gf: [69, 69 + br],
        a1: 1, a2: 0, b1: 1, b2: -1, mane: [0, 1, 2, 1][f], cb: 0,
      };
    },
    // club cocked high over the screen-left shoulder; off arm crosses under the chin
    wl: { lean: -0.14, dx: -3, dy: -1, hx: -2, hy: -1, mo: 0.9, g1: [21, 32], wa: 246, wl: 22, wk: 1.12, a1: 2, a2: 1, b1: -1, b2: -1, mane: 3 },
    wl5: { g1: [27, 46], wa: 222, wl: 21, a1: 1, a2: 0, b1: 1, gf: [62, 54], mane: 2 },
    // club straight up behind the head, both fists above the ears
    wh: { lean: 0, dx: 0, dy: -3, hx: 0, hy: 3, mo: 1, g1: [44, 21], wa: 270, wl: 10, wk: 1.3, a1: 1, a2: 2, b1: -1, b2: 1, mane: 3, cb: 1 },
    wh5: { g1: [44, 37], wa: 270, wl: 26, wk: 1.15, a1: 1, a2: 2, b1: 1, b2: -1, mo: 0.8, cb: 1, mane: 2 },
    // club cocked high over the screen-right shoulder
    wr: { lean: 0.14, dx: 3, dy: -1, hx: 2, hy: -1, mo: 0.9, g1: [67, 32], wa: -66, wl: 22, wk: 1.12, a1: 1, a2: 2, b1: 1, b2: 1, mane: 3 },
    wr5: { g1: [58, 46], wa: -42, wl: 21, a1: 1, a2: 0, b1: 1, gf: [72, 56], mane: 2 },
    // strikes: lunge at the viewer, club swept through in front of the body
    sl: { lean: 0.09, dx: 3, dy: 6, s: 1.08, hx: 3, hy: 2, mo: 1, g1: [50, 60], wa: 36, wl: 24, wk: 1.3, a1: 2, a2: 1, b1: -1, b2: -1 },
    sh: { lean: 0, dx: 0, dy: 9, s: 1.1, hx: 0, hy: 0, mo: 1, g1: [44, 50], wa: 90, wl: 13, wk: 1.75, a1: 1, a2: 2, b1: 1, b2: -1 },
    sr: { lean: -0.09, dx: -3, dy: 6, s: 1.08, hx: -3, hy: 2, mo: 1, g1: [38, 60], wa: 144, wl: 24, wk: 1.3, a1: 2, a2: 1, b1: 1, b2: 1 },
    hurt: { lean: 0.11, dx: 3, dy: -1, s: 0.97, hx: 5, hy: -3, tilt: 1, mo: 1, shut: 1, g1: [15, 60], wa: 98, wl: 21, gf: [70, 30], a1: 1, a2: 0, b1: 1, b2: 1, mane: 3 },
  };

  const GN_SPOTS = spotList(9, 20, 26, 31, 36, 30, 1.3, 1.1);

  // Hyena head, 3/4 view turned toward screen-left. (x,y) = skull centre (screen).
  function gnollHead(S, x, y, o = {}) {
    const k = o.k || 1, mo = o.mo || 0;
    const tl = o.tilt || 0;  // hurt: head thrown back (muzzle lifts)
    const fur = GFUR;
    // ears: tall, rounded-pointed, tilted outward, dark-rimmed
    const ear = (ex, ey, rot, lo) => {
      S.ball(ex, ey, 3.6 * k, 6.4 * k, MANE, { rot, lo: 1 });
      S.ball(ex + Math.sin(-rot) * 0.6, ey + 0.9 * k, 2.6 * k, 5 * k, fur, { rot, lo: lo + 2, hi: 9 });
      S.ball(ex + Math.sin(-rot) * 0.9 + 0.3, ey + 1.8 * k, 1.3 * k, 3.4 * k, MANE, { rot, lo: 0, hi: 3 });
    };
    ear(x - 8.5 * k, y - 8 * k + tl, -0.45, 1);
    ear(x + 8 * k, y - 9 * k + tl, 0.35, 0);
    // skull, cheek ruff
    S.ball(x + 1 * k, y + 0.5 * k, 8.4 * k, 7.4 * k, fur, { lo: 1, hi: 10, spec: 0.1, rim: 0.4 });
    S.ball(x + 3 * k, y + 5 * k, 6.5 * k, 4.4 * k, fur, { lo: 1, hi: 8, rim: 0.4 });
    // muzzle: long, tapering down-left, sandy on top with a dark sooty tip
    const mx = x - 10.5 * k, my = y + (8.5 - tl * 6) * k;
    const jo = 1.6 + mo * 4.6;
    const jx = mx + 2.4 * k, jy = my + jo * k;
    // lower jaw sits behind the snout
    S.capsule(x + 2 * k, y + 7.5 * k, jx, jy, 3 * k, 1.9 * k, fur, { lo: 1, hi: 6 });
    if (mo > 0.2) {
      // mouth interior + tongue
      S.poly([[x + 3 * k, y + 5 * k], [mx + 0.5 * k, my + 1.4 * k], [jx - 0.8, jy - 0.6], [x + 2 * k, y + 8.6 * k]], MOUTH, { grad: [x, y + 5 * k, x, y + 9 * k, 0.6, 0.05] });
      if (mo > 0.6) S.ball(lerp(x + 1, jx, 0.45), lerp(y + 7.5 * k, jy, 0.45) - 0.2, 2 * k, 1.1 * k, R.blood, { lo: 3, hi: 6 });
      // lower fangs
      for (let i = 0; i < 3; i++) {
        const t = 0.25 + i * 0.3;
        const tx = lerp(x + 2 * k, jx, t), ty = lerp(y + 7.3 * k, jy, t) - 1.6 * k;
        S.px(tx, ty, '#eed'); if (i === 2) S.px(tx, ty - 1, '#bba');
      }
    }
    S.capsule(x - 0.5 * k, y + 1 * k, mx, my, 4.8 * k, 3 * k, fur, { lo: 1, hi: 10, spec: 0.15 });
    S.capsule(lerp(x, mx, 0.66), lerp(y + 1 * k, my, 0.66), mx, my, 3.3 * k, 3 * k, MUZ, { lo: 1, spec: 0.3 });
    S.line(x - 2 * k, y - 0.8 * k, lerp(x, mx, 0.6), lerp(y, my, 0.6) - 2.6 * k, '#db7');
    // upper teeth along the gum line: the hyena grin running back to the cheek
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const tx = lerp(x + 3 * k, mx + 1.2 * k, t), ty = lerp(y + 5.4 * k, my + 2.2 * k, t);
      if (mo > 0.2) {
        S.px(tx, ty, i % 2 ? '#bba' : '#ffe');
        if (i === 5) S.px(tx, ty + 1, '#ddc');
      } else S.px(tx, ty, i % 3 === 2 ? '#ddc' : '#101');
    }
    // nose
    S.ball(mx - 0.8 * k, my - 0.4 * k, 2.5 * k, 2 * k, ['#000', '#101', '#112', '#223', '#445'], { spec: 1 });
    // brow: heavy dark ridge slanting down to the snout
    S.line(x - 6 * k, y - 3 * k, x - 1 * k, y - 1.5 * k, MANE[2]);
    S.line(x + 2 * k, y - 2.5 * k, x + 7 * k, y - 4 * k, MANE[2]);
    // eyes: dark tear-mark patches, burning amber pupils
    const eye = (ex, ey, side) => {
      ex = Math.round(ex); ey = Math.round(ey);
      S.px(ex - 1, ey, '#211'); S.px(ex + 1, ey, '#211'); S.px(ex, ey + 1, '#312'); S.px(ex - side, ey + 1, '#211');
      S.px(ex - side, ey + 2, '#312');
      if (o.shut) { S.px(ex, ey, '#211'); S.px(ex - side, ey, '#101'); S.px(ex + side, ey - 1, '#211'); return; }
      S.px(ex, ey, '#ff8'); S.px(ex + side, ey, '#f92'); S.px(ex - side, ey, '#a40');
    };
    eye(x - 4.5 * k, y - 0.5 * k + tl * 0.5, -1);
    eye(x + 4 * k, y - 1.5 * k + tl * 0.5, 1);
    // forehead spots
    spotAt(S, fur, x - 1 * k, y - 5.5 * k, 1.4, 1.1, -3);
    spotAt(S, fur, x + 5 * k, y - 4 * k, 1.2, 1, -3);
    spotAt(S, fur, x + 7 * k, y + 3.5 * k, 1.3, 1.1, -3);
  }

  // Bristling dark mane fanned out behind the head and down the hump.
  function gnollMane(S, x, y, o = {}) {
    const k = o.k || 1, b = o.bristle || 0;
    S.ball(x + 1 * k, y + 1 * k, 11 * k, 10 * k, MANE, { lo: 1, hi: 4 });
    const r = U.rng(41);
    for (let i = 0; i < 13; i++) {
      const a = (-185 + i * 15.5) * D2R;
      const L = (6 + r() * 4 + (i % 2) * 2 + b * 0.8) * k;
      const bx = x + 1 * k + Math.cos(a) * 8 * k, by = y + 1 * k + Math.sin(a) * 8 * k;
      const tx = bx + Math.cos(a) * L + (i % 3 - 1) * 1.5, ty = by + Math.sin(a) * L - 1.5 * k;
      const px = -Math.sin(a) * 2.6 * k, py = Math.cos(a) * 2.6 * k;
      S.poly([[bx + px, by + py], [tx, ty], [bx - px, by - py]], MANE, { grad: [bx, by, tx, ty, 0.25, 0.75 + r() * 0.25] });
    }
  }

  function drawGnoll(S, pose) {
    crisp(S);
    const q = decode(pose);
    const p = resolve(gnollKeys, q);
    const T = mkT(p, 44, 94, 62), W = wrap(S, T), s = T.s;
    const fur = GFUR;

    // ---- key joints (screen) ----
    const shL = T.P(28, 39), shR = T.P(60, 39);
    const head = T.P(44 + p.hx, 31 + p.hy);
    const hipL = T.P(37, 63), hipR = T.P(51, 63);
    const footL = [30, 92], footR = [58, 92];

    // ---- weapon geometry ----
    const ga = p.wa, c = Math.cos(ga * D2R), sn = Math.sin(ga * D2R);
    const g1 = p.g1, g2 = [g1[0] + c * 6, g1[1] + sn * 6];
    const tgt = a => (a === 1 ? g1 : a === 2 ? g2 : null);
    const club = () => boneClub(S, g1[0] - c * 1, g1[1] - sn * 1, ga, p.wl, p.wk);

    // ---- behind: raised club, mane ----
    if (p.cb > 0.5) club();
    gnollMane(S, head[0], head[1] - 1, { bristle: p.mane, k: 1.05 });

    // ---- legs (digitigrade) ----
    const leg = (hip, foot, side, lo, seed) => {
      const kx = lerp(hip[0], foot[0], 0.3) + side * 6, ky = lerp(hip[1], foot[1], 0.36);
      const hx = lerp(hip[0], foot[0], 0.78) - side * 1, hy = lerp(hip[1], foot[1], 0.74);
      S.capsule(hip[0], hip[1], kx, ky, 6 * s, 4 * s, fur, { lo, hi: 9, rim: 0.3 });
      S.capsule(kx, ky, hx, hy, 3.4 * s, 2.2 * s, fur, { lo, hi: 8.5, rim: 0.3 });
      S.capsule(hx, hy, foot[0] + side, foot[1] - 2, 2.3 * s, 2 * s, fur, { lo: lo + 0.5, hi: 8 });
      S.ball(hx, hy, 2.4, 2, MANE, { lo: 1, hi: 4 });                  // dark hock tuft
      S.ball(foot[0] + side * 0.5, foot[1] - 1.5, 4.4, 2.5, fur, { lo, hi: 8 });
      for (let i = -1; i <= 1; i++) { S.px(foot[0] + side * 0.5 + i * 2 - 0.5, foot[1], '#bba'); S.px(foot[0] + side * 0.5 + i * 2 - 0.5, foot[1] + 1, '#554'); }
      limbSpots(S, fur, hip[0], hip[1], kx, ky, 5, 3, seed, -3);
      limbSpots(S, fur, kx, ky, hx, hy, 2.5, 2, seed + 1, -3);
    };
    leg(hipR, footR, 1, 1, 21);
    leg(hipL, footL, -1, 0, 31);

    // ---- torso ----
    W.ball(44, 33, 17, 9, fur, { lo: 1, hi: 8 });                   // hump / traps
    W.ball(44, 48, 13.5, 11, fur, { lo: 0.5, hi: 9, rim: 0.4 });     // ribcage
    W.ball(37, 42, 8, 6.5, fur, { lo: 1, hi: 9.5, spec: 0.1 });      // pecs
    W.ball(51, 42, 8, 6.5, fur, { lo: 1, hi: 9, rim: 0.4 });
    W.ball(44, 56, 8.5, 6, fur, { lo: 3, hi: 10 });                  // pale belly
    W.ball(44, 62, 11, 5, fur, { lo: 1, hi: 8 });                    // pelvis
    // ribs & sternum creases
    for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) W.line(44 + sd * (8 + i), 48.5 + i * 2.5, 44 + sd * (11.5 + i), 47.5 + i * 2.5, '#532');
    W.line(44, 45, 44, 50, '#743');
    W.line(35, 48, 41, 49.5, '#743'); W.line(47, 49.5, 53, 48, '#743');
    for (const [sx, sy, rx, ry] of GN_SPOTS) spotAt(S, fur, T.X(sx, sy), T.Y(sx, sy), rx * s, ry * s, -3, 4);
    // shoulders (deltoids)
    S.ball(shL[0], shL[1], 6.5 * s, 6 * s, fur, { lo: 1, hi: 9.5, spec: 0.15 });
    S.ball(shR[0], shR[1], 6.5 * s, 6 * s, fur, { lo: 1, hi: 9, rim: 0.4 });
    spotAt(S, fur, shL[0] - 2, shL[1] + 1, 1.6, 1.2, -3); spotAt(S, fur, shL[0] + 2.5, shL[1] - 2, 1.3, 1, -3);
    // hide pauldron with bone spikes on the screen-right shoulder
    S.ball(shR[0] + 1, shR[1] - 1, 7 * s, 4.5 * s, HIDE, { rot: 0.3, spec: 0.2, lo: 1 });
    S.line(shR[0] - 5, shR[1] + 1, shR[0] + 6, shR[1] + 3, '#211');
    for (let i = 0; i < 3; i++) {
      const bx = shR[0] - 3 + i * 3.5, by = shR[1] - 4 + Math.abs(i - 1) * 1.2;
      S.horn(bx, by, bx + 1 + i * 0.5, by - 3, bx + 2.5 + i, by - 5.5, 1.4, 0.4, 'bone', { lo: 2, spec: 0.3 });
    }

    // ---- belt & loincloth ----
    W.poly([[33, 60], [55, 60], [54, 64], [34, 64]], HIDE, { grad: [44, 60, 44, 64, 0.55, 0.25] });
    W.poly([[37, 63], [51, 63], [53, 77], [50, 75], [47, 79], [43, 76], [39, 78], [35, 75]], HIDE, { grad: [44, 63, 44, 79, 0.6, 0.15] });
    W.line(41, 65, 40, 75, '#211'); W.line(47, 65, 48, 75, '#211');
    const sk = T.P(49, 62);
    S.ball(sk[0], sk[1], 2.4, 2.2, 'bone', { lo: 2, spec: 0.3 });
    S.px(sk[0] - 1, sk[1], '#101'); S.px(sk[0] + 1, sk[1], '#101'); S.px(sk[0], sk[1] + 2, '#554');

    // ---- bone necklace ----
    const nk = t => T.P(lerp(32, 56, t), 41 + Math.sin(t * Math.PI) * 7);
    let prev = nk(0);
    for (let i = 1; i <= 12; i++) { const pt = nk(i / 12); S.line(prev[0], prev[1], pt[0], pt[1], '#211'); prev = pt; }
    for (let i = 1; i < 10; i++) {
      const pt = nk(i / 10);
      if (i === 5) {
        S.ball(pt[0], pt[1] + 2.5, 2.7, 2.4, 'bone', { lo: 2, spec: 0.4 });
        S.px(pt[0] - 1, pt[1] + 2, '#101'); S.px(pt[0] + 1, pt[1] + 2, '#101');
        S.px(pt[0], pt[1] + 4, '#554'); S.px(pt[0] - 1, pt[1] + 5, '#998'); S.px(pt[0] + 1, pt[1] + 5, '#998');
      } else if (i % 2) {
        S.tri([pt[0] - 1.2, pt[1]], [pt[0] + 1.6, pt[1]], [pt[0] + 0.2, pt[1] + 3.8], 'bone', { tone: 0.8 });
      } else {
        S.capsule(pt[0], pt[1] + 0.5, pt[0] + 0.3, pt[1] + 3, 1, 1, 'bone', { lo: 3, spec: 0.3 });
      }
    }

    // ---- arms: deltoid, biceps bulge, forearm swelling below the elbow ----
    const arm = (sh, hand, bend, lo, seed) => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], 16 * s, 16 * s, bend);
      const o = { lo, hi: 9, rim: 0.35 };
      S.capsule(sh[0], sh[1], j.ex, j.ey, 4.6 * s, 3.4 * s, fur, o);
      S.ball(lerp(sh[0], j.ex, 0.5), lerp(sh[1], j.ey, 0.5), 4.6 * s, 3.4 * s, fur, Object.assign({ rot: Math.atan2(j.ey - sh[1], j.ex - sh[0]) }, o));
      S.capsule(j.ex, j.ey, lerp(j.ex, j.hx, 0.35), lerp(j.ey, j.hy, 0.35), 3.6 * s, 3.9 * s, fur, o);
      S.capsule(lerp(j.ex, j.hx, 0.35), lerp(j.ey, j.hy, 0.35), j.hx, j.hy, 3.9 * s, 2.6 * s, fur, o);
      limbSpots(S, fur, sh[0], sh[1], j.ex, j.ey, 4, 2, seed, -3);
      limbSpots(S, fur, j.ex, j.ey, j.hx, j.hy, 3, 2, seed + 7, -3);
      // dark fur cuff at the wrist
      S.ball(lerp(j.hx, j.ex, 0.2), lerp(j.hy, j.ey, 0.2), 3.2 * s, 2.9 * s, MANE, { lo: 1, hi: 5 });
      return j;
    };
    const fist = (j, lo) => {
      S.ball(j.hx, j.hy, 3.4 * s, 3.2 * s, fur, { lo: lo + 1, hi: 9, spec: 0.1 });
      S.line(j.hx - 2, j.hy + 1, j.hx + 1, j.hy + 1, '#532');
      S.px(j.hx - 1, j.hy - 1, '#c96');
    };
    const claw = (j, lo) => {
      S.ball(j.hx, j.hy, 3.4 * s, 3 * s, fur, { lo: lo + 1, hi: 8.5 });
      const dx = j.hx - j.ex, dy = j.hy - j.ey, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      for (let i = -1; i <= 1; i++) {
        const bx = j.hx + ux * 2.5 - uy * i * 2, by = j.hy + uy * 2.5 + ux * i * 2;
        S.capsule(j.hx - uy * i * 1.5, j.hy + ux * i * 1.5, bx, by, 1.4, 1.2, fur, { lo: lo + 1, hi: 8 });
        S.horn(bx, by, bx + ux * 2.5, by + uy * 2.5, bx + ux * 3.5 + uy * 1.2 * (i || 1), by + uy * 3.5 - ux * 1.2 * (i || 1), 1.1, 0.3, 'bone', { lo: 2, hi: 7 });
      }
    };
    const t1 = tgt(p.a1) || p.gf, t2 = tgt(p.a2) || p.gf;
    const crossL = p.a1 && t1[0] > 52;
    let j1, j2;
    if (crossL) { j2 = arm(shR, t2, p.b2, 0.6, 50); j1 = arm(shL, t1, p.b1, 0, 60); }
    else { j1 = arm(shL, t1, p.b1, 0, 60); j2 = arm(shR, t2, p.b2, 0.6, 50); }
    if (p.cb <= 0.5) club();
    if (p.a1) fist(j1, 0); else claw(j1, 0);
    if (p.a2) fist(j2, 0.6); else claw(j2, 0.6);

    // ---- head (in front: it juts forward) ----
    gnollHead(S, head[0], head[1], { k: 1.1, mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt * 1.4 });

    S.outline();

    // ---- swoosh trailing the club ----
    if (q.st) {
      const cols = ['#445', '#778', '#bba', '#ffe'];
      if (q.dir < 0) swoosh(S, [[16, 3], [7, 24], [5, 52], [11, 76], [24, 92]], 7, cols, { behind: true, side: -1 });
      else if (q.dir > 0) swoosh(S, [[72, 3], [81, 24], [83, 52], [77, 76], [64, 92]], 7, cols, { behind: true, side: 1 });
      else {
        swoosh(S, [[38, 2], [24, 12], [15, 34], [13, 58]], 5, cols, { behind: true, side: -1 });
        swoosh(S, [[50, 2], [64, 12], [73, 34], [75, 58]], 5, cols, { behind: true, side: 1 });
      }
    }
  }

  function gnollPortrait(S) {
    crisp(S);
    S.ball(12, 27, 14, 9, GFUR, { lo: 1, hi: 8 });
    gnollMane(S, 13, 11, { k: 0.85 });
    S.ball(12, 23, 9, 5, GFUR, { lo: 1, hi: 8, rim: 0.3 });
    gnollHead(S, 13, 11, { k: 0.9, mo: 0.8 });
    S.outline();
  }

  EN['Gnoll'] = { w: 88, h: 96, anchor: [44, 94], center: [44, 50], mouth: [33, 41], draw: drawGnoll, portrait: gnollPortrait };

  // ===============================================================
  // HOBGOBLIN — disciplined veteran: nasal helm, lamellar, red tabard,
  // scimitar. Upright military stance (contrast with sloppy goblins).
  // h = sword hand (screen-left arm), ba = blade angle (deg), bc = blade
  // curve side, o2 = off hand (screen-right arm), two = off hand on hilt.
  // ===============================================================
  const HSKIN = ['#100', '#201', '#311', '#521', '#731', '#942', '#b52', '#c73', '#d95', '#eb7'];
  const BRASS = ['#100', '#210', '#420', '#640', '#860', '#a82', '#ca4', '#ec6'];
  const TROUS = ['#101', '#102', '#213', '#223', '#334', '#445'];

  const hobKeys = {
    idle: f => {
      const br = [0, 1, 1, 0][f], hb = [0, 0, 1, 1][f], sw = [0, 1, 0, -1][f];
      return {
        lean: 0, dx: 0, dy: br, s: 1, hx: 0, hy: hb, tilt: 0, mo: 0, shut: 0,
        h: [24, 64 + br], ba: 112 + sw * 2.5, bl: 27, bc: 1, b1: 1,
        o2: [62, 62 + br], b2: -1, two: 0, tab: sw, sm: 0, ang: 0, glint: 0,
      };
    },
    // blade cocked high over the screen-left shoulder, off arm thrust forward
    wl: { lean: -0.12, dx: -3, dy: -1, hx: -3, hy: 0, h: [17, 27], ba: 250, bl: 24, bc: -1, b1: -1, o2: [62, 62], b2: -1, tab: -1, mo: 0.5, ang: 1 },
    wl5: { h: [24, 44], ba: 240, bl: 26, bc: -1, b1: 1, o2: [62, 62], b2: -1 },
    // blade raised straight above the helm in both hands
    wh: { lean: 0, dx: 0, dy: -3, hx: 0, hy: 2, h: [30, 11], ba: -4, bl: 30, bc: -1, b1: -1, o2: [57, 10], b2: 1, two: 0, mo: 0.5, ang: 1, glint: 0 },
    wh5: { h: [30, 42], ba: -2, bl: 30, bc: -1, b1: 1, o2: [57, 41], b2: -1, two: 0, glint: 0 },
    // blade cocked high over the screen-right shoulder (back-hand), off arm drawn back
    wr: { lean: 0.12, dx: 3, dy: -1, hx: 3, hy: 0, h: [68, 28], ba: -66, bl: 24, bc: 1, b1: 1, o2: [24, 52], b2: 1, tab: 1, mo: 0.5, ang: 1 },
    wr5: { h: [60, 44], ba: -52, bl: 26, bc: 1, b1: 1, o2: [56, 62], b2: -1 },
    // strikes: lunge, blade cuts through toward the viewer
    sl: { lean: 0.08, dx: 3, dy: 5, s: 1.08, hx: 2, hy: 2, h: [56, 60], ba: 30, bl: 30, bc: 1, b1: -1, o2: [70, 44], b2: -1, tab: 1, mo: 1, ang: 1 },
    sh: { lean: 0, dx: 0, dy: 7, s: 1.1, hx: 0, hy: 2, h: [44, 52], ba: 90, bl: 28, bc: 1, b1: 1, o2: [48, 58], b2: -1, two: 1, mo: 1, ang: 1 },
    sr: { lean: -0.08, dx: -3, dy: 5, s: 1.08, hx: -2, hy: 2, h: [32, 60], ba: 150, bl: 30, bc: -1, b1: 1, o2: [20, 44], b2: 1, tab: -1, mo: 1, ang: 1 },
    hurt: { lean: 0.1, dx: 3, dy: -1, s: 0.97, hx: 4, hy: -3, tilt: 1, mo: 1, shut: 1, h: [18, 54], ba: 115, bl: 26, bc: -1, b1: 1, o2: [70, 40], b2: 1, tab: 1 },
  };

  // Curved scimitar: grip at (hx,hy), blade toward angle a. bc = which way it curves.
  function scimitar(S, hx, hy, a, L, bc = 1, k = 1) {
    const c = Math.cos(a * D2R), s = Math.sin(a * D2R), nx = -s * bc, ny = c * bc;
    // grip + pommel
    S.capsule(hx - c * 5, hy - s * 5, hx + c * 1, hy + s * 1, 1.4, 1.4, R.wood, { lo: 0, hi: 3 });
    S.ball(hx - c * 6, hy - s * 6, 1.7, 1.7, BRASS, { spec: 0.6 });
    // blade outline points
    const back = [], edge = [];
    const N = 14;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const bend = t * t * L * 0.22;                       // sweeps back toward the tip
      const cx = hx + c * (3 + L * t) + nx * bend, cy = hy + s * (3 + L * t) + ny * bend;
      const w = (t < 0.75 ? lerp(1.5, 2.6, t / 0.75) : lerp(2.6, 0, (t - 0.75) / 0.25)) * k;
      back.push([cx - nx * w * 0.6, cy - ny * w * 0.6]);
      edge.push([cx + nx * w, cy + ny * w]);
    }
    const tipx = edge[N][0], tipy = edge[N][1];
    S.poly(back.concat(edge.slice().reverse()), R.steel, { grad: [hx - nx * 3, hy - ny * 3, hx + nx * 3, hy + ny * 3, 0.45, 0.85] });
    // bright cutting edge + fuller
    for (let i = 1; i < N; i++) S.line(edge[i][0] - nx * 0.4, edge[i][1] - ny * 0.4, edge[i + 1][0] - nx * 0.4, edge[i + 1][1] - ny * 0.4, i > N * 0.4 ? '#eef' : '#bcd');
    for (let i = 1; i < N - 3; i++) S.px((back[i][0] + edge[i][0]) / 2, (back[i][1] + edge[i][1]) / 2, '#467');
    S.px(tipx, tipy, '#fff');
    // brass cross-guard
    S.capsule(hx + c * 2 - nx * 3.2, hy + s * 2 - ny * 3.2, hx + c * 2 + nx * 3.6, hy + s * 2 + ny * 3.6, 1.2, 1.2, BRASS, { spec: 0.5 });
  }

  function hobHead(S, x, y, o = {}) {
    const k = o.k || 1, tl = o.tilt || 0;
    // pointed ears jutting from under the helm
    const ear = (sd, lo) => {
      const bx = x + sd * 6.5 * k, by = y + 1 * k;
      const tx = x + sd * 16 * k, ty = y - (4 + tl) * k;
      S.poly([[bx, by - 2.6 * k], [tx, ty], [bx + sd * 1, by + 3 * k]], HSKIN, { tone: sd < 0 ? 0.62 : 0.42 });
      S.line(bx + sd * 1.5, by, tx - sd * 2, ty + 1.2, HSKIN[3]);
      S.px(tx - sd * 3, ty + 1, HSKIN[lo ? 5 : 7]);
    };
    ear(-1, 0); ear(1, 1);
    // face & heavy jaw
    S.ball(x, y, 7.2 * k, 8 * k, HSKIN, { lo: 1, hi: 8.5, spec: 0.1, rim: 0.3 });
    S.ball(x, y + 4.5 * k, 6.6 * k, 4.4 * k, HSKIN, { lo: 1, hi: 7.5, rim: 0.3 });
    // cheekbones
    S.ball(x - 4 * k, y + 2 * k, 2.4 * k, 1.6 * k, HSKIN, { lo: 3, hi: 9 });
    S.ball(x + 4 * k, y + 2 * k, 2.4 * k, 1.6 * k, HSKIN, { lo: 2, hi: 8 });
    // helm: iron dome + riveted rim + nasal bar + finial
    S.ball(x, y - 4 * k, 8.4 * k, 7.6 * k, R.steel, { lo: 1, hi: 7, spec: 0.5, clip: (px, py) => py < y - 1.5 * k });
    S.poly([[x - 6 * k, y - 8 * k], [x - 0.5 * k, y - 15 * k], [x + 0.5 * k, y - 15 * k], [x + 6 * k, y - 8 * k]], R.steel, { grad: [x - 5 * k, y - 12 * k, x + 5 * k, y - 9 * k, 0.8, 0.3] });
    S.line(x - 0.5 * k, y - 14 * k, x - 0.5 * k, y - 5 * k, '#bcd');
    S.capsule(x - 8.2 * k, y - 2 * k, x + 8.2 * k, y - 2 * k, 1.6 * k, 1.6 * k, R.steel, { lo: 1, hi: 6, spec: 0.4 });
    for (let i = -2; i <= 2; i++) S.px(x + i * 3.4 * k, y - 2.4 * k, i < 0 ? '#bcd' : '#8ab');
    S.line(x - 5 * k, y - 7 * k, x - 2 * k, y - 11 * k, '#bcd');
    // brow: deep scowl shadow under the rim
    S.poly([[x - 6.5 * k, y - 1 * k], [x - 1 * k, y + 0.5 * k], [x + 1 * k, y + 0.5 * k], [x + 6.5 * k, y - 1 * k], [x + 6 * k, y - 0.2 * k], [x, y + 1.6 * k], [x - 6 * k, y - 0.2 * k]], HSKIN, { tone: 0.18 });
    // eyes: narrow, yellow, hard
    const eye = (ex, ey, sd) => {
      ex = Math.round(ex); ey = Math.round(ey);
      if (o.shut) { S.line(ex - 1, ey, ex + 1, ey + (sd < 0 ? -1 : -1), '#101'); S.px(ex, ey + 1, HSKIN[3]); return; }
      S.px(ex - 1, ey, sd < 0 ? '#fd5' : '#c60'); S.px(ex, ey, '#fe8'); S.px(ex + 1, ey, sd < 0 ? '#c60' : '#fd5');
      S.px(ex + sd * 0, ey, '#fe8');
      S.px(ex - sd, ey + 1, HSKIN[3]);
    };
    eye(x - 3.2 * k, y + 1 * k, -1);
    eye(x + 3.2 * k, y + 1 * k, 1);
    // nasal bar over the nose
    S.rect(Math.round(x) - 1, Math.round(y - 3 * k), 2, Math.round(5.5 * k), '#8ab');
    S.px(Math.round(x) - 1, Math.round(y - 3 * k), '#eef');
    S.line(Math.round(x), Math.round(y - 2 * k), Math.round(x), Math.round(y + 2.5 * k), '#345');
    S.px(x - 1.5 * k, y + 3.5 * k, '#311'); S.px(x + 1.5 * k, y + 3.5 * k, '#311');   // nostrils
    // mouth: hard line, lower tusks
    const mo = o.mo || 0;
    if (mo > 0.6) {
      S.ellipse(x, y + 6.2 * k, 2.8 * k, 1.6 * k, '#301');
      S.line(x - 2 * k, y + 5 * k, x + 2 * k, y + 5 * k, '#eed');
    } else {
      S.line(x - 3 * k, y + 5.5 * k, x + 3 * k, y + 5.5 * k, '#301');
      S.px(x - 3.5 * k, y + 6 * k, '#301'); S.px(x + 3.5 * k, y + 6 * k, '#301');
    }
    S.px(x - 2.5 * k, y + 4.6 * k, '#eed'); S.px(x - 2.5 * k, y + 5.6 * k - (mo > 0.6 ? 0 : 0), '#bba');
    S.px(x + 2.5 * k, y + 4.6 * k, '#eed'); S.px(x + 2.5 * k, y + 5.6 * k, '#bba');
    // old scar: a pale welt raked across the screen-left brow and cheek (skips the eye)
    {
      const ex = Math.round(x - 3.2 * k), ey = Math.round(y + 1 * k);
      const x0 = x - 6.2 * k, y0 = y - 2 * k, x1 = x - 2 * k, y1 = y + 5.5 * k, n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let i = 0; i <= n; i++) {
        const px = Math.round(lerp(x0, x1, i / n)), py = Math.round(lerp(y0, y1, i / n));
        if (Math.abs(py - ey) <= 1 && px >= ex - 3 && px <= ex + 2) continue;
        S.px(px + 1, py, '#411'); S.px(px, py, i % 3 ? '#eb8' : '#fdb');
      }
    }
    // jaw shadow and a stern crease between the brows
    S.line(x - 5 * k, y + 7.4 * k, x + 5 * k, y + 7.4 * k, HSKIN[3]);
    S.px(x - 0.5, y + 0.2 * k, HSKIN[2]);
    // black chin braid
    S.capsule(x, y + 8 * k, x + 0.5, y + 11 * k, 1.2 * k, 0.8 * k, TROUS, { lo: 0, hi: 3 });
    S.px(x, y + 9.5 * k, '#a82');
  }

  function drawHob(S, pose) {
    crisp(S);
    const q = decode(pose);
    const p = resolve(hobKeys, q);
    const T = mkT(p, 44, 94, 62), W = wrap(S, T), s = T.s;

    const shL = T.P(29, 37), shR = T.P(59, 37);
    const head = T.P(44 + p.hx, 27 + p.hy);
    const hipL = T.P(38, 62), hipR = T.P(50, 62);
    const footL = [34, 92], footR = [54, 92];

    // ---- blade geometry ----
    const sc = () => scimitar(S, p.h[0], p.h[1], p.ba, p.bl, p.bc, s);
    const bladeBehind = false;

    // ---- legs: trousers, knee cops, boots ----
    const leg = (hip, foot, sd, lo) => {
      const kx = lerp(hip[0], foot[0], 0.48) + sd * 1.5, ky = lerp(hip[1], foot[1], 0.5);
      S.capsule(hip[0], hip[1], kx, ky, 5.6 * s, 4.4 * s, TROUS, { lo, rim: 0.3 });
      S.capsule(kx, ky, foot[0], foot[1] - 4, 4.2 * s, 3.6 * s, HIDE, { lo: lo + 0.5, spec: 0.2 });
      S.capsule(kx - sd * 0.3, ky + 4, kx, ky + 6, 4.6 * s, 4.6 * s, HIDE, { lo: lo + 1, hi: 6 });     // boot cuff
      S.ball(kx, ky - 0.5, 3 * s, 2.6 * s, R.steel, { lo: lo + 1, hi: 5.5, spec: 0.3 });           // knee cop
      S.ball(foot[0] + sd * 1.2, foot[1] - 1.8, 5 * s, 2.8 * s, HIDE, { lo, spec: 0.3 });         // boot toe
      S.line(foot[0] - 4, foot[1], foot[0] + 4 + sd, foot[1], '#101');
    };
    leg(hipR, footR, 1, 1);
    leg(hipL, footL, -1, 0);

    // ---- torso: lamellar coat ----
    W.ball(44, 47, 15.5, 14, R.steel, { lo: 1, hi: 6, spec: 0.2, rim: 0.3 });
    W.ball(44, 60, 12.5, 6, R.steel, { lo: 1, hi: 5 });
    // lamellar rows: dark seams + alternating lit plate edges
    for (let row = 0; row < 8; row++) {
      const yy = 37 + row * 3.2;
      for (let xx = 28; xx <= 60; xx += 1) {
        const X = T.X(xx, yy), Y = T.Y(xx, yy);
        if (inRamp(S, X, Y, R.steel) === undefined) continue;
        S.px(X, Y, '#223');
        if (((xx + row * 2) % 4) === 0) { S.px(X, Y + 1, '#112'); }
        else if (inRamp(S, X, Y - 1, R.steel) !== undefined && ((xx + row * 2) % 4) === 1) nudge(S, X, Y - 1, R.steel, 1);
      }
    }
    // mail skirt below the coat
    W.poly([[33, 62], [55, 62], [57, 72], [31, 72]], R.steel, { grad: [44, 62, 44, 72, 0.55, 0.25] });
    for (let yy = 63; yy < 72; yy += 2) for (let xx = 31; xx < 58; xx += 2) { const X = T.X(xx + (yy % 4 ? 1 : 0), yy), Y = T.Y(xx, yy); if (inRamp(S, X, Y, R.steel) !== undefined) nudge(S, X, Y, R.steel, -2); }

    // ---- red tabard: centre panel neck to knees ----
    const sway = p.tab || 0;
    W.poly([[38, 34], [50, 34], [51, 61], [37, 61]], R.crimson, { grad: [36, 40, 52, 40, 0.75, 0.4] });
    const hem = [[37, 61], [51, 61], [52 + sway, 83], [48 + sway, 81], [44 + sway, 84], [40 + sway, 81], [36 + sway, 83]];
    W.poly(hem, R.crimson, { grad: [44, 61, 44 + sway, 84, 0.6, 0.2] });
    W.line(40, 63, 39 + sway, 80, '#502'); W.line(48, 63, 49 + sway, 80, '#502');
    // gold trim down the edges
    W.line(38, 35, 37, 60, '#c92'); W.line(50, 35, 51, 60, '#a70');
    // sigil: black field, gold chevron
    W.poly([[40, 41], [48, 41], [48, 48], [44, 51], [40, 48]], TROUS, { tone: 0.15 });
    W.line(41, 43, 44, 47, '#eb3'); W.line(44, 47, 47, 43, '#c92'); W.px(44, 43, '#fe6');

    // ---- belt ----
    W.poly([[31, 59], [57, 59], [57, 63], [31, 63]], HIDE, { grad: [44, 59, 44, 63, 0.6, 0.25] });
    const bk = T.P(44, 61);
    S.rect(bk[0] - 2, bk[1] - 2, 5, 4, '#860'); S.rect(bk[0] - 1, bk[1] - 1, 3, 2, '#301'); S.px(bk[0] - 2, bk[1] - 2, '#ec6');

    // ---- neck & gorget ----
    W.cap(44, 30, 44, 35, 5, 5, HSKIN, { lo: 1, hi: 6 });
    W.ball(44, 35, 8, 3, R.steel, { lo: 1, spec: 0.5 });

    // ---- arms ----
    // layered iron lames sloping down off the shoulder
    const pauldron = (sh, sd, lo) => {
      for (let i = 2; i >= 0; i--) {
        const x0 = sh[0] - sd * 4, y0 = sh[1] - 4 + i * 3.2;
        const x1 = sh[0] + sd * 7.5, y1 = sh[1] + 1 + i * 3.6;
        S.horn(x0, y0, sh[0] + sd * 2, y0 - 3, x1, y1, 2.6 * s, 2 * s, R.steel, { lo: lo + 1, hi: 6.5, spec: 0.5 });
        S.line(x0 + sd, y0 + 2.4, x1 - sd, y1 + 1.6, '#112');
      }
      S.ball(sh[0] - sd * 1, sh[1] - 5, 1.1, 1.1, BRASS, { spec: 0.8 });
    };
    const arm = (sh, hand, bend, lo, sd) => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], 15 * s, 15 * s, bend);
      S.capsule(sh[0], sh[1], j.ex, j.ey, 5.2 * s, 4.2 * s, TROUS, { lo, rim: 0.3 });               // padded sleeve
      S.capsule(j.ex, j.ey, j.hx, j.hy, 4.2 * s, 3.1 * s, HSKIN, { lo: lo + 1, hi: 8.5, rim: 0.3 }); // bare forearm
      const bx = lerp(j.ex, j.hx, 0.5), by = lerp(j.ey, j.hy, 0.5);
      S.capsule(bx, by, lerp(j.ex, j.hx, 0.85), lerp(j.ey, j.hy, 0.85), 3.4 * s, 3 * s, HIDE, { lo: lo + 1, spec: 0.3 }); // bracer
      return j;
    };
    const fist = (j, lo) => {
      S.ball(j.hx, j.hy, 3.4 * s, 3.1 * s, HSKIN, { lo: lo + 2, hi: 8.5, spec: 0.2 });
      S.px(j.hx - 1, j.hy - 1, HSKIN[8]);
    };
    // painter's order: arm crossing the body last
    const crossL = p.h[0] > 50, crossR = p.o2[0] < 38;
    const drawSword = () => { if (!bladeBehind) sc(); };
    let j1, j2;
    if (crossR && !crossL) {
      j1 = arm(shL, p.h, p.b1, 0, -1); drawSword(); fist(j1, 0); pauldron(shL, -1, 0);
      j2 = arm(shR, p.two ? [p.h[0] + 3, p.h[1] + 2] : p.o2, p.b2, 0.5, 1); fist(j2, 0.5); pauldron(shR, 1, 0.5);
    } else if (crossL) {
      j2 = arm(shR, p.two ? [p.h[0] + 3, p.h[1] + 2] : p.o2, p.b2, 0.5, 1); fist(j2, 0.5); pauldron(shR, 1, 0.5);
      pauldron(shL, -1, 0);
      j1 = arm(shL, p.h, p.b1, 0, -1); drawSword(); fist(j1, 0);
    } else {
      j2 = arm(shR, p.two ? [p.h[0] + 4, p.h[1] + 1] : p.o2, p.b2, 0.5, 1); pauldron(shR, 1, 0.5);
      j1 = arm(shL, p.h, p.b1, 0, -1); pauldron(shL, -1, 0);
      drawSword(); fist(j1, 0); fist(j2, 0.5);
    }

    // ---- head ----
    hobHead(S, head[0], head[1], { k: 1.12, mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt * 2 });

    S.outline();

    if (q.st) {
      const cols = ['#445', '#778', '#bcd', '#eef'];
      if (q.dir < 0) swoosh(S, [[14, 4], [6, 26], [5, 52], [12, 76], [26, 92]], 7, cols, { behind: true, side: -1 });
      else if (q.dir > 0) swoosh(S, [[74, 4], [82, 26], [83, 52], [76, 76], [62, 92]], 7, cols, { behind: true, side: 1 });
      else {
        swoosh(S, [[38, 2], [24, 12], [15, 34], [13, 58]], 5, cols, { behind: true, side: -1 });
        swoosh(S, [[50, 2], [64, 12], [73, 34], [75, 58]], 5, cols, { behind: true, side: 1 });
      }
    }
    if (p.glint > 0.5) glint(S, p.h[0], p.h[1] - p.bl - 3, 2);
  }

  function hobPortrait(S) {
    crisp(S);
    S.ball(12, 27, 13, 7, R.steel, { lo: 1, hi: 7, spec: 0.3 });
    S.poly([[9, 20], [15, 20], [15, 24], [9, 24]], R.crimson, { tone: 0.6 });
    hobHead(S, 12, 12, { k: 0.95 });
    S.outline();
  }

  EN['Hobgoblin'] = { w: 88, h: 96, anchor: [44, 94], center: [44, 48], mouth: [44, 33], draw: drawHob, portrait: hobPortrait };

  // ===============================================================
  // GHOUL — emaciated corpse-eater: ribs, long jagged claws, lank hair,
  // pale glowing eyes, long tongue, needle teeth, tattered shroud,
  // a faint sickly glow. Crouched with knees splayed wide.
  // hl/hr = hand targets (screen), al/ar = claw angles (deg), sp = spread.
  // ===============================================================
  const GSKIN = ['#011', '#012', '#123', '#234', '#345', '#466', '#687', '#9a9', '#bcb', '#dec'];
  const CLAW = ['#100', '#211', '#322', '#443', '#654', '#876', '#a98', '#cca'];
  const HAIR = ['#000', '#001', '#011', '#112', '#122', '#233'];
  const SHROUD = ['#101', '#212', '#222', '#332', '#443', '#554', '#776', '#887', '#998', '#bba'];
  const TONGUE = ['#100', '#201', '#302', '#413', '#614', '#825', '#a46'];

  const ghoulKeys = {
    idle: f => {
      const br = [0, 1, 1, 0][f], hb = [0, 0, 1, 1][f], sw = [0, 1, 0, -1][f];
      return {
        lean: sw * 0.012, dx: 0, dy: br, s: 1, hx: sw * 0.5, hy: hb, tilt: 0, mo: 0.7 + 0.2 * sw, shut: 0,
        hl: [17, 66 + br], al: 95, hr: [71, 66 + br + sw], ar: 85, sp: 0.9, bl: 1, br2: -1,
        tg: sw, glow: [0, 1, 2, 1][f], rear: 0,
      };
    },
    wl: { lean: -0.13, dx: -3, dy: -2, hx: -3, hy: -1, mo: 1, hl: [14, 17], al: 255, hr: [66, 60], ar: 100, sp: 1.25, bl: -1, br2: -1, tg: -1 },
    wl5: { hl: [17, 38], al: 215, sp: 1.1 },
    wh: { lean: 0, dx: 0, dy: -4, hx: 0, hy: 1, mo: 1, hl: [27, 17], al: 258, hr: [61, 17], ar: 282, sp: 1.25, bl: -1, br2: 1, tg: 0, rear: 1 },
    wh5: { hl: [23, 34], al: 225, hr: [65, 34], ar: 315, sp: 1.1, bl: -1, br2: 1, rear: 0.5 },
    wr: { lean: 0.13, dx: 3, dy: -2, hx: 3, hy: -1, mo: 1, hl: [22, 60], al: 80, hr: [74, 17], ar: 285, sp: 1.25, bl: 1, br2: 1, tg: 1 },
    wr5: { hr: [71, 38], ar: 325, sp: 1.1 },
    sl: { lean: 0.1, dx: 4, dy: 5, s: 1.08, hx: 3, hy: 2, mo: 1, hl: [55, 68], al: 55, hr: [72, 52], ar: 70, sp: 1.35, bl: -1, br2: -1, tg: 1 },
    sh: { lean: 0, dx: 0, dy: 7, s: 1.1, hx: 0, hy: 3, mo: 1, hl: [33, 68], al: 95, hr: [55, 68], ar: 85, sp: 1.35, bl: 1, br2: -1, tg: 0 },
    sr: { lean: -0.1, dx: -4, dy: 5, s: 1.08, hx: -3, hy: 2, mo: 1, hl: [16, 52], al: 110, hr: [33, 68], ar: 125, sp: 1.35, bl: 1, br2: 1, tg: -1 },
    hurt: { lean: 0.12, dx: 3, dy: -2, s: 0.97, hx: 5, hy: -4, tilt: 1, mo: 1, shut: 1, hl: [18, 44], al: 165, hr: [68, 36], ar: 15, sp: 0.6, bl: 1, br2: -1, tg: 1 },
  };

  // Bony hand with four long, jagged claws fanning around angle a (deg).
  function ghoulHand(S, x, y, a, sp, k, lo) {
    const base = a * D2R;
    S.ball(x, y, 3.3 * k, 2.8 * k, GSKIN, { lo: lo + 1, hi: 8, rot: base });
    for (let i = 0; i < 4; i++) {
      const fa = base + (i - 1.5) * 0.34 * sp;
      const c = Math.cos(fa), s = Math.sin(fa);
      const fl = (i === 1 || i === 2 ? 5.2 : 4.4) * k;
      const x1 = x + c * fl, y1 = y + s * fl;
      S.capsule(x + c * 1.5, y + s * 1.5, x1, y1, 1.2 * k, 1 * k, GSKIN, { lo: lo + 1, hi: 7.5 });
      S.px(lerp(x, x1, 0.55), lerp(y, y1, 0.55), GSKIN[lo > 0.3 ? 6 : 8]);   // knuckle
      const L = (8 + (i === 1 || i === 2 ? 2 : 0)) * k;
      const cx = x1 + c * L * 0.6 - s * 1.8, cy = y1 + s * L * 0.6 + c * 1.8;
      S.horn(x1, y1, cx, cy, x1 + c * L + s * 1, y1 + s * L - c * 1, 1.5 * k, 0.3, CLAW, { lo: lo + 1.5, spec: 0.5 });
      // jagged notch
      S.px(x1 + c * L * 0.4 - s * 1.3, y1 + s * L * 0.4 + c * 1.3, CLAW[1]);
    }
  }

  function ghoulHead(S, x, y, o = {}) {
    const k = o.k || 1, tl = o.tilt || 0, mo = o.mo || 0;
    // lank hair behind the head
    const r = U.rng(5);
    for (let i = 0; i < 7; i++) {
      const sd = i < 3 ? -1 : i < 6 ? 1 : 0;
      const bx = x + sd * (4 + (i % 3) * 1.6) * k, by = y - 6 * k;
      const ex = x + sd * (8 + (i % 3) * 2.2) * k + (r() - 0.5) * 2, ey = y + (9 + (i % 3) * 3.5 + r() * 3) * k;
      S.horn(bx, by, bx + sd * 4 * k, y + 1 * k, ex, ey, 1.8 * k, 0.6, HAIR, { lo: 1 });
    }
    // small pointed ears
    S.tri([x - 6 * k, y - 2 * k], [x - 10.5 * k, y - 6.5 * k - tl], [x - 6 * k, y + 2 * k], GSKIN, { tone: 0.5 });
    S.tri([x + 6 * k, y - 2 * k], [x + 10.5 * k, y - 6.5 * k - tl], [x + 6 * k, y + 2 * k], GSKIN, { tone: 0.3 });
    // gaunt skull: high cranium, hollow cheeks, narrow chin
    S.ball(x, y - 1.5 * k, 7 * k, 7 * k, GSKIN, { lo: 1, hi: 9, spec: 0.25, rim: 0.4 });
    S.ball(x, y + 4.5 * k, 5 * k, 4.6 * k, GSKIN, { lo: 1, hi: 8, rim: 0.3 });
    S.ball(x - 4.2 * k, y + 3 * k, 1.6 * k, 2.2 * k, GSKIN, { lo: 0, hi: 3.5 });   // hollow cheeks
    S.ball(x + 4.2 * k, y + 3 * k, 1.6 * k, 2.2 * k, GSKIN, { lo: 0, hi: 3 });
    // scalp hair strands over the crown
    S.horn(x - 1, y - 8 * k, x - 5 * k, y - 7 * k, x - 7 * k, y - 1 * k, 1.4 * k, 0.6, HAIR, { lo: 1 });
    S.horn(x + 1, y - 8 * k, x + 5 * k, y - 7 * k, x + 7 * k, y - 1 * k, 1.4 * k, 0.6, HAIR, { lo: 1 });
    S.line(x, y - 8 * k, x - 2 * k, y - 4 * k, HAIR[3]);
    // deep eye sockets with pale cold pupils
    const ey = Math.round(y - 1 * k + tl * 0.5);
    for (const sd of [-1, 1]) {
      const ex = Math.round(x + sd * 2.8 * k);
      S.ellipse(ex + 0.5, ey + 0.5, 2.2 * k, 1.7 * k, '#011');
      if (o.shut) { S.line(ex - 1, ey, ex + 1, ey + (sd < 0 ? 0 : 0), GSKIN[5]); continue; }
      S.px(ex, ey, '#efe'); S.px(ex + sd, ey, '#9dc'); S.px(ex, ey + 1, '#4a8');
    }
    // nose: two slits
    S.px(x - 1, y + 2 * k, '#011'); S.px(x + 1, y + 2 * k, '#011');
    // mouth: wide, needle teeth
    const mw = 3.6 * k, mh = (1.2 + mo * 2.6) * k, my = y + 5.5 * k;
    S.ellipse(x, my, mw, mh, '#201');
    S.ellipse(x, my + 0.4, mw - 1, Math.max(0.5, mh - 1), '#100');
    for (let i = -3; i <= 3; i++) {
      const tx = Math.round(x + i * 1.05 * k);
      S.px(tx, Math.round(my - mh + 0.6), '#eed');
      if (i % 2 === 0 && mo > 0.3) S.px(tx, Math.round(my - mh + 1.6), '#bba');
      if (mo > 0.3) { S.px(tx, Math.round(my + mh - 1.3), i % 2 ? '#bba' : '#eed'); }
    }
  }

  function drawGhoul(S, pose) {
    crisp(S);
    const q = decode(pose);
    const p = resolve(ghoulKeys, q);
    const T = mkT(p, 44, 94, 62), W = wrap(S, T), s = T.s;
    const sk = GSKIN;

    const shL = T.P(30, 33), shR = T.P(58, 33);
    const head = T.P(44 + p.hx, 31 + p.hy - p.rear * 4);
    const hipL = T.P(38, 61), hipR = T.P(50, 61);
    const footL = [27, 92], footR = [61, 92];

    // ---- tattered shroud: pale grave-linen strips hanging off the shoulders ----
    const sw = (p.tg || 0);
    const strips = [[-13, 66, -3], [-6, 78, -1], [2, 72, 0], [8, 80, 1], [14, 64, 3]];
    strips.forEach(([ox, len, fan], i) => {
      const x0 = 44 + ox * 0.9, y0 = 31;
      const x1 = 44 + ox * 1.12 + fan * 1.5 + sw * (i % 2 ? 1.5 : -1), y1 = y0 + len - 22;
      const wd = 3 - Math.abs(ox) * 0.05;
      const yb = Math.min(y1, 94 - (3 + (p.dy || 0)) / s - 3.5);
      W.poly([[x0 - wd, y0], [x0 + wd, y0], [x1 + wd * 0.8, yb - 2], [x1 + 1.2, yb + 2 + (i % 3)], [x1 - 0.3, yb - 1.5], [x1 - 1.4, yb + 1.5], [x1 - wd * 0.8, yb - 0.5]], SHROUD, { lo: 2, hi: 9, grad: [x0 - wd * 2, y0, x0 + wd * 3, y1, 0.85 - Math.abs(ox) * 0.01, 0.4] });
      W.line(x0 + (i % 2 ? 1 : -1), y0 + 4, x1 + (i % 2 ? 1 : -1), y1 - 4, SHROUD[4]);
      spotAt(S, SHROUD, T.X(lerp(x0, x1, 0.6), lerp(y0, y1, 0.6)), T.Y(lerp(x0, x1, 0.6), lerp(y0, y1, 0.6)), 1.4, 1.8, -2, 3);
    });

    // ---- legs: splayed, bony knees, long clawed toes ----
    const leg = (hip, foot, sd, lo) => {
      const kx = lerp(hip[0], foot[0], 0.55) + sd * 8, ky = lerp(hip[1], foot[1], 0.4);
      S.capsule(hip[0], hip[1], kx, ky, 4 * s, 2.8 * s, sk, { lo, hi: 8, rim: 0.4 });
      S.capsule(kx, ky, foot[0], foot[1] - 2, 2.8 * s, 2 * s, sk, { lo, hi: 7.5, rim: 0.4 });
      S.ball(kx, ky, 3 * s, 2.6 * s, sk, { lo: lo + 1, hi: 8.5, spec: 0.3 });          // knobbly knee
      S.ball(foot[0] + sd * 1.5, foot[1] - 1.5, 4 * s, 2 * s, sk, { lo, hi: 7 });
      for (let i = 0; i < 3; i++) {
        const tx = foot[0] + sd * 1.5 + (i - 1) * 2.6 + sd * 1.5, ty = foot[1];
        S.horn(tx - sd * 1, ty - 1, tx + sd * 0.5, ty, tx + sd * 1.8 + (i - 1), ty + 1, 0.9, 0.3, CLAW, { lo: 1 });
      }
      // shin tendon line
      S.line(lerp(kx, foot[0], 0.2), lerp(ky, foot[1], 0.2), lerp(kx, foot[0], 0.8), lerp(ky, foot[1], 0.8), sk[3]);
    };
    leg(hipR, footR, 1, 1);
    leg(hipL, footL, -1, 0);

    // ---- emaciated torso ----
    W.ball(44, 31, 15, 6, sk, { lo: 0.5, hi: 6 });                                // hunched upper back
    W.ball(44, 43, 11.5, 12, sk, { lo: 1, hi: 8.5, spec: 0.15, rim: 0.4 });     // ribcage
    W.ball(44, 55, 6.5, 5.5, sk, { lo: 0, hi: 5 });                             // sunken belly
    W.ball(44, 60, 9, 4, sk, { lo: 1, hi: 6 });                                 // pelvis
    W.cap(44, 50, 44, 58, 2.6, 2.2, sk, { lo: 2, hi: 7 });                      // abdomen ridge
    // ribs: dark gaps with lit bone ridges
    for (let i = 0; i < 5; i++) {
      const y0 = 38 + i * 3.1;
      for (const sd of [-1, 1]) {
        W.line(44 + sd * 2, y0, 44 + sd * (9 - i * 0.3), y0 + 2.2 + i * 0.25, sk[2]);
        W.line(44 + sd * 2, y0 - 1, 44 + sd * (8.5 - i * 0.3), y0 + 1.2 + i * 0.25, i < 2 ? sk[7] : sk[6]);
      }
    }
    W.line(44, 36, 44, 49, sk[3]);                                               // sternum groove
    // collarbones & bony shoulders
    W.line(34, 34, 42, 36, sk[7]); W.line(46, 36, 54, 34, sk[6]);
    S.ball(shL[0], shL[1], 4.2 * s, 3.8 * s, sk, { lo: 1, hi: 9, spec: 0.3 });
    S.ball(shR[0], shR[1], 4.2 * s, 3.8 * s, sk, { lo: 1, hi: 8, rim: 0.4 });

    // ---- shroud waist wrap ----
    W.poly([[33, 57], [55, 57], [57, 64], [54, 71], [51, 66], [48, 76], [44, 68], [40, 74], [36, 66], [32, 69]], SHROUD, { lo: 2, grad: [44, 57, 44, 76, 0.85, 0.35] });
    W.line(35, 59, 53, 61, SHROUD[4]); W.line(40, 62, 46, 69, SHROUD[4]);
    // grave-dirt stains
    spotAt(S, SHROUD, T.X(38, 61), T.Y(38, 61), 1.6, 1, -3, 2);
    spotAt(S, SHROUD, T.X(50, 64), T.Y(50, 64), 1.2, 1, -3, 2);

    // ---- neck ----
    S.capsule(T.X(44, 34), T.Y(44, 34), head[0], head[1] + 5, 2.4 * s, 2 * s, sk, { lo: 1, hi: 6 });

    // ---- arms ----
    const arm = (sh, hand, bend, lo, ang) => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], 16 * s, 16 * s, bend);
      S.capsule(sh[0], sh[1], j.ex, j.ey, 2.7 * s, 1.9 * s, sk, { lo, hi: 8, rim: 0.4 });
      S.capsule(j.ex, j.ey, j.hx, j.hy, 2.1 * s, 1.6 * s, sk, { lo, hi: 8, rim: 0.4 });
      S.ball(j.ex, j.ey, 2.3 * s, 2.1 * s, sk, { lo: lo + 1, hi: 8.5, spec: 0.3 });     // bony elbow
      S.ball(lerp(j.ex, j.hx, 0.85), lerp(j.ey, j.hy, 0.85), 1.9 * s, 1.7 * s, sk, { lo: lo + 1, hi: 8 }); // knobbly wrist
      return j;
    };
    // the raised / striking arm is drawn last
    const firstR = !(q.w && q.dir > 0) && !(q.st && q.dir > 0);
    const doL = () => { const j = arm(shL, p.hl, p.bl, 0, p.al); ghoulHand(S, j.hx, j.hy, p.al, p.sp, s, 0); };
    const doR = () => { const j = arm(shR, p.hr, p.br2, 0.5, p.ar); ghoulHand(S, j.hx, j.hy, p.ar, p.sp, s, 0.5); };
    if (firstR) { doR(); doL(); } else { doL(); doR(); }

    // ---- head + tongue ----
    ghoulHead(S, head[0], head[1], { mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt * 2 });
    const mx = head[0], my = head[1] + 7.5;
    const tg = p.tg || 0;
    if (p.mo > 0.4) S.horn(mx, my, mx + 2 + tg * 2, my + 6, mx - 1 + tg * 3, my + 11 + p.mo * 2, 1.5, 0.7, TONGUE, { lo: 1, spec: 0.5 });

    S.outline();

    // ---- faint sickly glow hugging the silhouette ----
    const mask = S.data.slice(), w = S.w, h = S.h;
    const gl = p.glow || 0;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      if (mask[y * w + x]) continue;
      let d = 9;
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (mask[(y + j) * w + x + i]) d = Math.min(d, Math.abs(i) + Math.abs(j) * 0.999);
      if (d > 3.2) continue;
      const lvl = d < 1.5 ? 0.7 + gl * 0.05 : d < 2.5 ? 0.32 + gl * 0.04 : 0.1;
      if (lvl > P.thresh(x, y)) S.set(x, y, d < 1.5 ? '#254' : '#143');
    }
    // eyes glow over the outline
    const ey = Math.round(head[1] - 1 + p.tilt);
    if (!(p.shut > 0.5)) for (const sd of [-1, 1]) S.px(Math.round(head[0] + sd * 2.8), ey, '#fff');

    if (q.st) {
      const cols = ['#132', '#475', '#9ba', '#dec'];
      // three raking claw streaks
      for (let i = 0; i < 3; i++) {
        const o = i * 4;
        if (q.dir < 0) swoosh(S, [[14 + o, 4], [7 + o, 30], [9 + o, 56], [20 + o, 80]], 2.5, cols, { behind: true, side: -1 });
        else if (q.dir > 0) swoosh(S, [[74 - o, 4], [81 - o, 30], [79 - o, 56], [68 - o, 80]], 2.5, cols, { behind: true, side: 1 });
        else { swoosh(S, [[30 - o, 4], [20 - o, 30], [18 - o, 60]], 2, cols, { behind: true, side: -1 }); swoosh(S, [[58 + o, 4], [68 + o, 30], [70 + o, 60]], 2, cols, { behind: true, side: 1 }); }
      }
    }
  }

  function ghoulPortrait(S) {
    crisp(S);
    S.poly([[0, 24], [3, 17], [9, 15], [15, 15], [21, 17], [24, 24]], SHROUD, { grad: [12, 15, 12, 24, 0.6, 0.2] });
    S.ball(12, 21, 7, 4, GSKIN, { lo: 1, hi: 7 });
    ghoulHead(S, 12, 10, { k: 0.95, mo: 0.9 });
    S.horn(12, 16, 13.5, 19, 11.5, 22, 1.2, 0.6, TONGUE, { lo: 1, spec: 0.5 });
    S.outline();
    S.px(10, 9, '#fff'); S.px(14, 9, '#fff');
  }

  EN['Ghoul'] = { w: 88, h: 96, anchor: [44, 94], center: [44, 48], mouth: [44, 37], draw: drawGhoul, portrait: ghoulPortrait };

  // ===============================================================
  // BUGBEAR — massive and silent: shaggy brown fur, bear snout, small
  // yellow eyes, big ears, hunched mountain of shoulders, spiked
  // morningstar. As bulky as the frame allows.
  // g1 = lower grip, wa = haft angle (deg), a1/a2 = grip per arm (0 = free).
  // ===============================================================
  const BFUR = ['#100', '#200', '#201', '#211', '#311', '#421', '#532', '#642', '#753', '#864', '#a86'];
  const IRON = ['#000', '#101', '#112', '#223', '#334', '#445', '#667', '#889', '#bbc'];

  const bugKeys = {
    idle: f => {
      const br = [0, 1, 1, 0][f], hb = [0, 0, 1, 1][f], sw = [0, 1, 0, -1][f];
      return {
        lean: 0, dx: 0, dy: br, s: 1, hx: 0, hy: hb, tilt: 0, mo: 0, shut: 0,
        g1: [18, 60 + br], wa: 100 + sw * 1.5, wl: 18, wk: 1, gf: [72, 72 + br],
        a1: 1, a2: 0, b1: 1, b2: -1, mb: 0, ear: [0, 0, 1, 0][f], fs: 1,
      };
    },
    wl: { lean: -0.12, dx: -3, dy: -1, hx: -2, hy: 0, g1: [28, 32], wa: 238, wl: 20, a1: 2, a2: 1, b1: -1, b2: -1, mo: 0.4 },
    wl5: { g1: [28, 46], wa: 225, wl: 18, a1: 1, a2: 0, b1: 1, gf: [64, 60] },
    wh: { lean: 0, dx: 0, dy: -2, hx: 0, hy: 5, g1: [44, 31], wa: 270, wl: 14, wk: 1, a1: 1, a2: 2, b1: -1, b2: 1, mb: 1, mo: 0.4, fs: 0.62 },
    wh5: { g1: [44, 44], wa: 270, wl: 20, a1: 1, a2: 2, b1: 1, b2: -1, mb: 1, fs: 0.85 },
    wr: { lean: 0.12, dx: 3, dy: -1, hx: 2, hy: 0, g1: [61, 32], wa: -58, wl: 20, a1: 1, a2: 2, b1: 1, b2: 1, mo: 0.4 },
    wr5: { g1: [60, 46], wa: -45, wl: 18, a1: 1, a2: 0, b1: 1, gf: [74, 58] },
    sl: { lean: 0.08, dx: 3, dy: 5, s: 1.07, hx: 2, hy: 2, g1: [52, 62], wa: 40, wl: 19, wk: 1.3, a1: 2, a2: 1, b1: -1, b2: -1, mo: 0.6 },
    sh: { lean: 0, dx: 0, dy: 7, s: 1.08, hx: 0, hy: 2, g1: [44, 52], wa: 90, wl: 13, wk: 1.6, a1: 1, a2: 2, b1: 1, b2: -1, mo: 0.6 },
    sr: { lean: -0.08, dx: -3, dy: 5, s: 1.07, hx: -2, hy: 2, g1: [36, 62], wa: 140, wl: 19, wk: 1.3, a1: 2, a2: 1, b1: 1, b2: 1, mo: 0.6 },
    hurt: { lean: 0.1, dx: 3, dy: -1, s: 0.97, hx: 4, hy: -3, tilt: 1, mo: 1, shut: 1, g1: [18, 58], wa: 100, wl: 18, gf: [70, 36], a1: 1, a2: 0, b1: 1, b2: 1 },
  };

  // Spiked morningstar: (gx,gy) lower grip, angle a toward the head, haft length L, k head scale.
  function morningstar(S, gx, gy, a, L, k = 1) {
    const c = Math.cos(a * D2R), s = Math.sin(a * D2R);
    const hx = gx + c * (L + 4 * k), hy = gy + s * (L + 4 * k);
    S.capsule(gx - c * 5, gy - s * 5, gx + c * L, gy + s * L, 1.9, 2.2, R.wood, { lo: 1, spec: 0.3 });
    // iron collar
    S.capsule(gx + c * (L - 2), gy + s * (L - 2), gx + c * L, gy + s * L, 2.8 * k, 2.8 * k, IRON, { lo: 1, spec: 0.5 });
    // grip wrap
    for (let i = -3; i <= 4; i += 2) S.line(gx + c * i - s * 2, gy + s * i + c * 2, gx + c * i + s * 2, gy + s * i - c * 2, '#211');
    // spikes behind the ball (drawn first), then the ball, then front spikes
    const spikes = [];
    for (let i = 0; i < 8; i++) {
      const ang = (i * 45 + 22) * D2R;
      spikes.push([Math.cos(ang), Math.sin(ang)]);
    }
    const R0 = 5.6 * k;
    for (const [ux, uy] of spikes) {
      const bx = hx + ux * R0 * 0.8, by = hy + uy * R0 * 0.8;
      S.capsule(bx, by, hx + ux * (R0 + 4.2 * k), hy + uy * (R0 + 4.2 * k), 1.7 * k, 0.3, IRON, { lo: 2, spec: 0.6 });
    }
    S.ball(hx, hy, R0, R0, IRON, { lo: 1, spec: 0.9, rim: 0.3 });
    S.ball(hx - 0.3, hy + 0.3, 1.5 * k, 1.5 * k, IRON, { lo: 2, hi: 6, spec: 0.6 });   // front spike stub
    S.px(hx - 1.8 * k, hy - 1.8 * k, '#dde');
  }

  function bugHead(S, x, y, o = {}) {
    const k = o.k || 1, tl = o.tilt || 0;
    const fur = BFUR;
    // big ears, slightly pointed, set high and wide
    const ear = (sd, lo) => {
      const tw = sd > 0 ? (o.ear || 0) : 0;
      const ex = x + sd * (10 + tw * 0.8) * k, ey = y - (8.5 + tw * 1.5) * k + tl;
      S.ball(ex, ey, 4.8 * k, 5.6 * k, fur, { lo: lo + 1, hi: 10, rot: sd * 0.45, rim: 0.4 });
      S.tri([ex - 2.8 * k, ey - 3.5 * k], [ex + sd * 2.8 * k, ey - 8.5 * k], [ex + 2.8 * k, ey - 2.5 * k], fur, { tone: sd < 0 ? 0.7 : 0.45 });
      S.ball(ex - sd * 0.3, ey + 1, 2.4 * k, 3.4 * k, ['#100', '#201', '#311', '#412', '#523'], { lo: 0, rot: sd * 0.45 });
    };
    ear(-1, 1); ear(1, 0);
    // broad skull
    S.ball(x, y, 9.5 * k, 8.5 * k, fur, { lo: 0, hi: 9.5, spec: 0.1, rim: 0.4 });
    // shaggy cheek ruffs & chin beard
    for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) {
      const bx = x + sd * (6.5 + i * 0.6) * k, by = y + (1 + i * 2.6) * k;
      S.tri([bx - sd, by - 2], [bx + sd * 4 * k, by + 1.5 + i * 0.6], [bx - sd * 1.5, by + 2.5], fur, { tone: sd < 0 ? 0.6 - i * 0.08 : 0.32 - i * 0.05 });
    }
    S.tri([x - 3 * k, y + 7 * k], [x + 2.5 * k, y + 7 * k], [x - 0.5 * k, y + 11 * k], fur, { tone: 0.3 });
    // bear muzzle: paler, broad, protruding
    S.ball(x - 0.5 * k, y + 4.6 * k, 5.4 * k, 3.9 * k, fur, { lo: 2, hi: 10, spec: 0.2 });
    S.ball(x - 0.5 * k, y + 2.6 * k, 2.6 * k, 1.7 * k, ['#000', '#101', '#112', '#223', '#556'], { spec: 1 });
    // mouth: shut, silent - a hard line with fangs jutting up over the lip
    S.line(x - 4 * k, y + 6.8 * k, x + 3 * k, y + 6.8 * k, '#101');
    S.px(x - 4.3 * k, y + 6.2 * k, '#101'); S.px(x + 3.3 * k, y + 6.2 * k, '#101');
    if ((o.mo || 0) > 0.5) {
      S.ellipse(x - 0.5, y + 8 * k, 3.2 * k, 1.8 * k, '#301');
      S.ellipse(x - 0.5, y + 8.4 * k, 2.2 * k, 0.9 * k, '#100');
    }
    for (const sd of [-1, 1]) {
      const fx = Math.round(x - 0.5 + sd * 2.4 * k);
      S.px(fx, Math.round(y + 6.8 * k), '#eed'); S.px(fx, Math.round(y + 5.8 * k), '#ffe'); S.px(fx + sd, Math.round(y + 6.8 * k), '#998');
    }
    // heavy brow shelf
    S.poly([[x - 8 * k, y - 3 * k], [x - 1 * k, y - 0.6 * k], [x + 1 * k, y - 0.6 * k], [x + 8 * k, y - 3 * k], [x + 7.5 * k, y - 1 * k], [x, y + 1.2 * k], [x - 7.5 * k, y - 1 * k]], fur, { tone: 0.08 });
    S.line(x - 7 * k, y - 3.3 * k, x - 1.5 * k, y - 1.4 * k, fur[8]);
    // small yellow eyes glinting from deep sockets
    for (const sd of [-1, 1]) {
      const ex = Math.round(x + sd * 3.6 * k - 0.5), ey = Math.round(y + 0.2 * k + tl * 0.5);
      S.px(ex - 1, ey, '#100'); S.px(ex + 1, ey, '#100'); S.px(ex, ey + 1, '#211');
      if (o.shut) { S.px(ex, ey, '#100'); S.px(ex - sd, ey - 1, '#100'); continue; }
      S.px(ex, ey, '#fe6'); S.px(ex + sd, ey, '#c60');
    }
  }

  function drawBugbear(S, pose) {
    crisp(S, 0.5, 1.4);
    const q = decode(pose);
    const p = resolve(bugKeys, q);
    const T = mkT(p, 44, 94, 64), W = wrap(S, T), s = T.s;
    const fur = BFUR;

    const shL = T.P(22, 36), shR = T.P(66, 36);
    const head = T.P(44 + p.hx, 34 + p.hy);
    const hipL = T.P(35, 66), hipR = T.P(53, 66);
    const footL = [30, 92], footR = [58, 92];

    const ga = p.wa, c = Math.cos(ga * D2R), sn = Math.sin(ga * D2R);
    const g1 = p.g1, g2 = [g1[0] + c * 8, g1[1] + sn * 8];
    const tgt = a => (a === 1 ? g1 : a === 2 ? g2 : null);
    const weapon = () => morningstar(S, g1[0], g1[1], ga, p.wl, p.wk);
    if (p.mb > 0.5) weapon();

    // ---- legs: short, thick, big flat feet ----
    const leg = (hip, foot, sd, lo) => {
      const kx = lerp(hip[0], foot[0], 0.5) + sd * 3, ky = lerp(hip[1], foot[1], 0.48);
      S.capsule(hip[0], hip[1], kx, ky, 8 * s, 6.5 * s, fur, { lo, hi: 9, rim: 0.3 });
      S.capsule(kx, ky, foot[0], foot[1] - 3, 6 * s, 5 * s, fur, { lo, hi: 8.5, rim: 0.3 });
      S.ball(foot[0] + sd, foot[1] - 2, 6.5, 3, fur, { lo, hi: 8 });
      for (let i = -1; i <= 1; i++) { S.px(foot[0] + sd + i * 3 - 0.5, foot[1], '#cca'); S.px(foot[0] + sd + i * 3 - 0.5, foot[1] + 1, '#665'); }
      limbStrokes(S, fur, hip[0], hip[1], foot[0], foot[1] - 3, 6, 22, 80 + sd);
    };
    leg(hipR, footR, 1, 0.5);
    leg(hipL, footL, -1, 0);

    // ---- body mass ----
    W.ball(44, 30, 23, 11, fur, { lo: 0, hi: 7.5 });                      // hump of the back
    W.ball(44, 46, 20, 15, fur, { lo: 0, hi: 8.5, rim: 0.3 });            // chest barrel
    W.ball(37, 43, 9, 7, fur, { lo: 1, hi: 9.5 });                        // pecs
    W.ball(51, 43, 9, 7, fur, { lo: 0.5, hi: 9, rim: 0.3 });
    W.ball(44, 60, 15, 9, fur, { lo: 1, hi: 9.5 });                       // gut
    W.ball(44, 67, 13, 5, fur, { lo: 0, hi: 7 });                         // hips
    // chest fur parting & pec shadow
    W.poly([[30, 49], [44, 53], [58, 49], [55, 52], [44, 56], [33, 52]], fur, { tone: 0.25 });
    W.line(44, 40, 44, 52, fur[3]);
    S.ball(shL[0], shL[1], 10 * s, 9 * s, fur, { lo: 0, hi: 9.5, spec: 0.1 });
    S.ball(shR[0], shR[1], 10 * s, 9 * s, fur, { lo: 0, hi: 9, rim: 0.4 });
    // spiky fur mantles bristling off the shoulders and hump
    for (let i = 0; i < 9; i++) {
      const t = i / 8, bx = lerp(16, 72, t), by = 30 - Math.sin(t * Math.PI) * 5 + (i % 2) * 2;
      const tipx = bx + (t - 0.5) * 9, tipy = by - 6 - (i % 2) * 2 - Math.sin(t * Math.PI) * 2;
      W.poly([[bx - 3.5, by + 3], [tipx, tipy], [bx + 3.5, by + 3]], fur, { grad: [bx, by + 3, tipx, tipy, t < 0.5 ? 0.45 : 0.3, t < 0.5 ? 0.8 : 0.55] });
    }
    furStrokes(S, fur, BUG_STROKES, T);

    // ---- harness: chest strap, belt, loincloth ----
    W.poly([[24, 34], [29, 32], [62, 62], [57, 64]], HIDE, { grad: [24, 33, 60, 63, 0.7, 0.35] });
    for (let i = 0; i < 4; i++) { const pt = T.P(lerp(28, 58, i / 3 * 0.9 + 0.05), lerp(34, 62, i / 3 * 0.9 + 0.05)); S.ball(pt[0], pt[1], 1.2, 1.2, IRON, { lo: 2, spec: 0.8 }); }
    W.poly([[30, 63], [58, 63], [58, 68], [30, 68]], HIDE, { grad: [44, 63, 44, 68, 0.6, 0.25] });
    for (let i = 0; i < 5; i++) { const pt = T.P(33 + i * 5.5, 65.5); S.ball(pt[0], pt[1], 1.1, 1.1, IRON, { lo: 2, spec: 0.8 }); }
    W.poly([[36, 67], [52, 67], [54, 80], [50, 78], [46, 82], [42, 78], [38, 81], [34, 78]], HIDE, { lo: 1, grad: [44, 67, 44, 82, 0.5, 0.15] });

    // ---- arms ----
    const arm = (sh, hand, bend, lo, seed) => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], 17 * s, 16 * s, bend);
      S.capsule(sh[0], sh[1], j.ex, j.ey, 6.6 * s, 5.4 * s, fur, { lo, hi: 9, rim: 0.35 });
      S.capsule(j.ex, j.ey, lerp(j.ex, j.hx, 0.4), lerp(j.ey, j.hy, 0.4), 5.6 * s, 6 * s, fur, { lo, hi: 9, rim: 0.35 });
      S.capsule(lerp(j.ex, j.hx, 0.4), lerp(j.ey, j.hy, 0.4), j.hx, j.hy, 6 * s, 4.4 * s, fur, { lo, hi: 9, rim: 0.35 });
      // shaggy elbow tuft
      const ux = j.ex - sh[0], uy = j.ey - sh[1], ul = Math.hypot(ux, uy) || 1;
      S.tri([j.ex - uy / ul * 3, j.ey + ux / ul * 3], [j.ex + ux / ul * 6 + (bend > 0 ? -2 : 2), j.ey + uy / ul * 6 + 2], [j.ex + uy / ul * 3, j.ey - ux / ul * 3], fur, { tone: 0.35 });
      limbStrokes(S, fur, sh[0], sh[1], j.hx, j.hy, 6, 26, seed);
      // iron-studded leather wrist wrap
      const wx = lerp(j.hx, j.ex, 0.25), wy = lerp(j.hy, j.ey, 0.25);
      S.ball(wx, wy, 4.8 * s, 4.2 * s, HIDE, { lo: 1, spec: 0.3 });
      S.ball(wx - 1, wy - 1, 0.9, 0.9, IRON, { lo: 3, spec: 0.8 });
      return j;
    };
    const fist = (j, lo) => {
      const fs = (p.fs || 1) * s;
      S.ball(j.hx, j.hy, 5 * fs, 4.4 * fs, fur, { lo: lo + 0.5, hi: 8.5, spec: 0.1 });
      S.line(j.hx - 3 * fs, j.hy + 1, j.hx + 2 * fs, j.hy + 1, fur[2]);
      S.line(j.hx - 3 * fs, j.hy + 2.5 * fs, j.hx + 2 * fs, j.hy + 2.5 * fs, fur[2]);
      S.px(j.hx - 2 * fs, j.hy - 2 * fs, fur[9]);
    };
    const paw = (j, lo) => {
      S.ball(j.hx, j.hy, 5 * s, 4.6 * s, fur, { lo: lo + 1, hi: 9 });
      const dx = j.hx - j.ex, dy = j.hy - j.ey, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      for (let i = -1.5; i <= 1.5; i++) {
        const bx = j.hx + ux * 4 - uy * i * 2.2, by = j.hy + uy * 4 + ux * i * 2.2;
        S.horn(bx, by, bx + ux * 2, by + uy * 2, bx + ux * 3 + uy * 1, by + uy * 3 - ux * 1, 1, 0.3, CLAW, { lo: 1 });
      }
    };
    const t1 = tgt(p.a1) || p.gf, t2 = tgt(p.a2) || p.gf;
    const crossL = p.a1 && t1[0] > 50;
    let j1, j2;
    if (crossL) { j2 = arm(shR, t2, p.b2, 0.5, 90); j1 = arm(shL, t1, p.b1, 0, 91); }
    else { j1 = arm(shL, t1, p.b1, 0, 91); j2 = arm(shR, t2, p.b2, 0.5, 90); }
    if (p.mb <= 0.5) weapon();
    if (p.a1) fist(j1, 0); else paw(j1, 0);
    if (p.a2) fist(j2, 0.5); else paw(j2, 0.5);

    // ---- head, sunk between the shoulders ----
    bugHead(S, head[0], head[1], { k: 1.18, mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt * 2, ear: p.ear || 0 });

    // shaggy fur edge (stable per body position)
    const dyU = Math.round(T.Y(44, 40) - 40);
    shagD(S, fur, (x, y) => [x, y < 66 ? y - dyU : y], 0.32);

    S.outline();

    if (q.st) {
      const cols = ['#445', '#778', '#bbc', '#eef'];
      if (q.dir < 0) swoosh(S, [[16, 3], [6, 26], [4, 52], [10, 76], [24, 92]], 7, cols, { behind: true, side: -1 });
      else if (q.dir > 0) swoosh(S, [[72, 3], [82, 26], [84, 52], [78, 76], [64, 92]], 7, cols, { behind: true, side: 1 });
      else {
        swoosh(S, [[36, 2], [22, 12], [12, 34], [9, 58]], 5, cols, { behind: true, side: -1 });
        swoosh(S, [[52, 2], [66, 12], [76, 34], [79, 58]], 5, cols, { behind: true, side: 1 });
      }
    }
  }
  const BUG_STROKES = strokeList(17, 170, 16, 22, 56, 50);

  function bugPortrait(S) {
    crisp(S);
    S.ball(12, 26, 15, 9, BFUR, { lo: 1, hi: 8 });
    bugHead(S, 12, 13, { k: 0.95 });
    shagD(S, BFUR, (x, y) => [x, y], 0.3);
    S.outline();
  }

  EN['Bugbear'] = { w: 88, h: 96, anchor: [44, 94], center: [44, 50], mouth: [44, 42], draw: drawBugbear, portrait: bugPortrait };

  // ===============================================================
  // WIGHT — gaunt barrow-king: rusted ancient armour, tattered dark
  // cloak, pale blue-white skin, corroded barrow-crown, burning icy
  // eyes, an ancient sword, wisps of cold spectral mist.
  // h = hilt hand (screen-left arm), sa = blade angle, o2 = other hand.
  // ===============================================================
  const WSKIN = ['#012', '#123', '#234', '#346', '#568', '#78a', '#9bc', '#cde', '#eff'];
  const CLOAK = ['#000', '#001', '#101', '#102', '#113', '#214', '#225', '#336', '#447'];
  const RUSTI = ['#100', '#110', '#211', '#311', '#422', '#532', '#643', '#754', '#965'];
  const CROWN = ['#100', '#210', '#320', '#430', '#541', '#762', '#983', '#ba5'];
  const BLADE = ['#001', '#112', '#223', '#334', '#456', '#678', '#89a', '#bcd', '#def'];
  const MIST = ['#124', '#248', '#37a', '#5ac', '#8de', '#bef'];
  const IRONW = ['#000', '#001', '#112', '#123', '#234', '#345', '#567', '#789', '#9ab'];

  const wightKeys = {
    idle: f => {
      const br = [0, 1, 1, 0][f], hb = [0, 0, 1, 1][f];
      return {
        lean: 0, dx: 0, dy: br, s: 1, hx: 0, hy: hb, tilt: 0, mo: 0.2, shut: 0,
        h: [44, 58 + br], sa: 90, sl: 34, o2: [46, 57 + br], b1: 1, b2: -1, two: 1,
        cape: [0, 1, 0, -1][f], mist: f, flare: [0, 1, 2, 1][f],
      };
    },
    wl: { lean: -0.12, dx: -3, dy: -2, hx: -3, hy: 0, h: [22, 32], sa: 244, sl: 30, o2: [26, 35], b1: -1, b2: -1, two: 1, mo: 0.6, cape: -2 },
    wl5: { h: [24, 48], sa: 235, sl: 31, o2: [28, 51], b1: 1, b2: -1 },
    wh: { lean: 0, dx: 0, dy: -3, hx: 0, hy: 2, h: [27, 12], sa: -3, sl: 36, o2: [58, 10], b1: -1, b2: 1, two: 0, mo: 0.6, cape: 0 },
    wh5: { h: [28, 40], sa: -2, sl: 36, o2: [58, 39], b1: 1, b2: -1, two: 0 },
    wr: { lean: 0.12, dx: 3, dy: -2, hx: 3, hy: 0, h: [64, 32], sa: -62, sl: 30, o2: [67, 29], b1: 1, b2: 1, two: 1, mo: 0.6, cape: 2 },
    wr5: { h: [62, 48], sa: -55, sl: 31, o2: [65, 45], b1: 1, b2: -1 },
    sl: { lean: 0.08, dx: 3, dy: 5, s: 1.08, hx: 2, hy: 2, h: [52, 60], sa: 36, sl: 36, o2: [56, 62], b1: -1, b2: -1, two: 1, mo: 1, cape: 2 },
    sh: { lean: 0, dx: 0, dy: 7, s: 1.1, hx: 0, hy: 2, h: [44, 50], sa: 90, sl: 38, o2: [46, 52], b1: 1, b2: -1, two: 1, mo: 1 },
    sr: { lean: -0.08, dx: -3, dy: 5, s: 1.08, hx: -2, hy: 2, h: [36, 60], sa: 144, sl: 36, o2: [32, 62], b1: 1, b2: 1, two: 1, mo: 1, cape: -2 },
    hurt: { lean: 0.1, dx: 3, dy: -2, s: 0.97, hx: 4, hy: -3, tilt: 1, mo: 1, shut: 1, h: [20, 52], sa: 118, sl: 32, o2: [70, 40], b1: 1, b2: 1, two: 0, cape: 2, flare: 3 },
  };

  // Ancient straight sword: hilt at (hx,hy), blade toward a. Pitted iron, cold pale edge.
  function oldSword(S, hx, hy, a, L, k = 1) {
    const c = Math.cos(a * D2R), s = Math.sin(a * D2R), nx = -s, ny = c;
    // grip + disc pommel
    S.capsule(hx - c * 6, hy - s * 6, hx + c * 1, hy + s * 1, 1.5, 1.5, HIDE, { lo: 0, hi: 4 });
    S.ball(hx - c * 7.5, hy - s * 7.5, 2.2, 2.2, CROWN, { lo: 1, spec: 0.6 });
    // blade
    const b0x = hx + c * 3, b0y = hy + s * 3;
    const tx = hx + c * (3 + L), ty = hy + s * (3 + L);
    const w0 = 2.4 * k, w1 = 1.6 * k;
    S.poly([[b0x + nx * w0, b0y + ny * w0], [tx - c * 4 + nx * w1, ty - s * 4 + ny * w1], [tx, ty], [tx - c * 4 - nx * w1, ty - s * 4 - ny * w1], [b0x - nx * w0, b0y - ny * w0]], BLADE, { grad: [b0x - nx * 3, b0y - ny * 3, b0x + nx * 3, b0y + ny * 3, 0.75, 0.35] });
    // fuller
    S.line(b0x + c * 2, b0y + s * 2, hx + c * (L - 6), hy + s * (L - 6), '#223');
    // cold edge highlight + notches
    S.line(b0x - nx * (w0 - 0.6) + c, b0y - ny * (w0 - 0.6) + s, tx - c * 3 - nx * (w1 - 0.6), ty - s * 3 - ny * (w1 - 0.6), '#bef');
    for (const t of [0.35, 0.62]) S.px(b0x + c * L * t + nx * w0 * 0.9, b0y + s * L * t + ny * w0 * 0.9, '#000');
    for (const t of [0.22, 0.5, 0.78]) spotAt(S, BLADE, b0x + c * L * t + nx * 0.6, b0y + s * L * t + ny * 0.6, 0.9, 0.9, -2, 2);
    // broad crossguard, ends curving toward the blade
    S.horn(hx + c * 2 - nx * 5, hy + s * 2 - ny * 5 + 0, hx + c * 1, hy + s * 1, hx + c * 2 + nx * 5, hy + s * 2 + ny * 5, 1.4, 1.4, CROWN, { lo: 1, spec: 0.5 });
  }

  function wightHead(S, x, y, o = {}) {
    const k = o.k || 1, tl = o.tilt || 0, fl = o.flare || 0;
    // long lank grey-white hair falling from under the crown
    const hr = [[-1, 3.5, 7.5, 12, 6], [-1, 5, 9.5, 19, 4.5], [-1, 6.5, 10, 24, 5.5], [-1, 6, 8, 15, 3.5],
                [1, 3.5, 7.5, 13, 5.5], [1, 5, 9.5, 18, 4], [1, 6.5, 10.5, 25, 5], [1, 6, 8.5, 16, 3.2]];
    for (const [sd, x0, xm, len, hi] of hr) {
      S.horn(x + sd * x0 * k, y - 5 * k, x + sd * xm * k, y + 2 * k, x + sd * (xm - 1.5) * k, y + len * k * 0.62 + 2, 1.1 * k, 0.4, WSKIN, { lo: 1, hi });
    }
    // gaunt face: tight skin over the skull, cold and dim so the eyes burn
    S.ball(x, y - 0.5 * k, 6.4 * k, 7.6 * k, WSKIN, { lo: 1, hi: 7.2, spec: 0.3, rim: 0.3 });
    S.ball(x, y + 4.5 * k, 4.4 * k, 4 * k, WSKIN, { lo: 1, hi: 6.5, rim: 0.3 });
    S.ball(x - 3.8 * k, y + 2.6 * k, 1.5 * k, 2.2 * k, WSKIN, { lo: 0, hi: 2.5 });
    S.ball(x + 3.8 * k, y + 2.6 * k, 1.5 * k, 2.2 * k, WSKIN, { lo: 0, hi: 2 });
    // brow ridge
    S.line(x - 5 * k, y - 2.6 * k, x - 1 * k, y - 1.6 * k, WSKIN[7]);
    S.line(x + 1 * k, y - 1.6 * k, x + 5 * k, y - 2.6 * k, WSKIN[5]);
    // black eye sockets with burning icy eyes
    const ey = Math.round(y - 0.3 * k + tl * 0.5);
    for (const sd of [-1, 1]) {
      const ex = Math.round(x + sd * 2.6 * k - 0.5);
      S.ellipse(ex + 0.5, ey + 0.5, 2.1 * k, 1.7 * k, '#000');
      if (o.shut) { S.line(ex - 1, ey, ex + 1, ey, '#37a'); continue; }
      S.px(ex, ey, '#fff'); S.px(ex + sd, ey, '#8de'); S.px(ex - sd, ey, '#37a');
      S.px(ex, ey - 1, fl > 1 ? '#8de' : '#5ac'); S.px(ex, ey + 1, '#248');
    }
    // nose: collapsed to slits
    S.px(x - 1, y + 2.6 * k, '#001'); S.px(x + 1, y + 2.6 * k, '#001'); S.px(x, y + 1.5 * k, WSKIN[6]);
    // lipless grin
    const mo = o.mo || 0;
    const my = Math.round(y + 5.2 * k);
    S.rect(Math.round(x - 2.5 * k), my, Math.round(5 * k) + 1, mo > 0.5 ? 3 : 2, '#000');
    for (let i = -2; i <= 2; i++) { S.px(Math.round(x + i * 1.1 * k), my, i % 2 ? '#9bc' : '#cde'); if (mo > 0.5) S.px(Math.round(x + i * 1.1 * k), my + 2, '#78a'); }
    // corroded barrow-crown: tarnished bronze band, five tall points, verdigris
    const cy = y - 6 * k;
    S.capsule(x - 6.6 * k, cy, x + 6.6 * k, cy, 1.8 * k, 1.8 * k, CROWN, { lo: 1, hi: 6.5, spec: 0.4 });
    for (let i = -2; i <= 2; i++) {
      const px = x + i * 3 * k, h = (i === 0 ? 7.5 : Math.abs(i) === 1 ? 5.5 : 4) * k;
      S.tri([px - 1.4 * k, cy - 0.5], [px + (i * 0.4), cy - h], [px + 1.4 * k, cy - 0.5], CROWN, { tone: i < 0 ? 0.68 : i === 0 ? 0.58 : 0.4 });
      S.px(px + i * 0.4, cy - h + 1, i <= 0 ? '#983' : '#762');
    }
    for (const [vx, vy] of [[-4.5, 0.5], [2, -1], [5, 0.5], [-1.5, -3], [-3.5, -2], [3.4, -2.5]]) S.px(x + vx * k, cy + vy * k, '#376');
    S.px(x + 4 * k, cy + 1, '#498');
    S.px(x, cy, '#8de'); S.px(x, cy + 1, '#37a');
  }

  function drawWight(S, pose) {
    crisp(S, 0.5, 1.15);
    const q = decode(pose);
    const p = resolve(wightKeys, q);
    const T = mkT(p, 44, 94, 64), W = wrap(S, T), s = T.s;
    const cp = p.cape || 0;

    const shL = T.P(30, 33), shR = T.P(58, 33);
    const head = T.P(44 + p.hx, 21 + p.hy);
    const hipL = T.P(39, 64), hipR = T.P(49, 64);
    const footL = [36, 92], footR = [52, 92];

    // ---- tattered cloak, back layer: flares to a ragged hem on the ground ----
    const hem = [];
    const r = U.rng(23);
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, x = lerp(8, 80, t) + cp * (1 - Math.abs(t - 0.5) * 2) * 1.5;
      const y = 92 - (i % 2 ? 5 + r() * 7 : r() * 2);
      hem.push([x + (i % 2 ? cp : 0), y]);
    }
    S.poly([T.P(28, 28), T.P(60, 28), [70 + cp, 58], ...hem.slice().reverse(), [18 + cp, 58]], CLOAK, { grad: [16, 36, 72, 80, 0.85, 0.2] });
    // heavy folds: lit ridge + dark trough
    for (const [fx, sh] of [[15, 0.9], [23, 0.8], [33, 0.6], [55, 0.45], [65, 0.35], [73, 0.3]]) {
      const top = T.P(fx < 44 ? 31 + (fx - 15) * 0.2 : 57 - (73 - fx) * 0.2, 34);
      const bx = fx + cp * 0.8, by = 88;
      S.line(top[0], top[1], bx, by, CLOAK[1]);
      S.line(top[0] - 1, top[1] + 2, bx - 1, by - 1, CLOAK[Math.round(3 + sh * 4)]);
    }
    // torn holes
    for (const [hx, hy] of [[21, 76], [67, 72], [29, 86], [60, 84]]) S.ellipse(hx + cp, hy, 1.2, 2.2, null);

    // ---- legs: rusted greaves under a mail skirt ----
    const leg = (hip, foot, sd, lo) => {
      const kx = lerp(hip[0], foot[0], 0.5) + sd, ky = lerp(hip[1], foot[1], 0.5);
      S.capsule(hip[0], hip[1], kx, ky, 4.6 * s, 3.8 * s, IRONW, { lo: lo + 1, hi: 5 });
      S.capsule(kx, ky, foot[0], foot[1] - 3, 3.8 * s, 3.2 * s, IRONW, { lo: lo + 1, hi: 7, spec: 0.5 });
      S.ball(kx, ky, 3.2 * s, 2.8 * s, IRONW, { lo: lo + 1, hi: 7.5, spec: 0.6 });
      S.ellipse(kx + sd, ky + 5, 1.4, 2, RUSTI[4]);
      S.ball(foot[0] + sd * 1.5, foot[1] - 1.8, 4.6, 2.6, IRONW, { lo, hi: 6, spec: 0.4 });
    };
    leg(hipR, footR, 1, 1);
    leg(hipL, footL, -1, 0);

    // ---- torso: gaunt frame in ancient mail under a corroded breastplate ----
    W.ball(44, 45, 12, 13, IRONW, { lo: 1, hi: 6, rim: 0.3 });                 // mail hauberk
    W.ball(44, 58, 9.5, 6, IRONW, { lo: 1, hi: 5 });
    for (let yy = 34; yy < 64; yy += 2) for (let xx = 30; xx < 59; xx += 2) {
      const X = T.X(xx + (yy % 4 ? 1 : 0), yy), Y = T.Y(xx, yy);
      if (inRamp(S, X, Y, IRONW) !== undefined) nudge(S, X, Y, IRONW, -2);
    }
    // breastplate: two dished plates, pitted and rust-eaten
    W.ball(39, 42, 6.5, 7, IRONW, { lo: 2, hi: 8, spec: 0.6 });
    W.ball(49, 42, 6.5, 7, IRONW, { lo: 1.5, hi: 7.5, spec: 0.4, rim: 0.3 });
    W.line(44, 36, 44, 49, '#001');
    for (const [rx, ry, rr] of [[37, 45, 1.8], [50, 39, 1.5], [41, 39, 1.1], [51, 46, 1.6], [46, 47, 1.1]]) {
      const pt = T.P(rx, ry);
      S.ellipse(pt[0], pt[1], rr, rr * 0.8, RUSTI[4]); S.px(pt[0] - 0.5, pt[1] - 0.5, RUSTI[6]);
    }
    for (const [rx, ry] of [[36, 37], [52, 37], [38, 48], [50, 48]]) W.px(rx, ry, '#9ab');
    // mail skirt with a ragged hem
    W.poly([[33, 60], [55, 60], [57, 76], [53, 74], [50, 78], [46, 75], [42, 78], [38, 74], [31, 76]], IRONW, { lo: 1, hi: 6, grad: [44, 60, 44, 78, 0.6, 0.2] });
    for (let yy = 61; yy < 77; yy += 2) for (let xx = 32; xx < 57; xx += 2) { const X = T.X(xx + (yy % 4 ? 1 : 0), yy), Y = T.Y(xx, yy); if (inRamp(S, X, Y, IRONW) !== undefined) nudge(S, X, Y, IRONW, -2); }
    for (const [rx, ry] of [[36, 70], [49, 66], [53, 73]]) spotAt(S, IRONW, T.X(rx, ry), T.Y(rx, ry), 1.6, 1.2, 0, 0), S.px(T.X(rx, ry), T.Y(rx, ry), RUSTI[5]);
    // belt with a corroded bronze clasp
    W.poly([[32, 57], [56, 57], [56, 61], [32, 61]], HIDE, { lo: 0, hi: 5, grad: [44, 57, 44, 61, 0.6, 0.2] });
    const bk = T.P(44, 59);
    S.ball(bk[0], bk[1], 2.4, 2.2, CROWN, { lo: 1, hi: 6, spec: 0.6 }); S.px(bk[0] + 1, bk[1], '#376');
    // gorget + high collar of the cloak
    W.ball(44, 31, 8, 3.2, IRONW, { lo: 1, hi: 7, spec: 0.5 });
    W.poly([[28, 26], [35, 30], [44, 32], [53, 30], [60, 26], [62, 33], [52, 36], [44, 37], [36, 36], [26, 33]], CLOAK, { grad: [26, 26, 62, 36, 0.8, 0.3] });

    // ---- arms ----
    const pauldron = (sh, sd, lo) => {
      S.ball(sh[0], sh[1] + 1, 6.6 * s, 5 * s, IRONW, { lo: lo + 1, hi: 7.5, spec: 0.6, rim: 0.3, rot: sd * 0.3 });
      S.ball(sh[0] + sd, sh[1] - 1.5, 6 * s, 4 * s, IRONW, { lo: lo + 1.5, hi: 8, spec: 0.7, rot: sd * 0.3 });
      S.line(sh[0] - 5, sh[1] + 1.5, sh[0] + 5, sh[1] + 1.5 + sd, '#001');
      S.ellipse(sh[0] - sd * 2, sh[1] + 2.5, 1.6, 1.1, RUSTI[4]); S.px(sh[0] - sd * 2 - 1, sh[1] + 2, RUSTI[6]);
    };
    const arm = (sh, hand, bend, lo) => {
      const j = ik(sh[0], sh[1], hand[0], hand[1], 16 * s, 15 * s, bend);
      S.capsule(sh[0], sh[1], j.ex, j.ey, 4 * s, 3.3 * s, IRONW, { lo: lo + 1, hi: 5.5 });          // mail sleeve
      for (let t = 0.15; t < 0.95; t += 0.18) { const mx = lerp(sh[0], j.ex, t), my = lerp(sh[1], j.ey, t); S.px(mx, my, '#001'); S.px(mx + 1, my + 1, '#001'); }
      S.capsule(j.ex, j.ey, j.hx, j.hy, 3.3 * s, 2.7 * s, IRONW, { lo: lo + 1, hi: 7.5, spec: 0.6 }); // iron vambrace
      S.ellipse(lerp(j.ex, j.hx, 0.45), lerp(j.ey, j.hy, 0.45), 1.5, 1.2, RUSTI[4]);                    // rust bloom
      S.px(lerp(j.ex, j.hx, 0.45) - 0.5, lerp(j.ey, j.hy, 0.45) - 0.5, RUSTI[6]);
      return j;
    };
    const hand = (j, lo) => {
      S.ball(j.hx, j.hy, 2.8 * s, 2.6 * s, WSKIN, { lo: lo + 1, hi: 8, spec: 0.2 });
      S.line(j.hx - 2, j.hy + 1, j.hx + 1, j.hy + 1, WSKIN[2]);
    };
    const sword = () => oldSword(S, p.h[0], p.h[1], p.sa, p.sl, s);
    const t2 = p.two > 0.5 ? p.o2 : p.o2;
    const crossL = p.h[0] > 52, crossR = t2[0] < 36;
    if (crossL) {
      const j2 = arm(shR, t2, p.b2, 0.5); pauldron(shR, 1, 0.5);
      pauldron(shL, -1, 0); const j1 = arm(shL, p.h, p.b1, 0);
      sword(); hand(j1, 0); hand(j2, 0.5);
    } else if (crossR) {
      const j1 = arm(shL, p.h, p.b1, 0); pauldron(shL, -1, 0);
      sword(); hand(j1, 0);
      const j2 = arm(shR, t2, p.b2, 0.5); pauldron(shR, 1, 0.5); hand(j2, 0.5);
    } else {
      const j1 = arm(shL, p.h, p.b1, 0), j2 = arm(shR, t2, p.b2, 0.5);
      pauldron(shL, -1, 0); pauldron(shR, 1, 0.5);
      sword(); hand(j1, 0); hand(j2, 0.5);
    }

    // ---- head ----
    wightHead(S, head[0], head[1], { k: 1.1, mo: p.mo, shut: p.shut > 0.5, tilt: p.tilt * 2, flare: p.flare });

    S.outline();

    // ---- burning eyes bleed light over the outline ----
    if (!(p.shut > 0.5)) {
      const ey = Math.round(head[1] - 0.5 * 1.1 + p.tilt);
      for (const sd of [-1, 1]) {
        const ex = Math.round(head[0] + sd * 2.6 * 1.1 - 0.5);
        if ((p.flare || 0) >= 1) S.px(ex, ey - 2, MIST[3]);
        if ((p.flare || 0) >= 2) S.px(ex + sd, ey - 3, MIST[2]);
      }
    }

    // ---- cold spectral mist: dithered wisps curling around the legs & hem ----
    const ph = (p.mist || 0) * 0.25 * Math.PI * 2;
    const wisp = (pts, wd, lvl0, front) => {
      // pts: control points; density peaks mid-wisp
      const N = 60;
      for (let i = 0; i <= N; i++) {
        const t = i / N, seg = t * (pts.length - 1), k0 = Math.min(pts.length - 2, Math.floor(seg)), f = seg - k0;
        const x = lerp(pts[k0][0], pts[k0 + 1][0], f), y = lerp(pts[k0][1], pts[k0 + 1][1], f);
        const w = wd * Math.sin(Math.PI * t);
        for (let j = -Math.ceil(w); j <= Math.ceil(w); j++) {
          const px = Math.round(x), py = Math.round(y + j);
          if (px < 1 || py < 1 || px > S.w - 2 || py > S.h - 2) continue;
          const lv = lvl0 * (1 - Math.abs(j) / (w + 1)) * Math.pow(Math.sin(Math.PI * t), 0.7);
          if (lv < P.thresh(px, py)) continue;
          if (!front && S.opaque(px, py)) continue;
          const cur = S.getHex(px, py);
          S.set(px, py, MIST[Math.min(MIST.length - 1, Math.floor(1 + lv * 4.2 + (cur ? 0.5 : 0)))]);
        }
      }
    };
    const sw2 = Math.sin(ph), cw2 = Math.cos(ph);
    // ground mist pooling around the feet (in front, soft and broad)
    wisp([[6, 91 + sw2], [24, 87 - cw2], [44, 90], [64, 87 + cw2], [82, 91 - sw2]], 3.4, 0.62, true);
    // slow plumes curling up from the hem
    wisp([[13 + sw2 * 1.5, 88], [10 + cw2, 78], [14 - sw2 * 1.5, 68]], 3.2, 0.5, false);
    wisp([[75 - sw2 * 1.5, 88], [78 - cw2, 77], [74 + sw2 * 1.5, 66]], 3.2, 0.5, false);
    wisp([[30, 92], [35 + sw2 * 1.5, 84], [31 - cw2, 78]], 2.4, 0.5, true);
    wisp([[58, 92], [53 - sw2 * 1.5, 85], [57 + cw2, 79]], 2.4, 0.5, true);
    // cold breath curling off the shoulders
    wisp([[29 + cw2, 29], [24 + sw2 * 1.5, 22], [27 - cw2, 16]], 2.2, 0.38, false);
    wisp([[59 - cw2, 29], [64 - sw2 * 1.5, 22], [61 + cw2, 16]], 2.2, 0.38, false);

    if (q.st) {
      const cols = ['#248', '#37a', '#8de', '#eff'];
      if (q.dir < 0) swoosh(S, [[16, 3], [6, 26], [4, 52], [10, 76], [24, 92]], 7, cols, { behind: true, side: -1 });
      else if (q.dir > 0) swoosh(S, [[72, 3], [82, 26], [84, 52], [78, 76], [64, 92]], 7, cols, { behind: true, side: 1 });
      else {
        swoosh(S, [[36, 2], [22, 12], [12, 34], [9, 58]], 5, cols, { behind: true, side: -1 });
        swoosh(S, [[52, 2], [66, 12], [76, 34], [79, 58]], 5, cols, { behind: true, side: 1 });
      }
    }
  }

  function wightPortrait(S) {
    crisp(S, 0.5, 1.15);
    S.poly([[0, 24], [2, 18], [8, 16], [16, 16], [22, 18], [24, 24]], CLOAK, { grad: [0, 16, 24, 24, 0.85, 0.3] });
    S.ball(4, 21, 5, 4, IRONW, { lo: 1, hi: 7.5, spec: 0.6 });
    S.ball(20, 21, 5, 4, IRONW, { lo: 1, hi: 6.5, spec: 0.4 });
    S.ball(12, 22, 6, 3, IRONW, { lo: 1, hi: 7, spec: 0.5 });
    wightHead(S, 12, 12, { k: 0.95, mo: 0.2 });
    S.outline();
  }

  EN['Wight'] = { w: 88, h: 96, anchor: [44, 94], center: [44, 48], mouth: [44, 27], draw: drawWight, portrait: wightPortrait };
})();
