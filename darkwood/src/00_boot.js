'use strict';
// ================================================================
// BOOT — the shared namespace and small helpers every module uses.
// Every other file wraps itself in an IIFE and hangs its API off DW.
// ================================================================
var DW = window.DW = window.DW || {};

(() => {
  const U = DW.util = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min; // inclusive integers
  U.chance = p => Math.random() < p;
  U.pick = arr => arr[Math.floor(Math.random() * arr.length)];
  U.fmt = n => Math.round(n).toLocaleString('en-US');

  U.ease = {
    in: t => t * t,
    out: t => 1 - (1 - t) * (1 - t),
    inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    outBack: t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
    outBounce: t => {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    },
  };

  // Seeded RNG (mulberry32) so procedural art is identical on every load.
  U.rng = seed => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.hash = str => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  };

  // Cheap smooth 1D value noise, handy for flicker and sway.
  U.noise1 = (x, seed = 0) => {
    const i = Math.floor(x), f = x - i;
    const h = n => {
      let v = Math.imul((n + seed * 7919) ^ 0x5bd1e995, 0x27d4eb2d);
      v ^= v >>> 15;
      return (v >>> 0) / 4294967296;
    };
    const s = f * f * (3 - 2 * f);
    return h(i) * (1 - s) + h(i + 1) * s;
  };
})();
