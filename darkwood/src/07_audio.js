// ================================================================
// AUDIO — every sound and every note is synthesised here with the
// Web Audio API. There are no audio files.
//
//   DW.audio.unlock()           first user gesture: create/resume the context
//   DW.audio.sfx(name, opts)    fire-and-forget effect, opts {pitch, vol}
//   DW.audio.music(name|null)   switch track with a short fade, or stop
//   DW.audio.setMusic(on) / setSfx(on), .musicOn / .sfxOn (persisted)
//
// Music is written like an early-90s Amiga MOD: a handful of channels
// (lead, bass, arpeggio/chords, drums) playing "sampled" instruments.
// The samples are rendered in JS on first use (Karplus-Strong lute and
// harp, additive bells, synthetic drums) and replayed at any pitch the
// way Paula did; the rest are small oscillator patches. Songs are stored
// as compact text patterns (see SONGS) and played by a look-ahead
// scheduler. Everything is a silent no-op before unlock() or when Web
// Audio is missing, and no call ever throws.
// ================================================================
(() => {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const AU = DW.audio = { musicOn: true, sfxOn: true };
  const KEY = 'darkwood_audio';
  const AHEAD = 0.1, TICK_MS = 25, FADE = 0.35;
  const TAU = Math.PI * 2;

  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    if (s.music === false) AU.musicOn = false;
    if (s.sfx === false) AU.sfxOn = false;
  } catch (_) { /* storage blocked: keep defaults */ }
  const saveSettings = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ music: AU.musicOn, sfx: AU.sfxOn })); } catch (_) { /* ignore */ }
  };

  // Small seeded RNG so rendered samples are identical on every load.
  const rng = seed => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const jitter = () => 1 + (Math.random() * 2 - 1) * 0.04;

  // ---------------------------------------------------------------
  // Engine: master chain + rendered sample bank, built per context
  // (the live one, or an OfflineAudioContext for testing).
  // ---------------------------------------------------------------
  function makeEngine(c) {
    const E = { ctx: c, sr: c.sampleRate, ks: new Map() };
    E.nyq = E.sr * 0.45;
    // master: buses -> compressor -> warm lowpass (Paula-ish) -> soft clip
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.min(9500, E.nyq); lp.Q.value = 0.5;
    const clip = c.createWaveShaper();
    const cv = new Float32Array(2049);
    for (let i = 0; i < cv.length; i++) {
      const x = i / 1024 - 1, a = Math.abs(x);
      cv[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
    }
    clip.curve = cv;
    E.master = c.createGain();
    E.master.connect(comp); comp.connect(lp); lp.connect(clip); clip.connect(c.destination);
    E.out = clip;
    E.musicBus = gain(c, 0.32); E.musicBus.connect(E.master);
    E.sfxBus = gain(c, 0.6); E.sfxBus.connect(E.master);

    // crunch curve for crits
    const cr = new Float32Array(1025);
    for (let i = 0; i < cr.length; i++) { const x = i / 512 - 1; cr[i] = Math.tanh(x * 4) / Math.tanh(4); }
    E.crunch = cr;

    E.noise = mkBuf(c, 2, d => { const r = rng(7); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }, true);
    E.drum = makeDrums(c);
    E.bell = makeBell(c);
    E.waves = {
      organ: wave(c, [0, 0.55, 1, 0.3, 0.7, 0, 0.4, 0, 0.45, 0, 0.12, 0, 0.2, 0, 0, 0, 0.15]),
      flute: wave(c, [0, 1, 0.32, 0.1, 0.04, 0.02]),
    };
    return E;
  }

  function gain(c, v) { const g = c.createGain(); g.gain.value = v; return g; }
  function wave(c, amps) {
    const re = new Float32Array(amps.length), im = new Float32Array(amps);
    return c.createPeriodicWave(re, im);
  }
  function panner(c, p) {
    if (c.createStereoPanner) { const n = c.createStereoPanner(); n.pan.value = p || 0; return n; }
    return gain(c, 1);
  }
  function filt(E, type, f, q) {
    const n = E.ctx.createBiquadFilter();
    n.type = type; n.frequency.value = Math.min(f, E.nyq); n.Q.value = q == null ? 0.7 : q;
    return n;
  }

  // Render a mono buffer with fn(data, sampleRate, length); edges get a
  // tiny fade so a sample can never start or stop with a click.
  function mkBuf(c, dur, fn, raw) {
    const sr = c.sampleRate, n = Math.max(2, Math.floor(sr * dur));
    const b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
    fn(d, sr, n);
    if (!raw) {
      const fi = Math.min(n, Math.floor(sr * 0.0006)), fo = Math.min(n, Math.floor(sr * 0.008));
      for (let i = 0; i < fi; i++) d[i] *= i / fi;
      for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo;
    }
    return b;
  }
  const hpCoef = (fc, sr) => { const rc = 1 / (TAU * fc); return rc / (rc + 1 / sr); };
  // 808-style metallic source: six detuned square waves
  const metal = t => {
    let s = 0;
    for (const f of [507, 734, 887, 1255, 1296, 1920]) s += Math.sin(TAU * f * t) > 0 ? 1 : -1;
    return s / 6;
  };
  function hiss(d, sr, n, seed, fc, mix, env) {
    const r = rng(seed), a = hpCoef(fc, sr);
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, w = (r() * 2 - 1) * (1 - mix) + metal(t) * mix;
      const y = a * (y1 + w - x1); x1 = w; y1 = y;          // two one-pole highpasses
      const z = a * (y2 + y - x2); x2 = y; y2 = z;
      d[i] = z * env(t);
    }
  }

  function makeDrums(c) {
    const D = {};
    D.kick = mkBuf(c, 0.5, (d, sr, n) => {
      const r = rng(11); let ph = 0, lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, f = 44 + 115 * Math.exp(-t / 0.032) + 60 * Math.exp(-t / 0.004);
        ph += TAU * f / sr;
        let s = Math.sin(ph) * Math.exp(-t / 0.17);
        if (t < 0.005) { lp += (r() * 2 - 1 - lp) * 0.35; s += lp * 0.6 * (1 - t / 0.005); }
        d[i] = Math.tanh(s * 1.7) * 0.92;
      }
    });
    D.snare = mkBuf(c, 0.32, (d, sr, n) => {
      const r = rng(12), a = hpCoef(900, sr); let x1 = 0, y1 = 0, p1 = 0, p2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, w = r() * 2 - 1, y = a * (y1 + w - x1); x1 = w; y1 = y;
        p1 += TAU * 185 * (1 + 0.35 * Math.exp(-t / 0.012)) / sr; p2 += TAU * 330 / sr;
        d[i] = (Math.sin(p1) * 0.55 * Math.exp(-t / 0.05) + Math.sin(p2) * 0.22 * Math.exp(-t / 0.028) +
          y * 0.9 * Math.exp(-t / 0.075)) * 0.85;
      }
    });
    D.hat = mkBuf(c, 0.09, (d, sr, n) => hiss(d, sr, n, 13, 6500, 0.35, t => Math.exp(-t / 0.018) * 1.4));
    D.ohat = mkBuf(c, 0.5, (d, sr, n) => hiss(d, sr, n, 14, 6000, 0.35, t => Math.exp(-t / 0.13) * 1.2));
    D.crash = mkBuf(c, 2.2, (d, sr, n) => hiss(d, sr, n, 15, 3200, 0.3, t => Math.min(1, t / 0.003) * Math.exp(-t / 0.55) * 1.1));
    D.shaker = mkBuf(c, 0.14, (d, sr, n) => hiss(d, sr, n, 16, 5000, 0, t => Math.min(1, t / 0.008) * Math.exp(-t / 0.035) * 1.2));
    D.tom = mkBuf(c, 0.6, (d, sr, n) => {   // base pitch 110 Hz, re-pitched by rate
      const r = rng(17); let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr; ph += TAU * 110 * (1 + 0.5 * Math.exp(-t / 0.04)) / sr;
        d[i] = (Math.sin(ph) * Math.exp(-t / 0.2) + (r() * 2 - 1) * 0.15 * Math.exp(-t / 0.01)) * 0.9;
      }
    });
    D.timp = mkBuf(c, 1.8, (d, sr, n) => {  // base pitch 98 Hz (G2)
      const r = rng(18), P = [[1, 1, 0.9], [1.504, 0.45, 0.5], [1.742, 0.28, 0.4], [1.99, 0.22, 0.3]];
      const ph = [0, 0, 0, 0]; let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, gl = 1 + 0.04 * Math.exp(-t / 0.05); let s = 0;
        for (let k = 0; k < 4; k++) { ph[k] += TAU * 98 * P[k][0] * gl / sr; s += Math.sin(ph[k]) * P[k][1] * Math.exp(-t / P[k][2]); }
        lp += (r() * 2 - 1 - lp) * 0.08;
        d[i] = (s * 0.55 + lp * 1.2 * Math.exp(-t / 0.012)) * Math.min(1, t / 0.002);
      }
    });
    return D;
  }

  function makeBell(c) {   // additive church-bell partials at a base of 440 Hz
    const P = [[0.5, 0.25, 2.4], [1, 1, 2.0], [1.2, 0.35, 1.4], [1.5, 0.28, 1.2], [2, 0.45, 1.0],
      [2.51, 0.2, 0.7], [3.01, 0.14, 0.5], [4.17, 0.09, 0.35], [5.43, 0.05, 0.25]];
    return mkBuf(c, 3, (d, sr, n) => {
      let pk = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr; let s = 0;
        for (const [r, a, k] of P) s += Math.sin(TAU * 440 * r * t) * a * Math.exp(-t / k);
        d[i] = s * Math.min(1, t / 0.002); pk = Math.max(pk, Math.abs(d[i]));
      }
      for (let i = 0; i < n; i++) d[i] *= 0.8 / pk;
    });
  }

  // Karplus-Strong plucked strings, one buffer per (kind, note), made on
  // first use and cached. Averaging taps N and N-1 makes the loop N - 0.5
  // samples long; the leftover fraction is fixed with playbackRate.
  const KS = {
    harp: { b: 0.75, t60: 2.6, len: 2.2, pick: 0 },
    lute: { b: 0.4, t60: 1.4, len: 1.4, pick: 0.19 },
    kbass: { b: 0.28, t60: 1.6, len: 1.4, pick: 0.12 },
  };
  function ksSample(E, kind, m) {
    const key = kind + m;
    let s = E.ks.get(key);
    if (s) return s;
    const P = KS[kind], sr = E.sr, f = hz(m);
    const N = Math.max(4, Math.round(sr / f + 0.5)), rate = f / (sr / (N - 0.5));
    const len = Math.floor(sr * P.len);
    const b = E.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const r = rng(m * 31 + kind.length), ring = new Float32Array(N);
    let lp = 0, mean = 0;
    for (let i = 0; i < N; i++) { lp += (r() * 2 - 1 - lp) * P.b; ring[i] = lp; }
    if (P.pick) {
      const k = Math.max(1, Math.round(N * P.pick)), tmp = ring.slice();
      for (let i = 0; i < N; i++) ring[i] = tmp[i] - tmp[(i - k + N) % N];
    }
    for (let i = 0; i < N; i++) mean += ring[i];
    mean /= N;
    for (let i = 0; i < N; i++) ring[i] -= mean;
    const g = Math.pow(0.001, 1 / (f * P.t60));
    let idx = 0, pk = 1e-9;
    for (let i = 0; i < len; i++) {
      const a = ring[idx], nx = idx + 1 === N ? 0 : idx + 1;
      d[i] = a; ring[idx] = g * 0.5 * (a + ring[nx]); idx = nx;
      if (a > pk) pk = a; else if (-a > pk) pk = -a;
    }
    const sc = 0.8 / pk, fo = Math.floor(sr * 0.03);
    for (let i = 0; i < len; i++) d[i] *= sc * (i > len - fo ? (len - i) / fo : 1);
    s = { b, rate };
    E.ks.set(key, s);
    return s;
  }

  // Short synth notes rendered once per pitch in JS (band-limited saw /
  // square -> resonant state-variable lowpass with a decaying cutoff), then
  // replayed as samples. Far cheaper than live filter automation per note.
  //   osc: [wave, cents, level, bypassFilter]   ff: [startMul, endMul, seconds]
  const SAMP = {
    bass: { len: 1.7, a: 0.004, tc: 0.075, s: 0.55, ff: [12, 2.6, 0.1], q: 5, osc: [['saw', 0, 0.5], ['tri', 0, 0.35, 1]] },
    spluck: { len: 0.32, a: 0.002, tc: 0.03, s: 0.12, ff: [8, 1.6, 0.12], q: 2, osc: [['sq', 0, 0.3]] },
    stab: { len: 0.45, a: 0.004, tc: 0.0375, s: 0.35, ff: [9, 2, 0.16], q: 2, osc: [['saw', -9, 0.3], ['saw', 9, 0.3]] },
  };
  const blep = (t, dt) => {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  };
  function synthSample(E, kind, m) {
    const key = '~' + kind + m;
    let b = E.ks.get(key);
    if (b) return b;
    const P = SAMP[kind], sr = E.sr, f = hz(m), n = Math.floor(sr * P.len);
    b = E.ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0), ph = P.osc.map(() => 0), dts = P.osc.map(o => f * Math.pow(2, o[1] / 1200) / sr);
    const k = 1 / P.q, fLo = f * P.ff[1], fHi = f * P.ff[0];
    let ic1 = 0, ic2 = 0, a1 = 0, a2 = 0, a3 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 15) === 0) {
        const fc = Math.min(sr * 0.45, t < P.ff[2] ? fHi * Math.pow(fLo / fHi, t / P.ff[2]) : fLo);
        const g = Math.tan(Math.PI * fc / sr);
        a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
      }
      let x = 0, dry = 0;
      for (let j = 0; j < P.osc.length; j++) {
        const o = P.osc[j], p = ph[j], dt = dts[j];
        let v;
        if (o[0] === 'saw') v = 2 * p - 1 - blep(p, dt);
        else if (o[0] === 'sq') v = (p < 0.5 ? 1 : -1) + blep(p, dt) - blep((p + 0.5) % 1, dt);
        else v = 4 * Math.abs(p - 0.5) - 1;
        if (o[3]) dry += v * o[2]; else x += v * o[2];
        ph[j] = p + dt >= 1 ? p + dt - 1 : p + dt;
      }
      const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      const env = t < P.a ? t / P.a : P.s + (1 - P.s) * Math.exp(-(t - P.a) / P.tc);
      d[i] = (v2 + dry) * env;
    }
    const fo = Math.floor(sr * 0.02);
    for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo;
    E.ks.set(key, b);
    return b;
  }

  // ---------------------------------------------------------------
  // Envelope + voice helpers. Every gain starts and ends at exactly
  // zero via ramps, so nothing clicks.
  // ---------------------------------------------------------------
  function adsr(p, t, dur, a, d, s, r, pk) {
    const rel = t + Math.max(dur, a + 0.002);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(pk, t + a);
    let lv = pk;
    if (s < 1 && d > 0) {
      const sv = pk * s, tc = d / 4;
      p.setTargetAtTime(sv, t + a, tc);
      lv = sv + (pk - sv) * Math.exp(-(rel - t - a) / tc);
    }
    p.setValueAtTime(lv, rel);
    p.linearRampToValueAtTime(0, rel + r);
    return rel + r;
  }
  function perc(p, t, a, pk, d) {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(pk, t + a);
    p.exponentialRampToValueAtTime(pk * 0.001 + 1e-6, t + a + d);
    p.linearRampToValueAtTime(0, t + a + d + 0.01);
    return t + a + d + 0.012;
  }
  // Frequency path: [f0, [f1, dt1], [f2, dt2], ...] with exponential ramps.
  function path(E, p, t, pts) {
    p.setValueAtTime(Math.min(pts[0], E.nyq), t);
    for (let i = 1; i < pts.length; i++) p.exponentialRampToValueAtTime(Math.max(10, Math.min(pts[i][0], E.nyq)), t + pts[i][1]);
  }

  // Sustained oscillator voice for the music: o = {type|w, f, det[], fl:[type,q,...path],
  // pk:[freq,gainDb,q], a,d,s,r, v, vib:[rate, cents, delay]}
  function syn(V, t, dur, o) {
    const E = V.E, c = E.ctx, amp = c.createGain(), oscs = [];
    amp.gain.value = 0;
    const end = adsr(amp.gain, t, dur, o.a, o.d, o.s, o.r, o.v);
    let head = amp;
    if (o.fl) {
      const f = c.createBiquadFilter();
      f.type = o.fl[0]; f.Q.value = o.fl[1];
      path(E, f.frequency, t, o.fl.slice(2));
      f.connect(head); head = f;
    }
    amp.connect(o.ins ? insert(V, o.ins) : V.dest);
    for (const det of o.det || [0]) {
      const os = c.createOscillator();
      if (o.w) os.setPeriodicWave(E.waves[o.w]); else os.type = o.type || 'sawtooth';
      os.frequency.value = o.f; os.detune.value = det;
      os.connect(head); os.start(t); os.stop(end + 0.02);
      oscs.push(os);
    }
    if (o.vib && dur > o.vib[2] + 0.1) {
      const l = c.createOscillator(), lg = c.createGain();
      l.frequency.value = o.vib[0];
      lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + o.vib[2]);
      lg.gain.linearRampToValueAtTime(o.vib[1], t + o.vib[2] + 0.3);
      l.connect(lg);
      for (const os of oscs) lg.connect(os.detune);
      l.start(t); l.stop(end + 0.02); oscs.push(l);
    }
    for (const os of oscs) V.track(os, end + 0.02);
    return end;
  }

  // Static per-instrument filters live once per channel (like a tracker
  // channel effect) instead of once per note.
  const INSERT = {
    choir: [['lowpass', 1500, 0.6], ['peaking', 800, 1.4, 8]],
    strings: [['lowpass', 1700, 0.6]],
    organ: [['lowpass', 5200, 0.7]],
    dbass: [['lowpass', 650, 0.7]],
  };
  function insert(V, name) {
    const ins = V.ins || (V.ins = {});
    if (ins[name]) return ins[name];
    let head = V.dest;
    const chain = INSERT[name] || [];
    for (let i = chain.length - 1; i >= 0; i--) {
      const [type, f, q, g] = chain[i], b = filt(V.E, type, f, q);
      if (g) b.gain.value = g;
      b.connect(head); head = b;
    }
    return (ins[name] = head);
  }

  // Replay a rendered synth sample, gated to the note length.
  function sampled(V, t, m, kind, v, dur, rel) {
    const c = V.E.ctx, b = synthSample(V.E, kind, m), src = c.createBufferSource(), g = c.createGain();
    src.buffer = b;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.002);
    let end = t + b.duration;
    if (dur + rel < b.duration - 0.02) {
      g.gain.setValueAtTime(v, t + Math.max(dur, 0.003));
      end = t + Math.max(dur, 0.003) + rel;
      g.gain.linearRampToValueAtTime(0, end);
    }
    src.connect(g); g.connect(V.dest);
    src.start(t); src.stop(end + 0.01);
    V.track(src, end + 0.01);
  }

  function pluck(V, t, m, kind, v, ring) {
    const E = V.E, c = E.ctx, s = ksSample(E, kind, m), src = c.createBufferSource(), g = c.createGain();
    src.buffer = s.b; src.playbackRate.value = s.rate;
    const nat = s.b.duration / s.rate;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.003);
    let end = t + nat;
    if (ring < nat - 0.12) {
      const rt = t + Math.max(ring, 0.03);
      g.gain.setValueAtTime(v, rt); g.gain.linearRampToValueAtTime(0, rt + 0.1);
      end = rt + 0.1;
    }
    src.connect(g); g.connect(V.dest);
    src.start(t); src.stop(end + 0.01);
    V.track(src, end + 0.01);
  }

  function bellNote(V, t, f, v, ring) {
    const E = V.E, c = E.ctx, src = c.createBufferSource(), g = c.createGain(), rate = f / 440;
    src.buffer = E.bell; src.playbackRate.value = rate;
    const nat = E.bell.duration / rate;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.002);
    let end = t + nat;
    if (ring < nat - 0.3) { g.gain.setValueAtTime(v, t + ring); g.gain.linearRampToValueAtTime(0, t + ring + 0.3); end = t + ring + 0.3; }
    src.connect(g); g.connect(V.dest);
    src.start(t); src.stop(end + 0.01);
    V.track(src, end + 0.01);
  }

  function hitBuf(E, dest, t, name, v, rate) {
    const c = E.ctx, s = c.createBufferSource(), g = gain(c, v);
    s.buffer = E.drum[name];
    if (rate) s.playbackRate.value = rate;
    s.connect(g); g.connect(dest); s.start(t);
  }
  // Drum hit on a music channel: hits of equal level share one gain node.
  function drumHit(V, t, name, v, rate) {
    const c = V.E.ctx, ins = V.ins || (V.ins = {}), key = 'v' + v;
    if (!ins[key]) { ins[key] = gain(c, v); ins[key].connect(V.dest); }
    const s = c.createBufferSource();
    s.buffer = V.E.drum[name];
    if (rate) s.playbackRate.value = rate;
    s.connect(ins[key]); s.start(t);
    V.track(s, t + s.buffer.duration / (rate || 1));
  }

  // ---------------------------------------------------------------
  // Instruments: (V, time, midi, seconds, velocity)
  // ---------------------------------------------------------------
  const INST = {
    harp: (V, t, m, d, v) => pluck(V, t, m, 'harp', v, d + 1.8),
    lute: (V, t, m, d, v) => pluck(V, t, m, 'lute', v, d + 0.35),
    kbass: (V, t, m, d, v) => pluck(V, t, m, 'kbass', v, d + 0.08),
    bell: (V, t, m, d, v) => bellNote(V, t, hz(m), v * 0.8, Math.max(d, 2)),
    flute: (V, t, m, d, v) => {
      const f = hz(m);
      syn(V, t, d, { w: 'flute', f, a: 0.045, d: 0.25, s: 0.8, r: 0.14, v: v * 0.55, vib: [5.2, 14, 0.25] });
      syn(V, t, Math.min(d, 0.06), { type: 'sawtooth', f: f * 1.5, fl: ['bandpass', 2, f * 3], a: 0.01, d: 0.05, s: 0, r: 0.04, v: v * 0.05 });
    },
    saw: (V, t, m, d, v) => {
      const f = hz(m);
      syn(V, t, d, { type: 'sawtooth', det: [-8, 8], f, fl: ['lowpass', 1.3, f * 10, [Math.min(f * 4, 3600), 0.2]], a: 0.006, d: 0.3, s: 0.7, r: 0.1, v: v * 0.32, vib: [5.8, 16, 0.2] });
    },
    organ: (V, t, m, d, v) => syn(V, t, d, { w: 'organ', det: [-4, 4], f: hz(m) / 2, ins: 'organ', a: 0.01, d: 0.15, s: 0.85, r: 0.09, v: v * 0.32, vib: [6.4, 9, 0.05] }),
    brass: (V, t, m, d, v) => {
      const f = hz(m);
      syn(V, t, d, { type: 'sawtooth', det: [-7, 7], f, fl: ['lowpass', 1.6, f * 1.2, [f * 7, 0.07], [f * 3.5, 0.4]], a: 0.025, d: 0.3, s: 0.75, r: 0.12, v: v * 0.38, vib: [5.5, 12, 0.3] });
    },
    stab: (V, t, m, d, v) => sampled(V, t, m, 'stab', v, Math.min(d, 0.16), 0.08),
    spluck: (V, t, m, d, v) => sampled(V, t, m, 'spluck', v, Math.min(d, 0.12), 0.06),
    bass: (V, t, m, d, v) => sampled(V, t, m, 'bass', v, d, 0.05),
    dbass: (V, t, m, d, v) => syn(V, t, d, { type: 'triangle', f: hz(m), ins: 'dbass', a: 0.02, d: 0.6, s: 0.7, r: 0.3, v: v * 0.38 }),
    strings: (V, t, m, d, v) => syn(V, t, d, { type: 'sawtooth', det: [-9, 9], f: hz(m), ins: 'strings', a: 0.4, d: 0.8, s: 0.85, r: 0.7, v: v * 0.22 }),
    choir: (V, t, m, d, v) => syn(V, t, d, { type: 'sawtooth', det: [-11, 11], f: hz(m), ins: 'choir', a: 0.6, d: 1.0, s: 0.9, r: 1.0, v: v * 0.17 }),
  };

  // ---------------------------------------------------------------
  // SONGS. One step is a 16th note. Per channel:
  //   pad   holds each chord, voiced inside one octave from `lo`
  //   arp   one char per step: digit = rung of the chord ladder, c = whole
  //         chord stab, - = stop, . = let ring
  //   bass  one char per step: 1 3 5 7 8 = chord degree (0 = octave below)
  //   drum  k kick, s snare, g ghost, h/H hat, o open hat, c crash+kick,
  //         C crash, t m l toms, x kick+snare, b shaker, K/S = with hat,
  //         T timpani on the chord root
  //   mel   NOTE:steps or r:steps; @inst switches instrument
  // `p` holds named patterns/phrases and `o` lists them in play order.
  // ---------------------------------------------------------------
  const SONGS = {
    // Haunting D minor: harp arpeggios over a slow choir, a lone flute.
    title: {
      bpm: 72, bars: 24,
      chords: 'Dm Bb Gm A  Dm Am Bb F Gm Dm Bb A  Bb C Am Dm Gm Bb Asus4 A  Dm Bb Gm:8 Asus4:8 A',
      ch: [
        { k: 'pad', i: 'choir', lo: 57, v: 0.7 },
        { k: 'arp', i: 'harp', lo: 50, v: 0.6, pan: -0.3, p: { a: '0123432101234321', b: '0124542101245421' }, o: 'aaaa aaaaaaaa bbbbbbbb aaaa' },
        { k: 'bass', i: 'dbass', lo: 38, v: 0.8, p: { a: '1...............', b: '1.......5.......' }, o: 'aaaa aaaaaaaa bbbbbbbb aaaa' },
        { k: 'drum', v: 0.55, p: { q: '................', p: 'T...............', h: 'k..k............', f: 'k..k....l...l.l.' }, o: 'qqqq pqpqpqpq hhhhhhhf pqpq' },
        { k: 'mel', i: 'flute', v: 0.6, pan: 0.15, o: 'zabcde', p: {
          z: 'r:64',
          a: 'A4:4 D5:4 F5:6 E5:2  E5:8 r:2 C5:2 D5:2 E5:2  F5:6 D5:2 Bb4:8  C5:4 A4:4 F4:8',
          b: 'G4:4 Bb4:4 D5:4 G5:4  F5:6 E5:2 D5:8  D5:4 C5:2 Bb4:2 F5:4 D5:4  E5:8 C#5:4 A4:4',
          c: 'F5:4 Bb5:4 A5:4 F5:4  G5:6 E5:2 C5:8  E5:4 A5:4 G5:4 E5:4  F5:8 E5:4 D5:4',
          d: 'G5:6 F5:2 D5:4 Bb4:4  D5:6 F5:2 Bb5:8  A5:6 G5:2 F5:4 E5:4  E5:4 D5:2 C#5:2 A4:8',
          e: '@bell A5:8 D6:8  F5:16  Bb5:8 D5:8  C#5:8 r:8',
        } },
      ],
    },
    // Calm A dorian jig in 6/8: lute picking, tabor, recorder and harp.
    town: {
      bpm: 96, bar: 12, bars: 24,
      chords: 'Am D Am G  Am D G Am  C G D Em  C G Bm D  Am D Am G  Am D G Am',
      ch: [
        { k: 'pad', i: 'strings', lo: 55, v: 0.5 },
        { k: 'arp', i: 'lute', lo: 52, v: 0.65, pan: -0.35, p: { a: '0.1.2.3.2.1.', b: '0.2.3.2.1.2.' }, o: 'ab' },
        { k: 'bass', i: 'kbass', lo: 40, v: 0.9, p: { a: '1.....5.....', b: '1.....3.5...' }, o: 'aaab' },
        { k: 'drum', v: 0.35, p: { a: 'k...b.t...b.', b: 'k...b.t.b.tt' }, o: 'aaab' },
        { k: 'mel', i: 'flute', v: 0.62, pan: 0.2, o: 'xyuvxy', p: {
          x: 'A4:4 B4:2 C5:4 D5:2  E5:4 F#5:2 E5:4 D5:2  C5:4 B4:2 A4:4 B4:2  G4:6 B4:4 D5:2',
          y: 'A4:4 B4:2 C5:4 E5:2  A5:4 F#5:2 E5:4 D5:2  B4:4 D5:2 G5:4 F#5:2  E5:4 C5:2 A4:6',
          u: '@harp G5:4 E5:2 C5:4 E5:2  D5:4 B4:2 G4:4 B4:2  A4:4 D5:2 F#5:4 A5:2  G5:4 F#5:2 E5:6',
          v: '@harp E5:4 F#5:2 G5:4 A5:2  B5:4 A5:2 G5:4 D5:2  F#5:4 E5:2 D5:4 B4:2  A4:4 B4:2 C5:4 D5:2',
        } },
      ],
    },
    // Driving E minor: octave bass, chip arps, saw lead.
    battle: {
      bpm: 140, bars: 32,
      chords: 'Em Em C D  Em Em C D Em Em Am B  C D Bm Em C D B B  Em Em C D Em Em Am B  Em C Am B',
      ch: [
        { k: 'pad', i: 'strings', lo: 52, v: 0.45 },
        { k: 'arp', i: 'spluck', lo: 64, v: 0.5, pan: -0.4, p: { a: '0120120120120123', b: '3210321032103210' }, o: 'aaaa abababab aaaaaaab abababab aaaa' },
        { k: 'bass', i: 'bass', lo: 40, v: 0.45, p: { a: '1.1.8.1.1.1.8.5.', b: '1.1.8.1.1.1.5.8.' }, o: 'aaab' },
        { k: 'drum', v: 0.45, p: { q: 'k...k...k...k.hh', a: 'k.h.s.hkk.h.s.h.', b: 'k.h.s.hkk.hks.sg', c: 'c.h.s.hkk.h.s.h.', f: 'k.h.s.h.t.t.m.l.' }, o: 'qqqf caabaaaf caabaabf caabaaaf cbbf' },
        { k: 'mel', i: 'saw', v: 1, pan: 0.2, o: 'zabar', p: {
          z: 'E4:2 E4:1 E4:1 G4:2 E4:2 A4:2 G4:2 F#4:2 D4:2  E4:2 E4:1 E4:1 G4:2 E4:2 A4:2 G4:2 F#4:2 D4:2  ' +
            'E4:2 E4:1 E4:1 G4:2 E4:2 C5:2 B4:2 G4:2 E4:2  F#4:2 F#4:1 F#4:1 A4:2 F#4:2 D5:2 C5:2 A4:2 F#4:2',
          a: 'E5:6 F#5:2 G5:4 B5:4  B5:6 A5:2 G5:4 F#5:4  G5:6 E5:2 C5:4 E5:4  D5:4 F#5:4 A5:8  ' +
            'G5:6 F#5:2 E5:4 B4:4  E5:4 G5:4 B5:4 E6:4  C6:6 B5:2 A5:4 E5:4  D#5:8 F#5:4 B5:4',
          b: 'E5:2 G5:2 C6:4 B5:4 G5:4  A5:6 F#5:2 D5:8  F#5:2 B5:2 D6:4 B5:4 A5:4  B5:6 G5:2 E5:8  ' +
            'G5:4 A5:4 B5:4 C6:4  D6:6 C6:2 B5:4 A5:4  B5:4 A5:4 F#5:4 D#5:4  F#5:8 D#5:4 B4:4',
          r: 'E5:2 E5:1 E5:1 G5:2 E5:2 A5:2 G5:2 F#5:2 D5:2  E5:2 E5:1 E5:1 G5:2 E5:2 C6:2 B5:2 G5:2 E5:2  ' +
            'A5:2 A5:1 A5:1 C6:2 A5:2 E6:2 C6:2 B5:2 A5:2  B5:4 F#5:4 D#5:4 B4:4',
        } },
      ],
    },
    // C minor dread: pipe organ, choir, galloping bass, double kick.
    boss: {
      bpm: 150, bars: 32,
      chords: 'Cm G Ab G  Cm G Ab Ab Fm G Cm G  Db Db Cm G Ab Fm G G  Fm Db Cm Cm Db Ab G G  Cm G Ab G',
      ch: [
        { k: 'pad', i: 'choir', lo: 55, v: 0.7 },
        { k: 'arp', i: 'stab', lo: 60, v: 0.75, pan: -0.35, p: { r: '................', a: 'c..c..c...c..c..', b: 'c..c..c.c.c.c.c.' }, o: 'rrrb aaaaaaab aaaaaaab aaaaaaab aaab' },
        { k: 'bass', i: 'bass', lo: 36, v: 0.47, p: { i: '1...............', a: '1.111.111.111.11', b: '1.111.111.1.8.5.' }, o: 'iiib aaaaaaab aaaaaaab aaaaaaab aaab' },
        { k: 'drum', v: 0.32, p: { i: 'T...k...T...k.k.', a: 'KhKkShKhKhKkShKk', f: 'KhKkShKht.t.m.l.', c: 'chKkShKhKhKkShKk' }, o: 'iiif caaaaaaf caaaaaaf caaaaaaf caaf' },
        { k: 'mel', i: 'organ', v: 0.9, pan: 0.2, o: 'zabco', p: {
          z: 'C4:4 C4:2 C4:2 Eb4:4 C4:4  D4:4 D4:2 Eb4:2 D4:4 B3:4  C4:4 C4:2 C4:2 Eb4:4 Ab4:4  G4:16',
          a: 'C5:6 D5:2 Eb5:4 G5:4  F5:2 Eb5:2 D5:4 C5:4 B4:4  C5:6 Eb5:2 Ab5:8  Ab5:4 G5:4 Eb5:4 C5:4  ' +
            'F5:6 G5:2 Ab5:4 C6:4  B5:6 Ab5:2 G5:4 F5:4  Eb5:4 D5:4 C5:4 G4:4  B4:8 D5:4 G5:4',
          b: 'F5:4 Ab5:4 Db6:8  C6:2 Db6:2 Ab5:4 F5:4 Db5:4  Eb5:6 G5:2 C6:8  D6:4 C6:4 B5:4 G5:4  ' +
            'Ab5:6 G5:2 F5:4 Eb5:4  F5:4 Ab5:4 C6:4 F6:4  G5:12 Ab5:2 G5:2  F5:4 Eb5:4 D5:4 B4:4',
          c: 'C5:4 F5:4 Ab5:4 C6:4  Db6:6 C6:2 Ab5:8  G5:4 Eb5:4 C5:4 Eb5:4  G5:8 Ab5:4 G5:4  ' +
            'F5:4 Ab5:4 Db6:4 F6:4  Eb6:6 Db6:2 C6:8  B5:4 D6:4 F6:4 D6:4  B5:8 G5:8',
          o: 'C5:4 C5:2 C5:2 Eb5:4 C5:4  D5:4 D5:2 Eb5:2 D5:4 B4:4  C5:4 C5:2 C5:2 Eb5:4 Ab5:4  G5:8 B4:8',
        } },
      ],
    },
    // D major brass fanfare, then a gentle dawn loop (from bar 5).
    victory: {
      bpm: 100, bars: 20, loop: 4,
      chords: 'D G A D  D A Bm F#m G D Em A  D A Bm G Em A D D',
      ch: [
        { k: 'pad', i: 'strings', lo: 57, v: 0.55 },
        { k: 'arp', i: 'harp', lo: 50, v: 0.75, pan: -0.3, p: { r: '................', g: '0123456789......', a: '0.1.2.3.4.3.2.1.' }, o: 'rrrg aaaaaaaaaaaaaaaa' },
        { k: 'bass', i: 'dbass', lo: 38, v: 0.75, p: { f: '1...............', a: '1.......5.......' }, o: 'ffff aaaaaaaaaaaaaaaa' },
        { k: 'drum', v: 0.6, p: { x: 'c...............', y: 'T.....T.T.......', z: 'T...T...TTTTTTTT', w: 'c...........T...', q: '................', s: 'k.......b.......' }, o: 'xyzw qqqqqqqq ssssssss' },
        { k: 'mel', i: 'flute', v: 0.65, pan: 0.15, o: 'fgh', p: {
          f: '@brass A4:2 A4:1 A4:1 D5:4 F#5:4 A5:4  B5:8 A5:2 G5:2 F#5:2 G5:2  A5:4 E5:2 F#5:2 G5:4 C#6:4  D6:12 r:4',
          g: 'F#5:8 E5:4 D5:4  C#5:8 E5:4 A4:4  D5:6 C#5:2 B4:8  A4:6 B4:2 C#5:8  B4:4 D5:4 G5:8  F#5:6 E5:2 D5:8  E5:4 F#5:4 G5:4 B5:4  A5:12 r:4',
          h: 'F#5:6 G5:2 A5:8  G5:4 F#5:4 E5:8  F#5:4 D5:4 B4:8  B5:6 A5:2 G5:8  G5:4 F#5:4 E5:4 D5:4  C#5:6 D5:2 E5:8  D5:16  r:16',
        } },
        { k: 'mel', i: 'brass', v: 0.45, pan: -0.2, o: 'fz', p: {
          f: 'F#4:2 F#4:1 F#4:1 A4:4 D5:4 F#5:4  G5:8 F#5:2 E5:2 D5:2 E5:2  E5:4 C#5:2 D5:2 E5:4 A5:4  F#5:12 r:4',
          z: 'r:256',
        } },
      ],
    },
    // Short sting, no loop.
    defeat: {
      bpm: 80, bars: 2, loop: -1,
      chords: 'Bb:8 A:8 Dm',
      ch: [
        { k: 'pad', i: 'choir', lo: 50, v: 0.9 },
        { k: 'bass', i: 'dbass', lo: 38, v: 0.8, p: '1.......1.......1...............' },
        { k: 'drum', v: 0.7, p: 'T.......T.......T...............' },
        { k: 'mel', i: 'brass', v: 0.6, p: 'A4:4 G4:4 F4:4 E4:4  D4:16' },
        { k: 'mel', i: 'bell', v: 0.5, p: 'r:16 D3:16' },
      ],
    },
  };

  // ---------------------------------------------------------------
  // Song compiler: text patterns -> per-step event lists.
  // ---------------------------------------------------------------
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const QUAL = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6], 5: [0, 7], aug: [0, 4, 8] };
  const noteMidi = s => {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
    return m ? 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : null;
  };
  const inWindow = (pc, lo) => lo + (((pc - lo) % 12) + 12) % 12;
  const KIT = {
    k: [['kick', 1]], K: [['kick', 1], ['hat', 0.45]], s: [['snare', 0.85]], S: [['snare', 0.85], ['hat', 0.45]],
    g: [['snare', 0.22]], h: [['hat', 0.5]], H: [['hat', 0.8]], o: [['ohat', 0.55]], c: [['crash', 0.6], ['kick', 1]],
    C: [['crash', 0.6]], t: [['tom', 0.8, 1.45]], m: [['tom', 0.8, 1.15]], l: [['tom', 0.85, 0.85]],
    x: [['kick', 1], ['snare', 0.85]], b: [['shaker', 0.45]],
  };
  const errors = [];

  function compile(name, def) {
    const bar = def.bar || 16, total = def.bars * bar, err = m => errors.push(name + ': ' + m);
    const steps = Array.from({ length: total }, () => []);
    const chordAt = new Array(total);
    let pos = 0;
    for (const tok of def.chords.split(/\s+/).filter(Boolean)) {
      const [nm, ln] = tok.split(':'), m = /^([A-G])([#b]?)(.*)$/.exec(nm), L = ln ? +ln : bar;
      if (!m || !QUAL[m[3]]) { err('bad chord ' + tok); continue; }
      const ch = { pc: (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12, iv: QUAL[m[3]], at: pos, len: L };
      for (let k = 0; k < L && pos + k < total; k++) chordAt[pos + k] = ch;
      pos += L;
    }
    if (pos !== total) err('chords cover ' + pos + ' of ' + total + ' steps');
    const stream = (c, sep) => {   // patterns in play order; grids repeat the order to fill the song
      const P = typeof c.p === 'string' ? { a: c.p } : c.p, ord = (c.o || 'a').replace(/\s/g, '');
      const parts = [];
      let len = 0;
      for (let k = 0; k < ord.length || (!sep && len < total && k < 4096); k++) {
        const pat = P[ord[k % ord.length]];
        if (pat == null) { err('missing pattern ' + ord[k % ord.length]); break; }
        const x = sep ? pat : pat.replace(/[\s|]/g, '');
        if (!x.length) break;
        parts.push(x); len += x.length;
      }
      return sep ? parts : parts.join('');
    };
    const ladder = (ch, lo) => {
      const r = inWindow(ch.pc, lo), n = ch.iv.length, out = [];
      for (let i = 0; i < 12; i++) out.push(r + ch.iv[i % n] + 12 * Math.floor(i / n));
      return out;
    };
    def.ch.forEach((c, ci) => {
      const add = (at, ev) => { if (at < total) { ev.c = ci; steps[at].push(ev); } };
      if (c.k === 'pad') {
        for (let s = 0; s < total; s++) {
          const ch = chordAt[s];
          if (ch && ch.at === s) add(s, { i: c.i, ms: ch.iv.map(x => inWindow(ch.pc + x, c.lo)).sort((a, b) => a - b), l: ch.len });
        }
      } else if (c.k === 'mel') {
        let at = 0;
        for (const ph of stream(c, true)) {
          let inst = c.i;
          for (const tok of ph.split(/\s+/).filter(t => t && t !== '|')) {
            if (tok[0] === '@') { inst = tok.slice(1); if (!INST[inst]) err('unknown instrument ' + inst); continue; }
            const [n, ln] = tok.split(':'), L = +ln;
            if (!(L > 0)) { err('bad length ' + tok); continue; }
            if (n !== 'r') {
              const m = noteMidi(n);
              if (m === null) err('bad note ' + tok); else add(at, { i: inst, m, l: L });
            }
            at += L;
          }
        }
        if (at !== total) err('melody ' + ci + ' covers ' + at + ' of ' + total + ' steps');
      } else {
        const s = stream(c, false);
        if (s.length !== total) err(c.k + ' ' + ci + ' covers ' + s.length + ' of ' + total + ' steps');
        for (let i = 0; i < Math.min(s.length, total); i++) {
          const ch = s[i], cd = chordAt[i];
          if (ch === '.' || ch === '-' || !cd) continue;
          let len = 1;
          while (i + len < s.length && s[i + len] === '.') len++;
          if (c.k === 'drum') {
            if (ch === 'T') add(i, { d: [['timp', 0.9, hz(inWindow(cd.pc, 40)) / 98]] });
            else if (KIT[ch]) add(i, { d: KIT[ch] });
            else err('unknown drum ' + ch);
          } else if (c.k === 'bass') {
            const iv = cd.iv, off = { 0: -12, 1: 0, 2: 2, 3: iv[1], 4: 5, 5: iv[2] == null ? 7 : iv[2], 6: 9, 7: iv[3] == null ? 10 : iv[3], 8: 12 }[ch];
            if (off == null) err('bad bass ' + ch); else add(i, { i: c.i, m: inWindow(cd.pc, c.lo) + off, l: len });
          } else if (ch === 'c') {
            add(i, { i: c.i, ms: cd.iv.map(x => inWindow(cd.pc + x, c.lo)), l: len });
          } else if (ch >= '0' && ch <= '9') {
            add(i, { i: c.i, m: ladder(cd, c.lo)[+ch], l: len });
          } else err('bad arp ' + ch);
        }
      }
    });
    return {
      name, bar, total, bars: def.bars, steps, ch: def.ch,
      sd: 60 / def.bpm / 4, loop: def.loop == null ? 0 : def.loop,
    };
  }
  const SONG = {};
  for (const k in SONGS) { try { SONG[k] = compile(k, SONGS[k]); } catch (e) { errors.push(k + ': ' + e.message); } }

  // ---------------------------------------------------------------
  // Player: look-ahead scheduler. tick(until) schedules every step that
  // starts before `until`. The live context calls it every 25 ms with
  // until = now + 100 ms; the offline renderer calls it once.
  // ---------------------------------------------------------------
  function makePlayer(E, name, t0, startStep) {
    const S = SONG[name];
    if (!S) return null;
    const c = E.ctx, out = gain(c, 1);
    out.connect(E.musicBus);
    const P = { name, S, E, out, t0, n: 0, step: startStep || 0, done: false, nodes: [], late: 0, endT: 0 };
    P.track = (node, end) => { P.nodes.push({ node, end }); };
    P.V = S.ch.map(ch => {
      const g = gain(c, ch.v == null ? 1 : ch.v), pn = panner(c, ch.pan);
      g.connect(pn); pn.connect(out);
      return { E, dest: g, track: P.track };
    });
    return P;
  }

  function playStep(P, idx, t) {
    const S = P.S;
    for (const ev of S.steps[idx]) {
      const V = P.V[ev.c];
      if (P.solo != null && P.solo !== ev.c) continue;
      if (ev.d) { for (const [nm, v, rate] of ev.d) drumHit(V, t, nm, v, rate); continue; }
      const fn = INST[ev.i], dur = ev.l * S.sd;
      if (!fn) continue;
      if (ev.ms) { const v = 1 / Math.sqrt(ev.ms.length); for (const m of ev.ms) fn(V, t, m, dur, v); }
      else fn(V, t, ev.m, dur, 1);
    }
  }

  function tick(P, until) {
    const S = P.S;
    while (!P.done) {
      const t = P.t0 + P.n * S.sd;
      if (t >= until) break;
      playStep(P, P.step, t);
      P.n++; P.step++;
      if (P.step >= S.total) {
        if (S.loop < 0) { P.done = true; P.endT = t + S.sd + 3; } else P.step = S.loop * S.bar;
      }
    }
  }

  function stopPlayer(P, fade) {
    const c = P.E.ctx, now = c.currentTime, g = P.out.gain;
    P.done = true;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + fade);
    } catch (_) { /* ignore */ }
    const kill = () => {
      for (const x of P.nodes) { try { x.node.stop(); } catch (_) { /* already stopped */ } }
      P.nodes = [];
      try { P.out.disconnect(); } catch (_) { /* ignore */ }
    };
    setTimeout(kill, (fade + 0.15) * 1000);
  }

  // ---------------------------------------------------------------
  // SFX building blocks (fire-and-forget into `o`)
  // ---------------------------------------------------------------
  // Tone: {type|w, f, f1, ft, fp (freq path), a, d, v, det, flt, ff, q, lfo:[rate, depthHz, type]}
  function T(E, o, t, x) {
    const c = E.ctx, os = c.createOscillator(), g = c.createGain();
    if (x.w) os.setPeriodicWave(E.waves[x.w]); else os.type = x.type || 'sine';
    if (x.fp) path(E, os.frequency, t, x.fp);
    else {
      os.frequency.setValueAtTime(x.f, t);
      if (x.f1) os.frequency.exponentialRampToValueAtTime(x.f1, t + (x.ft || (x.a || 0.002) + x.d));
    }
    if (x.det) os.detune.value = x.det;
    g.gain.value = 0;
    const end = perc(g.gain, t, x.a || 0.002, x.v, x.d);
    if (x.flt) { const f = filt(E, x.flt, x.ff, x.q); os.connect(f); f.connect(g); } else os.connect(g);
    g.connect(o);
    os.start(t); os.stop(end + 0.02);
    if (x.lfo) {
      const l = c.createOscillator(), lg = gain(c, x.lfo[1]);
      l.type = x.lfo[2] || 'sine'; l.frequency.value = x.lfo[0];
      l.connect(lg); lg.connect(os.frequency); l.start(t); l.stop(end + 0.02);
    }
    return end;
  }
  // Filtered noise: {ft, f, f1, fT, q, a, d, v}
  function N(E, o, t, x) {
    const c = E.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = E.noise; s.loop = true;
    f.type = x.ft || 'bandpass'; f.Q.value = x.q || 1;
    f.frequency.setValueAtTime(Math.min(x.f, E.nyq), t);
    if (x.f1) f.frequency.exponentialRampToValueAtTime(Math.min(x.f1, E.nyq), t + (x.fT || (x.a || 0.002) + x.d));
    g.gain.value = 0;
    const end = perc(g.gain, t, x.a || 0.002, x.v, x.d);
    s.connect(f); f.connect(g); g.connect(o);
    s.start(t, Math.random() * 1.5); s.stop(end + 0.02);
    return end;
  }
  // Long held layer with linear fade in/out (rumbles, grinding): src 'noise' or osc type
  function held(E, o, t, dur, x) {
    const c = E.ctx, g = c.createGain(), f = filt(E, x.ft || 'lowpass', x.f, x.q);
    let s;
    if (x.src === 'noise') { s = c.createBufferSource(); s.buffer = E.noise; s.loop = true; }
    else { s = c.createOscillator(); s.type = x.src; s.frequency.value = x.fo; }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(x.v, t + x.a);
    g.gain.setValueAtTime(x.v, t + dur - x.r);
    g.gain.linearRampToValueAtTime(0, t + dur);
    let head = g;
    if (x.am) {   // amplitude wobble (ratchet / growl)
      const am = gain(c, 1 - x.am[1]), l = c.createOscillator(), lg = gain(c, x.am[1]);
      l.type = x.am[2] || 'sawtooth'; l.frequency.value = x.am[0];
      l.connect(lg); lg.connect(am.gain); am.connect(g); head = am;
      l.start(t); l.stop(t + dur + 0.02);
    }
    if (x.lfo && s.frequency) {
      const l = c.createOscillator(), lg = gain(c, x.lfo[1]);
      l.frequency.value = x.lfo[0]; l.connect(lg); lg.connect(s.frequency);
      l.start(t); l.stop(t + dur + 0.02);
    }
    s.connect(f); f.connect(head); g.connect(o);
    if (x.src === 'noise') s.start(t, Math.random()); else s.start(t);
    s.stop(t + dur + 0.02);
  }
  // Metallic ring: inharmonic sine partials
  function R(E, o, t, f, ratios, v, d) {
    ratios.forEach((r, i) => T(E, o, t, { f: f * r, v: v / (1 + i * 0.5), d: d / (1 + i * 0.3), a: 0.001 }));
  }
  function swish(E, o, t, p, D, v) {
    N(E, o, t, { ft: 'bandpass', f: 320 * p, f1: 2600 * p, fT: D * 0.7, q: 1.6, a: D * 0.55, d: D * 0.45, v });
    N(E, o, t, { ft: 'bandpass', f: 170 * p, f1: 900 * p, fT: D * 0.7, q: 1, a: D * 0.55, d: D * 0.45, v: v * 0.6 });
  }
  function footstep(E, o, t, p, v) {
    N(E, o, t, { ft: 'lowpass', f: 420 * p, v: 0.55 * v, d: 0.05 });
    N(E, o, t + 0.004, { ft: 'bandpass', f: 2300 * p, q: 1.2, v: 0.16 * v, d: 0.03 });
  }
  const sv = (E, o) => ({ E, dest: o, track: () => {} });
  // Output trim per effect, so combat hits sit clearly above the music.
  const LVL = { hit: 1.6, crit: 1.5, hurt: 1.6, block: 1.5, parry: 1.6, whoosh: 1.2, miss: 1.4, step: 3, screech: 2.2,
    flee: 1.4, deny: 1.3, equip: 1.4, magic: 1.6, ice: 1.5, zap: 1.5, fire: 1.5, stun: 1.3, gate: 1.1 };
  const semi = p => 12 * Math.log2(p);

  const SFX = {
    tap(E, o, t, p) {
      T(E, o, t, { type: 'triangle', f: 1250 * p, f1: 900 * p, ft: 0.04, v: 0.3, d: 0.05 });
      N(E, o, t, { ft: 'highpass', f: 4000, v: 0.08, d: 0.015 });
    },
    back(E, o, t, p) {
      T(E, o, t, { type: 'triangle', f: 720 * p, f1: 430 * p, ft: 0.08, v: 0.3, d: 0.09 });
      N(E, o, t, { ft: 'bandpass', f: 1800, v: 0.06, d: 0.02 });
    },
    coin(E, o, t, p) {
      R(E, o, t, 1980 * p, [1, 1.5, 2.66], 0.22, 0.22);
      R(E, o, t + 0.07, 2640 * p, [1, 1.5, 2.66], 0.25, 0.45);
    },
    buy(E, o, t, p) {
      N(E, o, t, { ft: 'lowpass', f: 900, v: 0.35, d: 0.06 });
      T(E, o, t, { f: 180 * p, f1: 90 * p, v: 0.3, d: 0.08 });
      for (let i = 0; i < 4; i++) R(E, o, t + 0.06 + i * 0.055, (2100 + i * 260) * p * (0.97 + Math.random() * 0.06), [1, 1.5, 2.7], 0.13, 0.3);
      N(E, o, t + 0.05, { ft: 'bandpass', f: 7000, q: 2, v: 0.1, a: 0.01, d: 0.25 });
    },
    deny(E, o, t, p) {
      for (let i = 0; i < 2; i++) {
        T(E, o, t + i * 0.11, { type: 'square', f: 155 * p, v: 0.13, a: 0.004, d: 0.08, flt: 'lowpass', ff: 1400 });
        T(E, o, t + i * 0.11, { type: 'square', f: 146 * p, v: 0.13, a: 0.004, d: 0.08, flt: 'lowpass', ff: 1400 });
      }
    },
    equip(E, o, t, p) {
      N(E, o, t, { ft: 'bandpass', f: 2200 * p, f1: 6500 * p, q: 3, v: 0.3, a: 0.02, d: 0.12 });
      R(E, o, t + 0.04, 1560 * p, [1, 1.47, 2.09, 2.9], 0.12, 0.35);
      N(E, o, t, { ft: 'lowpass', f: 600, v: 0.3, d: 0.05 });
    },
    hit(E, o, t, p) {
      T(E, o, t, { f: 170 * p, f1: 55 * p, ft: 0.09, v: 0.75, d: 0.12 });
      N(E, o, t, { ft: 'lowpass', f: 2600 * p, v: 0.6, d: 0.09 });
      N(E, o, t, { ft: 'bandpass', f: 1200 * p, q: 1.5, v: 0.5, d: 0.035 });
      N(E, o, t, { ft: 'highpass', f: 5000, v: 0.15, d: 0.02 });
    },
    crit(E, o, t, p) {
      const c = E.ctx, sh = c.createWaveShaper(), g = gain(c, 0.55);
      sh.curve = E.crunch; sh.connect(g); g.connect(o);
      T(E, sh, t, { f: 130 * p, f1: 34 * p, ft: 0.22, v: 0.9, d: 0.28 });
      N(E, sh, t, { ft: 'lowpass', f: 3500 * p, f1: 400, fT: 0.25, v: 0.9, d: 0.26 });
      N(E, o, t, { ft: 'bandpass', f: 1500 * p, q: 1.2, v: 0.55, d: 0.05 });
      N(E, o, t, { ft: 'highpass', f: 4500, v: 0.3, d: 0.03 });
      R(E, o, t, 620 * p, [1, 1.83, 2.71], 0.14, 0.25);
      T(E, o, t, { f: 62 * p, f1: 30 * p, v: 0.6, d: 0.35 });
    },
    miss(E, o, t, p) {
      swish(E, o, t, p * 1.25, 0.2, 0.35);
    },
    hurt(E, o, t, p) {
      T(E, o, t, { f: 140 * p, f1: 45 * p, ft: 0.15, v: 0.85, d: 0.18 });
      N(E, o, t, { ft: 'lowpass', f: 1800, v: 0.6, d: 0.12 });
      T(E, o, t + 0.01, { type: 'sawtooth', f: 210 * p, f1: 130 * p, ft: 0.16, v: 0.3, a: 0.01, d: 0.17, flt: 'bandpass', ff: 650 * p, q: 3 });
    },
    block(E, o, t, p) {
      const lp = filt(E, 'lowpass', 2600); lp.connect(o);
      R(E, lp, t, 380 * p, [1, 2.32, 3.89, 5.1], 0.32, 0.22);
      T(E, o, t, { f: 150 * p, f1: 80 * p, v: 0.5, d: 0.09 });
      N(E, o, t, { ft: 'bandpass', f: 1100 * p, q: 1, v: 0.5, d: 0.06 });
      N(E, o, t, { ft: 'lowpass', f: 500, v: 0.45, d: 0.1 });
    },
    parry(E, o, t, p) {
      swish(E, o, t, p * 1.4, 0.22, 0.3);
      N(E, o, t, { ft: 'highpass', f: 3500, v: 0.45, d: 0.025 });
      const f = 2150 * p;
      for (const [r, v, d] of [[1, 0.26, 1.1], [1.004, 0.18, 1.0], [2.08, 0.14, 0.8], [2.093, 0.09, 0.7], [3.42, 0.07, 0.5], [4.95, 0.045, 0.35]]) {
        T(E, o, t, { f: f * r, v, d, a: 0.0015 });
      }
      T(E, o, t, { f: 520 * p, f1: 380 * p, v: 0.25, d: 0.08 });
    },
    whoosh(E, o, t, p) {
      swish(E, o, t, p, 0.3 / Math.sqrt(p), 0.5);
    },
    fire(E, o, t, p) {
      N(E, o, t, { ft: 'lowpass', f: 250 * p, f1: 3000 * p, fT: 0.25, q: 1.5, a: 0.06, d: 0.6, v: 0.75 });
      N(E, o, t, { ft: 'bandpass', f: 900 * p, q: 0.8, a: 0.03, d: 0.4, v: 0.3 });
      T(E, o, t, { f: 90 * p, f1: 45 * p, v: 0.5, a: 0.02, d: 0.35 });
      for (let i = 0; i < 7; i++) N(E, o, t + 0.08 + Math.random() * 0.5, { ft: 'highpass', f: 2500 + Math.random() * 3000, v: 0.15 + Math.random() * 0.2, d: 0.012 });
    },
    ice(E, o, t, p) {
      N(E, o, t, { ft: 'bandpass', f: 3000, q: 2, v: 0.4, d: 0.03 });
      N(E, o, t, { ft: 'highpass', f: 5000, a: 0.02, d: 0.45, v: 0.25 });
      [2637, 3136, 3520, 4186, 3951, 4699].forEach((f, i) => T(E, o, t + i * 0.045 + Math.random() * 0.02, { f: f * p, v: 0.1, d: 0.25 }));
      T(E, o, t, { type: 'triangle', f: 1400 * p, f1: 700 * p, v: 0.12, d: 0.3 });
    },
    zap(E, o, t, p) {
      T(E, o, t, { type: 'sawtooth', f: 1600 * p, f1: 110 * p, ft: 0.36, v: 0.28, a: 0.003, d: 0.36, flt: 'highpass', ff: 300, lfo: [47, 600 * p, 'square'] });
      N(E, o, t, { ft: 'bandpass', f: 600, q: 0.7, v: 0.45, d: 0.08 });
      N(E, o, t, { ft: 'highpass', f: 3000, v: 0.4, d: 0.3 });
      for (let i = 0; i < 4; i++) N(E, o, t + 0.05 + Math.random() * 0.25, { ft: 'highpass', f: 4000, v: 0.3, d: 0.015 });
    },
    heal(E, o, t, p) {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => T(E, o, t + i * 0.07, { type: 'triangle', f: f * p, v: 0.16, a: 0.01, d: 0.5 }));
      T(E, o, t, { f: 392 * p, f1: 784 * p, ft: 0.5, v: 0.12, a: 0.15, d: 0.5 });
      N(E, o, t, { ft: 'highpass', f: 7000, a: 0.2, d: 0.4, v: 0.06 });
    },
    magic(E, o, t, p) {
      T(E, o, t, { type: 'triangle', f: 330 * p, f1: 1320 * p, ft: 0.4, v: 0.2, a: 0.05, d: 0.45, lfo: [9, 25 * p] });
      T(E, o, t, { type: 'triangle', f: 335 * p, f1: 990 * p, ft: 0.4, v: 0.15, a: 0.05, d: 0.45, lfo: [7, 20 * p] });
      for (let i = 0; i < 5; i++) T(E, o, t + 0.1 + i * 0.06, { f: (1500 + Math.random() * 1500) * p, v: 0.06, d: 0.15 });
      N(E, o, t, { ft: 'bandpass', f: 2000 * p, f1: 6000 * p, q: 4, a: 0.1, d: 0.35, v: 0.1 });
    },
    drink(E, o, t, p) {
      for (let i = 0; i < 3; i++) T(E, o, t + i * 0.12 + Math.random() * 0.02, { f: (220 + i * 40) * p, f1: (520 + i * 80) * p, ft: 0.06, v: 0.3, a: 0.005, d: 0.07 });
      N(E, o, t, { ft: 'bandpass', f: 900, q: 2, a: 0.02, d: 0.35, v: 0.08 });
      T(E, o, t + 0.42, { type: 'triangle', f: 900 * p, f1: 1400 * p, ft: 0.08, v: 0.12, d: 0.12 });
    },
    stun(E, o, t, p) {
      T(E, o, t, { f: 220 * p, f1: 70 * p, v: 0.6, d: 0.15 });
      N(E, o, t, { ft: 'bandpass', f: 1500, q: 2, v: 0.3, d: 0.04 });
      for (let i = 0; i < 3; i++) T(E, o, t + 0.12 + i * 0.13, { f: (1800 + i * 150) * p, f1: 2400 * p, ft: 0.06, v: 0.1, a: 0.01, d: 0.12, lfo: [14, 200] });
    },
    levelup(E, o, t, p) {
      const V = sv(E, o), dm = semi(p);
      [72, 76, 79, 84, 88, 91].forEach((m, i) => {
        INST.spluck(V, t + i * 0.065, m + dm, 0.1, 1.6);
        bellNote(V, t + i * 0.065, hz(m + dm + 12), 0.07, 0.8);
      });
      [84, 88, 91, 96].forEach(m => bellNote(V, t + 0.4, hz(m + dm), 0.09, 1.4));
      [60, 64, 67, 72].forEach(m => INST.brass(V, t + 0.4, m + dm, 0.5, 0.7));
      N(E, o, t + 0.38, { ft: 'highpass', f: 6000, a: 0.05, d: 0.6, v: 0.08 });
    },
    victory(E, o, t, p) {
      const V = sv(E, o), dm = semi(p), s = 0.1;
      for (const [m, at, len] of [[67, 0, 1], [72, 1, 1], [76, 2, 1], [79, 3, 2], [76, 5, 1], [79, 6, 8]]) INST.brass(V, t + at * s, m + dm, len * s * 0.85, 1);
      [60, 64, 67, 72].forEach(m => INST.brass(V, t + 6 * s, m + dm, 0.75, 0.6));
      hitBuf(E, o, t + 6 * s, 'timp', 0.8, hz(48 + dm) / 98);
      hitBuf(E, o, t + 6 * s, 'crash', 0.35);
      bellNote(V, t + 6 * s, hz(91 + dm), 0.1, 1.2);
    },
    defeat(E, o, t, p) {
      const V = sv(E, o), dm = semi(p);
      [[52, 0, 0.28], [51, 0.32, 0.28], [50, 0.64, 1.1]].forEach(([m, at, len]) => INST.brass(V, t + at, m + dm, len, 1));
      [50, 53, 57].forEach(m => INST.choir(V, t + 0.6, m + dm, 1.0, 1.4));
      hitBuf(E, o, t + 0.64, 'timp', 0.9, hz(38 + dm) / 98);
      bellNote(V, t + 0.64, hz(38 + dm), 0.25, 2.4);
    },
    flee(E, o, t, p) {
      for (let i = 0; i < 4; i++) footstep(E, o, t + i * 0.09, p * (1 + i * 0.05), 1 - i * 0.18);
      swish(E, o, t + 0.12, p * 0.8, 0.35, 0.35);
    },
    gate(E, o, t, p) {
      const D = 3.6;
      T(E, o, t, { f: 90 * p, f1: 40 * p, v: 0.7, d: 0.35 });
      R(E, o, t, 310 * p, [1, 1.58, 2.37, 3.1], 0.25, 0.7);
      N(E, o, t, { ft: 'bandpass', f: 900, q: 1, v: 0.4, d: 0.08 });
      held(E, o, t + 0.15, D, { src: 'noise', ft: 'lowpass', f: 110 * p, q: 0.8, a: 0.6, r: 0.5, v: 1.1 });
      held(E, o, t + 0.2, D - 0.2, { src: 'noise', ft: 'bandpass', f: 380 * p, q: 2.5, a: 0.4, r: 0.5, v: 0.6, am: [11, 0.6] });
      held(E, o, t + 0.25, D - 0.3, { src: 'sawtooth', fo: 44 * p, ft: 'lowpass', f: 320, q: 1, a: 0.5, r: 0.6, v: 0.3, lfo: [0.8, 4] });
      for (let k = t + 0.35; k < t + D; k += 0.1 + Math.random() * 0.06) {
        const f = (1100 + Math.random() * 900) * p;
        N(E, o, k, { ft: 'bandpass', f: f * 1.8, q: 5, v: 0.2 + Math.random() * 0.15, d: 0.04 });
        R(E, o, k, f, [1, 1.41, 2.3], 0.05 + Math.random() * 0.04, 0.09);
      }
      const s = t + D + 0.05;
      T(E, o, s, { f: 70 * p, f1: 28 * p, v: 0.9, d: 0.9 });
      N(E, o, s, { ft: 'lowpass', f: 1800, f1: 200, fT: 0.6, v: 0.7, d: 0.7 });
      R(E, o, s, 180 * p, [1, 1.63, 2.51, 3.3], 0.22, 1.4);
      hitBuf(E, o, s, 'crash', 0.22, 0.6);
    },
    door(E, o, t, p) {
      T(E, o, t, { type: 'sawtooth', f: 85 * p, f1: 125 * p, ft: 0.3, v: 0.14, a: 0.04, d: 0.28, flt: 'bandpass', ff: 1100 * p, q: 4, lfo: [23, 25] });
      N(E, o, t, { ft: 'bandpass', f: 3000, q: 3, v: 0.12, d: 0.02 });
      N(E, o, t + 0.32, { ft: 'lowpass', f: 700, v: 0.45, d: 0.08 });
      T(E, o, t + 0.32, { f: 110 * p, f1: 60 * p, v: 0.4, d: 0.1 });
    },
    roar(E, o, t, p) {
      const c = E.ctx, s = 1 / Math.sqrt(p), D = 1.15 * s;
      const amp = c.createGain(), lp = filt(E, 'lowpass', 400, 3), am = gain(c, 0.68);
      path(E, lp.frequency, t, [380 * p, [1500 * p, 0.25 * s], [520 * p, D]]);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.5, t + 0.12 * s);
      amp.gain.linearRampToValueAtTime(0.38, t + 0.6 * D);
      amp.gain.exponentialRampToValueAtTime(0.0005, t + D);
      amp.gain.linearRampToValueAtTime(0, t + D + 0.02);
      const lfo = c.createOscillator(), lg = gain(c, 0.32);
      lfo.type = 'triangle'; lfo.frequency.value = 27 + Math.random() * 8;
      lfo.connect(lg); lg.connect(am.gain);
      am.connect(lp); lp.connect(amp); amp.connect(o);
      for (const [r, det] of [[1, 0], [1.01, 8], [1.5, -5], [0.5, 0]]) {
        const os = c.createOscillator();
        os.type = 'sawtooth'; os.detune.value = det;
        path(E, os.frequency, t, [70 * r * p, [105 * r * p, 0.3 * s], [58 * r * p, D]]);
        os.connect(am); os.start(t); os.stop(t + D + 0.05);
      }
      lfo.start(t); lfo.stop(t + D + 0.05);
      N(E, o, t, { ft: 'bandpass', f: 700 * p, q: 0.8, a: 0.1 * s, d: D, v: 0.3 });
      T(E, o, t, { f: 50 * p, v: 0.4, a: 0.1, d: D * 0.9 });
    },
    screech(E, o, t, p) {
      const D = 0.4 / Math.sqrt(p);
      T(E, o, t, { type: 'sawtooth', fp: [850 * p, [1750 * p, D * 0.3], [700 * p, D]], v: 0.22, a: 0.015, d: D, flt: 'bandpass', ff: 2200, q: 1.2, lfo: [36, 90 * p] });
      T(E, o, t + 0.01, { type: 'square', fp: [1300 * p, [2300 * p, D * 0.25], [900 * p, D]], v: 0.07, a: 0.015, d: D * 0.9, flt: 'lowpass', ff: 4000, lfo: [41, 120 * p] });
      N(E, o, t, { ft: 'bandpass', f: 3200 * p, q: 2, a: 0.02, d: D, v: 0.14 });
    },
    step(E, o, t, p) {
      footstep(E, o, t, p, 1);
    },
  };

  // ---------------------------------------------------------------
  // Live context, scheduler pump and the public API
  // ---------------------------------------------------------------
  let ctx = null, E = null, cur = null, wanted = null, timer = null, broken = !AC;
  const lastSfx = {}, liveSfx = [];

  function pump() {
    try {
      if (!ctx || ctx.state !== 'running' || !cur) return;
      const now = ctx.currentTime, P = cur;
      if (P.t0 + P.n * P.S.sd < now) { P.late++; P.t0 = now + 0.02 - P.n * P.S.sd; }  // stalled: skip ahead
      tick(P, now + AHEAD);
      if (P.nodes.length > 64) P.nodes = P.nodes.filter(x => x.end > now);
      if (P.done && now > P.endT) {
        try { P.out.disconnect(); } catch (_) { /* ignore */ }
        cur = null;
        if (wanted === P.name) wanted = null;
      }
    } catch (_) { /* never let the timer die */ }
  }

  function startMusic() {
    if (!E || !wanted || !AU.musicOn || cur) return;
    cur = makePlayer(E, wanted, ctx.currentTime + 0.12);
  }

  AU.unlock = () => {
    try {
      if (broken) return;
      if (!ctx) {
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { ctx = new AC(); }
        E = makeEngine(ctx);
        // iOS: play one silent sample inside the gesture to wake the output
        const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
        timer = setInterval(pump, TICK_MS);
      }
      if (ctx.state !== 'running' && ctx.resume) {
        const pr = ctx.resume();
        if (pr && pr.catch) pr.catch(() => {});
      }
      startMusic();
    } catch (_) {
      broken = true; ctx = E = cur = null;
      if (timer) clearInterval(timer);
    }
  };

  AU.music = name => {
    try {
      name = name || null;
      if (name && !SONG[name]) return;
      wanted = name;
      if (!E) return;
      if (cur && cur.name === name && !cur.done) return;
      if (cur) { stopPlayer(cur, FADE); cur = null; }
      startMusic();
    } catch (_) { /* ignore */ }
  };

  AU.sfx = (name, opts) => {
    try {
      if (!E || !AU.sfxOn || ctx.state !== 'running') return;
      const fn = SFX[name];
      if (!fn) return;
      const now = ctx.currentTime;
      if (lastSfx[name] && now - lastSfx[name] < 0.03) return;   // same sound twice in one frame
      while (liveSfx.length && liveSfx[0] < now) liveSfx.shift();
      if (liveSfx.length >= 14 && (name === 'tap' || name === 'step' || name === 'whoosh')) return;
      lastSfx[name] = now;
      const o = opts || {}, p = (o.pitch > 0 ? o.pitch : 1) * jitter();
      const out = gain(ctx, (o.vol >= 0 ? Math.min(o.vol, 2) : 1) * (LVL[name] || 1));
      out.connect(E.sfxBus);
      fn(E, out, now + 0.005, p);
      liveSfx.push(now + 1); liveSfx.sort((a, b) => a - b);
    } catch (_) { /* ignore */ }
  };

  AU.setMusic = on => {
    try {
      AU.musicOn = !!on; saveSettings();
      if (!AU.musicOn) { if (cur) { stopPlayer(cur, FADE); cur = null; } } else startMusic();
    } catch (_) { /* ignore */ }
  };
  AU.setSfx = on => { AU.sfxOn = !!on; saveSettings(); };

  // Suspend while hidden (timers are throttled in the background, and iOS
  // suspends us anyway); resume when the page comes back.
  try {
    document.addEventListener('visibilitychange', () => {
      try {
        if (!ctx) return;
        if (document.hidden) { if (ctx.state === 'running' && ctx.suspend) ctx.suspend().catch(() => {}); }
        else AU.unlock();
      } catch (_) { /* ignore */ }
    });
    window.addEventListener('pageshow', () => { if (ctx) AU.unlock(); });
  } catch (_) { /* ignore */ }

  // ---------------------------------------------------------------
  // Test hooks (used by the offline harness, harmless in the game)
  // ---------------------------------------------------------------
  AU._render = (kind, name, secs, opts) => {
    const o = opts || {}, sr = o.sr || 44100;
    const c = new OAC(2, Math.ceil(sr * secs), sr), e = makeEngine(c);
    if (kind === 'sfx') {
      const out = gain(c, (o.vol == null ? 1 : o.vol) * (LVL[name] || 1));
      out.connect(e.sfxBus);
      SFX[name](e, out, 0.02, o.pitch || 1);
    } else if (kind === 'note') {   // name = 'inst:midi'
      const [i, m] = name.split(':');
      INST[i]({ E: e, dest: e.musicBus, track: () => {} }, 0.02, +m, o.dur || 1, 1);
    } else {
      const P = makePlayer(e, name, 0.02, o.startStep || 0);
      if (o.solo != null) P.solo = o.solo;
      const t0 = performance.now();
      tick(P, secs);
      AU._schedMs = performance.now() - t0;
    }
    return c.startRendering();
  };
  AU._info = () => ({
    errors: errors.slice(), sfx: Object.keys(SFX), inst: Object.keys(INST),
    songs: Object.fromEntries(Object.entries(SONG).map(([k, s]) => [k, { bars: s.bars, bar: s.bar, total: s.total, sd: s.sd, loop: s.loop, channels: s.ch.length, loopSecs: s.total * s.sd }])),
  });
  AU._song = n => SONG[n];
  AU._debug = () => ({
    state: ctx ? ctx.state : 'none', time: ctx ? ctx.currentTime : 0, wanted,
    playing: cur ? cur.name : null, step: cur ? cur.step : -1, steps: cur ? cur.n : 0,
    nextT: cur ? cur.t0 + cur.n * cur.S.sd : 0, late: cur ? cur.late : 0, nodes: cur ? cur.nodes.length : 0,
    ks: E ? E.ks.size : 0,
  });
  AU._tap = () => {   // live output meter for tests
    if (!E) return null;
    if (!E.an) { E.an = ctx.createAnalyser(); E.an.fftSize = 2048; E.out.connect(E.an); }
    const d = new Float32Array(E.an.fftSize);
    E.an.getFloatTimeDomainData(d);
    let s = 0, pk = 0;
    for (const x of d) { s += x * x; pk = Math.max(pk, Math.abs(x)); }
    return { rms: Math.sqrt(s / d.length), peak: pk };
  };
})();
