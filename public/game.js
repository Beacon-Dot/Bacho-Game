(() => {
'use strict';

/* ---------- Maze: # wall, . pen, o super pen, - ghost door, G ghost box, P pac start ---------- */
const MAP = [
  '###################',
  '#........#........#',
  '#o##.###.#.###.##o#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.###.#.###.####',
  '####.#.......#.####',
  '####.#.##-##.#.####',
  '    ...#GGG#...    ',
  '####.#.#####.#.####',
  '####.#.......#.####',
  '####.###.#.###.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#.....P.....#.o#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '#.######.#.######.#',
  '#.................#',
  '###################'
];
const COLS = 19, ROWS = 21, T = 24, TUN = 9;
const K = 2;   // render scale: logical size stays 24px tiles, canvas is drawn at 2x for sharpness
const DIRS = [{x:0,y:-1},{x:-1,y:0},{x:0,y:1},{x:1,y:0}];
const CHARS = {
  pacman: { img: 'pacman', color: '#ffd84a', label: 'Bacho' },
  ghost1: { img: 'ghost1', color: '#ff4b4b', label: 'Somi' },
  ghost2: { img: 'ghost2', color: '#ff8ad8', label: 'Gopa' },
  ghost3: { img: 'ghost3', color: '#3fe6ff', label: 'Ayaan' }
};
const DIR_NAMES = { up: DIRS[0], left: DIRS[1], down: DIRS[2], right: DIRS[3] };
const FRIGHT_TIME = 7;

/* ---------- DOM ---------- */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
cv.width = COLS * T * K; cv.height = ROWS * T * K;
const $score = document.getElementById('score');
const $high = document.getElementById('high');
const $lives = document.getElementById('lives');
const $level = document.getElementById('level');
const $mute = document.getElementById('mute');
const $ov = document.getElementById('overlay');
const $ovTitle = document.getElementById('ov-title');
const $ovText = document.getElementById('ov-text');
const $ovBtn = document.getElementById('ov-btn');

/* ---------- Images ---------- */
const img = {};
['pacman', 'ghost1', 'ghost2', 'ghost3', 'pen', 'superpen'].forEach(n => {
  const i = new Image();
  i.onerror = () => {
    console.warn('Could not load ' + n + '.png - keep it in the same folder as index.html');
    const w = document.getElementById('ov-text');
    if (w && !w.dataset.warned) { w.dataset.warned = '1'; w.innerHTML += '<br><br>⚠ Missing image: ' + n + '.png (put all PNGs next to index.html)'; }
  };
  i.src = n + '.png';
  img[n] = i;
});
const ok = i => i && i.complete && i.naturalWidth > 0;

/* ---------- Audio (Web Audio API, no files) ---------- */
let AC = null, muted = false, siren = null, blipAlt = false;
function initAudio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
  if (AC && AC.state === 'suspended') AC.resume();
  unlockClips();
}
function tone(f, d, type = 'square', v = 0.07, delay = 0, f2) {
  if (!AC || muted) return;
  const t = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + d);
  o.connect(g); g.connect(AC.destination);
  o.start(t); o.stop(t + d + 0.03);
}
const clips = {};
const canOgg = (() => { try { return !!new Audio().canPlayType('audio/ogg; codecs="opus"') || !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch (e) { return false; } })();
[1, 2, 3].forEach(n => {
  const a = new Audio();
  a.preload = 'auto';
  a.addEventListener('error', () => {
    if (!a.triedMp3 && canOgg) { a.triedMp3 = true; a.src = 'sound' + n + '.mp3'; } else a.bad = true;
  });
  a.src = 'sound' + n + (canOgg ? '.ogg' : '.mp3');
  clips[n] = a;
});
let clipsUnlocked = false;
function unlockClips() {   // mobile browsers only allow playback after a user gesture
  if (clipsUnlocked) return;
  clipsUnlocked = true;
  Object.values(clips).forEach(a => {
    a.muted = true;
    const p = a.play();
    const done = () => { a.pause(); a.currentTime = 0; a.muted = false; };
    if (p && p.then) p.then(done).catch(() => { a.muted = false; }); else done();
  });
}
function playClip(n, fallback) {
  if (muted) return;
  const a = clips[n];
  if (!a || a.bad) { if (fallback) fallback(); return; }
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => { if (fallback) fallback(); });
  } catch (e) { if (fallback) fallback(); }
}
const sfx = {
  pen() { blipAlt = !blipAlt; tone(blipAlt ? 520 : 390, 0.07, 'square', 0.05); },
  power() { playClip(2, () => tone(220, 0.35, 'sawtooth', 0.08, 0, 900)); },
  ghost() { playClip(3, () => tone(180, 0.3, 'sawtooth', 0.09, 0, 1400)); },
  death() { playClip(1, () => tone(700, 0.9, 'square', 0.08, 0, 70)); },
  over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'square', 0.08, i * 0.28)); tone(131, 0.7, 'triangle', 0.1, 1.15); },
  win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.16, 'square', 0.07, i * 0.14)); }
};
function sirenStart() {
  if (!AC || siren) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'square'; g.gain.value = muted ? 0 : 0.025;
  o.connect(g); g.connect(AC.destination); o.start();
  siren = { o, g };
}
function sirenStop() {
  if (!siren) return;
  try { siren.o.stop(); } catch (e) {}
  siren = null;
}
function sirenUpdate(now) {
  if (siren) siren.o.frequency.value = 420 + 260 * Math.abs(Math.sin(now * 5));
}
$mute.addEventListener('click', toggleMute);
function toggleMute() {
  muted = !muted;
  $mute.textContent = muted ? '🔇' : '🔊';
  if (siren) siren.g.gain.value = muted ? 0 : 0.025;
  if (muted) Object.values(clips).forEach(a => a.pause());
}

/* ---------- Game state ---------- */
let state = 'menu';   // menu | ready | play | dying | over | win
const START_LIVES = 5;
let level = 1, score = 0, lives = START_LIVES, high = 0, timer = 0, fright = 0, combo = 0, foodLeft = 0, clock = 0;
let food, pac, ghosts, popups = [];
try { high = parseInt(localStorage.getItem('pacpen-high') || '0', 10) || 0; } catch (e) {}
$high.textContent = high;

const GHOST_DEFS = [
  { type: 'chase',  img: 'ghost1', color: '#ff4b4b', start: [9, 7],  wait: 0, state: 'normal' },
  { type: 'ambush', img: 'ghost2', color: '#ff8ad8', start: [9, 9],  wait: 3, state: 'house' },
  { type: 'patrol', img: 'ghost3', color: '#3fe6ff', start: [10, 9], wait: 7, state: 'house' }
];

function bfs(tx, ty) {
  const d = Array.from({ length: ROWS }, () => Array(COLS).fill(Infinity));
  const q = [[tx, ty]]; d[ty][tx] = 0;
  while (q.length) {
    const [c, r] = q.shift();
    for (const v of DIRS) {
      const nc = c + v.x, nr = r + v.y;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      if (MAP[nr][nc] === '#' || d[nr][nc] !== Infinity) continue;
      d[nr][nc] = d[r][c] + 1; q.push([nc, nr]);
    }
  }
  return d;
}
const distHome = bfs(9, 9), distExit = bfs(9, 7);
const dd = (m, c, r) => (r < 0 || r >= ROWS || c < 0 || c >= COLS) ? Infinity : m[r][c];

function buildFood() {
  food = []; foodLeft = 0;
  for (let r = 0; r < ROWS; r++) {
    food.push([]);
    for (let c = 0; c < COLS; c++) {
      const ch = MAP[r][c];
      const v = ch === '.' ? 1 : ch === 'o' ? 2 : 0;
      food[r].push(v); if (v) foodLeft++;
    }
  }
}
function resetActors() {
  pac = { c: 9, r: 15, dx: 0, dy: 0, p: 0, next: null, mouth: 0 };
  ghosts = GHOST_DEFS.map(d => ({ ...d, c: d.start[0], r: d.start[1], dx: d.type === 'chase' ? -1 : 0, dy: 0, p: 0, fright: false, wait: d.wait }));
  fright = 0; combo = 0; sirenStop();
}
function newGame() {
  score = 0; lives = START_LIVES; level = 1; popups = [];
  buildFood(); resetActors(); updateHud();
  startReady();
}
function startReady() { state = 'ready'; timer = 1.8; $ov.classList.add('hidden'); }

function updateHud() {
  $score.textContent = score; $high.textContent = high; $level.textContent = level;
  $lives.textContent = lives > 0 ? '♥'.repeat(lives) : '–';
}
function addScore(n) {
  score += n;
  if (score > high) { high = score; try { localStorage.setItem('pacpen-high', String(high)); } catch (e) {} }
  updateHud();
}
function showOverlay(title, text, btn) {
  $ovTitle.textContent = title; $ovText.innerHTML = text; $ovBtn.textContent = btn;
  $ov.classList.remove('hidden'); $ovBtn.focus({ preventScroll: true });
}
$ovBtn.addEventListener('click', () => { initAudio(); newGame(); });

/* ---------- Movement ---------- */
const wrap = e => { if (e.c < 0) e.c = COLS - 1; else if (e.c >= COLS) e.c = 0; };
function canPac(c, r, d) {
  const nc = c + d.x, nr = r + d.y;
  if (nc < 0 || nc >= COLS) return r === TUN;
  const ch = MAP[nr][nc];
  return ch !== '#' && ch !== '-' && ch !== 'G';
}
function canGhost(g, d) {
  const nc = g.c + d.x, nr = g.r + d.y;
  if (nc < 0 || nc >= COLS) return g.r === TUN;
  const ch = MAP[nr][nc];
  if (ch === '#') return false;
  if (ch === '-') return g.state === 'leaving' || g.state === 'eaten';
  return true;
}
function flip(e) {
  if (!e.dx && !e.dy) return;
  if (e.p > 0) { e.c += e.dx; e.r += e.dy; wrap(e); e.p = 1 - e.p; }
  e.dx = -e.dx; e.dy = -e.dy;
}
function advance(e, dist, decide, arrive) {
  while (dist > 1e-9) {
    if (e.p === 0) { decide(e); if (!e.dx && !e.dy) return; }
    const s = Math.min(dist, 1 - e.p);
    e.p += s; dist -= s;
    if (e.p >= 1 - 1e-9) { e.c += e.dx; e.r += e.dy; wrap(e); e.p = 0; if (arrive) arrive(e); }
  }
}

function setDir(d) {
  if (state !== 'play' && state !== 'ready') return;
  pac.next = d;
  if ((pac.dx || pac.dy) && d.x === -pac.dx && d.y === -pac.dy) flip(pac);
}
function pacDecide(e) {
  if (e.next && canPac(e.c, e.r, e.next)) { e.dx = e.next.x; e.dy = e.next.y; }
  if (!canPac(e.c, e.r, { x: e.dx, y: e.dy })) { e.dx = 0; e.dy = 0; }
}
function pacArrive(e) {
  const v = food[e.r][e.c];
  if (!v) return;
  food[e.r][e.c] = 0; foodLeft--;
  if (v === 1) { addScore(10); sfx.pen(); }
  else {
    addScore(50); sfx.power();
    fright = FRIGHT_TIME; combo = 0; sirenStart();
    ghosts.forEach(g => { if (g.state !== 'eaten') { g.fright = true; if (g.state === 'normal') flip(g); } });
  }
  if (foodLeft <= 0) levelComplete();
}

function ghostDecide(g) {
  const opts = DIRS.filter(d => canGhost(g, d));
  if (!opts.length) { g.dx = 0; g.dy = 0; return; }
  let pick;
  if (g.state === 'leaving' || g.state === 'eaten') {
    const m = g.state === 'eaten' ? distHome : distExit;
    pick = opts.reduce((a, b) => dd(m, g.c + b.x, g.r + b.y) < dd(m, g.c + a.x, g.r + a.y) ? b : a);
  } else {
    let f = opts.filter(d => !(d.x === -g.dx && d.y === -g.dy));
    if (!f.length) f = opts;
    if (g.fright || g.type === 'patrol') pick = f[Math.floor(Math.random() * f.length)];
    else {
      let tx = pac.c, ty = pac.r;
      if (g.type === 'ambush') { tx += pac.dx * 4; ty += pac.dy * 4; }
      const cost = d => (g.c + d.x - tx) ** 2 + (g.r + d.y - ty) ** 2;
      pick = f.reduce((a, b) => cost(b) < cost(a) ? b : a);
    }
  }
  g.dx = pick.x; g.dy = pick.y;
}
function ghostArrive(g) {
  if (g.state === 'eaten' && g.c === 9 && g.r === 9) { g.state = 'leaving'; g.fright = false; }
  else if (g.state === 'leaving' && g.r <= 7) g.state = 'normal';
}
// Ghost speed multiplier: starts slow (0.72x) and rises 0.06 each level, capped at 1.12x
// (Pac-Man's own speed is 6.5 tiles/s). Tweak the three numbers to change the difficulty curve.
const ghostMul = () => Math.min(1.12, 0.72 + 0.06 * (level - 1));
function ghostSpeed(g) {
  if (g.state === 'eaten') return 11;
  if (g.state === 'leaving') return 4.5;
  if (g.fright) return 3.4 * Math.min(1, ghostMul());
  return (g.type === 'chase' ? 5.8 : 5.5) * ghostMul();
}

/* ---------- Update ---------- */
const pos = e => ({ x: e.c + e.dx * e.p, y: e.r + e.dy * e.p });

function update(dt) {
  clock += dt;
  popups.forEach(p => p.t += dt);
  popups = popups.filter(p => p.t < 0.9);
  sirenUpdate(clock);

  if (state === 'ready') { timer -= dt; if (timer <= 0) state = 'play'; return; }
  if (state === 'dying') {
    timer -= dt;
    if (timer <= 0) {
      lives--; updateHud();
      if (lives <= 0) endGame(false);
      else { resetActors(); startReady(); }
    }
    return;
  }
  if (state === 'levelup') {
    timer -= dt;
    if (timer <= 0) { level++; buildFood(); resetActors(); popups = []; updateHud(); startReady(); }
    return;
  }
  if (state !== 'play') return;

  advance(pac, 6.5 * dt, pacDecide, pacArrive);
  if (state !== 'play') return;
  if (pac.dx || pac.dy) pac.mouth += dt * 14;

  if (fright > 0) {
    fright -= dt;
    if (fright <= 0) { fright = 0; combo = 0; ghosts.forEach(g => g.fright = false); sirenStop(); }
  }

  for (const g of ghosts) {
    if (g.state === 'house') { g.wait -= dt; if (g.wait <= 0) g.state = 'leaving'; continue; }
    advance(g, ghostSpeed(g) * dt, ghostDecide, ghostArrive);
  }

  const pp = pos(pac);
  for (const g of ghosts) {
    const gp = pos(g);
    if (Math.hypot(pp.x - gp.x, pp.y - gp.y) > 0.65 || g.state === 'eaten') continue;
    if (g.fright) {
      combo++;
      const pts = 200 * Math.pow(2, combo - 1);
      addScore(pts); sfx.ghost();
      popups.push({ x: (gp.x + .5) * T, y: (gp.y + .5) * T, text: '+' + pts, t: 0 });
      g.state = 'eaten'; g.fright = false;
    } else {
      state = 'dying'; timer = 1.3; sirenStop(); sfx.death();
      return;
    }
  }
}

function levelComplete() {
  state = 'levelup'; timer = 2.2; sirenStop(); sfx.win();
  ghosts.forEach(g => g.fright = false); fright = 0;
}

function endGame(win) {
  state = win ? 'win' : 'over';
  sirenStop();
  (win ? sfx.win : sfx.over)();
  setTimeout(() => {
    if (win) showOverlay('You win!', 'Every pen collected.<br>Score: ' + score, 'Play Again');
    else showOverlay('Game over', 'You reached level ' + level + '<br>Score: ' + score + '<br>High score: ' + high, 'Play Again');
  }, win ? 700 : 1200);
}

/* ---------- Rendering ---------- */
const mazeCv = document.createElement('canvas');
mazeCv.width = COLS * T * K; mazeCv.height = ROWS * T * K;
(function buildMaze() {
  const g = mazeCv.getContext('2d');
  g.scale(K, K);
  g.fillStyle = '#04041a'; g.fillRect(0, 0, mazeCv.width, mazeCv.height);
  const wall = (c, r) => c < 0 || c >= COLS || (MAP[r] && MAP[r][c] === '#');
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const x = c * T, y = r * T;
    if (MAP[r][c] === '#') {
      g.fillStyle = '#0b1450'; g.fillRect(x, y, T, T);
      g.strokeStyle = '#3b5bff'; g.lineWidth = 2; g.shadowColor = '#3b5bff'; g.shadowBlur = 6;
      g.beginPath();
      if (!wall(c, r - 1)) { g.moveTo(x, y + 1); g.lineTo(x + T, y + 1); }
      if (!wall(c, r + 1)) { g.moveTo(x, y + T - 1); g.lineTo(x + T, y + T - 1); }
      if (!wall(c - 1, r)) { g.moveTo(x + 1, y); g.lineTo(x + 1, y + T); }
      if (!wall(c + 1, r)) { g.moveTo(x + T - 1, y); g.lineTo(x + T - 1, y + T); }
      g.stroke(); g.shadowBlur = 0;
    } else if (MAP[r][c] === '-') {
      g.fillStyle = '#ff9bd9'; g.fillRect(x, y + T / 2 - 2, T, 4);
    }
  }
})();

function face(image, x, y, r, ring, o = {}) {
  ctx.save();
  ctx.shadowColor = ring; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#222'; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  if (ok(image)) {
    const iw = image.naturalWidth, ih = image.naturalHeight, s = Math.min(iw, ih);
    ctx.drawImage(image, (iw - s) / 2, (ih - s) / 2, s, s, x - r, y - r, r * 2, r * 2);
  }
  if (o.tint) { ctx.fillStyle = o.tint; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  if (o.mouth !== undefined && o.mouth > 0.02) {
    ctx.fillStyle = '#04041a';
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.arc(x, y, r * 1.5, o.angle - o.mouth, o.angle + o.mouth);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function draw() {
  ctx.setTransform(K, 0, 0, K, 0, 0);
  ctx.clearRect(0, 0, COLS * T, ROWS * T);
  ctx.drawImage(mazeCv, 0, 0, COLS * T, ROWS * T);
  if (!food) return;

  // pens
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const v = food[r][c]; if (!v) continue;
    const x = (c + .5) * T, y = (r + .5) * T;
    const w = v === 2 ? 30 + 3 * Math.sin(clock * 6) : 15;
    ctx.save();
    if (v === 2) { ctx.shadowColor = '#ffd84a'; ctx.shadowBlur = 16; }
    if (v === 2 && ok(img.superpen)) {
      const h = 42 + 3 * Math.sin(clock * 6), sw = h * img.superpen.naturalWidth / img.superpen.naturalHeight;
      ctx.translate(x, y); ctx.rotate(0.6 + 0.25 * Math.sin(clock * 3));
      ctx.drawImage(img.superpen, -sw / 2, -h / 2, sw, h);
    } else if (ok(img.pen)) ctx.drawImage(img.pen, x - w / 2, y - w * 0.42, w, w * img.pen.naturalHeight / img.pen.naturalWidth);
    else { ctx.fillStyle = v === 2 ? '#ffd84a' : '#7fd6e8'; ctx.beginPath(); ctx.arc(x, y, v === 2 ? 8 : 3, 0, 7); ctx.fill(); }
    ctx.restore();
  }

  // ghosts
  if (state !== 'dying') for (const g of ghosts) {
    const p = pos(g), x = (p.x + .5) * T, y = (p.y + .5) * T;
    if (g.state === 'eaten') {
      ctx.save(); ctx.globalAlpha = .45; face(img[g.img], x, y, 9, '#ffffff'); ctx.restore();
    } else if (g.fright) {
      const flash = fright < 2 && Math.floor(clock * 6) % 2 === 0;
      face(img[g.img], x, y, 10, flash ? '#ffffff' : '#2a4bff', { tint: flash ? 'rgba(255,255,255,.45)' : 'rgba(30,60,255,.6)' });
    } else face(img[g.img], x, y, 10, g.color);
  }

  drawRemotes();

  // pacman (your chosen character)
  {
    const p = pos(pac), x = (p.x + .5) * T, y = (p.y + .5) * T;
    const angle = Math.atan2(pac.dy || 0, pac.dx || 1);
    if (state === 'dying') {
      const k = Math.max(0, timer / 1.3);
      ctx.save(); ctx.translate(x, y); ctx.rotate((1 - k) * 8); ctx.translate(-x, -y);
      face(img[CHARS[myChar].img], x, y, 11 * k, CHARS[myChar].color); ctx.restore();
    } else {
      const open = (pac.dx || pac.dy) ? Math.abs(Math.sin(pac.mouth)) * 0.6 : 0.05;
      face(img[CHARS[myChar].img], x, y, 11, CHARS[myChar].color, { mouth: open, angle });
      if (myName) tag(myName, x, y - 17, CHARS[myChar].color);
    }
  }

  // popups
  ctx.font = 'bold 14px "Courier New", monospace'; ctx.textAlign = 'center';
  for (const p of popups) {
    ctx.globalAlpha = 1 - p.t / 0.9;
    ctx.fillStyle = '#00ffff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    const y = p.y - p.t * 28;
    ctx.strokeText(p.text, p.x, y); ctx.fillText(p.text, p.x, y);
  }
  ctx.globalAlpha = 1;

  if (state === 'levelup') {
    ctx.font = 'bold 22px "Courier New", monospace'; ctx.fillStyle = '#00ffff'; ctx.textAlign = 'center';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
    ctx.strokeText('LEVEL ' + level + ' CLEAR!', COLS * T / 2, 12 * T + T * 0.8 + 2);
    ctx.fillText('LEVEL ' + level + ' CLEAR!', COLS * T / 2, 12 * T + T * 0.8 + 2);
  }
  if (state === 'ready') {
    ctx.font = 'bold 20px "Courier New", monospace'; ctx.fillStyle = '#ffd84a'; ctx.textAlign = 'center';
    ctx.fillText(level > 1 ? 'LEVEL ' + level + '  READY!' : 'READY!', COLS * T / 2, 12 * T + T * 0.8 + 2);
  }
}

/* ---------- Loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  stepRemotes(dt); update(dt); draw(); netTick(now);
  requestAnimationFrame(frame);
}
buildFood(); resetActors();
requestAnimationFrame(frame);

/* ---------- Multiplayer (Socket.io) ----------
   Every player runs their own copy of the maze; the others show up as live avatars.
   io() with no URL connects to whatever origin served the page, so it works on localhost and on Render.
   If the Socket.io script isn't available (e.g. index.html opened from disk) the game runs single-player. */
const socket = typeof io === 'function' ? io() : null;
const ROOM = (new URLSearchParams(location.search).get('room') || 'lobby').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'lobby';
const remotes = new Map();
let myChar = 'pacman', myName = '', inGame = false, uniqueMode = true, takenByOthers = [], selected = null, lastSent = 0, lastKey = '';
const $net = document.getElementById('net'), $select = document.getElementById('select'), $chars = document.getElementById('chars');
const $join = document.getElementById('join'), $selMsg = document.getElementById('sel-msg'), $selSub = document.getElementById('sel-sub');

function setNet() {
  if (!socket) $net.textContent = 'Offline (single-player)';
  else if (!socket.connected) $net.textContent = 'Connecting…';
  else $net.textContent = '● ' + ROOM + ' · ' + (inGame && myName ? myName + ' · ' : '') + (remotes.size + (inGame ? 1 : 0)) + ' playing';
}
function addRemote(p) { remotes.set(p.id, { id: p.id, name: p.name, character: p.character, x: p.x, y: p.y, tx: p.x, ty: p.y, dir: p.dir }); setNet(); }

// --- character cards (built once, refreshed in place so keyboard focus survives)
const cards = {};
Object.entries(CHARS).forEach(([id, c]) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'char'; b.setAttribute('role', 'radio');
  b.style.setProperty('--ring', c.color);
  b.innerHTML = '<img alt="" src="' + c.img + '.png"><span>' + c.label + '</span><em hidden>Taken</em>';
  b.addEventListener('click', () => { selected = id; $selMsg.textContent = ''; refreshChars(); });
  $chars.appendChild(b); cards[id] = b;
});
function refreshChars() {
  if (selected && uniqueMode && takenByOthers.includes(selected)) { selected = null; $selMsg.textContent = 'That character was just taken - pick another.'; }
  Object.entries(cards).forEach(([id, b]) => {
    const taken = uniqueMode && takenByOthers.includes(id);
    b.disabled = taken; b.classList.toggle('taken', taken);
    b.querySelector('em').hidden = !taken;
    b.setAttribute('aria-checked', String(selected === id));
  });
  $join.disabled = !selected;
}
if (!socket) $selSub.textContent = 'Choose your character (offline mode)';
refreshChars(); setNet();

function enterGame() { inGame = true; $select.classList.add('hidden'); setNet(); newGame(); }
$join.addEventListener('click', () => {
  if (!selected) return;
  initAudio();
  if (!socket || !socket.connected) { myChar = selected; enterGame(); return; }   // offline: play now, register if we connect later
  socket.emit('join', { character: selected, room: ROOM }, res => {
    if (!res || !res.ok) {
      $selMsg.textContent = (res && res.error) || 'Could not join.';
      if (res && res.taken) { takenByOthers = res.taken; refreshChars(); }
      return;
    }
    myChar = selected; myName = res.you.name; uniqueMode = res.unique;
    remotes.clear(); res.players.forEach(addRemote);
    enterGame();
  });
});

if (socket) {
  const rejoin = (retry) => socket.emit('join', { character: myChar, room: ROOM }, res => {
    if (res && res.ok) { myName = res.you.name; remotes.clear(); res.players.forEach(addRemote); }
    else if (res && res.taken && retry) { myChar = Object.keys(CHARS).find(c => !res.taken.includes(c)) || myChar; rejoin(false); }
    setNet();
  });
  socket.on('connect', () => {
    socket.emit('lobby:enter', { room: ROOM });
    if (inGame) rejoin(true);          // reconnect after a drop or a server restart
    setNet();
  });
  socket.on('disconnect', () => { remotes.clear(); setNet(); });
  socket.on('lobby:state', s => {
    uniqueMode = s.unique;
    takenByOthers = s.taken.filter(c => !(inGame && c === myChar));
    refreshChars();
  });
  socket.on('player:joined', addRemote);
  socket.on('player:changed', addRemote);
  socket.on('player:moved', m => {
    const r = remotes.get(m.id); if (!r) return;
    r.tx = m.x; r.ty = m.y; r.dir = m.dir;
  });
  socket.on('player:left', m => { remotes.delete(m.id); setNet(); });
}

// send our position ~20x/s (plus a 1s heartbeat when standing still)
function netTick(now) {
  if (!socket || !socket.connected || !inGame || !myName) return;
  if (now - lastSent < 50) return;
  const p = pos(pac);
  const dir = pac.dx ? (pac.dx > 0 ? 'right' : 'left') : pac.dy ? (pac.dy > 0 ? 'down' : 'up') : 'none';
  const x = +p.x.toFixed(2), y = +p.y.toFixed(2), key = x + ',' + y + dir;
  if (key === lastKey && now - lastSent < 1000) return;
  lastKey = key; lastSent = now;
  socket.volatile.emit('move', { x, y, dir });
}
function stepRemotes(dt) {
  const k = 1 - Math.exp(-dt * 18);
  remotes.forEach(r => {
    if (Math.abs(r.tx - r.x) > COLS / 2 || Math.abs(r.ty - r.y) > 4) { r.x = r.tx; r.y = r.ty; }   // tunnel wrap / respawn: snap
    else { r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; }
  });
}
function tag(text, x, y, color) {
  ctx.save();
  ctx.font = 'bold 9px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 9;
  ctx.fillStyle = 'rgba(4,4,20,.88)'; ctx.strokeStyle = color; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.rect(x - w / 2, y - 6, w, 12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}
function drawRemotes() {
  remotes.forEach(r => {
    const c = CHARS[r.character]; if (!c) return;
    const x = (r.x + .5) * T, y = (r.y + .5) * T;
    const moving = r.dir !== 'none';
    const angle = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[r.dir] || 0;
    face(img[c.img], x, y, 11, c.color, r.character === 'pacman' ? { mouth: moving ? Math.abs(Math.sin(clock * 14)) * 0.6 : 0.05, angle } : {});
    tag(r.name, x, y - 17, c.color);
  });
}

/* ---------- Input ---------- */
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', a: 'left', s: 'down', d: 'right', W: 'up', A: 'left', S: 'down', D: 'right' };
window.addEventListener('keydown', e => {
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  const k = KEYS[e.key];
  if (!k) return;
  e.preventDefault();
  if (state === 'play' || state === 'ready') setDir(DIR_NAMES[k]);
});
document.querySelectorAll('.dpad button').forEach(b => {
  b.addEventListener('pointerdown', e => { e.preventDefault(); initAudio(); setDir(DIR_NAMES[b.dataset.dir]); });
});
let sx = 0, sy = 0, tracking = false;
document.addEventListener('touchstart', e => {
  if (e.target.closest('button')) { tracking = false; return; }
  sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!tracking) return;
  e.preventDefault();
  const t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
  setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIR_NAMES.right : DIR_NAMES.left) : (dy > 0 ? DIR_NAMES.down : DIR_NAMES.up));
  sx = t.clientX; sy = t.clientY;   // re-anchor so you can chain swipes without lifting
}, { passive: false });
document.addEventListener('contextmenu', e => e.preventDefault());
})();
