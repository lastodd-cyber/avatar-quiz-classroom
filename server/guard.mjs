import { createHash, timingSafeEqual } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest();

export function keyMatches(input, secret) {
  if (typeof input !== 'string' || typeof secret !== 'string' || !input || !secret) return false;
  if (Buffer.byteLength(input) > 256 || Buffer.byteLength(secret) > 256) return false;
  return timingSafeEqual(digest(input), digest(secret));
}

export function withinMessageLimit(value, limit = 16 * 1024) {
  if (!Number.isSafeInteger(limit) || limit < 0) return false;
  try {
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value.byteLength <= limit;
    if (value instanceof ArrayBuffer) return value.byteLength <= limit;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= limit;
  } catch {
    return false;
  }
}

export function createFailureLimiter({ max = 5, windowMs = 60000, lockMs = 60000,
  now = Date.now, maxEntries = 2048 } = {}) {
  for (const value of [max, windowMs, lockMs, maxEntries]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('시도 제한 설정값을 확인해 주세요.');
  }
  const attempts = new Map();
  // 같은 교실에서도 입력한 키가 다르면 서로 잠그지 않는다. 원문 키는 보관하지 않는다.
  function scope(room, candidate) {
    if (typeof room !== 'string' || !room || room.length > 128 || typeof candidate !== 'string') {
        throw new Error('교실과 입력 키를 함께 지정해야 합니다.');
    }
    if (Buffer.byteLength(candidate) > 256) throw new Error('입력 키 크기를 먼저 검사해 주세요.');
    return `${room}:${digest(candidate).toString('hex')}`;
  }
  function prune(time) {
    for (const [id, item] of attempts) {
      if (Math.max(item.expires, item.lockedUntil) <= time) attempts.delete(id);
    }
  }
  return {
    check(room, candidate) {
      const time = now();
      prune(time);
      const item = attempts.get(scope(room, candidate));
      const retryAfterMs = Math.max(0, (item?.lockedUntil || 0) - time);
      return { locked: retryAfterMs > 0, retryAfterMs };
    },
    fail(room, candidate) {
      const time = now();
      prune(time);
      const id = scope(room, candidate);
      let item = attempts.get(id);
      if (!item) {
        // 메모리 상한은 오래된 항목 제거로 처리하며 전체 이용자를 잠그지 않는다.
        if (attempts.size >= maxEntries) attempts.delete(attempts.keys().next().value);
        item = { failures: 0, expires: time + windowMs, lockedUntil: 0 };
        attempts.set(id, item);
      }
      item.failures += 1;
      if (item.failures >= max && item.lockedUntil <= time) item.lockedUntil = time + lockMs;
    },
    success(room, candidate) {
      attempts.delete(scope(room, candidate));
    }
  };
}

export async function authorizeTeacher(input, config, { delayMs = 300,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!config.cloudMode) return true;
  if (keyMatches(input, config.teacherKey)) return true;
  // 교차 검토 17번: 클라우드 교사용 키는 잠그지 않고 실패에만 고정 지연을 둔다.
  await delay(delayMs);
  return false;
}
