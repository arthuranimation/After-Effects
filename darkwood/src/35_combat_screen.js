// ================================================================
// COMBAT SCREEN — the arena stage, over-the-shoulder hero, the
// wind-up / block / parry loop and all the juice.
//
// Flow:  intro → next ─┬→ player (choose an action) → play events → next
//                      ├→ windup (block pad; read the tell) → strike → next
//                      └→ over → result dialog
// ================================================================
(() => {
  const G = DW.gfx, F = DW.font, UI = DW.ui, A = DW.art, FX = DW.fx, U = DW.util, P = DW.pal;
  const Gm = DW.game, S = DW.state, D = DW.data, App = DW.app, C = DW.combat;

  const EVENT_TIME = {
    log: 0, pAttack: 0.2, eDamage: 0.24, pDamage: 0.4, heal: 0.3, mp: 0.15, cast: 0.45, enemyRise: 0.9,
    enemyDie: 1.1, playerDie: 1.2, stun: 0.5, regen: 0.3, drain: 0.35, status: 0.35, counter: 0.12,
    flee: 0.5, drink: 0.2, parry: 0, block: 0, vanish: 0.7,
  };

  let st;   // per-fight screen state
  const L = {};   // layout

  function layout() {
    L.w = G.w; L.h = G.h;
    L.plateH = 34;
    L.actH = 70; L.logH = 34; L.barH = 24;
    L.bottomH = L.barH + L.logH + L.actH;
    L.stageY = L.plateH;
    L.stageH = L.h - L.plateH - L.bottomH;
    L.stageB = L.stageY + L.stageH;
    L.barY = L.stageB;
    L.logY = L.barY + L.barH;
    L.actY = L.logY + L.logH;
    L.enemyFeetY = L.stageB - 62;
    L.heroY = L.stageB + 12;
  }

  // ---------------------------------------------------------------
  // Positions of things on the stage
  // ---------------------------------------------------------------
  const enemyDef = () => A.enemyDef(st.enemy.name) || { w: 64, h: 64, anchor: [32, 63], center: [32, 32] };
  const enemyOrigin = () => {
    const d = enemyDef();
    let x = (L.w >> 1) - d.anchor[0], y = L.enemyFeetY - d.anchor[1];
    if (st.pose.wind) x += st.pose.dir * Math.round(3 * st.pose.wind);
    if (st.strikeT > 0) y += 6;
    if (st.hurtT > 0) y -= 2;
    if (st.dying) y += Math.round(st.dieT * 8);
    if (st.introT < 0.5) y -= Math.round((0.5 - st.introT) * 30);
    return [x, y];
  };
  const enemyCenter = () => {
    const d = enemyDef(), [x, y] = enemyOrigin();
    const c = d.center || [d.w >> 1, d.h >> 1];
    return [x + c[0], y + c[1]];
  };
  const enemySide = dir => {
    const d = enemyDef(), [x, y] = enemyOrigin();
    return [x + (d.w >> 1) + dir * Math.round(d.w * 0.42), y + Math.round(d.h * (dir === 0 ? 0.05 : 0.3))];
  };
  const heroCenter = () => [L.w >> 1, L.stageB - 34];
  const shieldPos = dir => [(L.w >> 1) + (dir === 1 ? 14 : dir === 0 ? -6 : -26), L.stageB - (dir === 0 ? 58 : 40)];

  // ---------------------------------------------------------------
  // Enter
  // ---------------------------------------------------------------
  App.register('combat', {
    enter(params) {
      layout();
      FX.clear();
      const c = C.start(params.enemy, params.streak || 0);
      st = {
        c, enemy: c.enemy, phase: 'intro', introT: 0, t: 0,
        queue: [], wait: 0, log: [],
        pose: { f: 0, dir: 0, wind: 0, strike: 0, hurt: 0 },
        hero: { act: 'idle', t: 0, dir: 0 }, heroT: 0,
        strikeT: 0, hurtT: 0, flashT: 0, dieT: 0, dying: false, heroDying: 0,
        windup: null, guard: null, guardAt: 0, wt: 0, glinted: false, feinted: false,
        menu: null, cheer: 0.3, hpGhost: c.ehp, pGhost: S.p.hp, result: null, vanishing: 0,
        banner: { text: c.streak ? 'REMATCH!' : 'VS', sub: c.enemy.name.toUpperCase(), t: 0 },
      };
      pullEvents();
      App.music(c.enemy.tier >= 4 ? 'boss' : 'battle');
      App.sfx(c.enemy.tier >= 3 ? 'roar' : 'screech');
    },
    exit() { FX.clear(); },
    draw(dt, t) {
      if (G.w !== L.w || G.h !== L.h) layout();
      update(dt);
      render(t);
    },
  });

  // ---------------------------------------------------------------
  // Events → animation queue
  // ---------------------------------------------------------------
  function pullEvents() {
    const c = st.c;
    while (c.events.length) st.queue.push(c.events.shift());
  }

  function addLog(text, col) {
    st.log.push({ text, col: P.c[col] || col || P.c.text });
    if (st.log.length > 30) st.log.shift();
  }

  function playEvent(e) {
    const [ex, ey] = enemyCenter();
    const [hx, hy] = heroCenter();
    switch (e.t) {
      case 'fn': e.fn(); return 0;
      case 'log': addLog(e.text, e.col); break;
      case 'pAttack':
        st.hero = { act: 'attack', t: 0, dir: 0 }; st.heroT = e.quick ? 0.16 : 0.26;
        App.sfx('whoosh', { pitch: 1.3, vol: 0.5 });
        break;
      case 'counter':
        st.hero = { act: 'attack', t: 0, dir: 0 }; st.heroT = 0.18;
        FX.glint(shieldPos(st.guard === null ? 0 : st.guard)[0], shieldPos(0)[1], 8);
        break;
      case 'eDamage': {
        const big = e.crit || e.dmg >= st.c.emax * 0.2;
        if (e.src === 'melee' || e.src === 'counter') FX.slash(ex, ey, Math.random() < 0.5 ? 1 : -1, e.crit ? '#fd5' : '#fff', e.crit ? 30 : 24);
        if (e.src === 'burn') FX.embers(ex, ey, 10);
        else if (e.src === 'frost' || e.src === 'ice') FX.frost(ex, ey, 10);
        else if (e.src === 'lightning') FX.sparks(ex, ey, 18);
        else if (e.src === 'fire') { FX.embers(ex, ey, 24); FX.burst(ex, ey, { n: 18, cols: ['#fd5', '#fa2', '#e70'], speed: 90, grav: 60 }); }
        else FX.sparks(ex, ey, e.crit ? 20 : 10);
        FX.number(ex + U.rand(-8, 8), ey - 10, (e.crit ? e.dmg + '!' : e.dmg), e.crit ? '#fd5' : '#fff', { big: e.crit });
        st.hurtT = 0.22; st.flashT = 0.08;
        FX.stop(e.crit ? 0.09 : 0.045);
        if (e.crit) { FX.shake(4, 0.25); FX.flash('#fff', 0.1); }
        else FX.shake(1.5, 0.12);
        App.sfx(e.src === 'fire' || e.src === 'burn' ? 'fire' : e.src === 'ice' || e.src === 'frost' ? 'ice' : e.src === 'lightning' ? 'zap' : e.crit ? 'crit' : 'hit');
        st.cheer = Math.min(1, st.cheer + (big ? 0.6 : 0.25));
        break;
      }
      case 'pDamage': {
        const dir = e.dir;
        if (e.parried) {
          st.hero = { act: 'block', t: 0, dir }; st.heroT = 0.4;
          const [sx, sy] = shieldPos(dir);
          FX.glint(sx, sy, 12, '#fff', 0.4); FX.ring(sx, sy, '#fd5', 34, 0.4); FX.sparks(sx, sy, 22);
          FX.number(sx, sy - 14, 'PARRY!', '#fd5', { big: true, life: 1.1 });
          FX.slow(0.35); FX.flash('#fd5', 0.12);
          App.sfx('parry'); UI.buzz(15);
          st.cheer = 1;
        } else if (e.blocked) {
          st.hero = { act: 'block', t: 0, dir }; st.heroT = 0.35;
          const [sx, sy] = shieldPos(dir);
          FX.sparks(sx, sy, 12); FX.shake(2, 0.15);
          FX.number(hx, hy - 30, e.dmg, '#bcd');
          App.sfx('block'); UI.buzz(20);
        } else {
          st.hero = { act: 'hurt', t: 0, dir: 0 }; st.heroT = 0.4;
          if (e.breath) { FX.embers(hx, hy - 20, 30); FX.flash('#fa2', 0.2); }
          FX.blood(hx, hy - 20, 10);
          FX.number(hx + U.rand(-10, 10), hy - 34, e.dmg, '#f65', { big: e.dmg >= S.p.maxHp * 0.2 });
          FX.shake(e.dmg >= S.p.maxHp * 0.2 ? 6 : 4, 0.3); FX.flash('#d33', 0.15); FX.stop(0.06);
          App.sfx('hurt'); UI.buzz(45);
          st.cheer = Math.min(1, st.cheer + 0.4);
        }
        break;
      }
      case 'heal': FX.heal(hx, hy - 10, 20); FX.number(hx, hy - 36, '+' + e.amount, '#9d7'); App.sfx('heal'); FX.pillar(hx, L.stageB, '#9c7', 70); break;
      case 'mp': FX.magic(hx, hy - 10, 14, ['#bef', '#8de', '#5ac']); FX.number(hx, hy - 36, '+' + e.amount + ' MP', '#8de'); App.sfx('magic'); break;
      case 'drink': App.sfx('drink'); break;
      case 'regen': FX.heal(ex, ey, 10); FX.number(ex, ey - 16, '+' + e.amount, '#9d7'); break;
      case 'drain': FX.magic(hx, hy - 10, 16, ['#dbf', '#b8e', '#74a']); FX.number(hx, hy - 30, '-' + e.amount + ' XP', '#c9f'); App.sfx('magic', { pitch: 0.6 }); break;
      case 'stun':
        if (e.who === 'enemy') { FX.number(ex, ey - 24, 'STUNNED', '#fd5'); FX.ring(ex, ey, '#fd5', 20); }
        else { FX.number(hx, hy - 34, 'PETRIFIED', '#bbc'); }
        App.sfx('stun');
        break;
      case 'status':
        if (e.type === 'exhaust') FX.number(hx, hy - 34, 'EXHAUSTED', '#f65');
        if (e.type === 'petrify') { FX.number(hx, hy - 34, 'STONE!', '#bbc'); FX.flash('#889', 0.2); }
        break;
      case 'cast': return castFx(e.id);
      case 'enemyRise':
        FX.flash('#d33', 0.25); FX.shake(5, 0.4); FX.number(L.w >> 1, L.stageY + 30, 'RISES AGAIN!', '#f65', { big: true, life: 1.4 });
        App.sfx('roar'); st.hpGhost = st.c.ehp;
        break;
      case 'enemyDie':
        st.dying = true; st.dieT = 0; st.flashT = 0.6;
        FX.shake(5, 0.4); FX.stop(0.12); FX.flash('#fff', 0.15);
        FX.dust(L.w >> 1, L.enemyFeetY, 24); FX.sparks(ex, ey, 24);
        App.sfx(st.enemy.tier >= 3 ? 'roar' : 'screech', { pitch: 0.7 });
        st.cheer = 1;
        break;
      case 'playerDie':
        st.heroDying = 0.001; FX.flash('#d33', 0.5); FX.shake(6, 0.5);
        App.sfx('defeat');
        break;
      case 'flee':
        if (e.ok) { st.vanishing = 0.001; App.sfx('flee'); }
        else { FX.number(hx, hy - 34, 'CUT OFF!', '#f65'); App.sfx('deny'); }
        break;
      case 'vanish':
        st.vanishing = 0.001; FX.magic(hx, hy - 10, 30, ['#334', '#445', '#74a', '#000']); App.sfx('magic', { pitch: 0.5 });
        break;
    }
    return EVENT_TIME[e.t] || 0;
  }

  // Returns how long the cast takes before the next event plays.
  function castFx(id) {
    const [ex, ey] = enemyCenter();
    const [hx, hy] = heroCenter();
    if (id === 'double_slash') { App.sfx('whoosh'); return 0.08; }
    st.hero = { act: 'cast', t: 0, dir: 0 }; st.heroT = 0.45;
    FX.magic(hx, hy - 30, 10);
    switch (id) {
      case 'fireball': case 'wand_fire': FX.bolt(hx, hy - 40, ex, ey, 'fire', () => { FX.flash('#fa2', 0.12); FX.shake(3, 0.2); }); App.sfx('fire'); break;
      case 'wand_lightning': FX.bolt(hx, hy - 40, ex, ey, 'lightning'); FX.flash('#eff', 0.1); App.sfx('zap'); break;
      case 'icy_rain': FX.icefall(ex, ey, 46); App.sfx('ice'); break;
      case 'shatter': FX.ring(ex, ey, '#fd5', 34); FX.sparks(ex, ey, 16); App.sfx('crit'); break;
      case 'ultra_strength': FX.flash('#d33', 0.15); FX.burst(hx, hy - 20, { n: 26, cols: ['#f65', '#d33', '#fa2'], speed: 70, grav: -40 }); App.sfx('roar', { pitch: 1.6 }); break;
      case 'speed_warrior': FX.burst(hx, hy - 20, { n: 22, cols: ['#eff', '#8de'], speed: 120, grav: 0, angle: Math.PI, spread: 0.6 }); App.sfx('whoosh'); break;
      case 'rallying_cry': FX.pillar(hx, L.stageB, '#fd5', 90); App.sfx('levelup', { vol: 0.6 }); break;
      case 'riposte': FX.glint(shieldPos(0)[0], shieldPos(0)[1], 10); App.sfx('parry', { vol: 0.5 }); break;
      case 'vanish': break;
    }
    return EVENT_TIME.cast;
  }

  // ---------------------------------------------------------------
  // Update (state machine)
  // ---------------------------------------------------------------
  function update(dt) {
    const c = st.c;
    st.t += dt;
    st.cheer = Math.max(0.15, st.cheer - dt * 0.5);
    if (st.strikeT > 0) st.strikeT -= dt;
    if (st.hurtT > 0) st.hurtT -= dt;
    if (st.flashT > 0) st.flashT -= dt;
    if (st.dying) st.dieT = Math.min(1, st.dieT + dt * 1.1);
    if (st.heroDying) st.heroDying = Math.min(1, st.heroDying + dt);
    if (st.vanishing) st.vanishing = Math.min(1, st.vanishing + dt * 1.6);
    if (st.heroT > 0) {
      st.heroT -= dt;
      if (st.hero.act === 'attack') st.hero.t = st.heroT > 0.14 ? 0 : st.heroT > 0.06 ? 1 : 2;
      if (st.hero.act === 'attack' && st.hero.t === 1 && !st.hero.swung) { st.hero.swung = true; }
      if (st.heroT <= 0 && st.phase !== 'windup') st.hero = { act: 'idle', t: 0, dir: 0 };
    }
    st.hpGhost = U.lerp(st.hpGhost, c.ehp, Math.min(1, dt * 3));
    st.pGhost = U.lerp(st.pGhost, S.p.hp, Math.min(1, dt * 3));
    if (st.banner) { st.banner.t += dt; if (st.banner.t > 1.4) st.banner = null; }

    // play queued events
    if (st.wait > 0) { st.wait -= dt; return; }
    while (st.queue.length && st.wait <= 0) st.wait = playEvent(st.queue.shift());
    if (st.wait > 0 || st.queue.length) return;

    switch (st.phase) {
      case 'intro':
        st.introT += dt;
        if (st.introT > 1.0) { st.phase = 'next'; }
        break;
      case 'next': {
        if (c.over) { st.phase = 'ending'; st.endT = 0; break; }
        const r = C.next();
        pullEvents();
        if (r.type === 'player') { st.phase = 'player'; st.menu = null; }
        else if (r.type === 'enemy') beginWindup(r.attack);
        else if (r.type === 'over') { st.phase = 'ending'; st.endT = 0; }
        else st.wait = 0.25;   // skipped turn: breathe, then continue
        break;
      }
      case 'player': break;   // waiting for a tap
      case 'windup': updateWindup(dt); break;
      case 'after':
        st.afterT -= dt;
        if (st.afterT <= 0) st.phase = 'next';
        break;
      case 'ending':
        st.endT += dt;
        if (st.endT > 0.5 && !st.result) showResult();
        break;
    }
  }

  function beginWindup(a) {
    st.phase = 'windup';
    st.windup = a; st.wt = 0;
    st.guard = null; st.guardAt = 0; st.glinted = false; st.feinted = false;
    st.pose = { f: 0, dir: a.dir, wind: 0.01, strike: 0, hurt: 0 };
    st.hero = { act: 'idle', t: 0, dir: 0 };
    App.sfx('whoosh', { pitch: 0.7, vol: 0.4 });
  }

  function setGuard(dir) {
    if (st.phase !== 'windup' || !st.windup) return;
    st.guard = dir; st.guardAt = st.wt;
    st.hero = { act: 'block', t: 0, dir }; st.heroT = 9;
    App.sfx('step', { pitch: 1.2, vol: 0.4 });
  }

  function updateWindup(dt) {
    const a = st.windup;
    st.wt += dt * 1000;
    const dir = a.feintAt && st.wt >= a.feintAt ? a.feintDir : a.dir;
    if (a.feintAt && !st.feinted && st.wt >= a.feintAt) { st.feinted = true; App.sfx('whoosh', { pitch: 0.9, vol: 0.5 }); }
    st.pose.dir = dir;
    st.pose.wind = Math.min(1, st.wt / (a.windup * 0.6));
    const remain = a.windup - st.wt;
    if (!st.glinted && remain <= a.parry && !a.breath) {
      st.glinted = true;
      const [gx, gy] = enemySide(dir);
      FX.glint(gx, gy, 7, '#fff', 0.28);
    }
    if (a.breath && Math.random() < 0.5) {
      const d = enemyDef(), [ox, oy] = enemyOrigin();
      const m = d.mouth || [d.w >> 1, Math.round(d.h * 0.3)];
      FX.embers(ox + m[0], oy + m[1], 1);
    }
    if (st.wt >= a.windup) {
      const ms = st.guard === null ? 9999 : a.windup - st.guardAt;
      st.pose = { f: 0, dir, wind: 0, strike: 1, hurt: 0 };
      st.strikeT = 0.28;
      App.sfx(a.breath ? 'fire' : 'whoosh', { pitch: a.breath ? 0.8 : 1.6 });
      const r = C.resolveAttack(st.guard, ms);
      pullEvents();
      if (r.combo && !st.c.over) {
        st.wait = 0.3;
        setTimeout0(() => beginWindup(r.combo));
      } else {
        st.phase = 'after'; st.afterT = 0.35;
        st.windup = null;
      }
    }
  }
  // run after the current queue drains (keeps ordering with events)
  function setTimeout0(fn) { st.queue.push({ t: 'fn', fn }); }

  // ---------------------------------------------------------------
  // Player input
  // ---------------------------------------------------------------
  function doAct(kind, arg) {
    if (st.phase !== 'player') return;
    if (!C.act(kind, arg)) { App.sfx('deny'); return; }
    st.menu = null;
    pullEvents();
    st.phase = 'after'; st.afterT = 0.3;
  }

  // ---------------------------------------------------------------
  // Result
  // ---------------------------------------------------------------
  function showResult() {
    const sum = C.finish();
    st.result = sum;
    const e = st.enemy;
    if (sum.result === 'win') {
      App.sfx('victory');
      App.music(null);
      const lines = [`{blue}+${U.fmt(sum.xp)} XP{/}    {gold}+${U.fmt(sum.gold)} gold`];
      if (sum.streak) lines.push(`{orange}Rematch ×${sum.streak}: gold ×${Math.pow(1.5, sum.streak).toFixed(2)}`);
      if (sum.questGold) lines.push(`{gold}Oath fulfilled: +${sum.questGold} gold`);
      if (sum.levels.length) lines.push(`{gold}LEVEL UP! You are now level ${S.p.level}.`);
      const after = dest => App.levelUps(() => dest());
      const buttons = [];
      if (sum.final) {
        buttons.push({ label: 'CLAIM YOUR TITLE', theme: 'gold', key: 'Enter', onTap: () => after(() => App.go('ending')) });
      } else {
        buttons.push({ label: 'FIGHT AGAIN', theme: 'red', onTap: () => after(() => App.go('combat', { enemy: e.name, streak: sum.streak + 1 })) });
        buttons.push({ label: 'BACK TO THE ARENA', theme: 'gold', key: 'Enter', onTap: () => after(() => App.go('arena', { tier: e.tier, enemy: e.name })) });
      }
      App.dialog(sum.final ? 'THE DRAGON FALLS' : 'VICTORY!', lines.join('\n') + (sum.final ? '' : `\n\n{dim}Fight again: it returns with ${sum.streak + 2} lives, but pays ×${Math.pow(1.5, sum.streak + 1).toFixed(2)} gold.`), buttons, { icon: A.enemyPortrait(e.name) });
    } else if (sum.result === 'lose') {
      App.music(null);
      const tip = (S.stats.losses >= 2 && !S.settings.assist) ? '\n\n{dim}Tip: turn on Block Assist in Options for slower wind-ups.' : '\n\n{dim}Watch which side it winds up from, and block that side.';
      App.dialog('DEFEATED', `You were dragged from the sand barely alive.\n{red}Lost ${U.fmt(sum.lostGold)} gold.${tip}`, [
        { label: 'LIMP BACK TO TOWN', theme: 'stone', key: 'Enter', onTap: () => App.go('town') },
      ]);
    } else {
      const gotGold = sum.gold ? `\n{gold}+${U.fmt(sum.gold)} gold` : '';
      const gotXp = sum.xp ? `  {blue}+${U.fmt(sum.xp)} XP` : '';
      App.dialog('ESCAPED', `You slip out of the arena with your life.${gotGold}${gotXp}`, [
        { label: 'BACK TO THE ARENA', theme: 'gold', key: 'Enter', onTap: () => App.levelUps(() => App.go('arena', { tier: st.enemy.tier, enemy: st.enemy.name })) },
      ]);
    }
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------
  function render(t) {
    const c = st.c, w = L.w;
    // stage
    A.drawScene('arena', 0, L.stageY, w, L.stageH, App.t, { tier: st.enemy.tier }, { cheer: st.cheer });
    G.clip(0, L.stageY, w, L.stageH, () => {
      drawEnemy();
      drawTell();
      drawHero();
      FX.draw();
      drawTurnStrip();
      if (st.banner) drawBanner();
    });
    drawEnemyPlate();
    drawPlayerBar();
    drawLog();
    drawActions();
  }

  function drawEnemy() {
    if (st.dieT >= 1) return;
    const [x, y] = enemyOrigin();
    const pose = Object.assign({}, st.pose);
    if (st.phase !== 'windup' && st.strikeT <= 0) { pose.wind = 0; pose.strike = 0; }
    if (st.strikeT <= 0) pose.strike = 0;
    pose.hurt = st.hurtT > 0 || st.dying ? 1 : 0;
    if (!pose.wind && !pose.strike && !pose.hurt) pose.f = Math.floor(App.t * 4) % 4;
    const img = A.enemyFrame(st.enemy.name, pose);
    const d = enemyDef();
    // shadow
    G.dither((L.w >> 1) - Math.floor(d.w / 3), L.enemyFeetY - 2, Math.floor(d.w * 2 / 3), 5, null, '#000', 9);
    let fade = 0;
    if (st.introT < 0.6) fade = Math.round((1 - st.introT / 0.6) * 16);
    if (st.dying) fade = Math.round(Math.max(0, st.dieT - 0.25) / 0.75 * 16);
    const flash = st.flashT > 0 && (Math.floor(st.flashT * 30) & 1) === 0 ? '#fff' : null;
    G.blit(img, x, y, { fade, flash });
  }

  // Extra readability for the tell: a pulsing chevron on the attacking side.
  function drawTell() {
    if (st.phase !== 'windup' || !st.windup) return;
    const dir = st.pose.dir;
    const [sx, sy] = enemySide(dir);
    const pulse = Math.floor(App.t * 10) & 1;
    const col = pulse ? '#f65' : '#fd5';
    const big = S.settings.assist;
    const glyph = dir < 0 ? '◀' : dir > 0 ? '▶' : '▲';
    const ox = dir < 0 ? -10 : dir > 0 ? 6 : -2, oy = dir === 0 ? -12 : 0;
    if (big) F.big(glyph, sx + ox, sy + oy - 4, { scale: 2, ramp: 'blood', align: 'center' });
    else F.draw(glyph, sx + ox, sy + oy, col, { outline: '#000' });
    // coaching for brand-new players: the first few attacks are spelled out
    if ((S.stats.blocks || 0) + (S.stats.parries || 0) < 3 && (S.stats.fights || 0) <= 3) {
      const side = dir < 0 ? 'LEFT: tap ◀' : dir > 0 ? 'RIGHT: tap ▶' : 'ABOVE: tap ▲';
      const txt = `It attacks from the ${side}`;
      const ty = L.stageY + 24;
      G.dither(0, ty - 3, L.w, 14, null, '#000', 11);
      F.draw(txt, L.w >> 1, ty, pulse ? '#fd5' : '#ffe', { align: 'center', shadow: true });
    }
  }

  function drawHero() {
    const pose = Object.assign({ f: Math.floor(App.t * 3) % 4 }, st.hero);
    const img = A.heroFrame(pose, Gm.gear());
    const def = A.hero || { w: 80, h: 72, anchor: [40, 71] };
    let x = (L.w >> 1) - def.anchor[0], y = L.heroY - def.anchor[1];
    if (st.hero.act === 'hurt') y += 2;
    if (st.hero.act === 'attack' && st.hero.t === 1) y -= 3;
    let fade = 0;
    if (st.heroDying) { fade = Math.round(st.heroDying * 12); y += Math.round(st.heroDying * 10); }
    if (st.vanishing) fade = Math.round(st.vanishing * 16);
    G.blit(img, x, y, { fade });
  }

  function drawTurnStrip() {
    if (st.c.over) return;
    const order = C.preview(6);
    let x = 4;
    const y = L.stageY + 4;
    G.dither(x - 2, y - 2, 6 * 14 + 30, 16, null, '#000', 9);
    F.draw('NEXT', x, y + 3, '#889', { shadow: true });
    x += 24;
    const por = A.enemyPortrait(st.enemy.name), hp = A.icon('hero_portrait');
    order.forEach((who, i) => {
      G.rect(x - 1, y - 1, 13, 13, i === 0 ? '#fd5' : '#000');
      const src = who === 'p' ? hp : por;
      G.ctx.drawImage(src, 6, 4, 11, 11, x, y, 11, 11);
      if (who === 'e') G.dither(x, y, 11, 11, null, '#d33', 3);
      x += 14;
    });
  }

  function drawBanner() {
    const b = st.banner;
    const f = b.t;
    if (f > 1.3) return;
    const y = L.stageY + Math.round(L.stageH * 0.3);
    const slide = f < 0.15 ? (0.15 - f) * 600 : f > 1.1 ? (f - 1.1) * -800 : 0;
    G.dither(0, y - 4, L.w, 34, null, '#000', 10);
    F.big(b.text, (L.w >> 1) + slide, y, { scale: 2, ramp: 'blood', align: 'center' });
    F.big(b.sub, (L.w >> 1) - slide, y + 16, { scale: 1, ramp: 'gold', align: 'center' });
  }

  function drawEnemyPlate() {
    const c = st.c, w = L.w;
    UI.panel(0, 0, w, L.plateH, 'stone');
    F.draw(st.enemy.name, 6, 5, P.c.gold, { shadow: true });
    // lives
    if (c.lives > 1) {
      let lx = 6 + F.measure(st.enemy.name) + 6;
      for (let i = 0; i < c.lives; i++) { F.draw('♥', lx, 5, i < c.livesLeft ? P.c.red : '#334', { shadow: true }); lx += 7; }
    }
    const armor = c.est.some(s => s.type === 'shatter') ? `{red}ARM ${Math.round(st.enemy.armor * (1 - c.est.find(s => s.type === 'shatter').armorPct))}` : `ARM ${st.enemy.armor}`;
    F.draw(`${armor}{/}  SPD ${C.enemySpeed(c)}`, w - 6, 5, P.c.dim, { align: 'right', shadow: true });
    UI.bar(5, 15, w - 10, 9, c.ehp / c.emax, 'blood', { ghost: st.hpGhost / c.emax, label: `${Math.max(0, c.ehp)}/${c.emax}` });
    App.statusIcons(C.statusList('enemy'), 6, 26);
  }

  function drawPlayerBar() {
    const p = S.p, w = L.w, y = L.barY;
    UI.panel(0, y, w, L.barH, 'stone');
    const bw = Math.floor((w - 14) / 2);
    const low = p.hp / p.maxHp < 0.3;
    UI.bar(5, y + 4, bw, 9, p.hp / p.maxHp, low ? 'blood' : 'green', { ghost: st.pGhost / p.maxHp, label: `HP ${p.hp}/${p.maxHp}`, pulse: low });
    UI.bar(9 + bw, y + 4, bw, 9, p.mp / Math.max(1, p.maxMp), 'arcane', { label: `MP ${p.mp}/${p.maxMp}` });
    const end = App.statusIcons(C.statusList('player'), 6, y + 15);
    F.draw(`SPD ${C.playerSpeed()}`, w - 6, y + 14, P.c.dim, { align: 'right' });
    if (st.c.pst.some(s => s.type === 'riposte')) F.draw('counter ready', end + 2, y + 14, P.c.gold);
  }

  function drawLog() {
    const w = L.w, y = L.logY;
    UI.panel(0, y, w, L.logH, 'dark');
    const lines = [];
    for (let i = st.log.length - 1; i >= 0 && lines.length < 3; i--) {
      const wr = F.wrap('{' + st.log[i].col + '}' + st.log[i].text, w - 12);
      for (let k = wr.length - 1; k >= 0 && lines.length < 3; k--) lines.unshift({ text: wr[k], age: st.log.length - 1 - i });
    }
    lines.forEach((ln, i) => F.draw(ln.text, 6, y + 4 + i * 10, P.c.text, { shadow: true }));
  }

  // ---------------------------------------------------------------
  // Actions / block pad / sub-menus
  // ---------------------------------------------------------------
  function drawActions() {
    const w = L.w, y = L.actY, h = L.h - L.actY;
    UI.panel(0, y, w, h, 'stone');
    if (st.phase === 'windup') return drawBlockPad(y, h);

    const ready = st.phase === 'player' && !st.queue.length && st.wait <= 0;
    const pad = 5, gap = 4;
    const bw = Math.floor((w - pad * 2 - gap) / 2), bh = Math.floor((h - pad * 2 - gap) / 2);

    if (st.menu) return drawMenu(y, h, ready);

    const p = S.p;
    const cheapest = p.slots.length ? Math.min(...p.slots.map(Gm.abilityCost)) : 99;
    const items = Object.values(p.potions).reduce((s, n) => s + n, 0) + Gm.wandCharges();
    if (UI.button('a-atk', pad, y + pad, bw, bh, 'ATTACK', { theme: 'red', icon: A.icon('ui_atk'), disabled: !ready, key: ['1', 'a'], sound: false })) doAct('attack');
    if (UI.button('a-skl', pad + bw + gap, y + pad, bw, bh, 'SKILLS', { theme: 'purple', icon: A.icon('m_skills'), disabled: !ready || !p.slots.length, sub: p.slots.length ? `from ${cheapest} MP` : 'none', key: ['2', 's'] })) st.menu = 'skills';
    if (UI.button('a-itm', pad, y + pad + bh + gap, bw, bh, 'ITEMS', { theme: 'green', icon: A.icon('m_bag'), disabled: !ready || !items, sub: items ? `${items} in pack` : 'empty', key: ['3', 'i'] })) st.menu = 'items';
    if (UI.button('a-fle', pad + bw + gap, y + pad + bh + gap, bw, bh, 'FLEE', { theme: 'stone', icon: A.icon('m_flee'), disabled: !ready, key: ['4', 'f'], sound: false })) doAct('flee');
  }

  function drawMenu(y, h, ready) {
    const w = L.w, p = S.p;
    const opts = [];
    if (st.menu === 'skills') {
      p.slots.forEach(id => {
        const a = Gm.abilityData(id), cost = Gm.abilityCost(id);
        opts.push({ id, label: Gm.abilityName(id), sub: `${cost} MP · ${a.ranks[Gm.rank(id) - 1]}`, icon: A.icon(a.icon), ok: p.mp >= cost, act: () => doAct('ability', id), theme: 'purple' });
      });
    } else {
      for (const [n, cnt] of Object.entries(p.potions)) {
        const it = Gm.itemData(n);
        const full = it.type === 'mana' ? p.mp >= p.maxMp : p.hp >= p.maxHp;
        opts.push({ id: n, label: `${n} ×${cnt}`, sub: full ? (it.type === 'mana' ? 'MP is full' : 'HP is full') : it.type === 'mana' ? `+${it.value} MP` : it.value >= 999 ? 'Full HP' : `+${it.value} HP`, icon: A.icon(it.icon), ok: !full, act: () => doAct('potion', n), theme: 'green' });
      }
      for (const [n, cnt] of Object.entries(p.wands)) {
        const it = Gm.itemData(n);
        opts.push({ id: n, label: `${n} (${cnt})`, sub: it.element === 'fire' ? 'Fire, ignores armour' : 'Lightning, may stun', icon: A.icon(it.icon), ok: true, act: () => doAct('wand', n), theme: 'blue' });
      }
    }
    // the menu grows upward over the log if needed
    const rowH = 26, n = opts.length;
    const mh = n * (rowH + 3) + 28;
    const my = L.h - mh - 4;
    UI.panel(2, my, w - 4, mh + 2, 'gold');
    opts.forEach((o, i) => {
      if (UI.button('m-' + o.id, 8, my + 6 + i * (rowH + 3), w - 16, rowH, o.label, { icon: o.icon, sub: o.sub, align: 'left', theme: o.ok ? o.theme : 'dark', disabled: !ready || !o.ok, key: String(i + 1), sound: false })) o.act();
    });
    if (UI.button('m-back', 8, my + mh - 22, w - 16, 18, 'BACK', { key: 'Escape', sound: 'back' })) st.menu = null;
  }

  function drawBlockPad(y, h) {
    const w = L.w, a = st.windup;
    // timer bar with the parry zone at the end
    const bx = 6, bw = w - 12, by = y + 4;
    const remain = Math.max(0, a.windup - st.wt);
    // time runs left → right; the parry zone waits at the right-hand end
    G.rect(bx, by, bw, 6, '#000');
    const inner = bw - 2;
    const pz = Math.round(inner * a.parry / a.windup);
    G.rect(bx + 1 + inner - pz, by + 1, pz, 4, a.breath ? '#334' : '#530');
    G.dither(bx + 1 + inner - pz, by + 1, pz, 4, null, a.breath ? '#556' : '#a70', 8);
    const fill = Math.round(inner * Math.min(1, st.wt / a.windup));
    G.rect(bx + 1, by + 1, fill, 4, remain <= a.parry && !a.breath ? '#fe6' : '#d33');
    G.rect(bx + fill, by, 1, 6, '#fff');
    F.draw(a.breath ? 'BREATH! block it — it cannot be parried' : remain <= a.parry ? 'NOW — PARRY!' : 'BLOCK THE ATTACK', w >> 1, by + 8, remain <= a.parry && !a.breath ? P.c.gold : P.c.text, { align: 'center', shadow: true });
    const pad = 5, gap = 4, top = by + 19;
    const bh = y + h - top - pad;
    const cw = Math.floor((w - pad * 2 - gap * 2) / 3);
    const dirs = [[-1, '◀ LEFT', ['ArrowLeft', 'a']], [0, '▲ HIGH', ['ArrowUp', 'w', ' ']], [1, 'RIGHT ▶', ['ArrowRight', 'd']]];
    dirs.forEach(([d, label, keys], i) => {
      const x = pad + i * (cw + gap);
      const hint = S.settings.assist && d === st.pose.dir;
      UI.button('blk' + d, x, top, cw, bh, label, { theme: st.guard === d ? 'gold' : hint ? 'red' : 'steel', sound: false });
      // react on touch-down, not release: blocking must be instant. Each press re-times the guard.
      if (UI.enabled && UI.pointer.pressed && UI.active === 'blk' + d) setGuard(d);
      if (keys.some(k => UI.key(k))) setGuard(d);
    });
    // swipes on the stage
    const sw = UI.swipe(0, L.stageY, w, L.stageH);
    if (sw === 'L') setGuard(-1); else if (sw === 'R') setGuard(1); else if (sw === 'U') setGuard(0);
  }
})();
