import './champion-fx.css';
import { createSoundControl } from '../sound-control.js';

// 별도 이미지 다운로드 없이 기존 아바타를 크게 합성하는 누적 우승 시상식.
export function createChampionFx({ avatarCanvas, onCover = () => {}, audio }) {
  let root, frame = 0, previousFocus, soundControl, removeVisibility;
  function close() {
    cancelAnimationFrame(frame);
    audio?.stop('champion');
    removeVisibility?.();
    removeVisibility = null;
    soundControl?.destroy();
    soundControl = null;
    root?.remove();
    root = null;
    onCover(false);
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function show(winner, { replay = true, onCoop = null } = {}) {
    close();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    previousFocus = document.activeElement;
    root = document.createElement('section');
    root.id = 'champion-finale';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '오늘의 퀴즈 우승 발표');
    root.innerHTML = `<canvas class="champion-particles" aria-hidden="true"></canvas>
      <div class="champion-beams" aria-hidden="true"></div>
      <div class="champion-orbit" aria-hidden="true"></div>
      <div class="champion-intro"><p>모든 도전이 끝났다</p><strong>오늘의 주인공은?</strong><b>3</b></div>
      <div class="champion-result" aria-live="polite">
        <p class="champion-eyebrow">우리 교실 · 퀴즈 챔피언</p>
        <h1 class="champion-title">오늘의 시상식</h1>
        <div class="champion-cast"></div>
        <div class="champion-names"></div><p class="champion-score"></p>
        <p class="champion-cheer">끝까지 도전한 모두에게 큰 박수!</p>
      </div>
      <button class="champion-close" type="button">교실로 돌아가기</button>`;
    const current = root;
    const cast = root.querySelector('.champion-cast');
    // 시상대: 왼쪽 2등 · 가운데 1등 · 오른쪽 3등(공동 등수는 같은 자리 옆에). 예전 서버 데이터는 1등만 있다.
    const podium = winner.podium?.length ? winner.podium
      : (winner.champions || []).map(person => ({ ...person, rank: 1, points: winner.points, score: winner.score }));
    const order = [2, 1, 3].flatMap(rank => podium.filter(p => p.rank === rank));
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    cast.style.setProperty('--champion-count', String(Math.max(1, Math.min(6, order.length))));
    for (const person of order.slice(0, 6)) {
      const stand = document.createElement('div');
      stand.className = `champion-stand rank-${person.rank}`;
      stand.style.setProperty('--land-delay', `${{ 3: 0.35, 2: 0.8, 1: 1.25 }[person.rank] || 0.35}s`);
      const figure = document.createElement('div');
      figure.className = 'champion-figure';
      // 왕관과 캐릭터를 그림 크기 상자에 함께 넣어 화면 폭이 바뀌어도 머리·발 위치가 맞는다.
      const art = document.createElement('div');
      art.className = 'champion-art';
      if (person.rank === 1) {
        art.innerHTML = '<svg class="champion-crown" viewBox="0 0 100 65" aria-hidden="true"><path d="M10 18L30 34 50 5 70 34 90 18 82 55H18Z" fill="#f2d78c" stroke="#2a1410" stroke-width="4"/><path d="M20 62H80" stroke="#f2d78c" stroke-width="5"/></svg>';
      }
      const source = avatarCanvas(person.avatar, person.avatarKind || 'v05');
      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.getContext('2d').drawImage(source, 0, 0);
      canvas.setAttribute('aria-label', `${person.rank}등 ${person.name} 캐릭터`);
      art.style.setProperty('--art-w', String(canvas.width));
      art.style.setProperty('--art-h', String(canvas.height));
      art.append(canvas);
      figure.append(art);
      const block = document.createElement('div');
      block.className = 'champion-block';
      const medal = document.createElement('b');
      medal.textContent = String(person.rank);
      const name = document.createElement('strong');
      name.textContent = person.name;
      const pts = document.createElement('small');
      pts.textContent = Number.isFinite(person.points) ? `${fmt(person.points)}점` : `${person.score ?? 0}문제`;
      block.append(medal, name, pts);
      stand.append(figure, block);
      cast.append(stand);
    }
    const firsts = podium.filter(p => p.rank === 1);
    root.querySelector('.champion-names').textContent = '';
    root.querySelector('.champion-title').textContent = firsts.length > 1 ? '공동 1등!' : '오늘의 시상식';
    root.querySelector('.champion-score').textContent = `1등 ${firsts.map(p => p.name).join(' · ')}`
      + (Number.isFinite(winner.points) ? ` · ${fmt(winner.points)}점` : ` · ${winner.score}문제 정답`);
    root.querySelector('.champion-close').onclick = close;
    if (onCoop) {
      // 선생님 화면: 시상식 바로 뒤에 1~5등 협동 게임방을 연다.
      const coop = document.createElement('button');
      coop.type = 'button';
      coop.className = 'champion-coop';
      coop.textContent = '협동 게임방 열기 (1~5등)';
      coop.onclick = () => onCoop();
      root.querySelector('.champion-close').before(coop);
    }
    soundControl = createSoundControl(audio, { overlay: true });
    if (soundControl) root.append(soundControl.button);
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        e.preventDefault();
        const buttons = [...root.querySelectorAll('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement);
        buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    });
    document.body.append(root);
    root.querySelector('button').focus({ preventScroll: true });
    onCover(true);

    const canvas = root.querySelector('.champion-particles');
    const ctx = canvas.getContext('2d');
    let width = 0, height = 0;
    const colors = ['#f2d78c', '#f4b8a6', '#fbe6df', '#a9cfcb', '#ffffff'];
    const count = innerWidth < 768 ? 140 : 280;
    let seed = winner.announcedAt >>> 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const pieces = Array.from({ length: count }, (_, i) => ({
      delay: (i % 4) * 1.1, side: i % 2, speed: .22 + random() * .6,
      rise: .5 + random() * .8, size: 4 + random() * 7, spin: random() * 9,
      color: colors[i % colors.length], star: i % 7 === 0,
    }));
    const started = performance.now();
    // 이미 끝난 시상을 재접속했을 때는 긴 등장 연출을 반복하지 않는다.
    const fresh = replay && Date.now() - winner.announcedAt < 18000;
    const animated = fresh && !reduced;
    let audible = fresh && !document.hidden;
    const onVisibility = () => { if (document.hidden) audible = false; };
    document.addEventListener('visibilitychange', onVisibility);
    removeVisibility = () => document.removeEventListener('visibilitychange', onVisibility);
    if (animated && audible) audio?.play('champion-intro', { channel: 'champion' });
    let revealed = false;
    function draw(now) {
      if (root !== current) return;
      const t = animated ? (now - started) / 1000 : 14;
      if (width !== innerWidth || height !== innerHeight) {
        width = innerWidth; height = innerHeight;
        const dpr = Math.min(devicePixelRatio || 1, 1.5);
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (t < 3) root.querySelector('.champion-intro b').textContent = String(Math.max(1, 3 - Math.floor(t)));
      else if (!revealed) {
        revealed = true;
        if (audible) audio?.play('champion-reveal', { channel: 'champion' });
        root.classList.add('is-revealed');
        if (!animated) root.classList.add('is-still');
      }
      ctx.clearRect(0, 0, width, height);
      if (t >= 3 && t < 14 && !reduced) {
        for (const p of pieces) {
          const age = t - 3 - p.delay;
          if (age < 0 || age > 7) continue;
          const x = (p.side ? width : 0) + (p.side ? -1 : 1) * width * p.speed * age * .42;
          const y = height * .85 - height * p.rise * age * .65 + height * .16 * age * age;
          ctx.save(); ctx.translate(x, y); ctx.rotate(age * p.spin);
          ctx.globalAlpha = Math.min(1, (7 - age) / 2);
          ctx.fillStyle = p.color;
          if (p.star) {
            ctx.beginPath();
            for (let j = 0; j < 10; j++) {
              const a = j * Math.PI / 5, r = p.size * (j % 2 ? .45 : 1);
              ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            }
            ctx.closePath(); ctx.fill();
          } else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * Math.cos(age * 5));
          ctx.restore();
        }
      }
      if (t < 14) frame = requestAnimationFrame(draw);
      else root.classList.add('is-still');
    }
    frame = requestAnimationFrame(draw);
  }
  return { show, close, destroy: close };
}
