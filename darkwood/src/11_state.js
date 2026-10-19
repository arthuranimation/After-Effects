// ================================================================
// STATE — the player, formulas, shops, levelling and save/load.
// Pure logic: no drawing here, so it can be simulated headlessly.
// ================================================================
(() => {
  const D = DW.data, U = DW.util;
  const S = DW.state = { p: null, quest: null, flags: {}, settings: { assist: false }, stats: {}, combat: null };
  const Gm = DW.game = {};

  Gm.SAVE_KEY = 'darkwood_save';
  Gm.VERSION = 3;

  // ---------------------------------------------------------------
  // New game
  // ---------------------------------------------------------------
  Gm.freshPlayer = () => ({
    name: 'Derek', level: 1, xp: 0,
    hp: 30, maxHp: 30, mp: 10, maxMp: 10, gold: 15,
    str: 10, dex: 10, con: 10,
    weapon: 'Dagger', armor: null, ring: null,
    potions: {},          // item name → count (healing and mana)
    wands: {},            // wand name → charges
    tomes: {},            // tome name → true once read
    learned: { double_slash: 1 },   // ability id → rank (1..5)
    slots: ['double_slash'],        // equipped abilities (max D.SLOTS)
    defeated: {},         // enemy name → times defeated
    pendingLevels: [],    // levels whose reward hasn't been chosen yet
  });

  Gm.newGame = () => {
    S.p = Gm.freshPlayer();
    S.quest = null;
    S.flags = { gateOpen: false, victorySeen: false };
    S.stats = { fights: 0, wins: 0, losses: 0, blocks: 0, parries: 0, crits: 0, bestStreak: 0 };
    S.combat = null;
  };

  // ---------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------
  Gm.weaponData = name => D.WEAPONS.find(w => w.name === (name || S.p.weapon)) || D.WEAPONS[0];
  Gm.itemData = name => D.ITEMS.find(i => i.name === name) || null;
  Gm.enemyData = name => D.ENEMIES.find(e => e.name === name) || null;
  Gm.abilityData = id => D.ABILITIES.find(a => a.id === id) || null;
  Gm.armorData = () => (S.p.armor ? Gm.itemData(S.p.armor) : null);
  Gm.ringData = () => (S.p.ring ? Gm.itemData(S.p.ring) : null);

  Gm.trait = (w = Gm.weaponData()) => {
    const [kind, n] = (w.trait || '').split(' ');
    return { kind: kind || '', n: parseInt(n, 10) || 0 };
  };

  Gm.gear = () => ({
    weapon: Gm.weaponData().look,
    armor: Gm.armorData() ? Gm.armorData().look : 'none',
  });

  // ---------------------------------------------------------------
  // Formulas
  // ---------------------------------------------------------------
  Gm.bonus = v => Math.floor((v - 10) / 2);
  Gm.xpForLevel = lvl => (lvl <= 1 ? 100 : Math.floor(100 * Math.pow(lvl, 1.5)));
  Gm.xpNext = () => Gm.xpForLevel(S.p.level);

  Gm.speed = () => Math.max(1, 7 + Gm.bonus(S.p.dex) + Gm.weaponData().speed + Math.floor(S.p.level / 4));
  Gm.defense = () => (Gm.armorData() ? Gm.armorData().value : 0) + (Gm.ringData() ? Gm.ringData().value : 0) + Math.max(0, Gm.bonus(S.p.dex));
  Gm.damageBonus = () => Math.max(0, Gm.bonus(S.p.str)) + Math.floor(S.p.level * 2 / 3);
  Gm.critChance = () => {
    const t = Gm.trait();
    return 0.05 + (t.kind === 'crit' ? t.n / 100 : 0) + Math.max(0, Gm.bonus(S.p.dex)) * 0.01;
  };
  Gm.hpPerLevel = () => 4 + Math.max(0, Gm.bonus(S.p.con));
  Gm.vitalityGain = () => 8 + Math.max(0, Gm.bonus(S.p.con)) * 2;
  Gm.ARCANE_GAIN = 4;
  Gm.attackRange = () => {
    const w = Gm.weaponData(), b = Gm.damageBonus();
    return [w.damage_min + b, w.damage_max + b];
  };

  Gm.innCost = () => 10 + S.p.level * 8;
  Gm.tradeIn = cost => Math.floor((cost || 0) * 0.3);

  // ---------------------------------------------------------------
  // Abilities
  // ---------------------------------------------------------------
  Gm.rank = id => S.p.learned[id] || 0;
  Gm.abilityCost = id => {
    const a = Gm.abilityData(id);
    return a ? a.mp + Math.max(0, Gm.rank(id) - 1) : 99;
  };
  Gm.abilityName = id => {
    const a = Gm.abilityData(id);
    if (!a) return id;
    const r = Gm.rank(id);
    return r >= 5 ? a.rank5Name : r <= 1 ? a.name : `${a.name} +${r - 1}`;
  };
  Gm.learnedList = () => D.ABILITIES.filter(a => S.p.learned[a.id]).map(a => a.id);

  Gm.learn = id => {
    if (S.p.learned[id]) return false;
    S.p.learned[id] = 1;
    if (S.p.slots.length < D.SLOTS) S.p.slots.push(id);
    return true;
  };

  Gm.toggleSlot = id => {
    const i = S.p.slots.indexOf(id);
    if (i >= 0) { S.p.slots.splice(i, 1); return 'removed'; }
    if (S.p.slots.length >= D.SLOTS) return 'full';
    S.p.slots.push(id);
    return 'added';
  };
  Gm.replaceSlot = (index, id) => {
    const cur = S.p.slots.indexOf(id);
    if (cur >= 0) S.p.slots.splice(cur, 1);
    S.p.slots[Math.min(index, S.p.slots.length)] = id;
    S.p.slots = S.p.slots.filter(Boolean).slice(0, D.SLOTS);
  };

  // ---------------------------------------------------------------
  // XP and levels. Each level: automatic HP/MP growth, possibly a new
  // ability, then a pending choice (vitality / arcane / mastery).
  // ---------------------------------------------------------------
  Gm.gainXp = n => {
    const p = S.p;
    p.xp += Math.max(0, Math.round(n));
    const gained = [];
    while (p.xp >= Gm.xpNext()) {
      p.xp -= Gm.xpNext();
      p.level++;
      const hpUp = Gm.hpPerLevel();
      p.maxHp += hpUp; p.hp += hpUp;
      p.maxMp += 1; p.mp += 1;
      const ab = D.LEVEL_ABILITIES[p.level];
      if (ab) Gm.learn(ab);
      p.pendingLevels.push(p.level);
      gained.push(p.level);
    }
    return gained;
  };

  // Skill ranks are capped by level (rank 2 at level 3, 3 at 6, 4 at 9, 5 at 12)
  // so a rank-5 skill can't be rushed at level 5.
  Gm.maxRank = () => Math.min(5, 1 + Math.floor(S.p.level / 3));
  Gm.masteryOptions = () => Gm.learnedList().filter(id => Gm.rank(id) < Gm.maxRank());

  // choice: 'vitality' | 'arcane' | 'mastery' (with ability id). Restores HP and MP fully.
  Gm.chooseLevelReward = (choice, abilityId) => {
    const p = S.p;
    if (!p.pendingLevels.length) return null;
    let msg = '';
    if (choice === 'vitality') {
      const g = Gm.vitalityGain();
      p.maxHp += g;
      msg = `+${g} max HP`;
    } else if (choice === 'arcane') {
      p.maxMp += Gm.ARCANE_GAIN;
      msg = `+${Gm.ARCANE_GAIN} max MP`;
    } else if (choice === 'mastery' && abilityId && Gm.rank(abilityId) > 0 && Gm.rank(abilityId) < Gm.maxRank()) {
      p.learned[abilityId]++;
      msg = `${Gm.abilityName(abilityId)} (rank ${p.learned[abilityId]})`;
    } else {
      return null;
    }
    p.hp = p.maxHp; p.mp = p.maxMp;
    p.pendingLevels.shift();
    return msg;
  };

  // ---------------------------------------------------------------
  // Shops. All return { ok, msg }.
  // ---------------------------------------------------------------
  // Price after trade-in. Negative = the shop pays you the difference (a trade-down).
  Gm.weaponPrice = w => w.cost - Gm.tradeIn(Gm.weaponData().cost);
  Gm.buyWeapon = name => {
    const w = Gm.weaponData(name);
    if (!w || w.name === S.p.weapon) return { ok: false, msg: 'Already equipped.' };
    const price = Gm.weaponPrice(w);
    if (S.p.gold < price) return { ok: false, msg: `You need ${U.fmt(price)} gold.` };
    S.p.gold -= price;
    S.p.weapon = w.name;
    return { ok: true, msg: `Equipped the ${w.name}.` + (price < 0 ? ` (+${-price}g back)` : '') };
  };

  Gm.itemPrice = item => {
    if (item.type === 'armor') return item.cost - Gm.tradeIn(Gm.armorData() ? Gm.armorData().cost : 0);
    if (item.type === 'ring') return item.cost - Gm.tradeIn(Gm.ringData() ? Gm.ringData().cost : 0);
    return item.cost;
  };
  // True when buying this would replace better gear you already wear.
  Gm.isDowngrade = item => {
    if (item.type === 'armor' && Gm.armorData()) return item.value < Gm.armorData().value;
    if (item.type === 'ring' && Gm.ringData()) return item.value < Gm.ringData().value;
    if (item.damage_max !== undefined) return item.cost < Gm.weaponData().cost;
    return false;
  };

  Gm.itemStatus = item => {
    const p = S.p;
    if (item.type === 'armor' && p.armor === item.name) return 'equipped';
    if (item.type === 'ring' && p.ring === item.name) return 'equipped';
    if (item.type === 'tome' && p.tomes[item.name]) return 'read';
    return '';
  };

  Gm.buyItem = name => {
    const item = Gm.itemData(name);
    const p = S.p;
    if (!item) return { ok: false, msg: '?' };
    const st = Gm.itemStatus(item);
    if (st) return { ok: false, msg: st === 'read' ? 'You have already studied it.' : 'Already equipped.' };
    const price = Gm.itemPrice(item);
    if (p.gold < price) return { ok: false, msg: `You need ${U.fmt(price)} gold.` };
    p.gold -= price;
    switch (item.type) {
      case 'potion':
      case 'mana':
        p.potions[item.name] = (p.potions[item.name] || 0) + 1;
        return { ok: true, msg: `${item.name} (${p.potions[item.name]} carried)` };
      case 'armor':
        p.armor = item.name;
        return { ok: true, msg: `Equipped ${item.name}. Defense ${Gm.defense()}.` };
      case 'ring':
        p.ring = item.name;
        return { ok: true, msg: `Equipped ${item.name}. Defense ${Gm.defense()}.` };
      case 'tome': {
        p[item.stat] += item.value;
        p.tomes[item.name] = true;
        if (item.stat === 'con') { p.maxHp += item.value * 2; p.hp += item.value * 2; }
        return { ok: true, msg: `${item.stat.toUpperCase()} +${item.value}. You feel changed.` };
      }
      case 'wand':
        p.wands[item.name] = (p.wands[item.name] || 0) + item.charges;
        return { ok: true, msg: `${item.name}: ${p.wands[item.name]} charges.` };
    }
    return { ok: false, msg: '?' };
  };

  Gm.potionCount = () => Object.entries(S.p.potions).filter(([n]) => Gm.itemData(n) && Gm.itemData(n).type === 'potion').reduce((s, [, c]) => s + c, 0);
  Gm.wandCharges = () => Object.values(S.p.wands).reduce((s, c) => s + c, 0);

  // ---------------------------------------------------------------
  // Arena progression
  // ---------------------------------------------------------------
  Gm.defeatedIn = tier => D.ENEMIES.filter(e => e.tier === tier && S.p.defeated[e.name]).length;
  Gm.tierUnlocked = tier => tier <= 1 || Gm.defeatedIn(tier - 1) >= D.TIER_UNLOCK;
  Gm.enemyUnlocked = e => {
    if (!Gm.tierUnlocked(e.tier)) return false;
    if (e.name === D.FINAL_BOSS) return D.ENEMIES.filter(o => o.tier === e.tier && o.name !== e.name).every(o => S.p.defeated[o.name]);
    return true;
  };
  Gm.highestTier = () => [4, 3, 2, 1].find(t => Gm.tierUnlocked(t));
  Gm.totalDefeated = () => D.ENEMIES.filter(e => S.p.defeated[e.name]).length;

  // ---------------------------------------------------------------
  // The Rusty Flagon
  // ---------------------------------------------------------------
  Gm.rest = () => {
    const p = S.p;
    if (p.hp >= p.maxHp && p.mp >= p.maxMp) return { ok: false, msg: 'You are already fully rested.' };
    const cost = Gm.innCost();
    if (p.gold < cost) return { ok: false, msg: `A room costs ${cost} gold. You have ${U.fmt(p.gold)}.` };
    p.gold -= cost;
    p.hp = p.maxHp; p.mp = p.maxMp;
    let offer = null;
    if (!S.quest && Math.random() < 0.4) offer = Gm.makeQuest();
    return { ok: true, msg: `You sleep soundly. Health and magic restored. (-${cost}g)`, offer };
  };

  // The stables are free: patch yourself up to half health and magic.
  // (Stops a broken, defeated hero from being stuck at 30% forever.)
  Gm.stables = () => {
    const p = S.p;
    const hp = Math.max(p.hp, Math.ceil(p.maxHp * 0.5)), mp = Math.max(p.mp, Math.ceil(p.maxMp * 0.5));
    if (hp === p.hp && mp === p.mp) return { ok: false, msg: 'The straw will do you no more good. You need a real bed.' };
    p.hp = hp; p.mp = mp;
    return { ok: true, msg: 'You sleep in the straw beside the horses. Half rested.' };
  };

  Gm.makeQuest = () => {
    const pool = D.ENEMIES.filter(e => Gm.enemyUnlocked(e) && e.name !== D.FINAL_BOSS);
    if (!pool.length) return null;
    // favour foes near the player's frontier
    const top = Gm.highestTier();
    const near = pool.filter(e => e.tier >= top - 1);
    const e = U.pick(near.length ? near : pool);
    const reward = Math.round(e.gold * 1.5 + 30);
    const giver = U.rand(0, D.QUEST_GIVERS.length - 1);
    return { enemy: e.name, reward, giver };
  };
  Gm.questText = q => D.QUEST_GIVERS[q.giver || 0].replace('{enemy}', '{red}' + q.enemy + '{/}').replace('{reward}', '{gold}' + q.reward + '{/}');
  Gm.acceptQuest = q => { S.quest = q; };

  // ---------------------------------------------------------------
  // Save / load (localStorage). Old v1/v2 saves from Darkwood 8 migrate.
  // ---------------------------------------------------------------
  Gm.SETTINGS_KEY = 'darkwood_settings';
  Gm.saveSettings = () => { try { localStorage.setItem(Gm.SETTINGS_KEY, JSON.stringify(S.settings)); } catch (_) { /* ignore */ } };
  Gm.loadSettings = () => {
    try { Object.assign(S.settings, JSON.parse(localStorage.getItem(Gm.SETTINGS_KEY) || '{}') || {}); } catch (_) { /* ignore */ }
  };

  Gm.save = () => {
    Gm.saveSettings();
    if (!S.p) return false;
    const data = { v: Gm.VERSION, player: S.p, quest: S.quest, flags: S.flags, settings: S.settings, stats: S.stats };
    try { localStorage.setItem(Gm.SAVE_KEY, JSON.stringify(data)); return true; } catch (_) { return false; }
  };

  Gm.readSave = () => {
    try {
      const raw = localStorage.getItem(Gm.SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  };
  Gm.hasSave = () => !!Gm.readSave();
  Gm.clearSave = () => { try { localStorage.removeItem(Gm.SAVE_KEY); } catch (_) { /* ignore */ } };

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  Gm.load = () => {
    const data = Gm.readSave();
    if (!data || !data.player) return false;
    try {
      if (data.v === 3) {
        const base = Gm.freshPlayer();
        const pd = data.player;
        S.p = Object.assign(base, pd);
        // keep only things the current data tables know about, so a renamed item
        // or a damaged field can never break the game
        const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
        const counts = (v, ok) => Object.fromEntries(Object.entries(obj(v)).filter(([n, c]) => ok(n) && typeof c === 'number' && c > 0));
        S.p.potions = counts(pd.potions, n => { const i = Gm.itemData(n); return i && (i.type === 'potion' || i.type === 'mana'); });
        S.p.wands = counts(pd.wands, n => { const i = Gm.itemData(n); return i && i.type === 'wand'; });
        S.p.tomes = obj(pd.tomes);
        S.p.learned = counts(pd.learned, id => !!Gm.abilityData(id));
        if (!Object.keys(S.p.learned).length) S.p.learned = { double_slash: 1 };
        S.p.slots = (Array.isArray(pd.slots) ? pd.slots : []).filter(id => S.p.learned[id]).slice(0, D.SLOTS);
        S.p.defeated = counts(pd.defeated, n => !!Gm.enemyData(n));
        S.p.pendingLevels = (Array.isArray(pd.pendingLevels) ? pd.pendingLevels : []).filter(n => typeof n === 'number');
        if (S.p.armor && !Gm.itemData(S.p.armor)) S.p.armor = null;
        if (S.p.ring && !Gm.itemData(S.p.ring)) S.p.ring = null;
        for (const k of ['level', 'xp', 'hp', 'maxHp', 'mp', 'maxMp', 'gold', 'str', 'dex', 'con']) if (typeof S.p[k] !== 'number' || !isFinite(S.p[k])) S.p[k] = Gm.freshPlayer()[k];
        if (!D.WEAPONS.find(w => w.name === S.p.weapon)) S.p.weapon = 'Dagger';
        S.quest = data.quest || null;
        S.flags = Object.assign({ gateOpen: false, victorySeen: false }, data.flags || {});
        S.settings = Object.assign({ assist: false }, data.settings || {});
        Gm.loadSettings();   // settings changed on the title screen win
        S.stats = Object.assign({ fights: 0, wins: 0, losses: 0, blocks: 0, parries: 0, crits: 0, bestStreak: 0 }, data.stats || {});
      } else {
        Gm.migrate(data);
      }
      S.combat = null;
      return true;
    } catch (e) {
      console.error('load failed', e);
      return false;
    }
  };

  // Darkwood 8.0 (save v1/v2) → v3
  Gm.migrate = data => {
    Gm.newGame();
    const p = S.p, pd = data.player;
    p.name = pd.name || 'Derek';
    p.level = Math.max(1, num(pd.level, 1));
    p.xp = Math.max(0, num(pd.xp, 0));
    // 8.0 heroes only gained HP from Vitality picks; v9 also grants HP every level.
    const oldMax = Math.max(30, num(pd.maxHp, 30));
    const vitPicks = Math.max(0, Math.round((oldMax - 30) / (10 + Math.max(0, Gm.bonus(num(pd.con, 10))))));
    p.con = num(pd.con, 10);
    p.maxHp = 30 + (p.level - 1) * Gm.hpPerLevel() + vitPicks * Gm.vitalityGain();
    p.hp = Math.max(1, Math.round(p.maxHp * U.clamp(num(pd.hp, oldMax) / oldMax, 0, 1)));
    const oldMaxMp = num(pd.maxMp, 5);
    const arcanePicks = Math.max(0, Math.round((oldMaxMp - 5) / 2));
    p.maxMp = 10 + (p.level - 1) + arcanePicks * Gm.ARCANE_GAIN;
    p.mp = p.maxMp;
    p.gold = Math.max(0, num(pd.gold, 0));
    p.str = num(pd.str, 10); p.dex = num(pd.dex, 10); p.con = num(pd.con, 10);
    if (pd.weaponName && D.WEAPONS.find(w => w.name === pd.weaponName)) p.weapon = pd.weaponName;
    if (pd.armorName && Gm.itemData(pd.armorName)) p.armor = pd.armorName;
    if (pd.ringName && Gm.itemData(pd.ringName)) p.ring = pd.ringName;
    (pd.potionNames || []).forEach(n => { if (Gm.itemData(n)) p.potions[n] = (p.potions[n] || 0) + 1; });
    (pd.wands || []).forEach(w => { if (Gm.itemData(w.name)) p.wands[w.name] = (p.wands[w.name] || 0) + num(w.charges, 0); });
    (pd.tomes || []).forEach(t => { p.tomes[t] = true; });
    (pd.defeated || []).forEach(n => { if (Gm.enemyData(n)) p.defeated[n] = 1; });
    // 8.0 could silently overwrite abilities; give back everything earned by level.
    p.learned = {};
    for (let l = 1; l <= p.level; l++) if (D.LEVEL_ABILITIES[l]) p.learned[D.LEVEL_ABILITIES[l]] = 1;
    (pd.abilities || []).forEach(a => { if (a && Gm.abilityData(a.id)) p.learned[a.id] = U.clamp(num(a.rank, 1), 1, 5); });
    p.slots = (pd.abilities || []).map(a => a && a.id).filter(id => p.learned[id]).slice(0, D.SLOTS);
    if (!p.slots.length) p.slots = Object.keys(p.learned).slice(0, D.SLOTS);
    if (data.quest && Gm.enemyData(data.quest.enemyName)) S.quest = { enemy: data.quest.enemyName, reward: num(data.quest.reward, 100), giver: 0 };
    if (p.defeated[D.FINAL_BOSS]) S.flags.gateOpen = true;
    Gm.loadSettings();
    Gm.save();
  };
})();
