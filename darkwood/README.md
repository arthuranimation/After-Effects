# Darkwood — Arena of Champions (v9.0)

A phone-first remake of the classic arena RPG, rebuilt as Amiga-style pixel art.
Everything (sprites, scenes, the font and the music) is drawn and synthesised by
code, so the whole game is one self-contained file with no images and no server.

**Play:** open `index.html` in any modern browser. On a phone, use "Add to Home
Screen" for a full-screen app. Progress saves automatically in the browser, and
saves from Darkwood 8.0 are migrated.

## How to play

- **Town:** tap a building, or use the buttons below the scene.
  - **Arena:** four rings of five foes each. Beat 4 foes in a ring to open the
    next ring. Each ring hits much harder than the last, so you will need
    armour. The Red Dragon waits at the top of the last ring.
  - **Smithy:** weapons trade damage against speed, and some have traits:
    *Crush* ignores armour, *Crit* lands more critical hits, *Holy* deals
    extra damage to undead and fiends. Your old weapon is traded in for 30%.
  - **Apothecary:** potions, mana draughts, armour, rings, tomes and wands.
  - **The Rusty Flagon:** rent a room to fully rest, or sleep in the stables
    for free (half health). Strangers may offer you a paid oath to kill a foe.
    A pale stranger plays **Bone Dice**: roll three, hold any, re-roll once.
    Skulls stay where they fall. Three skulls pays ×12, three crowns ×8, any
    other triple ×3, two crowns ×1.5, and a pair returns your stake.
- **Combat:** the turn strip shows who acts next; faster fighters act more often.
  - **Your turn:** Attack, use Skills (MP), use Items, or Flee.
  - **Blocking:** when a monster winds up, watch which side it raises its
    weapon or claw on and guard that side: tap the battle **left of your hero,
    above your hero, or right of your hero** (the left, middle and right
    thirds of the screen), or use the arrow keys. A block cuts the damage by
    80% and gives you 1 MP.
  - **Parrying:** block at the last moment, when the glint flashes and the
    timing bar above your hero reaches the gold zone. A parry stops all the
    damage, gives you 2 MP and lets you act sooner.
  - **Attack styles:** every monster has its own moves, named as they wind up.
    *Lunges* creep, then snap forward (the bar speeds up). *Delayed* swings stop
    halfway to bait an early parry. *Heavy* blows are slow and hurt.
    *Flurries* are three quick strikes. *Jabs* are fast and light. Some foes
    *feint* (switch sides mid wind-up), and fire breath can be blocked but
    never parried.
- **Levelling:** each level gives a little HP and MP automatically, plus a
  choice:
  - **Vitality:** more max HP.
  - **Arcane:** more max MP.
  - **Mastery:** rank a skill up toward its rank-5 form, e.g. Fireball → Inferno.

  New skills unlock up to level 9. You can equip any three of them on the Hero
  screen.
- **Rematches:** after a win, *Fight Again* brings the foe back with an extra
  life for more gold.
- **Block Assist** (in Options) slows down wind-ups, widens the parry window
  and shows an arrow on the attacking side. Use it if the timing is too tight.

## Changes since 8.0

**Bugs fixed:**
- Ability ranks 2–5 can now be reached.
- Abilities are no longer silently overwritten when your slots are full.
- Gaining several levels at once now grants every reward and every skill.
- Ultra Strength is no longer applied twice.
- Fireball no longer subtracts *your* armour from its damage.
- Enemies now have armour, so Shatter, Crush and the wands actually do something.
- The Troll's 1,500-gold typo is fixed.
- Starting a new game now fully resets your hero, skills and quest.
- A defeated hero with no gold can no longer get stuck (the stables are free).

**New:**
- Directional blocking and parrying.
- Feints and combos.
- Weapon speed and traits.
- Tiered arena.
- Turn-order preview.
- Danger ratings.
- Skill loadouts.
- Bestiary.
- Varied quests and rumours.
- An ending where the North Gate opens, setting up the next chapter: the
  countryside, its caves and dungeons, and Blackstone.

## Editing the game

Source lives in `src/` and is built into the single `index.html`:

```sh
node build.mjs          # rebuild index.html (and dev.html, which loads src/ directly)
```

- **Balance & content:** `src/10_data.js` holds weapons, enemies, items,
  abilities, rings, quests and rumours.
- **Rules:** `src/11_state.js` (formulas, shops, levelling, saves) and
  `src/12_combat.js` (the combat engine).
- **Screens:** `src/3x_*.js`.
- **Art:** `src/2x_art_*.js`. See [`ART_SPEC.md`](ART_SPEC.md) for the sprite
  format, if you want to swap in your own sprites.
- **Audio:** `src/07_audio.js`.

Tools (Node 18+ and Playwright):

```sh
node tools/sim.mjs 40 all                       # headless balance simulation (novice / average / expert bots)
node tools/shot.mjs --out x.png --zoom 3 --eval "DW.preview.enemy('Red Dragon')"   # art contact sheets
node tools/play.mjs --scenario tools/scenarios/tour.mjs --out shots/                 # phone-sized playtest screenshots
```
