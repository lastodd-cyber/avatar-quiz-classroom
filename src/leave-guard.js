// 교실 입장 중에만 한 단계의 기록을 두어 휴대폰 뒤로가기를 확인창으로 받는다.
export function createLeaveGuard(confirmLeave) {
  const marker = 'classroomLeaveGuard';
  let active = false;
  const protect = () => history.pushState({ ...history.state, [marker]: true }, '', location.href);
  const back = () => {
    if (!active) return;
    protect();
    confirmLeave();
  };
  const unload = event => {
    if (!active) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('popstate', back);
  return {
    enable() {
      if (active) return;
      active = true;
      if (!history.state?.[marker]) protect();
      window.addEventListener('beforeunload', unload);
    },
    disable() {
      active = false;
      window.removeEventListener('beforeunload', unload);
    }
  };
}
