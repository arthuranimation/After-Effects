// ================================================================
// COMBAT ENGINE — initiative, attacks, blocking, abilities, statuses.
// Pure logic. It never draws or waits: the combat screen drives it
//   next()            → { type: 'player' | 'enemy' | 'skip' | 'over' }
//   act(kind, arg)    → the player's action
//   resolveAttack(guardDir, guardMsBeforeStrike) → the enemy's blow lands
// and plays the events it queues in c.events (damage numbers, sounds,
// animations). The same code runs in the headless balance simulator.
// ================================================================
(() => {
  const D = DW.data, U = DW.util, Gm = DW.game, S = DW.state;
  const C = DW.combat = {};

  const ev = (c, e) => { c.events.push(e); if (e.t === 'log') c.log.push(e); };
  const say = (c, text, col = 'text') => ev(c, { t: 'log', text, col });

  // ---------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------
  C.start = (enemyName, streak = 0) => {
    const e = Gm.enemyData(enemyName);
    const pS = Gm.speed(), eS = e.speed;
    let pg, eg;
    if (pS > eS) { pg = 100; eg = Math.round(eS / pS * 100); }
    else if (eS > pS) { eg = 100; pg = Math.round(pS / eS * 100); }
    else { pg = Math.random() < 0.5 ? 100 : 99; eg = pg === 100 ? 99 : 100; }
    const hp = streak > 0 ? Math.round(e.hp * 1.25) : e.hp;
    const c = S.combat = {
      enemy: e, streak,
      lives: streak + 1, livesLeft: streak + 1,
      ehp: hp, emax: hp,
      pg, eg, over: false, result: null, rewards: null,
      pst: [], est: [],           // statuses: { type, turns, ...data, fresh }
      petrified: false,
      last: null, turnNo: 0,
      pending: null,              // the enemy attack being wound up
      log: [], events: [],
      dealt: 0, taken: 0, blocks: 0, parries: 0,
    };
    S.stats.fights = (S.stats.fights || 0) + 1;
    if (streak === 0) {
      say(c, `The ${e.name} stands before you.`, 'dim');
    } else {
      say(c, `The ${e.name} returns, angrier. It has ${c.lives} lives this time.`, 'red');
    }
    say(c, (pg >= eg ? 'You have' : `The ${e.name} has`) + ' the initiative.', 'dim');
    return c;
  };

  // ---------------------------------------------------------------
  // Speeds & multipliers
  // ---------------------------------------------------------------
  const st = (arr, type) => arr.find(s => s.type === type);
  const addSt = (arr, s) => { const i = arr.findIndex(x => x.type === s.type); if (i >= 0) arr.splice(i, 1); arr.push(s); };
  const dropSt = (arr, type) => { const i = arr.findIndex(x => x.type === type); if (i >= 0) arr.splice(i, 1); };

  C.enemySpeed = (c = S.combat) => {
    let spd = c.enemy.speed;
    const sl = st(c.est, 'slow'); if (sl) spd *= 1 - sl.pct;
    const sh = st(c.est, 'shatter');
    if (sh && sh.spdPct) return Math.max(1, Math.min(Math.round(spd) - 1, Math.floor(spd * (1 - sh.spdPct))));
    return Math.max(1, Math.round(spd));
  };

  C.playerSpeed = (c = S.combat) => {
    let spd = Gm.speed();
    if (!c) return spd;
    const su = st(c.pst, 'surge'); if (su) spd = Math.max(spd, C.enemySpeed(c) + 1);
    if (st(c.pst, 'exhaust')) spd = Math.max(1, Math.round(spd * 0.67));
    return spd;
  };

  const playerDamageMult = c => {
    let m = 1;
    const pw = st(c.pst, 'power'); if (pw) m *= pw.mult;
    const su = st(c.pst, 'surge'); if (su && su.bonus) m *= 1 + su.bonus;
    return m;
  };

  const enemyArmor = (c, pierce = 0) => {
    let a = c.enemy.armor;
    const sh = st(c.est, 'shatter'); if (sh) a *= 1 - sh.armorPct;
    a *= 1 - pierce;
    const t = Gm.trait();
    if (t.kind === 'crush') a -= t.n;
    return Math.max(0, Math.round(a));
  };

  const takenMult = c => { const sh = st(c.est, 'shatter'); return sh ? 1 + sh.taken : 1; };
  const holyMult = c => (Gm.trait().kind === 'holy' && (c.enemy.kind === 'undead' || c.enemy.kind === 'fiend') ? 1.5 : 1);

  // One weapon blow. Returns { dmg, crit }.
  C.weaponHit = (c, mult = 1, opts = {}) => {
    const w = Gm.weaponData();
    let raw = U.rand(w.damage_min, w.damage_max) + Gm.damageBonus();
    const crit = !opts.noCrit && Math.random() < Gm.critChance();
    if (crit) raw *= 2;
    let dmg = Math.max(1, raw - enemyArmor(c, opts.pierce || 0));
    dmg = dmg * mult * playerDamageMult(c) * takenMult(c) * holyMult(c);
    return { dmg: Math.max(1, Math.round(dmg)), crit };
  };

  // Damage to the enemy; returns true if it died (or lost a life).
  const hurtEnemy = (c, dmg, src = 'melee', crit = false) => {
    dmg = Math.max(0, Math.round(dmg));
    c.ehp -= dmg; c.dealt += dmg;
    if (crit) S.stats.crits = (S.stats.crits || 0) + 1;
    ev(c, { t: 'eDamage', dmg, crit, src });
    return checkEnemy(c);
  };

  const checkEnemy = c => {
    if (c.ehp > 0) return false;
    c.livesLeft--;
    if (c.livesLeft > 0) {
      const hp = Math.round(c.enemy.hp * 1.5);
      c.ehp = hp; c.emax = hp;
      c.eg = 100; c.pg = Math.min(c.pg, 50); c.last = null;
      c.est = c.est.filter(s => s.type === 'shatter');
      say(c, `The ${c.enemy.name} staggers... and rises again! (${c.livesLeft} ${c.livesLeft === 1 ? 'life' : 'lives'} left)`, 'red');
      ev(c, { t: 'enemyRise' });
      return true;
    }
    c.ehp = 0;
    say(c, `The ${c.enemy.name} collapses. Victory!`, 'gold');
    ev(c, { t: 'enemyDie' });
    end(c, 'win');
    return true;
  };

  const hurtPlayer = (c, dmg) => {
    const p = S.p;
    p.hp = Math.max(0, p.hp - dmg);
    c.taken += dmg;
    if (p.hp <= 0) {
      say(c, 'You have fallen in battle.', 'red');
      ev(c, { t: 'playerDie' });
      end(c, 'lose');
      return true;
    }
    return false;
  };

  const end = (c, result) => { c.over = true; c.result = result; c.pending = null; };

  // ---------------------------------------------------------------
  // Turn order
  // ---------------------------------------------------------------
  // Who acts next, without changing anything (for the turn-order strip).
  C.preview = (n = 5, c = S.combat) => {
    if (!c) return [];
    let pg = c.pg, eg = c.eg;
    const pS = C.playerSpeed(c), eS = C.enemySpeed(c);
    const out = [];
    for (let i = 0; i < n; i++) {
      while (pg < 100 && eg < 100) { pg += pS; eg += eS; }
      const who = pick(pg, eg, pS, eS);
      out.push(who);
      if (who === 'p') pg -= 100; else eg -= 100;
    }
    return out;
  };
  const pick = (pg, eg, pS, eS) => {
    if (pg >= 100 && eg >= 100) return pg > eg ? 'p' : eg > pg ? 'e' : (eS > pS ? 'e' : 'p');
    return pg >= 100 ? 'p' : 'e';
  };

  C.next = () => {
    const c = S.combat;
    if (!c || c.over) return { type: 'over' };
    const pS = C.playerSpeed(c), eS = C.enemySpeed(c);
    while (c.pg < 100 && c.eg < 100) { c.pg += pS; c.eg += eS; }
    const who = pick(c.pg, c.eg, pS, eS);
    c.turnNo++;

    if (who === 'e') {
      c.eg -= 100;
      if (c.last === 'e') say(c, `The ${c.enemy.name} moves with terrifying speed — again!`, 'orange');
      c.last = 'e';
      // start-of-turn effects
      const burn = st(c.est, 'burn');
      if (burn) {
        say(c, `The ${c.enemy.name} burns for ${burn.value}.`, 'orange');
        if (hurtEnemy(c, burn.value, 'burn')) return c.over ? { type: 'over' } : { type: 'skip', who: 'enemy' };
        burn.value = Math.max(1, Math.floor(burn.value * burn.decay));
        if (--burn.turns <= 0) dropSt(c.est, 'burn');
      }
      const frost = st(c.est, 'frost');
      if (frost) {
        say(c, `Frostbite gnaws at the ${c.enemy.name} for ${frost.value}.`, 'ice');
        if (hurtEnemy(c, frost.value, 'frost')) return c.over ? { type: 'over' } : { type: 'skip', who: 'enemy' };
      }
      if (c.enemy.special === 'regen') {
        if (st(c.est, 'burn')) {
          say(c, `The flames stop the ${c.enemy.name}'s wounds from closing!`, 'orange');
        } else if (c.ehp < c.emax) {
          const r = Math.min(c.emax - c.ehp, Math.max(1, Math.floor(c.enemy.hp * 0.05)));
          c.ehp += r;
          say(c, `The ${c.enemy.name} regenerates ${r} HP.`, 'green');
          ev(c, { t: 'regen', amount: r });
        }
      }
      if (st(c.est, 'stun')) {
        dropSt(c.est, 'stun');
        say(c, `The ${c.enemy.name} is stunned and loses its turn!`, 'green');
        ev(c, { t: 'stun', who: 'enemy' });
        endEnemyTurn(c);
        return { type: 'skip', who: 'enemy' };
      }
      c.pending = makeAttack(c, false);
      return { type: 'enemy', attack: c.pending };
    }

    c.pg -= 100;
    if (c.petrified) {
      c.petrified = false;
      dropSt(c.pst, 'petrify');
      say(c, 'You are petrified and cannot move!', 'red');
      ev(c, { t: 'stun', who: 'player' });
      c.last = 'p';
      endPlayerTurn(c);
      return { type: 'skip', who: 'player' };
    }
    if (c.last === 'p') say(c, 'You move with superior speed — you act again!', 'green');
    c.last = 'p';
    return { type: 'player' };
  };

  // ---------------------------------------------------------------
  // Enemy attacks: direction, wind-up length, feints and combos.
  // ---------------------------------------------------------------
  const DIRS = [-1, 0, 1];
  const pickDir = (m, avoid) => {
    const ws = [m.L, m.H, m.R].map((w, i) => (DIRS[i] === avoid ? 0 : w));
    const total = ws.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * total;
    for (let i = 0; i < 3; i++) { r -= ws[i]; if (r < 0) return DIRS[i]; }
    return 0;
  };

  C.windupMs = (c = S.combat) => {
    const spd = C.enemySpeed(c);
    let ms = U.clamp(1750 - (spd - 4) * 85, 700, 1800) * (1 - 0.05 * (c.enemy.tier - 1));
    if (S.settings.assist) ms *= 1.4;
    return Math.round(ms);
  };

  const makeAttack = (c, isCombo, prevDir) => {
    const m = c.enemy.moves;
    const dir = pickDir(m, isCombo ? prevDir : undefined);
    let windup = C.windupMs(c);
    if (isCombo) windup = Math.round(windup * 0.6);
    const parry = Math.round(Math.max(200, windup * 0.28) * (S.settings.assist ? 1.3 : 1));
    const a = { dir, windup, parry, isCombo, combo: false, feintAt: 0, feintDir: dir, breath: false };
    if (!isCombo && Math.random() < (m.combo || 0)) a.combo = true;
    if (!isCombo && Math.random() < (m.feint || 0)) {
      a.feintAt = Math.round(windup * 0.45);
      a.feintDir = pickDir(m, dir);
    }
    a.final = a.feintAt ? a.feintDir : dir;
    a.breath = c.enemy.special === 'fire' && a.final === 0 && (c.enemy.kind === 'dragon' || Math.random() < 0.5);
    return a;
  };

  // guardDir: -1/0/1 or null (never blocked). guardMs: ms before the strike
  // that the final guard input happened (smaller = later = parry).
  // Returns { combo: attack } when a follow-up strike begins, else {}.
  C.resolveAttack = (guardDir, guardMs = 9999) => {
    const c = S.combat;
    if (!c || c.over || !c.pending) return {};
    const a = c.pending;
    const e = c.enemy, p = S.p;
    const dir = a.final;
    const blocked = guardDir !== null && guardDir !== undefined && guardDir === dir;
    const parried = blocked && guardMs <= a.parry && !a.breath;

    const roll = U.rand(e.damage_min, e.damage_max);
    const def = Gm.defense();
    let dmg = Math.max(1, roll - (e.special === 'fire' ? Math.floor(def / 4) : Math.floor(def / 2)));
    if (st(c.pst, 'exhaust')) dmg = Math.round(dmg * 1.25);
    const what = a.breath ? 'breathes fire on you' : 'strikes you';

    const rip = st(c.pst, 'riposte');
    if (parried) {
      c.parries++; S.stats.parries = (S.stats.parries || 0) + 1;
      p.mp = Math.min(p.maxMp, p.mp + 2);
      c.pg += 25;
      say(c, 'PARRY! You turn the blow aside completely. (+2 MP)', 'gold');
      ev(c, { t: 'parry', dir });
      ev(c, { t: 'pDamage', dmg: 0, blocked: true, parried: true, dir });
    } else if (blocked) {
      c.blocks++; S.stats.blocks = (S.stats.blocks || 0) + 1;
      dmg = Math.max(1, Math.round(dmg * (a.breath ? 0.35 : 0.2)));
      p.mp = Math.min(p.maxMp, p.mp + 1);
      say(c, `Blocked! Only ${dmg} damage gets through. (+1 MP)`, 'green');
      ev(c, { t: 'block', dir });
      ev(c, { t: 'pDamage', dmg, blocked: true, parried: false, dir });
      if (hurtPlayer(c, dmg)) return {};
    } else {
      say(c, `The ${e.name} ${what} for ${dmg}${guardDir !== null && guardDir !== undefined ? ' — wrong side!' : '.'}`, 'red');
      ev(c, { t: 'pDamage', dmg, blocked: false, parried: false, dir, breath: a.breath });
      if (hurtPlayer(c, dmg)) return {};
      if (e.special === 'drain' && Math.random() < 0.3 && p.xp > 0) {
        const lost = Math.max(1, Math.floor(p.xp * 0.1));
        p.xp -= lost;
        say(c, `Its touch drains ${lost} XP from you!`, 'purple');
        ev(c, { t: 'drain', amount: lost });
      }
      if (e.special === 'petrify' && Math.random() < 0.25) {
        c.petrified = true;
        addSt(c.pst, { type: 'petrify', turns: 1 });
        say(c, 'Its gaze meets yours. You are turning to stone!', 'red');
        ev(c, { t: 'status', who: 'player', type: 'petrify' });
      }
    }

    // Riposte: counter on a block, spent either way
    if (rip) {
      if (blocked) {
        const mult = [1.5, 1.75, 2, 2, 2.5][rip.rank - 1];
        const h = C.weaponHit(c, mult);
        say(c, `RIPOSTE! You counter for ${h.dmg}${h.crit ? ' (critical!)' : ''}.`, 'gold');
        ev(c, { t: 'counter' });
        if (rip.rank >= 4) addSt(c.est, { type: 'stun', turns: 1 });
        if (hurtEnemy(c, h.dmg, 'counter', h.crit)) { if (c.over) return {}; }
        if (--rip.charges <= 0) dropSt(c.pst, 'riposte');
      }
    }

    if (!c.over && a.combo && !a.isCombo) {
      c.pending = makeAttack(c, true, dir);
      say(c, `The ${e.name} strikes again!`, 'orange');
      return { combo: c.pending };
    }
    c.pending = null;
    endEnemyTurn(c);
    return {};
  };

  const endEnemyTurn = c => {
    for (const s of [...c.est]) {
      if (s.type === 'shatter' || s.type === 'burn' || s.type === 'stun') continue;
      if (s.fresh) { s.fresh = false; continue; }
      if (--s.turns <= 0) dropSt(c.est, s.type);
    }
  };

  const endPlayerTurn = c => {
    for (const s of [...c.pst]) {
      if (s.type === 'riposte' || s.type === 'petrify') continue;
      if (s.fresh) { s.fresh = false; continue; }
      if (--s.turns <= 0) {
        dropSt(c.pst, s.type);
        if (s.type === 'power' && s.exhaust > 0) {
          addSt(c.pst, { type: 'exhaust', turns: s.exhaust });
          say(c, `Your strength fades. You are exhausted for ${s.exhaust} turns.`, 'red');
          ev(c, { t: 'status', who: 'player', type: 'exhaust' });
        }
      }
    }
  };

  // ---------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------
  C.canAct = (kind, arg) => {
    const c = S.combat, p = S.p;
    if (!c || c.over || c.pending) return false;
    if (kind === 'ability') return p.slots.includes(arg) && p.mp >= Gm.abilityCost(arg);
    if (kind === 'potion') return (p.potions[arg] || 0) > 0;
    if (kind === 'wand') return (p.wands[arg] || 0) > 0;
    return true;
  };

  C.act = (kind, arg) => {
    const c = S.combat;
    if (!C.canAct(kind, arg)) return false;
    if (kind === 'attack') actAttack(c);
    else if (kind === 'ability') actAbility(c, arg);
    else if (kind === 'potion') actPotion(c, arg);
    else if (kind === 'wand') actWand(c, arg);
    else if (kind === 'flee') actFlee(c);
    if (!c.over) endPlayerTurn(c);
    return true;
  };

  const actAttack = c => {
    const h = C.weaponHit(c);
    ev(c, { t: 'pAttack' });
    say(c, `You strike the ${c.enemy.name} for ${h.dmg}${h.crit ? ' — critical!' : '.'}`, h.crit ? 'gold' : 'text');
    hurtEnemy(c, h.dmg, 'melee', h.crit);
  };

  const actPotion = (c, name) => {
    const p = S.p, item = Gm.itemData(name);
    p.potions[name]--;
    if (p.potions[name] <= 0) delete p.potions[name];
    ev(c, { t: 'drink' });
    if (item.type === 'mana') {
      const amt = Math.min(item.value, p.maxMp - p.mp);
      p.mp += amt;
      say(c, `You drink the ${name}. +${amt} MP.`, 'blue');
      ev(c, { t: 'mp', amount: amt });
    } else {
      const heal = item.value >= 999 ? p.maxHp : item.value;
      const amt = Math.min(heal, p.maxHp - p.hp);
      p.hp += amt;
      say(c, `You drink the ${name}. +${amt} HP.`, 'green');
      ev(c, { t: 'heal', amount: amt });
    }
  };

  const actWand = (c, name) => {
    const p = S.p, item = Gm.itemData(name);
    p.wands[name]--;
    if (p.wands[name] <= 0) delete p.wands[name];
    const spread = item.element === 'fire' ? 15 : 10;
    const dmg = Math.round(U.rand(item.value - spread, item.value + spread) * takenMult(c));
    ev(c, { t: 'cast', id: item.element === 'fire' ? 'wand_fire' : 'wand_lightning' });
    if (item.element === 'fire') {
      say(c, `Your Fire Wand erupts for ${dmg}!`, 'orange');
      if (hurtEnemy(c, dmg, 'fire')) return;
      addSt(c.est, { type: 'burn', turns: 2, value: Math.max(1, Math.round(dmg * 0.25)), decay: 0.5, fresh: true });
    } else {
      say(c, `Lightning crackles from your wand for ${dmg}!`, 'blue');
      if (hurtEnemy(c, dmg, 'lightning')) return;
      if (Math.random() < 0.25) {
        addSt(c.est, { type: 'stun', turns: 1 });
        say(c, `The ${c.enemy.name} is stunned!`, 'green');
      }
    }
  };

  const actFlee = c => {
    const chance = U.clamp(0.5 + (C.playerSpeed(c) - C.enemySpeed(c)) * 0.05 + Math.max(0, Gm.bonus(S.p.dex)) * 0.03, 0.15, 0.9);
    if (Math.random() < chance) {
      say(c, 'You escape the arena!', 'dim');
      ev(c, { t: 'flee', ok: true });
      end(c, 'fled');
    } else {
      say(c, `You try to flee, but the ${c.enemy.name} cuts you off!`, 'red');
      ev(c, { t: 'flee', ok: false });
    }
  };

  const actAbility = (c, id) => {
    const p = S.p, r = Gm.rank(id), name = Gm.abilityName(id);
    p.mp -= Gm.abilityCost(id);
    ev(c, { t: 'cast', id });
    switch (id) {
      case 'double_slash': {
        const hits = [2, 2, 3, 3, 4][r - 1], mult = [1, 1.1, 1, 1.1, 1.1][r - 1];
        say(c, `${name}: ${hits} rapid strikes!`, 'gold');
        let total = 0;
        for (let i = 0; i < hits && !c.over; i++) {
          const h = C.weaponHit(c, mult);
          total += h.dmg;
          ev(c, { t: 'pAttack', quick: true });
          if (hurtEnemy(c, h.dmg, 'melee', h.crit) && (c.over || c.ehp === c.emax)) break;
        }
        say(c, `Total: ${total} damage.`, 'text');
        break;
      }
      case 'fireball': {
        const w = Gm.weaponData();
        const base = (U.rand(w.damage_min, w.damage_max) + Gm.damageBonus()) * 1.5 + 8 + p.level;
        const pierce = r >= 5 ? 1 : 0.5;
        const impact = Math.max(1, Math.round((base - enemyArmor(c, pierce)) * playerDamageMult(c) * takenMult(c)));
        say(c, `${name}: fire engulfs the ${c.enemy.name} for ${impact}!`, 'orange');
        if (hurtEnemy(c, impact, 'fire')) break;
        addSt(c.est, { type: 'burn', turns: [3, 4, 4, 5, 5][r - 1], value: Math.max(1, Math.floor(impact * 0.5)), decay: [0.5, 0.5, 0.7, 0.7, 0.75][r - 1], fresh: true });
        break;
      }
      case 'icy_rain': {
        const h = C.weaponHit(c, 0.6);
        const pct = [0.33, 0.4, 0.4, 0.45, 0.5][r - 1], turns = [3, 3, 4, 4, 5][r - 1];
        say(c, `${name}: ice shards hit for ${h.dmg}. Slowed ${Math.round(pct * 100)}%!`, 'ice');
        if (hurtEnemy(c, h.dmg, 'ice', h.crit)) break;
        addSt(c.est, { type: 'slow', turns, pct });
        if (r >= 4) addSt(c.est, { type: 'frost', turns, value: 2 + Math.floor(p.level / 2) });
        if (r >= 5) { addSt(c.est, { type: 'stun', turns: 1 }); say(c, `The ${c.enemy.name} is frozen solid!`, 'ice'); }
        break;
      }
      case 'speed_warrior': {
        const turns = [3, 4, 4, 5, 5][r - 1], bonus = [0, 0, 0.1, 0.1, 0.15][r - 1];
        addSt(c.pst, { type: 'surge', turns, bonus, fresh: true });
        say(c, `${name}: you move like the wind for ${turns} turns.`, 'blue');
        if (r >= 5) c.pg = Math.max(c.pg, c.eg + 1, 100);
        break;
      }
      case 'ultra_strength': {
        const mult = [1.5, 1.5, 1.5, 1.6, 1.75][r - 1], turns = r >= 5 ? 4 : 3, exhaust = [3, 2, 1, 0, 0][r - 1];
        dropSt(c.pst, 'exhaust');
        addSt(c.pst, { type: 'power', turns, mult, exhaust, fresh: true });
        say(c, `${name}: savage power surges through you (×${mult}) for ${turns} turns!`, 'red');
        break;
      }
      case 'rallying_cry': {
        const pct = [0.15, 0.2, 0.25, 0.3, 0.35][r - 1];
        const amt = Math.min(p.maxHp - p.hp, Math.round(p.maxHp * pct));
        p.hp += amt;
        say(c, `${name}: you find your resolve. +${amt} HP.`, 'green');
        ev(c, { t: 'heal', amount: amt });
        if (r >= 3) {
          const bad = c.pst.filter(s => s.type === 'exhaust' || s.type === 'petrify');
          const n = r >= 4 ? bad.length : Math.min(1, bad.length);
          for (let i = 0; i < n; i++) dropSt(c.pst, bad[i].type);
          if (n) { c.petrified = c.petrified && !!st(c.pst, 'petrify'); say(c, 'Your ailments fade.', 'green'); }
        }
        if (r >= 5) c.pg += 30;
        break;
      }
      case 'riposte': {
        addSt(c.pst, { type: 'riposte', rank: r, charges: r >= 5 ? 2 : 1 });
        say(c, `${name}: you ready a counter. Block the next blow!`, 'gold');
        break;
      }
      case 'shatter': {
        const armorPct = [0.4, 0.5, 0.6, 0.8, 1][r - 1], taken = [0.1, 0.1, 0.15, 0.15, 0.2][r - 1], spdPct = [0, 0, 0.1, 0.1, 0.15][r - 1];
        addSt(c.est, { type: 'shatter', turns: 999, armorPct, taken, spdPct });
        say(c, `${name}: you break the ${c.enemy.name}'s guard!`, 'gold');
        if (r >= 5) addSt(c.est, { type: 'stun', turns: 1 });
        break;
      }
      case 'vanish': {
        const goldPct = [0, 0.25, 0.5, 0.75, 1][r - 1];
        c.rewards = { gold: Math.round(c.enemy.gold * goldPct), xp: r >= 5 ? Math.round(c.enemy.xp * 0.5) : 0 };
        say(c, `${name}: you dissolve into shadow.`, 'purple');
        ev(c, { t: 'vanish' });
        end(c, 'vanish');
        break;
      }
    }
  };

  // Statuses for display: [{ type, turns, who }]
  C.statusList = (who, c = S.combat) => {
    if (!c) return [];
    return (who === 'player' ? c.pst : c.est).map(s => ({ type: s.type, turns: s.turns >= 999 ? 0 : s.turns, charges: s.charges }));
  };

  // ---------------------------------------------------------------
  // Finish: apply rewards / penalties. Returns a summary for the screen.
  // ---------------------------------------------------------------
  C.finish = () => {
    const c = S.combat, p = S.p, e = c.enemy;
    if (!c || c.finished) return c && c.summary;
    c.finished = true;
    const sum = { result: c.result, xp: 0, gold: 0, questGold: 0, levels: [], lostGold: 0, enemy: e.name, streak: c.streak, final: false };
    if (c.result === 'win') {
      S.stats.wins = (S.stats.wins || 0) + 1;
      S.stats.bestStreak = Math.max(S.stats.bestStreak || 0, c.streak);
      sum.xp = e.xp;
      sum.gold = Math.round(e.gold * Math.pow(1.5, c.streak));
      p.gold += sum.gold;
      p.defeated[e.name] = (p.defeated[e.name] || 0) + 1;
      if (S.quest && S.quest.enemy === e.name) {
        sum.questGold = S.quest.reward;
        p.gold += sum.questGold;
        S.quest = null;
      }
      sum.final = e.name === D.FINAL_BOSS;
      sum.levels = Gm.gainXp(sum.xp);
    } else if (c.result === 'lose') {
      S.stats.losses = (S.stats.losses || 0) + 1;
      sum.lostGold = Math.floor(p.gold * 0.25);
      p.gold -= sum.lostGold;
      p.hp = Math.max(1, Math.floor(p.maxHp * 0.3));
      p.mp = Math.max(p.mp, Math.floor(p.maxMp * 0.3));
    } else if (c.result === 'vanish' && c.rewards) {
      sum.gold = c.rewards.gold; sum.xp = c.rewards.xp;
      p.gold += sum.gold;
      if (sum.xp) sum.levels = Gm.gainXp(sum.xp);
    }
    c.summary = sum;
    Gm.save();
    return sum;
  };
})();
