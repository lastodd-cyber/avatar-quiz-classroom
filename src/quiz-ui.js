import './quiz.css';
import { createQuizFx } from './fx/quiz-fx.js';
import { createServerClock } from './server-clock.js';
import { splitAcceptedInput, CHOICE_DELAY_MS } from '../shared/quiz-core.js';
import { validateQuizSpec } from '../shared/quiz-spec.js';
import { enterFullscreen, exitFullscreen } from './fullscreen.js';
import { createSoundControl } from './sound-control.js';
import { createQuizImporter } from './quiz-import-ui.js';

const BANK_KEY = 'classroom-quiz-bank-v1';
// '시작!' 도장(0.7초 + 사라지는 0.25초)이 화면에 있는 동안만 문제를 어두운 배경 위로 띄운다.
// 도장이 사라지면 제자리 문제를 보여 준다. 느린 기기에서 도장이 늦게 사라져도 이 시간 뒤에는 내린다.
const QUESTION_LIFT_MAX_MS = 2500;

// 문제·입력 DOM은 출제 때만 만들고, 진행 숫자와 판정만 따로 갱신한다.
export function createQuizUI({ room, viewer, avatarCanvas, content, toast, onCover = () => {}, audio }) {
  const zone = document.querySelector('#quiz-zone');
  const host = document.querySelector('#quiz-admin');
  const clock = createServerClock(room);
  const fx = createQuizFx({
    serverNow: clock.now, avatarCanvas, viewer, compact: window.innerWidth < 768, audio,
  });
  let quiz = null;
  let phase = 'idle';
  let opened = false;
  let locked = false;
  let sending = false;
  let composing = false;
  let pendingComposition = false;
  let lastText = '';
  let lastSentAt = -Infinity;
  let frame = 0;
  let closed = false;
  let correctSoundPlayed = false;
  let visibilityEpoch = 0;
  let visibleSince = -Infinity;
  let maySoundForAnswer = () => false;
  let boardSoundControl;
  let quizImporter;
  let online = true;
  let secret = '';
  let bank = [];
  let nextIndex = 0;
  let editingIndex = null;
  let starting = false;
  const progressKey = `classroom-quiz-progress-${room.roomId}`;
  let board = false;
  let revealKey = '';
  let alive = true;
  let liveQuestion = null;
  const unbind = [];
  const $ = selector => zone.querySelector(selector);
  const h = selector => host?.querySelector(selector);
  const listen = (type, fn) => unbind.push(room.onMessage(type, fn));
  const command = (action, extra = {}) => room.request('admin', { action, ...extra });
  const error = e => toast(e.message || '연결을 확인하고 다시 시도해 주세요.');

  function controls() {
    if (!host) return;
    const active = phase === 'countdown' || phase === 'open';
    h('#quiz-form').hidden = active;
    h('#quiz-preparation').hidden = active;
    h('#quiz-running').hidden = !active;
    h('#quiz-after').hidden = phase !== 'revealed';
    for (const button of document.querySelectorAll('[data-quiz-action]')) {
      const action = button.dataset.quizAction;
      button.disabled = !online || starting || (['finish', 'abort'].includes(action) ? !active : active) ||
        (action === 'next' && nextIndex >= bank.length);
    }
    h('#quiz-restart').disabled = active || starting || !bank.length;
  }

  function viewport() {
    const vv = window.visualViewport;
    zone.style.setProperty('--quiz-vvh', `${vv?.height || window.innerHeight}px`);
    zone.style.setProperty('--quiz-vvt', `${vv?.offsetTop || 0}px`);
    positionQuestion();
  }

  function positionQuestion() {
    const source = $('#quiz-question');
    if (!source || !liveQuestion) return;
    const rect = source.getBoundingClientRect();
    const style = getComputedStyle(source);
    // 높이도 제자리 칸에 맞춰 자른다. 글자 크기 설정 등으로 복제본이 더 커져도 아래 입력칸을 덮지 않게.
    Object.assign(liveQuestion.style, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
      padding: style.padding, font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
      color: style.color,
    });
  }

  function hideQuestion() {
    liveQuestion?.remove();
    liveQuestion = null;
    $('#quiz-question')?.classList.remove('quiz-question-reserved');
  }

  function showQuestion() {
    hideQuestion();
    // 시작 도장의 어두운 배경보다 위에 문제만 둔다. 입력칸이나 결과 카드는 복제하지 않는다.
    liveQuestion = document.createElement('h2');
    liveQuestion.id = 'quiz-live-question';
    liveQuestion.textContent = quiz.question;
    liveQuestion.setAttribute('aria-hidden', 'true');
    document.body.append(liveQuestion);
    positionQuestion();
    $('#quiz-question').classList.add('quiz-question-reserved');
  }

  function lockInput() {
    $('#quiz-answer')?.blur();
    for (const input of zone.querySelectorAll('input, button')) input.disabled = true;
    locked = true;
  }

  function stop() {
    audio?.stop('answer');
    cancelAnimationFrame(frame);
    lockInput();
    fx.skip();
    hideQuestion();
    zone.hidden = true;
    zone.replaceChildren();
    document.body.classList.remove('quiz-sheet-open');
    onCover(false);
    document.querySelector('#quiz-privacy')?.remove();
    quiz = null;
    phase = 'idle';
    secret = '';
    revealKey = '';
    controls();
  }

  function progress(value) {
    if (value.quizId && quiz?.quizId !== value.quizId) return;
    const text = `정답 ${value.correct || 0}명 · 제출 ${value.answered || 0}명`;
    if ($('#quiz-progress')) $('#quiz-progress').textContent = text;
    if (h('#host-quiz-progress')) h('#host-quiz-progress').textContent = text;
    const bar = document.querySelector('#board-progress');
    if (bar) bar.textContent = text;
  }

  function tick() {
    if (!quiz || phase === 'revealed') return;
    const now = clock.now();
    if (!opened && now >= quiz.startAt) {
      opened = true;
      phase = 'open';
      $('#quiz-question').textContent = quiz.question;
      if (!fx.root.hidden && now < quiz.startAt + QUESTION_LIFT_MAX_MS) showQuestion();
      zone.dataset.openedAt = String(now);
      if ($('#quiz-answer')) {
        $('#quiz-answer').value = '';
        if (viewer.role === 'guest' && !matchMedia('(pointer: coarse)').matches) $('#quiz-answer').focus({ preventScroll: true });
      }
      if ($('#quiz-options')) $('#quiz-options').hidden = false;
      $('#quiz-feedback').textContent = quiz.practice ? '연습 문제예요. 점수에 들어가지 않아요.' : '정답을 보내 주세요.';
      positionQuestion();
    }
    // 띄운 문제는 고정 위치라 문제 칸이 스크롤되거나 키보드로 화면이 바뀌면 어긋난다(폴드에서 입력칸과 겹침).
    // 띄워 둔 짧은 동안은 매 프레임 제자리에 맞추고, 도장이 사라지면 내린다.
    if (liveQuestion) {
      if (fx.root.hidden || now >= quiz.startAt + QUESTION_LIFT_MAX_MS) hideQuestion();
      else positionQuestion();
    }
    const remaining = Math.max(0, quiz.endsAt - now);
    $('#quiz-timer').textContent = opened ? `${Math.ceil(remaining / 1000)}초` : '곧 시작';
    $('#quiz-timebar').value = remaining;
    const canSend = online && !locked && !sending && opened && remaining > 0 &&
      now >= quiz.startAt + (quiz.type === 'choice' ? CHOICE_DELAY_MS : 0);
    for (const button of zone.querySelectorAll('button')) button.disabled = !canSend;
    if (remaining === 0 && !closed) {
      lockInput();
      hideQuestion();
      closed = true;
      void fx.closed({ audible: quiz.endsAt > visibleSince });
    }
    frame = requestAnimationFrame(tick);
  }

  function start(q, me = null, replay = true) {
    const same = quiz?.quizId === q.quizId;
    if (same && phase !== 'revealed') {
      if (!replay) fx.skip();
      if (me) showResult({ status: me.lastStatus, attemptsLeft: me.attemptsLeft });
      return;
    }
    cancelAnimationFrame(frame);
    fx.skip();
    hideQuestion();
    document.querySelector('#quiz-privacy')?.remove();
    quiz = q;
    audio?.stop('answer');
    correctSoundPlayed = false;
    maySoundForAnswer = () => false;
    phase = 'countdown';
    opened = false;
    closed = false;
    locked = false;
    sending = false;
    composing = false;
    pendingComposition = false;
    lastText = '';
    revealKey = '';
    clock.seed(q.serverTime);
    zone.hidden = false;
    zone.dataset.quizId = q.quizId;
    delete zone.dataset.openedAt;
    document.body.classList.toggle('quiz-sheet-open', viewer.role === 'guest');
    onCover(false);
    zone.innerHTML = `<div class="quiz-status"><span id="quiz-progress">정답 0명 · 제출 0명</span>
      <b id="quiz-timer">곧 시작</b></div><progress id="quiz-timebar"></progress>
      <h2 id="quiz-question">곧 문제가 나와요</h2>
      <form id="quiz-answer-form"><div id="quiz-options" hidden></div>
      <div id="quiz-text-answer"><label for="quiz-answer">나의 답</label>
      <input id="quiz-answer" type="text" autocomplete="off" autocapitalize="off" autocorrect="off"
        spellcheck="false" enterkeyhint="send" maxlength="40">
      <button class="button primary" id="quiz-send" disabled>보내기</button></div></form>
      <p id="quiz-feedback" role="status">입력칸을 눌러 키보드를 미리 열어 두세요.</p>
      <p id="quiz-attempts"></p>`;
    $('#quiz-timebar').max = q.seconds * 1000;
    $('#quiz-answer').inputMode = q.numeric ? 'decimal' : 'text';
    $('#quiz-text-answer').hidden = q.type === 'choice';
    $('#quiz-answer-form').hidden = viewer.role !== 'guest';
    $('#quiz-attempts').textContent = `기회 ${q.attempts}번${q.practice ? ' · 연습(점수 없음)' : ''}`;
    if (q.type === 'choice') {
      for (const [index, option] of q.options.entries()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'answer-option';
        button.textContent = `${index + 1}. ${option}`;
        button.dataset.choice = index;
        button.disabled = true;
        button.onclick = () => void submit(index);
        $('#quiz-options').append(button);
      }
    }
    const input = $('#quiz-answer');
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => {
      composing = false;
      if (pendingComposition) {
        pendingComposition = false;
        setTimeout(() => void submit(), 0);
      }
    });
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (composing) {
        pendingComposition = true;
      } else if (event.isComposing || event.keyCode === 229) {
        // compositionend가 먼저 온 키보드도 다음 작업에서 완성 문자열을 한 번 보낸다.
        setTimeout(() => void submit(), 0);
      } else {
        void submit();
      }
    });
    $('#quiz-answer-form').onsubmit = event => {
      event.preventDefault();
      if (composing) pendingComposition = true;
      else void submit();
    };
    if (me?.lastStatus) showResult({ status: me.lastStatus, attemptsLeft: me.attemptsLeft });
    progress({ answered: 0, correct: 0 });
    viewport();
    if (replay && clock.now() < q.startAt) void fx.countdown({ startAt: q.startAt });
    if (performance.now() - clock.syncedAt() > 30000) void clock.sync(3);
    controls();
    tick();
  }

  function showResult(result, audible = false) {
    if (!$('#quiz-feedback') || !result?.status) return;
    if (result.status === 'correct' && !correctSoundPlayed) {
      correctSoundPlayed = true;
      // 한 번만 답하는 문제의 received 응답이나 재접속 복원에서는 정답 소리를 내지 않는다.
      if (audible && viewer.role === 'guest') audio?.play('correct', { channel: 'answer' });
    }
    const messages = {
      correct: '정답이에요! 공개 때 기록을 확인해요.', wrong: '아쉬워요. 다시 도전해 보세요.',
      received: '제출했어요. 결과를 기다려 주세요.', early: '아직 시작 전이에요.',
      closed: '마감됐어요.', already: '이미 정답을 맞혔어요.', noAttempts: '기회를 모두 썼어요.',
      tooFast: '잠깐 기다렸다가 보내 주세요.', empty: '답을 적어 주세요.', denied: '제출할 수 없어요.',
    };
    $('#quiz-feedback').textContent = messages[result.status] || '';
    $('#quiz-feedback').dataset.status = result.status;
    if (result.attemptsLeft !== undefined) {
      $('#quiz-attempts').textContent = `남은 기회 ${result.attemptsLeft}번`;
    }
    if (result.status === 'wrong') $('#quiz-answer').value = '';
    if (['correct', 'received', 'already', 'noAttempts', 'closed'].includes(result.status) ||
        result.attemptsLeft === 0) lockInput();
  }

  async function submit(choice) {
    if (!quiz || !opened || locked || sending || !online || phase === 'revealed') return;
    const text = $('#quiz-answer').value;
    if (quiz.type === 'short' && (!text.trim() || composing)) return;
    const key = choice === undefined ? text : String(choice);
    if (key === lastText && performance.now() - lastSentAt < 300) return;
    sending = true;
    lastText = key;
    lastSentAt = performance.now();
    const quizId = quiz.quizId;
    const submitEpoch = visibilityEpoch;
    const submittedVisible = !document.hidden;
    const maySoundForThisAnswer = () => submittedVisible && !document.hidden && submitEpoch === visibilityEpoch;
    maySoundForAnswer = maySoundForThisAnswer;
    try {
      const result = await room.request('answer', { quizId, text, choice });
      if (quiz?.quizId === quizId && phase !== 'revealed') showResult(result, maySoundForThisAnswer());
    } catch (e) {
      error(e);
    } finally {
      sending = false;
    }
  }

  function reveal(payload, replay = true) {
    const key = JSON.stringify(payload);
    if (key === revealKey) return;
    revealKey = key;
    cancelAnimationFrame(frame);
    lockInput();
    hideQuestion();
    phase = 'revealed';
    onCover(viewer.role === 'guest' && window.innerWidth < 768);
    secret = '';
    zone.hidden = true;
    document.body.classList.remove('quiz-sheet-open');
    if (replay && !closed) void fx.closed({ audible: quiz?.endsAt > visibleSince });
    else if (!replay) fx.skip();
    closed = true;
    const mineResult = payload.results.find(row => row.id === viewer.id);
    const mine = viewer.role === 'host' ? '' : mineResult ?
      `내 기록 ${mineResult.recordText} · ${mineResult.rank}등` : `아쉬워요! 정답은 ${payload.answerText}`;
    void fx.reveal(payload, { mine, replay, audible: payload.revealAt >= visibleSince }).catch(error);
    if (!document.querySelector('#quiz-privacy')) {
      const privacy = document.createElement('p');
      privacy.id = 'quiz-privacy';
      privacy.textContent = '가장 빠른 사람의 별명이 칠판에 떠요. 답안은 수업 중 서버 메모리에만 있어요.';
      document.body.append(privacy);
    }
    controls();
  }

  function restore(state) {
    clock.seed(state.serverTime);
    if (state.phase === 'idle') stop();
    else if (state.phase === 'revealed') {
      quiz = state.quiz;
      reveal(state.reveal, false);
    } else {
      start(state.quiz, state.me, false);
      progress(state.progress);
    }
  }

  function readSpec() {
    const type = h('#quiz-type').value;
    const base = {
      type, question: h('#question').value, seconds: Number(h('#quiz-seconds').value),
      practice: h('#quiz-practice').checked, explanation: h('#explanation').value,
    };
    if (type === 'short') return {
      ...base, answers: [h('#quiz-answer-key').value, ...splitAcceptedInput(h('#quiz-alternates').value)],
      attempts: Number(h('#quiz-attempts-setting').value),
      numeric: h('#quiz-numeric').checked, strict: h('#quiz-strict').checked,
    };
    return {
      ...base, options: h('#quiz-choice-options').value.split('\n').map(x => x.trim()).filter(Boolean),
      correct: Number(h('#quiz-correct-choice').value) - 1,
    };
  }

  function fillSpec(q) {
    h('#quiz-type').value = q.type || (q.options ? 'choice' : 'short');
    h('#question').value = q.question || '';
    h('#quiz-answer-key').value = q.answers?.[0] || '';
    h('#quiz-alternates').value = q.answers?.slice(1).join(', ') || '';
    h('#quiz-seconds').value = q.seconds || 20;
    h('#quiz-attempts-setting').value = q.attempts || 3;
    h('#quiz-choice-options').value = q.options?.join('\n') || '';
    h('#quiz-correct-choice').value = (q.correct || 0) + 1;
    h('#explanation').value = q.explanation || '';
    h('#quiz-practice').checked = q.practice === true;
    h('#quiz-numeric').checked = q.numeric === true;
    h('#quiz-strict').checked = q.strict === true;
    changeType();
    maskAnswers();
  }

  function maskAnswers() {
    for (const input of host.querySelectorAll('.quiz-secret')) {
      const cover = input.nextElementSibling;
      const mask = !CSS.supports('-webkit-text-security', 'disc') && input !== document.activeElement;
      input.hidden = mask;
      cover.hidden = !mask;
      cover.textContent = input.value ? '정답 입력됨 ●●● · 편집' : '정답 입력 · 편집';
    }
    h('#accepted-count').textContent = `인정하는 답 ${readSpec().answers?.filter(Boolean).length || 0}개`;
  }

  function changeType() {
    const short = h('#quiz-type').value === 'short';
    h('#quiz-short-fields').hidden = !short;
    h('#quiz-choice-fields').hidden = short;
    for (const tab of host.querySelectorAll('[data-quiz-type]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.quizType === h('#quiz-type').value));
    }
  }

  async function launch(spec, finalInSet = false) {
    if (starting) return;
    validateQuizSpec(spec);
    starting = true;
    controls();
    try {
    const type = spec.type || (spec.options ? 'choice' : 'short');
    secret = type === 'choice' ? spec.options?.[spec.correct] : spec.answers?.join(', ');
    const result = await command('quiz', { quiz: spec, finalInSet });
    if (!result?.ok) {
      secret = '';
      throw new Error(result?.error || '문제 설정을 확인해 주세요.');
    }
    resetEditor();
    if (bank[nextIndex] && specIdentity(spec) === specIdentity(bank[nextIndex])) {
      nextIndex += 1;
      saveProgress();
      renderBank();
    }
    h('#quiz-preparation').open = false;
    } finally {
      starting = false;
      controls();
    }
  }

  function specIdentity(q) {
    const type = q.type || (q.options ? 'choice' : 'short');
    return JSON.stringify([
      type, q.question, q.answers || null, q.options || null, q.correct ?? null,
      q.seconds ?? 20, type === 'choice' ? 1 : q.attempts ?? 3,
      !!q.practice, !!q.strict, !!q.numeric, q.explanation || '',
    ]);
  }

  function saveBank() {
    let stored = true;
    try {
      localStorage.setItem(BANK_KEY, JSON.stringify(bank));
    } catch {
      stored = false;
      toast('이 기기에 목록을 저장하지 못했어요. JSON으로 내보내 주세요.');
    }
    saveProgress();
    h('#quiz-save-status').textContent = stored ? `${bank.length}문제 저장됨 · 이 브라우저에 보관` :
      '저장 실패 · 창을 닫기 전에 문제 파일로 내보내 주세요';
    renderBank();
    return stored;
  }

  function saveProgress() {
    try { sessionStorage.setItem(progressKey, JSON.stringify({ bank, nextIndex })); } catch {}
  }

  function resetEditor() {
    editingIndex = null;
    h('#quiz-form').reset();
    h('#quiz-editor-title').textContent = '새 문제 작성';
    h('#quiz-save').textContent = '목록에 저장하고 다음 문제 작성';
    changeType();
    maskAnswers();
  }

  function renderBank() {
    const list = h('#quiz-bank');
    list.replaceChildren();
    bank.forEach((q, index) => {
      const row = document.createElement('li');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = `${index + 1}. ${q.question}`;
      edit.onclick = () => {
        fillSpec(q);
        editingIndex = index;
        h('#quiz-editor-title').textContent = `${index + 1}번 문제 수정`;
        h('#quiz-save').textContent = '수정 내용 저장';
        nextIndex = index;
        saveProgress();
        renderBank();
        h('#quiz-form').scrollIntoView({ block: 'start' });
      };
      edit.className = 'quiz-bank-question';
      edit.setAttribute('aria-label', `${index + 1}번 문제 수정: ${q.question}`);
      const actions = document.createElement('div');
      actions.className = 'quiz-bank-actions';
      for (const [delta, label] of [[-1, '위로'], [1, '아래로']]) {
        const move = document.createElement('button');
        move.type = 'button';
        move.textContent = label;
        move.setAttribute('aria-label', `${index + 1}번 문제 ${label}`);
        const target = index + delta;
        move.disabled = target < 0 || target >= bank.length;
        move.onclick = () => {
          [bank[index], bank[target]] = [bank[target], bank[index]];
          if (nextIndex === index) nextIndex = target;
          else if (nextIndex === target) nextIndex = index;
          resetEditor();
          saveBank();
        };
        actions.append(move);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '삭제';
      remove.setAttribute('aria-label', `${index + 1}번 문제 삭제`);
      remove.onclick = () => {
        bank.splice(index, 1);
        if (index < nextIndex) nextIndex -= 1;
        nextIndex = Math.min(nextIndex, bank.length);
        resetEditor();
        saveBank();
      };
      actions.append(remove);
      row.append(edit, actions);
      row.classList.toggle('quiz-bank-current', index === nextIndex);
      list.append(row);
    });
    h('#quiz-bank-position').textContent = !bank.length ? '아직 준비한 문제가 없어요. 아래에서 문제를 저장해 주세요.' :
      nextIndex < bank.length ? `준비한 문제 ${bank.length}개 · 다음은 ${nextIndex + 1}번` :
      `${bank.length}문제를 모두 진행했어요.`;
    h('#quiz-next-preview').textContent = bank[nextIndex]?.question || '';
    h('#quiz-bank-start').textContent = nextIndex < bank.length ? `${nextIndex + 1}번 문제 시작!` :
      bank.length ? '준비한 문제 모두 완료' : '문제를 먼저 저장해 주세요';
    controls();
  }

  async function next() {
    fx.skip();
    if (nextIndex < bank.length) {
      await launch(bank[nextIndex], nextIndex === bank.length - 1);
    } else {
      if (phase === 'revealed') await command('closeQuiz');
      if (board) toast('준비한 문제를 모두 풀었어요. 칠판 모드를 끄고 문제를 준비해 주세요.');
      else { h('#quiz-preparation').open = true; h('#question').focus(); }
    }
  }

  function setBoard(value) {
    board = value;
    document.body.classList.toggle('quiz-board', value);
    document.querySelector('#board-toggle').textContent = value ? '퀴즈 화면 닫기' : '퀴즈 전체화면';
    document.querySelector('#board-toolbar').hidden = !value;
    document.activeElement?.blur();
    hideSecret();
    window.dispatchEvent(new Event('resize'));
    positionQuestion();
    if (value) void enterFullscreen(toast);
    else void exitFullscreen();
  }

  function hideSecret() {
    if (h('#host-secret')) h('#host-secret').textContent = '';
  }

  function escape(event) {
    if (event.key === 'Escape' && board) setBoard(false);
  }

  if (host) {
    host.innerHTML = `<h3>오늘의 퀴즈</h3>
      <div id="quiz-sequence"><p id="quiz-bank-position" aria-live="polite"></p>
        <p id="quiz-next-preview"></p>
        <button class="button primary wide" id="quiz-bank-start" data-quiz-action="next">1번 문제 시작!</button>
        <button class="button light wide" id="quiz-restart" type="button">1번부터 다시 준비</button>
        <p class="tiny">마지막 문제의 결과를 보여준 뒤 누적 1등을 자동으로 발표해요.</p></div>
      <details id="quiz-preparation"><summary>문제 미리 만들어 놓기</summary>
        <p class="tiny">문제와 정답을 적고 저장하면 다음 문제를 계속 만들 수 있어요. 10문제 이상도 준비할 수 있어요.</p>
        <p id="quiz-save-status" role="status">저장한 목록은 이 브라우저에 남아요. 다른 기기에서는 문제 파일을 불러오세요.</p>
        <form id="quiz-form"><h4 id="quiz-editor-title">새 문제 작성</h4>
      <div class="quiz-type-tabs" role="tablist" aria-label="문제 종류">
        <button type="button" role="tab" data-quiz-type="short" aria-selected="true">단답형</button>
        <button type="button" role="tab" data-quiz-type="choice" aria-selected="false">객관식</button></div>
      <select id="quiz-type" hidden aria-label="문제 종류"><option value="short">단답형</option>
        <option value="choice">객관식</option></select>
      <label>문제<textarea id="question" maxlength="200" required rows="2"></textarea></label>
      <div id="quiz-short-fields"><label>정답<input id="quiz-answer-key" class="quiz-secret"
        type="text" maxlength="40" autocomplete="off"><button type="button" hidden></button></label>
      <label>다른 정답도 인정<input id="quiz-alternates" class="quiz-secret" type="text" maxlength="410"
        autocomplete="off"><button type="button" hidden></button></label>
      <small id="accepted-count"></small><label>기회<select id="quiz-attempts-setting">
        <option value="1">1번</option><option value="2">2번</option><option value="3" selected>3번</option>
        <option value="4">4번</option><option value="5">5번</option></select></label>
      <label class="quiz-check"><input id="quiz-numeric" type="checkbox">숫자 답</label>
      <label class="quiz-check"><input id="quiz-strict" type="checkbox">엄격하게(띄어쓰기도 채점)</label></div>
      <div id="quiz-choice-fields" hidden><label>보기(한 줄에 하나, 2~4개)
        <textarea id="quiz-choice-options" maxlength="803" rows="4"></textarea></label>
      <label>정답 번호<input class="quiz-secret" id="quiz-correct-choice" type="text" inputmode="numeric"
        value="1" maxlength="1" autocomplete="off"><button type="button" hidden></button></label></div>
      <label>제한 시간(초)<input id="quiz-seconds" type="number" min="5" max="120" value="20"
        list="quiz-time-options" required></label><datalist id="quiz-time-options">
        <option value="10"></option><option value="20"></option><option value="30"></option>
        <option value="60"></option></datalist>
      <label>해설<textarea id="explanation" maxlength="300" rows="2"></textarea></label>
      <label class="quiz-check"><input id="quiz-practice" type="checkbox">연습(점수 없음)</label>
      <p class="tiny muted">띄어쓰기·대소문자·문장부호와 끝의 ‘입니다/요’는 무시하고 채점해요.
        엄격하게를 켜면 띄어쓰기와 문장부호도 비교해요.</p>
      <button class="button primary wide" type="button" id="quiz-save">목록에 저장하고 다음 문제 작성</button>
      <button class="button light wide" type="button" id="quiz-new">새 문제 작성</button>
      <button class="button light wide" id="start-quiz">지금 입력한 문제 바로 시작</button></form>
        <h4>저장한 문제 목록</h4><ol id="quiz-bank"></ol>
        <div class="quiz-file-tools"><h4>문제 파일 보관·불러오기</h4>
        <p class="tiny">정답이 포함된 파일은 학생에게 공유하지 마세요.</p>
        <button id="sample-quiz">예시 목록 불러오기</button><button id="quiz-export">문제 파일 내보내기</button>
        <label>문제 파일 불러오기<input id="quiz-import" type="file" accept=".json,.xlsx,.csv,.pdf"></label>
        <button type="button" id="quiz-paste">글로 붙여넣기</button>
        <button type="button" id="quiz-template">엑셀 양식 내려받기(CSV)</button>
        <p class="tiny">양식대로 채워 올리면 가장 정확해요. XLSX·CSV 5MB, PDF 20MB, JSON 500KB까지.<br>
        파일은 이 브라우저 안에서만 읽고 서버로 보내지 않아요. 추가한 문항은 퀴즈를 시작할 때 교실에 전달돼요.</p>
        <p id="quiz-import-status" class="tiny" role="status"></p>
        </div></details>
      <div id="quiz-running" hidden><p id="host-quiz-progress"></p>
        <button data-quiz-action="finish" class="button soft">지금 마감</button>
        <button data-quiz-action="abort" class="button light">취소</button>
        <button id="peek-answer" type="button">정답 보기(누르는 동안)</button>
        <span id="host-secret"></span></div>
      <div id="quiz-after" hidden><button data-quiz-action="next" class="button primary">다음 문제</button>
        <button data-quiz-action="closeQuiz" class="button light">결과 닫기</button></div>`;
    const toggle = document.createElement('button');
    toggle.id = 'board-toggle';
    toggle.className = 'button light compact';
    toggle.textContent = '퀴즈 전체화면';
    toggle.onclick = () => setBoard(!board);
    document.querySelector('.header-actions').prepend(toggle);
    const toolbar = document.createElement('nav');
    toolbar.id = 'board-toolbar';
    toolbar.hidden = true;
    toolbar.innerHTML = `<span id="board-progress">준비한 문제를 시작하세요</span>
      <button data-quiz-action="next">다음 문제</button><button data-quiz-action="finish">지금 마감</button>
      <button data-quiz-action="abort">취소</button><button data-quiz-action="award">1등 발표</button>
      <button data-quiz-action="coopOpen">게임방 열기</button>
      <button id="board-fullscreen">전체화면</button><button id="board-exit">관리자로 돌아가기</button>`;
    document.body.append(toolbar);
    boardSoundControl = createSoundControl(audio);
    if (boardSoundControl) toolbar.append(boardSoundControl.button);
    document.querySelector('#board-exit').onclick = () => setBoard(false);
    document.querySelector('#board-fullscreen').onclick = () => void enterFullscreen(toast);
    for (const button of document.querySelectorAll('[data-quiz-action]')) {
      button.onclick = () => {
        const action = button.dataset.quizAction;
        void (action === 'next' ? next() : command(action)).catch(error);
      };
    }
    h('#quiz-form').onsubmit = event => {
      event.preventDefault();
      void launch(readSpec()).catch(error);
    };
    h('#quiz-type').onchange = changeType;
    for (const tab of host.querySelectorAll('[data-quiz-type]')) {
      tab.onclick = () => {
        h('#quiz-type').value = tab.dataset.quizType;
        changeType();
      };
    }
    h('#quiz-save').onclick = () => {
      if (editingIndex === null && bank.length >= 200) return toast('목록은 200문제까지 저장할 수 있어요.');
      const q = readSpec();
      try { validateQuizSpec(q); } catch (e) { error(e); return; }
      if (editingIndex === null) bank.push(q);
      else bank[editingIndex] = q;
      if (saveBank()) {
        resetEditor();
        h('#question').focus();
      }
    };
    h('#quiz-new').onclick = () => { resetEditor(); h('#question').focus(); };
    h('#quiz-restart').onclick = () => { nextIndex = 0; saveProgress(); renderBank(); };
    h('#sample-quiz').onclick = () => {
      if (bank.length > 198) return toast('목록은 200문제까지 저장할 수 있어요.');
      bank.push(structuredClone(content.sampleShortQuiz), { ...structuredClone(content.sampleQuiz), type: 'choice' });
      fillSpec(bank[nextIndex] || bank[0]);
      saveBank();
    };
    h('#quiz-export').onclick = () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(bank, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'quiz-list.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    quizImporter = createQuizImporter({ host, capacity: () => 200 - bank.length, toast,
      add: specs => {
        specs.forEach(validateQuizSpec);
        bank.push(...specs.slice(0, 200 - bank.length));
        resetEditor();
        saveBank();
      },
    });
    for (const input of host.querySelectorAll('.quiz-secret')) {
      input.onblur = maskAnswers;
      input.oninput = maskAnswers;
      input.nextElementSibling.onclick = () => {
        input.hidden = false;
        input.nextElementSibling.hidden = true;
        input.focus();
      };
    }
    const peek = h('#peek-answer');
    peek.onpointerdown = event => {
      peek.setPointerCapture(event.pointerId);
      h('#host-secret').textContent = secret || '이 기기에서 낸 정답만 볼 수 있어요.';
    };
    peek.onpointerup = hideSecret;
    peek.onpointercancel = hideSecret;
    peek.onblur = hideSecret;
    peek.onkeydown = event => {
      if ([' ', 'Enter'].includes(event.key)) {
        event.preventDefault();
        h('#host-secret').textContent = secret;
      }
    };
    peek.onkeyup = hideSecret;
    try {
      const stored = JSON.parse(localStorage.getItem(BANK_KEY) || '[]');
      if (Array.isArray(stored)) bank = stored.slice(0, 200).filter(q => {
        try { validateQuizSpec(q); return true; } catch { return false; }
      });
      const progress = JSON.parse(sessionStorage.getItem(progressKey) || 'null');
      if (progress && JSON.stringify(progress.bank) === JSON.stringify(bank) && Number.isInteger(progress.nextIndex)) {
        nextIndex = Math.max(0, Math.min(progress.nextIndex, bank.length));
      }
    } catch {
      // 손상된 저장값은 빈 목록으로 시작한다.
    }
    renderBank();
    maskAnswers();
    controls();
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', hideSecret);
  }

  listen('welcome', m => {
    viewer.id = m.id;
    viewer.role = m.role;
    online = true;
    void clock.sync(5);
  });
  listen('quiz', q => start(q));
  listen('quizProgress', progress);
  listen('quizReveal', payload => reveal(payload));
  listen('quizState', restore);
  listen('quizAborted', stop);
  listen('quizIdle', stop);
  listen('answerResult', result => showResult(result, maySoundForAnswer()));
  room.onDrop(() => {
    online = false;
    fx.skip();
    audio?.stop('answer');
    hideSecret();
    controls();
  });
  room.onLeave(() => {
    online = false;
    fx.skip();
    audio?.stop('answer');
    lockInput();
    controls();
  });
  const interval = setInterval(() => { if (online) void clock.sync(3); }, 60000);
  const visibility = async () => {
    hideSecret();
    if (document.hidden) { visibilityEpoch++; return; }
    visibleSince = clock.now();
    if (!online) return;
    await clock.sync(3);
    try {
      const state = await room.request('quizState');
      if (alive) restore(state);
    } catch (e) {
      if (alive) error(e);
    }
  };
  document.addEventListener('visibilitychange', visibility);
  window.visualViewport?.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('scroll', viewport);
  window.addEventListener('resize', viewport);
  return {
    clearPresentation: stop,
    destroy() {
      alive = false;
      stop();
      clearInterval(interval);
      for (const off of unbind) if (typeof off === 'function') off();
      fx.destroy();
      boardSoundControl?.destroy();
      quizImporter?.destroy();
      document.querySelector('#board-toolbar')?.remove();
      document.body.classList.remove('quiz-board');
      document.removeEventListener('visibilitychange', visibility);
      window.visualViewport?.removeEventListener('resize', viewport);
      window.visualViewport?.removeEventListener('scroll', viewport);
      window.removeEventListener('resize', viewport);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', hideSecret);
    },
  };
}
