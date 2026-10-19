// ================================================================
// SHOPS & INN — the Weapon Smith, the Apothecary, the Rusty Flagon.
// ================================================================
(() => {
  const G = DW.gfx, F = DW.font, UI = DW.ui, A = DW.art, FX = DW.fx, U = DW.util, P = DW.pal;
  const Gm = DW.game, S = DW.state, D = DW.data, App = DW.app;

  // ---------------------------------------------------------------
  // Shared list + detail layout
  // rows: [{ key, icon, name, nameCol, line2, right, rightCol, badge, badgeCol, dim }]
  // ---------------------------------------------------------------
  const ROW_H = 30;
  App.list = (id, rows, sel, x, y, w, h) => {
    let out = sel;
    UI.panel(x, y, w, h, 'dark');
    UI.scroll(id, x + 1, y + 1, w - 2, h - 2, rows.length * ROW_H + 2, oy => {
      rows.forEach((r, i) => {
        const ry = oy + 1 + i * ROW_H;
        if (ry > y + h || ry + ROW_H < y) return;
        const isSel = i === sel;
        const pressed = UI.isPressed(id + ':' + i);
        if (UI.tap(id + ':' + i, x + 1, ry, w - 6, ROW_H - 1)) { out = i; App.sfx('tap'); }
        if (isSel || pressed) G.rect(x + 2, ry, w - 7, ROW_H - 1, isSel ? '#334' : '#223');
        if (isSel) G.frame(x + 2, ry, w - 7, ROW_H - 1, '#c92');
        G.hline(x + 4, x + w - 8, ry + ROW_H - 1, '#223');
        G.rect(x + 5, ry + 6, 18, 18, '#000');
        G.rect(x + 6, ry + 7, 16, 16, '#223');
        if (r.icon) G.blit(r.icon, x + 7, ry + 8, r.dim ? { fade: 7 } : undefined);
        F.draw(r.name, x + 28, ry + 5, r.dim ? '#667' : r.nameCol || P.c.bright, { shadow: true });
        if (r.line2) F.draw(r.line2, x + 28, ry + 16, r.dim ? '#556' : P.c.dim);
        if (r.right) F.draw(r.right, x + w - 9, ry + 5, r.rightCol || P.c.gold, { align: 'right', shadow: true });
        if (r.badge) F.draw(r.badge, x + w - 9, ry + 16, r.badgeCol || P.c.green, { align: 'right' });
      });
    });
    return out;
  };

  // Detail panel with title, wrapped text and an action button. Returns true when the button is tapped.
  App.detail = (x, y, w, h, title, text, extra, btn) => {
    UI.panel(x, y, w, h, 'stone');
    F.draw(title, x + 8, y + 7, P.c.gold, { shadow: true });
    const bw = btn ? 74 : 0;
    const lines = F.wrap(text, w - 16 - (btn ? 0 : 0));
    let cy = y + 19;
    lines.slice(0, 3).forEach(ln => { F.draw(ln, x + 8, cy, P.c.text, { shadow: true }); cy += 10; });
    if (extra) F.draw(extra, x + 8, y + h - 16, P.c.dim, { shadow: true });
    if (!btn) return false;
    return UI.button('detail-btn', x + w - bw - 6, y + h - 26, bw, 20, btn.label, { theme: btn.theme || 'gold', disabled: btn.disabled, sound: false, key: 'Enter' });
  };

  const traitLabel = w => {
    const t = Gm.trait(w);
    if (t.kind === 'crush') return `Crush ${t.n}`;
    if (t.kind === 'crit') return `Crit +${t.n}%`;
    if (t.kind === 'holy') return 'Holy';
    return '';
  };
  const sign = n => (n > 0 ? '+' + n : String(n));

  const buyFx = (res) => {
    if (res.ok) {
      App.sfx('buy'); UI.toast(res.msg, P.c.green);
      FX.burst(G.w >> 1, App.HUD_H + 6, { n: 10, cols: ['#fe6', '#fd5', '#c92'], speed: 50, grav: 90, life: 0.6 });
      App.save();
    } else { App.sfx('deny'); UI.toast(res.msg, P.c.red); UI.buzz(30); }
  };

  // ---------------------------------------------------------------
  // WEAPON SMITH
  // ---------------------------------------------------------------
  let wSel = 0;
  App.register('smithy', {
    enter() {
      App.music('town');
      const cur = D.WEAPONS.findIndex(w => w.name === S.p.weapon);
      wSel = Math.min(D.WEAPONS.length - 1, cur + 1);
      UI.scrollReset('wlist');
      const s = UI.scrollState('wlist'); s.off = Math.max(0, (wSel - 2) * ROW_H);
    },
    draw() {
      const w = G.w, h = G.h;
      const top = App.header('smithy', 'WEAPON SMITH', 96);
      const detH = 86;
      const b = Gm.damageBonus();
      const rows = D.WEAPONS.map(wp => {
        const eq = wp.name === S.p.weapon;
        const price = Gm.weaponPrice(wp);
        const afford = S.p.gold >= price;
        return {
          icon: A.icon('w_' + wp.look), name: wp.name, nameCol: eq ? P.c.gold : undefined,
          line2: `${wp.damage_min + b}-${wp.damage_max + b} dmg  SPD ${sign(wp.speed)}  ${traitLabel(wp)}`,
          right: eq ? '' : wp.cost === 0 ? 'free' : U.fmt(price) + 'g', rightCol: afford ? P.c.gold : P.c.redDim,
          badge: eq ? 'EQUIPPED' : '', badgeCol: P.c.gold,
        };
      });
      wSel = App.list('wlist', rows, wSel, 4, top + 2, w - 8, h - top - detH - 8);
      const wp = D.WEAPONS[wSel], cur = Gm.weaponData();
      const eq = wp.name === S.p.weapon;
      const dAvg = (wp.damage_min + wp.damage_max - cur.damage_min - cur.damage_max) / 2;
      const cmp = eq ? 'Your current weapon.' :
        `vs yours: dmg {${dAvg >= 0 ? 'green' : 'red'}}${dAvg >= 0 ? '+' : ''}${dAvg}{/}  spd {${wp.speed - cur.speed >= 0 ? 'green' : 'red'}}${sign(wp.speed - cur.speed)}{/}` +
        (Gm.tradeIn(cur.cost) ? `  · trade-in ${Gm.tradeIn(cur.cost)}g` : '');
      const price = Gm.weaponPrice(wp);
      if (App.detail(4, h - detH - 4, w - 8, detH, wp.name, wp.description, cmp,
        { label: eq ? 'OWNED' : `BUY ${U.fmt(price)}`, disabled: eq, theme: S.p.gold >= price ? 'gold' : 'stone' })) {
        if (wp.cost < cur.cost && S.p.gold >= price) {
          App.confirm('TRADE DOWN?', `The smith will take your ${cur.name} in part exchange for the cheaper ${wp.name}. Are you sure?`, () => buyFx(Gm.buyWeapon(wp.name)), 'TRADE');
        } else buyFx(Gm.buyWeapon(wp.name));
      }
      App.drawHud();
    },
  });

  // ---------------------------------------------------------------
  // APOTHECARY
  // ---------------------------------------------------------------
  const TABS = [
    { label: 'POTIONS', types: ['potion', 'mana'] },
    { label: 'ARMOUR', types: ['armor', 'ring'] },
    { label: 'ARCANE', types: ['tome', 'wand'] },
  ];
  let aTab = 0, aSel = 0;

  const itemLine = it => {
    switch (it.type) {
      case 'potion': return it.value >= 999 ? 'Restores all HP' : `Restores ${it.value} HP`;
      case 'mana': return `Restores ${it.value} MP`;
      case 'armor': case 'ring': return `+${it.value} defense`;
      case 'tome': return `+${it.value} ${it.stat.toUpperCase()}, permanent`;
      case 'wand': return `${it.charges} charges · ${it.value - (it.element === 'fire' ? 15 : 10)}-${it.value + (it.element === 'fire' ? 15 : 10)} dmg`;
    }
    return '';
  };

  App.register('apothecary', {
    enter() { App.music('town'); aSel = 0; UI.scrollReset('alist'); },
    draw() {
      const w = G.w, h = G.h;
      const top = App.header('apothecary', 'APOTHECARY', 96);
      const nt = UI.tabs('atabs', 4, top + 2, w - 8, 20, TABS.map(t => t.label), aTab);
      if (nt !== aTab) { aTab = nt; aSel = 0; UI.scrollReset('alist'); }
      const items = D.ITEMS.filter(i => TABS[aTab].types.includes(i.type));
      const detH = 86;
      const rows = items.map(it => {
        const st = Gm.itemStatus(it);
        const price = Gm.itemPrice(it);
        let badge = '';
        if (st === 'equipped') badge = 'EQUIPPED';
        else if (st === 'read') badge = 'STUDIED';
        else if ((it.type === 'potion' || it.type === 'mana') && S.p.potions[it.name]) badge = `carried ${S.p.potions[it.name]}`;
        else if (it.type === 'wand' && S.p.wands[it.name]) badge = `${S.p.wands[it.name]} charges`;
        return {
          icon: A.icon(it.icon), name: it.name, nameCol: st ? P.c.gold : undefined, line2: itemLine(it),
          right: st ? '' : U.fmt(price) + 'g', rightCol: S.p.gold >= price ? P.c.gold : P.c.redDim,
          badge, badgeCol: st ? P.c.gold : P.c.green, dim: st === 'read',
        };
      });
      aSel = Math.min(aSel, items.length - 1);
      aSel = App.list('alist', rows, aSel, 4, top + 25, w - 8, h - top - 25 - detH - 8);
      const it = items[aSel];
      const st = Gm.itemStatus(it);
      const price = Gm.itemPrice(it);
      let extra = '';
      if (it.type === 'armor' || it.type === 'ring') {
        const cur = it.type === 'armor' ? Gm.armorData() : Gm.ringData();
        extra = cur ? `Replaces your ${cur.name}${Gm.tradeIn(cur.cost) ? ` (trade-in ${Gm.tradeIn(cur.cost)}g)` : ''}.` : `Your defense: ${Gm.defense()}.`;
      } else if (it.type === 'potion' || it.type === 'mana') {
        extra = `Carried: ${S.p.potions[it.name] || 0}. Drink in battle from ITEMS.`;
      } else if (it.type === 'wand') {
        extra = `Charges carried: ${S.p.wands[it.name] || 0}. Buying adds ${it.charges}.`;
      }
      if (App.detail(4, h - detH - 4, w - 8, detH, it.name, it.description, extra,
        { label: st ? (st === 'read' ? 'STUDIED' : 'OWNED') : `BUY ${U.fmt(price)}`, disabled: !!st, theme: S.p.gold >= price ? 'gold' : 'stone' })) {
        buyFx(Gm.buyItem(it.name));
      }
      App.drawHud();
    },
  });

  // ---------------------------------------------------------------
  // THE RUSTY FLAGON
  // ---------------------------------------------------------------
  let rumor = 0;
  const offerQuest = q => {
    const e = Gm.enemyData(q.enemy);
    App.dialog('A STRANGER', Gm.questText(q), [
      { label: 'SWEAR THE OATH', theme: 'gold', onTap: () => { Gm.acceptQuest(q); App.save(); UI.toast(`You swore to slay the ${e.name}.`, P.c.gold); App.sfx('equip'); } },
      { label: 'LEAVE IT BE', theme: 'stone', key: 'Escape', sound: 'back' },
    ], { icon: A.enemyPortrait(e.name) });
  };

  App.register('inn', {
    enter() { App.music('town'); rumor = U.rand(0, D.RUMORS.length - 1); },
    draw() {
      const w = G.w, h = G.h, p = S.p;
      const top = App.header('inn', 'THE RUSTY FLAGON', 96);
      let y = top + 4;
      // rumour board
      const rumH = 64;
      UI.panel(4, y, w - 8, rumH, 'parch');
      F.draw('Overheard:', 12, y + 6, '#530');
      F.drawWrapped('"' + D.RUMORS[rumor] + '"', 12, y + 18, w - 24, '#321');
      y += rumH + 6;

      // oath
      if (S.quest) {
        UI.panel(4, y, w - 8, 34, 'dark');
        G.blit(A.enemyPortrait(S.quest.enemy), 9, y + 5);
        F.draw('Your oath: slay the {red}' + S.quest.enemy, 38, y + 7, P.c.text, { shadow: true });
        F.draw('Reward on victory: {gold}' + S.quest.reward + ' gold', 38, y + 19, P.c.dim);
        y += 40;
      }

      const bw = w - 8, cost = Gm.innCost();
      const full = p.hp >= p.maxHp && p.mp >= p.maxMp;
      if (UI.button('inn-rest', 4, y, bw, 34, `RENT A ROOM  ${cost}g`, { theme: full || p.gold < cost ? 'stone' : 'gold', icon: A.icon('m_inn'), sub: 'Full health and magic. Strangers talk.', sound: false })) {
        const r = Gm.rest();
        if (r.ok) {
          App.sfx('heal'); UI.toast(r.msg, P.c.green); App.save();
          FX.heal(w >> 1, h >> 1, 24);
          if (r.offer) offerQuest(r.offer);
        } else { App.sfx('deny'); UI.toast(r.msg, P.c.red); }
      }
      y += 40;
      if (UI.button('inn-stable', 4, y, bw, 30, 'SLEEP IN THE STABLES', { theme: 'stone', sub: 'Free. Recover to half health and magic.', sound: false })) {
        const r = Gm.stables();
        if (r.ok) { App.sfx('heal'); UI.toast(r.msg, P.c.green); App.save(); }
        else { App.sfx('deny'); UI.toast(r.msg, P.c.dim); }
      }
      y += 36;
      if (UI.button('inn-listen', 4, y, bw, 24, 'LISTEN TO THE ROOM', { theme: 'stone' })) {
        rumor = (rumor + 1 + U.rand(0, D.RUMORS.length - 2)) % D.RUMORS.length;
      }
      App.drawHud();
    },
  });
})();
