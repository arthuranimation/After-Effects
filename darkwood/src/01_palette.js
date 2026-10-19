// ================================================================
// PALETTE — 12-bit Amiga-style colours (#rgb, 4096 possible).
// Ramps run dark → light and hue-shift (cool shadows, warm lights),
// which is what makes shaded pixel art read as "painted".
// ================================================================
(() => {
  const P = DW.pal = {};

  P.ramps = {
    ink:     ['#000', '#101', '#112', '#213'],
    night:   ['#001', '#102', '#113', '#224', '#235', '#346', '#468', '#68a'],
    dusk:    ['#102', '#203', '#314', '#425', '#636', '#847', '#a58', '#c79'],
    stone:   ['#101', '#112', '#223', '#334', '#445', '#556', '#778', '#99a', '#bbc', '#dde'],
    sand:    ['#100', '#210', '#321', '#432', '#543', '#764', '#986', '#ba8', '#dca'],
    wood:    ['#100', '#200', '#310', '#420', '#531', '#742', '#963', '#b85'],
    skin:    ['#200', '#301', '#512', '#723', '#944', '#b65', '#d97', '#eca'],
    green:   ['#010', '#021', '#132', '#243', '#354', '#475', '#6a6', '#9c7', '#ce9'],
    leaf:    ['#001', '#011', '#021', '#132', '#243', '#364', '#486', '#6a7'],
    olive:   ['#110', '#220', '#331', '#442', '#563', '#784', '#9a5', '#bc7'],
    bone:    ['#110', '#221', '#432', '#554', '#776', '#998', '#bba', '#ddc', '#ffe'],
    blood:   ['#100', '#200', '#401', '#702', '#a13', '#d33', '#f65', '#f98'],
    crimson: ['#100', '#200', '#301', '#502', '#803', '#a12', '#c32', '#e53', '#f86', '#fb9'],
    ember:   ['#100', '#200', '#300', '#410', '#620', '#830', '#a40', '#c60'],
    fire:    ['#100', '#300', '#610', '#920', '#c40', '#e70', '#fa2', '#fd5', '#ffb', '#fff'],
    gold:    ['#100', '#320', '#530', '#750', '#a70', '#c92', '#eb3', '#fe6', '#ffb'],
    ice:     ['#002', '#013', '#125', '#248', '#37a', '#5ac', '#8de', '#bef', '#eff'],
    arcane:  ['#101', '#202', '#314', '#426', '#538', '#74a', '#96c', '#b8e', '#dbf'],
    fur:     ['#100', '#210', '#321', '#432', '#643', '#754', '#965', '#b87', '#da9'],
    tan:     ['#110', '#220', '#431', '#642', '#853', '#a74', '#c95', '#eb7', '#fd9'],
    ghoul:   ['#011', '#012', '#123', '#234', '#356', '#477', '#698', '#9ba', '#cdc'],
    teal:    ['#011', '#022', '#033', '#144', '#255', '#376', '#498', '#6ba', '#9dc'],
    steel:   ['#101', '#112', '#223', '#345', '#467', '#689', '#8ab', '#bcd', '#eef'],
    rust:    ['#100', '#200', '#310', '#520', '#731', '#942', '#b63'],
  };

  // Named colours for UI and text. Text markup can use these names: "{gold}100{/} gold".
  P.c = {
    black: '#000', white: '#fff',
    text: '#ddc', bright: '#ffe', dim: '#889', dark: '#556', faint: '#334',
    gold: '#fd5', goldDim: '#a70',
    red: '#f65', redDim: '#a13',
    green: '#9d7', greenDim: '#475',
    blue: '#8de', blueDim: '#37a',
    purple: '#c9f', purpleDim: '#74a',
    orange: '#fa2', ice: '#bef', fire: '#fa2',
    panel: '#223', panelDark: '#112', shadow: '#000',
  };

  // ---------------------------------------------------------------
  // Colour maths
  // ---------------------------------------------------------------
  const rgbCache = new Map();
  P.rgb = hex => {
    let v = rgbCache.get(hex);
    if (v) return v;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    rgbCache.set(hex, v);
    return v;
  };

  // Quantise to 12-bit and return '#rgb'.
  P.fromRGB = (r, g, b) => {
    const q = v => Math.max(0, Math.min(15, Math.round(v / 17))).toString(16);
    return '#' + q(r) + q(g) + q(b);
  };

  P.mix = (a, b, t) => {
    const A = P.rgb(a), B = P.rgb(b);
    return P.fromRGB(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  };

  P.shade = (hex, f) => {
    const A = P.rgb(hex);
    return P.fromRGB(A[0] * f, A[1] * f, A[2] * f);
  };

  // Uint32 in ImageData byte order (little-endian ABGR), alpha 255.
  const intCache = new Map();
  P.toInt = hex => {
    let v = intCache.get(hex);
    if (v !== undefined) return v;
    const [r, g, b] = P.rgb(hex);
    v = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    intCache.set(hex, v);
    return v;
  };
  P.fromInt = v => P.fromRGB(v & 255, (v >>> 8) & 255, (v >>> 16) & 255);

  // ---------------------------------------------------------------
  // Ordered dithering — 4x4 Bayer matrix, the classic Amiga look.
  // ---------------------------------------------------------------
  P.bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  P.thresh = (x, y) => (P.bayer4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;

  P.ramp = name => (Array.isArray(name) ? name : P.ramps[name] || P.ramps.stone);

  // Pick a dithered colour from a ramp at a fractional index v (0 .. len-1).
  P.rampColor = (ramp, v, x, y) => {
    ramp = P.ramp(ramp);
    const n = ramp.length - 1;
    if (v <= 0) return ramp[0];
    if (v >= n) return ramp[n];
    const i = Math.floor(v);
    return ramp[(v - i) > P.thresh(x, y) ? i + 1 : i];
  };

  // Same, with f normalised to 0..1 across the whole ramp.
  P.rampF = (ramp, f, x, y) => {
    ramp = P.ramp(ramp);
    return P.rampColor(ramp, f * (ramp.length - 1), x, y);
  };
})();
