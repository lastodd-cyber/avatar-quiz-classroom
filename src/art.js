import { WORLD, DEFAULT_AVATAR } from '../shared/world.js';
import { drawPixelPreview, spriteSheet } from './pixel-avatar.js';
import { cleanAvatarForKind } from '../shared/world.js';
import { TEMPLATE, composeRGBA, visibleLayers, partKey, recolorLayer } from '../shared/avatar-v05.js';

let partsPromise;
let avatarParts;
const previewCache = new Map();
const PREVIEW_CACHE_LIMIT = 96;
// 여러 모양 버튼이 같은 얼굴·머리·옷색을 공유한다. 색을 입힌 부품도 재사용하며
// 64장(약 8 MiB)까지만 보관한다. 겹치는 순서와 RGBA 합성은 기존 공용 함수를 쓴다.
const coloredParts = new Map();
const COLORED_PART_CACHE_LIMIT = 64;
function coloredPart(layer, avatar) {
  const id = partKey(layer.id, avatar);
  const source = avatarParts[id];
  if (!source || !layer.recolor) return source;
  const key = JSON.stringify([id, avatar[layer.recolor],
    ['skin', 'top', 'bottom'].includes(layer.recolor) ? avatar.skin : null]);
  if (coloredParts.has(key)) {
    const pixels = coloredParts.get(key);
    coloredParts.delete(key);
    coloredParts.set(key, pixels);
    return pixels;
  }
  const pixels = recolorLayer(layer, source, avatar);
  coloredParts.set(key, pixels);
  if (coloredParts.size > COLORED_PART_CACHE_LIMIT) coloredParts.delete(coloredParts.keys().next().value);
  return pixels;
}

export function loadAvatarV05() {
  if (!partsPromise) {
    partsPromise = (async () => {
      const response = await fetch('/assets/avatars_v05/manifest.json');
      if (!response.ok) throw new Error('캐릭터 부품 목록을 읽지 못했어요.');
      const manifest = await response.json();
      const entries = await Promise.all(manifest.layers.map(async layer => {
        const img = new Image();
        img.src = layer.file;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = TEMPLATE.width;
        canvas.height = TEMPLATE.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return [layer.id, ctx.getImageData(0, 0, canvas.width, canvas.height).data];
      }));
      avatarParts = Object.fromEntries(entries);
    })().catch(error => {
      partsPromise = null;
      throw error;
    });
  }
  return partsPromise;
}

export function avatarAppearanceKey(avatar, kind = 'v02') {
  return `${kind}:${JSON.stringify(cleanAvatarForKind(avatar, kind))}`;
}

// 교실 텍스처·목록·입장 화면이 같은 원본 캔버스를 재사용한다. 오래된 미리보기만 제한한다.
export function cachedAvatarCanvas(avatar, kind = 'v02') {
  const clean = cleanAvatarForKind(avatar, kind);
  const key = avatarAppearanceKey(clean, kind);
  if (previewCache.has(key)) {
    const canvas = previewCache.get(key);
    previewCache.delete(key);
    previewCache.set(key, canvas);
    return canvas;
  }
  const canvas = document.createElement('canvas');
  if (kind === 'v05') {
    if (!avatarParts) throw new Error('캐릭터 부품을 먼저 불러와야 해요.');
    canvas.width = TEMPLATE.width;
    canvas.height = TEMPLATE.height;
    const layers = visibleLayers(clean).map(layer => coloredPart(layer, clean)).filter(Boolean);
    const pixels = new ImageData(composeRGBA(layers), TEMPLATE.width, TEMPLATE.height);
    canvas.getContext('2d').putImageData(pixels, 0, 0);
  } else {
    drawPixelPreview(canvas, clean);
  }
  previewCache.set(key, canvas);
  if (previewCache.size > PREVIEW_CACHE_LIMIT) previewCache.delete(previewCache.keys().next().value);
  return canvas;
}

export function drawAvatarForKind(canvas, avatar, kind = 'v02', scale = 1) {
  const source = cachedAvatarCanvas(avatar, kind);
  canvas.width = source.width * scale;
  canvas.height = source.height * scale;
  canvas.dataset.avatarKind = kind;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = kind === 'v05';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}
export function drawAvatar(canvas,input=DEFAULT_AVATAR,direction='down',frame=0){return drawPixelPreview(canvas,input,direction,frame);}
export function avatarCanvas(a){return drawAvatar(document.createElement('canvas'),a);}
export { spriteSheet };
let classroomBackground;
export async function loadClassroomArt(){if(classroomBackground)return;const img=new Image();img.src='/assets/classroom_pixel_v01.png';await img.decode();classroomBackground=img;}
export function drawClassroom(canvas){canvas.width=WORLD.width;canvas.height=WORLD.height;const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;c.drawImage(classroomBackground,0,0,WORLD.width,WORLD.height);return canvas;}
