// ================================================================
// ENEMIES — TIER I, "The Pit": Giant Rat, Kobold, Goblin, Skeleton, Orc.
// Procedural pixel art painted with DW.kit. Each enemy is a small rig:
// key poses are joint positions, the engine's pose is a blend of the
// idle pose and one key pose, and the painter draws the body back to
// front from those joints.
// ================================================================
(() => {
  const K = DW.kit, P = DW.pal, U = DW.util;
  const R = P.ramps;
  const E = DW.art.enemies;

  // ---------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;

  // Blend two key poses (numbers, arrays, nested objects; others snap at t=.5).
  const mix = (a, b, t) => {
    if (b === undefined) return a;
    if (typeof a === 'number') return lerp(a, b, t);
    if (Array.isArray(a)) return a.map((v, i) => mix(v, b[i], t));
    if (a && typeof a === 'object') {
      const o = {};
      for (const k in a) o[k] = mix(a[k], b[k], t);
      for (const k in b) if (!(k in a)) o[k] = b[k];
      return o;
    }
    return t < 0.5 ? a : b;
  };

  // Two-bone IK: returns the middle joint (elbow / knee) for A -> C.
  const ik = (ax, ay, cx, cy, l1, l2, bend) => {
    let dx = cx - ax, dy = cy - ay, d = Math.hypot(dx, dy) || 0.001;
    const maxd = (l1 + l2) * 0.995;
    if (d > maxd) { cx = ax + dx / d * maxd; cy = ay + dy / d * maxd; dx = cx - ax; dy = cy - ay; d = maxd; }
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const mx = ax + dx * a / d, my = ay + dy * a / d;
    return [mx - dy / d * h * bend, my + dx / d * h * bend, cx, cy];
  };

  // A view: the kit's primitives through a transform (scale about the
  // anchor, shift, and a lean that shears the body above the feet).
  const view = (S, t = {}) => {
    const ax = t.ax || 0, ay = t.ay || 0, k = t.k || 1, dx = t.dx || 0, dy = t.dy || 0, sh = t.sh || 0;
    const X = (x, y) => ax + (x - ax) * k + dx + (ay - y) * sh;
    const Y = (x, y) => ay + (y - ay) * k + dy;
    const V = {
      S, k, X, Y, t,
      ball: (x, y, rx, ry, r, o) => S.ball(X(x, y), Y(x, y), rx * k, ry * k, r, o),
      capsule: (x1, y1, x2, y2, r1, r2, r, o) => S.capsule(X(x1, y1), Y(x1, y1), X(x2, y2), Y(x2, y2), r1 * k, r2 * k, r, o),
      horn: (x0, y0, cx, cy, x1, y1, r0, r1, r, o) =>
        S.horn(X(x0, y0), Y(x0, y0), X(cx, cy), Y(cx, cy), X(x1, y1), Y(x1, y1), r0 * k, r1 * k, r, o),
      poly: (pts, r, o = {}) => {
        const q = pts.map(p => [X(p[0], p[1]), Y(p[0], p[1])]);
        if (o.grad) { const g = o.grad; o = Object.assign({}, o, { grad: [X(g[0], g[1]), Y(g[0], g[1]), X(g[2], g[3]), Y(g[2], g[3]), g[4], g[5]] }); }
        S.poly(q, r, o);
      },
      tri: (a, b, c, r, o) => V.poly([a, b, c], r, o),
      ellipse: (x, y, rx, ry, c) => S.ellipse(X(x, y), Y(x, y), rx * k, ry * k, c),
      line: (x0, y0, x1, y1, c) => S.line(X(x0 + 0.5, y0 + 0.5) - 0.5, Y(x0 + 0.5, y0 + 0.5) - 0.5, X(x1 + 0.5, y1 + 0.5) - 0.5, Y(x1 + 0.5, y1 + 0.5) - 0.5, c),
      px: (x, y, c) => S.set(Math.floor(X(x + 0.5, y + 0.5)), Math.floor(Y(x + 0.5, y + 0.5)), c),
      glow: (x, y, c, r) => S.glow(Math.floor(X(x + 0.5, y + 0.5)), Math.floor(Y(x + 0.5, y + 0.5)), c, r),
      erase: (x, y) => S.set(Math.floor(X(x + 0.5, y + 0.5)), Math.floor(Y(x + 0.5, y + 0.5)), 0),
      rect: (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) V.px(x + i, y + j, c); },
    };
    return V;
  };

  // Paint into a fresh layer, then composite it over S. Where the layer's
  // edge lies over existing paint, draw a contour line so overlapping forms
  // of the same ramp stay separate (an arm across a chest). `line` may be a
  // colour or fn(underHex) -> colour; o.skipLit leaves the upper-left edge open.
  const layer = (S, t, fn, line = '#101', o = {}) => {
    const L = K.create(S.w, S.h);
    fn(view(L, t), L);
    const w = S.w, h = S.h, src = L.data, dst = S.data;
    if (line) {
      const fixed = typeof line === 'string' ? P.toInt(line) : 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i] || !dst[i]) continue;
        const r = x < w - 1 && src[i + 1], l = x > 0 && src[i - 1], d = y < h - 1 && src[i + w], u = y > 0 && src[i - w];
        if (!(r || l || d || u)) continue;
        if (o.skipLit && !(l || u)) continue;   // only lines on the bottom/right of the layer
        dst[i] = fixed || P.toInt(line(P.fromInt(dst[i])));
      }
    }
    for (let i = 0; i < src.length; i++) if (src[i]) dst[i] = src[i];
    return L;
  };

  // Shift a colour along a ramp (texture: fur, scales, grime).
  const shifter = (ramp, d) => {
    ramp = P.ramp(ramp);
    const idx = new Map(ramp.map((c, i) => [c, i]));
    return hex => {
      const i = idx.get(hex);
      if (i === undefined) return hex;
      return ramp[U.clamp(i + d, 0, ramp.length - 1)];
    };
  };
  const inRamp = (S, ramp) => {
    const set = new Set(P.ramp(ramp).map(c => P.toInt(c)));
    return (x, y) => set.has(S.get(x, y));
  };

  // Short hair strokes over pixels of a ramp — mangy fur.
  const strands = (S, ramp, x0, y0, w, h, n, seed, dx = 1, dy = 1, d = -1) => {
    const r = U.rng(seed), sh = shifter(ramp, d), test = inRamp(S, ramp);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(x0 + r() * w), y = Math.floor(y0 + r() * h);
      if (!test(x, y)) continue;
      const len = 1 + Math.floor(r() * 2.5);
      for (let k = 0; k < len; k++) {
        const px = x + Math.round(dx * k), py = y + Math.round(dy * k);
        if (test(px, py)) S.set(px, py, sh(S.getHex(px, py)));
      }
    }
  };

  // A motion smear: a crescent band along a quadratic curve, densest at
  // the leading end (x1,y1). Painted after the outline, only on empty pixels.
  const smear = (S, x0, y0, cx, cy, x1, y1, wid, cols = ['#457', '#89b', '#cde']) => {
    const n = Math.ceil((Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy)) * 3);
    const done = new Set();
    for (let i = 0; i <= n; i++) {
      const t = i / n, it = 1 - t;
      const x = it * it * x0 + 2 * it * t * cx + t * t * x1;
      const y = it * it * y0 + 2 * it * t * cy + t * t * y1;
      const tx = 2 * it * (cx - x0) + 2 * t * (x1 - cx), ty = 2 * it * (cy - y0) + 2 * t * (y1 - cy);
      const tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl;
      const ww = wid * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.6) + 0.5;
      for (let s2 = -ww; s2 <= ww; s2 += 0.4) {
        const px = Math.floor(x + nx * s2), py = Math.floor(y + ny * s2);
        const key = px * 512 + py;
        if (done.has(key) || px < 0 || py < 0 || px >= S.w || py >= S.h || S.opaque(px, py)) continue;
        done.add(key);
        const core = 1 - Math.abs(s2) / (ww + 0.01);
        const v = Math.min(1, t * 1.3) * (0.45 + 0.55 * core);
        if (v < P.thresh(px, py) * 0.85 + 0.08) continue;
        S.set(px, py, cols[Math.min(cols.length - 1, Math.floor(v * cols.length))]);
      }
    }
  };

  // Pose -> which key: idle | windL/H/R | strikeL/H/R | hurt
  const breathOf = f => [0, 0.5, 1, 0.5][f];
  const poseKey = q => {
    if (q.hurt) return 'hurt';
    const side = q.dir < 0 ? 'L' : q.dir > 0 ? 'R' : 'H';
    if (q.strike) return 'strike' + side;
    if (q.wind) return 'wind' + side;
    return 'idle';
  };

  // Rig evaluation. KEY.idle(b, f) gives the breathing idle pose; every
  // other key is fn(w, idle) -> a complete pose (w = 0.5 or 1 for wind-ups).
  // half(idle, full, over) blends part-way and applies explicit overrides,
  // so half wind-ups travel along arcs instead of straight through the body.
  const rig = (KEY, q) => {
    const k = poseKey(q);
    const idle = KEY.idle(k === 'idle' ? breathOf(q.f) : 0, q.f);
    if (k === 'idle') return idle;
    return KEY[k](q.wind >= 1 || !k.startsWith('wind') ? 1 : 0.5, idle);
  };
  const half = (idle, full, over, t = 0.55) => Object.assign(mix(idle, full, t), over || {});

  // IK that picks the elbow/knee solution pointing along `pref` [x,y].
  const joint = (a, c, l1, l2, pref) => {
    const p1 = ik(a[0], a[1], c[0], c[1], l1, l2, 1), p2 = ik(a[0], a[1], c[0], c[1], l1, l2, -1);
    const mx = (a[0] + p1[2]) / 2, my = (a[1] + p1[3]) / 2;
    const d1 = (p1[0] - mx) * pref[0] + (p1[1] - my) * pref[1];
    const d2 = (p2[0] - mx) * pref[0] + (p2[1] - my) * pref[1];
    return d1 >= d2 ? p1 : p2;
  };

  const INK = '#101';

  // ---------------------------------------------------------------
  // Weapons
  // ---------------------------------------------------------------
  // Spiked club: grip at (x,y), pointing along `ang`, length len.
  // fs > 1 swells the head (foreshortened toward the viewer).
  const spikedClub = (V, x, y, ang, len, fs = 1) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    const bx = x - c * 4, by = y - s * 4;                 // pommel end
    const tx = x + c * len, ty = y + s * len;              // club head end
    const nx = -s, ny = c;
    const rHead = 4.3 * fs;
    const spike = (x0, y0, x1, y1, r) => V.capsule(x0, y0, x1, y1, r, 0.35, 'steel', { lo: 3, spec: 0.9 });
    // spikes first so the wood overlaps their roots
    for (const [t, side] of [[0.42, 1], [0.55, -1], [0.66, 1], [0.78, -1], [0.88, 1], [0.95, -1]]) {
      const px = lerp(bx, tx, t), py = lerp(by, ty, t);
      const r = lerp(1.8, rHead, Math.pow(t, 0.8));
      spike(px, py, px + nx * side * (r + 3.4 * fs), py + ny * side * (r + 3.4 * fs), 1.4 * Math.min(fs, 1.3));
    }
    spike(tx, ty, tx + c * (rHead + 2.5), ty + s * (rHead + 2.5), 1.4);
    V.capsule(bx, by, tx, ty, 1.7, rHead, 'wood', { lo: 1, spec: 0.3 });
    if (fs > 1.2) {
      // the head end faces us: a knotted cap ringed with nails
      V.ball(tx, ty, rHead + 0.6, rHead + 0.6, 'wood', { lo: 1, spec: 0.35 });
      if (fs >= 1.5) {
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * TAU + 0.3, ca = Math.cos(a), sa = Math.sin(a);
          V.capsule(tx + ca * rHead * 0.8, ty + sa * rHead * 0.8, tx + ca * (rHead + 2.6), ty + sa * (rHead + 2.6), 1.2, 0.3, 'steel', { lo: 2, hi: 7, spec: 0.5 });
        }
        V.ball(tx + c * 0, ty, rHead * 0.92, rHead * 0.92, 'wood', { lo: 1, spec: 0.35 });
      }
      for (const [ox, oy] of [[-0.4, -0.3], [0.35, -0.1], [-0.1, 0.4]]) {
        V.ball(tx + ox * rHead * 1.2, ty + oy * rHead * 1.2, 1.2, 1.2, 'steel', { lo: 3, spec: 1 });
      }
    }
    // iron band and nail heads
    const kx = lerp(bx, tx, 0.36), ky = lerp(by, ty, 0.36), kr = lerp(1.8, rHead, 0.36) + 0.7;
    V.capsule(kx - nx * kr, ky - ny * kr, kx + nx * kr, ky + ny * kr, 1, 1, 'steel', { lo: 1, hi: 6 });
    for (const t of [0.6, 0.76]) {
      const px = lerp(bx, tx, t), py = lerp(by, ty, t);
      V.px(Math.floor(px - nx * 1.5 - 0.5), Math.floor(py - ny * 1.5 - 0.5), '#bcd');
    }
    return [tx, ty];
  };

  // ===============================================================
  // GOBLIN — M 88x96. Wiry, hunched, cackling; spiked club.
  // ===============================================================
  // sickly green: purple-teal shadows -> yellow-green lights
  const GOB_SKIN = ['#102', '#112', '#222', '#232', '#342', '#453', '#574', '#795', '#9a5'];
  const gob = {};

  const GI = (b, f) => ({
    t: { k: 1, dx: 0, dy: 0, sh: 0 },
    pelvis: [44, 68], chest: [44, 55 - b], head: [44, 38 - b], turn: 0, tilt: 0,
    shL: [32, 46 - b], shR: [56, 46 - b],
    footL: [31, 92], footR: [57, 92],
    handL: [24, 70 - b], handR: [63, 64 - b],
    elL: [-1, 0.2], elR: [1, 0.4],
    club: -1.0 - b * 0.06, clubLen: 24, clubFs: 1, clubFront: true,
    mouth: f === 2 ? 0.3 : 0, eyes: 1, earL: f === 2 ? 2 : 0, earR: f === 3 ? 1 : 0,
  });
  gob.KEY = {
    idle: GI,
    windL: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: -2, dy: 0, sh: -0.08 },
        chest: [42, 54], head: [41, 37], turn: -1,
        shL: [31, 45], shR: [53, 47],
        handL: [26, 32], handR: [30, 36], elL: [-1, 0.6], elR: [0.2, 1],
        club: -2.25, clubFront: false, mouth: 0.15, earL: -2, earR: 2,
      });
      return w < 1 ? half(I, full, { handL: [26, 44], handR: [30, 47], club: -2.05, elR: [0, 1], t: { k: 1, dx: -1, dy: 0, sh: -0.04 } }) : full;
    },
    windR: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: 2, dy: 0, sh: 0.06 },
        chest: [46, 54], head: [47, 37], turn: 1,
        shL: [35, 47], shR: [57, 45],
        handL: [57, 36], handR: [61, 32], elL: [-0.2, 1], elR: [1, 0.6],
        club: -1.0, clubFront: false, mouth: 0.15, earL: 2, earR: -2,
      });
      return w < 1 ? half(I, full, { handL: [57, 47], handR: [61, 44], club: -1.05, elL: [0, 1], t: { k: 1, dx: 1, dy: 0, sh: 0.04 } }) : full;
    },
    windH: (w, I) => {
      const full = Object.assign({}, I, {
        pelvis: [44, 67], chest: [44, 52], head: [44, 36],
        shL: [33, 44], shR: [55, 44],
        handL: [40, 20], handR: [48, 20], elL: [-1, 0], elR: [1, 0],
        club: -1.57, clubLen: 12, clubFs: 1.1, clubFront: false, mouth: 0.7, earL: -3, earR: -3,
      });
      return w < 1 ? half(I, full, { handL: [38, 27], handR: [50, 27], clubLen: 9, club: -1.57 }) : full;
    },
    strikeL: (w, I) => Object.assign({}, I, {
      t: { k: 1.1, dx: 1, dy: 0, sh: 0.04 },
      pelvis: [44, 70], chest: [45, 58], head: [45, 44], turn: 1,
      shL: [33, 50], shR: [56, 51],
      handL: [44, 61], handR: [48, 62], elL: [-0.3, 1], elR: [1, 0.6],
      club: 0.3, clubLen: 17, clubFs: 1.3, clubFront: true, mouth: 1,
      smear: [[14, 8], [-6, 52], 'tip'],
    }),
    strikeR: (w, I) => Object.assign({}, I, {
      t: { k: 1.1, dx: -1, dy: 0, sh: -0.04 },
      pelvis: [44, 70], chest: [43, 58], head: [43, 44], turn: -1,
      shL: [32, 51], shR: [55, 50],
      handL: [40, 62], handR: [44, 61], elL: [-1, 0.6], elR: [0.3, 1],
      club: 2.85, clubLen: 17, clubFs: 1.3, clubFront: true, mouth: 1,
      smear: [[74, 8], [94, 52], 'tip'],
    }),
    strikeH: (w, I) => Object.assign({}, I, {
      t: { k: 1.1, dx: 0, dy: 0, sh: 0 },
      pelvis: [44, 70], chest: [44, 58], head: [44, 44],
      shL: [33, 50], shR: [55, 50],
      handL: [41, 55], handR: [47, 55], elL: [-1, 0.4], elR: [1, 0.4],
      club: 1.57, clubLen: 9, clubFs: 1.6, clubFront: true, mouth: 1,
      smear: [[26, 2], [16, 36], 'tip'], smear2: [[62, 2], [72, 36], 'tip'],
    }),
    hurt: (w, I) => Object.assign({}, I, {
      t: { k: 0.97, dx: 2, dy: 0, sh: -0.06 },
      chest: [45, 54], head: [47, 37], turn: 2, tilt: 2,
      shL: [34, 46], shR: [57, 47],
      handL: [20, 38], handR: [66, 50], elL: [-1, 0], elR: [1, 1],
      club: -0.8, clubLen: 22, mouth: 0.9, eyes: 0, earL: -4, earR: -4,
    }),
  };

  gob.head = (V, x, y, p) => {
    const turn = p.turn || 0, ex = turn;
    const eL = p.earL || 0, eR = p.earR || 0;
    // ears behind the skull: lit left ear, shadowed right ear, with a torn notch
    V.poly([[x - 6, y - 6], [x - 32, y - 13 + eL], [x - 26, y - 7 + eL], [x - 8, y + 3]], GOB_SKIN, { n: [-0.25, -0.6, 0.75] });
    V.poly([[x - 10, y - 4], [x - 27, y - 10 + eL], [x - 22, y - 7 + eL], [x - 10, y + 1]], R.skin, { tone: 0.42, lo: 1, hi: 6 });
    V.poly([[x + 6, y - 6], [x + 32, y - 13 + eR], [x + 26, y - 7 + eR], [x + 8, y + 3]], GOB_SKIN, { n: [0.45, -0.2, 0.85] });
    V.poly([[x + 10, y - 4], [x + 27, y - 10 + eR], [x + 22, y - 7 + eR], [x + 10, y + 1]], R.skin, { tone: 0.25, lo: 1, hi: 6 });
    for (const [dx, dy] of [[-21, -8], [-20, -8], [-21, -7], [-22, -8], [-20, -7]]) V.erase(x + dx, y + dy + eL);
    // brass ring through the right ear
    V.px(x + 13, y + 1 + eR * 0.3, '#eb3'); V.px(x + 14, y + 2 + eR * 0.3, '#a70'); V.px(x + 12, y + 2 + eR * 0.3, '#c92'); V.px(x + 13, y + 3 + eR * 0.3, '#750');
    // skull, cheekbones/jowls, pointed chin
    V.ball(x + ex * 0.2, y - 2, 10, 9, GOB_SKIN, { spec: 0.1 });
    V.ball(x + ex * 0.4, y + 4, 8.4, 5.5, GOB_SKIN);
    V.ball(x + ex * 0.6, y + 9, 3.6, 2.4, GOB_SKIN, { lo: 1 });
    V.px(x - 5 + ex * 0.2, y - 8, '#bc6'); V.px(x - 4 + ex * 0.2, y - 9, '#bc6');
    // forehead wrinkles
    V.line(x - 3 + ex, y - 7, x + 3 + ex, y - 7, '#453');
    // heavy, scowling brow
    const bx = x + ex * 0.8;
    V.poly([[bx - 9, y - 6], [bx - 1, y - 2], [bx + 1, y - 2], [bx + 9, y - 6], [bx + 9, y - 3], [bx + 1, y + 0.5], [bx - 1, y + 0.5], [bx - 9, y - 3]], GOB_SKIN, { n: [-0.2, -0.75, 0.6] });
    V.line(bx - 8, y - 2, bx - 2, y + 1, '#122'); V.line(bx + 2, y + 1, bx + 8, y - 2, '#112');
    // eye sockets + slanted eyes
    for (const sx of [-1, 1]) {
      const cx = bx + sx * 4.5;
      V.ellipse(cx, y + 1, 3, 1.8, '#102');
      if (p.eyes) {
        V.px(cx - 1, y + 1, '#d33'); V.px(cx, y + 1, '#f65'); V.px(cx + 1, y + 1, '#d33');
        V.px(cx - sx, y + 1, '#fd5'); V.px(cx - sx * 2, y + 1, '#a13');
      } else {
        V.line(cx - 2, y + (sx < 0 ? 0 : 1), cx + 2, y + (sx < 0 ? 1 : 0), '#101');
      }
      V.line(cx - 2, y + 3, cx + 1, y + 3, '#232');     // eye bags
    }
    // hooked nose: bridge, bulb drooping over the lip, nostrils
    const nx = x + ex * 1.1;
    V.capsule(nx, y - 1, nx + turn * 0.4, y + 4, 1.3, 2.2, GOB_SKIN, { spec: 0.3 });
    V.ball(nx + turn * 0.5, y + 5.5, 2.5, 2.1, GOB_SKIN, { spec: 0.6 });
    V.px(nx - 1 + turn * 0.5, y + 4, '#bc6');
    V.px(nx - 2 + turn * 0.5, y + 7, '#112'); V.px(nx + 2 + turn * 0.5, y + 7, '#102');
    // mouth: a lopsided sneer with crooked teeth, or a cackling gape
    const m = p.mouth || 0, mx = x + ex * 0.8, my = y + 9;
    if (m > 0.5) {
      V.ellipse(mx, my + 1.5, 6.5, 1.6 + m * 2.2, '#101');
      V.ellipse(mx, my + 2.8, 3.6, 0.8 + m * 1.1, '#502');
      for (const [tx, c] of [[-5, '#bba'], [-3, '#ddc'], [-2, '#bba'], [1, '#ddc'], [2, '#ddc'], [5, '#998']]) V.px(mx + tx, my, c);
      V.px(mx - 3, my + 1, '#bba'); V.px(mx + 2, my + 1, '#998');
      for (const tx of [-4, -1, 3]) V.px(mx + tx, my + 2 + m * 2.4, '#998');
    } else {
      V.line(mx - 8, my - 4, mx - 6, my - 1, '#101');
      V.line(mx - 6, my - 1, mx + 5, my - 1, '#101');
      V.line(mx + 5, my - 1, mx + 7, my - 2, '#101');
      if (m > 0) { V.line(mx - 3, my, mx + 3, my, '#101'); V.px(mx, my, '#502'); }
      for (const [tx, ty, c] of [[-6, -2, '#998'], [-4, -2, '#ddc'], [-3, -2, '#bba'], [-1, -2, '#ddc'], [2, -2, '#bba'], [3, -3, '#ddc'], [3, -2, '#ddc'], [-2, 0, '#998'], [1, 0, '#998']]) V.px(mx + tx, my + ty, c);
    }
  };

  gob.arm = (V, sh, hand, pref, lo, bracer) => {
    const [ex, ey] = joint(sh, hand, 13, 13, pref);
    V.capsule(sh[0], sh[1], ex, ey, 3.2, 2.2, GOB_SKIN, { lo });
    V.capsule(ex, ey, hand[0], hand[1], 2.6, 2, GOB_SKIN, { lo });
    V.ball(ex, ey, 2.4, 2.2, GOB_SKIN, { lo });
    if (bracer) {
      V.capsule(lerp(ex, hand[0], 0.35), lerp(ey, hand[1], 0.35), lerp(ex, hand[0], 0.8), lerp(ey, hand[1], 0.8), 3, 2.8, R.wood, { lo: 2, spec: 0.2 });
      V.px(lerp(ex, hand[0], 0.55), lerp(ey, hand[1], 0.55), '#bcd');
    }
    V.ball(hand[0], hand[1], 3, 2.8, GOB_SKIN, { lo });
    return [ex, ey];
  };

  gob.leg = (V, hip, foot, pref, lo) => {
    const ank = [foot[0], foot[1] - 3];
    const [kx, ky] = joint(hip, ank, 13, 13, pref);
    V.capsule(hip[0], hip[1], kx, ky, 3.8, 2.6, GOB_SKIN, { lo });
    V.capsule(kx, ky, ank[0], ank[1], 2.6, 1.9, GOB_SKIN, { lo });
    V.ball(kx, ky, 3, 2.7, GOB_SKIN, { lo, spec: 0.2 });
    const dir = foot[0] < 44 ? -1 : 1;
    V.ball(foot[0] + dir * 2, foot[1] - 1, 5.2, 2.3, GOB_SKIN, { lo });
    for (const t of [3, 5, 7]) V.px(foot[0] + dir * t, foot[1] + (t === 7 ? -1 : 0), '#bba');
  };

  gob.draw = (S, q) => {
    const p = rig(gob.KEY, q);
    const T = Object.assign({ ax: 44, ay: 94 }, p.t);
    const V = view(S, T);
    const [px, py] = p.pelvis, [cx, cy] = p.chest, [hx, hy] = p.head;
    let tip = null;
    const clubDraw = VV => { tip = spikedClub(VV, p.handR[0], p.handR[1], p.club, p.clubLen, p.clubFs); };

    if (!p.clubFront) layer(S, T, clubDraw, null);
    // legs (right leg is in shadow)
    gob.leg(V, [px - 5, py + 1], p.footL, [-1, -0.2], 0);
    gob.leg(V, [px + 5, py + 1], p.footR, [1, -0.2], 1);
    // torso: lean chest, ribs, pot belly
    V.capsule(px, py, cx, cy, 7.5, 9, GOB_SKIN);
    V.ball(cx, cy, 10.5, 9, GOB_SKIN, { spec: 0.08 });
    V.ball(lerp(cx, px, 0.6), lerp(cy, py, 0.6) + 1, 8, 6.5, GOB_SKIN, { lo: 0.5 });
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      V.line(cx + sx * (5 + i), cy + 2 + i * 2, cx + sx * (8 + i * 0.5), cy + 1 + i * 2, sx < 0 ? '#343' : '#232');
    }
    V.line(cx, cy - 6, cx, cy + 2, '#343');
    // shoulders
    V.ball(p.shL[0], p.shL[1] + 1, 4.6, 4.2, GOB_SKIN);
    V.ball(p.shR[0], p.shR[1] + 1, 4.6, 4.2, GOB_SKIN, { lo: 0.5 });
    // leather scraps: strap, belt + buckle, ragged loincloth, studded pauldron
    V.poly([[p.shL[0] - 1, p.shL[1] - 1], [p.shL[0] + 3, p.shL[1] - 2], [px + 9, py - 2], [px + 5, py - 1]], R.wood, { tone: 0.55, lo: 1 });
    V.poly([[px - 10, py - 2], [px + 10, py - 2], [px + 9, py + 2], [px - 9, py + 2]], R.wood, { grad: [px, py - 2, px, py + 2, 0.75, 0.3] });
    V.rect(px - 2, py - 1, 3, 3, '#467');
    V.px(px - 1, py - 1, '#bcd');
    V.poly([[px - 8, py + 2], [px + 8, py + 2], [px + 7, py + 12], [px + 4, py + 9], [px + 2, py + 13], [px - 1, py + 10], [px - 4, py + 14], [px - 7, py + 10]],
      R.dusk, { grad: [px - 6, py + 2, px + 6, py + 12, 0.75, 0.15], lo: 1, hi: 6 });
    gob.head(V, hx, hy, p);
    // arms in front, each with its own contour so they read over the body
    layer(S, T, VV => gob.arm(VV, p.shL, p.handL, p.elL, 0, false), '#122');
    // studded leather pauldron over the left shoulder
    layer(S, T, VV => {
      const [sx, sy] = p.shL;
      VV.poly([[sx - 7, sy + 3], [sx - 6, sy - 2], [sx - 2, sy - 4], [sx + 3, sy - 4], [sx + 6, sy - 1], [sx + 5, sy + 1], [sx + 1, sy], [sx - 2, sy + 2], [sx - 4, sy + 5]],
        R.wood, { grad: [sx - 4, sy - 4, sx + 4, sy + 4, 0.95, 0.35], lo: 1 });
      VV.line(sx - 5, sy + 1, sx + 3, sy - 1, '#310');
      VV.px(sx - 4, sy - 1, '#bcd'); VV.px(sx, sy - 3, '#bcd'); VV.px(sx + 3, sy - 2, '#8ab');
    }, '#210');
    if (p.clubFront) layer(S, T, clubDraw, '#122');
    layer(S, T, VV => {
      gob.arm(VV, p.shR, p.handR, p.elR, 0.5, true);
      // fingers wrapped around the haft
      VV.px(p.handR[0] - 1, p.handR[1] + 1, '#232'); VV.px(p.handR[0] + 1, p.handR[1] + 1, '#232');
    }, '#122');
    // claws on the free hand
    if (p.handL[1] > p.shL[1]) for (const d of [-2, 0, 2]) V.px(p.handL[0] + d, p.handL[1] + 3, '#998');
    S.outline(INK);
    if (p.smear && tip) {
      const [a, c] = p.smear;
      const X = (x, y) => T.ax + (x - T.ax) * T.k + T.dx + (T.ay - y) * T.sh, Y = (x, y) => T.ay + (y - T.ay) * T.k;
      smear(S, a[0], a[1], c[0], c[1], X(tip[0], tip[1]), Y(tip[0], tip[1]), 3);
      if (p.smear2) smear(S, p.smear2[0][0], p.smear2[0][1], p.smear2[1][0], p.smear2[1][1], X(tip[0], tip[1]), Y(tip[0], tip[1]), 3);
    }
  };

  gob.portrait = S => {
    const p = Object.assign(GI(0, 0), { earL: -5, earR: -5, mouth: 0 });
    const k = 0.8;
    const V = view(S, { ax: 0, ay: 0, k, dx: 12 - 44 * k, dy: 11 - 38 * k });
    V.ball(44, 60, 16, 10, GOB_SKIN);
    V.ball(32, 51, 6, 5, GOB_SKIN); V.ball(56, 51, 6, 5, GOB_SKIN, { lo: 0.5 });
    V.poly([[26, 46], [30, 48], [40, 62], [36, 62]], R.wood, { tone: 0.5, lo: 1 });
    gob.head(V, 44, 38, p);
    S.outline(INK);
  };

  E['Goblin'] = {
    w: 88, h: 96, anchor: [44, 94], center: [44, 56], mouth: [44, 47],
    draw: gob.draw, portrait: gob.portrait,
  };

  // ===============================================================
  // ORC — M 88x96. Scarred, brutal; two-handed cleaver-axe.
  // ===============================================================
  const ORC_SKIN = ['#101', '#111', '#122', '#222', '#333', '#343', '#454', '#565', '#676', '#898'];
  const HAIR = ['#000', '#101', '#112', '#212', '#223', '#334', '#445'];
  const LEATHER = ['#100', '#200', '#210', '#310', '#421', '#531', '#642', '#753'];
  const IRON = ['#101', '#111', '#212', '#222', '#323', '#434', '#545', '#667', '#889', '#bbc'];
  const orc = {};

  // A clenched fist: ball, finger creases, knuckle glints.
  const fist = (V, x, y, r, ramp, o = {}) => {
    V.ball(x, y, r, r * 0.92, ramp, Object.assign({ spec: 0.25 }, o));
    const d = P.ramp(ramp)[2];
    V.line(x - r * 0.6, y + r * 0.25, x + r * 0.5, y + r * 0.35, d);
    V.px(x - r * 0.15, y + r * 0.25 - 1, d);
    V.px(x - r * 0.5, y - r * 0.2, P.ramp(ramp)[P.ramp(ramp).length - 2]);
  };

  // Heavy cleaver-axe. Grip (x,y), haft along ang, `len` from grip to the
  // top. side +1/-1 puts the blade on either side of the haft.
  const cleaverAxe = (V, x, y, ang, len, side = 1, fs = 1, spike = true) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    const nx = -s * side, ny = c * side;
    const at = (t, o) => [x + c * t + nx * o, y + s * t + ny * o];
    const bl = 14 * fs, b0 = len - 15 * fs, b1 = len + 1;
    // haft with leather grip wrap
    V.capsule(...at(-7, 0), ...at(b1, 0), 1.9, 1.9, 'wood', { lo: 1, spec: 0.3 });
    for (let t = -5; t < 6; t += 2) { const q = at(t, 0); V.px(q[0], q[1], '#310'); }
    // blade: a heavy slab, edge flared and bearded
    const pts = [at(b0 + 3, 1), at(b1, 1), at(b1 + 1.5, bl * 0.55), at(b1 + 3, bl), at(b0 - 3, bl + 1.5), at(b0 + 1, bl * 0.5)];
    V.poly(pts, IRON, { grad: [...at(len - 8, 2), ...at(len - 8, bl), 0.6, 0.2], lo: 1, hi: 8 });
    // bright bevelled cutting edge
    const e0 = at(b1 + 3, bl), e1 = at(b0 - 3, bl + 1.5);
    V.line(e0[0], e0[1], e1[0], e1[1], '#cde');
    const f0 = at(b1 + 2, bl - 1.4), f1 = at(b0 - 2, bl);
    V.line(f0[0], f0[1], f1[0], f1[1], '#889');
    // notches bitten out of the edge
    for (const t of [0.3, 0.7]) {
      const q = at(lerp(b1 + 3, b0 - 3, t), bl + lerp(0, 1.5, t));
      V.erase(q[0], q[1]);
      const q2 = at(lerp(b1 + 3, b0 - 3, t), bl - 1 + lerp(0, 1.5, t)); V.px(q2[0], q2[1], '#223');
    }
    // iron socket, top spike, rivets
    V.capsule(...at(b0 + 2, 0), ...at(b1, 0), 2.7, 2.7, IRON, { lo: 1, spec: 0.6 });
    if (spike) V.capsule(...at(b1, 0), ...at(b1 + 5, 0), 1.6, 0.4, IRON, { lo: 2, spec: 0.8 });
    for (const t of [b0 + 4, b1 - 2]) { const q = at(t, 4); V.px(q[0], q[1], '#bcd'); }
    // rust blooms
    const r = U.rng(77);
    for (let i = 0; i < 16; i++) {
      const q = at(lerp(b0, b1, r()), lerp(3, bl - 2, r()));
      if (V.S.opaque(Math.floor(V.X(q[0], q[1])), Math.floor(V.Y(q[0], q[1])))) V.px(q[0], q[1], r() < 0.5 ? '#731' : '#520');
    }
    const m = at(len - 6, bl * 0.7);
    return m;
  };

  const OI = (b, f) => ({
    t: { k: 1, dx: 0, dy: 0, sh: 0 },
    pelvis: [44, 64], chest: [44, 44 - b], head: [44, 25 - b], turn: 0,
    shL: [25, 36 - b], shR: [63, 36 - b],
    footL: [26, 92], footR: [62, 92],
    handL: [17, 62 - b], handR: [64, 60 - b], grip: 0,
    elL: [-1, 0.2], elR: [1, 0.3],
    axe: -1.8, axeLen: 44, axeSide: 1, axeFs: 1, axeFront: true, spike: true,
    mouth: f === 2 ? 0.4 : 0, eyes: 1, brow: 0, knot: f === 1 || f === 2 ? 1 : 0,
  });
  orc.KEY = {
    idle: OI,
    windL: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: -2, dy: 0, sh: -0.05 },
        chest: [42, 44], head: [41, 26], turn: -1,
        shL: [24, 36], shR: [54, 39],
        handR: [29, 35], grip: 9, elL: [-1, 0.6], elR: [0, 1],
        axe: -1.88, axeLen: 25, axeSide: -1, axeFs: 0.9, axeFront: false, mouth: 0.6, brow: 1,
      });
      return w < 1 ? half(I, full, { handR: [36, 44], axe: -2.05, axeLen: 30, elR: [0, 1], t: { k: 1, dx: -1, dy: 0, sh: -0.035 } }) : full;
    },
    windR: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: 2, dy: 0, sh: 0.05 },
        chest: [46, 44], head: [47, 26], turn: 1,
        shL: [34, 39], shR: [64, 36],
        handR: [58, 35], grip: 9, elL: [0, 1], elR: [1, 0.6], gripSwap: true,
        axe: -1.26, axeLen: 25, axeSide: 1, axeFs: 0.9, axeFront: false, mouth: 0.6, brow: 1,
      });
      return w < 1 ? half(I, full, { handR: [54, 44], axe: -1.15, axeLen: 28, elL: [0, 1], gripSwap: true, t: { k: 1, dx: 1, dy: 0, sh: 0.035 } }) : full;
    },
    windH: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 0.96, dx: 0, dy: 0, sh: 0 },
        pelvis: [44, 63], chest: [44, 42], head: [44, 26],
        shL: [25, 34], shR: [63, 34],
        handR: [46, 21], handL: [42, 22], grip: 0, elL: [-1, -1.2], elR: [1, -1.2], behind: true,
        axe: -1.57, axeLen: 17, axeSide: 1, axeFs: 0.9, axeFront: false, spike: true, mouth: 0.9, brow: 1,
      });
      return w < 1 ? half(I, full, { handR: [47, 29], handL: [41, 30], axeLen: 13, behind: true, t: { k: 0.98, dx: 0, dy: 0, sh: 0 } }) : full;
    },
    strikeL: (w, I) => Object.assign({}, I, {
      t: { k: 1.06, dx: 1, dy: 0, sh: 0.04 },
      pelvis: [44, 66], chest: [45, 47], head: [45, 30], turn: 1,
      shL: [26, 39], shR: [63, 40],
      handR: [48, 62], grip: 9, elL: [-0.2, 1], elR: [1, 0.5],
      axe: 0.15, axeLen: 21, axeSide: -1, axeFs: 1.05, axeFront: true, mouth: 1, brow: 1,
      smear: [[10, 8], [-6, 56]],
    }),
    strikeR: (w, I) => Object.assign({}, I, {
      t: { k: 1.06, dx: -1, dy: 0, sh: -0.04 },
      pelvis: [44, 66], chest: [43, 47], head: [43, 30], turn: -1,
      shL: [25, 40], shR: [62, 39],
      handR: [40, 62], grip: 9, elL: [-1, 0.5], elR: [0.2, 1],
      axe: 3.0, axeLen: 21, axeSide: 1, axeFs: 1.05, axeFront: true, mouth: 1, brow: 1,
      smear: [[78, 8], [94, 56]],
    }),
    strikeH: (w, I) => Object.assign({}, I, {
      t: { k: 1.06, dx: 0, dy: 0, sh: 0 },
      pelvis: [44, 66], chest: [44, 47], head: [44, 31],
      shL: [26, 40], shR: [62, 40],
      handR: [44, 55], grip: -6, elL: [-1, 0.4], elR: [1, 0.4],
      axe: 1.57, axeLen: 20, axeSide: -1, axeFs: 1.45, axeFront: true, mouth: 1, brow: 1,
      smear: [[28, -2], [16, 36]], smear2: [[60, -2], [72, 36]],
    }),
    hurt: (w, I) => Object.assign({}, I, {
      t: { k: 0.97, dx: 2, dy: 0, sh: -0.05 },
      chest: [45, 43], head: [47, 25], turn: 2,
      shL: [27, 36], shR: [64, 37],
      handL: [14, 42], handR: [64, 58], elL: [-1, 0.2], elR: [1, 1],
      axe: -1.42, axeLen: 36, mouth: 1, eyes: 0, brow: 0,
    }),
  };

  orc.head = (V, x, y, p) => {
    const ex = (p.turn || 0);
    // black topknot bound with a ring, tail swinging behind
    const kn = p.knot || 0;
    V.horn(x + 2, y - 11, x + 9 + kn, y - 15, x + 10 + kn, y - 4, 2.4, 1.2, HAIR, { spec: 0.6 });
    V.ball(x + 1, y - 12, 3.6, 2.8, HAIR, { spec: 0.6 });
    V.px(x + 4, y - 12, '#a70'); V.px(x + 4, y - 11, '#eb3');
    // swept-back pointed ears with rings
    V.poly([[x - 8, y - 3], [x - 16, y - 9], [x - 13, y - 4], [x - 8, y + 2]], ORC_SKIN, { n: [-0.5, -0.4, 0.75] });
    V.poly([[x + 8, y - 3], [x + 16, y - 9], [x + 13, y - 4], [x + 8, y + 2]], ORC_SKIN, { n: [0.6, -0.2, 0.75] });
    V.px(x + 12, y - 3, '#eb3'); V.px(x + 12, y - 2, '#a70'); V.px(x - 12, y - 3, '#c92');
    // skull and the huge underslung jaw
    V.ball(x + ex * 0.2, y - 4, 8.6, 8, ORC_SKIN, { spec: 0.15 });
    V.ball(x + ex * 0.4, y + 3, 10.5, 6.5, ORC_SKIN);
    V.px(x - 4, y - 10, '#898'); V.px(x - 3, y - 10, '#898');
    // war paint: a red band across the eyes
    V.poly([[x - 10, y - 5], [x + 10, y - 5], [x + 10, y - 0.5], [x - 10, y - 0.5]], R.crimson, { grad: [x - 8, y - 5, x + 8, y, 0.62, 0.28], lo: 1, hi: 7,
      clip: (px, py) => V.S.opaque(px, py) });
    // heavy brow
    const bx = x + ex * 0.7, bb = p.brow ? 1 : 0;
    V.poly([[bx - 9, y - 7 + bb], [bx + 9, y - 7 + bb], [bx + 8, y - 4 + bb], [bx + 1, y - 3 + bb * 2], [bx - 1, y - 3 + bb * 2], [bx - 8, y - 4 + bb]], ORC_SKIN, { n: [-0.25, -0.8, 0.5] });
    V.line(bx - 8, y - 3 + bb, bx - 2, y - 2 + bb * 2, '#101'); V.line(bx + 2, y - 2 + bb * 2, bx + 8, y - 3 + bb, '#101');
    // small, mean eyes glinting under the brow
    for (const sx of [-1, 1]) {
      const cx = bx + sx * 4, ey = y - 2 + bb;
      V.line(cx - 2, ey, cx + 1, ey, '#101');
      if (p.eyes) { V.px(cx, ey, '#fd5'); V.px(cx - sx, ey, '#e70'); }
      else V.line(cx - 2, ey + 1, cx + 2, ey + 1, '#101');
    }
    // broad flat nose
    V.ball(bx, y + 0.5, 3, 2.3, ORC_SKIN, { spec: 0.4 });
    V.px(bx - 2, y + 2, '#101'); V.px(bx + 1, y + 2, '#101');
    // scar through the left brow and cheek
    V.line(bx - 6, y - 8, bx - 3, y + 3, '#787');
    V.px(bx - 7, y - 7, '#565'); V.px(bx - 2, y + 2, '#565');
    // mouth with an underbite; tusks jut up from the lower jaw
    const m = p.mouth || 0, mx = bx, my = y + 5;
    if (m > 0.5) {
      V.ellipse(mx, my + 1, 6.4, 1.5 + m * 2, '#101');
      V.ellipse(mx, my + 1.8, 3.6, 0.6 + m, '#502');
      for (const tx of [-2, 0, 2]) V.px(mx + tx, my - 1, '#ddc');
      for (const tx of [-3, 3]) V.px(mx + tx, my + 2 + m * 1.6, '#bba');
    } else {
      V.line(mx - 6, my, mx + 6, my, '#101');
      V.line(mx - 4, my + 1, mx + 4, my + 1, '#222');
      if (m > 0) V.line(mx - 2, my + 1, mx + 2, my + 1, '#101');
    }
    const ty = m > 0.5 ? 2 : 0;
    V.horn(mx - 5, my + 2 + ty, mx - 7, my - 1 + ty, mx - 6, my - 5 + ty, 1.8, 0.6, R.bone, { lo: 3, spec: 0.5 });
    V.horn(mx + 5, my + 2 + ty, mx + 7, my - 1 + ty, mx + 6, my - 5 + ty, 1.8, 0.6, R.bone, { lo: 2, hi: 7, spec: 0.3 });
  };

  orc.arm = (V, sh, hand, pref, lo, open) => {
    const [ex, ey] = joint(sh, hand, 15, 14, pref);
    V.ball(sh[0], sh[1] + 1, 7, 6.5, ORC_SKIN, { lo });                       // deltoid
    V.capsule(sh[0], sh[1], ex, ey, 6.2, 4.6, ORC_SKIN, { lo });
    V.ball(lerp(sh[0], ex, 0.45), lerp(sh[1], ey, 0.45), 5.6, 5.6, ORC_SKIN, { lo, spec: 0.15 }); // biceps
    V.capsule(ex, ey, hand[0], hand[1], 5.2, 3.8, ORC_SKIN, { lo });
    // iron-banded leather wrist wrap
    const wx = lerp(ex, hand[0], 0.68), wy = lerp(ey, hand[1], 0.68);
    V.capsule(lerp(ex, hand[0], 0.55), lerp(ey, hand[1], 0.55), lerp(ex, hand[0], 0.82), lerp(ey, hand[1], 0.82), 4.6, 4.3, LEATHER, { lo: 1, spec: 0.2 });
    V.px(wx - 1, wy - 1, '#9ab');
    if (!open) fist(V, hand[0], hand[1], 4.6, ORC_SKIN, { lo });
    else {
      V.ball(hand[0], hand[1], 4.4, 4, ORC_SKIN, { lo });
      for (const d of [-3, -1, 1, 3]) V.capsule(hand[0] + d, hand[1] + 2, hand[0] + d * 1.5, hand[1] - 5, 1.1, 0.9, ORC_SKIN, { lo });
    }
    return [ex, ey];
  };

  orc.leg = (V, hip, foot, pref, lo) => {
    const dir = foot[0] < 44 ? -1 : 1;
    const ank = [foot[0], foot[1] - 5];
    const [kx, ky] = joint(hip, ank, 14, 13, pref);
    V.capsule(hip[0], hip[1], kx, ky, 7.6, 5.6, ORC_SKIN, { lo });
    V.ball(kx, ky, 5, 4.4, ORC_SKIN, { lo, spec: 0.2 });
    V.capsule(kx, ky, ank[0], ank[1], 5.2, 4.2, ORC_SKIN, { lo });
    // shin wraps
    for (let t = 0.3; t < 0.8; t += 0.18) V.line(lerp(kx, ank[0], t) - 4, lerp(ky, ank[1], t), lerp(kx, ank[0], t) + 4, lerp(ky, ank[1], t) + 2, '#210');
    // ankle boots with fur cuff and an iron toe cap
    V.ball(foot[0] + dir * 2, foot[1] - 3, 7.2, 3.8, LEATHER, { lo: 1, hi: 5 - lo });
    V.capsule(ank[0] - 4.5, ank[1] - 0.5, ank[0] + 4.5, ank[1] - 0.5, 2, 2, R.fur, { lo: 1, hi: 6 - lo });
    V.ball(foot[0] + dir * 6, foot[1] - 2.5, 3, 2.4, IRON, { lo: 1, spec: 0.6 });
  };

  orc.draw = (S, q) => {
    const p = rig(orc.KEY, q);
    const T = Object.assign({ ax: 44, ay: 94 }, p.t);
    const V = view(S, T);
    const [px, py] = p.pelvis, [cx, cy] = p.chest, [hx, hy] = p.head;
    // the second hand rides the haft when two-handed (grip<0: explicit)
    const hL = p.grip ? [p.handR[0] + Math.cos(p.axe) * p.grip, p.handR[1] + Math.sin(p.axe) * p.grip] : p.handL;
    const two = p.grip !== 0;
    let tip = null;
    const axeDraw = VV => { tip = cleaverAxe(VV, p.handR[0], p.handR[1], p.axe, p.axeLen, p.axeSide, p.axeFs, p.spike); };
    if (!p.axeFront) layer(S, T, axeDraw, null);
    // legs
    orc.leg(V, [px - 8, py + 2], p.footL, [-1, -0.1], 0);
    orc.leg(V, [px + 8, py + 2], p.footR, [1, -0.1], 1);
    // studded leather strips hanging from the belt
    const strips = [[-15, 13, 0.75], [-9, 15, 0.6], [-3, 14, 0.5], [3, 15, 0.4], [9, 13, 0.3], [14, 12, 0.2]];
    for (const [ox, len, tn] of strips) {
      V.poly([[px + ox - 3, py - 1], [px + ox + 3, py - 1], [px + ox + 3, py + len], [px + ox, py + len + 1], [px + ox - 3, py + len]], LEATHER, { grad: [px + ox, py, px + ox, py + len, tn + 0.25, tn - 0.1], lo: 1 });
      V.line(px + ox + 3, py, px + ox + 3, py + len, '#100');
      V.px(px + ox, py + len - 3, '#9ab');
    }
    // ragged crimson loin-flap, matching the war paint
    V.poly([[px - 5, py - 1], [px + 5, py - 1], [px + 6, py + 17], [px + 3, py + 15], [px + 1, py + 20], [px - 2, py + 16], [px - 4, py + 19], [px - 6, py + 15]],
      R.crimson, { grad: [px - 5, py, px + 5, py + 18, 0.62, 0.12], lo: 1, hi: 6 });
    V.line(px + 5, py, px + 6, py + 16, '#200');
    // torso: gut, barrel chest, trapezius hump
    V.ball(px, py - 7, 15, 10, ORC_SKIN, { lo: 0.5 });
    V.ball(cx, cy, 19, 13.5, ORC_SKIN, { spec: 0.08 });
    V.ball(cx, cy - 9, 13, 7, ORC_SKIN);
    // pecs, sternum, abs
    V.line(cx - 13, cy + 3, cx - 2, cy + 6, '#222'); V.line(cx + 2, cy + 6, cx + 13, cy + 3, '#122');
    V.line(cx, cy - 3, cx, cy + 12, '#222');
    for (const yy of [10, 14]) { V.line(cx - 6, cy + yy, cx - 2, cy + yy, '#333'); V.line(cx + 2, cy + yy, cx + 6, cy + yy, '#222'); }
    V.px(cx - 8, cy - 2, '#676'); V.px(cx - 7, cy - 3, '#676');
    // old scar across the gut
    V.line(cx + 4, cy + 8, cx + 11, cy + 4, '#676'); V.line(cx + 4, cy + 9, cx + 11, cy + 5, '#222');
    // war paint: three red claw stripes over the left pec
    for (const ox of [-12, -8, -4]) {
      V.line(cx + ox, cy - 6, cx + ox + 3, cy + 3, '#a12'); V.line(cx + ox + 1, cy - 6, cx + ox + 4, cy + 3, '#c32');
    }
    // leather harness strap with studs + wide belt
    V.poly([[p.shR[0] - 3, p.shR[1] - 4], [p.shR[0] + 2, p.shR[1] - 2], [px - 11, py - 3], [px - 16, py - 5]], LEATHER, { tone: 0.55, lo: 1 });
    for (let t = 0.12; t < 1; t += 0.2) V.px(lerp(p.shR[0] - 1, px - 13, t), lerp(p.shR[1] - 3, py - 4, t), '#9ab');
    V.poly([[px - 17, py - 6], [px + 17, py - 6], [px + 17, py], [px - 17, py]], LEATHER, { grad: [px, py - 6, px, py, 0.65, 0.2], lo: 1 });
    V.line(px - 17, py - 6, px + 17, py - 6, '#531');
    // iron buckle cast as a crude skull
    V.ball(px, py - 3, 4.2, 3.6, 'steel', { lo: 1, hi: 7, spec: 0.6 });
    V.px(px - 2, py - 4, '#101'); V.px(px + 1, py - 4, '#101'); V.px(px - 1, py - 2, '#223'); V.px(px, py - 1, '#223');
    if (p.behind) {
      // arms raised with the hands hidden behind the head
      layer(S, T, VV => orc.arm(VV, p.shL, hL, p.elL, 0.3, false), '#122');
      layer(S, T, VV => orc.arm(VV, p.shR, p.handR, p.elR, 0.8, false), '#122');
      V.ball(hx, hy + 9, 9, 5, ORC_SKIN, { lo: 0.5 });          // thick neck in front of the arms
    }
    // head
    orc.head(V, hx, hy, p);
    // far arm, pauldron, axe, near arm
    const tgtL = p.gripSwap ? p.handR : hL, tgtR = p.gripSwap ? hL : p.handR;
    if (!p.behind) layer(S, T, VV => orc.arm(VV, p.shL, tgtL, p.elL, 0, q.hurt), '#122');
    layer(S, T, VV => {
      const [sx, sy] = p.shL;
      // crude iron pauldron: lames stepping down over the deltoid, one spike
      const ox = sx - 3, oy = sy + 1;
      VV.capsule(ox - 2, oy - 4, ox - 6, oy - 12, 2, 0.4, IRON, { lo: 2, spec: 0.9 });
      VV.ball(ox - 2, oy + 5, 8.5, 3.2, IRON, { lo: 1, hi: 5, rot: -0.3 });
      VV.ball(ox - 1, oy + 2, 9, 3.6, IRON, { lo: 1, hi: 6, rot: -0.3 });
      VV.ball(ox + 0.5, oy - 1.5, 8.5, 4.4, IRON, { lo: 1, hi: 8, rot: -0.3, spec: 0.5 });
      VV.line(ox - 8, oy + 2, ox + 7, oy - 3, '#111'); VV.line(ox - 9, oy + 5, ox + 6, oy + 0, '#111');
      for (const [rx, ry] of [[-5, -2], [0, -4], [5, -4], [-6, 3], [2, 1]]) VV.px(ox + rx, oy + ry, '#bbc');
      const r = U.rng(9);
      for (let i = 0; i < 14; i++) VV.px(ox - 8 + r() * 15, oy - 4 + r() * 10, r() < 0.5 ? '#731' : '#520');
    }, '#101');
    if (p.axeFront) layer(S, T, axeDraw, '#101');
    if (!p.behind) layer(S, T, VV => orc.arm(VV, p.shR, tgtR, p.elR, 0.6, false), '#122');
    if (two && !p.behind) layer(S, T, VV => fist(VV, tgtL[0], tgtL[1], 4.6, ORC_SKIN), '#122');
    S.outline(INK);
    if (p.smear && tip) {
      const X = (x, y) => T.ax + (x - T.ax) * T.k + T.dx + (T.ay - y) * T.sh, Y = (x, y) => T.ay + (y - T.ay) * T.k;
      for (const sm of [p.smear, p.smear2]) if (sm) smear(S, sm[0][0], sm[0][1], sm[1][0], sm[1][1], X(tip[0], tip[1]), Y(tip[0], tip[1]), 4);
    }
  };

  orc.portrait = S => {
    const p = OI(0, 0);
    const k = 0.78;
    const V = view(S, { ax: 0, ay: 0, k, dx: 12 - 44 * k, dy: 11 - 27 * k });
    V.ball(44, 46, 22, 12, ORC_SKIN);
    V.ball(44, 37, 13, 7, ORC_SKIN);
    V.ball(23, 40, 8.5, 4.4, IRON, { lo: 1, hi: 8, rot: -0.3, spec: 0.5 });
    orc.head(V, 44, 27, p);
    S.outline(INK);
  };

  E['Orc'] = {
    w: 88, h: 96, anchor: [44, 94], center: [44, 46], mouth: [44, 31],
    draw: orc.draw, portrait: orc.portrait,
  };

  // ===============================================================
  // SKELETON — M 88x96. Bones held together by cold dark magic;
  // tattered tabard, notched longsword.
  // ===============================================================
  const BONE = R.bone;
  const RAG = ['#001', '#102', '#112', '#213', '#224', '#335', '#446', '#557'];
  const skel = {};

  // Notched longsword. Grip (x,y), blade along ang, blade length len.
  const longsword = (V, x, y, ang, len, o = {}) => {
    const c = Math.cos(ang), s = Math.sin(ang), nx = -s, ny = c;
    const at = (t, w) => [x + c * t + nx * w, y + s * t + ny * w];
    const hw = o.hw || 2.2;
    // grip, pommel
    V.capsule(...at(-7, 0), ...at(-1, 0), 1.3, 1.3, LEATHER, { lo: 1, spec: 0.3 });
    V.ball(...at(-8, 0), 1.8, 1.8, 'steel', { lo: 2, spec: 0.8 });
    // blade halves: lit side + shadow side, then edge and fuller
    V.poly([at(2, 0), at(2, -hw), at(len * 0.85, -hw * 0.8), at(len, 0)], 'steel', { tone: 0.62, lo: 2 });
    V.poly([at(2, 0), at(len, 0), at(len * 0.85, hw * 0.8), at(2, hw)], 'steel', { tone: 0.32, lo: 1 });
    const f0 = at(4, 0), f1 = at(len * 0.7, 0);
    V.line(f0[0], f0[1], f1[0], f1[1], '#345');
    const e0 = at(3, -hw + 0.5), e1 = at(len * 0.82, -hw * 0.8 + 0.5);
    V.line(e0[0], e0[1], e1[0], e1[1], '#bcd');
    // notches
    for (const [t, sd] of [[0.38, -1], [0.55, 1], [0.7, -1]]) {
      const q = at(len * t, sd * hw * 0.9); V.erase(q[0], q[1]);
      const q2 = at(len * t + 1, sd * hw * 0.9); V.erase(q2[0], q2[1]);
    }
    // rust at the root
    const r = U.rng(31);
    for (let i = 0; i < 6; i++) { const q = at(3 + r() * len * 0.4, (r() - 0.5) * hw * 1.6); V.px(q[0], q[1], r() < 0.5 ? '#731' : '#520'); }
    // crossguard
    V.capsule(...at(0, -5), ...at(0, 5), 1.4, 1.4, 'steel', { lo: 1, hi: 7, spec: 0.7 });
    V.ball(...at(0, -5.5), 1.5, 1.5, 'steel', { lo: 2, spec: 0.6 }); V.ball(...at(0, 5.5), 1.5, 1.5, 'steel', { lo: 1, hi: 6 });
    return at(len, 0);
  };

  // A long bone: shaft with knobbly ends.
  const longBone = (V, a, b, r, o = {}) => {
    const lo = o.lo || 0;
    V.capsule(a[0], a[1], b[0], b[1], r, r * 0.85, BONE, { lo: 1 + lo, hi: 6.3, spec: 0.35 });
    V.ball(a[0], a[1], r * 1.6, r * 1.5, BONE, { lo: 1 + lo, hi: 6.5, spec: 0.35 });
    if (!o.noEnd) V.ball(b[0], b[1], r * 1.5, r * 1.4, BONE, { lo: 1 + lo, hi: 6.5, spec: 0.35 });
  };
  // Twin bones (forearm / shin).
  const twinBone = (V, a, b, r, o = {}) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, px = -dy / d * 1.1, py = dx / d * 1.1;
    const lo = o.lo || 0;
    V.capsule(a[0] - px, a[1] - py, b[0] - px * 0.6, b[1] - py * 0.6, r, r * 0.8, BONE, { lo: 1 + lo, hi: 7 });
    V.capsule(a[0] + px, a[1] + py, b[0] + px * 0.6, b[1] + py * 0.6, r * 0.9, r * 0.8, BONE, { lo: 1.5 + lo, hi: 6 });
  };
  // Bony hand: palm knot + splayed finger bones (or wrapped round a grip).
  const boneHand = (V, x, y, dirx, diry, grip, lo = 0) => {
    V.ball(x, y, 2.2, 2, BONE, { lo: 1 + lo, hi: 7 });
    if (grip) { V.ball(x + dirx * 1.5, y + diry * 1.5, 2.2, 2, BONE, { lo: 1 + lo, hi: 7, spec: 0.3 }); return; }
    const a = Math.atan2(diry, dirx);
    for (const da of [-0.55, -0.18, 0.18, 0.55]) {
      const fa = a + da;
      V.horn(x, y, x + Math.cos(fa) * 3.5, y + Math.sin(fa) * 3.5, x + Math.cos(fa + 0.5) * 5.5, y + Math.sin(fa + 0.5) * 5.5, 0.8, 0.5, BONE, { lo: 1 + lo, hi: 7 });
    }
  };

  const KI = (b, f) => ({
    t: { k: 1, dx: 0, dy: 0, sh: 0 },
    pelvis: [44, 62], chest: [44, 44 - b * 0.5], head: [44, 23 - b], skullOff: [0, 0], jaw: f === 3 ? 2 : 0.6,
    shL: [33, 36 - b * 0.5], shR: [55, 36 - b * 0.5],
    footL: [35, 92], footR: [54, 92],
    handL: [26, 60], handR: [62, 58 - b * 0.5], behind: false,
    elL: [-1, 0.3], elR: [1, 0.4],
    sword: -1.15 - b * 0.03, swordLen: 32, swordFront: true, twoHand: 0,
    glow: [1, 0.7, 0.9, 0.6][f], eyes: 1, tilt: 0,
  });
  skel.KEY = {
    idle: KI,
    windL: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: -2, dy: 0, sh: -0.07 },
        chest: [42, 44], head: [41, 23], tilt: -1,
        shL: [32, 36], shR: [52, 37],
        handR: [27, 31], twoHand: 6, elL: [-1, 0.6], elR: [0, 1],
        sword: -2.12, swordLen: 30, swordFront: false, jaw: 2.5,
      });
      return w < 1 ? half(I, full, { handR: [29, 44], sword: -1.95, swordLen: 31, elR: [0, 1], t: { k: 1, dx: -1, dy: 0, sh: -0.035 } }) : full;
    },
    windR: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: 2, dy: 0, sh: 0.07 },
        chest: [46, 44], head: [47, 23], tilt: 1,
        shL: [36, 37], shR: [56, 36],
        handR: [62, 32], twoHand: 6, elL: [0, 1], elR: [1, 0.6],
        sword: -1.02, swordLen: 30, swordFront: false, jaw: 2.5,
      });
      return w < 1 ? half(I, full, { handR: [61, 44], sword: -1.2, swordLen: 31, elL: [0, 1], t: { k: 1, dx: 1, dy: 0, sh: 0.035 } }) : full;
    },
    windH: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 0.92, dx: 0, dy: 0, sh: 0 },
        pelvis: [44, 61], chest: [44, 42], head: [44, 24],
        shL: [33, 34], shR: [55, 34],
        handR: [44, 12], twoHand: -4.5, elL: [-1, 0.1], elR: [1, 0.1],
        sword: -1.57, swordLen: 18, swordFront: false, jaw: 3,
      });
      return w < 1 ? half(I, full, { handR: [44, 14], swordLen: 12, sword: -1.57, t: { k: 0.97, dx: 0, dy: 0, sh: 0 } }) : full;
    },
    strikeL: (w, I) => Object.assign({}, I, {
      t: { k: 1.08, dx: 1, dy: 0, sh: 0.04 },
      pelvis: [44, 64], chest: [45, 47], head: [45, 27], tilt: 1,
      shL: [34, 39], shR: [56, 40],
      handR: [52, 58], twoHand: 6, elL: [-0.3, 1], elR: [1, 0.6],
      sword: 0.4, swordLen: 26, swordFront: true, jaw: 3,
      smear: [[8, 8], [-4, 50]],
    }),
    strikeR: (w, I) => Object.assign({}, I, {
      t: { k: 1.08, dx: -1, dy: 0, sh: -0.04 },
      pelvis: [44, 64], chest: [43, 47], head: [43, 27], tilt: -1,
      shL: [32, 40], shR: [54, 39],
      handR: [36, 58], twoHand: 6, elL: [-1, 0.6], elR: [0.3, 1],
      sword: 2.74, swordLen: 26, swordFront: true, jaw: 3,
      smear: [[80, 8], [92, 50]],
    }),
    strikeH: (w, I) => Object.assign({}, I, {
      t: { k: 1.08, dx: 0, dy: 0, sh: 0 },
      pelvis: [44, 64], chest: [44, 47], head: [44, 28],
      shL: [33, 40], shR: [55, 40],
      handR: [44, 47], twoHand: -5, elL: [-1, 0.4], elR: [1, 0.4],
      sword: 1.57, swordLen: 19, swordHw: 3.2, swordFront: true, jaw: 3,
      smear: [[30, -2], [24, 30]], smear2: [[58, -2], [64, 30]],
    }),
    hurt: (w, I) => Object.assign({}, I, {
      t: { k: 0.97, dx: 2, dy: 0, sh: -0.06 },
      chest: [45, 43], head: [47, 21], skullOff: [2, -2], tilt: 2, jaw: 4,
      shL: [34, 36], shR: [57, 37],
      handL: [20, 40], handR: [68, 52], elL: [-1, 0], elR: [1, 1],
      sword: -0.75, swordLen: 30, glow: 1.4, eyes: 2,
    }),
  };

  skel.skull = (V, x, y, p) => {
    const t = p.tilt || 0, jaw = p.jaw || 0;
    // mandible (hangs below, drawn first) with lower teeth
    V.poly([[x - 6, y + 3], [x + 6, y + 3], [x + 5.5, y + 6 + jaw], [x + 2.5, y + 9 + jaw], [x - 2.5, y + 9 + jaw], [x - 5.5, y + 6 + jaw]], BONE, { grad: [x - 5, y + 3, x + 5, y + 9, 0.75, 0.25], lo: 1, hi: 7 });
    V.line(x - 4, y + 5 + jaw, x + 4, y + 5 + jaw, '#101');
    for (let i = -3; i <= 3; i += 1.5) V.px(x + i, y + 4 + jaw, i === 0 ? '#998' : '#ddc');
    // cranium, brow ridge, cheekbones narrowing to the maxilla
    V.ball(x + t * 0.3, y - 3.5, 8, 7.6, BONE, { lo: 1, hi: 7.6, spec: 0.4 });
    V.poly([[x - 7.5, y - 1], [x + 7.5, y - 1], [x + 6.5, y + 2.5], [x + 3.5, y + 5], [x - 3.5, y + 5], [x - 6.5, y + 2.5]], BONE, { grad: [x - 6, y - 1, x + 6, y + 5, 0.72, 0.28], lo: 1, hi: 7 });
    V.line(x - 7, y + 1, x - 4, y + 3, '#554'); V.line(x + 7, y + 1, x + 4, y + 3, '#432');
    V.px(x - 6, y + 2, '#432'); V.px(x + 6, y + 2, '#221'); V.px(x + 5, y + 3, '#221');
    // deep, slanted eye sockets with cold pinpoint lights
    for (const sx of [-1, 1]) {
      const ex = x + sx * 3.3 + t * 0.4, ey = y - 1;
      V.poly([[ex - 2.6, ey - 2 + (sx > 0 ? 1 : 0)], [ex + 2.6, ey - 2 + (sx < 0 ? 1 : 0)], [ex + 2.2, ey + 1.6], [ex - 2.2, ey + 1.6]], ['#101'], { tone: 0 });
      V.px(ex - sx * 1.6, ey - 2.5 + (sx > 0 ? 1 : 0), '#776');
      if (p.eyes) {
        const big = p.eyes > 1;
        V.px(ex, ey, big ? '#eff' : '#bef'); V.px(ex - 1, ey, '#37a'); V.px(ex, ey + 1, '#125');
        if (big) { V.px(ex + 1, ey, '#5ac'); V.px(ex, ey - 1, '#5ac'); }
      }
    }
    // nasal cavity
    const nx = x + t * 0.4;
    V.px(nx - 1, y + 2, '#101'); V.px(nx, y + 2, '#101'); V.px(nx, y + 3, '#101'); V.px(nx - 1, y + 3, '#101'); V.px(nx - 1, y + 1, '#432');
    // upper teeth, long and gapped
    V.line(x - 4, y + 5, x + 4, y + 5, '#101');
    for (let i = -3.5; i <= 3.5; i += 1.5) { V.px(x + i, y + 4, '#ddc'); V.px(x + i, y + 5, i < 0 ? '#bba' : '#998'); }
    // crack across the cranium
    V.line(x + 2, y - 11, x + 3, y - 7, '#432'); V.line(x + 3, y - 7, x + 5, y - 6, '#432');
  };

  skel.draw = (S, q) => {
    const p = rig(skel.KEY, q);
    const T = Object.assign({ ax: 44, ay: 94 }, p.t);
    const V = view(S, T);
    const [px, py] = p.pelvis, [cx, cy] = p.chest, [hx, hy] = p.head;
    const hL = p.twoHand ? [p.handR[0] + Math.cos(p.sword) * p.twoHand, p.handR[1] + Math.sin(p.sword) * p.twoHand] : p.handL;
    let tip = null;
    const swordDraw = VV => { tip = longsword(VV, p.handR[0], p.handR[1], p.sword, p.swordLen, { hw: p.swordHw }); };
    if (!p.swordFront) layer(S, T, swordDraw, null);

    // legs: far details first
    for (const [sd, foot, lo] of [[-1, p.footL, 0], [1, p.footR, 0.6]]) {
      const hip = [px + sd * 5, py + 2], ank = [foot[0], foot[1] - 3];
      const [kx, ky] = joint(hip, ank, 15, 14, [sd, -0.15]);
      longBone(V, hip, [kx, ky], 1.8, { lo });
      twinBone(V, [kx, ky + 1], ank, 1.1, { lo });
      V.ball(kx, ky, 2.4, 2.2, BONE, { lo: 1 + lo, hi: 8, spec: 0.4 });         // kneecap
      V.ball(ank[0] + sd, ank[1] + 1, 2.2, 1.6, BONE, { lo: 1 + lo, hi: 7 });
      for (const d of [0, 2, 4]) V.line(ank[0] + sd * (d * 0.5 + 1), ank[1] + 2, ank[0] + sd * (d + 2), foot[1], d === 4 ? '#776' : '#bba');
    }
    // pelvis: iliac wings with dark hollows, sacrum, pubic arch
    V.ellipse(px, py, 7, 3.5, '#101');                                  // pelvic cavity
    for (const sd of [-1, 1]) {
      V.poly([[px + sd * 2.5, py + 2], [px + sd * 2, py - 2], [px + sd * 6, py - 5], [px + sd * 9.5, py - 4.5], [px + sd * 9, py - 1], [px + sd * 6, py + 2.5]],
        BONE, { grad: [px + sd * 9, py - 5, px + sd * 3, py + 2, sd < 0 ? 0.8 : 0.55, 0.3], lo: 1, hi: 7 });
      V.line(px + sd * 3, py - 2, px + sd * 8, py - 4, sd < 0 ? '#ddc' : '#998');   // iliac crest
    }
    V.tri([px - 1.8, py - 3.5], [px + 1.8, py - 3.5], [px, py + 2.5], BONE, { tone: 0.5, lo: 1, hi: 7 });   // sacrum
    // ragged tabard hanging from a rope belt
    V.poly([[px - 4.5, py + 1], [px + 4.5, py + 1], [px + 5, py + 14], [px + 3, py + 11], [px + 2, py + 19], [px - 1, py + 13], [px - 3, py + 17], [px - 5, py + 12]],
      RAG, { grad: [px - 5, py + 1, px + 5, py + 16, 0.85, 0.2], lo: 1 });
    V.ellipse(px + 2, py + 8, 1.2, 1.6, 0); V.erase(px - 2, py + 5);
    V.poly([[px - 5, py + 4], [px - 5, py + 1], [px + 5, py + 9], [px + 5, py + 12]], RAG, { tone: 0.85, lo: 2, hi: 7,
      clip: (x, y) => S.opaque(x, y) });                                 // faded heraldic bend
    V.px(px - 1, py + 1, '#a70'); V.px(px, py + 1, '#750');             // tarnished brooch
    V.capsule(px - 9, py + 1, px + 9, py + 1, 1, 1, R.wood, { lo: 1, hi: 5 });
    for (let i = -8; i <= 8; i += 2) V.px(px + i, py + 1, '#310');
    // lumbar spine
    for (let i = 0; i < 4; i++) {
      const yy = lerp(cy + 11, py - 4, i / 3), xx = lerp(cx, px, i / 3);
      V.ball(xx, yy, 2.3, 1.5, BONE, { lo: 1, hi: 7, spec: 0.2 });
    }
    // ribcage: dark cavity, back ribs, the cold magic inside, front ribs, sternum
    V.ball(cx, cy + 1, 10.5, 10.5, ['#101', '#102', '#112', '#113'], { lo: 0, hi: 2 });
    for (let i = 0; i < 4; i++) {
      const ry = cy - 5 + i * 4.2;
      for (const sd of [-1, 1]) V.horn(cx, ry + 2, cx + sd * 6, ry + 1, cx + sd * 9, ry + 4, 0.8, 0.6, BONE, { lo: 1, hi: 2.5 });
    }
    V.capsule(cx, cy - 10, cx, cy + 11, 1.2, 1.2, BONE, { lo: 1, hi: 3.5 });   // spine behind
    const g = p.glow || 0;
    if (g > 0) {
      const gx = Math.round(V.X(cx, cy + 1)), gy = Math.round(V.Y(cx, cy + 1));
      for (let j = -7; j <= 7; j++) for (let i = -7; i <= 7; i++) {
        const d = Math.hypot(i, j * 1.1) / (3.4 + g * 2.6);
        if (d >= 1 || !S.opaque(gx + i, gy + j)) continue;
        const v = (1 - d) * g;
        if (v > P.thresh(gx + i, gy + j) * 1.1) S.set(gx + i, gy + j, v > 0.8 ? '#8de' : v > 0.5 ? '#37a' : v > 0.25 ? '#125' : '#113');
      }
    }
    for (let i = 0; i < 5; i++) {
      const ry = cy - 8 + i * 4, wv = [0, 1.2, 1.8, 1.4, 0][i];
      for (const sd of [-1, 1]) {
        V.horn(cx + sd * 1.6, ry, cx + sd * (7 + wv), ry - 1.6, cx + sd * (10 + wv - (i === 4 ? 2 : 0)), ry + 3, 1, 0.75, BONE, { lo: sd > 0 ? 1.6 : 1, hi: 7.2, spec: 0.35 });
      }
    }
    V.capsule(cx, cy - 9, cx, cy + 5, 1.3, 1, BONE, { lo: 1, hi: 7.4, spec: 0.3 });   // sternum
    // clavicles + shoulder knobs
    V.capsule(cx - 1.5, cy - 9, p.shL[0], p.shL[1], 1.1, 1, BONE, { lo: 1, hi: 8 });
    V.capsule(cx + 1.5, cy - 9, p.shR[0], p.shR[1], 1.1, 1, BONE, { lo: 1.5, hi: 7 });
    // neck vertebrae
    for (let i = 0; i < 3; i++) V.ball(lerp(cx, hx, 0.25 + i * 0.22), lerp(cy - 10, hy + 7, 0.1 + i * 0.3), 1.8, 1.3, BONE, { lo: 1, hi: 7 });
    // tattered scrap of cloth over the left shoulder
    V.poly([[p.shL[0] - 4, p.shL[1] - 2], [p.shL[0] + 4, p.shL[1] - 3], [p.shL[0] + 3, p.shL[1] + 6], [p.shL[0] + 1, p.shL[1] + 4], [p.shL[0] - 1, p.shL[1] + 9], [p.shL[0] - 3, p.shL[1] + 5], [p.shL[0] - 5, p.shL[1] + 6]],
      RAG, { grad: [p.shL[0] - 4, p.shL[1] - 3, p.shL[0] + 3, p.shL[1] + 8, 0.9, 0.3], lo: 1 });
    if (p.behind) {
      layer(S, T, VV => {
        for (const [sh, hand, pref, lo] of [[p.shL, p.handL, p.elL, 0], [p.shR, p.handR, p.elR, 0.5]]) {
          const [ex, ey] = joint(sh, hand, 13, 12, pref);
          longBone(VV, sh, [ex, ey], 1.5, { lo });
          twinBone(VV, [ex, ey], hand, 0.9, { lo });
          VV.ball(ex, ey, 1.9, 1.8, BONE, { lo: 1 + lo, hi: 8, spec: 0.4 });
        }
      }, '#101');
    }
    // skull
    skel.skull(V, hx + p.skullOff[0], hy + p.skullOff[1], p);
    // arms
    const arm = (VV, sh, hand, pref, lo, grip, hdir) => {
      const [ex, ey] = joint(sh, hand, 13, 12, pref);
      longBone(VV, sh, [ex, ey], 1.5, { lo });
      twinBone(VV, [ex, ey], hand, 0.9, { lo });
      VV.ball(ex, ey, 1.9, 1.8, BONE, { lo: 1 + lo, hi: 8, spec: 0.4 });
      boneHand(VV, hand[0], hand[1], hdir[0], hdir[1], grip, lo);
    };
    if (!p.behind) layer(S, T, VV => arm(VV, p.shL, hL, p.elL, 0, !!p.twoHand, [-0.3, 1]), '#101');
    if (p.swordFront) layer(S, T, swordDraw, '#101');
    if (!p.behind) layer(S, T, VV => arm(VV, p.shR, p.handR, p.elR, 0.5, true, [0.3, 1]), '#101');
    S.speckle(0, 0, S.w, S.h, 0.07, h => (h === '#ddc' || h === '#bba') ? '#998' : h === '#ffe' ? '#ddc' : h, 41);
    S.outline(INK);
    if (p.smear && tip) {
      for (const sm of [p.smear, p.smear2]) if (sm) smear(S, sm[0][0], sm[0][1], sm[1][0], sm[1][1], V.X(tip[0], tip[1]), V.Y(tip[0], tip[1]), 3.5);
    }
  };

  skel.portrait = S => {
    const p = KI(0, 0);
    const k = 0.95;
    const V = view(S, { ax: 0, ay: 0, k, dx: 12 - 44 * k, dy: 11 - 23 * k });
    V.ball(44, 41, 10, 9, ['#101', '#102', '#112'], { lo: 0, hi: 2 });
    for (let i = 0; i < 2; i++) for (const sd of [-1, 1]) V.horn(44 + sd * 1.5, 36 + i * 3.3, 44 + sd * 7, 34.5 + i * 3.3, 44 + sd * 10, 39 + i * 3.3, 1.1, 0.8, BONE, { lo: 1, hi: 8 });
    V.capsule(42, 35, 31, 36, 1.1, 1, BONE, { lo: 1, hi: 8 }); V.capsule(46, 35, 57, 36, 1.1, 1, BONE, { lo: 1.5, hi: 7 });
    V.ball(31, 37, 3, 3, BONE, { lo: 1, hi: 8 }); V.ball(57, 37, 3, 3, BONE, { lo: 1.5, hi: 7 });
    skel.skull(V, 44, 23, p);
    S.outline(INK);
  };

  E['Skeleton'] = {
    w: 88, h: 96, anchor: [44, 94], center: [44, 46], mouth: [44, 28],
    draw: skel.draw, portrait: skel.portrait,
  };

  // ===============================================================
  // KOBOLD — S 64x56. Small, scaly, shifty; a notched rusty blade.
  // ===============================================================
  const KOB = ['#101', '#201', '#311', '#520', '#731', '#942', '#b63', '#d84'];
  const BELLY = ['#210', '#431', '#642', '#853', '#a74', '#c95', '#db8'];
  const kob = {};

  // Crude, notched, rusty short blade. Grip (x,y), along ang, blade length len.
  const rustBlade = (V, x, y, ang, len, fs = 1) => {
    const c = Math.cos(ang), s = Math.sin(ang), nx = -s, ny = c;
    const at = (t, w) => [x + c * t + nx * w, y + s * t + ny * w];
    const hw = 1.9 * fs;
    V.capsule(...at(-5, 0), ...at(-1, 0), 1.1, 1.1, LEATHER, { lo: 2, spec: 0.3 });
    V.ball(...at(-5.5, 0), 1.3, 1.3, IRON, { lo: 2 });
    V.poly([at(1, 0), at(1, -hw), at(len * 0.8, -hw), at(len, 0.3)], IRON, { tone: 0.72, lo: 2, hi: 8 });
    V.poly([at(1, 0), at(len, 0.3), at(len * 0.75, hw), at(1, hw)], IRON, { tone: 0.38, lo: 1, hi: 7 });
    const e0 = at(2, -hw + 0.6), e1 = at(len * 0.78, -hw + 0.6);
    V.line(e0[0], e0[1], e1[0], e1[1], '#bbc');
    for (const t of [0.35, 0.62]) { const q = at(len * t, -hw); V.erase(q[0], q[1]); }
    const q3 = at(len * 0.5, hw); V.erase(q3[0], q3[1]);
    const r = U.rng(5);
    for (let i = 0; i < 7; i++) { const q = at(2 + r() * len * 0.8, (r() - 0.4) * hw * 1.4); V.px(q[0], q[1], r() < 0.5 ? '#731' : '#942'); }
    V.capsule(...at(0, -3), ...at(0, 3), 1, 1, IRON, { lo: 2, hi: 7, spec: 0.6 });
    return at(len, 0);
  };

  const BI = (b, f) => ({
    t: { k: 1, dx: 0, dy: 0, sh: 0 },
    pelvis: [32, 40], chest: [32, 31 - b * 0.6], head: [29, 18 - b], open: 0, behind: false,
    shL: [25, 26 - b * 0.6], shR: [39, 26 - b * 0.6],
    footL: [23, 53], footR: [41, 53],
    handL: [22, 30 - b], handR: [44, 39 - b * 0.5],
    elL: [-1, 0.6], elR: [1, 0.4],
    blade: -0.8, bladeLen: 15, bladeFs: 1.15, bladeFront: true, twoHand: 0,
    tail: [[58, 52], [59, 38 + [0, -1, -2, -1][f]]], look: [-1, 0, 1, 0][f], eyes: 1,
  });
  kob.KEY = {
    idle: BI,
    windL: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: -1, dy: 0, sh: -0.08 },
        chest: [31, 30], head: [27, 16], look: -1,
        shL: [24, 25], shR: [36, 26],
        handR: [17, 16], handL: [22, 21], twoHand: 0, elL: [-1, 0.6], elR: [0, 1],
        blade: -2.2, bladeLen: 14, bladeFront: false, open: 1,
        tail: [[56, 44], [57, 30]],
      });
      return w < 1 ? half(I, full, { handR: [22, 26], blade: -1.95, elR: [0, 1], t: { k: 1, dx: -1, dy: 0, sh: -0.04 } }) : full;
    },
    windR: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: 1, dy: 0, sh: 0.08 },
        chest: [33, 30], head: [31, 16], look: 1,
        shL: [27, 26], shR: [40, 25],
        handR: [48, 14], handL: [20, 30], elL: [-1, 0.6], elR: [1, 0.3],
        blade: -1.05, bladeLen: 14, bladeFront: false, open: 1,
        tail: [[50, 52], [57, 40]],
      });
      return w < 1 ? half(I, full, { handR: [47, 24], blade: -0.85 }) : full;
    },
    windH: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: 0, dy: 0, sh: 0 },
        pelvis: [32, 40], chest: [32, 30], head: [29, 20], look: 0,
        shL: [23, 25], shR: [41, 25],
        handR: [41, 8], handL: [22, 8], elL: [-1, 0], elR: [1, 0], behind: true,
        blade: Math.PI, bladeLen: 16, bladeFs: 1.2, bladeFront: true, open: 1,
        tail: [[56, 46], [56, 28]],
      });
      return w < 1 ? half(I, full, { handR: [42, 13], handL: [21, 13], blade: Math.PI, bladeLen: 16, bladeFront: true, behind: true }) : full;
    },
    strikeL: (w, I) => Object.assign({}, I, {
      t: { k: 1.1, dx: 1, dy: 0, sh: 0.05 },
      pelvis: [32, 41], chest: [33, 32], head: [31, 19], look: 0,
      shL: [26, 27], shR: [40, 27],
      handR: [38, 39], handL: [21, 34], elL: [-1, 0.5], elR: [1, 0.6],
      blade: 0.25, bladeLen: 14, bladeFs: 1.3, bladeFront: true, open: 1,
      smear: [[6, 8], [0, 40]], tail: [[54, 50], [55, 38]],
    }),
    strikeR: (w, I) => Object.assign({}, I, {
      t: { k: 1.1, dx: -1, dy: 0, sh: -0.05 },
      pelvis: [32, 41], chest: [31, 32], head: [28, 19], look: 0,
      shL: [24, 27], shR: [38, 27],
      handR: [27, 38], handL: [20, 33], elL: [-1, 0.5], elR: [0.2, 1],
      blade: 2.9, bladeLen: 14, bladeFs: 1.3, bladeFront: true, open: 1,
      smear: [[58, 6], [64, 36]], tail: [[54, 50], [55, 38]],
    }),
    strikeH: (w, I) => Object.assign({}, I, {
      t: { k: 1.12, dx: 0, dy: 0, sh: 0 },
      pelvis: [32, 42], chest: [32, 33], head: [30, 21], look: 0,
      shL: [25, 28], shR: [39, 28],
      handR: [40, 39], handL: [25, 40], elL: [-0.6, 1], elR: [0.6, 1],
      blade: Math.PI + 0.06, bladeLen: 16, bladeFs: 1.3, bladeFront: true, open: 1,
      smear: [[22, -2], [16, 20]], smear2: [[44, -2], [50, 20]],
      tail: [[54, 50], [55, 38]],
    }),
    hurt: (w, I) => Object.assign({}, I, {
      t: { k: 0.96, dx: 2, dy: 0, sh: -0.07 },
      chest: [33, 30], head: [32, 17], look: 0, eyes: 0, open: 1,
      shL: [26, 25], shR: [40, 26],
      handL: [24, 14], handR: [49, 30], elL: [-1, 0.8], elR: [1, 0.6],
      blade: -0.2, bladeLen: 12,
      tail: [[56, 48], [60, 42]],
    }),
  };

  // Scaly texture: a staggered grid of darker scale-edges over the rust ramp.
  const scales = (S, test) => {
    const dk = shifter(KOB, -1), lt = shifter(KOB, 1);
    S.recolor((x, y) => test(x, y) && ((x + ((y >> 1) & 1) * 2) & 3) === 0 && (y & 1) === 0, h => dk(h));
    S.recolor((x, y) => test(x, y) && ((x + 1 + ((y >> 1) & 1) * 2) & 3) === 0 && (y & 1) === 1 && y % 4 === 1, h => lt(h));
  };

  kob.head = (V, x, y, p) => {
    const op = p.open || 0, lk = p.look || 0;
    // backswept horns (far one darker), drawn behind the skull
    V.horn(x + 5, y - 3, x + 9, y - 6, x + 13, y - 7, 1.4, 0.5, BONE, { lo: 1, hi: 5 });
    V.horn(x + 2, y - 4, x + 5, y - 9, x + 10, y - 11, 1.8, 0.5, BONE, { lo: 2, hi: 7, spec: 0.4 });
    // spiny frill at the back of the head
    for (const [a, b2] of [[[x + 6, y - 1], [x + 10, y - 2]], [[x + 6, y + 2], [x + 10, y + 2]]]) V.capsule(a[0], a[1], b2[0], b2[1], 1.3, 0.4, KOB, { lo: 1, hi: 5 });
    // lower jaw (drops when open)
    V.capsule(x + 1, y + 4, x - 8, y + 6 + op * 3, 2.6, 1.7, KOB, { lo: 1, hi: 5 });
    if (op) { V.capsule(x, y + 4.5, x - 7, y + 5.5 + op * 1.5, 1.5, 1, ['#101', '#301', '#502'], { lo: 0, hi: 2 }); }
    // cranium + snout
    V.ball(x + 1, y - 1, 7.4, 6.2, KOB, { spec: 0.35 });
    V.capsule(x - 1, y + 1.5, x - 9, y + 3.5, 4, 2.6, KOB, { spec: 0.3 });
    // nostrils, brow ridge
    V.px(x - 10, y + 2, '#101'); V.px(x - 8, y + 1, '#311');
    V.line(x - 5, y - 4, x - 1, y - 3, '#311'); V.line(x + 2, y - 3, x + 5, y - 4, '#311');
    // mouth line with needle teeth
    V.line(x - 10, y + 5, x + 2, y + 4, '#101');
    V.line(x + 2, y + 4, x + 4, y + 2, '#101');                         // sly upturned corner
    for (const tx of [-9, -7, -5, -3, -1]) V.px(x + tx, y + 6, tx === -1 ? '#bba' : '#ddc');
    V.px(x + 3, y + 3, '#ddc');
    if (op) for (const tx of [-8, -5, -2]) V.px(x + tx, y + 6 + op * 2, '#bba');
    // eyes: yellow with a black slit that darts about
    if (p.eyes) {
      V.ellipse(x - 2.5, y - 1, 2.2, 1.6, '#101');
      V.px(x - 4, y - 1, '#ca2'); V.px(x - 3, y - 1, '#fd5'); V.px(x - 2, y - 1, '#fd5'); V.px(x - 1, y - 1, '#ca2');
      V.px(x - 3, y - 2, '#fe8'); V.px(x - 2, y - 2, '#ca2');
      V.px(x - 3 + lk, y - 1, '#101'); V.px(x - 3 + lk, y - 2, '#101');
      V.px(x + 4, y - 1, '#ca2'); V.px(x + 5, y - 1, '#a70'); V.px(x + 4 + (lk > 0 ? 1 : 0), y - 1, '#101');
    } else {
      V.line(x - 5, y - 1, x - 1, y - 2, '#101'); V.line(x + 3, y - 2, x + 5, y - 1, '#101');
    }
  };

  kob.draw = (S, q) => {
    const p = rig(kob.KEY, q);
    const T = Object.assign({ ax: 32, ay: 54 }, p.t);
    const V = view(S, T);
    const [px, py] = p.pelvis, [cx, cy] = p.chest, [hx, hy] = p.head;
    let tip = null;
    const bladeDraw = VV => { tip = rustBlade(VV, p.handR[0], p.handR[1], p.blade, p.bladeLen, p.bladeFs); };
    const hL = p.twoHand ? [p.handR[0] + Math.cos(p.blade) * p.twoHand, p.handR[1] + Math.sin(p.blade) * p.twoHand] : p.handL;
    if (!p.bladeFront) layer(S, T, bladeDraw, null);
    // tail, behind everything
    const [tc, tt] = p.tail;
    V.horn(px + 4, py + 1, tc[0], tc[1], tt[0], tt[1], 3.6, 0.8, KOB, { lo: 0.5, hi: 6 });
    // legs: digitigrade, far leg darker
    for (const [sd, foot, lo] of [[1, p.footR, 1], [-1, p.footL, 0]]) {
      const hip = [px + sd * 4, py + 1];
      const knee = [px + sd * 8, py + 6];
      const ank = [foot[0] - sd * 0.5, foot[1] - 4];
      V.capsule(hip[0], hip[1], knee[0], knee[1], 3.6, 2.6, KOB, { lo });
      V.capsule(knee[0], knee[1], ank[0], ank[1], 2.4, 1.6, KOB, { lo });
      V.capsule(ank[0], ank[1], foot[0] + sd * 2, foot[1] - 1, 1.8, 1.6, KOB, { lo });
      for (const d of [-1, 1, 3]) V.px(foot[0] + sd * (2 + d), foot[1], '#ddc');
    }
    // torso + pale banded belly
    V.ball(cx, cy, 7.4, 8.6, KOB, { spec: 0.15 });
    V.ball(lerp(cx, px, 0.5), lerp(cy, py, 0.5), 6, 5.5, KOB, { lo: 0.5 });
    V.ball(cx - 1, cy + 2.5, 4.4, 6.4, BELLY, { lo: 1, spec: 0.1 });
    for (let yy = -2; yy <= 7; yy += 2) V.line(cx - 4, cy + yy + 0.5, cx + 2, cy + yy + 0.5, '#642');
    // ragged loincloth on a cord
    V.poly([[px - 6, py - 1], [px + 6, py - 1], [px + 5, py + 6], [px + 2, py + 4], [px, py + 8], [px - 2, py + 5], [px - 5, py + 7]], R.sand, { grad: [px - 5, py - 1, px + 5, py + 7, 0.7, 0.15], lo: 1, hi: 7 });
    V.line(px - 6, py - 1, px + 6, py - 1, '#310');
    V.px(px - 3, py - 1, '#ddc'); V.px(px - 3, py, '#bba');            // bone fetish on the cord
    // arms: thin, clawed
    const arm = (VV, sh, hand, pref, lo, claws) => {
      const [ex, ey] = joint(sh, hand, 9, 8.5, pref);
      VV.capsule(sh[0], sh[1], ex, ey, 2.4, 1.8, KOB, { lo });
      VV.capsule(ex, ey, hand[0], hand[1], 1.8, 1.5, KOB, { lo });
      VV.ball(hand[0], hand[1], 2.1, 2, KOB, { lo, spec: 0.3 });
      if (claws) for (const [dx, dy] of claws) VV.px(hand[0] + dx, hand[1] + dy, '#ddc');
    };
    if (p.behind) {
      layer(S, T, VV => { arm(VV, p.shL, p.handL, p.elL, 0.3, null); arm(VV, p.shR, p.handR, p.elR, 0.6, null); }, '#201');
    }
    scales(S, (x, y) => true);
    kob.head(V, hx, hy, p);
    if (p.behind) {
      if (p.bladeFront) layer(S, T, bladeDraw, '#101');
      for (const h of [p.handL, p.handR]) layer(S, T, VV => VV.ball(h[0], h[1], 2.3, 2.1, KOB, { spec: 0.3 }), '#201');
      S.outline(INK);
      return;
    }
    const clawUp = p.handL[1] < p.shL[1] ? [[-2, -2], [0, -3], [2, -2]] : [[-2, 2], [0, 3], [2, 2]];
    layer(S, T, VV => arm(VV, p.shL, hL, p.elL, 0, p.twoHand ? null : clawUp), '#201');
    if (p.bladeFront && !p.ice) layer(S, T, bladeDraw, '#101');
    layer(S, T, VV => arm(VV, p.shR, p.handR, p.elR, 0.6, null), '#201');
    if (p.bladeFront && p.ice) layer(S, T, bladeDraw, '#101');
    S.outline(INK);
    if (p.smear && tip) {
      for (const sm of [p.smear, p.smear2]) if (sm) smear(S, sm[0][0], sm[0][1], sm[1][0], sm[1][1], V.X(tip[0], tip[1]), V.Y(tip[0], tip[1]), 2.5);
    }
  };

  kob.portrait = S => {
    const p = BI(0, 0);
    const k = 1.15;
    const V = view(S, { ax: 0, ay: 0, k, dx: 12 - 30 * k, dy: 11 - 16 * k });
    V.ball(32, 30, 7.4, 8.6, KOB);
    V.ball(31, 32, 4.4, 6.4, BELLY, { lo: 1 });
    V.ball(25, 26, 3, 3, KOB); V.ball(39, 26, 3, 3, KOB, { lo: 0.6 });
    scales(S, (x, y) => true);
    kob.head(V, 30, 16, Object.assign(p, { look: -1 }));
    S.outline(INK);
  };

  E['Kobold'] = {
    w: 64, h: 56, anchor: [32, 54], center: [32, 30], mouth: [21, 22],
    draw: kob.draw, portrait: kob.portrait,
  };

  // ===============================================================
  // GIANT RAT — S 64x56. Bloated, mangy sewer rat; festering bite.
  // ===============================================================
  const RFUR = ['#101', '#211', '#212', '#322', '#433', '#543', '#654', '#765', '#987', '#ba9'];
  const PINK = ['#201', '#412', '#723', '#944', '#b65', '#d97', '#eca'];
  const rat = {};

  const RI = (b, f) => ({
    t: { k: 1, dx: 0, dy: 0, sh: 0 },
    rump: [40, 35 - b * 0.5], chest: [27, 38 - b], head: [22, 28 - b], hTurn: 1,
    pawL: [17, 53], pawR: [31, 53], hind: [49, 53], hindFar: [37, 53],
    tail: [[59, 53], [59, 40], [54 + [0, 1, 0, -1][f], 31 - [0, 1, 2, 1][f]]],
    mouth: f === 2 ? 0.3 : 0, eyes: 1, rear: 0, big: 1,
  });
  rat.KEY = {
    idle: RI,
    windL: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: -1, dy: 0, sh: -0.05 },
        rump: [39, 38], chest: [28, 29], head: [25, 18], rear: 1, hTurn: 0.8,
        pawL: [11, 11], pawR: [33, 40],
        tail: [[59, 53], [59, 42], [55, 34]], mouth: 0.7,
      });
      return w < 1 ? half(I, full, { pawL: [11, 25], mouth: 0.4 }) : full;
    },
    windR: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: 1, dy: 0, sh: 0.05 },
        rump: [37, 38], chest: [29, 29], head: [25, 18], rear: 1, hTurn: 1.6,
        pawL: [21, 40], pawR: [50, 11],
        tail: [[57, 53], [58, 44], [54, 37]], mouth: 0.7,
      });
      return w < 1 ? half(I, full, { pawR: [47, 25], mouth: 0.4 }) : full;
    },
    windH: (w, I) => {
      const full = Object.assign({}, I, {
        rump: [35, 39], chest: [32, 27], head: [31, 14], rear: 2, hTurn: 1.8,
        pawL: [20, 9], pawR: [44, 8], hind: [46, 53], hindFar: [25, 53],
        tail: [[56, 53], [59, 45], [55, 38]], mouth: 1.2,
      });
      return w < 1 ? half(I, full, { pawL: [19, 20], pawR: [43, 19], mouth: 0.8, rear: 1.5, head: [27, 20] }) : full;
    },
    strikeL: (w, I) => Object.assign({}, I, {
      t: { k: 1.08, dx: 1, dy: 0, sh: 0.03 },
      rump: [41, 37], chest: [29, 39], head: [26, 32], hTurn: 1.8,
      pawL: [19, 47], pawR: [36, 53], mouth: 1, tail: [[57, 53], [57, 40], [52, 32]], pawFront: 'L',
      smear: [[9, 6], [4, 42], 'pawL'],
    }),
    strikeR: (w, I) => Object.assign({}, I, {
      t: { k: 1.08, dx: -2, dy: 0, sh: -0.03 },
      rump: [40, 37], chest: [27, 39], head: [23, 32], hTurn: 0.5,
      pawL: [14, 53], pawR: [34, 47], mouth: 1, pawFront: 'R',
      smear: [[55, 4], [62, 40], 'pawR'],
    }),
    strikeH: (w, I) => Object.assign({}, I, {
      t: { k: 1.1, dx: 1, dy: 0, sh: 0 },
      rump: [40, 37], chest: [30, 40], head: [29, 31], hTurn: 1.8, big: 1.35,
      pawL: [16, 50], pawR: [42, 50], mouth: 1.15, tail: [[57, 53], [57, 40], [52, 32]],
      smear: [[20, -2], [14, 20], 'head'], smear2: [[40, -2], [46, 20], 'head'],
    }),
    hurt: (w, I) => Object.assign({}, I, {
      t: { k: 0.96, dx: 2, dy: 0, sh: -0.06 },
      rump: [41, 37], chest: [30, 35], head: [28, 24], hTurn: 1.5, rear: 0.5,
      pawL: [20, 38], pawR: [35, 40], mouth: 0.9, eyes: 0,
      tail: [[62, 49], [61, 33], [58, 25]],
    }),
  };

  rat.head = (V, x, y, p) => {
    const t = p.hTurn || 0, m = p.mouth || 0, g = p.big || 1;
    // the muzzle points down-left; as t grows the head turns toward us
    const nx = x + (-5 + t * 2) * g, ny = y + (8.5 - t * 0.4) * g;
    // ears: cupped, pink inside; far ear first
    V.ball(x + 7 * g, y - 6 * g, 4.2 * g, 4.6 * g, RFUR, { lo: 1, hi: 6 });
    V.ball(x + 7.4 * g, y - 5.5 * g, 2.7 * g, 3 * g, PINK, { lo: 1, hi: 4 });
    V.ball(x - 6 * g, y - 6.5 * g, 4.6 * g, 4.8 * g, RFUR, { lo: 1, hi: 8 });
    V.ball(x - 6.3 * g, y - 6 * g, 3 * g, 3.2 * g, PINK, { lo: 1, hi: 5 });
    // skull + puffy cheeks, then the long tapering muzzle
    V.ball(x + 0.5 * g, y - 1 * g, 8.2 * g, 6.6 * g, RFUR, { spec: 0.1 });
    V.ball(x - 0.5 * g + t * 0.4, y + 3 * g, 7.2 * g, 4.8 * g, RFUR);
    V.capsule(x - 0.5 * g + t * 0.6, y + 2.5 * g, nx, ny - 1 * g, 4.6 * g, 2.2 * g, RFUR, { spec: 0.25 });
    // mouth
    if (m > 0) {
      const my = ny + (2.5 + m * 1.5) * g;
      V.ellipse(nx, my, 3 * g, (1.2 + m * 1.9) * g, '#101');
      V.ellipse(nx, my + 0.5 * g, 1.8 * g, (0.6 + m * 1.2) * g, '#723');
      V.rect(nx - 1, my + (m * 1.9) * g - 1, 1, 2, '#ec5'); V.rect(nx, my + (m * 1.9) * g - 1, 1, 2, '#ca2');  // lower incisors
    }
    // nose
    V.ball(nx, ny, 2 * g, 1.6 * g, PINK, { lo: 2, spec: 0.9 });
    V.px(nx - 1, ny + 0.5, '#412'); V.px(nx + 1, ny + 0.5, '#412');
    // long yellow upper incisors
    const iy = ny + 1.6 * g, il = Math.round(3 * g);
    V.rect(nx - 1, iy, 1, il, '#ec5'); V.rect(nx, iy, 1, il, '#ca2'); V.px(nx - 1, iy, '#fe8');
    // beady glowing eyes, set wide on the wedge of the head
    if (p.eyes) {
      for (const [ex, ey, r] of [[x - 4 * g + t * 0.7, y - 1.5 * g, 1], [x + 4 * g + t * 0.7, y - 2 * g, 0]]) {
        V.ellipse(ex, ey, 1.7 * g, 1.4 * g, '#101');
        V.px(ex, ey, r ? '#f65' : '#d33'); V.px(ex - 1, ey, '#a13');
        if (r) V.px(ex - 1, ey - 1, '#fdb');
      }
    } else {
      V.line(x - 6 + t * 0.7, y - 2, x - 2 + t * 0.7, y - 1, '#101'); V.line(x + 2 + t * 0.7, y - 2, x + 6 + t * 0.7, y - 3, '#101');
    }
    return [nx, ny];
  };

  rat.draw = (S, q) => {
    const p = rig(rat.KEY, q);
    const T = Object.assign({ ax: 32, ay: 54 }, p.t);
    const V = view(S, T);
    const [rx, ry] = p.rump, [cx, cy] = p.chest, [hx, hy] = p.head;
    // naked ringed tail, curling behind
    const [t1, t2, t3] = p.tail;
    layer(S, T, VV => {
      VV.horn(rx + 9, ry + 7, t1[0], t1[1], t2[0], t2[1], 2.6, 1.6, PINK, { lo: 1, hi: 5.5 });
      VV.horn(t2[0], t2[1], t2[0] + 1, (t2[1] + t3[1]) / 2 - 3, t3[0], t3[1], 1.6, 0.6, PINK, { lo: 1, hi: 5.5 });
      VV.S.recolor((x, y) => (x + y * 2) % 5 === 0, h => shifter(PINK, -1)(h));   // ring segments
    }, null);
    // far hind foot
    V.ball(p.hindFar[0], p.hindFar[1] - 1, 3.4, 1.8, PINK, { lo: 1, hi: 4 });
    // rump/haunch and near hind leg
    V.ball(rx, ry, 16, 14, RFUR, { spec: 0.05 });
    const hy2 = Math.min(ry + 10, 45);
    V.ball(rx + 5, hy2, 8.5, 7, RFUR, { lo: 0.6 });
    V.capsule(rx + 6, hy2 + 3, p.hind[0], p.hind[1] - 2, 4, 2.4, RFUR, { lo: 0.6 });
    V.ball(p.hind[0] - 2, p.hind[1] - 1, 4.4, 1.9, PINK, { lo: 1, hi: 5 });
    for (const d of [-5, -3, -1]) V.px(p.hind[0] + d - 1, p.hind[1], '#ddc');
    // bloated chest/belly
    const rear = p.rear || 0;
    V.ball(cx, cy, 12.5 - rear, 12 + rear * 2, RFUR, { spec: 0.08 });
    V.ball(cx + 2, cy + 5 + rear, 8.5, 6.5 + rear * 1.5, RFUR, { lo: 1.5 });      // pale belly
    // forelegs
    const fore = (VV, sh, paw, lo, up, swipe) => {
      if (swipe) {
        VV.capsule(sh[0], sh[1] - 3, paw[0], paw[1], 4.6, 3, RFUR, { lo });     // foreshortened, reaching at us
        VV.ball(paw[0], paw[1], 3.6, 3, PINK, { lo: 1, hi: 6, spec: 0.3 });
        const d = paw[0] >= cx ? 1 : -1;
        for (const a of [0.2, 0.75, 1.3]) {
          const ca = Math.cos(a) * d, sa = Math.sin(a);
          VV.line(paw[0] + ca * 3, paw[1] + sa * 2.5, paw[0] + ca * 5.5, paw[1] + sa * 4.5, '#ddc');
        }
        return;
      }
      if (up) {
        const [ex, ey] = joint(sh, paw, 9, 9, [paw[0] < cx ? -1 : 1, 0.6]);
        VV.capsule(sh[0], sh[1], ex, ey, 4.2, 3, RFUR, { lo });
        VV.capsule(ex, ey, paw[0], paw[1], 2.8, 1.6, RFUR, { lo });
      } else VV.capsule(sh[0], sh[1], paw[0], paw[1] - 2, 3.6, 2.2, RFUR, { lo });
      VV.ball(paw[0], paw[1] - (up ? 0 : 1), up ? 2.8 : 3.4, up ? 2.6 : 1.8, PINK, { lo: 1 + lo, hi: 6 });
      const claws = up ? [[-3, -2], [-1, -3], [1, -3], [3, -2]] : [[-3, 1], [-1, 1], [1, 1], [3, 1]];
      for (const [dx, dy] of claws) { VV.px(paw[0] + dx, paw[1] + dy - (up ? 0 : 1), '#ddc'); if (up) VV.px(paw[0] + dx * 1.3, paw[1] + dy * 1.6, '#998'); }
    };
    const upL = p.pawL[1] < cy, upR = p.pawR[1] < cy;
    const shL = upL ? [cx - 6, cy - 2] : [cx - 5, cy + 6], shR = upR ? [cx + 6, cy - 2] : [cx + 5, cy + 6];
    if (p.pawFront !== 'R') layer(S, T, VV => fore(VV, shR, p.pawR, 0.8, upR), '#211');
    if (p.pawFront !== 'L') layer(S, T, VV => fore(VV, shL, p.pawL, 0, upL), '#211');
    // mangy fur texture
    strands(S, RFUR, 0, 0, S.w, S.h, 900, 11, 1, 1, -1);
    S.speckle(0, 0, S.w, S.h, 0.1, shifter(RFUR, 1), 13);
    // mange: bald, festering patches
    for (const [mx, my, mr] of [[rx + 7, ry - 6, 2.6], [rx + 1, ry + 5, 1.8]]) {
      V.ball(mx, my, mr, mr * 0.6, ['#212', '#312', '#423', '#634', '#745'], { spec: 0.2 });
      V.px(mx - 0.5, my, '#401'); V.px(mx + 0.5, my, '#502');
    }
    // head
    layer(S, T, VV => { p._nose = rat.head(VV, hx, hy, p); }, '#211', { skipLit: true });
    // whiskers: thin, long, radiating
    const [nx, ny] = p._nose;
    for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) {
      const x0 = nx + sd * 3, y0 = ny - 1 + i * 0.6, x1 = nx + sd * (10 + i), y1 = ny - 4 + i * 3.5;
      for (let k = 0; k <= 6; k++) {
        const xx = lerp(x0, x1, k / 6), yy = lerp(y0, y1, k / 6);
        if (k < 5 || !S.opaque(Math.floor(V.X(xx, yy)), Math.floor(V.Y(xx, yy)))) V.px(xx, yy, k < 3 ? '#998' : '#776');
      }
    }
    if (p.pawFront === 'L') layer(S, T, VV => fore(VV, [cx - 8, cy + 6], p.pawL, 0, false, true), '#211');
    if (p.pawFront === 'R') layer(S, T, VV => fore(VV, [cx + 8, cy + 6], p.pawR, 0.4, false, true), '#211');
    S.outline(INK);
    if (p.smear) {
      for (const sm of [p.smear, p.smear2]) if (sm) {
        const tgt = sm[2] === 'head' ? [hx, hy + 2] : sm[2] === 'pawL' ? p.pawL : p.pawR;
        const ex = V.X(tgt[0], tgt[1]), ey = V.Y(tgt[0], tgt[1]);
        if (sm[2] === 'head') { smear(S, sm[0][0], sm[0][1], sm[1][0], sm[1][1], ex, ey, 2.8); continue; }
        // a claw rake: three thin parallel trails
        for (const o of [-4, 0, 4]) smear(S, sm[0][0] + o, sm[0][1] - o * 0.5, sm[1][0] + o, sm[1][1] - o * 0.3, ex + o * 0.5, ey + o * 0.8, 1.3, ['#89b', '#cde', '#eff']);
      }
    }
  };

  rat.portrait = S => {
    const p = RI(0, 0);
    const k = 0.92;
    const V = view(S, { ax: 0, ay: 0, k, dx: 12 - 23 * k, dy: 11.5 - 29 * k });
    V.ball(23, 46, 17, 9, RFUR, { lo: 0.5 });
    V.ball(10, 44, 5, 4, RFUR); V.ball(36, 44, 5, 4, RFUR, { lo: 1 });
    strands(S, RFUR, 0, 0, 24, 24, 160, 3, 1, 1, -1);
    rat.head(V, 23, 29, Object.assign(p, { hTurn: 2.4, mouth: 0 }));
    S.outline(INK);
  };

  E['Giant Rat'] = {
    w: 64, h: 56, anchor: [32, 54], center: [30, 36], mouth: [19, 40],
    draw: rat.draw, portrait: rat.portrait,
  };
})();
