// ================================================================
// APP — screen manager, modal stack, HUD, shared dialogs, settings
// and the level-up flow. Screens are immediate-mode: each frame
// `draw(dt, t)` paints the screen and handles its own taps.
// ================================================================
(() => {
  const G = DW.gfx, F = DW.font, UI = DW.ui, A = DW.art, FX = DW.fx, U = DW.util, P = DW.pal;
  const Gm = DW.game, S = DW.state, D = DW.data;
  const App = DW.app = { screens: {}, cur: null, name: '', params: null, modals: [], t: 0, screenT: 0 };
  const sfx = (n, o) => DW.audio && DW.audio.sfx && DW.audio.sfx(n, o);
  const music = n => DW.audio && DW.audio.music && DW.audio.music(n);
  App.sfx = sfx; App.music = music;

  App.HUD_H = 30;

  // ---------------------------------------------------------------
  // Screens & modals
  // ---------------------------------------------------------------
  App.register = (name, screen) => { App.screens[name] = screen; };

  App.go = (name, params = {}, opts = {}) => {
    const swap = () => {
      if (App.cur && App.cur.exit) App.cur.exit();
      App.modals = [];
      App.name = name; App.params = params;
      App.cur = App.screens[name];
      App.screenT = 0;
      if (App.cur && App.cur.enter) App.cur.enter(params);
    };
    if (opts.instant) swap(); else FX.wipe(swap);
  };

  App.modal = m => { App.modals.push(m); return m; };
  App.closeModal = m => {
    const i = m ? App.modals.indexOf(m) : App.modals.length - 1;
    if (i >= 0) App.modals.splice(i, 1);
  };
  App.topModal = () => App.modals[App.modals.length - 1] || null;

  App.frame = (dt, gameDt) => {
    App.t += dt; App.screenT += gameDt;
    const ctx = G.ctx;
    const [sx, sy] = FX.offset();
    UI.enabled = !App.modals.length && !FX.wiping();
    ctx.save();
    ctx.translate(sx, sy);
    if (App.cur) App.cur.draw(gameDt, App.screenT);
    ctx.restore();
    App.modals.forEach((m, i) => {
      UI.enabled = i === App.modals.length - 1 && !FX.wiping();
      G.dither(0, 0, G.w, G.h, null, '#000', 9);
      m.draw(dt);
    });
    UI.enabled = true;
  };

  App.save = () => { Gm.save(); };

  // ---------------------------------------------------------------
  // HUD — portrait, name, level, gold, HP / MP / XP bars.
  // ---------------------------------------------------------------
  const ghost = { hp: null, mp: null };
  App.drawHud = () => {
    const p = S.p;
    const w = G.w, H = App.HUD_H;
    UI.panel(0, 0, w, H, 'stone');
    G.rect(3, 3, 24, 24, '#000');
    G.blit(A.icon('hero_portrait'), 3, 3);
    G.frame(2, 2, 26, 26, '#a70');
    F.draw(p.name, 32, 5, P.c.gold, { shadow: true });
    F.draw('Lv ' + p.level, 32 + F.measure(p.name) + 5, 5, P.c.text, { shadow: true });
    const goldTxt = U.fmt(p.gold);
    const gx = w - 6 - F.measure(goldTxt);
    F.draw(goldTxt, gx, 5, P.c.gold, { shadow: true });
    G.blit(A.icon('ui_gold'), gx - 11, 4);
    // bars
    const bx = 32, bw = Math.floor((w - bx - 6 - 3) / 2);
    ghost.hp = ghost.hp === null ? p.hp : U.lerp(ghost.hp, p.hp, 0.08);
    ghost.mp = ghost.mp === null ? p.mp : U.lerp(ghost.mp, p.mp, 0.08);
    const low = p.hp / p.maxHp < 0.3;
    UI.bar(bx, 14, bw, 9, p.hp / p.maxHp, low ? 'blood' : 'green', { ghost: ghost.hp / p.maxHp, label: `${p.hp}/${p.maxHp}`, pulse: low });
    UI.bar(bx + bw + 3, 14, bw, 9, p.mp / Math.max(1, p.maxMp), 'arcane', { label: `${p.mp}/${p.maxMp}` });
    UI.bar(bx, 24, w - bx - 6, 3, p.xp / Gm.xpNext(), 'ice');
  };

  // A scene banner with a title plate and back button. Returns the y below it.
  App.header = (sceneName, title, h, opts = {}) => {
    const y = opts.y !== undefined ? opts.y : App.HUD_H;
    A.drawScene(sceneName, 0, y, G.w, h, App.t, opts.state || {}, opts.live || {});
    G.hline(0, G.w - 1, y + h, '#000');
    G.hline(0, G.w - 1, y + h + 1, '#445');
    if (title) {
      const tw = F.measure(title) * 2 + 16;
      const tx = Math.floor((G.w - tw) / 2), ty = y + h - 22;
      G.dither(tx - 4, ty - 2, tw + 8, 22, null, '#000', 10);
      F.big(title, G.w >> 1, ty + 2, { scale: 2, ramp: opts.ramp || 'gold', align: 'center' });
    }
    if (opts.back !== false) {
      if (UI.button('hdr-back', 4, y + 4, 34, 18, '◀', { theme: 'stone', key: 'Escape', sound: 'back' })) App.go(opts.backTo || 'town');
    }
    return y + h + 2;
  };

  // ---------------------------------------------------------------
  // Generic dialogs
  // ---------------------------------------------------------------
  // buttons: [{ label, theme, key, onTap }]
  App.dialog = (title, text, buttons, opts = {}) => {
    const m = {
      title, text, buttons, opts,
      draw() {
        const w = Math.min(G.w - 16, 240);
        const x = Math.floor((G.w - w) / 2);
        const lines = F.wrap(this.text, w - 20);
        const iconH = this.opts.icon ? this.opts.icon.height + 6 : 0;
        const btnH = 22;
        const h = 22 + iconH + lines.length * 10 + 10 + this.buttons.length * (btnH + 4) + 4;
        const y = Math.max(8, Math.floor((G.h - h) / 2));
        let cy = UI.dialog(x, y, w, h, this.title, this.opts.style || 'gold') + 4;
        if (this.opts.icon) { G.blit(this.opts.icon, x + Math.floor((w - this.opts.icon.width) / 2), cy); cy += iconH; }
        lines.forEach((ln, i) => F.draw(ln, x + 10, cy + i * 10, P.c.text, { shadow: true }));
        cy += lines.length * 10 + 8;
        this.buttons.forEach((b, i) => {
          if (UI.button('dlg-' + i + '-' + b.label, x + 10, cy, w - 20, btnH, b.label, { theme: b.theme || 'stone', key: b.key, sound: b.sound })) {
            App.closeModal(this);
            b.onTap && b.onTap();
          }
          cy += btnH + 4;
        });
      },
    };
    return App.modal(m);
  };

  App.message = (title, text, onOk, opts) => App.dialog(title, text, [{ label: 'OK', theme: 'gold', key: ['Enter', ' ', 'Escape'], onTap: onOk }], opts);
  App.confirm = (title, text, onYes, yesLabel = 'YES', opts) => App.dialog(title, text, [
    { label: yesLabel, theme: 'red', onTap: onYes },
    { label: 'CANCEL', theme: 'stone', key: 'Escape', sound: 'back' },
  ], opts);

  // ---------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------
  App.settings = () => {
    const au = DW.audio || {};
    App.modal({
      draw() {
        const w = Math.min(G.w - 16, 230), h = 216;
        const x = Math.floor((G.w - w) / 2), y = Math.floor((G.h - h) / 2);
        let cy = UI.dialog(x, y, w, h, 'OPTIONS') + 4;
        const row = (id, label, on, sub) => {
          const r = UI.button(id, x + 10, cy, w - 20, 24, label + (on === undefined ? '' : on ? ':  ON' : ':  OFF'), { theme: on ? 'gold' : 'stone', sub, align: 'left' });
          cy += 28;
          return r;
        };
        if (row('set-music', 'MUSIC', !!au.musicOn)) au.setMusic && au.setMusic(!au.musicOn);
        if (row('set-sfx', 'SOUND', !!au.sfxOn)) au.setSfx && au.setSfx(!au.sfxOn);
        if (row('set-assist', 'BLOCK ASSIST', !!S.settings.assist)) { S.settings.assist = !S.settings.assist; App.save(); }
        F.draw('Assist: slower wind-ups, wider parry.', x + 12, cy - 2, P.c.dim);
        cy += 10;
        if (S.p && row('set-name', 'RENAME HERO')) {
          let n = null;
          try { n = window.prompt('Name your hero', S.p.name); } catch (_) { /* ignore */ }
          if (n && n.trim()) { S.p.name = n.trim().slice(0, 12); App.save(); }
        }
        if (S.p && row('set-new', 'NEW GAME')) {
          App.confirm('NEW GAME', 'Start over? Your current hero and all progress will be lost.', () => {
            App.closeModal();
            Gm.clearSave(); Gm.newGame(); App.save();
            App.go('town');
          }, 'START OVER');
        }
        if (UI.button('set-close', x + 10, y + h - 30, w - 20, 22, 'CLOSE', { theme: 'stone', key: 'Escape', sound: 'back' })) App.closeModal(this);
      },
    });
  };

  // ---------------------------------------------------------------
  // Level-up flow: one modal per pending level.
  // ---------------------------------------------------------------
  App.levelUps = (onDone) => {
    if (!S.p.pendingLevels.length) { onDone && onDone(); return; }
    sfx('levelup');
    FX.ring(G.w >> 1, G.h >> 1, '#fd5', 60, 0.6);
    let mastery = false;
    const m = App.modal({
      born: App.t,
      draw() {
        const p = S.p;
        const lvl = p.pendingLevels[0];
        if (lvl === undefined) { App.closeModal(this); onDone && onDone(); return; }
        const newAb = D.LEVEL_ABILITIES[lvl];
        const w = Math.min(G.w - 12, 248);
        const opts = Gm.masteryOptions();
        const h = mastery ? 40 + opts.length * 30 + 34 : 188 + (newAb ? 34 : 0);
        const x = Math.floor((G.w - w) / 2), y = Math.max(6, Math.floor((G.h - h) / 2));
        UI.dialog(x, y, w, h, '');
        const pulse = Math.sin((App.t - this.born) * 6) > 0;
        F.big('LEVEL ' + lvl + '!', G.w >> 1, y + 8, { scale: 2, ramp: pulse ? 'gold' : 'fire', align: 'center' });
        let cy = y + 30;
        if (mastery) {
          F.draw('Rank up which skill?', G.w >> 1, cy, P.c.text, { align: 'center', shadow: true });
          cy += 14;
          opts.forEach(id => {
            const a = Gm.abilityData(id), r = Gm.rank(id);
            if (UI.button('lu-m-' + id, x + 8, cy, w - 16, 26, Gm.abilityName(id) + '  ' + '●'.repeat(r) + '○'.repeat(5 - r), {
              icon: A.icon(a.icon), align: 'left', theme: 'purple', sub: 'Next: ' + a.ranks[r],
            })) {
              const msg = Gm.chooseLevelReward('mastery', id);
              UI.toast('{purple}' + msg, P.c.text);
              mastery = false; App.save(); sfx('magic');
            }
            cy += 30;
          });
          if (UI.button('lu-m-back', x + 8, cy, w - 16, 22, 'BACK', { key: 'Escape', sound: 'back' })) mastery = false;
          return;
        }
        F.draw(`Automatic: +${Gm.hpPerLevel()} max HP, +1 max MP`, G.w >> 1, cy, P.c.dim, { align: 'center' });
        cy += 14;
        if (newAb) {
          const a = Gm.abilityData(newAb);
          UI.panel(x + 8, cy, w - 16, 30, 'dark');
          G.blit(A.icon(a.icon), x + 13, cy + 8);
          F.draw('New skill: {gold}' + a.name, x + 32, cy + 5, P.c.text, { shadow: true });
          F.draw(p.slots.includes(newAb) ? 'Equipped and ready.' : 'Equip it on the Hero screen.', x + 32, cy + 16, P.c.dim);
          cy += 34;
        }
        F.draw('Choose your reward (all restore HP & MP):', G.w >> 1, cy, P.c.text, { align: 'center', shadow: true });
        cy += 13;
        const bw = w - 16;
        if (UI.button('lu-vit', x + 8, cy, bw, 30, 'VITALITY', { icon: A.icon('ui_hp'), theme: 'red', sub: `+${Gm.vitalityGain()} max HP`, key: '1' })) {
          UI.toast('{red}' + Gm.chooseLevelReward('vitality'), P.c.text); App.save(); sfx('heal');
        }
        cy += 34;
        if (UI.button('lu-arc', x + 8, cy, bw, 30, 'ARCANE', { icon: A.icon('ui_mp'), theme: 'blue', sub: `+${Gm.ARCANE_GAIN} max MP`, key: '2' })) {
          UI.toast('{blue}' + Gm.chooseLevelReward('arcane'), P.c.text); App.save(); sfx('magic');
        }
        cy += 34;
        if (UI.button('lu-mas', x + 8, cy, bw, 30, 'MASTERY', { icon: A.icon('m_skills'), theme: 'purple', sub: opts.length ? 'Rank up a skill' : 'All skills mastered', disabled: !opts.length, key: '3' })) {
          mastery = true;
        }
      },
    });
    return m;
  };

  // ---------------------------------------------------------------
  // Small shared drawing helpers
  // ---------------------------------------------------------------
  App.statusIcons = (list, x, y) => {
    let cx = x;
    for (const s of list) {
      G.rect(cx - 1, y - 1, 9, 9, '#000');
      G.blit(A.icon('st_' + s.type), cx, y);
      if (s.turns) F.draw(String(s.turns), cx + 9, y, P.c.text, { shadow: true });
      cx += s.turns ? 18 : 11;
    }
    return cx;
  };

  App.money = (n, x, y, opts = {}) => {
    const txt = U.fmt(n);
    const tw = F.measure(txt) + 10;
    const sx = opts.align === 'right' ? x - tw : x;
    G.blit(A.icon('ui_gold'), sx, y - 1);
    F.draw(txt, sx + 10, y, opts.col || P.c.gold, { shadow: true });
    return tw;
  };
})();
