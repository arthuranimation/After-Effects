# Darkwood — Art Specification

All art in Darkwood is **procedural pixel art**: JavaScript functions paint each
sprite into a pixel buffer using shaded primitives from the sprite kit
(`src/03_kit.js`). Frames are rendered once, cached, and drawn on a low-res
canvas (~216–288 px wide, 400–600 px tall) that the browser scales up by whole
device pixels, so every game pixel stays a crisp square on a phone.

The target look is **early-90s Amiga dark fantasy**: Shadow of the Beast,
Lionheart, Moonstone, Ambermoon, Eye of the Beholder, Black Crypt, Gods. That means:

- rich, *hue-shifted* shading (cool purple/blue shadows, warm highlights)
- ordered (Bayer) dithering for gradients — never smooth alpha blends
- strong, readable silhouettes with a dark 1 px outline
- moody night palettes with hot accents (torchlight, glowing eyes, fire)
- 12-bit colour only (`#rgb` hex, 3 digits) — use `DW.pal.ramps` where possible

## Files and ownership

| File | Contents |
| --- | --- |
| `src/20_art_hero.js` | hero (back view) |
| `src/21_art_enemies_t1.js` | Giant Rat, Kobold, Goblin, Skeleton, Orc |
| `src/22_art_enemies_t2.js` | Gnoll, Hobgoblin, Ghoul, Bugbear, Wight |
| `src/23_art_enemies_t3.js` | Ogre, Troll, Basilisk, Werewolf, Vampire |
| `src/24_art_enemies_t4.js` | Hill Giant, Fire Giant, Lich, Demon, Red Dragon |
| `src/25_art_icons.js` | item, ability, status and UI icons |
| `src/26_art_scenes_ext.js` | title, logo, town, victory |
| `src/27_art_scenes_int.js` | arena stage, smithy, apothecary, inn |

Rules for every art file:

- Wrap the whole file in an IIFE: `(() => { ... })();` — no new globals.
- Only register into `DW.art.*`. Never edit the foundation files (`00`–`06`).
- Use `DW.util.rng(seed)` for any randomness (deterministic art). No `Math.random()`.
- Painting a frame may take up to ~30 ms (it is cached). Per-frame `animate()`
  code must be cheap (< 2 ms): draw with `DW.gfx` primitives or blit small
  pre-cached sprites (`DW.kit.cached(key, w, h, fn)` keyed by frame index).
- End every character/icon with `S.outline()` (ink `#101`) unless a different
  outline is a deliberate stylistic choice.
- Keep the kit's default light direction (upper-left). Consistent lighting is
  what makes 20 separately-drawn monsters feel like one game.

## The sprite kit (cheat sheet)

```js
const img = DW.kit.make(w, h, S => { ... });  // returns a canvas
S.ball(cx, cy, rx, ry, ramp, o)      // shaded ellipsoid. o.rot, o.depth, o.spec, o.rim, o.lo, o.hi, o.tone, o.clip
S.capsule(x1,y1,x2,y2,r1,r2,ramp,o)  // tapered shaded limb / neck / tail
S.horn(x0,y0,cx,cy,x1,y1,r0,r1,ramp,o) // curved bezier capsule chain (horns, claws, tails)
S.poly(points, ramp, o)              // polygon. o.tone (0..1), o.n facet normal, o.grad [x0,y0,x1,y1,t0,t1]
S.tri(a, b, c, ramp, o)
S.ellipse(cx,cy,rx,ry,col) / S.rect / S.line / S.px    // flat colour
S.glow(x, y, col, r)                 // glowing eye / gem with dithered halo
S.speckle(x,y,w,h,density,fn,seed)   // texture: fn(hex) -> hex on painted pixels
S.recolor(test(x,y), col|fn)         // repaint painted pixels matching a test
S.stamp(otherSprite, dx, dy, flipX)  // composite a Sprite (K.create(w,h)) into this one
S.outline(col='#101', {selective, diag})
S.innerShadow()                      // darken bottom-right inner edge
```

`o.lo` / `o.hi` restrict which part of the ramp a primitive uses (e.g. `{lo: 2}`
pushes a far limb darker). `o.tone` gives a fixed brightness instead of lighting.
Painter's order matters: draw far limbs first, near limbs last.

Ramps: `ink night dusk stone sand wood skin green leaf olive bone blood crimson
ember fire gold ice arcane fur tan ghoul teal steel rust` (see `src/01_palette.js`).

## Enemies

Register in `DW.art.enemies[name]` using the **exact** enemy name:

```js
DW.art.enemies['Goblin'] = {
  w: 88, h: 96,              // canvas size (see size classes)
  anchor: [44, 94],          // feet point: where the sprite touches the floor
  center: [44, 50],          // body centre: hit sparks & damage numbers spawn here
  mouth: [44, 30],           // optional: where breath / spit effects start
  draw(S, pose) { ... },     // paint one frame
  portrait(S) { ... },       // 24×24 head-and-shoulders bust for menus
};
```

**Size classes** (canvas w × h): S `64×56` · M `88×96` · L `120×120` · XL `168×136`.
Leave 1 px free on every edge for the outline.

**Pose** — the engine asks for these frames (≈14 per enemy, each cached once):

| pose | meaning |
| --- | --- |
| `{f:0..3}` | idle loop, played ~4 fps: breathing, swaying, tail flicks, flame flicker |
| `{dir:-1, wind:0.5 \| 1}` | wind-up of an attack that lands from **screen-left** |
| `{dir: 0, wind:0.5 \| 1}` | wind-up of an **overhead** attack (from above) |
| `{dir: 1, wind:0.5 \| 1}` | wind-up of an attack that lands from **screen-right** |
| `{dir, strike:1}` | the blow landing, following through toward the player |
| `{hurt:1}` | recoil: flinch back, eyes squeezed / mouth open |

**The wind-up is a gameplay tell — this matters most.** The player blocks by
reading which side the attack comes from, so wind-ups must be instantly
readable on a phone at 1×:

- `dir:-1`: weapon/claw/head pulled back and **raised high on the screen-LEFT**
  side; body twisting left.
- `dir: 1`: the mirror — raised on the **screen-RIGHT** side.
- `dir: 0`: both arms / weapon / head raised **straight up above the head**,
  body stretched tall (rearing, overhead chop, a breath attack from above).
- `wind:0.5` is half-way there, `wind:1` the full cocked pose (exaggerate it).
- Avoid mirror-flipping the whole sprite for the opposite side (it flips the
  lighting); move the limbs instead. Flipping only a symmetric weapon is fine.

Personality matters more than detail: a hunched, sneering goblin; a lumbering
ogre; an elegant, menacing vampire. Faces read at 1×: big eye shapes, glowing
pupils, teeth.

## Hero

`DW.art.hero = { w: 80, h: 72, anchor: [40, 71], draw(S, pose, gear) }`

The hero is seen **from behind, over the shoulder** (Punch-Out!! style), at the
bottom of the combat stage, facing the enemy. The bottom ~10 px may be hidden
under the UI. Shield on the **left** arm (screen-left), weapon in the **right**
hand (screen-right).

- `pose.act`: `idle` (f 0..3 breathing) · `attack` (t 0 wind-up over the right
  shoulder, t 1 mid-swing, t 2 follow-through down-left) · `block` (dir -1:
  shield raised on the left, 0: shield raised overhead, 1: shield swept across
  to the right) · `hurt` (recoil) · `cast` (both arms raised, glow between the
  hands) · `victory` (weapon raised high).
- `gear.weapon`: `dagger shortsword mace longsword axe flail greatsword hammer
  magicsword holysword` (magicsword has a cool blue glint, holysword glows gold).
- `gear.armor`: `none` (tunic) · `leather` · `chain` (dithered mail) ·
  `plate` (pauldrons) · `fullplate` (ornate, gold trim, helmet). The shield also
  upgrades: wood → iron-rimmed → steel kite → gilded.

## Icons

`DW.art.icons[name] = { w, h, draw(S) }`. Items and abilities are **14×14**,
statuses **7×7**, small UI glyphs **8×8**. Names are listed in the
icons task; the screens look icons up by name.

## Scenes

```js
DW.art.scenes['town'] = {
  paint(S, w, h, state) { ... },                    // static layer, cached per size+state
  animate(ctx, x, y, w, h, t, state, live) { ... }, // per frame overlay at (x, y), t in seconds
  hotspots(w, h, state) { return [{ id, x, y, w, h, label }]; },  // tappable areas
};
```

Scenes must be **responsive**: width 216–288, heights as listed per scene.
Anchor ground-level content to the bottom and let sky or walls stretch.

## Previewing your work

```sh
node tools/shot.mjs --own 21_art_enemies_t1.js --out /tmp/x.png --zoom 3 --eval "DW.preview.enemy('Goblin')"
node tools/shot.mjs --out /tmp/x.png --zoom 2 --eval "DW.preview.lineup(['Giant Rat','Kobold','Goblin'])"
node tools/shot.mjs --out /tmp/x.png --zoom 3 --eval "DW.preview.hero({weapon:'axe',armor:'plate'})"
node tools/shot.mjs --out /tmp/x.png --zoom 3 --eval "DW.preview.heroGear()"
node tools/shot.mjs --out /tmp/x.png --zoom 4 --eval "DW.preview.icons()"
node tools/shot.mjs --out /tmp/x.png --zoom 2 --eval "DW.preview.scene('town', 234, 330, 1.2)"
node tools/shot.mjs --out /tmp/x.png --zoom 2 --eval "DW.preview.sceneSizes('arena', [[216,200],[234,300],[288,360]])"
```

Script errors from any file are printed, so check the output as well as the image.

`--own file1.js,file2.js` loads only the foundation (`00`–`06`) plus the listed
files, so other files being edited at the same time can't break your preview.
