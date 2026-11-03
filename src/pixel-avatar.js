import { DEFAULT_AVATAR, cleanAvatar } from '../shared/world.js';
import { HAIRS, DIRECTIONS, LAYERS, PIXEL_SPEC } from '../shared/avatar-catalog.js';
export const tint=(hex,amount)=>'#'+[1,3,5].map(i=>{const n=parseInt(hex.slice(i,i+2),16);return Math.round(amount>0?n+(255-n)*amount:n*(1+amount)).toString(16).padStart(2,'0');}).join('');
// Integer scanlines keep the original artwork on a real pixel grid.
function painter(ctx){
 const r=(x,y,w,h,col)=>{ctx.fillStyle=col;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));};
 const p=(points,col)=>{const ys=points.map(v=>v[1]);for(let y=Math.floor(Math.min(...ys));y<Math.ceil(Math.max(...ys));y++){const xs=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if((a[1]<=y+.5&&b[1]>y+.5)||(b[1]<=y+.5&&a[1]>y+.5))xs.push(a[0]+(y+.5-a[1])*(b[0]-a[0])/(b[1]-a[1]));}xs.sort((a,b)=>a-b);for(let i=0;i<xs.length;i+=2)r(Math.ceil(xs[i]-.5),y,Math.ceil(xs[i+1]-.5)-Math.ceil(xs[i]-.5),1,col);}};
 const box=(x,y,w,h,fill,edge)=>{r(x+2,y,w-4,h,edge);r(x,y+2,w,h-4,edge);r(x+1,y+1,w-2,h-2,fill);};return {r,p,box};
}
export function paintAvatar(ctx,input=DEFAULT_AVATAR,direction='down',frame=0,onlyLayer=null){
 const a=cleanAvatar(input),k=HAIRS[a.style].kind,back=direction==='up',side=direction==='left'||direction==='right';
 const {r,p,box}=painter(ctx),O='#352e36',skin=a.skin,ss=tint(skin,-.19),sl=tint(skin,.20),hair=a.hair,hs=tint(hair,-.29),hl=tint(hair,.22),hh=tint(hair,.10),cloth=a.shirt,cs=tint(cloth,-.24),cl=tint(cloth,.22),pants=a.pants,ps=tint(pants,-.25),pl=tint(pants,.20),shoe=a.shoeColor,accent=a.accent;
 const step=frame===1?-1:frame===3?1:0,bob=frame%2?-1:0;
 ctx.save();if(direction==='left'){ctx.translate(48,0);ctx.scale(-1,1);}ctx.translate(0,bob);
 const layer=(name,draw)=>{if(!onlyLayer||name===onlyLayer)draw();};
 const long=['long','longbang','wave','shoulder','braid'].includes(k),bobbed=['bob','shortbob','partbob','wavebob','fluffy'].includes(k),tied=['pony','lowpony','twintail','bun','doublebun'].includes(k);
 layer('hairBack',()=>{
  if(k==='bald')return;
  if(long||bobbed){const end=long?43:k==='shortbob'?32:37;box(side?14:10,12,side?23:28,end-12,hair,O);r(side?15:11,19,3,end-21,hs);r(side?32:33,19,3,end-20,hs);r(side?17:14,20,2,end-22,hl);r(29,19,2,end-20,hh);if(k.includes('wave')||k==='fluffy'){for(let y=18;y<end-2;y+=6){r(9,y,3,4,O);r(10,y+1,3,3,hair);r(35,y+2,4,4,O);r(35,y+2,2,3,hl);}}if(k==='braid'){for(let y=29;y<47;y+=4){box(30-(y%8?0:1),y,6,5,hair,O);r(32,y+1,2,2,hl);}r(31,46,4,2,accent);}}
  if(tied){if(k==='pony'||k==='lowpony'){box(side?9:31,k==='pony'?12:25,9,22,hair,O);r(side?10:32,k==='pony'?15:27,2,15,hl);r(side?13:31,k==='pony'?14:26,4,2,accent);}if(k==='twintail'){for(const x of [5,35]){box(x,19,8,23,hair,O);r(x+2,23,2,14,hl);r(x,19,8,3,accent);}}if(k==='bun'||k==='doublebun'){for(const x of k==='bun'?[18]:[7,31]){box(x,4,10,10,hair,O);r(x+2,5,5,2,hl);r(x+1,12,8,2,accent);}}}
 });

 layer('legs',()=>{
  const skirt=a.bottom===3||a.bottom===4,shorts=a.bottom===2,wide=a.bottom===5,legs=side?[[20,step],[24,-step]]:[[16,step],[26,-step]];
  for(const[x,s]of legs){box(x,48,side?7:6+(wide?2:0),11+(s>0?1:0),shorts||skirt?skin:pants,O);r(x+1,49,2,7,shorts||skirt?sl:pl);if(a.bottom===6)r(x+4,48,1,9,'#ece5d0');if(a.bottom===1)r(x+1,53,4,1,tint(pants,.1));if(shorts)r(x,47,7,4,pants);}
  if(skirt){const end=a.bottom===4?57:52;p([[16,44],[32,44],[35,end],[13,end]],O);p([[17,45],[31,45],[33,end-1],[15,end-1]],pants);for(let x=18;x<=29;x+=5)p([[x,46],[x+1,46],[x+2,end-1],[x,end-1]],ps);r(18,45,12,1,pl);}else{r(side?20:16,46,side?11:16,4,pants);r(side?21:17,47,side?9:14,1,pl);r(23,49,2,5,ps);if(a.bottom===7){r(17,46,14,1,accent);r(18,48,3,3,ps);r(27,48,3,3,ps);r(18,48,3,1,pl);r(27,48,3,1,pl);}}
 });
 layer('shoes',()=>{
  for(const[x,s]of side?[[20,step],[24,-step]]:[[15,step],[26,-step]]){const y=57+(s<0?-1:0),high=a.shoes===3||a.shoes===4;box(x,y-(high?3:0),8,5+(high?3:0),shoe,O);r(x+1,y+3,6,1,a.shoes===5?ss:'#ded7c9');r(x+1,y,4,1,tint(shoe,.24));if(a.shoes===0||a.shoes===3){r(x+2,y+1,3,1,'#fff4dd');r(x+3,y-1,2,1,'#fff4dd');}if(a.shoes===2)r(x+1,y+1,6,1,tint(shoe,-.4));if(a.shoes===5){r(x+1,y,5,2,skin);r(x+3,y,1,2,shoe);}}
 });
 layer('body',()=>{
  const x=side?17:14,w=side?17:20,short=[0,1,2,3,14].includes(a.top),arm=short?skin:cloth;
  for(const[ax,s]of side?[[28,-step],[15,step]]:[[11,step],[32,-step]]){box(ax,37+s,5,12,arm,O);r(ax+1,short?39+s:46+s,3,4,skin);r(ax+1,49+s,2,1,ss);r(ax+1,37+s,3,short?5:7,cloth);r(ax+1,38+s,1,3,cl);}
  p([[x+3,34],[x+w-3,34],[x+w,38],[x+w-1,48],[x+1,48],[x,38]],O);p([[x+3,35],[x+w-3,35],[x+w-1,38],[x+w-2,47],[x+2,47],[x+1,38]],cloth);r(x+2,39,2,7,cl);r(x+w-4,39,2,7,cs);r(x+2,46,w-4,1,cs);
  if(!back){r(side?24:21,34,6,3,ss);r(side?25:22,34,4,2,skin);}const front=!back&&!side;
  if(a.top===0&&front){r(20,37,8,1,cs);r(22,38,4,1,cl);r(27,40,3,3,cl);}
  if(a.top===1)for(const y of [39,43])r(x+2,y,w-4,2,'#f2e8d5');
  if(a.top===2){r(x+2,38,w-4,6,accent);r(x+2,44,w-4,1,tint(accent,-.2));}
  if([3,6,7,10,11,12,13].includes(a.top)&&front){p([[18,35],[23,37],[21,40],[17,36]],'#f2e7d2');p([[25,37],[30,35],[31,36],[27,40]],'#f2e7d2');r(23,38,1,8,cs);for(const y of [40,43,46])r(24,y,1,1,'#ece4d3');}
  if(a.top===4){if(back){box(x+3,35,w-6,8,cs,O);r(x+4,36,w-8,2,cl);}else{r(x+4,36,w-8,2,cs);r(20,38,1,4,'#eddfc7');r(27,38,1,4,'#eddfc7');r(19,43,10,3,cs);r(20,43,8,1,cl);}}
  if(a.top===5&&front){r(21,40,6,4,accent);r(23,39,2,6,accent);r(22,41,4,2,cl);}
  if(a.top===6&&front){r(27,40,3,4,cs);r(27,40,3,1,cl);}
  if(a.top===7){for(let yy=38;yy<47;yy+=4)r(x+2,yy,w-4,1,cs);for(let xx=x+4;xx<x+w-2;xx+=4)r(xx,38,1,9,cs);}
  if(a.top===8){r(x+2,35,3,6,'#efe5d0');r(x+w-5,35,3,6,'#efe5d0');if(front){p([[20,35],[24,42],[28,35]],'#efe5d0');p([[22,35],[24,39],[26,35]],ss);}r(x+2,45,w-4,1,cl);}
  if([9,10,11].includes(a.top)&&!back){r(22,37,5,10,'#efe6d5');r(21,37,1,10,cs);r(27,37,1,10,cs);if(a.top===11){p([[18,35],[23,39],[20,42]],cl);p([[30,35],[26,39],[29,42]],cl);}if(a.top===10){r(17,40,4,3,cs);r(28,40,3,3,cs);r(17,40,4,1,cl);}}
  if(a.top===12&&front){r(23,37,2,2,accent);p([[23,39],[25,39],[26,44],[24,46],[22,44]],accent);}
  if(a.top===13&&front){p([[19,37],[24,39],[19,41]],accent);p([[29,37],[24,39],[29,41]],accent);r(23,38,2,2,tint(accent,-.2));}
  if(a.top===14){r(x+3,35,2,12,pants);r(x+w-5,35,2,12,pants);r(x+3,40,w-6,7,pants);r(x+5,41,w-10,4,pl);r(x+3,39,1,1,'#eed394');r(x+w-4,39,1,1,'#eed394');}
  if(a.top===15){for(let xx=x+3;xx<x+w-2;xx+=3)r(xx,39,1,7,cl);r(x+2,36,w-4,2,cs);}
 });
 layer('bagBack',()=>{if(a.bag!==1&&a.bag!==4)return;if(back||side){box(side?10:15,36,side?9:18,17,accent,O);r(side?11:17,38,side?3:13,3,tint(accent,.25));box(side?10:18,44,side?6:12,7,tint(accent,-.13),tint(accent,-.32));r(side?12:23,44,2,1,'#eedcaf');if(a.bag===4){r(side?10:16,39,side?7:16,2,tint(accent,-.3));r(side?12:20,41,2,5,'#e9d6a9');r(side?12:27,41,2,5,'#e9d6a9');}}});
 layer('face',()=>{
  const wide=a.faceShape===2?1:a.faceShape===3||a.faceShape===5?-1:0;
  if(side){box(15,12,20,21,skin,O);p([[31,21],[36,22],[36,25],[33,26],[33,30],[29,33],[20,32],[17,28],[17,18]],skin);r(19,15,11,2,sl);r(18,27,4,4,ss);r(26,31,5,1,ss);box(16,23,4,6,skin,ss);r(17,24,1,2,sl);}
  else{const x=12-wide,w=24+wide*2;p([[x+5,11],[x+w-5,11],[x+w-2,14],[x+w,19],[x+w,28],[x+w-4,33],[x+5,34],[x,29],[x,18],[x+2,14]],O);p([[x+5,12],[x+w-5,12],[x+w-2,15],[x+w-1,19],[x+w-1,28],[x+w-5,32],[x+5,33],[x+1,28],[x+1,19],[x+3,15]],skin);r(x+5,14,w-10,2,sl);r(x+2,23,1,5,sl);r(x+4,30,w-8,2,ss);if(a.faceShape===1){r(x+3,30,3,2,O);r(x+w-6,30,3,2,O);r(x+6,31,w-12,2,skin);}if(a.faceShape===4){r(x+2,28,2,3,skin);r(x+w-4,28,2,3,skin);}if(a.faceShape===5){r(x+5,32,w-10,1,O);r(x+6,31,w-12,1,ss);}if(!back){box(x-2,23,4,6,skin,O);r(x-1,24,2,3,ss);box(x+w-2,23,4,6,skin,O);r(x+w-1,24,2,3,ss);}}
 });
 layer('features',()=>{
  if(back)return;const eyes=side?[29]:[a.spacing<.92?18:17,a.spacing<.92?27:28],y=24;
  for(const x of eyes){r(x-1,y-3,4,1,hs);if(a.eyeStyle===3){r(x,y,2,1,O);r(x-1,y+1,1,1,O);r(x+2,y+1,1,1,O);}else if(a.eyeStyle===4)r(x-1,y+1,4,1,O);else{const ht=a.eyeStyle===2?2:a.eyeStyle===1||a.eyeStyle===5?4:3;r(x,y,2,ht,O);r(x,y,1,1,'#fff4e3');if(a.eyeStyle===5)r(x+1,y+2,1,1,'#cab493');}}
  if(!side){r(14,28,3,1,tint(skin,-.09));r(31,28,3,1,tint(skin,-.09));r(24,27,1,1,ss);}const mx=side?29:22;
  if(a.mouthStyle===1){r(mx,29,4,2,'#955e58');r(mx+1,29,2,1,'#fff0df');}else if(a.mouthStyle===2)r(mx,30,3,1,'#925d54');else if(a.mouthStyle===3){r(mx,29,4,1,'#875349');r(mx+1,30,2,1,'#c48578');}else{r(mx,29,1,1,'#976358');r(mx+1,30,2,1,'#976358');r(mx+3,29,1,1,'#976358');}
 });
 layer('hairFront',()=>{
  if(k==='bald'){if(back){r(18,16,10,1,sl);r(14,22,1,6,ss);}return;}const curly=['curl','fluffy','wave','wavebob'].includes(k);
  p([[15,8],[20,6],[29,6],[35,9],[38,14],[38,25],[34,27],[34,19],[30,16],[18,17],[14,24],[10,24],[10,15]],O);p([[15,9],[21,7],[29,7],[34,10],[37,14],[37,23],[35,24],[33,18],[30,15],[17,16],[13,22],[11,23],[11,15]],hair);p([[14,13],[19,9],[27,8],[32,10],[33,12],[22,11],[17,14]],hl);r(13,15,2,4,hh);r(35,15,2,7,hs);
  if(back){box(side?15:12,13,side?21:24,18,hair,hs);r(15,14,3,12,hh);r(21,13,2,15,hl);r(29,16,2,13,hh);for(let x=15;x<34;x+=5)r(x,28,2,3,hs);if(long||bobbed){const end=long?43:k==='shortbob'?32:36;box(11,22,26,end-22,hair,hs);for(const x of [14,20,28,33]){r(x,24,1,end-26,hh);r(x+1,end-3,1,2,hs);}r(15,23,2,7,hl);}return;}
  if(k==='crop'){r(12,14,24,3,hs);r(14,15,20,2,hair);r(11,17,3,5,hair);r(34,17,3,5,hair);return;}
  if(['bowl','bob','shortbob','longbang','twintail','doublebun'].includes(k)){p([[13,14],[34,14],[35,22],[31,22],[31,20],[29,22],[26,21],[25,23],[23,22],[22,20],[20,22],[17,21],[15,23],[12,22]],hair);for(const x of [16,21,27,32]){r(x,15,1,4,hl);r(x+1,20,1,2,hs);}r(14,14,17,1,hh);}
  else if(['part','partbob','lowpony','bun','braid'].includes(k)){p([[24,10],[24,15],[19,21],[13,23],[13,15],[17,11]],hair);p([[25,10],[31,12],[35,17],[35,22],[30,19],[27,16]],hair);p([[22,11],[23,13],[19,18],[16,19],[18,15]],hl);r(24,11,1,5,hs);r(27,14,2,2,hl);}
  else if(k==='quiff'||k==='spike'){p(k==='spike'?[[12,14],[14,5],[18,9],[21,3],[25,8],[29,4],[31,9],[36,8],[34,16]]:[[13,15],[14,8],[19,4],[28,3],[33,6],[35,13],[28,16],[19,16]],O);p([[15,13],[16,8],[22,6],[29,5],[32,8],[33,12],[28,14],[20,15]],hair);p([[17,10],[23,7],[29,7],[29,9],[22,10]],hl);}
  else if(curly){for(const[x,y]of [[12,13],[18,10],[24,10],[30,13],[15,18],[22,17],[29,18],[34,18]]){box(x-2,y-2,6,6,hair,hs);r(x-1,y-1,3,1,hl);}if(k==='fluffy'){box(8,16,5,9,hair,O);box(35,16,5,9,hair,O);}}
  else{p([[14,13],[31,12],[34,16],[27,18],[23,22],[18,23],[20,20],[15,22],[13,21]],hair);p([[16,15],[28,13],[30,14],[24,17],[19,18]],hl);r(17,20,3,1,hs);r(31,18,2,4,hair);if(k==='undercut'){r(11,22,3,3,hs);r(34,22,3,3,hs);}if(k==='shoulder'){r(12,30,3,7,hl);r(33,30,3,7,hs);r(13,37,3,2,hair);r(32,37,3,2,hair);}}
  if(side){r(14,19,5,7,hair);r(15,18,1,5,hl);r(18,25,1,3,hs);}
 });
 layer('eyewear',()=>{
  if(back||!a.eyewear)return;const col=a.eyewear===3?'#9d8060':'#45404a',y=22,positions=side?[27]:[14,25];
  for(const x of positions){const large=a.eyewear===4,w=large?10:9,ht=large?8:7;if(a.eyewear===5){box(x,y,w,ht,'#465768',O);r(x+2,y+1,3,1,'#a0bdc2');}else if(a.eyewear===2){r(x,y,w,1,col);r(x,y+ht-1,w,1,col);r(x,y,1,ht,col);r(x+w-1,y,1,ht,col);}else{r(x+2,y,w-4,1,col);r(x+2,y+ht-1,w-4,1,col);r(x,y+2,1,ht-4,col);r(x+w-1,y+2,1,ht-4,col);r(x+1,y+1,1,1,col);r(x+w-2,y+1,1,1,col);r(x+1,y+ht-2,1,1,col);r(x+w-2,y+ht-2,1,1,col);}}
  r(side?18:22,24,side?9:4,1,col);if(!side){r(12,24,2,1,col);r(34,24,2,1,col);}
 });
 layer('hat',()=>{
  const hat=a.hat;if(!hat)return;const fill=accent,shade=tint(fill,-.22),light=tint(fill,.23);
  if(hat===1){p([[12,14],[14,8],[19,5],[29,5],[35,9],[36,16]],O);p([[13,14],[15,9],[20,6],[29,6],[34,10],[35,15]],fill);r(15,9,3,4,light);r(24,6,1,8,shade);r(side?26:12,15,side?15:25,3,shade);r(side?29:15,15,side?12:19,1,light);}
  if(hat===2){p([[10,11],[15,6],[26,4],[35,7],[37,13],[32,17],[13,16]],O);p([[11,11],[16,7],[27,5],[34,8],[36,13],[31,16],[13,15]],fill);r(16,8,12,2,light);r(15,16,18,2,shade);r(25,3,2,3,O);}
  if(hat===3){box(12,5,24,15,fill,O);r(13,15,22,5,shade);for(let x=15;x<35;x+=4)r(x,8,1,7,light);r(14,16,20,1,light);box(20,1,8,6,fill,O);}
  if(hat===4){p([[15,6],[32,6],[35,15],[39,19],[9,19],[13,14]],O);p([[16,7],[31,7],[34,15],[37,18],[11,18],[15,14]],fill);r(15,13,18,3,shade);r(18,8,9,2,light);}
  if(hat===5){p([[29,9],[37,7],[37,16],[31,13],[27,16],[26,8]],O);p([[30,10],[36,9],[36,14],[31,12],[28,14],[28,10]],accent);r(30,10,2,4,tint(accent,-.2));}
  if(hat===6){r(side?29:31,17,5,2,accent);r(side?30:32,16,4,1,tint(accent,.4));}
  if(hat===7){const x=side?29:34,y=15;for(const[dx,dy]of [[-2,0],[2,0],[0,-2],[0,2]])box(x+dx,y+dy,3,3,'#f5d6c3','#ad8276');r(x+1,y+1,1,1,'#e2b852');}
  if(hat===8){r(11,14,2,15,O);r(35,14,2,15,O);r(14,10,20,2,O);box(9,21,6,9,accent,O);box(33,21,6,9,accent,O);r(11,23,2,5,tint(accent,.3));}
  if(hat===9){r(24,2,1,7,'#477353');p([[24,4],[19,4],[17,1],[21,1]],'#70995c');p([[25,4],[28,0],[32,1],[30,4]],'#a0b974');r(15,10,18,1,'#eee2b7');}
 });
 layer('bagFront',()=>{
  if(back)return;if(a.bag===1||a.bag===4){r(17,36,2,9,accent);r(29,36,2,9,accent);r(18,42,1,2,'#ede0b8');if(a.bag===4){r(19,40,10,1,accent);r(23,39,2,3,'#ede0b8');}}
  if(a.bag===2){p([[30,35],[32,36],[18,48],[16,47]],tint(accent,-.2));box(12,44,10,9,accent,O);r(13,45,8,2,tint(accent,.25));r(16,49,2,1,'#efe1bb');}
  if(a.bag===3){r(31,38,1,9,O);r(37,39,1,9,O);box(30,45,10,12,accent,O);r(32,47,5,1,tint(accent,.3));r(33,51,3,3,'#eae2c8');}
  if(a.bag===5){r(16,33,17,4,accent);r(26,36,4,9,accent);r(27,38,1,6,tint(accent,.25));r(26,44,1,2,tint(accent,-.2));r(29,44,1,2,tint(accent,-.2));}
 });ctx.restore();
}
export function pixelCanvas(avatar,direction='down',frame=0,layer=null){const c=document.createElement('canvas');c.width=48;c.height=64;paintAvatar(c.getContext('2d'),avatar,direction,frame,layer);return c;}
export function spriteSheet(avatar,layer=null){const c=document.createElement('canvas');c.width=192;c.height=256;const ctx=c.getContext('2d');for(let d=0;d<4;d++)for(let f=0;f<4;f++){ctx.save();ctx.translate(f*48,d*64);paintAvatar(ctx,avatar,DIRECTIONS[d],f,layer);ctx.restore();}return c;}
export function drawPixelPreview(canvas,avatar,direction='down',frame=0){canvas.width=144;canvas.height=192;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#475c4522';ctx.fillRect(42,180,60,6);ctx.drawImage(pixelCanvas(avatar,direction,frame),0,0,144,192);return canvas;}
export { LAYERS, PIXEL_SPEC };
