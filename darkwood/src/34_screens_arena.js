// ================================================================
// ARENA (choose a foe) and HERO (stats, skills, bestiary) screens
// ================================================================
(() => {
  const G = DW.gfx, F = DW.font, UI = DW.ui, A = DW.art, FX = DW.fx, U = DW.util, P = DW.pal;
  const Gm = DW.game, S = DW.state, D = DW.data, App = DW.app, C = DW.combat;

  const SPECIAL = {
    drain: '{purple}Drains XP on unblocked hits',
    regen: '{green}Regenerates each turn (fire stops it)',
    petrify: '{red}Its gaze can petrify you',
    fire: '{orange}Fire: armour only half protects',
    none: '',
  };
  const KIND = { beast: 'Beast', humanoid: 'Humanoid', undead: 'Undead', giant: 'Giant', fiend: 'Fiend', dragon: 'Dragon' };

  // Rough danger estimate for the player right now.
  App.danger = e => {
    const avgHit = Math.max(1, (Gm.attackRange()[0] + Gm.attackRange()[1]) / 2 - Math.max(0, e.armor - (Gm.trait().kind === 'crush' ? Gm.trait().n : 0)));
    const turns = e.hp / avgHit;
    const rate = e.speed / Gm.speed();
    const hit = Math.max(1, (e.damage_min + e.damage_max) / 2 - (e.special === 'fire' ? Gm.defense() / 4 : Gm.defense() / 2));
    const taken = turns * rate * hit * 0.5;
    const r = taken / S.p.maxHp;
    if (r < 0.35) return ['Easy', P.c.green];
    if (r < 0.7) return ['Fair', P.c.gold];
    if (r < 1.1) return ['Hard', P.c.orange];
    return ['Deadly', P.c.red];
  };

  let tierSel = 1, eSel = 0;
  const tierEnemies = t => D.ENEMIES.filter(e => e.tier === t);

  App.register('arena', {
    enter(params) {
      App.music('town');
      tierSel = params && params.tier ? params.tier : Gm.highestTier();
      const list = tierEnemies(tierSel);
      const firstNew = list.findIndex(e => Gm.enemyUnlocked(e) && !S.p.defeated[e.name]);
      eSel = params && params.enemy ? Math.max(0, list.findIndex(e => e.name === params.enemy)) : Math.max(0, firstNew);
      if (S.p.pendingLevels.length) App.levelUps();
    },
    draw() {
      const w = G.w, h = G.h;
      const short = h < 440;
      let y = App.header('arena', '', short ? 40 : 64, { state: { tier: tierSel }, live: { cheer: 0.2 } });
      F.big('THE ARENA', w >> 1, App.HUD_H + (short ? 12 : 22), { scale: 2, ramp: 'gold', align: 'center' });

      const locked = [1, 2, 3, 4].map(t => !Gm.tierUnlocked(t));
      const nt = UI.tabs('tiers', 4, y + 2, w - 8, 22, D.TIERS.map(t => 'RING ' + t.short), tierSel - 1, { locked });
      if (nt !== tierSel - 1) { tierSel = nt + 1; eSel = 0; App.sfx('tap'); }
      y += 27;
      const tier = D.TIERS[tierSel - 1];
      F.draw(tier.name, 8, y + 2, P.c.gold, { shadow: true });
      const done = Gm.defeatedIn(tierSel);
      F.draw(`${done}/5 beaten`, w - 8, y + 2, done >= D.TIER_UNLOCK ? P.c.green : P.c.dim, { align: 'right', shadow: true });
      y += 12;
      if (!short) y += F.drawWrapped(tier.blurb, 8, y, w - 16, P.c.dim) + 2;

      // enemy rows
      const list = tierEnemies(tierSel);
      const rowH = 30;
      UI.panel(4, y, w - 8, rowH * 5 + 4, 'dark');
      list.forEach((e, i) => {
        const ry = y + 2 + i * rowH;
        const open = Gm.enemyUnlocked(e);
        const seen = open || S.p.defeated[e.name];
        if (UI.tap('en-' + i, 5, ry, w - 10, rowH - 1)) { eSel = i; App.sfx('tap'); }
        if (i === eSel) { G.rect(6, ry, w - 12, rowH - 1, '#334'); G.frame(6, ry, w - 12, rowH - 1, '#c92'); }
        G.rect(9, ry + 2, 26, 26, '#000');
        const por = A.enemyPortrait(e.name);
        G.blit(por, 10, ry + 3, seen ? undefined : { flash: '#223' });
        if (!open) G.blit(A.icon('ui_lock'), 23, ry + 17);
        F.draw(seen ? e.name : '? ? ?', 40, ry + 5, open ? P.c.bright : '#667', { shadow: true });
        F.draw(seen ? KIND[e.kind] + (e.special !== 'none' ? ' · ' + e.special : '') : 'Locked', 40, ry + 16, '#778');
        const kills = S.p.defeated[e.name] || 0;
        if (S.quest && S.quest.enemy === e.name) F.draw('OATH', w - 10, ry + 5, P.c.gold, { align: 'right', shadow: true });
        else if (kills) F.draw('★'.repeat(Math.min(3, kills)), w - 10, ry + 5, P.c.gold, { align: 'right', shadow: true });
        else if (open) F.draw('NEW', w - 10, ry + 5, P.c.green, { align: 'right', shadow: true });
        if (open && seen) { const [dn, dc] = App.danger(e); F.draw(dn, w - 10, ry + 16, dc, { align: 'right' }); }
      });
      y += rowH * 5 + 8;

      // detail
      const e = list[eSel];
      const open = Gm.enemyUnlocked(e);
      const detH = h - y - 4;
      UI.panel(4, y, w - 8, detH, 'stone');
      let cy = y + 7;
      if (!open) {
        const need = !Gm.tierUnlocked(e.tier)
          ? `Defeat ${D.TIER_UNLOCK} foes in ${D.TIERS[e.tier - 2].name} to open this ring.`
          : 'Defeat the other four champions of the Crown to face the dragon.';
        F.draw('Locked', 10, cy, P.c.red, { shadow: true });
        F.drawWrapped(need, 10, cy + 12, w - 20, P.c.text, { shadow: true });
        return App.drawHud();
      }
      F.draw(e.name, 10, cy, P.c.gold, { shadow: true });
      const [dn, dc] = App.danger(e);
      F.draw(dn, w - 10, cy, dc, { align: 'right', shadow: true });
      cy += 12;
      const stats = [['ui_hp', e.hp], ['ui_atk', `${e.damage_min}-${e.damage_max}`], ['ui_def', e.armor], ['ui_spd', e.speed]];
      let sx = 10;
      for (const [ic, v] of stats) {
        G.blit(A.icon(ic), sx, cy);
        F.draw(String(v), sx + 10, cy, P.c.text, { shadow: true });
        sx += 16 + F.measure(String(v)) + 6;
      }
      cy += 11;
      F.draw(`Reward: {blue}${U.fmt(e.xp)} xp{/} · {gold}${U.fmt(e.gold)} gold`, 10, cy, P.c.dim);
      cy += 12;
      if (SPECIAL[e.special]) { F.draw(SPECIAL[e.special], 10, cy, P.c.text, { shadow: true }); cy += 11; }
      const moves = [];
      if (e.moves.feint) moves.push('{orange}feints');
      if (e.moves.combo) moves.push('{orange}strikes twice');
      const descLines = F.wrap(e.description + (moves.length ? '  It ' + moves.join('{/} and ') + '{/}.' : ''), w - 20);
      const room = Math.max(1, Math.floor((y + detH - 32 - cy) / 10));
      descLines.slice(0, room).forEach((ln, i) => F.draw(ln, 10, cy + i * 10, P.c.dim));
      cy += Math.min(room, descLines.length) * 10 + 4;
      // a live look at the foe when the screen is tall enough
      const boxH = y + detH - 32 - cy;
      if (boxH >= 60) {
        const bx = 9, bw = w - 18;
        G.rect(bx - 1, cy - 1, bw + 2, boxH + 2, '#000');
        G.clip(bx, cy, bw, boxH, () => {
          A.drawScene('arena', bx, cy, bw, boxH, App.t, { tier: e.tier }, { cheer: 0.1 });
          const img = A.enemyFrame(e.name, { f: Math.floor(App.t * 4) });
          const d = A.enemyDef(e.name) || { w: img.width, h: img.height, anchor: [img.width >> 1, img.height - 1] };
          // tall foes are shown head-first (legs cropped) so the face is never cut off
          const top = d.anchor[1] > boxH - 10 ? cy + 3 : cy + boxH - 8 - d.anchor[1];
          const feet = top + d.anchor[1];
          G.dither((w >> 1) - Math.floor(d.w / 3), feet - 2, Math.floor(d.w * 2 / 3), 4, null, '#000', 9);
          G.blit(img, (w >> 1) - d.anchor[0], top);
        });
      }
      if (UI.button('fight', 10, y + detH - 28, w - 20, 22, 'FIGHT!', { theme: 'red', key: 'Enter', sound: false })) {
        App.sfx('roar');
        App.go('combat', { enemy: e.name, streak: 0 });
      }
      App.drawHud();
    },
  });

  // ---------------------------------------------------------------
  // HERO
  // ---------------------------------------------------------------
  let heroTab = 0;
  const statRow = (x, y, w, icon, label, value, col) => {
    if (icon) G.blit(A.icon(icon), x, y);
    F.draw(label, x + (icon ? 11 : 0), y, P.c.dim);
    F.draw(String(value), x + w, y, col || P.c.bright, { align: 'right', shadow: true });
  };

  App.register('hero', {
    enter() { App.music('town'); if (S.p.pendingLevels.length) App.levelUps(); },
    draw() {
      const w = G.w, h = G.h, p = S.p;
      G.blit(G.cache(`herobg|${w}x${h}`, w, h - App.HUD_H, (cx, cw, ch) => G.copper(0, 0, cw, ch, ['#112', '#102', '#101'], cx, 6)), 0, App.HUD_H);
      let y = App.HUD_H + 4;
      if (UI.button('hero-back', 4, y, 38, 22, '◀', { key: 'Escape', sound: 'back' })) App.go('town');
      heroTab = UI.tabs('herotabs', 46, y, w - 50, 22, ['STATS', 'SKILLS', 'BESTIARY'], heroTab);
      y += 28;
      if (heroTab === 0) drawStats(y);
      else if (heroTab === 1) drawSkills(y);
      else drawBestiary(y);
      App.drawHud();
    },
  });

  function drawStats(y) {
    const w = G.w, h = G.h, p = S.p;
    // hero on a little arena pedestal
    const boxH = 82;
    UI.panel(4, y, w - 8, boxH, 'dark');
    G.clip(5, y + 1, w - 10, boxH - 2, () => {
      A.drawScene('arena', 5, y + 1, w - 10, boxH - 2, DW.app.t, { tier: Gm.highestTier() });
      const img = A.heroFrame({ act: 'idle', f: Math.floor(DW.app.t * 3) }, Gm.gear());
      G.blit(img, (w >> 1) - (img.width >> 1), y + boxH - img.height + 8);
    });
    F.draw(p.name, 10, y + 5, P.c.gold, { shadow: true });
    F.draw(`Level ${p.level}`, 10, y + 15, P.c.text, { shadow: true });
    F.draw(`XP ${U.fmt(p.xp)}/${U.fmt(Gm.xpNext())}`, w - 10, y + 5, P.c.blue, { align: 'right', shadow: true });
    y += boxH + 4;

    const colW = Math.floor((w - 8 - 12) / 2);
    UI.panel(4, y, w - 8, 76, 'stone');
    const [a0, a1] = Gm.attackRange();
    let ly = y + 7;
    const L = 10, R = 10 + colW + 6;
    statRow(L, ly, colW - 4, 'ui_hp', 'HP', `${p.hp}/${p.maxHp}`, P.c.green);
    statRow(R, ly, colW - 4, 'ui_mp', 'MP', `${p.mp}/${p.maxMp}`, P.c.purple); ly += 11;
    statRow(L, ly, colW - 4, 'ui_atk', 'Attack', `${a0}-${a1}`);
    statRow(R, ly, colW - 4, 'ui_def', 'Defense', Gm.defense()); ly += 11;
    statRow(L, ly, colW - 4, 'ui_spd', 'Speed', Gm.speed());
    statRow(R, ly, colW - 4, 'ui_xp', 'Crit', Math.round(Gm.critChance() * 100) + '%'); ly += 11;
    statRow(L, ly, colW - 4, null, 'Strength', p.str);
    statRow(R, ly, colW - 4, null, 'Dexterity', p.dex); ly += 11;
    statRow(L, ly, colW - 4, null, 'Constitution', p.con);
    statRow(R, ly, colW - 4, null, 'Gold', U.fmt(p.gold), P.c.gold); ly += 11;
    F.draw('STR dmg · DEX spd/def/crit · CON hp', w >> 1, ly + 1, '#889', { align: 'center' });
    y += 80;

    // gear & pack
    const gearH = h - y - 4;
    UI.panel(4, y, w - 8, gearH, 'dark');
    let gy = y + 4;
    const wp = Gm.weaponData();
    const gearRow = (icon, name, line) => {
      G.rect(8, gy, 18, 18, '#000');
      G.blit(A.icon(icon), 10, gy + 2);
      F.draw(name, 30, gy, P.c.bright, { shadow: true });
      F.draw(line, 30, gy + 9, P.c.dim);
      gy += 21;
    };
    gearRow('w_' + wp.look, wp.name, `${a0}-${a1} dmg · SPD ${wp.speed >= 0 ? '+' : ''}${wp.speed}`);
    const ar = Gm.armorData(), rg = Gm.ringData();
    gearRow(ar ? ar.icon : 'a_leather', ar ? ar.name : 'No armour', ar ? `+${ar.value} defense` : 'Buy some at the Apothecary');
    if (rg) gearRow(rg.icon, rg.name, `+${rg.value} defense`);
    const pack = [];
    for (const [n, c] of Object.entries(p.potions)) pack.push([Gm.itemData(n).icon, c]);
    for (const [n, c] of Object.entries(p.wands)) pack.push([Gm.itemData(n).icon, c]);
    if (pack.length && gy + 20 < y + gearH) {
      F.draw('Pack:', 10, gy + 4, P.c.dim);
      let px = 40;
      for (const [ic, c] of pack) {
        if (px + 30 > w - 6) { px = 40; gy += 17; }
        G.blit(A.icon(ic), px, gy + 1); F.draw('×' + c, px + 15, gy + 4, P.c.text); px += 32;
      }
      gy += 20;
    }
    if (S.quest && gy + 12 < y + gearH) F.draw(`Oath: slay the {red}${S.quest.enemy}{/} for {gold}${S.quest.reward}g`, 10, gy + 2, P.c.text);
  }

  function drawSkills(y) {
    const w = G.w, h = G.h, p = S.p;
    // equipped slots
    F.draw(`Tap a skill to equip it (${p.slots.length}/${D.SLOTS} slots)`, w >> 1, y, P.c.dim, { align: 'center' });
    y += 11;
    const sw = Math.floor((w - 8 - 8) / 3);
    for (let i = 0; i < D.SLOTS; i++) {
      const sx = 4 + i * (sw + 4);
      UI.panel(sx, y, sw, 30, i < p.slots.length ? 'gold' : 'dark');
      const id = p.slots[i];
      if (id) {
        const a = Gm.abilityData(id);
        G.blit(A.icon(a.icon), sx + 6, y + 8);
        const nm = Gm.abilityName(id);
        F.draw(F.measure(nm) > sw - 26 ? a.name.split(' ')[0] : nm, sx + 23, y + 7, P.c.bright, { shadow: true });
        F.draw(Gm.abilityCost(id) + ' MP', sx + 23, y + 17, P.c.purple);
      } else F.draw('empty', sx + sw / 2, y + 11, '#556', { align: 'center' });
    }
    y += 34;
    const rowH = 31;
    const listH = h - y - 4;
    UI.panel(4, y, w - 8, listH, 'dark');
    UI.scroll('skills', 5, y + 1, w - 10, listH - 2, D.ABILITIES.length * rowH + 2, oy => {
      D.ABILITIES.forEach((a, i) => {
        const ry = oy + 1 + i * rowH;
        const r = Gm.rank(a.id);
        const eq = p.slots.includes(a.id);
        const lvl = Object.keys(D.LEVEL_ABILITIES).find(k => D.LEVEL_ABILITIES[k] === a.id);
        if (r && UI.tap('sk-' + a.id, 5, ry, w - 14, rowH - 1)) {
          const res = Gm.toggleSlot(a.id);
          if (res === 'full') {
            App.dialog('SKILL SLOTS FULL', `Replace which skill with ${Gm.abilityName(a.id)}?`, p.slots.map((sid, si) => ({
              label: Gm.abilityName(sid), theme: 'purple', onTap: () => { Gm.replaceSlot(si, a.id); App.save(); App.sfx('equip'); },
            })).concat([{ label: 'CANCEL', key: 'Escape', sound: 'back' }]));
          } else { App.sfx(res === 'added' ? 'equip' : 'back'); App.save(); }
        }
        if (eq) G.rect(6, ry, w - 16, rowH - 1, '#213');
        G.hline(8, w - 12, ry + rowH - 1, '#223');
        G.rect(9, ry + 5, 18, 18, '#000');
        G.blit(A.icon(a.icon), 11, ry + 7, r ? undefined : { flash: '#334' });
        if (r) {
          F.draw(Gm.abilityName(a.id), 32, ry + 3, eq ? P.c.gold : P.c.bright, { shadow: true });
          F.draw('●'.repeat(r) + '○'.repeat(5 - r), w - 12, ry + 3, P.c.purple, { align: 'right' });
          F.draw(F.fit(a.ranks[r - 1], w - 46), 32, ry + 13, P.c.text);
          F.draw(F.fit(`${Gm.abilityCost(a.id)} MP${r < 5 ? ' · next: ' + a.ranks[r] : ''}`, w - 46), 32, ry + 22, '#889');
        } else {
          F.draw(a.name, 32, ry + 3, '#889', { shadow: true });
          F.draw(`Learned at level ${lvl}`, 32, ry + 13, '#778');
          F.draw(F.fit(a.desc, w - 46), 32, ry + 22, '#778');
        }
      });
    });
  }

  function drawBestiary(y) {
    const w = G.w, h = G.h, p = S.p;
    F.draw(`${Gm.totalDefeated()} of ${D.ENEMIES.length} creatures slain`, w >> 1, y, P.c.gold, { align: 'center', shadow: true });
    y += 12;
    const cols = 4, cw = Math.floor((w - 8) / cols), ch = 46;
    D.ENEMIES.forEach((e, i) => {
      const cx = 4 + (i % cols) * cw, cy = y + Math.floor(i / cols) * ch;
      const kills = p.defeated[e.name] || 0;
      if (UI.tap('best-' + i, cx, cy, cw - 2, ch - 2)) {
        App.sfx('tap');
        if (kills) App.message(e.name.toUpperCase(), `${e.description}\n\n{dim}${KIND[e.kind]} · HP ${e.hp} · DMG ${e.damage_min}-${e.damage_max} · ARM ${e.armor} · SPD ${e.speed}\n{gold}Defeated ${kills} time${kills > 1 ? 's' : ''}.`, null, { icon: A.enemyPortrait(e.name) });
        else App.message('UNKNOWN', 'You have not defeated this creature yet.', null);
      }
      UI.panel(cx, cy, cw - 2, ch - 2, 'dark');
      G.blit(A.enemyPortrait(e.name), cx + Math.floor((cw - 2 - 24) / 2), cy + 4, kills ? undefined : { flash: '#223' });
      const nm = kills ? e.name : '???';
      F.draw(F.measure(nm) > cw - 6 ? nm.split(' ')[0] : nm, cx + Math.floor((cw - 2) / 2), cy + 31, kills ? P.c.text : '#556', { align: 'center' });
      if (kills) F.draw('★', cx + cw - 9, cy + 3, P.c.gold);
    });
  }
})();
