import { RULES } from './photo-rules-v05.js';
import { gridPoint, mean, quantile } from './photo-frame-v05.js';

export function assertRaster({ labels, valid, width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || labels.length !== width * height || (valid && valid.length !== labels.length)) {
    throw new Error('측정 격자의 크기가 맞지 않아요.');
  }
}

// 모델 출력 크기가 달라도 라벨은 최근접 이웃으로 고정 격자에 옮긴다.
export function resizeLabels(labels, width, height, targetWidth, targetHeight) {
  assertRaster({ labels, width, height });
  const output = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / targetHeight));
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * width / targetWidth));
      output[y * targetWidth + x] = labels[sy * width + sx];
    }
  }
  return output;
}

// 유효 영역의 바깥은 라벨 0(배경)과 구별한다.
export function measureHair({ labels, valid, width, height, frame, grid = RULES.head }) {
  assertRaster({ labels, valid, width, height });
  const r = RULES.measure;
  const half = frame.fw / 2;
  const okay = (x, y) => x >= 0 && y >= 0 && x < width && y < height
    && (!valid || valid[y * width + x] > 0);
  const bottoms = [];
  const tops = [];
  const shoulders = [];
  const sideTotal = [0, 0];
  const sideHair = [0, 0];
  const bins = Array.from({ length: 7 }, () => [0, 0]);
  const low = [0, 0];
  const topTouches = new Set();
  const foreheadTop = r.foreheadTop * frame.lf;
  const foreheadBottom = frame.yBrow - r.browMargin;
  let bottomTouch = false;
  let volSide = null;
  let hairCount = 0;
  for (let x = 0; x < width; x++) {
    const ax = Math.abs(gridPoint(x, 0, grid).x);
    if (ax < half + r.shoulderInner || ax > half + r.shoulderOuter) continue;
    for (let y = 0; y < height; y++) {
      const p = gridPoint(x, y, grid);
      const label = labels[y * width + x];
      if (okay(x, y) && p.y >= frame.lc && (label === 2 || label === 4)) {
        shoulders.push(p.y);
        break;
      }
    }
  }
  const yShoulder = quantile(shoulders, 0.5) ?? frame.lc * (1 + r.shoulderFallback);
  const shLen = (yShoulder - frame.lc) / frame.lc;
  let shoulderTotal = 0;
  let shoulderValid = 0;
  const shoulderRow = Math.floor(grid.originY + (yShoulder + r.shoulderMargin * frame.lc) * grid.pxPerIod);
  for (let x = 0; x < width; x++) {
    const ax = Math.abs(gridPoint(x, 0, grid).x);
    if (ax < half + r.sideInner || ax > half + r.sideOuter) continue;
    shoulderTotal++;
    if (okay(x, shoulderRow)) shoulderValid++;
  }
  for (let y = 0; y < height; y++) {
    let run = 0;
    let first = null;
    let last = null;
    for (let x = 0; x < width; x++) {
      const p = gridPoint(x, y, grid);
      const ax = Math.abs(p.x);
      const hair = okay(x, y) && labels[y * width + x] === 1;
      run = hair ? run + 1 : 0;
      if (run >= r.minRun) {
        first ??= x - run + 1;
        last = x;
      }
      if (!okay(x, y)) continue;
      const isSide = ax >= half + r.sideInner && ax <= half + r.sideOuter;
      if (hair) {
        hairCount++;
        if (isSide && p.y >= 0) {
          bottoms.push(p.y);
          if (!okay(x, y + 1)) bottomTouch = true;
        }
        if (ax <= r.topHalf) tops.push(p.y);
        if (p.y < -frame.lf && !okay(x, y - 1)) topTouches.add(x);
      }
      if (ax >= half + r.bandInner && ax <= half + r.bandOuter
        && p.y >= r.bandTop * frame.lc && p.y <= r.bandBottom * frame.lc) {
        const side = p.x < 0 ? 0 : 1;
        sideTotal[side]++;
        if (hair) sideHair[side]++;
      }
      if (ax <= r.foreheadHalf && p.y >= foreheadTop && p.y <= foreheadBottom) {
        const bin = Math.min(6, Math.floor((p.x + r.foreheadHalf) / (2 * r.foreheadHalf) * 7));
        bins[bin][0]++;
        if (hair) bins[bin][1]++;
        if (p.y >= foreheadBottom - r.fringeLow * (foreheadBottom - foreheadTop)) {
          low[0]++;
          if (hair) low[1]++;
        }
      }
    }
    const rowY = gridPoint(0, y, grid).y;
    if (first !== null && rowY >= -frame.lf && rowY <= 0) {
      const span = (last - first + 1) / grid.pxPerIod / frame.fw;
      volSide = Math.max(volSide ?? 0, span);
    }
  }
  const hairBottom = quantile(bottoms, r.bottomQuantile);
  const hairTop = quantile(tops, r.topQuantile);
  const len = hairBottom === null ? null : (hairBottom - frame.lc) / frame.lc;
  const lengthKnown = shoulderTotal > 0 && shoulderValid / shoulderTotal >= r.validFraction && !bottomTouch;
  const sides = sideTotal.map((n, i) => n ? sideHair[i] / n : null);
  const covered = bins.reduce((n, b) => n + b[1], 0);
  const total = bins.reduce((n, b) => n + b[0], 0);
  const rates = bins.map(b => b[0] ? b[1] / b[0] : null);
  const left = mean(rates.slice(0, 3).filter(Number.isFinite));
  const right = mean(rates.slice(4).filter(Number.isFinite));
  const partKnown = rates.every(Number.isFinite);
  let lengthClass = 'unknown';
  if (len !== null) {
    lengthClass = len < r.ear ? 'ear' : len < r.jaw ? 'jaw' : len < shLen + r.longMargin ? 'neck' : 'long';
  }
  return {
    shLen, yShoulder, len, lengthClass, lengthKnown, shapeKnown: hairCount > 0,
    side: sides.every(Number.isFinite) ? mean(sides) : null,
    sideMin: sides.every(Number.isFinite) ? Math.min(...sides) : null,
    fringe: total ? covered / total : null,
    fringeLow: low[0] ? low[1] / low[0] : null,
    centerGap: partKnown ? mean([rates[0], rates[1], rates[5], rates[6]]) - rates[3] : null,
    asym: partKnown ? (left - right) / (left + right + 0.01) : null,
    volTop: hairTop === null ? null : -frame.lf - hairTop,
    topKnown: topTouches.size <= r.topTouchColumns && hairTop !== null,
    volSide,
  };
}

// 침식과 인접 라벨 제외를 통과한 실제 픽셀만 반환한다. 호출자가 사용 후 버린다.
export function sampleByLabel({ labels, valid, width, height, rgba, label, frame,
  grid = RULES.head, erosion = RULES.color.erosion, maxSamples = RULES.color.maxSamples }) {
  assertRaster({ labels, valid, width, height });
  if (rgba.length !== labels.length * 4) throw new Error('색 격자의 크기가 맞지 않아요.');
  const accepted = [];
  const okay = (x, y) => x >= 0 && y >= 0 && x < width && y < height
    && (!valid || valid[y * width + x] > 0);
  for (let y = erosion; y < height - erosion; y++) {
    for (let x = erosion; x < width - erosion; x++) {
      const i = y * width + x;
      if (labels[i] !== label || !okay(x, y)) continue;
      const p = gridPoint(x, y, grid);
      if (label === 4 && (p.y < frame.lc * RULES.color.topStart || Math.abs(p.x) > RULES.color.topHalf)) {
        continue;
      }
      const side = Math.abs(p.x) >= frame.fw / 2 + RULES.measure.sideInner
        && Math.abs(p.x) <= frame.fw / 2 + RULES.measure.sideOuter && p.y >= 0;
      if (label === 1 && !(p.y <= frame.yBrow || side)) continue;
      const radius = label === 1 ? Math.max(erosion, RULES.color.skinMargin) : erosion;
      let keep = true;
      for (let dy = -radius; dy <= radius && keep; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const j = (y + dy) * width + x + dx;
          const inner = Math.abs(dx) <= erosion && Math.abs(dy) <= erosion;
          if (!okay(x + dx, y + dy) || (inner && labels[j] !== label)
            || (label === 1 && labels[j] === 3)) {
            keep = false;
            break;
          }
        }
      }
      if (keep) accepted.push(i);
    }
  }
  const count = Math.min(accepted.length, maxSamples);
  const samples = [];
  for (let n = 0; n < count; n++) {
    const i = accepted[Math.floor(n * accepted.length / count)] * 4;
    samples.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  return samples;
}
