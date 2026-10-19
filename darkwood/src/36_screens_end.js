// ================================================================
// ENDING — the dragon is dead; the North Gate opens at dawn.
// ================================================================
(() => {
  const G = DW.gfx, F = DW.font, UI = DW.ui, A = DW.art, FX = DW.fx, U = DW.util, P = DW.pal;
  const Gm = DW.game, S = DW.state, D = DW.data, App = DW.app;

  let gateSfx = false;
  App.register('ending', {
    enter() {
      gateSfx = false;
      App.music('victory');
      S.flags.gateOpen = true;
      App.save();
    },
    draw(dt, t) {
      const w = G.w, h = G.h, p = S.p;
      A.drawScene('victory', 0, 0, w, h, t, {});
      if (!gateSfx && t > 0.3) { gateSfx = true; App.sfx('gate'); FX.shake(2, 2.5); }

      // titles fade in
      if (t > 1.2) {
        const y = Math.round(h * 0.07);
        F.big('CAPTAIN', w >> 1, y, { scale: 3, ramp: 'gold', align: 'center' });
        F.big('OF THE GUARD', w >> 1, y + 30, { scale: 2, ramp: 'gold', align: 'center' });
        if (t < 1.6) G.dither(0, y - 4, w, 54, null, '#000', Math.round((1.6 - t) / 0.4 * 16));
        F.draw(`Hail, ${p.name} of Darkwood!`, w >> 1, y + 52, P.c.bright, { align: 'center', outline: '#000' });
      }

      if (t > 3.6) {
        const ph = 168;
        const py = h - ph - 6;
        UI.panel(6, py, w - 12, ph, 'gold');
        let y = py + 8;
        const row = (k, v, col) => {
          F.draw(k, 16, y, P.c.dim, { shadow: true });
          F.draw(String(v), w - 16, y, col || P.c.bright, { align: 'right', shadow: true });
          y += 11;
        };
        row('Final level', p.level, P.c.gold);
        row('Creatures slain', `${Gm.totalDefeated()} / ${D.ENEMIES.length}`);
        row('Battles fought', S.stats.fights || 0);
        row('Blocks / parries', `${S.stats.blocks || 0} / ${S.stats.parries || 0}`);
        row('Gold', U.fmt(p.gold), P.c.gold);
        y += 3;
        F.drawWrapped('The North Gate stands open. Beyond it lie wild country, caves and dungeons... and far to the north, the black town of {red}Blackstone{/}, where something stirs beneath the waves.', 16, y, w - 32, P.c.text, { shadow: true });
        if (UI.button('end-ok', 14, py + ph - 28, w - 28, 22, 'RETURN TO DARKWOOD', { theme: 'gold', key: ['Enter', ' '] })) {
          S.flags.victorySeen = true;
          App.save();
          App.go('town');
        }
        if (t > 4.2) F.draw('TO BE CONTINUED', w >> 1, py - 12, Math.floor(t * 2) % 2 ? P.c.gold : P.c.orange, { align: 'center', outline: '#000' });
      }
    },
  });
})();
