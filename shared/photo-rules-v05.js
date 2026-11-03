// 모든 수치와 판별 범위는 [초안]. 실제 사진의 보정·시험을 통과한 값이 아니다.
export const RULES = {
  input: { maxBytes: 15 * 1024 * 1024, detectorMax: 640 },
  head: { width: 448, height: 448, pxPerIod: 64, originX: 224, originY: 170 },
  eyes: { width: 256, height: 128, pxPerIod: 96, originX: 128, originY: 58 },
  quality: {
    minIod: 40, yawWarn: 0.15, yawError: 0.30, rollWarn: 25, mouthWarn: 0.12,
    dark: 0.04, bright: 0.8, backlight: 3, hat: 0.3, sunglasses: 0.35,
    hatHalf: 1, hatTop: -2.4, accessoryHalf: 1.1, accessoryY: [-0.2, 0.48],
  },
  measure: {
    sideInner: -0.15, sideOuter: 1.3, bottomQuantile: 0.97, topQuantile: 0.02,
    shoulderInner: 0.6, shoulderOuter: 1.4, shoulderFallback: 0.6, shoulderMargin: 0.4,
    bandInner: -0.1, bandOuter: 0.35, bandTop: 0.15, bandBottom: 0.75,
    foreheadHalf: 0.7, foreheadTop: -0.9, browMargin: 0.05, fringeLow: 0.35,
    topHalf: 0.8, minRun: 3, topTouchColumns: 5, validFraction: 0.9,
    ear: -0.45, jaw: 0.1, longMargin: 0.15,
  },
  weights: { len: [3, 0.3], fringe: [2, 0.2], side: [1.5, 0.2],
    volSide: [1, 0.15], volTop: [0.6, 0.3] },
  match: { tie: 1e-9, similar: 0.5, centerGap: 0.3, asym: 0.35, curly: 1.35, curlyFirst: 1.45 },
  calibration: { lengthWeights: [1.5, 2.25, 3, 3.75, 4.5] },
  white: {
    reference: '#e6dcd6', minEye: 20, eyeOpen: 0.06, brightFraction: 0.4, agreement: 0.03,
    gainMin: 0.8, gainMax: 1.25, exposureMin: 0.6, exposureMax: 1.6,
    irisScale: 1.15, skinHueMin: 20, skinHueMax: 90,
  },
  color: {
    hairMin: 150, topMin: 300, maxSamples: 3000, erosion: 2, skinMargin: 3,
    trimLow: 0.2, trimHigh: 0.8, highlightHigh: 0.95, topStart: 1.35, topHalf: 3,
    dyeChroma: 0.06, dyeShare: 0.6, naturalHue: [30, 100], redHue: [30, 330],
    blueHue: [200, 300], dyeLight: 0.5, grayChroma: 0.025, grayLight: 0.5,
    hairBounds: [0.24, 0.31, 0.42, 0.60], warmHighlight: 0.03, blondB: 0.04,
    boundary: 0.03, neutralChroma: 0.035, whiteLight: 0.8, grayTopLight: 0.45,
    navyChroma: 0.025, navyHue: [220, 300], clusters: 3, iterations: 8,
    lightWeight: 0.7, seeds: [0.1, 0.5, 0.9], minShare: 0.08, secondaryShare: 0.25,
    secondaryDistance: 0.15,
  },
  glasses: {
    hi: 0.55, lo: 0.30, excludeMargin: 0.05, minCoverage: 0.5, noiseFloor: 0.008,
    bridgeX: 0.12, bridgeY: [-0.18, 0.08], lowX: [0.2, 0.8], lowY: [0.22, 0.48],
    outerX: [0.85, 1.05], outerY: [-0.2, 0.25], cheekX: [0.3, 0.7], cheekY: [0.58, 0.72],
    weights: [0.45, 0.35, 0.2], segmentFraction: 0.08, segmentBonus: 0.15,
    bilateralMin: 0.15, normalization: 3,
  },
};

export const EYE_LOOPS = [
  [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
];
export const BROW_LOOPS = [
  [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
];
export const BROW_TOP = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300];

// null은 해당 방향 제한 없음. 어깨 상대 범위는 함수로 계산한다.
export const HAIR_RULES = [
  { id: 'messy', name: '덮은 머리', len: [-1, 0], fringe: [0.55, null], side: [0.25, 0.8],
    volSide: [1.15, 1.5], volTop: [0.4, null] },
  { id: 'crop', name: '아주 짧은 머리', len: [null, -0.45], fringe: [null, 0.35],
    side: [null, 0.2], volSide: [null, 1.15], volTop: [null, 0.45] },
  { id: 'twoBlock', name: '내린 투블럭', len: [null, -0.45], fringe: [0.4, null],
    side: [null, 0.25], volSide: [1, 1.3], volTop: [0.3, 0.9] },
  { id: 'liftUp', name: '앞머리 올림', len: [null, -0.3], fringe: [null, 0.15],
    side: [null, 0.35], volTop: [0.35, null] },
  { id: 'sidePart', name: '옆가르마 짧은 머리', len: [-0.8, 0.1],
    fringe: [0.15, 0.6], side: [0.15, 0.6] },
  { id: 'centerPart', name: '가운데 가르마', len: [-0.8, 0.1],
    fringe: [0.15, 0.6], side: [0.2, 0.7] },
  { id: 'bob', name: '앞머리 단발', len: s => [-0.45, s + 0.15],
    fringe: [0.55, null], side: [0.5, null] },
  { id: 'bobPart', name: '가르마 단발', len: s => [-0.45, s + 0.15],
    fringe: [null, 0.55], side: [0.5, null] },
  { id: 'shoulder', name: '어깨 길이 머리', len: s => [s - 0.15, s + 0.35], side: [0.4, null] },
  { id: 'longStraight', name: '긴 생머리', len: s => [s + 0.15, null],
    fringe: [null, 0.55], side: [0.35, null] },
  { id: 'longBang', name: '앞머리 긴 생머리', len: s => [s + 0.15, null],
    fringe: [0.55, null], side: [0.35, null] },
  { id: 'ponytail', name: '묶은 머리', len: [null, 0.1], side: [null, 0.15], volSide: [null, 1.2] },
  { id: 'curlyShort', name: '짧은 곱슬·펌', len: s => [null, s + 0.15], volSide: [1.35, null] },
];

export const PHOTO_PALETTES = {
  hair: [
    ['black', '검정', '#1a1714'], ['original', '흑갈색', '#2e221c'],
    ['chestnut', '밤색', '#4e3222'], ['lightBrown', '밝은 갈색', '#7a5638'],
    ['blond', '금발', '#b8955e'], ['gray', '회색', '#8e8a88'],
    ['wine', '와인', '#5a2028'], ['pink', '분홍', '#c77d95'], ['blue', '파랑', '#2e4a7a'],
  ].map(([id, name, photoRef]) => ({ id, name, photoRef })),
  top: [
    ['original', '검정', '#1e1e22'], ['navy', '남색', '#1f2a44'], ['green', '초록', '#3f7a52'],
    ['red', '빨강', '#b0303a'], ['sky', '하늘색', '#8db8dc'], ['white', '흰색', '#e8e8e6'],
    ['gray', '회색', '#8c8c90'], ['pink', '분홍', '#e7a1b4'], ['yellow', '노랑', '#e8c84a'],
    ['beige', '베이지', '#cdb594'], ['purple', '보라', '#6a4c8c'],
    ['orange', '주황', '#df7b30'], ['mint', '민트', '#83cbb9'],
  ].map(([id, name, photoRef]) => ({ id, name, photoRef })),
};

export const REASONS = {
  messy: '앞머리가 이마를 덮고 옆머리가 귀를 살짝 덮어서',
  crop: '앞머리와 옆머리가 모두 짧아서',
  twoBlock: '옆머리는 짧고 앞머리는 내려서',
  liftUp: '이마가 보이고 윗머리가 올라와서',
  sidePart: '이마가 일부 보이는 짧은 머리여서',
  centerPart: '이마가 일부 보이는 가르마 머리여서',
  bob: '앞머리가 있는 턱 길이 단발에 가까워서',
  bobPart: '앞머리 없이 턱 길이 단발에 가까워서',
  shoulder: '머리 끝이 어깨에 가까워서',
  longStraight: '머리가 어깨 아래까지 내려와서',
  longBang: '앞머리가 있고 머리가 어깨 아래까지 와서',
  ponytail: '옆머리가 짧게 보여 묶은 모습도 준비했어요',
  curlyShort: '머리 옆부분이 풍성하게 보여서',
  alternative: '비슷한 머리 모양의 다른 후보예요',
  available: '현재 준비된 머리 그림으로 보여 드려요',
  hair: name => `머리색이 ${name}에 가까워서`,
  top: name => `윗옷이 ${name}으로 보여서`,
  glassesUnknown: '안경이 잘 안 보여서 다른 모습도 준비했어요',
  glassesYes: '양쪽 안경테가 보여서',
};

export const NOTES = {
  shoulderHidden: '어깨가 안 보여서 머리 길이는 짐작했어요',
  topHidden: '머리 윗부분이 잘려서 부피는 짐작했어요',
  hairUnknown: '머리가 잘 안 보여서 모양은 직접 확인해 주세요',
  topUnknown: '옷이 잘 안 보여서 기본 옷으로 했어요',
  colorUnknown: '머리색이 잘 안 보여서 기본 색으로 했어요',
  whiteNone: '조명 때문에 색이 조금 다를 수 있어요',
  yaw: '정면을 봐 주세요',
  roll: '고개를 똑바로 하고 찍으면 더 잘 보여요',
  light: '밝은 곳에서 찍어 주세요',
  backlight: '창문을 바라보고 찍어 주세요',
  hat: '모자나 후드를 벗고 찍으면 머리가 잘 보여요',
  mouth: '입을 가볍게 다물고 찍어 주세요',
  sunglasses: '눈이 어둡게 보여 안경 여부를 확인해 주세요',
  similar: '비슷한 머리 후보가 있어요. 직접 골라 주세요',
  limited: '준비된 그림과 색이 적어 후보 수가 적을 수 있어요',
  unavailable: '사진에 가까운 머리 그림이 아직 준비되지 않았어요',
};
