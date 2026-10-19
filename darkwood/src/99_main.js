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

  let last = 0;
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - (last || now)) / 1000));
    last = now;
    UI.beginFrame();
    FX.update(dt);
    let gameDt = dt;
    if (FX.hitstop > 0) { FX.hitstop -= dt; gameDt = 0; }
    else if (FX.slowmo > 0) gameDt = dt * 0.4;
    G.clear('#000');
    App.frame(dt, gameDt);
    UI.drawToasts(App.name === 'combat' ? 40 : App.HUD_H + 4);
    FX.drawFlash();
    FX.updateWipe(dt);
    FX.drawWipe();
    UI.endFrame();
    requestAnimationFrame(frame);
  }

  DW.main = () => {
    const canvas = document.getElementById('screen');
    G.init(canvas, document.getElementById('wrap'));
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
