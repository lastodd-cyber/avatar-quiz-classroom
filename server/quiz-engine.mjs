import { randomBytes } from 'node:crypto';
import { cleanAvatarForKind } from '../shared/world.js';
import {
  LEAD_MS, COUNTDOWN_MS, GRACE_MS, REVEAL_DELAY_MS, RETRY_COOLDOWN_MS, NEAR_MISS_MS,
  CHOICE_DELAY_MS, MAX_ANSWER_LENGTH, normalizeAnswer, isCorrect, formatRecord, REVEAL_EFFECTS, pointsFor,
} from '../shared/quiz-core.js';

import { validateQuizSpec } from '../shared/quiz-spec.js';

export class QuizEngine {
  #quiz = null;
  #secret = null;
  #records = new Map();
  #eligible = new Set();
  #closedAt = null;
  #reveal = null;
  #seq = 0;
  #now;
  #random;
  #avatarKind;
  #lastEffect = null;

  constructor({ now = Date.now, random = () => randomBytes(4).readUInt32LE(0), avatarKind = 'v02' } = {}) {
    this.#now = now;
    this.#random = random;
    this.#avatarKind = avatarKind === 'v05' ? 'v05' : 'v02';
  }

  get phase() {
    if (!this.#quiz) return 'idle';
    if (this.#closedAt !== null) return 'revealed';
    return this.#now() < this.#quiz.startAt ? 'countdown' : 'open';
  }

  start(spec, { eligibleIds = [] } = {}) {
    if (this.#quiz && this.#closedAt === null) return { ok: false, error: '진행 중인 문제가 있습니다.' };
    let checked;
    try {
      checked = validateQuizSpec(spec);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const startAt = this.#now() + LEAD_MS + COUNTDOWN_MS;
    this.#quiz = {
      id: randomBytes(6).toString('hex'),
      type: checked.type,
      question: spec.question.trim(),
      options: checked.type === 'choice' ? spec.options.slice() : null,
      numeric: checked.type === 'short' && spec.numeric === true,
      strict: checked.strict,
      seconds: checked.seconds,
      attempts: checked.attempts,
      practice: spec.practice === true,
      startAt,
      endsAt: startAt + checked.seconds * 1000,
    };
    this.#secret = {
      accepted: checked.accepted,
      originals: checked.type === 'short' ? spec.answers.slice() : null,
      correct: checked.type === 'choice' ? spec.correct : null,
      explanation: checked.explanation,
    };
    this.#records = new Map();
    this.#eligible = new Set(eligibleIds);
    this.#closedAt = null;
    this.#reveal = null;
    this.#seq = 0;
    return { ok: true, quiz: this.publicQuiz() };
  }

  submit(person, message) {
    const recvAt = this.#now();
    const q = this.#quiz;
    if (!q || message?.quizId !== q.id) return { status: 'closed' };
    if (!person || person.role !== 'guest' || person.banned || typeof person.id !== 'string') {
      return { status: 'denied' };
    }
    if (this.#closedAt !== null || recvAt >= q.endsAt + GRACE_MS) return { status: 'closed' };
    const delay = q.type === 'choice' ? CHOICE_DELAY_MS : 0;
    if (recvAt < q.startAt + delay) return { status: 'early' };
    const rec = this.#records.get(person.id) ?? {
      used: 0, lastAt: -Infinity, correct: false, ms: null, seq: 0, lastStatus: null,
    };
    // 한 번만 내는 문제는 재제출 응답으로도 정오답을 구별할 수 없어야 한다.
    if (q.attempts === 1 && rec.used > 0) return { status: 'noAttempts', attemptsLeft: 0 };
    if (rec.correct) return { status: 'already', attemptsLeft: 0 };
    if (rec.used >= q.attempts) return { status: 'noAttempts', attemptsLeft: 0 };
    if (recvAt - rec.lastAt < RETRY_COOLDOWN_MS) {
      return { status: 'tooFast', attemptsLeft: q.attempts - rec.used };
    }
    let ok;
    if (q.type === 'short') {
      const text = typeof message.text === 'string' ? message.text.slice(0, MAX_ANSWER_LENGTH) : '';
      if (!normalizeAnswer(text, { strict: q.strict })) return { status: 'empty' };
      ok = isCorrect(text, this.#secret.accepted, { strict: q.strict });
    } else {
      if (!Number.isInteger(message.choice) || message.choice < 0 || message.choice >= q.options.length) {
        return { status: 'denied' };
      }
      rec.choice = message.choice;
      ok = message.choice === this.#secret.correct;
    }
    rec.used += 1;
    rec.lastAt = recvAt;
    if (ok) {
      rec.correct = true;
      rec.ms = Math.max(0, Math.floor(recvAt - q.startAt));
      rec.seq = ++this.#seq;
    }
    rec.lastStatus = q.attempts === 1 ? 'received' : (ok ? 'correct' : 'wrong');
    this.#records.set(person.id, rec);
    this.#eligible.add(person.id);
    const attemptsLeft = rec.correct ? 0 : q.attempts - rec.used;
    if (q.attempts === 1) return { status: 'received', attemptsLeft };
    if (ok) return { status: 'correct', attemptsLeft, ms: rec.ms };
    return { status: 'wrong', attemptsLeft };
  }

  isAllDone(connectedGuestIds) {
    if (!this.#quiz || this.#closedAt !== null) return false;
    const ids = Array.from(connectedGuestIds).filter(id => this.#eligible.has(id));
    // 접속 중인 대상이 없으면 모두 끝난 것으로 처리하지 않는다.
    if (!ids.length) return false;
    return ids.every(id => {
      const rec = this.#records.get(id);
      return rec && (rec.correct || rec.used >= this.#quiz.attempts);
    });
  }

  close(reason, people) {
    if (!this.#quiz || this.#closedAt !== null) return null;
    const q = this.#quiz;
    const closedAt = this.#now();
    // 난수 주입 계약은 Math.random의 실수가 아닌 부호 없는 32비트 정수다.
    const effectSeed = this.#random();
    if (!Number.isInteger(effectSeed) || effectSeed < 0 || effectSeed > 0xffffffff) {
      throw new RangeError('random은 부호 없는 32비트 정수를 반환해야 합니다.');
    }
    const participants = Array.from(this.#eligible)
      .map(id => people.get(id)).filter(person => person && person.role === 'guest' && !person.banned);
    const answers = participants.filter(person => this.#records.has(person.id));
    const correct = answers.filter(person => this.#records.get(person.id).correct);
    correct.sort((a, b) => {
      const left = this.#records.get(a.id);
      const right = this.#records.get(b.id);
      return left.ms - right.ms || left.seq - right.seq;
    });
    // 같은 두 자리 기록이 겹치는 사람만 세 자리로 통일한다.
    const labels = correct.map(person => formatRecord(this.#records.get(person.id).ms));
    const recordText = person => {
      const ms = this.#records.get(person.id).ms;
      const duplicates = labels.filter(label => label === formatRecord(ms)).length;
      return formatRecord(ms, duplicates > 1 ? 3 : 2);
    };
    const effects = REVEAL_EFFECTS.filter(effect => effect !== this.#lastEffect);
    const effect = effects[effectSeed % effects.length];
    this.#lastEffect = effect;
    const podium = correct.slice(0, 3).map((person, index) => ({
      rank: index + 1,
      id: person.id,
      name: person.name,
      ms: this.#records.get(person.id).ms,
      recordText: recordText(person),
      avatar: cleanAvatarForKind(person.avatar, this.#avatarKind),
      avatarKind: this.#avatarKind,
    }));
    let winner = null;
    if (correct.length) {
      const person = correct[0];
      const rec = this.#records.get(person.id);
      winner = {
        id: person.id,
        name: person.name,
        ms: rec.ms,
        recordText: recordText(person),
        attempt: rec.used,
        avatar: cleanAvatarForKind(person.avatar, this.#avatarKind),
        avatarKind: this.#avatarKind,
        connected: person.connected === true,
      };
    }
    const scores = (q.practice ? [] : correct).map((person, index) => {
      const ms = this.#records.get(person.id).ms;
      const gained = pointsFor(ms, q.seconds * 1000);
      person.score = (person.score ?? 0) + 1;
      person.points = (person.points ?? 0) + gained;
      person.elapsed = (person.elapsed ?? 0) + ms;
      person.firsts = (person.firsts ?? 0) + (index === 0 ? 1 : 0);
      return { id: person.id, score: person.score, points: person.points, gained, elapsed: person.elapsed, firsts: person.firsts };
    });
    const choiceCounts = q.type === 'choice' ? q.options.map(() => 0) : null;
    if (choiceCounts) {
      for (const person of answers) choiceCounts[this.#records.get(person.id).choice] += 1;
    }
    this.#closedAt = closedAt;
    this.#reveal = {
      v: 1,
      quizId: q.id,
      type: q.type,
      practice: q.practice,
      question: q.question,
      answerText: q.type === 'short' ? this.#secret.originals[0] : q.options[this.#secret.correct],
      accepted: q.type === 'short' ? this.#secret.originals.slice() : [],
      choiceIndex: this.#secret.correct,
      choiceCounts,
      explanation: this.#secret.explanation,
      startAt: q.startAt,
      closedAt,
      closeReason: reason,
      revealAt: closedAt + REVEAL_DELAY_MS,
      winner,
      podium,
      results: correct.map((person, index) => ({
        id: person.id, name: person.name, rank: index + 1,
        ms: this.#records.get(person.id).ms, recordText: recordText(person),
      })),
      correctCount: correct.length,
      answeredCount: answers.length,
      total: participants.length,
      nearMiss: podium.length > 1 && podium[1].ms - podium[0].ms < NEAR_MISS_MS,
      scores,
      effectSeed,
      effect,
    };
    return structuredClone(this.#reveal);
  }

  abort() {
    if (!this.#quiz || this.#closedAt !== null) return null;
    return this.#reset();
  }

  clear() {
    if (!this.#quiz || this.#closedAt === null) return null;
    return this.#reset();
  }

  rename(personId, name) {
    if (!this.#reveal) return null;
    const rows = [this.#reveal.winner, ...this.#reveal.podium, ...this.#reveal.results];
    for (const row of rows) if (row?.id === personId) row.name = name;
    return structuredClone(this.#reveal);
  }

  #reset() {
    const id = this.#quiz.id;
    this.#quiz = null;
    this.#secret = null;
    this.#records.clear();
    this.#eligible.clear();
    this.#closedAt = null;
    this.#reveal = null;
    this.#seq = 0;
    return id;
  }

  publicQuiz() {
    const q = this.#quiz;
    if (!q) return null;
    return {
      v: 1,
      quizId: q.id,
      type: q.type,
      question: q.question,
      options: q.options ? q.options.slice() : null,
      numeric: q.numeric,
      seconds: q.seconds,
      attempts: q.attempts,
      practice: q.practice,
      startAt: q.startAt,
      endsAt: q.endsAt,
      serverTime: this.#now(),
      total: this.#reveal ? this.#reveal.total : this.#eligible.size,
    };
  }

  progress() {
    if (!this.#quiz) return null;
    return {
      quizId: this.#quiz.id,
      answered: this.#reveal ? this.#reveal.answeredCount : this.#records.size,
      correct: this.#reveal ? this.#reveal.correctCount :
        Array.from(this.#records.values()).filter(rec => rec.correct).length,
    };
  }

  stateFor(personId) {
    const q = this.#quiz;
    const rec = this.#records.get(personId);
    const progress = this.progress();
    const me = q ? {
      attemptsUsed: rec?.used ?? 0,
      attemptsLeft: rec?.correct ? 0 : q.attempts - (rec?.used ?? 0),
      lastStatus: rec?.lastStatus ?? null,
      choice: rec?.choice ?? null,
    } : null;
    if (me && (q.attempts > 1 || this.#closedAt !== null)) {
      me.correct = rec?.correct ?? false;
      me.ms = rec?.ms ?? null;
    }
    return {
      v: 1,
      phase: this.phase,
      quiz: this.publicQuiz(),
      progress: progress ? { answered: progress.answered, correct: progress.correct } : null,
      me,
      reveal: this.#reveal ? structuredClone(this.#reveal) : null,
      serverTime: this.#now(),
    };
  }
}
