// ================================================================
// FONT — a hand-made proportional bitmap font (7px caps, 2px
// descenders, 10px line height) plus a scaled "logo" style with
// copper gradient fill, outline and drop shadow.
//
// Text markup: "{gold}100{/} gold"  switches colour by palette
// name (DW.pal.c) or hex ("{#f65}"); "{/}" returns to the base colour.
// ================================================================
(() => {
  const P = DW.pal, G = DW.gfx;
  const F = DW.font = {};

  F.LINE = 10;     // line height
  F.ASCENT = 7;    // cap height (baseline sits at y + 6)

  // Rows top → bottom; rows 7-8 are descenders. '#' = ink.
  const GLYPHS = {
    'A': '.###.|#...#|#...#|#####|#...#|#...#|#...#',
    'B': '####.|#...#|#...#|####.|#...#|#...#|####.',
    'C': '.###.|#...#|#....|#....|#....|#...#|.###.',
    'D': '####.|#...#|#...#|#...#|#...#|#...#|####.',
    'E': '#####|#....|#....|####.|#....|#....|#####',
    'F': '#####|#....|#....|####.|#....|#....|#....',
    'G': '.###.|#...#|#....|#.###|#...#|#...#|.####',
    'H': '#...#|#...#|#...#|#####|#...#|#...#|#...#',
    'I': '###|.#.|.#.|.#.|.#.|.#.|###',
    'J': '..###|...#.|...#.|...#.|#..#.|#..#.|.##..',
    'K': '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
    'L': '#....|#....|#....|#....|#....|#....|#####',
    'M': '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
    'N': '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
    'O': '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
    'P': '####.|#...#|#...#|####.|#....|#....|#....',
    'Q': '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
    'R': '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
    'S': '.####|#....|#....|.###.|....#|....#|####.',
    'T': '#####|..#..|..#..|..#..|..#..|..#..|..#..',
    'U': '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
    'V': '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
    'W': '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.',
    'X': '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
    'Y': '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
    'Z': '#####|....#|...#.|..#..|.#...|#....|#####',

    'a': '....|....|.##.|...#|.###|#..#|.###',
    'b': '#...|#...|###.|#..#|#..#|#..#|###.',
    'c': '....|....|.###|#...|#...|#...|.###',
    'd': '...#|...#|.###|#..#|#..#|#..#|.###',
    'e': '....|....|.##.|#..#|####|#...|.###',
    'f': '.##|#..|###|#..|#..|#..|#..',
    'g': '....|....|.###|#..#|#..#|#..#|.###|...#|.##.',
    'h': '#...|#...|###.|#..#|#..#|#..#|#..#',
    'i': '#|.|#|#|#|#|#',
    'j': '.#|..|.#|.#|.#|.#|.#|.#|#.',
    'k': '#...|#...|#..#|#.#.|##..|#.#.|#..#',
    'l': '#.|#.|#.|#.|#.|#.|.#',
    'm': '.....|.....|##.#.|#.#.#|#.#.#|#.#.#|#.#.#',
    'n': '....|....|###.|#..#|#..#|#..#|#..#',
    'o': '....|....|.##.|#..#|#..#|#..#|.##.',
    'p': '....|....|###.|#..#|#..#|#..#|###.|#...|#...',
    'q': '....|....|.###|#..#|#..#|#..#|.###|...#|...#',
    'r': '....|....|#.##|##..|#...|#...|#...',
    's': '....|....|.###|#...|.##.|...#|###.',
    't': '.#.|.#.|###|.#.|.#.|.#.|..#',
    'u': '....|....|#..#|#..#|#..#|#..#|.###',
    'v': '.....|.....|#...#|#...#|#...#|.#.#.|..#..',
    'w': '.....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.',
    'x': '.....|.....|#...#|.#.#.|..#..|.#.#.|#...#',
    'y': '....|....|#..#|#..#|#..#|#..#|.###|...#|.##.',
    'z': '....|....|####|...#|.##.|#...|####',

    '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
    '1': '.#.|##.|.#.|.#.|.#.|.#.|###',
    '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
    '3': '####.|....#|....#|.###.|....#|....#|####.',
    '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
    '5': '#####|#....|####.|....#|....#|#...#|.###.',
    '6': '.###.|#....|#....|####.|#...#|#...#|.###.',
    '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
    '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
    '9': '.###.|#...#|#...#|.####|....#|....#|.###.',

    '.': '.|.|.|.|.|.|#',
    ',': '..|..|..|..|..|.#|.#|#.',
    ':': '.|.|#|.|.|#|.',
    ';': '..|..|.#|..|..|.#|.#|#.',
    '!': '#|#|#|#|#|.|#',
    '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
    "'": '#|#|.|.|.|.|.',
    '"': '#.#|#.#|...|...|...|...|...',
    '-': '....|....|....|####|....|....|....',
    '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
    '=': '....|....|####|....|####|....|....',
    '/': '....#|....#|...#.|..#..|.#...|#....|#....',
    '(': '..#|.#.|#..|#..|#..|.#.|..#',
    ')': '#..|.#.|..#|..#|..#|.#.|#..',
    '[': '##|#.|#.|#.|#.|#.|##',
    ']': '##|.#|.#|.#|.#|.#|##',
    '%': '##..#|##.#.|...#.|..#..|.#...|.#.##|#..##',
    '*': '.....|..#..|#.#.#|.###.|#.#.#|..#..|.....',
    '<': '...#|..#.|.#..|#...|.#..|..#.|...#',
    '>': '#...|.#..|..#.|...#|..#.|.#..|#...',
    '_': '.....|.....|.....|.....|.....|.....|#####',
    '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#',
    '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.',
    '$': '..#..|.####|#.#..|.###.|..#.#|####.|..#..',
    '@': '.###.|#...#|#.###|#.#.#|#.##.|#....|.###.',
    '×': '.....|.....|#...#|.#.#.|..#..|.#.#.|#...#',
    '·': '.|.|.|#|.|.|.',
    '–': '....|....|....|####|....|....|....',
    '—': '......|......|......|######|......|......|......',
    '→': '.....|..#..|...#.|#####|...#.|..#..|.....',
    '←': '.....|..#..|.#...|#####|.#...|..#..|.....',
    '↑': '..#..|.###.|#.#.#|..#..|..#..|..#..|.....',
    '↓': '.....|..#..|..#..|..#..|#.#.#|.###.|..#..',
    '♥': '.....|.#.#.|#####|#####|.###.|..#..|.....',
    '●': '.....|.###.|#####|#####|#####|.###.|.....',
    '○': '.....|.###.|#...#|#...#|#...#|.###.|.....',
    '★': '..#..|..#..|#####|.###.|.#.#.|#...#|.....',
    '✓': '.....|....#|...#.|#.#..|.#...|.....|.....',
    '▲': '.....|..#..|.###.|#####|.....|.....|.....',
    '▼': '.....|#####|.###.|..#..|.....|.....|.....',
    '◀': '...#|..##|.###|####|.###|..##|...#',
    '▶': '#...|##..|###.|####|###.|##..|#...',
    '…': '.....|.....|.....|.....|.....|.....|#.#.#',
  };
  // Typographic aliases
  const ALIAS = { '’': "'", '‘': "'", '“': '"', '”': '"', 'é': 'e', 'ö': 'o', '–': '-', '−': '-' };

  const SPACE_W = 3;
  const GLYPH_GAP = 1;

  // Parse glyph strings once: { w, rows: [string...] }
  const glyphs = {};
  for (const ch in GLYPHS) {
    const rows = GLYPHS[ch].split('|');
    glyphs[ch] = { w: rows[0].length, rows };
  }
  const glyphOf = ch => glyphs[ch] || glyphs[ALIAS[ch]] || glyphs[ch.toUpperCase()] || glyphs['?'];

  // ---------------------------------------------------------------
  // Atlas: all glyphs rendered once per colour.
  // ---------------------------------------------------------------
  const CHARS = Object.keys(glyphs);
  const CELL_W = 7, CELL_H = 9;
  const atlases = new Map();
  const atlasIndex = {};
  CHARS.forEach((ch, i) => { atlasIndex[ch] = i; });

  function atlas(col) {
    let a = atlases.get(col);
    if (a) return a;
    const o = G.offscreen(CHARS.length * CELL_W, CELL_H);
    o.ctx.fillStyle = col;
    CHARS.forEach((ch, i) => {
      const g = glyphs[ch];
      g.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === '#') o.ctx.fillRect(i * CELL_W + x, y, 1, 1);
      });
    });
    a = o.canvas;
    atlases.set(col, a);
    return a;
  }

  const resolveCol = name => {
    if (!name) return null;
    if (name[0] === '#') return name;
    return P.c[name] || null;
  };

  // Split markup into runs: [{text, col}]
  function runs(text, base) {
    const out = [];
    let col = base, buf = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') {
        const end = text.indexOf('}', i);
        if (end > i) {
          const tag = text.slice(i + 1, end);
          if (buf) { out.push({ text: buf, col }); buf = ''; }
          col = tag === '/' || tag === '' ? base : (resolveCol(tag) || col);
          i = end;
          continue;
        }
      }
      buf += ch;
    }
    if (buf) out.push({ text: buf, col });
    return out;
  }

  F.strip = text => String(text).replace(/\{[^}]*\}/g, '');

  F.charW = ch => (ch === ' ' ? SPACE_W : glyphOf(ch).w);

  // Shorten plain text with "…" so it fits maxW pixels.
  F.fit = (text, maxW) => {
    text = String(text);
    if (F.measure(text) <= maxW) return text;
    let t = F.strip(text);
    while (t.length > 1 && F.measure(t + '…') > maxW) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  };

  F.measure = (text, scale = 1) => {
    const s = F.strip(text);
    let w = 0;
    for (let i = 0; i < s.length; i++) {
      w += F.charW(s[i]);
      if (i < s.length - 1) w += GLYPH_GAP;
    }
    return w * scale;
  };

  function drawRaw(ctx, s, x, y, col) {
    const a = atlas(col);
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === ' ') { x += SPACE_W + GLYPH_GAP; continue; }
      const key = glyphs[ch] ? ch : glyphs[ALIAS[ch]] ? ALIAS[ch] : glyphs[ch.toUpperCase()] ? ch.toUpperCase() : '?';
      const g = glyphs[key];
      ctx.drawImage(a, atlasIndex[key] * CELL_W, 0, g.w, CELL_H, x, y, g.w, CELL_H);
      x += g.w + GLYPH_GAP;
    }
    return x;
  }

  // Draw text. o: { align: 'left'|'center'|'right', shadow: colour|true, outline: colour, ctx }
  // Returns the drawn width.
  F.draw = (text, x, y, col = P.c.text, o = {}) => {
    const ctx = o.ctx || G.ctx;
    text = String(text);
    const w = F.measure(text);
    if (o.align === 'center') x -= Math.floor(w / 2);
    else if (o.align === 'right') x -= w;
    x |= 0; y |= 0;
    const rs = runs(text, col);
    const pass = (dx, dy, override) => {
      let cx = x + dx;
      for (const r of rs) cx = drawRaw(ctx, r.text, cx, y + dy, override || r.col);
    };
    if (o.outline) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) pass(dx, dy, o.outline);
    } else if (o.shadow) {
      pass(1, 1, o.shadow === true ? '#000' : o.shadow);
    }
    pass(0, 0, null);
    return w;
  };

  // Word-wrap to maxW pixels. Colour markup is carried across line breaks.
  F.wrap = (text, maxW) => {
    const lines = [];
    for (const para of String(text).split('\n')) {
      const words = para.split(' ');
      let line = '', lineW = 0, open = '';
      for (const word of words) {
        const ww = F.measure(word);
        const add = line ? F.measure(' ') + GLYPH_GAP * 2 + ww : ww;
        if (line && lineW + add > maxW) {
          lines.push(line);
          line = open + word;
          lineW = ww;
        } else {
          line += (line ? ' ' : '') + word;
          lineW += add;
        }
        // track the last open colour tag so it carries to the next line
        const tags = word.match(/\{[^}]*\}/g);
        if (tags) { const last = tags[tags.length - 1]; open = last === '{/}' ? '' : last; }
      }
      lines.push(line);
    }
    return lines;
  };

  // Draw wrapped text; returns total height used.
  F.drawWrapped = (text, x, y, maxW, col = P.c.text, o = {}) => {
    const lines = F.wrap(text, maxW);
    const lh = o.lineH || F.LINE;
    lines.forEach((ln, i) => F.draw(ln, o.align === 'center' ? x + Math.floor(maxW / 2) : x, y + i * lh, col, o));
    return lines.length * lh;
  };

  // ---------------------------------------------------------------
  // Big text: pixel-scaled glyphs with a vertical ramp gradient,
  // dark outline, bevel highlight and drop shadow — Amiga title style.
  // o: { scale (2), ramp ('gold'), outline ('#000'), shadow (true), align, ctx, hiRow }
  // Cached per (text, scale, ramp).
  // ---------------------------------------------------------------
  F.big = (text, x, y, o = {}) => {
    const scale = o.scale || 2;
    const rampName = o.ramp || 'gold';
    const ramp = P.ramp(rampName);
    const key = 'bigfont|' + text + '|' + scale + '|' + (Array.isArray(rampName) ? rampName.join() : rampName) + '|' + (o.outline || '') + (o.shadow === false ? 'n' : 's');
    const tw = F.measure(text) * scale;
    const th = 9 * scale;
    const pad = 3;
    const img = G.cache(key, tw + pad * 2, th + pad * 2, ctx => {
      // 1) glyph mask
      const mask = new Uint8Array((tw + pad * 2) * (th + pad * 2));
      const W = tw + pad * 2;
      let cx = 0;
      const s = F.strip(text);
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === ' ') { cx += (SPACE_W + GLYPH_GAP) * scale; continue; }
        const g = glyphOf(ch);
        g.rows.forEach((row, gy) => {
          for (let gx = 0; gx < row.length; gx++) if (row[gx] === '#') {
            for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
              mask[(pad + gy * scale + sy) * W + pad + cx + gx * scale + sx] = 1;
            }
          }
        });
        cx += (g.w + GLYPH_GAP) * scale;
      }
      const H = th + pad * 2;
      const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? mask[y * W + x] : 0;
      const capH = 7 * scale;
      // 2) shadow
      if (o.shadow !== false) {
        ctx.fillStyle = '#000';
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x - 2, y - 2)) ctx.fillRect(x, y, 1, 1);
      }
      // 3) outline
      ctx.fillStyle = o.outline || '#000';
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (at(x, y)) continue;
        if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1) || at(x - 1, y - 1) || at(x + 1, y + 1) || at(x + 1, y - 1) || at(x - 1, y + 1)) ctx.fillRect(x, y, 1, 1);
      }
      // 4) gradient fill with bevel: light at the top, mid-tone at the baseline
      const hiI = ramp.length - 1, loI = Math.max(1, Math.floor(ramp.length * 0.45));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!at(x, y)) continue;
        const f = 1 - Math.min(1, Math.max(0, (y - pad) / capH));
        let col = P.rampColor(ramp, loI + f * (hiI - 1 - loI), x, y);
        if (!at(x, y - 1)) col = ramp[hiI];                                       // top bevel light
        else if (!at(x, y + 1) || !at(x + 1, y)) col = ramp[loI - 1];             // bottom-right bevel dark
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    });
    let dx = x - pad;
    if (o.align === 'center') dx = x - Math.floor(tw / 2) - pad;
    else if (o.align === 'right') dx = x - tw - pad;
    (o.ctx || G.ctx).drawImage(img, dx | 0, (y - pad) | 0);
    return tw;
  };
})();
