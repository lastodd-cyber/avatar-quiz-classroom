// document 전체를 사용해야 퀴즈·시상·대화창도 함께 표시된다.
export async function enterFullscreen(toast = () => {}) {
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request) { toast('이 브라우저에서는 주소창을 숨길 수 없어 화면 안을 최대한 넓게 보여드려요.'); return; }
  try { await request.call(root); }
  catch { toast('전체화면 버튼을 다시 눌러 주세요. 교실의 넓은 화면은 그대로 사용할 수 있어요.'); }
}
export async function exitFullscreen() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) return;
  try { await (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch {}
}
