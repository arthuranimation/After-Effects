// Plays real fights through the UI: attacks with the keyboard, blocks by reading the tell.
// Usage: --scenario tools/scenarios/fight.mjs  (env FOE=Goblin, PARRY=1 to time parries late)
export default async function (api) {
  const foe = process.env.FOE || 'Goblin';
  await api.wait(300);
  await api.eval(foe => {
    const G = DW.game; G.clearSave(); G.newGame();
    const p = DW.state.p; p.level = 6; p.maxHp = 80; p.hp = 80; p.maxMp = 30; p.mp = 30;
    p.weapon = 'Longsword'; p.armor = 'Chain Mail';
    p.learned = { double_slash: 2, fireball: 1, icy_rain: 1, shatter: 1 }; p.slots = ['double_slash', 'fireball', 'shatter'];
    p.potions = { 'Healing Potion': 2 }; p.wands = { 'Fire Wand': 2 };
    DW.app.go('combat', { enemy: foe, streak: 0 }, { instant: true });
  }, foe);
  let shots = 0, windupShots = 0, turns = 0;
  for (let i = 0; i < 400; i++) {
    const s = await api.eval(() => {
      const c = DW.state.combat;
      return { over: c.over, pending: c.pending ? { dir: c.pending.final, windup: c.pending.windup, feint: c.pending.feintAt } : null, modals: DW.app.modals.length, mp: DW.state.p.mp, hp: DW.state.p.hp };
    });
    if (s.modals) { await api.wait(400); await api.shot('result'); break; }
    if (s.pending) {
      if (windupShots < 2) { await api.wait(Math.round(s.pending.windup * 0.5)); await api.shot('windup-' + windupShots++); }
      if (s.pending.feint) await api.wait(s.pending.feint + 40);
      const re = await api.eval(() => { const c = DW.state.combat; return c.pending ? c.pending.final : null; });
      if (re !== null) {
        if (process.env.PARRY) await api.wait(Math.max(0, s.pending.windup * 0.8 - 300));
        await api.key(re < 0 ? 'ArrowLeft' : re > 0 ? 'ArrowRight' : 'ArrowUp');
      }
      await api.wait(150);
      continue;
    }
    // player's turn? try actions in rotation
    const k = turns % 4 === 1 && s.mp >= 10 ? ['2', '2'] : turns % 4 === 3 ? ['3', '1'] : ['1'];
    for (const key of k) await api.key(key);
    turns++;
    if (shots < 3 && turns % 2 === 0) await api.shot('turn-' + shots++);
    await api.wait(250);
  }
  const log = await api.eval(() => DW.state.combat.log.map(l => l.text).slice(-12).join('\n'));
  console.log('--- combat log tail ---\n' + log);
}
