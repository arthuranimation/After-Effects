// ================================================================
// GAME DATA — edit these tables to customise the game.
//
// WEAPONS  look: the sprite used for the hero and the shop icon
//          speed: added to the hero's speed (light blades are quick)
//          trait: crush N (ignores N armour) | crit N (% extra crit chance)
//                 | holy (×1.5 damage to undead and fiends)
// ENEMIES  tier 1-4 (arena rings), armor (flat damage reduction),
//          kind: beast | humanoid | undead | giant | fiend | dragon
//          special: none | drain | regen | petrify | fire
//          moves: how it attacks — weights for left / high / right, plus
//                 feint (chance the tell switches mid wind-up) and
//                 combo (chance of a quick second strike)
// ITEMS    type: potion | mana | armor | ring | tome | wand
// ================================================================
(() => {
  const D = DW.data = {};

  D.WEAPONS = [
    { name: 'Dagger',                look: 'dagger',     damage_min: 2,  damage_max: 4,  speed: 2,  cost: 0,    trait: 'crit 10', description: 'A crude but reliable blade. Quick in the hand, quicker to find a gap.' },
    { name: 'Short Sword',           look: 'shortsword', damage_min: 2,  damage_max: 6,  speed: 1,  cost: 50,   trait: '',        description: 'A reliable short blade favoured by scouts.' },
    { name: 'Mace',                  look: 'mace',       damage_min: 3,  damage_max: 7,  speed: 0,  cost: 90,   trait: 'crush 2', description: 'A heavy bludgeon that ignores light armour.' },
    { name: 'Longsword',             look: 'longsword',  damage_min: 4,  damage_max: 8,  speed: 0,  cost: 160,  trait: '',        description: 'The classic weapon of a seasoned warrior.' },
    { name: 'Battle Axe',            look: 'axe',        damage_min: 5,  damage_max: 11, speed: -1, cost: 280,  trait: 'crit 10', description: 'A brutal cleaving weapon. Its bite opens grievous wounds.' },
    { name: 'Flail',                 look: 'flail',      damage_min: 3,  damage_max: 13, speed: 0,  cost: 380,  trait: 'crush 3', description: 'Unpredictable arcing strikes slip past shields and plate.' },
    { name: 'Great Sword',           look: 'greatsword', damage_min: 7,  damage_max: 14, speed: -2, cost: 650,  trait: '',        description: 'A two-handed blade requiring real strength.' },
    { name: 'War Hammer',            look: 'hammer',     damage_min: 7,  damage_max: 16, speed: -3, cost: 950,  trait: 'crush 5', description: 'Crushes bone and bends steel alike. Slow, but nothing stops it.' },
    { name: 'Sword +1',              look: 'magicsword', damage_min: 6,  damage_max: 12, speed: 1,  cost: 1300, trait: 'crit 10', description: 'An enchanted blade that bites supernaturally true.' },
    { name: 'Sword +3',              look: 'magicsword', damage_min: 8,  damage_max: 16, speed: 1,  cost: 2600, trait: 'crit 15', description: 'A masterwork weapon humming with arcane power.' },
    { name: 'Sword +5 Holy Avenger', look: 'holysword',  damage_min: 11, damage_max: 22, speed: 1,  cost: 6000, trait: 'holy',    description: 'A legendary blade of divine wrath. The dead and the damned fear it.' },
  ];

  D.TIERS = [
    { name: 'The Pit',            short: 'I',   blurb: 'Rats, runts and the restless dead. Every champion starts in the Pit.' },
    { name: 'The Blood Sands',    short: 'II',  blurb: 'Veterans and things that feed on them. The sand here is never dry.' },
    { name: 'The Iron Ring',      short: 'III', blurb: 'Monsters the city pays dearly to keep chained. The crowd goes quiet.' },
    { name: "The Champion's Crown", short: 'IV', blurb: 'Giants, demons, and the dragon. Win here and the city is yours.' },
  ];
  D.TIER_UNLOCK = 3;          // defeat this many in a ring to open the next
  D.FINAL_BOSS = 'Red Dragon'; // unlocked once every other foe in its ring is beaten

  const M = (L, H, R, extra = {}) => Object.assign({ L, H, R, feint: 0, combo: 0 }, extra);

  D.ENEMIES = [
    // ---- I: The Pit ----
    { name: 'Giant Rat',  tier: 1, hp: 14,  damage_min: 1,  damage_max: 4,  armor: 0,  speed: 9,  xp: 60,   gold: 12,   kind: 'beast',    special: 'none',    moves: M(1, 1, 1),            description: 'A bloated sewer rat the size of a dog. Its bite festers.' },
    { name: 'Kobold',     tier: 1, hp: 18,  damage_min: 2,  damage_max: 4,  armor: 1,  speed: 8,  xp: 90,   gold: 18,   kind: 'humanoid', special: 'none',    moves: M(2, 1, 2),            description: 'A small reptilian creature with a cruel cunning and a rusty blade.' },
    { name: 'Goblin',     tier: 1, hp: 24,  damage_min: 2,  damage_max: 6,  armor: 1,  speed: 9,  xp: 130,  gold: 26,   kind: 'humanoid', special: 'none',    moves: M(2, 1, 2),            description: 'Cackling and vicious. Travels in packs but fights alone.' },
    { name: 'Skeleton',   tier: 1, hp: 28,  damage_min: 3,  damage_max: 6,  armor: 3,  speed: 6,  xp: 170,  gold: 32,   kind: 'undead',   special: 'none',    moves: M(1, 2, 1),            description: 'Held together by dark magic. Feels no pain or mercy. Blades skitter off its bones.' },
    { name: 'Orc',        tier: 1, hp: 36,  damage_min: 3,  damage_max: 8,  armor: 2,  speed: 7,  xp: 220,  gold: 45,   kind: 'humanoid', special: 'none',    moves: M(1, 2, 1),            description: 'Scarred and brutal. Lives for the thrill of combat.' },
    // ---- II: The Blood Sands ----
    { name: 'Gnoll',      tier: 2, hp: 44,  damage_min: 5, damage_max: 11,  armor: 2,  speed: 8,  xp: 320,  gold: 58,   kind: 'beast',    special: 'none',    moves: M(2, 1, 2, { combo: 0.15 }), description: 'A hyena-headed marauder with a taste for carrion.' },
    { name: 'Hobgoblin',  tier: 2, hp: 50,  damage_min: 6, damage_max: 12, armor: 3,  speed: 7,  xp: 420,  gold: 75,   kind: 'humanoid', special: 'none',    moves: M(2, 1, 2, { feint: 0.15 }), description: 'Disciplined and dangerous. A veteran of a hundred skirmishes.' },
    { name: 'Ghoul',      tier: 2, hp: 58,  damage_min: 6, damage_max: 12, armor: 1,  speed: 9,  xp: 480,  gold: 85,   kind: 'undead',   special: 'drain',   moves: M(2, 1, 2),            description: "Its cold touch doesn't just wound — it steals your very experience." },
    { name: 'Bugbear',    tier: 2, hp: 66,  damage_min: 7, damage_max: 14, armor: 3,  speed: 6,  xp: 600,  gold: 100,  kind: 'humanoid', special: 'none',    moves: M(1, 2, 1),            description: 'Massive and silent. Strikes before you even hear it coming.' },
    { name: 'Wight',      tier: 2, hp: 72,  damage_min: 8, damage_max: 14, armor: 4,  speed: 7,  xp: 700,  gold: 120,  kind: 'undead',   special: 'drain',   moves: M(1, 1, 1, { feint: 0.15 }), description: 'A wraith of hunger. Each blow drains the life from your soul.' },
    // ---- III: The Iron Ring ----
    { name: 'Ogre',       tier: 3, hp: 110, damage_min: 10, damage_max: 19, armor: 3,  speed: 5,  xp: 950,  gold: 160,  kind: 'giant',    special: 'none',    moves: M(1, 3, 1),            description: 'Enormous and stupid. Its fists hit like falling stones.' },
    { name: 'Troll',      tier: 3, hp: 120, damage_min: 9, damage_max: 16, armor: 3,  speed: 6,  xp: 1150, gold: 190,  kind: 'giant',    special: 'regen',   moves: M(2, 1, 2, { combo: 0.2 }),  description: 'Wounds close before your eyes. Only persistent assault — or fire — will finish it.' },
    { name: 'Basilisk',   tier: 3, hp: 130, damage_min: 10, damage_max: 17, armor: 6,  speed: 6,  xp: 1350, gold: 230,  kind: 'beast',    special: 'petrify', moves: M(2, 1, 2, { feint: 0.2 }),  description: 'Its gaze can lock your muscles mid-swing. Avert your eyes.' },
    { name: 'Werewolf',   tier: 3, hp: 115, damage_min: 11, damage_max: 19, armor: 3,  speed: 12, xp: 1500, gold: 260,  kind: 'beast',    special: 'none',    moves: M(2, 1, 2, { combo: 0.35 }), description: 'Faster and fiercer than anything natural. Strikes in a blur of claws.' },
    { name: 'Vampire',    tier: 3, hp: 145, damage_min: 13, damage_max: 21, armor: 4,  speed: 11, xp: 1800, gold: 330,  kind: 'undead',   special: 'drain',   moves: M(2, 1, 2, { feint: 0.3 }),  description: 'Aristocratic and lethal. Drains your hard-won experience with each touch.' },
    // ---- IV: The Champion's Crown ----
    { name: 'Hill Giant', tier: 4, hp: 190, damage_min: 17, damage_max: 28, armor: 4,  speed: 4,  xp: 2400, gold: 450,  kind: 'giant',    special: 'none',    moves: M(1, 3, 1),            description: 'It wields an oak tree as a club. The ground shakes when it walks.' },
    { name: 'Fire Giant', tier: 4, hp: 215, damage_min: 17, damage_max: 29, armor: 5,  speed: 5,  xp: 3000, gold: 600,  kind: 'giant',    special: 'fire',    moves: M(1, 2, 1, { combo: 0.15 }), description: 'Wreathed in flame. Your armour is little protection from the heat.' },
    { name: 'Lich',       tier: 4, hp: 190, damage_min: 16, damage_max: 27, armor: 4,  speed: 8,  xp: 3600, gold: 750,  kind: 'undead',   special: 'drain',   moves: M(1, 1, 1, { feint: 0.3 }), description: 'An ancient sorcerer who cheated death. Its power is immeasurable.' },
    { name: 'Demon',      tier: 4, hp: 225, damage_min: 18, damage_max: 30, armor: 5,  speed: 9,  xp: 4500, gold: 900,  kind: 'fiend',    special: 'none',    moves: M(2, 1, 2, { combo: 0.15, feint: 0.15 }), description: 'Summoned from the abyss. It exists only to destroy.' },
    { name: 'Red Dragon', tier: 4, hp: 340, damage_min: 24, damage_max: 40, armor: 6,  speed: 9,  xp: 8000, gold: 2000, kind: 'dragon',   special: 'fire',    moves: M(2, 2, 2, { combo: 0.2, feint: 0.2 }),  description: 'The apex predator. Captain of the Guard or ashes — choose wisely.' },
  ];

  D.ITEMS = [
    { name: 'Healing Potion',         type: 'potion', icon: 'p_heal',     value: 25,  cost: 40,   description: 'A murky red draught. Restores 25 HP.' },
    { name: 'Greater Healing Potion', type: 'potion', icon: 'p_greater',  value: 60,  cost: 120,  description: 'A rich crimson elixir. Restores 60 HP.' },
    { name: 'Elixir of Life',         type: 'potion', icon: 'p_elixir',   value: 999, cost: 600,  description: 'Glows from within. Restores you to full health.' },
    { name: 'Mana Draught',           type: 'mana',   icon: 'p_mana',     value: 15,  cost: 60,   description: 'Cold and faintly luminous. Restores 15 MP.' },
    { name: 'Leather Armor',          type: 'armor',  icon: 'a_leather',  look: 'leather',   value: 2,  cost: 30,   description: 'Cured hide stitched together. Better than nothing.' },
    { name: 'Chain Mail',             type: 'armor',  icon: 'a_chain',    look: 'chain',     value: 5,  cost: 200,  description: 'Interlocked rings of iron. Solid and dependable.' },
    { name: 'Plate Armor',            type: 'armor',  icon: 'a_plate',    look: 'plate',     value: 8,  cost: 800,  description: 'Heavy forged steel. Serious protection for serious fighters.' },
    { name: 'Full Plate +4',          type: 'armor',  icon: 'a_fullplate', look: 'fullplate', value: 12, cost: 3000, description: 'Masterwork enchanted plate. The finest protection gold can buy.' },
    { name: 'Ring of Protection +1',  type: 'ring',   icon: 'r_silver',   value: 2,   cost: 300,  description: 'A silver band that subtly deflects incoming blows.' },
    { name: 'Ring of Protection +3',  type: 'ring',   icon: 'r_iron',     value: 5,   cost: 1500, description: 'A rune-carved band of cold iron. Turns aside many strikes.' },
    { name: 'Tome of Strength',       type: 'tome',   icon: 't_str',      stat: 'str', value: 2, cost: 1500, description: 'Forbidden exercises of the old gladiators. Strength +2, forever.' },
    { name: 'Tome of Dexterity',      type: 'tome',   icon: 't_dex',      stat: 'dex', value: 2, cost: 1500, description: 'The footwork of the shadow-dancers. Dexterity +2, forever.' },
    { name: 'Tome of Constitution',   type: 'tome',   icon: 't_con',      stat: 'con', value: 4, cost: 1500, description: 'Rites of endurance. Constitution +4 and more health, forever.' },
    { name: 'Lightning Wand',         type: 'wand',   icon: 'wand_lightning', element: 'lightning', value: 26, charges: 3, cost: 700,  description: '3 charges. 16–36 lightning damage that ignores armour and may stun.' },
    { name: 'Fire Wand',              type: 'wand',   icon: 'wand_fire',      element: 'fire',      value: 40, charges: 3, cost: 1300, description: '3 charges. 25–55 fire damage that ignores armour and sets the foe alight.' },
  ];

  // ---------------------------------------------------------------
  // ABILITIES — learned automatically at the listed level; ranked up
  // with the Mastery choice on level-up (rank 5 renames the skill).
  // Three can be equipped at once (swap freely in town).
  // ---------------------------------------------------------------
  D.ABILITIES = [
    { id: 'double_slash',   name: 'Double Slash',   rank5Name: 'Blade Flurry',     mp: 4,  icon: 'ab_double_slash',
      desc: 'Strike in rapid succession. Each hit is a full attack.',
      ranks: ['2 hits', '2 hits, +10% damage', '3 hits', '3 hits, +10% damage', '4 hits, +10% damage'] },
    { id: 'vanish',         name: 'Vanish',         rank5Name: 'Ghost Step',       mp: 5,  icon: 'ab_vanish',
      desc: 'Melt into shadow and leave the fight.',
      ranks: ['Guaranteed escape', 'Escape, keep 25% of its gold', 'Escape, keep 50% of its gold', 'Escape, keep 75% of its gold', 'Escape with all its gold and half its XP'] },
    { id: 'rallying_cry',   name: 'Rallying Cry',   rank5Name: 'War Hymn',         mp: 6,  icon: 'ab_rallying_cry',
      desc: 'Find your second wind.',
      ranks: ['Restore 15% HP', 'Restore 20% HP', 'Restore 25% HP, cure 1 ailment', 'Restore 30% HP, cure all ailments', 'Restore 35% HP, cure all, act sooner'] },
    { id: 'speed_warrior',  name: 'Speed Warrior',  rank5Name: 'Blur',             mp: 6,  icon: 'ab_speed_warrior',
      desc: "Match the enemy's speed, plus a step.",
      ranks: ['3 turns', '4 turns', '4 turns, +10% damage', '5 turns, +10% damage', '5 turns, +15% damage, act at once'] },
    { id: 'fireball',       name: 'Fireball',       rank5Name: 'Inferno',          mp: 10, icon: 'ab_fireball',
      desc: 'Hurl fire that ignores half of armour and burns for several turns.',
      ranks: ['Burn 3 turns', 'Burn 4 turns', 'Burn 4 turns, slower decay', 'Burn 5 turns, slower decay', 'Burn 5 turns, ignores all armour'] },
    { id: 'riposte',        name: 'Riposte',        rank5Name: 'Vengeance',        mp: 6,  icon: 'ab_riposte',
      desc: 'Your next successful block becomes a counterattack.',
      ranks: ['1.5× counter', '1.75× counter', '2× counter', '2× counter + stun', '2.5× counter + stun, lasts 2 blocks'] },
    { id: 'icy_rain',       name: 'Icy Rain',       rank5Name: 'Flash Freeze',     mp: 8,  icon: 'ab_icy_rain',
      desc: 'Ice shards wound and slow the enemy.',
      ranks: ['Slow 33% for 3 turns', 'Slow 40% for 3 turns', 'Slow 40% for 4 turns', 'Slow 45% for 4 turns + frostbite', 'Slow 50% for 5 turns + frostbite + freeze'] },
    { id: 'shatter',        name: 'Shatter',        rank5Name: 'Ruin',             mp: 6,  icon: 'ab_shatter',
      desc: "Break the enemy's guard for the rest of the fight.",
      ranks: ['Armour -40%, +10% damage taken', 'Armour -50%, +10% damage taken', 'Armour -60%, +15% taken, SPD -10%', 'Armour -80%, +15% taken, SPD -10%', 'Armour gone, +20% taken, SPD -15%, flinch'] },
    { id: 'ultra_strength', name: 'Ultra Strength', rank5Name: "Berserker's Rage", mp: 9,  icon: 'ab_ultra_strength',
      desc: 'Massive strength for a few turns, then exhaustion.',
      ranks: ['1.5× damage 3 turns, exhausted 3', '1.5× damage 3 turns, exhausted 2', '1.5× damage 3 turns, exhausted 1', '1.6× damage 3 turns, no exhaustion', '1.75× damage 4 turns, no exhaustion'] },
  ];

  D.LEVEL_ABILITIES = {
    1: 'double_slash',
    2: 'vanish',
    3: 'rallying_cry',
    4: 'speed_warrior',
    5: 'fireball',
    6: 'riposte',
    7: 'icy_rain',
    8: 'shatter',
    9: 'ultra_strength',
  };
  D.SLOTS = 3;

  // ---------------------------------------------------------------
  // THE RUSTY FLAGON — quest givers and rumours.
  // {enemy} and {reward} are filled in.
  // ---------------------------------------------------------------
  D.QUEST_GIVERS = [
    'A woman emerges from the darkness with a dreadful bandaged wound to her face. She tells you that the {enemy} killed her sister, and almost killed her. "If you defeat it," she whispers, "I will give you {reward} gold."',
    'A one-armed veteran slides onto the bench beside you. "The {enemy} took this arm, and my pride with it. Bring me word of its death and {reward} gold is yours."',
    'A pale scholar in ink-stained robes leans close. "I need proof the {enemy} can bleed. Kill it in the arena and my college will pay {reward} gold."',
    'The innkeeper wipes a tankard and lowers his voice. "Bookmakers lost a fortune on the {enemy} last season. They\'ll pay {reward} gold to see it fall."',
  ];

  D.RUMORS = [
    'They say the North Gate has been sealed since the old king died. Only a Captain of the Guard may order it opened.',
    'Fishermen from Blackstone, up the coast, have stopped coming to market. Their boats come back empty, or not at all.',
    'A merchant swears the caves beyond the North Gate glitter with gold — and with eyes.',
    'The dragon in the arena was caught as a hatchling. It has not forgotten.',
    'Fire, they say, stops a troll knitting itself back together.',
    'Watch a beast\'s shoulders, not its claws. The shoulders never lie.',
    'The Lich in the Crown fights with tricks. It will feint, and feint again.',
    'An old sailor drinks alone by the fire, muttering about a black stone town and something that sings beneath the waves.',
    'A good parry rings like a bell. Wait for the glint, then raise your shield.',
    'The smith says a mace will rattle a skeleton better than any sword.',
    'Speed wins fights. A quick blade and quick feet buy you extra swings.',
    'Some say the Captain of the Guard is the only one who has seen the road north, and that he never came back.',
  ];
})();
