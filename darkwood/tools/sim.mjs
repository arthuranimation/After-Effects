#!/usr/bin/env node
// Headless balance simulator: plays whole games with a scripted player
// using the real data, state and combat code.
//
//   node tools/sim.mjs [runs=40] [skill=avg|novice|expert|all]
//
// Skill = how often the bot guards the right side, and how often a correct
// guard is timed as a parry.
import fs from 'fs';
import path from 'path';
import url from 'url';
import vm from 'vm';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const src = f => fs.readFileSync(path.join(here, '..', 'src', f), 'utf8');

const SKILLS = {
  novice: { block: 0.55, parry: 0.1, feintPenalty: 0.2 },
  avg: { block: 0.75, parry: 0.3, feintPenalty: 0.15 },
  expert: { block: 0.92, parry: 0.55, feintPenalty: 0.08 },
};

function makeWorld() {
  const store = {};
  const ctx = {
    console, Math, JSON, Date,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['00_boot.js', '10_data.js', '11_state.js', '12_combat.js']) vm.runInContext(src(f), ctx, { filename: f });
  return ctx.DW;
}

function playGame(DW, skill, log = false) {
  const { game: Gm, state: S, data: D, combat: C } = DW;
  Gm.newGame();
  const p = () => S.p;
  const out = { fights: 0, losses: 0, flees: 0, perEnemy: {}, finished: false, levelAtDragon: 0, goldSpent: 0, firstWinFight: {} };
  let consecutiveLosses = 0;

  const shop = () => {
    // best weapon by expected damage after armour of the current frontier foe, nudged by speed
    const frontier = D.ENEMIES.find(e => Gm.enemyUnlocked(e) && !p().defeated[e.name]) || D.ENEMIES[19];
    const score = w => {
      const t = (w.trait || '').split(' ');
      const crush = t[0] === 'crush' ? +t[1] : 0;
      const avg = (w.damage_min + w.damage_max) / 2 + Gm.damageBonus();
      return Math.max(1, avg - Math.max(0, frontier.armor - crush)) * (1 + w.speed * 0.06) * (t[0] === 'holy' ? 1.15 : 1);
    };
    const curW = Gm.weaponData();
    const bestW = D.WEAPONS.filter(w => Gm.weaponPrice(w) <= p().gold - 60 && score(w) > score(curW) * 1.08).sort((a, b) => score(b) - score(a))[0];
    if (bestW) { out.goldSpent += Gm.weaponPrice(bestW); Gm.buyWeapon(bestW.name); }
    for (const type of ['armor', 'ring']) {
      const cur = type === 'armor' ? Gm.armorData() : Gm.ringData();
      const best = D.ITEMS.filter(i => i.type === type && i.value > (cur ? cur.value : 0) && Gm.itemPrice(i) <= p().gold - 80).sort((a, b) => b.value - a.value)[0];
      if (best) { out.goldSpent += Gm.itemPrice(best); Gm.buyItem(best.name); }
    }
    // keep a few potions sized to max HP
    const potion = p().maxHp > 120 ? 'Greater Healing Potion' : 'Healing Potion';
    const want = p().level >= 4 ? 3 : 2;
    while ((p().potions[potion] || 0) < want && Gm.itemPrice(Gm.itemData(potion)) <= p().gold - 20) { out.goldSpent += Gm.itemData(potion).cost; Gm.buyItem(potion); }
    for (const t of ['Tome of Strength', 'Tome of Dexterity', 'Tome of Constitution']) {
      const it = Gm.itemData(t);
      if (!p().tomes[t] && p().gold > it.cost + 1500) { out.goldSpent += it.cost; Gm.buyItem(t); }
    }
  };

  const levelChoices = () => {
    while (p().pendingLevels.length) {
      const lv = p().pendingLevels[0];
      const m = Gm.masteryOptions();
      const pref = ['fireball', 'double_slash', 'shatter', 'ultra_strength', 'rallying_cry'].find(id => m.includes(id));
      if (lv % 3 === 0 && pref) Gm.chooseLevelReward('mastery', pref);
      else if (lv % 3 === 1) Gm.chooseLevelReward('arcane');
      else Gm.chooseLevelReward('vitality');
    }
    // equip the most useful abilities
    const prefer = ['fireball', 'shatter', 'ultra_strength', 'double_slash', 'rallying_cry', 'icy_rain', 'riposte', 'speed_warrior', 'vanish'];
    p().slots = prefer.filter(id => p().learned[id]).slice(0, D.SLOTS);
  };

  const fight = (name) => {
    C.start(name, 0);
    const c = S.combat;
    let guardDir;
    let safety = 0;
    while (!c.over && safety++ < 500) {
      const t = C.next();
      if (t.type === 'player') {
        const hpPct = p().hp / p().maxHp;
        const pot = Object.keys(p().potions).find(n => Gm.itemData(n).type === 'potion' && p().potions[n] > 0);
        if (hpPct < 0.35 && pot) { C.act('potion', pot); continue; }
        const can = id => p().slots.includes(id) && C.canAct('ability', id);
        const shattered = c.est.some(s => s.type === 'shatter');
        const powered = c.pst.some(s => s.type === 'power');
        if (can('shatter') && !shattered && c.enemy.armor >= 3 && c.ehp > c.emax * 0.4) C.act('ability', 'shatter');
        else if (can('ultra_strength') && !powered && c.ehp > c.emax * 0.4) C.act('ability', 'ultra_strength');
        else if (can('fireball') && !c.est.some(s => s.type === 'burn')) C.act('ability', 'fireball');
        else if (can('rallying_cry') && hpPct < 0.45) C.act('ability', 'rallying_cry');
        else if (can('double_slash') && p().mp >= Gm.abilityCost('double_slash') + 4) C.act('ability', 'double_slash');
        else C.act('attack');
      } else if (t.type === 'enemy') {
        let a = t.attack;
        for (;;) {
          let pb = skill.block - (a.feintAt ? skill.feintPenalty : 0);
          if (a.isCombo) pb -= 0.1;
          const right = Math.random() < pb;
          guardDir = right ? a.final : [-1, 0, 1].filter(d => d !== a.final)[Math.floor(Math.random() * 2)];
          const ms = right && Math.random() < skill.parry ? a.parry / 2 : a.parry + 200;
          const r = C.resolveAttack(guardDir, ms);
          if (r.combo) { a = r.combo; continue; }
          break;
        }
      }
      c.events.length = 0;
    }
    return C.finish();
  };

  let guard = 0;
  while (guard++ < 600) {
    shop();
    levelChoices();
    if (p().hp < p().maxHp * 0.85 || p().mp < p().maxMp * 0.5) {
      const r = Gm.rest();
      if (r && r.offer) Gm.acceptQuest(r.offer);
      if (!r.ok) Gm.stables();
    }
    // pick a target: next undefeated unlocked foe; after losses, grind the toughest beaten one
    const unlocked = D.ENEMIES.filter(e => Gm.enemyUnlocked(e));
    let target = unlocked.find(e => !p().defeated[e.name]);
    if (!target) { out.finished = true; break; }
    if (consecutiveLosses >= 2) {
      // grind something safely beatable: the best-paying beaten foe a ring below the frontier
      const beaten = unlocked.filter(e => p().defeated[e.name] && e.tier < target.tier);
      const pool = beaten.length ? beaten : unlocked.filter(e => p().defeated[e.name]);
      if (pool.length) target = pool[pool.length - 1 - (consecutiveLosses % Math.min(3, pool.length))];
    }
    if (target.name === 'Red Dragon' && !out.levelAtDragon) { out.levelAtDragon = p().level; out.gearAtDragon = p().weapon + ' / ' + (p().armor || '-') + ' / ' + (p().ring || '-'); }
    const sum = fight(target.name);
    out.fights++;
    out.perEnemy[target.name] = out.perEnemy[target.name] || { tries: 0, losses: 0 };
    out.perEnemy[target.name].tries++;
    if (sum.result === 'win') {
      consecutiveLosses = 0;
      if (!out.firstWinFight[target.name]) out.firstWinFight[target.name] = { fight: out.fights, level: p().level };
      if (target.name === 'Red Dragon') { out.finished = true; break; }
    } else {
      out.losses++; consecutiveLosses++;
      out.perEnemy[target.name].losses++;
    }
    levelChoices();
  }
  out.level = p().level;
  out.gold = p().gold;
  out.maxHp = p().maxHp;
  return out;
}

const runs = parseInt(process.argv[2] || '40', 10);
const which = process.argv[3] || 'all';
for (const sk of (which === 'all' ? Object.keys(SKILLS) : [which])) {
  const DW = makeWorld();
  const results = [];
  for (let i = 0; i < runs; i++) results.push(playGame(DW, SKILLS[sk]));
  const avg = k => (results.reduce((s, r) => s + r[k], 0) / results.length).toFixed(1);
  const done = results.filter(r => r.finished).length;
  console.log(`\n=== ${sk}: ${done}/${runs} finished · fights ${avg('fights')} · losses ${avg('losses')} · final level ${avg('level')} · level at dragon ${avg('levelAtDragon')} · maxHp ${avg('maxHp')}`);
  const names = DW.data.ENEMIES.map(e => e.name);
  const rows = names.map(n => {
    const tries = results.reduce((s, r) => s + (r.perEnemy[n] ? r.perEnemy[n].tries : 0), 0);
    const losses = results.reduce((s, r) => s + (r.perEnemy[n] ? r.perEnemy[n].losses : 0), 0);
    const fw = results.filter(r => r.firstWinFight[n]);
    const lvl = fw.length ? (fw.reduce((s, r) => s + r.firstWinFight[n].level, 0) / fw.length).toFixed(1) : '-';
    return `${n.padEnd(11)} tries ${(tries / runs).toFixed(1).padStart(5)}  lossRate ${(tries ? losses / tries * 100 : 0).toFixed(0).padStart(3)}%  firstWin@lvl ${lvl}`;
  });
  console.log(rows.join('\n'));
  const gear = {}; results.forEach(r => { gear[r.gearAtDragon] = (gear[r.gearAtDragon] || 0) + 1; });
  console.log('gear at dragon:', Object.entries(gear).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g, n]) => `${g} ×${n}`).join(' | '));
}
