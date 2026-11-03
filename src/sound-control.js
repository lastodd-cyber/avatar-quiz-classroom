import './sound-control.css';

// 교실·퀴즈·시상식의 버튼은 같은 기기의 설정을 함께 표시한다.
export function createSoundControl(audio, { overlay = false } = {}) {
  if (!audio) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `sound-toggle${overlay ? ' sound-toggle-overlay' : ''}`;
  button.dataset.soundToggle = '';
  const off = audio.subscribe(({ enabled, available, ready }) => {
    button.textContent = !available ? '효과음 미지원' : enabled ? '효과음 끄기' : '효과음 켜기';
    button.setAttribute('aria-pressed', String(enabled));
    button.disabled = !available;
    button.title = !available ? '이 브라우저에서는 소리를 재생할 수 없어요.' :
      enabled && !ready ? '화면을 한 번 누르면 효과음이 준비돼요.' :
      '이 기기의 효과음만 바꿔요. 소리 크기는 기기 볼륨으로 조절하세요.';
  });
  button.onclick = () => void audio.setEnabled(!audio.state.enabled);
  return { button, destroy() { off(); button.remove(); } };
}
