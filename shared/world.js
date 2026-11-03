export const WORLD = { width: 1152, height: 768, speed: 220 };
export const NETWORK = {
  reconnectSeconds: 20,
  disconnectedSeatMs: 3 * 60 * 1000,
  positionRepairMs: 5000,
  movementBurstSeconds: .55,
  moveMessagesPerSecond: 20,
  moveMessageBurst: 30
};

export function preferredIPv4Addresses(interfaces) {
  const priority = name => /vethernet|virtual|vmware|vbox|docker|wsl|hyper-v|vpn|tun|tap/i.test(name) ? 2 :
    /wi-?fi|wireless|wlan|ethernet|이더넷|무선/i.test(name) ? 0 : 1;
  return [...new Set(Object.entries(interfaces).sort(([a], [b]) => priority(a) - priority(b))
    .flatMap(([, entries]) => entries || [])
    .filter(n => n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'))
    .map(n => n.address))];
}

// 초기 snapshot 이후의 이벤트를 같은 상태로 합친다. 서버의 비공개 값은 취급하지 않는다.
export function applyClassroomMessage(state, type, message) {
  if (type === 'snapshot') return message;
  if (!state) return state;
  if (type === 'delta') {
    Object.assign(state, message.fields);
    const removed = new Set(message.removed || []);
    state.people = state.people.filter(p => !removed.has(p.id));
    for (const patch of message.people || []) {
      const person = state.people.find(p => p.id === patch.id);
      if (person) Object.assign(person, patch);
      else state.people.push(patch);
    }
  } else if (type === 'chatLine') {
    if (!state.chat.some(line => line.id === message.line.id)) state.chat.push(message.line);
    state.chat = state.chat.slice(-80);
  } else if (type === 'quizProgress') {
    if (state.quiz?.id === message.id) state.quiz.answered = message.answered;
  } else if (type === 'positions') {
    for (const position of message) {
      const person = state.people.find(p => p.id === position.id);
      if (person) Object.assign(person, position);
    }
  }
  if (Number.isInteger(message.revision)) state.revision = message.revision;
  return state;
}

// 도착 간격마다 여유를 더하지 않고, 실제 시간만큼만 이동 예산을 충전한다.
export function consumeMovementBudget(person, position, now) {
  const cap = WORLD.speed * NETWORK.movementBurstSeconds;
  person.moveBudget = Math.min(cap, (person.moveBudget ?? cap) +
    WORLD.speed * Math.max(0, now - person.lastMove) / 1000);
  person.lastMove = now;
  const distance = Math.hypot(position.x - person.x, position.y - person.y);
  if (distance > person.moveBudget + .001) return false;
  person.moveBudget = Math.max(0, person.moveBudget - distance);
  return true;
}
// Pixel background v01: furniture remains on the perimeter, with a central gathering area.
export const DESKS = [{ x: 483, y: 174, w: 184, h: 118 }];
export function walkable(x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 170 && x <= 990 && y >= 275 && y <= 720 && !DESKS.some(d => x > d.x - 18 && x < d.x + d.w + 18 && y > d.y - 10 && y < d.y + d.h + 14);
}
import { CATALOG } from './avatar-catalog.js';
import { cleanAvatarV05 } from './avatar-v05.js';

// 두 형식이 glasses 같은 필드를 공유하므로 다른 종류의 설정은 통째로 기본값으로 돌린다.
export function cleanAvatarForKind(value, kind = 'v02') {
  const a = value && typeof value === 'object' ? value : {};
  const isV02 = typeof a.top === 'number' || typeof a.style === 'number' ||
    ['hair', 'skin'].some(key => typeof a[key] === 'string' && a[key].startsWith('#'));
  const isV05 = typeof a.top === 'string' || typeof a.bottom === 'string' ||
    ['hair', 'skin'].some(key => typeof a[key] === 'string' && !a[key].startsWith('#'));
  if (kind === 'v05') return cleanAvatarV05(isV02 ? undefined : a);
  return cleanAvatar(isV05 ? undefined : a);
}
export const DEFAULT_AVATAR = { skin: '#efbc99', hair: '#44302c', shirt: '#6f9374', pants:'#465571', shoeColor:'#f0e8d7', accent:'#e2bc67', style: 0, face: 1, eye: 1, spacing: 1, glasses: false, mouth: 1, brow: 1, faceShape:0, eyeStyle:0, mouthStyle:0, top:4, bottom:1, shoes:0, eyewear:0, hat:0, bag:0 };
export const PALETTE = ['#d38370', '#568d86', '#8797c7', '#d5aa50', '#b092b7', '#79a278'];
export function cleanAvatar(value) {
  const a = value && typeof value === 'object' ? value : {};
  const out = { ...DEFAULT_AVATAR };
  for (const k of ['skin', 'hair', 'shirt', 'pants', 'shoeColor', 'accent']) if (typeof a[k] === 'string' && /^#[\da-f]{6}$/i.test(a[k])) out[k] = a[k];
  for (const k of ['face', 'eye', 'spacing', 'mouth', 'brow']) if (Number.isFinite(a[k])) out[k] = Math.max(.75, Math.min(1.3, a[k]));
  for(const [category,list] of Object.entries(CATALOG)) { const key=category==='hair'?'style':category; if(Number.isInteger(a[key])&&list.some(item=>item.id===a[key]))out[key]=a[key]; }
  if(a.glasses===true && !Object.hasOwn(a,'eyewear'))out.eyewear=1;
  out.glasses = out.eyewear > 0;
  return out;
}
