import { AUDIO_CUES, DEFAULT_VOLUME, createAudioOutput, scheduleCue } from './audio-score.js';

// v2: 기본 음량을 0.35 → 0.8로 올리면서 예전에 저장된 작은 음량은 한 번 새로 시작한다.
const PREFIX = 'classroom-audio-v2-';
export const MAX_AUDIO_VOICES = 96;
const clamp = value => Math.max(0, Math.min(1, value));

// AudioContext는 켜기 버튼이나 실제 터치/키 입력 때만 준비한다. 늦게 준비돼도 지난 소리를 재생하지 않는다.
export function createClassroomAudio(options = {}) {
  const doc = options.document ?? globalThis.document;
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  const factory = options.contextFactory || (Context ? () => new Context({ latencyHint: 'interactive' }) : null);
  let storage = options.storage;
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  let context, output, unlocking, destroyed = false, role = 'guest';
  let available = Boolean(factory), enabled = false, volume = DEFAULT_VOLUME;
  const voices = new Map();
  const subscribers = new Set();
  const snapshot = () => ({ enabled, ready: context?.state === 'running', available: available && !destroyed, volume });
  function notify() { for (const fn of subscribers) { try { fn(snapshot()); } catch { /* UI errors cannot interrupt play */ } } }
  function readPreference() {
    let saved;
    try { saved = JSON.parse(storage?.getItem(PREFIX + role) || 'null'); } catch { /* optional private-mode storage */ }
    enabled = typeof saved?.enabled === 'boolean' ? saved.enabled : role === 'teacher';
    volume = Number.isFinite(saved?.volume) ? clamp(saved.volume) : DEFAULT_VOLUME;
  }
  function persist() { try { storage?.setItem(PREFIX + role, JSON.stringify({ enabled, volume })); } catch { /* optional storage */ } }
  function stop(channel) {
    for (const [voice, group] of voices) { if (group === channel) { voices.delete(voice); voice.stop(); } }
  }
  function stopAll() { for (const voice of [...voices.keys()]) voice.stop(); voices.clear(); }
  function applyVolume() {
    if (!output) return;
    try {
      output.gain.gain.cancelScheduledValues(context.currentTime);
      output.gain.gain.setTargetAtTime(volume, context.currentTime, .02);
    } catch { /* closing context */ }
  }
  function contextChanged() {
    if (context?.state !== 'running') stopAll();
    if (context?.state === 'closed') available = false;
    notify();
  }
  async function unlock() {
    if (destroyed || !enabled || !available || doc?.hidden) return false;
    if (context?.state === 'running') return true;
    if (unlocking) return unlocking;
    try {
      if (!context) {
        context = factory();
        output = createAudioOutput(context, volume);
        context.addEventListener?.('statechange', contextChanged);
      }
      // resume() must be invoked in this gesture stack, before the first await.
      const resumed = context.state === 'running' ? Promise.resolve() : context.resume();
      unlocking = Promise.resolve(resumed).then(() => {
        if (destroyed || !enabled || doc?.hidden) { stopAll(); return false; }
        return context.state === 'running';
      }).catch(() => false).finally(() => { unlocking = null; notify(); });
      return unlocking;
    } catch {
      // Unsupported/broken contexts leave the classroom usable and the controls informative.
      available = false;
      stopAll();
      output?.destroy(); output = null;
      try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* unavailable */ }
      notify();
      return false;
    }
  }
  async function setEnabled(value) {
    if (destroyed) return false;
    enabled = Boolean(value); persist();
    if (!enabled) stopAll();
    notify();
    return enabled ? unlock() : false;
  }
  function setRole(value) {
    if (destroyed) return;
    const next = value === 'teacher' || value === 'host' ? 'teacher' : 'guest';
    if (next === role) return;
    stopAll(); role = next; readPreference(); applyVolume(); notify();
  }
  function setVolume(value) {
    if (destroyed || !Number.isFinite(value)) return;
    volume = clamp(value); persist(); applyVolume();
    if (!volume) stopAll();
    notify();
  }
  function play(cue, { channel = 'quiz', delay = 0 } = {}) {
    if (destroyed || !enabled || !volume || !available || !output || context?.state !== 'running' || doc?.hidden || !AUDIO_CUES.includes(cue)) return false;
    try {
      scheduleCue(context, output.input, cue, {
        when: context.currentTime + Math.max(0, Math.min(10, Number.isFinite(delay) ? delay : 0)),
        track(voice) {
          while (voices.size >= MAX_AUDIO_VOICES) {
            const oldest = voices.keys().next().value;
            voices.delete(oldest); oldest.stop();
          }
          voices.set(voice, channel);
          voice.onended = () => voices.delete(voice);
        },
      });
      return true;
    } catch { return false; }
  }
  function gesture(event) {
    if (event.isTrusted && enabled && !destroyed) void unlock();
  }
  function visibility() { if (doc?.hidden) stopAll(); }
  doc?.addEventListener('pointerdown', gesture, { capture: true, passive: true });
  doc?.addEventListener('keydown', gesture, { capture: true, passive: true });
  doc?.addEventListener('visibilitychange', visibility);
  readPreference();
  return {
    get state() { return snapshot(); },
    setRole, setEnabled, setVolume, unlock, play, stop, stopAll,
    subscribe(fn) {
      subscribers.add(fn);
      try { fn(snapshot()); } catch { /* isolated UI observer */ }
      return () => subscribers.delete(fn);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; stopAll();
      doc?.removeEventListener('pointerdown', gesture, true);
      doc?.removeEventListener('keydown', gesture, true);
      doc?.removeEventListener('visibilitychange', visibility);
      context?.removeEventListener?.('statechange', contextChanged);
      output?.destroy(); output = null;
      try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* optional browser audio */ }
      notify(); subscribers.clear();
    },
  };
}
