// 교실 캐릭터 템플릿 v05 — 부품 조합과 색 바꾸기 (브라우저·Node 공용, 순수 함수)
//
// 모든 부품은 같은 144×224 캔버스, 같은 좌표에 그려져 있다. 위치를 옮기지 않고 LAYERS 순서대로 겹치기만 한다.
// 머리·상의·하의(신발과 한 세트)는 모양이 여러 개다. 겹치는 자리(hairFront, upper, lower·shoes)에
// 고른 모양의 부품(hair:<id>, top:<id>, bottom:<id>·shoes:<id>)을 넣는다.
// 색은 부품을 새로 그리지 않고 밝기 → 단계 색표(어두운 색, 중간색, 밝은 색)로 바꿔서 만든다.
// 부품 그림: scripts/build-avatars-v05-base.mjs(몸·얼굴), scripts/build-avatars-v05-shapes.mjs(머리·상의·안경)

// 캔버스는 키(196)보다 넉넉하다: 위 16px·좌우 8px은 부푼 머리·묶은 머리 꼬리가 잘리지 않게 둔 여백.
export const TEMPLATE = {
  width: 144,
  height: 224,
  feet: [72, 218], // 발바닥 중앙. 게임에서 캐릭터 위치(x, y)가 이 점에 온다.
  characterHeight: 196, // 민머리 정수리~발바닥
  displayHeight: 104, // 교실 게임 좌표(1152×768)에서 그릴 키
};

// 아래에서 위로 겹치는 순서. recolor는 그 부품에 적용할 색 바꾸기 종류.
// hairFront·upper·lower·shoes 자리는 고른 머리 모양·상의 모양·하의 세트의 부품으로 채워진다(partKey).
export const LAYERS = [
  { id: 'lower', name: '하의·다리', recolor: 'bottom' },
  { id: 'shoes', name: '신발', recolor: null },
  { id: 'arms', name: '팔·손', recolor: 'skin' },
  { id: 'face', name: '얼굴 바탕', recolor: 'skin' },
  { id: 'brows', name: '눈썹', recolor: 'hair' },
  { id: 'upper', name: '상의', recolor: 'top' },
  { id: 'hairFront', name: '머리', recolor: 'hair' },
  { id: 'glasses', name: '안경', recolor: null },
];

// 색표. 값을 바꾸거나 항목을 추가하면 꾸미기 화면과 사진 매칭에서 바로 쓸 수 있다.
// hair·top·bottom: [어두운 색, 중간색, 밝은 색]. skin: 피부 중간 톤 하나(그림의 피부를 이 톤 비율로 옮긴다).
// original: true 인 항목은 그림 색을 그대로 둔다. 상의 그림은 회색 천이라 상의 'original'(검정)도 색표로 칠한다.
export const PALETTES = {
  hair: [
    { id: 'original', name: '흑갈색(원화)', original: true },
    { id: 'black', name: '검정', ramp: ['#0d0b0f', '#2a2630', '#5a5664'] },
    { id: 'chestnut', name: '밤색', ramp: ['#2a140c', '#6b3a22', '#b0744a'] },
    { id: 'lightBrown', name: '밝은 갈색', ramp: ['#4a2c16', '#9a6a3c', '#e0b07a'] },
    { id: 'blond', name: '금발', ramp: ['#6a4a1c', '#c89a48', '#f4dc98'] },
    { id: 'gray', name: '회색', ramp: ['#3a3a40', '#8a8a94', '#d6d6dc'] },
    // 염색 3가지(사진 매칭은 와인색 위주, 분홍·파랑은 학생이 직접 고를 때)
    { id: 'wine', name: '와인', ramp: ['#2a0c12', '#6a2030', '#b05068'] },
    { id: 'pink', name: '분홍', ramp: ['#5a2a3a', '#c77d95', '#f2c4d2'] },
    { id: 'blue', name: '파랑', ramp: ['#101c34', '#2e4a7a', '#7aa0d8'] },
    // 게임용 색 2가지(사진 머리색 판별에는 쓰지 않고, 알록달록 처음 모습과 직접 고르기에만)
    { id: 'green', name: '초록', ramp: ['#0e2a1a', '#2f7a4c', '#86d0a0'] },
    { id: 'purple', name: '보라', ramp: ['#20123a', '#5c3a8c', '#b49ae0'] },
  ],
  skin: [
    { id: 'original', name: '기본(원화)', original: true },
    { id: 'light', name: '밝음', tone: '#fcd6ba' },
    { id: 'medium', name: '중간', tone: '#d6a076' },
    { id: 'deep', name: '진함', tone: '#966242' },
  ],
  top: [
    { id: 'original', name: '검정', ramp: ['#0e0e12', '#26262c', '#4c4c56'] },
    { id: 'navy', name: '남색', ramp: ['#0e1630', '#24366a', '#4a64a8'] },
    { id: 'green', name: '초록', ramp: ['#0e2a1c', '#2a6a44', '#5aa678'] },
    { id: 'red', name: '빨강', ramp: ['#3a0c10', '#9a2a30', '#d8606a'] },
    { id: 'sky', name: '하늘', ramp: ['#1e3a5a', '#5a8ec0', '#a6d0f0'] },
    // 밝은 색은 그림 가장자리 외곽선을 지키는 규칙(keepEdge)과 함께 쓴다
    { id: 'white', name: '흰색', ramp: ['#9a9a9e', '#dedee0', '#ffffff'] },
    { id: 'gray', name: '회색', ramp: ['#3a3a3e', '#7c7c82', '#bdbdc2'] },
    { id: 'pink', name: '분홍', ramp: ['#7a3a4c', '#e7a1b4', '#fbd8e2'] },
    { id: 'yellow', name: '노랑', ramp: ['#7a5a12', '#e8c84a', '#fff0a8'] },
    { id: 'beige', name: '베이지', ramp: ['#6a5636', '#cdb594', '#f0e2c8'] },
    { id: 'purple', name: '보라', ramp: ['#2a1a40', '#6a4c8c', '#a890c8'] },
    { id: 'orange', name: '주황', ramp: ['#71300f', '#df7b30', '#ffc78c'] },
    { id: 'mint', name: '민트', ramp: ['#285950', '#83cbb9', '#d0f4e9'] },
  ],
  // 하의: 기본 반바지는 검정으로 그려져 있어 'original'이면 그대로, 회색으로 그린 세트는 'original'도 검정 색표로 칠한다.
  bottom: [
    { id: 'original', name: '검정', original: true, ramp: ['#0e0e12', '#26262c', '#4c4c56'] },
    { id: 'navy', name: '남색', ramp: ['#0c1226', '#1e2c52', '#43568a'] },
    { id: 'denim', name: '청색', ramp: ['#101a30', '#2c4470', '#6a88b8'] },
    { id: 'gray', name: '회색', ramp: ['#3a3a3e', '#76767c', '#b4b4ba'] },
    { id: 'beige', name: '베이지', ramp: ['#5a4a30', '#a89068', '#e0d0a8'] },
    { id: 'khaki', name: '카키', ramp: ['#303b22', '#737c4e', '#b7bd83'] },
  ],
};

// 머리 모양 14종. 새 양갈래·웨이브는 직접 선택만 가능하다.
// photoMatch: 사진 자동 매칭 후보로 쓸지 여부.
export const HAIR_STYLES = [
  { id: 'twoBlock', name: '내린 투블럭', photoMatch: true },
  { id: 'crop', name: '아주 짧은 머리', photoMatch: true },
  { id: 'sidePart', name: '옆가르마', photoMatch: true },
  { id: 'liftUp', name: '앞머리 올림', photoMatch: true },
  { id: 'centerPart', name: '가운데 가르마', photoMatch: true },
  { id: 'curlyShort', name: '짧은 곱슬', photoMatch: true },
  { id: 'bob', name: '앞머리 단발', photoMatch: true },
  { id: 'bobPart', name: '가르마 단발', photoMatch: true },
  { id: 'shoulder', name: '어깨 길이', photoMatch: true },
  { id: 'longStraight', name: '긴 생머리', photoMatch: true },
  { id: 'longBang', name: '앞머리 긴 머리', photoMatch: true },
  { id: 'ponytail', name: '묶은 머리', photoMatch: true },
  { id: 'twinTails', name: '양갈래 머리', photoMatch: false },
  { id: 'longWaves', name: '긴 웨이브', photoMatch: false },
];

// 상의 모양 12종(기본 무지 티 + 그림 생성 3회차 시트 C·D). 모두 회색 천으로 그려져 있다.
// long: 긴팔(손까지 상의 부품에 들어 있어 팔 부품을 숨긴다).
// mid: 회색 천 가운데 밝기(이 밝기가 색표 중간색이 된다). maxLum: 이 밝기 이상(흰 안감 셔츠)은 색을 바꾸지 않는다.
export const TOP_STYLES = [
  { id: 'plainTee', name: '반팔 티', mid: 0.537 },
  { id: 'stripedTee', name: '줄무늬 티', mid: 0.526 },
  { id: 'polo', name: '카라 티', mid: 0.527 },
  { id: 'knitVest', name: '니트 조끼', mid: 0.418, maxLum: 0.48 },
  { id: 'hoodie', name: '후드티', mid: 0.517, long: true },
  { id: 'cardigan', name: '가디건', mid: 0.517, maxLum: 0.62, long: true },
  { id: 'blazer', name: '교복 재킷', mid: 0.47, maxLum: 0.53, long: true },
  { id: 'paddedJacket', name: '패딩', mid: 0.49, long: true },
  { id: 'checkShirt', name: '체크 셔츠', mid: 0.448 },
  { id: 'raglanTee', name: '래글런 티', mid: 0.546, maxLum: 0.75 },
  { id: 'sailorBlouse', name: '세일러 블라우스', mid: 0.536, maxLum: 0.75 },
  { id: 'varsityJacket', name: '야구 점퍼', mid: 0.471, maxLum: 0.75, long: true },
];

// 하의+신발 세트 8종(기본 반바지 + 시트 E 6세트 + 시트 H 롱치마). 신발은 하의와 묶어서 고른다.
// 부품은 bottom:<id>(다리·하의·양말)와 shoes:<id>(신발) 두 장. 신발은 색을 바꾸지 않는다.
// short: 꾸미기 화면 버튼에 쓰는 짧은 이름(신발은 그림으로 보인다).
// black: 검정으로 그린 기본 반바지(색 바꾸기 규칙 RULES.bottom). 나머지는 회색 천(mid는 상의와 같은 뜻, 흰 양말은 0.68 이상이라 그대로).
export const BOTTOM_STYLES = [
  { id: 'shorts', name: '반바지·운동화', short: '반바지', black: true },
  { id: 'slacks', name: '교복 바지·로퍼', short: '교복 바지', mid: 0.361 },
  { id: 'joggers', name: '조거 바지·운동화', short: '조거 바지', mid: 0.426 },
  { id: 'jeans', name: '일자 바지·캔버스화', short: '일자 바지', mid: 0.408 },
  { id: 'widePants', name: '와이드 바지·슬립온', short: '와이드 바지', mid: 0.439 },
  { id: 'pleatedSkirt', name: '주름 치마·구두', short: '주름 치마', mid: 0.434 },
  { id: 'aLineSkirt', name: 'A라인 치마·운동화', short: 'A라인 치마', mid: 0.443 },
  { id: 'longSkirt', name: '롱치마·운동화', short: '롱치마', mid: 0.488 },
];

// 안경 있음/없음은 기존 glasses로 유지한다. 모양을 저장하지 않은 예전 설정은 동그란 테다.
export const GLASSES_STYLES = [
  { id: 'round', name: '동그란 테' },
  { id: 'square', name: '사각 테' },
  { id: 'bold', name: '검정 뿔테' },
  { id: 'metal', name: '금속 테' },
];

export const DEFAULT_HAIR_STYLE = HAIR_STYLES[0].id;
export const DEFAULT_TOP_STYLE = TOP_STYLES[0].id;
export const DEFAULT_BOTTOM_STYLE = BOTTOM_STYLES[0].id;
export const DEFAULT_GLASSES_STYLE = GLASSES_STYLES[0].id;

// hairStyle·topStyle·bottomStyle·glassesStyle은 선택 항목이다. 없으면 첫 모양(DEFAULT_*_STYLE)으로 그린다.
export const DEFAULT_AVATAR_V05 = {
  hair: 'original',
  skin: 'original',
  top: 'original',
  bottom: 'original',
  glasses: false,
};

// 그림 피부의 중간 톤(기본 캐릭터에서 잰 값). skin 색표는 이 값과의 비율로 적용한다.
const SOURCE_SKIN = [252, 193, 158];
// 색 바꾸기 대상 밝기 범위. 이 범위 밖은 색표의 끝 색으로 고정된다.
const RULES = {
  hair: { lo: 0.05, hi: 0.5 },
  top: { lo: 0.04, span: 0.25, keepEdge: true }, // 밝기 lo → 어두운 색, mid → 중간색, mid + span → 밝은 색
  // 검정 반바지만(발바닥 위 42px까지). 다리 외곽선과 양말은 그대로 둔다.
  bottom: { lo: 0.02, hi: 0.3, maxLum: 0.3, maxY: TEMPLATE.feet[1] - 42, keepEdge: true },
  // 회색으로 그린 하의 세트: 상의와 같은 방식. 흰 양말은 maxLum 이상이라 그대로 남는다.
  bottomGray: { lo: 0.04, span: 0.25, keepEdge: true },
};

export function hexToRgb(hex) {
  return [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
}

function luminance(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function isSkin(r, g, b) {
  return luminance(r, g, b) > 0.42 && r > g && g > b && r - b > 40;
}

function sampleRamp(ramp, t) {
  t = Math.max(0, Math.min(1, t));
  const k = t < 0.5 ? 0 : 1;
  const u = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  return [0, 1, 2].map(c => ramp[k][c] + (ramp[k + 1][c] - ramp[k][c]) * u);
}

// 밝기를 색표로 옮긴다. 명암(머리카락 결, 옷 주름)은 밝기 차이로 남는다.
// 그림 가장자리의 어두운 외곽선 픽셀: 1px 안에 투명(또는 캔버스 밖)이 있는 아주 어두운 픽셀.
// 흰색·노랑 같은 밝은 색으로 바꿔도 테두리가 남게 그대로 둔다.
const EDGE_MAX_LUM = 0.14;
function isEdge(rgba, width, height, i) {
  const x = i % width;
  const y = (i - x) / width;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) return true;
      if (rgba[(yy * width + xx) * 4 + 3] < 128) return true;
    }
  }
  return false;
}

// mid가 있으면 밝기 lo~mid를 색표 앞 절반, mid~mid+span을 뒤 절반에 맞춘다(회색 천의 주된 밝기 = 중간색).
function applyRamp(rgba, width, rampHex, { lo, hi, mid, span, maxLum = Infinity, maxY = Infinity, keepEdge = false, skinSource = rgba }) {
  const ramp = rampHex.map(hexToRgb);
  const out = new Uint8ClampedArray(rgba);
  const height = rgba.length / 4 / width;
  const toT = mid === undefined
    ? l => (l - lo) / (hi - lo)
    : l => (l < mid ? 0.5 * (l - lo) / (mid - lo) : 0.5 + 0.5 * (l - mid) / span);
  for (let p = 0; p < out.length; p += 4) {
    if (!out[p + 3]) continue;
    const y = Math.floor(p / 4 / width);
    const l = luminance(out[p], out[p + 1], out[p + 2]);
    if (y > maxY || l >= maxLum) continue;
    if (keepEdge && l < EDGE_MAX_LUM && isEdge(rgba, width, height, p / 4)) continue;
    if (Number.isFinite(maxLum) && isSkin(skinSource[p], skinSource[p + 1], skinSource[p + 2])) continue;
    const c = sampleRamp(ramp, toT(l));
    out[p] = c[0];
    out[p + 1] = c[1];
    out[p + 2] = c[2];
  }
  return out;
}

function shiftSkin(rgba, toneHex) {
  const tone = hexToRgb(toneHex);
  const factor = tone.map((v, k) => v / SOURCE_SKIN[k]);
  const out = new Uint8ClampedArray(rgba);
  for (let p = 0; p < out.length; p += 4) {
    if (!out[p + 3] || !isSkin(out[p], out[p + 1], out[p + 2])) continue;
    for (let c = 0; c < 3; c++) out[p + c] = out[p + c] * factor[c];
  }
  return out;
}

export function findPalette(group, id) {
  return PALETTES[group].find(item => item.id === id) || PALETTES[group][0];
}

export function findHairStyle(id) {
  return HAIR_STYLES.find(style => style.id === id) || HAIR_STYLES[0];
}

export function findTopStyle(id) {
  return TOP_STYLES.find(style => style.id === id) || TOP_STYLES[0];
}

export function findBottomStyle(id) {
  return BOTTOM_STYLES.find(style => style.id === id) || BOTTOM_STYLES[0];
}

export function findGlassesStyle(id) {
  return GLASSES_STYLES.find(style => style.id === id) || GLASSES_STYLES[0];
}

// 겹치는 자리 → 실제 부품 이름. 머리·상의는 고른 모양의 부품, 나머지는 자리 이름 그대로.
export function partKey(layerId, avatar = DEFAULT_AVATAR_V05) {
  if (layerId === 'hairFront') return `hair:${findHairStyle(avatar.hairStyle).id}`;
  if (layerId === 'upper') return `top:${findTopStyle(avatar.topStyle).id}`;
  if (layerId === 'lower') return `bottom:${findBottomStyle(avatar.bottomStyle).id}`;
  if (layerId === 'shoes') return `shoes:${findBottomStyle(avatar.bottomStyle).id}`;
  if (layerId === 'glasses') return `glasses:${findGlassesStyle(avatar.glassesStyle).id}`;
  return layerId;
}

// 부품 이름 → parts 폴더 안 파일 경로 (hair:bob → hair/bob.png)
export function partFile(key) {
  return `${key.replace(':', '/')}.png`;
}

// 모양을 고르는 자리(부품 이름이 모양마다 다름)
const SHAPED = new Set(['hairFront', 'upper', 'lower', 'shoes', 'glasses']);

// 부품 이름 전체(manifest에 있어야 하는 것): 몸·얼굴 부품 + 하의 세트(하의·신발) + 상의 모양 + 머리 모양
export function allPartKeys() {
  return [
    ...LAYERS.filter(layer => !SHAPED.has(layer.id)).map(layer => layer.id),
    ...BOTTOM_STYLES.flatMap(style => [`bottom:${style.id}`, `shoes:${style.id}`]),
    ...TOP_STYLES.map(style => `top:${style.id}`),
    ...HAIR_STYLES.map(style => `hair:${style.id}`),
    ...GLASSES_STYLES.map(style => `glasses:${style.id}`),
  ];
}

// 부품 이름 → 겹치는 자리 (manifest의 recolor를 정할 때 쓴다)
export function layerOfPart(key) {
  const prefix = key.split(':')[0];
  const id = { hair: 'hairFront', top: 'upper', bottom: 'lower', shoes: 'shoes', glasses: 'glasses' }[prefix] || key;
  return LAYERS.find(layer => layer.id === id);
}

// 부품 하나에 아바타 설정의 색을 입힌다. 원화 색(original)이면 같은 배열을 그대로 돌려준다.
export function recolorLayer(layer, rgba, avatar, width = TEMPLATE.width) {
  if (!layer.recolor) return rgba;
  const skin = findPalette('skin', avatar.skin);
  if (layer.recolor === 'skin') return skin.original ? rgba : shiftSkin(rgba, skin.tone);
  if (layer.recolor === 'bottom') {
    // 하의 부품에는 다리 피부와 양말도 들어 있다.
    const style = findBottomStyle(avatar.bottomStyle);
    const bottom = findPalette('bottom', avatar.bottom);
    let out = skin.original ? rgba : shiftSkin(rgba, skin.tone);
    if (style.black) {
      if (!bottom.original) out = applyRamp(out, width, bottom.ramp, { ...RULES.bottom, skinSource: rgba });
    } else {
      out = applyRamp(out, width, bottom.ramp, { ...RULES.bottomGray, mid: style.mid, maxLum: style.maxLum ?? 0.68, skinSource: rgba });
    }
    return out;
  }
  if (layer.recolor === 'top') {
    // 긴팔 상의 부품에는 손 피부도 들어 있다. 흰 안감은 maxLum 이상이라 그대로 남는다.
    const style = findTopStyle(avatar.topStyle);
    const top = findPalette('top', avatar.top);
    let out = skin.original ? rgba : shiftSkin(rgba, skin.tone);
    if (!top.original) out = applyRamp(out, width, top.ramp, { ...RULES.top, mid: style.mid, maxLum: style.maxLum ?? 1.01, skinSource: rgba });
    return out;
  }
  const choice = findPalette(layer.recolor, avatar[layer.recolor]);
  return choice.original ? rgba : applyRamp(rgba, width, choice.ramp, RULES[layer.recolor]);
}

// 보이는 자리만 고른다. 안경은 avatar.glasses가 true일 때만, 팔은 긴팔 상의면 뺀다. hidden에 id를 넣으면 검수용으로 숨긴다.
export function visibleLayers(avatar, hidden = []) {
  const long = findTopStyle(avatar.topStyle).long;
  return LAYERS.filter(layer => !hidden.includes(layer.id)
    && (layer.id !== 'glasses' || avatar.glasses === true)
    && (layer.id !== 'arms' || !long));
}

// 같은 크기의 RGBA 부품들을 원본 위치 그대로 겹친다(source-over, 비곱셈 알파).
export function composeRGBA(rgbaLayers, width = TEMPLATE.width, height = TEMPLATE.height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (const src of rgbaLayers) {
    for (let p = 0; p < out.length; p += 4) {
      const a = src[p + 3] / 255;
      if (!a) continue;
      const b = out[p + 3] / 255;
      const oa = a + b * (1 - a);
      for (let c = 0; c < 3; c++) out[p + c] = (src[p + c] * a + out[p + c] * b * (1 - a)) / oa;
      out[p + 3] = oa * 255;
    }
  }
  return out;
}

// parts: { [부품 이름]: Uint8ClampedArray(RGBA) } → 아바타 한 명의 완성 RGBA.
export function composeAvatar(parts, avatar = DEFAULT_AVATAR_V05, hidden = []) {
  const layers = visibleLayers(avatar, hidden)
    .map(layer => ({ layer, rgba: parts[partKey(layer.id, avatar)] }))
    .filter(item => item.rgba);
  return composeRGBA(layers.map(({ layer, rgba }) => recolorLayer(layer, rgba, avatar)));
}

// 알록달록한 처음 모습: 실제 머리색·옷색은 검정·남색이 대부분이라 교실이 단조로워진다.
// 사진으로는 머리 모양·안경을 닮게 하고, 색과 옷은 학생마다 무작위로 골라 교실에 여러 색이 섞이게 한다.
// 성별은 묻거나 추측하지 않는다. 머리 모양이 단발·긴 머리·묶은 머리일 때만 치마·세일러 블라우스도 가끔 섞고,
// 짧은 머리(사진 없이 들어온 학생 포함)에는 주지 않는다. 마음에 안 들면 다른 후보나 꾸미기 화면에서 고른다.
export const COLORFUL = {
  hair: ['pink', 'blue', 'green', 'purple', 'wine', 'blond', 'lightBrown', 'gray'], // 4번 중 3번은 이 중에서
  hairNatural: ['original', 'black', 'chestnut'],
  top: ['red', 'yellow', 'sky', 'green', 'pink', 'purple', 'orange', 'mint', 'white', 'navy'],
  bottom: ['original', 'navy', 'denim', 'gray', 'beige', 'khaki'],
  hairStyles: ['twoBlock', 'crop', 'sidePart', 'liftUp', 'centerPart', 'curlyShort'], // 사진이 없을 때만
  topStyles: TOP_STYLES.map(style => style.id).filter(id => id !== 'sailorBlouse'),
  bottomStyles: ['shorts', 'slacks', 'joggers', 'jeans', 'widePants'],
  longHair: ['bob', 'bobPart', 'shoulder', 'longStraight', 'longBang', 'ponytail', 'twinTails', 'longWaves'],
  skirts: ['pleatedSkirt', 'aLineSkirt', 'longSkirt'], // 긴 머리일 때 하의 후보에 더함(8개 중 3개)
  longHairTops: ['sailorBlouse'], // 긴 머리일 때 상의 후보에 더함
};

// base에 준 머리 모양·안경·피부는 그대로 두고 나머지를 무작위로 고른다. rand는 0 이상 1 미만을 돌려주는 함수.
export function colorfulAvatarV05(base = {}, rand = Math.random) {
  const pick = list => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  const hairStyle = base.hairStyle ?? pick(COLORFUL.hairStyles);
  const longHair = COLORFUL.longHair.includes(hairStyle);
  return cleanAvatarV05({
    ...DEFAULT_AVATAR_V05,
    hairStyle,
    hair: rand() < 0.75 ? pick(COLORFUL.hair) : pick(COLORFUL.hairNatural),
    top: pick(COLORFUL.top),
    topStyle: pick(longHair ? [...COLORFUL.topStyles, ...COLORFUL.longHairTops] : COLORFUL.topStyles),
    bottom: pick(COLORFUL.bottom),
    bottomStyle: pick(longHair ? [...COLORFUL.bottomStyles, ...COLORFUL.skirts] : COLORFUL.bottomStyles),
    skin: base.skin ?? DEFAULT_AVATAR_V05.skin,
    glasses: base.glasses === true,
    ...(base.glassesStyle ? { glassesStyle: base.glassesStyle } : {}),
  });
}

// 설정값 정리: 모르는 색 id는 원화 색으로 돌린다. 서버·클라이언트 양쪽에서 같은 규칙을 쓴다.
export function cleanAvatarV05(value) {
  const a = value && typeof value === 'object' ? value : {};
  const out = { ...DEFAULT_AVATAR_V05 };
  for (const group of ['hair', 'skin', 'top', 'bottom']) {
    if (typeof a[group] === 'string' && PALETTES[group].some(item => item.id === a[group])) out[group] = a[group];
  }
  // 모양: 알려진 id일 때만 남기고, 기본 모양은 적지 않는다(예전 저장값의 'messy'는 기본 모양이 된다).
  if (typeof a.hairStyle === 'string' && a.hairStyle !== DEFAULT_HAIR_STYLE && HAIR_STYLES.some(style => style.id === a.hairStyle)) {
    out.hairStyle = a.hairStyle;
  }
  const retiredTops = { pocketTee: 'plainTee', schoolShirt: 'polo', sweatshirt: 'hoodie', trackJacket: 'hoodie' };
  const topStyle = typeof a.topStyle === 'string' && Object.hasOwn(retiredTops, a.topStyle) ? retiredTops[a.topStyle] : a.topStyle;
  if (typeof topStyle === 'string' && topStyle !== DEFAULT_TOP_STYLE && TOP_STYLES.some(style => style.id === topStyle)) {
    out.topStyle = topStyle;
  }
  if (typeof a.bottomStyle === 'string' && a.bottomStyle !== DEFAULT_BOTTOM_STYLE
    && BOTTOM_STYLES.some(style => style.id === a.bottomStyle)) {
    out.bottomStyle = a.bottomStyle;
  }
  if (typeof a.glasses === 'boolean') out.glasses = a.glasses;
  if (typeof a.glassesStyle === 'string' && a.glassesStyle !== DEFAULT_GLASSES_STYLE
    && GLASSES_STYLES.some(style => style.id === a.glassesStyle)) {
    out.glassesStyle = a.glassesStyle;
  }
  return out;
}
