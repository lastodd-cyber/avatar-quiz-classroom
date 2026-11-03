import { PHOTO_PALETTES, RULES } from './photo-rules-v05.js';
import { clamp, mean } from './photo-frame-v05.js';

export function srgbToLinear(value) {
  const v = clamp(value / 255);
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, a, b: bb, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360 };
}

export function rgbToOklab(rgb) {
  return linearToOklab(rgb.map(srgbToLinear));
}

export function hexRgb(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('사진 기준색은 6자리 HEX여야 해요.');
  return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
}

export function labComponents(value) {
  return { L: value.L, a: value.a ?? value.C * Math.cos(value.h * Math.PI / 180),
    b: value.b ?? value.C * Math.sin(value.h * Math.PI / 180) };
}

export function colorDistance(a, b) {
  const aa = labComponents(a);
  const bb = labComponents(b);
  return Math.hypot(RULES.color.lightWeight * (aa.L - bb.L), aa.a - bb.a, aa.b - bb.b);
}

export const luminance = rgb => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const averageRgb = samples => [0, 1, 2].map(c => mean(samples.map(rgb => rgb[c])));
const noWhite = () => ({ method: 'none', gains: [1, 1, 1], exposure: 1 });

export function correctedLinear(rgb, white = noWhite()) {
  return rgb.map((v, c) => clamp(srgbToLinear(v) * white.gains[c] * white.exposure));
}

// 눈 다각형·홍채·머리 제외는 표본 수집 단계에서 수행한다. 배경 보정은 하지 않는다.
export function estimateWhite({ eyes = [], openness = [], skinSamples = [] } = {}) {
  const w = RULES.white;
  if (eyes.length !== 2 || openness.length !== 2 || openness.some(v => !Number.isFinite(v) || v < w.eyeOpen)) {
    return noWhite();
  }
  const bright = eyes.map(samples => {
    const linear = samples.map(rgb => rgb.map(srgbToLinear));
    linear.sort((a, b) => luminance(a) - luminance(b));
    return linear.slice(Math.floor(linear.length * (1 - w.brightFraction)));
  });
  if (bright.some(samples => samples.length < w.minEye)) return noWhite();
  const averages = bright.map(averageRgb);
  const labs = averages.map(linearToOklab);
  if (Math.hypot(labs[0].a - labs[1].a, labs[0].b - labs[1].b) > w.agreement) return noWhite();
  const measured = averageRgb(averages);
  if (measured.some(v => v <= 0)) return noWhite();
  const reference = hexRgb(w.reference).map(srgbToLinear);
  const ratios = reference.map((v, c) => v / measured[c]);
  const gains = ratios.map(v => clamp(v / ratios[1], w.gainMin, w.gainMax));
  const exposure = clamp(luminance(reference) / luminance(measured), w.exposureMin, w.exposureMax);
  const white = { method: 'sclera', gains, exposure };
  if (skinSamples.length) {
    const skin = linearToOklab(averageRgb(skinSamples.map(rgb => correctedLinear(rgb, white))));
    if (skin.h < w.skinHueMin || skin.h > w.skinHueMax) return noWhite();
  }
  return white;
}

function dyeSector(h) {
  const c = RULES.color;
  if (h < c.redHue[0] || h >= c.redHue[1]) return 'red';
  if (h >= c.blueHue[0] && h <= c.blueHue[1]) return 'blue';
  return 'other';
}

export function hairColorStats(samples, white = noWhite()) {
  if (samples.length < RULES.color.hairMin) return { known: false, n: samples.length };
  const colors = samples.map(rgb => correctedLinear(rgb, white)).sort((a, b) => luminance(a) - luminance(b));
  const slice = (a, b) => colors.slice(Math.floor(colors.length * a), Math.ceil(colors.length * b));
  const lab = linearToOklab(averageRgb(slice(RULES.color.trimLow, RULES.color.trimHigh)));
  const highlight = linearToOklab(averageRgb(slice(RULES.color.trimHigh, RULES.color.highlightHigh)));
  const sector = dyeSector(lab.h);
  const consistent = colors.filter(rgb => {
    const value = linearToOklab(rgb);
    return value.C >= RULES.color.dyeChroma && dyeSector(value.h) === sector;
  }).length;
  return { known: true, L: lab.L, C: lab.C, h: lab.h, highlightB: highlight.b,
    dyeShare: consistent / colors.length, n: samples.length };
}

export function rankPalette(color, group, palettes = PHOTO_PALETTES[group]) {
  return palettes.map(item => {
    const entry = typeof item === 'string' ? { id: item } : item;
    const reference = entry.photoRef ?? PHOTO_PALETTES[group].find(p => p.id === entry.id)?.photoRef;
    return reference ? { id: entry.id, distance: colorDistance(color, rgbToOklab(hexRgb(reference))) } : null;
  }).filter(Boolean).sort((a, b) => a.distance - b.distance);
}

export function classifyHairColor(stats) {
  if (!stats || stats.known === false || !Number.isFinite(stats.L)) {
    return { primary: 'original', secondary: null, ranked: ['original'], dye: false, known: false };
  }
  const c = RULES.color;
  const { L, C, h } = stats;
  const sector = dyeSector(h);
  const dye = C >= c.dyeChroma && (h < c.naturalHue[0] || h > c.naturalHue[1])
    && stats.dyeShare >= c.dyeShare && sector !== 'other';
  const natural = ['black', 'original', 'chestnut', 'lightBrown', 'blond', 'gray'];
  let primary;
  if (dye) primary = sector === 'blue' ? 'blue' : L < c.dyeLight ? 'wine' : 'pink';
  else if (C < c.grayChroma && L >= c.grayLight) primary = 'gray';
  else {
    let index = c.hairBounds.findIndex(bound => L < bound);
    if (index < 0) index = 4;
    primary = natural[index];
    if (primary === 'blond' && labComponents(stats).b <= c.blondB) primary = 'lightBrown';
    if (primary === 'black' && stats.highlightB > c.warmHighlight) primary = 'original';
  }
  const allowed = PHOTO_PALETTES.hair.filter(p => dye || natural.includes(p.id));
  const ranked = [primary, ...rankPalette(stats, 'hair', allowed).map(p => p.id).filter(id => id !== primary)];
  let secondary = null;
  if (!dye && primary !== 'gray') {
    const boundary = c.hairBounds.findIndex(bound => Math.abs(L - bound) <= c.boundary);
    if (boundary >= 0) secondary = natural[boundary] === primary ? natural[boundary + 1] : natural[boundary];
  }
  return { primary, secondary, ranked, dye, known: true };
}

// 초기 중심을 밝기 백분위로 정한다. 빈 군집은 버리고 무작위 값은 쓰지 않는다.
export function kmeansOklab(input, { iterations = RULES.color.iterations } = {}) {
  if (!input.length) return [];
  const points = input.map(labComponents).sort((a, b) => a.L - b.L || a.a - b.a || a.b - b.b);
  let centers = RULES.color.seeds.map(q => ({ ...points[Math.floor((points.length - 1) * q)] }));
  let groups;
  const assign = () => {
    const buckets = centers.map(() => []);
    for (const p of points) {
      let winner = 0;
      let distance = Infinity;
      centers.forEach((center, i) => {
        const d = colorDistance(p, center);
        if (d < distance) {
          distance = d;
          winner = i;
        }
      });
      buckets[winner].push(p);
    }
    return buckets;
  };
  for (let step = 0; step < iterations; step++) {
    groups = assign();
    centers = centers.map((center, i) => groups[i].length ? {
      L: mean(groups[i].map(p => p.L)), a: mean(groups[i].map(p => p.a)), b: mean(groups[i].map(p => p.b)),
    } : center);
  }
  groups = assign();
  return centers.map((p, i) => ({ L: p.L, C: Math.hypot(p.a, p.b),
    h: (Math.atan2(p.b, p.a) * 180 / Math.PI + 360) % 360, share: groups[i].length / points.length }))
    .filter(p => p.share >= RULES.color.minShare).sort((a, b) => b.share - a.share || a.L - b.L);
}

export function topColorStats(samples, white = noWhite()) {
  if (samples.length < RULES.color.topMin) return [];
  const clusters = kmeansOklab(samples.map(rgb => linearToOklab(correctedLinear(rgb, white))));
  const secondary = clusters[1];
  if (secondary && (secondary.share < RULES.color.secondaryShare
    || colorDistance(clusters[0], secondary) < RULES.color.secondaryDistance)) return clusters.slice(0, 1);
  return clusters.slice(0, 2);
}

export function classifyTopColor(color) {
  if (!color || !Number.isFinite(color.L)) return 'original';
  const c = RULES.color;
  // 남색 예외는 무채색 분기보다 먼저 검사한다.
  if (color.L < c.grayTopLight && color.C >= c.navyChroma
    && color.h >= c.navyHue[0] && color.h <= c.navyHue[1]) return 'navy';
  if (color.C < c.neutralChroma) {
    return color.L >= c.whiteLight ? 'white' : color.L >= c.grayTopLight ? 'gray' : 'original';
  }
  return rankPalette(color, 'top')[0].id;
}
