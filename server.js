// ============================================================
//  8 BITS KONG - servidor online para la partida del aula
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const TEACHER_KEY = process.env.TEACHER_KEY || 'profesor-local';
const TICK_MS = 1000 / 30;
const WORLD_W = 480;
const WORLD_H = 320;
const MAX_LIVES = 5;
const COUNTDOWN_MS = 3000;
const INTERMISSION_MS = 1800;
const END_SCREEN_MS = 9000;
const NAME_MAX = 12;

const CHARACTERS = [
  'Mario', 'Luigi', 'Peach', 'Daisy', 'Yoshi', 'Toad', 'Toadette',
  'Bowser', 'Bowser Jr.', 'Donkey Kong', 'Wario', 'Waluigi', 'Rosalina', 'Pauline', 'Birdo',
];
const SUIT_COLORS = [
  { name: 'Rojo', hex: '#ff004d' },
  { name: 'Azul', hex: '#29adff' },
  { name: 'Verde', hex: '#00e436' },
  { name: 'Amarillo', hex: '#ffec27' },
  { name: 'Morado', hex: '#83769c' },
];

// Suelos de cinco alturas y una escalera distinta entre cada pareja de niveles.
// El extremo superior queda cerca de la meta, como en un juego arcade de plataformas.
const LEVELS = [
  { name: 'El puente', ladders: [365, 100, 350, 120], barrelMs: 3100, barrelSpeed: 1.05 },
  { name: 'La fundición', ladders: [95, 370, 115, 365], barrelMs: 2700, barrelSpeed: 1.25 },
  { name: 'Las vigas', ladders: [345, 115, 370, 95], barrelMs: 2400, barrelSpeed: 1.42 },
  { name: 'La torre', ladders: [110, 350, 100, 360], barrelMs: 2150, barrelSpeed: 1.58 },
  { name: 'El rescate final', ladders: [360, 95, 350, 110], barrelMs: 1950, barrelSpeed: 1.75 },
].map((level, i) => ({
  ...level,
  number: i + 1,
  floors: [288, 238, 188, 138, 88],
  goalX: 425,
}));

const VIRTUAL_IF = /vmware|virtualbox|vbox|vethernet|hyper-v|wsl|docker|loopback|tailscale|zerotier/i;
let mainIP = null;
function detectMainIP() {
  const sock = dgram.createSocket('udp4');
  sock.on('error', () => sock.close());
  sock.connect(53, '8.8.8.8', () => {
    try { mainIP = sock.address().address; } catch {}
    sock.close();
  });
}
function lanIPs() {
  const ips = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_IF.test(name)) continue;
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }
  return mainIP && ips.includes(mainIP) ? [mainIP] : ips;
}

const players = new Map();
let hazards = [];
let events = [];
let phase = 'lobby'; // lobby | countdown | playing | intermission | ended
let phaseStart = Date.now();
let levelIndex = 0;
let nextId = 1;
let nextBarrelAt = 0;
let endMessage = '';

function setPhase(next) { phase = next; phaseStart = Date.now(); }
function currentLevel() { return LEVELS[levelIndex]; }
function cleanName(raw) {
  let name = String(raw || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX) || 'Jugador';
  const taken = new Set([...players.values()].filter(p => p.joined).map(p => p.name.toLowerCase()));
  const base = name;
  let suffix = 2;
  while (taken.has(name.toLowerCase())) name = `${base.slice(0, NAME_MAX - 2)}${suffix++}`;
  return name;
}
function selectedCharacter(raw) { return CHARACTERS.includes(raw) ? raw : CHARACTERS[0]; }
function selectedColor(raw) { return SUIT_COLORS.find(c => c.hex === raw) || SUIT_COLORS[0]; }

function resetPlayerForLevel(p) {
  p.x = 34;
  p.y = currentLevel().floors[0];
  p.vy = 0;
  p.onGround = true;
  p.climbing = false;
  p.reachedGoal = false;
  p.hammerUntil = 0;
  p.hammerReadyAt = 0;
  p.invulnerableUntil = 0;
  p.input = { u: false, d: false, l: false, r: false };
}

function beginLevel() {
  hazards = [];
  nextBarrelAt = Date.now() + 1200;
  for (const p of players.values()) if (p.joined && p.alive) resetPlayerForLevel(p);
  setPhase('countdown');
}

function startGame() {
  const joined = [...players.values()].filter(p => p.joined);
  if (!joined.length || phase !== 'lobby') return;
  levelIndex = 0;
  endMessage = '';
  for (const p of joined) {
    p.lives = MAX_LIVES;
    p.alive = true;
    p.inGame = true;
    p.k = 0;
    resetPlayerForLevel(p);
  }
  beginLevel();
}

function backToLobby() {
  hazards = [];
  for (const p of players.values()) {
    p.inGame = false;
    p.alive = false;
    p.reachedGoal = false;
  }
  setPhase('lobby');
}

function playerHit(p, reason) {
  const now = Date.now();
  if (!p.alive || now < p.invulnerableUntil) return;
  p.lives = Math.max(0, p.lives - 1);
  p.invulnerableUntil = now + 1300;
  p.k++;
  events.push({ k: 'hit', id: p.id, reason });
  if (p.lives === 0) {
    p.alive = false;
    events.push({ k: 'out', id: p.id, n: p.name });
  } else {
    resetPlayerForLevel(p);
    p.invulnerableUntil = now + 1300;
  }
}

function spawnBarrel(now) {
  const level = currentLevel();
  hazards.push({
    id: `${levelIndex}-${now}-${Math.random()}`,
    x: 455,
    y: level.floors[level.floors.length - 1],
    floor: level.floors.length - 1,
    dir: -1,
    speed: level.barrelSpeed + Math.random() * 0.3,
  });
  nextBarrelAt = now + level.barrelMs;
  events.push({ k: 'barrel' });
}

function findLadder(level, p) {
  for (let i = 0; i < level.ladders.length; i++) {
    const top = level.floors[i + 1];
    const bottom = level.floors[i];
    const x = level.ladders[i];
    if (Math.abs(p.x - x) < 13 && p.y >= top - 5 && p.y <= bottom + 5) return { x, top, bottom };
  }
  return null;
}

function updatePlayer(p, level) {
  if (!p.alive || p.reachedGoal) return;
  const oldY = p.y;
  const ladder = findLadder(level, p);
  if (ladder && (p.input.u || p.input.d)) {
    p.climbing = true;
    p.onGround = false;
    p.x = ladder.x;
    p.vy = 0;
    p.y += (p.input.d ? 1 : -1) * 1.75;
    if (p.y <= ladder.top) { p.y = ladder.top; p.climbing = false; p.onGround = true; }
    if (p.y >= ladder.bottom) { p.y = ladder.bottom; p.climbing = false; p.onGround = true; }
  } else {
    p.climbing = false;
    const move = (p.input.r ? 1 : 0) - (p.input.l ? 1 : 0);
    p.x = Math.max(20, Math.min(WORLD_W - 20, p.x + move * 2.25));
    p.vy = Math.min(6, p.vy + 0.28);
    p.y += p.vy;
    p.onGround = false;
    if (p.vy >= 0) {
      for (const floorY of level.floors) {
        if (oldY <= floorY && p.y >= floorY) {
          p.y = floorY;
          p.vy = 0;
          p.onGround = true;
          break;
        }
      }
    } else p.onGround = false;
  }
  if (p.y > WORLD_H + 16) playerHit(p, 'caída');
  const topFloor = level.floors[level.floors.length - 1];
  if (p.onGround && Math.abs(p.y - topFloor) < 1 && p.x >= level.goalX - 20) {
    p.reachedGoal = true;
    events.push({ k: 'goal', id: p.id, n: p.name });
  }
}

function useHammer(p) {
  const now = Date.now();
  if (phase !== 'playing' || !p.alive || now < p.hammerReadyAt) return;
  p.hammerUntil = now + 950;
  p.hammerReadyAt = now + 6500;
  events.push({ k: 'hammer', id: p.id });
}

function update() {
  const now = Date.now();
  if (phase === 'countdown' && now - phaseStart >= COUNTDOWN_MS) setPhase('playing');
  if (phase === 'intermission' && now - phaseStart >= INTERMISSION_MS) {
    if (levelIndex >= LEVELS.length - 1) {
      endMessage = '¡RESCATE COMPLETADO!';
      setPhase('ended');
      events.push({ k: 'win' });
    } else {
      levelIndex++;
      events.push({ k: 'level', n: levelIndex + 1 });
      beginLevel();
    }
  }
  if (phase === 'ended' && now - phaseStart >= END_SCREEN_MS) backToLobby();
  if (phase !== 'playing') return;

  const level = currentLevel();
  const active = [...players.values()].filter(p => p.joined && p.inGame && p.alive);
  for (const p of active) updatePlayer(p, level);

  if (now >= nextBarrelAt) spawnBarrel(now);
  for (const b of hazards) {
    b.x += b.dir * b.speed;
    if (b.x < 18 || b.x > WORLD_W - 18) {
      if (b.floor > 0) {
        b.floor--;
        b.y = level.floors[b.floor];
        b.dir *= -1;
      } else b.remove = true;
    }
    for (const p of active) {
      if (now < p.invulnerableUntil || p.reachedGoal) continue;
      if (now < p.hammerUntil && Math.abs(p.x - b.x) < 27 && Math.abs(p.y - b.y) < 20) {
        b.remove = true;
        p.k++;
        events.push({ k: 'smash', id: p.id });
        break;
      }
      if (Math.abs(p.x - b.x) < 13 && Math.abs((p.y - 9) - b.y) < 14) {
        playerHit(p, 'barril');
      }
    }
  }
  hazards = hazards.filter(b => !b.remove);

  const alive = [...players.values()].filter(p => p.joined && p.inGame && p.alive);
  if (!alive.length) {
    endMessage = '¡FIN DE LA PARTIDA!';
    setPhase('ended');
    events.push({ k: 'lose' });
  } else if (alive.every(p => p.reachedGoal)) {
    if (levelIndex === LEVELS.length - 1) {
      endMessage = '¡RESCATE COMPLETADO!';
      setPhase('ended');
      events.push({ k: 'win' });
    } else setPhase('intermission');
  }
}

function snapshot() {
  const now = Date.now();
  const level = currentLevel();
  return JSON.stringify({
    t: 's', ph: phase,
    cd: phase === 'countdown' ? Math.max(0, Math.ceil((COUNTDOWN_MS - (now - phaseStart)) / 1000)) : 0,
    level: levelIndex + 1, levelName: level.name, levelData: level,
    intermission: phase === 'intermission' ? Math.max(0, INTERMISSION_MS - (now - phaseStart)) : 0,
    end: endMessage,
    p: [...players.values()].filter(p => p.joined).map(p => ({
      id: p.id, n: p.name, ch: p.character, c: p.color,
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
      lives: p.lives, al: p.alive, ig: p.inGame, goal: p.reachedGoal,
      cl: p.climbing, hm: now < p.hammerUntil, hcd: Math.max(0, p.hammerReadyAt - now), k: p.k,
      inv: now < p.invulnerableUntil,
    })),
    b: hazards.map(b => ({ x: Math.round(b.x), y: b.y, floor: b.floor })),
    e: events,
  });
}

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/client.js': ['client.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const server = http.createServer((req, res) => {
  const file = STATIC[(req.url || '/').split('?')[0]];
  if (!file) { res.writeHead(404); return res.end('No encontrado'); }
  fs.readFile(path.join(__dirname, 'public', file[0]), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Error'); }
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 1024 });

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress || '';
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);
  const isPlayer = requestUrl.searchParams.get('player') === '1';
  const isHost = !isPlayer && (isLocal || requestUrl.searchParams.get('teacher') === TEACHER_KEY);
  const p = {
    id: nextId++, ws, name: '', character: CHARACTERS[0], color: SUIT_COLORS[0].hex,
    joined: false, isHost, x: 34, y: 288, vy: 0, onGround: true, climbing: false,
    lives: 0, alive: false, inGame: false, reachedGoal: false, hammerUntil: 0,
    hammerReadyAt: 0, invulnerableUntil: 0, k: 0,
    input: { u: false, d: false, l: false, r: false },
  };
  players.set(p.id, p);
  ws.send(JSON.stringify({
    t: 'welcome', id: p.id, isHost, ips: lanIPs(), port: PORT,
    characters: CHARACTERS, colors: SUIT_COLORS, maxLives: MAX_LIVES,
  }));

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'join':
        if (p.joined) return;
        p.name = cleanName(m.name);
        p.character = selectedCharacter(m.character);
        p.color = selectedColor(m.color).hex;
        p.joined = true;
        ws.send(JSON.stringify({ t: 'joined', name: p.name }));
        console.log(`  + ${p.name} (${p.character}) se ha unido (${addr.replace('::ffff:', '')})`);
        break;
      case 'in':
        p.input = { u: !!m.u, d: !!m.d, l: !!m.l, r: !!m.r };
        break;
      case 'jump':
        if (phase === 'playing' && p.alive && p.inGame && (p.onGround || p.climbing)) {
          p.vy = -5.7;
          p.onGround = false;
          p.climbing = false;
        }
        break;
      case 'hammer': useHammer(p); break;
      case 'start': if (p.isHost) startGame(); break;
      case 'stop': if (p.isHost && phase !== 'lobby') backToLobby(); break;
    }
  });
  ws.on('close', () => {
    if (p.joined) console.log(`  - ${p.name} se ha desconectado`);
    players.delete(p.id);
  });
});

setInterval(() => {
  update();
  const msg = snapshot();
  events = [];
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(msg);
}, TICK_MS);

detectMainIP();
setInterval(detectMainIP, 30000);
server.listen(PORT, '0.0.0.0', async () => {
  await new Promise(resolve => setTimeout(resolve, 300));
  console.log('\n  ==========================================');
  console.log('        8 BITS KONG - servidor listo');
  console.log('  ==========================================\n');
  console.log(`  PROFESOR: http://localhost:${PORT}\n`);
  console.log('  JUGADORES:');
  const ips = lanIPs();
  if (ips.length) ips.forEach(ip => console.log(`     http://${ip}:${PORT}/?player=1`));
  else console.log('     (no se ha encontrado ninguna IP de red)');
  console.log('\n  Pulsa Ctrl+C para cerrar el servidor.\n');
});
