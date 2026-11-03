// 협동 게임방 물리와 규칙. 화면은 내 몸을 이 함수로 움직이고, 서버는 같은 함수로 버튼·열쇠·문을 판정한다.
// 몸: { x(가운데), y(발바닥), vx, vy, grounded, facing(-1|1), on(밟고 선 친구 id 또는 null) }
import { COOP, px, plateRect, levelSize } from './coop-level.js';

const EPS = 0.01;

export function bodyRect(b, size = COOP.body) {
  return { x: b.x - size.w / 2, y: b.y - size.h, w: size.w, h: size.h };
}

export function overlaps(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && a.x + a.w > b.x - pad && a.y < b.y + b.h + pad && a.y + a.h > b.y - pad;
}

// 지금 막혀 있는 블록들(픽셀). 계단은 버튼을 누른 뒤에만, 가로막은 열리기 전에만 단단하다.
export function solidRects(level, objects = {}) {
  const rects = level.solids.map(r => px(r));
  if (objects.stairs) for (const r of level.stairs.blocks) rects.push(px(r));
  if (!objects.gate) rects.push(px(level.gate.rect));
  return rects;
}

export function newBody(point) {
  return { x: point.x, y: point.y, vx: 0, vy: 0, grounded: true, facing: 1, on: null };
}

// 블록 안에 끼었으면 위로 꺼낸다(계단이 생기는 자리에 서 있던 경우).
function unstick(body, solids) {
  for (let i = 0; i < 4; i++) {
    const r = bodyRect(body);
    const hit = solids.find(s => overlaps(r, s));
    if (!hit) return;
    body.y = hit.y;
    body.vy = 0;
    body.grounded = true;
  }
}

// 한 번 움직이기. input: { move: -1|0|1, jump: 이번에 점프를 눌렀는지 }
// others: 다른 친구들 [{ id, x, y, dx, dy }] — 머리 위는 위에서 내려올 때만 밟힌다. dx·dy는 이번에 친구가 움직인 양.
export function stepBody(body, input, dt, solids, others = [], bounds = null) {
  const size = COOP.body;
  // 친구 머리 위에 서 있으면 친구와 같이 움직인다.
  if (body.on) {
    const carrier = others.find(o => o.id === body.on);
    if (carrier) {
      body.x += carrier.dx || 0;
      body.y += carrier.dy || 0;
    } else body.on = null;
  }
  unstick(body, solids);
  const move = Math.sign(input.move || 0);
  body.vx = move * COOP.walkSpeed;
  if (move) body.facing = move;
  if (input.jump && body.grounded) {
    body.vy = -COOP.jumpSpeed;
    body.grounded = false;
    body.on = null;
  }
  body.vy = Math.min(body.vy + COOP.gravity * dt, COOP.maxFall);

  // 가로 이동
  body.x += body.vx * dt;
  let r = bodyRect(body);
  for (const s of solids) {
    if (!overlaps(r, s)) continue;
    if (body.vx > 0) body.x = s.x - size.w / 2 - EPS;
    else if (body.vx < 0) body.x = s.x + s.w + size.w / 2 + EPS;
    r = bodyRect(body);
  }

  // 세로 이동
  const prevFeet = body.y;
  body.y += body.vy * dt;
  body.grounded = false;
  body.on = null;
  r = bodyRect(body);
  for (const s of solids) {
    if (!overlaps(r, s)) continue;
    if (body.vy >= 0 && prevFeet <= s.y + EPS + 1) {
      body.y = s.y;
      body.vy = 0;
      body.grounded = true;
    } else if (body.vy < 0) {
      body.y = s.y + s.h + size.h;
      body.vy = 0;
    }
    r = bodyRect(body);
  }
  // 친구 머리: 내려오는 중이고 직전에 머리보다 위에 있었을 때만 밟는다.
  if (body.vy >= 0 && !body.grounded) {
    for (const o of others) {
      const head = o.y - size.h;
      const horizontal = Math.abs(body.x - o.x) < size.w - 2;
      if (horizontal && prevFeet <= head + 2 + Math.abs(o.dy || 0) && body.y >= head) {
        body.y = head;
        body.vy = 0;
        body.grounded = true;
        body.on = o.id;
        break;
      }
    }
  }
  if (bounds) {
    body.x = Math.max(size.w / 2, Math.min(bounds.width - size.w / 2, body.x));
    body.y = Math.max(size.h, Math.min(bounds.height, body.y));
  }
  return body;
}

// 버튼: 그 칸의 바닥(= 아래 블록 윗면)에 발을 대고 서 있으면 눌린 것.
export function plateDown(plate, bodies) {
  const p = plateRect(plate);
  const floor = p.y + p.h;
  return bodies.some(b => Math.abs(b.y - floor) <= 3 && b.x >= p.x - 4 && b.x <= p.x + p.w + 4);
}

function keyRect(level) {
  const [x, y] = level.key;
  return { x: x * COOP.tile, y: y * COOP.tile, w: COOP.tile, h: COOP.tile };
}

export function emptyObjects() {
  return { stairs: false, gate: false, keyHolder: null, keyUsed: false, door: false, atGoal: [] };
}

// 버튼·열쇠·문 판정. bodies: [{ id, x, y, connected }]. 바뀐 objects와 일어난 일 목록을 돌려준다.
// cleared: 문이 열렸고 접속 중인 모두가 문 안으로 들어갔을 때.
export function evaluateObjects(level, previous, bodies) {
  const objects = { ...previous, atGoal: [...previous.atGoal] };
  const events = [];
  const inside = new Set(objects.atGoal);
  const active = bodies.filter(b => b.connected !== false && !inside.has(b.id));

  if (!objects.stairs && plateDown(level.stairs.plate, active)) {
    objects.stairs = true;
    events.push('stairs');
  }
  if (!objects.gate && level.gate.plates.every(plate => plateDown(plate, active))) {
    objects.gate = true;
    events.push('gate');
  }
  // 열쇠를 든 친구가 나가면 열쇠는 제자리로 돌아간다.
  if (objects.keyHolder && !objects.keyUsed && !active.some(b => b.id === objects.keyHolder)) {
    objects.keyHolder = null;
    events.push('keyReturn');
  }
  if (!objects.keyHolder && !objects.keyUsed) {
    const holder = active.find(b => overlaps(bodyRect(b), keyRect(level), 2));
    if (holder) {
      objects.keyHolder = holder.id;
      events.push('key');
    }
  }
  const door = px(level.door);
  if (!objects.door && objects.keyHolder) {
    const holder = active.find(b => b.id === objects.keyHolder);
    if (holder && overlaps(bodyRect(holder), door)) {
      objects.door = true;
      objects.keyUsed = true;
      events.push('door');
    }
  }
  if (objects.door) {
    for (const b of active) {
      if (overlaps(bodyRect(b), door)) {
        objects.atGoal.push(b.id);
        events.push(`goal:${b.id}`);
      }
    }
  }
  const connected = bodies.filter(b => b.connected !== false);
  const cleared = objects.door && connected.length > 0 && connected.every(b => objects.atGoal.includes(b.id));
  return { objects, events, cleared };
}

// 서버가 받은 위치가 말이 되는지. prev가 없으면(첫 위치) 시작 자리 근처인지만 본다.
// 친구 머리에 타고 가면 친구 속도가 더해지므로 가로 허용 폭을 넉넉히 둔다.
export function plausibleMove(level, objects, prev, next, dtMs) {
  if (!next || !Number.isFinite(next.x) || !Number.isFinite(next.y)) return false;
  const { width, height } = levelSize(level);
  const size = COOP.body;
  if (next.x < size.w / 2 - 1 || next.x > width - size.w / 2 + 1 || next.y < size.h - 1 || next.y > height + 1) return false;
  const solids = solidRects(level, objects);
  // m: 몸 가장자리에서 안쪽으로 줄이는 폭. 끝 위치는 4픽셀, 사이 길은 몸 가운데 심만 본다.
  const embedded = (p, mx = 4, my = 4) => {
    const r = bodyRect(p);
    const inner = { x: r.x + mx, y: r.y + my, w: r.w - mx * 2, h: r.h - my * 2 };
    return solids.some(s => overlaps(inner, s));
  };
  if (embedded(next)) return false;
  if (!prev) return true;
  const dt = Math.max(16, Math.min(1000, dtMs)) / 1000;
  const maxDx = COOP.walkSpeed * 2.2 * dt + 40;
  const maxDy = (COOP.jumpSpeed + COOP.maxFall) * dt + 60;
  if (Math.abs(next.x - prev.x) > maxDx || Math.abs(next.y - prev.y) > maxDy) return false;
  // 두 위치 사이 길이 블록(닫힌 가로막 등)을 지나면 안 된다. 8픽셀 간격으로 확인한다.
  // 점프는 곡선이라 직선 사이 길이 모서리를 살짝 스칠 수 있어서 몸 가운데(가로 8·세로 28픽셀)만 본다.
  const steps = Math.ceil(Math.hypot(next.x - prev.x, next.y - prev.y) / 8);
  for (let i = 1; i < steps; i++) {
    const k = i / steps;
    if (embedded({ x: prev.x + (next.x - prev.x) * k, y: prev.y + (next.y - prev.y) * k }, 7, 8)) return false;
  }
  return true;
}
