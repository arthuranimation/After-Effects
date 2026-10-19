// ================================================================
// FX — particles, floating numbers, screen shake, flashes, hit-stop,
// spell effects and the dithered screen-wipe transition.
// All in logical pixels; everything is drawn with hard pixels.
// ================================================================
(() => {
  const G = DW.gfx, F = DW.font, P = DW.pal, U = DW.util;
  const FX = DW.fx = {};

  let parts = [], nums = [], effects = [];
  let shakeAmt = 0, shakeT = 0;
  let flashCol = null, flashT = 0, flashDur = 1;
  FX.hitstop = 0;      // seconds of frozen game time left
  FX.slowmo = 0;       // seconds of half-speed time left

  FX.clear = () => { parts = []; nums = []; effects = []; shakeAmt = 0; flashCol = null; FX.hitstop = 0; FX.slowmo = 0; };

  // ---------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------
  // o: { n, cols, speed, spread (radians), angle, life, grav, size, drag, up }
  FX.burst = (x, y, o = {}) => {
    const n = o.n || 12;
    for (let i = 0; i < n; i++) {
      const a = (o.angle !== undefined ? o.angle : -Math.PI / 2) + (Math.random() - 0.5) * (o.spread !== undefined ? o.spread : Math.PI * 2);
      const s = (o.speed || 60) * (0.4 + Math.random() * 0.8);
      parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: (o.life || 0.6) * (0.6 + Math.random() * 0.6), age: 0,
        col: U.pick(o.cols || ['#fff', '#fd5', '#fa2']),
        grav: o.grav !== undefined ? o.grav : 120, size: o.size || 1, drag: o.drag || 0.9,
        trail: o.trail || false,
      });
    }
  };

  FX.sparks = (x, y, n = 14) => FX.burst(x, y, { n, cols: ['#fff', '#ffb', '#fd5', '#fa2'], speed: 110, life: 0.45, grav: 200 });
  FX.blood = (x, y, n = 10) => FX.burst(x, y, { n, cols: ['#d33', '#a13', '#702'], speed: 70, life: 0.6, grav: 260, size: 1 });
  FX.embers = (x, y, n = 12) => FX.burst(x, y, { n, cols: ['#fd5', '#fa2', '#e70', '#c40'], speed: 50, life: 1.1, grav: -40, drag: 0.95 });
  FX.frost = (x, y, n = 14) => FX.burst(x, y, { n, cols: ['#eff', '#bef', '#8de', '#5ac'], speed: 60, life: 0.9, grav: 40 });
  FX.heal = (x, y, n = 16) => FX.burst(x, y, { n, cols: ['#ce9', '#9c7', '#ffe'], speed: 30, life: 1.0, grav: -50, spread: Math.PI * 0.8 });
  FX.magic = (x, y, n = 16, cols = ['#dbf', '#b8e', '#96c']) => FX.burst(x, y, { n, cols, speed: 45, life: 0.9, grav: -30 });
  FX.dust = (x, y, n = 10) => FX.burst(x, y, { n, cols: ['#986', '#764', '#543'], speed: 40, life: 0.7, grav: 30, angle: -Math.PI / 2, spread: Math.PI });

  // ---------------------------------------------------------------
  // Floating numbers / words
  // ---------------------------------------------------------------
  FX.number = (x, y, text, col = '#fff', o = {}) => {
    nums.push({ x, y, text: String(text), col, age: 0, life: o.life || 1.0, big: !!o.big, vx: (Math.random() - 0.5) * 16 });
  };

  // ---------------------------------------------------------------
  // Screen effects
  // ---------------------------------------------------------------
  FX.shake = (amt = 3, dur = 0.25) => { shakeAmt = Math.max(shakeAmt, amt); shakeT = Math.max(shakeT, dur); };
  FX.flash = (col = '#fff', dur = 0.15) => { flashCol = col; flashT = dur; flashDur = dur; };
  FX.stop = sec => { FX.hitstop = Math.max(FX.hitstop, sec); };
  FX.slow = sec => { FX.slowmo = Math.max(FX.slowmo, sec); };

  FX.offset = () => {
    if (shakeT <= 0) return [0, 0];
    const a = shakeAmt * Math.min(1, shakeT * 6);
    return [Math.round((Math.random() * 2 - 1) * a), Math.round((Math.random() * 2 - 1) * a)];
  };

  // ---------------------------------------------------------------
  // Timed effects: each { age, life, draw(f, e) } with f = 0..1
  // ---------------------------------------------------------------
  FX.add = (life, draw, data = {}) => { const e = Object.assign({ age: 0, life, draw }, data); effects.push(e); return e; };

  // A sweeping slash arc across a point.
  FX.slash = (cx, cy, dir = 1, col = '#fff', size = 26) => {
    FX.add(0.22, f => {
      const r = size;
      const a0 = dir > 0 ? -2.4 : -0.7, a1 = dir > 0 ? 0.5 : -3.6;
      const head = U.lerp(a0, a1, Math.min(1, f * 1.6));
      const tail = U.lerp(a0, a1, Math.max(0, f * 1.6 - 0.5));
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const a = U.lerp(tail, head, i / steps);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.6;
        const w = i > steps - 3 ? 2 : 1;
        G.rect(x, y, w + 1, w, i > steps - 4 ? col : '#bcd');
      }
    });
  };

  // Expanding pixel ring (parries, level-ups).
  FX.ring = (cx, cy, col = '#fd5', maxR = 30, life = 0.35) => {
    FX.add(life, f => {
      const r = Math.round(maxR * U.ease.out(f));
      const n = Math.max(12, r * 4);
      for (let i = 0; i < n; i++) {
        if (f > 0.6 && (i % 2)) continue;
        const a = i / n * Math.PI * 2;
        G.px(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, col);
      }
    });
  };

  // A star-burst glint (the parry cue and parry success).
  FX.glint = (cx, cy, size = 6, col = '#fff', life = 0.3) => {
    FX.add(life, f => {
      const s = Math.round(size * (f < 0.3 ? f / 0.3 : 1 - (f - 0.3) / 0.7));
      if (s <= 0) return;
      G.hline(cx - s, cx + s, cy, col); G.vline(cx, cy - s, cy + s, col);
      const d = Math.floor(s / 2);
      for (let i = 1; i <= d; i++) { G.px(cx - i, cy - i, '#ffb'); G.px(cx + i, cy - i, '#ffb'); G.px(cx - i, cy + i, '#ffb'); G.px(cx + i, cy + i, '#ffb'); }
      G.rect(cx - 1, cy - 1, 3, 3, '#fff');
    });
  };

  // A projectile from (x0,y0) to (x1,y1). kind: fire | ice | lightning | arcane
  FX.bolt = (x0, y0, x1, y1, kind, onHit, dur = 0.32) => {
    const trailCols = { fire: ['#fd5', '#fa2', '#e70', '#c40'], ice: ['#eff', '#bef', '#8de'], arcane: ['#dbf', '#b8e', '#96c'], lightning: ['#fff', '#eff', '#8de'] }[kind] || ['#fff'];
    if (kind === 'lightning') {
      FX.add(0.25, f => {
        let px = x0, py = y0;
        const segs = 9;
        for (let i = 1; i <= segs; i++) {
          const t = i / segs;
          const nx = U.lerp(x0, x1, t) + (i < segs ? (Math.random() - 0.5) * 18 : 0);
          const ny = U.lerp(y0, y1, t) + (i < segs ? (Math.random() - 0.5) * 6 : 0);
          G.line(px, py, nx, ny, f < 0.5 ? '#fff' : '#8de');
          G.line(px + 1, py, nx + 1, ny, '#5ac');
          px = nx; py = ny;
        }
      });
      if (onHit) FX.add(0.06, () => {}).onEnd = onHit;
      return;
    }
    const e = FX.add(dur, f => {
      const t = U.ease.in(f);
      const x = U.lerp(x0, x1, t), y = U.lerp(y0, y1, t) - Math.sin(f * Math.PI) * 18;
      const r = kind === 'fire' ? 4 : 3;
      G.circle(x, y, r + 1, trailCols[trailCols.length - 1]);
      G.circle(x, y, r, trailCols[1]);
      G.circle(x - 1, y - 1, r - 2, trailCols[0]);
      if (Math.random() < 0.8) parts.push({ x, y, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: 0.4, age: 0, col: U.pick(trailCols), grav: -20, size: 1, drag: 0.9 });
    });
    e.onEnd = onHit;
  };

  // Falling ice shards over a point.
  FX.icefall = (cx, cy, w = 40) => {
    for (let i = 0; i < 9; i++) {
      const sx = cx - w / 2 + Math.random() * w, delay = i * 0.04;
      FX.add(0.35 + delay, f => {
        const ff = U.clamp((f * (0.35 + delay) - delay) / 0.35, 0, 1);
        if (ff <= 0) return;
        const y = U.lerp(cy - 70, cy + (Math.random() * 6 - 3), ff);
        G.vline(sx, y - 5, y, '#bef'); G.px(sx, y + 1, '#fff'); G.px(sx - 1, y - 3, '#5ac');
        if (ff >= 1 && Math.random() < 0.3) FX.frost(sx, cy, 2);
      });
    }
  };

  // Rising light pillars (level up / heal).
  FX.pillar = (cx, bottom, col = '#fd5', h = 60, life = 0.8) => {
    FX.add(life, f => {
      const a = f < 0.2 ? f / 0.2 : 1 - (f - 0.2) / 0.8;
      const w = Math.round(10 * a);
      if (w <= 0) return;
      G.dither(cx - w, bottom - h, w * 2, h, null, col, Math.round(a * 8));
      G.dither(cx - Math.floor(w / 2), bottom - h, w, h, null, '#fff', Math.round(a * 6));
    });
  };

  // ---------------------------------------------------------------
  // Update & draw
  // ---------------------------------------------------------------
  FX.update = dt => {
    if (shakeT > 0) shakeT -= dt; else shakeAmt = 0;
    if (flashT > 0) flashT -= dt;
    if (FX.slowmo > 0) FX.slowmo -= dt;
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.age += dt;
      if (q.age >= q.life) { parts.splice(i, 1); continue; }
      q.vy += q.grav * dt;
      const d = Math.pow(q.drag, dt * 60);
      q.vx *= d; q.vy *= d;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
    for (let i = nums.length - 1; i >= 0; i--) {
      const n = nums[i];
      n.age += dt;
      if (n.age >= n.life) nums.splice(i, 1);
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.age += dt;
      if (e.age >= e.life) { effects.splice(i, 1); if (e.onEnd) e.onEnd(); }
    }
  };

  FX.draw = () => {
    for (const e of effects) e.draw(Math.min(1, e.age / e.life), e);
    for (const q of parts) {
      const fade = q.age / q.life;
      if (fade > 0.7 && ((q.x | 0) + (q.y | 0)) & 1) continue;   // dithered fade-out
      G.rect(q.x, q.y, q.size, q.size, q.col);
    }
    for (const n of nums) {
      const f = n.age / n.life;
      const rise = U.ease.out(Math.min(1, f * 2)) * 18;
      const pop = f < 0.12 ? -Math.round((0.12 - f) * 30) : 0;
      const x = Math.round(n.x + n.vx * f), y = Math.round(n.y - rise + pop);
      if (f > 0.8 && (Math.floor(n.age * 30) & 1)) continue;
      if (n.big) F.big(n.text, x, y - 6, { scale: 2, ramp: n.col === '#f65' ? 'blood' : n.col === '#9d7' ? 'green' : 'gold', align: 'center' });
      else F.draw(n.text, x, y, n.col, { align: 'center', outline: '#000' });
    }
  };

  FX.drawFlash = () => {
    if (flashT > 0 && flashCol) {
      const lvl = Math.round(16 * (flashT / flashDur) * 0.7);
      G.dither(0, 0, G.w, G.h, null, flashCol, lvl);
    }
  };

  // ---------------------------------------------------------------
  // Screen wipe: dithered fade to black, swap, fade back in.
  // ---------------------------------------------------------------
  let wipe = null;
  FX.wipe = (swap, dur = 0.16) => {
    if (wipe) { swap(); return; }
    wipe = { t: 0, dur, swap, swapped: false };
  };
  FX.wiping = () => !!wipe;
  FX.updateWipe = dt => {
    if (!wipe) return;
    wipe.t += dt;
    if (!wipe.swapped && wipe.t >= wipe.dur) { wipe.swapped = true; wipe.swap(); }
    if (wipe.t >= wipe.dur * 2) wipe = null;
  };
  FX.drawWipe = () => {
    if (!wipe) return;
    const f = wipe.t < wipe.dur ? wipe.t / wipe.dur : 1 - (wipe.t - wipe.dur) / wipe.dur;
    G.dither(0, 0, G.w, G.h, null, '#000', Math.round(U.clamp(f, 0, 1) * 16));
  };
})();
