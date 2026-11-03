// 협동 게임방(블록 놀이터) 화면. 서버 약속은 Handoff/설계_협동게임방.md.
// 참가자: 내 캐릭터는 이 화면에서 바로 움직이고(shared/coop-physics.js), 위치를 서버로 보낸다.
// 구경하는 학생·선생님: 서버가 보내는 위치를 조금 늦게(부드럽게) 그린다.
import './coop.css';
import { COOP, LEVELS, LEVEL_1, px, plateRect, levelSize, spawnPoint } from '../../shared/coop-level.js';
import { stepBody, solidRects, newBody, plateDown } from '../../shared/coop-physics.js';
import { COOP_ART, COOP_ART_BASE } from './coop-art-data.js';

const HOLD_MS = 170; // 이보다 오래 누르면 걷기, 짧으면 점프
const JUMP_BUFFER_S = .15; // 땅에 닿기 직전에 누른 점프도 받아 준다(움직임 계산 시간 기준이라 화면이 느려도 사라지지 않음)
const INTERP_MS = 110; // 친구 위치는 이만큼 늦게 그려서 끊기지 않게
const DRAW_H = 58; // 캐릭터 그림 키(세상 픽셀). 부딪힘 상자(44)보다 조금 크게
const SEND_MS = 1000 / COOP.sendHz;
const BLOCKS = ['#f4a99a', '#a8d8cc', '#f6d58a', '#b8c4ef', '#d7b7e8'];
const DARK = { '#f4a99a': '#d9806f', '#a8d8cc': '#78b5a6', '#f6d58a': '#d9b25c', '#b8c4ef': '#8e9bd0', '#d7b7e8': '#b08ec4' };
const TEAL = '#0f4c4f';
// 블록 그림 색: 고정 블록은 solids 순서대로 돌려 쓰고, 계단은 노랑(노란 버튼과 같은 색), 양옆 벽은 나무
const BLOCK_ART = ['salmon', 'lilac', 'mint', 'periwinkle'];
const WALL_PARALLAX = .5; // 벽 그림은 캐릭터보다 천천히 지나가 깊이가 느껴지게
const HINTS = {
  stairs: '친구 머리를 밟고 언덕에 올라가 노란 버튼을 눌러요',
  gate: '파란 버튼 두 개를 동시에 눌러 가로막을 열어요',
  key: '친구 머리 위에서 뛰어 공중의 열쇠를 잡아요',
  door: '열쇠를 든 친구가 문까지 가요',
  goal: '모두 문으로 들어가요!',
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (name, n = 6) => [...String(name || '')].length > n ? [...String(name)].slice(0, n).join('') + '…' : String(name || '');
const mmss = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// 코덱스 16 그림(Art/Coop_v01 → scripts/cut-coop-art.py). 전부 불러오기 전이나 실패하면 예전처럼 코드로 그린다.
const art = { ready: false, img: {} };
let artLoading = null;
function loadArt() {
  if (artLoading) return artLoading;
  artLoading = Promise.all(Object.entries(COOP_ART).map(([name, s]) => new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { art.img[name] = img; resolve(); };
    img.onerror = reject;
    img.src = COOP_ART_BASE + s.file;
  }))).then(() => { art.ready = true; }, () => { artLoading = null; });
  return artLoading;
}

export function createCoopView({ viewer, send, admin = () => {}, avatarCanvas, audio, onCover = () => {}, clock }) {
  let root = null;
  let canvas = null;
  let ctx = null;
  let state = null;
  let level = LEVEL_1;
  let frame = 0;
  let lastFrame = 0;
  let acc = 0;
  let me = null; // 내 몸(참가자일 때)
  let needsSync = true;
  let lastSent = 0;
  let lastSentKey = '';
  let staticLayer = null;
  let cam = { x: 0, y: 0, scale: 1, ox: 0, oy: 0, ready: false };
  let resultKey = '';
  let introKey = '';
  let lastSecond = '';
  const remote = new Map();
  const avatars = new Map();
  const particles = [];
  const floaters = [];
  const appear = { stairs: 0, gate: 0, door: 0 };
  const pointers = new Map();
  const keys = new Set();
  const input = { walk: 0, jump: false, jumpAge: 0, hop: 0 };
  let landedAt = 0;
  let wasGrounded = true;
  let bannerTimer = 0;

  const player = () => state?.players.find(p => p.id === viewer.id);
  const atGoal = id => state?.objects?.atGoal?.includes(id);
  const canControl = () => !!(me && state?.phase === 'playing' && !atGoal(viewer.id));
  const mode = () => (viewer.role === 'host' ? 'host' : player() ? 'player' : 'watch');
  const play = cue => { try { audio?.play(cue, { channel: 'coop' }); } catch { /* 소리는 없어도 된다 */ } };
  void loadArt();

  // ---------- 화면 만들기 ----------
  function mount() {
    root = document.createElement('div');
    root.id = 'coop-room';
    root.className = 'coop-room';
    root.innerHTML = `
      <header class="coop-hud">
        <b class="coop-title">블록 놀이터</b>
        <span class="coop-goal"></span>
        <span class="coop-timer" role="timer"></span>
      </header>
      <canvas class="coop-canvas" aria-label="협동 게임방 화면"></canvas>
      <p class="coop-hint" aria-live="polite"></p>
      <div class="coop-banner" hidden></div>
      <section class="coop-intro" hidden></section>
      <section class="coop-result" hidden></section>
      <footer class="coop-bar"></footer>`;
    document.body.append(root);
    canvas = root.querySelector('canvas');
    ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', releaseAll);
    onCover(true);
    lastFrame = performance.now();
    frame = requestAnimationFrame(loop);
  }

  function renderBar() {
    const bar = root.querySelector('.coop-bar');
    const m = mode();
    root.classList.toggle('role-player', m === 'player');
    root.classList.toggle('role-watch', m === 'watch');
    root.classList.toggle('role-host', m === 'host');
    const cheer = `<div class="coop-cheers" role="group" aria-label="응원하기">
        <button type="button" data-cheer="heart">${heartSvg()}<span>하트</span></button>
        <button type="button" data-cheer="clap"><b>짝짝</b><span>박수</span></button>
        <button type="button" data-cheer="fire">${starSvg()}<span>최고</span></button>
      </div>`;
    if (m === 'player') {
      bar.innerHTML = '<p class="coop-controls"><b>길게 누르기</b> 그쪽으로 걷기 <i></i> <b>톡</b> 점프</p>';
    } else if (m === 'host') {
      bar.innerHTML = `${cheer}<div class="coop-host">
        <button type="button" class="coop-btn" data-coop="restart">다시 하기</button>
        <button type="button" class="coop-btn ghost" data-coop="close">게임방 닫기</button></div>`;
    } else {
      bar.innerHTML = `<p class="coop-watch">1~5등 친구들이 도전 중! 응원을 보내요</p>${cheer}`;
    }
    for (const b of bar.querySelectorAll('[data-cheer]')) b.onclick = () => {
      send('coopCheer', b.dataset.cheer);
      b.classList.remove('pop');
      void b.offsetWidth;
      b.classList.add('pop');
    };
    for (const b of bar.querySelectorAll('[data-coop]')) b.onclick = () => {
      if (b.dataset.coop === 'close') admin('coopClose');
      else admin('coopRestart');
    };
    bar.dataset.mode = m;
  }

  // ---------- 서버에서 오는 것 ----------
  function update(coop) {
    if (!coop) return close();
    const fresh = !state || state.id !== coop.id;
    const prevObjects = state?.objects;
    state = coop;
    level = LEVELS[coop.level] || LEVEL_1;
    if (!root) mount();
    if (fresh) resetSession();
    else if (prevObjects) {
      if (!prevObjects.stairs && coop.objects.stairs) appear.stairs = performance.now();
      if (!prevObjects.gate && coop.objects.gate) appear.gate = performance.now();
      if (!prevObjects.door && coop.objects.door) appear.door = performance.now();
      if (!prevObjects.keyHolder && coop.objects.keyHolder && !coop.objects.keyUsed) {
        banner(`${short(nameOf(coop.objects.keyHolder), 8)} 열쇠 잡았다!`);
      }
    }
    if (root.querySelector('.coop-bar').dataset.mode !== mode()) renderBar();
    root.classList.toggle('is-intro', coop.phase === 'intro');
    root.classList.toggle('is-playing', coop.phase === 'playing');
    root.classList.toggle('is-done', coop.phase === 'cleared' || coop.phase === 'failed');
    renderIntro();
    renderResult();
    renderHint();
    renderGoal();
  }

  function resetSession() {
    clock?.sync?.(3);
    remote.clear();
    particles.length = 0;
    appear.stairs = state.objects.stairs ? -1 : 0;
    appear.gate = state.objects.gate ? -1 : 0;
    appear.door = state.objects.door ? -1 : 0;
    staticLayer = null;
    cam.ready = false;
    resultKey = '';
    introKey = '';
    const mine = player();
    me = mine ? newBody(spawnPoint(level, mine.slot)) : null;
    needsSync = state.phase !== 'intro';
    lastSentKey = '';
    input.walk = 0;
    input.hop = 0;
    input.jump = false;
    renderBar();
  }

  function positions(list) {
    if (!state || !Array.isArray(list)) return;
    const now = performance.now();
    for (const item of list) {
      if (!Array.isArray(item)) continue;
      const [id, x, y, f = 1, on = null] = item;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (id === viewer.id) {
        // 다시 들어온 참가자는 서버가 기억하는 자리에서 이어서 한다.
        if (me && needsSync) Object.assign(me, { x, y, vx: 0, vy: 0 });
        needsSync = false;
        continue;
      }
      let r = remote.get(id);
      if (!r) {
        r = { samples: [], x, y, f, on, dx: 0, dy: 0, jumpAt: 0 };
        remote.set(id, r);
      }
      const last = r.samples.at(-1);
      if (last && last.y - y > 6 && Math.abs(last.y - y) < 40 && now - r.jumpAt > 250) r.jumpAt = now;
      r.samples.push({ t: now, x, y, f, on });
      if (r.samples.length > 12) r.samples.shift();
    }
  }

  function correct(p) {
    if (!me || !p) return;
    Object.assign(me, { x: p.x, y: p.y, vx: 0, vy: 0, on: null });
  }

  function nameOf(id) {
    return state?.players.find(p => p.id === id)?.name || '친구';
  }

  function event(e) {
    if (!state || !e || e.id !== state.id) return;
    const T = COOP.tile;
    switch (e.type) {
      case 'start':
        play('coop-start');
        banner('시작!');
        break;
      case 'stairs':
        appear.stairs = performance.now();
        play('coop-open');
        banner('계단이 생겼어요! 모두 올라와요');
        for (const r of level.stairs.blocks) sparkle(px(r).x + T / 2, px(r).y, '#f2c14e', 10);
        break;
      case 'gate': {
        appear.gate = performance.now();
        play('coop-open');
        banner('가로막이 열렸어요!');
        const g = px(level.gate.rect);
        for (let y = g.y; y < g.y + g.h; y += T * 2) sparkle(g.x + T / 2, y + T, '#5aa0d8', 6);
        break;
      }
      case 'key':
        // 누가 잡았는지는 바로 뒤에 오는 상태(objects.keyHolder)로 띄운다(update).
        play('coop-key');
        sparkle((level.key[0] + .5) * T, (level.key[1] + .5) * T, '#f2c14e', 16);
        break;
      case 'keyReturn':
        play('coop-key-return');
        banner('열쇠가 제자리로 돌아갔어요');
        break;
      case 'door': {
        appear.door = performance.now();
        play('coop-door');
        banner('문이 열렸어요! 모두 들어가요');
        const d = px(level.door);
        sparkle(d.x + d.w / 2, d.y + d.h / 2, '#f2c14e', 20);
        break;
      }
      case 'goal': {
        play('coop-goal');
        const d = px(level.door);
        sparkle(d.x + d.w / 2, d.y + d.h / 3, '#ffffff', 12);
        if (e.by === viewer.id) banner('골인! 친구들을 기다려요');
        break;
      }
      case 'cleared':
        play('coop-clear');
        confetti();
        break;
      case 'failed':
        play('coop-fail');
        break;
      default:
    }
  }

  function cheers(c) {
    if (!root || !c) return;
    const now = performance.now();
    for (const kind of ['heart', 'clap', 'fire']) {
      const n = Math.min(10, Math.max(0, Number(c[kind]) || 0));
      for (let i = 0; i < n; i++) {
        floaters.push({ kind, x: .08 + Math.random() * .84, t0: now + i * 70, life: 1700 + Math.random() * 500,
          drift: (Math.random() - .5) * 60, size: 18 + Math.random() * 10 });
      }
    }
    if (floaters.length > 80) floaters.splice(0, floaters.length - 80);
    if (mode() === 'player' && (c.heart || c.clap || c.fire)) play('coop-cheer');
  }

  function close() {
    if (!root) {
      state = null;
      return;
    }
    cancelAnimationFrame(frame);
    canvas.removeEventListener('pointerdown', pointerDown);
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('blur', releaseAll);
    releaseAll();
    clearTimeout(bannerTimer);
    root.remove();
    root = null;
    state = null;
    me = null;
    remote.clear();
    particles.length = 0;
    floaters.length = 0;
    audio?.stop?.('coop');
    onCover(false);
  }

  // ---------- 글자 영역 ----------
  function banner(text) {
    const el = root?.querySelector('.coop-banner');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { el.hidden = true; }, 2300);
  }

  function renderHint() {
    const o = state.objects;
    const step = !o.stairs ? 'stairs' : !o.gate ? 'gate' : !o.keyHolder && !o.keyUsed ? 'key' : !o.door ? 'door' : 'goal';
    const n = { stairs: 1, gate: 2, key: 3, door: 4, goal: 5 }[step];
    const el = root.querySelector('.coop-hint');
    const text = state.phase === 'playing' ? `${n}/5 · ${HINTS[step]}` : '';
    if (el.textContent !== text) el.textContent = text;
  }

  function renderGoal() {
    const total = state.players.filter(p => p.connected !== false).length;
    root.querySelector('.coop-goal').textContent = `골인 ${state.objects.atGoal.length}/${total}`;
  }

  function avatarImage(p) {
    const key = p.id + JSON.stringify(p.avatar || {});
    let img = avatars.get(key);
    if (!img) {
      try { img = avatarCanvas?.(p.avatar || {}, p.avatarKind || 'v05') || null; } catch { img = null; }
      avatars.set(key, img);
    }
    return img;
  }

  function renderIntro() {
    const el = root.querySelector('.coop-intro');
    el.hidden = state.phase !== 'intro';
    if (el.hidden || introKey === state.id) return;
    introKey = state.id;
    el.innerHTML = `<p class="coop-kicker">퀴즈 1~5등 초대</p>
      <h2>협동 게임방 · 블록 놀이터</h2>
      <ol class="coop-lineup"></ol>
      <p class="coop-count"></p>
      <p class="coop-howto">${mode() === 'player'
        ? '<b>길게 누르기</b> 걷기 · <b>톡</b> 점프 · 친구 머리를 밟고 올라가요'
        : '모두 함께 문까지 가면 성공! 휴대폰으로 응원해 주세요'}</p>`;
    const list = el.querySelector('.coop-lineup');
    for (const p of state.players) {
      const li = document.createElement('li');
      if (p.id === viewer.id) li.className = 'me';
      const img = avatarImage(p);
      if (img) {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        li.append(c);
      }
      if (p.rank) {
        const rank = document.createElement('em');
        rank.textContent = `${p.rank}등`;
        li.prepend(rank);
      }
      const name = document.createElement('span');
      name.textContent = short(p.name, 5);
      li.append(name);
      list.append(li);
    }
  }

  function renderResult() {
    const el = root.querySelector('.coop-result');
    const done = state.phase === 'cleared' || state.phase === 'failed';
    el.hidden = !done;
    const key = state.id + state.phase;
    if (!done || resultKey === key) return;
    resultKey = key;
    const o = state.objects;
    if (state.phase === 'cleared') {
      el.className = 'coop-result win';
      el.innerHTML = `<p class="coop-kicker">모두 골인</p><h2>성공!</h2>
        <p class="coop-time">${mmss(state.clearMs)}${state.newRecord ? ' <b>신기록!</b>' : ''}</p>
        <ol class="coop-photo"></ol>
        <p class="coop-best">${state.bestMs ? `이 교실 최고 기록 ${mmss(state.bestMs)}` : ''}</p>`;
    } else {
      const reached = o.door ? '문을 열었는데' : o.keyHolder || o.keyUsed ? '열쇠를 잡았는데' : o.gate ? '가로막을 열었는데'
        : o.stairs ? '언덕 계단까지 만들었는데' : '';
      el.className = 'coop-result lose';
      el.innerHTML = `<p class="coop-kicker">시간이 다 됐어요</p><h2>아깝다!</h2>
        <p class="coop-time">${reached ? `${reached} 조금 모자랐어요` : '다시 하면 깰 수 있어요'}</p>
        <ol class="coop-photo"></ol>`;
    }
    const photo = el.querySelector('.coop-photo');
    for (const [i, p] of state.players.entries()) {
      const li = document.createElement('li');
      li.style.setProperty('--d', `${i * 0.09}s`);
      const img = avatarImage(p);
      if (img) {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        li.append(c);
      }
      const name = document.createElement('span');
      name.textContent = short(p.name, 6);
      li.append(name);
      photo.append(li);
    }
  }

  // ---------- 조작 ----------
  function myScreenX() {
    return me ? (me.x - cam.x) * cam.scale + cam.ox : 0;
  }
  function sideOf(clientX) {
    const rect = canvas.getBoundingClientRect();
    const dx = clientX - rect.left - myScreenX();
    return Math.abs(dx) < 14 ? 0 : Math.sign(dx);
  }
  function updateWalk() {
    const walking = [...pointers.values()].filter(p => p.walking).at(-1);
    input.walk = walking ? (sideOf(walking.x) || me?.facing || 1) : 0;
  }
  function pointerDown(e) {
    if (!canControl()) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 캡처는 없어도 된다 */ }
    // stamp: 손가락이 닿은 실제 시각. 화면이 잠깐 버벅여도 톡과 길게 누르기를 바르게 가른다.
    const p = { stamp: e.timeStamp, x: e.clientX, walking: false, timer: 0 };
    p.timer = setTimeout(() => {
      p.walking = true;
      updateWalk();
    }, HOLD_MS);
    pointers.set(e.pointerId, p);
  }
  function pointerMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    if (p.walking) updateWalk();
  }
  function pointerUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    clearTimeout(p.timer);
    pointers.delete(e.pointerId);
    // 실제로 짧게 닿았으면 걷기 타이머가 먼저 돌았어도 점프. 걷기로 바뀌지 않은 짧은 누르기도 점프.
    const held = e.timeStamp - p.stamp;
    const tap = held < HOLD_MS || (!p.walking && held < 400);
    if (tap && e.type === 'pointerup' && canControl()) {
      input.jump = true;
      input.jumpAge = 0;
      input.hop = sideOf(p.x);
    }
    updateWalk();
  }
  function keyDown(e) {
    if (!canControl() || e.target?.closest?.('input, textarea')) return;
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(k)) {
      keys.add(k.toLowerCase().replace('arrow', ''));
      e.preventDefault();
    } else if ([' ', 'ArrowUp', 'w', 'W'].includes(k)) {
      if (!e.repeat) {
        input.jump = true;
        input.jumpAge = 0;
        input.hop = 0;
      }
      e.preventDefault();
    }
  }
  function keyUp(e) {
    keys.delete(e.key.toLowerCase().replace('arrow', ''));
  }
  function releaseAll() {
    for (const p of pointers.values()) clearTimeout(p.timer);
    pointers.clear();
    keys.clear();
    input.walk = 0;
  }
  function keyMove() {
    return (keys.has('right') || keys.has('d') ? 1 : 0) - (keys.has('left') || keys.has('a') ? 1 : 0);
  }

  // ---------- 매 프레임 ----------
  function loop(t) {
    frame = requestAnimationFrame(loop);
    if (!root || !state) return;
    const dt = Math.min(.05, Math.max(0, (t - lastFrame) / 1000));
    lastFrame = t;
    resize();
    const others = interpolateOthers(t);
    if (me && state.phase === 'playing' && !atGoal(viewer.id)) simulate(dt, others, t);
    if (me && state.phase === 'playing') maybeSend(t);
    updateCamera(dt);
    draw(t);
    renderClock();
  }

  function interpolateOthers(t) {
    const target = t - INTERP_MS;
    const list = [];
    for (const p of state.players) {
      if (p.id === viewer.id) continue;
      let r = remote.get(p.id);
      if (!r) {
        const s = spawnPoint(level, p.slot);
        r = { samples: [], x: s.x, y: s.y, f: 1, on: null, dx: 0, dy: 0, jumpAt: 0 };
        remote.set(p.id, r);
      }
      const s = r.samples;
      let x = r.x;
      let y = r.y;
      if (s.length) {
        const a = s[0];
        const b = s.at(-1);
        if (target <= a.t) ({ x, y } = a);
        else if (target >= b.t) ({ x, y } = b);
        else {
          for (let i = 0; i < s.length - 1; i++) {
            if (s[i].t <= target && target < s[i + 1].t) {
              const k = (target - s[i].t) / (s[i + 1].t - s[i].t);
              x = s[i].x + (s[i + 1].x - s[i].x) * k;
              y = s[i].y + (s[i + 1].y - s[i].y) * k;
              break;
            }
          }
        }
        r.f = b.f;
        r.on = b.on;
      }
      // 멀리 튀면(정정·재입장) 미끄러지지 않고 바로 옮긴다.
      const jump = Math.hypot(x - r.x, y - r.y) > 220;
      r.dx = jump ? 0 : x - r.x;
      r.dy = jump ? 0 : y - r.y;
      r.x = x;
      r.y = y;
      if (p.connected !== false && !atGoal(p.id)) list.push({ id: p.id, x, y, dx: r.dx, dy: r.dy });
    }
    return list;
  }

  function simulate(dt, others, now) {
    acc = Math.min(acc + dt, .1);
    const step = COOP.stepMs / 1000;
    const solids = solidRects(level, state.objects);
    const bounds = levelSize(level);
    let first = true;
    while (acc >= step) {
      acc -= step;
      const wantJump = input.jump;
      const move = input.walk || keyMove() || (!me.grounded || wantJump ? input.hop : 0);
      const before = me.grounded;
      stepBody(me, { move, jump: wantJump }, step,
        solids, first ? others : others.map(o => ({ ...o, dx: 0, dy: 0 })), bounds);
      first = false;
      if (wantJump && before && !me.grounded && me.vy < 0) {
        input.jump = false;
        play('coop-jump');
      } else if (wantJump) {
        input.jumpAge += step;
        if (input.jumpAge > JUMP_BUFFER_S) input.jump = false;
      }
      if (me.grounded && !wasGrounded) {
        landedAt = now;
        input.hop = 0;
        dust(me.x, me.y);
      }
      wasGrounded = me.grounded;
    }
  }

  function maybeSend(t) {
    if (t - lastSent < SEND_MS) return;
    const key = `${me.x.toFixed(1)},${me.y.toFixed(1)},${me.facing},${me.on}`;
    if (key === lastSentKey && t - lastSent < 1000) return;
    lastSent = t;
    lastSentKey = key;
    const r1 = n => Math.round(n * 10) / 10;
    send('coopMove', { id: state.id, x: r1(me.x), y: r1(me.y), vx: r1(me.vx), vy: r1(me.vy), f: me.facing, on: me.on });
  }

  function renderClock() {
    const now = clock?.now?.() ?? Date.now();
    let text = '';
    if (state.phase === 'intro') {
      const left = Math.max(0, Math.ceil((state.startAt - now) / 1000));
      const count = root.querySelector('.coop-count');
      const label = left > 0 ? `${left}초 뒤 시작` : '시작!';
      if (count && count.textContent !== label) count.textContent = label;
      text = mmss(level.seconds * 1000);
    } else if (state.phase === 'playing') text = mmss(state.endsAt - now);
    else if (state.phase === 'cleared') text = mmss(state.clearMs);
    else text = '0:00';
    if (text !== lastSecond) {
      lastSecond = text;
      const el = root.querySelector('.coop-timer');
      el.textContent = text;
      el.classList.toggle('low', state.phase === 'playing' && state.endsAt - now < 30000);
    }
  }

  // ---------- 카메라 ----------
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      cam.ready = false;
    }
  }

  function focusX() {
    if (me && !atGoal(viewer.id)) return me.x;
    const xs = state.players.filter(p => p.connected !== false && !atGoal(p.id) && p.id !== viewer.id)
      .map(p => remote.get(p.id)?.x).filter(Number.isFinite);
    if (me && !atGoal(viewer.id)) xs.push(me.x);
    if (!xs.length) return px(level.door).x;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  function updateCamera(dt) {
    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const size = levelSize(level);
    // 선생님(칠판)은 스테이지 전체. 학생은 좁은 화면에서도 캐릭터가 잘 보이게 가로 약 10~12칸을 보여 준다.
    let scale;
    if (mode() === 'host') scale = Math.min(w / size.width, h / size.height);
    else scale = Math.min(h / size.height, w / (mode() === 'player' ? 330 : 400), 1.6);
    const viewW = w / scale;
    const viewH = h / scale;
    const target = Math.max(0, Math.min(size.width - viewW, focusX() - viewW / 2));
    cam.scale = scale;
    cam.x = !cam.ready || mode() === 'host' ? target : cam.x + (target - cam.x) * Math.min(1, dt * 6);
    if (viewW >= size.width) cam.x = (size.width - viewW) / 2;
    cam.y = viewH >= size.height ? (size.height - viewH) / 2 : size.height - viewH;
    cam.ox = 0;
    cam.oy = 0;
    cam.dpr = dpr;
    cam.w = w;
    cam.h = h;
    cam.ready = true;
  }

  // ---------- 그리기 ----------
  function draw(t) {
    const c = ctx;
    const { dpr, scale } = cam;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (art.ready) drawWall(c);
    else drawSky(c, cam.w, cam.h);
    c.setTransform(dpr * scale, 0, 0, dpr * scale, -cam.x * scale * dpr, -cam.y * scale * dpr);
    if (art.ready) {
      drawFloorArt(c);
      drawSolidsArt(c);
    } else {
      if (!staticLayer) staticLayer = buildStatic();
      // 스테이지 바깥(화면이 더 클 때): 위는 트인 하늘, 옆은 벽, 아래는 바닥
      const size = levelSize(level);
      c.fillStyle = TEAL;
      c.fillRect(-4000, 0, 4000, size.height);
      c.fillRect(size.width, 0, 4000, size.height);
      c.fillStyle = '#e2b386';
      c.fillRect(-4000, size.height, size.width + 8000, 4000);
      c.drawImage(staticLayer, 0, 0);
    }
    drawStairs(c, t);
    drawGate(c, t);
    drawPlates(c, t);
    drawDoor(c, t);
    drawKey(c, t);
    const drawn = drawPlayers(c, t);
    updateParticles(c, t);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTags(c, drawn);
    drawFloaters(c, t);
  }

  // 놀이방 벽: 단색 두 겹(디자인 규칙상 그라데이션은 쓰지 않는다)
  function drawSky(c, w, h) {
    c.fillStyle = '#fcebe4';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#f7e0d6';
    c.fillRect(0, h * .62, w, h * .38);
  }

  // ---------- 그림(코덱스 16) ----------
  const floorTop = () => (level.h - 2) * COOP.tile;
  const view = () => ({ l: cam.x, r: cam.x + cam.w / cam.scale, b: cam.y + cam.h / cam.scale });

  // 크게 줄여 그리는 그림(칠판 전체 화면 등)은 화면 크기에 맞춰 한 번만 곱게 줄여 둔다.
  // 매 장면 '고화질로 줄이기'를 쓰면 느린 기기에서 초당 화면 수가 3분의 1로 떨어진다.
  const scaled = new Map();
  let scaledFor = 0;
  function sprite(name, w, h) {
    const img = art.img[name];
    const k = cam.scale * cam.dpr;
    const dw = Math.max(1, Math.round(w * k));
    const dh = Math.max(1, Math.round(h * k));
    if (dw >= img.width * .6) return img; // 많이 줄지 않으면 원본 그대로(기본 필터로 충분)
    if (scaledFor !== k) {
      scaled.clear();
      scaledFor = k;
    }
    const key = `${name}|${dw}|${dh}`;
    let small = scaled.get(key);
    if (!small) {
      small = document.createElement('canvas');
      small.width = dw;
      small.height = dh;
      const g = small.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, dw, dh);
      scaled.set(key, small);
    }
    return small;
  }
  const paint = (c, name, x, y, w = COOP_ART[name].w, h = COOP_ART[name].h) => c.drawImage(sprite(name, w, h), x, y, w, h);

  // 놀이방 벽: 화면 기준으로 그리고 걸레받이 아랫변을 바닥 윗면에 맞춘다. 한 장씩 좌우를 뒤집어 이어 이음새를 감춘다.
  function drawWall(c) {
    const img = art.img.wall;
    const bottom = (floorTop() - cam.y) * cam.scale;
    if (bottom <= 0) return;
    const w = img.width * bottom / img.height;
    const shift = cam.x * cam.scale * WALL_PARALLAX;
    for (let k = Math.floor(shift / w); k * w - shift < cam.w; k++) {
      const x = k * w - shift;
      if (k % 2 === 0) c.drawImage(img, x, 0, w + .5, bottom);
      else {
        c.save();
        c.translate(x + w, 0);
        c.scale(-1, 1);
        c.drawImage(img, -.5, 0, w + .5, bottom);
        c.restore();
      }
    }
  }

  // 바닥: 윗면 판자 한 줄(2칸) + 그 아래는 판자만 엇갈려 화면 끝까지
  function drawFloorArt(c) {
    const v = view();
    const top = COOP_ART.floor_top;
    const fill = COOP_ART.floor_fill;
    const y0 = floorTop();
    for (let x = Math.floor(v.l / top.w) * top.w; x < v.r; x += top.w) paint(c, 'floor_top', x, y0, top.w + .5, top.h);
    for (let y = y0 + top.h, row = 0; y < v.b; y += fill.h, row++) {
      const off = row % 2 ? fill.w / 2 : 0;
      for (let x = Math.floor((v.l - off) / fill.w) * fill.w + off; x < v.r; x += fill.w) {
        paint(c, 'floor_fill', x, y, fill.w + .5, fill.h + .5);
      }
    }
  }

  // 고정 블록: 한 칸에 블록 그림 하나. 바닥·천장은 따로 그리거나 그리지 않는다(위로 트인 놀이방).
  function drawSolidsArt(c) {
    const T = COOP.tile;
    const size = levelSize(level);
    const v = view();
    level.solids.forEach((r, i) => {
      const rect = px(r);
      if (rect.w >= size.width - 1) return;
      const frame = rect.h >= size.height - 1;
      const name = 'block_' + (frame ? 'wood' : BLOCK_ART[i % BLOCK_ART.length]);
      for (let y = rect.y; y < Math.min(rect.y + rect.h, floorTop()); y += T) {
        for (let x = rect.x; x < rect.x + rect.w; x += T) {
          if (x + T >= v.l && x <= v.r) paint(c, name, x, y, T, T);
        }
      }
    });
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function toyBlock(c, x, y, s, color) {
    roundRect(c, x + 1, y + 1, s - 2, s - 2, 6);
    c.fillStyle = color;
    c.fill();
    c.fillStyle = DARK[color] || '#0002';
    roundRect(c, x + 1, y + s - 8, s - 2, 7, 4);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,.5)';
    roundRect(c, x + 5, y + 4, s - 14, 4, 2);
    c.fill();
    c.beginPath();
    c.arc(x + s / 2, y + s / 2 - 1, 4.5, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,.35)';
    c.fill();
    c.strokeStyle = 'rgba(42,20,16,.18)';
    c.lineWidth = 1;
    roundRect(c, x + 1, y + 1, s - 2, s - 2, 6);
    c.stroke();
  }

  function buildStatic() {
    const size = levelSize(level);
    const T = COOP.tile;
    const layer = document.createElement('canvas');
    layer.width = size.width;
    layer.height = size.height;
    const c = layer.getContext('2d');
    // 벽 장식: 은은한 구름
    c.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 9; i++) {
      const cx = 140 + i * 230;
      const cy = 70 + (i % 3) * 28;
      for (const [dx, dy, r] of [[0, 0, 22], [22, -8, 26], [48, 0, 20]]) {
        c.beginPath();
        c.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
        c.fill();
      }
    }
    level.solids.forEach((r, i) => {
      const rect = px(r);
      const ceiling = rect.w >= size.width - 1 && rect.y === 0;
      const frame = rect.h >= size.height - 1;
      const floor = rect.y >= (level.h - 2) * T && rect.w >= size.width - 1;
      if (floor) {
        c.fillStyle = '#e2b386';
        c.fillRect(rect.x, rect.y, rect.w, rect.h);
        c.fillStyle = '#c8955f';
        c.fillRect(rect.x, rect.y, rect.w, 5);
        c.strokeStyle = 'rgba(120,70,40,.25)';
        for (let x = rect.x; x < rect.x + rect.w; x += 96) {
          c.beginPath();
          c.moveTo(x + (x / 96 % 2) * 40, rect.y + 6);
          c.lineTo(x + (x / 96 % 2) * 40, rect.y + rect.h);
          c.stroke();
        }
        return;
      }
      if (ceiling) return; // 천장은 막혀 있지만 그리지 않는다(위로 트인 놀이방처럼)
      if (frame) {
        c.fillStyle = TEAL;
        c.fillRect(rect.x, rect.y, rect.w, rect.h);
        return;
      }
      const color = BLOCKS[i % BLOCKS.length];
      for (let y = rect.y; y < rect.y + rect.h; y += T) {
        for (let x = rect.x; x < rect.x + rect.w; x += T) toyBlock(c, x, y, T, color);
      }
    });
    return layer;
  }

  function popScale(start, t, delay = 0) {
    if (start === -1) return 1;
    const k = Math.min(1, Math.max(0, (t - start - delay) / 380));
    const back = 1.70158;
    return 1 + (back + 1) * Math.pow(k - 1, 3) + back * Math.pow(k - 1, 2);
  }

  function drawStairs(c, t) {
    if (!state.objects.stairs) return;
    const T = COOP.tile;
    level.stairs.blocks.forEach((r, i) => {
      const rect = px(r);
      const s = Math.max(0, popScale(appear.stairs, t, i * 110));
      if (s <= 0) return;
      c.save();
      c.translate(rect.x + rect.w / 2, rect.y + rect.h);
      c.scale(s, s);
      for (let y = 0; y < rect.h; y += T) {
        if (art.ready) paint(c, 'block_butter', -rect.w / 2, -rect.h + y, T, T);
        else toyBlock(c, -rect.w / 2, -rect.h + y, T, '#f6d58a');
      }
      c.restore();
    });
  }

  function drawGate(c, t) {
    const g = px(level.gate.rect);
    let alpha = 1;
    let lift = 0;
    if (state.objects.gate) {
      if (appear.gate === -1) return;
      const k = Math.min(1, (t - appear.gate) / 650);
      if (k >= 1) return;
      alpha = 1 - k;
      lift = -g.h * k * k;
    }
    c.save();
    c.globalAlpha = alpha;
    c.translate(0, lift);
    if (art.ready) {
      const s = COOP_ART.gate;
      paint(c, 'gate', g.x + (g.w - s.w) / 2, g.y + g.h - s.h);
      c.restore();
      return;
    }
    roundRect(c, g.x + 3, g.y, g.w - 6, g.h, 6);
    c.fillStyle = '#fff4ec';
    c.fill();
    c.save();
    c.clip();
    c.fillStyle = '#e46a5f';
    for (let y = g.y - 40; y < g.y + g.h; y += 28) {
      c.beginPath();
      c.moveTo(g.x, y);
      c.lineTo(g.x + g.w, y - 14);
      c.lineTo(g.x + g.w, y);
      c.lineTo(g.x, y + 14);
      c.closePath();
      c.fill();
    }
    c.restore();
    c.strokeStyle = '#2a1410';
    c.lineWidth = 2;
    roundRect(c, g.x + 3, g.y, g.w - 6, g.h, 6);
    c.stroke();
    c.restore();
  }

  function bodiesForPlates() {
    const list = [];
    if (me && !atGoal(viewer.id)) list.push(me);
    for (const p of state.players) {
      if (p.id === viewer.id || atGoal(p.id) || p.connected === false) continue;
      const r = remote.get(p.id);
      if (r) list.push(r);
    }
    return list;
  }

  // 버튼: 받침 위 동그란 머리. 밟으면 납작해지고, 아직 할 일이면 위에 번호표가 뜬다.
  function drawPlate(c, plate, color, kind, label, done, t) {
    const r = plateRect(plate);
    const pressed = done || plateDown(plate, bodiesForPlates());
    const cx = r.x + r.w / 2;
    const base = r.y + r.h;
    if (pressed && !done) {
      c.fillStyle = 'rgba(255,255,255,.55)';
      c.beginPath();
      c.ellipse(cx, base - 4, 20, 9, 0, 0, Math.PI * 2);
      c.fill();
    }
    if (art.ready) {
      const name = `button_${kind}_${pressed ? 'down' : 'up'}`;
      const s = COOP_ART[name];
      paint(c, name, cx - s.w / 2, base - s.h);
    } else {
      drawPlateShape(c, cx, base, color, pressed);
    }
    if (label && !done) {
      const y = base - (art.ready ? 34 : 26) + Math.sin(t / 260 + cx) * 2;
      c.beginPath();
      c.arc(cx, y, 9, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
      c.strokeStyle = '#2a1410';
      c.lineWidth = 1.5;
      c.stroke();
      c.fillStyle = '#fffaf2';
      c.font = '800 12px Pretendard, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, cx, y + .5);
    }
  }

  function drawPlateShape(c, cx, base, color, pressed) {
    c.fillStyle = '#7a5a48';
    roundRect(c, cx - 15, base - 5, 30, 5, 2);
    c.fill();
    c.beginPath();
    c.ellipse(cx, base - 5, 11, pressed ? 3 : 9, 0, Math.PI, 0);
    c.closePath();
    c.fillStyle = color;
    c.fill();
    c.strokeStyle = '#2a1410';
    c.lineWidth = 1.5;
    c.stroke();
  }

  function drawPlates(c, t) {
    drawPlate(c, level.stairs.plate, '#e0a92a', 'yellow', '!', state.objects.stairs, t);
    level.gate.plates.forEach((p, i) => drawPlate(c, p, '#4a8fc9', 'blue', String(i + 1), state.objects.gate, t));
  }

  // s는 예전 도형 열쇠 배율(1.1 = 떠 있는 열쇠, .9 = 머리 위에 든 열쇠)
  function keyShape(c, x, y, s) {
    if (art.ready) {
      const k = COOP_ART.key;
      const w = k.w * s / 1.1;
      const h = k.h * s / 1.1;
      paint(c, 'key', x - w / 2, y - h / 2, w, h);
      return;
    }
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    c.fillStyle = '#f2c14e';
    c.strokeStyle = '#2a1410';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(-7, 0, 6, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath();
    c.rect(-1, -2.5, 15, 5);
    c.rect(9, 2, 3, 4);
    c.rect(4, 2, 3, 3);
    c.fill();
    c.stroke();
    c.fillStyle = '#fff6';
    c.beginPath();
    c.arc(-8.5, -1.5, 2, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  function drawKey(c, t) {
    const o = state.objects;
    if (o.keyUsed) return;
    const T = COOP.tile;
    if (o.keyHolder) return; // 든 친구 머리 위에 그린다(drawPlayers)
    const x = (level.key[0] + .5) * T;
    const y = (level.key[1] + .5) * T + Math.sin(t / 300) * 3;
    c.save();
    c.globalAlpha = .35 + .2 * Math.sin(t / 200);
    c.fillStyle = '#fff3c4';
    c.beginPath();
    c.arc(x, y, 18, 0, Math.PI * 2);
    c.fill();
    c.restore();
    keyShape(c, x, y, 1.1);
  }

  function drawDoor(c, t) {
    const d = px(level.door);
    const o = state.objects;
    if (art.ready) {
      // 아치 바닥 가운데를 문 칸의 바닥 가운데에 맞춘다. 열린 문은 안쪽 빛이 살짝 숨쉬게.
      const name = o.door ? 'door_open' : 'door_closed';
      const s = COOP_ART[name];
      const ax = d.x + d.w / 2;
      const ay = d.y + d.h;
      paint(c, name, ax - s.ax, ay - s.ay);
      if (o.door) {
        c.fillStyle = `rgba(255,240,200,${.12 + .1 * Math.sin(t / 250)})`;
        c.beginPath();
        c.ellipse(ax, ay - s.ay * .45, d.w * .26, s.ay * .4, 0, 0, Math.PI * 2);
        c.fill();
      }
      return;
    }
    c.save();
    c.beginPath();
    c.moveTo(d.x, d.y + d.h);
    c.lineTo(d.x, d.y + d.w / 2);
    c.arc(d.x + d.w / 2, d.y + d.w / 2, d.w / 2, Math.PI, 0);
    c.lineTo(d.x + d.w, d.y + d.h);
    c.closePath();
    c.fillStyle = o.door ? '#3b2a2a' : '#b9784e';
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = '#2a1410';
    c.stroke();
    if (o.door) {
      // 열린 문 안쪽의 따뜻한 빛(단색 두 겹)
      c.fillStyle = `rgba(255,214,140,${.35 + .15 * Math.sin(t / 250)})`;
      c.beginPath();
      c.ellipse(d.x + d.w / 2, d.y + d.h * .68, d.w * .42, d.h * .3, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,236,190,.55)';
      c.beginPath();
      c.ellipse(d.x + d.w / 2, d.y + d.h * .7, d.w * .22, d.h * .16, 0, 0, Math.PI * 2);
      c.fill();
    } else {
      c.strokeStyle = 'rgba(42,20,16,.35)';
      c.lineWidth = 1.5;
      for (const x of [d.x + d.w / 3, d.x + d.w * 2 / 3]) {
        c.beginPath();
        c.moveTo(x, d.y + 14);
        c.lineTo(x, d.y + d.h);
        c.stroke();
      }
      // 자물쇠
      const lx = d.x + d.w / 2;
      const ly = d.y + d.h * .6;
      c.strokeStyle = '#2a1410';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(lx, ly - 6, 6, Math.PI, 0);
      c.stroke();
      roundRect(c, lx - 9, ly - 6, 18, 14, 3);
      c.fillStyle = '#f2c14e';
      c.fill();
      c.lineWidth = 2;
      c.stroke();
    }
    c.restore();
  }

  function drawAvatar(c, p, x, y, t, opts) {
    const img = avatarImage(p);
    const s = DRAW_H / 196;
    const squash = opts.squash || 0;
    c.save();
    c.translate(x, y);
    if (opts.grounded) {
      c.fillStyle = 'rgba(42,20,16,.16)';
      c.beginPath();
      c.ellipse(0, 0, 15, 4, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.rotate(opts.lean || 0);
    c.scale(1 + squash * .12, 1 - squash * .12);
    if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;
    if (img) c.drawImage(img, -72 * s, -218 * s, 144 * s, 224 * s);
    else {
      c.fillStyle = '#f4a99a';
      roundRect(c, -11, -44, 22, 44, 8);
      c.fill();
    }
    c.restore();
  }

  function drawPlayers(c, t) {
    const drawn = [];
    for (const p of state.players) {
      if (atGoal(p.id)) continue;
      const mine = p.id === viewer.id && me;
      const r = mine ? me : remote.get(p.id);
      if (!r) continue;
      const moving = mine ? Math.abs(me.vx) > 1 : Math.abs(r.dx) > .3;
      const grounded = mine ? me.grounded : !(r.dy < -.3 || r.dy > .3);
      const bob = moving && grounded ? Math.abs(Math.sin(t / 90)) * 2 : 0;
      const sinceLand = mine ? t - landedAt : 1000;
      const squash = sinceLand < 140 ? (1 - sinceLand / 140) : (!grounded ? -.4 : 0);
      const lean = moving ? (mine ? me.facing : Math.sign(r.dx)) * .06 : 0;
      drawAvatar(c, p, r.x, r.y - bob, t, { grounded, squash, lean, alpha: p.connected === false ? .35 : undefined });
      if (state.objects.keyHolder === p.id) keyShape(c, r.x, r.y - DRAW_H - 10 + Math.sin(t / 220) * 2, .9);
      drawn.push({ p, x: r.x, y: r.y, mine: !!mine, holder: state.objects.keyHolder === p.id });
    }
    return drawn;
  }

  // 이름표는 화면 글자 크기로 그린다. 옆 이름표와 겹치면 한 줄씩 위로 비켜 올린다.
  function drawTags(c, drawn) {
    c.font = '600 12px Pretendard, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const placed = [];
    const ordered = [...drawn].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || a.x - b.x);
    for (const d of ordered) {
      const sx = (d.x - cam.x) * cam.scale;
      let sy = (d.y - cam.y) * cam.scale - DRAW_H * cam.scale - (d.holder ? 30 : 12);
      const label = (d.p.connected === false ? '연결 끊김 · ' : '') + short(d.p.name, 5);
      const w = c.measureText(label).width + 12;
      for (let i = 0; i < 4 && placed.some(b => Math.abs(b.x - sx) < (b.w + w) / 2 + 2 && Math.abs(b.y - sy) < 19); i++) sy -= 19;
      placed.push({ x: sx, y: sy, w });
      roundRect(c, sx - w / 2, sy - 9, w, 18, 9);
      c.fillStyle = d.mine ? TEAL : 'rgba(255,250,242,.92)';
      c.fill();
      c.strokeStyle = d.mine ? TEAL : 'rgba(42,20,16,.25)';
      c.lineWidth = 1;
      c.stroke();
      c.fillStyle = d.mine ? '#fbe6df' : '#2a1410';
      c.fillText(label, sx, sy + .5);
      if (d.mine) {
        c.fillStyle = TEAL;
        c.beginPath();
        c.moveTo(sx - 5, sy + 9);
        c.lineTo(sx + 5, sy + 9);
        c.lineTo(sx, sy + 15);
        c.closePath();
        c.fill();
      }
    }
  }

  // ---------- 반짝이·먼지·응원 ----------
  function sparkle(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 120;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 700 + Math.random() * 400, t0: performance.now(), color, size: 2 + Math.random() * 3, star: true });
    }
  }
  function dust(x, y) {
    for (let i = 0; i < 6; i++) {
      particles.push({ x: x + (Math.random() - .5) * 16, y, vx: (Math.random() - .5) * 60, vy: -20 - Math.random() * 30,
        life: 380, t0: performance.now(), color: 'rgba(200,170,140,.7)', size: 2 + Math.random() * 2 });
    }
  }
  function confetti() {
    const d = px(level.door);
    const colors = ['#f4a99a', '#a8d8cc', '#f6d58a', '#b8c4ef', '#f2c14e', '#ffffff'];
    for (let i = 0; i < 90; i++) {
      const a = -Math.PI / 2 + (Math.random() - .5) * 1.6;
      const v = 200 + Math.random() * 320;
      particles.push({ x: d.x + d.w / 2, y: d.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1600 + Math.random() * 900,
        t0: performance.now(), color: colors[i % colors.length], size: 3 + Math.random() * 3, gravity: 380, rect: true });
    }
  }
  function updateParticles(c, t) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const age = t - p.t0;
      if (age > p.life) {
        particles.splice(i, 1);
        continue;
      }
      const s = age / 1000;
      const x = p.x + p.vx * s;
      const y = p.y + p.vy * s + .5 * (p.gravity ?? 160) * s * s;
      c.globalAlpha = 1 - age / p.life;
      c.fillStyle = p.color;
      if (p.rect) c.fillRect(x, y, p.size, p.size * .6);
      else {
        c.beginPath();
        c.arc(x, y, p.size, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;
  }
  function drawFloaters(c, t) {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      const age = t - f.t0;
      if (age < 0) continue;
      if (age > f.life) {
        floaters.splice(i, 1);
        continue;
      }
      const k = age / f.life;
      const x = f.x * cam.w + Math.sin(k * 6) * f.drift * .3 + f.drift * k;
      const y = cam.h - 20 - k * cam.h * .55;
      c.globalAlpha = Math.min(1, (1 - k) * 1.6);
      drawIcon(c, f.kind, x, y, f.size * (k < .15 ? k / .15 : 1));
    }
    c.globalAlpha = 1;
  }
  function drawIcon(c, kind, x, y, size) {
    c.save();
    c.translate(x, y);
    if (kind === 'heart') {
      const s = size / 20;
      c.scale(s, s);
      c.beginPath();
      c.moveTo(0, 6);
      c.bezierCurveTo(-14, -4, -8, -16, 0, -8);
      c.bezierCurveTo(8, -16, 14, -4, 0, 6);
      c.fillStyle = '#e46a5f';
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = '#2a1410';
      c.stroke();
    } else if (kind === 'fire') {
      const s = size / 20;
      c.scale(s, s);
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 4.5 : 10;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      c.fillStyle = '#f2c14e';
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = '#2a1410';
      c.stroke();
    } else {
      c.font = `800 ${Math.round(size * .75)}px Pretendard, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const w = size * 1.7;
      roundRect(c, -w / 2, -size / 2, w, size, size / 2);
      c.fillStyle = '#fffaf2';
      c.fill();
      c.strokeStyle = TEAL;
      c.lineWidth = 1.5;
      c.stroke();
      c.fillStyle = TEAL;
      c.fillText('짝!', 0, 1);
    }
    c.restore();
  }

  function destroy() {
    close();
  }

  return {
    update, positions, correct, event, cheers, close, destroy,
    get open() { return !!root; },
    get state() { return state; },
    debug: () => ({ me: me && { ...me }, cam: { ...cam }, floaters: floaters.length, phase: state?.phase, objects: state?.objects,
      remote: [...remote.entries()].map(([id, r]) => ({ id, x: r.x, y: r.y })) }),
  };
}

function heartSvg() {
  return '<svg viewBox="-12 -12 24 22" aria-hidden="true"><path d="M0 6C-14-4-8-16 0-8C8-16 14-4 0 6Z" fill="#e46a5f" stroke="#2a1410" stroke-width="1.5"/></svg>';
}
function starSvg() {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 4.5 : 10;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="-12 -12 24 24" aria-hidden="true"><polygon points="${pts}" fill="#f2c14e" stroke="#2a1410" stroke-width="1.5"/></svg>`;
}
