// 표시용 서버 시계. 기록 판정에는 사용하지 않는다.
export function createServerClock(room, {
  now = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  let offset = null;
  let bestRtt = Infinity;
  let syncedAt = -Infinity;
  let pending = null;

  async function measure(count) {
    const samples = [];
    for (let i = 0; i < count; i += 1) {
      try {
        const t0 = now();
        const server = await room.request('time', undefined, { timeout: 2000 });
        const t1 = now();
        if (Number.isFinite(server) && t1 >= t0) {
          samples.push({ rtt: t1 - t0, offset: server - (t0 + t1) / 2 });
        }
      } catch {
        // 단일 표본 실패가 카운트다운을 막지 않게 한다.
      }
      await sleep(80);
    }
    if (!samples.length) return;
    samples.sort((a, b) => a.rtt - b.rtt);
    const best = samples[0];
    const recent = now() - syncedAt < 120000;
    if (offset !== null && recent && best.rtt > bestRtt * 2 + 30) return;
    offset = best.offset;
    bestRtt = best.rtt;
    syncedAt = now();
  }

  return {
    sync(count = 5) {
      // 여러 화면 이벤트가 겹쳐도 측정을 공유하여 요청 폭주를 막는다.
      if (pending) return pending;
      if (!Number.isInteger(count) || count < 1) return Promise.resolve();
      pending = measure(count).finally(() => { pending = null; });
      return pending;
    },
    seed(serverTime) {
      if (offset === null && Number.isFinite(serverTime)) offset = serverTime - now();
    },
    now: () => now() + (offset ?? 0),
    rtt: () => bestRtt,
    syncedAt: () => syncedAt,
  };
}
