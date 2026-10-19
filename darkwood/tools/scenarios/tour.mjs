// A quick tour of every screen (used for visual review and smoke testing).
export default async function (api) {
  await api.wait(600);
  await api.shot('title');
  // new game
  await api.eval(() => { DW.game.clearSave(); DW.game.newGame(); DW.state.p.gold = 900; DW.game.save(); DW.app.go('town', {}, { instant: true }); });
  await api.wait(500);
  await api.shot('town');
  for (const s of ['smithy', 'apothecary', 'inn', 'arena', 'hero']) {
    await api.eval(n => DW.app.go(n, {}, { instant: true }), s);
    await api.wait(400);
    await api.shot(s);
  }
  await api.eval(() => { DW.app.go('hero', {}, { instant: true }); });
  await api.wait(200);
  // skills tab
  const { w } = await api.size();
  await api.tap(Math.round(42 + (w - 46) / 2), 30 + 4 + 10);
  await api.wait(300);
  await api.shot('hero-skills');
  await api.tap(Math.round(42 + (w - 46) * 5 / 6), 30 + 4 + 10);
  await api.wait(300);
  await api.shot('hero-bestiary');
  // combat
  await api.eval(() => DW.app.go('combat', { enemy: 'Goblin', streak: 0 }, { instant: true }));
  await api.wait(500);
  await api.shot('combat-intro');
  await api.wait(1500);
  await api.shot('combat-turn');
}
