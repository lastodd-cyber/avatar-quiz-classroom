// 직접 합성하는 교실 효과음 악보. 외부 음원·네트워크 요청 없이 같은 소리를 재생한다.
const NOTE = { C3: 130.81, D3: 146.83, E3: 164.81, G3: 196, A3: 220, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, C6: 1046.5 };
// 2026-10-20 다시 다듬음: 휴대폰 스피커는 낮은 소리(200Hz 아래)와 배음 없는 사인파를 잘 못 낸다.
// 기본 파형을 삼각파로 바꾸고, 북에는 휴대폰에서 들리는 '톡' 소리, 종에는 높은 배음을 더했다.
const tone = (at, note, duration = .2, gain = .15, extra = {}) =>
  ({ kind: 'tone', at, frequency: NOTE[note] || note, duration, gain, wave: 'triangle', attack: .008, ...extra });
const noise = (at, duration, gain, extra = {}) =>
  ({ kind: 'noise', at, duration, gain, frequency: 1500, filter: 'bandpass', attack: .006, ...extra });
const chord = (at, notes, duration, gain = .075, extra = {}) => notes.map(note => tone(at, note, duration, gain, { wave: 'triangle', ...extra }));
const bell = (at, note, gain = .14, pan = 0) => [tone(at, note, .55, gain, { pan, wave: 'sine' }),
  tone(at, (NOTE[note] || note) * 2, .22, gain * .3, { pan, wave: 'sine' }),
  tone(at, (NOTE[note] || note) * 3, .12, gain * .12, { pan, wave: 'sine' })];
const drum = (at, gain = .2, duration = .22) => [tone(at, 135, duration, gain, { to: 53, attack: .003, wave: 'sine' }),
  tone(at, 330, duration * .7, gain * .55, { to: 160, attack: .002 }),
  noise(at, .03, gain * .5, { frequency: 2400, filter: 'bandpass' }),
  noise(at, .07, gain * .25, { frequency: 700, filter: 'lowpass' })];
const burst = (at, pan = 0) => [
  ...drum(at, .21, .32),
  noise(at + .012, .45, .17, { filter: 'lowpass', frequency: 3600, to: 850, pan }),
  ...bell(at + .06, 'G5', .07, pan), ...bell(at + .15, 'C6', .045, -pan),
];

const scores = {
  countdown: [tone(0, 'G4', .12, .14), tone(.005, 'G3', .08, .06)],
  go: [...bell(0, 'C5', .16), ...bell(.09, 'E5', .14), ...bell(.18, 'G5', .12), ...chord(0, ['C4', 'E4', 'G4'], .45, .045)],
  correct: [...bell(0, 'E5', .12, -.2), ...bell(.085, 'G5', .12, .2), ...bell(.17, 'C6', .10)],
  closed: [noise(0, .22, .045, { frequency: 1900, to: 450, attack: .1 }),
    ...drum(.22, .15, .26), tone(.24, 'G3', .24, .055)],
  // quiz-fx.js의 실제 착지·도장·등장 시각에 충격음을 맞춘다.
  'reveal-roll': [0, .25, .5, .75, 1, 1.25].flatMap((at, i) => [
    tone(at, [196, 220, 261.63, 293.66, 329.63, 392][i], .25, .085, { to: [220, 261.63, 293.66, 329.63, 392, 523.25][i], pan: -.5 + i * .1 }),
    noise(at, .065, .025, { frequency: 600, filter: 'lowpass' }),
  ]).concat(drum(.675, .10, .15), drum(1.2, .08, .14), drum(1.5, .17), bell(1.56, 'C5', .13), bell(2.03, 'E5', .065)),
  'reveal-bigface': [tone(0, 'G3', .87, .11, { to: NOTE.C5, wave: 'triangle', attack: .16 }),
    tone(.9, 'C5', .5, .13, { to: NOTE.G4 }), ...drum(.9, .13),
    ...drum(1.8, .16, .18), ...bell(1.8, 'E5', .10), ...bell(1.91, 'G5', .075)],
  'reveal-cutin': [noise(0, .26, .085, { frequency: 700, to: 2600, pan: -.5 }),
    noise(.06, .3, .075, { frequency: 900, to: 3200, pan: .5 }),
    ...chord(.36, ['C4', 'E4', 'G4'], .35, .065, { attack: .004 }),
    noise(.42, .42, .05, { frequency: 1800, to: 700, pan: -.3 }),
    ...drum(.9, .16, .17), ...bell(.9, 'C5', .12, .35), ...bell(1.02, 'G5', .07)],
  'reveal-drop': [tone(0, 'G5', .61, .075, { to: 100, wave: 'triangle' }),
    noise(.12, .49, .055, { frequency: 2800, to: 650, attack: .2 }),
    ...drum(.62, .27, .4), noise(.62, .18, .075, { filter: 'lowpass', frequency: 1700 }),
    ...bell(.71, 'C5', .10), tone(1.16, 'C4', .17, .07, { to: NOTE.G3 })],
  'reveal-clones': [
    ...[0, .15, .3, .45, .6, .76].flatMap((at, i) => bell(at,
      ['C5', 'E5', 'G5', 'E5', 'G5', 'C6'][i], .08, i % 2 ? .65 : -.65)),
    ...[1.2, 1.45, 1.7, 1.95].flatMap((at, i) => bell(at,
      ['C5', 'E5', 'G5', 'E5'][i], .045, i % 2 ? -.55 : .55)),
    ...[noise(2.80, .31, .07, { frequency: 600, to: 2600, attack: .24 }),
      ...drum(3.11, .17, .22), ...chord(3.11, ['C4', 'E4', 'G4'], .5, .065),
      ...bell(3.16, 'C5', .1)].map(event => ({ ...event, phase: 'merge' })),
  ],
  'reveal-spotlight': [
    ...[0, .21, .42, .63, .84, 1.05, 1.26, 1.45, 1.6, 1.72].flatMap((at, i) => drum(at, .055 + i * .007, .12)),
    noise(1.4, .38, .06, { frequency: 800, to: 2800, attack: .28 }),
    ...chord(1.78, ['C4', 'E4', 'G4'], .65, .075, { attack: .03 }),
    ...bell(1.8, 'C5', .1), ...bell(2.2, 'E5', .09), ...bell(2.29, 'G5', .07),
  ],
  // 2026-10-20 추가 연출 6종(quiz-fx.js 시간표: 빼꼼 0.22·0.78·1.34초 + 1.68초 짠, 캡슐 0.48초 쿵·덜컹 3번·1.95초 열림,
  // 불꽃 0.55·0.85·1.15·1.85초, 풍선 1.55·1.75·1.95초 펑·2.25초 착지, 속보 띠, 로켓 0~0.7초 발사·2.35초 착지)
  'reveal-peek': [
    ...[.22, .78, 1.34].flatMap((at, i) => [
      tone(at, ['E4', 'G4', 'B4'][i], .16, .09, { to: NOTE[['A4', 'C5', 'E5'][i]], wave: 'triangle' }),
      tone(at + .3, ['A4', 'C5', 'E5'][i], .12, .05, { to: NOTE[['E4', 'G4', 'B4'][i]], wave: 'triangle' })]),
    ...drum(1.7, .16, .2), ...bell(1.72, 'C5', .12), ...bell(1.84, 'E5', .1), ...bell(1.96, 'G5', .08),
  ],
  'reveal-gacha': [tone(0, 'G5', .46, .06, { to: 300, wave: 'triangle' }), ...drum(.48, .2, .3),
    ...[.87, 1.22, 1.57].flatMap(at => [noise(at, .2, .07, { frequency: 2400, to: 1200 }), tone(at, 'C5', .07, .035, { wave: 'square' })]),
    noise(1.92, .3, .1, { frequency: 3000, to: 600 }), ...drum(1.93, .18),
    ...bell(1.96, 'C5', .12), ...bell(2.06, 'E5', .1), ...bell(2.16, 'G5', .09), ...bell(2.28, 'C6', .07)],
  'reveal-fireworks': [
    ...[0, .3, .6].flatMap((at, i) => [tone(at, 300, .55, .045, { to: 1400, pan: [-.6, .6, 0][i] }),
      ...burst(at + .55, [-.6, .6, 0][i])]),
    tone(1.3, 260, .55, .06, { to: 1600 }), ...burst(1.85, 0),
    ...chord(1.88, ['C4', 'E4', 'G4'], .6, .07), ...bell(1.95, 'C6', .07)],
  'reveal-balloon': [tone(0, 'C4', 1.4, .05, { to: NOTE.C5, wave: 'triangle', attack: .3 }),
    ...[1.55, 1.75, 1.95].flatMap((at, i) => [noise(at, .08, .14, { frequency: 2600, filter: 'highpass' }),
      tone(at, ['G5', 'E5', 'C6'][i], .1, .05)]),
    ...drum(2.25, .2, .3), ...bell(2.3, 'C5', .1)],
  'reveal-news': [...chord(0, ['C4', 'E4', 'G4'], .14, .07, { attack: .004 }),
    ...chord(.16, ['C4', 'E4', 'G4'], .14, .07, { attack: .004 }), ...chord(.32, ['D4', 'G4', 'B4'], .5, .08, { attack: .004 }),
    ...bell(.7, 'G5', .08), ...bell(.82, 'E5', .07), ...bell(.94, 'C5', .07),
    ...[1.2, 1.5, 1.8, 2.1].map(at => tone(at, 'C6', .05, .03, { wave: 'square' }))],
  'reveal-rocket': [noise(0, .7, .12, { frequency: 200, to: 2600, filter: 'lowpass', attack: .2 }),
    tone(0, 80, .7, .08, { to: 300, wave: 'sawtooth' }),
    ...[1.0, 1.3, 1.6, 1.9].flatMap((at, i) => bell(at, ['G5', 'E5', 'C5', 'G4'][i], .06)),
    ...drum(2.35, .2, .3), ...bell(2.4, 'C5', .1), ...bell(2.52, 'E5', .08)],
  result: [...chord(0, ['C4', 'E4', 'G4'], .55, .085), ...bell(.06, 'E5', .10),
    ...bell(.2, 'G5', .08), ...bell(.34, 'C6', .06)],
  noWinner: [tone(0, 'G3', .35, .11), tone(.16, 'C4', .42, .09)],
  'champion-intro': [
    ...[0, .5, 1, 1.38, 1.75, 2, 2.2, 2.4, 2.58, 2.74].flatMap((at, i) => drum(at, .10 + i * .009, .17)),
    ...chord(0, ['G3', 'D4'], .8, .045, { attack: .1 }),
    ...chord(1, ['G3', 'B3', 'D4'], .8, .055, { attack: .1 }),
    ...chord(2, ['G3', 'B3', 'D5'], .84, .07, { attack: .08 }),
    noise(1.6, 1.25, .085, { frequency: 500, to: 2800, attack: 1.05 }),
    tone(2.35, 'G4', .49, .07, { to: NOTE.C5, attack: .18 }),
  ],
  'champion-reveal': [
    // 2026-10-20 시상대에 맞춤(발표 순간부터): 제목 0초, 3·2·1등 받침 착지 .935·1.385·1.835초(지연 + .9초의 65%),
    // 왕관 1.95초 등장 → 2.44초 착지(+.7초의 70%). 착지마다 작은 쿵, 왕관 착지에 축포·종·마지막 화음.
    ...burst(0, -.5), ...burst(2.44, 0),
    ...[.935, 1.385, 1.835].flatMap((at, i) => drum(at, .11 + i * .02, .17 + i * .02)),
    noise(1.95, .49, .05, { frequency: 900, to: 3200, attack: .35 }),
    ...chord(0, ['C3', 'C4', 'E4', 'G4'], .32, .09),
    ...chord(.36, ['C3', 'C4', 'E4', 'G4'], .5, .095),
    ...chord(1.835, ['G3', 'B3', 'D4'], .55, .06),
    ...chord(2.44, ['C3', 'G3', 'C4', 'E4', 'G4'], 1.6, .075, { attack: .02 }),
    ...[0, .18, .36, .935, 1.385, 1.835, 2.44].flatMap((at, i) => [
      tone(at, ['G4', 'G4', 'C5', 'E5', 'D5', 'B4', 'C5'][i], i === 6 ? 1.3 : .23, .105, { wave: 'triangle' }),
      tone(at, ['G3', 'G3', 'C4', 'E4', 'D4', 'B3', 'C4'][i], i === 6 ? 1.3 : .23, .05),
    ]),
    ...[2.75, 2.92, 3.09, 3.26, 3.43, 3.6].flatMap((at, i) => bell(at,
      ['C5', 'E5', 'G5', 'C6', 'G5', 'C6'][i], .055, i % 2 ? .45 : -.45)),
  ],
  // 협동 게임방(2026-10-22): 짧고 귀엽게. 점프는 내 화면에서만 아주 작게.
  'coop-start': [...bell(0, 'C5', .12), ...bell(.12, 'E5', .12), ...bell(.24, 'G5', .13),
    ...chord(.24, ['C4', 'E4', 'G4'], .4, .05)],
  'coop-jump': [tone(0, 'C5', .09, .05, { to: NOTE.G5, attack: .004 })],
  'coop-plate': [tone(0, 'G4', .08, .09, { attack: .003 }), tone(.07, 'C5', .12, .09, { attack: .003 })],
  'coop-open': [noise(0, .35, .06, { frequency: 600, to: 2400, attack: .05 }),
    ...bell(.1, 'E5', .1), ...bell(.22, 'A4', .08), ...bell(.34, 'C6', .07)],
  'coop-key': [...bell(0, 'G5', .1), ...bell(.08, 'C6', .09), tone(.16, 'E5', .2, .05, { wave: 'sine' })],
  'coop-key-return': [tone(0, 'E5', .16, .06, { to: NOTE.G4 }), tone(.14, 'C4', .2, .05)],
  'coop-door': [...drum(0, .16, .24), noise(.05, .3, .05, { frequency: 900, to: 300, filter: 'lowpass' }),
    ...bell(.2, 'C5', .1), ...bell(.32, 'G5', .1)],
  'coop-goal': [tone(0, 'E5', .1, .08, { attack: .003 }), tone(.08, 880, .14, .07)],
  'coop-clear': [...burst(0, -.4), ...burst(.35, .4),
    ...[0, .16, .32, .5].flatMap((at, i) => [tone(at, ['C5', 'E5', 'G5', 'C6'][i], i === 3 ? .9 : .2, .1)]),
    ...chord(.5, ['C3', 'G3', 'C4', 'E4', 'G4'], 1.2, .07, { attack: .02 }),
    ...[.9, 1.06, 1.22].flatMap((at, i) => bell(at, ['E5', 'G5', 'C6'][i], .06, i % 2 ? .4 : -.4))],
  'coop-fail': [tone(0, 'G4', .28, .08), tone(.26, 'E4', .28, .08), tone(.52, 'C4', .6, .08, { to: 196 }),
    noise(.52, .3, .04, { frequency: 700, to: 300, filter: 'lowpass' })],
  'coop-cheer': [tone(0, 'C6', .06, .03, { wave: 'sine' })],
};

export const AUDIO_CUES = Object.freeze(Object.keys(scores));
export function getCueScore(cue, { compact = false } = {}) {
  // 분신술은 휴대폰에서 14개, 큰 화면에서 22개: 펼치기·모으기의 시차까지 반영한다.
  const mergeOffset = compact ? -(22 - 14) * (.038 + .014) : 0;
  return (scores[cue] || []).map(event => ({ ...event, at: event.at + (event.phase === 'merge' ? mergeOffset : 0) }));
}

const noiseBuffers = new WeakMap();
function getNoiseBuffer(context) {
  let buffer = noiseBuffers.get(context);
  if (buffer) return buffer;
  buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 2), context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 0x71ab4d2f;
  for (let i = 0; i < samples.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    samples[i] = (seed >>> 0) / 2147483648 - 1;
  }
  noiseBuffers.set(context, buffer);
  return buffer;
}

export const DEFAULT_VOLUME = .8;
// 음량 → 키우기(약 3.2배) → 아주 낮은 소리 덜기 → 너무 높은 소리 덜기 → 압축 → 제한 → 스피커.
// 예전에는 효과음 세기(0.05~0.15) × 음량 0.35라 교실에서 거의 안 들렸다.
export function createAudioOutput(context, volume = DEFAULT_VOLUME) {
  const gain = context.createGain();
  const boost = context.createGain();
  const lowCut = context.createBiquadFilter();
  const filter = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const limiter = context.createDynamicsCompressor();
  gain.gain.value = Math.max(0, Math.min(1, volume));
  boost.gain.value = 3.2;
  lowCut.type = 'highpass'; lowCut.frequency.value = 110; lowCut.Q.value = .5;
  filter.type = 'lowpass'; filter.frequency.value = 8000; filter.Q.value = .5;
  compressor.threshold.value = -16; compressor.knee.value = 8; compressor.ratio.value = 6;
  compressor.attack.value = .002; compressor.release.value = .16;
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = .001; limiter.release.value = .08;
  gain.connect(boost); boost.connect(lowCut); lowCut.connect(filter); filter.connect(compressor);
  compressor.connect(limiter); limiter.connect(context.destination);
  return { input: gain, gain, compressor, destroy() {
    for (const node of [gain, boost, lowCut, filter, compressor, limiter]) { try { node.disconnect(); } catch { /* already closed */ } }
  } };
}

// OfflineAudioContext에도 같은 악보·엔벌로프·노이즈를 사용해 실제 출력 샘플을 검증할 수 있다.
export function scheduleCue(context, destination, cue, { when = context.currentTime, track = () => {}, compact = globalThis.innerWidth < 640 } = {}) {
  const score = getCueScore(cue, { compact });
  const voices = [];
  try {
    for (const event of score) {
      const at = Math.max(context.currentTime, when) + event.at;
      const end = at + event.duration;
      const source = event.kind === 'noise' ? context.createBufferSource() : context.createOscillator();
      const gain = context.createGain();
      const nodes = [source, gain];
      let tail = source;
      let disposed = false;
      const voice = { source, onended: null, stop() {
        if (disposed) return;
        try { source.stop(context.currentTime); } catch { /* source ended or did not start */ }
        dispose();
      } };
      function dispose() {
        if (disposed) return;
        disposed = true;
        source.onended = null;
        for (const node of nodes) { try { node.disconnect(); } catch { /* already closed */ } }
        voice.onended?.();
      }
      source.onended = dispose;
      voices.push(voice);
      if (event.kind === 'noise') {
        source.buffer = getNoiseBuffer(context); source.loop = true;
        const filter = context.createBiquadFilter();
        filter.type = event.filter; filter.Q.value = .7;
        filter.frequency.setValueAtTime(event.frequency, at);
        if (event.to) filter.frequency.exponentialRampToValueAtTime(event.to, end);
        tail.connect(filter); tail = filter; nodes.push(filter);
      } else {
        source.type = event.wave;
        source.frequency.setValueAtTime(event.frequency, at);
        if (event.to) source.frequency.exponentialRampToValueAtTime(event.to, end);
      }
      tail.connect(gain); tail = gain;
      if (event.pan && typeof context.createStereoPanner === 'function') {
        const pan = context.createStereoPanner(); pan.pan.value = event.pan;
        tail.connect(pan); tail = pan; nodes.push(pan);
      }
      tail.connect(destination);
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.linearRampToValueAtTime(event.gain, at + Math.min(event.attack, event.duration * .9));
      gain.gain.exponentialRampToValueAtTime(.0001, end);
      source.start(at); source.stop(end + .015);
      track(voice);
    }
    return voices;
  } catch (error) {
    for (const voice of voices) voice.stop();
    throw error;
  }
}
