// ================================================================
// TITLE & TOWN screens
// ================================================================
(() => {
  const G = DW.gfx, F = DW.font, UI = DW.ui, A = DW.art, FX = DW.fx, U = DW.util, P = DW.pal;
  const Gm = DW.game, S = DW.state, D = DW.data, App = DW.app;

  App.VERSION = '9.0';

  // ---------------------------------------------------------------
  // TITLE
  // ---------------------------------------------------------------
  App.register('title', {
    enter() { App.music('title'); },
    draw(dt, t) {
      const w = G.w, h = G.h;
      A.drawScene('title', 0, 0, w, h, App.t, {});
      // logo with a gentle float
      const logo = A.icon('logo');
      const ly = Math.round(h * 0.11 + Math.sin(App.t * 1.3) * 2);
      G.blit(logo, Math.floor((w - logo.width) / 2), ly);
      F.draw('ARENA  OF  CHAMPIONS', w >> 1, ly + logo.height + 4, '#c92', { align: 'center', shadow: '#000' });

      const save = Gm.readSave();
      const bw = Math.min(180, w - 40), bx = Math.floor((w - bw) / 2);
      let by = Math.round(h * 0.64);
      if (save && save.player) {
        const pd = save.player;
        if (UI.button('t-cont', bx, by, bw, 32, 'CONTINUE', { theme: 'gold', sub: `${pd.name || 'Derek'} · Level ${pd.level || 1}`, key: 'Enter' })) {
          if (Gm.load()) App.go('town');
          else { Gm.newGame(); App.go('town'); }
        }
        by += 38;
      }
      if (UI.button('t-new', bx, by, bw, 26, 'NEW GAME', { theme: save ? 'stone' : 'gold', key: save ? undefined : 'Enter' })) {
        const start = () => { Gm.clearSave(); Gm.newGame(); App.save(); App.go('town', { intro: true }); };
        if (save) App.confirm('NEW GAME', 'Start over? Your saved hero will be lost.', start, 'START OVER');
        else start();
      }
      by += 32;
      if (UI.button('t-opt', bx, by, bw, 22, 'OPTIONS', { theme: 'stone' })) App.settings();
      F.draw('v' + App.VERSION, w - 4, h - 10, '#445', { align: 'right' });
      F.draw('A remake of Darkwood', 4, h - 10, '#445');
    },
  });

  // ---------------------------------------------------------------
  // TOWN
  // ---------------------------------------------------------------
  const PLACES = [
    { id: 'arena', label: 'ARENA', icon: 'm_arena', theme: 'red', go: () => App.go('arena') },
    { id: 'smithy', label: 'SMITHY', icon: 'm_smithy', go: () => App.go('smithy') },
    { id: 'apothecary', label: 'APOTHECARY', icon: 'm_apothecary', go: () => App.go('apothecary') },
    { id: 'inn', label: 'INN', icon: 'm_inn', go: () => App.go('inn') },
    { id: 'hero', label: 'HERO', icon: 'm_hero', go: () => App.go('hero') },
    { id: 'options', label: 'OPTIONS', icon: 'ui_music', go: () => App.settings() },
  ];

  const gateTap = () => {
    if (S.flags.gateOpen) {
      App.sfx('gate');
      App.message('THE NORTH GATE', 'The great gate stands open. Beyond it the road winds into wild country: caves, ruins, and far to the north, the black town of {red}Blackstone{/} by the sea.\n\nYour journey north begins in the next chapter.', null, { icon: A.icon('m_gate') });
    } else {
      App.sfx('deny');
      App.message('THE NORTH GATE', 'Sealed with chains and the old king\'s wax. Only the {gold}Captain of the Guard{/} may order it opened.\n\nThe city crowns its Captain in the Arena: defeat the {red}Red Dragon{/}.', null, { icon: A.icon('m_gate') });
    }
  };

  App.register('town', {
    enter(params) {
      App.music('town');
      if (params && params.intro) {
        App.message('DARKWOOD', `Welcome to Darkwood, ${S.p.name}, the safest city in the kingdom.\n\nThe Arena crowns a Captain of the Guard each generation. Fight your way up its four rings, buy better steel, and face the {red}Red Dragon{/}.\n\nIn battle, watch which side a monster winds up from, then {gold}block that side{/}. Block at the last moment to {gold}parry{/}.`, () => App.levelUps());
      } else if (S.p.pendingLevels.length) {
        App.levelUps();
      }
    },
    draw(dt, t) {
      const w = G.w, h = G.h, top = App.HUD_H;
      const panelH = 104;
      const sceneH = h - top - panelH;
      const state = { gateOpen: !!S.flags.gateOpen };
      A.drawScene('town', 0, top, w, sceneH, App.t, state);

      // tappable buildings with name plaques
      for (const hs of A.hotspots('town', w, sceneH, state)) {
        const place = PLACES.find(p => p.id === hs.id);
        const pressed = UI.isPressed('hs-' + hs.id);
        if (UI.tap('hs-' + hs.id, hs.x, top + hs.y, hs.w, hs.h)) {
          App.sfx('door');
          if (hs.id === 'gate') gateTap(); else if (place) place.go();
        }
        const label = hs.label || (place ? place.label : hs.id.toUpperCase());
        const lw = F.measure(label) + 6;
        const lx = Math.round(hs.x + hs.w / 2 - lw / 2), ly = top + hs.y + hs.h - 12;
        G.dither(lx, ly, lw, 10, null, '#000', pressed ? 14 : 10);
        F.draw(label, lx + 3, ly + 2, pressed ? '#fff' : hs.id === 'arena' ? '#fd5' : '#ddc', { shadow: true });
      }

      // quest banner
      if (S.quest) {
        const txt = `Oath: slay the {red}${S.quest.enemy}{/} · {gold}${S.quest.reward}g`;
        const tw = F.measure(txt) + 12;
        const bx = Math.floor((w - tw) / 2);
        UI.panel(bx, top + 3, tw, 15, 'parch');
        F.draw(txt, bx + 6, top + 7, '#321');
      }

      App.drawHud();

      // bottom panel
      const py = h - panelH;
      UI.panel(0, py, w, panelH, 'stone');
      const pad = 6, gap = 4;
      const bw = Math.floor((w - pad * 2 - gap) / 2), bh = 28;
      PLACES.forEach((pl, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const bx = pad + col * (bw + gap), by = py + pad + row * (bh + gap);
        let sub;
        if (pl.id === 'inn') sub = `Rest ${Gm.innCost()}g`;
        if (pl.id === 'arena') sub = `Ring ${D.TIERS[Gm.highestTier() - 1].short} · ${Gm.totalDefeated()}/20`;
        if (pl.id === 'hero' && S.p.pendingLevels.length) sub = 'Level up!';
        if (UI.button('town-' + pl.id, bx, by, bw, bh, pl.label, { icon: A.icon(pl.icon), theme: pl.theme || 'stone', sub, key: String(i + 1) })) {
          pl.go();
        }
      });
    },
  });
})();
