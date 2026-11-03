// 협동 게임방(블록 놀이터) 스테이지와 물리 숫자. 서버와 화면이 같이 쓴다.
// 좌표는 칸(tile) 단위로 적고, 실제 픽셀은 COOP.tile을 곱한다. 몸의 x는 가운데, y는 발바닥.
//
// 숫자를 바꿀 때: 혼자 점프 높이(약 2.4칸)로는 3칸 벽을 못 넘고, 친구 머리 위(1.4칸)에서 뛰면
// 넘을 수 있어야 한다. tests/coop-physics.test.mjs가 이 관계를 검사한다.

export const COOP = {
  tile: 32,
  gravity: 1900, // 픽셀/초²
  jumpSpeed: 540, // 점프 순간 위로 속도. 최고 높이 = jumpSpeed² / (2 × gravity) ≈ 77픽셀
  walkSpeed: 170, // 걷는 속도(픽셀/초)
  maxFall: 900,
  body: { w: 22, h: 44 }, // 부딪힘 상자. 그림은 이보다 조금 크게 그린다
  maxPlayers: 5,
  minPlayers: 2,
  introMs: 5000, // 시작 전 조작 안내
  sendHz: 15, // 내 위치를 서버로 보내는 횟수
  stepMs: 1000 / 60,
};

// 첫 스테이지: 머리 밟고 올라가기 → 계단 버튼 → 두 버튼 동시에 → 열쇠 → 문.
// rect: [x, y, w, h] 칸 단위. y는 위에서 아래로 늘어난다(0이 천장).
export const LEVEL_1 = {
  id: 'blocks-1',
  title: '블록 놀이터',
  w: 64,
  h: 14,
  seconds: 180,
  // 시작 자리(발이 닿는 칸). 5명까지 나란히 선다.
  spawn: [[3, 12], [4, 12], [5, 12], [6, 12], [7, 12]],
  solids: [
    [0, 12, 64, 2], // 바닥
    [0, 0, 64, 1], // 천장
    [0, 0, 1, 14], // 왼쪽 벽
    [63, 0, 1, 14], // 오른쪽 벽
    [10, 11, 2, 1], // 연습 계단 1칸
    [12, 10, 2, 2], // 연습 계단 2칸
    [18, 9, 6, 3], // 3칸 높이 언덕: 혼자는 못 오르고 친구 머리를 밟아야 한다
    [33, 10, 3, 2], // 2번 버튼이 있는 낮은 턱
  ],
  // 언덕 위 버튼을 한 번 누르면 언덕 앞에 계단이 생긴다(남은 친구도 올라오게).
  stairs: {
    plate: [21, 8],
    blocks: [[15, 11, 1, 1], [16, 10, 1, 2], [17, 9, 1, 3]],
  },
  // 두 버튼을 같은 순간에 누르면 문(가로막)이 열린다. 천장까지 막혀 있어 넘어갈 수 없다.
  gate: {
    plates: [[27, 11], [34, 9]],
    rect: [38, 1, 1, 11],
  },
  // 혼자 뛰면 닿지 않고, 친구 머리 위에서 뛰면 닿는 높이에 떠 있다.
  key: [46, 7],
  // 열쇠를 든 사람이 닿으면 열리고, 모두 들어가면 성공.
  door: [58, 10, 2, 2],
};

export const LEVELS = { [LEVEL_1.id]: LEVEL_1 };

// 칸 단위 rect → 픽셀 rect
export function px([x, y, w, h], tile = COOP.tile) {
  return { x: x * tile, y: y * tile, w: w * tile, h: h * tile };
}

// 버튼 자리(칸 하나): 그 칸의 바닥에 발을 대고 서 있으면 눌린 것.
export function plateRect([x, y], tile = COOP.tile) {
  return { x: x * tile, y: y * tile, w: tile, h: tile };
}

export function levelSize(level, tile = COOP.tile) {
  return { width: level.w * tile, height: level.h * tile };
}

export function spawnPoint(level, slot, tile = COOP.tile) {
  const [x, y] = level.spawn[slot % level.spawn.length];
  return { x: (x + .5) * tile, y: y * tile };
}
