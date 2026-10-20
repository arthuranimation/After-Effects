// Plays a few rounds of bone dice and screenshots the table.
export default async function (api) {
  await api.eval(() => { DW.game.clearSave(); DW.game.newGame(); DW.state.p.gold = 500; DW.app.go('inn', {}, { instant: true }); });
  await api.wait(300);
  await api.eval(() => DW.app.go('dice', {}, { instant: true }));
  await api.wait(300);
  for (let r = 0; r < 6; r++) {
    await api.key('Enter'); await api.wait(1000);                       // roll
    const ph = await api.eval(() => DW.app.name);
    if (r === 0) await api.shot('after-first-roll');
    await api.key('Enter'); await api.wait(1000);                       // re-roll (or roll again if done)
  }
  await api.shot('dice-result');
  console.log('gold after 6 rounds:', await api.eval(() => DW.state.p.gold), 'net:', await api.eval(() => DW.state.stats.diceNet));
}
