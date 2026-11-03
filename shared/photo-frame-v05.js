import { BROW_TOP, RULES } from './photo-rules-v05.js';

export const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
export const mean = values => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

export function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * clamp(fraction))];
}

export function toFace(frame, p) {
  const dx = p.x - frame.origin.x;
  const dy = p.y - frame.origin.y;
  return { x: (dx * frame.u.x + dy * frame.u.y) / frame.iod,
    y: (dx * frame.v.x + dy * frame.v.y) / frame.iod };
}

export function faceFrame(landmarksPx) {
  const point = i => {
    const p = landmarksPx[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new Error('얼굴 기준점을 찾지 못했어요. 정면 사진을 골라 주세요.');
    }
    return p;
  };
  const mid = (a, b) => ({ x: (point(a).x + point(b).x) / 2, y: (point(a).y + point(b).y) / 2 });
  const left = mid(33, 133);
  const right = mid(362, 263);
  const iod = Math.hypot(right.x - left.x, right.y - left.y);
  if (iod < 1e-6) throw new Error('눈 사이 거리를 재지 못했어요.');
  const u = { x: (right.x - left.x) / iod, y: (right.y - left.y) / iod };
  const frame = { iod, u, v: { x: -u.y, y: u.x },
    origin: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } };
  frame.lc = toFace(frame, point(152)).y;
  frame.lf = -toFace(frame, point(10)).y;
  frame.fw = Math.abs(toFace(frame, point(454)).x - toFace(frame, point(234)).x);
  frame.yBrow = Math.min(...BROW_TOP.map(i => toFace(frame, point(i)).y));
  frame.yaw = Math.abs(toFace(frame, point(1)).x);
  frame.rollDeg = Math.atan2(u.y, u.x) * 180 / Math.PI;
  frame.mouth = Math.hypot(point(13).x - point(14).x, point(13).y - point(14).y) / iod;
  if (frame.lc <= 0 || frame.lf <= 0 || frame.fw <= 0) throw new Error('얼굴 방향을 확인해 주세요.');
  return frame;
}

export function canvasTransform(frame, options = RULES.head) {
  const { pxPerIod, originY } = options;
  const originX = options.originX ?? (options.width ?? options.size) / 2;
  const s = pxPerIod / frame.iod;
  return [s * frame.u.x, s * frame.v.x, s * frame.u.y, s * frame.v.y,
    originX - s * (frame.u.x * frame.origin.x + frame.u.y * frame.origin.y),
    originY - s * (frame.v.x * frame.origin.x + frame.v.y * frame.origin.y)];
}

export function gridPoint(x, y, grid = RULES.head) {
  return { x: (x + 0.5 - grid.originX) / grid.pxPerIod,
    y: (y + 0.5 - grid.originY) / grid.pxPerIod };
}

export function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function nearPolygon(p, polygon, margin = 0) {
  if (pointInPolygon(p, polygon)) return true;
  return polygon.some((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= margin;
  });
}

export function qualityGates({ faceCount = 1, frame, iodPx = frame?.iod, hair,
  faceLuma, backgroundLuma, hatRatio, eyeCheekRatio }) {
  const q = RULES.quality;
  const errors = [];
  const warnings = [];
  if (faceCount !== 1) {
    errors.push(faceCount ? '한 사람만 나온 사진을 골라 주세요.' : '밝은 곳에서 정면으로 찍어 주세요.');
  }
  if (frame) {
    if (iodPx < q.minIod) errors.push('얼굴이 더 크게 나오도록 가까이 찍어 주세요.');
    if (frame.yaw > q.yawError) errors.push('정면을 봐 주세요.');
    else if (frame.yaw > q.yawWarn) warnings.push('yaw');
    if (Math.abs(frame.rollDeg) > q.rollWarn) warnings.push('roll');
    if (frame.mouth > q.mouthWarn) warnings.push('mouth');
  }
  if (hair?.lengthKnown === false) warnings.push('shoulderHidden');
  if (hair?.topKnown === false) warnings.push('topHidden');
  if (hair?.shapeKnown === false) warnings.push('hairUnknown');
  if (Number.isFinite(faceLuma) && (faceLuma < q.dark || faceLuma > q.bright)) warnings.push('light');
  if (backgroundLuma / Math.max(faceLuma, 1e-6) > q.backlight) warnings.push('backlight');
  if (hatRatio > q.hat) warnings.push('hat');
  if (eyeCheekRatio < q.sunglasses) warnings.push('sunglasses');
  return { errors, warnings };
}
