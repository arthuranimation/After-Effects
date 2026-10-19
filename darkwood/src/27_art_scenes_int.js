// ================================================================
// INTERIOR SCENES — the arena combat stage (a torch-lit colosseum
// bowl at night), and the shop headers: the weaponsmith's forge,
// the apothecary and the Rusty Flagon's common room.
// Static layers are painted once per size/state with the kit and a
// per-pixel "lighting grid" (brightness x warmth, Bayer dithered:
// cool moonlit shadows, warm torch pools). animate() only blits
// small sprites cached by frame index and draws a few DW.gfx rects.
// ================================================================
(() => {
  const P = DW.pal, U = DW.util, K = DW.kit, G = DW.gfx, A = DW.art;
  const TH = P.thresh;
  const clamp = U.clamp;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------
  const memo = new Map();
  const remember = (key, fn) => { let v = memo.get(key); if (v === undefined) { v = fn(); memo.set(key, v); } return v; };

  function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, seed, oct = 3) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2; }
    return s / n;
  }
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // Lighting grid: rows = warmth (cool moonlight → hot firelight),
  // columns = brightness. pick() dithers along both axes.
  function pick(grid, b, wm, x, y) {
    const nb = grid[0].length - 1, nw = grid.length - 1;
    const bv = clamp(b, 0, 1) * nb, wv = clamp(wm, 0, 1) * nw;
    let bi = Math.floor(bv), wi = Math.floor(wv);
    if (bv - bi > TH(x, y)) bi++;
    if (wv - wi > TH(x + 2, y + 3)) wi++;
    return grid[wi > nw ? nw : wi][bi > nb ? nb : bi];
  }

  const STONE = [
    ['#000', '#001', '#101', '#112', '#212', '#223', '#323', '#334', '#445', '#556', '#667'],
    ['#000', '#100', '#101', '#211', '#212', '#322', '#323', '#433', '#544', '#654', '#765'],
    ['#000', '#100', '#200', '#310', '#321', '#431', '#532', '#642', '#753', '#864', '#a86'],
    ['#100', '#200', '#310', '#420', '#531', '#641', '#752', '#863', '#a74', '#c95', '#eb7'],
  ];
  const SAND = [
    ['#000', '#101', '#111', '#211', '#212', '#312', '#322', '#423', '#433', '#534', '#645'],
    ['#000', '#100', '#211', '#311', '#321', '#422', '#432', '#533', '#643', '#754', '#865'],
    ['#100', '#200', '#310', '#321', '#421', '#532', '#642', '#753', '#863', '#974', '#a85'],
    ['#100', '#210', '#320', '#431', '#531', '#642', '#752', '#863', '#a74', '#b85', '#ca7'],
  ];
  // Step a colour along whichever lighting-grid row holds it (hue-safe darken/lighten).
  const stepMaps = new Map();
  function stepper(grid) {
    let m = stepMaps.get(grid);
    if (!m) {
      m = new Map();
      for (const row of grid) row.forEach((c, i) => { if (!m.has(c)) m.set(c, [row, i]); });
      stepMaps.set(grid, m);
    }
    return (hex, d) => { const e = m.get(hex); return e ? e[0][clamp(e[1] + d, 0, e[0].length - 1)] : hex; };
  }
  const GORE = ['#100', '#200', '#201', '#301', '#311', '#411', '#421'];
  const FIRE = ['#100', '#300', '#610', '#920', '#c40', '#e70', '#fa2', '#fd5', '#ffb', '#fff'];

  // ---------------------------------------------------------------
  // Fire: tongues of flame with palette-cycling heat bands, cached per
  // frame index (NF frames loop seamlessly).
  // ---------------------------------------------------------------
  const NF = 8;
  function tongueHeat(px, py, t, f) {
    const yy = (t.base - py) / t.h;                 // 0 at the base → 1 at the tip
    if (yy < -0.3 || yy > 1) return -1;
    const ph = f / NF * TAU + t.ph;
    const c = t.cx + Math.sin(ph + yy * 2.4) * t.sway * yy + Math.sin(ph * 2 + yy * 5) * t.sway * 0.25 * yy;
    let hw = yy < 0 ? t.hw * Math.sqrt(Math.max(0, 1 - (yy / 0.3) * (yy / 0.3))) : t.hw * Math.pow(1 - yy, 0.75);
    hw *= 0.86 + 0.12 * Math.sin(ph * 2 + yy * 6 + t.ph) + 0.08 * Math.sin(ph * 3 - yy * 9);
    const d = Math.abs(px - c);
    if (d > hw) return -1;
    let heat = (1 - d / (hw + 0.6)) * 0.75 + (1 - Math.max(0, yy)) * 0.55;
    heat += 0.14 * Math.sin(py * 1.15 + ph * 2);    // rising bands — the palette-cycling shimmer
    return heat;
  }
  // tongues: [{cx, base, h, hw, sway, ph}], o.hot boosts the core, o.cool keeps it dim
  function paintFire(S, tongues, f, o = {}) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const t of tongues) {
      x0 = Math.min(x0, t.cx - t.hw - t.sway - 2); x1 = Math.max(x1, t.cx + t.hw + t.sway + 2);
      y0 = Math.min(y0, t.base - t.h - 1); y1 = Math.max(y1, t.base + t.h * 0.3 + 1);
    }
    const lo = o.lo !== undefined ? o.lo : 1, hi = o.hi !== undefined ? o.hi : FIRE.length - 1;
    for (let y = Math.floor(y0); y <= y1; y++) for (let x = Math.floor(x0); x <= x1; x++) {
      let best = -1;
      for (const t of tongues) { const v = tongueHeat(x + 0.5, y + 0.5, t, f); if (v > best) best = v; }
      if (best < 0) continue;
      const v = lo + clamp(best * (o.gain || 1), 0, 1.15) * (hi - lo);
      let i = Math.floor(v);
      if (v - i > TH(x, y)) i++;
      S.set(x, y, FIRE[clamp(i, lo, hi)]);
    }
  }
  // A single torch flame sprite (9 × 15), frame f.
  const torchFlame = f => K.cached('dw27|torch|' + f, 9, 15, S => {
    paintFire(S, [
      { cx: 4.5, base: 13.5, h: 12, hw: 2.9, sway: 1.1, ph: 0 },
      { cx: 3.8, base: 13, h: 7, hw: 2, sway: 1.4, ph: 2.1 },
      { cx: 5.4, base: 13, h: 8.5, hw: 1.8, sway: 1.2, ph: 4.2 },
    ], f);
  });
  // Tiny candle flame (3 × 6), 4 frames.
  const candleFlame = f => K.cached('dw27|candle|' + f, 5, 7, S => {
    const sway = [0, 0.5, 0, -0.5][f & 3], tall = [5, 6, 5.5, 4.5][f & 3];
    paintFire(S, [{ cx: 2.5 + sway * 0.3, base: 6.2, h: tall, hw: 1.25, sway: sway, ph: 0 }], 0, { lo: 3, gain: 1.2 });
  });

  // Warm halo sprite blitted over a light source for flicker (sparse dither dots).
  const haloSprite = (r, lv, col) => K.cached(`dw27|halo|${r}|${lv}|${col}`, r * 2 + 1, r * 2 + 1, S => {
    for (let y = 0; y <= r * 2; y++) for (let x = 0; x <= r * 2; x++) {
      const d = Math.hypot(x - r, y - r) / (r + 0.5);
      if (d >= 1) continue;
      const a = (1 - d) * (1 - d) * lv;
      if (a > TH(x, y) + 0.02) S.set(x, y, col);
    }
  });

  // Rising embers / sparks: deterministic particle list driven by t.
  function drawEmbers(ctx, list, t, ox = 0, oy = 0) {
    for (const e of list) {
      const life = ((t * e.rate + e.ph) % 1 + 1) % 1;
      const x = e.x + Math.sin(t * e.wob + e.ph * 9) * e.amp + e.dx * life;
      const y = e.y - life * e.rise;
      const col = life < 0.25 ? '#ffb' : life < 0.5 ? '#fd5' : life < 0.75 ? '#e70' : '#920';
      if (life > 0.92) continue;
      G.rect((ox + x) | 0, (oy + y) | 0, 1, 1, col, ctx);
    }
  }

  // ---------------------------------------------------------------
  // Crowd figures. 8 × 8 cells: head (rows 0-3) over shoulders.
  //   h/H hair  s/S/L skin shadow/lit/highlight  c/C/D cloth  m/M metal
  // ---------------------------------------------------------------
  const PEOPLE = [
    ['...hh...', '..hHhh..', '..SSsh..', '..SSs...', '.DCCCcc.', 'DDCCCccc', 'DCCCCccc', 'CCCCcccc'],   // bare
    ['...cC...', '..cDCc..', '..cSsc..', '..CSsC..', '.DCCCcc.', 'DDCCCccc', 'DCCCCccc', 'CCCCcccc'],   // hood
    ['...mM...', '..mMMm..', '..mSsm..', '..SSs...', '.DCCCcc.', 'DDCCCccc', 'DCCCCccc', 'CCCCcccc'],   // helm
    ['...hh...', '..hHhh..', '.hSSshh.', '.hSSsh..', '.hCCCch.', 'DDCCCccc', 'DCCCCccc', 'CCCCcccc'],   // long hair
    ['...SS...', '..SLSs..', '..SSss..', '..SSs...', '.DCCCcc.', 'DDCCCccc', 'DCCCCccc', 'CCCCcccc'],   // bald
    ['..hhhh..', '.hhHhhh.', '..SSsh..', '..SSs...', '.DCCCcc.', 'DDCCCccc', 'DCCCCccc', 'CCCCcccc'],   // hat
  ];
  // cloth ramps (5 steps, dark → light) — muted so the crowd stays behind the fighters
  const CLOTH = [
    ['#100', '#201', '#302', '#412', '#523'],   // wine
    ['#100', '#210', '#321', '#432', '#542'],   // brown
    ['#101', '#111', '#212', '#322', '#433'],   // ash
    ['#100', '#201', '#311', '#421', '#532'],   // rust
    ['#101', '#102', '#213', '#314', '#424'],   // plum
    ['#001', '#011', '#122', '#233', '#344'],   // dull teal
    ['#110', '#210', '#321', '#431', '#542'],   // ochre
    ['#100', '#200', '#311', '#422', '#533'],   // russet
  ];
  const SKIN = [['#100', '#210', '#311'], ['#201', '#321', '#422'], ['#311', '#532', '#643'], ['#421', '#843', '#a64'], ['#531', '#a53', '#c86']];
  const HAIR = [['#000', '#100'], ['#100', '#210'], ['#100', '#321'], ['#210', '#432'], ['#211', '#543']];
  const METAL = [['#101', '#112'], ['#112', '#223'], ['#223', '#334'], ['#334', '#556'], ['#445', '#778']];

  // Paint one figure into a Sprite. lv 0..4 light level. rows: limit rows drawn.
  function paintPerson(S, ox, oy, tpl, cloth, hair, lv, rows = 8, test) {
    const T = PEOPLE[tpl], cr = CLOTH[cloth], sk = SKIN[lv], hr = HAIR[Math.min(4, Math.max(0, lv - 1) + (hair & 1))], mt = METAL[lv];
    for (let j = 0; j < rows; j++) for (let i = 0; i < 8; i++) {
      const ch = T[j][i];
      if (ch === '.') continue;
      const x = ox + i, y = oy + j;
      if (test && !test(x, y)) continue;
      let col;
      switch (ch) {
        case 'h': col = hr[0]; break;
        case 'H': col = hr[1]; break;
        case 's': col = sk[0]; break;
        case 'S': col = sk[1]; break;
        case 'L': col = sk[2]; break;
        case 'c': col = cr[clamp(lv - 3, 0, 4)]; break;
        case 'C': col = cr[clamp(lv - 2, 0, 4)]; break;
        case 'D': col = cr[clamp(lv - 1, 0, 4)]; break;
        case 'm': col = mt[0]; break;
        case 'M': col = mt[1]; break;
        default: col = '#101';
      }
      S.set(x, y, col);
    }
  }
  // Back-lit silhouette with a warm rim where the glow is behind it.
  function paintSilhouette(S, ox, oy, tpl, rim, rows = 8, test) {
    const T = PEOPLE[tpl];
    const at = (i, j) => i >= 0 && j >= 0 && i < 8 && j < rows && T[j][i] !== '.';
    for (let j = 0; j < rows; j++) for (let i = 0; i < 8; i++) {
      if (!at(i, j)) continue;
      const x = ox + i, y = oy + j;
      if (test && !test(x, y)) continue;
      // rim only on upward-facing edges: the glow is behind and above them
      S.set(x, y, !at(i, j - 1) && j < 4 ? rim : '#101');
    }
  }
  // Cached bob sprites (rows 0-5) for animate: the figure lifted, with the
  // uncovered part of its resting head back-filled dark.
  const bobSprite = (kind, tpl, cloth, hair, lv, rim, lift) =>
    K.cached(`dw27|bob|${kind}|${tpl}|${cloth}|${hair}|${lv}|${rim}|${lift}`, 8, 6 + lift, S => {
      const T = PEOPLE[tpl];
      for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) if (T[j][i] !== '.') S.set(i, j + lift, '#101');
      if (kind === 'sil') paintSilhouette(S, 0, 0, tpl, rim, 6);
      else paintPerson(S, 0, 0, tpl, cloth, hair, lv, 6);
    });

  // ================================================================
  // ARENA — the combat stage
  // ================================================================
  // Wall space: s = arc position, z = height above the sand (px at the centre).
  // The bowl projection lifts rows above eye level toward the sides and
  // sinks rows below it, which reads as the inside of a curved colosseum.
  const AZ = {
    eye: 18, curv: 0.16, a: 117, fz: 40,
    pod: 26, cop: 30, stands: 56, band: 60, arc1: 104, cor1: 110, arc2: 142, cor2: 146, attic: 164,
  };
  const GATE = 22, BAY = 38;
  const TIER = {
    1: { cloth: ['#100', '#210', '#310', '#420', '#531', '#642', '#753'], trim: ['#210', '#321', '#543', '#765'], emb: ['#543', '#987'], name: 'rust' },
    2: { cloth: ['#010', '#011', '#021', '#132', '#243', '#354', '#465'], trim: ['#310', '#520', '#741', '#a73'], emb: ['#741', '#c94'], name: 'green' },
    3: { cloth: ['#001', '#012', '#113', '#124', '#235', '#346', '#468'], trim: ['#223', '#445', '#778', '#aab'], emb: ['#889', '#cce'], name: 'steel' },
    4: { cloth: ['#100', '#200', '#301', '#502', '#712', '#923', '#b34'], trim: ['#420', '#740', '#b81', '#fd4'], emb: ['#c91', '#fe6'], name: 'crimson' },
  };

  function makeCourses(seed, n, minW, maxW, range) {
    const r = U.rng(seed), out = [];
    for (let i = 0; i < n; i++) {
      const j = [];
      let s = -range - r() * maxW;
      while (s < range + maxW) { j.push(s); s += minW + r() * (maxW - minW); }
      j.push(s);
      out.push(j);
    }
    return out;
  }
  const blk = { i: 0, ls: 0, bw: 1 };
  function findBlock(j, s) {
    let lo = 0, hi = j.length - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (j[m] <= s) lo = m; else hi = m - 1; }
    blk.i = lo; blk.ls = s - j[lo]; blk.bw = j[lo + 1] - j[lo];
    return blk;
  }
  const POD_C = makeCourses(11, 6, 11, 21, 300);
  const SPAN_C = makeCourses(29, 8, 13, 24, 300);
  const ATT_C = makeCourses(47, 4, 16, 28, 300);

  // Bevelled ashlar block: lit top/left edges, dark bottom/right, mortar joints.
  function ashlar(joints, s, zc, ch, seed) {
    const B = findBlock(joints, s);
    if (zc < 1 || B.ls < 1) return 0.13;
    let b = 0.3 + hash2(B.i, seed, 5) * 0.08;
    if (zc >= ch - 1) b += 0.1;
    else if (zc < 2) b -= 0.05;
    if (B.ls < 2) b += 0.05;
    else if (B.ls >= B.bw - 1) b -= 0.07;
    return b;
  }

  function arenaLayout(w, h) {
    return remember(`ar|${w}x${h}`, () => {
      const L = { w, h, cx: w / 2 };
      const c = AZ.curv, a = AZ.a, rc = Math.sqrt(c);
      L.floorC = Math.round(Math.max(h * 0.3, h - 120, Math.min(h * 0.62, 56)));
      L.feetY = h - 56;
      L.k = new Float32Array(w); L.s = new Float32Array(w); L.yF = new Float32Array(w);
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5 - L.cx) / a;
        L.k[x] = 1 + c * u * u;
        L.s[x] = (a / rc) * Math.atan(rc * u);
        L.yF[x] = L.floorC + AZ.eye * (L.k[x] - 1);
      }
      L.kOf = xf => { const u = (xf - L.cx) / a; return 1 + c * u * u; };
      L.xOf = s => L.cx + (a / rc) * Math.tan(rc * s / a);
      L.yOf = (xf, z) => L.floorC + (AZ.eye - z) * L.kOf(xf) - AZ.eye;
      L.sOf = xf => (a / rc) * Math.atan(rc * (xf - L.cx) / a);
      const sEdge = Math.max(Math.abs(L.s[0]), Math.abs(L.s[w - 1])) + 12;

      // pilasters, torches, banners along the podium
      L.pilasters = []; L.torches = []; L.banners = [];
      for (let side = -1; side <= 1; side += 2) {
        for (let p = GATE, n = 0; p < sEdge; p += BAY, n++) {
          L.pilasters.push(side * p);
          if (n > 0) L.torches.push(side * p);
          const bc = p + BAY / 2;
          if (bc < sEdge) L.banners.push(side * bc);
        }
      }
      L.aisles = L.torches.filter((p, i) => Math.abs(p) > 80 && Math.abs(p) < 110);
      // light sources (screen space)
      L.lights = L.torches.map(p => {
        const x = L.xOf(p);
        return { x, y: L.yOf(x, 25), r: 34, i: 1 };
      });
      // arcade arches: glow strength per arch (deterministic)
      L.arches1 = []; L.arches2 = [];
      for (let n = -8; n <= 8; n++) {
        const sA = n * 30;
        if (Math.abs(sA) < sEdge + 15) L.arches1.push({ s: sA, g: [0.9, 0.35, 0.7, 0, 1, 0.55, 0.2][((n % 7) + 7) % 7] });
      }
      for (let n = -12; n <= 12; n++) {
        const sA = n * 22;
        if (Math.abs(sA) < sEdge + 11) L.arches2.push({ s: sA, g: [0.5, 0, 0.8, 0.3, 0, 0.6][((n % 6) + 6) % 6] });
      }
      // a moon over the rim when the stage is tall enough to show sky
      {
        const mx = Math.round(w * 0.2), skyH = L.yOf(mx, AZ.attic + 20);
        L.moon = skyH > 58 ? { x: mx, y: Math.round(Math.max(30, skyH * 0.45)), R: Math.round(clamp(skyH * 0.13, 8, 12)) } : null;
      }
      // blood soaked into the sand: [screen u, depth D, radius X, radius D]
      L.stains = [];
      const sr = U.rng(4242);
      for (const [u0, D, rx, rd] of [[-0.52, 0.6, 11, 0.05], [0.46, 0.82, 8, 0.03], [0.68, 0.5, 7, 0.04], [-0.16, 0.9, 6, 0.022], [-0.84, 0.4, 6, 0.045]]) {
        const X = u0 * AZ.a * D;
        L.stains.push({ X, D, rx, rd });
        const n = 3 + Math.floor(sr() * 3);
        for (let i = 0; i < n; i++) {
          const a = sr() * TAU, d = 0.9 + sr() * 0.8;
          L.stains.push({ X: X + Math.cos(a) * rx * d, D: D + Math.sin(a) * rd * d, rx: rx * (0.2 + sr() * 0.25), rd: rd * (0.25 + sr() * 0.3) });
        }
        // a drag smear trailing off to one side
        const dir = sr() < 0.5 ? -1 : 1;
        for (let i = 1; i <= 4; i++) L.stains.push({ X: X + dir * rx * (0.7 + i * 0.45), D: D + rd * 0.3 * i * (sr() - 0.5), rx: rx * 0.42 * (1 - i * 0.15), rd: rd * 0.32 });
      }

      // ---- the crowd: stands rows (front-lit by the podium torches) ----
      const rnd = U.rng(901);
      L.people = [];
      const zOf = (xf, yf) => AZ.eye - (yf - L.floorC + AZ.eye) / L.kOf(xf);
      const TPLW = [0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 3, 4, 5];   // mostly bare heads: rhythm over variety
      for (let r = 3; r >= 0; r--) {
        const zb = AZ.cop + r * 6;
        for (let n = -2; n * 5 < w + 4; n++) {
          const x = n * 5 + ((r & 1) ? 2 : 0) + (rnd() < 0.15 ? 1 : 0);
          const xc = x + 4, s = L.sOf(xc);
          let skip = rnd() < 0.04;
          for (const a2 of L.aisles) if (Math.abs(s - a2) < 6) skip = true;
          const y = Math.round(L.yOf(xc, zb)) - 8 - (rnd() < 0.12 ? 1 : 0);
          const tl = torchLight(L, xc - 0.5, y + 2, 0.8);
          const lv = clamp(Math.floor(0.75 + tl * 6 + rnd() * 0.9 + r * 0.08), 0, 4);
          if (!skip && y + 8 > 0 && y < h) {
            L.people.push({
              kind: 'std', x, y, tpl: TPLW[Math.floor(rnd() * TPLW.length)], cloth: Math.floor(rnd() * CLOTH.length),
              hair: Math.floor(rnd() * 2), lv, ph: rnd() * 50, rate: 0.6 + rnd() * 1.2, arm: rnd(), rim: '', clip: null,
            });
          }
        }
      }
      // ---- the galleries: silhouettes against a warm back-glow ----
      const inside = (sp, R, zs, zMin) => (x, y) => {
        const s = L.sOf(x + 0.5), z = zOf(x + 0.5, y + 0.5);
        const ds = s - Math.round(s / sp) * sp;
        return Math.abs(ds) < R && z > zMin && (z < zs || Math.hypot(ds, z - zs) < R);
      };
      const in1 = inside(30, 9, 86, 63), in2 = inside(22, 6, 128, 113);
      for (const arc of L.arches1) {
        for (const [ds, dz, back] of [[0.4, 3, 1], [-4.2, 0, 0], [4.4, 0, 0]]) {
          const xc = L.xOf(arc.s + ds);
          const x = Math.round(xc - 4), y = Math.round(L.yOf(xc, 63 + dz)) - 8;
          if (y + 8 < 0 || y > h || x < -8 || x > w) continue;
          const tpl = Math.floor(hash2(arc.s, ds * 10, 3) * PEOPLE.length);
          const sil = arc.g > 0.3;
          L.people.push({
            kind: sil ? 'sil' : 'std', x, y, tpl, cloth: ((arc.s / 30 + 9) % CLOTH.length) | 0, hair: 0, lv: back ? 0 : 1,
            ph: hash2(arc.s, ds * 7, 9) * 50, rate: 0.7 + hash2(arc.s, ds, 4), arm: hash2(arc.s, ds, 6),
            rim: back ? '#421' : arc.g > 0.75 ? '#a52' : arc.g > 0.5 ? '#831' : '#521', clip: in1,
          });
        }
      }
      for (const arc of L.arches2) {
        const xc = L.xOf(arc.s);
        const x = Math.round(xc - 4), y = Math.round(L.yOf(xc, 113)) - 8;
        if (y + 8 < 0 || y > h || x < -8 || x > w) continue;
        const sil = arc.g > 0.25;
        L.people.push({
          kind: sil ? 'sil' : 'std', x, y, tpl: Math.floor(hash2(arc.s, 5, 3) * PEOPLE.length), cloth: 4, hair: 0, lv: 0,
          ph: hash2(arc.s, 2, 9) * 50, rate: 0.6 + hash2(arc.s, 3, 4), arm: hash2(arc.s, 4, 6),
          rim: arc.g > 0.6 ? '#831' : '#421', clip: in2,
        });
      }
      return L;
    });
  }

  function torchLight(L, x, y, fy) {
    let sum = 0;
    const px = x + 0.5, py = y + 0.5;
    for (const t of L.lights) {
      const dx = px - t.x;
      if (dx > t.r || dx < -t.r) continue;
      const dy = (py - t.y) * fy;
      if (dy > t.r || dy < -t.r) continue;
      const d2 = (dx * dx + dy * dy) / (t.r * t.r);
      if (d2 < 1) { const f = 1 - Math.sqrt(d2); sum += t.i * f * f; }
    }
    return sum;
  }

  // Shading result for one wall pixel.
  const M = { b: 0, w: 0, col: null, lit: 1 };

  function archGlow(arches, s, sp) {
    const n = Math.round(s / sp);
    for (const A2 of arches) if (Math.round(A2.s / sp) === n) return A2.g;
    return 0;
  }

  function wallPx(L, s, z, x, y) {
    M.col = null; M.w = 0; M.lit = 1;
    // ---------------- podium wall ----------------
    if (z < AZ.pod) {
      // gate in the centre bay
      const as = Math.abs(s);
      if (as < 13 && z < 13 + Math.sqrt(Math.max(0, 169 - s * s))) {
        const r = Math.hypot(s, Math.max(0, z - 13));
        if (as < 9.5 && (z < 13 || r < 9.5)) {
          // portcullis over a black passage with a faint ember glow deep inside
          const bar = Math.abs(((s + 100) % 3.2) - 1.6) < 0.55;
          const rail = ((z + 100) % 5) < 1;
          if ((bar || rail) && z > 0.5) {
            const left = ((s + 100) % 3.2) < 1.1;
            M.b = bar && left ? 0.34 : 0.22; M.w = 0.05; M.lit = 0.6;
            if (z < 2.5 && bar) M.b = 0.4;   // spike tips
            return;
          }
          M.lit = 0.15;
          M.b = 0.05 + 0.1 * smooth(14, 0, z); M.w = 0.55;
          return;
        }
        // arch ring + jambs
        if (z >= 13) {
          const ang = Math.atan2(z - 13, s);
          const seg = ang / (Math.PI / 7);
          if (Math.abs(seg - Math.round(seg)) < 0.09 || r > 12.6) { M.b = 0.13; return; }
          M.b = Math.abs(ang - Math.PI / 2) < 0.16 ? 0.46 : 0.36 - (s > 0 ? 0.05 : 0);
          if (r < 10.5) M.b -= 0.06;
          return;
        }
        const zc = (z + 1) % 5;
        if (zc < 1 || as > 12.4) { M.b = 0.13; return; }
        M.b = 0.33 + (as < 10.5 ? (s < 0 ? -0.08 : 0.02) : 0) + (zc > 4 ? 0.08 : 0);
        return;
      }
      // pilasters
      for (const p of L.pilasters) {
        const d = s - p, ad = Math.abs(d);
        const wide = z < 3 || z > AZ.pod - 4;
        if (ad < (wide ? 5.5 : 4.5)) {
          const zc = (z + 2) % 8;
          if (zc < 1 || (wide && (z > 2 && z < 3 || z > AZ.pod - 4 && z < AZ.pod - 3))) { M.b = 0.13; return; }
          M.b = 0.38 + hash2(Math.floor(z / 8), p | 0, 3) * 0.05;
          if (d < (wide ? -4.5 : -3.5)) M.b += 0.12;
          else if (d > (wide ? 3.5 : 2.5)) M.b -= 0.14;
          if (zc > 7) M.b += 0.06;
          return;
        }
      }
      // ashlar courses
      if (z < 3) { M.b = z > 2 ? 0.28 : 0.18; return; }
      const ci = Math.floor((z - 3) / 6), zc = (z - 3) - ci * 6;
      M.b = ashlar(POD_C[ci % POD_C.length], s, zc, 6, ci);
      M.b += (vnoise(s * 0.3, z * 0.45, 3) - 0.5) * 0.1;
      // cast shadow right of each pilaster, under the coping
      for (const p of L.pilasters) { const d = s - p; if (d > 4.5 && d < 8) { M.b *= 0.62; break; } }
      if (z > AZ.pod - 3) M.b *= 0.72;
      // rain streaks and dried blood low on the wall
      const st = vnoise(s * 0.45, 0.5, 9);
      if (st > 0.66) M.b -= 0.07 * (z / AZ.pod);
      if (z < 7 && fbm(s * 0.22, z * 0.35, 21, 2) > 0.7 + z * 0.02) { M.b *= 0.7; M.w += 0.25; }
      return;
    }
    // ---------------- coping with dentils ----------------
    if (z < AZ.cop) {
      const zc = z - AZ.pod;
      if (zc < 1) M.b = 0.12;
      else if (zc < 3) M.b = ((s + 400) % 3) < 2 ? 0.42 : 0.18;
      else M.b = 0.58;
      return;
    }
    // ---------------- stands (crowd painted afterwards) ----------------
    if (z < AZ.stands) {
      for (const a of L.aisles) {
        const d = Math.abs(s - a);
        if (d < 3.5) { M.b = ((z + 400) % 2) < 1 ? 0.3 : 0.15; return; }
        if (d < 4.5) { M.b = 0.36; return; }
      }
      const zr = (z - AZ.cop) % 6;
      M.b = zr < 1 ? 0.26 : zr > 5 ? 0.07 : 0.12;
      return;
    }
    // ---------------- arcade base band ----------------
    if (z < AZ.band) {
      const zc = z - AZ.stands;
      M.b = zc < 1 ? 0.12 : zc > 3 ? 0.44 : 0.3;
      return;
    }
    // ---------------- arcade 1 ----------------
    if (z < AZ.arc1) {
      const sA = Math.round(s / 30) * 30, ds = s - sA, ads = Math.abs(ds);
      const zs = 86, R = 9;
      const r = Math.hypot(ds, z - zs);
      if (ads < R && (z < zs || r < R)) {
        // gallery interior: a low parapet, then darkness with a warm back-glow
        if (z < 63) { M.b = z > 62 ? 0.32 : 0.2; M.lit = 0.5; return; }
        const g = archGlow(L.arches1, s, 30);
        M.lit = 0.2;
        M.b = 0.04 + g * 0.42 * smooth(zs + 6, 64, z) * (1 - 0.35 * (ads / R));
        M.w = 0.35 + g * 0.65;
        return;
      }
      if (z >= zs && r < R + 3.2) {
        const ang = Math.atan2(z - zs, ds);
        const seg = ang / (Math.PI / 7);
        if (Math.abs(seg - Math.round(seg)) < 0.1 || r > R + 2.8) { M.b = 0.14; return; }
        M.b = Math.abs(ang - Math.PI / 2) < 0.17 ? 0.5 : 0.4 - (ds > 0 ? 0.05 : 0);
        if (r < R + 1) M.b -= 0.08;
        return;
      }
      // pillar with an engaged half-column
      const pc = Math.round((s - 15) / 30) * 30 + 15, pl = s - pc, apl = Math.abs(pl);
      if (z < zs + 2 && z > zs - 2 && ads >= R - 1) { M.b = z > zs + 1 ? 0.5 : z < zs - 1 ? 0.15 : 0.4; return; }
      if (apl < 3 && z < zs - 2) {
        const nx = pl / 3;
        M.b = 0.34 - nx * 0.14 - nx * nx * 0.08;
        if (z < 64) M.b = z < 61 ? 0.42 : 0.24;
        return;
      }
      const ci = Math.floor((z - AZ.band) / 8), zc = (z - AZ.band) - ci * 8;
      M.b = ashlar(SPAN_C[ci % SPAN_C.length], s, zc, 8, ci + 40);
      if (ads >= R && ads < R + 2 && z < zs) M.b -= 0.06;   // reveal shadow inside the jamb
      M.b += (vnoise(s * 0.25, z * 0.3, 5) - 0.5) * 0.08;
      return;
    }
    // ---------------- cornice 1 ----------------
    if (z < AZ.cor1) {
      const zc = z - AZ.arc1;
      if (zc < 1) M.b = 0.1;
      else if (zc < 4) M.b = ((s + 400) % 4) < 2.5 ? 0.44 : 0.2;
      else if (zc < 5) M.b = 0.4;
      else M.b = 0.6;
      return;
    }
    // ---------------- arcade 2 ----------------
    if (z < AZ.arc2) {
      const sA = Math.round(s / 22) * 22, ds = s - sA, ads = Math.abs(ds);
      const zs = 128, R = 6;
      const r = Math.hypot(ds, z - zs);
      if (ads < R && (z < zs || r < R) && z > AZ.cor1 + 1) {
        if (z < 113) { M.b = 0.24; M.lit = 0.5; return; }
        const g = archGlow(L.arches2, s, 22);
        M.lit = 0.2;
        M.b = 0.03 + g * 0.34 * smooth(zs + 4, 113, z);
        M.w = 0.3 + g * 0.6;
        return;
      }
      if (z >= zs && r < R + 2.4) {
        const ang = Math.atan2(z - zs, ds);
        const seg = ang / (Math.PI / 5);
        if (Math.abs(seg - Math.round(seg)) < 0.12 || r > R + 2) { M.b = 0.15; return; }
        M.b = 0.42 - (ds > 0 ? 0.06 : 0);
        return;
      }
      if (ads >= R && ads < R + 1.5 && z < zs) { M.b = 0.2; return; }
      const ci = Math.floor((z - AZ.cor1) / 7), zc = (z - AZ.cor1) - ci * 7;
      M.b = ashlar(SPAN_C[(ci + 3) % SPAN_C.length], s, zc, 7, ci + 80) + 0.02;
      return;
    }
    // ---------------- cornice 2 ----------------
    if (z < AZ.cor2) {
      const zc = z - AZ.arc2;
      M.b = zc < 1 ? 0.12 : zc < 3 ? 0.38 : 0.6;
      return;
    }
    // ---------------- attic ----------------
    if (z < AZ.attic) {
      const sA = Math.round(s / 22) * 22, ds = Math.abs(s - sA);
      if (ds < 2.5 && z > 149 && z < 157) { M.b = z > 156 ? 0.06 : 0.03; M.lit = 0.2; return; }
      const pc = Math.round((s - 11) / 22) * 11 * 2 + 11, pl = Math.abs(s - pc);
      if (pl < 2 && z > 158 && z < 161) { M.b = z > 160 ? 0.62 : 0.46; return; }
      if (z > AZ.attic - 1) { M.b = 0.66; return; }
      const ci = Math.floor((z - AZ.cor2) / 9), zc = (z - AZ.cor2) - ci * 9;
      M.b = ashlar(ATT_C[ci % ATT_C.length], s, zc, 9, ci + 120) + 0.04;
      return;
    }
    M.b = -1;   // sky
  }

  const SKY = ['#001', '#001', '#102', '#102', '#103', '#113', '#213', '#214', '#224'];

  function paintArena(S, w, h, st) {
    const L = arenaLayout(w, h);
    const tier = clamp((st.tier | 0) || 1, 1, 4);
    const yhF = L.floorC - AZ.fz;
    const sandBottom = h - L.floorC;

    const gore = new Uint8Array(w * h);
    // ---------- per-pixel wall + floor ----------
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = L.k[x], s = L.s[x];
        const u = (x + 0.5 - L.cx) / AZ.a;
        const z = AZ.eye - (y + 0.5 - L.floorC + AZ.eye) / k;
        if (z >= 0) {
          wallPx(L, s, z, x, y);
          if (M.b < 0) {
            // night sky: deep indigo, faint moon-glow from the upper left
            let glow = Math.max(0, 1 - Math.hypot(x + 20, y + 40) / (w * 0.9)) * 0.5;
            if (L.moon) glow += Math.pow(Math.max(0, 1 - Math.hypot(x + 0.5 - L.moon.x, y + 0.5 - L.moon.y) / (L.moon.R * 3.4)), 1.6) * 0.75;
            gore[y * w + x] = 2;
            const v = clamp(y / Math.max(30, L.yOf(L.cx, AZ.attic)) * 0.55 + glow, 0, 1) * (SKY.length - 1);
            let i = Math.floor(v); if (v - i > TH(x, y)) i++;
            S.set(x, y, SKY[Math.min(SKY.length - 1, i)]);
            if (hash2(x, y, 77) > 0.994) S.set(x, y, hash2(x, y, 78) > 0.6 ? '#668' : '#335');
            continue;
          }
          if (M.col) { S.set(x, y, M.col); continue; }
          // moonlight grows with height (the low wall sits in the shadow of the near stands)
          const moon = (0.66 + 0.5 * smooth(10, 150, z)) * (1 - 0.07 * u);
          const tl = torchLight(L, x, y, 1) * M.lit;
          const b = M.b * (moon + 1.25 * tl);
          const wm = 0.08 + M.w + tl * 1.15;
          S.set(x, y, pick(STONE, b, wm, x, y));
          continue;
        }
        // ---------- sand ----------
        const yF = L.yF[x];
        const D = (yF - yhF) / (y + 0.5 - yhF);      // depth: 1 at the wall foot → ~0.25 at the bottom
        const X = (x + 0.5 - L.cx) * D;
        let b = 0.24 + 0.14 * (1 - D);
        let wm = 0.32;
        // the fighting pool of light in the middle
        const px = (x + 0.5 - L.cx) / (w * 0.5), py = (y + 0.5 - L.feetY) / Math.max(26, sandBottom * 0.72);
        const pool = Math.max(0, 1 - px * px - py * py);
        b += 0.24 * pool; wm += 0.38 * pool;
        b -= 0.12 * u * u;
        // contact shadow at the wall foot
        const dy0 = y + 0.5 - yF;
        if (dy0 < 7) b *= 0.45 + 0.55 * (dy0 / 7);
        // torch spill on the sand
        const tl = torchLight(L, x, y, 2.4);
        b += 0.22 * tl; wm += 0.8 * tl;
        // grain, low mottling and faint wind ripples (finer with distance)
        b += (hash2(x, y, 5) - 0.5) * 0.05 + (fbm(X * 0.05, D * 6, 13, 2) - 0.5) * 0.1;
        b += 0.025 * Math.sin(D * 64 + vnoise(X * 0.04, D * 3, 8) * 5);
        // old blood soaked into the sand
        let g = 0, nz = -1;
        for (const st0 of L.stains) {
          const dx = (X - st0.X) / st0.rx;
          if (dx > 1.6 || dx < -1.6) continue;
          const dd = (D - st0.D) / st0.rd;
          if (dd > 1.6 || dd < -1.6) continue;
          if (nz < 0) nz = fbm(X * 0.14, D * 14, 61, 3);
          const d = Math.hypot(dx, dd) + (nz - 0.5) * 1.1 + (hash2(st0.X * 10 | 0, 0, 3) - 0.5) * 0.2;
          if (d < 1) g = Math.max(g, 1 - d);
        }
        if (g > 0 && (g > 0.3 || g / 0.3 > TH(x + 1, y))) {
          const v = clamp(b * 7.5 - 0.6 - g * 1.5, 0, GORE.length - 1);
          let i = Math.floor(v); if (v - i > TH(x, y)) i++;
          S.set(x, y, GORE[Math.min(GORE.length - 1, i)]);
          gore[y * w + x] = 1;
          continue;
        }
        // spatter
        if (hash2(x, y, 91) > 0.996 - 0.008 * Math.max(0, 1 - Math.abs(px) * 1.4) * Math.max(0, 1 - Math.abs(py))) {
          S.set(x, y, GORE[clamp(Math.round(b * 6), 1, 4)]);
          gore[y * w + x] = 1;
          continue;
        }
        S.set(x, y, pick(SAND, b, wm, x, y));
      }
    }

    // ---------- rake grooves following the curve of the wall ----------
    const sandStep = stepper(SAND);
    for (let i = 1; i < 60; i++) {
      const D = 1 - i * 0.045;
      if (D < 0.2) break;
      for (let x = 0; x < w; x++) {
        const y = Math.round(yhF + (L.yF[x] - yhF) / D + Math.sin(x * 0.11 + i) * 0.4);
        if (y >= h - 1 || y <= L.yF[x] + 2) continue;
        const brk = vnoise(x * 0.05, i * 3.1, 41);
        const cxd = Math.abs(x + 0.5 - L.cx) / (w * 0.5);
        const trample = (1 - cxd) * smooth(L.feetY - 30, L.feetY + 10, y);
        if (brk < 0.22 + trample * 0.6) continue;
        if (!gore[y * w + x]) S.set(x, y, sandStep(S.getHex(x, y), -2));
        if (!gore[(y + 1) * w + x] && TH(x, y) < 0.5) S.set(x, y + 1, sandStep(S.getHex(x, y + 1), 1));
      }
    }

    // ---------- the crowd ----------
    for (const p of L.people) {
      if (p.kind === 'sil') paintSilhouette(S, p.x, p.y, p.tpl, p.rim, 8, p.clip);
      else paintPerson(S, p.x, p.y, p.tpl, p.cloth, p.hair, p.lv, 8, p.clip);
    }

    // ---------- iron sconces under each torch ----------
    for (const p of L.torches) {
      const xc = L.xOf(p), x = Math.round(xc - 0.5), y = Math.round(L.yOf(xc, 21));
      if (x < -4 || x > w + 4 || y < -4 || y > h) continue;
      // bracket + cup
      S.set(x, y + 4, '#101'); S.set(x, y + 3, '#212'); S.set(x - 1, y + 2, '#323'); S.set(x, y + 2, '#212');
      S.rect(x - 2, y, 5, 2, '#211'); S.rect(x - 2, y, 2, 1, '#543'); S.set(x + 2, y + 1, '#100');
      S.set(x - 3, y - 1, '#101'); S.set(x + 3, y - 1, '#101');
      S.rect(x - 2, y - 1, 5, 1, '#320');   // glowing coals rim
    }

    // ---------- the moon and a few streaks of cloud (tall stages only) ----------
    if (L.moon) {
      const { x: mx, y: my, R } = L.moon;
      const MOON = ['#324', '#435', '#657', '#879', '#a9a', '#bbb', '#ccb', '#ddc', '#eed', '#ffe'];
      const cr = U.rng(17), craters = [];
      for (let i = 0; i < 5; i++) { const a = cr() * TAU, d = Math.sqrt(cr()) * R * 0.65; craters.push([mx + Math.cos(a) * d, my + Math.sin(a) * d, 1.6 + cr() * R * 0.12]); }
      for (let y = my - R - 1; y <= my + R + 1; y++) for (let x = mx - R - 1; x <= mx + R + 1; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h || gore[y * w + x] !== 2) continue;
        const dx = (x + 0.5 - mx) / R, dy = (y + 0.5 - my) / R, d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        let I = S.lit(K.norm3([dx, dy, Math.sqrt(1 - d2)]), { ambient: 0.6 });
        if (fbm(dx * 1.6 + 3, dy * 1.6 + 1, 23, 2) > 0.55) I -= 0.13;
        for (const [cx2, cy2, r2] of craters) {
          const ex = x + 0.5 - cx2, ey = y + 0.5 - cy2, cd = Math.hypot(ex, ey);
          if (cd < r2) I += cd > r2 - 1 ? (ex + ey > 0 ? 0.1 : -0.08) : -0.12;
        }
        S.shadePx(x, y, MOON, I);
      }
      // cloud banks: soft dark streaks with dithered edges and moonlit crowns
      for (const [cx2, cy2, len, th] of [[mx + R * 1.2, my + R * 0.95, R * 6, 2.6], [mx - R * 2.2, my - R * 1.5, R * 3.4, 1.6], [mx + R * 6, my + R * 2.2, R * 5, 2]]) {
        for (let x = Math.round(cx2 - len / 2); x < cx2 + len / 2; x++) {
          const k2 = (x - (cx2 - len / 2)) / len;
          const taper = Math.pow(Math.sin(Math.PI * k2), 0.7);
          const t2 = th * taper * (0.7 + 0.6 * vnoise(x * 0.15, cy2, 5));
          const yc = cy2 + Math.sin(x * 0.07 + cy2) * 1.2;
          for (let y = Math.floor(yc - t2 - 1); y <= yc + t2 + 1; y++) {
            if (x < 0 || y < 0 || x >= w || y >= h || gore[y * w + x] !== 2) continue;
            const d = 1 - Math.abs(y + 0.5 - yc) / (t2 + 0.5);
            if (d <= 0 || d * 1.6 < TH(x, y)) continue;
            const onMoon = Math.hypot(x + 0.5 - mx, y + 0.5 - my) < R;
            const crown = y + 0.5 < yc - t2 * 0.45;
            S.set(x, y, crown ? (onMoon ? '#bbb' : '#324') : (onMoon ? '#768' : '#102'));
          }
        }
      }
    }

    // ---------- masts for the velarium on the attic ----------
    const atticY = L.yOf(L.cx, AZ.attic);
    if (atticY > 6) {
      for (let n = -6; n <= 6; n++) {
        const sm = n * 44 + 22;
        const xc = L.xOf(sm);
        if (xc < -2 || xc > w + 2) continue;
        const yb = L.yOf(xc, AZ.attic), yt = L.yOf(xc, AZ.attic + 26);
        for (let y = Math.floor(yt); y < yb; y++) { S.set(Math.floor(xc) - 1, y, '#213'); S.set(Math.floor(xc), y, '#101'); }
      }
    }

    // ---------- bones, a broken sword, a shield on the sand ----------
    paintArenaProps(S, L, w, h);
  }

  // ---------- props on the sand ----------
  // Hand-placed pixel templates (crisp at 1x). Keys: x outline, B/b/d bone
  // lit/mid/shade, O socket, n nose, S/s/z steel, G/g bronze, W/w wood,
  // R/r iron rim, k dark leather.
  const PROP_COL = {
    x: '#101', B: '#cb9', b: '#987', d: '#654', e: '#432', O: '#100', n: '#322',
    S: '#bbc', s: '#778', z: '#445', G: '#b83', g: '#741', W: '#863', w: '#542', v: '#321',
    R: '#889', r: '#445', k: '#211',
  };
  const PROPS = {
    skull: [
      '...xxxx...',
      '..xBBbbx..',
      '.xBBbbbdx.',
      '.xBbbbbdx.',
      'xbOObbOOdx',
      'xbOOnbOOdx',
      '.xdbnnbdx.',
      '..xbdbdx..',
      '...xxxx...',
    ],
    femur: [
      'xx.........xx',
      'xBxxxxxxxxxbx',
      'xbBBbbbbbbbdx',
      'xdxxxxxxxxxdx',
      'xx.........xx',
    ],
    ribs: [
      '..x.x.x.x..',
      '.xBxBxbxbx.',
      '.xbxbxbxdx.',
      'xxBxbxbxdxx',
      'xbbbbbbbddx',
      'xxxxxxxxxxx',
    ],
    sword: [   // broken blade stuck in the sand, hilt up
      '...xx...',
      '..xGgx..',
      '...xkx..',
      '...xkx..',
      '.xxkkxx.',
      'xGGGggg x'.replace(' ', ''),
      '.xxSsxx.',
      '...xSzx.',
      '...xSzx.',
      '...xSzx.',
      '...xSsx.',
      '...xSzx.',
      '...xzx..',
      '..xSzx..',
      '..xx....',
    ],
    tip: [
      'xxxx.....',
      'xSSsxxx..',
      '.xxzzzsxx',
      '....xxxx.',
    ],
    shield: [
      '....xxxxxxxxx....',
      '..xxrRRRRRRRrxx..',
      '.xrWWwWWwvWWwwrx.',
      'xrWWwWWwWvWWwwwrx',
      'xrWwwWsSswvWwwwrx',
      'xrWwWWzszWvwwwwrx',
      '.xrWwWwWWwwvwwrx.',
      '..xxrrrrrrrrrxx..',
      '....xxxxxxxxx....',
    ],
    spear: [
      'xx..................',
      'xWxx................',
      '.xwWxx..........xx..',
      '..xxwWxx......xxSx..',
      '....xxwWxx..xxSSsxx.',
      '......xxwx.xwxzzsSsx',
      '........x..xwwxxxxx.',
      '............xx......',
    ],
    bone: [
      'x.....x',
      'Bxxxxxb',
      'xbbbbbd',
      'x.xxx.x',
    ],
  };
  function stampProp(S, name, x, y, dim) {
    const T = PROPS[name];
    for (let j = 0; j < T.length; j++) for (let i = 0; i < T[j].length; i++) {
      const ch = T[j][i];
      if (ch === '.' || ch === ' ') continue;
      let col = PROP_COL[ch];
      if (dim && ch !== 'x' && ch !== 'O') col = P.mix(col, '#212', dim);
      S.set(x + i, y + j, col);
    }
  }

  function paintArenaProps(S, L, w, h) {
    const yhF = L.floorC - AZ.fz;
    const at = (u0, D) => {
      const x = L.cx + u0 * AZ.a;
      const xi = clamp(Math.round(x), 0, w - 1);
      return [Math.round(x), Math.round(yhF + (L.yF[xi] - yhF) / D)];
    };
    const shadow = (x, y, rx, ry) => {
      for (let j = -ry; j <= ry; j++) for (let i = -rx; i <= rx; i++) {
        if ((i * i) / (rx * rx) + (j * j) / (ry * ry) > 1) continue;
        const X = Math.round(x + i), Y = Math.round(y + j);
        const hx = S.getHex(X, Y);
        if (hx && TH(X, Y) < 0.65) S.set(X, Y, P.shade(hx, 0.55));
      }
    };
    const place = (name, u0, D, dx, dy, sh, dim) => {
      const [x, y] = at(u0, D);
      const T = PROPS[name];
      const px = x + dx, py = y + dy;
      if (py + T.length >= h - 1 || py < L.floorC + 2 || px < -T[0].length || px > w) return;
      if (sh) shadow(px + T[0].length / 2 + 1, py + T.length - 1, sh[0], sh[1]);
      stampProp(S, name, px, py, dim);
    };
    // left: a skull and femur from some forgotten bout, ribs nearer the wall
    place('ribs', -0.56, 0.8, -5, -5, [6, 1], 0.35);
    place('femur', -0.8, 0.5, -10, -3, [7, 1], 0.1);
    place('skull', -0.66, 0.46, -3, -8, [5, 1], 0);
    place('spear', -0.86, 0.32, -10, -6, [10, 2], 0);
    // right: a broken sword stuck fast, its point nearby, a split shield
    place('sword', 0.8, 0.52, -4, -14, [5, 1], 0);
    place('tip', 0.66, 0.5, -4, -2, null, 0.1);
    place('shield', 0.7, 0.32, -8, -5, [9, 2], 0);
    // small bones by the wall foot
    place('bone', -0.2, 0.92, -3, -2, null, 0.45);
    place('bone', 0.3, 0.88, -3, -2, null, 0.45);
    place('bone', 0.98, 0.78, -3, -2, null, 0.4);
  }

  // ---------- arena animation ----------
  // Banner sprite: rod + swallow-tailed cloth with the tier emblem, flutter frame f (0..5).
  const EMBLEM = {
    1: ['.###.', '#####', '#.#.#', '.###.', '.#.#.'], // skull
    2: ['..#..', '.###.', '##.##', '.###.', '..#..'], // bronze sun
    3: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'], // crossed blades
    4: ['#.#.#', '#####', '#####'],                   // crown
  };
  const bannerSprite = (tier, f) => K.cached(`dw27|banner|${tier}|${f}`, 15, 27, S => {
    const T = TIER[tier];
    const ph = f / 6 * TAU;
    const top = 2, len = 21, x0 = 3, bw = 9;
    const off = r => Math.sin(ph + r * 0.28) * (r / len) * 1.6 + Math.sin(ph * 2 + r * 0.5) * (r / len) * 0.5;
    const cells = [];
    for (let r = 0; r < len; r++) {
      const o = off(r);
      for (let i = 0; i < bw; i++) {
        // swallowtail notch
        if (r > len - 6 && Math.abs(i - (bw - 1) / 2) < (r - (len - 6)) * 0.9) continue;
        cells.push([x0 + i + Math.round(o), top + r, i, r]);
      }
    }
    // shadow on the wall behind
    for (const [x, y] of cells) if (TH(x + 2, y + 1) < 0.55) S.set(x + 2, y + 1, '#000');
    for (const [x, y, i, r] of cells) {
      const fold = Math.cos((i / bw) * TAU * 1.25 + ph * 0.5 + r * 0.06);
      let v = 3.2 + fold * 1.1 - (i / bw) * 1.2 - r * 0.04;
      const edge = i === 0 || i === bw - 1 || (r > len - 7 && !cells.some(c => c[2] === i && c[3] === r + 1));
      if (edge || r < 2) { S.set(x, y, T.trim[clamp(Math.round(1 + fold * 0.8 + (i === 0 ? 1 : 0)), 0, 3)]); continue; }
      let ci = Math.floor(v); if (v - ci > TH(x, y)) ci++;
      S.set(x, y, T.cloth[clamp(ci, 0, T.cloth.length - 1)]);
    }
    // emblem
    const E = EMBLEM[tier], eh = E.length, ew = E[0].length;
    const ey = top + 7 - (eh > 4 ? 1 : 0);
    for (let j = 0; j < eh; j++) for (let i = 0; i < ew; i++) {
      if (E[j][i] !== '#') continue;
      const r = ey - top + j;
      const x = x0 + 2 + i + Math.round(off(r)), y = ey + j;
      S.set(x, y, (i + j) % 3 === 0 ? T.emb[1] : T.emb[0]);
    }
    // rod with finials
    for (let x = 0; x < 15; x++) S.set(x, 1, x < 2 || x > 12 ? '#432' : '#210');
    S.set(1, 0, '#654'); S.set(13, 0, '#654'); S.set(0, 1, '#765');
    S.set(7, 0, '#101');
  });

  // Small swallow-tail pennant flying to the right from a mast top, 4 frames.
  const pennantSprite = (tier, f) => K.cached(`dw27|pennant|${tier}|${f}`, 12, 7, S => {
    const T = TIER[tier];
    const ph = f / 4 * TAU;
    for (let i = 0; i < 10; i++) {
      const wave = Math.sin(ph - i * 0.7) * (i / 10) * 1.4;
      const half = 2.2 * (1 - i / 11);
      const cy = 3 + wave;
      for (let y = Math.floor(cy - half); y <= Math.ceil(cy + half); y++) {
        if (Math.abs(y + 0.5 - cy) > half) continue;
        if (i > 6 && Math.abs(y + 0.5 - cy) < (i - 6) * 0.4) continue;   // forked tail
        const lit = Math.cos(ph - i * 0.7) > 0.3 ? 1 : 0;
        S.set(1 + i, y, T.cloth[clamp(3 + lit + (y + 0.5 < cy ? 1 : 0), 0, T.cloth.length - 1)]);
      }
    }
    S.rect(0, 0, 1, 7, '#101');
  });

  function arenaAnim(ctx, ox, oy, w, h, t, st, live) {
    const L = arenaLayout(w, h);
    const tier = clamp((st.tier | 0) || 1, 1, 4);
    const cheer = clamp(live.cheer !== undefined ? live.cheer : 0.2, 0, 1);
    // pennants on the velarium masts
    if (L.yOf(L.cx, AZ.attic) > 6) {
      for (let n = -6; n <= 6; n++) {
        const xc = L.xOf(n * 44 + 22);
        if (xc < -2 || xc > w + 8) continue;
        const yt = L.yOf(xc, AZ.attic + 26);
        const f = Math.floor(t * 7 + n * 1.7) & 3;
        G.blit(pennantSprite(tier, (f + 4) % 4), ox + Math.floor(xc), oy + Math.round(yt) - 1, { ctx });
      }
    }
    // banners
    for (const b of L.banners) {
      const xc = L.xOf(b);
      if (xc < -10 || xc > w + 10) continue;
      const yt = L.yOf(xc, AZ.pod) - 1;
      if (yt > h) continue;
      const f = Math.floor(t * (3 + cheer * 3) + b * 0.37) % 6;
      G.blit(bannerSprite(tier, (f + 6) % 6), ox + Math.round(xc - 7.5), oy + Math.round(yt) - 1, { ctx });
    }
    // crowd: bobbing heads and raised arms
    const act = 0.1 + cheer * 0.5;
    for (const p of L.people) {
      const n = U.noise1(t * p.rate * 0.7 + p.ph, 7);
      if (n < 1 - act) continue;
      const a = (n - (1 - act)) / act;
      const hop = Math.abs(Math.sin(t * (5 + p.rate * 3) + p.ph));
      const lift = clamp(Math.round(hop * (cheer > 0.55 ? 2 : 1) * Math.min(1, a * 2.5)), 0, 2);
      const X = ox + p.x, Y = oy + p.y;
      if (lift > 0) G.blit(bobSprite(p.kind, p.tpl, p.cloth, p.hair, p.lv, p.rim, lift), X, Y - lift, { ctx });
      if (cheer > 0.25 && a > 0.4 && p.arm < 0.2 + cheer * 0.7) {
        const sil = p.kind === 'sil';
        const lv = Math.min(4, p.lv + 1);
        const sleeve = sil ? '#101' : CLOTH[p.cloth][clamp(p.lv - 1, 0, 4)];
        const fore = sil ? '#101' : SKIN[lv][0], fist = sil ? '#101' : SKIN[lv][1];
        const up = 3 + (hop > 0.5 ? 1 : 0);
        const both = p.arm < 0.3;
        const side = Math.floor(p.arm * 100) & 1;
        const yb = Y - lift + 4;
        for (const sd of both ? [0, 1] : [side]) {
          const ax = sd ? X + 6 : X + 1, dir = sd ? 1 : -1;
          const sway = hop > 0.7 ? dir : 0;
          G.rect(ax, yb - 1, 1, 2, sleeve, ctx);
          G.rect(ax, yb - up, 1, up - 1, fore, ctx);
          G.rect(ax + sway, yb - up - 1, 1, 1, fist, ctx);
          // a few fans wave rags in the ring's colours
          if (p.arm < 0.07 && !sil) {
            const tc = TIER[tier].cloth, fx = ax + sway + (Math.sin(t * 9 + p.ph) > 0 ? dir : 0);
            G.rect(fx, yb - up - 3, 2, 2, tc[4], ctx);
            G.rect(fx + (dir > 0 ? 1 : 0), yb - up - 3, 1, 1, tc[5], ctx);
          }
        }
      }
    }
    // torch flames, halo flicker, embers
    const fr = Math.floor(t * 12);
    for (let i = 0; i < L.torches.length; i++) {
      const p = L.torches[i];
      const xc = L.xOf(p);
      if (xc < -8 || xc > w + 8) continue;
      const yb = L.yOf(xc, 21);
      const fl = U.noise1(t * 6 + i * 3.3, 11);
      const hr = 11;
      G.blit(haloSprite(hr, 0.25 + fl * 0.3, '#a52'), ox + Math.round(xc - 0.5) - hr, oy + Math.round(yb) - 6 - hr, { ctx });
      G.blit(torchFlame((fr + i * 3) % NF), ox + Math.round(xc - 0.5) - 4, oy + Math.round(yb) - 14, { ctx });
    }
    drawEmbers(ctx, remember(`arEmb|${w}x${h}`, () => {
      const out = [], r = U.rng(55);
      for (const p of L.torches) {
        const xc = L.xOf(p), yb = L.yOf(xc, 21);
        for (let i = 0; i < 2; i++) out.push({ x: xc - 0.5 + (r() - 0.5) * 2, y: yb - 10, rise: 18 + r() * 22, rate: 0.35 + r() * 0.4, ph: r(), wob: 2 + r() * 3, amp: 1 + r() * 1.5, dx: (r() - 0.3) * 6 });
      }
      return out;
    }), t, ox, oy);
  }

  A.scenes['arena'] = {
    paint: paintArena,
    animate: arenaAnim,
  };

  // ================================================================
  // SHOP INTERIORS — shared pieces
  // ================================================================
  // Hue-shifted ramps: cool blue-violet shadows climbing to warm highlights,
  // so every prop sits in "firelight against the night" without extra work.
  const R_STEEL = ['#001', '#112', '#223', '#334', '#545', '#765', '#a86', '#dc9', '#ffd'];
  const R_COLD = ['#001', '#012', '#123', '#234', '#346', '#568', '#89b', '#bce'];
  const R_WOOD = ['#000', '#100', '#210', '#320', '#431', '#642', '#863', '#a75'];
  const R_LEATH = ['#100', '#200', '#310', '#420', '#531', '#742', '#953'];
  const R_SOOT = ['#000', '#101', '#111', '#212', '#322', '#432', '#643', '#854'];
  const R_BRASS = ['#100', '#210', '#430', '#640', '#861', '#b82', '#da4', '#fd7'];

  // Bayer-dithered pick along a single ramp, v in 0..1.
  const rampPick = (ramp, v, x, y) => P.rampF(ramp, clamp(v, 0, 1), x, y);
  function falloff(x, y, lx, ly, r, fy = 1) {
    const dx = x + 0.5 - lx, dy = (y + 0.5 - ly) * fy;
    const d = Math.sqrt(dx * dx + dy * dy) / r;
    return d < 1 ? (1 - d) * (1 - d) : 0;
  }
  // A layer of props: painted with the kit, outlined, then stamped.
  function layer(S, fn, o = {}) {
    const T = K.create(S.w, S.h);
    if (o.light) T.light = K.norm3(o.light);
    if (o.ambient !== undefined) T.ambient = o.ambient;
    fn(T);
    if (o.outline !== false) T.outline(o.ink || '#101');
    S.stamp(T, 0, 0);
    return T;
  }
  // Rough stone block courses in screen pixels (x joints per course).
  const WALL_C = makeCourses(301, 24, 9, 20, 400);
  function roughStone(x, y, ch, seed) {
    const ci = Math.floor(y / ch), zc = y - ci * ch;
    const B = findBlock(WALL_C[(ci + seed) % WALL_C.length], x - 200 + seed * 7);
    if (zc === ch - 1 || B.ls < 1) return 0.12;
    let b = 0.34 + hash2(B.i, ci + seed, 9) * 0.1;
    if (zc === 0) b += 0.08;
    else if (zc === ch - 2) b -= 0.06;
    if (B.ls < 2) b += 0.05;
    else if (B.ls >= B.bw - 1) b -= 0.06;
    return b + (vnoise(x * 0.3, y * 0.3, seed) - 0.5) * 0.1;
  }

  // ================================================================
  // SMITHY — a roaring forge, anvil, racks of blades, a moonlit window
  // ================================================================
  const SM_WALL = [
    ['#000', '#001', '#011', '#012', '#112', '#123', '#223', '#234', '#345', '#456'],
    ['#000', '#101', '#111', '#212', '#222', '#323', '#333', '#434', '#544', '#655'],
    ['#100', '#200', '#311', '#321', '#432', '#542', '#653', '#764', '#975', '#a86'],
    ['#100', '#310', '#420', '#530', '#641', '#752', '#a63', '#c84', '#ea6', '#fc8'],
  ];

  function smithLayout(w, h) {
    return remember(`sm|${w}x${h}`, () => {
      const L = { w, h };
      L.yF = h - 22;
      L.fx0 = 2; L.fx1 = 80;                                   // forge body
      L.bodyTop = L.yF - 45; L.hoodTop = L.bodyTop - 13;
      L.cx0 = 27; L.cx1 = 55;                                  // chimney
      L.m = { cx: 41, rx: 24, spring: L.yF - 24, ry: 13, ledge: L.yF - 13 };   // arched mouth
      L.m.top = L.m.spring - L.m.ry;
      L.fire = { x: L.m.cx, y: L.m.ledge - 6 };
      L.win = { x0: w - 56, x1: w - 36, y0: Math.max(9, L.yF - 70), y1: L.yF - 47 };
      L.anv = { x: w - 76, y: L.yF - 27 };
      L.bar = { x0: w - 27, x1: w - 5, y0: L.yF - 18 };
      L.rack = { x0: 96, x1: Math.max(118, w - 104), y0: L.yF - 66, y1: L.yF - 29 };
      return L;
    });
  }
  const inMouth = (L, x, y) => {
    const m = L.m, dx = (x + 0.5 - m.cx) / m.rx;
    if (dx <= -1 || dx >= 1 || y >= m.ledge) return false;
    return y + 0.5 >= m.spring - m.ry * Math.sqrt(1 - dx * dx);
  };

  function paintSmithy(S, w, h) {
    const L = smithLayout(w, h);
    const fx = L.fire.x, fy = L.fire.y, m = L.m;
    const W = L.win;
    const fireAt = (x, y) => {
      const dx = x + 0.5 - fx, dy = (y + 0.5 - fy) * 1.15;
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, 1 - d / (w * 0.92));
      return a * a * 1.05 + Math.max(0, 1 - d / 44) * 0.4;
    };
    const shaftAt = (x, y) => {
      if (y < W.y1) return 0;
      const xw = x + 0.5 + (y + 0.5 - W.y1) * 0.62;
      if (xw < W.x0 + 2 || xw > W.x1 - 2) return 0;
      const edge = Math.min(xw - W.x0 - 2, W.x1 - 2 - xw) / 4;
      return clamp(edge, 0, 1) * Math.max(0, 1 - (y - W.y1) / (L.yF - W.y1 + 24));
    };

    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const lf = fireAt(x, y);
      // ---- chimney + hood: soot-black brick, the hood lip lit from below ----
      if (y < L.bodyTop) {
        let l = L.cx0, r = L.cx1;
        if (y >= L.hoodTop) {
          const t = (y - L.hoodTop) / (L.bodyTop - L.hoodTop);
          l = L.cx0 + (L.fx0 - L.cx0) * t; r = L.cx1 + (L.fx1 - L.cx1) * t;
        }
        if (x >= l - 0.5 && x < r + 0.5) {
          const row = Math.floor(y / 4), off = (row & 1) * 4;
          const mortar = (y % 4 === 3) || ((x + off) % 9 === 0);
          let b = mortar ? 0.12 : 0.27 + hash2((x + off) / 9 | 0, row, 3) * 0.08;
          if (x < l + 1.5) b += 0.1;
          else if (x > r - 1.5) b -= 0.08;
          if (y >= L.hoodTop && y < L.hoodTop + 2) b = y === L.hoodTop ? 0.45 : 0.2;   // hood shoulder ledge
          b += (vnoise(x * 0.2, y * 0.2, 7) - 0.5) * 0.08;
          const up = y >= L.hoodTop ? 0.5 * (y - L.hoodTop) / (L.bodyTop - L.hoodTop) : 0;
          S.set(x, y, pick(SM_WALL, b * (0.35 + lf * 0.55 + up), 0.2 + lf * 0.6 + up * 0.5, x, y));
          continue;
        }
      }
      // ---- forge body ----
      if (x >= L.fx0 && x < L.fx1 && y >= L.bodyTop && y < L.yF) {
        // the arched mouth: firebrick glowing hotter toward the coals
        if (inMouth(L, x, y)) {
          const t = (y - m.top) / (m.ledge - m.top);
          const row = Math.floor(y / 3), off = (row & 1) * 3;
          const mortar = (y % 3 === 2) || ((x + off) % 6 === 0);
          const side = Math.abs(x + 0.5 - m.cx) / m.rx;
          const b = (mortar ? 0.3 : 0.5) * (0.25 + t * 0.8) * (1 - side * 0.35);
          S.set(x, y, pick(SM_WALL, b, 0.75 + t * 0.25, x, y));
          continue;
        }
        // voussoirs ringing the mouth
        const dx = (x + 0.5 - m.cx), dy = (y + 0.5 - m.spring);
        const rr = Math.hypot(dx / (m.rx + 5), Math.min(0, dy) / (m.ry + 5));
        const ringIn = Math.hypot(dx / m.rx, Math.min(0, dy) / m.ry);
        if (y < m.ledge && rr < 1 && ringIn >= 1) {
          const ang = Math.atan2(Math.min(0, dy) / (m.ry + 2), dx / (m.rx + 2));
          const seg = ang / (Math.PI / 9);
          const joint = Math.abs(seg - Math.round(seg)) < 0.12 || rr > 0.93;
          const inner = ringIn < 1.08;
          const key = Math.abs(ang + Math.PI / 2) < 0.17;
          let b = joint ? 0.14 : key ? 0.5 : 0.4;
          if (dx > 0 && !joint) b -= 0.06;
          S.set(x, y, pick(SM_WALL, inner && !joint ? 0.62 : b * (0.45 + lf * 0.8), inner ? 1 : 0.4 + lf * 0.7, x, y));
          continue;
        }
        // hearth ledge in front of the coals
        if (y >= m.ledge && y < m.ledge + 3 && Math.abs(x + 0.5 - m.cx) < m.rx + 3) {
          const b = y === m.ledge ? 0.7 : y === m.ledge + 1 ? 0.5 : 0.18;
          S.set(x, y, pick(SM_WALL, b, 0.85, x, y));
          continue;
        }
        // ash pit with a dull red glow
        const ap = Math.hypot((x + 0.5 - m.cx) / 7, Math.min(0, y + 0.5 - (L.yF - 4)) / 4);
        if (y > m.ledge + 4 && ap < 1) {
          const t = (y - (L.yF - 8)) / 8;
          S.set(x, y, rampPick(['#000', '#100', '#200', '#300', '#410', '#620'], 0.15 + t * 0.6 + (hash2(x, y, 4) > 0.8 ? 0.2 : 0), x, y));
          continue;
        }
        // mantel ledge on top of the body
        if (y < L.bodyTop + 3) {
          const b = y === L.bodyTop ? 0.55 : y === L.bodyTop + 1 ? 0.42 : 0.14;
          S.set(x, y, pick(SM_WALL, b * (0.5 + lf * 0.7), 0.35 + lf * 0.6, x, y));
          continue;
        }
        // ashlar
        const ci = Math.floor((y - L.bodyTop - 3) / 6), zc = (y - L.bodyTop - 3) - ci * 6;
        let b = ashlar(POD_C[ci % POD_C.length], x * 1.1 + 40, 5 - zc, 6, ci + 300);
        if (x < L.fx0 + 1) b += 0.08;
        if (x >= L.fx1 - 1) b -= 0.1;
        b += (vnoise(x * 0.3, y * 0.3, 11) - 0.5) * 0.08;
        S.set(x, y, pick(SM_WALL, b * (0.4 + lf * 0.75), 0.3 + lf * 0.65, x, y));
        continue;
      }
      // ---- ceiling beam ----
      if (y < 6) {
        let b = y === 5 ? 0.12 : y === 4 ? 0.4 : 0.28 + (y === 0 ? -0.08 : 0);
        b += (vnoise(x * 0.15, y, 4) - 0.5) * 0.12;
        if ((x + 7) % 41 === 0 && y === 2) b = 0.7;
        S.set(x, y, rampPick(R_WOOD, b * (0.55 + lf * 0.9), x, y));
        continue;
      }
      // ---- window ----
      if (x >= W.x0 - 2 && x < W.x1 + 2 && y >= W.y0 - 2 && y < W.y1 + 2) {
        const r = (W.x1 - W.x0) / 2, cxw = (W.x0 + W.x1) / 2, ya = W.y0 + r;
        const dArch = Math.hypot(x + 0.5 - cxw, y + 0.5 - ya);
        const inArch = y >= ya || dArch < r;
        const inFrame = y >= ya - 2 || dArch < r + 2;
        if (inArch && x >= W.x0 && x < W.x1 && y < W.y1) {
          const bar = (x - W.x0) % 5 === 2 || (y - W.y0) % 7 === 6;
          if (bar) S.set(x, y, '#101');
          else {
            const v = 0.25 + (1 - (y - W.y0) / (W.y1 - W.y0)) * 0.35 + (x - W.x0) / (W.x1 - W.x0) * 0.2;
            S.set(x, y, rampPick(['#012', '#123', '#134', '#245', '#357'], v, x, y));
            if (hash2(x, y, 33) > 0.95) S.set(x, y, '#68a');
          }
          continue;
        }
        if (inFrame) {
          const sill = y >= W.y1;
          const b = sill ? (y === W.y1 ? 0.6 : 0.28) : (x < cxw ? 0.42 : 0.26);
          S.set(x, y, pick(SM_WALL, b * (0.55 + lf * 0.5) + 0.08, 0.12 + lf * 0.4, x, y));
          continue;
        }
      }
      const sh = shaftAt(x, y);
      // ---- floor: flagstones ----
      if (y >= L.yF) {
        const yy = y - L.yF;
        const rows = [0, 4, 9, 15, 22, 30, 40];
        let ri = 0; while (ri < rows.length - 1 && yy >= rows[ri + 1]) ri++;
        const rh = rows[ri + 1] - rows[ri], ry = yy - rows[ri];
        const sw = 14 + ri * 5, off = hash2(ri, 1, 2) * sw;
        const xi = Math.floor((x + off) / sw), lx = (x + off) - xi * sw;
        let b = 0.3 + hash2(xi, ri, 6) * 0.1;
        if (ry === rh - 1 || lx < 1) b = 0.1;
        else if (ry === 0) b += 0.1;
        b += (hash2(x, y, 8) - 0.5) * 0.06;
        if (yy < 2) b *= 0.55;
        S.set(x, y, pick(SM_WALL, b * (0.35 + lf * 1.1) + sh * 0.3, 0.12 + lf * 1.1 - sh * 0.6, x, y));
        continue;
      }
      // ---- back wall ----
      let b = roughStone(x, y, 7, 3);
      const soot = Math.max(0, 1 - Math.hypot(x - (L.cx0 + L.cx1) / 2, (y - L.hoodTop) * 0.6) / 64);
      b *= 1 - soot * 0.55;
      S.set(x, y, pick(SM_WALL, b * (0.3 + lf * 1.0) + sh * 0.22, 0.12 + lf * 1.1 - sh * 0.7, x, y));
    }

    // ---- coal bed inside the mouth ----
    for (let y = m.ledge - 5; y < m.ledge; y++) for (let x = m.cx - m.rx + 2; x < m.cx + m.rx - 2; x++) {
      const k = (x - (m.cx - m.rx + 2)) / (2 * m.rx - 4);
      const top = m.ledge - 1 - Math.sin(k * Math.PI) * 4 - (vnoise(x * 0.5, 1, 8) - 0.5) * 2;
      if (y + 0.5 < top) continue;
      const n = vnoise(x * 0.7, y * 0.9, 12);
      const hot = n > 0.56 ? 6 : n > 0.43 ? 4 : n > 0.3 ? 2 : 1;
      S.set(x, y, FIRE[clamp(hot + (y > m.ledge - 2 ? 1 : 0) + (TH(x, y) > 0.7 ? -1 : 0), 1, 7)]);
    }

    // ---- racks of blades ----
    const RK = L.rack;
    const lightL = [-0.85, -0.3, 0.45];
    const BLADE = ['#101', '#112', '#223', '#334', '#445', '#556', '#778', '#998', '#cb9'];
    layer(S, T => {
      const n = Math.max(3, Math.floor((RK.x1 - RK.x0) / 11) + 1);
      const sp = (RK.x1 - RK.x0) / Math.max(1, n - 1);
      const mid = n >= 7 ? Math.floor(n / 2) : -9;
      for (let i = 0; i < n; i++) {
        if (i === mid) continue;
        const x = Math.round(RK.x0 + i * sp);
        const kind = (i * 7 + 3) % 4;
        const top = RK.y0 + (kind === 1 ? 0 : kind === 2 ? 4 : 2);
        const len = RK.y1 - top - (kind === 3 ? 5 : 1);
        const lit = clamp(1.25 - (x - fx) / (w * 0.8), 0.3, 1);
        const bw = kind === 1 ? 2.1 : kind === 2 ? 1.5 : 1.7;
        const y0 = top + 8, y1 = top + len - 3;
        for (let y = y0; y <= y1 + 3; y++) {
          const k = y > y1 ? (y1 + 3.5 - y) / 3.5 : 1;          // tapering point
          const half = Math.max(0.5, bw * k);
          for (let xx = Math.floor(x - half); xx <= Math.ceil(x + half) - 1; xx++) {
            const u0 = (xx + 0.5 - x) / half;                     // -1 left edge … 1 right edge
            let v = u0 < -0.5 ? 0.55 + lit * 0.35 : u0 < 0 ? 0.42 : Math.abs(u0) < 0.3 ? 0.3 : 0.22;
            if (Math.abs(u0) < 0.25 && y > y0 + 1 && y < y1 - 2) v = 0.18;   // fuller groove
            T.set(xx, y, rampPick(BLADE, v * (0.6 + lit * 0.5), xx, y));
          }
        }
        const gc = kind === 3 || kind === 0 ? R_BRASS : R_STEEL;
        const hi = Math.round(3 + lit * 4);
        T.capsule(x - 4.2, top + 7, x + 4.2, top + 7, 1, 1, gc, { hi });
        T.capsule(x, top + 2.5, x, top + 5.5, 1, 1, R_LEATH, { hi: 5 });
        T.ball(x, top + 1.5, 1.5, 1.5, gc, { hi });
      }
      for (const ry of [RK.y0 + 9, RK.y1 - 5]) T.capsule(RK.x0 - 5, ry, RK.x1 + 5, ry, 1.3, 1.3, R_WOOD, { hi: 6 });
      if (mid >= 0) {
        // a round shield hung over the middle of the rack: planks, iron rim, boss, a painted chevron
        const sx = RK.x0 + mid * sp, sy = (RK.y0 + RK.y1) / 2 + 1, sr = 9;
        T.ball(sx, sy, sr, sr, R_WOOD, { hi: 6, depth: 0.35 });
        T.recolor((px, py) => Math.hypot(px + 0.5 - sx, py + 0.5 - sy) < sr - 1.5 && Math.abs((py + 0.5 - sy) + Math.abs(px + 0.5 - sx) * 0.7 - 1) < 2.2,
          (hx, px, py) => (px < sx ? '#a32' : '#712'));
        T.recolor((px, py) => { const d = Math.hypot(px + 0.5 - sx, py + 0.5 - sy); return d >= sr - 1.5 && d < sr + 0.7; }, (hx, px, py) => (px + py < sx + sy ? '#778' : '#334'));
        T.ball(sx, sy, 2.4, 2.4, R_STEEL, { hi: 7, spec: 0.7 });
      }
    }, { light: lightL });

    // ---- crossed axes beside the rack ----
    layer(S, T => {
      const ax = RK.x1 + 17, ay = RK.y0 + 4;
      const lit = clamp(1.2 - (ax - fx) / (w * 0.8), 0.3, 1), hi = Math.round(3 + lit * 3);
      for (const sd of [-1, 1]) {
        T.capsule(ax - sd * 9, ay + 26, ax + sd * 6, ay + 1, 1.2, 1.2, R_WOOD, { hi: 6 });
        const hx = ax + sd * 6, hy = ay + 2;
        T.poly([[hx, hy - 3], [hx + sd * 5, hy - 7], [hx + sd * 8.5, hy - 1], [hx + sd * 8, hy + 4], [hx + sd * 5, hy + 7], [hx, hy + 3]], BLADE, { grad: [hx - 2, hy - 6, hx + 6, hy + 6, 0.75, 0.25] });
        T.line(hx + sd * 8, hy - 1, hx + sd * 7.5, hy + 4, BLADE[hi + 1]);
      }
    }, { light: lightL });

    // ---- tongs hung on a nail by the window (when there is room) ----
    layer(S, T => {
      const gx0 = RK.x1 + 29, gx1 = W.x0 - 3;
      if (gx1 - gx0 < 16) return;
      const tx = Math.round((gx0 + gx1) / 2), ty = L.yF - 66;
      T.capsule(tx - 1, ty, tx - 3, ty + 15, 0.7, 0.7, R_STEEL, { hi: 5 });
      T.capsule(tx + 1, ty, tx + 3, ty + 15, 0.7, 0.7, R_STEEL, { hi: 4 });
      T.ball(tx, ty + 0.5, 1.4, 1.2, R_STEEL, { hi: 5 });
    }, { light: lightL });

    // ---- bellows feeding the forge: teardrop boards, pleated leather, brass nozzle ----
    layer(S, T => {
      const bx = L.fx1 + 4, by = L.yF - 14;
      const drop = (dy, sc) => [[0, 0], [7, -3], [15, -6], [23, -7.5], [29, -6.5], [32, -3], [31.5, 1], [28, 3.5], [20, 4], [11, 3], [4, 1.5]]
        .map(([px, py]) => [bx + px, by + dy + py * sc]);
      T.poly(drop(6, 0.9), R_WOOD, { tone: 0.25 });                                    // bottom board
      T.poly(drop(4.5, 1), R_LEATH, { grad: [bx, by - 2, bx, by + 10, 0.65, 0.15] });   // leather sides
      for (let i = 0; i < 3; i++) {
        const pl = drop(2 + i * 1.5, 1);
        for (let k = 3; k < 9; k++) T.line(pl[k][0], pl[k][1], pl[k + 1][0], pl[k + 1][1], i === 1 ? '#742' : '#531');
      }
      T.poly(drop(0, 1), R_WOOD, { grad: [bx, by - 7, bx + 30, by + 3, 0.95, 0.35] });   // top board
      T.line(bx + 8, by - 2, bx + 27, by - 5, '#310');                                  // grain
      T.ball(bx + 22, by - 2, 2, 1.3, R_BRASS, { hi: 7 });                              // valve plate
      T.capsule(bx - 6, by + 2, bx + 2, by + 1.5, 1.2, 1.6, R_BRASS, { hi: 7, spec: 0.6 });   // nozzle
      T.capsule(bx + 31, by - 2, bx + 37, by - 9, 1, 1, R_WOOD, { hi: 6 });              // handle
      T.ball(bx + 37.5, by - 9.5, 1.5, 1.5, R_WOOD, { hi: 7 });
    }, { light: [-0.8, -0.4, 0.45] });

    // ---- the anvil on its stump, a hot blade, a hammer ----
    layer(S, T => {
      const ax = L.anv.x, ay = L.anv.y;
      // stump
      T.poly([[ax - 11, ay + 12], [ax + 11, ay + 12], [ax + 12, L.yF + 4], [ax - 12, L.yF + 4]], R_WOOD, { grad: [ax - 12, 0, ax + 12, 0, 0.8, 0.15] });
      for (let i = -8; i <= 8; i += 4) T.line(ax + i, ay + 14, ax + i + (i > 0 ? 1 : 0), L.yF + 3, '#210');
      T.ellipse(ax, ay + 12, 11, 1.8, '#642');
      T.capsule(ax - 12, ay + 18, ax + 12, ay + 18, 0.9, 0.9, R_STEEL, { hi: 5 });
      // anvil: feet, waist, body, horn, heel
      T.poly([[ax - 11, ay + 12], [ax - 8, ay + 8], [ax + 9, ay + 8], [ax + 12, ay + 12]], R_STEEL, { grad: [ax - 11, 0, ax + 12, 0, 0.6, 0.15], hi: 7 });
      T.poly([[ax - 5, ay + 8], [ax - 6, ay + 4], [ax + 7, ay + 4], [ax + 6, ay + 8]], R_STEEL, { grad: [ax - 6, 0, ax + 7, 0, 0.65, 0.15], hi: 7 });
      T.poly([[ax - 11, ay - 3], [ax + 15, ay - 3], [ax + 14, ay + 1], [ax + 9, ay + 4], [ax - 8, ay + 4], [ax - 10, ay + 1]], R_STEEL, { grad: [ax - 11, ay - 3, ax + 14, ay + 4, 0.8, 0.2], hi: 8 });
      T.horn(ax - 11, ay - 1.5, ax - 18, ay - 1, ax - 25, ay - 4, 3, 0.6, R_STEEL, { hi: 8, spec: 0.7 });
      T.rect(ax - 11, ay - 3, 26, 1, '#dc9');
      T.rect(ax + 5, ay - 3, 10, 1, '#a86');
      T.rect(ax - 10, ay - 2, 3, 1, '#765');
      // a blade fresh from the fire
      T.capsule(ax - 9, ay - 4.5, ax + 8, ay - 4, 1.1, 0.8, ['#300', '#610', '#920', '#c40', '#e70', '#fa2', '#fd5'], { tone: 0.72 });
      T.capsule(ax + 8, ay - 4, ax + 14, ay - 4.5, 0.8, 0.8, R_STEEL, { hi: 6 });
      // hammer leaning on the heel
      T.capsule(ax + 9, ay - 5, ax + 22, ay - 13, 1, 0.9, R_WOOD, { hi: 6 });
      T.poly([[ax + 5, ay - 9], [ax + 12, ay - 9], [ax + 12, ay - 4], [ax + 5, ay - 4]], R_STEEL, { grad: [ax + 5, ay - 9, ax + 12, ay - 4, 0.85, 0.25], hi: 7 });
    }, { light: [-0.85, -0.25, 0.5] });

    // ---- quench barrel ----
    layer(S, T => {
      const { x0, x1, y0 } = L.bar, cx = (x0 + x1) / 2, rx = (x1 - x0) / 2;
      T.poly([[x0, y0], [x1, y0], [x1 - 1, L.yF + 5], [x0 + 1, L.yF + 5]], R_WOOD, { grad: [x0, 0, x1, 0, 0.62, 0.15] });
      for (let x = x0 + 3; x < x1 - 1; x += 4) T.line(x, y0 + 2, x, L.yF + 4, '#100');
      for (const yy of [y0 + 4, y0 + 14]) T.capsule(x0, yy, x1, yy, 0.8, 0.8, R_STEEL, { hi: 5 });
      T.ellipse(cx, y0, rx, 2, '#320');
      T.ellipse(cx, y0 + 0.5, rx - 1.5, 1.2, '#123');
      T.rect(Math.round(cx - 5), y0, 4, 1, '#469');
    }, { light: [-0.7, -0.5, 0.5] });

    // ---- tongs and a poker leaning on the forge ----
    layer(S, T => {
      T.capsule(L.fx0 + 5, m.ledge + 4, L.fx0 + 9, L.yF + 2, 0.7, 0.7, R_STEEL, { hi: 7 });
      T.capsule(L.fx0 + 7, m.ledge + 3, L.fx0 + 8, L.yF + 2, 0.7, 0.7, R_STEEL, { hi: 5 });
      T.capsule(L.fx1 - 6, m.ledge + 2, L.fx1 - 2, L.yF + 2, 0.7, 0.7, R_STEEL, { hi: 6 });
    });

    // ---- hot air: glow spilling from the mouth over the forge front ----
    for (let y = m.top - 8; y < L.yF + 4; y++) for (let x = 0; x < L.fx1 + 26; x++) {
      if (inMouth(L, x, y)) continue;
      const a = falloff(x, y, fx, fy, 40, 1.25);
      if (a * 0.5 > TH(x, y) + 0.1) S.set(x, y, P.mix(S.getHex(x, y), '#f92', 0.2));
    }
  }

  // Forge flames: irregular tongues clipped to the arched mouth, cached per frame.
  function smithFire(L, f) {
    const m = L.m, fw = m.rx * 2, fh = m.ledge - m.top;
    return K.cached(`dw27|smfire|${fw}|${fh}|${f}`, fw, fh, S => {
      const base = fh - 3;
      paintFire(S, [
        { cx: fw * 0.5, base, h: fh * 0.98, hw: 6.5, sway: 2, ph: 0 },
        { cx: fw * 0.36, base, h: fh * 0.75, hw: 5, sway: 1.8, ph: 1.7 },
        { cx: fw * 0.64, base, h: fh * 0.82, hw: 5, sway: 1.6, ph: 3.4 },
        { cx: fw * 0.22, base, h: fh * 0.45, hw: 3.5, sway: 1.2, ph: 4.9 },
        { cx: fw * 0.8, base, h: fh * 0.5, hw: 3.5, sway: 1.3, ph: 2.6 },
        { cx: fw * 0.44, base: base - fh * 0.55, h: fh * 0.3, hw: 2, sway: 2.5, ph: 5.5 },
      ], f, { lo: 2 });
      // keep it inside the arch
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (!inMouth(L, x + m.cx - m.rx, y + m.top)) S.set(x, y, 0);
    });
  }

  function smithyAnim(ctx, ox, oy, w, h, t) {
    const L = smithLayout(w, h), m = L.m;
    const f = Math.floor(t * 12) % NF;
    G.blit(smithFire(L, f), ox + m.cx - m.rx, oy + m.top, { ctx });
    // the coals breathe
    const br = U.noise1(t * 3, 5);
    G.blit(haloSprite(9, 0.15 + br * 0.3, '#fa2'), ox + m.cx - 9 - 8, oy + m.ledge - 12, { ctx });
    G.blit(haloSprite(9, 0.15 + (1 - br) * 0.3, '#fa2'), ox + m.cx - 9 + 9, oy + m.ledge - 12, { ctx });
    // the blade on the anvil cools and glows
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    const ax = L.anv.x, ay = L.anv.y;
    G.rect(ox + ax - 7, oy + ay - 5, 10, 1, pulse > 0.6 ? '#ffb' : '#fd5', ctx);
    G.blit(haloSprite(7, 0.2 + pulse * 0.2, '#e70'), ox + ax - 8, oy + ay - 12, { ctx });
    // sparks leaping from the coals
    const sp = remember(`smSp|${w}x${h}`, () => {
      const r = U.rng(5), out = [];
      for (let i = 0; i < 18; i++) out.push({ x: m.cx - m.rx + 6 + r() * (m.rx * 2 - 12), y: m.ledge - 3, rise: 14 + r() * 30, rate: 0.5 + r() * 0.9, ph: r(), wob: 3 + r() * 4, amp: 0.8 + r() * 1.5, dx: (r() - 0.5) * 22 });
      return out;
    });
    drawEmbers(ctx, sp, t, ox, oy);
    // steam curling off the quench barrel
    const b = L.bar;
    for (let i = 0; i < 6; i++) {
      const life = (t * 0.35 + i / 6) % 1;
      const x = (b.x0 + b.x1) / 2 + Math.sin(t * 1.3 + i * 2) * 2 + life * 4 - 2;
      const y = b.y0 - 1 - life * 18;
      if (life < 0.85) G.rect(ox + (x | 0), oy + (y | 0), life < 0.4 ? 2 : 1, 1, life < 0.5 ? '#556' : '#334', ctx);
    }
  }

  A.scenes['smithy'] = { paint: paintSmithy, animate: smithyAnim };

})();
