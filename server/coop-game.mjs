import { randomBytes } from 'node:crypto';
import { COOP, LEVEL_1, spawnPoint } from '../shared/coop-level.js';
import { emptyObjects, evaluateObjects, plausibleMove } from '../shared/coop-physics.js';
import { withinMessageLimit } from './guard.mjs';

// 시상과 게임방은 같은 정렬과 공동 등수를 쓴다. 입력 배열은 바꾸지 않는다.
export function rankStudents(people) {
  const sorted = people.filter(p => p.role === 'guest' && p.connected && !p.banned && !p.expired)
    .slice().sort((a, b) => (b.points || 0) - (a.points || 0) ||
      (b.score || 0) - (a.score || 0) || (a.elapsed || 0) - (b.elapsed || 0) || a.seat - b.seat);
  let rank = 0;
  return sorted.map((p, index) => {
    if (index === 0 || (p.points || 0) !== (sorted[index - 1].points || 0)) rank = index + 1;
    return { ...p, rank };
  });
}

const round = value => Math.round(value * 10) / 10;
const moveKeys = new Set(['id', 'x', 'y', 'vx', 'vy', 'f', 'on']);

// Colyseus와 무관한 한 교실의 게임 진행. now를 주입해 모든 시간을 검사할 수 있다.
export class CoopGame {
  constructor({ now = Date.now, level = LEVEL_1 } = {}) {
    this.now = now;
    this.level = level;
    this.bestMs = null;
    this.state = null;
    this.bodies = new Map();
    this.dirty = new Set();
    this.cheerTimes = new Map();
    this.cheers = { heart: 0, clap: 0, fire: 0 };
  }

  open(candidates, avatarKind = 'v02') {
    const players = rankStudents(candidates).slice(0, COOP.maxPlayers);
    if (players.length < COOP.minPlayers)
      return { ok: false, error: '게임방은 학생 2명 이상 있어야 열 수 있어요.' };
    this.begin(players.map((p, slot) => ({
      id: p.id, name: p.name, avatar: p.avatar, avatarKind,
      rank: p.rank, points: p.points || 0, slot, connected: true,
    })));
    return { ok: true };
  }

  begin(players) {
    const now = this.now();
    this.state = {
      id: 'c' + randomBytes(8).toString('hex'), level: this.level.id, phase: 'intro',
      startAt: now + COOP.introMs, endsAt: now + COOP.introMs + this.level.seconds * 1000,
      finishedAt: null, clearMs: null, bestMs: this.bestMs, newRecord: false,
      players: players.map(p => ({ ...p })), objects: emptyObjects(),
    };
    this.bodies.clear();
    this.dirty.clear();
    for (const p of players) {
      this.bodies.set(p.id, { ...spawnPoint(this.level, p.slot), vx: 0, vy: 0, f: 1, on: null,
        at: this.state.startAt, correctedAt: -Infinity });
      this.dirty.add(p.id);
    }
    this.lastRepair = this.state.startAt;
    this.lastCheers = now;
    this.cheers = { heart: 0, clap: 0, fire: 0 };
    this.cheerTimes.clear();
  }

  restart() {
    if (!this.state) return { ok: false };
    this.begin(this.state.players);
    return { ok: true };
  }

  close() {
    this.state = null;
    this.bodies.clear();
    this.dirty.clear();
    this.cheerTimes.clear();
    this.cheers = { heart: 0, clap: 0, fire: 0 };
  }

  publicState() {
    if (!this.state) return null;
    return { ...this.state, players: this.state.players.map(p => ({ ...p })),
      objects: { ...this.state.objects, atGoal: [...this.state.objects.atGoal] } };
  }

  move(playerId, message) {
    const state = this.state, now = this.now();
    const player = state?.players.find(p => p.id === playerId);
    if (!player?.connected || state.phase !== 'playing' || now >= state.endsAt ||
        state.objects.atGoal.includes(playerId) || !message || message.id !== state.id ||
        !withinMessageLimit(message, 512) || Object.keys(message).some(key => !moveKeys.has(key))) return null;
    if (!['x', 'y', 'vx', 'vy'].every(key => Number.isFinite(message[key])) ||
        ![-1, 1].includes(message.f) || !(message.on === null ||
          (typeof message.on === 'string' && message.on !== playerId &&
            state.players.some(p => p.id === message.on && p.connected && !state.objects.atGoal.includes(p.id))))) return null;
    const prev = this.bodies.get(playerId);
    if (!plausibleMove(this.level, state.objects, prev, message, now - prev.at)) {
      if (now - prev.correctedAt < 250) return null;
      prev.correctedAt = now;
      return { x: prev.x, y: prev.y };
    }
    if (['x', 'y', 'f', 'on'].some(key => prev[key] !== message[key])) this.dirty.add(playerId);
    Object.assign(prev, { x: message.x, y: message.y, vx: message.vx, vy: message.vy,
      f: message.f, on: message.on, at: now });
    return null;
  }

  cheer(personId, kind) {
    if (!this.state || !['heart', 'clap', 'fire'].includes(kind)) return false;
    const now = this.now();
    const times = (this.cheerTimes.get(personId) || []).filter(at => now - at < 1000);
    if (times.length >= 4) return false;
    times.push(now);
    this.cheerTimes.set(personId, times);
    this.cheers[kind]++;
    return true;
  }

  setConnected(id, connected) {
    const player = this.state?.players.find(p => p.id === id);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    if (connected) this.dirty.add(id);
  }

  rename(id, name) {
    const player = this.state?.players.find(p => p.id === id);
    if (player) player.name = name;
  }

  remove(id) {
    if (!this.state) return;
    this.state.players = this.state.players.filter(p => p.id !== id);
    this.state.objects.atGoal = this.state.objects.atGoal.filter(goalId => goalId !== id);
    this.bodies.delete(id);
    this.dirty.delete(id);
    this.cheerTimes.delete(id);
    for (const [otherId, body] of this.bodies) {
      if (body.on !== id) continue;
      body.on = null;
      this.dirty.add(otherId);
    }
    // 열쇠 반환은 다음 tick의 evaluateObjects가 판정하고 이벤트를 보낸다.
  }

  tick() {
    if (!this.state) return null;
    const state = this.state, now = this.now();
    const result = { changed: false, events: [], positions: [], cheers: null };
    const event = (type, by = null) => {
      result.events.push({ id: state.id, type, by });
      result.changed = true;
    };
    if (state.phase === 'intro' && now >= state.startAt) {
      state.phase = 'playing';
      event('start');
    }
    if (state.phase === 'playing') {
      if (now >= state.endsAt) {
        state.phase = 'failed';
        state.finishedAt = now;
        event('failed');
      } else {
        const evaluated = evaluateObjects(this.level, state.objects,
          state.players.map(p => ({ ...this.bodies.get(p.id), id: p.id, connected: p.connected })));
        state.objects = evaluated.objects;
        for (const entry of evaluated.events) {
          if (entry.startsWith('goal:')) event('goal', entry.slice(5));
          else event(entry);
        }
        // 마지막 골인 위치도 성공 상태와 같은 tick에서 전송한다.
        const repair = now - this.lastRepair >= 2000;
        result.positions = state.players.filter(p => repair || this.dirty.has(p.id)).map(p => {
          const b = this.bodies.get(p.id);
          return [p.id, round(b.x), round(b.y), b.f, b.on];
        });
        this.dirty.clear();
        if (repair) this.lastRepair = now;
        if (evaluated.cleared) {
          state.phase = 'cleared';
          state.finishedAt = now;
          state.clearMs = now - state.startAt;
          state.newRecord = this.bestMs === null || state.clearMs < this.bestMs;
          if (state.newRecord) this.bestMs = state.clearMs;
          state.bestMs = this.bestMs;
          event('cleared');
        }
      }
    }
    if (now - this.lastCheers >= 300) {
      if (Object.values(this.cheers).some(count => count > 0)) result.cheers = this.cheers;
      this.cheers = { heart: 0, clap: 0, fire: 0 };
      this.lastCheers = now;
      for (const [id, times] of this.cheerTimes) {
        if (now - times[times.length - 1] >= 1000) this.cheerTimes.delete(id);
      }
    }
    return result;
  }
}
