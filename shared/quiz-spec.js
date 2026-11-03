import { DEFAULT_SECONDS, MIN_SECONDS, MAX_SECONDS, DEFAULT_ATTEMPTS, MIN_ATTEMPTS, MAX_ATTEMPTS, MAX_ANSWER_LENGTH, MAX_ACCEPTED, MAX_QUESTION_LENGTH, MAX_EXPLANATION_LENGTH, prepareAccepted } from './quiz-core.js';

// 공개 필드와 비밀 필드는 분리하고, 반환 객체는 내부 상태와 참조를 공유하지 않는다.
function validText(value, limit) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
}

export function validateQuizSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('문제 설정이 필요합니다.');
  const type = spec.type ?? (Array.isArray(spec.options) ? 'choice' : 'short');
  if (!['short', 'choice'].includes(type)) throw new Error('지원하지 않는 문제 형식입니다.');
  if (!validText(spec.question, MAX_QUESTION_LENGTH)) throw new Error('문제는 1~200자로 적어 주세요.');
  const seconds = spec.seconds ?? DEFAULT_SECONDS;
  const attempts = type === 'choice' ? 1 : (spec.attempts ?? DEFAULT_ATTEMPTS);
  if (!Number.isInteger(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    throw new Error('제한 시간은 5~120초 정수여야 합니다.');
  }
  if (!Number.isInteger(attempts) || attempts < MIN_ATTEMPTS || attempts > MAX_ATTEMPTS) {
    throw new Error('기회는 1~5번이어야 합니다.');
  }
  const explanation = spec.explanation ?? '';
  if (typeof explanation !== 'string' || explanation.length > MAX_EXPLANATION_LENGTH) {
    throw new Error('해설은 300자 이내로 적어 주세요.');
  }
  const strict = spec.strict === true;
  let accepted = null;
  if (type === 'short') {
    if (!Array.isArray(spec.answers) || spec.answers.length < 1 || spec.answers.length > MAX_ACCEPTED) {
      throw new Error('허용 답은 1~10개여야 합니다.');
    }
    if (!spec.answers.every(answer => validText(answer, MAX_ANSWER_LENGTH))) {
      throw new Error('허용 답은 각각 1~40자로 적어 주세요.');
    }
    accepted = prepareAccepted(spec.answers, { strict });
  } else {
    if (!Array.isArray(spec.options) || spec.options.length < 2 || spec.options.length > 4 ||
        !spec.options.every(option => validText(option, MAX_QUESTION_LENGTH))) {
      throw new Error('보기는 비어 있지 않은 2~4개여야 합니다.');
    }
    if (!Number.isInteger(spec.correct) || spec.correct < 0 || spec.correct >= spec.options.length) {
      throw new Error('정답 보기 번호가 올바르지 않습니다.');
    }
  }
  return { type, seconds, attempts, strict, explanation, accepted };
}

