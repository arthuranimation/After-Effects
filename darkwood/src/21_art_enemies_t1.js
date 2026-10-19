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
        t: { k: 1, dx: 2, dy: 0, sh: 0.08 },
        chest: [46, 54], head: [47, 37], turn: 1,
        shL: [35, 47], shR: [57, 45],
        handL: [58, 36], handR: [62, 32], elL: [-0.2, 1], elR: [1, 0.6],
        club: -0.9, clubFront: false, mouth: 0.15, earL: 2, earR: -2,
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
      handL: [20, 38], handR: [68, 50], elL: [-1, 0], elR: [1, 1],
      club: -0.5, clubLen: 22, mouth: 0.9, eyes: 0, earL: -4, earR: -4,
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
        t: { k: 1, dx: -2, dy: 0, sh: -0.07 },
        chest: [42, 44], head: [41, 26], turn: -1,
        shL: [24, 36], shR: [56, 38],
        handR: [32, 29], grip: 9, elL: [-1, 0.6], elR: [0, 1],
        axe: -2.0, axeLen: 24, axeSide: -1, axeFs: 0.95, axeFront: false, mouth: 0.6, brow: 1,
      });
      return w < 1 ? half(I, full, { handR: [36, 44], axe: -2.05, axeLen: 30, elR: [0, 1], t: { k: 1, dx: -1, dy: 0, sh: -0.035 } }) : full;
    },
    windR: (w, I) => {
      const full = Object.assign({}, I, {
        t: { k: 1, dx: 2, dy: 0, sh: 0.07 },
        chest: [46, 44], head: [47, 26], turn: 1,
        shL: [32, 38], shR: [64, 36],
        handR: [56, 29], grip: 9, elL: [0, 1], elR: [1, 0.6],
        axe: -1.14, axeLen: 24, axeSide: 1, axeFs: 0.95, axeFront: false, mouth: 0.6, brow: 1,
      });
      return w < 1 ? half(I, full, { handR: [54, 44], axe: -1.15, axeLen: 28, elL: [0, 1], t: { k: 1, dx: 1, dy: 0, sh: 0.035 } }) : full;
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
    if (!p.behind) layer(S, T, VV => orc.arm(VV, p.shL, hL, p.elL, 0, q.hurt), '#122');
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
    if (!p.behind) layer(S, T, VV => orc.arm(VV, p.shR, p.handR, p.elR, 0.6, false), '#122');
    if (two && !p.behind) layer(S, T, VV => fist(VV, hL[0], hL[1], 4.6, ORC_SKIN), '#122');
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
})();
