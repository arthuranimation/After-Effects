// ================================================================
// HERO — Derek, seen from behind, over the shoulder (Punch-Out!!
// style), standing at the bottom of the combat stage facing the
// monster. Shield on the left arm, weapon in the right hand.
//
// The hero is a small rig. Every pose is a set of joint positions
// (shoulders, elbows, hands, head, hips) plus a shield placement and a
// weapon angle. The painter builds the figure from those joints in
// depth order (far things first), so 13 poses x 10 weapons x 5 armours
// all come out of the same handful of layer functions:
//   legs · torso · head · arms · pauldrons · shield · weapon · fist
// Each layer is painted into its own buffer and composited with a
// contour line where it overlaps earlier paint, so an arm across the
// back or a blade over a shoulder always reads as a separate form.
//
// The back is a height field (spine groove, shoulder blades, cloth
// gathers, a ridged back plate); normals come from finite differences,
// so the anatomy shades itself under the kit's upper-left light.
//
// Only rows 0..58 are visible in combat (the bottom ~12 px sit under
// the HUD bar), so every shape that matters lives above that line.
// ================================================================
(() => {
  const K = DW.kit, P = DW.pal, U = DW.util;
  const R = P.ramps;
  const A = DW.art;
  A.icons = A.icons || {};

  const W = 80, H = 72;
  const INK = '#101';
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = U.clamp;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const L2 = (() => { const l = Math.hypot(K.LIGHT[0], K.LIGHT[1]); return [K.LIGHT[0] / l, K.LIGHT[1] / l]; })();
  // Brightness of a flat facet whose 2D outward normal is (nx, ny).
  const facet = (nx, ny, base = 0.5, k = 0.42) => clamp(base + k * (nx * L2[0] + ny * L2[1]), 0, 1);

  // ---------------------------------------------------------------
  // Ramps (12-bit, dark -> light, hue-shifted: cool shadows, warm lights)
  // ---------------------------------------------------------------
  const HAIR = ['#100', '#200', '#310', '#321', '#421', '#532', '#743', '#954', '#b75'];
  const TUNIC = ['#102', '#113', '#124', '#225', '#236', '#347', '#459', '#57a', '#79c'];
  const LEATHER = ['#100', '#110', '#210', '#321', '#431', '#542', '#653', '#864', '#a86'];
  const STRAP = ['#100', '#110', '#210', '#321', '#432', '#543', '#654', '#765'];
  const TROUSER = ['#101', '#111', '#211', '#322', '#432', '#543', '#654'];
  const SKIN = ['#201', '#311', '#421', '#632', '#843', '#a53', '#c74', '#d96', '#eb8'];
  const STEEL = R.steel, GOLD = R.gold, WOOD = R.wood, PLUME = R.crimson, ICE = R.ice;
  const BLUED = ['#101', '#112', '#213', '#235', '#346', '#468', '#68a', '#9bc', '#cdf'];
  const DARKSTEEL = ['#101', '#112', '#213', '#324', '#435', '#557', '#679', '#89b'];

  const idx = ramp => new Map(ramp.map((c, i) => [P.toInt(c), i]));
  const STEEL_I = idx(STEEL), HAIR_I = idx(HAIR);

  // ---------------------------------------------------------------
  // Painting helpers
  // ---------------------------------------------------------------
  // Paint fn(L) into a fresh layer, then lay it over S. Where the layer's
  // edge sits on existing paint, draw a contour: `line` is a colour or
  // fn(underHex) -> colour (null = no contour).
  const layer = (S, fn, line = INK) => {
    const L = K.create(S.w, S.h);
    fn(L);
    const w = S.w, h = S.h, src = L.data, dst = S.data;
    if (line) {
      const fixed = typeof line === 'string' ? P.toInt(line) : 0;
      const marks = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i] || !dst[i]) continue;
        if ((x < w - 1 && src[i + 1]) || (x > 0 && src[i - 1]) || (y < h - 1 && src[i + w]) || (y > 0 && src[i - w])) marks.push(i);
      }
      for (const i of marks) dst[i] = fixed || P.toInt(line(P.fromInt(dst[i])));
    }
    for (let i = 0; i < src.length; i++) if (src[i]) dst[i] = src[i];
    return L;
  };
  const deepen = hex => P.shade(hex, 0.4);

  // Walk a line, shifting pixels that belong to `ramp` by d steps.
  const stroke = (S, map, ramp, x0, y0, x1, y1, d) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      const i = map.get(S.get(x0, y0));
      if (i !== undefined) S.set(x0, y0, ramp[clamp(i + d, 0, ramp.length - 1)]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };

  // Chain mail: staggered ring highlights over dark gaps, following the form.
  const mailTex = (L, test) => {
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const v = L.data[y * L.w + x];
      if (!v) continue;
      const i = STEEL_I.get(v);
      if (i === undefined || (test && !test(x, y))) continue;
      const ph = ((x + ((y >> 1) & 1)) & 1);
      const d = (y & 1) ? (ph ? -1 : 0) : (ph ? 1 : -1);
      L.data[y * L.w + x] = P.toInt(STEEL[clamp(i + d, 1, 7)]);
    }
  };

  // Height-field surface: zf(x, y) -> height in px, or null outside.
  // Normals by central differences; outside neighbours count as height 0.
  const surf = (L, x0, y0, x1, y1, zf, ramp, o = {}) => {
    const k = o.steep || 1;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      const px = x + 0.5, py = y + 0.5;
      const z = zf(px, py);
      if (z === null) continue;
      const zl = zf(px - 1, py), zr = zf(px + 1, py), zu = zf(px, py - 1), zd = zf(px, py + 1);
      const gx = ((zr === null ? 0 : zr) - (zl === null ? 0 : zl)) / 2;
      const gy = ((zd === null ? 0 : zd) - (zu === null ? 0 : zu)) / 2;
      const n = K.norm3([-gx * k, -gy * k, 1]);
      L.shadePx(x, y, ramp, L.lit(n, o) + (o.bias || 0), o);
    }
  };

  // ---------------------------------------------------------------
  // The rig
  // ---------------------------------------------------------------
  const ORDER_IDLE = ['shield', 'weapon', 'legs', 'torso', 'head', 'armL', 'armR', 'paulL', 'paulR', 'fistR'];

  const base = () => ({
    hip: [40, 57], waist: [40, 47], neck: [40, 27], head: [40, 18], tilt: 0, turn: 0,
    shL: [24, 32], shR: [56, 32],
    elL: [22, 43], hdL: [14, 38],
    elR: [60, 43], hdR: [64, 37],
    hipL: [35, 59], kneeL: [33, 63], footL: [32, 66],
    hipR: [45, 59], kneeR: [47, 64], footR: [48, 67],
    shield: { sx: 0.82, sy: 1, rot: 0.05, edge: [-1, 0] },
    weapon: { ang: -1.4, fk: 1, chain: [7, 12] },
    order: ORDER_IDLE,
    plume: 0,
    fx: {},
  });

  const move = (j, keys, dx, dy) => { for (const k of keys) j[k] = [j[k][0] + dx, j[k][1] + dy]; };

  const POSE = {
    idle(q) {
      const j = base();
      const f = q.f | 0;
      const b = [0, 1, 1, 0][f], hb = [0, 0, 1, 1][f];
      move(j, ['neck', 'shL', 'shR', 'elL', 'elR', 'hdL', 'hdR'], 0, -b);
      move(j, ['head'], 0, -hb);
      j.weapon.ang += [0, -0.02, -0.035, -0.015][f];
      j.weapon.rest = [0, -0.02, -0.035, -0.015][f];
      j.plume = f;
      return j;
    },

    attack(q) {
      const j = base();
      if (q.t === 0) {            // cocked back over the right shoulder
        j.shL = [26, 31]; j.shR = [57, 33]; j.neck = [41, 27]; j.head = [41, 18]; j.turn = 0.5;
        j.elR = [67, 20]; j.hdR = [53, 13];
        j.elL = [20, 42]; j.hdL = [18, 35];
        j.shield = { sx: 0.9, sy: 1, rot: 0, edge: [-1, 0] };
        j.weapon = { ang: 1.2, fk: 0.92, chain: [9, 9] };
        j.order = ['shield', 'legs', 'torso', 'head', 'armL', 'paulL', 'armR', 'paulR', 'weapon', 'fistR'];
      } else if (q.t === 1) {     // mid-swing, arcing over toward the enemy
        j.shL = [23, 33]; j.shR = [54, 30]; j.neck = [39, 27]; j.head = [39, 18]; j.turn = -0.3;
        j.elR = [61, 24]; j.hdR = [51, 16];
        j.elL = [18, 42]; j.hdL = [16, 36];
        j.weapon = { ang: -2.0, fk: 0.62, chain: [-10, -6] };
        j.fx.smear = { from: [70, 44], ctrl: [84, 6] };
        j.order = ['weapon', 'armR', 'fistR', 'shield', 'legs', 'torso', 'paulR', 'head', 'armL', 'paulL'];
      } else {                    // follow-through, down to the left
        j.shL = [22, 34]; j.shR = [52, 31]; j.neck = [38, 28]; j.head = [37, 19]; j.turn = -0.7;
        j.elR = [40, 42]; j.hdR = [25, 49];
        j.elL = [15, 37]; j.hdL = [12, 30];
        j.shield = { sx: 0.7, sy: 1, rot: -0.3, edge: [-1, 0] };
        j.weapon = { ang: 2.75, fk: 1, chain: [-10, 4] };
        j.fx.smear = { from: [44, 2], ctrl: [6, 8] };
        j.order = ['shield', 'weapon', 'armR', 'fistR', 'legs', 'torso', 'head', 'armL', 'paulL', 'paulR'];
      }
      return j;
    },

    block(q) {
      const j = base();
      if (q.dir < 0) {            // shield raised on the left
        j.shL = [22, 32]; j.shR = [54, 33]; j.neck = [38, 27]; j.head = [37, 19]; j.turn = -0.6;
        j.elL = [13, 32]; j.hdL = [15, 21];
        j.shield = { sx: 0.95, sy: 1, rot: -0.25, edge: [-1, 0] };
        j.elR = [60, 44]; j.hdR = [62, 38];
        j.weapon.ang = -1.25;
      } else if (q.dir > 0) {     // shield swept across the body to the right
        j.shL = [27, 32]; j.shR = [57, 34]; j.neck = [41, 28]; j.head = [41, 20]; j.turn = 0.4;
        j.elL = [40, 28]; j.hdL = [58, 16];
        j.shield = { sx: 0.97, sy: 1, rot: 0.22, edge: [1, 0], kite: { sx: 0.95, sy: 0.92, rot: 0.3, at: [58, 13] } };
        j.elR = [62, 45]; j.hdR = [65, 50];
        j.weapon = { ang: 1.3, fk: 1, chain: [6, 8] };
        j.order = ['shield', 'armL', 'legs', 'torso', 'paulL', 'head', 'armR', 'paulR', 'weapon', 'fistR'];
      } else {                    // shield raised overhead, head ducked
        j.neck = [40, 29]; j.head = [40, 22]; j.shL = [24, 31]; j.shR = [56, 31];
        j.elL = [21, 20]; j.hdL = [35, 9];
        j.shield = { sx: 1.05, sy: 0.5, rot: -0.08, edge: [0, -1], kite: { sx: 0.48, sy: 0.88, rot: -1.62, at: [35, 8] } };
        j.elR = [62, 43]; j.hdR = [64, 37];
        j.weapon.ang = -1.3;
        j.order = ['weapon', 'shield', 'legs', 'torso', 'head', 'armL', 'paulL', 'armR', 'paulR', 'fistR'];
      }
      return j;
    },

    hurt() {
      const j = base();
      j.hip = [41, 57]; j.waist = [42, 49]; j.neck = [46, 33]; j.head = [48, 27]; j.tilt = 0.45; j.turn = 0.8;
      j.shL = [29, 31]; j.shR = [61, 38];
      j.elL = [19, 34]; j.hdL = [13, 28];
      j.shield = { sx: 0.72, sy: 1, rot: -0.7, edge: [-1, 0] };
      j.elR = [65, 47]; j.hdR = [68, 51];
      j.weapon = { ang: -1.0, fk: 1, chain: [6, 6] };
      j.order = ['weapon', 'shield', 'legs', 'torso', 'head', 'armL', 'armR', 'paulL', 'paulR', 'fistR'];
      return j;
    },

    cast() {
      const j = base();
      j.shL = [24, 31]; j.shR = [56, 31];
      j.neck = [40, 27]; j.head = [40, 19];
      j.elL = [19, 23]; j.hdL = [30, 13];
      j.shield = { sx: 0.34, sy: 1, rot: -0.35, edge: [-1, 0] };
      j.elR = [61, 23]; j.hdR = [51, 13];
      j.weapon = { ang: 0.95, fk: 0.9, chain: [7, 9] };
      j.fx.orb = [40, 8];
      return j;
    },

    victory() {
      const j = base();
      j.neck = [40, 26]; j.head = [40, 17]; j.shL = [24, 31]; j.shR = [56, 30];
      j.elR = [65, 25]; j.hdR = [60, 18];
      j.elL = [20, 42]; j.hdL = [15, 47];
      j.shield = { sx: 0.72, sy: 1, rot: 0.22, edge: [-1, 0] };
      j.weapon = { ang: -2.55, fk: 1, chain: [-2, 10] };
      j.fx.glint = true;
      return j;
    },
  };

  // ---------------------------------------------------------------
  // Legs (mostly under the HUD in combat; seen in menus)
  // ---------------------------------------------------------------
  function legs(S, j, a) {
    const plate = a === 'plate' || a === 'fullplate';
    const pants = plate ? (a === 'fullplate' ? BLUED : STEEL) : a === 'chain' ? STEEL : TROUSER;
    const boot = plate ? pants : STRAP;
    for (const [hip, knee, foot] of [[j.hipL, j.kneeL, j.footL], [j.hipR, j.kneeR, j.footR]]) {
      layer(S, L => {
        L.capsule(hip[0], hip[1], knee[0], knee[1], 4.3, 3.4, pants, { hi: plate ? 7 : 5, spec: plate ? 0.5 : 0, rim: 0.2 });
        if (a === 'chain') mailTex(L);
        const cx = lerp(knee[0], foot[0], 0.15), cy = lerp(knee[1], foot[1], 0.15);
        L.capsule(cx, cy, foot[0], foot[1], 3.5, 3, boot, { lo: 1, hi: plate ? 7 : 6, spec: 0.4, rim: 0.2 });
        L.ball(foot[0], foot[1] + 1, 3.8, 2.2, boot, { lo: 0, hi: plate ? 6 : 5 });
        if (!plate) L.ball(cx, cy + 0.5, 3.9, 1.5, STRAP, { lo: 2, spec: 0.3 });       // boot cuff
        else L.ball(knee[0], knee[1], 3, 2.6, pants, { spec: 0.7, hi: 7 });           // poleyn
      }, deepen);
    }
  }

  // ---------------------------------------------------------------
  // Torso: the back as a height field, plus neck, skirt and belt
  // ---------------------------------------------------------------
  // Shape of the back for a pose: returns the local frame at (x, y) or null.
  function backFrame(j) {
    const sL = j.shL, sR = j.shR, n = j.neck, w = j.waist;
    const shY = (sL[1] + sR[1]) / 2, mid = (sL[0] + sR[0]) / 2;
    const bot = w[1] + 5;
    return (x, y) => {
      if (y > bot) return null;
      const t = clamp((y - shY) / (w[1] - shY), 0, 1);
      const cx = lerp(mid, w[0], t);
      const dx = x - cx;
      const s = dx < 0 ? sL : sR;
      const hw0 = Math.abs(s[0] - cx) + 3;
      const hw = lerp(hw0, 11.5, Math.pow(t, 1.3));
      const u = dx / hw, au = Math.abs(u);
      if (au >= 1) return null;
      // trapezius: from the neck down to the top of the shoulder
      const yTop = lerp(n[1] - 3, s[1] - 4, Math.pow(Math.min(1, au * 1.05), 0.75));
      if (y < yTop) return null;
      return { u, au, t, dx, cx, hw, hw0, shY, yTop, s };
    };
  }

  function backHeight(f, x, y, a) {
    const { u, au, t, dx, hw0, shY, yTop } = f;
    const plate = a === 'plate' || a === 'fullplate';
    let z;
    if (plate) {
      z = 7.5 * Math.sqrt(Math.max(0, 1 - Math.pow(au, 1.5)));
      z += 1.3 * Math.max(0, 1 - Math.abs(dx) / 2.2);           // central ridge
      z -= 1.2 * smooth(0, 2.5, yTop + 2.5 - y);                // rolled top edge
    } else {
      z = 7 * Math.sqrt(1 - u * u);
      const soft = a === 'none' ? 1 : a === 'leather' ? 0.35 : 0.6;
      for (const sd of [-1, 1]) {                                // shoulder blades
        const bx = (dx - sd * hw0 * 0.42) / 5.2, by = (y - (shY + 5)) / 4.6;
        z += 1.5 * soft * Math.exp(-(bx * bx + by * by));
      }
      z -= 1.4 * soft * Math.exp(-(dx * dx) / 2.2) * smooth(0.05, 0.3, t);   // spine groove
      z += 0.8 * soft * Math.exp(-((Math.abs(dx) - 3.4) ** 2) / 2.5) * smooth(0.45, 0.9, t); // lower back
      if (a !== 'chain') z += 0.6 * Math.sin(dx * 1.15 + 0.4) * smooth(0.6, 1, t) * (1 - au * 0.6); // gathers
      z -= 0.5 * smooth(0, 1.8, yTop + 1.8 - y);
    }
    return z;
  }

  function torso(S, j, a) {
    const plate = a === 'plate' || a === 'fullplate';
    const frame = backFrame(j);
    const [wx, wy] = j.waist, [hx, hy] = j.hip, [nx, ny] = j.neck;
    const body = a === 'none' ? TUNIC : a === 'leather' ? LEATHER : a === 'fullplate' ? BLUED : STEEL;
    const bodyO = a === 'none' ? { rim: 0.25, steep: 1.2 }
      : a === 'leather' ? { rim: 0.25, spec: 0.12, steep: 1.2 }
        : a === 'chain' ? { hi: 6, rim: 0.3, steep: 1.1 }
          : { spec: 0.8, rim: 0.4, hi: 7, steep: 1.6, bias: -0.1, dither: false };

    // neck (under everything else of the torso)
    layer(S, L => {
      L.capsule(nx, ny + 1, j.head[0], j.head[1] + 3, 4.4, 4.1, SKIN, { lo: 1, hi: 6, rim: 0.2 });
    }, null);

    // skirt over the hips
    layer(S, L => {
      const top = wy + 3, botY = hy + 3;
      const zf = (x, y) => {
        if (y < top || y > botY) return null;
        const t = (y - top) / (botY - top);
        const cx = lerp(wx, hx, t);
        const hw = lerp(11.5, 14, t) + (a === 'none' ? 0.5 * Math.sin(x * 1.3) * t : 0);
        const u = (x - cx) / hw;
        if (Math.abs(u) >= 1) return null;
        let z = 6 * Math.sqrt(1 - u * u);
        if (a !== 'chain') z += 0.7 * Math.sin((x - cx) * 1.25) * (0.4 + t);
        return z;
      };
      const skirt = a === 'chain' ? STEEL : a === 'fullplate' ? PLUME : TUNIC;
      surf(L, wx - 16, wy, wx + 16, hy + 4, zf, skirt, a === 'chain' ? { hi: 6, rim: 0.2 } : { rim: 0.2, hi: a === 'fullplate' ? 7 : 8 });
      if (a === 'chain') mailTex(L);
      if (plate) {       // tassets
        const tr = a === 'fullplate' ? BLUED : STEEL;
        for (const sd of [-1, 1]) {
          const cx = wx + sd * 6.5;
          L.poly([[cx - 5.5, wy + 3], [cx + 5.5, wy + 3], [cx + 6 + sd * 1.5, wy + 9], [cx - 6 + sd * 1.5, wy + 9]], tr,
            { grad: [cx - 6, wy + 3, cx + 6, wy + 9, sd < 0 ? 0.8 : 0.55, sd < 0 ? 0.35 : 0.2], hi: 7 });
          L.line(cx - 5 + sd, wy + 6, cx + 5 + sd, wy + 6, a === 'fullplate' ? '#a70' : '#345');
        }
      }
    }, deepen);

    // the back
    layer(S, L => {
      const zf = (x, y) => { const f = frame(x, y); return f ? backHeight(f, x, y, a) : null; };
      surf(L, 8, ny - 6, 72, wy + 6, zf, body, bodyO);
      if (a === 'chain') mailTex(L);
      const bi = idx(body);
      if (a === 'none' || a === 'leather') {
        // hemmed neckline and armholes
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = bi.get(L.get(x, y));
          if (i === undefined) continue;
          const f = frame(x + 0.5, y + 0.5);
          if (!f) continue;
          const top = y + 0.5 - f.yTop;
          if (top < 1.3 || (f.au > 0.9 && f.t < 0.45)) L.set(x, y, body[Math.max(1, i - 2)]);
          else if (top < 2.3 && f.au < 0.75) L.set(x, y, body[Math.min(8, i + 1)]);
        }
      }
      if (a === 'leather') {
        // stitched panel seams and a yoke across the shoulders
        const sy = (j.shL[1] + j.shR[1]) / 2 + 2;
        for (let x = 10; x < 70; x++) {
          const f = frame(x + 0.5, sy + 0.5);
          if (f && f.au < 0.92) { const i = bi.get(L.get(x, sy)); if (i !== undefined) L.set(x, sy, body[Math.max(0, i - 2)]); if ((x & 1) && L.opaque(x, sy + 1)) L.set(x, sy + 1, body[Math.min(8, (bi.get(L.get(x, sy + 1)) || 4) + 1)]); }
        }
        for (const sd of [-1, 1]) for (let y = sy + 2; y < wy + 4; y++) {
          const f0 = frame(40, y + 0.5);
          if (!f0) continue;
          const x = Math.round(f0.cx + sd * f0.hw * 0.48);
          const i = bi.get(L.get(x, y)); if (i === undefined) continue;
          L.set(x, y, body[Math.max(0, i - 2)]);
          if ((y & 1) === 0) { const i2 = bi.get(L.get(x + sd, y)); if (i2 !== undefined) L.set(x + sd, y, body[Math.min(8, i2 + 2)]); }
        }
      }
      if (plate) {
        // trim along the rolled top edge and the arm openings
        const trim = a === 'fullplate' ? GOLD : STEEL;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (!L.opaque(x, y)) continue;
          const f = frame(x + 0.5, y + 0.5);
          if (!f) continue;
          if (y + 0.5 - f.yTop < 1.6 || (f.au > 0.86 && f.t < 0.55)) {
            if (a === 'fullplate') L.shadePx(x, y, GOLD, 0.55 + 0.35 * (f.u < 0 ? 1 : 0) - 0.2 * f.t);
            else { const i = STEEL_I.get(L.get(x, y)); if (i !== undefined) L.set(x, y, trim[Math.min(8, i + 1)]); }
          }
        }
        // spine ridge: a lit edge on the left, a shadow on the right
        for (let y = 0; y < H; y++) {
          const f0 = frame(40, y + 0.5);
          if (!f0 || f0.t > 0.92) continue;
          const xr = Math.round(f0.cx - 0.5);
          if (L.opaque(xr - 1, y) && y + 0.5 - f0.yTop > 2) L.set(xr - 1, y, a === 'fullplate' ? '#9bc' : '#bcd');
          if (L.opaque(xr + 1, y) && y + 0.5 - f0.yTop > 2) L.set(xr + 1, y, a === 'fullplate' ? '#235' : '#345');
        }
        // rivets along the rolled top edge
        for (const sd of [-1, 1]) for (const k of [0.35, 0.62]) {
          const yy = Math.round(lerp(j.neck[1] - 1, (sd < 0 ? j.shL : j.shR)[1] - 3, k)) + 1;
          for (let x = 0; x < W; x++) {
            const f = frame(x + 0.5, yy + 0.5);
            if (f && Math.abs(f.u - sd * k * 0.95) < 0.04 && L.opaque(x, yy)) { L.set(x, yy, a === 'fullplate' ? '#fe6' : '#dde'); break; }
          }
        }
        // fauld lames at the waist
        for (let k = 0; k < 2; k++) {
          const y0 = wy - 1 + k * 3;
          for (let x = 0; x < W; x++) {
            const f = frame(x + 0.5, y0 + 0.5);
            if (!f || !L.opaque(x, y0)) continue;
            L.set(x, y0, a === 'fullplate' ? '#530' : '#112');
            if (L.opaque(x, y0 + 1)) L.set(x, y0 + 1, a === 'fullplate' ? (f.u < 0 ? '#eb3' : '#a70') : (f.u < 0 ? '#bcd' : '#689'));
          }
        }
        if (a === 'fullplate') {
          // gilded sun on the back plate
          const cx = Math.round((j.shL[0] + j.shR[0]) / 2), cy = Math.round((j.shL[1] + j.shR[1]) / 2 + 6);
          for (let k = 0; k < 8; k++) {
            const an = k / 8 * Math.PI * 2;
            L.set(Math.round(cx + Math.cos(an) * 3.2 - 0.5), Math.round(cy + Math.sin(an) * 3.2 - 0.5), k < 3 || k > 6 ? '#fe6' : '#c92');
          }
          L.ball(cx, cy, 2.1, 2.1, GOLD, { spec: 0.8 });
        }
      }
    }, deepen);

    // belt (a smile: we see the back half of a ring from above) and pouch
    layer(S, L => {
      const bw = 12.6;
      for (let x = Math.floor(wx - bw); x <= Math.ceil(wx + bw); x++) {
        const t = (x + 0.5 - wx) / bw;
        if (Math.abs(t) > 1) continue;
        const y0 = Math.round(wy + 3 + 1.4 * (1 - t * t));
        for (let k = 0; k < 3; k++) {
          const I = (k === 0 ? 0.85 : k === 1 ? 0.6 : 0.3) * (0.75 + 0.25 * (1 - (t + 1) / 2));
          L.shadePx(x, y0 + k, STRAP, I);
        }
        if (a === 'fullplate' && Math.abs(Math.round(x - wx) % 5) === 0) L.set(x, y0 + 1, '#eb3');
      }
      if (a === 'leather') {
        // baldric: a strap from the right shoulder down to the left hip
        const [sx, sy] = j.shR;
        L.capsule(sx - 3, sy - 1, wx - 10, wy + 3, 1.6, 1.6, STRAP, { lo: 1, spec: 0.3 });
      }
    });
  }

  // ---------------------------------------------------------------
  // Head: hair from behind, or a plumed helm for full plate
  // ---------------------------------------------------------------
  const TUFTS = [[-2.6, 1.2], [-2.15, 1.6], [-1.75, 1.9], [-1.35, 1.7], [-0.95, 1.5], [-0.55, 1.1], [-3.0, 0.8], [-0.2, 0.7]];

  function head(S, j, a) {
    const [hx, hy] = j.head;
    const tilt = j.tilt || 0;
    if (a === 'fullplate') {
      layer(S, L => {
        // flared neck guard in two lames
        L.poly([[hx - 6.6, hy + 1], [hx + 6.6, hy + 1], [hx + 10.5, hy + 8.5], [hx - 10.5, hy + 8.5]], BLUED, { grad: [hx - 9, hy, hx + 9, hy + 8, 0.85, 0.3], hi: 7 });
        for (let x = Math.floor(hx - 11); x <= hx + 11; x++) {
          const t = (x + 0.5 - hx) / 10.5;
          const y1 = Math.round(hy + 8 + 0.8 * (1 - t * t)), y0 = Math.round(hy + 4.5 + 0.6 * (1 - t * t));
          if (L.opaque(x, y1)) L.shadePx(x, y1, GOLD, x < hx ? 0.75 : 0.45);
          if (L.opaque(x, y0)) L.set(x, y0, '#112');
          if (L.opaque(x, y0 + 1)) L.set(x, y0 + 1, x < hx ? '#9bc' : '#68a');
        }
      }, deepen);
      layer(S, L => {
        L.ball(hx, hy - 0.5, 7.8, 7.8, BLUED, { spec: 0.9, rim: 0.35, rot: tilt, hi: 7 });
        for (let x = Math.floor(hx - 8); x <= hx + 8; x++) {
          const t = (x + 0.5 - hx) / 7.4;
          if (Math.abs(t) > 1) continue;
          const y = Math.round(hy + 1.5 + 1.4 * (1 - t * t));
          for (let k = 0; k < 2; k++) if (L.opaque(x, y + k)) L.shadePx(x, y + k, GOLD, (k ? 0.35 : 0.65) + 0.3 * (1 - (t + 1) / 2));
        }
        // comb ridge
        for (let y = Math.round(hy - 7); y < hy + 1; y++) { if (L.opaque(Math.round(hx - 1), y)) L.set(Math.round(hx - 1), y, '#9bc'); if (L.opaque(Math.round(hx), y)) L.set(Math.round(hx), y, '#235'); }
      }, deepen);
      layer(S, L => {
        const fl = [0, 1, 0, -1][j.plume | 0];
        L.horn(hx, hy - 6, hx + 2, hy - 15, hx + 9 + fl, hy - 10 + fl, 2.6, 1, PLUME, { spec: 0.3 });
        L.horn(hx + 1, hy - 7, hx + 4, hy - 13, hx + 8 + fl, hy - 7 + fl, 1.6, 0.6, PLUME, { lo: 2 });
      });
      return;
    }
    layer(S, L => {
      const t = j.turn || 0;
      // ears
      for (const sd of [-1, 1]) {
        const ex = hx + sd * 6.6 + t * 1.3, ey = hy + 1.5;
        L.ball(ex, ey, 1.8, 2.8, SKIN, { lo: 1, hi: 6 });
        L.set(Math.floor(ex + sd * 0.3), Math.floor(ey), SKIN[2]);
      }
    }, deepen);
    layer(S, L => {
      // skull under the hair
      L.ball(hx, hy, 6.8, 7.4, HAIR, { lo: 1, hi: 7, rot: tilt, rim: 0.25 });
      // tufts around the crown, swept back
      for (const [an0, len] of TUFTS) {
        const an = an0 + tilt;
        const ca = Math.cos(an), sa = Math.sin(an);
        L.capsule(hx + ca * 5, hy + sa * 5.6, hx + ca * (6.6 + len) + 0.4, hy + sa * (7.2 + len) + 0.9, 1.4, 0.4, HAIR, { lo: 1, hi: 7 });
      }
      // nape: carve the hairline so the neck shows below the hair
      for (let y = Math.floor(hy + 3); y <= hy + 9; y++) for (let x = Math.floor(hx - 6); x <= hx + 6; x++) {
        const d = Math.abs(x + 0.5 - hx);
        const notch = (d > 1.2 && d < 2.6) || (d > 4 && d < 5) ? 1 : 0;
        if (y + 0.5 > hy + 5.2 + notch - d * 0.12 && HAIR_I.has(L.get(x, y))) L.set(x, y, 0);
      }
      // strands from the crown: dark partings and lit locks
      for (let i = -4; i <= 4; i++) stroke(L, HAIR_I, HAIR, hx + 0.5 + i * 0.5, hy - 5, hx + i * 1.7, hy + 5, -2);
      for (let i = -3; i <= 1; i++) stroke(L, HAIR_I, HAIR, hx - 1 + i * 0.9, hy - 5.5, hx - 2 + i * 1.6, hy - 1, 1);
    }, deepen);
  }

  // ---------------------------------------------------------------
  // Arms and hands
  // ---------------------------------------------------------------
  function fist(L, x, y, a) {
    if (a === 'plate' || a === 'fullplate') {
      const r = a === 'fullplate' ? BLUED : STEEL;
      L.ball(x, y, 3, 2.8, r, { spec: 0.8, hi: 7 });
      if (a === 'fullplate') { L.set(Math.floor(x - 1), Math.floor(y - 1), '#fe6'); L.set(Math.floor(x), Math.floor(y - 1), '#c92'); }
    } else {
      L.ball(x, y, 2.9, 2.7, a === 'chain' ? STRAP : SKIN, { spec: 0.15, lo: 1, hi: a === 'chain' ? 6 : 7 });
    }
  }

  function arm(S, j, side, a) {
    const sh = side < 0 ? j.shL : j.shR, el = side < 0 ? j.elL : j.elR, hd = side < 0 ? j.hdL : j.hdR;
    layer(S, L => {
      const ux = el[0] - sh[0], uy = el[1] - sh[1], ul = Math.hypot(ux, uy) || 1;
      // upper arm + shoulder
      if (a === 'none' || a === 'leather') {
        L.capsule(sh[0] + ux / ul * 0.5, sh[1] + uy / ul * 0.5, el[0], el[1], 4.5, 3, SKIN, { rim: 0.3, hi: 7, depth: 0.8 });
        // triceps belly, bulging toward the outside of the arm
        const nx = -uy / ul * side, ny = ux / ul * side, out = nx * side > 0 || (nx === 0 && ny < 0) ? 1 : -1;
        L.ball(lerp(sh[0], el[0], 0.48) + nx * out * 0.9, lerp(sh[1], el[1], 0.48) + ny * out * 0.9, 3.7, 4.6, SKIN,
          { rim: 0.3, hi: 7, depth: 0.6, rot: Math.atan2(uy, ux) + Math.PI / 2 });
        if (a === 'leather') L.ball(sh[0], sh[1], 4.6, 4, TUNIC, { lo: 1, hi: 6 });
      } else if (a === 'fullplate') {
        L.capsule(sh[0], sh[1], el[0], el[1], 3.9, 3.2, BLUED, { spec: 0.7, rim: 0.3, hi: 7 });
      } else {
        L.capsule(sh[0], sh[1], el[0], el[1], 4, 3.3, STEEL, { hi: 6, rim: 0.25 });
        L.ball(sh[0], sh[1], 5, 4.6, STEEL, { hi: 6 });
        mailTex(L);
      }
      // forearm
      if (a === 'none') {
        L.capsule(el[0], el[1], hd[0], hd[1], 3, 2.4, SKIN, { rim: 0.3, hi: 7, depth: 0.8 });
        L.ball(lerp(el[0], hd[0], 0.3), lerp(el[1], hd[1], 0.3), 3.4, 3.4, SKIN, { rim: 0.3, hi: 7, depth: 0.6 });
      }
      else if (a === 'leather') {
        L.capsule(el[0], el[1], hd[0], hd[1], 3, 2.4, SKIN, { rim: 0.3, hi: 7, depth: 0.8 });
        const bx = lerp(el[0], hd[0], 0.35), by = lerp(el[1], hd[1], 0.35);
        L.capsule(bx, by, lerp(el[0], hd[0], 0.85), lerp(el[1], hd[1], 0.85), 3.1, 2.8, STRAP, { spec: 0.35, lo: 1 });
      } else if (a === 'chain') {
        L.capsule(el[0], el[1], hd[0], hd[1], 3.3, 2.7, STEEL, { hi: 6, rim: 0.25 });
        mailTex(L);
      } else {
        const r = a === 'fullplate' ? BLUED : STEEL;
        L.capsule(el[0], el[1], hd[0], hd[1], 3.4, 2.9, r, { spec: 0.8, rim: 0.3, hi: 7 });
        L.ball(el[0], el[1], 3.3, 3, r, { spec: 0.5, hi: 7, depth: 0.7 });               // couter
        if (a === 'fullplate') {
          const tx = lerp(el[0], hd[0], 0.78), ty = lerp(el[1], hd[1], 0.78);
          L.ball(tx, ty, 2.6, 2.6, GOLD, { lo: 2, spec: 0.6 });
        }
      }
      if (side < 0) fist(L, hd[0], hd[1], a);
    });
  }

  // Pixel-art plate edges: a bright rim where the form faces the light
  // (upper/left neighbour empty) and an optional dark rim on the far side.
  const plateEdges = (L, lit, dark) => {
    const src = L.data.slice(), w = L.w, h = L.h;
    const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      if (lit && !op(x, y - 1) && op(x, y + 1)) L.set(x, y, lit);
      else if (lit && !op(x - 1, y) && !op(x - 1, y - 1)) L.set(x, y, lit);
      else if (dark && (!op(x, y + 1) || !op(x + 1, y))) L.set(x, y, dark);
    }
  };

  function pauldron(S, j, side, a) {
    if (a === 'none' || a === 'chain') return;
    const sh = side < 0 ? j.shL : j.shR, el = side < 0 ? j.elL : j.elR;
    const ang = Math.atan2(el[1] - sh[1], el[0] - sh[0]);
    const ox = Math.cos(ang), oy = Math.sin(ang);
    const slope = Math.atan2(j.shR[1] - j.shL[1], j.shR[0] - j.shL[0]) + side * 0.3;
    if (a === 'leather') {
      layer(S, L => L.ball(sh[0] + ox * 2.8, sh[1] + oy * 2.8, 4.4, 3.4, LEATHER, { lo: 1, spec: 0.2, rot: ang + Math.PI / 2, depth: 0.7 }), deepen);
      layer(S, L => {
        L.ball(sh[0] - ox * 0.3, sh[1] - oy * 0.3 - 0.6, 5.6, 4.4, LEATHER, { lo: 1, spec: 0.25, rot: slope, depth: 0.8 });
        plateEdges(L, LEATHER[7], null);
        L.set(Math.floor(sh[0] - 1), Math.floor(sh[1] - 1), '#cb9');
        L.set(Math.floor(sh[0] + 2), Math.floor(sh[1]), '#a86');
      }, deepen);
      return;
    }
    const fp = a === 'fullplate';
    const r = fp ? BLUED : STEEL;
    const ri = idx(r);
    const lit = fp ? '#cdf' : '#bcd';
    layer(S, L => {
      // one segmented shell: a dome over the shoulder running down the arm
      L.capsule(sh[0] - ox * 0.5, sh[1] - oy * 0.5, sh[0] + ox * 7.5, sh[1] + oy * 7.5, fp ? 6.4 : 6, fp ? 5.2 : 4.8, r, { spec: 0.45, rim: 0.35, hi: 7, depth: 0.75 });
      L.ball(sh[0] - ox * 0.6, sh[1] - oy * 0.6 - 0.9, fp ? 7.6 : 7.1, fp ? 5.6 : 5.2, r, { spec: 0.55, rim: 0.35, hi: 7, rot: slope, depth: 0.75 });
      // lame joints across the arm: a dark gap, then the next plate's lit lip
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = ri.get(L.get(x, y));
        if (i === undefined) continue;
        const along = (x + 0.5 - sh[0]) * ox + (y + 0.5 - sh[1]) * oy;
        for (const d of [3.4, 6.6]) {
          if (along >= d && along < d + 1) L.set(x, y, fp ? GOLD[4 + (x < sh[0] ? 1 : 0)] : r[Math.max(1, i - 3)]);
          else if (along >= d + 1 && along < d + 2) L.set(x, y, r[Math.min(7, i + 1)]);
        }
      }
      plateEdges(L, lit, null);
      if (fp) {
        // gilded outer rim and a rivet on the cap
        const src = L.data.slice();
        const op = (x, y) => x >= 0 && y >= 0 && x < W && y < H && src[y * W + x];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (!op(x, y)) continue;
          const along = (x + 0.5 - sh[0]) * ox + (y + 0.5 - sh[1]) * oy;
          if (!op(x, y + 1) || (!op(x + side, y) && along > -1)) L.shadePx(x, y, GOLD, x < sh[0] ? 0.8 : 0.55);
        }
        L.set(Math.floor(sh[0] - ox - 1), Math.floor(sh[1] - oy - 2), '#fe6');
      }
    });
    if (fp) {
      // haute-piece: a raised, gilded neck guard on the inside of the pauldron
      layer(S, L => {
        const x = sh[0] - side * 4.2, y = sh[1] - 4.2;
        L.poly([[x - 1.6, y + 2.5], [x + 1.6, y + 2.5], [x + 1.2 - side * 0.6, y - 2.2], [x - 1.2 - side * 0.6, y - 2.2]], GOLD, { tone: side < 0 ? 0.8 : 0.55 });
      });
    }
  }

  // ---------------------------------------------------------------
  // Shield (we see its back: the inside face, the grip and the rim)
  // ---------------------------------------------------------------
  const SHIELD_KIND = { none: 'wood', leather: 'hide', chain: 'iron', plate: 'kite', fullplate: 'gilded' };

  function shield(S, j, a) {
    const kind = SHIELD_KIND[a] || 'wood';
    const round = kind === 'wood' || kind === 'hide' || kind === 'iron';
    const sh = !round && j.shield.kite ? Object.assign({}, j.shield, j.shield.kite) : j.shield;
    const r = kind === 'wood' ? 11 : 11.5;
    const cr = Math.cos(sh.rot), sr = Math.sin(sh.rot);
    const c0 = sh.at || j.hdL;
    const kw = kind === 'gilded' ? 11 : 10;
    const hw = v => {             // kite half-width at local v
      if (v < -2) return kw;
      if (v > 17) return -1;
      return kw * Math.cos((v + 2) / 19 * Math.PI / 2);
    };
    const inside = (u, v) => {
      if (round) return u * u + v * v <= r * r;
      const top = -10.5 + 1.6 * (u / kw) * (u / kw);
      return v >= top && Math.abs(u) <= hw(v);
    };
    const M = new Uint8Array(W * H), E = new Uint8Array(W * H);
    const ex = sh.edge[0] * 1.6, ey = sh.edge[1] * 1.6;
    let cx = c0[0], cy = c0[1];
    const local = (px, py) => {
      const dx = px + 0.5 - cx, dy = py + 0.5 - cy;
      return [(dx * cr + dy * sr) / sh.sx, (-dx * sr + dy * cr) / sh.sy];
    };
    for (let pass = 0; pass < 2; pass++) {
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      M.fill(0); E.fill(0);
      for (let y = -6; y < H + 6; y++) for (let x = -6; x < W + 6; x++) {
        const [u, v] = local(x, y), [u2, v2] = local(x - ex, y - ey);
        const a1 = inside(u, v), a2 = inside(u2, v2);
        if (!a1 && !a2) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (a1) M[y * W + x] = 1;
        if (a2) E[y * W + x] = 1;
      }
      const dx = x0 < 2 ? 2 - x0 : x1 > W - 3 ? W - 3 - x1 : 0, dy = y0 < 2 ? 2 - y0 : y1 > H - 3 ? H - 3 - y1 : 0;
      if (!dx && !dy) break;
      cx += dx; cy += dy;
      if (!sh.at) j.hdL = [j.hdL[0] + dx, j.hdL[1] + dy];
    }
    const inM = (x, y) => x >= 0 && y >= 0 && x < W && y < H && M[y * W + x];
    const edgeDist = (x, y, max) => {
      for (let d = 1; d <= max; d++) {
        for (let k = -d; k <= d; k++) {
          if (!inM(x + k, y - d) || !inM(x + k, y + d) || !inM(x - d, y + k) || !inM(x + d, y + k)) return d;
        }
      }
      return max + 1;
    };
    const rimW = kind === 'wood' ? 1 : 2;
    const rimRamp = kind === 'wood' ? WOOD : kind === 'hide' ? LEATHER : kind === 'gilded' ? GOLD : STEEL;
    layer(S, L => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!M[i] && E[i]) { L.shadePx(x, y, rimRamp, 0.32); continue; }
        if (!M[i]) continue;
        const [u, v] = local(x, y);
        const ang = Math.atan2(v * sh.sy, u * sh.sx);
        const d = edgeDist(x, y, rimW + 1);
        if (d <= rimW) {
          const I = 0.55 - 0.42 * (Math.cos(ang) * L2[0] + Math.sin(ang) * L2[1]);
          L.shadePx(x, y, rimRamp, clamp(I + (d === 1 ? 0.12 : -0.08), 0, 1), kind === 'gilded' ? {} : { lo: 1 });
          continue;
        }
        if (round) {
          const nu = u / r, nv = v / r;
          let I = 0.4 + 0.22 * (nu * 0.6 + nv * 0.5);
          const board = Math.floor((u + r) / 3.7);
          I += [0.05, -0.04, 0.08, -0.02, 0.03, -0.06, 0.04][board % 7];
          const f = ((u + r) / 3.7) - board;
          if (f < 0.27) I -= 0.25;
          const hd = Math.hypot(u, v);
          if (hd < 3.6) I = 0.02;
          else if (hd < 4.6) I = 0.62;
          if (kind === 'iron' && Math.abs(v) < 1.6 && hd >= 4.6) { L.shadePx(x, y, STEEL, 0.45 + (v < 0 ? 0.15 : -0.1), { lo: 1 }); continue; }
          L.shadePx(x, y, WOOD, I);
        } else {
          const I = 0.3 + 0.25 * (u / kw * 0.6 + (v + 2) / 18 * 0.4);
          L.shadePx(x, y, kind === 'gilded' ? BLUED : DARKSTEEL, I + (kind === 'gilded' ? 0.15 : 0));
          if (Math.abs(v - 6) < 1.3 && Math.abs(u) < hw(v) - 2.5) L.shadePx(x, y, STRAP, 0.5 + (v < 6 ? 0.15 : -0.1));
        }
      }
      // rivets through the boards / on the rim
      if (kind === 'iron' || kind === 'gilded' || kind === 'kite') {
        const n = round ? 10 : 9;
        for (let k = 0; k < n; k++) {
          let u, v;
          if (round) { const an = k / n * Math.PI * 2 + 0.2; u = Math.cos(an) * (r - 3.2); v = Math.sin(an) * (r - 3.2); }
          else { const t = k / (n - 1); v = lerp(-8, 13, t); u = (k & 1 ? 1 : -1) * Math.max(0, hw(v) - 3.2); if (k === 0) u = -kw + 3.2; }
          const px = cx + (u * sh.sx) * cr - (v * sh.sy) * sr, py = cy + (u * sh.sx) * sr + (v * sh.sy) * cr;
          if (M[Math.floor(py) * W + Math.floor(px)]) L.set(Math.floor(px), Math.floor(py), kind === 'gilded' ? '#fe6' : '#bcd');
        }
      }
    }, deepen);
  }

  // ---------------------------------------------------------------
  // Weapons. Each is built in its own frame: u runs from the grip
  // centre (0) toward the business end, v across it (+v = screen-right
  // when the weapon points up). fk foreshortens along u only.
  // ---------------------------------------------------------------
  const wframe = (S, x, y, ang, fk, flip = 1) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    const T = (u, v) => [x + c * u * fk - s * v * flip, y + s * u * fk + c * v * flip];
    const F = {
      S, c, s, fk, T, x, y, ang,
      cap: (u0, v0, u1, v1, r0, r1, ramp, o) => { const p = T(u0, v0), q = T(u1, v1); S.capsule(p[0], p[1], q[0], q[1], r0, r1, ramp, o); },
      poly: (pts, ramp, o) => S.poly(pts.map(p => T(p[0], p[1])), ramp, o),
      tri: (a, b, c2, ramp, o) => S.poly([a, b, c2].map(p => T(p[0], p[1])), ramp, o),
      ball: (u, v, rx, ry, ramp, o = {}) => { const p = T(u, v); S.ball(p[0], p[1], rx, ry, ramp, Object.assign({ rot: ang }, o)); },
      line: (u0, v0, u1, v1, col) => { const p = T(u0, v0), q = T(u1, v1); S.line(p[0] - 0.5, p[1] - 0.5, q[0] - 0.5, q[1] - 0.5, col); },
      px: (u, v, col) => { const p = T(u, v); S.set(Math.floor(p[0]), Math.floor(p[1]), col); },
      toneA: facet(s * flip, -c * flip), toneB: facet(-s * flip, c * flip),
    };
    return F;
  };

  // Two-facet blade from u0 to the point, half widths w0 (base) and w1 (shoulder).
  const blade = (F, u0, u1, tip, w0, w1, ramp, o = {}) => {
    const lo = o.lo !== undefined ? o.lo : 2;
    F.poly([[u0, 0], [u0, -w0], [u1, -w1], [tip, 0]], ramp, { tone: 0.2 + 0.7 * F.toneA, lo });
    F.poly([[u0, 0], [u0, w0], [u1, w1], [tip, 0]], ramp, { tone: 0.2 + 0.7 * F.toneB, lo });
    if (o.fuller) F.line(u0 + 1, 0, u1 - 2, 0, o.fuller);
  };

  const guard = (F, u, half, r, ramp, o) => F.cap(u, -half, u, half, r, r, ramp, Object.assign({ spec: 0.6 }, o));

  const WEAPONS = {
    dagger: {
      len: 15, hull: [[15, 0, 0.5], [-5.2, 0, 1.6], [2, 3, 1], [2, -3, 1]],
      draw(F) {
        F.cap(-4.5, 0, 1, 0, 1.3, 1.3, STRAP);
        F.ball(-5.2, 0, 1.6, 1.6, STEEL, { spec: 0.6 });
        guard(F, 2, 3, 1, STEEL);
        blade(F, 3, 11, 15, 1.7, 1.3, STEEL);
      },
    },
    shortsword: {
      len: 22, hull: [[22, 0, 0.5], [-5.3, 0, 2], [2, 4, 1.2], [2, -4, 1.2], [15, 2.7, 0.5], [15, -2.7, 0.5]],
      draw(F) {
        F.cap(-4.5, 0, 1, 0, 1.4, 1.4, WOOD, { lo: 2 });
        F.ball(-5.3, 0, 2, 2, GOLD, { spec: 0.4, hi: 6 });
        guard(F, 2, 4, 1.2, STEEL);
        blade(F, 3, 15, 22, 2.1, 2.7, STEEL);
      },
    },
    longsword: {
      len: 33, hull: [[33, 0, 0.5], [-8.3, 0, 2.1], [2, 6.5, 1.2], [2, -6.5, 1.2]],
      draw(F) {
        F.cap(-7.5, 0, 1, 0, 1.4, 1.4, STRAP);
        F.ball(-8.3, 0, 2.1, 2.1, STEEL, { spec: 0.7 });
        guard(F, 2, 6.5, 1.2, STEEL);
        blade(F, 3, 28, 33, 2, 1.6, STEEL, { fuller: '#456' });
      },
    },
    greatsword: {
      len: 44, hull: [[44, 0, 0.5], [-12, 0, 2.6], [2, 9, 1.5], [2, -9, 1.5], [10, 4.5, 0.5], [10, -4.5, 0.5]],
      draw(F) {
        F.cap(-11, 0, 1, 0, 1.6, 1.6, STRAP);
        F.ball(-12, 0, 2.6, 2.6, STEEL, { spec: 0.7 });
        guard(F, 2, 9, 1.5, STEEL);
        F.ball(2, 0, 2.2, 2.4, STEEL, { spec: 0.8 });
        blade(F, 3, 8, 8, 2.2, 2.2, STEEL);
        F.tri([8, -2], [8, -4.5], [10, -2], STEEL, { tone: 0.5 });
        blade(F, 8, 38, 44, 3.2, 2.6, STEEL, { fuller: '#456' });
      },
    },
    magicsword: {
      len: 33, glow: 2.6, hull: [[33, 0, 0.5], [-8.3, 0, 2.1], [2, 6.5, 1.2], [2, -6.5, 1.2]],
      draw(F) {
        F.cap(-7.5, 0, 1, 0, 1.4, 1.4, DARKSTEEL);
        F.ball(-8.3, 0, 2.1, 2.1, ICE, { spec: 0.7 });
        guard(F, 2, 6.5, 1.2, DARKSTEEL);
        blade(F, 3, 28, 33, 2, 1.6, ICE, { fuller: '#8de', lo: 3 });
      },
    },
    holysword: {
      len: 34, glow: 3.6, hull: [[34, 0, 0.5], [-8.3, 0, 2.2], [2, 7, 1.3], [2, -7, 1.3]],
      draw(F) {
        F.cap(-7.5, 0, 1, 0, 1.4, 1.4, GOLD);
        F.ball(-8.3, 0, 2.2, 2.2, GOLD, { spec: 0.7 });
        guard(F, 2, 7, 1.3, GOLD);
        blade(F, 3, 29, 34, 2.3, 1.8, STEEL, { fuller: '#eb3', lo: 3 });
      },
    },
    mace: {
      len: 24, hull: [[24.5, 0, 1.4], [-6.3, 0, 1.8], [18, 6, 0.5], [18, -6, 0.5], [18.5, 0, 3.6]],
      draw(F) {
        F.cap(-6, 0, 16, 0, 1.4, 1.3, STEEL, { spec: 0.4 });
        F.cap(-4.5, 0, 1.5, 0, 1.6, 1.6, STRAP);
        F.ball(-6.3, 0, 1.8, 1.8, STEEL, { spec: 0.6 });
        for (const sgn of [-1, 1]) F.poly([[14, 0], [15.5, 6 * sgn], [21, 6 * sgn], [23, 0]], STEEL, { tone: sgn < 0 ? 0.2 + 0.7 * F.toneA : 0.2 + 0.7 * F.toneB });
        F.ball(18.5, 0, 3.6, 3.4, STEEL, { spec: 0.9 });
        F.ball(23.3, 0, 1.4, 1.4, STEEL, { spec: 0.6 });
      },
    },
    axe: {
      len: 25, hull: [[23, 0, 1.4], [-8.5, 0, 1.6], [24.5, 6.5, 0.5], [23.5, 10, 0.5], [18, 10.3, 0.5], [11, 9.2, 0.5], [17.5, -3.5, 0.5]],
      draw(F) {
        F.cap(-8, 0, 23, 0, 1.5, 1.4, WOOD, { lo: 2 });
        F.ball(-8.5, 0, 1.6, 1.6, STEEL);
        F.poly([[14, 1], [21, 1], [24.5, 6.5], [23.5, 10], [18, 10.2], [11, 9.2], [12, 6]], STEEL, { tone: 0.2 + 0.7 * F.toneB });
        F.poly([[15, -1], [20, -1], [19, -3.5], [16, -3.5]], STEEL, { tone: 0.2 + 0.7 * F.toneA });
        F.line(23.5, 9.5, 18, 9.7, '#dde');
        F.line(18, 9.7, 11.5, 8.8, '#bcd');
      },
    },
    hammer: {
      len: 28, hull: [[28, 1.5, 0.5], [-8.5, 0, 1.6], [17.5, -10, 0.5], [23.5, 8, 0.5], [16.5, 8, 0.5]],
      draw(F) {
        F.cap(-8, 0, 21, 0, 1.4, 1.3, WOOD, { lo: 2 });
        F.cap(13, 0, 21, 0, 1.6, 1.6, STEEL, { spec: 0.5 });
        F.ball(-8.5, 0, 1.6, 1.6, STEEL);
        F.poly([[18, -3], [22, -3], [17.5, -10]], STEEL, { tone: 0.2 + 0.7 * F.toneA });
        F.poly([[17.5, -3], [22.5, -3], [22.5, 5], [17.5, 5]], STEEL, { tone: 0.55 });
        F.poly([[16.5, 5], [23.5, 5], [23.5, 8], [16.5, 8]], STEEL, { tone: 0.2 + 0.7 * F.toneB });
        F.poly([[22.5, 0], [22.5, 3], [28, 1.5]], STEEL, { tone: 0.6 });
      },
    },
    flail: {
      len: 10, hull: [[9.6, 0, 1.9], [-5, 0, 1.7]], flail: true, restAng: -0.85, restChain: [1, 13],
      draw(F) {
        F.cap(-5, 0, 9, 0, 1.6, 1.5, WOOD, { lo: 2 });
        F.cap(-4, 0, 1.5, 0, 1.7, 1.7, STRAP);
        F.ball(9.6, 0, 1.9, 1.9, STEEL, { spec: 0.6 });
      },
    },
  };

  // Keep the weapon on the canvas: first foreshorten it (pointing toward or
  // away from the camera), then swing it a little, until every hull point
  // (with its radius, the outline and any glow) is inside.
  const fits = (def, x, y, ang, fk, flip = 1) => {
    const c = Math.cos(ang), s = Math.sin(ang), g = (def.glow || 0) + 2.2;
    for (const [u, v0, r] of def.hull) {
      const v = v0 * flip;
      const px = x + c * u * fk - s * v, py = y + s * u * fk + c * v, m = r + g;
      if (px < m || py < m || px > W - m || py > H - m) return false;
    }
    return true;
  };
  const fitWeapon = (def, x, y, ang, fk) => {
    for (const flip of [1, -1]) for (const da of [0, 0.08, -0.08, 0.16, -0.16, 0.26, -0.26, 0.38, -0.38, 0.5, -0.5]) {
      for (let k = fk; k >= 0.55; k -= 0.03) if (fits(def, x, y, ang + da, k, flip)) return [ang + da, k, flip];
    }
    for (const da of [0, 0.2, -0.2, 0.4, -0.4]) for (let k = fk; k > 0.25; k -= 0.03) if (fits(def, x, y, ang + da, k)) return [ang + da, k, 1];
    return [ang, 0.3, 1];
  };

  function weapon(S, j, wname, out) {
    const def = WEAPONS[wname] || WEAPONS.dagger;
    const [x, y] = j.hdR;
    let ang = j.weapon.ang;
    if (j.weapon.rest !== undefined && def.restAng !== undefined) ang = def.restAng + j.weapon.rest;
    const chain = j.weapon.rest !== undefined && def.restChain ? def.restChain : j.weapon.chain;
    let fk, flip;
    [ang, fk, flip] = fitWeapon(def, x, y, ang, j.weapon.fk);
    let F;
    layer(S, L => {
      F = wframe(L, x, y, ang, fk, flip);
      if (def.flail) {
        const [tx, ty] = F.T(10.5, 0);
        let bx = tx + chain[0], by = ty + chain[1];
        bx = clamp(bx, 8.5, W - 9.5); by = clamp(by, 8.5, H - 9.5);
        const n = 6;
        const mx = (tx + bx) / 2, my = (ty + by) / 2 + 2.5;
        for (let i = 0; i <= n; i++) {
          const t = i / n, it = 1 - t;
          const px = it * it * tx + 2 * it * t * mx + t * t * bx, py = it * it * ty + 2 * it * t * my + t * t * by;
          L.ball(px, py, 1.1, 1.1, STEEL, { lo: 2, spec: 0.5 });
        }
        for (let k = 0; k < 7; k++) {
          const a2 = k / 7 * Math.PI * 2 + 0.3;
          L.capsule(bx, by, bx + Math.cos(a2) * 5.6, by + Math.sin(a2) * 5.6, 1.1, 0.3, STEEL, { lo: 3, spec: 0.8 });
        }
        L.ball(bx, by, 3.6, 3.6, STEEL, { spec: 0.9, rim: 0.3 });
        out.ball = [bx, by];
      }
      def.draw(F);
    });
    out.tip = F.T(def.len, 0);
    out.F = F;
    out.def = def;
  }

  function fistR(S, j, a) {
    layer(S, L => fist(L, j.hdR[0], j.hdR[1], a));
  }

  // ---------------------------------------------------------------
  // Effects painted after the outline, on empty pixels only
  // ---------------------------------------------------------------
  const smear = (S, x0, y0, cx, cy, x1, y1, wid, cols) => {
    const n = Math.ceil((Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy)) * 3);
    for (let i = 0; i <= n; i++) {
      const t = i / n, it = 1 - t;
      const x = it * it * x0 + 2 * it * t * cx + t * t * x1;
      const y = it * it * y0 + 2 * it * t * cy + t * t * y1;
      const tx = 2 * it * (cx - x0) + 2 * t * (x1 - cx), ty = 2 * it * (cy - y0) + 2 * t * (y1 - cy);
      const tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl;
      const ww = wid * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.6) + 0.4;
      for (let s2 = -ww; s2 <= ww; s2 += 0.4) {
        const px = Math.floor(x + nx * s2), py = Math.floor(y + ny * s2);
        if (px < 1 || py < 1 || px >= S.w - 1 || py >= S.h - 1 || S.opaque(px, py)) continue;
        const core = 1 - Math.abs(s2) / (ww + 0.01);
        const v = Math.min(1, t * 1.25) * (0.4 + 0.6 * core);
        if (v < P.thresh(px, py) * 0.85 + 0.1) continue;
        S.set(px, py, cols[Math.min(cols.length - 1, Math.floor(v * cols.length))]);
      }
    }
  };

  // Dithered halo on empty pixels around (x, y): cols run inner -> outer.
  const halo = (S, x, y, r, cols, dens = 1) => {
    for (let j = Math.floor(y - r); j <= y + r; j++) for (let i = Math.floor(x - r); i <= x + r; i++) {
      if (i < 1 || j < 1 || i >= S.w - 1 || j >= S.h - 1 || S.opaque(i, j)) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - y) / r;
      if (d >= 1 || (1 - d) * dens < P.thresh(i, j)) continue;
      S.set(i, j, cols[Math.min(cols.length - 1, Math.floor(d * cols.length))]);
    }
  };

  // Four-point star glint (drawn over everything).
  const sparkle = (S, x, y, cols, arm = 2) => {
    x = clamp(Math.floor(x), arm + 1, S.w - arm - 2); y = clamp(Math.floor(y), arm + 1, S.h - arm - 2);
    for (let k = 1; k <= arm; k++) {
      const c = cols[Math.min(cols.length - 1, k)];
      S.set(x + k, y, c); S.set(x - k, y, c); S.set(x, y + k, c); S.set(x, y - k, c);
    }
    S.set(x, y, cols[0]);
  };

  // Spell light between the raised hands: a radiant orb that also lights
  // the nearby hands, helm or hair with a dithered tint.
  const castGlow = (S, x, y) => {
    for (let j = 0; j < S.h; j++) for (let i = 0; i < S.w; i++) {
      if (!S.opaque(i, j)) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - y);
      if (d > 12) continue;
      const k = (1 - d / 12) * 0.9;
      if (k > P.thresh(i, j)) S.set(i, j, P.mix(S.getHex(i, j), '#dbf', 0.45));
    }
    halo(S, x, y, 9.5, ['#dbf', '#b8e', '#96c', '#538'], 1.15);
    for (let k = 0; k < 8; k++) {
      const an = k / 8 * Math.PI * 2 + 0.2, len = k & 1 ? 6 : 9;
      for (let t = 3; t < len; t++) {
        const px = Math.floor(x + Math.cos(an) * t), py = Math.floor(y + Math.sin(an) * t);
        if (px >= 1 && py >= 1 && px < S.w - 1 && py < S.h - 1 && !S.opaque(px, py) && (t < len - 2 || (t & 1))) S.set(px, py, t < 5 ? '#fff' : '#dbf');
      }
    }
    S.ball(x, y, 3.2, 3.2, ['#96c', '#b8e', '#dbf', '#fef', '#fff'], { tone: 1 });
    S.ball(x - 0.5, y - 0.5, 2, 2, ['#fff'], { tone: 1 });
  };

  const TINT = {
    magicsword: { r: 2.6, halo: ['#5ac', '#37a', '#248'], dens: 0.75, glints: [0.55, 0.92], spark: ['#fff', '#bef', '#5ac'], smear: ['#248', '#5ac', '#bef'] },
    holysword: { r: 3.6, halo: ['#fe6', '#eb3', '#c92', '#a70'], dens: 0.9, glints: [0.3, 0.75, 1], spark: ['#fff', '#ffb', '#eb3'], smear: ['#a70', '#eb3', '#ffb'] },
  };

  // ---------------------------------------------------------------
  // Assemble one frame
  // ---------------------------------------------------------------
  const ARMORS = ['none', 'leather', 'chain', 'plate', 'fullplate'];

  function drawHero(S, pose, gear) {
    const act = POSE[pose.act] ? pose.act : 'idle';
    const j = POSE[act](pose);
    const a = ARMORS.includes(gear.armor) ? gear.armor : 'none';
    const wn = WEAPONS[gear.weapon] ? gear.weapon : 'dagger';
    const wout = {};
    const parts = {
      shield: () => shield(S, j, a),
      weapon: () => weapon(S, j, wn, wout),
      legs: () => legs(S, j, a),
      torso: () => torso(S, j, a),
      head: () => head(S, j, a),
      armL: () => arm(S, j, -1, a),
      armR: () => arm(S, j, 1, a),
      paulL: () => pauldron(S, j, -1, a),
      paulR: () => pauldron(S, j, 1, a),
      fistR: () => fistR(S, j, a),
    };
    for (const p of j.order) parts[p]();
    S.outline(INK);
    const tint = TINT[wn];
    if (j.fx.smear && wout.tip) {
      const sm = j.fx.smear;
      smear(S, sm.from[0], sm.from[1], sm.ctrl[0], sm.ctrl[1], wout.tip[0], wout.tip[1], 3.2, tint ? tint.smear : ['#446', '#99a', '#dde']);
    }
    if (tint && wout.F) {
      // enchanted blade: a dithered aura hugging the blade, plus glints
      const F = wout.F, len = wout.def.len;
      for (let u = 3; u <= len; u += 0.5) {
        const [bx, by] = F.T(u, 0);
        halo(S, bx, by, tint.r, tint.halo, tint.dens);
      }
      for (const k of tint.glints) { const [gx, gy] = F.T(len * k, 0); sparkle(S, gx, gy, tint.spark); }
    }
    if (j.fx.orb) castGlow(S, j.fx.orb[0], j.fx.orb[1]);
    if (j.fx.glint && wout.tip) sparkle(S, wout.tip[0], wout.tip[1], ['#fff', '#ffb', '#eb3'], 3);
  }

  A.hero = {
    w: W, h: H, anchor: [40, 71],
    draw(S, pose, gear) { drawHero(S, pose || {}, gear || {}); },
  };

  // ---------------------------------------------------------------
  // HUD portrait: front-facing bust, 24x24
  // ---------------------------------------------------------------
  A.icons['hero_portrait'] = {
    w: 24, h: 24,
    draw(S) {
      // shoulders: blue tunic, mail collar, a leather strap
      layer(S, L => {
        L.ball(12, 26, 12.5, 7.5, TUNIC, { rim: 0.2 });
        L.ball(12, 20.6, 7.6, 3, STEEL, { hi: 6 });
        mailTex(L);
        L.capsule(4.5, 19.5, 7.5, 24, 1.3, 1.3, STRAP, { lo: 1, spec: 0.3 });
      });
      // neck, in the shadow of the jaw
      layer(S, L => { L.capsule(12, 20, 12, 15, 2.9, 3, SKIN, { lo: 1, hi: 5.5 }); L.rect(10, 17, 5, 1, SKIN[2]); L.rect(11, 18, 3, 1, SKIN[3]); }, deepen);
      // ears, face, jaw
      layer(S, L => {
        L.ball(6.4, 11.4, 1.4, 2.2, SKIN, { lo: 2, hi: 7 });
        L.ball(17.6, 11.4, 1.4, 2.2, SKIN, { lo: 1, hi: 5 });
        L.ball(12, 10.6, 5.5, 6.2, SKIN, { lo: 2, spec: 0.05 });
        L.ball(12, 13.4, 4.6, 3.5, SKIN, { lo: 2 });
        // stubble along the jaw
        for (let y = 13; y <= 17; y++) for (let x = 7; x <= 17; x++) {
          if (!L.opaque(x, y) || ((x + y) & 1)) continue;
          if (y >= 17 || x <= 8 || x >= 16) L.set(x, y, P.mix(L.getHex(x, y), '#312', 0.25));
        }
      }, deepen);
      // hair: short and tousled, the fringe stopping above the brows
      layer(S, L => {
        L.ball(12, 5.2, 6.4, 3.7, HAIR, { lo: 1, hi: 7 });
        for (const [x0, y0, x1, y1, r] of [
          [6.8, 5.5, 6.3, 9.4, 1.4], [17.2, 5.5, 17.8, 9.4, 1.3],          // temples
          [8.4, 5.6, 7.8, 7.8, 1.3], [11.4, 5.8, 10.4, 7.4, 1.2], [14.6, 5.8, 15.6, 7.6, 1.2],  // fringe locks
          [7.6, 3.4, 5.5, 2.2, 1.1], [10.6, 2.6, 9.9, 0.9, 1.1], [13.6, 2.6, 14.8, 1, 1.1], [16.4, 3.4, 18.6, 2.5, 1],  // crown tufts
        ]) L.capsule(x0, y0, x1, y1, r, 0.45, HAIR, { lo: 1, hi: 7 });
        for (const [x0, y0, x1, y1] of [[10, 2, 9, 6], [13, 2, 13.5, 6], [16, 3, 17, 7], [7.5, 4, 7, 7]]) stroke(L, HAIR_I, HAIR, x0, y0, x1, y1, -2);
        stroke(L, HAIR_I, HAIR, 8, 4, 10, 2.6, 2);
        stroke(L, HAIR_I, HAIR, 11, 3.5, 12, 2.5, 1);
      }, deepen);
      // face: furrowed brows, shadowed eyes, straight nose, set mouth
      const px = (x, y, c) => S.set(x, y, c);
      for (const [x, y] of [[8, 9], [9, 9], [14, 9], [15, 9], [16, 9]]) px(x, y, SKIN[3]);     // eye sockets
      for (const [x, y] of [[7, 8], [8, 8], [9, 8], [10, 9], [13, 9], [14, 8], [15, 8], [16, 8]]) px(x, y, '#310');
      px(8, 8, '#421'); px(16, 8, '#421');
      px(8, 10, '#edc'); px(9, 10, '#235'); px(10, 10, SKIN[6]);
      px(13, 10, SKIN[5]); px(14, 10, '#235'); px(15, 10, '#cba');
      px(11, 10, SKIN[7]); px(11, 11, SKIN[7]); px(12, 11, SKIN[5]); px(12, 12, SKIN[4]);   // nose ridge and shade
      px(11, 12, SKIN[5]); px(13, 12, SKIN[4]);
      px(10, 14, SKIN[4]); px(11, 14, '#512'); px(12, 14, '#512'); px(13, 14, SKIN[3]);     // mouth
      px(11, 15, SKIN[6]); px(10, 16, SKIN[6]); px(11, 16, SKIN[7]);                         // lit chin
      px(9, 12, SKIN[7]); px(8, 12, SKIN[6]);                                                // cheekbone light
      S.outline(INK);
    },
  };
})();
