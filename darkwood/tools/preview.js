// Preview helpers for tools/shot.mjs — contact sheets of art for visual review.
// Not part of the game build.
(() => {
  const G = DW.gfx, F = DW.font, A = DW.art, P = DW.pal;
  const V = DW.preview = {};

  V.fit = (w, h) => {
    const c = G.canvas;
    c.width = w; c.height = h;
    G.ctx = c.getContext('2d'); G.ctx.imageSmoothingEnabled = false;
    G.w = w; G.h = h;
    G.clear('#000');
  };

  const label = (t, x, y, col = '#889') => F.draw(t, x, y, col, { shadow: true });

  // Arena-ish backdrop so sprites are judged against the real setting.
  function backdrop(x, y, w, h) {
    G.copper(x, y, w, Math.floor(h * 0.55), ['#102', '#213', '#324', '#432'], undefined, 3);
    G.copper(x, y + Math.floor(h * 0.55), w, h - Math.floor(h * 0.55), ['#543', '#432', '#321', '#210'], undefined, 3);
  }

  function shadow(cx, y, rw) {
    G.dither(cx - rw, y - 2, rw * 2, 4, null, '#000', 9);
  }

  // Every pose of one enemy on an arena backdrop, plus its portrait.
  V.enemy = (name, opts = {}) => {
    const def = A.enemyDef(name) || { w: 64, h: 64, anchor: [32, 63] };
    const cw = def.w + 10, ch = def.h + 16;
    const rows = [
      [['idle f0', { f: 0 }], ['idle f1', { f: 1 }], ['idle f2', { f: 2 }], ['idle f3', { f: 3 }]],
      [['wind L .5', { dir: -1, wind: 0.5 }], ['wind L 1', { dir: -1, wind: 1 }], ['wind H .5', { dir: 0, wind: 0.5 }],
       ['wind H 1', { dir: 0, wind: 1 }], ['wind R .5', { dir: 1, wind: 0.5 }], ['wind R 1', { dir: 1, wind: 1 }]],
      [['strike L', { dir: -1, strike: 1 }], ['strike H', { dir: 0, strike: 1 }], ['strike R', { dir: 1, strike: 1 }], ['hurt', { hurt: 1 }]],
    ];
    const cols = 6;
    V.fit(cols * cw + 40, rows.length * ch + 22);
    F.draw(name + '  ' + def.w + 'x' + def.h, 4, 4, '#fd5', { shadow: true });
    rows.forEach((row, r) => row.forEach(([lab, pose], c) => {
      const x = c * cw, y = 16 + r * ch;
      backdrop(x, y, cw - 2, ch - 2);
      const img = A.enemyFrame(name, pose);
      const ax = def.anchor ? def.anchor[0] : img.width / 2, ay = def.anchor ? def.anchor[1] : img.height - 1;
      shadow(x + 5 + ax, y + 4 + ay, Math.floor(def.w / 3));
      G.blit(img, x + 5, y + 4);
      if (def.center && opts.marks) G.px(x + 5 + def.center[0], y + 4 + def.center[1], '#0f0');
      if (def.mouth && opts.marks) G.px(x + 5 + def.mouth[0], y + 4 + def.mouth[1], '#f0f');
      label(lab, x + 2, y + ch - 12);
    }));
    // portrait
    const px = 4 * cw + 8, py = 16 + 2 * ch + 4;
    G.rect(px - 1, py - 1, 26, 26, '#445');
    G.blit(A.enemyPortrait(name), px, py);
    label('portrait', px, py + 28);
    return `${name}: frames ok`;
  };

  // Idle frames of several enemies side by side at true scale (consistency check).
  V.lineup = (names, h = 150) => {
    const defs = names.map(n => A.enemyDef(n) || { w: 64, h: 64 });
    const total = defs.reduce((s, d) => s + d.w + 8, 8);
    V.fit(total, h + 14);
    backdrop(0, 0, total, h);
    let x = 8;
    names.forEach((n, i) => {
      const d = defs[i];
      const img = A.enemyFrame(n, { f: 0 });
      const ay = d.anchor ? d.anchor[1] : img.height - 1;
      const by = h - 12;
      shadow(x + (d.anchor ? d.anchor[0] : d.w / 2), by, Math.floor(d.w / 3));
      G.blit(img, x, by - ay);
      label(n, x, h + 3, '#bbc');
      x += d.w + 8;
    });
  };

  // Hero: every pose with one gear set.
  V.hero = (gear = { weapon: 'longsword', armor: 'chain' }) => {
    const def = A.hero || { w: 80, h: 72 };
    const cw = def.w + 8, ch = def.h + 16;
    const poses = [
      ['idle 0', { act: 'idle', f: 0 }], ['idle 1', { act: 'idle', f: 1 }], ['idle 2', { act: 'idle', f: 2 }], ['idle 3', { act: 'idle', f: 3 }],
      ['atk 0', { act: 'attack', t: 0 }], ['atk 1', { act: 'attack', t: 1 }], ['atk 2', { act: 'attack', t: 2 }],
      ['block L', { act: 'block', dir: -1 }], ['block H', { act: 'block', dir: 0 }], ['block R', { act: 'block', dir: 1 }],
      ['hurt', { act: 'hurt' }], ['cast', { act: 'cast' }], ['victory', { act: 'victory' }],
    ];
    const cols = 5;
    V.fit(cols * cw, Math.ceil(poses.length / cols) * ch + 16);
    F.draw('hero  ' + gear.weapon + ' / ' + gear.armor, 4, 4, '#fd5', { shadow: true });
    poses.forEach(([lab, pose], i) => {
      const x = (i % cols) * cw, y = 16 + Math.floor(i / cols) * ch;
      backdrop(x, y, cw - 2, ch - 2);
      G.blit(A.heroFrame(pose, gear), x + 4, y + 2);
      label(lab, x + 2, y + ch - 12);
    });
  };

  // Hero idle across all weapon × armour looks.
  V.heroGear = () => {
    const weapons = ['dagger', 'shortsword', 'mace', 'longsword', 'axe', 'flail', 'greatsword', 'hammer', 'magicsword', 'holysword'];
    const armors = ['none', 'leather', 'chain', 'plate', 'fullplate'];
    const def = A.hero || { w: 80, h: 72 };
    const cw = def.w + 4, ch = def.h + 4;
    V.fit(weapons.length * cw, armors.length * ch);
    armors.forEach((ar, r) => weapons.forEach((wp, c) => {
      const x = c * cw, y = r * ch;
      backdrop(x, y, cw - 2, ch - 2);
      G.blit(A.heroFrame({ act: 'idle' }, { weapon: wp, armor: ar }), x + 2, y + 2);
    }));
  };

  // All registered icons (or a given list) with names, at 1x and on two backgrounds.
  V.icons = (names) => {
    names = names || Object.keys(A.icons);
    const cols = 6, cw = 64, ch = 30;
    V.fit(cols * cw, Math.ceil(names.length / cols) * ch + 4);
    names.forEach((n, i) => {
      const x = (i % cols) * cw, y = 2 + Math.floor(i / cols) * ch;
      G.rect(x + 1, y, 20, 20, '#223');
      G.rect(x + 22, y, 20, 20, '#445');
      const img = A.icon(n);
      G.blit(img, x + 1 + Math.floor((20 - img.width) / 2), y + Math.floor((20 - img.height) / 2));
      G.blit(img, x + 22 + Math.floor((20 - img.width) / 2), y + Math.floor((20 - img.height) / 2));
      F.draw(n.length > 12 ? n.slice(0, 12) : n, x + 1, y + 21, '#889');
    });
  };

  // A scene at a given size and time, with hotspot boxes outlined.
  V.scene = (name, w = 234, h = 300, t = 0, state = {}, opts = {}, live = {}) => {
    V.fit(w, h);
    A.drawScene(name, 0, 0, w, h, t, state, live);
    if (opts.hot !== false) {
      for (const hs of A.hotspots(name, w, h, state)) {
        G.frame(hs.x, hs.y, hs.w, hs.h, '#0f0');
        F.draw(hs.label || hs.id, hs.x + 2, hs.y + 2, '#0f0', { shadow: true });
      }
    }
  };

  // Several sizes of one scene stacked side by side (responsive check).
  V.sceneSizes = (name, sizes = [[216, 260], [234, 300], [270, 340]], t = 0, state = {}) => {
    const W = sizes.reduce((s, [w]) => s + w + 6, 0), H = Math.max(...sizes.map(s => s[1]));
    V.fit(W, H);
    let x = 0;
    for (const [w, h] of sizes) {
      A.drawScene(name, x, 0, w, h, t, state);
      x += w + 6;
    }
  };

  V.palette = () => {
    const names = Object.keys(P.ramps);
    V.fit(260, names.length * 10 + 4);
    names.forEach((n, i) => {
      P.ramps[n].forEach((c, j) => G.rect(70 + j * 18, 2 + i * 10, 18, 9, c));
      F.draw(n, 2, 3 + i * 10, '#ccc');
    });
  };

  V.font = () => {
    V.fit(240, 120);
    F.draw('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 4, 4, '#ddc');
    F.draw('abcdefghijklmnopqrstuvwxyz', 4, 16, '#ddc');
    F.draw('0123456789 .,:;!?\'"-+=/()%*<>&', 4, 28, '#ddc');
    F.draw('{gold}Gold{/} {red}Red{/} {green}Green{/} {blue}Blue{/} {purple}Arcane{/}', 4, 40, '#ddc', { shadow: true });
    F.draw('♥ ● ★ ✓ ▲ ◀ ▶ → ← ↑ ↓ ×1.5', 4, 52, '#fd5');
    F.big('DARKWOOD', 120, 66, { scale: 3, ramp: 'gold', align: 'center' });
  };

  // A reference sprite showing the kit in use (not part of the game).
  V.example = () => {
    V.fit(200, 110);
    backdrop(0, 0, 200, 110);
    const img = DW.kit.make(64, 72, S => {
      // legs
      S.capsule(25, 52, 23, 68, 5, 4, 'green');
      S.capsule(39, 52, 41, 68, 5, 4, 'green', { lo: 1 });
      // body + belly
      S.ball(32, 42, 15, 14, 'green');
      S.ball(32, 47, 9, 7, 'olive', { lo: 2 });
      // loincloth
      S.poly([[20, 50], [44, 50], [40, 60], [24, 60]], 'wood', { grad: [32, 50, 32, 60, 0.7, 0.3] });
      // arms
      S.capsule(18, 36, 10, 48, 4, 4, 'green', { lo: 1 });
      S.capsule(46, 36, 54, 26, 4, 3, 'green');
      // club
      S.capsule(55, 26, 58, 6, 2, 4, 'wood', { spec: 0.4 });
      // head, ears, eyes, teeth
      S.ball(32, 22, 11, 10, 'green', { spec: 0.3 });
      S.tri([22, 18], [10, 12], [23, 24], 'green', { tone: 0.5 });
      S.tri([42, 18], [54, 12], [41, 24], 'green', { tone: 0.75 });
      S.glow(28, 21, '#f65', 1); S.glow(36, 21, '#f65', 1);
      S.rect(29, 27, 6, 1, '#101'); S.px(30, 28, '#eed'); S.px(33, 28, '#eed');
      S.outline();
    });
    G.dither(40 - 22, 98, 44, 4, null, '#000', 9);
    G.blit(img, 8, 30);
    F.draw('kit example (64x72)', 90, 10, '#fd5', { shadow: true });
  };
})();
