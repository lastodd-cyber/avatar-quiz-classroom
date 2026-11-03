import { PALETTES, DEFAULT_AVATAR_V05, cleanAvatarV05, hexToRgb } from './avatar-v05.js';

// original에는 색상 값이 없으므로 원화의 대표 중간색을 사용한다.
// 피부는 조합 모듈의 SOURCE_SKIN과 같은 값이다. 머리·옷은 원화의 대표색 근삿값이다.
export const ORIGINAL_TONES = { hair: '#352a29', skin: '#fcc19e', top: '#252329', bottom: '#24242a' };
const LABELS = { hair: '머리', top: '상의' };
const validHex = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);

export function nearestPaletteV05(group, hex) {
  const choices = PALETTES[group];
  if (!choices) throw new Error('알 수 없는 색표: ' + group);
  if (!validHex(hex)) return { id: choices[0].id, distance: null, reason: '색 정보가 없어 원화 색 선택' };
  const rgb = hexToRgb(hex);
  const ranked = choices.map(choice => {
    const tone = choice.original ? ORIGINAL_TONES[group] : choice.tone || choice.ramp[1];
    const color = hexToRgb(tone);
    // RGB 가중 제곱 거리. 같은 거리면 색표에 먼저 있는 항목을 유지한다.
    const distance = color.reduce((sum, channel, index) =>
      sum + (channel - rgb[index]) ** 2 * [.30, .59, .11][index], 0);
    return { id: choice.id, name: choice.name, distance };
  });
  ranked.sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  return { ...best, reason: `${hex}와 색 거리가 가장 가까운 ${best.name} 선택` };
}

// 옛 호출자 호환용이다. 학생 사진 경로는 photo-match-v05.js를 사용한다.
export function matchAvatarV05(analysis = {}, current = DEFAULT_AVATAR_V05) {
  const avatar = { ...DEFAULT_AVATAR_V05 };
  avatar.skin = cleanAvatarV05(current).skin;
  const reasons = [];
  for (const group of ['hair', 'top']) {
    const color = group === 'top' ? analysis.shirt : analysis[group];
    const choice = nearestPaletteV05(group, color);
    avatar[group] = choice.id;
    reasons.push(`${LABELS[group]}: ${choice.reason}`);
  }
  if (typeof analysis.glasses === 'boolean') avatar.glasses = analysis.glasses;
  reasons.push(`안경: ${avatar.glasses ? '있음' : '없음'}. 머리 모양과 하의는 기본 모습 유지`);
  return { avatar: cleanAvatarV05(avatar), reasons, reason: reasons.join(' · ') };
}
