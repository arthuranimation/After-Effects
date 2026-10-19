// ================================================================
// EXTERIOR SCENES & LOGO — the DARKWOOD title logo, the title night
// (moon, castle crag, parallax forests, mist, bats), the town plaza
// (arena, smithy, apothecary, inn, the sealed North Gate) and the
// victory dawn (portcullis rising over the road north).
// Static layers are painted once per size/state with the kit; the
// animate() overlays only blit small cached sprites or draw a few
// DW.gfx rects per frame.
// ================================================================
(() => {
  const P = DW.pal, U = DW.util, K = DW.kit, G = DW.gfx, A = DW.art;
  const TH = P.thresh;

  // ---------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------
  // A 1-bit mask with polygon fill (same scanline rule as the kit).
  class Mask {
    constructor(w, h) { this.w = w; this.h = h; this.a = new Uint8Array(w * h); }
    get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.a[y * this.w + x] : 0; }
    set(x, y, v = 1) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.a[y * this.w + x] = v; }
    poly(pts, v = 1, ox = 0, oy = 0) {
      let minY = Infinity, maxY = -Infinity;
      for (const p of pts) { minY = Math.min(minY, p[1] + oy); maxY = Math.max(maxY, p[1] + oy); }
      for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        const sy = y + 0.5, xs = [];
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const xi = pts[i][0] + ox, yi = pts[i][1] + oy, xj = pts[j][0] + ox, yj = pts[j][1] + oy;
          if ((yi > sy) !== (yj > sy)) xs.push(xi + (sy - yi) / (yj - yi) * (xj - xi));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, v);
        }
      }
    }
    // is (x,y) an empty pixel touching the mask?
    edge(x, y, diag) {
      if (this.get(x, y)) return false;
      if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) return true;
      return !!diag && !!(this.get(x - 1, y - 1) || this.get(x + 1, y - 1) || this.get(x - 1, y + 1) || this.get(x + 1, y + 1));
    }
    grow(diag) {
      const m = new Mask(this.w, this.h);
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) || this.edge(x, y, diag)) m.a[y * this.w + x] = 1;
      }
      return m;
    }
  }

  // Copper-bar style vertical gradient into a Sprite: solid bands with
  // Bayer-dithered seams `soft` rows tall. test(x,y) optionally limits it.
  function copper(S, x0, y0, w, h, cols, soft = 4, test) {
    const n = cols.length;
    const bandH = h / Math.max(1, n - 1);
    const edge = Math.min(1, soft / bandH);
    for (let r = 0; r < h; r++) {
      const y = y0 + r;
      const f = (r / Math.max(1, h - 1)) * (n - 1);
      const i = Math.min(n - 2, Math.floor(f));
      const fr = f - i;
      let lv;
      if (fr < 0.5 - edge / 2) lv = 0;
      else if (fr > 0.5 + edge / 2) lv = 1;
      else lv = (fr - (0.5 - edge / 2)) / Math.max(0.0001, edge);
      const a = cols[i], b = cols[Math.min(n - 1, i + 1)];
      for (let x = x0; x < x0 + w; x++) {
        if (test && !test(x, y)) continue;
        S.set(x, y, lv > TH(x, y) ? b : a);
      }
    }
  }

  // Dither a flat colour over existing pixels (or everywhere when all=true) at level 0..1.
  function veil(S, x0, y0, w, h, col, level, test, all = true) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      if (test && !test(x, y)) continue;
      if (!all && !S.opaque(x, y)) continue;
      const lv = typeof level === 'function' ? level(x, y) : level;
      if (lv > TH(x, y)) S.set(x, y, col);
    }
  }

  // Catmull-Rom spline through points -> dense polyline.
  function spline(pts, step = 1) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const n = Math.max(2, Math.ceil(len / step));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), p1[2] !== undefined ? p1[2] : 0]);
      }
    }
    const last = pts[pts.length - 1];
    out.push([last[0], last[1], last[2] || 0]);
    return out;
  }

  // Tiny memo keyed by string.
  const memo = new Map();
  const remember = (key, fn) => { let v = memo.get(key); if (v === undefined) { v = fn(); memo.set(key, v); } return v; };

  // Value noise (optionally periodic in x so strips tile seamlessly).
  function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, seed, px) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const wx = v => (px ? ((v % px) + px) % px : v);
    const a = hash2(wx(xi), yi, seed), b = hash2(wx(xi + 1), yi, seed);
    const c = hash2(wx(xi), yi + 1, seed), d = hash2(wx(xi + 1), yi + 1, seed);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, seed, oct = 3, px) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 17, px ? px * f : 0); n += a; a *= 0.5; f *= 2; }
    return s / n;
  }

  // ---------------------------------------------------------------
  // Night-sky pieces shared by the title and town
  // ---------------------------------------------------------------
  const MOON = ['#324', '#435', '#657', '#879', '#a9a', '#bbb', '#ccb', '#ddc', '#eed', '#ffe'];

  // Halo + cratered full moon, lit from the upper left.
  function paintMoon(S, mx, my, R, o = {}) {
    const halo = o.halo || ['#425', '#536', '#647'];
    const hr = R * (o.haloR || 2.1);
    // soft halo rings (dithered, copper-style steps)
    for (let y = Math.floor(my - hr); y <= my + hr; y++) for (let x = Math.floor(mx - hr); x <= mx + hr; x++) {
      const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my);
      if (d <= R || d > hr) continue;
      const f = 1 - (d - R) / (hr - R);          // 1 at the limb → 0 outside
      const v = Math.pow(f, 1.6) * halo.length;
      const i = Math.floor(v);
      if (i >= halo.length) { S.set(x, y, halo[halo.length - 1]); continue; }
      if (v - i > TH(x, y)) S.set(x, y, halo[i]);
      else if (i > 0) S.set(x, y, halo[i - 1]);
    }
    const craters = [];
    const r = U.rng(o.seed || 7);
    for (let i = 0; i < 4 + Math.round(R / 14); i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R * 0.7;
      craters.push([mx + Math.cos(a) * d, my + Math.sin(a) * d, Math.max(2.2, R * (0.07 + r() * 0.07))]);
    }
    for (let y = Math.floor(my - R); y <= my + R; y++) for (let x = Math.floor(mx - R); x <= mx + R; x++) {
      const dx = (x + 0.5 - mx) / R, dy = (y + 0.5 - my) / R;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const n = K.norm3([dx, dy, Math.sqrt(1 - d2)]);
      let I = S.lit(n, { ambient: 0.62 });
      // maria: soft dark seas in two depths
      const m = fbm(dx * 1.5 + 3, dy * 1.5 + 1, (o.seed || 7) + 5, 2);
      if (m > 0.53) I -= 0.12 + (m > 0.6 ? 0.08 : 0);
      for (const [cx, cy, cr] of craters) {
        const ex = x + 0.5 - cx, ey = y + 0.5 - cy, cd = Math.hypot(ex, ey);
        if (cd > cr) continue;
        if (cd > cr - 1.1) I += (ex + ey > 0 ? 0.14 : -0.1);   // lit lower-right rim
        else I -= (ex + ey < 0 ? 0.16 : 0.07);                  // shadowed upper-left bowl
      }
      // darker limb
      if (d2 > 0.86) I -= 0.08;
      S.shadePx(x, y, MOON, I);
    }
  }

  // Stars as data; drawn (twinkling) per frame by drawStars.
  function makeStars(w, yMax, count, seed, avoid) {
    const r = U.rng(seed), out = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 20) {
      const x = Math.floor(r() * w), y = Math.floor(Math.pow(r(), 1.25) * yMax);
      if (avoid && avoid(x, y)) continue;
      const b = r();
      out.push({ x, y, b, ph: r() * 6.28, rate: 0.6 + r() * 2.2, big: b > 0.94 });
    }
    return out;
  }
  const STAR_COLS = ['#213', '#324', '#446', '#668', '#99b', '#ccd', '#fff'];
  function drawStars(ctx, ox, oy, stars, t, h) {
    for (const s of stars) {
      if (h && s.y >= h) continue;
      const tw = 0.5 + 0.5 * Math.sin(t * s.rate + s.ph);
      const v = U.clamp(s.b * 4.2 + tw * 2.2 - 0.4, 0, 6) | 0;
      if (v <= 0) continue;
      const col = STAR_COLS[v];
      G.rect(ox + s.x, oy + s.y, 1, 1, col, ctx);
      if (s.big && v >= 5) {
        const arm = STAR_COLS[v - 2];
        G.rect(ox + s.x - 1, oy + s.y, 1, 1, arm, ctx); G.rect(ox + s.x + 1, oy + s.y, 1, 1, arm, ctx);
        G.rect(ox + s.x, oy + s.y - 1, 1, 1, arm, ctx); G.rect(ox + s.x, oy + s.y + 1, 1, 1, arm, ctx);
        if (v >= 6 && tw > 0.85) {
          G.rect(ox + s.x - 2, oy + s.y, 1, 1, '#446', ctx); G.rect(ox + s.x + 2, oy + s.y, 1, 1, '#446', ctx);
          G.rect(ox + s.x, oy + s.y - 2, 1, 1, '#446', ctx); G.rect(ox + s.x, oy + s.y + 2, 1, 1, '#446', ctx);
        }
      }
    }
  }

  // Pixel bat, 2 wing frames (cached).
  function batSprite(f) {
    return K.cached('dw26|bat|' + f, 11, 7, S => {
      const body = '#101', wing = '#102';
      if (f === 0) {   // wings up
        S.poly([[5, 3], [1, 0], [0, 2], [2, 2], [3, 4]], wing, { tone: 0.5 });
        S.poly([[6, 3], [10, 0], [11, 2], [9, 2], [8, 4]], wing, { tone: 0.5 });
      } else {         // wings down
        S.poly([[5, 3], [0, 4], [1, 6], [3, 5], [4, 4]], wing, { tone: 0.5 });
        S.poly([[6, 3], [11, 4], [10, 6], [8, 5], [7, 4]], wing, { tone: 0.5 });
      }
      S.rect(5, 2, 2, 3, body); S.px(5, 1, body); S.px(6, 1, body);
      S.px(5, 3, '#a13'); S.px(6, 3, '#a13');
    });
  }

  // Tree silhouettes for forest strips. col = body colour, rim = moonlit edge (upper-left).
  function pineTree(S, x, base, h, hw, col, rim, seed, tipsOnly) {
    const r = U.rng(seed);
    const tiers = Math.max(3, Math.round(h / 6));
    const top = Math.round(base - h);
    S.rect(Math.round(x), top - 1, 1, Math.ceil(h) + 1, col);
    for (let y = top; y < base; y++) {
      const t = (y - top) / h;
      const tierT = (t * tiers) % 1;
      let half = hw * (0.12 + 0.88 * Math.pow(t, 0.9)) * (0.5 + 0.5 * tierT) + (r() - 0.5) * 0.8;
      const x0 = Math.round(x - half), x1 = Math.round(x + half);
      for (let xx = x0; xx <= x1; xx++) S.set(xx, y, col);
      if (rim && half > 0.8) {
        if (!tipsOnly) { S.set(x0, y, rim); if (tierT > 0.7 && half > 2.5) S.set(x0 + 1, y, rim); }
        else if (tierT > 0.62 || y < top + 2) { S.set(x0, y, rim); if (half > 3) S.set(x0 + 1, y, rim); }
      }
    }
  }
  function roundTree(S, x, base, h, hw, col, rim, seed) {
    const r = U.rng(seed);
    const top = base - h;
    S.rect(Math.round(x), Math.round(top + h * 0.5), 1, Math.ceil(h * 0.5), col);
    const blobs = 4 + Math.floor(r() * 3);
    const pts = [];
    for (let i = 0; i < blobs; i++) {
      const bx = x + (r() - 0.5) * hw * 1.1, by = top + hw * 0.55 + r() * h * 0.3;
      const br = hw * (0.42 + r() * 0.28);
      S.ellipse(bx, by, br, br * 0.8, col);
      pts.push([bx, by, br]);
    }
    if (rim) {
      for (const [bx, by, br] of pts) for (let y = Math.floor(by - br); y < by; y++) for (let xx = Math.floor(bx - br); xx < bx; xx++) {
        if (S.getHex(xx, y) !== col) continue;
        if ((!S.opaque(xx - 1, y) || !S.opaque(xx, y - 1)) && TH(xx, y) < 0.75) S.set(xx, y, rim);
      }
    }
  }
  // Gnarled bare tree, recursive. Flat colour; rim added by the caller.
  function gnarlBranch(S, x, y, ang, len, r, depth, rnd, col, o = {}) {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    const bend = (rnd() - 0.5) * len * 0.5;
    const qx = (x + x2) / 2 - Math.sin(ang) * bend, qy = (y + y2) / 2 + Math.cos(ang) * bend;
    S.horn(x, y, qx, qy, x2, y2, r, Math.max(0.5, r * 0.68), [col], { tone: 0 });
    if (depth <= 0 || r < 0.7) return;
    const n = rnd() < 0.3 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      let a = ang + (i - (n - 1) / 2) * (0.55 + rnd() * 0.35) + (rnd() - 0.5) * 0.3;
      if (o.up) a = a * 0.8 + o.up * 0.2;
      gnarlBranch(S, x2, y2, a, len * (0.62 + rnd() * 0.18), r * 0.62, depth - 1, rnd, col, o);
    }
  }
  // Rim-light the upper-left edges of everything painted in a sprite.
  function rimLight(S, rim, rim2, test) {
    const W = S.w, H = S.h, src = S.data.slice();
    const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? src[y * W + x] : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!at(x, y) || (test && !test(x, y))) continue;
      const l = !at(x - 1, y), u = !at(x, y - 1);
      if (l && u) S.set(x, y, rim);
      else if (l || u) S.set(x, y, TH(x, y) < 0.6 ? rim : (rim2 || rim));
      else if (rim2 && (!at(x - 2, y) || !at(x - 1, y - 1)) && TH(x, y) < 0.3) S.set(x, y, rim2);
    }
  }

  // Wispy cloud streak: darkens sky, veils the moon.
  function cloudStreak(S, cx, cy, len, th, seed, onMoon) {
    for (let x = Math.floor(cx - len / 2); x < cx + len / 2; x++) {
      const k = (x - (cx - len / 2)) / len;
      const taper = Math.pow(Math.sin(Math.PI * k), 0.8);
      const yc = cy + Math.sin(x * 0.07 + seed) * 1.2;
      const tt = th * taper;
      for (let y = Math.floor(yc - tt - 1); y <= yc + tt + 1; y++) {
        const d = 1 - Math.abs(y + 0.5 - yc) / (tt + 0.5);
        if (d <= 0) continue;
        const n = vnoise(x / 22, y / 6, seed);
        const lv = d * d * (0.25 + n * 1.3) * taper;
        if (lv <= TH(x, y)) continue;
        const hex = S.getHex(x, y);
        if (!hex) continue;
        if (onMoon(x, y)) {
          const i = MOON.indexOf(hex);
          S.set(x, y, MOON[Math.max(3, (i < 0 ? 6 : i) - 2)]);
        } else S.set(x, y, P.shade(hex, 0.7));
      }
    }
  }

  // Clean cloud bar: a long, tapered dark strip with a moonlit top edge.
  function cloudBar(S, x0, x1, y, th, onMoon, dark, lit) {
    for (let x = Math.round(x0); x < x1; x++) {
      const k = (x - x0) / (x1 - x0);
      const t = Math.max(1, Math.round(th * Math.min(1, Math.min(k, 1 - k) * 8)));
      const yy = Math.round(y + Math.sin(x * 0.09) * 0.6);
      for (let j = 0; j < t; j++) {
        const py = yy - j;
        const m = onMoon(x, py);
        S.set(x, py, j === t - 1 && t > 1 ? (m ? '#bbb' : lit) : (m ? '#879' : dark));
      }
    }
  }

  // ================================================================
  // TITLE — moonlit night over the castle-city of Darkwood.
  // ================================================================
  const TITLE_SKY = ['#001', '#002', '#103', '#104', '#204', '#205', '#315', '#325', '#426', '#436', '#537'];

  function titleLayout(w, h) {
    return remember(`title|${w}x${h}`, () => {
      const L = {};
      L.u = w / 234;
      L.R = Math.round(Math.min(w * 0.15, h * 0.078));
      L.mx = Math.round(w * 0.39);
      L.my = Math.round(Math.max(h * 0.30 + L.R + 3, h * 0.11 + 76 + L.R));
      L.far = Math.round(h * 0.565);
      L.mid = Math.round(h * 0.635);
      L.near = Math.round(h * 0.68);
      L.horizon = L.far;
      L.crag = { cx: Math.round(w * 0.635), top: Math.round(L.my + L.R * 0.55) };
      L.stars = makeStars(w, L.far - 10, Math.round(w * h / 1100), 4242,
        (x, y) => Math.hypot(x - L.mx, y - L.my) < L.R * 1.5);
      L.windows = [];
      L.flies = [];
      const r = U.rng(55);
      for (let i = 0; i < 9; i++) L.flies.push({ x: r() * w, y: L.mid + r() * (h - L.mid) * 0.75, ph: r() * 6.28, sp: 0.3 + r() * 0.5 });
      return L;
    });
  }

  // The castle-city on its crag (static, behind the forests).
  function paintCastle(S, w, h, L, o = {}) {
    const C = K.create(w, h);
    const BODY = o.body || '#102';
    const body = [BODY];
    const u = o.u || Math.max(1.05, Math.min(L.u, h / 506 * 1.08) * 1.22);
    const cx = L.crag.cx, top = L.crag.top;
    const X = v => Math.round(cx + v * u), Y = v => Math.round(top - v * u);
    // crag: a cliff-sided spire; y given downward from the summit
    const left = [[-27, 0], [-30, 5], [-28, 10], [-35, 15], [-33, 22], [-42, 28], [-40, 36], [-50, 42], [-52, 52], [-66, 62], [-78, 90]];
    const right = [[27, 0], [29, 3], [37, 6], [36, 12], [43, 16], [45, 23], [52, 26], [50, 33], [60, 40], [64, 52], [80, 66], [92, 90]];
    const poly = left.map(([a, b]) => [X(a), Y(-b)]).concat(right.slice().reverse().map(([a, b]) => [X(a), Y(-b)]));
    C.poly(poly, body, { tone: 0 });
    // cliff texture: dark cracks and lighter ledges are added after the rim pass
    // houses on the eastern ledges: [x, y(down), w, h]
    const houses = [[30, 4, 6, 5], [37, 4, 5, 4], [38, 14, 6, 4], [46, 21, 6, 5], [53, 24, 5, 4], [52, 38, 7, 5], [60, 38, 5, 4], [-36, 13, 5, 4], [-44, 26, 6, 4]];
    // curtain wall with merlons
    C.rect(X(-27), Y(9), Math.round(54 * u), Math.round(9 * u) + 1, BODY);
    for (let i = -27; i < 27; i += 3) C.rect(X(i), Y(11), Math.max(1, Math.round(1.6 * u)), 2, BODY);
    // towers
    const tower = (x0, tw, th, rh, flag, cren) => {
      C.rect(X(x0), Y(th), Math.round(tw * u), Math.round(th * u) + 1, BODY);
      const rx0 = X(x0) - 1, rx1 = X(x0 + tw) + 1, mid = (rx0 + rx1) / 2;
      if (cren) for (let i = 0; i < tw; i += 3) C.rect(X(x0 + i), Y(th + 2), 2, 2, BODY);
      const ry = Y(th + (cren ? 2 : 0));
      C.poly([[rx0, ry + 1], [rx1 + 1, ry + 1], [mid + 1.5, Y(th + rh)], [mid - 0.5, Y(th + rh)]], body, { tone: 0 });
      const tipX = Math.round(mid), tipY = Y(th + rh);
      C.rect(tipX, tipY - 3, 1, 3, BODY);
      if (flag) { C.rect(tipX + 1, tipY - 3, 3, 1, '#a12'); C.rect(tipX + 1, tipY - 2, 2, 1, '#702'); C.px(tipX + 4, tipY - 2, '#702'); }
    };
    tower(-25, 10, 40, 20, true);    // great west tower (crosses the moon)
    tower(-12, 4, 25, 15, false);    // chapel spire
    tower(-6, 16, 31, 13, true, true);  // keep
    tower(12, 7, 27, 12, true);      // east tower
    tower(21, 5, 16, 8, false);      // gate turret
    // moonlit rim (light from the upper left)
    rimLight(C, o.rim || '#435', o.rim2 || '#314');
    // houses clinging to the ledges: moonlit plaster under dark gables
    for (const [hx, hy, hw, hh] of houses) {
      const x0 = X(hx), x1 = X(hx + hw), yb = Y(-hy), yt = Y(-hy + hh);
      C.rect(x0, yt, x1 - x0, yb - yt + 1, o.house ? o.house[0] : '#214');
      C.rect(x0, yt, 1, yb - yt + 1, o.house ? o.house[1] : '#325');
      C.rect(x1 - 1, yt, 1, yb - yt + 1, '#204');
      const ap = Math.round(hw * 0.55 * u);
      C.tri([x0 - 1, yt + 1], [x1 + 1, yt + 1], [(x0 + x1) / 2, yt - ap], [BODY], { tone: 0 });
      C.line(x0 - 1, yt, Math.round((x0 + x1) / 2) - 1, yt - ap + 1, o.rim2 || '#314');
    }
    // cliff cracks and ledges
    const rr = U.rng(3);
    for (let i = 0; i < 16; i++) {
      const sx = X(-40 + rr() * 90), sy = Y(-8 - rr() * 50);
      if (!C.opaque(sx, sy)) continue;
      const len = 4 + rr() * 9;
      for (let k = 0; k < len; k++) { const px = sx + Math.round(Math.sin(k * 0.7 + i) * 1), py = sy + k; if (C.getHex(px, py) === BODY) C.set(px, py, '#001'); }
      if (C.getHex(sx - 1, sy) === BODY) C.set(sx - 1, sy, '#213');
    }
    // lit windows (remembered for flicker)
    const win = (vx, vy, tall) => {
      const x = X(vx), y = Y(vy);
      if (!C.opaque(x, y)) return;
      C.set(x, y, o.win || '#fd5'); if (tall) C.set(x, y + 1, o.win2 || '#c60');
      L.windows.push([x, y, tall ? 2 : 1]);
    };
    win(-21, 34, 1); win(-19, 26, 0); win(-21, 18, 0); win(-10, 18, 0);
    win(-2, 25, 1); win(3, 25, 1); win(1, 16, 0); win(6, 10, 0);
    win(15, 21, 1); win(16, 13, 0); win(23, 11, 0);
    win(-22, 5, 0); win(-14, 5, 0); win(-4, 4, 0); win(10, 5, 0); win(19, 4, 0);
    for (const [hx, hy, hw, hh] of houses) { win(hx + 1.5, -hy + 2.5, 1); if (hw > 5) win(hx + hw - 2, -hy + 2.5, 1); }
    win(-31, -9, 0);
    S.stamp(C, 0, 0);
    // no stars in front of the castle or crag
    if (L.stars) L.stars = L.stars.filter(st => !C.opaque(st.x, st.y) && !C.opaque(st.x, st.y + 2) && !C.opaque(st.x - 1, st.y) && !C.opaque(st.x + 1, st.y));
  }

  // Forest strip layers (each opaque from its treeline down). Cached per size.
  const TITLE_PAN = [1, 3, 6];      // sway amplitude per layer (px)
  function titleLayer(w, h, i) {
    const L = titleLayout(w, h);
    const pad = TITLE_PAN[i] + 1, W = w + pad * 2;
    return K.cached(`dw26|title|L${i}|${w}x${h}`, W, h, S => {
      const r = U.rng(900 + i * 31);
      const u = Math.max(0.9, L.u);
      if (i === 0) {
        // far: hazy violet pines, low contrast, lit only at the branch tips
        const yb = L.far;
        const ranks = [['#326', '#437', 0], ['#325', '#436', 7]];
        ranks.forEach(([col, rim, dy], row) => {
          for (let x = -6; x < W + 6; x += 2 + r() * 3.5) {
            const hh = (8 + r() * 11 + 5 * Math.sin(x * 0.045 + row * 2)) * u;
            pineTree(S, x, yb + 4 + dy, hh, 2 + hh * 0.2, col, rim, (x * 7 + row * 99) | 0, true);
          }
        });
        copper(S, 0, yb + 10, W, h - yb - 10, ['#325', '#214'], 3);
      } else if (i === 1) {
        // mid: dark spires and a few broad oaks; crisp silhouettes, tips touched by the moon
        const yb = L.mid;
        const ranks = [['#103', '#215', 0, 1.1], ['#102', '#204', 9, 0.9]];
        ranks.forEach(([col, rim, dy, sc], row) => {
          for (let x = -10; x < W + 10; x += 4 + r() * 6) {
            const tall = r() < 0.18 ? 1.45 : 1;
            const hh = (20 + r() * 16 + 8 * Math.sin(x * 0.033 + 4 + row * 1.7)) * u * sc * tall;
            if (r() < 0.2) roundTree(S, x, yb + 6 + dy, hh * 0.7, 5 + r() * 4, col, rim, (x * 13 + row) | 0);
            else pineTree(S, x, yb + 6 + dy, hh, 2.5 + hh * 0.2, col, rim, (x * 11 + row * 7) | 0, true);
          }
        });
        S.rect(0, yb + 14, W, h - yb - 14, '#102');
      } else {
        // near: black hillside framed by great gnarled trees
        const col = '#001';
        const yb = L.near;
        const hill = x => yb + Math.sin(x * 0.021 + 0.6) * 5 * u + Math.sin(x * 0.057) * 2;
        for (let x = 0; x < W; x++) { const y0 = Math.round(hill(x)); S.rect(x, y0, 1, h - y0, col); }
        // grass and fern tufts along the crest
        for (let x = 0; x < W; x += 1) {
          const y0 = Math.round(hill(x));
          if (r() < 0.45) S.rect(x, y0 - 1 - Math.floor(r() * 3), 1, 3, col);
        }
        for (let k = 0; k < 7; k++) {
          const fx = r() * W, fy = hill(fx) + 1;
          for (let a = -2; a <= 2; a++) S.horn(fx, fy, fx + a * 2, fy - 5, fx + a * 4.5, fy - 3 + Math.abs(a), 0.7, 0.4, [col], { tone: 0 });
        }
        // great trees at both edges, leaning in over the scene
        const gnarl = (bx, side, sd) => {
          const rr = U.rng(sd);
          const tb = Math.round(hill(bx)) + 8;
          const th = (tb - h * 0.34);
          // roots
          for (let k = 0; k < 3; k++) S.horn(bx, tb - 6, bx + side * (6 + k * 5), tb - 2, bx + side * (10 + k * 7), tb + 3, 2.4, 0.8, [col], { tone: 0 });
          // trunk in two bends
          const tx1 = bx + side * 6 * u, ty1 = tb - th * 0.5, tx2 = bx + side * 2 * u, ty2 = tb - th;
          S.horn(bx, tb, bx - side * 3, tb - th * 0.25, tx1, ty1, 11 * u, 7 * u, [col], { tone: 0 });
          S.horn(tx1, ty1, tx1 + side * 4, ty1 - th * 0.25, tx2, ty2, 7 * u, 4 * u, [col], { tone: 0 });
          // main limbs reaching in (kept low so the logo band stays clear)
          gnarlBranch(S, tx1, ty1 + 10, -Math.PI / 2 + side * 1.2, 28 * u, 4 * u, 4, rr, col);
          gnarlBranch(S, (tx1 + tx2) / 2, (ty1 + ty2) / 2, -Math.PI / 2 + side * 0.85, 26 * u, 3.4 * u, 4, rr, col);
          gnarlBranch(S, tx2, ty2 + 2, -Math.PI / 2 + side * 0.45, 18 * u, 2.6 * u, 3, rr, col);
          gnarlBranch(S, tx2, ty2 + 6, -Math.PI / 2 - side * 0.35, 12 * u, 2 * u, 3, rr, col);
          // hanging moss strands
          for (let k = 0; k < 5; k++) {
            const mx = tx1 + side * (8 + rr() * 30) * u, my0 = ty1 - 10 - rr() * th * 0.3;
            if (!S.opaque(Math.round(mx), Math.round(my0))) continue;
            const ml = 4 + rr() * 10;
            for (let q = 0; q < ml; q++) if (TH(Math.round(mx), Math.round(my0 + q)) < 0.8 - q / ml * 0.6) S.set(mx, my0 + q, col);
          }
        };
        gnarl(pad + 2, 1, 77);
        gnarl(W - pad - 3, -1, 93);
        rimLight(S, '#102', '#101', (x, y) => y < L.near + 4);
        // a faint path winding up toward the castle
        for (let y = yb + 2; y < h; y++) {
          const k = (y - yb) / (h - yb);
          const pc = W * 0.5 + Math.sin(k * 3.6 + 0.4) * W * 0.12 * (0.3 + k);
          const pw = 1 + k * k * W * 0.16;
          for (let x = Math.floor(pc - pw); x <= pc + pw; x++) {
            const e = 1 - Math.abs(x + 0.5 - pc) / pw;
            if (e * (0.42 - k * 0.2) > TH(x, y) && S.opaque(x, y)) S.set(x, y, '#102');
          }
        }
      }
    });
  }

  // Mist band: periodic dithered wisps, scrolled in animate.
  function mistStrip(key, PW, bh, col, dens, seed) {
    return K.cached(`dw26|mist|${key}|${PW}x${bh}`, PW, bh, S => {
      for (let y = 0; y < bh; y++) for (let x = 0; x < PW; x++) {
        const vy = Math.sin((y + 0.5) / bh * Math.PI);
        const n = fbm(x / PW * 8, y / 7, seed, 3, 8);
        const lv = vy * vy * (n * 1.7 - 0.45) * dens;
        if (lv > TH(x, y)) S.set(x, y, col);
      }
    });
  }

  A.scenes['title'] = {
    paint(S, w, h) {
      const L = titleLayout(w, h);
      L.windows.length = 0;
      copper(S, 0, 0, w, L.horizon, TITLE_SKY, 4);
      S.rect(0, L.horizon, w, h - L.horizon, TITLE_SKY[TITLE_SKY.length - 1]);
      paintMoon(S, L.mx, L.my, L.R, { seed: 11 });
      const onMoon = (x, y) => Math.hypot(x + 0.5 - L.mx, y + 0.5 - L.my) <= L.R;
      cloudBar(S, L.mx - L.R * 1.6, L.mx + L.R * 1.1, L.my + L.R * 0.42, 3, onMoon, '#214', '#426');
      cloudBar(S, L.mx - L.R * 0.9, L.mx + L.R * 0.5, L.my + L.R * 0.62, 2, onMoon, '#214', '#426');
      cloudBar(S, L.mx - L.R * 2.4, L.mx - L.R * 0.6, L.my + L.R * 0.86, 2, onMoon, '#204', '#315');
      cloudStreak(S, L.mx + L.R * 2.1, L.my - L.R * 0.55, L.R * 2.4, 1.2, 5, onMoon);
      cloudStreak(S, w * 0.80, h * 0.30, w * 0.30, 1.1, 9, onMoon);
      paintCastle(S, w, h, L);
      // moonlit haze pooling behind the far treeline
      veil(S, 0, L.far - 18, w, 26, '#426', (x, y) => Math.max(0, 1 - Math.abs(y - (L.far - 4)) / 13) * 0.75 * (0.6 + 0.4 * Math.sin(x * 0.05)));
    },
    animate(ctx, x, y, w, h, t) {
      const L = titleLayout(w, h);
      drawStars(ctx, x, y, L.stars, t);
      for (let i = 0; i < L.windows.length; i++) {
        const [wx, wy] = L.windows[i];
        const n = U.noise1(t * 2.5 + i * 7.3, i);
        if (n < 0.22) G.rect(x + wx, y + wy, 1, 1, '#c60', ctx);
        else if (n > 0.82) G.rect(x + wx, y + wy, 1, 1, '#ffb', ctx);
      }
      // bats crossing the moon now and then
      const bc = t % 13;
      if (bc < 5) {
        const k = bc / 5, cyc = Math.floor(t / 13);
        for (let b = 0; b < 1 + (cyc % 2); b++) {
          const bx = x + Math.round(w + 10 - k * (w + 30) + b * 14);
          const by = y + Math.round(L.my - L.R * (0.9 - (cyc % 3) * 0.5) + Math.sin(k * 11 + b * 2) * 5 + b * 6);
          G.blit(batSprite((Math.floor(t * 8) + b) % 2), bx, by, { ctx });
        }
      }
      const sway = Math.sin(t * 0.19);
      const PW = 256;
      const mists = [
        [L.far + 1, 16, '#437', 1.1, 2.5, 1],
        [L.mid - 2, 18, '#325', 1.1, 4.5, 2],
        [L.near + 24, 30, '#103', 1.1, 7, 3],
      ];
      for (let i = 0; i < 3; i++) {
        const pad = TITLE_PAN[i] + 1;
        G.blit(titleLayer(w, h, i), x - pad + Math.round(sway * TITLE_PAN[i]), y, { ctx });
        const [my0, mh, mc, md, sp, sd] = mists[i];
        const img = mistStrip('t' + i, PW, mh, mc, md, sd);
        const off = Math.floor(t * sp) % PW;
        for (let mx = -off; mx < w; mx += PW) G.blit(img, x + mx, y + my0, { ctx });
      }
      // fireflies in the dark wood
      for (const f of L.flies) {
        const fx = x + Math.round((f.x + Math.sin(t * f.sp + f.ph) * 10 + w) % w);
        const fy = y + Math.round(f.y + Math.sin(t * f.sp * 1.7 + f.ph * 2) * 5);
        const b = Math.sin(t * 2.2 + f.ph * 3);
        if (b > 0.2) G.rect(fx, fy, 1, 1, b > 0.75 ? '#ef8' : '#9c4', ctx);
      }
    },
  };

  // ================================================================
  // TOWN — the plaza of Darkwood at night, the sealed North Gate.
  // ================================================================
  const TOWN_SKY = ['#001', '#002', '#103', '#104', '#204', '#205', '#315', '#325', '#426'];
  const R_WALL = ['#101', '#112', '#213', '#223', '#334', '#445', '#556', '#667', '#889'];
  const R_SAND = ['#100', '#201', '#311', '#322', '#432', '#543', '#654', '#765', '#986'];
  const R_SLATE = ['#001', '#102', '#113', '#213', '#224', '#335', '#446', '#557'];
  const R_GREEN = ['#011', '#012', '#122', '#233', '#344', '#455', '#567', '#788'];
  const R_PLASTER = ['#211', '#322', '#433', '#544', '#655', '#766', '#987', '#ba9'];
  const R_TIMBER = ['#100', '#200', '#310', '#321', '#431', '#542', '#653'];
  const R_SOOT = ['#100', '#201', '#212', '#322', '#433', '#544', '#655', '#766', '#877'];
  const R_COBBLE = ['#101', '#112', '#212', '#223', '#323', '#334', '#445', '#556'];
  const R_IRON = ['#001', '#112', '#223', '#334', '#445', '#667', '#889'];

  function townLayout(w, h) {
    return remember(`town|${w}x${h}`, () => {
      const cx = Math.round(w / 2);
      const L = { w, h, cx };
      L.yF = h - 16;                 // front ground line
      L.yB = h - 114;                // back ground line (foot of the wall)
      L.wallTop = L.yB - 40;
      L.gate = { x0: cx - 29, x1: cx + 29, base: L.yB, top: L.yB - 72, ax0: cx - 12, ax1: cx + 12, aTop: L.yB - 30 };
      const ax1 = cx - 32;
      L.arena = { x1: ax1, x0: ax1 - Math.min(122, ax1 + 10), base: L.yB + 4 };
      L.arena.top = L.arena.base - 86;
      L.apo = { x0: cx + 39, x1: cx + 39 + 52, base: L.yB + 10 };
      L.apo.top = L.apo.base - 88;
      const sw = Math.min(80, Math.round(w * 0.33));
      L.smithy = { x0: 0, x1: sw, base: L.yF, top: L.yF - 78 };
      const iw = Math.min(86, Math.round(w * 0.36));
      L.inn = { x0: w - iw, x1: w, base: L.yF + 2, top: L.yF + 2 - 100 };
      L.braziers = [[cx - 26, L.yB + 15], [cx + 26, L.yB + 15]];
      const mr = Math.round(U.clamp(L.arena.top * 0.05, 9, 13));
      L.moon = { x: Math.round(w * 0.2), y: Math.max(mr + 4, Math.round((L.arena.top) * 0.3)), r: mr };
      L.stars = makeStars(w, L.wallTop - 4, Math.round(w * (L.wallTop) / 260), 777,
        (x, y) => Math.hypot(x - L.moon.x, y - L.moon.y) < L.moon.r * 2);
      return L;
    });
  }

  // Masonry: running-bond blocks with mortar, per-block tone jitter.
  // o: { bw, bh, I (number|fn(x,y)), seed, test(x,y), oy }
  function masonry(S, x0, y0, w, h, ramp, o = {}) {
    const bw = o.bw || 6, bh = o.bh || 3, seed = o.seed || 1;
    const oy = o.oy !== undefined ? o.oy : y0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      if (o.test && !o.test(x, y)) continue;
      const ry = y - oy, row = Math.floor(ry / bh);
      const off = (row & 1) ? (bw >> 1) : 0;
      const rx = x + off, col = Math.floor(rx / bw);
      const bx = rx - col * bw, by = ry - row * bh;
      let I = typeof o.I === 'function' ? o.I(x, y) : (o.I !== undefined ? o.I : 0.5);
      I += (hash2(col, row, seed) - 0.5) * 0.14;
      if (by === bh - 1 || bx === bw - 1) I -= 0.2;
      else if (by === 0 || bx === 0) I += 0.06;
      S.shadePx(x, y, ramp, I);
    }
  }

  // Overlapping roof tiles / shingles inside test(x,y).
  function shingles(S, x0, y0, x1, y1, ramp, test, o = {}) {
    const rh = o.rh || 3, tw = o.tw || 4, seed = o.seed || 3;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!test(x, y)) continue;
      const row = Math.floor((y - y0) / rh), by = (y - y0) - row * rh;
      const off = (row & 1) ? (tw >> 1) : 0;
      const col = Math.floor((x + off) / tw), bx = (x + off) - col * tw;
      let I = typeof o.I === 'function' ? o.I(x, y) : (o.I !== undefined ? o.I : 0.45);
      I += (hash2(col, row, seed) - 0.5) * 0.16;
      if (by === rh - 1) I -= 0.24;
      else if (bx === 0) I -= 0.1;
      else if (by === 0) I += 0.08;
      S.shadePx(x, y, ramp, I);
    }
  }

  // Warm (or any) light pool: tints existing pixels with a dithered falloff.
  function lightPool(S, lx, ly, r, k, col, o = {}) {
    const sq = o.squash || 1;
    for (let y = Math.floor(ly - r / sq); y <= ly + r / sq; y++) for (let x = Math.floor(lx - r); x <= lx + r; x++) {
      const d = Math.hypot(x + 0.5 - lx, (y + 0.5 - ly) * sq) / r;
      if (d >= 1 || (o.test && !o.test(x, y))) continue;
      const hex = S.getHex(x, y);
      if (!hex) continue;
      const f = (1 - d) * (1 - d) * k;
      const t = TH(x, y);
      if (f > t + 0.5) S.set(x, y, P.mix(hex, col, o.max || 0.5));
      else if (f > t) S.set(x, y, P.mix(hex, col, (o.max || 0.5) * 0.55));
    }
  }

  // Defer a light pool so it lands on everything painted (buildings and cobbles).
  const pool = (L, ...args) => L.pools.push(args);
  // Paint into a private layer, ink-outline it, then stamp it onto the scene.
  function inked(S, w, h, fn, ink = '#101') {
    const C = K.create(w, h);
    fn(C);
    const d = C.data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) if (d[row + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y0 > y) y0 = y; y1 = y; }
    }
    if (x1 < 0) return C;
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(w - 1, x1 + 1); y1 = Math.min(h - 1, y1 + 1);
    const ci = P.toInt(ink);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (d[i]) { S.data[i] = d[i]; continue; }
      if ((x > 0 && d[i - 1]) || (x < w - 1 && d[i + 1]) || (y > 0 && d[i - w]) || (y < h - 1 && d[i + w])) S.data[i] = ci;
    }
    return C;
  }

  // Window: frame, lit glass with panes, sill. glass = [dark, mid, bright].
  function windowLit(S, x, y, w, h, glass, o = {}) {
    S.rect(x - 1, y - 1, w + 2, h + 2, o.frame || '#100');
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const f = 1 - (j / h) * 0.6 - (i === 0 ? 0.15 : 0);
      S.set(x + i, y + j, f > 0.75 ? glass[2] : f > 0.5 ? (TH(x + i, y + j) < (f - 0.5) * 4 ? glass[2] : glass[1]) : glass[1]);
    }
    if (o.panes !== false) {
      if (w >= 4) S.rect(x + (w >> 1), y, 1, h, o.mullion || glass[0]);
      if (h >= 5) S.rect(x, y + (h >> 1), w, 1, o.mullion || glass[0]);
    }
    if (o.arch) { S.set(x - 1, y - 1, null); S.set(x + w, y - 1, null); S.rect(x, y - 1, w, 1, o.frame || '#100'); S.set(x, y, o.frame || '#100'); S.set(x + w - 1, y, o.frame || '#100'); }
    if (o.sill !== false) S.rect(x - 1, y + h + 1, w + 2, 1, o.sill || '#334');
  }

  function paintTownSky(S, L, open) {
    const { w, h } = L;
    const skyH = L.wallTop + 8;
    copper(S, 0, 0, w, skyH, TOWN_SKY, 4);
    paintMoon(S, L.moon.x, L.moon.y, L.moon.r, { seed: 4, halo: ['#204', '#315', '#426'], haloR: 2.4 });
    const onMoon = (x, y) => Math.hypot(x + 0.5 - L.moon.x, y + 0.5 - L.moon.y) <= L.moon.r;
    cloudBar(S, L.moon.x - 9, L.moon.x + 22, L.moon.y + 4, 2, onMoon, '#103', '#315');
    cloudBar(S, L.moon.x - 18, L.moon.x + 12, L.moon.y + 7, 2, onMoon, '#103', '#204');
    cloudBar(S, w * 0.55, w * 0.9, L.moon.y + 16, 2, onMoon, '#103', '#204');
    // thin night clouds drifting across a tall sky
    const skyTop = L.arena.top;
    if (skyTop > 90) {
      cloudStreak(S, w * 0.62, skyTop * 0.42, w * 0.5, 1.4, 12, onMoon);
      cloudStreak(S, w * 0.3, skyTop * 0.72, w * 0.46, 1.2, 14, onMoon);
      cloudBar(S, w * 0.5, w * 0.98, skyTop * 0.58, 2, onMoon, '#103', '#214');
    }
    // the old castle on its crag, far off to the west (only when the sky is tall enough)
    const crown = L.arena.base - 72;
    if (crown > 74) {
      const u = U.clamp((crown - 50) / 70, 0.62, 0.9);
      paintCastle(S, w, h, { crag: { cx: Math.round(L.arena.x0 + (L.arena.x1 - L.arena.x0) * 0.42), top: crown - 6 }, windows: [] },
        { u, body: '#103', rim: '#315', rim2: '#214', house: ['#204', '#215'], win: '#c83', win2: '#842' });
    }
    // far wooded hills beyond the wall
    const base = L.wallTop + 2;
    const hill = x => base - 9 - Math.sin(x * 0.03 + 1) * 4 - Math.sin(x * 0.011 + 3) * 5;
    for (let x = 0; x < w; x++) {
      const y0 = Math.round(hill(x));
      for (let y = y0; y < base + 6; y++) S.set(x, y, y < y0 + 2 && TH(x, y) < 0.5 ? '#204' : '#103');
    }
    const r = U.rng(31);
    for (let x = 0; x < w; x += 2 + r() * 3) pineTree(S, x, hill(x) + 2, 4 + r() * 7, 2 + r() * 1.5, '#103', '#204', (x * 5) | 0);
    if (open) {
      // dawn glow rising behind the North Gate
      const gx = L.cx, gy = L.wallTop;
      for (let y = Math.max(0, gy - 60); y < base + 4; y++) for (let x = gx - 70; x < gx + 70; x++) {
        const hex = S.getHex(x, y);
        if (!hex) continue;
        const d = Math.hypot((x - gx) / 70, (y - gy) / 50);
        const f = Math.pow(Math.max(0, 1 - d), 1.6) * 1.2;
        if (f > TH(x, y)) S.set(x, y, P.mix(hex, '#f84', 0.32));
        if (f > TH(x, y) + 0.45) S.set(x, y, P.mix(hex, '#fb6', 0.45));
      }
    }
  }

  function paintWall(S, L) {
    const { w } = L, top = L.wallTop, yb = L.yB;
    masonry(S, 0, top + 4, w, yb - top - 4 + 2, R_WALL, { I: (x, y) => 0.42 - (y - top) / (yb - top) * 0.12, seed: 5, bw: 7 });
    // walk shadow and merlons
    S.rect(0, top + 4, w, 1, '#112');
    for (let x = -2; x < w; x += 7) {
      masonry(S, x, top, 4, 4, R_WALL, { I: 0.5, seed: 6, bw: 4, bh: 2 });
      S.rect(x, top, 4, 1, '#667');
      S.rect(x + 3, top + 1, 1, 3, '#213');
    }
    // arrow slits along the wall
    for (let x = 10; x < w; x += 36) { S.rect(x, top + 12, 1, 5, '#001'); S.set(x, top + 11, '#112'); }
  }

  // Shared torch sconce (flame is animated).
  function sconce(S, L, x, y) {
    S.rect(x - 1, y + 1, 3, 1, '#223'); S.set(x, y + 2, '#112'); S.set(x, y + 3, '#112');
    S.set(x, y, '#310');
    L.torches.push([x, y]);
  }

  function paintGate(S, L, open) {
    const g = L.gate, yb = g.base, cx = L.cx;
    const tw = 15, th = 58;
    // towers with side faces and slate roofs
    const towers = [[g.x0, 1], [g.x1 - tw, -1]];
    for (const [tx, inner] of towers) {
      masonry(S, tx, yb - th, tw, th, R_WALL, { I: (x, y) => 0.5 + (y < yb - th + 8 ? 0.04 : 0), seed: 7 + tx, bw: 5 });
      // side face toward the gate (lit when it faces right = light from the left)
      const sx = inner > 0 ? tx + tw - 2 : tx;
      for (let y = yb - th; y < yb; y++) for (let x = sx; x < sx + 2; x++) S.shadePx(x, y, R_WALL, inner > 0 ? 0.28 : 0.68);
      // merlons
      for (let x = tx; x < tx + tw; x += 4) { S.rect(x, yb - th - 3, 3, 3, '#556'); S.set(x, yb - th - 3, '#778'); S.set(x + 2, yb - th - 2, '#334'); }
      // slate spire
      const rx0 = tx + 1, rx1 = tx + tw - 1, apex = yb - th - 18;
      const test = (x, y) => { const k = (y - apex) / (yb - th - 3 - apex); const half = (rx1 - rx0) / 2 * k; return k >= 0 && k <= 1 && Math.abs(x + 0.5 - (rx0 + rx1) / 2) <= half; };
      shingles(S, rx0, apex, rx1, yb - th - 3, R_SLATE, test, { I: (x) => 0.6 - (x - rx0) / (rx1 - rx0) * 0.35, rh: 2, tw: 3, seed: tx });
      S.rect(Math.round((rx0 + rx1) / 2), apex - 4, 1, 4, '#334');
      S.rect(Math.round((rx0 + rx1) / 2) + 1, apex - 4, 3, 1, '#a12'); S.rect(Math.round((rx0 + rx1) / 2) + 1, apex - 3, 2, 1, '#702');
      // arrow slits
      const sxs = tx + Math.floor(tw / 2);
      S.rect(sxs, yb - th + 12, 1, 6, '#001'); S.rect(sxs - 1, yb - th + 14, 3, 1, '#001');
      S.rect(sxs, yb - th + 30, 1, 5, '#001');
    }
    // centre block over the arch
    const bx0 = g.x0 + tw, bx1 = g.x1 - tw, btop = yb - 46;
    masonry(S, bx0, btop, bx1 - bx0, 46, R_WALL, { I: 0.46, seed: 9, bw: 6 });
    for (let x = bx0; x < bx1; x += 4) { S.rect(x, btop - 3, 3, 3, '#556'); S.set(x, btop - 3, '#778'); }
    S.rect(bx0, btop, bx1 - bx0, 1, '#223');
    // the arch opening (round top) with voussoirs
    const ax0 = g.ax0, ax1 = g.ax1, spring = yb - 18, ar = (ax1 - ax0) / 2, acx = (ax0 + ax1) / 2;
    const inArch = (x, y, grow = 0) => {
      if (x + 0.5 < ax0 - grow || x + 0.5 > ax1 + grow || y >= yb) return false;
      if (y + 0.5 >= spring) return true;
      return Math.hypot(x + 0.5 - acx, y + 0.5 - spring) <= ar + grow;
    };
    for (let y = spring - ar - 4; y < yb; y++) for (let x = ax0 - 4; x < ax1 + 4; x++) {
      if (!inArch(x, y, 3) || inArch(x, y)) continue;
      const a = Math.atan2(y + 0.5 - spring, x + 0.5 - acx);
      const seg = Math.floor((a + Math.PI) / (Math.PI / 9));
      const edge = Math.abs(((a + Math.PI) / (Math.PI / 9)) - seg - 0.5) > 0.38 && y < spring;
      S.shadePx(x, y, R_WALL, (edge ? 0.3 : 0.62) + (x < acx ? 0.06 : -0.06) - (y > spring ? 0.04 : 0));
    }
    // keystone with a carved tree crest
    S.rect(acx - 2, spring - ar - 5, 4, 5, '#778'); S.rect(acx - 2, spring - ar - 5, 4, 1, '#99a'); S.rect(acx + 1, spring - ar - 4, 1, 4, '#445');
    // crest shield above
    const sy = btop + 6;
    S.poly([[acx - 5, sy], [acx + 5, sy], [acx + 5, sy + 6], [acx, sy + 10], [acx - 5, sy + 6]], 'crimson', { grad: [acx - 5, sy, acx + 5, sy + 10, 0.55, 0.3] });
    S.rect(acx - 5, sy, 10, 1, '#c92');
    S.rect(acx - 0.5, sy + 3, 1, 5, '#a70'); S.ellipse(acx, sy + 3, 2.6, 1.8, '#eb3'); S.set(acx - 1, sy + 2, '#fe6');
    if (!open) {
      // dark gate passage behind the portcullis
      for (let y = spring - ar; y < yb; y++) for (let x = ax0; x < ax1; x++) if (inArch(x, y)) S.set(x, y, (y > yb - 6 && TH(x, y) < 0.4) ? '#102' : '#001');
      // portcullis: iron grid with spiked feet
      for (let y = spring - ar; y < yb; y++) for (let x = ax0; x < ax1; x++) {
        if (!inArch(x, y)) continue;
        const vx = (x - ax0 - 1) % 4, hy = (yb - 3 - y) % 6;
        if (vx === 0 || vx === 1) S.set(x, y, vx === 0 ? '#556' : '#223');
        if (hy === 0) S.set(x, y, (vx === 0 || vx === 1) ? '#889' : '#445');
        if (hy === 5 && !(vx === 0 || vx === 1)) S.set(x, y, '#112');
      }
      for (let x = ax0 + 1; x < ax1; x += 4) { S.set(x, yb - 1, '#667'); S.set(x + 1, yb - 1, '#334'); }
      // heavy chains crossed over the bars
      const chain = (xa, ya, xb, yb2) => {
        const n = Math.ceil(Math.hypot(xb - xa, yb2 - ya));
        for (let i = 0; i <= n; i++) {
          const x = Math.round(xa + (xb - xa) * i / n), y = Math.round(ya + (yb2 - ya) * i / n);
          S.set(x - 1, y, '#001'); S.set(x + 1, y, '#001'); S.set(x, y - 1, '#001'); S.set(x, y + 1, '#001');
        }
        for (let i = 0; i <= n; i++) {
          const x = Math.round(xa + (xb - xa) * i / n), y = Math.round(ya + (yb2 - ya) * i / n);
          S.set(x, y, i % 3 === 0 ? '#bbc' : i % 3 === 1 ? '#778' : '#445');
        }
      };
      chain(ax0 - 1, spring - 7, ax1, yb - 2);
      chain(ax1, spring - 7, ax0 - 1, yb - 2);
      // shackles
      S.rect(ax0 - 3, spring - 9, 3, 3, '#445'); S.rect(ax1 - 1, spring - 9, 3, 3, '#445');
      // the red wax seal of the old king, ribbons and drips
      const scx = acx, scy = Math.round((spring - 7 + yb - 2) / 2) + 0.5;
      S.poly([[scx - 1, scy + 2], [scx - 4, scy + 9], [scx - 2, scy + 8], [scx, scy + 3]], 'crimson', { tone: 0.45 });
      S.poly([[scx + 1, scy + 2], [scx + 4, scy + 9], [scx + 2, scy + 8], [scx, scy + 3]], 'gold', { tone: 0.6 });
      S.ellipse(scx, scy, 4.6, 4.6, '#301');
      S.ball(scx, scy, 4, 4, 'crimson', { spec: 0.5, lo: 2 });
      S.ellipse(scx, scy, 2.2, 2.2, '#702');
      S.set(scx - 0.5, scy - 0.5, '#a12'); S.set(scx - 2, scy - 3, '#fb9');
      S.set(scx + 3, scy + 4, '#803'); S.set(scx + 3, scy + 5, '#502');
    } else {
      // dawn beyond the gate: golden sky, the hills, a road running north
      const top = spring - ar;
      for (let y = top; y < yb; y++) for (let x = ax0; x < ax1; x++) {
        if (!inArch(x, y)) continue;
        const f = (y - top) / (yb - top);
        S.set(x, y, P.rampF(['#c53', '#e74', '#f95', '#fb6', '#fd8', '#ffb'], Math.min(1, f * 1.5), x, y));
      }
      const hz = yb - 9;
      for (let x = ax0; x < ax1; x++) {
        const hy = Math.round(hz - 1 - Math.sin(x * 0.4) * 1.2);
        for (let y = hy; y < yb; y++) if (inArch(x, y)) S.set(x, y, y < hy + 1 ? '#975' : (TH(x, y) < 0.5 ? '#753' : '#642'));
      }
      for (let y = hz; y < yb; y++) {
        const k = (y - hz) / (yb - hz);
        const half = 1 + k * 7, rc = acx + Math.sin(k * 3) * 2 * (1 - k);
        for (let x = Math.floor(rc - half); x <= rc + half; x++) if (inArch(x, y)) S.set(x, y, k < 0.3 ? '#fd8' : TH(x, y) < 0.5 ? '#eb7' : '#c95');
      }
      // the sun peeping over the far hills
      S.ellipse(acx + 3, hz - 2, 3, 3, '#ffe');
      // raised portcullis: only the spiked foot shows
      for (let x = ax0; x < ax1; x++) for (let y = top; y < top + 7; y++) {
        if (!inArch(x, y)) continue;
        const vx = (x - ax0 - 1) % 4;
        if (vx === 0 || vx === 1) S.set(x, y, vx === 0 ? '#556' : '#223');
        if (y === top + 4) S.set(x, y, (vx === 0 || vx === 1) ? '#889' : '#445');
      }
      for (let x = ax0 + 1; x < ax1; x += 4) { S.set(x, top + 7, '#556'); }
      // broken chains hanging at the jambs
      for (const xx of [ax0 - 2, ax1 + 1]) for (let y = spring - 8; y < spring + 6; y++) S.set(xx, y, y % 3 === 0 ? '#bbc' : y % 3 === 1 ? '#778' : '#445');
    }
    sconce(S, L, ax0 - 6, yb - 24);
    sconce(S, L, ax1 + 5, yb - 24);
  }

  function paintArena(S, L) {
    const ar = L.arena, x0 = ar.x0, x1 = ar.x1, yb = ar.base;
    const xc = (x0 + x1) / 2, rr = (x1 - x0) / 2;
    const sag = x => 3 * (1 - Math.pow((x + 0.5 - xc) / rr, 2));
    const ang = x => Math.asin(U.clamp((x + 0.5 - xc) / rr, -0.999, 0.999));
    const lightX = x => { const a = ang(x); return S.lit(K.norm3([Math.sin(a), -0.25, Math.cos(a)]), { ambient: 0.15 }); };
    const P1 = 3, T1 = 31, E1 = 35, T2 = 55, E2 = 59, AT = 69, CR = 72;
    const step = 0.3;
    const arch = (hRel, x, tier) => {
      const a = ang(x);
      const off = tier === 1 ? 0 : step / 2;
      const k = Math.round((a - off) / step), ac = k * step + off;
      const axs = xc + rr * Math.sin(ac);
      const main = tier === 1 && k === 0;
      const hw = (main ? 6 : tier === 1 ? 3.6 : 3) * Math.cos(ac);
      const base = tier === 1 ? P1 : E1, ah = main ? 23 : tier === 1 ? 19 : 15, rv = main ? 6 : tier === 1 ? 3.6 : 3;
      const dx = (x + 0.5 - axs);
      if (Math.abs(dx) > hw || hw < 0.8) return 0;
      const hh = hRel - base, spr = ah - rv;
      if (hh < 0 || hh > ah) return 0;
      if (hh > spr && (dx / hw) ** 2 + ((hh - spr) / rv) ** 2 > 1) return 0;
      return main ? 2 : 1;
    };
    const pillar = (x, tier) => {
      const a = ang(x), off = tier === 1 ? step / 2 : 0;
      const k = Math.round((a - off) / step), pc = xc + rr * Math.sin(k * step + off);
      return Math.abs(x + 0.5 - pc) < 1.4 * Math.cos(k * step + off) + 0.2 ? (x + 0.5 < pc ? 2 : 1) : 0;
    };
    for (let x = Math.max(0, Math.floor(x0)); x < x1; x++) {
      const base = yb + Math.round(sag(x));
      const lx = lightX(x);
      for (let y = base - CR; y < base; y++) {
        const hRel = base - y;
        let I = 0.1 + lx * 0.46 + hRel / CR * 0.08;
        let col = null;
        if (hRel < P1) I -= 0.12 + (hRel === P1 - 1 ? -0.1 : 0);
        else if (hRel < T1) {
          const a = arch(hRel, x, 1);
          if (a) {
            const f = (hRel - P1) / 20;
            col = a === 2 ? P.rampF(['#fa4', '#e72', '#a41', '#610', '#300'], Math.min(1, f * 1.1), x, y)
                          : P.rampF(['#a41', '#620', '#310', '#200', '#100'], Math.min(1, f * 1.6), x, y);
          } else { const p = pillar(x, 1); if (p) I += p === 2 ? 0.14 : 0.06; if (hRel === T1 - 1 && p) I += 0.1; }
        } else if (hRel < E1) {
          I += hRel === E1 - 1 ? 0.18 : hRel === T1 ? -0.16 : 0.06;
        } else if (hRel < T2) {
          const a = arch(hRel, x, 2);
          if (a) col = (hRel - E1) < 3 ? '#201' : TH(x, y) < 0.15 ? '#201' : '#100';
          else { const p = pillar(x, 2); if (p) I += p === 2 ? 0.12 : 0.05; }
        } else if (hRel < E2) {
          I += hRel === E2 - 1 ? 0.18 : hRel === T2 ? -0.16 : 0.06;
        } else if (hRel < AT) {
          const a = ang(x), k = Math.round(a / step), wc = xc + rr * Math.sin(k * step);
          if (Math.abs(x + 0.5 - wc) < 1.1 * Math.cos(k * step) + 0.1 && hRel > E2 + 3 && hRel < AT - 2) col = '#100';
          if (Math.abs(x + 0.5 - (xc + rr * Math.sin(k * step + step / 2))) < 0.9) I += 0.06;
        } else {
          I += hRel === CR - 1 ? 0.22 : hRel === AT ? -0.18 : 0.1;
        }
        if (col) S.set(x, y, col); else S.shadePx(x, y, R_SAND, I);
      }
      // stepped plinth shadow onto the plaza
      S.set(x, base, '#101');
    }
    // long hanging banners on the upper arcade
    for (const a of [-0.9, -0.3, 0.3, 0.9]) {
      const bxc = xc + rr * Math.sin(a), bw = Math.max(2, Math.round(5 * Math.cos(a)));
      if (bxc - bw / 2 < 0 || bxc > x1 - 2) continue;
      const bx = Math.round(bxc - bw / 2), by0 = yb + Math.round(sag(bxc)) - E2 + 1, by1 = yb + Math.round(sag(bxc)) - E1 - 1;
      for (let y = by0; y < by1; y++) for (let x = bx; x < bx + bw; x++) {
        const tip = y >= by1 - 3 && Math.abs(x + 0.5 - (bx + bw / 2)) > (by1 - y) * bw / 6;
        if (tip) continue;
        S.shadePx(x, y, 'crimson', (x === bx ? 0.55 : 0.4) - (y - by0) / (by1 - by0) * 0.15);
      }
      S.rect(bx, by0, bw, 1, '#c92');
      const ey = Math.round((by0 + by1) / 2) - 1, ex = Math.round(bxc - 0.5);
      S.set(ex, ey, '#eb3'); S.set(ex, ey + 1, '#a70'); if (bw > 3) { S.set(ex - 1, ey, '#a70'); S.set(ex + 1, ey, '#a70'); }
    }
    // flag masts along the crown (flags animated)
    L.flags = [];
    for (const a of [-1.05, -0.45, 0.15, 0.75]) {
      const fx = Math.round(xc + rr * Math.sin(a));
      if (fx < 2 || fx > x1 - 3) continue;
      const fy = yb + Math.round(sag(fx)) - CR;
      S.rect(fx, fy - 12, 1, 12, '#321'); S.set(fx, fy - 13, '#c92');
      L.flags.push([fx + 1, fy - 12]);
    }
    // crest above the main gate: crossed swords on a shield
    const gy = yb + 3 - E1 + 1;
    S.poly([[xc - 4, gy - 1], [xc + 4, gy - 1], [xc + 4, gy + 3], [xc, gy + 6], [xc - 4, gy + 3]], 'crimson', { tone: 0.45 });
    S.line(xc - 3, gy, xc + 2, gy + 5, '#ddc'); S.line(xc + 3, gy, xc - 2, gy + 5, '#bbc');
    S.rect(xc - 4, gy - 1, 8, 1, '#eb3');
    // torches flanking the main gate
    sconce(S, L, Math.round(xc - 10), yb - 20);
    sconce(S, L, Math.round(xc + 9), yb - 20);
    // fire-glow over the rim of the arena bowl
    for (let x = Math.max(0, Math.floor(x0)); x < x1; x++) {
      const base = yb + Math.round(sag(x)) - CR;
      const k = 1 - Math.abs((x + 0.5 - xc) / rr);
      for (let y = base - 10; y < base; y++) {
        const f = k * (1 - (base - y) / 10) * 0.55;
        const hex = S.getHex(x, y);
        if (hex && f > TH(x, y)) S.set(x, y, P.mix(hex, '#f73', 0.25));
      }
    }
  }

  function paintApothecary(S, L) {
    const a = L.apo, x0 = a.x0, x1 = a.x1, yb = a.base;
    const tx1 = x0 + 15;                // turret right edge
    // main house: stone walls, two floors, steep gable
    const wTop = yb - 52;
    masonry(S, tx1 - 1, wTop, x1 - tx1 + 1, yb - wTop, R_GREEN, { I: (x, y) => 0.5 - (x - tx1) / (x1 - tx1) * 0.12, seed: 13, bw: 5 });
    S.rect(x1 - 2, wTop, 2, yb - wTop, '#122');
    const gx = (tx1 + x1) / 2, apex = yb - 84;
    const roofT = (x, y) => y >= apex && y <= wTop + 1 && Math.abs(x + 0.5 - gx) <= (y - apex) / (wTop - apex) * ((x1 - tx1) / 2 + 3);
    shingles(S, tx1 - 4, apex, x1 + 4, wTop + 1, R_SLATE, roofT, { I: x => x < gx ? 0.62 : 0.32, rh: 3, tw: 3, seed: 21 });
    // dormer-ish gable window with a round green light
    S.ellipse(gx, wTop - 10, 3.2, 3.2, '#100');
    S.ellipse(gx, wTop - 10, 2.2, 2.2, '#3a6'); S.set(gx - 1, wTop - 11, '#9e9'); S.rect(gx - 0.5, wTop - 12, 1, 4, '#132');
    // chimney
    S.rect(x1 - 10, apex + 8, 5, 14, '#233'); S.rect(x1 - 10, apex + 8, 1, 14, '#455'); S.rect(x1 - 11, apex + 7, 7, 2, '#344');
    L.smoke.push([x1 - 8, apex + 6, 'g']);
    // turret: round tower with a witch-hat roof
    const tcx = x0 + 7.5, tr = 7.5, tTop = yb - 60;
    for (let x = x0; x < tx1; x++) {
      const nx = (x + 0.5 - tcx) / tr;
      const lx = S.lit(K.norm3([nx, -0.2, Math.sqrt(Math.max(0, 1 - nx * nx))]), { ambient: 0.1 });
      for (let y = tTop; y < yb; y++) {
        const row = Math.floor((y - tTop) / 3), by = (y - tTop) % 3;
        const col = Math.floor((x + (row & 1) * 2) / 4);
        let I = 0.15 + lx * 0.55 + (hash2(col, row, 17) - 0.5) * 0.12;
        if (by === 2) I -= 0.18;
        S.shadePx(x, y, R_GREEN, I);
      }
    }
    const hatApex = yb - 88;
    const hat = (x, y) => { if (y < hatApex || y > tTop + 1) return false; const k = (y - hatApex) / (tTop + 1 - hatApex); return Math.abs(x + 0.5 - (tcx + (1 - k) * 2)) <= Math.pow(k, 1.3) * (tr + 2) + 0.3; };
    shingles(S, x0 - 3, hatApex, tx1 + 3, tTop + 1, R_SLATE, hat, { I: x => 0.25 + (1 - (x - x0) / 15) * 0.4, rh: 2, tw: 3, seed: 23 });
    S.set(Math.round(tcx + 2), hatApex - 1, '#c92'); S.set(Math.round(tcx + 2), hatApex - 2, '#fe6');
    // green glass windows
    const glass = ['#132', '#3a6', '#9e9'];
    windowLit(S, Math.round(tcx) - 1, tTop + 10, 3, 7, glass, { arch: true, sill: '#233', mullion: '#132' });
    windowLit(S, tx1 + 4, wTop + 8, 5, 7, glass, { sill: '#233' });
    windowLit(S, x1 - 13, wTop + 8, 5, 7, glass, { sill: '#233' });
    windowLit(S, tx1 + 4, wTop + 26, 5, 7, glass, { sill: '#233' });
    windowLit(S, x1 - 13, wTop + 26, 5, 7, glass, { sill: '#233' });
    L.windows.push([Math.round(tcx) - 1, tTop + 10, 3, 7, 'g'], [tx1 + 4, wTop + 8, 5, 7, 'g'], [x1 - 13, wTop + 8, 5, 7, 'g'], [tx1 + 4, wTop + 26, 5, 7, 'g'], [x1 - 13, wTop + 26, 5, 7, 'g']);
    // herbs drying under the eaves
    for (let i = 0; i < 4; i++) { const hx = tx1 + 3 + i * 6; S.rect(hx, wTop + 1, 1, 2, '#321'); S.rect(hx - 1, wTop + 3, 3, 2, i % 2 ? '#364' : '#475'); S.set(hx, wTop + 5, '#243'); }
    // iron bracket and the hanging flask sign
    const sx = x0 - 7, sy = yb - 40;
    S.rect(sx, sy, 10, 1, '#223'); S.line(sx + 3, sy + 1, x0, sy + 5, '#223');
    S.set(sx + 1, sy + 1, '#445'); S.set(sx + 1, sy + 2, '#445');
    S.set(sx + 1, sy + 1, '#556'); S.set(sx + 1, sy + 2, '#556');
    S.rect(sx, sy + 3, 3, 1, '#a70');
    S.rect(sx, sy + 4, 3, 3, '#7a9'); S.rect(sx, sy + 4, 1, 3, '#bdc');
    S.ball(sx + 1, sy + 10, 4.2, 4.2, ['#011', '#132', '#265', '#3a6', '#6c8', '#aea', '#efe'], { spec: 0.7 });
    S.rect(sx - 2, sy + 11, 7, 3, '#3a6'); S.rect(sx - 2, sy + 11, 7, 1, '#9e9');
    S.ball(sx + 1, sy + 10, 4.2, 4.2, ['#011', '#132', '#265', '#3a6', '#6c8', '#aea', '#efe'], { spec: 0.7, clip: (x, y) => y < sy + 11 });
    S.set(sx - 1, sy + 8, '#efe');
    L.glows.push([sx + 1, sy + 10, 'g']);
  }

  function paintCobbles(S, L, open) {
    const { w, h, cx } = L, y0 = L.yB - 1;
    const vpY = L.yB - 190, C = 19000, KX = 64;
    for (let y = y0; y < h; y++) {
      const d = y + 0.5 - vpY;
      const depth = C / d, row = Math.floor(depth), by = depth - row;   // by: 0 = far edge of a row
      const k = (y - y0) / (h - y0);
      for (let x = 0; x < w; x++) {
        const px = (x + 0.5 - cx) / d * KX + (row & 1) * 0.5;
        const col = Math.floor(px), bx = px - col;
        const j = hash2(col, row, 41);
        let I = 0.36 + (j - 0.5) * 0.2 - (1 - k) * 0.06;
        const ex = Math.min(bx, 1 - bx), ey = Math.min(by, 1 - by);
        if (ex < 0.1 || ey < 0.12) I -= 0.26;                 // joints
        else if (by > 0.8 || bx < 0.25) I += 0.1;             // lit near-left shoulder of each stone
        else if (bx > 0.75) I -= 0.07;
        S.shadePx(x, y, R_COBBLE, I);
      }
    }
    // drain gutter and a worn path toward the gate
    for (let y = L.yB + 2; y < h; y += 1) {
      const k = (y - L.yB) / (h - L.yB);
      const half = 6 + k * 34;
      for (let x = Math.floor(cx - half); x <= cx + half; x++) {
        const hex = S.getHex(x, y);
        if (hex && TH(x, y) < 0.22) S.set(x, y, P.mix(hex, '#445', 0.4));
      }
    }
    if (open) {
      // golden light pouring from the open gate across the plaza
      const g = L.gate;
      for (let y = L.yB; y < h; y++) {
        const k = (y - L.yB) / (h - L.yB);
        const half = 12 + k * 60;
        for (let x = Math.floor(cx - half); x <= cx + half; x++) {
          const e = 1 - Math.abs(x + 0.5 - cx) / half;
          const f = e * (1 - k * 0.75) * 1.1;
          const hex = S.getHex(x, y);
          if (!hex) continue;
          if (f > TH(x, y) + 0.4) S.set(x, y, P.mix(hex, '#fd8', 0.55));
          else if (f > TH(x, y)) S.set(x, y, P.mix(hex, '#fa4', 0.35));
        }
      }
    }
  }

  function paintBrazier(S, L, x, y) {
    S.line(x - 3, y, x - 1, y - 5, '#223'); S.line(x + 3, y, x + 1, y - 5, '#112'); S.line(x, y, x, y - 5, '#223');
    S.poly([[x - 4, y - 8], [x + 5, y - 8], [x + 3, y - 5], [x - 2, y - 5]], R_IRON, { grad: [x - 4, y - 8, x + 5, y - 5, 0.7, 0.2] });
    S.rect(x - 4, y - 9, 9, 1, '#667');
    S.rect(x - 3, y - 10, 7, 1, '#f73');
    L.fires.push([x, y - 10, 1.3]);
    pool(L, x, y - 2, 20, 0.95, '#f83', { squash: 1.6 });
  }

  function paintSmithy(S, L) {
    const sm = L.smithy, x1 = sm.x1, yb = sm.base;
    const fx1 = Math.min(x1 - 20, 56);               // forge-house right edge
    const wTop = yb - 30, apex = yb - 60, gcx = fx1 / 2 - 1;
    const gHalf = fx1 / 2 + 2;
    const inGable = (x, y) => y >= apex + 4 && y < wTop && Math.abs(x + 0.5 - gcx) <= (y - apex - 4) / (wTop - apex - 4) * gHalf;
    // outside chimney stack hugging the west wall
    const chx = 2;
    masonry(S, chx, yb - 82, 10, 82, R_SOOT, { I: (x) => x < chx + 3 ? 0.62 : 0.42, seed: 53, bw: 4, bh: 2 });
    S.rect(chx - 1, yb - 83, 12, 2, '#556'); S.rect(chx - 1, yb - 83, 12, 1, '#889');
    S.rect(chx + 2, yb - 82, 6, 1, '#f72'); S.rect(chx + 3, yb - 82, 4, 1, '#fd5');
    L.smoke.push([chx + 5, yb - 85, 's']);
    L.sparks = [chx + 5, yb - 84];
    // facade and gable
    masonry(S, chx + 10, wTop, fx1 - chx - 10, yb - wTop, R_SOOT, { I: (x, y) => 0.56 - (y - wTop) / 30 * 0.1, seed: 51, bw: 6 });
    masonry(S, 0, apex, fx1 + 2, wTop - apex, R_SOOT, { I: (x, y) => 0.5 - (x - gcx) / gHalf * 0.08, seed: 55, bw: 5, test: inGable });
    // roof edges (we look a little down onto the slopes)
    const outer = (x, y) => { const k = (y - apex) / (wTop + 3 - apex); return k >= 0 && k <= 1 && Math.abs(x + 0.5 - gcx) <= k * (gHalf + 6) + 1.5; };
    shingles(S, -6, apex, fx1 + 8, wTop + 3, R_TIMBER, (x, y) => outer(x, y) && !inGable(x, y) && !(x >= chx && x < chx + 10 && y > yb - 82),
      { I: x => (x < gcx ? 0.78 : 0.38), rh: 2, tw: 3, seed: 52 });
    // round vent in the gable, lit from the forge below
    S.ellipse(gcx, apex + 18, 3.5, 3.5, '#100'); S.ellipse(gcx, apex + 18, 2.5, 2.5, '#c50'); S.set(gcx - 1, apex + 17, '#fa3');
    S.rect(gcx - 0.5, apex + 15, 1, 6, '#310'); S.rect(gcx - 3, apex + 17.5, 6, 1, '#310');
    // forge mouth: a big round-topped door glowing orange
    const dw = 16, dx0 = Math.round(gcx - dw / 2 + 4), dTop = yb - 24;
    const inDoor = (x, y) => x >= dx0 && x < dx0 + dw && y >= dTop && y < yb && !((y - dTop) < 6 && Math.hypot(x + 0.5 - (dx0 + dw / 2), y - dTop - 6) > dw / 2);
    for (let y = dTop - 3; y < yb; y++) for (let x = dx0 - 3; x < dx0 + dw + 3; x++) {
      if (inDoor(x, y)) {
        const f = (y - dTop) / 24;
        S.set(x, y, P.rampF(['#310', '#620', '#a40', '#e70', '#fa2', '#fd5'], Math.min(1, 0.12 + f * 1.0), x, y));
      } else if ((y - dTop) < 6 ? Math.hypot(x + 0.5 - (dx0 + dw / 2), y - dTop - 6) <= dw / 2 + 2.5 : (x >= dx0 - 2 && x < dx0 + dw + 2)) {
        S.shadePx(x, y, R_SOOT, x < dx0 + dw / 2 ? 0.74 : 0.5);
      }
    }
    // the smith's hearth and anvil, silhouetted against the fire
    S.rect(dx0 + 2, yb - 7, 8, 2, '#100'); S.rect(dx0 + 4, yb - 5, 3, 5, '#100'); S.rect(dx0 + 1, yb - 8, 3, 1, '#100');
    S.rect(dx0 + 11, yb - 12, 5, 12, '#200'); S.rect(dx0 + 11, yb - 13, 5, 1, '#ffb'); S.rect(dx0 + 12, yb - 14, 3, 1, '#fd5');
    L.forge = [dx0, dTop, dw, yb - dTop];
    // lean-to awning on posts over the anvil yard
    const lx0 = fx1 - 1, lx1 = x1 - 1, lTop = yb - 33;
    const slope = x => Math.round(lTop + (x - lx0) / Math.max(1, lx1 - lx0) * 8);
    masonry(S, lx0, lTop + 2, lx1 - lx0, yb - lTop - 2, R_SOOT, { I: 0.26, seed: 54, bw: 5, test: (x, y) => y > slope(x) + 3 });
    for (let x = lx0 - 1; x <= lx1 + 1; x++) {
      const ty = slope(x);
      for (let y = ty; y < ty + 4; y++) S.shadePx(x, y, R_TIMBER, y === ty ? 0.75 : y === ty + 3 ? 0.12 : 0.48 - ((x - lx0) % 4 === 0 ? 0.15 : 0));
    }
    S.rect(lx1 - 1, slope(lx1) + 4, 2, yb - slope(lx1) - 4, '#321'); S.rect(lx1 - 1, slope(lx1) + 4, 1, yb - slope(lx1) - 4, '#653');
    // anvil and quench barrel in the yard
    const anx = lx0 + 3, any = yb - 2;
    S.rect(anx + 2, any - 3, 3, 4, '#112'); S.rect(anx, any - 6, 8, 3, '#223'); S.rect(anx - 2, any - 6, 2, 1, '#223');
    S.rect(anx, any - 6, 8, 1, '#d95'); S.rect(anx - 2, any - 6, 2, 1, '#b63');
    const bx = lx1 - 9;
    S.capsule(bx + 3, yb - 7, bx + 3, yb - 2, 3, 3, R_TIMBER, { depth: 0.6 });
    S.rect(bx, yb - 8, 7, 1, '#112'); S.rect(bx, yb - 6, 7, 1, '#445'); S.rect(bx, yb - 3, 7, 1, '#445');
    // hanging anvil sign at the awning's corner
    const sx = lx1 + 1, sy = slope(lx1) + 6;
    S.rect(sx - 14, sy, 15, 1, '#112'); S.line(sx - 3, sy + 1, sx, sy + 4, '#112');
    S.set(sx - 12, sy + 1, '#445'); S.set(sx - 4, sy + 1, '#445');
    const ax = sx - 14, ay = sy + 3;
    S.poly([[ax, ay], [ax + 13, ay], [ax + 13, ay + 3], [ax + 9, ay + 4], [ax + 9, ay + 6], [ax + 12, ay + 8], [ax + 2, ay + 8], [ax + 5, ay + 6], [ax + 5, ay + 4], [ax + 2, ay + 3], [ax - 2, ay + 1]],
      R_IRON, { grad: [ax, ay, ax + 12, ay + 8, 0.95, 0.25] });
    S.rect(ax, ay, 13, 1, '#bbc');
    // glowing window
    windowLit(S, chx + 14, wTop + 9, 6, 6, ['#310', '#c50', '#fa3'], { sill: '#334' });
    L.windows.push([chx + 14, wTop + 9, 6, 6, 'o']);
    pool(L, dx0 + dw / 2, yb + 2, 38, 1.2, '#f72', { squash: 1.4 });
    pool(L, dx0 + dw / 2, dTop + 4, 20, 0.8, '#f83', { test: (x, y) => !inDoor(x, y) });
  }

  // Bronze statue of a past Captain of the Guard, sword raised.
  function paintStatue(S, L) {
    const x = L.cx, yb = L.h - 18;
    const BR = ['#011', '#112', '#123', '#234', '#355', '#476', '#698', '#9ba'];
    masonry(S, x - 10, yb - 4, 21, 4, R_WALL, { I: 0.42, seed: 71, bw: 5, bh: 2 });
    masonry(S, x - 7, yb - 15, 15, 11, R_WALL, { I: 0.52, seed: 72, bw: 5, bh: 3 });
    S.rect(x - 8, yb - 16, 17, 1, '#778'); S.rect(x - 10, yb - 5, 21, 1, '#667');
    S.rect(x - 3, yb - 11, 7, 3, '#a70'); S.rect(x - 3, yb - 11, 7, 1, '#eb3');
    const by = yb - 16;
    S.capsule(x - 2, by - 1, x - 2.5, by - 7, 1.6, 1.8, BR, {});
    S.capsule(x + 2, by - 1, x + 2.5, by - 7, 1.6, 1.8, BR, { lo: 1 });
    S.poly([[x - 5, by - 16], [x + 4, by - 16], [x + 6, by - 3], [x - 7, by - 3]], BR, { grad: [x - 7, by - 16, x + 6, by - 3, 0.55, 0.1] });
    S.ball(x, by - 12, 4, 5, BR, { spec: 0.3 });
    S.capsule(x - 3, by - 14, x - 6, by - 9, 1.4, 1.3, BR, {});
    S.ball(x - 6, by - 8, 2.8, 3.4, BR, { lo: 1, spec: 0.4 });
    S.capsule(x + 3, by - 15, x + 5, by - 21, 1.4, 1.2, BR, {});
    S.capsule(x + 5, by - 22, x + 5, by - 34, 0.9, 0.5, BR, { spec: 0.6 });
    S.rect(x + 3, by - 22, 5, 1, '#355');
    S.ball(x, by - 19, 2.6, 2.8, BR, { spec: 0.5 });
    S.rect(x - 1, by - 22, 3, 1, '#9ba');
  }

  // Crates, barrels and a hand-cart on the back plaza.
  function crate(S, x, y, s2) {
    for (let j = 0; j < s2; j++) for (let i = 0; i < s2; i++) {
      const edge = i === 0 || j === 0 || i === s2 - 1 || j === s2 - 1 || i === j;
      S.shadePx(x + i, y + j, R_TIMBER, edge ? 0.85 - (i === s2 - 1 || j === s2 - 1 ? 0.45 : 0) : 0.55);
    }
  }
  function barrel(S, x, y, r, hgt) {
    S.capsule(x, y - hgt + r * 0.6, x, y - r * 0.6, r, r, R_TIMBER, { depth: 0.6 });
    S.rect(Math.round(x - r), Math.round(y - hgt + 1), Math.round(r * 2), 1, '#223');
    S.rect(Math.round(x - r), Math.round(y - 2), Math.round(r * 2), 1, '#223');
  }
  function paintProps(S, L) {
    const yb = L.yB;
    const ax = Math.round(L.arena.x1 - 30);
    if (ax > 24) {
      crate(S, ax, yb + 4, 6); crate(S, ax + 6, yb + 5, 5); crate(S, ax + 2, yb - 1, 5);
      barrel(S, ax + 15, yb + 10, 2.5, 7);
    }
    // hand-cart with a spoked wheel
    const cx0 = Math.round(L.arena.x1 - 64);
    if (cx0 > 10 && cx0 + 22 < L.smithy.x1 + 30) {
      const cy = yb + 12;
      for (let x = cx0; x < cx0 + 18; x++) for (let y = cy - 6; y < cy - 2; y++) S.shadePx(x, y, R_TIMBER, y === cy - 6 ? 0.7 : 0.38);
      S.line(cx0 + 18, cy - 4, cx0 + 25, cy - 1, '#321');
      S.ellipse(cx0 + 6, cy, 3.5, 3.5, '#210'); S.ellipse(cx0 + 6, cy, 2.4, 2.4, '#213');
      S.line(cx0 + 3, cy, cx0 + 9, cy, '#321'); S.line(cx0 + 6, cy - 3, cx0 + 6, cy + 3, '#321');
      S.rect(cx0 + 2, cy - 9, 12, 3, '#542'); S.rect(cx0 + 2, cy - 9, 12, 1, '#875');
    }
  }

  // Wet puddle catching the light.
  function puddle(S, x, y, rx, ry, glint) {
    for (let j = -ry; j <= ry; j++) for (let i = -rx; i <= rx; i++) {
      const d = (i * i) / (rx * rx) + (j * j) / (ry * ry);
      if (d > 1) continue;
      S.set(x + i, y + j, j < 0 ? '#213' : '#112');
      if (j === -Math.floor(ry * 0.4) && Math.abs(i) < rx * 0.5) S.set(x + i, y + j, glint);
    }
  }

  function paintInn(S, L) {
    const n = L.inn, x0 = n.x0, x1 = n.x1, yb = n.base;
    const g1 = yb - 30, g2 = yb - 60;           // floor lines
    // ground floor: stone footing + plaster with timber
    masonry(S, x0 + 2, yb - 7, x1 - x0, 7, R_WALL, { I: 0.4, seed: 61, bw: 5 });
    for (let y = g1; y < yb - 7; y++) for (let x = x0 + 2; x < x1; x++) S.shadePx(x, y, R_PLASTER, 0.42 + (TH(x, y) - 0.5) * 0.08);
    // upper storey jettied out over the street
    for (let y = g2; y < g1 - 2; y++) for (let x = x0; x < x1; x++) S.shadePx(x, y, R_PLASTER, 0.5 + (TH(x, y) - 0.5) * 0.08);
    // jetty beam shadow
    S.rect(x0, g1 - 2, x1 - x0, 2, '#321'); S.rect(x0, g1 - 2, x1 - x0, 1, '#542'); S.rect(x0 + 2, g1, x1 - x0, 1, '#211');
    // timber frame
    const beam = (xa, ya, xb, yb2) => { S.line(xa, ya, xb, yb2, '#310'); S.line(xa + 1, ya, xb + 1, yb2, '#200'); };
    for (let x = x0 + 2; x < x1; x += 13) beam(x, g1, x, yb - 8);
    for (let x = x0; x < x1; x += 13) {
      beam(x, g2, x, g1 - 3);
      if (x + 13 <= x1) { S.line(x + 1, g2 + 1, x + 12, g1 - 4, '#310'); S.line(x + 12, g2 + 1, x + 1, g1 - 4, '#310'); }
    }
    S.rect(x0, g2, x1 - x0, 2, '#310'); S.rect(x0, g2, x1 - x0, 1, '#431');
    // windows: warm leaded panes
    const warm = ['#520', '#e92', '#fd6'];
    const wins = [];
    for (let x = x0 + 5; x + 8 < x1; x += 13) {
      // upper storey sits between the X braces
      windowLit(S, x + 1, g2 + 8, 6, 9, warm, { mullion: '#631', sill: '#321' });
      wins.push([x + 1, g2 + 8, 6, 9, 'w']);
    }
    // door with a lantern, two big ground floor windows
    const dx = x0 + 6;
    S.rect(dx - 1, g1 + 4, 10, yb - g1 - 4, '#200');
    for (let y = g1 + 5; y < yb; y++) for (let x = dx; x < dx + 8; x++) S.set(x, y, P.rampF(['#310', '#620', '#a52', '#e83', '#fb5'], Math.min(1, 0.25 + (y - g1 - 5) / 24), x, y));
    S.rect(dx + 3, g1 + 5, 1, yb - g1 - 5, '#420');
    windowLit(S, dx + 15, g1 + 6, 9, 8, warm, { mullion: '#631', sill: '#321' });
    if (x1 - x0 > 60) { windowLit(S, dx + 32, g1 + 6, 9, 8, warm, { mullion: '#631', sill: '#321' }); wins.push([dx + 32, g1 + 6, 9, 8, 'w']); }
    wins.push([dx + 15, g1 + 6, 9, 8, 'w']);
    L.windows.push(...wins);
    // lantern
    S.rect(dx + 10, g1 + 3, 3, 1, '#223'); S.rect(dx + 11, g1 + 4, 1, 1, '#223');
    S.rect(dx + 10, g1 + 5, 3, 4, '#fd6'); S.rect(dx + 10, g1 + 5, 3, 1, '#223'); S.rect(dx + 10, g1 + 8, 3, 1, '#223');
    L.glows.push([dx + 11, g1 + 7, 'w']);
    // roof: steep, with a dormer
    const apex = n.top + 4, ridge0 = x0 + 12, ridge1 = x1 + 10;
    const roofT = (x, y) => {
      if (y < apex || y > g2) return false;
      const k = (y - apex) / (g2 - apex);
      return x + 0.5 >= ridge0 - k * 14 && x + 0.5 <= ridge1;
    };
    shingles(S, x0 - 4, apex, x1, g2, R_SLATE, roofT, { I: (x, y) => 0.32 + (1 - (y - apex) / (g2 - apex)) * 0.18 + (x < ridge0 ? 0.18 : 0), rh: 3, tw: 4, seed: 63 });
    S.line(ridge0, apex, x1, apex, '#557');
    // dormer
    const dmx = x0 + 34, dmy = g2 - 18;
    S.rect(dmx, dmy, 12, 14, '#544'); S.rect(dmx, dmy, 1, 14, '#766');
    S.tri([dmx - 2, dmy + 1], [dmx + 14, dmy + 1], [dmx + 6, dmy - 7], R_SLATE, { grad: [dmx - 2, 0, dmx + 14, 0, 0.6, 0.3] });
    windowLit(S, dmx + 3, dmy + 4, 6, 7, warm, { mullion: '#631', sill: '#321' });
    L.windows.push([dmx + 3, dmy + 4, 6, 7, 'w']);
    // chimney
    const chx = x1 - 16;
    masonry(S, chx, apex - 12, 8, 16, R_WALL, { I: 0.38, seed: 64, bw: 4, bh: 2 });
    S.rect(chx - 1, apex - 13, 10, 2, '#556'); S.rect(chx - 1, apex - 13, 10, 1, '#778');
    L.smoke.push([chx + 4, apex - 14, 'w']);
    // wrought-iron bracket and the hanging rusty flagon
    const bx = x0 - 1, by = g2 + 4;
    S.rect(bx - 16, by, 17, 1, '#112'); S.line(bx - 5, by + 1, bx, by + 6, '#112'); S.set(bx - 16, by - 1, '#223');
    for (let i = 0; i < 2; i++) S.set(bx - 10, by + 1 + i, '#556');
    const tx = bx - 10, ty = by + 4;
    S.horn(tx + 4, ty + 3, tx + 9, ty + 4, tx + 4, ty + 10, 1.1, 1.1, 'rust', { lo: 1 });
    S.capsule(tx, ty + 3, tx, ty + 10, 4.2, 4.6, 'rust', { spec: 0.5 });
    S.rect(tx - 4, ty + 4, 9, 1, '#310'); S.rect(tx - 4, ty + 9, 9, 1, '#310');
    S.ellipse(tx, ty + 2, 4.5, 1.6, '#eed'); S.set(tx - 3, ty + 1, '#ffe'); S.set(tx + 2, ty + 3, '#ccb');
    S.set(tx - 2, ty, '#eed'); S.set(tx + 1, ty, '#ddc');
    // barrels by the door
    for (const [bxx, w2] of [[x0 - 9, 7], [x0 - 2, 6]]) {
      if (bxx < L.smithy.x1 + 2) continue;
      S.capsule(bxx + w2 / 2, yb - 7, bxx + w2 / 2, yb - 2, w2 / 2, w2 / 2, R_TIMBER, { depth: 0.6 });
      S.rect(bxx, yb - 7, w2, 1, '#223'); S.rect(bxx, yb - 3, w2, 1, '#223');
    }
    pool(L, dx + 4, yb, 30, 1.0, '#fa4', { squash: 1.6 });
    L.cat = null;
    for (const [bxx, w2] of [[x0 - 9, 7], [x0 - 2, 6]]) if (bxx >= L.smithy.x1 + 2) { L.cat = [bxx + 3, yb - 8]; break; }
  }

  A.scenes['town'] = {
    paint(S, w, h, state) {
      const L = townLayout(w, h);
      const open = !!state.gateOpen;
      L.torches = []; L.windows = []; L.smoke = []; L.glows = []; L.fires = []; L.pools = [];
      paintTownSky(S, L, open);
      paintWall(S, L);
      paintCobbles(S, L, open);
      puddle(S, L.cx - 30, h - 12, 7, 2, '#335');
      puddle(S, L.cx + 24, L.yB + 30, 5, 1, '#c83');
      puddle(S, L.cx - 44, L.yB + 22, 4, 1, '#335');
      inked(S, w, h, C => paintGate(C, L, open), '#001');
      inked(S, w, h, C => paintArena(C, L), '#100');
      inked(S, w, h, C => paintApothecary(C, L), '#001');
      inked(S, w, h, C => { paintProps(C, L); for (const [bx, by] of L.braziers) paintBrazier(C, L, bx, by); }, '#101');
      inked(S, w, h, C => paintStatue(C, L), '#001');
      inked(S, w, h, C => paintSmithy(C, L), '#100');
      inked(S, w, h, C => paintInn(C, L), '#100');
      for (const args of L.pools) lightPool(S, ...args);
      // torch light on the stone around every sconce
      for (const [tx, ty] of L.torches) lightPool(S, tx, ty, 14, 0.9, '#f93');
      L.stars = L.stars.filter(st => (st.y < L.wallTop - 14) && !(st.x >= L.arena.x0 && st.x < L.arena.x1 && st.y > L.arena.top) && !(st.x >= L.apo.x0 - 3 && st.x < L.apo.x1 + 3 && st.y > L.apo.top - 4) && !(st.x >= L.gate.x0 && st.x < L.gate.x1 && st.y > L.gate.top - 6));
    },
    animate(ctx, x, y, w, h, t, state) {
      const L = townLayout(w, h);
      if (!L.torches) return;
      const open = !!(state && state.gateOpen);
      drawStars(ctx, x, y, L.stars, t);
      // bats flitting across the sky now and then
      const bc = (t + 4) % 17;
      if (bc < 5 && L.arena.top > 40) {
        const k = bc / 5, cyc = Math.floor((t + 4) / 17);
        for (let b = 0; b < 2; b++) {
          const bx = Math.round(-14 + k * (w + 28) - b * 12);
          const by = Math.round(L.arena.top * (0.25 + (cyc % 3) * 0.18) + Math.sin(k * 13 + b * 2) * 4 + b * 5);
          G.blit(batSprite((Math.floor(t * 8) + b) % 2), x + bx, y + by, { ctx });
        }
      }
      // window glow flicker (candles behind the glass)
      for (let i = 0; i < L.windows.length; i++) {
        const [wx, wy, ww, wh, kind] = L.windows[i];
        const n = U.noise1(t * 1.1 + i * 5.1, i + 3);
        if (n > 0.32 && n < 0.78) continue;
        const dim = n <= 0.32;
        const col = kind === 'g' ? (dim ? '#286' : '#beb') : kind === 'o' ? (dim ? '#b40' : '#fd6') : (dim ? '#d82' : '#ffc');
        // repaint the upper glass row(s) only: keeps the mullions crisp
        G.rect(x + wx, y + wy, ww, Math.max(1, Math.round(wh * 0.35)), col, ctx);
        if (ww >= 4) G.rect(x + wx + (ww >> 1), y + wy, 1, Math.max(1, Math.round(wh * 0.35)), kind === 'g' ? '#132' : '#631', ctx);
      }
      // forge breathing
      if (L.forge) {
        const [fx, fy, fw, fh] = L.forge;
        const n = U.noise1(t * 2.4, 9);
        const ch = Math.round(fh * (0.25 + n * 0.25));
        G.rect(x + fx + 3, y + fy + fh - ch, fw - 6, ch, n > 0.5 ? '#fd5' : '#fa2', ctx);
        G.rect(x + fx + 5, y + fy + fh - Math.round(ch * 0.5), fw - 10, Math.round(ch * 0.5), '#ffb', ctx);
        G.rect(x + fx + 2, y + fy + fh - 7, 8, 2, '#100', ctx); G.rect(x + fx + 4, y + fy + fh - 5, 3, 5, '#100', ctx); G.rect(x + fx + 1, y + fy + fh - 8, 3, 1, '#100', ctx);
      }
      // torches and braziers, with a flickering glow
      for (let i = 0; i < L.torches.length; i++) {
        const [tx, ty] = L.torches[i];
        const fl = U.noise1(t * 6 + i * 4.3, i);
        G.blit(glowSprite(fl > 0.6 ? 2 : fl > 0.3 ? 1 : 0, 0), x + tx - 9, y + ty - 10, { ctx });
        G.blit(flameSprite((Math.floor(t * 10) + i * 3) % 4, 0), x + tx - 2, y + ty - 7, { ctx });
      }
      for (let i = 0; i < L.fires.length; i++) {
        const [fx, fy] = L.fires[i];
        const fl = U.noise1(t * 5 + i * 2.7, i + 7);
        G.blit(glowSprite(fl > 0.6 ? 2 : fl > 0.3 ? 1 : 0, 1), x + fx - 15, y + fy - 16, { ctx });
        G.blit(flameSprite((Math.floor(t * 9) + i * 2) % 4, 1), x + fx - 4, y + fy - 11, { ctx });
      }
      // chimney smoke (and green fumes from the apothecary)
      for (let i = 0; i < L.smoke.length; i++) {
        const [sx, sy, kind] = L.smoke[i];
        const N = 9;
        for (let k = N - 1; k >= 0; k--) {
          const age = (t * (kind === 's' ? 0.2 : 0.14) + k / N + i * 0.13) % 1;
          const px = sx + age * age * 18 + Math.sin(t * 1.1 + k * 2.3 + i) * 1.5 * age;
          const py = sy - age * 34;
          if (py < 2) continue;
          G.blit(puffSprite(Math.min(3, Math.floor(age * 4)), kind === 'g' ? 1 : kind === 's' ? 2 : 0, Math.min(3, Math.floor(age * 4.2))), x + Math.round(px) - 6, y + Math.round(py) - 6, { ctx });
        }
      }
      // forge sparks
      if (L.sparks) {
        const [sx, sy] = L.sparks;
        for (let k = 0; k < 5; k++) {
          const age = (t * 0.9 + k * 0.37) % 1;
          const r = hash2(k, Math.floor(t * 0.9 + k * 0.37), 5);
          const px = sx + (r - 0.5) * 10 * age + age * 4, py = sy - age * 22 - r * 4;
          if (age < 0.85) G.rect(x + Math.round(px), y + Math.round(py), 1, 1, age < 0.3 ? '#ffb' : age < 0.6 ? '#fa2' : '#c40', ctx);
        }
      }
      // arena flags
      if (L.flags) L.flags.forEach(([fx, fy], i) => G.blit(flagSprite((Math.floor(t * 5) + i) % 3), x + fx, y + fy, { ctx }));
      // golden motes drifting in the dawn light of the open gate
      if (open) {
        for (let k = 0; k < 10; k++) {
          const age = (t * 0.12 + k * 0.1) % 1;
          const mx = L.cx + Math.sin(k * 7.1 + t * 0.6) * (8 + age * 30), my = L.yB - 8 + age * 70;
          if (TH(k, Math.floor(t * 4)) < 0.7) G.rect(x + Math.round(mx), y + Math.round(my), 1, 1, k % 3 ? '#fd8' : '#ffe', ctx);
        }
      }
      // the night watch, pacing before the gate
      {
        const per = 18, ph = t % per;
        const x0g = L.cx - 34, x1g = L.cx + 34;
        let gx, dir = 1, moving = true;
        if (ph < 7) gx = x0g + (x1g - x0g) * ph / 7;
        else if (ph < 9) { gx = x1g; moving = false; dir = ph < 8 ? 1 : -1; }
        else if (ph < 16) { gx = x1g - (x1g - x0g) * (ph - 9) / 7; dir = -1; }
        else { gx = x0g; moving = false; dir = ph < 17 ? -1 : 1; }
        const fr = moving ? (Math.floor(t * 5) % 2) + 1 : 0;
        G.blit(guardSprite(fr), x + Math.round(gx) - 5, y + L.yB + 9 - 17, { ctx, flipX: dir < 0 });
      }
      // a black cat on the inn's barrel, tail swishing, blinking
      if (L.cat) {
        const blink = (t % 5) < 0.15;
        G.blit(catSprite(Math.floor(t * 2.5) % 4, blink), x + L.cat[0] - 4, y + L.cat[1] - 8, { ctx });
      }
    },
    hotspots(w, h) {
      const L = townLayout(w, h);
      const ar = L.arena, g = L.gate, a = L.apo, sm = L.smithy, n = L.inn;
      const ax0 = Math.max(0, ar.x0);
      return [
        // box bottoms are staggered so the screen's name plaques never share a row
        { id: 'arena', x: ax0, y: ar.top, w: ar.x1 - ax0, h: ar.base + 2 - ar.top, label: 'ARENA' },
        { id: 'gate', x: g.x0, y: g.top - 4, w: g.x1 - g.x0, h: g.base + 8 - (g.top - 4), label: 'NORTH GATE' },
        { id: 'apothecary', x: a.x0 - 8, y: a.top, w: a.x1 - a.x0 + 8, h: n.top - 5 - a.top, label: 'APOTHECARY' },
        { id: 'smithy', x: sm.x0, y: sm.top, w: sm.x1 - sm.x0, h: Math.min(h, sm.base + 8) - sm.top, label: 'SMITHY' },
        { id: 'inn', x: n.x0 - 16, y: g.base + 9, w: n.x1 - n.x0 + 16, h: Math.min(h, n.base + 6) - (g.base + 9), label: 'INN' },
      ];
    },
  };

  // Dithered warm glow halo around a flame (3 sizes; kind 1 = brazier).
  function glowSprite(sz, kind) {
    const R = (kind ? 13 : 8) + sz, W = R * 2 + 3;
    return K.cached(`dw26|glow|${kind}|${sz}`, W, W, S => {
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const d = Math.hypot(x + 0.5 - W / 2, y + 0.5 - W / 2) / R;
        if (d >= 1) continue;
        const f = (1 - d) * (1 - d) * 0.5;
        if (f > TH(x, y)) S.set(x, y, d < 0.35 ? '#c72' : '#953');
      }
    });
  }
  // Smoke puff: size 0..3, kind 0 grey / 1 green / 2 sooty, fade 0..3.
  function puffSprite(sz, kind, fade) {
    return K.cached(`dw26|puff|${sz}|${kind}|${fade}`, 13, 13, S => {
      const r = 2.2 + sz * 1.2;
      const cols = kind === 1 ? ['#254', '#376', '#598'] : kind === 2 ? ['#323', '#445', '#667'] : ['#334', '#556', '#778'];
      const dens = 1 - fade * 0.22;
      for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
        const dx = x + 0.5 - 6.5, dy = y + 0.5 - 6.5, d = Math.hypot(dx, dy) / r;
        if (d > 1) continue;
        if ((1 - d * d * 0.6) * dens <= TH(x + sz, y + fade * 2)) continue;
        const lit = (-dx - dy) / r;
        S.set(x, y, lit > 0.5 ? cols[2] : lit > -0.3 ? cols[1] : cols[0]);
      }
    });
  }
  // Pennant flag, 3 waving frames.
  function flagSprite(f) {
    return K.cached(`dw26|flag|${f}`, 8, 5, S => {
      for (let x = 0; x < 7; x++) {
        const k = x / 6, wv = Math.round(Math.sin(f * 2.1 + x * 0.9) * k * 1.2);
        const half = 2 - k * 1.5;
        for (let y = Math.round(2 - half + wv); y <= Math.round(2 + half + wv); y++) S.set(x, y, y <= 1 + wv ? '#e53' : '#a12');
      }
      S.set(0, 1, '#eb3'); S.set(0, 2, '#c92');
    });
  }
  // The night watch: 10x17, frame 0 idle, 1-2 walking (faces right).
  function guardSprite(f) {
    return K.cached(`dw26|guard|${f}`, 11, 18, S => {
      const step = f === 0 ? 0 : f === 1 ? 1.5 : -1.5;
      S.capsule(4.5, 12, 4.5 - step, 16.5, 1, 1, ['#101', '#112', '#223'], {});
      S.capsule(6, 12, 6 + step, 16.5, 1, 1, ['#101', '#112', '#223', '#334'], {});
      S.poly([[3, 6], [8, 6], [8.5, 13], [2.5, 13]], 'crimson', { grad: [3, 6, 8, 13, 0.6, 0.25] });
      S.rect(3, 9, 6, 1, '#a70');
      S.ball(5.5, 4, 2.2, 2.2, 'steel', { spec: 0.6 });
      S.rect(3, 4, 6, 1, '#445'); S.set(7, 4, '#b65');
      S.capsule(8.5, 7, 9, 11, 0.9, 0.9, ['#212', '#433', '#644'], {});
      S.line(9, 0, 9, 17, '#431'); S.set(9, 0, '#ccd'); S.set(9, 1, '#99a');
      S.outline('#101');
    });
  }
  // Black cat sitting, 4 tail frames, optional blink.
  function catSprite(f, blink) {
    return K.cached(`dw26|cat|${f}|${blink ? 1 : 0}`, 9, 9, S => {
      const c = '#101';
      S.ellipse(4, 6.5, 2.6, 2.2, c);
      S.ellipse(3, 3.5, 1.8, 1.6, c);
      S.set(1.6, 1.4, c); S.set(4.2, 1.4, c);
      const tail = [[6, 8, 8, 6], [6, 8, 8, 5], [6, 8, 7, 5], [6, 8, 8, 7]][f];
      S.line(tail[0], tail[1], tail[2], tail[3], c); S.set(tail[2], tail[3] - 1, c);
      if (!blink) { S.set(2, 3, '#ee4'); S.set(4, 3, '#ee4'); }
      S.set(2, 2, '#213');
    });
  }

  // Flame sprite: kind 0 = torch (5x8), 1 = brazier (9x12). 4 frames.
  function flameSprite(f, kind) {
    const W = kind ? 9 : 5, H = kind ? 12 : 8;
    return K.cached(`dw26|flame|${kind}|${f}`, W, H, S => {
      const r = U.rng(100 + f * 7 + kind * 31);
      const cx = (W - 1) / 2;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = y / (H - 1);                       // 0 tip → 1 base
        const sway = Math.sin(f * 1.7 + y * 0.9) * (1 - k) * (kind ? 1.4 : 0.8);
        const half = (kind ? 4.2 : 2.2) * Math.pow(k, 0.7) * (0.85 + r() * 0.3);
        const d = Math.abs(x + 0.5 - (cx + 0.5 + sway)) / Math.max(0.4, half);
        if (d > 1) continue;
        const heat = (1 - d) * 0.7 + k * 0.5;
        S.set(x, y, heat > 0.95 ? '#ffb' : heat > 0.75 ? '#fd5' : heat > 0.5 ? '#fa2' : heat > 0.3 ? '#e70' : '#a30');
      }
    });
  }

  // ================================================================
  // VICTORY — dawn over the open North Gate; the road north.
  // ================================================================
  const DAWN_SKY = ['#113', '#214', '#325', '#436', '#547', '#758', '#a68', '#c77', '#e86', '#fa6', '#fc7', '#fd9', '#ffc'];
  const R_BACK = ['#001', '#101', '#102', '#112', '#213', '#223', '#324', '#334', '#435', '#546'];

  function vicLayout(w, h) {
    return remember(`vic|${w}x${h}`, () => {
      const L = { w, h, cx: Math.round(w / 2) };
      L.yT = Math.min(Math.round(h * 0.62), h - 182);            // threshold (hero's feet)
      L.OH = Math.round(Math.min(h * 0.3, L.yT - h * 0.25, L.yT - h * 0.07 - 84));   // opening height (battlements stay under the titles)
      L.AW = Math.round(Math.min(w * 0.58, L.OH * 0.95)) & ~1;      // opening width
      L.ax0 = L.cx - L.AW / 2; L.ax1 = L.cx + L.AW / 2;
      L.R = L.AW / 2;
      L.archTop = L.yT - L.OH;
      L.spring = L.archTop + L.R;
      L.wallTop = L.archTop - 20;
      L.towerTop = L.archTop - 38;
      L.yH = L.yT - Math.round(L.OH * 0.36);                       // horizon seen through the arch
      L.sun = [L.cx + 2, L.yH];
      L.soffit = 5;
      L.heroH = Math.round(L.OH * 0.46);
      L.torches = [[L.ax0 - 6, L.spring + 14], [L.ax1 + 5, L.spring + 14]];
      // pixel rows of the visible opening (inside the soffit) for exact clipping
      L.rows = [];
      for (let y = L.archTop + L.soffit; y < L.yT; y++) {
        let x0 = L.ax0 + L.soffit, x1 = L.ax1 - L.soffit;
        if (y + 0.5 < L.spring) {
          const r = L.R - L.soffit, dy = L.spring - (y + 0.5);
          if (dy > r) continue;
          const hw = Math.sqrt(r * r - dy * dy);
          x0 = Math.round(L.cx - hw); x1 = Math.round(L.cx + hw);
        }
        L.rows.push([y, x0, x1]);
      }
      L.inOpen = (x, y, grow = 0) => {
        if (y >= L.yT || x + 0.5 < L.ax0 + L.soffit - grow || x + 0.5 > L.ax1 - L.soffit + grow) return false;
        if (y + 0.5 >= L.spring) return y >= L.archTop + L.soffit - grow;
        return Math.hypot(x + 0.5 - L.cx, y + 0.5 - L.spring) <= L.R - L.soffit + grow;
      };
      L.inArch = (x, y) => {
        if (y >= L.yT || x + 0.5 < L.ax0 || x + 0.5 > L.ax1) return false;
        if (y + 0.5 >= L.spring) return true;
        return Math.hypot(x + 0.5 - L.cx, y + 0.5 - L.spring) <= L.R;
      };
      return L;
    });
  }

  // The land beyond: mountains, the sea and Blackstone, hills, the road north.
  function paintBeyond(S, L) {
    const { w, cx, yH, yT } = L;
    const [sx, sy] = L.sun;
    const span = yT - yH;
    // sun glow on the sky
    for (let y = yH - 50; y < yH + 2; y++) for (let x = sx - 60; x < sx + 60; x++) {
      const d = Math.hypot(x + 0.5 - sx, (y + 0.5 - sy) * 1.4);
      const f = 1 - d / 60;
      if (f > 0 && f * 0.9 > TH(x, y)) S.set(x, y, f > 0.55 ? '#ffd' : '#fe9');
    }
    // distant mountains (hazy, rose-lit edges)
    const mtn = x => yH - 4 - Math.max(0, Math.sin(x * 0.07 + 0.5) * 7 + Math.sin(x * 0.19) * 3 + Math.sin(x * 0.031 + 2) * 5);
    for (let x = 0; x < w; x++) {
      const top = Math.round(mtn(x));
      for (let y = top; y <= yH; y++) {
        const edge = y === top;
        S.set(x, y, edge ? '#dab' : (y - top) < 3 && TH(x, y) < 0.5 ? '#b9a' : '#a89');
      }
    }
    // the sea to the east, glittering under the new sun
    const seaX = cx + Math.round(L.AW * 0.1);
    for (let y = yH; y < yH + 7; y++) for (let x = seaX; x < w; x++) {
      const near = Math.abs(x + 0.5 - sx) < 3 + (y - yH) * 1.6;
      S.set(x, y, near ? (TH(x, y) < 0.55 ? '#ffe' : '#fd8') : (y - yH) === 0 ? '#cab' : TH(x, y) < 0.35 ? '#a8a' : '#869');
    }
    // Blackstone: a black town on a sea-cliff, brooding under its own storm
    const bx = cx + Math.round(L.AW * 0.33), by = yH + 1;
    S.poly([[bx - 10, by + 6], [bx - 8, by], [bx - 3, by - 3], [bx + 8, by - 4], [bx + 12, by + 1], [bx + 13, by + 6]], ['#213'], { tone: 0 });
    const spire = (x0, hgt, wd = 2) => { S.rect(x0, by - 3 - hgt, wd, hgt, '#102'); S.set(x0 + (wd >> 1), by - 4 - hgt, '#102'); S.set(x0 + (wd >> 1), by - 5 - hgt, '#102'); };
    S.rect(bx - 5, by - 6, 15, 3, '#102');
    spire(bx - 5, 4); spire(bx - 2, 7); spire(bx + 1, 11, 3); spire(bx + 5, 6); spire(bx + 8, 3);
    S.set(bx + 2, by - 10, '#7e6'); S.set(bx - 1, by - 6, '#5a4');
    // a low storm bank brooding over Blackstone; the spires stand black against it
    for (let y = by - 22; y < by - 1; y++) for (let x = bx - 22; x < w; x++) {
      const top = by - 13 - Math.max(0, 6 * Math.sin((x - bx + 22) * 0.12) + 3 * Math.sin(x * 0.37)) * Math.min(1, (x - bx + 22) / 12);
      if (y < top || S.getHex(x, y) === '#102') continue;
      const dy = y - top, edge = Math.min(1, (x - (bx - 22)) / 10);
      if (edge * 1.4 - 0.2 < TH(x, y)) continue;
      S.set(x, y, dy < 1 ? '#a79' : dy < 4 ? '#768' : '#657');
    }
    spire(bx - 5, 4); spire(bx - 2, 7); spire(bx + 1, 11, 3); spire(bx + 5, 6); spire(bx + 8, 3);
    S.rect(bx - 5, by - 6, 15, 3, '#102');
    S.set(bx + 2, by - 10, '#7e6'); S.set(bx - 1, by - 6, '#5a4');
    // hills in three ranks, backlit: dark faces, golden crests
    const ranks = [
      { base: yH + 1, amp: 0.16, f: 0.05, ph: 1.2, col: ['#867', '#978', '#dca'], seed: 1 },
      { base: yH + Math.round(span * 0.35), amp: 0.22, f: 0.035, ph: 3.0, col: ['#554', '#665', '#eb8'], seed: 2 },
      { base: yH + Math.round(span * 0.7), amp: 0.2, f: 0.028, ph: 5.1, col: ['#332', '#443', '#fc8'], seed: 3 },
    ];
    const crest = [];
    ranks.forEach((rk, i) => {
      const topAt = x => Math.round(rk.base - span * rk.amp * (0.5 + 0.5 * Math.sin(x * rk.f + rk.ph)) - Math.sin(x * rk.f * 2.7) * 2);
      crest[i] = topAt;
      for (let x = 0; x < w; x++) {
        if (i === 0 && x >= seaX - 2) continue;
        const top = topAt(x);
        for (let y = top; y < yT; y++) {
          const dy = y - top;
          S.set(x, y, dy === 0 ? rk.col[2] : dy === 1 && TH(x, y) < 0.6 ? rk.col[2] : dy < 5 && TH(x, y) < 0.5 - dy * 0.1 ? rk.col[1] : rk.col[0]);
        }
      }
    });
    // a ruined tower on the western hills and a cave in an outcrop: adventures waiting
    const tx = cx - Math.round(L.AW * 0.3), ty = crest[1](tx);
    S.rect(tx - 2, ty - 9, 5, 10, '#323'); S.rect(tx - 2, ty - 10, 2, 1, '#323'); S.rect(tx + 2, ty - 11, 1, 2, '#323');
    S.set(tx - 2, ty - 9, '#eb8'); S.set(tx, ty - 6, '#100');
    const cvx = cx - Math.round(L.AW * 0.12), cvy = crest[2](cvx) + 4;
    S.poly([[cvx - 7, cvy + 6], [cvx - 4, cvy - 3], [cvx + 3, cvy - 4], [cvx + 8, cvy + 6]], ['#323'], { tone: 0 });
    S.line(cvx - 4, cvy - 3, cvx + 3, cvy - 4, '#fc8');
    S.ellipse(cvx + 1, cvy + 3, 2.5, 2.5, '#100'); S.rect(cvx - 1, cvy + 3, 5, 3, '#100');
    // trees dotting the near hills
    const r = U.rng(9);
    for (let k = 0; k < 11; k++) {
      const x = Math.round(L.ax0 + 6 + r() * (L.AW - 12)), ri = 1 + (k % 2);
      if (Math.abs(x - cx) < 10) continue;
      const y0 = crest[ri](x) + 2 + Math.floor(r() * 3);
      const ht = 4 + ri * 2 + Math.floor(r() * 3);
      for (let j = 0; j < ht; j++) {
        const half = Math.round((j / ht) * (1 + ri * 0.6));
        for (let i = -half; i <= half; i++) S.set(x + i, y0 - ht + j, i === -half ? (ri === 1 ? '#eb8' : '#fc8') : '#212');
      }
    }
    // the road north: wide at the gate, winding up to the horizon
    for (let y = yH + 2; y < yT; y++) {
      const k = (y - yH) / span;                       // 0 far → 1 near
      const half = 0.6 + k * k * L.AW * 0.2;
      const rc = cx + Math.sin(k * 7.5 + 0.8) * L.AW * 0.2 * (1 - k * 0.85) + (1 - k) * 6;
      for (let x = Math.floor(rc - half); x <= rc + half; x++) {
        const e = Math.abs(x + 0.5 - rc) / Math.max(0.6, half);
        S.set(x, y, e > 0.8 ? '#a75' : k < 0.5 ? (TH(x, y) < 0.5 ? '#ffd' : '#fd9') : (TH(x, y) < 0.3 + k * 0.3 ? '#c96' : '#fd9'));
      }
    }
    // the sun itself, half-risen behind the mountains
    for (let y = sy - 9; y <= sy; y++) for (let x = sx - 9; x <= sx + 9; x++) {
      const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
      if (d <= 8.5 && y < Math.round(mtn(x)) + 1) S.set(x, y, d > 7 ? '#ffd' : '#fff');
    }
  }

  // Inner face of the gatehouse, backlit by the dawn.
  function paintGatehouse(S, L) {
    const { w, h, cx, ax0, ax1, archTop, wallTop, towerTop, yT } = L;
    const C = K.create(w, h);
    const tL1 = ax0 - 10, tR0 = ax1 + 10;           // tower inner edges
    const inFrame = (x, y) => {
      if (y >= yT + 4) return false;
      if (y >= yT) return false;
      if (L.inArch(x, y)) return false;
      if (x < tL1 || x >= tR0) return y >= towerTop;
      return y >= wallTop;
    };
    masonry(C, 0, towerTop - 4, w, yT - towerTop + 4, R_BACK, {
      I: (x, y) => 0.36 + (y - towerTop) / (yT - towerTop) * 0.1 - (x < tL1 || x >= tR0 ? 0.05 : 0), seed: 81, bw: 8, bh: 4, test: inFrame });
    // tower faces step forward: a lit edge where they meet the curtain
    for (let y = towerTop; y < yT; y++) { C.set(tL1 - 1, y, '#112'); C.set(tL1 - 2, y, '#001'); C.set(tR0, y, '#324'); C.set(tR0 + 1, y, '#213'); }
    // merlons on towers and wall, rim-lit by the sky
    const merlons = (x0, x1, y0, step) => {
      for (let x = x0; x < x1; x += step) {
        for (let j = 0; j < 5; j++) for (let i = 0; i < step - 3; i++) C.shadePx(x + i, y0 - 5 + j, R_BACK, 0.38);
        C.rect(x, y0 - 5, step - 3, 1, '#a68'); C.set(x, y0 - 4, '#758');
      }
      C.rect(x0, y0, x1 - x0, 1, '#213');
    };
    merlons(-2, tL1, towerTop, 7); merlons(tR0, w + 2, towerTop, 7); merlons(tL1, tR0, wallTop, 6);
    // voussoirs around the arch, with a hot inner rim from the dawn
    for (let y = archTop - 9; y < yT; y++) for (let x = ax0 - 9; x < ax1 + 9; x++) {
      if (L.inArch(x, y)) continue;
      const dEdge = y + 0.5 < L.spring ? Math.hypot(x + 0.5 - cx, y + 0.5 - L.spring) - L.R : Math.min(Math.abs(x + 0.5 - ax0), Math.abs(x + 0.5 - ax1));
      if (dEdge > 8 || dEdge < 0) continue;
      const a = Math.atan2(y + 0.5 - L.spring, x + 0.5 - cx);
      const seg = (a + Math.PI) / (Math.PI / 13);
      const joint = y + 0.5 < L.spring && Math.abs(seg - Math.round(seg)) < 0.12;
      C.shadePx(x, y, R_BACK, joint ? 0.2 : 0.44 + (dEdge < 1.5 ? 0.25 : 0));
    }
    // soffit: the arch's inner surface, glowing with bounced dawn light
    for (let y = archTop; y < yT; y++) for (let x = ax0; x < ax1; x++) {
      if (!L.inArch(x, y) || L.inOpen(x, y)) continue;
      const k = (y - archTop) / (yT - archTop);
      C.set(x, y, P.rampF(['#432', '#753', '#a74', '#c85', '#ea6'], 0.25 + k * 0.7 + (TH(x, y) - 0.5) * 0.2, x, y));
    }
    // the threshold sill, its top edge lit by the dawn
    for (let x = ax0 - 4; x < ax1 + 4; x++) { C.set(x, yT, '#fc8'); C.set(x, yT + 1, TH(x, yT) < 0.5 ? '#a64' : '#753'); C.set(x, yT + 2, '#324'); C.set(x, yT + 3, '#102'); }
    // banners of Darkwood on the towers
    const banner = (bx) => {
      const bw = 12, top = towerTop + 6, bot = Math.min(yT - 26, towerTop + 6 + Math.round(L.OH * 0.55));
      for (let y = top; y < bot; y++) for (let x = bx; x < bx + bw; x++) {
        const tip = y > bot - 5 && Math.abs(x + 0.5 - (bx + bw / 2)) > (bot - y) * bw / 10;
        if (tip) continue;
        C.shadePx(x, y, 'crimson', (x < bx + 2 ? 0.42 : 0.3) - (y - top) / (bot - top) * 0.12);
      }
      C.rect(bx - 1, top - 1, bw + 2, 2, '#432'); C.rect(bx - 1, top - 1, bw + 2, 1, '#a74');
      C.rect(bx, top + 1, bw, 1, '#a70');
      // golden tree emblem
      const ex = bx + bw / 2 - 0.5, ey = top + Math.round((bot - top) * 0.4);
      C.rect(ex, ey, 1, 7, '#c92'); C.ellipse(ex + 0.5, ey, 3.5, 2.5, '#c92'); C.set(ex - 1, ey - 1, '#fe6'); C.set(ex + 1, ey + 6, '#a70'); C.set(ex - 1, ey + 6, '#a70');
    };
    banner(Math.round(tL1 / 2 - 6));
    banner(Math.round((tR0 + w) / 2 - 6));
    rimLight(C, '#435', null, (x, y) => !L.inArch(x, y));
    S.stamp(C, 0, 0);
    // torches either side of the arch (flames animate)
    for (const [tx, ty] of L.torches) { S.rect(tx - 1, ty + 1, 3, 1, '#112'); S.set(tx, ty + 2, '#001'); S.set(tx, ty, '#310'); lightPool(S, tx, ty, 12, 0.6, '#f93'); }
  }

  // The plaza floor before the gate, in deep shadow.
  const R_COBBLE_LIT = ['#200', '#311', '#421', '#532', '#743', '#954', '#b75', '#d96', '#fb8'];
  function paintVicFloor(S, L, ramp = R_COBBLE, lift = 0) {
    const { w, h, cx, yT } = L;
    const vpY = yT - 160, C = 14000, KX = 60;
    for (let y = yT; y < h; y++) {
      const d = y + 0.5 - vpY, depth = C / d, row = Math.floor(depth), by = depth - row;
      const k = (y - yT) / (h - yT);
      for (let x = 0; x < w; x++) {
        const px = (x + 0.5 - cx) / d * KX + (row & 1) * 0.5;
        const col = Math.floor(px), bx = px - col;
        let I = 0.3 + lift + (hash2(col, row, 83) - 0.5) * 0.16 - k * 0.14;
        if (Math.min(bx, 1 - bx) < 0.1 || Math.min(by, 1 - by) < 0.12) I -= 0.2;
        else if (by > 0.8) I += 0.08;
        S.shadePx(x, y, ramp, I);
      }
    }
  }

  // Light fields: sun rays fanning up through the dawn sky, and a pool of
  // light thrown through the gate across the cobbles (with the hero's shadow).
  function vicLight(w, h) {
    return remember(`viclight|${w}x${h}`, () => {
      const L = vicLayout(w, h);
      const [sx, sy] = L.sun;
      const ray = new Float32Array(w * h), floor = new Float32Array(w * h);
      const sky = (x, y) => (y < L.wallTop - 5 && !(y >= L.towerTop - 5 && (x < L.ax0 - 10 || x >= L.ax1 + 10))) || (L.inOpen(x, y) && y < L.yH - 3);
      for (let y = 0; y < L.yT; y++) for (let x = 0; x < w; x++) {
        if (!sky(x, y)) continue;
        const dx = x + 0.5 - sx, dy = y + 0.5 - sy, d = Math.hypot(dx, dy);
        const th = Math.atan2(dy, dx);
        // a fan of thin rays: only the upper half-plane, narrowing toward the sun
        const st = Math.pow(Math.max(0, Math.cos(th * 16 + 0.5)), 3) * (dy < 0 ? 1 : 0);
        ray[y * w + x] = st * U.clamp(1.1 - d / (h * 0.62), 0, 1) * (L.inOpen(x, y) ? 0.45 : 0.75);
      }
      // floor: a trapezoid widening toward us, fading into the dark
      const top = L.ax1 - L.ax0 - L.soffit * 2, span = h - L.yT;
      const hx = L.cx, hw = L.heroH * 0.16;
      for (let y = L.yT; y < h; y++) {
        const k = (y - L.yT) / span;
        const half = top / 2 * (1 + k * 0.42);
        const fade = Math.pow(Math.max(0, 1 - k * 1.25), 1.6) * 1.05;
        const shHalf = hw * (1 + k * 1.3), shX = hx + k * 3;
        for (let x = 0; x < w; x++) {
          const e = (half - Math.abs(x + 0.5 - L.cx)) / 5;
          if (e <= 0) continue;
          let f = Math.min(1, e) * fade;
          // the hero's shadow: legs, cape, then head, running toward us
          const ds = Math.abs(x + 0.5 - shX);
          if (k < 0.5 && ds < shHalf * (k < 0.08 ? 0.9 : 1.15)) f *= 0.08;
          else if (k >= 0.5 && k < 0.6 && ds < shHalf * 0.8) f *= 0.08;
          else if (k >= 0.6 && k < 0.68 && ds < shHalf * 0.45) f *= 0.1;
          floor[y * w + x] = f;
        }
      }
      return { ray, floor };
    });
  }
  // Lit versions of the sky and floor (sprites), revealed through the light fields.
  function vicLitImages(w, h) {
    return remember(`viclit|${w}x${h}`, () => {
      const L = vicLayout(w, h);
      const sky = K.create(w, L.yT);
      copper(sky, 0, 0, w, L.yH + 1, DAWN_SKY.slice(1).concat(['#ffe']), 4);
      sky.rect(0, L.yH + 1, w, L.yT - L.yH - 1, '#ffe');
      const floor = K.create(w, h);
      paintVicFloor(floor, L, R_COBBLE_LIT, 0.22);
      return { sky, floor };
    });
  }
  function vicRayLayer(w, h, lv) {
    const L = vicLayout(w, h);
    return K.cached(`dw26|vic|rays|${w}x${h}|${lv}`, w, L.yT, S => {
      const { ray } = vicLight(w, h);
      const src = vicLitImages(w, h).sky.data;
      const k = lv / 4;
      for (let y = 0; y < L.yT; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (ray[i] * k > TH(x, y)) S.data[i] = src[i];
      }
    });
  }
  function vicFloorLayer(w, h, lv) {
    const L = vicLayout(w, h);
    return K.cached(`dw26|vic|floor|${w}x${h}|${lv}`, w, h - L.yT, S => {
      const { floor } = vicLight(w, h);
      const src = vicLitImages(w, h).floor.data;
      const k = lv / 6;
      for (let y = 0; y < h - L.yT; y++) for (let x = 0; x < w; x++) {
        const gi = (y + L.yT) * w + x, v = floor[gi] * k, t = TH(x, y + L.yT);
        if (v <= t) continue;
        if (v > t + 0.6) S.set(x, y, '#fd9'); else S.data[y * w + x] = src[gi];
      }
    });
  }

  // Hero seen from behind, backlit, cape stirring (3 frames). H = height.
  function vicHero(H, f) {
    const W = Math.round(H * 0.82) + 4;
    return K.cached(`dw26|vic|hero|${H}|${f}`, W, H + 2, S => {
      const k = H / 64, X = v => v * k + 2, Y = v => v * k + 1;
      const body = ['#001', '#101', '#102', '#203'];
      const o = { lo: 0, hi: 3 };
      const sw = [0, 1, -1][f];
      // sword (screen right), point toward the ground, catching the dawn
      S.capsule(X(40), Y(35), X(48), Y(61), 1.25 * k, 0.45 * k, ['#223', '#556', '#99a', '#dde'], { spec: 0.6 });
      S.capsule(X(36.5), Y(35.5), X(43), Y(33), 0.9 * k, 0.9 * k, body, o);
      // legs below the cape, planted wide
      S.capsule(X(19), Y(42), X(14), Y(60), 3.2 * k, 2.6 * k, body, o);
      S.capsule(X(28), Y(42), X(33), Y(60), 3.2 * k, 2.6 * k, body, o);
      S.ball(X(13), Y(61.2), 3.6 * k, 2 * k, body, o); S.ball(X(34), Y(61.2), 3.6 * k, 2 * k, body, o);
      // sword arm hanging clear of the body
      S.capsule(X(34), Y(18), X(38), Y(27), 3 * k, 2.6 * k, body, o);
      S.capsule(X(38), Y(27), X(39.5), Y(34), 2.6 * k, 2.4 * k, body, o);
      // shield arm: elbow out, fist on the hip
      S.capsule(X(13), Y(18), X(6), Y(26), 3 * k, 2.6 * k, body, o);
      S.capsule(X(6), Y(26), X(12), Y(33), 2.6 * k, 2.4 * k, body, o);
      // cape hanging from the pauldrons, hem fluttering
      S.poly([[X(15), Y(15)], [X(32), Y(15)], [X(35), Y(30)], [X(36.5 + sw * 0.4), Y(46)], [X(31), Y(47.5 - sw)], [X(24), Y(46.5 + sw)], [X(17), Y(48 - sw)], [X(10.5 - sw * 0.4), Y(46)], [X(12), Y(30)]], body, { tone: 0.3 });
      // pauldrons and shoulders
      S.ball(X(13), Y(17), 5 * k, 4 * k, body, o);
      S.ball(X(34), Y(17), 5 * k, 4 * k, body, o);
      S.ball(X(23.5), Y(17), 9 * k, 3.6 * k, body, o);
      // round shield slung across the back
      S.ellipse(X(23.5), Y(28), 6.6 * k, 6.6 * k, '#203');
      S.ellipse(X(23.5), Y(28), 5.6 * k, 5.6 * k, '#102');
      S.ellipse(X(23.5), Y(28), 1.4 * k, 1.4 * k, '#213');
      // cape folds
      for (const fx of [18, 29]) S.line(X(fx), Y(36), X(fx + (fx < 24 ? -1.5 : 1.5)), Y(46), '#102');
      // head, neck, windblown hair
      S.capsule(X(23.5), Y(11), X(23.5), Y(15), 2.8 * k, 3.2 * k, body, o);
      S.ball(X(23.5), Y(8), 4.6 * k, 5.2 * k, body, o);
      S.tri([X(20), Y(5)], [X(16 + sw * 0.6), Y(7.5)], [X(19.5), Y(10)], body, { tone: 0.2 });
      S.tri([X(20), Y(9)], [X(16.5 + sw * 0.6), Y(12)], [X(20.5), Y(12.5)], body, { tone: 0.2 });
      // backlight rim: every edge facing the dawn catches gold
      const src = S.data.slice(), Wd = S.w, Hd = S.h;
      const at = (x, y) => (x >= 0 && y >= 0 && x < Wd && y < Hd) ? src[y * Wd + x] : 0;
      const steel = new Set(['#223', '#556', '#99a', '#dde'].map(c => P.toInt(c)));
      for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) {
        const v = at(x, y);
        if (!v || steel.has(v)) continue;
        const up = !at(x, y - 1), lf = !at(x - 1, y), rt = !at(x + 1, y);
        if (up) S.set(x, y, '#fe9');
        else if (lf || rt) S.set(x, y, y < Hd * 0.72 ? '#fc7' : '#c85');
        else if ((!at(x, y - 2) || !at(x - 2, y) || !at(x + 2, y)) && TH(x, y) < 0.5 && y < Hd * 0.8) S.set(x, y, '#842');
      }
      S.outline('#001');
    });
  }

  // The great portcullis (taller than the opening; slides up).
  function vicPortcullis(w, h, L) {
    const W = L.AW, H = L.OH + 10;
    return K.cached(`dw26|vic|gate|${w}x${h}`, W, H, S => {
      const step = 10, rowStep = 13;
      for (let x = 3; x < W; x += step) {
        for (let y = 0; y < H - 1; y++) { S.set(x, y, '#223'); S.set(x + 1, y, '#334'); S.set(x + 2, y, '#101'); }
        S.set(x, H - 3, '#334'); S.set(x + 1, H - 3, '#556'); S.set(x + 1, H - 2, '#445'); S.set(x + 1, H - 1, '#fc8');
      }
      for (let y = H - 8; y > 0; y -= rowStep) {
        for (let x = 0; x < W; x++) { S.set(x, y, '#334'); S.set(x, y + 1, '#112'); }
        for (let x = 3; x < W; x += step) { S.set(x + 1, y, '#c86'); }
      }
      // backlight on the bars' edges
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (S.opaque(x, y) && !S.opaque(x - 1, y) && TH(x, y) < 0.6) S.set(x, y, '#a64');
      }
    });
  }

  // Small bird, two wing frames.
  function birdSprite(f) {
    return K.cached(`dw26|bird|${f}`, 7, 4, S => {
      if (f) { S.set(0, 2, '#213'); S.set(1, 1, '#213'); S.set(2, 2, '#213'); S.set(3, 2, '#213'); S.set(4, 2, '#213'); S.set(5, 1, '#213'); S.set(6, 2, '#213'); }
      else { S.set(0, 0, '#213'); S.set(1, 1, '#213'); S.set(2, 2, '#213'); S.set(3, 3, '#213'); S.set(4, 2, '#213'); S.set(5, 1, '#213'); S.set(6, 0, '#213'); }
    });
  }

  A.scenes['victory'] = {
    paint(S, w, h) {
      const L = vicLayout(w, h);
      copper(S, 0, 0, w, L.yH + 1, DAWN_SKY, 4);
      // last stars fading at the zenith
      const r = U.rng(5);
      for (let i = 0; i < w / 6; i++) { const x = Math.floor(r() * w), y = Math.floor(Math.pow(r(), 2) * h * 0.14); S.set(x, y, y < h * 0.07 ? '#99b' : '#668'); }
      // thin dawn clouds, lit underneath
      const cloud = (cy, x0, x1, th, seed) => {
        for (let x = Math.round(x0); x < x1; x++) {
          const kk = (x - x0) / (x1 - x0), taper = Math.pow(Math.sin(Math.PI * kk), 0.6);
          const tt = Math.max(1, Math.round(th * taper * (0.7 + 0.6 * vnoise(x / 9, 0, seed))));
          const yc = Math.round(cy + Math.sin(x * 0.05 + seed) * 1.2);
          for (let j = 0; j < tt; j++) S.set(x, yc - j, j === 0 ? '#e87' : j === 1 ? '#a68' : '#758');
          S.set(x, yc - tt, '#547');
        }
      };
      cloud(h * 0.17, w * 0.04, w * 0.48, 3, 1);
      cloud(h * 0.215, w * 0.5, w * 0.97, 3, 2);
      cloud(h * 0.12, w * 0.62, w * 0.88, 2, 3);
      cloud(h * 0.245, w * 0.1, w * 0.36, 2, 4);
      paintBeyond(S, L);
      paintVicFloor(S, L);
      paintGatehouse(S, L);
    },
    animate(ctx, x, y, w, h, t) {
      const L = vicLayout(w, h);
      const T = U.clamp(t / 3, 0, 1);
      const open = T < 0.5 ? 2 * T * T : 1 - Math.pow(-2 * T + 2, 2) / 2;   // ease in-out
      // birds over the land beyond
      for (let b = 0; b < 6; b++) {
        const bx = ((t * 9 + b * 23 + (b % 2) * 7) % (w + 40)) - 20;
        const by = L.archTop + 18 + (b % 3) * 7 + Math.sin(t * 1.3 + b) * 2 + b * 2;
        G.blit(birdSprite((Math.floor(t * 6) + b) % 2), x + Math.round(bx), y + Math.round(by), { ctx });
      }
      // sea glitter
      for (let k = 0; k < 6; k++) {
        const gx = L.sun[0] + Math.round(Math.sin(t * 3 + k * 2.2) * (3 + k * 2)), gy = L.yH + 1 + (k % 5);
        if (Math.sin(t * 7 + k * 3) > 0.3) G.rect(x + gx, y + gy, 1, 1, '#fff', ctx);
      }
      // the portcullis rising, clipped to the opening
      const pc = vicPortcullis(w, h, L);
      const py = L.archTop + L.soffit - Math.round(open * (L.OH - 6)) - 4;
      ctx.save();
      ctx.beginPath();
      for (const [ry, rx0, rx1] of L.rows) ctx.rect(x + rx0, y + ry, rx1 - rx0, 1);
      ctx.clip();
      G.blit(pc, x + L.ax0, y + py, { ctx });
      ctx.restore();
      // sun rays shimmer in the sky; light floods the cobbles as the gate opens
      G.blit(vicRayLayer(w, h, 2 + Math.round(1 + Math.sin(t * 0.9))), x, y, { ctx });
      const lv = Math.max(1, Math.round(open * 6));      // a little light slips through the bars even while shut
      G.blit(vicFloorLayer(w, h, lv), x, y + L.yT, { ctx });
      // torches burning down in the dawn
      for (let i = 0; i < L.torches.length; i++) {
        const [tx, ty] = L.torches[i];
        G.blit(flameSprite((Math.floor(t * 10) + i * 3) % 4, 0), x + tx - 2, y + ty - 7, { ctx });
      }
      // the hero, and his long shadow toward us
      const hero = vicHero(L.heroH, Math.floor(t * 2.2) % 3);
      G.blit(hero, x + L.cx - Math.round(hero.width / 2), y + L.yT + 1 - hero.height + 2, { ctx });
    },
  };

  // ================================================================
  // LOGO — "DARKWOOD", chunky gothic letterforms in chrome-gold with
  // thorn serifs and a bramble of thorny vines weaving through.
  // ================================================================
  const LOGO_W = 200, LOGO_H = 56;

  // Letter outlines in a local box (x right, y down, cap = 0..h).
  // Each: { w, h, polys:[...], holes:[...], spikes:[...] }
  function letterDefs() {
    const H = 30, B = 36;   // inner cap height, big initial/final D
    const D = (h, first) => {
      const w = 21, c = Math.round(h * 0.22);
      return {
        w, h,
        polys: [[[0, 0], [w - 7, 0], [w, 7], [w, h - 7], [w - 7, h], [0, h]]],
        holes: [[[6, c], [w - 10, c], [w - 6, c + 4], [w - 6, h - c - 4], [w - 10, h - c], [6, h - c]]],
        spikes: [[[0, 4], [-1, -4], [7, 0]], [[0, h - 4], [-1, h + 3], [7, h]]],
      };
    };
    const O = () => ({ w: 21, h: H,
      polys: [[[7, 0], [14, 0], [21, 7], [21, H - 7], [14, H], [7, H], [0, H - 7], [0, 7]]],
      holes: [[[8, 6], [13, 6], [15, 9], [15, H - 9], [13, H - 6], [8, H - 6], [6, H - 9], [6, 9]]],
      spikes: [] });
    return [
      D(B, true),
      { w: 22, h: H,   // A — pointed gothic apex
        polys: [[[8.5, 0], [13.5, 0], [22, H], [15, H], [13.8, H - 6], [8.2, H - 6], [7, H], [0, H]]],
        holes: [[[10.5, 9], [11.5, 9], [13.4, H - 12], [8.6, H - 12]]],
        spikes: [[[8.5, 0], [11, -5], [13.5, 0]]] },
      { w: 22, h: H,   // R
        polys: [[[0, 0], [16, 0], [22, 6], [22, 12], [17, 16], [22, H], [15, H], [11, 18], [6, 18], [6, H], [0, H]]],
        holes: [[[6, 6], [13, 6], [16, 8], [16, 10], [13, 12], [6, 12]]],
        spikes: [[[0, 3], [-2, -3], [6, 0]], [[22, H], [24, H + 3], [16, H]]] },
      { w: 22, h: H,   // K
        polys: [[[0, 0], [6, 0], [6, H], [0, H]],
                [[6, 11], [15, 0], [22, 0], [10, 17], [6, 17]],
                [[8, 15], [12, 11], [22, H], [15, H]]],
        holes: [],
        spikes: [[[0, 3], [-2, -3], [6, 0]], [[22, 0], [24, -4], [16, 0]], [[22, H], [24, H + 3], [16, H]]] },
      { w: 28, h: H,   // W
        polys: [[[0, 0], [7, 0], [8.5, 18], [11.5, 6], [16.5, 6], [19.5, 18], [21, 0], [28, 0], [23.5, H], [17, H], [14, 18], [11, H], [4.5, H]]],
        holes: [],
        spikes: [[[0, 0], [-2, -4], [7, 0]], [[21, 0], [30, -4], [28, 0]], [[11.5, 6], [14, 1], [16.5, 6]]] },
      O(), O(),
      D(B, false),
    ];
  }

  // Chrome-gold fill: a sunset-chrome "horizon" across each letter — warm
  // gold brightening down to a hot line, a dark bronze horizon, then
  // reflected light rising again toward the foot.
  const GOLD_TOP = ['#c92', '#eb3', '#fe6', '#ffb'];
  const GOLD_BOT = ['#420', '#640', '#850', '#a70', '#c92'];
  function goldAt(f, x, y) {
    const hz = 0.52;
    if (f < hz) return P.rampColor(GOLD_TOP, Math.pow(f / hz, 1.2) * (GOLD_TOP.length - 1), x, y);
    return P.rampColor(GOLD_BOT, Math.pow((f - hz) / (1 - hz), 0.8) * (GOLD_BOT.length - 1), x, y);
  }

  function paintLogo(S) {
    const W = LOGO_W, H = LOGO_H;
    const defs = letterDefs();
    const gap = 2;
    const total = defs.reduce((s, d) => s + d.w, 0) + gap * (defs.length - 1);
    let x = Math.floor((W - total) / 2) - 1;
    const base = 45;                         // baseline (bottom of caps)
    const letters = new Mask(W, H);
    const owner = new Int16Array(W * H).fill(-1);   // which letter owns a pixel (for gradient)
    const boxes = [];
    defs.forEach((d, i) => {
      const top = base - d.h + (d.h > 30 ? 3 : 0);
      const m = new Mask(W, H);
      for (const p of d.polys) m.poly(p, 1, x, top);
      for (const p of d.spikes || []) m.poly(p, 1, x, top);
      for (const p of d.holes) m.poly(p, 0, x, top);
      for (let k = 0; k < m.a.length; k++) if (m.a[k]) { letters.a[k] = 1; owner[k] = i; }
      boxes.push({ x, top, w: d.w, h: d.h });
      x += d.w + gap;
    });
    const bx = i => boxes[i].x, bt = i => boxes[i].top;

    // --- vines: control points [x, y, front?] ---
    const d1 = bx(0), d2 = bx(7) + 21;
    const vineA = [[0, 55, 1], [2, 49, 1], [d1 + 9, 43, 1], [d1 + 10, 40, 0], [d1 - 1, 33, 0], [d1 - 2, 30, 1], [d1 + 9, 24, 1], [d1 + 10, 21, 0],
      [d1 - 1, 14, 0], [d1 - 1, 10, 1], [d1 + 6, 5, 1], [d1 + 16, 5, 1], [d1 + 26, 9, 0], [bx(1) + 10, 5, 1], [bx(2) - 2, 5, 1], [bx(2) + 10, 9, 0],
      [bx(3) - 2, 5, 1], [bx(3) + 10, 8, 0], [bx(3) + 18, 4, 1], [bx(4) + 2, 2, 1], [bx(4) + 8, 4, 1]];
    const vineB = [[199, 55, 1], [197, 47, 1], [d2 + 1, 40, 0], [d2 - 3, 33, 0], [d2 + 1, 26, 1], [d2 + 2, 18, 1], [d2 - 2, 11, 0], [d2 - 9, 6, 1], [d2 - 17, 5, 1], [bx(6) + 6, 9, 0], [bx(6) - 1, 5, 1], [bx(5) + 9, 4, 1], [bx(5) + 3, 1, 1]];
    const vineC = [[d1 + 12, 53, 1], [bx(1) + 6, 49, 0], [bx(2) - 1, 52, 1], [bx(3) + 3, 48, 0], [bx(3) + 14, 52, 1], [bx(4) + 8, 49, 0], [bx(4) + 16, 52, 1], [bx(5) + 6, 48, 0], [bx(5) + 18, 52, 1], [bx(6) + 8, 48, 0], [bx(6) + 18, 52, 1], [d2 - 12, 53, 1]];
    const back = K.create(W, H), front = K.create(W, H);
    const thornsF = [], thornsB = [];
    const drawVine = (ctrl, r0, r1, seed) => {
      const path = spline(ctrl, 0.6);
      const rnd = U.rng(seed);
      for (let i = 0; i < path.length - 1; i++) {
        const t = i / (path.length - 1);
        const r = r0 + (r1 - r0) * t;
        const [ax, ay, af] = path[i], [bx2, by] = path[i + 1];
        const L = af ? front : back;
        L.capsule(ax, ay, bx2, by, r, r, af ? ['#100', '#200', '#310', '#421', '#532', '#753', '#964'] : ['#100', '#100', '#200', '#310', '#421'], {});
      }
      // thorns
      let acc = 0, side = 1;
      for (let i = 1; i < path.length - 1; i++) {
        acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        if (acc < 4.5 + rnd() * 3) continue;
        acc = 0; side = -side;
        const [px, py, pf] = path[i];
        const dx = path[i + 1][0] - path[i - 1][0], dy = path[i + 1][1] - path[i - 1][1];
        const l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l * side, ny = dx / l * side;
        const t = i / (path.length - 1), r = r0 + (r1 - r0) * t;
        (pf ? thornsF : thornsB).push([px + nx * r, py + ny * r, px + nx * (r + 2.4) + dx / l * 1.2, py + ny * (r + 2.4) + dy / l * 1.2]);
      }
      return path;
    };
    drawVine(vineA, 1.9, 0.9, 11);
    drawVine(vineB, 1.9, 1.1, 23);
    drawVine(vineC, 1.3, 1.0, 37);
    for (const [ax, ay, bx2, by] of thornsB) back.line(ax, ay, bx2, by, '#321');
    for (const [ax, ay, bx2, by] of thornsF) { front.line(ax, ay, bx2, by, '#753'); front.set(bx2, by, '#a86'); }
    // ivy leaves (front layer): small pointed hearts, lit from the upper left
    const leaf = (lx, ly, dir) => {
      const cx = Math.cos(dir), sy = Math.sin(dir);
      front.ball(lx, ly, 2.6, 1.3, ['#011', '#021', '#132', '#243', '#364', '#486'], { rot: dir });
      front.set(lx + cx * 3.2, ly + sy * 3.2, '#243');
      front.set(lx - cx * 2.6, ly - sy * 2.6, '#310');
    };
    leaf(d1 + 21, 2, -0.3); leaf(bx(2) + 4, 2.5, 0.4); leaf(bx(4) + 5, 1.5, -0.6); leaf(d2 - 12, 3, 3.4);
    leaf(bx(2) + 6, 53, 0.3); leaf(bx(4) + 13, 53, -0.2); leaf(bx(6) + 13, 53, 3.0);

    const mFront = new Mask(W, H), mBack = new Mask(W, H);
    for (let k = 0; k < W * H; k++) { if (front.data[k]) mFront.a[k] = 1; if (back.data[k]) mBack.a[k] = 1; }

    // --- extrusion: chunky bronze depth toward the lower right ---
    const EXT = 3;
    const ext = new Mask(W, H);
    const extD = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      if (letters.get(xx, y)) continue;
      for (let d = 1; d <= EXT; d++) if (letters.get(xx - d, y - d) || (d < EXT && letters.get(xx - d, y - d - 1))) { ext.set(xx, y); extD[y * W + xx] = d; break; }
    }
    const solid = new Mask(W, H);
    for (let k = 0; k < W * H; k++) solid.a[k] = letters.a[k] | ext.a[k];
    const ring1 = solid.grow(true);             // outline (dark bronze)
    const ring2 = ring1.grow(false);            // outer outline (black)
    // back vines with their own dark outline
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      if (mBack.edge(xx, y, true)) S.set(xx, y, '#000');
      const v = back.data[y * W + xx]; if (v) S.data[y * W + xx] = v;
    }
    // letter outlines
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      if (solid.get(xx, y)) continue;
      if (ring1.get(xx, y)) S.set(xx, y, '#100');
      else if (ring2.get(xx, y) && !mBack.get(xx, y)) S.set(xx, y, '#000');
    }
    // extrusion
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      const k = y * W + xx;
      if (!ext.a[k]) continue;
      const d = extD[k];
      // underside faces (below a letter) slightly lighter than side faces
      const under = letters.get(xx - d, y - d) && !letters.get(xx - d + 1, y - d);
      S.set(xx, y, d === 1 ? (under ? '#530' : '#420') : d === 2 ? '#310' : '#200');
    }
    // letter fill + bevel
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      const k = y * W + xx;
      if (!letters.a[k]) continue;
      const b = boxes[owner[k]];
      const f = U.clamp((y - b.top) / b.h, 0, 1);
      let c = goldAt(f, xx, y);
      const up = letters.get(xx, y - 1), lf = letters.get(xx - 1, y);
      const dn = letters.get(xx, y + 1), rt = letters.get(xx + 1, y);
      if (!up) c = f < 0.52 ? '#ffe' : '#fe6';
      else if (!lf) c = f < 0.52 ? '#ffb' : '#eb3';
      else if (!dn || !rt) c = f < 0.52 ? '#a70' : '#640';
      S.set(xx, y, c);
    }
    // front vines: dark outline then wood
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      if (mFront.edge(xx, y, false) && !mFront.get(xx, y)) S.set(xx, y, '#100');
    }
    for (let k = 0; k < W * H; k++) if (front.data[k]) S.data[k] = front.data[k];
    // blood-red berries on the brambles
    const berry = (x0, y0) => {
      S.set(x0, y0, '#a12'); S.set(x0 + 1, y0, '#702'); S.set(x0, y0 + 1, '#702'); S.set(x0 + 1, y0 + 1, '#401');
      S.set(x0, y0 - 1, '#100'); S.set(x0 + 1, y0 - 1, '#100'); S.set(x0 - 1, y0, '#100'); S.set(x0 - 1, y0 + 1, '#100');
      S.set(x0 + 2, y0, '#100'); S.set(x0 + 2, y0 + 1, '#100'); S.set(x0, y0 + 2, '#100'); S.set(x0 + 1, y0 + 2, '#100');
      S.set(x0, y0, '#f65');
    };
    berry(d1 + 15, 1); berry(bx(3) + 17, 0); berry(d2 - 15, 2); berry(bx(5) + 11, 52);
    // a four-point glint on the top-left bevel of the K
    const gx = bx(3), gy = bt(3);
    for (let i = 1; i <= 4; i++) {
      const c = i === 1 ? '#fff' : i === 2 ? '#ffe' : i === 3 ? '#fe6' : '#c92';
      S.set(gx - i, gy, c); S.set(gx + i, gy, c); S.set(gx, gy - i, c); S.set(gx, gy + i, c);
    }
    S.set(gx, gy, '#fff');
  }

  A.icons['logo'] = { w: LOGO_W, h: LOGO_H, draw: paintLogo };
})();
