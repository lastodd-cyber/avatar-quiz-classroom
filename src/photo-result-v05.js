import './photo-result.css';
import { PALETTES, HAIR_STYLES, DEFAULT_HAIR_STYLE, DEFAULT_TOP_STYLE, DEFAULT_BOTTOM_STYLE, DEFAULT_GLASSES_STYLE,
  cleanAvatarV05, colorfulAvatarV05 } from '../shared/avatar-v05.js';
import { matchPhotoV05 } from '../shared/photo-match-v05.js';
import { analyzePhotoV05 } from './photo-v05.js';
import { drawAvatarForKind } from './art.js';

// 사진으로는 머리 모양·안경을 닮게 하고, 처음 두 후보의 색과 옷은 알록달록하게 바꾼다(교실에 여러 색이 섞이게).
// 마지막 후보는 사진에서 읽은 머리색·옷색 그대로 둔다. 안경이 애매할 때 안경 쓴 후보가 하나는 남게 한다.
export function colorfulPhotoCandidates(list, rand = Math.random) {
  if (!list.length) return list;
  const [base] = list;
  const second = list.find(item => item !== base && item.avatar.glasses !== base.avatar.glasses) || list[1] || base;
  const fun = item => {
    const { hairStyle, glasses, glassesStyle, skin } = item.avatar;
    const avatar = colorfulAvatarV05({ hairStyle, glasses, glassesStyle, skin }, rand);
    // 정리 함수는 기본 모양을 빼고 돌려준다. 그대로 두면 current()에서 학생의 예전 모양이 덮으므로 모양을 모두 적는다.
    return {
      ...item,
      avatar: { ...avatar, hairStyle: avatar.hairStyle ?? DEFAULT_HAIR_STYLE, topStyle: avatar.topStyle ?? DEFAULT_TOP_STYLE,
        bottomStyle: avatar.bottomStyle ?? DEFAULT_BOTTOM_STYLE,
        ...(glassesStyle ? { glassesStyle: avatar.glassesStyle ?? DEFAULT_GLASSES_STYLE } : {}) },
      reasons: [...item.reasons.filter(Boolean).slice(0, 1), item.reasons[0] ? '' : '색은 알록달록하게 골랐어요'].filter(Boolean),
    };
  };
  return [fun(base), fun(second), { ...base, title: '사진 속 내 색', reasons: ['머리색·옷색을 사진에서 그대로 가져왔어요'] }];
}

export const skinSwatchesV05 = () => PALETTES.skin.map((item, index) => `
  <button type="button" class="v05-swatch" data-palette="skin" data-value="${item.id}"
    style="--swatch:${item.tone || '#f0c4a0'}" aria-label="피부색 ${index + 1}"
    aria-pressed="false"></button>
`).join('');

// 사진과 측정값은 이 화면의 메모리에서만 사용한다. 호출자에게는 정리한 설정 id만 넘긴다.
export function openPhotoResultV05({ file, avatar, dialog, onChoose, onManual, onRetry, onClose }) {
  const original = cleanAvatarV05(avatar);
  let skin = original.skin;
  let selected = 0;
  let tied = false;
  let candidates = [];
  let active = true;
  const controller = new AbortController();
  const photoUrl = URL.createObjectURL(file);
  const d = dialog('사진으로 만든 나', `
    <button type="button" class="button light wide" id="photo-manual">사진 없이 직접 꾸미기</button>
    <p class="photo-guide">밝은 곳에서 정면을 보고, 얼굴은 크게 · 어깨까지 나오게 찍어 주세요.</p>
    <p class="photo-privacy">사진은 이 휴대폰 안에서만 살펴보고 저장하지 않아요.
      친구들에게는 고른 캐릭터만 보여요.</p>
    <p id="photo-progress" role="status" aria-live="polite">사진을 준비하고 있어요.</p>
    <div class="photo-comparison">
      <figure class="photo-original"><img alt="이 기기에서만 보는 내 사진"><figcaption>내 사진</figcaption></figure>
      <div id="photo-primary"></div>
    </div>
    <div id="photo-others" class="photo-others"></div>
    <div id="photo-result-controls" hidden>
      <button type="button" id="photo-tied" class="button light" aria-pressed="false" hidden>머리를 묶었어요</button>
      <fieldset class="photo-skin"><legend>피부색은 직접 골라 주세요</legend>${skinSwatchesV05()}</fieldset>
      <div class="photo-result-actions">
        <button type="button" id="photo-apply" class="button primary">이 캐릭터로 할게요</button>
        <button type="button" id="photo-edit" class="button light">직접 고치기</button>
      </div>
    </div>
    <button type="button" id="photo-retry" class="text-button">다시 찍기</button>
    <ul id="photo-notes" aria-label="사진 분석 참고 사항"></ul>
  `);
  d.classList.add('photo-result-dialog');
  // 직접 꾸미기는 제목보다 위에 두고 처음부터 키보드로 선택할 수 있게 한다.
  const find = selector => d.querySelector(selector);
  d.prepend(find('#photo-manual'));
  find('.photo-original img').src = photoUrl;
  find('#photo-manual').focus();

  function dispose() {
    if (!active) return;
    active = false;
    controller.abort();
    URL.revokeObjectURL(photoUrl);
    find('.photo-original img').removeAttribute('src');
    candidates = [];
    onClose();
  }
  function close() {
    dispose();
    d.close();
  }
  function current(index = selected) {
    return cleanAvatarV05({ ...original, ...candidates[index].avatar, skin,
      ...(tied ? { hairStyle: 'ponytail' } : {}) });
  }
  function render() {
    find('#photo-primary').replaceChildren();
    find('#photo-others').replaceChildren();
    const order = [selected, ...candidates.map((_, index) => index).filter(index => index !== selected)];
    for (const index of order) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'photo-candidate';
      button.dataset.candidate = String(index);
      button.setAttribute('aria-pressed', String(index === selected));
      const title = document.createElement('strong');
      title.textContent = candidates[index].title || (index === 0 ? '가장 비슷해요' : `다른 후보 ${index}`);
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      const reason = document.createElement('span');
      reason.textContent = candidates[index].reasons.at(-1) || '';
      reason.title = reason.textContent;
      button.append(title, canvas, reason);
      button.onclick = () => {
        selected = index;
        render();
        find('#photo-primary button').focus();
      };
      find(index === selected ? '#photo-primary' : '#photo-others').append(button);
      drawAvatarForKind(canvas, current(index), 'v05');
    }
    for (const button of d.querySelectorAll('[data-palette="skin"]')) {
      button.setAttribute('aria-pressed', String(button.dataset.value === skin));
    }
    find('#photo-tied').setAttribute('aria-pressed', String(tied));
  }
  find('#photo-manual').onclick = () => {
    close();
    onManual(original);
  };
  find('#close-dialog').onclick = close;
  d.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });
  d.addEventListener('close', dispose, { once: true });
  window.addEventListener('pagehide', close, { signal: controller.signal });
  find('#photo-retry').onclick = () => {
    close();
    onRetry();
  };
  find('#photo-apply').onclick = () => {
    const next = current();
    close();
    onChoose(next);
  };
  find('#photo-edit').onclick = () => {
    const next = current();
    close();
    onManual(next);
  };
  find('#photo-tied').hidden = !HAIR_STYLES.some(style => style.id === 'ponytail');
  find('#photo-tied').onclick = () => {
    tied = !tied;
    render();
  };
  for (const button of d.querySelectorAll('[data-palette="skin"]')) {
    button.onclick = () => {
      skin = button.dataset.value;
      render();
    };
  }
  async function run() {
    try {
      const features = await analyzePhotoV05(file, message => {
        if (active) find('#photo-progress').textContent = message;
      }, { signal: controller.signal });
      if (!active) return;
      const result = matchPhotoV05(features, {
        hairStyles: HAIR_STYLES.filter(style => style.photoMatch !== false), palettes: PALETTES
      });
      candidates = colorfulPhotoCandidates(result.candidates);
      for (const note of result.notes) {
        const item = document.createElement('li');
        item.textContent = note;
        find('#photo-notes').append(item);
      }
      if (!candidates.length) {
        find('#photo-progress').textContent = '후보를 고르기 어려워요. 다시 찍거나 직접 꾸며 주세요.';
        return;
      }
      find('#photo-progress').textContent = '마음에 드는 후보를 골라 주세요.';
      find('#photo-result-controls').hidden = false;
      render();
    } catch (error) {
      if (!active) return;
      find('#photo-progress').setAttribute('role', 'alert');
      find('#photo-progress').textContent = error.message;
    } finally {
      file = null;
    }
  }
  void run();
  return { close };
}
