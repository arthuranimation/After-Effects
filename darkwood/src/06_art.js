// ================================================================
// ART REGISTRY — art modules register drawings here; the game asks
// for cached frames. Anything missing falls back to a placeholder
// so the game always runs.
//
//   DW.art.enemies[name] = { w, h, anchor:[x,y], center:[x,y], mouth?:[x,y],
//                            draw(S, pose), portrait(S) }      // portrait is 24×24
//   DW.art.hero          = { w, h, anchor:[x,y], draw(S, pose, gear) }
//   DW.art.icons[name]   = { w, h, draw(S) }
//   DW.art.scenes[name]  = { paint(S, w, h, state), animate(ctx, x, y, w, h, t, state, live),
//                            hotspots?(w, h, state) }
// ================================================================
(() => {
  const G = DW.gfx, K = DW.kit, F = DW.font;
  const A = DW.art = DW.art || {};
  A.enemies = A.enemies || {};
  A.icons = A.icons || {};
  A.scenes = A.scenes || {};
  A.hero = A.hero || null;

  // ---------------------------------------------------------------
  // Enemy frames. Pose is quantised so each enemy has ~14 cached frames:
  //   idle f 0..3 | windup dir -1/0/1 × wind 0.5/1 | strike dir | hurt
  // ---------------------------------------------------------------
  A.normPose = (pose = {}) => {
    if (pose.hurt) return { f: 0, dir: 0, wind: 0, strike: 0, hurt: 1 };
    const dir = pose.dir < 0 ? -1 : pose.dir > 0 ? 1 : 0;
    if (pose.strike) return { f: 0, dir, wind: 0, strike: 1, hurt: 0 };
    if (pose.wind > 0) return { f: 0, dir, wind: pose.wind >= 0.75 ? 1 : 0.5, strike: 0, hurt: 0 };
    return { f: ((pose.f | 0) % 4 + 4) % 4, dir: 0, wind: 0, strike: 0, hurt: 0 };
  };

  A.enemyDef = name => A.enemies[name] || null;

  A.enemyFrame = (name, pose) => {
    const def = A.enemies[name];
    const q = A.normPose(pose);
    const key = `enemy|${name}|${q.f}|${q.dir}|${q.wind}|${q.strike}|${q.hurt}`;
    if (!def) return placeholderEnemy(name);
    return K.cached(key, def.w, def.h, S => {
      try { def.draw(S, q); } catch (e) { console.error('enemy art', name, e); }
    });
  };

  A.enemyPortrait = name => {
    const def = A.enemies[name];
    if (!def || !def.portrait) {
      // fall back: crop the top-centre of the idle frame
      const img = A.enemyFrame(name, {});
      return G.cache('portrait|' + name, 24, 24, ctx => {
        const sx = Math.max(0, Math.floor(img.width / 2 - 12));
        ctx.drawImage(img, sx, 0, 24, 24, 0, 0, 24, 24);
      });
    }
    return K.cached('portrait|' + name, 24, 24, S => {
      try { def.portrait(S); } catch (e) { console.error('portrait art', name, e); }
    });
  };

  function placeholderEnemy(name) {
    return K.cached('enemy|placeholder|' + name, 64, 64, S => {
      S.ball(32, 36, 22, 24, 'stone');
      S.glow(24, 30, '#f65', 1); S.glow(40, 30, '#f65', 1);
      S.outline();
    });
  }

  // ---------------------------------------------------------------
  // Hero frames (seen from behind, over the shoulder).
  //   pose: { act: 'idle'|'attack'|'block'|'hurt'|'cast'|'victory', f: 0..3, dir: -1|0|1, t: 0|1|2 }
  //   gear: { weapon: look, armor: look }
  // ---------------------------------------------------------------
  A.heroFrame = (pose = {}, gear = {}) => {
    const def = A.hero;
    const act = pose.act || 'idle';
    const q = {
      act,
      f: act === 'idle' ? ((pose.f | 0) % 4 + 4) % 4 : 0,
      dir: act === 'block' ? (pose.dir < 0 ? -1 : pose.dir > 0 ? 1 : 0) : 0,
      t: act === 'attack' ? Math.max(0, Math.min(2, pose.t | 0)) : 0,
    };
    const g = { weapon: gear.weapon || 'dagger', armor: gear.armor || 'none' };
    if (!def) {
      return K.cached('hero|placeholder|' + q.act + q.dir, 80, 72, S => {
        S.ball(40, 30, 10, 11, 'skin');
        S.ball(40, 62, 22, 18, 'wood');
        S.ball(18 + q.dir * 8, 52 - (q.act === 'block' ? 10 : 0), 10, 12, 'steel');
        S.outline();
      });
    }
    const key = `hero|${q.act}|${q.f}|${q.dir}|${q.t}|${g.weapon}|${g.armor}`;
    return K.cached(key, def.w, def.h, S => {
      try { def.draw(S, q, g); } catch (e) { console.error('hero art', e); }
    });
  };

  // ---------------------------------------------------------------
  // Icons
  // ---------------------------------------------------------------
  A.icon = name => {
    const def = A.icons[name];
    if (!def) {
      return K.cached('icon|missing|' + name, 12, 12, S => {
        S.ball(6, 6, 5, 5, 'stone'); S.outline();
      });
    }
    return K.cached('icon|' + name, def.w || 12, def.h || 12, S => {
      try { def.draw(S); } catch (e) { console.error('icon art', name, e); }
    });
  };
  A.hasIcon = name => !!A.icons[name];

  // ---------------------------------------------------------------
  // Scenes: a static layer cached per size/state + animated overlay.
  // ---------------------------------------------------------------
  const stateKey = st => (st ? JSON.stringify(st) : '');
  A.sceneCanvas = (name, w, h, state) => {
    const def = A.scenes[name];
    const key = `scene|${name}|${w}x${h}|${stateKey(state)}`;
    if (!def) {
      return G.cache(key, w, h, ctx => {
        G.copper(0, 0, w, h, ['#001', '#113', '#224', '#112'], ctx);
        F.draw(name, w >> 1, h >> 1, '#556', { align: 'center', ctx });
      });
    }
    return K.cached(key, w, h, S => {
      try { def.paint(S, w, h, state || {}); } catch (e) { console.error('scene art', name, e); }
    });
  };

  // `state` affects the cached static layer (keep it small: e.g. {gateOpen:true});
  // `live` carries per-frame values for animate only (e.g. {cheer:0.7}).
  A.drawScene = (name, x, y, w, h, t, state, live) => {
    G.blit(A.sceneCanvas(name, w, h, state), x, y);
    const def = A.scenes[name];
    if (def && def.animate) {
      G.clip(x, y, w, h, () => {
        try { def.animate(G.ctx, x, y, w, h, t, state || {}, live || {}); } catch (e) { console.error('scene anim', name, e); }
      });
    }
  };

  A.hotspots = (name, w, h, state) => {
    const def = A.scenes[name];
    return def && def.hotspots ? def.hotspots(w, h, state || {}) : [];
  };
})();
