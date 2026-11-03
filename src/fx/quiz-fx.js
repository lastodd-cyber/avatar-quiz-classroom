// 퀴즈 연출 — 3·2·1 카운트다운과 "가장 빠른 정답자" 등장 연출
//
// 사용법(교실 화면에서):
//   import { createQuizFx } from './fx/quiz-fx.js';
//   const fx = createQuizFx();
//   await fx.countdown({ startAt, now: serverNow, question: '조선의 4대 임금은?' });  // '시작!' 순간에 끝난다
//   await fx.reveal({ winner, answer, podium, correctCount, total, seed: quizId });  // 등장 연출 → 결과 카드
//   fx.clear();                                                                      // 결과 카드 닫기
//
// winner = { name: '별명', ms: 2310, avatar: { image: 캔버스|이미지, head: {x, y, w, h}, face: {x, y, w, h}, smooth: false } }
//   image: 완성 아바타(정면). head: image 안에서 머리 영역(왕얼굴·컷인), face: 얼굴만 좁게(분신술의 작은 얼굴).
//   v05 아바타는 HEAD_V05 / FACE_V05를 그대로 넘기면 된다. 없으면 위쪽 절반을 쓴다.
//   smooth: false(기본)면 정수 배로 키워 픽셀 느낌을 살리고, true면 부드럽게 키운다.
// 시험 페이지: fx-lab.html (개발 서버에서 버튼으로 연출을 하나씩 재생)
// podium = [{ name, ms }, ...] 2·3등. seed가 같으면 모든 화면에서 같은 연출이 나온다.
// 연출 화면은 화면 전체 위에 겹쳐 그리며 클릭을 막지 않는다. 이름은 textContent로만 넣는다.

import './quiz-fx.css';
import { createSoundControl } from '../sound-control.js';
import { formatRecord, REVEAL_EFFECTS } from '../../shared/quiz-core.js';
import { TEMPLATE } from '../../shared/avatar-v05.js';

// 연출 id 목록은 서버와 같은 원본(shared/quiz-core.js의 REVEAL_EFFECTS)을 쓴다. 여기에는 표시 이름만 둔다.
const EFFECT_NAMES = {
  roll: '데굴데굴',
  bigface: '왕얼굴',
  cutin: '만화 컷인',
  drop: '쿵 낙하',
  clones: '분신술',
  spotlight: '스포트라이트',
  peek: '빼꼼',
  gacha: '뽑기 캡슐',
  fireworks: '불꽃놀이',
  balloon: '풍선',
  news: '속보',
  rocket: '로켓 낙하산',
};
export const EFFECTS = REVEAL_EFFECTS.filter(id => EFFECT_NAMES[id]).map(id => ({ id, name: EFFECT_NAMES[id] }));

// v05 템플릿(144×224)에서 머리 영역(정사각형). face는 작은 얼굴 배지용으로 더 좁게 자른 영역.
// 다른 아바타는 avatar.head / avatar.face를 직접 넘긴다. 정사각형이 아니면 가운데를 정사각형으로 자른다.
export const HEAD_V05 = { x: 24, y: 6, w: 96, h: 96 };
export const FACE_V05 = { x: 42, y: 41, w: 60, h: 60 };

const COLORS = ['#0f4c4f', '#f4b8a6', '#fbe6df', '#f2c14e', '#a9cfcb', '#e49a87'];
const INK = '#2a1410';
const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- 작은 도구 ----------
const wait = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));

function hashSeed(value) {
  const text = String(value ?? '');
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// seed가 같으면 같은 연출. exclude에 직전 연출 id를 넣으면 연달아 같은 연출이 나오지 않는다.
export function pickEffect(seed, exclude = []) {
  const pool = EFFECTS.filter(e => !exclude.includes(e.id));
  const list = pool.length ? pool : EFFECTS;
  return list[Math.floor(mulberry32(hashSeed(seed))() * list.length)].id;
}

// 기록 글자. 서버가 보낸 recordText(예: '2.48초')가 있으면 그대로, 없으면 퀴즈 화면과 같은 규칙(내림)으로 만든다.
export function recordLabel(entry) {
  if (typeof entry.recordText === 'string' && entry.recordText) return entry.recordText;
  return formatRecord(Math.max(0, entry.ms || 0));
}

function splitRecord(text) {
  const match = /^(.*?)(초)?$/.exec(text);
  return { value: match[1], unit: match[2] || '' };
}

// 레이어 변환: 화면 가운데 기준 (x, y)px 이동, 회전, 크기
function T(x = 0, y = 0, scale = 1, rotate = 0, sx = scale, sy = scale) {
  return `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${sx}, ${sy})`;
}

const EASE = {
  out: 'cubic-bezier(.2, .8, .2, 1)',
  in: 'cubic-bezier(.55, 0, 1, .45)',
  back: 'cubic-bezier(.34, 1.56, .64, 1)',
  snap: 'cubic-bezier(.7, 0, .3, 1)',
};

// ---------- 입자(색종이·별·먼지·충격파·집중선) ----------
class Particles {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.running = false;
    this.last = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(this.lite?.() ? 1.5 : 2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  add(item) {
    this.items.push({ age: 0, ...item });
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(t => this.frame(t));
    }
  }

  clear() {
    this.items = [];
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  frame(now) {
    // 첫 rAF 시각이 add() 때 잰 시각보다 이를 수 있다 → dt가 음수가 되지 않게 0~0.05초로 묶는다.
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = Math.max(this.last, now);
    const ctx = this.ctx;
    try {
      ctx.clearRect(0, 0, this.w, this.h);
      this.items = this.items.filter(p => (p.age += dt) < p.life);
      for (const p of this.items) {
        try {
          this.draw(ctx, p, dt);
        } catch {
          p.age = p.life; // 그리다 실패한 입자 하나만 버리고 나머지는 계속 그린다
        }
      }
    } finally {
      // 어떤 경우에도 루프 상태를 정리한다(예외로 루프가 멈춘 채 running=true로 남지 않게).
      if (this.items.length) requestAnimationFrame(t => this.frame(t));
      else this.running = false;
    }
  }

  draw(ctx, p, dt) {
    const k = Math.min(1, Math.max(0, p.age / p.life));
    ctx.save();
    if (p.type === 'piece') {
      p.vy += (p.gravity ?? 900) * dt;
      p.vx *= 1 - 0.8 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.shape === 'star') {
        drawStar(ctx, p.size, p.color);
      } else {
        // 색종이: 뒤집히는 느낌으로 세로 폭을 줄였다 늘린다
        const flip = Math.cos(p.age * p.flip);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, (-p.size * 0.6 * flip) / 2, p.size, p.size * 0.6 * flip);
      }
    } else if (p.type === 'dust') {
      const r = Math.max(0, p.r0 + (p.r1 - p.r0) * easeOut(k));
      ctx.globalAlpha = 0.85 * (1 - k);
      ctx.fillStyle = '#fbe6df';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x + p.dx * easeOut(k), p.y - r * 0.4, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (p.type === 'ring') {
      const r = Math.max(0, p.r0 + (p.r1 - p.r0) * easeOut(k));
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(0.5, p.width * (1 - k * 0.7));
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * (p.squash ?? 1), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.type === 'burst') {
      // 만화 집중 배경: 색이 번갈아 가는 부채꼴(그라데이션 없음)
      const fade = Math.min(1, p.age / 0.15) * (k > 0.85 ? (1 - k) / 0.15 : 1);
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.age * p.spin);
      const R = Math.hypot(this.w, this.h);
      const step = (Math.PI * 2) / p.rays;
      for (let i = 0; i < p.rays; i++) {
        ctx.fillStyle = p.colors[i % p.colors.length];
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, i * step, (i + 1) * step);
        ctx.closePath();
        ctx.fill();
      }
    } else if (p.type === 'speed') {
      ctx.globalAlpha = 0.9 * (1 - k);
      ctx.strokeStyle = p.color;
      ctx.lineCap = 'round';
      for (const line of p.lines) {
        const x = line.x + p.dir * line.v * p.age;
        ctx.lineWidth = line.w;
        ctx.beginPath();
        ctx.moveTo(x, line.y);
        ctx.lineTo(x + p.dir * line.len, line.y);
        ctx.stroke();
      }
    } else if (p.type === 'orbit') {
      for (let i = 0; i < p.count; i++) {
        const a = p.age * p.speed + (i * Math.PI * 2) / p.count;
        ctx.save();
        ctx.translate(p.cx + Math.cos(a) * p.r, p.cy + Math.sin(a) * p.r * 0.35);
        ctx.rotate(a * 2);
        ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
        drawStar(ctx, p.size, COLORS[3]);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  confetti(x, y, { count = 60, power = 900, spread = Math.PI * 0.9, angle = -Math.PI / 2, rng = Math.random, stars = 0.2, life = 2.2 } = {}) {
    // 휴대폰에서는 입자 수를 절반으로 줄인다
    const total = this.lite?.() ? Math.ceil(count / 2) : count;
    for (let i = 0; i < total; i++) {
      const a = angle + (rng() - 0.5) * spread;
      const v = power * (0.45 + rng() * 0.65);
      this.add({
        type: 'piece',
        shape: rng() < stars ? 'star' : 'rect',
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        rot: rng() * Math.PI,
        spin: (rng() - 0.5) * 14,
        flip: 6 + rng() * 10,
        size: 8 + rng() * 10,
        color: COLORS[Math.floor(rng() * COLORS.length)],
        life: life * (0.7 + rng() * 0.5),
      });
    }
  }

  dust(x, y, size = 30) {
    for (const side of [-1, 1]) this.add({ type: 'dust', x, y, dx: side * size * 1.6, r0: size * 0.2, r1: size * 0.7, life: 0.55 });
  }

  ring(x, y, r1, { color = '#fbe6df', width = 10, life = 0.6, squash = 1 } = {}) {
    this.add({ type: 'ring', x, y, r0: 10, r1, color, width, life, squash });
  }

  burst(x, y, { rays = 18, colors = ['#f4b8a6', '#fbe6df'], spin = 0.35, life = 3 } = {}) {
    this.add({ type: 'burst', x, y, rays, colors, spin, life });
  }

  speedLines(rect, { dir = -1, count = 26, color = '#fbe6df', life = 1.4, rng = Math.random } = {}) {
    const lines = Array.from({ length: count }, () => ({
      x: rect.x + rng() * rect.w,
      y: rect.y + rng() * rect.h,
      len: 60 + rng() * 160,
      v: 900 + rng() * 900,
      w: 2 + rng() * 5,
    }));
    this.add({ type: 'speed', lines, dir, color, life });
  }

  orbit(cx, cy, r, { count = 3, size = 12, speed = 7, life = 1.1 } = {}) {
    this.add({ type: 'orbit', cx, cy, r, count, size, speed, life });
  }
}

function easeOut(k) {
  return 1 - (1 - k) ** 3;
}

function drawStar(ctx, size, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? size * 0.45 : size;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, size * 0.18);
  ctx.fill();
  ctx.stroke();
}

// ---------- 아바타 그림 ----------
function sourceSize(image) {
  return { w: image.naturalWidth || image.width, h: image.naturalHeight || image.height };
}

// 정수 배로 키운 캔버스(픽셀이 고르게 보이도록). targetHeight에 가장 가까운 배율.
function avatarCanvas(avatar, targetHeight) {
  const { w, h } = sourceSize(avatar.image);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(avatar.image, 0, 0);
  const scale = avatar.smooth ? targetHeight / h : Math.max(1, Math.round(targetHeight / h));
  canvas.style.width = `${w * scale}px`;
  canvas.style.height = `${h * scale}px`;
  canvas.className = 'qfx-avatar' + (avatar.smooth ? ' is-smooth' : '');
  canvas.setAttribute('aria-hidden', 'true');
  return { el: canvas, width: w * scale, height: h * scale };
}

function headCanvas(avatar, area = 'head') {
  const { w, h } = sourceSize(avatar.image);
  const base = (area === 'face' && avatar.face) || avatar.head || { x: 0, y: 0, w, h: Math.round(h / 2) };
  // 상자는 boxScale 배로 키워 쓴다(v05 2배 부품 256×416이면 2).
  const k = avatar.boxScale || 1;
  const rect = { x: base.x * k, y: base.y * k, w: base.w * k, h: base.h * k };
  // 동그란 액자에 넣으므로 가운데를 정사각형으로 자른다(그림이 늘어나지 않게).
  const side = Math.min(rect.w, rect.h);
  const head = { x: rect.x + (rect.w - side) / 2, y: rect.y + (rect.h - side) / 2, w: side, h: side };
  const canvas = document.createElement('canvas');
  canvas.width = head.w;
  canvas.height = head.h;
  canvas.getContext('2d').drawImage(avatar.image, head.x, head.y, head.w, head.h, 0, 0, head.w, head.h);
  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
}

// 머리를 동그란 액자에 넣은 요소. size는 화면 px.
function headBadge(avatar, size, area = 'head') {
  const frame = document.createElement('div');
  frame.className = 'qfx-head-frame';
  frame.style.width = `${size}px`;
  frame.style.height = `${size}px`;
  const canvas = headCanvas(avatar, area);
  canvas.style.imageRendering = avatar.smooth ? 'auto' : 'pixelated';
  frame.append(canvas);
  return frame;
}

function crownSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 64');
  svg.setAttribute('class', 'qfx-crown');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M6 58 L10 16 L32 38 L50 6 L68 38 L90 16 L94 58 Z');
  path.setAttribute('fill', '#f2c14e');
  path.setAttribute('stroke', INK);
  path.setAttribute('stroke-width', '6');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  for (const cx of [10, 50, 90]) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', cx === 50 ? '8' : '16');
    dot.setAttribute('r', '6');
    dot.setAttribute('fill', '#f4b8a6');
    dot.setAttribute('stroke', INK);
    dot.setAttribute('stroke-width', '4');
    svg.append(dot);
  }
  return svg;
}

function textEl(className, text) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

// 긴 이름은 글자 크기를 줄여 한 줄에 맞춘다(자르지 않는다).
function fitText(el, maxPx, minPx = 16) {
  let size = maxPx;
  el.style.fontSize = `${size}px`;
  while (size > minPx && el.scrollWidth > el.clientWidth + 1) {
    size -= 2;
    el.style.fontSize = `${size}px`;
  }
}

// ---------- 연출 본체 ----------
// 옵션
//   serverNow: () => 서버 기준 현재 시각(ms). 카운트다운·공개 시작을 모든 화면에서 맞춘다(기본 Date.now).
//   avatarCanvas: (avatar, avatarKind) => 캔버스. 서버 공개 데이터의 아바타 설정을 그림으로 바꾼다.
//   viewer: { id, role } — 내가 1등이면 "내가 1등!"으로 바뀐다.
//   compact: 휴대폰 화면(기본: 폭 768 미만). 카운트다운을 위쪽에만 띄워 답 입력칸을 가리지 않는다.
export function createQuizFx({
  parent = document.body,
  reducedMotion,
  serverNow = Date.now,
  avatarCanvas: renderAvatar = null,
  viewer = null,
  compact,
  audio,
} = {}) {
  const root = document.createElement('div');
  root.className = 'qfx-root';
  root.hidden = true;
  const backdrop = document.createElement('div');
  backdrop.className = 'qfx-backdrop';
  const canvas = document.createElement('canvas');
  canvas.className = 'qfx-canvas';
  const stage = document.createElement('div');
  stage.className = 'qfx-stage';
  const live = document.createElement('div');
  live.className = 'qfx-sr';
  live.setAttribute('aria-live', 'assertive');
  root.append(backdrop, canvas, stage, live);
  const soundControl = createSoundControl(audio, { overlay: true });
  if (soundControl) root.append(soundControl.button);
  parent.append(root);

  const particles = new Particles(canvas);
  particles.lite = () => isCompact();
  // 큰 글자 글꼴을 미리 받아 둔다. 글자 폭을 재기 전에 기다려야 화면 밖으로 넘치지 않는다.
  const fontReady = document.fonts?.load?.('48px QuizDisplay', '가장 빠른 정답!0123456789').catch(() => {}) ?? Promise.resolve();
  const waitFont = () => Promise.race([fontReady, wait(800)]);
  const reduce = reducedMotion ?? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let token = 0;
  let hideTimer = 0;
  let visibilityEpoch = 0;
  const onVisibility = () => { if (document.hidden) visibilityEpoch++; };
  document.addEventListener('visibilitychange', onVisibility);
  // 한 번 숨겨진 연출은 대기하던 작업이 끝나도 소리를 다시 시작하지 않는다.
  function captureSoundPermission() {
    const epoch = visibilityEpoch;
    const visible = !document.hidden;
    return () => visible && !document.hidden && epoch === visibilityEpoch;
  }

  const onResize = () => particles.resize();
  window.addEventListener('resize', onResize);

  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const vmin = () => Math.min(vw(), vh());
  const isCompact = () => compact ?? vw() < 768;

  function animate(el, keyframes, options) {
    const a = el.animate(keyframes, { fill: 'both', ...options });
    return a.finished.catch(() => {});
  }

  function layer(child, className = '') {
    const el = document.createElement('div');
    el.className = `qfx-layer ${className}`.trim();
    if (child) el.append(child);
    stage.append(el);
    return el;
  }

  function shake(power = 10, duration = 320) {
    const frames = [];
    for (let i = 0; i <= 8; i++) {
      const fall = 1 - i / 8;
      frames.push({ transform: `translate(${(i % 2 ? 1 : -1) * power * fall}px, ${((i * 7) % 3 - 1) * power * 0.6 * fall}px)` });
    }
    return animate(stage, frames, { duration, easing: 'linear', fill: 'none' });
  }

  function flash(color = '#fbe6df', duration = 220) {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;inset:0;background:${color}`;
    root.insertBefore(el, stage);
    return animate(el, [{ opacity: 0.9 }, { opacity: 0 }], { duration, easing: 'ease-out' }).then(() => el.remove());
  }

  function show() {
    clearTimeout(hideTimer);
    root.hidden = false;
    particles.resize();
  }

  function reset() {
    token++;
    audio?.stop('quiz');
    for (const a of root.getAnimations({ subtree: true })) a.cancel();
    stage.replaceChildren();
    stage.style.transform = '';
    for (const el of [...root.children]) if (![backdrop, canvas, stage, live, soundControl?.button].includes(el)) el.remove();
    particles.clear();
    return token;
  }

  function clear() {
    reset();
    root.hidden = true;
    backdrop.style.opacity = '0';
  }

  // ---------- 카운트다운 ----------
  // startAt: 서버 기준 '시작' 시각(ms). now(): 서버 기준 현재 시각을 돌려주는 함수.
  // '시작!'이 뜨는 순간 Promise가 끝난다(그때 답 입력을 열면 된다). 화면은 0.7초 뒤 저절로 사라진다.
  async function countdown({ startAt, now = serverNow, question = '' } = {}) {
    const maySound = captureSoundPermission();
    const my = reset();
    show();
    const alive = () => my === token;
    await waitFont();
    // 휴대폰: 배경을 덮지 않고 화면 위쪽에만 띄운다(입력칸을 눌러 키보드를 미리 열 수 있게).
    const small = isCompact();
    root.classList.toggle('is-compact', small);
    const cy = small ? -vh() * 0.3 : 0;
    if (!small) animate(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 250 });

    const ringSize = small ? Math.min(vmin() * 0.44, 220) : Math.min(vmin() * 0.64, 520);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'qfx-ring');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.style.width = `${ringSize}px`;
    svg.style.height = `${ringSize}px`;
    const track = document.createElementNS(SVG_NS, 'circle');
    const bar = document.createElementNS(SVG_NS, 'circle');
    for (const c of [track, bar]) {
      c.setAttribute('cx', '50');
      c.setAttribute('cy', '50');
      c.setAttribute('r', '44');
      c.setAttribute('stroke-width', '7');
    }
    track.setAttribute('class', 'track');
    bar.setAttribute('class', 'bar');
    bar.setAttribute('transform', 'rotate(-90 50 50)');
    const circumference = 2 * Math.PI * 44;
    bar.setAttribute('stroke-dasharray', String(circumference));
    svg.append(track, bar);
    if (small) {
      // 휴대폰: 위쪽에만 딥 틸 띠를 깔아 밝은 화면에서도 숫자가 보이게 한다(아래 입력칸은 가리지 않음).
      const band = document.createElement('div');
      band.className = 'qfx-band teal';
      band.style.left = '0';
      band.style.width = '100vw';
      band.style.height = `${ringSize + 36}px`;
      band.style.top = `${vh() / 2 + cy - (ringSize + 36) / 2}px`;
      stage.append(band);
      animate(band, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 220, easing: EASE.out });
    }
    const ringLayer = layer(svg);
    animate(ringLayer, [{ transform: T(0, cy, 0.6), opacity: 0 }, { transform: T(0, cy, 1), opacity: 1 }], { duration: 300, easing: EASE.back });

    if (question && !small) {
      const q = textEl('qfx-question', question);
      stage.append(q);
      animate(q, [{ opacity: 0, transform: 'translate(-50%, 20px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 300, easing: EASE.out });
    }

    for (const n of [3, 2, 1]) {
      const at = startAt - n * 1000;
      if (now() > at + 900) continue; // 늦게 들어온 화면은 지난 숫자를 건너뛴다
      await wait(at - now());
      if (!alive()) return;
      live.textContent = String(n);
      if (maySound()) audio?.play('countdown');
      const num = layer(textEl('qfx-count', String(n)));
      const tilt = n % 2 ? -8 : 8;
      animate(num, [
        { transform: T(0, cy, 2.4, tilt), opacity: 0 },
        { transform: T(0, cy, 0.92, 0), opacity: 1, offset: 0.28 },
        { transform: T(0, cy, 1.0, 0), opacity: 1, offset: 0.4 },
        { transform: T(0, cy, 1.0, 0), opacity: 1, offset: 0.82 },
        { transform: T(0, cy - ringSize * 0.08, 0.5, -tilt), opacity: 0 },
      ], { duration: 1000, easing: 'linear' }).then(() => num.remove());
      bar.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: circumference }], { duration: 1000, easing: 'linear', fill: 'both' });
      animate(ringLayer, [{ transform: T(0, cy, 1.08) }, { transform: T(0, cy, 1) }], { duration: 260, easing: EASE.out });
      if (!reduce) particles.confetti(vw() / 2, vh() / 2 + cy, { count: 10, power: 520, spread: Math.PI * 2, stars: 1, life: 0.9 });
    }

    await wait(startAt - now());
    if (!alive()) return;
    live.textContent = '시작';
    if (maySound()) audio?.play('go');
    ringLayer.remove();
    const go = layer(textEl('qfx-count is-go', '시작!'));
    animate(go, [
      { transform: T(0, cy, 0.3, -10), opacity: 0 },
      { transform: T(0, cy, 1.15, 4), opacity: 1, offset: 0.45 },
      { transform: T(0, cy, 1, 0), opacity: 1 },
    ], { duration: 360, easing: EASE.out });
    if (!reduce) {
      if (!small) flash('#f2c14e', 180);
      particles.ring(vw() / 2, vh() / 2 + cy, ringSize * 0.85, { color: '#f2c14e', width: small ? 8 : 14 });
      particles.confetti(vw() / 2, vh() / 2 + cy + ringSize * 0.2, { count: small ? 36 : 70, power: small ? 700 : 1100 });
    }
    hideTimer = setTimeout(() => {
      if (!alive()) return;
      animate(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'none' }).then(() => {
        if (alive()) clear();
      });
    }, 700);
  }

  // ---------- 결과 카드 ----------
  function card({ winner, answer, podium = [], correctCount, total, nearMiss = false, isMe = false, mine = '', explanation = '' }) {
    const el = document.createElement('div');
    el.className = 'qfx-card';
    const avatarBox = document.createElement('div');
    avatarBox.className = 'qfx-card-avatar';
    const portrait = avatarCanvas(winner.avatar, Math.min(vh() * 0.42, vw() < 640 ? 210 : 420));
    avatarBox.append(portrait.el, crownSvg());
    const body = document.createElement('div');
    body.className = 'qfx-card-body';
    body.append(textEl(isMe ? 'qfx-kicker is-me' : 'qfx-kicker', isMe ? '내가 1등!' : '가장 빠른 정답!'));
    if (nearMiss) body.append(textEl('qfx-near', '간발의 차!'));
    const name = textEl('qfx-name', winner.name);
    body.append(name);
    const time = document.createElement('div');
    time.className = 'qfx-time';
    const record = splitRecord(recordLabel(winner));
    time.append(record.value);
    const unit = document.createElement('small');
    unit.textContent = record.unit;
    time.append(unit);
    body.append(time);
    // 이번 문제에서 받은 점수(빠를수록 높음, 500~1000점)
    if (Number.isFinite(winner.gained)) body.append(textEl('qfx-gain', `+${winner.gained.toLocaleString('ko-KR')}점`));
    if (answer) {
      const ans = document.createElement('div');
      ans.className = 'qfx-answer';
      ans.append('정답 ');
      const b = document.createElement('b');
      b.textContent = answer;
      ans.append(b);
      body.append(ans);
    }
    if (explanation) body.append(textEl('qfx-meta', `해설 ${explanation}`));
    if (Number.isFinite(correctCount) && Number.isFinite(total)) body.append(textEl('qfx-meta', `정답 ${correctCount}명 / ${total}명 중`));
    if (podium.length) {
      const list = document.createElement('div');
      list.className = 'qfx-podium';
      podium.slice(0, 2).forEach((p, i) => {
        const chip = document.createElement('span');
        const rank = document.createElement('em');
        rank.textContent = `${i + 2}등`;
        chip.append(rank, `${p.name} ${recordLabel(p)}`);
        list.append(chip);
      });
      body.append(list);
    }
    // 내 결과 한 줄(퀴즈 화면이 계산해서 넘김). 예: '내 기록 3.21초 · 5등', '아쉬워요! 다음 문제에서 만나요'
    if (mine) body.append(textEl('qfx-mine', mine));
    el.append(avatarBox, body);
    return { el, name };
  }

  async function showCard(data, my) {
    const { el, name } = card(data);
    const holder = layer(el);
    fitText(name, Math.min(vmin() * 0.11, 88));
    live.textContent = `${data.isMe ? '내가 1등' : '가장 빠른 정답자'} ${data.winner.name}, ${recordLabel(data.winner)}`;
    await animate(holder, [
      { transform: T(0, 40, 0.6), opacity: 0 },
      { transform: T(0, -6, 1.04), opacity: 1, offset: 0.6 },
      { transform: T(0, 0, 1), opacity: 1 },
    ], { duration: 520, easing: EASE.out });
    if (my !== token || reduce) return;
    const crown = el.querySelector('.qfx-crown');
    animate(crown, [
      { transform: 'translate(-50%, -260%) rotate(-30deg)', opacity: 0 },
      { transform: 'translate(-50%, -60%) rotate(-8deg)', opacity: 1, offset: 0.7 },
      { transform: 'translate(-50%, -70%) rotate(-8deg)' },
      { transform: 'translate(-50%, -60%) rotate(-8deg)' },
    ], { duration: 700, easing: EASE.out });
    const rect = el.getBoundingClientRect();
    particles.confetti(rect.left + rect.width * 0.25, rect.top, { count: 40, power: 700 });
    particles.confetti(rect.right - rect.width * 0.2, rect.top, { count: 40, power: 700 });
    if (data.isMe) particles.confetti(vw() / 2, vh(), { count: 90, power: 1400 });
    const near = el.querySelector('.qfx-near');
    if (near) animate(near, [{ transform: 'rotate(-6deg) scale(2.2)', opacity: 0 }, { transform: 'rotate(-6deg) scale(1)', opacity: 1 }], { duration: 300, delay: 250, easing: EASE.in });
  }

  // ---------- 등장 연출 12종 ----------
  // 각 연출은 결과 카드 직전까지 그린다. ctx: { winner, rng, alive }
  const effects = {
    async roll({ winner, alive }) {
      const av = avatarCanvas(winner.avatar, vmin() * 0.5);
      const wrap = layer(av.el);
      const groundY = vh() * 0.12;
      const startX = -(vw() / 2 + av.width);
      const hop = av.height * 0.28;
      animate(wrap, [
        { transform: T(startX, groundY), offset: 0 },
        { transform: T(startX * 0.55, groundY - hop), offset: 0.22 },
        { transform: T(startX * 0.3, groundY), offset: 0.45 },
        { transform: T(startX * 0.12, groundY - hop * 0.45), offset: 0.63 },
        { transform: T(startX * 0.04, groundY), offset: 0.8 },
        { transform: T(0, groundY), offset: 1 },
      ], { duration: 1500, easing: 'linear' });
      animate(av.el, [{ transform: 'rotate(0deg) scale(.82)' }, { transform: 'rotate(1080deg) scale(.82)' }], { duration: 1500, easing: 'cubic-bezier(.25,.6,.35,1)' });
      const floorY = vh() / 2 + groundY + av.height * 0.41;
      for (const [t, k] of [[675, 0.3], [1200, 0.04], [1500, 0]]) {
        setTimeout(() => alive() && particles.dust(vw() / 2 + startX * k, floorY, av.width * 0.35), t);
      }
      await wait(1500);
      if (!alive()) return;
      shake(6, 220);
      await animate(av.el, [
        { transform: 'rotate(0deg) scale(.82)' },
        { transform: 'rotate(0deg) scale(1.05, .72)', offset: 0.3 },
        { transform: 'rotate(0deg) scale(.95, 1.08)', offset: 0.65 },
        { transform: 'rotate(0deg) scale(1)' },
      ], { duration: 480, easing: EASE.out });
      if (!alive()) return;
      particles.orbit(vw() / 2, vh() / 2 + groundY - av.height * 0.42, av.width * 0.36, { life: 1.2 });
      await animate(av.el, [
        { transform: 'rotate(0deg)' }, { transform: 'rotate(-7deg)' }, { transform: 'rotate(6deg)' },
        { transform: 'rotate(-4deg)' }, { transform: 'rotate(0deg)' },
      ], { duration: 1000, easing: 'ease-in-out' });
      if (!alive()) return;
      await animate(wrap, [{ transform: T(0, groundY), opacity: 1 }, { transform: T(0, groundY - av.height * 0.5, 0.6), opacity: 0 }], { duration: 300, easing: EASE.in });
      wrap.remove();
    },

    async bigface({ winner, alive }) {
      particles.burst(vw() / 2, vh() / 2, { rays: 22, colors: ['#f4b8a6', '#fbe6df'], life: 3.1 });
      const size = vmin() * 0.62;
      const badge = layer(headBadge(winner.avatar, size));
      await animate(badge, [
        { transform: T(0, 0, 0.05, -40) },
        { transform: T(0, 0, 1.18, 6), offset: 0.55 },
        { transform: T(0, 0, 0.92, -3), offset: 0.75 },
        { transform: T(0, 0, 1.04, 1), offset: 0.9 },
        { transform: T(0, 0, 1, 0) },
      ], { duration: 900, easing: EASE.out });
      if (!alive()) return;
      shake(12, 300);
      // 젤리처럼 출렁
      await animate(badge, [
        { transform: T(0, 0, 1, 0, 1, 1) },
        { transform: T(0, 0, 1, 0, 1.1, 0.9) },
        { transform: T(0, 0, 1, 0, 0.94, 1.07) },
        { transform: T(0, 0, 1, 0, 1.05, 0.96) },
        { transform: T(0, 0, 1, 0, 1, 1) },
      ], { duration: 620, easing: 'ease-in-out' });
      if (!alive()) return;
      const stamp = layer(textEl('qfx-stamp', '정답!'));
      await animate(stamp, [
        { transform: T(size * 0.32, size * 0.36, 3.2, -24), opacity: 0 },
        { transform: T(size * 0.32, size * 0.36, 0.9, -12), opacity: 1, offset: 0.7 },
        { transform: T(size * 0.32, size * 0.36, 1, -12), opacity: 1 },
      ], { duration: 280, easing: EASE.in });
      if (!alive()) return;
      shake(16, 260);
      particles.confetti(vw() / 2 + size * 0.32, vh() / 2 + size * 0.36, { count: 26, power: 760, spread: Math.PI * 2, stars: 1, life: 1.2 });
      await wait(700);
      if (!alive()) return;
      await Promise.all([
        animate(badge, [{ transform: T(0, 0, 1), opacity: 1 }, { transform: T(0, -vh() * 0.2, 0.3, 20), opacity: 0 }], { duration: 320, easing: EASE.in }),
        animate(stamp, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }),
      ]);
      badge.remove();
      stamp.remove();
    },

    async cutin({ winner, rng, alive }) {
      const bandH = Math.min(vmin() * 0.34, 300);
      const teal = document.createElement('div');
      teal.className = 'qfx-band teal';
      teal.style.top = `${vh() / 2 - bandH / 2}px`;
      const salmon = document.createElement('div');
      salmon.className = 'qfx-band salmon';
      salmon.style.height = `${bandH * 1.35}px`;
      salmon.style.top = `${vh() / 2 - bandH * 0.675}px`;
      stage.append(salmon, teal);
      const tilt = 'rotate(-7deg)';
      animate(salmon, [{ transform: `${tilt} translateX(-140vw)` }, { transform: `${tilt} translateX(0)` }], { duration: 260, easing: EASE.snap });
      await animate(teal, [{ transform: `${tilt} translateX(140vw)` }, { transform: `${tilt} translateX(0)` }], { duration: 300, delay: 60, easing: EASE.snap });
      if (!alive()) return;
      particles.speedLines({ x: 0, y: vh() / 2 - bandH / 2, w: vw(), h: bandH }, { dir: -1, life: 1.7, rng });
      const headSize = bandH * 1.25;
      const badge = layer(headBadge(winner.avatar, headSize));
      const text = layer(textEl('qfx-stamp', '가장 빠른 정답!'));
      const hx = -Math.min(vw() * 0.28, 320);
      // 글자는 얼굴 오른쪽에 붙이고, 화면을 넘으면 글자 크기를 줄인다
      const gap = 24;
      const room = vw() / 2 - (hx + headSize / 2) - gap - 16;
      let fontPx = Math.min(vmin() * 0.11, 92);
      text.style.fontSize = `${fontPx}px`;
      while (fontPx > 18 && text.offsetWidth > room) {
        fontPx -= 2;
        text.style.fontSize = `${fontPx}px`;
      }
      let tx = hx + headSize / 2 + gap + text.offsetWidth / 2;
      let ty = 0;
      if (fontPx < 34) {
        // 좁은 화면: 글자를 띠 아래 가운데로 내리고 화면 폭에 맞춘다
        fontPx = Math.min(vmin() * 0.11, 92);
        text.style.fontSize = `${fontPx}px`;
        while (fontPx > 18 && text.offsetWidth > vw() - 32) {
          fontPx -= 2;
          text.style.fontSize = `${fontPx}px`;
        }
        tx = 0;
        ty = bandH * 0.9;
      }
      animate(badge, [
        { transform: T(-vw(), 0, 1, -16) },
        { transform: T(hx + 30, 0, 1.06, 4), offset: 0.7 },
        { transform: T(hx, 0, 1, -4) },
      ], { duration: 420, easing: EASE.out });
      await animate(text, [
        { transform: T(vw(), ty, 1.4, -7), opacity: 0 },
        { transform: T(tx - 20, ty, 1, -7), opacity: 1, offset: 0.7 },
        { transform: T(tx, ty, 1, -7), opacity: 1 },
      ], { duration: 420, delay: 120, easing: EASE.out });
      if (!alive()) return;
      shake(8, 220);
      // 천천히 흘러가며 멈춘 듯한 컷
      animate(badge, [{ transform: T(hx, 0, 1, -4) }, { transform: T(hx + 24, 0, 1.03, -4) }], { duration: 1300, easing: 'linear' });
      animate(text, [{ transform: T(tx, ty, 1, -7) }, { transform: T(tx - 24, ty, 1, -7) }], { duration: 1300, easing: 'linear' });
      await wait(1300);
      if (!alive()) return;
      await Promise.all([teal, salmon, badge, text].map(el =>
        animate(el, [{ opacity: 1, clipPath: 'inset(0 0 0 0)' }, { opacity: 0, clipPath: 'inset(50% 0 50% 0)' }], { duration: 260, easing: EASE.in })));
      for (const el of [teal, salmon, badge, text]) el.remove();
    },

    async drop({ winner, alive }) {
      const av = avatarCanvas(winner.avatar, vmin() * 0.55);
      const groundY = vh() * 0.1;
      const shadow = document.createElement('div');
      shadow.style.cssText = `width:${av.width * 0.9}px;height:${av.width * 0.22}px;border-radius:50%;background:rgba(42,20,16,.45)`;
      const sLayer = layer(shadow);
      const floorY = groundY + av.height * 0.47;
      animate(sLayer, [{ transform: T(0, floorY, 0.15) , opacity: 0 }, { transform: T(0, floorY, 1), opacity: 1 }], { duration: 620, easing: EASE.in });
      const wrap = layer(av.el);
      await animate(wrap, [{ transform: T(0, -vh()), opacity: 1 }, { transform: T(0, groundY), opacity: 1 }], { duration: 620, easing: EASE.in });
      if (!alive()) return;
      shake(18, 380);
      particles.ring(vw() / 2, vh() / 2 + floorY, av.width * 1.6, { color: '#fbe6df', width: 12, squash: 0.32 });
      particles.dust(vw() / 2, vh() / 2 + floorY, av.width * 0.45);
      particles.confetti(vw() / 2, vh() / 2 + floorY, { count: 70, power: 1200 });
      await animate(av.el, [
        { transform: 'translateY(0) scale(1.25, .7)' },
        { transform: `translateY(${-av.height * 0.22}px) scale(.92, 1.1)`, offset: 0.35 },
        { transform: 'translateY(0) scale(1.1, .86)', offset: 0.6 },
        { transform: `translateY(${-av.height * 0.07}px) scale(.98, 1.03)`, offset: 0.8 },
        { transform: 'translateY(0) scale(1)' },
      ], { duration: 900, easing: 'ease-out' });
      if (!alive()) return;
      await wait(500);
      if (!alive()) return;
      await Promise.all([
        animate(wrap, [{ opacity: 1 }, { opacity: 0, transform: T(0, groundY - av.height * 0.3, 0.6) }], { duration: 280, easing: EASE.in }),
        animate(sLayer, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }),
      ]);
      wrap.remove();
      sLayer.remove();
    },

    async clones({ winner, rng, alive }) {
      const small = Math.max(36, vmin() * 0.11);
      const count = vw() < 640 ? 14 : 22;
      const radiusMax = vmin() * 0.42;
      const items = [];
      for (let i = 0; i < count; i++) {
        const el = layer(headBadge(winner.avatar, small, 'face'));
        const a = i * 2.39996; // 황금각으로 고르게 퍼진다
        const r = radiusMax * Math.sqrt((i + 1) / count);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r * 0.82;
        const spin = (rng() - 0.5) * 720;
        items.push({ el, x, y, spin });
        animate(el, [
          { transform: T(0, 0, 0.1, 0), opacity: 0 },
          { transform: T(x * 1.08, y * 1.08, 1.15, spin * 0.6), opacity: 1, offset: 0.7 },
          { transform: T(x, y, 1, spin), opacity: 1 },
        ], { duration: 520, delay: i * 38, easing: EASE.out });
      }
      await wait(520 + count * 38);
      if (!alive()) return;
      // 무리 전체가 한 바퀴 돈다
      await Promise.all(items.map(({ el, x, y, spin }) => {
        const frames = [];
        for (let s = 0; s <= 12; s++) {
          const t = (s / 12) * Math.PI * 2;
          const cx = x * Math.cos(t) - y * Math.sin(t);
          const cy = x * Math.sin(t) + y * Math.cos(t);
          frames.push({ transform: T(cx, cy, 1, spin + s * 30) });
        }
        return animate(el, frames, { duration: 1100, easing: 'ease-in-out' });
      }));
      if (!alive()) return;
      // 가운데로 모여 하나가 된다
      await Promise.all(items.map(({ el, x, y, spin }, i) =>
        animate(el, [{ transform: T(x, y, 1, spin + 360) }, { transform: T(0, 0, 0.2, spin + 540), opacity: 0 }], { duration: 360, delay: i * 14, easing: EASE.in })));
      for (const { el } of items) el.remove();
      if (!alive()) return;
      flash('#fbe6df', 240);
      particles.ring(vw() / 2, vh() / 2, vmin() * 0.5, { color: '#f2c14e', width: 16 });
      particles.confetti(vw() / 2, vh() / 2, { count: 60, power: 1000, spread: Math.PI * 2 });
      const big = layer(headBadge(winner.avatar, vmin() * 0.5));
      await animate(big, [{ transform: T(0, 0, 0.3), opacity: 0 }, { transform: T(0, 0, 1.12), opacity: 1, offset: 0.6 }, { transform: T(0, 0, 1) }], { duration: 420, easing: EASE.out });
      if (!alive()) return;
      await wait(500);
      if (!alive()) return;
      await animate(big, [{ opacity: 1 }, { opacity: 0, transform: T(0, -vh() * 0.15, 0.4) }], { duration: 280, easing: EASE.in });
      big.remove();
    },

    async spotlight({ winner, rng, alive }) {
      const spot = document.createElement('div');
      spot.className = 'qfx-spot';
      root.insertBefore(spot, stage);
      const drum = layer(textEl('qfx-drumroll', '두구두구...'));
      animate(drum, [{ transform: T(0, vh() * 0.36, 1), opacity: 0 }, { transform: T(0, vh() * 0.36, 1), opacity: 1 }], { duration: 200 });
      drum.animate([{ transform: T(0, vh() * 0.36, 1, -3) }, { transform: T(0, vh() * 0.36 - 6, 1.04, 3) }], { duration: 160, iterations: 14, direction: 'alternate' });
      const radius = vmin() * 0.27;
      spot.style.setProperty('--sr', `${radius}px`);
      // 원이 이곳저곳을 훑다가 가운데에 멈춘다
      let from = { x: vw() * 0.2, y: vh() * 0.3 };
      const stops = [
        { x: vw() * (0.65 + rng() * 0.2), y: vh() * (0.25 + rng() * 0.2) },
        { x: vw() * (0.15 + rng() * 0.2), y: vh() * (0.55 + rng() * 0.2) },
        { x: vw() * (0.7 + rng() * 0.15), y: vh() * (0.6 + rng() * 0.15) },
        { x: vw() / 2, y: vh() / 2 },
      ];
      for (const [i, to] of stops.entries()) {
        await tweenValue(i === stops.length - 1 ? 520 : 420, k => {
          const e = 1 - (1 - k) ** 3;
          spot.style.setProperty('--sx', `${from.x + (to.x - from.x) * e}px`);
          spot.style.setProperty('--sy', `${from.y + (to.y - from.y) * e}px`);
        });
        if (!alive()) return spot.remove();
        from = to;
      }
      drum.remove();
      const av = avatarCanvas(winner.avatar, radius * 1.8);
      const wrap = layer(av.el);
      tweenValue(260, k => spot.style.setProperty('--sr', `${radius * (1 + 0.35 * Math.sin(k * Math.PI))}px`));
      await animate(wrap, [{ transform: T(0, radius * 1.4, 0.6), opacity: 0 }, { transform: T(0, -radius * 0.12, 1.08), opacity: 1, offset: 0.7 }, { transform: T(0, 0, 1) }], { duration: 420, easing: EASE.out });
      if (!alive()) return spot.remove();
      particles.confetti(vw() * 0.1, vh() * 0.05, { count: 40, power: 900, angle: Math.PI * 0.25, spread: 0.8 });
      particles.confetti(vw() * 0.9, vh() * 0.05, { count: 40, power: 900, angle: Math.PI * 0.75, spread: 0.8 });
      await wait(900);
      if (!alive()) return spot.remove();
      await Promise.all([
        tweenValue(420, k => spot.style.setProperty('--sr', `${radius + k * Math.hypot(vw(), vh())}px`)),
        animate(wrap, [{ opacity: 1 }, { opacity: 0, transform: T(0, -radius * 0.5, 0.7) }], { duration: 300, delay: 120, easing: EASE.in }),
      ]);
      spot.remove();
      wrap.remove();
    },

    // ----- 2026-10-20 추가 6종 -----
    // 빼꼼: 왼쪽·오른쪽·아래 가장자리에서 얼굴이 빼꼼 내밀었다 숨고(0.56초씩), 1.68초에 가운데로 '짠!'
    async peek({ winner, alive }) {
      const size = vmin() * 0.34;
      const spots = [
        { x0: -vw() / 2 - size * 0.7, x1: -vw() / 2 + size * 0.36, y0: -vh() * 0.12, y1: -vh() * 0.12, r: 24 },
        { x0: vw() / 2 + size * 0.7, x1: vw() / 2 - size * 0.36, y0: vh() * 0.06, y1: vh() * 0.06, r: -24 },
        { x0: 0, x1: 0, y0: vh() / 2 + size * 0.7, y1: vh() / 2 - size * 0.32, r: 0 },
      ];
      for (const s of spots) {
        const el = layer(headBadge(winner.avatar, size));
        await animate(el, [
          { transform: T(s.x0, s.y0, 1, s.r) },
          { transform: T(s.x1, s.y1, 1, s.r), offset: 0.4 },
          { transform: T(s.x1, s.y1, 1, s.r * 0.4 + 10), offset: 0.56 },
          { transform: T(s.x1, s.y1, 1, s.r), offset: 0.72 },
          { transform: T(s.x0, s.y0, 1, s.r) },
        ], { duration: 560, easing: 'ease-in-out' });
        el.remove();
        if (!alive()) return;
      }
      const big = vmin() * 0.6;
      particles.burst(vw() / 2, vh() / 2, { rays: 20, colors: ['#f2c14e', '#fbe6df'], life: 2.4 });
      const badge = layer(headBadge(winner.avatar, big));
      await animate(badge, [{ transform: T(0, 0, 0.05, -30) }, { transform: T(0, 0, 1.15, 8), offset: 0.6 }, { transform: T(0, 0, 1, 0) }], { duration: 480, easing: EASE.back });
      if (!alive()) return;
      shake(10, 240);
      const stamp = layer(textEl('qfx-stamp', '짠!'));
      animate(stamp, [{ transform: T(big * 0.36, -big * 0.38, 2.6, 14), opacity: 0 }, { transform: T(big * 0.36, -big * 0.38, 1, 14), opacity: 1 }], { duration: 240, easing: EASE.in });
      particles.confetti(vw() / 2, vh() / 2, { count: 50, power: 950, spread: Math.PI * 2 });
      await wait(900);
      if (!alive()) return;
      await Promise.all([
        animate(badge, [{ opacity: 1 }, { opacity: 0, transform: T(0, -vh() * 0.18, 0.4) }], { duration: 300, easing: EASE.in }),
        animate(stamp, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }),
      ]);
      badge.remove();
      stamp.remove();
    },

    // 뽑기 캡슐: 0.48초에 떨어져 쿵, 덜컹덜컹 세 번(0.9·1.25·1.6초), 1.95초에 반으로 열리며 얼굴 등장
    async gacha({ winner, alive }) {
      const d = vmin() * 0.44;
      const cap = document.createElement('div');
      cap.className = 'qfx-capsule';
      cap.style.width = `${d}px`;
      cap.style.height = `${d}px`;
      const top = document.createElement('div');
      top.className = 'qfx-capsule-top';
      const bottom = document.createElement('div');
      bottom.className = 'qfx-capsule-bottom';
      const mark = textEl('qfx-capsule-mark', '?');
      cap.append(bottom, top, mark);
      const wrap = layer(cap);
      await animate(wrap, [{ transform: T(0, -vh() * 0.8, 1, -40) }, { transform: T(0, 0, 1, 0) }], { duration: 480, easing: EASE.in });
      if (!alive()) return;
      shake(10, 220);
      particles.dust(vw() / 2, vh() / 2 + d / 2, d * 0.4);
      await animate(cap, [{ transform: 'scale(1.18, .8)' }, { transform: 'scale(.94, 1.06)', offset: 0.5 }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
      for (const tilt of [16, -18, 22]) {
        await wait(90);
        if (!alive()) return;
        await animate(cap, [{ transform: 'rotate(0deg)' }, { transform: `rotate(${tilt}deg)` }, { transform: `rotate(${-tilt * 0.6}deg)` }, { transform: 'rotate(0deg)' }], { duration: 260, easing: 'ease-in-out' });
        if (!alive()) return;
      }
      await wait(90);
      if (!alive()) return;
      flash('#fbe6df', 200);
      shake(14, 260);
      mark.remove();
      animate(top, [{ transform: 'translate(0, 0) rotate(0deg)', opacity: 1 }, { transform: `translate(${-d * 0.9}px, ${-d * 1.1}px) rotate(-70deg)`, opacity: 0 }], { duration: 520, easing: EASE.out });
      animate(bottom, [{ transform: 'translate(0, 0) rotate(0deg)', opacity: 1 }, { transform: `translate(${d * 0.9}px, ${d * 0.9}px) rotate(60deg)`, opacity: 0 }], { duration: 520, easing: EASE.out });
      particles.burst(vw() / 2, vh() / 2, { rays: 18, colors: ['#f4b8a6', '#fbe6df'], life: 2 });
      particles.confetti(vw() / 2, vh() / 2, { count: 60, power: 1100, spread: Math.PI * 2, stars: 0.5 });
      const badge = layer(headBadge(winner.avatar, d * 1.2));
      await animate(badge, [{ transform: T(0, 0, 0.1, 0) }, { transform: T(0, 0, 1.15, -6), offset: 0.6 }, { transform: T(0, 0, 1, 0) }], { duration: 460, easing: EASE.back });
      wrap.remove();
      if (!alive()) return;
      await wait(800);
      if (!alive()) return;
      await animate(badge, [{ opacity: 1 }, { opacity: 0, transform: T(0, -vh() * 0.16, 0.5) }], { duration: 300, easing: EASE.in });
      badge.remove();
    },

    // 불꽃놀이: 불꽃 셋이 0.55·0.85·1.15초에 터지고, 마지막 불꽃이 1.85초에 가운데서 터지며 얼굴이 피어난다
    async fireworks({ winner, rng, alive }) {
      const night = document.createElement('div');
      night.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at 50% 30%, rgba(15,40,52,.55), rgba(8,20,28,.85))';
      root.insertBefore(night, stage);
      animate(night, [{ opacity: 0 }, { opacity: 1 }], { duration: 260 });
      const shoot = (x, y, duration) => {
        const trail = document.createElement('div');
        trail.className = 'qfx-rocket-trail';
        const el = layer(trail);
        return animate(el, [
          { transform: T(x - vw() / 2, vh() / 2 + 20, 1, 0), opacity: 1 },
          { transform: T(x - vw() / 2, y - vh() / 2, 1, 0), opacity: 1 },
        ], { duration, easing: 'cubic-bezier(.2,.7,.4,1)' }).then(() => el.remove());
      };
      const colors = [['#f2c14e', '#fbe6df'], ['#f4b8a6', '#a9cfcb'], ['#a9cfcb', '#f2c14e']];
      const shots = [
        { x: vw() * (0.2 + rng() * 0.1), y: vh() * 0.3, at: 0 },
        { x: vw() * (0.7 + rng() * 0.1), y: vh() * 0.24, at: 300 },
        { x: vw() * (0.42 + rng() * 0.16), y: vh() * 0.18, at: 600 },
      ];
      shots.forEach((s, i) => setTimeout(() => {
        if (!alive()) return;
        shoot(s.x, s.y, 550).then(() => {
          if (!alive()) return;
          particles.burst(s.x, s.y, { rays: 14, colors: colors[i], life: 1.1 });
          particles.confetti(s.x, s.y, { count: 46, power: 620, spread: Math.PI * 2, stars: 0.7, life: 1.6 });
        });
      }, s.at));
      await wait(1300);
      if (!alive()) return night.remove();
      await shoot(vw() / 2, vh() / 2, 550);
      if (!alive()) return night.remove();
      flash('#fbe6df', 220);
      shake(12, 280);
      particles.ring(vw() / 2, vh() / 2, vmin() * 0.55, { color: '#f2c14e', width: 14 });
      particles.burst(vw() / 2, vh() / 2, { rays: 24, colors: ['#f2c14e', '#fbe6df'], life: 2.4 });
      particles.confetti(vw() / 2, vh() / 2, { count: 90, power: 1200, spread: Math.PI * 2, stars: 0.8 });
      const badge = layer(headBadge(winner.avatar, vmin() * 0.56));
      await animate(badge, [{ transform: T(0, 0, 0.1, 0), opacity: 0 }, { transform: T(0, 0, 1.12, 0), opacity: 1, offset: 0.6 }, { transform: T(0, 0, 1, 0) }], { duration: 480, easing: EASE.out });
      if (!alive()) return night.remove();
      await wait(800);
      if (!alive()) return night.remove();
      await Promise.all([
        animate(badge, [{ opacity: 1 }, { opacity: 0, transform: T(0, -vh() * 0.15, 0.5) }], { duration: 300, easing: EASE.in }),
        animate(night, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 }),
      ]);
      badge.remove();
      night.remove();
    },

    // 풍선: 풍선을 들고 1.4초 동안 둥실 올라오고, 1.55·1.75·1.95초에 하나씩 터진 뒤 2.25초에 쿵 착지
    async balloon({ winner, rng, alive }) {
      const av = avatarCanvas(winner.avatar, vmin() * 0.42);
      const group = document.createElement('div');
      group.className = 'qfx-balloon-group';
      const bunch = document.createElementNS(SVG_NS, 'svg');
      bunch.setAttribute('viewBox', '0 0 120 150');
      bunch.setAttribute('class', 'qfx-balloons');
      bunch.style.width = `${av.height * 0.8}px`;
      bunch.style.height = `${av.height}px`;
      const balloons = [['#f4b8a6', 30, 40], ['#f2c14e', 62, 26], ['#a9cfcb', 92, 44]].map(([color, cx, cy]) => {
        const g = document.createElementNS(SVG_NS, 'g');
        const line = document.createElementNS(SVG_NS, 'path');
        line.setAttribute('d', `M${cx} ${cy + 26} Q ${(cx + 60) / 2 + (rng() - 0.5) * 12} ${cy + 70} 60 150`);
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke', INK);
        line.setAttribute('stroke-width', '2.4');
        const ball = document.createElementNS(SVG_NS, 'ellipse');
        ball.setAttribute('cx', String(cx));
        ball.setAttribute('cy', String(cy));
        ball.setAttribute('rx', '22');
        ball.setAttribute('ry', '27');
        ball.setAttribute('fill', color);
        ball.setAttribute('stroke', INK);
        ball.setAttribute('stroke-width', '4');
        const shine = document.createElementNS(SVG_NS, 'ellipse');
        shine.setAttribute('cx', String(cx - 8));
        shine.setAttribute('cy', String(cy - 10));
        shine.setAttribute('rx', '5');
        shine.setAttribute('ry', '8');
        shine.setAttribute('fill', '#fff');
        shine.setAttribute('opacity', '.6');
        g.append(line, ball, shine);
        bunch.append(g);
        return g;
      });
      group.append(bunch, av.el);
      const wrap = layer(group);
      // 풍선 다발+아바타를 화면에 넣고 높이를 잰다. 떠 있을 때도 착지할 때도 화면 안에 들어오게,
      // 너무 크면 풍선 다발부터 줄이고 그래도 크면 전체를 줄인다(발이 화면 밖으로 나가지 않게).
      const pad = Math.max(8, vh() * 0.03);
      const drop = vh() * 0.08; // 터진 뒤 떨어지는 최소 거리
      const maxH = vh() - pad * 2 - drop;
      const minBunch = av.height * 0.4;
      let bunchH = av.height;
      for (let i = 0; i < 3 && group.offsetHeight > maxH + 0.5 && bunchH > minBunch; i++) {
        bunchH = Math.max(minBunch, bunchH - (group.offsetHeight - maxH));
        bunch.style.width = `${bunchH * 0.8}px`;
        bunch.style.height = `${bunchH}px`;
      }
      const k = Math.min(1, maxH / group.offsetHeight);
      const half = group.offsetHeight * k / 2;
      // 자리는 예전 그대로(떠 있을 때 -6%, 착지 +10%)를 쓰되 화면 끝을 넘지 않게 묶는다
      const landY = Math.min(vh() * 0.1, vh() / 2 - pad - half);
      const restY = Math.max(pad + half - vh() / 2, Math.min(-vh() * 0.06, landY - drop));
      animate(wrap, [
        { transform: T(0, Math.max(vh() * 0.9, vh() / 2 + half + pad), k, -4) },
        { transform: T(vw() * 0.04, vh() * 0.3, k, 5), offset: 0.4 },
        { transform: T(-vw() * 0.03, restY + vh() * 0.04, k, -4), offset: 0.75 },
        { transform: T(0, restY, k, 2) },
      ], { duration: 1400, easing: 'ease-out' });
      await wait(1550);
      for (const [i, g] of balloons.entries()) {
        if (!alive()) return;
        const r = g.getBoundingClientRect();
        g.style.transformOrigin = 'center';
        g.style.transformBox = 'fill-box';
        animate(g, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 140, easing: 'ease-out' });
        particles.confetti(r.left + r.width / 2, r.top + r.height * 0.3, { count: 22, power: 520, spread: Math.PI * 2, life: 1 });
        if (i < balloons.length - 1) await wait(200);
      }
      if (!alive()) return;
      await animate(wrap, [{ transform: T(0, restY, k, 2) }, { transform: T(0, landY, k, 0) }], { duration: 300, easing: EASE.in });
      if (!alive()) return;
      shake(14, 300);
      // 먼지는 발밑(묶음의 맨 아래 = 아바타 발)에서
      particles.dust(vw() / 2, vh() / 2 + landY + half, av.width * 0.45 * k);
      await animate(av.el, [{ transform: 'scale(1.18, .78)' }, { transform: 'scale(.94, 1.06)', offset: 0.5 }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
      if (!alive()) return;
      await wait(300);
      if (!alive()) return;
      await animate(wrap, [{ opacity: 1 }, { opacity: 0, transform: T(0, 0, 0.6 * k) }], { duration: 280, easing: EASE.in });
      wrap.remove();
    },

    // 속보: '속보' 띠·TV 화면·이름 자막이 들어오고(0~0.6초), 자막이 흐르다 2.6초에 화면이 꺼진다
    async news({ winner, alive }) {
      const box = document.createElement('div');
      box.className = 'qfx-news';
      const boxW = Math.min(vw() * 0.86, vmin() * 1.1);
      box.style.width = `${boxW}px`;
      const tag = document.createElement('div');
      tag.className = 'qfx-news-tag';
      const dot = document.createElement('i');
      tag.append(dot, '속보');
      const tv = document.createElement('div');
      tv.className = 'qfx-tv';
      const av = avatarCanvas(winner.avatar, vmin() * 0.62);
      tv.style.height = `${av.height * 0.6}px`;
      tv.append(av.el);
      const bar = document.createElement('div');
      bar.className = 'qfx-news-bar';
      const title = document.createElement('b');
      title.textContent = `${winner.name}, 가장 빠른 정답!`;
      const ticker = document.createElement('div');
      ticker.className = 'qfx-news-ticker';
      const line = document.createElement('span');
      line.textContent = `● 교실 퀴즈 실시간 · ${winner.name} 1등 · 기록 ${recordLabel(winner)} · 모두 박수! `.repeat(3);
      ticker.append(line);
      bar.append(title, ticker);
      box.append(tag, tv, bar);
      const holder = layer(box);
      holder.style.transform = T(0, -vh() * 0.02);
      fitText(title, Math.min(vmin() * 0.07, 54), 16);
      animate(tv, [{ transform: 'scale(.2, .02)', opacity: 0 }, { transform: 'scale(1, .02)', opacity: 1, offset: 0.4 }, { transform: 'scale(1)' }], { duration: 420, easing: EASE.out });
      animate(tag, [{ transform: 'translateX(-60vw)' }, { transform: 'translateX(0)' }], { duration: 320, delay: 120, easing: EASE.snap });
      animate(bar, [{ transform: 'translateY(120%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 320, delay: 240, easing: EASE.out });
      dot.animate([{ opacity: 1 }, { opacity: 0.2 }], { duration: 400, iterations: 8, direction: 'alternate' });
      av.el.animate([{ transform: 'scale(1) translateY(0)' }, { transform: 'scale(1.08) translateY(4%)' }], { duration: 2400, fill: 'both', easing: 'ease-in-out' });
      line.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-50%)' }], { duration: 4000, fill: 'both', easing: 'linear' });
      await wait(700);
      if (!alive()) return;
      particles.confetti(vw() * 0.1, vh() * 0.1, { count: 30, power: 800, angle: Math.PI * 0.3, spread: 0.7 });
      particles.confetti(vw() * 0.9, vh() * 0.1, { count: 30, power: 800, angle: Math.PI * 0.7, spread: 0.7 });
      await wait(1900);
      if (!alive()) return;
      await animate(holder, [{ opacity: 1, clipPath: 'inset(0 0 0 0)' }, { opacity: 0.2, clipPath: 'inset(49.5% 0 49.5% 0)' }], { duration: 260, easing: EASE.in });
      holder.remove();
    },

    // 로켓 낙하산: 0.7초 동안 아래에서 위로 슝, 1.0초에 낙하산을 타고 내려와 2.35초에 착지
    async rocket({ winner, rng, alive }) {
      const av = avatarCanvas(winner.avatar, vmin() * 0.4);
      const flyer = layer(av.el);
      shake(8, 600);
      for (let t = 0; t <= 600; t += 75) {
        setTimeout(() => alive() && particles.dust(vw() / 2 + (rng() - 0.5) * 20, vh() - (t / 600) * vh() * 0.9, av.width * 0.22), t);
      }
      await animate(flyer, [{ transform: T(0, vh() / 2 + av.height, 1, 0) }, { transform: T(0, -vh() / 2 - av.height, 0.9, -6) }], { duration: 700, easing: EASE.in });
      flyer.remove();
      if (!alive()) return;
      await wait(300);
      if (!alive()) return;
      const group = document.createElement('div');
      group.className = 'qfx-chute-group';
      const chute = document.createElementNS(SVG_NS, 'svg');
      chute.setAttribute('viewBox', '0 0 140 90');
      chute.setAttribute('class', 'qfx-chute');
      chute.style.width = `${av.width * 1.35}px`;
      chute.style.height = `${av.width * 0.87}px`;
      const canopy = document.createElementNS(SVG_NS, 'path');
      canopy.setAttribute('d', 'M6 46 Q70 -26 134 46 Q117 36 100 46 Q85 36 70 46 Q55 36 40 46 Q23 36 6 46 Z');
      canopy.setAttribute('fill', '#f4b8a6');
      canopy.setAttribute('stroke', INK);
      canopy.setAttribute('stroke-width', '4');
      chute.append(canopy);
      for (const [x1, x2] of [[6, 56], [40, 62], [100, 78], [134, 84]]) {
        const cord = document.createElementNS(SVG_NS, 'line');
        cord.setAttribute('x1', String(x1));
        cord.setAttribute('y1', '46');
        cord.setAttribute('x2', String(x2));
        cord.setAttribute('y2', '90');
        cord.setAttribute('stroke', INK);
        cord.setAttribute('stroke-width', '2');
        chute.append(cord);
      }
      const stripe = document.createElementNS(SVG_NS, 'path');
      stripe.setAttribute('d', 'M70 12 Q60 30 70 46 Q80 30 70 12 Z');
      stripe.setAttribute('fill', '#fbe6df');
      chute.append(stripe);
      group.append(chute, av.el);
      const wrap = layer(group);
      const landY = vh() * 0.02;
      await animate(wrap, [
        { transform: T(-vw() * 0.06, -vh() / 2 - av.height, 1, -8) },
        { transform: T(vw() * 0.05, -vh() * 0.2, 1, 7), offset: 0.4 },
        { transform: T(-vw() * 0.03, -vh() * 0.04, 1, -5), offset: 0.75 },
        { transform: T(0, landY, 1, 0) },
      ], { duration: 1350, easing: 'ease-out' });
      if (!alive()) return;
      shake(10, 260);
      particles.dust(vw() / 2, vh() / 2 + landY + (av.width * 0.87 + av.height) / 2, av.width * 0.4);
      particles.confetti(vw() / 2, vh() / 2, { count: 40, power: 900, spread: Math.PI * 1.2 });
      animate(chute, [{ opacity: 1, transform: 'translateY(0) scaleY(1)' }, { opacity: 0, transform: `translateX(${av.width * 0.6}px) translateY(${av.width * 0.4}px) scaleY(.3) rotate(25deg)` }], { duration: 500, easing: EASE.in });
      await animate(av.el, [{ transform: 'scale(1.16, .8)' }, { transform: 'scale(.95, 1.05)', offset: 0.5 }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
      if (!alive()) return;
      await wait(350);
      if (!alive()) return;
      await animate(wrap, [{ opacity: 1 }, { opacity: 0, transform: T(0, landY - vh() * 0.1, 0.6) }], { duration: 280, easing: EASE.in });
      wrap.remove();
    },
  };

  function tweenValue(duration, onUpdate) {
    const start = performance.now();
    return new Promise(resolve => {
      const step = now => {
        const k = Math.min(1, (now - start) / duration);
        onUpdate(k);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  // 서버 공개 데이터(quizReveal, Handoff/설계_퀴즈.md 7-1)를 연출용 데이터로 바꾼다.
  function fromPayload(p) {
    const toAvatar = person => {
      const kind = person.avatarKind || 'v05';
      const image = (renderAvatar && renderAvatar(person.avatar, kind)) || placeholderAvatar();
      if (kind === 'v05') return { image, head: HEAD_V05, face: FACE_V05, boxScale: sourceSize(image).w / TEMPLATE.width };
      // 다른 아바타: 위쪽을 정사각형 머리 영역으로 본다
      const { w, h } = sourceSize(image);
      const side = Math.min(w, Math.round(h * 0.55));
      return { image, head: { x: Math.round((w - side) / 2), y: 0, w: side, h: side } };
    };
    const base = {
      answer: p.answerText || '',
      correctCount: p.correctCount,
      total: p.total,
      seed: p.effectSeed ?? p.quizId,
      effect: p.effect,
      explanation: p.explanation || '',
      revealAt: p.revealAt,
    };
    if (!p.winner) return { ...base, winner: null };
    return {
      ...base,
      winner: { id: p.winner.id, name: p.winner.name, ms: p.winner.ms, recordText: p.winner.recordText, avatar: toAvatar(p.winner),
        gained: (p.scores || []).find(s => s.id === p.winner.id)?.gained },
      podium: (p.podium || []).filter(x => x.rank > 1).map(x => ({ name: x.name, ms: x.ms, recordText: x.recordText })),
      nearMiss: Boolean(p.nearMiss),
      isMe: Boolean(viewer && viewer.id === p.winner.id),
    };
  }

  function placeholderAvatar() {
    const c = document.createElement('canvas');
    c.width = TEMPLATE.width;
    c.height = TEMPLATE.height;
    const g = c.getContext('2d');
    g.fillStyle = '#0f4c4f';
    g.beginPath();
    g.arc(72, 62, 40, 0, Math.PI * 2);
    g.fill();
    g.fillRect(42, 106, 60, 104);
    return c;
  }

  // 등장 연출 → 결과 카드. 카드가 다 뜨면 Promise가 끝난다. 카드는 clear()/skip()까지 남는다.
  // data: 서버 공개 데이터(quizReveal) 또는 { winner: { name, ms, avatar: { image, head, face } }, answer, podium, ... }
  // options.replay === false면 연출 없이 결과 카드만(늦게 들어온 화면, 다시 보기).
  async function reveal(input, { replay = true, mine = '', audible = true } = {}) {
    const maySound = captureSoundPermission();
    const raw = input && (input.v || 'answerText' in input || 'effectSeed' in input) ? fromPayload(input) : input;
    const data = mine ? { ...raw, mine } : raw;
    // 공개 시각(revealAt)까지는 '그만!' 화면을 그대로 둔다. 그 사이 skip()이 오면 그만둔다.
    const ticket = token;
    if (Number.isFinite(data.revealAt)) await wait(data.revealAt - serverNow());
    if (ticket !== token) return null;
    if (!data.winner) {
      await noWinner({ answer: data.answer, mine: data.mine, explanation: data.explanation, correctCount: data.correctCount, total: data.total, replay, audible: audible && maySound() });
      return 'none';
    }
    const my = reset();
    show();
    root.classList.remove('is-compact');
    const alive = () => my === token;
    const effect = EFFECTS.some(e => e.id === data.effect) ? data.effect : pickEffect(data.seed ?? Date.now(), data.exclude);
    const rng = mulberry32(hashSeed(`${data.seed}:${effect}`));
    await waitFont();
    if (!alive()) return effect;
    await animate(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: replay ? 220 : 0 });
    if (!alive()) return effect;
    if (replay && !reduce) {
      if (audible && maySound()) audio?.play(`reveal-${effect}`);
      await effects[effect]({ winner: data.winner, rng, alive });
    }
    if (!alive()) return effect;
    if (replay && audible && maySound()) audio?.play('result');
    await showCard(data, my);
    return effect;
  }

  // 마감 순간 '그만!' 도장. 공개 연출(reveal)이 시작되면 저절로 사라진다.
  async function closed({ audible = true } = {}) {
    const maySound = captureSoundPermission();
    const my = reset();
    show();
    root.classList.remove('is-compact');
    const alive = () => my === token;
    await waitFont();
    if (!alive()) return;
    animate(backdrop, [{ opacity: 0 }, { opacity: 0.7 }], { duration: 160 });
    live.textContent = '그만';
    if (audible && maySound()) audio?.play('closed');
    const stamp = layer(textEl('qfx-stamp', '그만!'));
    stamp.style.fontSize = `${Math.min(vmin() * 0.24, 200)}px`;
    await animate(stamp, [
      { transform: T(0, 0, 3, -18), opacity: 0 },
      { transform: T(0, 0, 0.92, -8), opacity: 1, offset: 0.7 },
      { transform: T(0, 0, 1, -8), opacity: 1 },
    ], { duration: 260, easing: EASE.in });
    if (!alive()) return;
    shake(14, 280);
    particles.ring(vw() / 2, vh() / 2, vmin() * 0.4, { color: '#fbe6df', width: 10 });
  }

  function skip() {
    clear();
  }

  // 정답자가 없을 때
  async function noWinner({ answer = '', mine = '', explanation = '', correctCount, total, replay = true, audible = true } = {}) {
    const maySound = captureSoundPermission();
    const my = reset();
    show();
    root.classList.remove('is-compact');
    const alive = () => my === token;
    // 다시 보기(늦게 들어온 화면)나 움직임 줄이기 설정이면 움직임 없이 바로 보여 준다.
    const motion = replay && !reduce ? 1 : 0;
    await waitFont();
    if (!alive()) return;
    await animate(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 * motion });
    if (!alive()) return;
    live.textContent = `정답자 없음. 정답 ${answer}`;
    if (replay && audible && maySound()) audio?.play('noWinner');
    const title = layer(textEl('qfx-stamp', '정답자 없음'));
    await animate(title, [
      { transform: T(0, -vh() * 0.6, 1, 0) },
      { transform: T(0, -vh() * 0.1, 1, 0), offset: 0.6 },
      { transform: T(0, -vh() * 0.1, 1, -6), offset: 0.75 },
      { transform: T(0, -vh() * 0.1, 1, 4), offset: 0.9 },
      { transform: T(0, -vh() * 0.1, 1, 0) },
    ], { duration: 1100 * motion, easing: EASE.out });
    if (!alive()) return;
    // 정답·해설·인원·내 결과를 한 덩어리로 아래에 놓는다
    const info = document.createElement('div');
    info.style.cssText = 'display:grid;justify-items:center;gap:10px;text-align:center';
    if (answer) {
      const box = document.createElement('div');
      box.className = 'qfx-answer';
      box.style.fontSize = `${Math.min(vmin() * 0.06, 44)}px`;
      box.style.margin = '0';
      box.append('정답 ');
      const b = document.createElement('b');
      b.textContent = answer;
      box.append(b);
      info.append(box);
    }
    const meta = [];
    if (explanation) meta.push(`해설 ${explanation}`);
    if (Number.isFinite(correctCount) && Number.isFinite(total)) meta.push(`정답 ${correctCount}명 / ${total}명 중`);
    for (const line of meta) {
      const el = textEl('qfx-meta', line);
      el.style.color = '#fbe6df';
      el.style.maxWidth = 'min(86vw, 760px)';
      el.style.whiteSpace = 'normal';
      info.append(el);
    }
    if (mine) {
      const me = textEl('qfx-mine is-center', mine);
      me.style.marginTop = '4px';
      info.append(me);
    }
    if (!info.childElementCount) return;
    const holder = layer(info);
    await animate(holder, [
      { transform: T(0, vh() * 0.14, 0.7), opacity: 0 },
      { transform: T(0, vh() * 0.12, 1), opacity: 1 },
    ], { duration: 360 * motion, easing: EASE.back });
  }

  function destroy() {
    clear();
    soundControl?.destroy();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', onResize);
    root.remove();
  }

  return { countdown, closed, reveal, noWinner, skip, clear, destroy, root };
}
