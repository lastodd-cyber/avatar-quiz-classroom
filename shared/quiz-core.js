// 서버와 브라우저가 함께 쓰는 퀴즈 규칙과 순수 함수.
export const LEAD_MS = 500; // 방송 도착 여유
export const COUNTDOWN_MS = 3000; // 3·2·1 표시
export const GRACE_MS = 150; // 마감 직전 제출의 도착 여유
export const REVEAL_DELAY_MS = 1200; // 그만! 표시
export const RETRY_COOLDOWN_MS = 700; // 재제출 최소 간격
export const ALL_DONE_DELAY_MS = 300; // 모두 끝난 뒤 마감 대기
export const PROGRESS_INTERVAL_MS = 250; // 진행 방송 최소 간격
export const NEAR_MISS_MS = 100; // 간발의 차 기준(미만)
export const CHOICE_DELAY_MS = 600; // 객관식 최소 읽기 시간
export const DEFAULT_SECONDS = 20;
export const MIN_SECONDS = 5;
export const MAX_SECONDS = 120;
export const SECOND_OPTIONS = Object.freeze([10, 20, 30, 60]);
export const DEFAULT_ATTEMPTS = 3;
export const MIN_ATTEMPTS = 1;
export const MAX_ATTEMPTS = 5;
export const MAX_ANSWER_LENGTH = 40;
export const MAX_ACCEPTED = 10;
export const MAX_QUESTION_LENGTH = 200;
export const MAX_EXPLANATION_LENGTH = 300;
export const ANSWER_TAILS = Object.freeze(['입니다', '이에요', '예요', '이요', '요']);
export const REVEAL_EFFECTS = Object.freeze(['roll', 'bigface', 'cutin', 'drop', 'clones', 'spotlight',
  'peek', 'gacha', 'fireworks', 'balloon', 'news', 'rocket']);

// 한 문제 점수: 맞힌 학생만 받는다. 문제가 열린 순간 맞히면 1000점, 제한 시간 끝에 맞히면 500점(그 사이는 비례).
// 틀리거나 못 맞히면 0점. 최종 순위는 문제마다 받은 점수의 합계로 정한다.
export const POINTS_MAX = 1000;
export const POINTS_MIN = 500;
export function pointsFor(ms, limitMs) {
  if (!Number.isFinite(ms) || !Number.isFinite(limitMs) || limitMs <= 0) return 0;
  const k = Math.min(1, Math.max(0, ms / limitMs));
  return Math.round(POINTS_MAX - (POINTS_MAX - POINTS_MIN) * k);
}

export function normalizeAnswer(text, { strict = false } = {}) {
  if (typeof text !== 'string') return '';
  let value = text.normalize('NFKC');
  const invisible = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2060-\u2064\u202a-\u202e\u2066-\u2069\ufeff]/g;
  value = value.replace(invisible, '');
  value = value.toLowerCase();
  if (strict) return value.trim().replace(/\s+/g, ' ');
  value = value.replace(/['"`‘’“”()[\]{}<>「」『』《》〈〉【】]/g, '');
  value = value.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  // 바깥 공백도 함께 제거해야 ' 세종. '의 마침표가 남지 않는다.
  value = value.replace(/^[\s.,!?~…·:;。、！？]+|[\s.,!?~…·:;。、！？]+$/g, '');
  return value.replace(/\s+/g, '');
}

export function prepareAccepted(list, opts) {
  if (!Array.isArray(list)) throw new TypeError('허용 답 목록이 필요합니다.');
  const result = Array.from(new Set(list.map(text => normalizeAnswer(text, opts)).filter(Boolean)));
  if (!result.length) throw new RangeError('비어 있지 않은 허용 답이 필요합니다.');
  return result;
}

export function isCorrect(text, preparedAccepted, opts = {}) {
  const value = normalizeAnswer(text, opts);
  if (!value) return false;
  return preparedAccepted.some(answer => value === answer ||
    (!opts.strict && ANSWER_TAILS.some(tail => value === answer + tail)));
}

export function splitAcceptedInput(text) {
  if (typeof text !== 'string') return [];
  // 숫자 세 자리 앞 쉼표만 보존하고, 나머지 쉼표와 줄바꿈에서 나눈다.
  return text.split(/(?<!\d),|,(?!\d{3}(?!\d))|\r?\n/)
    .map(value => value.trim()).filter(Boolean);
}

export function formatRecord(ms, digits = 2) {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError('기록은 0 이상의 유한한 수여야 합니다.');
  if (!Number.isInteger(digits) || digits < 0 || digits > 3) {
    throw new RangeError('소수 자릿수는 0~3이어야 합니다.');
  }
  const scale = 10 ** digits;
  return `${(Math.floor(ms / (1000 / scale)) / scale).toFixed(digits)}초`;
}
