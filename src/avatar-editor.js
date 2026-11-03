import { drawAvatar, drawAvatarForKind, cachedAvatarCanvas } from './art.js';
import {
  cleanAvatarV05, PALETTES, HAIR_STYLES, TOP_STYLES, BOTTOM_STYLES, GLASSES_STYLES,
  DEFAULT_AVATAR_V05, DEFAULT_HAIR_STYLE, DEFAULT_TOP_STYLE, DEFAULT_BOTTOM_STYLE, DEFAULT_GLASSES_STYLE,
} from '../shared/avatar-v05.js';
import { skinSwatchesV05 } from './photo-result-v05.js';
import { cleanAvatar, DEFAULT_AVATAR } from '../shared/world.js';
import { CATALOG, SKIN_COLORS, HAIR_COLORS, CLOTH_COLORS, PANTS_COLORS, DIRECTIONS, randomAvatar } from '../shared/avatar-catalog.js';

const LABELS={hair:'머리',faceShape:'얼굴형',eyeStyle:'눈',mouthStyle:'입',top:'상의',bottom:'하의',shoes:'신발',eyewear:'안경',hat:'머리 장식',bag:'가방·목도리'};
const COLORS={skin:['피부색',SKIN_COLORS],hair:['머리색',HAIR_COLORS],shirt:['상의 색',CLOTH_COLORS],pants:['하의 색',PANTS_COLORS],shoeColor:['신발 색',CLOTH_COLORS],accent:['장식 색',CLOTH_COLORS]};
const keysFor={hair:['hair'],faceShape:['skin'],eyeStyle:['skin'],mouthStyle:['skin'],top:['shirt','accent'],bottom:['pants'],shoes:['shoeColor'],eyewear:['hair'],hat:['accent'],bag:['accent']};
export function openAvatarEditor({avatar,candidates=[],dialog,onSave}){
 const original=cleanAvatar(avatar);let draft={...original},tab='hair',direction='down',walking=true,timer;
 const d=dialog('나의 작은 캐릭터',`<p class="muted editor-intro">사진으로 고른 모습에서 원하는 부분만 바꿔보세요. 모든 옷과 머리가 함께 움직여요.</p><div class="wardrobe"><section class="wardrobe-preview"><div class="pixel-pedestal"><canvas id="edit-avatar" aria-label="선택한 캐릭터 미리보기"></canvas></div><div class="direction-controls" aria-label="보는 방향">${['앞','왼쪽','오른쪽','뒤'].map((name,i)=>`<button type="button" data-direction="${DIRECTIONS[i]}" aria-pressed="${i===0}">${name}</button>`).join('')}</div><label class="check walk-check"><input type="checkbox" id="preview-walk" checked> 걷는 모습 보기</label><div class="editor-actions"><button type="button" id="random-avatar" class="button light">새 조합</button><button type="button" id="restore-avatar" class="button light">원래 모습</button></div><button type="button" id="download-avatar" class="text-button tiny">캐릭터 PNG 저장</button>${candidates.length?'<div class="photo-alternatives"><p>사진에서 고른 머리 후보</p><div id="photo-alternatives"></div></div>':''}</section><section class="wardrobe-parts"><nav class="part-tabs" aria-label="꾸밀 부위">${Object.entries(LABELS).map(([key,label])=>`<button type="button" data-tab="${key}" aria-pressed="${key===tab}">${label} <small>${CATALOG[key].length}</small></button>`).join('')}</nav><div class="part-title"><h3 id="part-title"></h3><span id="part-count"></span></div><div id="part-grid" class="part-grid"></div><div id="part-colors"></div></section></div><div class="editor-footer"><span>저장하기 전에는 현재 모습이 바뀌지 않아요.</span><button type="button" class="button primary" id="save-avatar">이 모습으로 할게요</button></div>`);
 d.classList.add('avatar-dialog');const $=s=>d.querySelector(s);
 function preview(){drawAvatar($('#edit-avatar'),draft,direction,walking?Math.floor(performance.now()/160)%4:0);}
 function thumbnails(){const key=tab==='hair'?'style':tab;for(const c of d.querySelectorAll('[data-part-canvas]'))drawAvatar(c,{...draft,[key]:Number(c.dataset.partCanvas)},'down');for(const b of d.querySelectorAll('[data-part]'))b.setAttribute('aria-pressed',String(Number(b.dataset.part)===draft[key]));$('#part-title').textContent=CATALOG[tab].find(x=>x.id===draft[key]).name;}
 function render(){
  const key=tab==='hair'?'style':tab;$('#part-count').textContent=CATALOG[tab].length+'가지';
  $('#part-grid').innerHTML=CATALOG[tab].map(part=>`<button type="button" class="part-option" data-part="${part.id}" aria-pressed="${draft[key]===part.id}" title="${part.name}"><canvas data-part-canvas="${part.id}" aria-hidden="true"></canvas><span>${part.name}</span></button>`).join('');
  $('#part-colors').innerHTML=keysFor[tab].map(color=>`<div class="color-row"><span>${COLORS[color][0]}</span><div class="swatches">${COLORS[color][1].map((hex,i)=>`<button type="button" class="swatch" style="--swatch:${hex}" data-color="${color}" data-hex="${hex}" aria-label="${COLORS[color][0]} ${i+1}" aria-pressed="${draft[color]===hex}"></button>`).join('')}<label class="custom-color" title="직접 색 고르기"><input type="color" data-custom-color="${color}" value="${draft[color]}" aria-label="${COLORS[color][0]} 직접 선택"></label></div></div>`).join('');
  for(const b of d.querySelectorAll('[data-part]'))b.onclick=()=>{draft[key]=Number(b.dataset.part);draft.glasses=draft.eyewear>0;thumbnails();preview();};
  for(const b of d.querySelectorAll('[data-color]'))b.onclick=()=>{draft[b.dataset.color]=b.dataset.hex;render();preview();};
  for(const input of d.querySelectorAll('[data-custom-color]'))input.oninput=()=>{draft[input.dataset.customColor]=input.value;thumbnails();preview();};
  thumbnails();
 }
 for(const b of d.querySelectorAll('[data-tab]'))b.onclick=()=>{tab=b.dataset.tab;for(const t of d.querySelectorAll('[data-tab]'))t.setAttribute('aria-pressed',String(t===b));render();};
 for(const b of d.querySelectorAll('[data-direction]'))b.onclick=()=>{direction=b.dataset.direction;for(const t of d.querySelectorAll('[data-direction]'))t.setAttribute('aria-pressed',String(t===b));preview();};
 $('#preview-walk').onchange=e=>{walking=e.target.checked;preview();};
 $('#random-avatar').onclick=()=>{draft=cleanAvatar(randomAvatar(DEFAULT_AVATAR));render();preview();};
 $('#restore-avatar').onclick=()=>{draft={...original};render();preview();};
 $('#download-avatar').onclick=()=>{const c=document.createElement('canvas');drawAvatar(c,draft,'down',0);const a=document.createElement('a');a.download='나의_픽셀_캐릭터.png';a.href=c.toDataURL('image/png');a.click();};
 $('#save-avatar').onclick=()=>{onSave(cleanAvatar(draft));d.close();};
 if(candidates.length){$('#photo-alternatives').innerHTML=candidates.map((a,i)=>`<button type="button" data-candidate="${i}" aria-label="사진 머리 후보 ${i+1}"><canvas></canvas></button>`).join('');for(const b of d.querySelectorAll('[data-candidate]')){const candidate=candidates[Number(b.dataset.candidate)];drawAvatar(b.querySelector('canvas'),candidate);b.onclick=()=>{draft={...draft,style:candidate.style};tab='hair';for(const t of d.querySelectorAll('[data-tab]'))t.setAttribute('aria-pressed',String(t.dataset.tab===tab));render();preview();};}}
 render();preview();timer=setInterval(preview,130);d.addEventListener('close',()=>clearInterval(timer),{once:true});
 return d;
}

export function openAvatarEditorV05({ avatar, dialog, onSave }) {
  const original = cleanAvatarV05(avatar);
  let draft = { ...original };
  const labels = { hair: '머리색', top: '상의 색', skin: '피부색', bottom: '하의 색' };
  const tones = { hair: '#352a29', top: '#252329', bottom: '#24242a' };
  const groups = Object.entries(labels).map(([key, label]) => `
    <fieldset class="v05-palette v05-palette--${key}${key === 'skin' ? '' : ' v05-color-palette'}"><legend>${label}</legend>
      <div class="v05-palette-options">${key === 'skin' ? skinSwatchesV05() : PALETTES[key].map(item => `
        <button type="button" data-palette="${key}" data-value="${item.id}" title="${item.name.replace('(원화)', '')}"
          aria-pressed="${draft[key] === item.id}">
          <i class="v05-color-dot" aria-hidden="true" style="--swatch:${item.ramp?.[1] || tones[key]}"></i>
          ${item.name.replace('(원화)', '')}</button>
      `).join('')}</div>
    </fieldset>
  `).join('');
  // 머리·상의·하의 모양: 지금 고른 색으로 그린 작은 그림 버튼(머리는 얼굴, 상의는 몸통, 하의는 허리 아래만 잘라 보여 준다)
  const shapeGroup = (key, label, list) => `
    <fieldset class="v05-palette v05-shapes v05-shapes--${key}"><legend>${label}</legend><div class="v05-shape-options">
      ${list.map(style => `
        <button type="button" data-palette="${key}" data-value="${style.id}" title="${style.name}">
          <canvas data-shape="${key}" data-value="${style.id}" width="96" height="${key === 'glassesStyle' ? 64 : 96}" aria-hidden="true"></canvas>
          <span>${style.short || style.name}</span></button>
      `).join('')}
    </div></fieldset>
  `;
  const styles = shapeGroup('hairStyle', '머리 모양', HAIR_STYLES) + shapeGroup('topStyle', '상의 모양', TOP_STYLES)
    + shapeGroup('bottomStyle', '하의·신발', BOTTOM_STYLES);
  const d = dialog('내 캐릭터 꾸미기', `
    <p class="muted v05-intro">마음에 드는 모양과 색, 안경을 골라 주세요.</p>
    <div class="v05-editor">
      <section class="v05-preview">
        <canvas id="edit-avatar" aria-label="내 캐릭터 미리보기"></canvas>
        <button type="button" id="restore-avatar" class="button light">원래 모습</button>
        <button type="button" id="download-avatar" class="text-button">캐릭터 PNG 저장</button>
      </section>
      <section class="v05-choices">${styles}${groups}${shapeGroup('glassesStyle', '안경', [
        { id: 'none', name: '없음' }, ...GLASSES_STYLES,
      ])}</section>
    </div>
    <div class="editor-footer">
      <span>저장하기 전에는 현재 모습이 바뀌지 않아요.</span>
      <button type="button" id="save-avatar" class="button primary">이 모습으로 할게요</button>
    </div>
  `);
  d.classList.add('avatar-dialog', 'v05-dialog');
  const find = selector => d.querySelector(selector);
  const SHAPE_CROP = {
    hairStyle: { x: 24, y: 4, w: 96, h: 96 },
    topStyle: { x: 20, y: 84, w: 104, h: 104 },
    bottomStyle: { x: 24, y: 126, w: 96, h: 96 },
    glassesStyle: { x: 28, y: 31, w: 88, h: 58.6667 },
  };
  const SHAPE_DEFAULT = { hairStyle: DEFAULT_HAIR_STYLE, topStyle: DEFAULT_TOP_STYLE,
    bottomStyle: DEFAULT_BOTTOM_STYLE, glassesStyle: DEFAULT_GLASSES_STYLE };
  // 잘라낸 그림에 걸치는 다른 부품도 포함한다. 머리 줄에는 옷깃, 상의 줄에는
  // 하의/신발, 하의 줄에는 긴 머리 끝이 보인다. 후보 모양 자체는 각 버튼이 정한다.
  const SHAPE_DEPENDENCIES = {
    hairStyle: ['hair', 'skin', 'top', 'topStyle', 'glasses', 'glassesStyle'],
    topStyle: ['top', 'skin', 'hair', 'hairStyle', 'bottom', 'bottomStyle'],
    bottomStyle: ['bottom', 'skin', 'top', 'topStyle', 'hair', 'hairStyle'],
    glassesStyle: ['skin', 'hair', 'hairStyle'],
  };
  const rows = [...d.querySelectorAll('.v05-shape-options')].map(strip => ({
    strip, canvases: [...strip.querySelectorAll('canvas')], key: '', avatar: null,
  }));
  const painted = new WeakMap();
  let frame = 0;
  const pendingRows = new Set();
  let closed = false;
  function paintVisible(row) {
    const group = row.canvases[0].dataset.shape;
    const crop = SHAPE_CROP[group];
    const clip = row.strip.getBoundingClientRect();
    // 먼저 배치를 읽고 그린다. 휴대폰에서 가려진 그림은 옆으로 넘길 때 합성한다.
    const visible = row.canvases.filter(canvas => {
      if (painted.get(canvas) === row.key) return false;
      const rect = canvas.getBoundingClientRect();
      return rect.right > clip.left && rect.left < clip.right;
    });
    for (const canvas of visible) {
      const value = canvas.dataset.value;
      const candidate = group === 'glassesStyle'
        ? { ...row.avatar, glasses: value !== 'none', glassesStyle: value }
        : { ...row.avatar, [group]: value };
      const source = cachedAvatarCanvas(candidate, 'v05');
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.imageSmoothingEnabled = true;
      g.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
      painted.set(canvas, row.key);
    }
  }
  function scheduleRow(row) {
    pendingRows.add(row);
    if (frame || closed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (closed) return;
      for (const item of pendingRows) paintVisible(item);
      pendingRows.clear();
    });
  }
  for (const row of rows) row.strip.addEventListener('scroll', () => scheduleRow(row), { passive: true });
  const resize = () => rows.forEach(scheduleRow);
  window.addEventListener('resize', resize);
  d.addEventListener('close', () => {
    closed = true;
    cancelAnimationFrame(frame);
    pendingRows.clear();
    window.removeEventListener('resize', resize);
  }, { once: true });
  function preview() {
    drawAvatarForKind(find('#edit-avatar'), draft, 'v05', 2);
    for (const button of d.querySelectorAll('[data-palette]')) {
      const key = button.dataset.palette;
      const value = key === 'glassesStyle' && !draft.glasses ? 'none' : draft[key] || SHAPE_DEFAULT[key];
      button.setAttribute('aria-pressed', String(value === button.dataset.value));
    }
    for (const row of rows) {
      const group = row.canvases[0].dataset.shape;
      const relevant = { ...DEFAULT_AVATAR_V05 };
      for (const key of SHAPE_DEPENDENCIES[group]) relevant[key] = draft[key];
      // 짧은 머리는 허리 아래에 보이지 않는다. 머리 모양 변경 자체는 계속 추적한다.
      if (group === 'bottomStyle' && !['longStraight', 'longBang', 'twinTails', 'longWaves'].includes(draft.hairStyle)) relevant.hair = 'original';
      row.avatar = cleanAvatarV05(relevant);
      const key = JSON.stringify(row.avatar);
      if (row.key === key) continue;
      row.key = key;
      paintVisible(row);
    }
  }
  for (const button of d.querySelectorAll('[data-palette]')) {
    button.onclick = () => {
      const { palette, value } = button.dataset;
      const next = palette === 'glassesStyle'
        ? cleanAvatarV05({ ...draft, glasses: value !== 'none', glassesStyle: value })
        : cleanAvatarV05({ ...draft, [palette]: value });
      if (JSON.stringify(next) === JSON.stringify(draft)) return;
      draft = next;
      preview();
    };
  }
  find('#restore-avatar').onclick = () => {
    draft = { ...original };
    preview();
  };
  find('#download-avatar').onclick = () => {
    const canvas = drawAvatarForKind(document.createElement('canvas'), draft, 'v05');
    const link = document.createElement('a');
    link.download = '나의_캐릭터.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  find('#save-avatar').onclick = () => {
    onSave(cleanAvatarV05(draft));
    d.close();
  };
  preview();
  return d;
}
