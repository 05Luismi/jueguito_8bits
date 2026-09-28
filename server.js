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
const MAX_BARRELS = 6;
const MAX_FIREBALLS = 3;
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
  { name: 'El puente', ladders: [365, 100, 350, 120], slopes: [0.04, -0.04, 0.04, -0.04, 0.04], barrelMs: 3100, barrelSpeed: 1.05, theme: { bg: '#080b1b', beam: '#ff004d', trim: '#ff77a8', ladder: '#29adff' } },
  { name: 'La fundición', ladders: [95, 370, 115, 365], slopes: [-0.045, 0.045, -0.045, 0.045, -0.045], barrelMs: 2700, barrelSpeed: 1.25, theme: { bg: '#1a100c', beam: '#ffa300', trim: '#ffccaa', ladder: '#ffec27' } },
  { name: 'Las vigas', ladders: [345, 115, 370, 95], slopes: [0.05, -0.05, 0.05, -0.05, 0.05], barrelMs: 2400, barrelSpeed: 1.42, theme: { bg: '#100d24', beam: '#c56cf0', trim: '#ff77a8', ladder: '#29adff' } },
  { name: 'La torre', ladders: [110, 350, 100, 360], slopes: [-0.055, 0.055, -0.055, 0.055, -0.055], barrelMs: 2150, barrelSpeed: 1.58, theme: { bg: '#081a12', beam: '#00a844', trim: '#00e436', ladder: '#ffec27' } },
  { name: 'El rescate final', ladders: [360, 95, 350, 110], slopes: [0.06, -0.06, 0.06, -0.06, 0.06], barrelMs: 1950, barrelSpeed: 1.75, theme: { bg: '#120914', beam: '#ff004d', trim: '#ffec27', ladder: '#00e436' } },
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
let nextFireballAt = 0;
let kongThrowUntil = 0;
let kongHealth = 3;
let kongHitUntil = 0;
let endMessage = '';

function setPhase(next) { phase = next; phaseStart = Date.now(); }
function currentLevel() { return LEVELS[levelIndex]; }
function floorYAt(level, floorIndex, x) {
  return level.floors[floorIndex] + (level.slopes[floorIndex] || 0) * (x - WORLD_W / 2);
}
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
  p.floor = 0;
  p.y = floorYAt(currentLevel(), p.floor, p.x);
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
  kongHealth = 3;
  kongHitUntil = 0;
  nextBarrelAt = Date.now() + 1500;
  nextFireballAt = Date.now() + 5000;
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
  if (hazards.filter(h => h.kind === 'barrel' || h.kind === 'firebarrel').length >= MAX_BARRELS) {
    // No guardamos una cola de lanzamientos: dejamos respirar la partida.
    nextBarrelAt = now + level.barrelMs;
    return;
  }
  const kind = levelIndex > 0 && Math.random() < 0.32 ? 'firebarrel' : 'barrel';
  hazards.push({
    id: `${levelIndex}-${now}-${Math.random()}`,
    kind,
    // Donkey Kong lanza los barriles desde la izquierda, en la viga superior.
    x: 67,
    y: floorYAt(level, level.floors.length - 1, 67),
    floor: level.floors.length - 1,
    dir: 1,
    speed: level.barrelSpeed * 1.18 + Math.random() * 0.3 + (kind === 'firebarrel' ? 0.45 : 0),
  });
  kongThrowUntil = now + 420;
  nextBarrelAt = now + level.barrelMs;
  events.push({ k: kind });
}

function spawnFireball(now) {
  const level = currentLevel();
  const cooldown = Math.max(4300, 8000 - levelIndex * 700);
  if (hazards.filter(h => h.kind === 'fireball').length >= MAX_FIREBALLS) {
    nextFireballAt = now + cooldown;
    return;
  }
  const floor = 1 + Math.floor(Math.random() * (level.floors.length - 1));
  const dir = Math.random() < 0.5 ? -1 : 1;
  hazards.push({
    id: `fire-${levelIndex}-${now}-${Math.random()}`,
    kind: 'fireball',
    x: dir < 0 ? WORLD_W - 22 : 22,
    y: floorYAt(level, floor, dir < 0 ? WORLD_W - 22 : 22),
    floor,
    dir,
    speed: 1.15 + levelIndex * 0.18 + Math.random() * 0.35,
    phase: Math.random() * Math.PI * 2,
  });
  nextFireballAt = now + cooldown;
  events.push({ k: 'fireball' });
}

function findLadder(level, p) {
  for (let i = 0; i < level.ladders.length; i++) {
    const x = level.ladders[i];
    const top = floorYAt(level, i + 1, x);
    const bottom = floorYAt(level, i, x);
    if (Math.abs(p.x - x) < 13 && p.y >= top - 5 && p.y <= bottom + 5) {
      return { x, top, bottom, topFloor: i + 1, bottomFloor: i };
    }
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
    if (p.y <= ladder.top) {
      p.y = ladder.top; p.floor = ladder.topFloor; p.climbing = false; p.onGround = true;
    }
    if (p.y >= ladder.bottom) {
      p.y = ladder.bottom; p.floor = ladder.bottomFloor; p.climbing = false; p.onGround = true;
    }
  } else {
    p.climbing = false;
    const move = (p.input.r ? 1 : 0) - (p.input.l ? 1 : 0);
    p.x = Math.max(20, Math.min(WORLD_W - 20, p.x + move * 2.25));
    if (p.onGround && p.vy === 0) {
      p.y = floorYAt(level, p.floor, p.x);
    } else {
      p.vy = Math.min(6, p.vy + 0.28);
      const nextY = p.y + p.vy;
      p.onGround = false;
      if (p.vy >= 0) {
        for (let i = level.floors.length - 1; i >= 0; i--) {
          const surface = floorYAt(level, i, p.x);
          if (oldY <= surface && nextY >= surface) {
            p.y = surface;
            p.floor = i;
            p.vy = 0;
            p.onGround = true;
            break;
          }
        }
      }
      if (!p.onGround) p.y = nextY;
    }
  }
  if (p.y > WORLD_H + 16) playerHit(p, 'caída');
  if (p.onGround && p.floor === level.floors.length - 1 && p.x >= level.goalX - 20) {
    if (levelIndex < LEVELS.length - 1) {
      p.reachedGoal = true;
      events.push({ k: 'goal', id: p.id, n: p.name });
    }
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
  if (now >= nextFireballAt) spawnFireball(now);
  for (const b of hazards) {
    if (b.kind === 'fireball') {
      b.x += b.dir * b.speed;
      if (b.x < 18 || b.x > WORLD_W - 18) b.dir *= -1;
      b.y = floorYAt(level, b.floor, b.x) - 7 - Math.abs(Math.sin(now / 175 + b.phase)) * 7;
    } else {
      if (b.falling) {
        b.y = Math.min(b.dropTarget, b.y + 2.8);
        if (b.y >= b.dropTarget) {
          b.falling = false;
          b.dir = b.nextDir;
          b.nextDir = undefined;
        }
      } else {
        const previousX = b.x;
        b.x += b.dir * b.speed;
        const ladderX = b.floor > 0 ? level.ladders[b.floor - 1] : undefined;
        const crossedLadder = ladderX !== undefined && (b.dir > 0
          ? previousX < ladderX && b.x >= ladderX
          : previousX > ladderX && b.x <= ladderX);
        if (crossedLadder && Math.random() < 0.3) {
          b.x = ladderX;
          b.floor--;
          b.falling = true;
          b.nextDir = b.dir;
          b.dropTarget = floorYAt(level, b.floor, b.x);
        } else if (b.x < 18 || b.x > WORLD_W - 18) {
          if (b.floor > 0) {
            b.x = Math.max(18, Math.min(WORLD_W - 18, b.x));
            b.floor--;
            b.falling = true;
            b.nextDir = -b.dir;
            b.dropTarget = floorYAt(level, b.floor, b.x);
          } else b.remove = true;
        } else {
          b.y = floorYAt(level, b.floor, b.x);
        }
      }
    }
    for (const p of active) {
      if (now < p.invulnerableUntil || p.reachedGoal) continue;
      if (now < p.hammerUntil && Math.abs(p.x - b.x) < 27 && Math.abs(p.y - b.y) < 20) {
        b.remove = true;
        p.k++;
        events.push({ k: 'smash', id: p.id });
        break;
      }
      const radius = b.kind === 'fireball' ? 11 : 13;
      if (Math.abs(p.x - b.x) < radius && Math.abs((p.y - 9) - b.y) < radius) {
        playerHit(p, b.kind === 'fireball' ? 'bola de fuego' : b.kind === 'firebarrel' ? 'barril de fuego' : 'barril');
      }
    }
  }
  hazards = hazards.filter(b => !b.remove);

  if (levelIndex === LEVELS.length - 1 && kongHealth > 0 && now >= kongHitUntil) {
    const topFloor = level.floors.length - 1;
    const kongFloorY = floorYAt(level, topFloor, 52);
    const attacker = active.find(p => now < p.hammerUntil && p.floor === topFloor &&
      Math.abs(p.x - 52) < 28 && Math.abs(p.y - kongFloorY) < 12);
    if (attacker) {
      kongHealth--;
      kongHitUntil = now + 1100;
      events.push({ k: 'bossHit', id: attacker.id, hp: kongHealth });
      if (kongHealth === 0) {
        endMessage = '¡DONKEY KONG DERROTADO! PAULINE ES LIBRE';
        setPhase('ended');
        events.push({ k: 'win' });
      }
    }
  }
  if (phase !== 'playing') return;

  const alive = [...players.values()].filter(p => p.joined && p.inGame && p.alive);
  if (!alive.length) {
    endMessage = '¡FIN DE LA PARTIDA!';
    setPhase('ended');
    events.push({ k: 'lose' });
  } else if (levelIndex < LEVELS.length - 1 && alive.every(p => p.reachedGoal)) {
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
    boss: levelIndex === LEVELS.length - 1 ? kongHealth : 0,
    bossHit: now < kongHitUntil,
    p: [...players.values()].filter(p => p.joined).map(p => ({
      id: p.id, n: p.name, ch: p.character, c: p.color,
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
      lives: p.lives, al: p.alive, ig: p.inGame, goal: p.reachedGoal,
      cl: p.climbing, hm: now < p.hammerUntil, hcd: Math.max(0, p.hammerReadyAt - now), k: p.k,
      inv: now < p.invulnerableUntil,
    })),
    b: hazards.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), floor: b.floor, kind: b.kind, d: b.dir })),
    kt: now < kongThrowUntil,
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
  const isHost = !isPlayer && (
    isLocal ||
    requestUrl.searchParams.get('teacher') === TEACHER_KEY ||
    requestUrl.searchParams.get('role') === 'teacher'
  );
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
          p.vy = -3.7;
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
