// ================================================================
// BONE DICE — a stranger's game in the Rusty Flagon.
// Roll three bone dice, hold any, re-roll the rest once.
// Skulls stay where they fall. Three skulls pays the most of all.
// Payouts give about a 5% house edge with perfect play.
// ================================================================
(() => {
  const G = DW.gfx, F = DW.font, UI = DW.ui, K = DW.kit, FX = DW.fx, U = DW.util, P = DW.pal;
  const Gm = DW.game, S = DW.state, App = DW.app;

  const FACES = ['skull', 'moon', 'eye', 'crown', 'fang', 'flame'];
  const BETS = [10, 25, 50, 100, 250, 500];

  // Payout as a multiple of the bet (1 = your bet back).
  const score = dice => {
    const n = f => dice.filter(d => d === f).length;
    const kinds = new Set(dice).size;
    if (n('skull') === 3) return { mult: 12, text: "THREE SKULLS — DEATH'S FAVOUR!" };
    if (n('skull') > 0) return { mult: 0, text: 'A skull. The bones are against you.' };
    if (n('crown') === 3) return { mult: 8, text: 'THREE CROWNS!' };
    if (kinds === 1) return { mult: 3, text: `Three ${dice[0]}s!` };
    if (n('crown') === 2) return { mult: 1.5, text: 'Two crowns.' };
    if (kinds === 2) return { mult: 1, text: 'A pair. Your stake comes back.' };
    return { mult: 0, text: 'Nothing. The stranger sweeps up your gold.' };
  };

  // ---------------------------------------------------------------
  // Art: 11px symbols on a bone die
  // ---------------------------------------------------------------
  const SYM = {
    skull: { c: { k: '#213' }, rows: ['...kkkkk...', '..kkkkkkk..', '.kkkkkkkkk.', '.kk..k..kk.', '.kk..k..kk.', '.kkkkkkkkk.', '..kkk.kkk..', '...kkkkk...', '...k.k.k...', '...kkkkk...'] },
    moon: { c: { b: '#248', c: '#8de', w: '#eff' }, rows: ['....bbbb...', '..bbccw....', '.bbcc......', '.bcc.......', 'bbcc.......', 'bbcc.......', 'bbcc.......', '.bcc.......', '.bbcc......', '..bbccw....', '....bbbb...'] },
    eye: { c: { k: '#213', r: '#d33', o: '#f98', w: '#ffe' }, rows: ['...........', '...kkkkk...', '.kkwwwwwkk.', 'kwwwrrrwwwk', 'kwwrrkrrwwk', 'kwwwrrrwwwk', '.kkwwwwwkk.', '...kkkkk...'] },
    crown: { c: { g: '#c92', y: '#fe6', r: '#d33', k: '#530' }, rows: ['y....y....y', 'yg..ygy..gy', 'ygg.ygy.ggy', 'ggggggggggg', 'gyyyyyyyyyg', 'ggrggyggrgg', 'kkkkkkkkkkk'] },
    fang: { c: { w: '#ffe', b: '#998', r: '#d33', k: '#432' }, rows: ['.kkkkkkkk..', '.kwwwwwwbk.', '..kwwwwbk..', '..kwwwwbk..', '...kwwbk...', '...kwwbk...', '....kwk....', '....krk....', '.....r.....'] },
    flame: { c: { r: '#c40', o: '#e70', y: '#fd5', w: '#ffb' }, rows: ['.....r.....', '....rr.....', '....ror....', '...roor..r.', '..rooyor.r.', '..royyyorr.', '.rooywyyor.', '.royywwyor.', '.royyyyyor.', '..rooooor..', '...rrrrr...'] },
  };

  const DIE = 28;
  const dieImg = (face, held, stuck) => K.cached(`die|${face}|${held ? 1 : 0}|${stuck ? 1 : 0}`, DIE, DIE, Sp => {
    // body: rounded bone cube, lit from the upper left
    for (let y = 1; y < DIE - 1; y++) for (let x = 1; x < DIE - 1; x++) {
      const corner = (x < 3 || x > DIE - 4) && (y < 3 || y > DIE - 4) && Math.hypot(x < 3 ? 3 - x : x - (DIE - 4), y < 3 ? 3 - y : y - (DIE - 4)) > 2.2;
      if (corner) continue;
      const t = (x + y) / (2 * DIE);
      Sp.set(x, y, P.rampColor('bone', 7 - t * 4 - (x > DIE - 5 || y > DIE - 5 ? 1.5 : 0), x, y));
    }
    Sp.outline(stuck ? '#a13' : held ? '#fe6' : '#101');
    if (held || stuck) Sp.outline(stuck ? '#300' : '#a70');
    const s = SYM[face];
    const oy = Math.floor((DIE - s.rows.length) / 2), ox = Math.floor((DIE - 11) / 2);
    s.rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== '.') Sp.set(ox + x, oy + y, s.c[row[x]]); });
  });

  // ---------------------------------------------------------------
  // Screen
  // ---------------------------------------------------------------
  const LINES = {
    hello: ['"Bones of a saint, they say. Or a sinner. Roll."', '"Skulls stay where they fall, friend. That is the rule."', '"Three skulls and Death himself pays you."'],
    win: ['He pays without blinking. Has he ever blinked?', 'The stranger counts out your winnings with long grey fingers.', '"Lucky. Luck runs out."'],
    lose: ['The stranger grins with far too many teeth.', '"The bones remember," he whispers, pocketing your gold.', 'He blows on the dice. They seem to breathe.'],
  };

  let st;
  const reset = () => { st = { phase: 'bet', dice: ['crown', 'moon', 'eye'], held: [false, false, false], rollT: 0, rolls: 0, result: null, line: U.pick(LINES.hello), betIdx: st ? st.betIdx : 1 }; };

  function roll() {
    st.phase = 'rolling'; st.rollT = 0.7; st.rolls++;
    App.sfx('coin', { pitch: 0.6 });
  }
  function settle() {
    st.dice = st.dice.map((d, i) => (st.held[i] || (st.rolls > 1 && d === 'skull') ? d : U.pick(FACES)));
    // a triple on the first throw needs no re-roll (three skulls included)
    if (st.rolls === 1 && new Set(st.dice).size === 1) return finish();
    st.phase = st.rolls === 1 ? 'held' : 'done';
    if (st.phase === 'done') finish();
    else st.held = st.dice.map(d => d === 'skull');
  }
  function finish() {
    st.phase = 'done';
    const r = score(st.dice);
    const bet = BETS[st.betIdx];
    const pay = Math.floor(bet * r.mult);
    S.p.gold += pay;
    st.result = { ...r, pay, net: pay - bet };
    S.stats.diceNet = (S.stats.diceNet || 0) + pay - bet;
    st.line = U.pick(pay > bet ? LINES.win : pay < bet ? LINES.lose : ['He shrugs and slides your stake back.']);
    if (pay > bet) { App.sfx(r.mult >= 8 ? 'levelup' : 'coin'); FX.burst(G.w >> 1, G.h >> 1, { n: r.mult >= 8 ? 40 : 16, cols: ['#fe6', '#fd5', '#c92'], speed: 80, grav: 120 }); }
    else if (pay < bet) App.sfx('deny');
    Gm.save();
  }

  App.register('dice', {
    enter() { reset(); App.music('town'); },
    draw(dt) {
      const w = G.w, h = G.h;
      const top = App.header('inn', 'BONE DICE', h < 440 ? 56 : 80, { backTo: 'inn' });
      let y = top + 4;
      // the stranger's line
      UI.panel(4, y, w - 8, 30, 'parch');
      F.drawWrapped(st.line, 10, y + 5, w - 20, '#321');
      y += 36;

      // payouts
      UI.panel(4, y, w - 8, 58, 'dark');
      const rows = [['Three skulls', '×12', P.c.red], ['Three crowns', '×8', P.c.gold], ['Any other triple', '×3', P.c.text], ['Two crowns', '×1.5', P.c.text], ['Any pair', 'stake back', P.c.dim]];
      rows.forEach(([k, v, c], i) => { F.draw(k, 10, y + 4 + i * 10, c); F.draw(v, w - 10, y + 4 + i * 10, c, { align: 'right' }); });
      y += 62;
      F.draw('Any other skull loses. Skulls stay where they fall.', w >> 1, y, '#889', { align: 'center' });
      y += 14;

      // dice
      if (st.phase === 'rolling') {
        st.rollT -= dt;
        if (Math.floor(st.rollT * 20) !== Math.floor((st.rollT + dt) * 20)) App.sfx('tap', { pitch: 1.5, vol: 0.4 });
        if (st.rollT <= 0) settle();
      }
      const ds = h >= 470 ? 2 : 1, D2 = DIE * ds;           // big dice when there's room
      const gap = 12, total = D2 * 3 + gap * 2, dx = (w - total) >> 1;
      for (let i = 0; i < 3; i++) {
        const x = dx + i * (D2 + gap);
        const spinning = st.phase === 'rolling' && !st.held[i];
        const face = spinning ? FACES[Math.floor((st.rollT * 23 + i * 7)) % 6] : st.dice[i];
        const jy = spinning ? Math.round(Math.sin(st.rollT * 40 + i) * 3) : 0;
        const stuck = st.phase === 'held' && st.dice[i] === 'skull';
        G.dither(x + 2, y + D2 + 1, D2 - 4, 3, null, '#000', 9);
        G.ctx.drawImage(dieImg(face, st.phase === 'held' && st.held[i] && !stuck, stuck), x, y + jy * ds, D2, D2);
        if (st.phase === 'held') {
          if (!stuck && UI.tap('die' + i, x - 4, y - 4, D2 + 8, D2 + 18)) { st.held[i] = !st.held[i]; App.sfx('tap'); }
          F.draw(stuck ? 'STUCK' : st.held[i] ? 'HELD' : 'roll', x + D2 / 2, y + D2 + 5, stuck ? P.c.red : st.held[i] ? P.c.gold : '#667', { align: 'center' });
        }
      }
      y += D2 + 18;

      // result
      if (st.phase === 'done' && st.result) {
        const r = st.result;
        F.draw(r.text, w >> 1, y, r.mult > 1 ? P.c.gold : r.mult === 1 ? P.c.text : P.c.red, { align: 'center', outline: '#000' });
        F.draw(r.net > 0 ? `You win ${U.fmt(r.net)} gold` : r.net < 0 ? `You lose ${U.fmt(-r.net)} gold` : 'Even.', w >> 1, y + 11, r.net > 0 ? P.c.green : r.net < 0 ? P.c.red : P.c.dim, { align: 'center', shadow: true });
      } else if (st.phase === 'held') {
        F.draw('Tap dice to hold them, then re-roll the rest', w >> 1, y + 4, P.c.text, { align: 'center', shadow: true });
      }
      y += 26;

      // controls
      const bw = w - 8, bet = BETS[st.betIdx];
      if (st.phase === 'bet' || st.phase === 'done') {
        if (UI.button('bet-', 4, y, 30, 24, '-', { disabled: st.betIdx === 0 })) st.betIdx--;
        if (UI.button('bet+', w - 34, y, 30, 24, '+', { disabled: st.betIdx === BETS.length - 1 || BETS[st.betIdx + 1] > S.p.gold })) st.betIdx++;
        F.draw(`Stake: {gold}${bet} gold`, w >> 1, y + 8, P.c.text, { align: 'center', shadow: true });
        y += 30;
        const can = S.p.gold >= bet;
        if (UI.button('roll', 4, y, bw, 30, can ? (st.phase === 'done' ? 'ROLL AGAIN' : 'ROLL THE BONES') : 'NOT ENOUGH GOLD', { theme: can ? 'gold' : 'stone', disabled: !can, key: 'Enter', sound: false })) {
          S.p.gold -= bet;
          st.rolls = 0; st.held = [false, false, false]; st.result = null;
          roll();
        }
      } else if (st.phase === 'held') {
        const hw = Math.floor((bw - 4) / 2);
        if (UI.button('reroll', 4, y, hw, 30, 'RE-ROLL', { theme: 'gold', key: 'Enter', sound: false })) roll();
        if (UI.button('stand', 8 + hw, y, hw, 30, 'STAND', { theme: 'stone', key: 's' })) finish();
      }
      App.drawHud();
    },
  });
})();
