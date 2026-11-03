import { Room, ServerError, matchMaker } from "@colyseus/core";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { NETWORK, walkable, cleanAvatarForKind, consumeMovementBudget } from "../shared/world.js";
import { QuizEngine } from './quiz-engine.mjs';
import { CoopGame, rankStudents } from './coop-game.mjs';
import { GRACE_MS, ALL_DONE_DELAY_MS, PROGRESS_INTERVAL_MS } from '../shared/quiz-core.js';
import { authorizeTeacher, createFailureLimiter, keyMatches, withinMessageLimit } from './guard.mjs';
let activeRooms = 0;
const hashPassword = promisify(scrypt);
const unsafeName = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const clean = (s, n) => typeof s === "string" ? 
  s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, n) : 
  "";
// 기존 matchmaking 경로에 읽기 전용 조회만 추가한다. 좌석 예약·입장·snapshot 전송은 하지 않는다.
const invokeMatchmake = matchMaker.controller.invokeMethod;
matchMaker.controller.invokeMethod = async function(method, roomName, options, auth) {
  if (method !== 'avatarKind') return invokeMatchmake.call(this, method, roomName, options, auth);
  if (!/^[A-F0-9]{6}$/.test(roomName)) throw new ServerError(400, '교실 코드를 확인해주세요.');
  const listing = await matchMaker.getRoomById(roomName);
  if (!listing) throw new ServerError(404, '교실을 찾지 못했어요. 코드를 확인해주세요.');
  return { avatarKind: listing.metadata?.avatarKind === 'v05' ? 'v05' : 'v02' };
};

export class Classroom extends Room {
  // 실제 학생 정원은 별도로 40명 검사한다. 41명 전원의 이전 재연결 예약과
  // 새 탭의 좌석 예약이 잠깐 겹쳐도 matchmaking 단계에서 막히지 않게 한다.
  maxClients = 85;
  autoDispose = false;
  people = new Map();
  connections = new Map();
  chat = [];
  quiz = null;
  quizEngine = new QuizEngine();
  coopGame = new CoopGame();
  quizDeadline;
  quizAllDone;
  quizProgressTimer;
  finaleTimer;
  finalInSet = false;
  lastQuizProgress = '';
  lastQuizProgressAt = 0;
  admissionLocked = false;
  chatOpen = true;
  announcement = "";
  winner = null;
  revision = 0;
  publishedPeople = new Map();
  publishedFields = {};
  dirtyPositions = new Set();
  lastPositionRepair = 0;
  authAttempts = [];
  authPending = false;
  teacherAttempts = createFailureLimiter();
  async onCreate(options) {
    this.config = Classroom.config;
    if (!withinMessageLimit(options, 4096)) throw new ServerError(413, '교실 설정이 너무 커요.');
    if (this.config.cloudMode && !await authorizeTeacher(options.teacherKey, this.config)) {
      throw new ServerError(403, '교사용 키가 맞지 않아요.');
    }
    if (!this.config.cloudMode && (typeof options.password !== 'string' ||
      options.password.length < 8 || options.password.length > 100)) {
      throw new ServerError(400, '관리자 비밀번호는 8~100자로 정해주세요.');
    }
    // 비동기 초기화 전에 자리를 선점해 동시 생성도 상한을 넘지 않게 한다.
    if (activeRooms >= this.config.maxRooms) {
      throw new ServerError(503, '지금은 교실을 더 만들 수 없어요. 쓰지 않는 교실을 닫아주세요.');
    }
    activeRooms += 1;
    this.countedRoom = true;
    try {
      await this.initializeRoom(options);
    } catch (error) {
      this.releaseRoom();
      throw error;
    }
  }
  async initializeRoom(options) {
    this.avatarKind = options.avatarKind === "v05" ? "v05" : "v02";
    this.quizEngine = new QuizEngine({ avatarKind: this.avatarKind });
    this.roomId = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
    this.title = clean(options.title, 28) || "우리의 교실";
    await this.setMetadata({ avatarKind: this.avatarKind });
    if (!this.config.cloudMode) {
      this.salt = randomBytes(16);
      this.secret = await hashPassword(options.password, this.salt, 32);
    }
    this.lastActive = Date.now();
    this.setPrivate(true);
    // Colyseus의 전역 제한은 이동 폭주도 4002로 종료한다. 종류별로 버리고 연결은 유지한다.
    this.maxMessagesPerSecond = Infinity;
    const register = this.onMessage.bind(this);
    this.onMessage = (type, handler) => register(type, (client, message, ctx) => {
      if (message !== undefined && !withinMessageLimit(message)) return { status: 'tooLarge' };
      if (type !== 'move' && type !== 'coopMove' &&
          !this.acceptMessage(client, 'control', 30, 40)) return { status: 'tooFast' };
      return handler(client, message, ctx);
    });
    this.onMessage("ready", (c) => {
      const p = this.person(c);
      if (!p || c.classroomReady) return;
      c.classroomReady = true;
      const a = this.quizEngine.stateFor(p.id).me;
      c.send(
        "welcome", 
        { 
        id: p.id, 
        token: p.token, 
        role: p.role, 
        code: this.roomId, 
        avatarKind: this.avatarKind, 
        answered: !!a?.attemptsUsed,
        quizId: this.quiz?.id, 
        choice: a?.choice 
      }
      );
      c.send('snapshot', this.snapshot());
      c.send('quizState', this.quizEngine.stateFor(p.id));
    });
    this.onMessage("move", (c, m) => this.move(c, m));
    this.onMessage('coopMove', (c, m) => this.coopMove(c, m));
    this.onMessage('coopCheer', (c, m) => this.coopCheer(c, m));
    this.onMessage("avatar", (c, m) => {
      const p = this.person(c);
      if (!p || Date.now() - (p.lastAvatar || 0) < 750) return;
      p.avatar = cleanAvatarForKind(m, this.avatarKind);
      p.lastAvatar = Date.now();
      this.sync();
    });
    this.onMessage("chat", (c, m) => this.say(c, m));
    this.onMessage('time', () => Date.now());
    this.onMessage('quizState', c => this.quizEngine.stateFor(this.person(c)?.id));
    this.onMessage('answer', (c, m, ctx) => this.answer(c, m, ctx));
    this.onMessage("admin", (c, m) => this.admin(c, m));
    this.onMessage("reaction", (c, m) => {
      const p = this.person(c);
      if (!p || 
        !["hello", "heart", "clap", "hand"].includes(m) || 
        Date.now() - (p.lastReaction || 
        0) < 1800) 
        return;
      p.lastReaction = Date.now();
      this.broadcast("reaction", { id: p.id, kind: m });
    });
    this.clock.setInterval(() => {
      if (this.quiz?.status === 'open' && Date.now() >= this.quiz.endsAt + GRACE_MS) this.finishQuiz('time');
      if (!this.clients.length && Date.now() - this.lastActive > 90 * 60 * 1e3) this.disconnect();
      this.expireSeats();
      this.flushPositions();
    }, 100);
    this.clock.setInterval(() => this.tickCoop(), 66);
  }
  async onAuth(client, options) {
    if (!withinMessageLimit(options, 4096)) throw new ServerError(413, '입장 정보가 너무 커요.');
    const host = [...this.people.values()].find(p => p.role === 'host');
    // 재입장 토큰은 비밀번호 실패 제한과 무관하게 먼저 검사한다.
    if (options.hostToken !== undefined) {
      if (!host || !keyMatches(options.hostToken, host.token)) {
        throw new ServerError(403, '관리자 재입장 정보를 확인해주세요.');
      }
      if (host.connected) throw new ServerError(409, '다른 창에 관리자가 접속해 있습니다.');
      return { role: 'host' };
    }
    if (this.config?.cloudMode && options.teacherKey !== undefined) {
      if (!await authorizeTeacher(options.teacherKey, this.config)) {
        const candidate = options.teacherKey;
        if (typeof candidate === 'string' && Buffer.byteLength(candidate) <= 256) {
          const limited = this.teacherAttempts.check(this.roomId, candidate);
          this.teacherAttempts.fail(this.roomId, candidate);
          if (limited.locked) throw new ServerError(429, '이 키의 인증은 잠시 후 다시 시도해주세요.');
        }
        throw new ServerError(403, '교사용 키가 맞지 않아요.');
      }
      this.teacherAttempts.success(this.roomId, options.teacherKey);
      if (host?.connected) throw new ServerError(409, '다른 창에 관리자가 접속해 있습니다.');
      return { role: 'host' };
    }
    if (options.password) {
      if (this.config?.cloudMode) throw new ServerError(403, '교사용 키로 입장해주세요.');
      if (typeof options.password !== "string" || 
        options.password.length > 100) 
        throw new ServerError(403, "관리자 비밀번호를 확인해주세요.");
      const now = Date.now();
      this.authAttempts = this.authAttempts.filter(time => now - time < 60000);
      if (this.authPending || this.authAttempts.length >= 5)
        throw new ServerError(429, "관리자 인증은 잠시 후 다시 시도해주세요.");
      this.authAttempts.push(now);
      this.authPending = true;
      try {
        if (!timingSafeEqual(await hashPassword(options.password, this.salt, 32), this.secret))
          throw new ServerError(403, "관리자 비밀번호를 확인해주세요.");
      } finally {
        this.authPending = false;
      }
      if ([...this.people.values()].some((p) => p.role === "host" && 
        p.connected)) 
        throw new ServerError(409, "다른 창에 관리자가 접속해 있습니다.");
      return { role: "host" };
    }
    const existing = [...this.people.values()].find((p) => p.token === options.resumeToken);
    this.expireSeats();
    if (existing?.banned) throw new ServerError(403, "관리자가 퇴장 처리했습니다.");
    if (existing?.role === "host") throw new ServerError(403, "관리자는 비밀번호로 다시 입장해주세요.");
    if (existing?.connected) throw new ServerError(409, "이미 연결된 참가자입니다. 기존 창을 이용해주세요.");
    if (this.admissionLocked && !existing) throw new ServerError(403, "지금은 입장이 잠겨 있어요. 관리자에게 알려주세요.");
    if ((!existing || existing.expired) && this.occupiedGuests().length >= 40)
      throw new ServerError(403, "한 교실에는 참가자 40명까지 입장할 수 있어요.");
    if (!existing && !clean(options.name, 12)) throw new ServerError(400, "별명을 입력해주세요.");
    if (!existing && (unsafeName.test(options.name) || /^관리자/.test(clean(options.name.normalize('NFKC'), 12))))
      throw new ServerError(400, "관리자로 시작하는 별명과 방향 제어 문자는 사용할 수 없어요.");
    return { role: "guest", existingId: existing?.id };
  }
  onJoin(client, options, auth) {
    let p = this.people.get(auth.existingId);
    if (auth.role === "host") p = [...this.people.values()].find((p2) => p2.role === "host");
    if (p?.banned) throw new ServerError(403, "관리자가 퇴장 처리했습니다.");
    if (p?.connected) throw new ServerError(409, "이미 연결된 참가자입니다. 기존 창을 이용해주세요.");
    this.expireSeats();
    if ((!p || p.expired) && auth.role === "guest" && this.occupiedGuests().length >= 40)
      throw new ServerError(403, "한 교실에는 참가자 40명까지 입장할 수 있어요.");
    const firstJoin = !p;
    if (!p) {
      const occupied = new Set(this.occupiedGuests().map(p2 => p2.seat));
      let seat = 0;
      while (occupied.has(seat)) seat++;
      p = { 
        id: randomBytes(8).toString("hex"), 
        token: randomBytes(24).toString("hex"), 
        role: auth.role, 
        name: this.uniqueName(clean(options.name, 12) || "선생님"),
        avatar: cleanAvatarForKind(options.avatar, this.avatarKind), 
        seat, 
        x: auth.role === "host" ? 576 : 240 + seat % 10 * 72, 
        y: auth.role === "host" ? 335 : 420 + Math.floor(seat / 10) * 92, 
        score: 0, 
        points: 0,
        firsts: 0,
        elapsed: 0, 
        muted: false, 
        connected: true, 
        lastMove: Date.now(), 
        lastChat: 0 
      };
      this.people.set(p.id, p);
    }
    if (p.expired && p.role === 'guest') {
      const occupied = new Set(this.occupiedGuests().map(other => other.seat));
      p.seat = 0;
      while (occupied.has(p.seat)) p.seat++;
      p.x = 240 + p.seat % 10 * 72;
      p.y = 420 + Math.floor(p.seat / 10) * 92;
    }
    p.expired = false;
    p.disconnectedAt = null;
    p.connected = true;
    this.coopGame.setConnected(p.id, true);
    p.lastMove = Date.now();
    p.moveBudget = 0;
    p.sessionId = client.sessionId;
    this.connections.set(client.sessionId, p.id);
    // 브라우저 토큰으로 새 탭이 복귀하면 이전 SDK 재연결 예약을 해제한다.
    p.reconnection?.reject();
    p.reconnection = null;
    this.lastActive = Date.now();
    client.send(
      "welcome", 
      { 
      id: p.id, 
      token: p.token, 
      role: p.role, 
      code: this.roomId, 
      avatarKind: this.avatarKind, 
      answered: !!this.quizEngine.stateFor(p.id).me?.attemptsUsed
    }
    );
    this.sync();
    if (firstJoin) this.system(`${p.name} 님이 교실에 들어왔어요.`);
  }
  onDrop(client) {
    // 폐기 중인 교실에는 새 재연결 예약을 만들 수 없다.
    if (this.closing) return;
    const p = this.person(client);
    if (!p || p.banned || p.sessionId !== client.sessionId) return;
    this.markDisconnected(p);
    p.reconnection = this.allowReconnection(client, NETWORK.reconnectSeconds);
  }
  onReconnect(client) {
    const p = this.person(client);
    if (!p || p.banned || p.sessionId !== client.sessionId) {
      client.leave(4000);
      return;
    }
    p.connected = true;
    this.coopGame.setConnected(p.id, true);
    p.disconnectedAt = null;
    p.lastMove = Date.now();
    p.moveBudget = 0;
    p.reconnection = null;
    client.classroomReady = false;
    this.sync();
    // SDK onReconnect에서 ready를 보내 초기 상태와 개인 답안을 복원한다.
  }
  onLeave(client) {
    const p = this.person(client);
    if (p && p.sessionId === client.sessionId) this.markDisconnected(p);
    this.connections.delete(client.sessionId);
    this.lastActive = Date.now();
  }
  markDisconnected(p) {
    p.connected = false;
    this.coopGame.setConnected(p.id, false);
    p.disconnectedAt ??= Date.now();
    this.dropFromWinner(p.id);
    this.sync();
    this.checkAllDone();
  }
  // 1등이 빠지면 지금처럼 발표를 내리고, 2·3등은 시상대에서만 뺀다.
  dropFromWinner(id) {
    if (this.winner?.ids?.includes(id)) this.winner = null;
    else if (this.winner?.podium?.some(entry => entry.id === id))
      this.winner.podium = this.winner.podium.filter(entry => entry.id !== id);
  }
  occupiedGuests() {
    return [...this.people.values()].filter(p => p.role === 'guest' && !p.banned && !p.expired);
  }
  expireSeats(now = Date.now()) {
    let changed = false;
    for (const p of this.people.values()) {
      if (!p.connected && !p.expired && p.disconnectedAt != null &&
          now - p.disconnectedAt >= NETWORK.disconnectedSeatMs) {
        p.expired = true;
        changed = true;
      }
    }
    if (changed) this.sync();
  }
  uniqueName(base) {
    const names = new Set([...this.people.values()].map(p => p.name));
    let name = base, suffix = 2;
    while (names.has(name)) name = `${base} (${suffix++})`;
    return name;
  }
  acceptMessage(client, kind, rate, capacity, now = Date.now()) {
    const limits = client.classroomLimits ||= {};
    const bucket = limits[kind] ||= { at: now, tokens: capacity };
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.at) * rate / 1000);
    bucket.at = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens--;
    return true;
  }
  person(c) {
    return this.people.get(this.connections.get(c.sessionId));
  }
  error(c, message) {
    c.send("notice", message);
  }
  publicPeople() {
    return [...this.people.values()]
      .filter((p) => !p.banned && !p.expired)
      .map(({ 
      id, 
      name, 
      avatar, 
      x, 
      y, 
      score, 
      points = 0,
      firsts = 0,
      elapsed, 
      role, 
      muted, 
      connected, 
      direction = 'down' }) => ({ id, name, avatar, x, y, score, points, firsts, elapsed, role, muted, connected, direction }));
  }
  snapshot() {
    return {
      code: this.roomId, 
      avatarKind: this.avatarKind, 
      title: this.title, 
      people: this.publicPeople(), 
      quiz: this.quiz, 
      chat: this.chat, 
      locked: this.admissionLocked, 
      chatOpen: this.chatOpen, 
      announcement: this.announcement, 
      winner: this.winner, 
      coop: this.coopGame.publicState(),
      revision: this.revision,
      serverTime: Date.now() 
    };
  }
  sync() {
    const state = this.snapshot();
    const fields = {};
    for (const key of ['quiz', 'locked', 'chatOpen', 'announcement', 'winner', 'coop']) {
      const serialized = JSON.stringify(state[key]);
      if (this.publishedFields[key] !== serialized) fields[key] = state[key];
      this.publishedFields[key] = serialized;
    }
    const current = new Map();
    const people = [];
    for (const person of state.people) {
      const previous = this.publishedPeople.get(person.id);
      const patch = { id: person.id };
      for (const [key, value] of Object.entries(person)) {
        if (previous && ['x', 'y', 'direction'].includes(key)) continue;
        if (!previous || JSON.stringify(previous[key]) !== JSON.stringify(value)) patch[key] = value;
      }
      if (Object.keys(patch).length > 1) people.push(patch);
      current.set(person.id, person);
    }
    const removed = [...this.publishedPeople.keys()].filter(id => !current.has(id));
    this.publishedPeople = current;
    if (people.length || removed.length || Object.keys(fields).length)
      this.broadcast('delta', { fields, people, removed, revision: ++this.revision });
  }
  flushPositions(now = Date.now()) {
    if (!this.clients.length) return;
    const repair = now - this.lastPositionRepair >= NETWORK.positionRepairMs;
    if (!repair && !this.dirtyPositions.size) return;
    const positions = [...this.people.values()]
      .filter(p => p.connected && !p.banned && (repair || this.dirtyPositions.has(p.id)))
      .map(({ id, x, y, direction = 'down' }) => ({ id, x, y, direction }));
    if (positions.length) this.broadcast('positions', positions);
    this.dirtyPositions.clear();
    if (repair) this.lastPositionRepair = now;
  }
  publishChat(line) {
    this.chat.push(line);
    this.chat = this.chat.slice(-80);
    this.broadcast('chatLine', { line, revision: ++this.revision });
  }
  system(text) {
    this.publishChat({ id: randomBytes(6).toString("hex"), name: "교실 안내", text, system: true, time: Date.now() });
  }
  move(c, m) {
    const p = this.person(c);
    if (!p?.connected || p.banned || !this.acceptMessage(c, 'move', NETWORK.moveMessagesPerSecond,
      NETWORK.moveMessageBurst) || !m || !walkable(m.x, m.y)) return;
    const now = Date.now();
    if (!consumeMovementBudget(p, m, now)) {
      if (now - (p.lastCorrection || 0) >= 250) {
        c.send('moveRejected', { id: p.id, x: p.x, y: p.y, direction: p.direction || 'down' });
        p.lastCorrection = now;
      }
      return;
    }
    const direction = ['down', 'up', 'left', 'right'].includes(m.direction) ? m.direction : p.direction;
    if (p.x !== m.x || p.y !== m.y || p.direction !== direction) this.dirtyPositions.add(p.id);
    p.x = m.x;
    p.y = m.y;
    p.lastMove = now;
    p.direction = direction;
  }
  coopMove(c, m) {
    const p = this.person(c);
    if (!this.coopGame.state || !p?.connected || p.banned ||
        !this.acceptMessage(c, 'coopMove', 20, 30)) return;
    const correction = this.coopGame.move(p.id, m);
    if (correction) c.send('coopCorrect', correction);
  }
  coopCheer(c, m) {
    const p = this.person(c);
    if (!p?.connected || p.banned) return;
    this.coopGame.cheer(p.id, m);
  }
  tickCoop() {
    if (!this.coopGame.state) return;
    const result = this.coopGame.tick();
    if (result.positions.length) this.broadcast('coopPos', result.positions);
    for (const event of result.events) this.broadcast('coopEvent', event);
    if (result.cheers) this.broadcast('coopCheers', result.cheers);
    if (result.changed) this.sync();
  }
  say(c, m) {
    const p = this.person(c);
    const text = clean(m, 180);
    if (!p || !text) return;
    if (p.role !== "host" && (!this.chatOpen || p.muted)) return this.error(c, "관리자가 채팅을 잠시 쉬도록 설정했어요.");
    if (Date.now() - p.lastChat < 750) return this.error(c, "메시지는 잠시 간격을 두고 보내주세요.");
    p.lastChat = Date.now();
    this.publishChat({
      id: randomBytes(6).toString("hex"), 
      playerId: p.id, 
      name: p.name, 
      text, 
      host: p.role === "host", 
      time: Date.now() 
    });
    this.broadcast("bubble", { id: p.id, text });
  }
  connectedGuests() {
    return [...this.people.values()].filter(p => p.role === 'guest' && p.connected && !p.banned).map(p => p.id);
  }
  clearQuizTimers() {
    this.finaleTimer?.clear();
    this.finaleTimer = null;
    this.quizDeadline?.clear();
    this.quizAllDone?.clear();
    this.quizProgressTimer?.clear();
    this.quizDeadline = null;
    this.quizAllDone = null;
    this.quizProgressTimer = null;
  }
  queueQuizProgress() {
    if (this.quizProgressTimer) return;
    const delay = Math.max(0, this.lastQuizProgressAt + PROGRESS_INTERVAL_MS - Date.now());
    this.quizProgressTimer = this.clock.setTimeout(() => {
      this.quizProgressTimer = null;
      const progress = this.quizEngine.progress();
      if (!progress || this.quizEngine.phase === 'revealed') return;
      const key = JSON.stringify(progress);
      if (key === this.lastQuizProgress) return;
      this.lastQuizProgress = key;
      this.lastQuizProgressAt = Date.now();
      this.quiz.answered = progress.answered;
      // 옛 클라이언트의 진행 숫자도 유지하지만 전체 상태는 재전송하지 않는다.
      this.publishedFields.quiz = JSON.stringify(this.quiz);
      this.broadcast('quizProgress', { ...progress, id: progress.quizId, revision: ++this.revision });
    }, delay);
  }
  checkAllDone() {
    if (this.quizAllDone || !this.quizEngine.isAllDone(this.connectedGuests())) return;
    const id = this.quiz?.id;
    this.quizAllDone = this.clock.setTimeout(() => {
      this.quizAllDone = null;
      if (this.quiz?.id === id && this.quizEngine.isAllDone(this.connectedGuests())) {
        this.finishQuiz('allDone');
      }
    }, ALL_DONE_DELAY_MS);
  }
  answer(c, m, ctx) {
    const result = this.quizEngine.submit(this.person(c), { ...m, quizId: m?.quizId ?? m?.id });
    if (ctx?.id === undefined) c.send('answerResult', result);
    if (['received', 'correct', 'wrong'].includes(result.status)) {
      if (m?.choice !== undefined) c.send('answerAccepted', { id: this.quiz.id, choice: m.choice });
      this.queueQuizProgress();
      this.checkAllDone();
    }
    return result;
  }
  finishQuiz(reason = 'host') {
    const reveal = this.quizEngine.close(reason, this.people);
    if (!reveal) return;
    this.clearQuizTimers();
    Object.assign(this.quiz, {
      status: 'ended', correct: reveal.choiceIndex, explanation: reveal.explanation,
      counts: reveal.choiceCounts, answered: reveal.answeredCount,
    });
    this.broadcast('quizReveal', reveal);
    if (this.finalInSet) {
      // 마지막 정답 연출을 보여준 뒤 서버에서 누적 우승을 함께 발표한다.
      const quizId = this.quiz.id;
      this.finaleTimer = this.clock.setTimeout(() => {
        this.finaleTimer = null;
        if (this.quiz?.id !== quizId || this.quizEngine.phase !== 'revealed') return;
        this.announceWinner();
        this.sync();
      }, Math.max(0, reveal.revealAt + 10000 - Date.now()));
    }
    this.sync();
  }
  announceWinner() {
    this.clearQuizTimers();
    this.quizEngine.clear();
    this.quiz = null;
    this.broadcast('quizIdle', {});
    // 최종 순위는 문제마다 받은 점수(points)의 합계. 점수가 같으면 같은 등수(공동)로 본다.
    const ranked = rankStudents([...this.people.values()]).filter(p => p.points > 0);
    if (!ranked.length) {
      this.winner = null;
      this.broadcast('notice', '퀴즈를 모두 마쳤어요! 이번에는 정답자가 없어 1등 발표를 쉬어 갑니다.');
      return;
    }
    const best = ranked[0];
    const winners = ranked.filter(p => p.rank === 1);
    // 시상대: 1·2·3등(공동 포함, 최대 6명)
    const podium = ranked.filter(p => p.rank <= 3).slice(0, 6).map(p => ({
      rank: p.rank, id: p.id, name: p.name, points: p.points, score: p.score,
      avatar: p.avatar, avatarKind: this.avatarKind,
    }));
    this.winner = {
      id: best.id, name: best.name, score: best.score, points: best.points,
      ids: winners.map(p => p.id), names: winners.map(p => p.name),
      champions: winners.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, avatarKind: this.avatarKind })),
      podium,
      announcedAt: Date.now(),
    };
  }
  admin(c, m) {
    if (this.person(c)?.role !== "host") return this.error(c, "관리자만 사용할 수 있는 기능이에요.");
    if (!m || typeof m.action !== "string") return;
    switch (m.action) {
      case 'coopOpen': {
        if (this.quiz?.status === 'open') {
          const error = '퀴즈를 마감한 뒤 게임방을 열어 주세요.';
          this.error(c, error);
          return { ok: false, error };
        }
        const result = this.coopGame.open([...this.people.values()], this.avatarKind);
        if (!result.ok) {
          this.error(c, result.error);
          return result;
        }
        break;
      }
      case 'coopRestart': {
        const result = this.coopGame.restart();
        if (!result.ok) return result;
        break;
      }
      case 'coopClose':
        this.coopGame.close();
        break;
      case 'closeRoom':
        this.closing = true;
        this.broadcast('notice', '교실이 닫혔어요. 선생님 화면의 새 QR을 찍어 주세요.');
        // 프록시가 닫힘 코드를 바꿔도 화면이 재연결하지 않게 먼저 알린다.
        this.broadcast('roomClosed');
        // 종료된 교실은 자동 복귀 대상이 아니므로 서버 종료 코드를 보낸다.
        void this.disconnect(4001);
        return { ok: true };
      case "lock":
        this.admissionLocked = !!m.value;
        break;
      case "chat":
        this.chatOpen = !!m.value;
        break;
      case "announcement":
        this.announcement = clean(m.text, 140);
        break;
      case "mute": {
        const p = this.people.get(m.id);
        if (p?.role === "guest") p.muted = !!m.value;
        break;
      }
      case "kick": {
        const p = this.people.get(m.id);
        if (p?.role !== "guest") return;
        p.banned = true;
        p.connected = false;
        this.coopGame.remove(p.id);
        p.reconnection?.reject();
        p.reconnection = null;
        for (const client of this.clients) if (this.connections.get(client.sessionId) === p.id) {
          client.send("kicked", "관리자가 퇴장 처리했습니다.");
          client.leave(4e3);
        }
        this.dropFromWinner(p.id);
        break;
      }
      case 'quiz': {
        const result = this.quizEngine.start(m.quiz, { eligibleIds: this.connectedGuests() });
        if (!result.ok) {
          this.error(c, result.error);
          return result;
        }
        this.coopGame.close();
        this.clearQuizTimers();
        this.finalInSet = m.finalInSet === true;
        const q = result.quiz;
        this.quiz = { ...q, id: q.quizId, startedAt: q.startAt, status: 'open', answered: 0 };
        this.winner = null;
        this.lastQuizProgress = '';
        this.broadcast('quiz', q);
        this.quizDeadline = this.clock.setTimeout(() => {
          if (this.quiz?.id === q.quizId) this.finishQuiz('time');
        }, Math.max(0, q.endsAt + GRACE_MS - Date.now()));
        this.sync();
        return result;
      }
      case 'finish':
        this.finishQuiz();
        return { ok: true };
      case 'abort': {
        const quizId = this.quizEngine.abort();
        if (!quizId) return { ok: false };
        this.clearQuizTimers();
        this.quiz = null;
        this.broadcast('quizAborted', { quizId });
        break;
      }
      case 'closeQuiz': {
        const quizId = this.quizEngine.clear();
        if (!quizId) return { ok: false };
        this.clearQuizTimers();
        this.quiz = null;
        this.broadcast('quizIdle', { quizId });
        break;
      }
      case 'rename': {
        const p = this.people.get(m.id);
        if (!p || p.role !== 'guest' || p.banned) return { ok: false };
        const names = new Set([...this.people.values()].filter(other => other.id !== p.id).map(other => other.name));
        let number = p.seat + 1;
        while (names.has('학생 ' + number)) number += 1;
        p.name = '학생 ' + number;
        this.coopGame.rename(p.id, p.name);
        this.quizEngine.rename(p.id, p.name);
        if (this.winner?.ids.includes(p.id)) {
          this.winner.names = this.winner.ids.map(id => this.people.get(id).name);
          this.winner.name = this.people.get(this.winner.id).name;
          for (const champion of this.winner.champions || []) {
            champion.name = this.people.get(champion.id).name;
          }
        }
        // 시상대(1·2·3등)에 선 학생도 새 별명으로 바꾼다.
        for (const entry of this.winner?.podium || []) if (entry.id === p.id) entry.name = p.name;
        // 공개된 카드도 새 별명으로 바꾸고 연출은 다시 재생하지 않는다.
        if (this.quizEngine.phase === 'revealed') {
          for (const client of this.clients) {
            client.send('quizState', this.quizEngine.stateFor(this.person(client)?.id));
          }
        }
        break;
      }
      case "award": {
        if (this.quiz?.status === "open") return this.error(c, "퀴즈를 마감한 뒤 순위를 발표해주세요.");
        this.announceWinner();
        break;
      }
      case "reset":
        if (this.quiz?.status === "open") return this.error(c, "퀴즈를 마감한 뒤 점수를 초기화해주세요.");
        this.coopGame.close();
        for (const p of this.people.values()) {
          p.score = 0;
          p.points = 0;
          p.elapsed = 0;
          p.firsts = 0;
        }
        this.winner = null;
        this.quiz = null;
        this.quizEngine.clear();
        this.clearQuizTimers();
        this.broadcast('quizIdle', {});
        break;
      default:
        return;
    }
    this.sync();
    this.checkAllDone();
    return { ok: true };
  }
  releaseRoom() {
    if (!this.countedRoom) return;
    this.countedRoom = false;
    activeRooms -= 1;
  }
  onDispose() {
    this.clearQuizTimers();
    this.releaseRoom();
  }
  onBeforeShutdown() {
    this.closing = true;
    this.broadcast('notice', '교실 서버가 다시 시작돼요. 선생님 화면의 새 QR을 찍어 주세요.');
    this.broadcast('roomClosed');
    return super.onBeforeShutdown();
  }
}
