import { HAIR_RULES, NOTES, PHOTO_PALETTES, REASONS, RULES } from './photo-rules-v05.js';
import { classifyHairColor, classifyTopColor, hexRgb, rankPalette, rgbToOklab } from './photo-color-v05.js';

const finite = Number.isFinite;
const idOf = item => typeof item === 'string' ? item : item.id;

export function rankHairStyles(features, { weights = RULES.weights } = {}) {
  const hair = features.hair ?? {};
  const shLen = features.frame?.shLen ?? RULES.measure.shoulderFallback;
  const gap = (value, range, lowerBound) => {
    if (!finite(value)) return 0;
    const [lo, hi] = range;
    if (hi !== null && value > hi) return value - hi;
    if (!lowerBound && lo !== null && value < lo) return lo - value;
    return 0;
  };
  return HAIR_RULES.map((rule, order) => {
    let score = 0;
    for (const [key, [weight, scale]] of Object.entries(weights)) {
      if (!rule[key] || (key === 'volTop' && hair.topKnown === false)) continue;
      const range = typeof rule[key] === 'function' ? rule[key](shLen) : rule[key];
      score += weight * gap(hair[key], range, key === 'len' && hair.lengthKnown === false) / scale;
    }
    let tie = 0;
    if (rule.id === 'centerPart' && hair.centerGap >= RULES.match.centerGap) tie = -1;
    if (rule.id === 'sidePart' && Math.abs(hair.asym) >= RULES.match.asym) tie = -1;
    // 관측되지 않은 곱슬 결이나 묶음 단서를 만들어 넣지 않는다.
    const curly = rule.id === 'curlyShort';
    const eligible = rule.id !== 'ponytail' && (!curly || (finite(hair.volSide)
      && hair.volSide >= RULES.match.curly && finite(hair.len) && hair.len <= shLen + RULES.measure.longMargin));
    const first = eligible && (!curly || hair.volSide >= RULES.match.curlyFirst);
    return { id: rule.id, score, tie, order, eligible, first };
  }).sort((a, b) => {
    if (Math.abs(a.score - b.score) > RULES.match.tie) return a.score - b.score;
    return a.tie - b.tie || a.order - b.order;
  });
}

function availablePalette(palettes, group) {
  const entries = palettes[group] ?? [];
  return [...new Map(entries.map(item => [idOf(item), item])).values()]
    .filter(item => PHOTO_PALETTES[group].some(p => p.id === idOf(item)));
}

function resolveColor(id, color, group, available) {
  if (available.some(p => idOf(p) === id)) return id;
  const reference = PHOTO_PALETTES[group].find(p => p.id === id);
  const measured = color && finite(color.L) ? color : rgbToOklab(hexRgb(reference.photoRef));
  return rankPalette(measured, group, available)[0]?.id;
}

export function matchPhotoV05(features, { hairStyles = ['messy'], palettes = PHOTO_PALETTES,
  weights = RULES.weights } = {}) {
  if (features?.version !== 1) throw new Error('사진 측정 형식을 확인해 주세요.');
  const notes = new Set((features.quality?.warnings ?? []).map(key => NOTES[key]).filter(Boolean));
  const hair = features.hair ?? {};
  if (hair.lengthKnown === false) notes.add(NOTES.shoulderHidden);
  if (hair.topKnown === false) notes.add(NOTES.topHidden);
  if (hair.shapeKnown === false) notes.add(NOTES.hairUnknown);
  if (features.white?.method !== 'sclera') notes.add(NOTES.whiteNone);
  const available = new Set(hairStyles.filter(item => typeof item === 'string' || item.photoMatch !== false).map(idOf));
  const all = rankHairStyles(features, { weights });
  const styles = all.filter(style => available.has(style.id) && style.eligible);
  const first = styles.find(style => style.first);
  const hairPalettes = availablePalette(palettes, 'hair');
  const topPalettes = availablePalette(palettes, 'top');
  if (!first || !hairPalettes.length || !topPalettes.length) {
    return { candidates: [], notes: [...notes, NOTES.limited] };
  }
  const unfilteredFirst = all.find(style => style.first);
  const unavailable = unfilteredFirst.id !== first.id;
  if (unavailable) notes.add(NOTES.unavailable);
  const otherStyles = styles.filter(style => style.id !== first.id);
  if (otherStyles[0] && Math.abs(otherStyles[0].score - first.score) < RULES.match.similar) notes.add(NOTES.similar);
  const color = classifyHairColor(features.hairColor);
  if (!color.known) notes.add(NOTES.colorUnknown);
  const tops = features.topColors ?? [];
  if (!tops.length) notes.add(NOTES.topUnknown);
  const primaryHair = resolveColor(color.primary, features.hairColor, 'hair', hairPalettes);
  const primaryTop = resolveColor(classifyTopColor(tops[0]), tops[0], 'top', topPalettes);
  const decision = features.glasses?.decision ?? 'unknown';
  // 첫 후보에는 '확실히 있음'일 때만 안경을 씌운다. 모르면 안경 없이 두고 안경 쓴 모습은 다른 후보로 보여 준다
  // (코 그림자·눈 밑 음영이 테처럼 잡혀 중간 점수가 자주 나와, 안경 없는 학생에게 안경이 씌워지던 문제).
  const glasses = decision === 'yes';
  const base = { hairStyle: first.id, hair: primaryHair, top: primaryTop, glasses };
  const candidates = [];
  const seen = new Set();
  const name = (group, id) => PHOTO_PALETTES[group].find(p => p.id === id)?.name ?? id;
  const add = (avatar, reason, direct = false) => {
    if (candidates.length >= 3) return;
    const key = JSON.stringify(avatar);
    if (seen.has(key)) return;
    seen.add(key);
    const styleReason = unavailable ? REASONS.available : direct ? REASONS[avatar.hairStyle] : REASONS.alternative;
    candidates.push({ avatar, reasons: [styleReason, reason].filter(Boolean).slice(0, 2) });
  };
  add(base, tops.length ? REASONS.top(name('top', primaryTop)) : null, hair.shapeKnown !== false);
  if (otherStyles[0]) {
    add({ ...base, hairStyle: otherStyles[0].id }, tops.length ? REASONS.top(name('top', primaryTop)) : null);
  }
  if (decision === 'unknown') add({ ...base, glasses: !glasses }, REASONS.glassesUnknown);
  if (tops[1]) {
    const second = resolveColor(classifyTopColor(tops[1]), tops[1], 'top', topPalettes);
    add({ ...base, top: second }, REASONS.top(name('top', second)));
  }
  if (color.secondary) {
    const second = resolveColor(color.secondary, features.hairColor, 'hair', hairPalettes);
    add({ ...base, hair: second }, REASONS.hair(name('hair', second)));
  }
  for (const style of otherStyles.slice(1)) add({ ...base, hairStyle: style.id }, null);
  // 그림이 한 종이면 다음으로 가까운 색만 쓴다. 알려진 안경 여부는 뒤집지 않는다.
  if (candidates.length < 3 && color.known) {
    for (const id of color.ranked.slice(1)) {
      const alternate = resolveColor(id, features.hairColor, 'hair', hairPalettes);
      add({ ...base, hair: alternate }, REASONS.hair(name('hair', alternate)));
    }
  }
  if (candidates.length < 3) notes.add(NOTES.limited);
  return { candidates, notes: [...notes] };
}
