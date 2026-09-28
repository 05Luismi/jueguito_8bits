// ============================================================
//  8 BITS KONG - cliente canvas de jugadores y profesor
// ============================================================
const $ = selector => document.querySelector(selector);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const SCALE = 2;
const W = canvas.width / SCALE;
const H = canvas.height / SCALE;
const FONT = '"Press Start 2P", "Courier New", monospace';
const PUBLIC_PLAYER_URL = 'https://jueguito-8bits.vercel.app/?player=1';
const GAME_SERVER_ORIGIN = 'https://jueguito-8bits.onrender.com';

let ws;
let myId = null;
let isHost = false;
let joined = false;
let characters = [];
let suitColors = [];
let prev = null;
let curr = null;
let lastListKey = '';
let inputDirty = false;
let muted = false;
let actx = null;

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function connect() {
  const pageUrl = new URL(location.href);
  const isVercelPage = location.hostname.endsWith('.vercel.app');
  const url = isVercelPage ? new URL(GAME_SERVER_ORIGIN) : new URL(location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (pageUrl.searchParams.get('player') === '1') url.searchParams.set('player', '1');
  else if (pageUrl.searchParams.has('teacher')) url.searchParams.set('teacher', pageUrl.searchParams.get('teacher'));
  else if (isVercelPage) url.searchParams.set('role', 'teacher');
  ws = new WebSocket(url);
  ws.onopen = () => { $('#offline').hidden = true; };
  ws.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.t === 'welcome') onWelcome(message);
    else if (message.t === 'joined') onJoined(message);
    else if (message.t === 's') onState(message);
  };
  ws.onclose = () => {
    $('#offline').hidden = false;
    joined = false;
    setTimeout(connect, 2000);
  };
}

function fillSelect(select, options, selected) {
  select.replaceChildren();
  for (const option of options) {
    const element = document.createElement('option');
    if (typeof option === 'string') {
      element.value = option;
      element.textContent = option;
    } else {
      element.value = option.hex;
      element.textContent = option.name;
    }
    if (element.value === selected) element.selected = true;
    select.appendChild(element);
  }
}

function onWelcome(message) {
  myId = message.id;
  isHost = message.isHost;
  characters = message.characters;
  suitColors = message.colors;
  fillSelect($('#characterSelect'), characters, characters[0]);
  fillSelect($('#hostCharacter'), characters, characters[0]);
  fillSelect($('#colorSelect'), suitColors, suitColors[0].hex);
  fillSelect($('#hostColor'), suitColors, suitColors[0].hex);

  const addressList = $('#addrList');
  addressList.replaceChildren();
  const localHosts = ['localhost', '127.0.0.1', '::1'];
  const isPublicPage = location.protocol === 'https:';
  const urls = isPublicPage
    ? [PUBLIC_PLAYER_URL]
    : (localHosts.includes(location.hostname) ? (message.ips.length ? message.ips : [location.hostname]) : [location.hostname])
      .map(ip => `http://${ip}:${message.port}/?player=1`);
  for (const url of urls) {
    const link = document.createElement('a');
    link.href = url;
    link.textContent = url;
    link.target = '_blank';
    link.rel = 'noopener';
    addressList.appendChild(link);
  }

  $('#hostPanel').hidden = !isHost;
  if (isHost) showScreen('game');
  else {
    showScreen('join');
    let savedName = '';
    let savedCharacter = characters[0];
    let savedColor = suitColors[0].hex;
    try {
      savedName = localStorage.getItem('8bits-name') || '';
      savedCharacter = localStorage.getItem('8bits-character') || savedCharacter;
      savedColor = localStorage.getItem('8bits-suit') || savedColor;
    } catch {}
    $('#nameInput').value = savedName;
    if (characters.includes(savedCharacter)) $('#characterSelect').value = savedCharacter;
    if (suitColors.some(color => color.hex === savedColor)) $('#colorSelect').value = savedColor;
    $('#nameInput').focus();
    try {
      if (savedName && sessionStorage.getItem('8bits-auto')) {
        send({ t: 'join', name: savedName, character: $('#characterSelect').value, color: $('#colorSelect').value });
      }
    } catch {}
  }
}

function join(name, character, color) {
  send({ t: 'join', name, character, color });
}

function onJoined(message) {
  joined = true;
  try {
    localStorage.setItem('8bits-name', message.name);
    localStorage.setItem('8bits-character', $('#characterSelect').value);
    localStorage.setItem('8bits-suit', $('#colorSelect').value);
    sessionStorage.setItem('8bits-auto', '1');
  } catch {}
  $('#hostJoinForm').hidden = true;
  showScreen('game');
}

function showScreen(id) {
  $('#join').hidden = id !== 'join';
  $('#game').hidden = id !== 'game';
}

$('#joinForm').addEventListener('submit', event => {
  event.preventDefault();
  join($('#nameInput').value.trim().toUpperCase(), $('#characterSelect').value, $('#colorSelect').value);
});
$('#hostJoinForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#hostName').value.trim();
  if (name) join(name.toUpperCase(), $('#hostCharacter').value, $('#hostColor').value);
});
$('#btnStart').addEventListener('click', () => send({ t: 'start' }));
$('#btnStop').addEventListener('click', () => send({ t: 'stop' }));

function initAudio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  }
  if (actx.state === 'suspended') actx.resume();
}
function beep(freq, duration = 0.08, type = 'square') {
  if (!actx || muted) return;
  const oscillator = actx.createOscillator();
  const gain = actx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = freq;
  gain.gain.setValueAtTime(0.045, actx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + duration);
  oscillator.connect(gain).connect(actx.destination);
  oscillator.start();
  oscillator.stop(actx.currentTime + duration);
}

function onState(state) {
  const oldPhase = curr && curr.ph;
  prev = curr;
  curr = state;
  for (const event of state.e) handleEvent(event);
  updateHud();
  updateSide();
  if (state.ph === 'countdown' && oldPhase !== 'countdown') beep(520);
  if (state.ph === 'ended' && oldPhase !== 'ended') {
    const victory = /COMPLETADO|DERROTADO|LIBRE/.test(state.end);
    beep(victory ? 880 : 180, 0.24);
  }
}

function handleEvent(event) {
  if (event.k === 'hit') beep(event.id === myId ? 150 : 240, 0.12, 'sawtooth');
  if (event.k === 'hammer' || event.k === 'smash') beep(330, 0.1);
  if (event.k === 'bossHit') {
    beep(175 + (3 - event.hp) * 90, 0.18, 'square');
    if (event.id === myId) addFeed(`¡Golpe al jefe! ${event.hp} impactos restantes`);
  }
  if (event.k === 'hammerPickup') {
    beep(620, 0.12, 'square');
    if (event.id === myId) addFeed('¡Mazo recargado!');
  }
  if (event.k === 'fireball' || event.k === 'firebarrel') beep(125, 0.16, 'sawtooth');
  if (event.k === 'level') beep(700, 0.13);
  if (event.k === 'goal') addFeed(`${event.n} llegó a la meta`);
  if (event.k === 'out') addFeed(`${event.n} se quedó sin vidas`);
  if (event.k === 'smash' && event.id === myId) addFeed('¡Barril destruido con el mazo!');
}

function addFeed(message) {
  const item = document.createElement('li');
  item.textContent = message;
  $('#feed').prepend(item);
  while ($('#feed').children.length > 5) $('#feed').lastChild.remove();
}

function me() { return curr && curr.p.find(player => player.id === myId); }
function updateHud() {
  const player = me();
  $('#hudHp').textContent = player && player.ig ? '♥'.repeat(Math.max(0, player.lives)) + '♡'.repeat(5 - Math.max(0, player.lives)) : '—';
  $('#hudHammer').textContent = player && player.ig ? (player.hcd <= 0 ? 'LISTO' : `${Math.ceil(player.hcd / 1000)}s`) : '—';
  $('#hudLevel').textContent = curr ? `${curr.level}/5` : '1/5';
}

function updateSide() {
  if (!curr) return;
  const people = [...curr.p].sort((a, b) => Number(b.al) - Number(a.al) || a.n.localeCompare(b.n));
  const key = people.map(p => `${p.id}|${p.n}|${p.ch}|${p.lives}|${p.al}|${p.goal}|${p.floor}|${Math.floor((p.x || 0) / 20)}`).join(';') + curr.ph;
  if (key === lastListKey) return;
  lastListKey = key;
  const active = curr.p.filter(p => p.ig && p.al).length;
  $('#aliveCount').textContent = `(${active} EN PARTIDA / ${curr.p.length} CONECTADOS)`;
  const list = $('#playerList');
  list.replaceChildren();
  for (const player of people) {
    const row = document.createElement('li');
    if (!player.al && player.ig) row.classList.add('dead');
    if (player.id === myId) row.classList.add('me');
    const name = document.createElement('span');
    name.className = 'pname';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = player.c;
    name.append(dot, `${player.n} · ${player.ch}`);
    const status = document.createElement('span');
    status.className = 'pstatus';
    status.textContent = player.ig ? (player.al ? (player.goal ? 'META' : `N${(player.floor || 0) + 1} ${Math.round((player.x / W) * 100)}% · ${player.lives}♥`) : 'FUERA') : 'LISTO';
    row.append(name, status);
    list.appendChild(row);
  }
  if (isHost) {
    $('#btnStart').disabled = curr.ph !== 'lobby' || curr.p.length < 1;
    $('#btnStart').textContent = curr.ph === 'lobby' && curr.p.length < 1 ? 'ESPERANDO JUGADORES' : 'EMPEZAR AVENTURA';
    $('#btnStop').disabled = curr.ph === 'lobby';
    $('#hostJoinForm').hidden = joined;
  }
}

const keys = { u: false, d: false, l: false, r: false };
const KEYMAP = {
  KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd',
  KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
};
function typing() {
  const element = document.activeElement;
  return element && ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
}
addEventListener('keydown', event => {
  if (typing()) return;
  const direction = KEYMAP[event.code];
  if (direction) {
    event.preventDefault();
    if (!keys[direction]) { keys[direction] = true; inputDirty = true; }
  }
  if (event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) { initAudio(); send({ t: 'jump' }); }
  }
  if (event.code === 'KeyX' && !event.repeat) { initAudio(); send({ t: 'hammer' }); }
  if (event.code === 'KeyM' && !event.repeat) muted = !muted;
});
addEventListener('keyup', event => {
  const direction = KEYMAP[event.code];
  if (direction && keys[direction]) { keys[direction] = false; inputDirty = true; }
});
addEventListener('blur', () => {
  for (const direction in keys) keys[direction] = false;
  inputDirty = true;
});
setInterval(() => {
  if (joined) {
    send({ t: 'in', ...keys });
    inputDirty = false;
  }
}, 50);

function fillBackground(theme = null) {
  ctx.fillStyle = theme ? theme.bg : '#080b1b';
  ctx.fillRect(0, 0, W, H);
  for (let y = 8; y < H; y += 16) {
    for (let x = (y % 32 ? 7 : 15); x < W; x += 32) {
      ctx.fillStyle = '#111a36';
      ctx.fillRect(x, y, 2, 2);
    }
  }
  ctx.fillStyle = '#18244a';
  ctx.fillRect(0, H - 8, W, 8);
}

function floorYAt(level, floorIndex, x) {
  return level.floors[floorIndex] + (level.slopes[floorIndex] || 0) * (x - W / 2);
}

function drawWorld(level) {
  fillBackground(level.theme);
  const floors = level.floors;
  for (let i = 0; i < floors.length; i++) {
    for (let x = 14; x < W - 14; x += 9) {
      const y = Math.round(floorYAt(level, i, x));
      ctx.fillStyle = '#050711';
      ctx.fillRect(x, y - 1, 10, 9);
      ctx.fillStyle = level.theme.beam;
      ctx.fillRect(x + 1, y, 8, 5);
      ctx.fillStyle = level.theme.trim;
      ctx.fillRect(x + 1, y, 8, 1);
      ctx.fillStyle = '#7e2553';
      ctx.fillRect(x + 1, y + 5, 8, 2);
      if ((x - 14) % 27 < 9) {
        ctx.fillStyle = '#fff1e8';
        ctx.fillRect(x + 3, y + 2, 1, 1);
        ctx.fillStyle = '#151020';
        ctx.fillRect(x + 6, y + 2, 1, 2);
      }
    }
    ctx.strokeStyle = '#151020';
    ctx.lineWidth = 1.5;
    for (let x = 20; x < W - 38; x += 26) {
      const y0 = Math.round(floorYAt(level, i, x) + 6);
      const y1 = Math.round(floorYAt(level, i, x + 13) + 12);
      const y2 = Math.round(floorYAt(level, i, x + 26) + 6);
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x + 13, y1);
      ctx.lineTo(x + 26, y2);
      ctx.stroke();
      ctx.fillStyle = level.theme.trim;
      ctx.fillRect(x + 12, y1, 2, 2);
    }
  }
  for (let i = 0; i < level.ladders.length; i++) {
    const x = level.ladders[i];
    const top = floorYAt(level, i + 1, x) + 2;
    const bottom = floorYAt(level, i, x) - 1;
    ctx.fillStyle = level.theme.ladder;
    ctx.fillRect(x - 5, top, 2, bottom - top);
    ctx.fillRect(x + 4, top, 2, bottom - top);
    for (let y = top + 2; y < bottom; y += 7) ctx.fillRect(x - 5, y, 11, 2);
  }
  const topFloor = floors.length - 1;
  const kongX = 52;
  const paulineX = level.goalX;
  const kongFeet = floorYAt(level, topFloor, kongX) - 25;
  const paulineFeet = floorYAt(level, topFloor, paulineX) - 25;
  drawRescuePlatform(18, 91, kongFeet, level.theme);
  drawRescuePlatform(379, 462, paulineFeet, level.theme);
  drawKong(kongX, kongFeet, curr.kt, performance.now(), curr.bossHit);
  drawPauline(paulineX, paulineFeet);
  for (const hammer of curr.h || []) drawHammerPickup(hammer.x, hammer.y, performance.now());
  for (const hazard of curr.b) {
    if (hazard.kind === 'fireball') drawFireball(hazard.x, hazard.y, performance.now(), hazard.d);
    else drawBarrel(hazard.x, hazard.y - 7, hazard.kind, performance.now(), hazard.d);
  }
}

function drawRescuePlatform(left, right, feet, theme) {
  const y = Math.round(feet);
  ctx.fillStyle = '#080b1b';
  ctx.fillRect(left - 2, y - 2, right - left + 4, 11);
  ctx.fillStyle = theme.beam;
  ctx.fillRect(left, y, right - left, 6);
  ctx.fillStyle = theme.trim;
  ctx.fillRect(left, y, right - left, 2);
  ctx.fillStyle = '#151020';
  for (let x = left + 10; x < right - 6; x += 18) {
    ctx.fillRect(x, y + 3, 2, 3);
    ctx.fillRect(x + 5, y + 3, 2, 3);
  }
  ctx.fillStyle = theme.beam;
  ctx.fillRect(left + 3, y + 7, 5, 5);
  ctx.fillRect(right - 8, y + 7, 5, 5);
  ctx.fillStyle = theme.trim;
  ctx.fillRect(left + 4, y + 7, 2, 5);
  ctx.fillRect(right - 7, y + 7, 2, 5);
}

function drawHammerPickup(x, feet, now) {
  const bob = Math.round(Math.sin(now / 180 + x) * 2);
  const y = Math.round(feet) - 9 + bob;
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 7, y + 10, 15, 2);
  ctx.fillStyle = '#ffec27';
  ctx.fillRect(x - 1, y, 3, 10);
  ctx.fillStyle = '#ab5236';
  ctx.fillRect(x - 7, y - 4, 14, 5);
  ctx.fillRect(x - 5, y - 6, 10, 2);
  ctx.fillStyle = '#c2c3c7';
  ctx.fillRect(x - 6, y - 3, 4, 2);
  ctx.fillStyle = '#fff1e8';
  ctx.fillRect(x - 5, y - 5, 3, 1);
}

function drawKong(x, feet, throwing = false, now = 0, damaged = false) {
  const step = Math.floor(now / 120) % 2;
  const y = feet - 25 + (throwing ? -1 : 0) + (damaged ? (Math.floor(now / 70) % 2 ? -2 : 2) : 0);
  ctx.fillStyle = damaged ? '#fff1e8' : '#ab5236';
  ctx.fillRect(x - 12, y + 8, 24, 13);
  ctx.fillRect(x - 15, y + 10 + step, 5, 9 - step);
  ctx.fillRect(x + 10, throwing ? y + 4 : y + 10 - step, 5, throwing ? 12 : 9 + step);
  if (throwing) {
    ctx.fillStyle = '#ffccaa';
    ctx.fillRect(x + 14, y + 2, 5, 5);
  }
  ctx.fillStyle = '#ffccaa';
  ctx.fillRect(x - 9, y + 2, 18, 9);
  ctx.fillRect(x - 6, y + 10, 12, 4);
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 4, y + 5, 2, 2);
  ctx.fillRect(x + 3, y + 5, 2, 2);
  ctx.fillStyle = '#5f3030';
  ctx.fillRect(x - 7, y, 4, 3);
  ctx.fillRect(x + 3, y, 4, 3);
  ctx.fillStyle = '#ff004d';
  ctx.fillRect(x - 10, y + 18, 8, 5);
  ctx.fillRect(x + 2, y + 18, 8, 5);
  ctx.fillStyle = '#ffec27';
  ctx.fillRect(x - 3, y + 18, 6, 3);
  ctx.fillStyle = '#5f3030';
  ctx.font = `5px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DK', x, y + 19);
}

function drawPauline(x, feet) {
  const y = feet - 22;
  ctx.fillStyle = '#ff77a8';
  ctx.fillRect(x - 6, y + 11, 12, 9);
  ctx.fillRect(x - 9, y + 17, 18, 3);
  ctx.fillStyle = '#ffccaa';
  ctx.fillRect(x - 5, y + 2, 10, 10);
  ctx.fillStyle = '#ab5236';
  ctx.fillRect(x - 7, y, 14, 4);
  ctx.fillRect(x - 8, y + 3, 3, 8);
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 2, y + 6, 1, 2);
  ctx.fillRect(x + 2, y + 6, 1, 2);
  ctx.fillStyle = '#ffec27';
  ctx.fillRect(x - 1, y + 13, 3, 3);
}

const CHARACTER_LOOKS = {
  Mario: { hat: '#ff004d', hair: '#ab5236', accent: '#29adff', kind: 'cap', emblem: 'M', moustache: true },
  Luigi: { hat: '#00a844', hair: '#ab5236', accent: '#1d2b53', kind: 'cap', emblem: 'L', moustache: true },
  Peach: { hat: '#ffec27', hair: '#ffa300', accent: '#ff77a8', kind: 'crown' },
  Daisy: { hat: '#ffec27', hair: '#ffa300', accent: '#ffa300', kind: 'crown' },
  Yoshi: { hat: '#00e436', hair: '#00a844', accent: '#fff1e8', kind: 'dino' },
  Toad: { hat: '#fff1e8', hair: '#ffccaa', accent: '#ff004d', kind: 'mushroom' },
  Toadette: { hat: '#ff77a8', hair: '#ffccaa', accent: '#ff77a8', kind: 'mushroom' },
  Bowser: { hat: '#ffec27', hair: '#ffa300', accent: '#00a844', kind: 'horns' },
  'Bowser Jr.': { hat: '#00e436', hair: '#ffccaa', accent: '#ffec27', kind: 'bandana' },
  'Donkey Kong': { hat: '#ab5236', hair: '#5f3030', accent: '#ff004d', kind: 'ape', moustache: true },
  Wario: { hat: '#ffec27', hair: '#ab5236', accent: '#83769c', kind: 'cap', emblem: 'W', moustache: true },
  Waluigi: { hat: '#83769c', hair: '#ab5236', accent: '#7e2553', kind: 'cap', emblem: 'Γ', moustache: true },
  Rosalina: { hat: '#29adff', hair: '#ffccaa', accent: '#29adff', kind: 'crown' },
  Pauline: { hat: '#7e2553', hair: '#5f3030', accent: '#ff004d', kind: 'widehat' },
  Birdo: { hat: '#ff77a8', hair: '#ff77a8', accent: '#ffec27', kind: 'snout' },
};

function drawCharacter(player, now) {
  if (player.inv && Math.floor(now / 80) % 2) return;
  const x = Math.round(player.x);
  const feet = Math.round(player.y);
  const top = feet - 20;
  const look = CHARACTER_LOOKS[player.ch] || CHARACTER_LOOKS.Mario;
  const isPrincess = ['Peach', 'Daisy', 'Rosalina', 'Pauline'].includes(player.ch);
  const isWide = look.kind === 'ape' || look.kind === 'horns';

  // Sombra, zapatos y piernas con dos frames para dar sensación de marcha.
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 8, feet, 16, 2);
  const step = Math.floor(now / 110) % 2;
  ctx.fillStyle = look.kind === 'ape' ? '#5f3030' : '#202040';
  ctx.fillRect(x - 5 - step, feet - 6, 4, 5);
  ctx.fillRect(x + 1 + step, feet - 6, 4, 5);
  ctx.fillStyle = '#5f574f';
  ctx.fillRect(x - 7, feet - 2, 6, 2);
  ctx.fillRect(x + 1, feet - 2, 6, 2);

  // Silueta y traje elegido por el jugador.
  if (look.kind === 'horns') {
    ctx.fillStyle = '#00a844';
    ctx.fillRect(x - 10, top + 9, 20, 9);
    ctx.fillStyle = '#ffec27';
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 7 + i * 6, top + 15, 3, 3);
  }
  if (look.kind === 'ape') {
    ctx.fillStyle = look.hair;
    ctx.fillRect(x - 9, top + 8, 18, 10);
    ctx.fillRect(x - 12, top + 10, 4, 6);
    ctx.fillRect(x + 8, top + 10, 4, 6);
  }
  ctx.fillStyle = player.c;
  ctx.fillRect(x - (isWide ? 8 : 6), top + 8, isWide ? 16 : 12, 8);
  ctx.fillStyle = look.accent;
  if (isPrincess) {
    ctx.fillRect(x - 2, top + 9, 4, 3);
    ctx.fillRect(x - 6, top + 14, 2, 2);
    ctx.fillRect(x + 4, top + 14, 2, 2);
  } else if (look.kind === 'ape') {
    ctx.fillRect(x - 2, top + 11, 4, 5);
  } else {
    ctx.fillRect(x - 1, top + 10, 2, 3);
  }
  if (isPrincess) {
    ctx.fillRect(x - 8, top + 13, 16, 4);
    ctx.fillStyle = '#ffec27';
    ctx.fillRect(x - 1, top + 9, 2, 4);
  } else if (look.kind === 'ape') {
    ctx.fillStyle = '#ff004d';
    ctx.fillRect(x - 2, top + 10, 4, 7);
    ctx.fillStyle = '#ffec27';
    ctx.fillRect(x - 1, top + 12, 2, 2);
  } else if (look.kind === 'dino' || look.kind === 'snout') {
    ctx.fillStyle = look.hair;
    ctx.fillRect(x - 8, top + 13, 4, 4);
    ctx.fillRect(x + 4, top + 13, 4, 4);
  }

  // Cabeza y accesorios distintos para reconocer cada personaje.
  ctx.fillStyle = look.kind === 'ape' ? '#ffccaa' : (look.kind === 'dino' ? '#00e436' : '#ffccaa');
  ctx.fillRect(x - 5, top + 2, 10, 8);
  if (isPrincess || ['cap', 'widehat'].includes(look.kind)) {
    ctx.fillStyle = look.hair;
    ctx.fillRect(x - 7, top + 4, 2, 6);
    ctx.fillRect(x + 5, top + 4, 2, 6);
    if (isPrincess) {
      ctx.fillRect(x - 8, top + 9, 3, 5);
      ctx.fillRect(x + 5, top + 9, 3, 5);
    }
  }
  if (look.kind === 'mushroom') {
    ctx.fillStyle = look.hat;
    ctx.fillRect(x - 8, top, 16, 5);
    ctx.fillRect(x - 5, top - 3, 10, 3);
    ctx.fillStyle = look.accent;
    ctx.fillRect(x - 6, top + 1, 3, 3);
    ctx.fillRect(x + 4, top + 1, 3, 3);
    ctx.fillRect(x - 1, top - 2, 3, 2);
    if (player.ch === 'Toadette') {
      ctx.fillRect(x - 11, top + 3, 4, 5);
      ctx.fillRect(x + 7, top + 3, 4, 5);
    }
  } else if (look.kind === 'crown') {
    ctx.fillStyle = look.hat;
    ctx.fillRect(x - 5, top - 2, 10, 3);
    ctx.fillRect(x - 5, top - 5, 2, 4);
    ctx.fillRect(x - 1, top - 6, 2, 5);
    ctx.fillRect(x + 3, top - 5, 2, 4);
  } else if (look.kind === 'dino' || look.kind === 'snout') {
    ctx.fillStyle = look.hat;
    ctx.fillRect(x - 5, top, 10, 4);
    ctx.fillRect(x + 3, top + 5, 9, 4);
    ctx.fillStyle = '#fff1e8';
    ctx.fillRect(x + 2, top + 4, 5, 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 8, top + 6, 1, 1);
    if (look.kind === 'snout') {
      ctx.fillStyle = look.accent;
      ctx.fillRect(x - 5, top - 4, 4, 3);
      ctx.fillRect(x - 2, top - 5, 5, 3);
    }
  } else if (look.kind === 'horns') {
    ctx.fillStyle = look.hair;
    ctx.fillRect(x - 6, top, 12, 4);
    ctx.fillStyle = '#fff1e8';
    ctx.fillRect(x - 7, top - 4, 3, 5);
    ctx.fillRect(x + 4, top - 4, 3, 5);
    ctx.fillStyle = '#00a844';
    ctx.fillRect(x - 8, top + 10, 4, 3);
    ctx.fillRect(x + 4, top + 10, 4, 3);
  } else if (look.kind === 'bandana') {
    ctx.fillStyle = look.hat;
    ctx.fillRect(x - 6, top, 12, 4);
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 5, top + 4, 10, 4);
    ctx.fillStyle = '#fff1e8';
    ctx.fillRect(x - 3, top + 5, 2, 1);
    ctx.fillRect(x + 2, top + 5, 2, 1);
  } else if (look.kind === 'widehat') {
    ctx.fillStyle = look.hat;
    ctx.fillRect(x - 7, top + 1, 14, 3);
    ctx.fillRect(x - 4, top - 3, 8, 5);
    ctx.fillStyle = '#ffec27';
    ctx.fillRect(x - 1, top - 2, 2, 2);
  } else {
    ctx.fillStyle = look.hat;
    ctx.fillRect(x - 6, top, 12, 4);
    ctx.fillRect(x - 8, top + 3, 16, 2);
    ctx.fillStyle = look.accent;
    ctx.fillRect(x - 1, top + 1, 3, 2);
    if (look.emblem) {
      ctx.font = `4px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff1e8';
      ctx.fillText(look.emblem, x, top + 2);
    }
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 3, top + 5, 2, 2);
  ctx.fillRect(x + 2, top + 5, 2, 2);
  if (look.moustache) {
    ctx.fillStyle = '#5f3030';
    ctx.fillRect(x - 5, top + 8, 4, 2);
    ctx.fillRect(x + 1, top + 8, 4, 2);
  }
  if (look.kind === 'ape') {
    ctx.fillStyle = '#ffccaa';
    ctx.fillRect(x - 7, top + 8, 5, 3);
    ctx.fillRect(x + 2, top + 8, 5, 3);
  }
  const handColor = look.kind === 'dino' ? '#00e436' : '#ffccaa';
  ctx.fillStyle = player.c;
  ctx.fillRect(x - 9, top + 11, 3, 4);
  ctx.fillRect(x + 6, top + 11, 3, 4);
  ctx.fillStyle = handColor;
  ctx.fillRect(x - 10, top + 13, 4, 3);
  ctx.fillRect(x + 6, top + 13, 4, 3);
  ctx.fillRect(x - 11, top + 14, 2, 2);
  ctx.fillRect(x + 9, top + 14, 2, 2);
  if (player.hm) {
    const swing = Math.floor(now / 80) % 2;
    ctx.fillStyle = '#ffccaa';
    ctx.fillRect(x + 7, top + 7, 3, 11);
    ctx.fillStyle = '#5f3030';
    ctx.fillRect(x + 8 + swing, top + 1, 3, 9);
    ctx.fillStyle = '#83769c';
    ctx.fillRect(x + 4 + swing, top - 2, 11, 5);
    ctx.fillStyle = '#c2c3c7';
    ctx.fillRect(x + 5 + swing, top - 3, 9, 2);
    ctx.fillStyle = '#fff1e8';
    ctx.fillRect(x + 6 + swing, top - 2, 3, 1);
  }
  if (player.goal) {
    ctx.fillStyle = '#ffec27';
    ctx.fillRect(x - 4, top - 7, 8, 2);
    ctx.fillRect(x - 2, top - 10, 4, 3);
  }
}

function drawBarrel(x, y, kind, now, direction = 1) {
  const fire = kind === 'firebarrel';
  const roll = Math.floor(now / 75) * (direction || 1);
  const stave = ((roll % 3) + 3) % 3;
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 8, y + 7, 16, 2);
  if (fire) {
    const flicker = Math.floor(now / 90) % 2;
    ctx.fillStyle = '#ff004d';
    ctx.fillRect(x - 6, y - 12 - flicker, 4, 6 + flicker);
    ctx.fillRect(x + 2, y - 13 + flicker, 5, 7 - flicker);
    ctx.fillStyle = '#ffec27';
    ctx.fillRect(x - 4, y - 9, 3, 4);
    ctx.fillRect(x + 3, y - 10, 3, 4);
  }
  const wood = fire ? '#d93600' : '#ab5236';
  const darkWood = fire ? '#7e2553' : '#5f3030';
  const hoop = fire ? '#ffec27' : '#83769c';
  // Silueta escalonada, tablones móviles y dos aros metálicos.
  ctx.fillStyle = '#151020';
  ctx.fillRect(x - 6, y - 9, 12, 2);
  ctx.fillRect(x - 8, y - 7, 16, 14);
  ctx.fillRect(x - 6, y + 7, 12, 2);
  ctx.fillStyle = wood;
  ctx.fillRect(x - 6, y - 7, 12, 14);
  ctx.fillRect(x - 8, y - 5, 16, 10);
  ctx.fillStyle = darkWood;
  ctx.fillRect(x - 5 + stave, y - 6, 2, 12);
  ctx.fillRect(x + 2 - stave, y - 6, 2, 12);
  ctx.fillStyle = hoop;
  ctx.fillRect(x - 8, y - 5, 16, 2);
  ctx.fillRect(x - 8, y + 3, 16, 2);
  ctx.fillStyle = fire ? '#fff1e8' : '#ffccaa';
  ctx.fillRect(x - 6, y - 3, 2, 2);
  ctx.fillRect(x + 4, y + 1, 2, 2);
}

function drawFireball(x, y, now, direction = 1) {
  const flicker = Math.floor(now / 75) % 2;
  ctx.fillStyle = '#ff004d';
  ctx.fillRect(x - 5, y - 4, 10, 9);
  ctx.fillRect(x - 3 - flicker, y - 7, 5, 4);
  ctx.fillRect(x + 1, y + 3, 4, 3);
  ctx.fillStyle = '#ff7700';
  ctx.fillRect(x - 3, y - 3, 6, 6);
  ctx.fillRect(x - 1 + flicker, y - 6, 3, 4);
  ctx.fillStyle = '#ffec27';
  ctx.fillRect(x - 1, y - 2, 3, 4);
  ctx.fillStyle = '#fff1e8';
  ctx.fillRect(x - 1, y - 1, 2, 2);
  ctx.fillRect(x - 3, y - 3, 2, 2);
  ctx.fillRect(x + 2, y - 3, 2, 2);
  ctx.fillStyle = '#151020';
  ctx.fillRect(x - 2 + Math.sign(direction), y - 2, 1, 2);
  ctx.fillRect(x + 3 + Math.sign(direction), y - 2, 1, 2);
}

function drawText(message, x, y, size = 8, color = '#fff1e8', align = 'center') {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(message, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(message, x, y);
}

function drawOverlay(player) {
  const phase = curr.ph;
  const blink = Math.floor(performance.now() / 450) % 2 === 0;
  if (phase === 'lobby') {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, W, H);
    drawText('8 BITS KONG', W / 2, 100, 22, '#ffec27');
    drawText(`${curr.p.length} JUGADOR${curr.p.length === 1 ? '' : 'ES'} CONECTADO${curr.p.length === 1 ? '' : 'S'}`, W / 2, 145, 8, '#29adff');
    drawText(isHost ? 'EL PROFESOR PUEDE EMPEZAR' : 'ESPERANDO AL PROFESOR...', W / 2, 188, 8, blink ? '#00e436' : '#fff1e8');
    drawText('5 NIVELES · 5 VIDAS · ¡DERROTA A KONG!', W / 2, 232, 6, '#ff77a8');
  } else if (phase === 'countdown') {
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.fillRect(0, 0, W, H);
    drawText(curr.cd ? String(curr.cd) : '¡YA!', W / 2, H / 2 - 10, 38, '#ffec27');
    drawText(`NIVEL ${curr.level}: ${curr.levelName.toUpperCase()}`, W / 2, H / 2 + 35, 7);
  } else if (phase === 'intermission') {
    ctx.fillStyle = 'rgba(0,0,0,.48)';
    ctx.fillRect(0, 0, W, H);
    drawText(`¡NIVEL ${curr.level} COMPLETADO!`, W / 2, H / 2 - 8, 13, '#00e436');
    drawText('PREPARANDO EL SIGUIENTE...', W / 2, H / 2 + 25, 7, '#ffec27');
  } else if (phase === 'ended') {
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(0, 0, W, H);
    drawText(curr.end || 'FIN DE LA PARTIDA', W / 2, H / 2 - 12, 13, '#ffec27');
    drawText('GRACIAS POR JUGAR', W / 2, H / 2 + 24, 8, '#29adff');
  } else {
    drawText(`NIVEL ${curr.level}/5: ${curr.levelName.toUpperCase()}`, 8, 12, 7, '#ffec27', 'left');
    drawText('ESPACIO SALTA · X MAZO', W - 8, 12, 6, '#fff1e8', 'right');
    const highScore = Math.max(0, ...curr.p.map(p => p.score || 0));
    drawText(`1UP ${String(player ? player.score || 0 : 0).padStart(6, '0')}`, 8, 25, 5, '#fff1e8', 'left');
    drawText(`HIGH SCORE ${String(highScore).padStart(6, '0')}`, W / 2, 25, 5, '#fff1e8');
    if (curr.level === 5) {
      drawText(`JEFE: DONKEY KONG  ${'♥'.repeat(Math.max(0, curr.boss || 0))}`, W / 2, 38, 7, '#ff004d');
      drawText('SUBE A LA VIGA SUPERIOR Y PULSA X JUNTO A KONG', W / 2, 49, 5, '#ffec27');
    }
    if (player && !player.al) {
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(90, 135, W - 180, 52);
      drawText('TE HAS QUEDADO SIN VIDAS', W / 2, 151, 7, '#ff004d');
      drawText('PUEDES VER AL EQUIPO', W / 2, 172, 6, '#fff1e8');
    } else if (player && player.goal) {
      drawText('¡META! ESPERA AL EQUIPO', W / 2, 35, 7, '#00e436');
    }
  }
}

function render() {
  requestAnimationFrame(render);
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (!curr) { fillBackground(); return; }
  drawWorld(curr.levelData);
  const now = performance.now();
  for (const player of curr.p) if (player.ig && player.al) drawCharacter(player, now);
  const player = me();
  drawOverlay(player);
}

connect();
render();
