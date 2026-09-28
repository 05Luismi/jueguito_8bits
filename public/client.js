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
  if (state.ph === 'ended' && oldPhase !== 'ended') beep(state.end.includes('COMPLETADO') ? 880 : 180, 0.24);
}

function handleEvent(event) {
  if (event.k === 'hit') beep(event.id === myId ? 150 : 240, 0.12, 'sawtooth');
  if (event.k === 'hammer' || event.k === 'smash') beep(330, 0.1);
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
  const key = people.map(p => `${p.id}|${p.n}|${p.ch}|${p.lives}|${p.al}|${p.goal}`).join(';') + curr.ph;
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
    status.textContent = player.ig ? (player.al ? (player.goal ? 'META' : `${player.lives}♥`) : 'FUERA') : 'LISTO';
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

function drawWorld(level) {
  fillBackground(level.theme);
  const floors = level.floors;
  for (let i = 0; i < floors.length; i++) {
    const y = floors[i];
    ctx.fillStyle = level.theme.beam;
    ctx.fillRect(16, y, W - 32, 5);
    ctx.fillStyle = level.theme.trim;
    ctx.fillRect(16, y, W - 32, 1);
    ctx.fillStyle = '#151020';
    for (let x = 20; x < W - 24; x += 18) {
      ctx.fillRect(x, y + 5, 2, 4);
      ctx.fillRect(x + 8, y + 5, 2, 4);
      ctx.fillRect(x + 4, y + 8, 2, 3);
    }
  }
  for (let i = 0; i < level.ladders.length; i++) {
    const x = level.ladders[i];
    const top = floors[i + 1] + 2;
    const bottom = floors[i] - 1;
    ctx.fillStyle = level.theme.ladder;
    ctx.fillRect(x - 5, top, 2, bottom - top);
    ctx.fillRect(x + 4, top, 2, bottom - top);
    for (let y = top + 2; y < bottom; y += 7) ctx.fillRect(x - 5, y, 11, 2);
  }
  drawKong(52, floors[floors.length - 1]);
  drawPauline(level.goalX, floors[floors.length - 1]);
  for (const barrel of curr.b) drawBarrel(barrel.x, barrel.y - 7);
}

function drawKong(x, feet) {
  const y = feet - 25;
  ctx.fillStyle = '#ab5236';
  ctx.fillRect(x - 11, y + 7, 22, 14);
  ctx.fillRect(x - 15, y + 10, 5, 9);
  ctx.fillRect(x + 10, y + 10, 5, 9);
  ctx.fillStyle = '#ffccaa';
  ctx.fillRect(x - 8, y + 2, 16, 9);
  ctx.fillRect(x - 5, y + 10, 10, 4);
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 4, y + 5, 2, 2);
  ctx.fillRect(x + 3, y + 5, 2, 2);
  ctx.fillStyle = '#ff004d';
  ctx.fillRect(x - 9, y + 18, 7, 5);
  ctx.fillRect(x + 2, y + 18, 7, 5);
  ctx.fillStyle = '#ffec27';
  ctx.fillRect(x - 2, y + 18, 4, 2);
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

function characterType(name) {
  if (['Peach', 'Daisy', 'Rosalina', 'Pauline'].includes(name)) return 'princess';
  if (['Yoshi', 'Birdo'].includes(name)) return 'dino';
  if (name === 'Toad' || name === 'Toadette') return 'toad';
  if (['Bowser', 'Bowser Jr.', 'Donkey Kong'].includes(name)) return 'monster';
  return 'hero';
}

function drawCharacter(player, now) {
  if (player.inv && Math.floor(now / 80) % 2) return;
  const x = Math.round(player.x);
  const feet = Math.round(player.y);
  const top = feet - 19;
  const type = characterType(player.ch);
  const hair = type === 'princess' ? '#ffccaa' : (player.ch === 'Luigi' || player.ch === 'Waluigi' ? '#ab5236' : '#ffccaa');
  const headgear = type === 'toad' ? '#fff1e8' : (type === 'monster' ? '#ffec27' : player.c);

  // Piernas y zapatos pixelados.
  ctx.fillStyle = '#202040';
  ctx.fillRect(x - 5, feet - 6, 4, 5);
  ctx.fillRect(x + 1, feet - 6, 4, 5);
  ctx.fillStyle = '#5f574f';
  ctx.fillRect(x - 7, feet - 2, 6, 2);
  ctx.fillRect(x + 1, feet - 2, 6, 2);

  // Traje: el color elegido por el jugador.
  ctx.fillStyle = player.c;
  ctx.fillRect(x - 6, top + 8, 12, 8);
  if (type === 'princess') {
    ctx.fillRect(x - 8, top + 14, 16, 3);
    ctx.fillStyle = '#ffec27';
    ctx.fillRect(x - 1, top + 9, 2, 3);
  } else if (type === 'monster') {
    ctx.fillRect(x - 8, top + 7, 3, 7);
    ctx.fillRect(x + 5, top + 7, 3, 7);
  }

  // Cara, pelo, gorro o manchas según la familia del personaje.
  ctx.fillStyle = hair;
  ctx.fillRect(x - 5, top + 2, 10, 8);
  ctx.fillStyle = headgear;
  if (type === 'toad') {
    ctx.fillRect(x - 8, top, 16, 5);
    ctx.fillRect(x - 5, top - 3, 10, 3);
    ctx.fillStyle = player.c;
    ctx.fillRect(x - 2, top - 3, 4, 3);
    ctx.fillRect(x - 7, top + 1, 3, 3);
    ctx.fillRect(x + 4, top + 1, 3, 3);
  } else if (type === 'dino') {
    ctx.fillRect(x - 6, top + 1, 12, 5);
    ctx.fillRect(x + 4, top + 6, 6, 3);
  } else {
    ctx.fillRect(x - 6, top, 12, 4);
    ctx.fillRect(x - 7, top + 2, 3, 3);
    if (type === 'monster') {
      ctx.fillStyle = '#fff1e8';
      ctx.fillRect(x - 6, top - 3, 3, 4);
      ctx.fillRect(x + 3, top - 3, 3, 4);
    }
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 3, top + 5, 2, 2);
  ctx.fillRect(x + 2, top + 5, 2, 2);
  if (player.hm) {
    ctx.fillStyle = '#ffccaa';
    ctx.fillRect(x + 7, top + 8, 2, 9);
    ctx.fillStyle = '#83769c';
    ctx.fillRect(x + 5, top + 5, 7, 4);
    ctx.fillStyle = '#c2c3c7';
    ctx.fillRect(x + 4, top + 4, 9, 2);
  }
  if (player.goal) {
    ctx.fillStyle = '#ffec27';
    ctx.fillRect(x - 4, top - 7, 8, 2);
    ctx.fillRect(x - 2, top - 10, 4, 3);
  }
}

function drawBarrel(x, y) {
  ctx.fillStyle = '#ab5236';
  ctx.fillRect(x - 7, y - 7, 14, 14);
  ctx.fillStyle = '#ffccaa';
  ctx.fillRect(x - 7, y - 5, 14, 2);
  ctx.fillRect(x - 7, y + 3, 14, 2);
  ctx.fillStyle = '#5f3030';
  ctx.fillRect(x - 1, y - 7, 2, 14);
  ctx.fillStyle = '#ffec27';
  ctx.fillRect(x - 4, y - 1, 2, 2);
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
    drawText('5 NIVELES · 5 VIDAS · ¡LLEGA A PAULINE!', W / 2, 232, 6, '#ff77a8');
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
