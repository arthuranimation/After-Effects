// ================================================================
// UI — immediate-mode widgets drawn straight onto the pixel canvas.
// Each frame a screen calls e.g. `if (UI.button('buy', x, y, w, h, 'BUY')) ...`
// and the widget both draws itself and reports a tap.
// ================================================================
(() => {
  const P = DW.pal, G = DW.gfx, F = DW.font, U = DW.util;
  const UI = DW.ui = {};

  // ---------------------------------------------------------------
  // Input state
  // ---------------------------------------------------------------
  const p = UI.pointer = { x: -999, y: -999, down: false, pressed: false, released: false, sx: 0, sy: 0, moved: 0, mouse: false };
  let flagDown = false, flagUp = false, upPos = null;
  UI.enabled = true;      // false while a modal covers the screen being drawn
  UI.active = null;       // id of the widget the current press started on
  UI.dragging = null;     // id of the scroll area being dragged
  const keysDown = new Set();
  let keysPressed = new Set(), keyQueue = new Set();
  let clipStack = [];

  function toLogical(e) {
    const r = G.canvas.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) * G.w / r.width), Math.floor((e.clientY - r.top) * G.h / r.height)];
  }

  UI.init = canvas => {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (canvas.setPointerCapture) try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      [p.x, p.y] = toLogical(e);
      p.sx = p.x; p.sy = p.y; p.moved = 0;
      p.mouse = e.pointerType === 'mouse';
      p.down = true; flagDown = true;
      UI.onFirstGesture && UI.onFirstGesture();
    });
    canvas.addEventListener('pointermove', e => {
      const [x, y] = toLogical(e);
      if (p.down) p.moved = Math.max(p.moved, Math.hypot(x - p.sx, y - p.sy));
      p.x = x; p.y = y;
      p.mouse = e.pointerType === 'mouse';
    });
    const up = e => {
      if (!p.down) return;
      [p.x, p.y] = toLogical(e);
      p.down = false; flagUp = true; upPos = [p.x, p.y];
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      keysDown.add(e.key); keyQueue.add(e.key);
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      UI.onFirstGesture && UI.onFirstGesture();
    });
    window.addEventListener('keyup', e => keysDown.delete(e.key));
  };

  UI.beginFrame = () => {
    p.pressed = flagDown; p.released = flagUp;
    if (flagUp && upPos) { p.x = upPos[0]; p.y = upPos[1]; }
    flagDown = flagUp = false;
    keysPressed = keyQueue; keyQueue = new Set();
    clipStack = [];
    UI.hot = null;
  };

  UI.endFrame = () => {
    if (p.released) { UI.active = null; UI.dragging = null; }
    if (!p.down && !p.mouse) { p.x = -999; p.y = -999; }
    UI.updateToasts();
  };

  UI.key = k => UI.enabled && keysPressed.has(k);
  UI.keyHeld = k => keysDown.has(k);
  UI.anyKey = () => UI.enabled && keysPressed.size > 0;

  const inRect = (x, y, w, h, px = p.x, py = p.y) => px >= x && py >= y && px < x + w && py < y + h;
  const inClip = (px = p.x, py = p.y) => {
    const c = clipStack[clipStack.length - 1];
    return !c || inRect(c[0], c[1], c[2], c[3], px, py);
  };
  UI.inside = (x, y, w, h) => inRect(x, y, w, h) && inClip();

  // A tap is a press and release in the same widget without dragging a scroll area.
  // Returns true on the frame the tap completes.
  UI.tap = (id, x, y, w, h) => {
    if (!UI.enabled) return false;
    if (p.pressed && inRect(x, y, w, h, p.sx, p.sy) && inClip(p.sx, p.sy)) UI.active = id;
    if (UI.active === id && p.down && UI.inside(x, y, w, h)) UI.hot = id;
    if (p.released && UI.active === id && !UI.dragging && p.moved < 10 && UI.inside(x, y, w, h)) {
      UI.active = null;
      return true;
    }
    return false;
  };
  UI.isPressed = id => UI.enabled && UI.active === id && p.down && !UI.dragging;

  // Swipe detection: returns 'L' | 'R' | 'U' | 'D' | null on release.
  UI.swipe = (x = 0, y = 0, w = G.w, h = G.h, minDist = 14) => {
    if (!UI.enabled || !p.released) return null;
    if (!inRect(x, y, w, h, p.sx, p.sy)) return null;
    const dx = p.x - p.sx, dy = p.y - p.sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < minDist) return null;
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'L' : 'R') : (dy < 0 ? 'U' : 'D');
  };

  UI.buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) { /* ignore */ } };
  const sfx = name => { if (DW.audio && DW.audio.sfx) DW.audio.sfx(name); };

  // ---------------------------------------------------------------
  // Themes
  // ---------------------------------------------------------------
  UI.THEMES = {
    stone:  { face: '#445', hi: '#99a', mid: '#667', lo: '#112', text: '#fd5', sub: '#bbc' },
    red:    { face: '#702', hi: '#f65', mid: '#a13', lo: '#200', text: '#ffb', sub: '#f98' },
    purple: { face: '#426', hi: '#b8e', mid: '#74a', lo: '#101', text: '#dbf', sub: '#b8e' },
    green:  { face: '#243', hi: '#9c7', mid: '#475', lo: '#010', text: '#ce9', sub: '#9c7' },
    blue:   { face: '#248', hi: '#8de', mid: '#37a', lo: '#002', text: '#eff', sub: '#8de' },
    gold:   { face: '#a70', hi: '#ffb', mid: '#eb3', lo: '#320', text: '#210', sub: '#530' },
    steel:  { face: '#345', hi: '#bcd', mid: '#689', lo: '#101', text: '#eef', sub: '#bcd' },
    dark:   { face: '#223', hi: '#556', mid: '#334', lo: '#000', text: '#ddc', sub: '#889' },
  };

  // Stone texture tile (shared by panels)
  const stoneTile = () => G.cache('ui|stonetile', 32, 32, ctx => {
    const r = U.rng(7);
    G.rect(0, 0, 32, 32, '#334', ctx);
    for (let i = 0; i < 90; i++) G.px(Math.floor(r() * 32), Math.floor(r() * 32), r() < 0.5 ? '#445' : '#223', ctx);
    // a few mortar cracks
    for (let i = 0; i < 4; i++) {
      let x = Math.floor(r() * 32), y = Math.floor(r() * 32);
      for (let k = 0; k < 5; k++) { G.px(x, y, '#223', ctx); x += r() < 0.5 ? 1 : 0; y += 1; }
    }
  });
  const darkTile = () => G.cache('ui|darktile', 4, 4, ctx => {
    G.rect(0, 0, 4, 4, '#112', ctx);
    G.px(0, 0, '#101', ctx); G.px(2, 2, '#101', ctx);
  });
  const woodTile = () => G.cache('ui|woodtile', 32, 16, ctx => {
    const r = U.rng(11);
    G.rect(0, 0, 32, 16, '#420', ctx);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
      const v = Math.sin(x * 0.35 + Math.sin(y * 0.9) * 2) + r() * 0.6;
      if (v > 1.0) G.px(x, y, '#531', ctx); else if (v < -0.9) G.px(x, y, '#310', ctx);
    }
    G.rect(0, 7, 32, 1, '#200', ctx); G.rect(0, 15, 32, 1, '#200', ctx);
  });

  function fillTile(x, y, w, h, tile) {
    const ctx = G.ctx;
    ctx.save();
    ctx.translate(x | 0, y | 0);
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, w | 0, h | 0);
    ctx.restore();
  }

  // ---------------------------------------------------------------
  // Panels
  // style: 'stone' (bevelled stone), 'dark' (inset text well), 'gold' (dialog),
  //        'wood' (shop sign), 'parch' (parchment note)
  // ---------------------------------------------------------------
  UI.panel = (x, y, w, h, style = 'stone') => {
    x |= 0; y |= 0; w |= 0; h |= 0;
    if (style === 'dark') {
      G.rect(x, y, w, h, '#000');
      fillTile(x + 1, y + 1, w - 2, h - 2, darkTile());
      G.hline(x + 1, x + w - 2, y + h - 1, '#334');
      G.vline(x + w - 1, y + 1, y + h - 1, '#334');
      return;
    }
    if (style === 'parch') {
      G.rect(x, y, w, h, '#000');
      G.rect(x + 1, y + 1, w - 2, h - 2, '#cb9');
      G.dither(x + 1, y + 1, w - 2, h - 2, null, '#ba8', 3);
      G.frame(x + 1, y + 1, w - 2, h - 2, '#986');
      return;
    }
    const T = style === 'gold'
      ? { o1: '#fe6', o2: '#c92', d1: '#530', d2: '#750', tile: null, face: '#223' }
      : style === 'wood'
        ? { o1: '#b85', o2: '#742', d1: '#200', d2: '#310', tile: woodTile(), face: null }
        : { o1: '#99a', o2: '#667', d1: '#101', d2: '#223', tile: stoneTile(), face: null };
    G.rect(x, y, w, h, '#000');
    // outer bevel
    G.hline(x + 1, x + w - 2, y + 1, T.o1); G.vline(x + 1, y + 1, y + h - 2, T.o1);
    G.hline(x + 1, x + w - 2, y + h - 2, T.d1); G.vline(x + w - 2, y + 1, y + h - 2, T.d1);
    // inner bevel
    G.hline(x + 2, x + w - 3, y + 2, T.o2); G.vline(x + 2, y + 2, y + h - 3, T.o2);
    G.hline(x + 2, x + w - 3, y + h - 3, T.d2); G.vline(x + w - 3, y + 2, y + h - 3, T.d2);
    if (T.tile) fillTile(x + 3, y + 3, w - 6, h - 6, T.tile);
    else {
      G.rect(x + 3, y + 3, w - 6, h - 6, T.face);
      G.dither(x + 3, y + 3, w - 6, Math.min(h - 6, 10), null, '#334', 4);
    }
    // corner rivets
    if (w > 24 && h > 20) {
      for (const [rx, ry] of [[x + 4, y + 4], [x + w - 6, y + 4], [x + 4, y + h - 6], [x + w - 6, y + h - 6]]) {
        G.rect(rx, ry, 2, 2, style === 'gold' ? '#fe6' : '#a70');
        G.px(rx + 1, ry + 1, style === 'gold' ? '#a70' : '#530');
        G.px(rx, ry, '#ffb');
      }
    }
  };

  // Panel with a title plate. Returns the content y (below the title).
  UI.dialog = (x, y, w, h, title, style = 'gold') => {
    UI.panel(x, y, w, h, style);
    if (title) {
      const tw = F.measure(title) + 16;
      const tx = x + Math.floor((w - tw) / 2);
      G.rect(tx, y - 4, tw, 13, '#000');
      G.rect(tx + 1, y - 3, tw - 2, 11, '#530');
      G.hline(tx + 1, tx + tw - 2, y - 3, '#c92');
      G.hline(tx + 1, tx + tw - 2, y + 7, '#320');
      F.draw(title, x + Math.floor(w / 2), y - 1, '#ffb', { align: 'center', shadow: '#210' });
    }
    return y + 12;
  };

  // Horizontal divider with a small gem in the middle.
  UI.divider = (x, y, w) => {
    G.hline(x, x + w - 1, y, '#000');
    G.hline(x, x + w - 1, y + 1, '#445');
    const cx = x + Math.floor(w / 2);
    G.rect(cx - 2, y - 1, 4, 4, '#000');
    G.rect(cx - 1, y, 2, 2, '#fd5');
  };

  // ---------------------------------------------------------------
  // Buttons
  // o: { theme, disabled, key, sub, icon (canvas), selected, align, sound (false|name), small }
  // ---------------------------------------------------------------
  UI.button = (id, x, y, w, h, label, o = {}) => {
    x |= 0; y |= 0; w |= 0; h |= 0;
    const T = UI.THEMES[o.disabled ? 'dark' : (o.theme || 'stone')];
    let clicked = false;
    if (!o.disabled) {
      clicked = UI.tap(id, x, y, w, h);
      if (!clicked && o.key && (Array.isArray(o.key) ? o.key.some(UI.key) : UI.key(o.key))) clicked = true;
    }
    const down = !o.disabled && (UI.isPressed(id) && UI.inside(x, y, w, h));
    const hover = !o.disabled && !down && p.mouse && UI.enabled && UI.inside(x, y, w, h);

    G.rect(x, y, w, h, '#000');
    if (down) {
      G.rect(x + 1, y + 1, w - 2, h - 2, T.lo);
      G.rect(x + 2, y + 2, w - 3, h - 3, T.face);
      G.dither(x + 2, y + 2, w - 3, h - 3, null, T.lo, 4);
    } else {
      G.rect(x + 1, y + 1, w - 2, h - 2, T.face);
      // glossy upper half
      G.dither(x + 2, y + 2, w - 4, Math.floor((h - 4) / 2), null, T.mid, hover ? 10 : 6);
      G.hline(x + 1, x + w - 2, y + 1, T.hi); G.vline(x + 1, y + 1, y + h - 2, T.hi);
      G.hline(x + 1, x + w - 2, y + h - 2, T.lo); G.vline(x + w - 2, y + 1, y + h - 2, T.lo);
    }
    if (o.selected) G.frame(x + 2, y + 2, w - 4, h - 4, '#fd5');

    const off = down ? 1 : 0;
    const textCol = o.disabled ? '#667' : T.text;
    const shadow = o.theme === 'gold' && !o.disabled ? '#fe6' : '#000';
    // content = [icon] + a column holding the label and (optionally) a sub-label
    let iconW = 0;
    if (o.icon) iconW = o.icon.width + (label || o.sub ? 4 : 0);
    const lw = label ? F.measure(label) : 0;
    const sw = o.sub ? Math.min(F.measure(o.sub), w - iconW - 10) : 0;
    const colW = Math.max(lw, sw);
    const contentH = 7 + (o.sub ? 10 : 0);
    let cx = o.align === 'left' ? x + 6 : x + Math.floor((w - iconW - colW) / 2);
    const cy = y + Math.floor((h - contentH) / 2) + off;
    if (o.icon) {
      const iy = y + Math.floor((h - o.icon.height) / 2) + off;
      G.blit(o.icon, cx + off, iy, o.disabled ? { fade: 8 } : undefined);
      cx += iconW;
    }
    const center = o.align !== 'left';
    if (label) F.draw(label, cx + off + (center ? Math.floor((colW - lw) / 2) : 0), cy, textCol, { shadow });
    if (o.sub) {
      F.draw(o.sub, cx + off + (center ? Math.floor((colW - sw) / 2) : 0), cy + 10, o.disabled ? '#556' : T.sub, { shadow: '#000' });
    }
    if (clicked && o.sound !== false) sfx(o.sound || 'tap');
    return clicked;
  };

  // Small square icon button (back arrows, close, page turns).
  UI.iconButton = (id, x, y, size, glyph, o = {}) => UI.button(id, x, y, size, size, glyph, o);

  // Tabs: returns the selected index.
  UI.tabs = (id, x, y, w, h, labels, sel, o = {}) => {
    const n = labels.length;
    const tw = Math.floor(w / n);
    let out = sel;
    labels.forEach((lab, i) => {
      const tx = x + i * tw, ww = i === n - 1 ? w - tw * (n - 1) : tw;
      const locked = o.locked && o.locked[i];
      if (UI.button(id + ':' + i, tx, y, ww, h, lab, { theme: i === sel ? 'gold' : 'stone', disabled: locked, sound: 'tap' })) out = i;
    });
    return out;
  };

  // ---------------------------------------------------------------
  // Bars — chunky tube-shaded gauges.
  // ramp: palette ramp name. o: { ghost (0..1), ticks (px), pulse (bool), label }
  // ---------------------------------------------------------------
  UI.bar = (x, y, w, h, frac, ramp, o = {}) => {
    x |= 0; y |= 0; w |= 0; h |= 0;
    frac = U.clamp(frac || 0, 0, 1);
    const R = P.ramp(ramp);
    G.rect(x, y, w, h, '#000');
    G.rect(x + 1, y + 1, w - 2, h - 2, '#101');
    G.dither(x + 1, y + 1, w - 2, h - 2, null, '#112', 8);
    const inner = w - 2;
    if (o.ghost !== undefined && o.ghost > frac) {
      const gw = Math.round(inner * U.clamp(o.ghost, 0, 1));
      G.rect(x + 1, y + 1, gw, h - 2, '#fff');
      G.dither(x + 1, y + 1, gw, h - 2, null, '#f98', 8);
    }
    const fw = Math.round(inner * frac);
    if (fw > 0) {
      const n = R.length;
      const top = R[n - 2] || R[n - 1], mid = R[Math.floor(n * 0.6)], low = R[Math.floor(n * 0.35)];
      G.rect(x + 1, y + 1, fw, h - 2, mid);
      G.rect(x + 1, y + 1, fw, 1, R[n - 1]);
      if (h > 4) G.rect(x + 1, y + 2, fw, 1, top);
      G.rect(x + 1, y + h - 2, fw, 1, low);
      if (h > 5) G.dither(x + 1, y + h - 3, fw, 1, null, low, 8);
      if (o.pulse) G.dither(x + 1, y + 1, fw, h - 2, null, '#fff', 3 + Math.round(Math.sin(performance.now() / 120) * 3 + 3));
    }
    if (o.ticks) for (let tx = x + o.ticks; tx < x + w - 1; tx += o.ticks) G.vline(tx, y + 1, y + h - 2, '#000');
    if (o.label) F.draw(o.label, x + Math.floor(w / 2), y + Math.floor((h - 7) / 2), '#fff', { align: 'center', outline: '#000' });
  };

  // ---------------------------------------------------------------
  // Scroll area — drag to scroll, with momentum and a thumb.
  // draw(offsetY) paints content in absolute coords; widgets inside are clipped.
  // ---------------------------------------------------------------
  const scrolls = new Map();
  UI.scrollState = id => {
    let s = scrolls.get(id);
    if (!s) { s = { off: 0, vel: 0, lastY: 0 }; scrolls.set(id, s); }
    return s;
  };
  UI.scrollReset = id => scrolls.delete(id);

  UI.scroll = (id, x, y, w, h, contentH, draw) => {
    const s = UI.scrollState(id);
    const maxOff = Math.max(0, contentH - h);
    if (UI.enabled) {
      if (p.pressed && inRect(x, y, w, h, p.sx, p.sy)) { s.grab = true; s.lastY = p.y; s.vel = 0; }
      if (s.grab && p.down) {
        if (p.moved >= 6 && maxOff > 0) UI.dragging = id;
        if (UI.dragging === id) {
          const dy = p.y - s.lastY;
          s.off -= dy; s.vel = -dy;
        }
        s.lastY = p.y;
      }
      if (!p.down) s.grab = false;
      if (UI.dragging !== id && !s.grab) {
        s.off += s.vel; s.vel *= 0.88;
        if (Math.abs(s.vel) < 0.1) s.vel = 0;
      }
      if (inRect(x, y, w, h) && UI.wheel) { s.off += UI.wheel; }
    }
    s.off = U.clamp(s.off, 0, maxOff);
    const off = Math.round(s.off);
    clipStack.push([x, y, w, h]);
    G.clip(x, y, w, h, () => draw(y - off));
    clipStack.pop();
    if (maxOff > 0) {
      const th = Math.max(10, Math.round(h * h / contentH));
      const ty = y + Math.round((h - th) * (off / maxOff));
      G.rect(x + w - 3, y, 3, h, '#101');
      G.rect(x + w - 3, ty, 3, th, '#889');
      G.px(x + w - 3, ty, '#ccd');
    }
    return off;
  };

  UI.wheel = 0;
  window.addEventListener('wheel', e => { UI.wheel += e.deltaY * 0.25; }, { passive: true });
  const _end = UI.endFrame;
  UI.endFrame = () => { _end(); UI.wheel = 0; };

  // ---------------------------------------------------------------
  // Toasts — short notices that float under the HUD and dither away.
  // ---------------------------------------------------------------
  const toasts = [];
  UI.toast = (text, col = P.c.text, ms = 2400) => {
    toasts.push({ text, col, born: performance.now(), ms });
    if (toasts.length > 4) toasts.shift();
  };
  UI.updateToasts = () => {
    const now = performance.now();
    for (let i = toasts.length - 1; i >= 0; i--) if (now - toasts[i].born > toasts[i].ms) toasts.splice(i, 1);
  };
  UI.drawToasts = (top = 30) => {
    const now = performance.now();
    toasts.forEach((t, i) => {
      const age = now - t.born;
      const lines = F.wrap(t.text, G.w - 40);
      const w = Math.min(G.w - 16, Math.max(...lines.map(l => F.measure(l))) + 14);
      const h = lines.length * 10 + 6;
      const x = Math.floor((G.w - w) / 2);
      const y = top + i * (h + 3) - Math.max(0, 6 - age / 25) | 0;
      G.rect(x, y, w, h, '#000');
      G.rect(x + 1, y + 1, w - 2, h - 2, '#112');
      G.hline(x + 1, x + w - 2, y + 1, '#445');
      lines.forEach((ln, k) => F.draw(ln, G.w >> 1, y + 4 + k * 10, t.col, { align: 'center', shadow: true }));
      const fade = Math.max(0, (age - (t.ms - 400)) / 400);
      if (fade > 0) G.dither(x, y, w, h, null, '#000', fade * 16);
    });
  };
})();
