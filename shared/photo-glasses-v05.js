import { BROW_LOOPS, EYE_LOOPS, RULES } from './photo-rules-v05.js';
import { clamp, gridPoint, mean, nearPolygon } from './photo-frame-v05.js';

export function sobel(luma, width, height) {
  if (luma.length !== width * height) throw new Error('눈 밝기 격자의 크기가 맞지 않아요.');
  const gx = new Float32Array(luma.length);
  const gy = new Float32Array(luma.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      gx[i] = (-luma[i - width - 1] + luma[i - width + 1] - 2 * luma[i - 1]
        + 2 * luma[i + 1] - luma[i + width - 1] + luma[i + width + 1]) / 8;
      gy[i] = (-luma[i - width - 1] - 2 * luma[i - width] - luma[i - width + 1]
        + luma[i + width - 1] + 2 * luma[i + width] + luma[i + width + 1]) / 8;
    }
  }
  return { gx, gy };
}

export function glassesExclusion({ points, labels, valid, width, height, grid = RULES.eyes }) {
  const polygons = [...EYE_LOOPS, ...BROW_LOOPS].map(ids => ids.map(i => points[i]).filter(Boolean));
  const exclude = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = gridPoint(x, y, grid);
      if ((valid && !valid[i]) || labels?.[i] === 1
        || polygons.some(poly => poly.length >= 3 && nearPolygon(p, poly, RULES.glasses.excludeMargin))) {
        exclude[i] = 1;
      }
    }
  }
  return exclude;
}

export function glassesScore({ luma, width, height, exclude, valid, grid = RULES.eyes,
  accessoryRatio = 0, sunglasses = false }) {
  const r = RULES.glasses;
  const { gx, gy } = sobel(luma, width, height);
  if ((exclude && exclude.length !== luma.length) || (valid && valid.length !== luma.length)) {
    throw new Error('안경 제외 영역의 크기가 맞지 않아요.');
  }
  // 경사 커널 안에 제외 픽셀이 있으면 눈썹·앞머리의 경계도 제외한다.
  const usable = (x, y) => {
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const i = (y + dy) * width + x + dx;
        if (exclude?.[i] || (valid && !valid[i])) return false;
      }
    }
    return true;
  };
  const region = (xRange, yRange, vertical = false) => {
    const lines = new Map();
    let total = 0;
    let count = 0;
    let sum = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = gridPoint(x, y, grid);
        if (p.x < xRange[0] || p.x > xRange[1] || p.y < yRange[0] || p.y > yRange[1]) continue;
        total++;
        const key = vertical ? x : y;
        const line = lines.get(key) ?? { total: 0, count: 0, sum: 0 };
        line.total++;
        if (usable(x, y)) {
          const value = Math.abs((vertical ? gx : gy)[y * width + x]);
          line.count++;
          line.sum += value;
          count++;
          sum += value;
        }
        lines.set(key, line);
      }
    }
    const peaks = [...lines.values()].filter(line => line.count >= line.total * r.minCoverage)
      .map(line => line.sum / line.count);
    return { peak: Math.max(0, ...peaks), mean: count ? sum / count : 0, coverage: total ? count / total : 0 };
  };
  const negative = range => [-range[1], -range[0]];
  const bridge = region([-r.bridgeX, r.bridgeX], r.bridgeY);
  const lows = [region(negative(r.lowX), r.lowY), region(r.lowX, r.lowY)];
  const outers = [region(negative(r.outerX), r.outerY, true), region(r.outerX, r.outerY, true)];
  const cheeks = [region(negative(r.cheekX), r.cheekY), region(r.cheekX, r.cheekY)];
  const reference = Math.max(r.noiseFloor, mean(cheeks.map(v => v.mean)));
  const normalize = value => clamp((value / reference - 1) / r.normalization);
  const parts = { bridge: normalize(bridge.peak), lowRim: normalize(Math.min(...lows.map(v => v.peak))),
    outerRim: normalize(Math.min(...outers.map(v => v.peak))) };
  const score = clamp(r.weights[0] * parts.bridge + r.weights[1] * parts.lowRim
    + r.weights[2] * parts.outerRim + (accessoryRatio >= r.segmentFraction ? r.segmentBonus : 0));
  const sufficient = [bridge, ...lows, ...outers, ...cheeks].every(v => v.coverage >= r.minCoverage);
  // 분할 보너스나 다리 하나만으로 '있음'이 되지 않게 눈 아래 테와 바깥 테 단서를 둘 다 요구한다.
  const bilateral = parts.lowRim >= r.bilateralMin && parts.outerRim >= r.bilateralMin;
  let decision = sufficient ? score <= r.lo ? 'no' : score >= r.hi && bilateral ? 'yes' : 'unknown' : 'unknown';
  // 눈 주변이 어두운 것은 조명 탓일 수도 있어 '있음'으로 정하지 않는다(경고 문구로 확인을 부탁한다).
  if (sunglasses && decision === 'no') decision = 'unknown';
  return { score, decision, parts };
}
