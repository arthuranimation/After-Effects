// Smoke test of the whole flow + robustness + rough performance (text output only).
// 1) taps NEW GAME with a pointer that gets cancelled (as some in-app viewers do)
// 2) intro → town → arena → fight (blocking from the tell) → result → level-ups
// 3) an injected draw error must show a message, not freeze the game
// 4) frame times with the CPU throttled 4x on title / town / combat
export default async function (api) {
  const page = api.page;
  const log = (...a) => console.log('[flow]', ...a);
  await api.eval(() => { localStorage.clear(); DW.app.go('title', {}, { instant: true }); });
  await api.wait(400);
  // NEW GAME button centre in logical coords (see 32_screens_town.js)
  const pos = await api.eval(() => {
    const w = DW.gfx.w, h = DW.gfx.h, bw = Math.min(180, w - 40);
    return { x: Math.floor((w - bw) / 2) + bw / 2, y: Math.round(h * 0.64) + 13 };
  });
  await api.eval(({ x, y }) => {
    const c = DW.gfx.canvas, r = c.getBoundingClientRect();
    const cx = r.left + (x + 0.5) * r.width / DW.gfx.w, cy = r.top + (y + 0.5) * r.height / DW.gfx.h;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, pointerId: 7, pointerType: 'touch', bubbles: true }));
    setTimeout(() => c.dispatchEvent(new PointerEvent('pointercancel', { clientX: 0, clientY: 0, pointerId: 7, pointerType: 'touch', bubbles: true })), 60);
  }, pos);
  await api.wait(800);
  log('after cancelled tap on NEW GAME → screen:', await api.eval(() => DW.app.name), 'modals:', await api.eval(() => DW.app.modals.length));
  await api.key('Enter'); await api.wait(300);                 // intro OK
  await api.key('1'); await api.wait(500);                     // ARENA
  log('screen:', await api.eval(() => DW.app.name));
  await api.key('Enter'); await api.wait(1600);                // FIGHT (Giant Rat)
  log('screen:', await api.eval(() => DW.app.name), 'foe:', await api.eval(() => DW.state.combat && DW.state.combat.enemy.name));
  for (let i = 0; i < 300; i++) {
    const s = await api.eval(() => { const c = DW.state.combat; return { over: c.over, pend: c.pending ? c.pending.final : null, feint: c.pending ? c.pending.feintAt : 0, modals: DW.app.modals.length }; });
    if (s.modals) break;
    if (s.pend !== null) {
      if (s.feint) await api.wait(s.feint + 40);
      const d = await api.eval(() => DW.state.combat.pending ? DW.state.combat.pending.final : null);
      if (d !== null) await api.key(d < 0 ? 'ArrowLeft' : d > 0 ? 'ArrowRight' : 'ArrowUp');
      await api.wait(120); continue;
    }
    await api.key('1'); await api.wait(200);
  }
  log('fight over:', await api.eval(() => DW.state.combat.result), 'saved level:', await api.eval(() => JSON.parse(localStorage.getItem('darkwood_save')).player.level));
  await api.key('Enter'); await api.wait(500);                 // BACK TO THE ARENA → level-up dialog(s)
  for (let i = 0; i < 4 && await api.eval(() => DW.app.modals.length); i++) { await api.key('1'); await api.wait(300); }
  log('after result:', await api.eval(() => DW.app.name), 'pending levels:', await api.eval(() => DW.state.p.pendingLevels.length), 'level:', await api.eval(() => DW.state.p.level));
  // injected error → on-screen message, loop keeps running
  await api.eval(() => { const s = DW.app.screens.arena, d = s.draw; s.draw = function () { if (!window.__boomed) { window.__boomed = 1; throw new Error('test boom'); } return d.apply(this, arguments); }; });
  await api.wait(300);
  const t0 = await api.eval(() => DW.app.t); await api.wait(300); const t1 = await api.eval(() => DW.app.t);
  log('loop alive after error:', t1 > t0);
  await api.shot('error-overlay');
  // performance
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (const [name, go] of [['title', "DW.app.go('title',{}, {instant:true})"], ['town', "DW.app.go('town',{}, {instant:true})"], ['combat', "DW.app.go('combat',{enemy:'Red Dragon'}, {instant:true})"]]) {
    await api.eval(g => { eval(g); }, go);
    await api.wait(1200);
    const ms = await api.eval(() => new Promise(res => { const ts = []; let n = 0; const f = t => { ts.push(t); if (++n < 90) requestAnimationFrame(f); else res(ts); }; requestAnimationFrame(f); }));
    const d = ms.slice(1).map((t, i) => t - ms[i]).sort((a, b) => a - b);
    log(`perf 4x CPU ${name}: median ${d[d.length >> 1].toFixed(1)} ms, p95 ${d[Math.floor(d.length * 0.95)].toFixed(1)} ms`);
  }
}
