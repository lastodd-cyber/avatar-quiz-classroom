import { loadModels } from './photo.js';
import { EYE_LOOPS, RULES } from '../shared/photo-rules-v05.js';
import { canvasTransform, faceFrame, gridPoint, mean, pointInPolygon,
  qualityGates, quantile, toFace } from '../shared/photo-frame-v05.js';
import { measureHair, resizeLabels, sampleByLabel } from '../shared/photo-measure-v05.js';
import { estimateWhite, hairColorStats, luminance, srgbToLinear, topColorStats } from '../shared/photo-color-v05.js';
import { glassesExclusion, glassesScore } from '../shared/photo-glasses-v05.js';

/**
 * @typedef {Object} PhotoFeaturesV05
 * @property {1} version
 * @property {Object} quality 경고 코드와 얼굴 크기·자세 숫자
 * @property {Object} frame lc, lf, fw, shLen (눈 사이 거리 단위)
 * @property {Object} hair F1~F6. 모르는 수치는 null. F7·F8은 출력하지 않음
 * @property {Object} white method, gains, exposure
 * @property {Object} hairColor L, C, h, highlightB, dyeShare, n 또는 known:false
 * @property {Array<Object>} topColors 주색과 보조색 최대 2개
 * @property {Object} glasses score, decision, parts
 */

function lumaOf(rgba) {
  const output = new Float32Array(rgba.length / 4);
  for (let i = 0; i < output.length; i++) {
    output[i] = luminance([0, 1, 2].map(c => srgbToLinear(rgba[i * 4 + c])));
  }
  return output;
}

function eyeSamples(eyes, points) {
  return EYE_LOOPS.map((loop, side) => {
    const polygon = loop.map(i => points[i]).filter(Boolean);
    const center = points[side ? 473 : 468];
    const rim = (side ? [474, 475, 476, 477] : [469, 470, 471, 472]).map(i => points[i]);
    if (polygon.length !== loop.length || !center || rim.some(p => !p)) return [];
    const radius = mean(rim.map(p => Math.hypot(p.x - center.x, p.y - center.y))) * RULES.white.irisScale;
    if (!(radius > 0)) return [];
    const samples = [];
    for (let y = 0; y < eyes.height; y++) {
      for (let x = 0; x < eyes.width; x++) {
        const i = y * eyes.width + x;
        if (!eyes.valid[i] || eyes.labels[i] === 1) continue;
        const p = gridPoint(x, y, RULES.eyes);
        if (!pointInPolygon(p, polygon) || Math.hypot(p.x - center.x, p.y - center.y) <= radius) continue;
        samples.push(Array.from(eyes.rgba.subarray(i * 4, i * 4 + 3)));
      }
    }
    return samples;
  });
}

function eyeOpen(points, top, bottom) {
  if (!points[top] || !points[bottom]) return 0;
  return Math.hypot(points[top].x - points[bottom].x, points[top].y - points[bottom].y);
}

// 픽셀 버퍼는 반환하지 않는다. Node의 가짜 장면도 같은 측정 경로를 사용한다.
export function measurePhotoV05({ head, eyes, frame, points, iodPx }) {
  const hair = measureHair({ ...head, frame });
  const skinSamples = sampleByLabel({ ...head, frame, label: 3 });
  const white = estimateWhite({ eyes: eyeSamples(eyes, points), skinSamples,
    openness: [eyeOpen(points, 159, 145), eyeOpen(points, 386, 374)] });
  const hairColor = hairColorStats(sampleByLabel({ ...head, frame, label: 1 }), white);
  const topColors = topColorStats(sampleByLabel({ ...head, frame, label: 4 }), white);
  const headLuma = lumaOf(head.rgba);
  const eyeLuma = lumaOf(eyes.rgba);
  const skinLight = [];
  const backgroundLight = [];
  const cheekLight = [];
  const eyeLight = [[], []];
  const polygons = EYE_LOOPS.map(loop => loop.map(i => points[i]).filter(Boolean));
  let hatTotal = 0;
  let hatCount = 0;
  let accessoryTotal = 0;
  let accessoryCount = 0;
  for (let y = 0; y < head.height; y++) {
    for (let x = 0; x < head.width; x++) {
      const i = y * head.width + x;
      if (!head.valid[i]) continue;
      const p = gridPoint(x, y);
      const label = head.labels[i];
      if (label === 3) skinLight.push(headLuma[i]);
      if (label === 0) backgroundLight.push(headLuma[i]);
      if (Math.abs(p.x) <= RULES.quality.hatHalf && p.y >= RULES.quality.hatTop && p.y <= -frame.lf) {
        hatTotal++;
        if (label === 4 || label === 5) hatCount++;
      }
    }
  }
  for (let y = 0; y < eyes.height; y++) {
    for (let x = 0; x < eyes.width; x++) {
      const i = y * eyes.width + x;
      if (!eyes.valid[i]) continue;
      const p = gridPoint(x, y, RULES.eyes);
      if (Math.abs(p.x) < RULES.quality.accessoryHalf && p.y >= RULES.quality.accessoryY[0]
        && p.y <= RULES.quality.accessoryY[1]) {
        accessoryTotal++;
        if (eyes.labels[i] === 5) accessoryCount++;
      }
      if (eyes.labels[i] === 3 && Math.abs(p.x) >= RULES.glasses.cheekX[0]
        && Math.abs(p.x) <= RULES.glasses.cheekX[1] && p.y >= RULES.glasses.cheekY[0]) {
        cheekLight.push(eyeLuma[i]);
      }
      polygons.forEach((polygon, side) => {
        if (polygon.length === 16 && eyes.labels[i] !== 1 && pointInPolygon(p, polygon)) {
          eyeLight[side].push(eyeLuma[i]);
        }
      });
    }
  }
  // 한쪽 그림자만으로 선글라스를 선언하지 않는다.
  const eyeCheekRatio = cheekLight.length && eyeLight.every(samples => samples.length)
    ? Math.max(...eyeLight.map(mean)) / Math.max(mean(cheekLight), 1e-6) : null;
  const quality = qualityGates({ frame, iodPx, hair,
    faceLuma: quantile(skinLight, 0.5), backgroundLuma: quantile(backgroundLight, 0.5),
    hatRatio: hatTotal ? hatCount / hatTotal : 0, eyeCheekRatio: eyeCheekRatio ?? undefined });
  const exclude = glassesExclusion({ ...eyes, points });
  const glasses = glassesScore({ ...eyes, luma: eyeLuma, exclude,
    accessoryRatio: accessoryTotal ? accessoryCount / accessoryTotal : 0,
    sunglasses: quality.warnings.includes('sunglasses') });
  headLuma.fill(0);
  eyeLuma.fill(0);
  exclude.fill(0);
  return { version: 1, quality: { warnings: quality.warnings, iodPx, yaw: frame.yaw, rollDeg: frame.rollDeg },
    frame: { lc: frame.lc, lf: frame.lf, fw: frame.fw, shLen: hair.shLen },
    hair, white, hairColor, topColors, glasses };
}

function validPixels(frame, bitmap, grid) {
  const valid = new Uint8Array(grid.width * grid.height);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const p = gridPoint(x, y, grid);
      const sx = frame.origin.x + frame.iod * (p.x * frame.u.x + p.y * frame.v.x);
      const sy = frame.origin.y + frame.iod * (p.x * frame.u.y + p.y * frame.v.y);
      valid[y * grid.width + x] = sx >= 0 && sy >= 0 && sx < bitmap.width && sy < bitmap.height ? 1 : 0;
    }
  }
  return valid;
}

function mapHeadToEyes(head) {
  const labels = new Uint8Array(RULES.eyes.width * RULES.eyes.height);
  for (let y = 0; y < RULES.eyes.height; y++) {
    for (let x = 0; x < RULES.eyes.width; x++) {
      const p = gridPoint(x, y, RULES.eyes);
      const hx = Math.floor(p.x * RULES.head.pxPerIod + RULES.head.originX);
      const hy = Math.floor(p.y * RULES.head.pxPerIod + RULES.head.originY);
      labels[y * RULES.eyes.width + x] = head.labels[hy * head.width + hx];
    }
  }
  return labels;
}

// 주입 가능한 실행기는 자원 정리 실패 경로를 모델·서버 없이 검사하기 위한 경계다.
function waitForModels(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function createPhotoAnalyzer({ models = loadModels,
  decode = blob => createImageBitmap(blob, { imageOrientation: 'from-image' }),
  makeCanvas = () => document.createElement('canvas'),
  yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  return async function analyze(blob, progress = () => {}, inspect, { signal } = {}) {
    if (!blob || blob.size > RULES.input.maxBytes) throw new Error('15MB 이하의 사진을 골라 주세요.');
    if (blob.type && !blob.type.startsWith('image/')) throw new Error('사진 파일을 골라 주세요.');
    const canvases = [];
    const buffers = [];
    let bitmap;
    let segmentation;
    const canvasOf = (width, height) => {
      const canvas = makeCanvas();
      canvases.push(canvas);
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
    try {
      bitmap = await decode(blob).catch(() => { throw new Error('사진을 읽지 못했어요. JPG나 PNG로 골라 주세요.'); });
      signal?.throwIfAborted();
      const ratio = Math.min(1, RULES.input.detectorMax / Math.max(bitmap.width, bitmap.height));
      const detector = canvasOf(Math.max(1, Math.round(bitmap.width * ratio)),
        Math.max(1, Math.round(bitmap.height * ratio)));
      detector.getContext('2d').drawImage(bitmap, 0, 0, detector.width, detector.height);
      const { face, segment } = await waitForModels(models(progress), signal).catch(error => {
        if (signal?.aborted) throw error;
        throw new Error('지금은 사진 분석을 쓸 수 없어요. 사진 없이 직접 꾸며 주세요.');
      });
      progress('얼굴 기준으로 머리와 옷을 살펴보고 있어요.');
      await yieldFrame();
      signal?.throwIfAborted();
      const detected = face.detect(detector);
      const count = detected.faceLandmarks.length;
      const countGate = qualityGates({ faceCount: count });
      if (countGate.errors.length) throw new Error(countGate.errors[0]);
      const landmarks = detected.faceLandmarks[0];
      const detectFrame = faceFrame(landmarks.map(p => ({ x: p.x * detector.width, y: p.y * detector.height })));
      const early = qualityGates({ frame: detectFrame });
      if (early.errors.length) throw new Error(early.errors[0]);
      const pixelPoints = landmarks.map(p => ({ x: p.x * bitmap.width, y: p.y * bitmap.height }));
      const frame = faceFrame(pixelPoints);
      const points = pixelPoints.map(p => toFace(frame, p));
      const render = grid => {
        const canvas = canvasOf(grid.width, grid.height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.imageSmoothingQuality = 'high';
        context.setTransform(...canvasTransform(frame, grid));
        context.drawImage(bitmap, 0, 0);
        const rgba = context.getImageData(0, 0, grid.width, grid.height).data;
        const valid = validPixels(frame, bitmap, grid);
        buffers.push(rgba, valid);
        return { canvas, rgba, valid, width: grid.width, height: grid.height };
      };
      const head = render(RULES.head);
      const eyes = render(RULES.eyes);
      segmentation = segment.segment(head.canvas);
      const mask = segmentation.categoryMask;
      if (!mask) throw new Error('머리 영역을 찾지 못했어요. 다시 찍어 주세요.');
      head.labels = resizeLabels(mask.getAsUint8Array(), mask.width, mask.height, head.width, head.height);
      buffers.push(head.labels);
      eyes.labels = mapHeadToEyes(head);
      buffers.push(eyes.labels);
      const features = measurePhotoV05({ head, eyes, frame, points, iodPx: detectFrame.iod });
      // 개발 도구만 동기 콜백으로 화면에 그린다. 정상 분석 결과에는 버퍼가 없다.
      if (inspect) inspect({ head, eyes, frame, features });
      progress('후보를 고를 준비가 됐어요.');
      return features;
    } finally {
      try {
        segmentation?.close();
      } finally {
        for (const buffer of buffers) buffer.fill(0);
        for (const canvas of canvases) {
          canvas.width = 1;
          canvas.height = 1;
        }
        bitmap?.close();
      }
    }
  };
}

const analyze = createPhotoAnalyzer();

/** @returns {Promise<PhotoFeaturesV05>} */
export function analyzePhotoV05(blob, progress = () => {}, options = {}) {
  return analyze(blob, progress, undefined, options);
}

// 개발 화면에서만 import한다. 학생 화면에는 inspect 콜백을 연결하지 않는다.
export function analyzePhotoV05ForLab(blob, progress, inspect) {
  return analyze(blob, progress, inspect);
}
