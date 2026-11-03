import { DEFAULT_AVATAR } from '../shared/world.js';
import { matchAvatar } from '../shared/avatar-match.js';
let models;
export async function loadModels(progress) {
  if (!models) models = (async()=> {
    progress('얼굴 분석 도구를 준비하고 있어요. 첫 실행은 조금 걸려요.');
    const { FilesetResolver, FaceLandmarker, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('/wasm');
    const face = await FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 2 });
    const segment = await ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: '/models/selfie_multiclass.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false });
    return { face, segment };
  })().catch(e=>{models=null;throw e;});
  return models;
}
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const median=values=>{values.sort((a,b)=>a-b);return values[Math.floor(values.length/2)]||0;};
function colour(samples, fallback) {
  if(samples.length<15)return fallback;
  return '#'+[0,1,2].map(i=>median(samples.map(v=>v[i])).toString(16).padStart(2,'0')).join('');
}
export async function photoToAvatar(blob, progress=()=>{}, detailed=false) {
  if(blob.size>15*1024*1024)throw new Error('15MB 이하의 사진을 골라주세요.');
  if(blob.type && !blob.type.startsWith('image/'))throw new Error('사진 파일을 골라주세요.');
  const bitmap=await createImageBitmap(blob).catch(()=>{throw new Error('이 사진을 읽을 수 없어요. JPG 또는 PNG 사진으로 다시 골라주세요.');});
  try {
    const scale=Math.min(1,640/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const {face,segment}=await loadModels(progress);
    progress('얼굴·머리 모양과 색을 살펴보고 있어요.');
    await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,40)));
    const result=face.detect(canvas);
    if(result.faceLandmarks.length!==1)throw new Error(result.faceLandmarks.length?'한 사람만 나온 사진을 골라주세요.':'얼굴을 찾지 못했어요. 밝은 곳에서 정면으로 찍은 사진을 골라주세요.');
    const lm=result.faceLandmarks[0];
    const W=canvas.width,H=canvas.height;
    const distance=(a,b)=>Math.hypot((lm[a].x-lm[b].x)*W,(lm[a].y-lm[b].y)*H);
    const fw=distance(234,454),fh=distance(10,152);
    if(fw<45)throw new Error('얼굴이 조금 더 크게 나온 사진을 골라주세요.');
    const seg=segment.segment(canvas),mask=seg.categoryMask;
    const raw=mask.getAsUint8Array(), mw=mask.width,mh=mask.height;
    const pixels=ctx.getImageData(0,0,W,H).data;
    const groups={1:[],3:[],4:[]};let hairCount=0,bangs=0,accessory=0,eyePixels=0,foreheadPixels=0,regionPixels=0;const hairYs=[],rowEdges=new Map(),clothRows=new Map();
    const left=Math.min(lm[234].x,lm[454].x),right=Math.max(lm[234].x,lm[454].x),top=lm[10].y,chin=lm[152].y;
    const eyeTop=Math.min(lm[159].y,lm[386].y)-.015,eyeBottom=Math.max(lm[145].y,lm[374].y)+.015;
    for(let y=0;y<mh;y+=2)for(let x=0;x<mw;x+=2){
      const label=raw[y*mw+x], nx=x/mw,ny=y/mh;
      const p=(Math.min(H-1,Math.floor(ny*H))*W+Math.min(W-1,Math.floor(nx*W)))*4;
      const col=[pixels[p],pixels[p+1],pixels[p+2]];
      if(groups[label] && nx>left-.12 && nx<right+.12)groups[label].push(col);
      if(nx>left-.13&&nx<right+.13&&ny<chin+.25)regionPixels++;
      if(ny>top&&ny<lm[9].y&&nx>left+.02&&nx<right-.02){foreheadPixels++;if(label===1)bangs++;}
      if(label===1&&nx>left-.13&&nx<right+.13){hairYs.push(ny);hairCount++;if(ny>top&&ny<chin){const edge=rowEdges.get(y)||[x,x];rowEdges.set(y,[Math.min(x,edge[0]),Math.max(x,edge[1])]);}}
      if(label===4&&nx>left&&nx<right&&ny>chin){const row=clothRows.get(y)||[];row.push((col[0]+col[1]+col[2])/3);clothRows.set(y,row);}
      if(nx>left&&nx<right&&ny>eyeTop&&ny<eyeBottom){eyePixels++;if(label===5)accessory++;}
    }
    seg.close();
    hairYs.sort((a,b)=>a-b);const hairBottom=hairYs[Math.floor(hairYs.length*.975)]||top;
    const outline=[...rowEdges.values()],jagged=outline.slice(1).map((v,i)=>Math.min(8,Math.abs(v[0]-outline[i][0])+Math.abs(v[1]-outline[i][1])));
    const texture=jagged.length>12?clamp((jagged.reduce((n,x)=>n+x,0)/jagged.length-1.4)/3,0,1):0;
    const bands=[...clothRows.values()].filter(v=>v.length>10).map(v=>median(v));let stripeChanges=0;for(let i=3;i<bands.length-3;i+=3){const previous=bands[i]-bands[i-3],next=bands[i+3]-bands[i];if(Math.abs(previous)>25&&Math.abs(next)>25&&previous*next<0)stripeChanges++;}
    const detected=matchAvatar({skin:colour(groups[3],DEFAULT_AVATAR.skin),hair:colour(groups[1],DEFAULT_AVATAR.hair),shirt:colour(groups[4],DEFAULT_AVATAR.shirt),length:clamp((hairBottom-lm[4].y)/(Math.max(.05,chin-top)*.8),0,1),fringe:foreheadPixels?clamp(bangs/foreheadPixels*1.5,0,1):.25,texture,stripes:stripeChanges>=3,faceRatio:fw/fh,eyeRatio:(distance(159,145)+distance(386,374))/2/fw,smileRatio:distance(13,14)/fw,spacing:distance(33,263)/fw/.67,hairCoverage:hairCount/Math.max(1,regionPixels),glasses:eyePixels>0&&accessory/eyePixels>.09});
    canvas.width=canvas.height=1;
    return detailed?detected:detected.avatar;
  } finally {bitmap.close();}
}
