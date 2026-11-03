import { HAIRS, SKIN_COLORS, HAIR_COLORS, CLOTH_COLORS } from './avatar-catalog.js';
import { DEFAULT_AVATAR, cleanAvatar } from './world.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
export function nearestColor(hex,palette){const v=rgb(hex);return [...palette].sort((a,b)=>{const dist=c=>rgb(c).reduce((n,x,i)=>n+(x-v[i])**2*[.3,.59,.11][i],0);return dist(a)-dist(b);})[0];}
export function matchAvatar(features){
 const f=features, length=clamp(f.length||0,0,1),fringe=clamp(f.fringe||0,0,1),texture=clamp(f.texture||0,0,1);
 // A frontal selfie cannot establish a hidden ponytail/bun. Offer observable silhouettes first.
 const plausible=HAIRS.filter(h=>!['pony','lowpony','twintail','bun','doublebun','braid'].includes(h.kind)&&((f.hairCoverage??1)<.015?h.kind==='bald':h.kind!=='bald'));
 const ranking=plausible.map(h=>({h,score:Math.abs(h.length-length)*3+Math.abs(h.fringe-fringe)*1.2+Math.abs(h.texture-texture)*.65})).sort((a,b)=>a.score-b.score);
 const face=f.faceRatio||.86,eye=f.eyeRatio||.045;
 // Dark/grey hair often picks up a purple cast from lighting. Do not turn that
 // slight cast into dyed hair; saturated non-natural hues remain available.
 const rawHair=f.hair||DEFAULT_AVATAR.hair,[r,g,b]=rgb(rawHair);
 const dyed=Math.max(r,g,b)-Math.min(r,g,b)>55&&((r>g*1.45&&b>g*1.35)||b>r*1.3||g>r*1.3);
 const avatar=cleanAvatar({...DEFAULT_AVATAR,skin:nearestColor(f.skin||DEFAULT_AVATAR.skin,SKIN_COLORS),hair:nearestColor(rawHair,dyed?HAIR_COLORS:HAIR_COLORS.slice(0,8)),shirt:nearestColor(f.shirt||DEFAULT_AVATAR.shirt,CLOTH_COLORS),style:ranking[0]?.h.id||0,faceShape:face>.96?2:face>.89?0:face>.81?1:3,eyeStyle:eye>.055?1:eye<.035?2:0,mouthStyle:(f.smileRatio||0)>.1?1:0,spacing:clamp(f.spacing||1,.8,1.2),eyewear:f.glasses?1:0,top:f.stripes?1:0});
 return {avatar,candidates:ranking.slice(0,3).map(({h})=>({...avatar,style:h.id})),summary:'머리 길이·앞머리·얼굴 비율과 색을 반영했어요. 안경과 옷 종류는 다듬기에서 바꿀 수 있어요. 하체는 기본 복장이에요.'};
}
