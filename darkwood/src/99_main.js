// ================================================================
// MAIN — boot the canvas, input and audio, then run the frame loop.
// ================================================================
(() => {
  const G = DW.gfx, UI = DW.ui, FX = DW.fx, App = DW.app, Gm = DW.game, S = DW.state;

  // Remember the wanted track so it can start once audio is unlocked by a tap.
  App.music = name => {
    App.wantMusic = name;
    if (DW.audio && DW.audio.music) DW.audio.music(name);
  };

  // A thrown error must never stop the loop (that freezes the game on one
  // frame). Errors are shown on screen so a player can report them.
  let last = 0, crash = null;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - (last || now)) / 1000));
    last = now;
    try {
      UI.beginFrame();
      if (G.rotateHint) { drawRotateHint(); UI.endFrame(); return; }
      FX.update(dt);
      let gameDt = dt;
      if (FX.hitstop > 0) { FX.hitstop -= dt; gameDt = 0; }
      else if (FX.slowmo > 0) gameDt = dt * 0.4;
      G.clear('#000');
      G.ctx.save();
      App.frame(dt, gameDt);
      G.ctx.restore();
      UI.drawToasts(App.name === 'combat' ? 56 : App.HUD_H + 24);
      FX.drawFlash();
      FX.updateWipe(dt);
      FX.drawWipe();
      if (crash) drawCrash();
      UI.endFrame();
    } catch (e) {
      try { G.ctx.restore(); } catch (_) { /* ignore */ }
      if (!crash) console.error(e);
      crash = { msg: String(e && e.message || e).slice(0, 160), where: App.name, t: performance.now() };
      try { drawCrash(); UI.endFrame(); } catch (_) { /* ignore */ }
    }
  }

  function drawCrash() {
    const F = DW.font;
    if (performance.now() - crash.t > 8000) { crash = null; return; }
    const lines = F.wrap(`Something went wrong on the ${crash.where} screen: ${crash.msg}`, G.w - 20);
    const h = lines.length * 10 + 8;
    G.rect(4, G.h - h - 4, G.w - 8, h, '#300');
    G.frame(4, G.h - h - 4, G.w - 8, h, '#f65');
    lines.forEach((ln, i) => F.draw(ln, 10, G.h - h + i * 10, '#ffe'));
  }

  function drawRotateHint() {
    const F = DW.font;
    G.clear('#000');
    F.big('DARKWOOD', G.w >> 1, (G.h >> 1) - 30, { scale: 2, ramp: 'gold', align: 'center' });
    F.draw('Please turn your phone upright', G.w >> 1, (G.h >> 1) + 2, '#ddc', { align: 'center' });
    F.draw('to play.', G.w >> 1, (G.h >> 1) + 13, '#ddc', { align: 'center' });
  }

  DW.main = () => {
    const canvas = document.getElementById('screen');
    G.init(canvas, document.getElementById('wrap'));
    Gm.loadSettings();
    UI.init(canvas);
    UI.onFirstGesture = () => {
      if (DW.audio && DW.audio.unlock) DW.audio.unlock();
      if (App.wantMusic !== undefined) App.music(App.wantMusic);
      UI.onFirstGesture = () => { if (DW.audio && DW.audio.unlock) DW.audio.unlock(); };
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (S.p && App.name !== 'title' && App.name !== 'combat') Gm.save(); }
      else if (DW.audio && DW.audio.unlock) DW.audio.unlock();
    });
    App.go('title', {}, { instant: true });
    requestAnimationFrame(frame);
  };

  if (!window.DW_NO_START) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', DW.main);
    else DW.main();
  }
})();
