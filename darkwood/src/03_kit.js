// ================================================================
// SPRITE KIT — procedural pixel art.
// Sprites are painted with shaded primitives (balls, capsules,
// polygons) into a pixel buffer. Each primitive is lit from the
// upper-left and shaded through a palette ramp with ordered
// dithering, then an outline pass gives the crisp pixel-art edge.
//
//   const img = DW.kit.make(64, 64, S => {
//     S.ball(32, 30, 14, 12, 'green');           // shaded body
//     S.capsule(20, 34, 12, 50, 4, 3, 'green');  // a limb
//     S.px(28, 26, '#f65');                      // an eye
//     S.outline();                               // dark outline
//   });
// ================================================================
(() => {
  const P = DW.pal, U = DW.util;
  const K = DW.kit = {};

  const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  K.LIGHT = norm3([-0.55, -0.7, 0.55]);   // from upper-left, toward the viewer
  const toInt = c => (typeof c === 'number' ? c : P.toInt(c));

  class Sprite {
    constructor(w, h) {
      this.w = w | 0; this.h = h | 0;
      this.data = new Uint32Array(this.w * this.h);
      this.light = K.LIGHT;
      this.ambient = 0.12;
    }

    // ---------- raw pixels ----------
    set(x, y, c) {
      x = Math.floor(x); y = Math.floor(y);
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      this.data[y * this.w + x] = c ? toInt(c) : 0;
    }
    px(x, y, c) { this.set(x, y, c); }
    get(x, y) {
      x = Math.floor(x); y = Math.floor(y);
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
      return this.data[y * this.w + x];
    }
    getHex(x, y) { const v = this.get(x, y); return v ? P.fromInt(v) : null; }
    opaque(x, y) { return this.get(x, y) !== 0; }
    erase(x, y) { this.set(x, y, 0); }
    clear() { this.data.fill(0); }

    rect(x, y, w, h, c) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
    }

    line(x0, y0, x1, y1, c) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        this.set(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }

    // Flat filled ellipse (no shading).
    ellipse(cx, cy, rx, ry, c) {
      for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
        for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
          const ex = (x + 0.5 - cx) / rx, ey = (y + 0.5 - cy) / ry;
          if (ex * ex + ey * ey <= 1) this.set(x, y, c);
        }
      }
    }

    // ---------- lighting ----------
    // Intensity 0..1 for a surface normal.
    lit(n, o = {}) {
      const L = o.light || this.light;
      let d = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
      d = (d + 0.3) / 1.3;                       // wrap lighting: softer terminator
      if (d < 0) d = 0;
      const amb = o.ambient !== undefined ? o.ambient : this.ambient;
      let I = amb + (1 - amb) * d;
      if (o.spec) {
        const H = norm3([L[0], L[1], L[2] + 1]);
        const s = Math.max(0, n[0] * H[0] + n[1] * H[1] + n[2] * H[2]);
        I += Math.pow(s, 24) * o.spec;
      }
      if (o.rim) {                                // back-light from the right
        const edge = 1 - Math.max(0, n[2]);
        I += Math.max(0, n[0] * 0.8 - n[1] * 0.2) * edge * edge * o.rim;
      }
      return I;
    }

    // Write a shaded pixel. I is 0..1; o.lo/o.hi restrict the ramp range.
    shadePx(x, y, ramp, I, o = {}) {
      ramp = P.ramp(ramp);
      const lo = o.lo !== undefined ? o.lo : 0;
      const hi = o.hi !== undefined ? o.hi : ramp.length - 1;
      let v = lo + U.clamp(I, 0, 1.2) * (hi - lo);
      if (o.dither === false) v = Math.round(v);
      this.set(x, y, P.rampColor(ramp, v, x, y));
    }

    // ---------- shaded primitives ----------
    // Shaded ellipsoid. o: { rot (radians), depth (normal z scale), spec, rim,
    //   lo, hi, light, ambient, clip(x,y)->bool, tone (fixed 0..1 instead of lighting) }
    ball(cx, cy, rx, ry, ramp, o = {}) {
      ramp = P.ramp(ramp);
      const rot = o.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
      const R = Math.max(rx, ry) + 1;
      const depth = o.depth !== undefined ? o.depth : 1;
      for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          const ex = (dx * cr + dy * sr) / rx, ey = (-dx * sr + dy * cr) / ry;
          const d2 = ex * ex + ey * ey;
          if (d2 > 1) continue;
          if (o.clip && !o.clip(x, y)) continue;
          let I;
          if (o.tone !== undefined) I = o.tone;
          else {
            const nx = ex * cr - ey * sr, ny = ex * sr + ey * cr;
            I = this.lit(norm3([nx, ny, Math.sqrt(1 - d2) * depth]), o);
          }
          this.shadePx(x, y, ramp, I, o);
        }
      }
    }

    // Tapered, shaded cylinder from (x1,y1) radius r1 to (x2,y2) radius r2 — limbs, necks, tails.
    capsule(x1, y1, x2, y2, r1, r2, ramp, o = {}) {
      ramp = P.ramp(ramp);
      const vx = x2 - x1, vy = y2 - y1;
      const len2 = vx * vx + vy * vy || 1e-6;
      const R = Math.max(r1, r2) + 1;
      const depth = o.depth !== undefined ? o.depth : 1;
      const minX = Math.floor(Math.min(x1, x2) - R), maxX = Math.ceil(Math.max(x1, x2) + R);
      const minY = Math.floor(Math.min(y1, y2) - R), maxY = Math.ceil(Math.max(y1, y2) + R);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          let t = ((px - x1) * vx + (py - y1) * vy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = x1 + vx * t, qy = y1 + vy * t;
          const r = r1 + (r2 - r1) * t;
          const ddx = px - qx, ddy = py - qy;
          const d = Math.hypot(ddx, ddy);
          if (d > r) continue;
          if (o.clip && !o.clip(x, y)) continue;
          let I;
          if (o.tone !== undefined) I = o.tone;
          else {
            const k = d / (r || 1);
            const nx = d ? ddx / d * k : 0, ny = d ? ddy / d * k : 0;
            I = this.lit(norm3([nx, ny, Math.sqrt(Math.max(0, 1 - k * k)) * depth]), o);
          }
          this.shadePx(x, y, ramp, I, o);
        }
      }
    }

    // Filled polygon [[x,y],...]. Shading options:
    //   o.tone: fixed 0..1          o.n: [nx,ny,nz] facet normal (lit)
    //   o.grad: [x0,y0,x1,y1,t0,t1] linear tone gradient
    // default: facet lit as facing the viewer.
    poly(pts, ramp, o = {}) {
      ramp = P.ramp(ramp);
      let minY = Infinity, maxY = -Infinity;
      for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      const facetI = o.tone !== undefined ? o.tone : this.lit(norm3(o.n || [0, 0, 1]), o);
      for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        const sy = y + 0.5;
        const xs = [];
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i], [xj, yj] = pts[j];
          if ((yi > sy) !== (yj > sy)) xs.push(xi + (sy - yi) / (yj - yi) * (xj - xi));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) {
            if (o.clip && !o.clip(x, y)) continue;
            let I = facetI;
            if (o.grad) {
              const [gx0, gy0, gx1, gy1, t0, t1] = o.grad;
              const gvx = gx1 - gx0, gvy = gy1 - gy0;
              let t = ((x + 0.5 - gx0) * gvx + (sy - gy0) * gvy) / (gvx * gvx + gvy * gvy || 1);
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              I = t0 + (t1 - t0) * t;
            }
            this.shadePx(x, y, ramp, I, o);
          }
        }
      }
    }

    tri(a, b, c, ramp, o) { this.poly([a, b, c], ramp, o); }

    // A curved horn/claw/tusk: tapered capsule chain along a quadratic bezier.
    horn(x0, y0, cx, cy, x1, y1, r0, r1, ramp, o = {}) {
      const steps = Math.max(4, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
      let px = x0, py = y0;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, it = 1 - t;
        const qx = it * it * x0 + 2 * it * t * cx + t * t * x1;
        const qy = it * it * y0 + 2 * it * t * cy + t * t * y1;
        const ra = r0 + (r1 - r0) * ((i - 1) / steps), rb = r0 + (r1 - r0) * t;
        this.capsule(px, py, qx, qy, ra, rb, ramp, o);
        px = qx; py = qy;
      }
    }

    // ---------- detail & finishing ----------
    // Bright core with a dithered halo (eyes, gems, magic).
    glow(x, y, c, r = 2) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const d = Math.hypot(i, j) / (r + 0.5);
        if (d >= 1) continue;
        if (1 - d > P.thresh(x + i, y + j) * 1.2) this.set(x + i, y + j, c);
      }
      this.set(x, y, '#fff');
    }

    // Sprinkle texture over already-painted pixels (fur, grime, stone).
    // fn(hex) -> new hex. density 0..1. Only touches opaque pixels inside the rect.
    speckle(x, y, w, h, density, fn, seed = 1) {
      const r = U.rng(seed);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        if (r() >= density) continue;
        const hex = this.getHex(x + i, y + j);
        if (hex) this.set(x + i, y + j, fn(hex));
      }
    }

    // Paint `c` over every opaque pixel that satisfies test(x, y) — masks & band shading.
    recolor(test, c) {
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (this.data[y * this.w + x] && test(x, y)) this.set(x, y, typeof c === 'function' ? c(this.getHex(x, y), x, y) : c);
      }
    }

    // Copy another Sprite onto this one at (dx, dy). flipX mirrors it.
    stamp(src, dx, dy, flipX = false) {
      for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
        const v = src.data[y * src.w + (flipX ? src.w - 1 - x : x)];
        if (v) this.set(dx + x, dy + y, v);
      }
    }

    // 1px outline around the silhouette.
    //   outline()                  dark ink outline
    //   outline('#301')            custom colour
    //   outline(null, {selective}) outline in a darkened version of the neighbour's colour
    //   o.diag: include diagonals (thicker, rounder)
    outline(c = '#101', o = {}) {
      const src = this.data.slice();
      const w = this.w, h = this.h;
      const ci = c ? toInt(c) : 0;
      const sel = o.selective || !c;
      const k = o.darken !== undefined ? o.darken : 0.3;
      const nb = o.diag
        ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
        : [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (src[y * w + x]) continue;
        for (const [ox, oy] of nb) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const v = src[ny * w + nx];
          if (!v) continue;
          this.data[y * w + x] = sel ? P.toInt(P.shade(P.fromInt(v), k)) : ci;
          break;
        }
      }
    }

    // Darken the interior edge on the shadow side (bottom-right) for extra form.
    innerShadow(c = null, amount = 0.6) {
      const src = this.data.slice();
      const w = this.w;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < w; x++) {
        const v = src[y * w + x];
        if (!v) continue;
        const r = x + 1 < w ? src[y * w + x + 1] : 0;
        const b = y + 1 < this.h ? src[(y + 1) * w + x] : 0;
        if (!r || !b) this.data[y * w + x] = c ? toInt(c) : P.toInt(P.shade(P.fromInt(v), amount));
      }
    }

    toCanvas() {
      const cv = document.createElement('canvas');
      cv.width = this.w; cv.height = this.h;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(this.w, this.h);
      img.data.set(new Uint8ClampedArray(this.data.buffer, this.data.byteOffset, this.data.byteLength));
      ctx.putImageData(img, 0, 0);
      return cv;
    }
  }

  K.Sprite = Sprite;
  K.create = (w, h) => new Sprite(w, h);
  K.make = (w, h, fn) => { const s = new Sprite(w, h); fn(s); return s.toCanvas(); };

  const cache = new Map();
  K.cached = (key, w, h, fn) => {
    let c = cache.get(key);
    if (!c) { c = K.make(w, h, fn); cache.set(key, c); }
    return c;
  };
  K.cacheClear = prefix => { for (const k of [...cache.keys()]) if (!prefix || k.startsWith(prefix)) cache.delete(k); };
  K.norm3 = norm3;
})();
