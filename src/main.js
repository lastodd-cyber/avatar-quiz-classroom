import "./style.css";
import { createQuizUI } from "./quiz-ui.js";
import { createLeaveGuard } from './leave-guard.js';
import { enterFullscreen, exitFullscreen } from './fullscreen.js';
import { createChampionFx } from './fx/champion-fx.js';
import { createServerClock } from './server-clock.js';
import { createClassroomAudio } from './audio.js';
import { createSoundControl } from './sound-control.js';
import { Client } from "@colyseus/sdk";
import QRCode from "qrcode";
import { DEFAULT_AVATAR, PALETTE, cleanAvatarForKind, applyClassroomMessage } from "../shared/world.js";
import {
  drawClassroom,
  loadClassroomArt,
  loadAvatarV05,
  drawAvatarForKind,
  cachedAvatarCanvas
} from "./art.js";
import { TEMPLATE, colorfulAvatarV05 } from "../shared/avatar-v05.js";
import { openPhotoResultV05 } from "./photo-result-v05.js";
import { createClassroom } from "./scene.js";
import { photoToAvatar } from "./photo.js";
import { openAvatarEditor, openAvatarEditorV05 } from "./avatar-editor.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(
  /[&<>"']/g, 
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
);
const icons = { 
  door: "M4 21V3h12v18M1 21h21M12 12h.01M16 4h4v17", 
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8" +
    "M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  camera: "M14 4h-4L8 7H3v13h18V7h-5zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0", 
  arrow: "M5 12h14M12 5l7 7-7 7", 
  close: "M6 6l12 12M6 18L18 6", 
  crown: "M3 7l4 4 5-7 5 7 4-4-2 12H5z", 
  board: "M3 3h18v14H3zM8 21l4-4 4 4", 
  chat: "M21 3H3v14h4v4l5-4h9z", 
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6", 
  qr: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6z" 
};
const icon = (name) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="${icons[name] || icons.door}"/>
    </svg>`;
let avatar = { ...DEFAULT_AVATAR };
let room;
let world;
let myId;
let role = "guest";
let snapshot;
let quizUI = null;
let coopView = null; // 협동 게임방 화면(선생님이 열면 모든 화면에 뜬다)
let coopLoading = null; // 게임방 코드는 처음 열릴 때만 받는다(평소 교실 첫 화면을 가볍게)
const audio = createClassroomAudio();
let roomSoundControl;
const championFx = createChampionFx({ avatarCanvas: cachedAvatarCanvas, onCover: setQuizCovered, audio });
function updateStudentViewport() {
  document.documentElement.style.setProperty('--student-height', `${window.visualViewport?.height || innerHeight}px`);
}
window.visualViewport?.addEventListener('resize', updateStudentViewport);
window.addEventListener('resize', updateStudentViewport);
document.addEventListener('fullscreenchange', () => {
  const button = document.querySelector('#student-fullscreen');
  if (button) button.textContent = document.fullscreenElement ? '전체화면 해제' : '전체화면';
});
let quizCovered = false;
let quizCoverFrame = 0;
let intentional = false;
let kicked = false;
// 서버가 교실을 닫는다고 미리 알린 상태. 프록시(Render 등)가 닫힘 코드 4001을 1006으로 바꿔도 닫힌 교실로 처리한다.
let roomClosed = false;
const leaveGuard = createLeaveGuard(() => {
  if ($('#confirm-leave')) return;
  const openedDialog = document.querySelector('dialog[open]');
  if (openedDialog) { openedDialog.close(); return; }
  confirmRoomLeave();
});
let photoBusy = false;
let photoFlow;
let lastAward = 0;
let roomOptions = null;
let roomCode = null;
let connectMode = null;
let avatarKind = new URLSearchParams(location.search).get("avatar") === "v05" ? "v05" : "v02";
let worldKind = null;
let roomRenderPending = false;
const peopleRows = new Map();
const chatIds = new Set();
const runtimeConfig = await fetch('/api/config').then(response => {
  if (!response.ok) throw new Error('교실 설정을 읽지 못했어요. 새로고침해 주세요.');
  return response.json();
});
const cloud = runtimeConfig.mode === 'cloud';
const missingRoomMessage = '교실을 찾지 못했어요. 선생님 화면의 새 QR을 찍어 주세요.';
const content = await fetch("/content.json").then((r) => r.json());
await loadClassroomArt();
const client = new Client(location.origin);
let saved;
let remembered;
let rememberAvatar = true;
let photoCandidates = [];
try {
  saved = JSON.parse(sessionStorage.getItem("classroom-profile"));
  rememberAvatar = localStorage.getItem('classroom-remember-avatar') !== 'off';
  remembered = rememberAvatar ? JSON.parse(localStorage.getItem('classroom-avatar')) : null;
  if (remembered?.avatar) avatar = remembered.avatar;
  else if (saved?.avatar) avatar = saved.avatar;
  if (!new URLSearchParams(location.search).has('avatar') && remembered?.avatarKind) {
    avatarKind = remembered.avatarKind === 'v05' ? 'v05' : 'v02';
  }
} catch {
}
const savedKind = remembered?.avatar ? remembered.avatarKind : saved?.avatar ? saved.avatarKind : null;
avatar = cleanAvatarForKind(avatar, avatarKind);
// 저장된 새 캐릭터가 없는 학생은 기본(검정 옷) 대신 알록달록한 모습으로 시작한다
if (avatarKind === "v05" && savedKind !== "v05") avatar = colorfulAvatarV05();
if (avatarKind === "v05") await loadAvatarV05();
function toast(message) {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.setAttribute("role", "status");
    document.body.append(t);
  }
  t.textContent = message;
  t.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("visible"), 4500);
}
function dialog(title, body) {
  $("#dialog")?.close();
  $("#dialog")?.remove();
  const d = document.createElement("dialog");
  d.id = "dialog";
  d.innerHTML = `<div class="dialog-title">
    <h2>${esc(title)}</h2>
    <button type="button" class="icon-button" id="close-dialog" aria-label="닫기">${icon("close")}</button>
    </div>${body}`;
  document.body.append(d);
  $("#close-dialog").onclick = () => d.close();
  d.addEventListener("close", () => d.remove());
  d.showModal();
  return d;
}
function admin(action, extra = {}) {
  room?.send("admin", { action, ...extra });
}
function renderHome() {
  const teacher = location.pathname === '/teacher';
  document.body.className = teacher ? 'home' : 'home student-home';
  $("#app").innerHTML = `<header class="home-header">
    <a class="brand" href="/">${icon("door")}<span>우리의 교실</span>
    </a>
    <span class="small-label">AVATAR CLASSROOM</span>
    <button class="text-button" id="create-room">교실 만들기 ${icon("arrow")}</button>
    </header>
  <main class="landing">
    <section class="intro">
    <div class="eyebrow">
    <span class="dot">
    </span> 얼굴은 캐릭터로, 만남은 우리답게</div>
    <h1>어서 와요,<br>우리의 교실에.</h1>
    <p class="lead">나를 닮은 작은 캐릭터로 입장해요.<br>함께 이야기하고, 퀴즈를 풀고, 오늘의 1등도 만나보세요.</p>
  <div class="join-card">
    <div class="avatar-step">
    <div class="avatar-preview">
    <canvas id="avatar-preview" aria-label="내 캐릭터 미리보기">
    </canvas>
    <span id="avatar-label">나의 캐릭터</span>
    </div>
    <div class="photo-actions">
    <span class="step-label">01 &nbsp; 나를 닮은 캐릭터</span>
    <p>사진으로 나만의 도트 캐릭터</p>
    <div class="button-row">
    <button class="button soft" id="take-photo">${icon("camera")} 사진 찍기</button>
    <button class="button light" id="choose-photo">사진 선택</button>
    </div>
    <input type="file" id="camera-file" accept="image/*" capture="user" hidden>
    <input type="file" id="photo-file" accept="image/*" hidden>
    <small>이 휴대폰 안에서만 살펴봐요. 사진 원본은 저장하거나 전송하지 않아요.</small>
    <small id="photo-status" role="status">사진은 이 기기에서만 분석하고, 원본은 전송하지 않아요.</small>
    <button class="text-button tiny" id="adjust-avatar">캐릭터 꾸미기</button>
    </div>
    </div>
  <label class="remember-avatar"><input id="remember-avatar" type="checkbox" checked>
    이 기기에 내 캐릭터 기억하기(공용 기기는 꺼 주세요)</label>
  <p class="tiny muted">실명 말고 별명, 친구들에게 별명과 캐릭터가 보여요.</p>
  <form id="join-form">
    <div class="form-row">
    <label>02 &nbsp; 나의 별명<input id="nickname" maxlength="12" required placeholder="어떤 이름으로 만날까요?"
    value="${esc(saved?.name || "")}">
    </label>
    <label class="code-field">03 &nbsp; 교실 코드<input id="room-code" maxlength="6" minlength="6"
    required placeholder="6자리 코드" autocomplete="off" value="${esc(new URLSearchParams(location.search).get("room") || 
      "")}">
    </label>
    </div>
    <button id="join-submit" class="button primary wide" type="submit">교실에 들어가기 ${icon("arrow")}</button>
    <p class="form-error" id="join-error" role="alert">
    </p>
    </form>
  <div class="join-footer">
    <span>사진 없이 기본 캐릭터로도 입장할 수 있어요.</span>
    <button class="text-button tiny" id="host-return">관리자로 입장</button>
    </div>
    </div>
    </section>
  <section class="room-preview">
    <div class="preview-label">
    <span>OUR LITTLE CLASSROOM</span>
    <span>공간 미리보기</span>
    </div>
    <div class="preview-art">
    <canvas id="room-preview" aria-label="책상과 칠판이 있는 따뜻한 교실 미리보기">
    </canvas>
    <div class="preview-caption">
    <strong>같은 공간, 함께 만드는 시간.</strong>
    <span>교실 · 연수 · 우리들의 모임</span>
    </div>
    </div>
    <div class="preview-features">
    <span>${icon("people")} 함께 보이는 아바타</span>
    <span>${icon("chat")} 실시간 대화</span>
    <span>${icon("crown")} 퀴즈와 1등 발표</span>
    </div>
    <p class="preview-note">사진으로 만든 캐릭터도, 처음 만난 친구도.<br>여기서는 모두 같은 교실의 주인공이에요.</p>
    </section>
    </main>
    <footer class="home-footer">설치 없이 브라우저에서 &nbsp; / &nbsp; 한 교실, 최대 40명 <span>사진 원본 저장 없음 · 대화는
    교실이 열려 있는 동안만</span>
    </footer>`;
  renderHomePreviews();
  $('#remember-avatar').checked = rememberAvatar;
  $('#remember-avatar').onchange = event => {
    rememberAvatar = event.target.checked;
    localStorage.setItem('classroom-remember-avatar', rememberAvatar ? 'on' : 'off');
    if (!rememberAvatar) localStorage.removeItem('classroom-avatar');
    else saveProfile();
  };
  $("#take-photo").onclick = () => $("#camera-file").click();
  $("#choose-photo").onclick = () => $("#photo-file").click();
  for (const id of ["camera-file", "photo-file"]) $("#" + id).onchange = async (e) => {
    if (e.target.files[0]) await importPhoto(e.target.files[0]);
    e.target.value = "";
  };
  $("#adjust-avatar").onclick = adjustAvatar;
  $("#create-room").onclick = () => hostDialog(false);
  $("#host-return").onclick = () => hostDialog(true);
  $("#join-form").onsubmit = async (e) => {
    e.preventDefault();
    if (photoBusy) return;
    const code = $("#room-code").value.trim().toUpperCase();
    if (!await previewRoomKind(code)) return;
    await connect("join", { name: $("#nickname").value.trim(), avatar }, code);
  };
  let previewTimer;
  $("#room-code").oninput = () => {
    clearTimeout(previewTimer);
    previewRequest++;
    const code = $("#room-code").value.trim().toUpperCase();
    if (code.length === 6) previewTimer = setTimeout(() => void previewRoomKind(code), 250);
  };
  const code = $("#room-code").value.trim().toUpperCase();
  if (code.length === 6) void previewRoomKind(code);
}
async function importPhoto(file) {
  // 코드만 담은 초대 링크에서도 교실 종류를 확인한 뒤 해당 사진 화면을 연다.
  const code = $('#room-code')?.value.trim().toUpperCase();
  if (/^[A-F0-9]{6}$/.test(code) && !await previewRoomKind(code)) return;
  if (!runtimeConfig.photoAssets) {
    $('#photo-status').textContent = '지금은 사진 분석을 쓸 수 없어요. 사진 없이 직접 꾸며 주세요.';
    adjustAvatar();
    return;
  }
  if (avatarKind === 'v05') {
    photoFlow?.close();
    photoBusy = true;
    photoFlow = openPhotoResultV05({ file, avatar, dialog,
      onClose: () => {
        photoBusy = false;
        photoFlow = null;
      },
      onChoose: next => {
        avatar = next;
        photoCandidates = [];
        renderHomePreviews();
        $('#avatar-label').textContent = '사진으로 만든 나';
        $('#photo-status').textContent = '고른 캐릭터를 적용했어요. 사진은 저장하지 않았어요.';
        saveProfile();
      },
      onManual: next => adjustAvatar(next),
      onRetry: () => $('#camera-file').click()
    });
    return;
  }
  photoBusy = true;
  for (const id of ["join-submit", "take-photo", "choose-photo"]) $("#" + id).disabled = true;
  try {
    const result = await photoToAvatar(file, (message) => $("#photo-status").textContent = message, true);
    const matched = result;
    avatar = matched.avatar;
    photoCandidates = result.candidates;
    renderHomePreviews();
    $("#avatar-label").textContent = "사진으로 만든 나";
    $("#photo-status").textContent = "완성! " + (matched.reason || result.summary);
    saveProfile();
  } catch (error) {
    $("#photo-status").textContent = error.message;
    toast(error.message);
  } finally {
    photoBusy = false;
    for (const id of ["join-submit", "take-photo", "choose-photo"]) $("#" + id).disabled = false;
  }
}
function saveProfile() {
  try {
    const name = $("#nickname")?.value || saved?.name || "";
    saved = { name, avatar, avatarKind };
    sessionStorage.setItem("classroom-profile", JSON.stringify(saved));
    if (rememberAvatar) {
      remembered = { avatarKind, avatar: cleanAvatarForKind(avatar, avatarKind) };
      localStorage.setItem('classroom-avatar', JSON.stringify(remembered));
    }
  } catch {
  }
}
function adjustAvatar(initialAvatar = avatar) {
  if (initialAvatar instanceof Event) initialAvatar = avatar;
  if (photoBusy) return toast("사진 분석이 끝나면 꾸밀 수 있어요.");
  const open = avatarKind === "v05" ? openAvatarEditorV05 : openAvatarEditor;
  open({ avatar: initialAvatar, candidates: photoCandidates, dialog, onSave: (next) => {
    avatar = next;
    saveProfile();
    if ($("#avatar-preview")) renderHomePreviews();
    if (room) {
      roomOptions.avatar = avatar;
      room.send("avatar", avatar);
    }
    toast("새 캐릭터를 저장했어요.");
  } });
}
function hostDialog(returning) {
  const roomField = returning ? `
    <label>교실 코드<input id="host-code" required minlength="6" maxlength="6"
      value="${esc(new URLSearchParams(location.search).get("room") || "")}" placeholder="6자리 코드">
    </label>
  ` : `
    <label>교실 이름<input id="class-title" maxlength="28" value="우리의 교실" required>
    </label>
    <label>캐릭터 종류<select id="avatar-kind">
      <option value="v02" ${avatarKind === "v02" ? "selected" : ""}>기존 픽셀 캐릭터</option>
      <option value="v05" ${avatarKind === "v05" ? "selected" : ""}>새 캐릭터(시험판)</option>
    </select>
    </label>
  `;
  dialog(returning ? "관리자로 돌아오기" : "우리만의 교실 만들기", `
    <p class="muted">관리자는 퀴즈와 공지, 입장과 대화를 관리할 수 있어요.</p>
    <form id="host-form">${roomField}
      <label>관리자 별명<input id="host-name" name="username" autocomplete="username"
        maxlength="12" value="선생님" required>
    </label>
      <label>${cloud ? '교사용 키' : '관리자 비밀번호'}<input id="host-password" type="password"
        name="${cloud ? 'teacher-key' : 'password'}" minlength="${cloud ? 20 : 8}"
        maxlength="${cloud ? 256 : 100}" required
        autocomplete="${cloud || returning ? 'current-password' : 'new-password'}"
        placeholder="${cloud ? '배포할 때 정한 교사용 키' : '8자 이상 · 참가자에게 공유하지 마세요'}">
    </label>
      <p class="muted tiny">교실 코드와 ${cloud ? '교사용 키' : '비밀번호'}를 기억해주세요.
        관리자가 다시 들어올 때 필요해요.</p>
      <p id="host-error" class="form-error" role="alert">
    </p>
      <button class="button primary wide" type="submit">${returning ? "관리자로 입장" : "교실 열기"}</button>
    </form>
  `);
  const updateHostToken = () => {
    const code = $('#host-code')?.value.trim().toUpperCase();
    const token = code && localStorage.getItem('classroom-host-token-' + code);
    $('#host-password').required = !token;
    $('#host-password').placeholder = token ? '이 기기에 저장된 관리자 정보로 입장' :
      (cloud ? '배포할 때 정한 교사용 키' : '8자 이상 · 참가자에게 공유하지 마세요');
  };
  if (returning) {
    updateHostToken();
    $('#host-code').oninput = updateHostToken;
  }
  if (!returning) $("#avatar-kind").onchange = async (event) => {
    try {
      await selectAvatarKind(event.target.value);
      renderHomePreviews();
    } catch (error) {
      $("#host-error").textContent = error.message;
    }
  };
  $("#host-form").onsubmit = async (event) => {
    event.preventDefault();
    if (photoBusy) return toast("사진 분석이 끝나면 교실을 열어주세요.");
    const options = { name: $('#host-name').value, avatar };
    const code = returning ? $('#host-code').value.trim().toUpperCase() : null;
    const key = $('#host-password').value;
    const token = code && localStorage.getItem('classroom-host-token-' + code);
    if (returning && token && !key) options.hostToken = token;
    else options[cloud ? 'teacherKey' : 'password'] = key;
    if (!returning) {
      await selectAvatarKind($("#avatar-kind").value);
      options.avatar = avatar;
      options.avatarKind = avatarKind;
      options.title = $("#class-title").value;
    }
    await connect(returning ? "host" : "create", options, code);
  };
}
async function connect(mode, options, code) {
  const buttons = [...document.querySelectorAll('button[type="submit"]')];
  buttons.forEach((b) => b.disabled = true);
  try {
    if (mode === "join") {
      const token = localStorage.getItem('classroom-token-' + code) ||
        sessionStorage.getItem('classroom-token-' + code);
      if (token) options.resumeToken = token;
    }
    const next = mode === "create" ? 
      await client.create("classroom", options) : 
      await client.joinById(code, options);
    room = next;
    roomCode = room.roomId;
    roomOptions = { ...options };
    // 인증 원문은 재연결 옵션에 남기지 않는다. welcome에서 교실별 토큰을 받는다.
    delete roomOptions.teacherKey;
    delete roomOptions.password;
    connectMode = mode;
    intentional = false;
    kicked = false;
    roomClosed = false;
    myId = null;
    role = mode === 'join' ? 'guest' : 'host';
    snapshot = null;
    chatIds.clear();
    peopleRows.clear();
    lastAward = 0;
    saved = { name: options.name, avatar, avatarKind };
    saveProfile();
    $("#dialog")?.close();
    history.replaceState(history.state, '', `${role === 'host' ? '/teacher' : '/'}?room=${room.roomId}&avatar=${avatarKind}`);
    leaveGuard.enable();
    quizUI?.destroy();
    renderRoom();
    wireRoom(room);
    room.send("ready");
  } catch (e) {
    if (options.hostToken && e.code === 403) {
      localStorage.removeItem('classroom-host-token-' + code);
      if ($('#host-password')) $('#host-password').required = true;
    }
    const target = $("#host-error") || $("#join-error");
    if (target) target.textContent = errorText(e);
    else toast(errorText(e));
  } finally {
    buttons.forEach((b) => b.disabled = false);
  }
}
function errorText(e) {
  if (e.code === 4212 || 
    /not found|not exist|not defined|no rooms/i.test(e.message)) 
    return missingRoomMessage;
  if (/fetch|network|socket|connect/i.test(e.message)) return "서버에 연결하지 못했어요. 인터넷과 교실 서버 실행 상태를 확인해주세요.";
  return e.message || "연결하지 못했어요. 잠시 후 다시 시도해주세요.";
}
function wireRoom(r) {
  r.reconnection.minUptime = 0;
  r.reconnection.maxRetries = 12;
  r.onMessage("welcome", (m) => {
    myId = m.id;
    role = m.role;
    if (m.role === 'guest') localStorage.setItem("classroom-token-" + r.roomId, m.token);
    if (m.role === 'host') {
      localStorage.setItem('classroom-host-token-' + r.roomId, m.token);
      roomOptions.hostToken = m.token;
    }
    $("#connection-status").textContent = "연결됨";
    $("#connection-status").classList.remove("offline");
  });
  r.onMessage("snapshot", (s) => {
    snapshot = s;
    const self = s.people.find(p => p.id === myId);
    if (self) world?.correctPosition(self);
    void applyRoomSnapshot(r);
  });
  for (const type of ['delta', 'chatLine']) r.onMessage(type, message => {
    snapshot = applyClassroomMessage(snapshot, type, message);
    if (!snapshot || !world) return;
    if (type === 'chatLine') renderChat(snapshot.chat);
    else renderState(true);
  });
  r.onMessage("positions", (p) => {
    applyClassroomMessage(snapshot, 'positions', p);
    world?.positions(p);
  });
  r.onMessage('moveRejected', p => {
    applyClassroomMessage(snapshot, 'positions', [p]);
    world?.correctPosition(p);
  });
  r.onDrop(() => {
    audio.stopAll();
    championFx.close();
    coopView?.close();
    $('#connection-status').textContent = '자동 재연결 중';
    $('#connection-status').classList.add('offline');
    $('#chat-send').disabled = true;
  });
  r.onReconnect(() => r.send('ready'));
  r.onMessage("notice", toast);
  // 협동 게임방: 위치·정정·일어난 일·응원(설계: Handoff/설계_협동게임방.md)
  r.onMessage('coopPos', m => coopView?.positions(m));
  r.onMessage('coopCorrect', m => coopView?.correct(m));
  r.onMessage('coopEvent', m => coopView?.event(m));
  r.onMessage('coopCheers', m => coopView?.cheers(m));
  r.onMessage("bubble", (m) => world?.bubble(m.id, m.text));
  r.onMessage(
    "reaction", 
    (m) => world?.bubble(m.id, { hello: "반가워요!", heart: "좋아요!", clap: "짝짝짝!", hand: "질문 있어요!" }[m.kind])
  );
  r.onMessage("answerAccepted", () => {});
  r.onMessage("kicked", (m) => {
    kicked = true;
    toast(m);
  });
  r.onMessage('roomClosed', () => {
    roomClosed = true;
    // 닫힌 교실에는 재연결하지 않는다. 연결이 끊기면 SDK가 바로 onLeave를 부른다.
    r.reconnection.enabled = false;
  });
  r.onLeave(code => {
    audio.stopAll();
    championFx.close();
    coopView?.close();
    if (intentional) return;
    const roomGone = code === 4001 || roomClosed;
    if (roomGone || kicked) leaveGuard.disable();
    $("#connection-status").textContent = kicked ? "퇴장됨" : "연결 끊김";
    $("#connection-status").classList.add("offline");
    $("#chat-send").disabled = true;
    dialog(kicked ? 
      "교실에서 퇴장했어요" : 
      "교실 연결이 끊겼어요", `<p>${kicked ? 
      "관리자에게 문의해주세요." : roomGone ? '선생님 화면의 새 QR을 찍어 주세요.' :
      "다시 연결하면 기존 점수와 제출한 답을 이어갈 수 있어요."}</p>
    <button class="button primary wide" id="reconnect">${kicked || roomGone ? '입장 화면으로' : '다시 연결'}</button>`);
    $("#reconnect").onclick = async () => {
      if (kicked || roomGone) {
        if (roomGone) {
          localStorage.removeItem('classroom-host-token-' + roomCode);
          history.replaceState({}, '', role === 'host' ? '/teacher' : '/');
        }
        $("#dialog")?.close();
        leave();
        return;
      }
      const b = $("#reconnect");
      b.disabled = true;
      const retry = { ...roomOptions };
      if (role === "guest") retry.resumeToken = localStorage.getItem("classroom-token-" + roomCode);
      world?.destroy();
      world = null;
      await connect(role === "host" ? "host" : "join", retry, roomCode);
      if ($("#reconnect")) $("#reconnect").disabled = false;
    };
  });
  r.onError((_, message) => toast(message));
}
function renderRoom() {
  championFx.close();
  coopView?.destroy();
  coopView = null;
  coopLoading = null;
  roomSoundControl?.destroy();
  audio.stopAll();
  audio.setRole(role);
  document.body.className = role === 'guest' ? 'in-room student-immersive' : 'in-room';
  updateStudentViewport();
  $("#app").innerHTML = `<div class="classroom-app">
    ${role === 'guest' ? '<nav class="student-tools" aria-label="교실 화면 설정"><button id="student-fullscreen">전체화면</button><button id="student-menu" aria-expanded="false">메뉴</button></nav>' : ''}
    <header class="class-header">
    <div class="brand">${icon("door")}<span id="class-name">우리의 교실</span>
    </div>
    <span class="room-tag">교실 <b>${esc(room.roomId)}</b>
    </span>
    <span id="connection-status" class="connection">연결 중</span>
    <div class="header-actions">
    <button class="button light compact" id="room-avatar" aria-label="내 캐릭터 꾸미기">${icon("people")}<span>내 캐릭터</span>
    </button>
    <button class="button light compact" id="invite">${icon("qr")} <span>초대</span>
    </button>
    <button class="button light compact" id="toggle-panel">${icon(role === "host" ? 
      "settings" : 
      "crown")}<span>${role === "host" ? 
      "관리자" : 
      "순위"}</span>
    </button>
    <button class="text-button" id="leave">나가기</button>
    </div>
    </header>
  <div id="announcement" class="announcement" hidden>
    </div>
  <main class="class-main">
    <section class="space">
    <div class="space-bar">
    <span>${icon("people")} <b id="online-count">0</b>명 함께하는 중</span>
    <span class="movement-hint">바닥을 누르거나 방향키로 이동해요</span>
    <span class="live-pill">LIVE</span>
    </div>
    <div class="stage-wrap">
    <div id="game" role="img" aria-label="모두의 아바타가 보이는 교실. 바닥을 누르거나 방향키로 이동합니다.">
    </div>
    <div class="camera-controls" aria-label="교실 화면 확대">
      <span class="pinch-hint">두 손가락으로 확대</span>
      <button type="button" id="zoom-out" aria-label="교실 축소">−</button>
      <button type="button" id="zoom-reset" aria-label="기본 크기로 돌아가기"><span id="zoom-level">100%</span></button>
      <button type="button" id="zoom-in" aria-label="교실 확대">+</button>
    </div>
    <div id="winner-banner" class="winner-banner" hidden>
    </div>
    </div>
    <div id="quiz-zone" hidden>
    </div>
    <div class="reaction-bar">
    <span>마음을 전해요</span>
    <button data-reaction="hello">안녕!</button>
    <button data-reaction="heart">좋아요</button>
    <button data-reaction="clap">박수</button>
    <button data-reaction="hand">손들기</button>
    </div>
    </section>
  <aside id="side-panel" class="side-panel" ${role === "host" ? "" : "hidden"}>
    <div class="panel-title">
    <div>
    <span class="eyebrow">${role === "host" ? "TEACHER’S DESK" : "CLASS LEADERBOARD"}</span>
    <h2>${role === "host" ? "교실 운영" : "우리의 순위"}</h2>
    </div>
    <button class="icon-button" id="close-panel" aria-label="패널 닫기">${icon("close")}</button>
    </div>${role === "host" ? hostPanel() : ""}<section class="panel-section">
    <div class="section-heading">
    <h3>참가자와 순위</h3>
    <span id="participant-total">
    </span>
    </div>
    <p class="tiny muted">정답 수 우선 · 동점이면 정답 제출 시간 합계순</p>
    <div id="people-list">
    </div>
    </section>
    </aside>
    </main>
  <section class="chat-panel" aria-label="교실 대화">
    <div class="chat-heading">
    <h2>${icon("chat")} 교실 대화</h2>
    <span id="chat-state">모두에게 보이는 대화예요</span>
    </div>
    <div id="chat-messages" class="chat-messages" role="log" aria-live="polite"
    aria-relevant="additions">
    </div>
    <form id="chat-form">
    <input id="chat-input" maxlength="180" placeholder="친구들에게 이야기를 건네보세요…" aria-label="대화 내용"
    autocomplete="off">
    <button id="chat-send" class="button primary compact" type="submit">보내기 ${icon("arrow")}</button>
    </form>
    </section>
    </div>`;
  worldKind = null;
  if (role === 'guest') {
    $('#student-fullscreen').onclick = () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) void exitFullscreen();
      else void enterFullscreen(toast);
    };
    $('#student-menu').onclick = () => {
      const open = document.body.classList.toggle('student-menu-open');
      $('#student-menu').setAttribute('aria-expanded', String(open));
      $('#student-menu').textContent = open ? '메뉴 닫기' : '메뉴';
      if (!open) $('#side-panel').hidden = true;
      window.dispatchEvent(new Event('resize'));
    };
  }
  $("#toggle-panel").onclick = () => {
    $("#side-panel").hidden = !$("#side-panel").hidden;
    renderPeople();
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
  };
  $("#close-panel").onclick = () => {
    $("#side-panel").hidden = true;
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
  };
  $("#invite").onclick = inviteDialog;
  $("#room-avatar").onclick = adjustAvatar;
  $('#zoom-in').onclick = () => world?.zoomBy(1.25);
  $('#zoom-out').onclick = () => world?.zoomBy(.8);
  $('#zoom-reset').onclick = () => world?.resetZoom();
  $("#leave").onclick = confirmRoomLeave;
  $("#chat-form").onsubmit = (e) => {
    e.preventDefault();
    const input = $("#chat-input");
    if (input.value.trim()) {
      room.send("chat", input.value);
      input.value = "";
      input.focus();
    }
  };
  document.querySelectorAll("[data-reaction]")
    .forEach((b) => b.onclick = () => room.send("reaction", b.dataset.reaction));
  if (role === "host") wireHost();
  quizUI = createQuizUI({
    room, viewer: { id: myId, role }, avatarCanvas: cachedAvatarCanvas, content, toast,
    onCover: setQuizCovered, audio,
  });
  roomSoundControl = createSoundControl(audio);
  $(role === 'guest' ? '.student-tools' : '.header-actions').prepend(roomSoundControl.button);
  // 게임방 코드는 첫 화면이 다 뜬 뒤 한가할 때 미리 받아 둔다(선생님이 열면 바로 뜨게).
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
  idle(() => void loadCoopView(), { timeout: 4000 });
}
function loadCoopView() {
  if (coopView || coopLoading) return coopLoading;
  const forRoom = room;
  coopLoading = import('./coop/coop-view.js').then(({ createCoopView }) => {
    if (room !== forRoom || coopView) return;
    coopView = createCoopView({
      // 교실 화면은 welcome(내 id)보다 먼저 그려지므로 id·역할은 늘 최신 값을 읽게 한다.
      viewer: { get id() { return myId; }, get role() { return role; } },
      send: (type, message) => room?.send(type, message), admin,
      avatarCanvas: cachedAvatarCanvas, audio, onCover: setQuizCovered, clock: createServerClock(room),
    });
    // 개발 서버에서만 브라우저 검사가 게임방 상태를 읽을 수 있게 둔다(배포 빌드에서는 빠진다).
    if (import.meta.env.DEV) window.__coopView = coopView;
    renderState(true);
  }).catch(() => {
    coopLoading = null;
    toast('게임방 화면을 불러오지 못했어요. 새로고침해 주세요.');
  });
  return coopLoading;
}
function confirmRoomLeave() {
    dialog("교실에서 나갈까요?", `<p>${role === "host" ? 
      `교실은 계속 열려 있어요. 코드와 ${cloud ? '교사용 키' : '비밀번호'}로 다시 관리할 수 있습니다.` :
      "같은 창에서 다시 들어오면 점수를 이어갈 수 있어요."}</p>
    <button class="button primary wide" id="stay-in-room">계속 참여하기</button>
    <button class="button light wide" id="confirm-leave">나가기</button>
    ${role === 'host' ? '<button class="button danger wide" id="close-room">모두 퇴장하고 교실 닫기</button>' : ''}`);
    $('#stay-in-room').onclick = () => $('#dialog').close();
    if ($('#close-room')) $('#close-room').onclick = () => {
      dialog('교실을 닫을까요?', '<p>모두 퇴장하며 점수와 대화가 사라져요.</p>' +
        '<button class="button danger wide" id="confirm-close-room">교실 닫기</button>');
      $('#confirm-close-room').onclick = () => admin('closeRoom');
    };
    $("#confirm-leave").onclick = () => {
      $("#dialog").close();
      leave();
    };
}
function setQuizCovered(covered) {
  quizCovered = covered;
  cancelAnimationFrame(quizCoverFrame);
  const container = $('#game');
  if (!container) return;
  // 기존 씬이 공개한 참조로 렌더 루프만 쉰다. 네트워크 상태 갱신은 계속 받는다.
  const apply = () => {
    if ($('#game') !== container) return;
    const game = container.classroomScene?.game;
    if (!game?.isRunning) {
      quizCoverFrame = requestAnimationFrame(apply);
      return;
    }
    if (covered && game.loop.running) game.loop.sleep();
    else if (!covered && !game.loop.running) game.loop.wake();
  };
  apply();
}
function hostPanel() {
  return `<section class="panel-section" id="quiz-admin"></section>
  <section class="panel-section controls">
    <div class="section-heading">
    <h3>공간 관리</h3>
    <span class="host-badge">관리자</span>
    </div>
    <label class="switch-row">새로운 입장 허용<input id="admission" type="checkbox" checked role="switch">
    </label>
    <label class="switch-row">참가자 채팅 허용<input id="allow-chat" type="checkbox" checked role="switch">
    </label>
    <form id="announce-form">
    <label>칠판 위 공지<input id="announce-text" maxlength="140" placeholder="모두에게 알려줄 내용을 적어요">
    </label>
    <button class="button soft wide" type="submit">공지 게시</button>
    </form>
    </section>
  <section class="panel-section">
    <div class="section-heading">
    <h3>오늘의 하이라이트</h3>
    </div>
    <button class="button gold wide" id="award">${icon("crown")} 1등 발표하기</button>
    <button class="button soft wide" id="coop-open">협동 게임방 열기 (1~5등)</button>
    <button class="text-button tiny" id="reset-score">점수 초기화</button>
    </section>`;
}
function wireHost() {
  $("#admission").onchange = (e) => admin("lock", { value: !e.target.checked });
  $("#allow-chat").onchange = (e) => admin("chat", { value: e.target.checked });
  $("#announce-form").onsubmit = (e) => {
    e.preventDefault();
    admin("announcement", { text: $("#announce-text").value });
    toast("공지를 반영했어요.");
  };
  $("#award").onclick = () => admin("award");
  $("#coop-open").onclick = () => admin("coopOpen");
  $("#reset-score").onclick = () => {
    dialog(
      "점수를 처음부터 시작할까요?", 
      '<p>모든 참가자의 누적 점수와 현재 퀴즈 결과가 지워집니다.</p><button id="confirm-reset" class="button primary wide">점수 초기화</button>'
    );
    $("#confirm-reset").onclick = () => {
      admin("reset");
      $("#dialog").close();
    };
  };
}
function renderState(live = false) {
  const s = snapshot;
  if (!s || !$("#class-name")) return;
  $("#class-name").textContent = s.title;
  $("#online-count").textContent = s.people.filter((p) => p.connected).length;
  $("#announcement").hidden = !s.announcement;
  $("#announcement").textContent = s.announcement;
  world.update(s.people);
  if (role === "host") {
    $("#admission").checked = !s.locked;
    $("#allow-chat").checked = s.chatOpen;
  }
  const me = s.people.find((p) => p.id === myId);
  const canChat = role === "host" || s.chatOpen && !me?.muted;
  $("#chat-input").disabled = !canChat;
  $("#chat-send").disabled = !canChat;
  $("#chat-state").textContent = canChat ? "모두에게 보이는 대화예요" : "관리자가 채팅을 잠시 쉬도록 설정했어요";
  renderChat(s.chat);
  renderPeople();
  $("#winner-banner").hidden = !s.winner;
  if (s.winner) {
    $("#winner-banner").innerHTML = `${icon("crown")}<span>오늘의 1등<strong>${esc(s.winner.names.join(" · "))}</strong>
    </span>
    <b>${Number.isFinite(s.winner.points) ? `${s.winner.points.toLocaleString('ko-KR')}점` : `${s.winner.score}문제 정답`}</b>`;
    if (lastAward !== s.winner.announcedAt && !s.coop) {
      lastAward = s.winner.announcedAt;
      quizUI?.clearPresentation();
      // 선생님 화면의 시상식에는 '협동 게임방 열기' 버튼을 같이 둔다.
      championFx.show(s.winner, { replay: live, onCoop: role === 'host' ? () => admin('coopOpen') : null });
    }
  } else if ($('#champion-finale')) championFx.close();
  // 협동 게임방이 열리면 시상식을 닫고 게임방 화면을 덮는다. 닫히면 교실로 돌아온다.
  if (s.coop) {
    if ($('#champion-finale')) championFx.close();
    if (!coopView) void loadCoopView();
    coopView?.update(s.coop);
    if (coopView?.open) setQuizCovered(true);
  } else coopView?.update(null);
}
function managePerson(id) {
  const p = snapshot.people.find((p2) => p2.id === id);
  dialog(`${p.name} 관리`, `<p>이 참가자의 교실 이용을 관리해요.</p>
    <button id="mute-person" class="button soft wide">${p.muted ? "채팅 다시 허용" : "이 참가자의 채팅 제한"}</button>
    <button id="rename-person" class="button light wide">별명 바꾸기 → 학생 번호</button>
    <button id="kick-person" class="button danger wide">교실에서 퇴장시키기</button>
    <p class="tiny muted">퇴장한 참가자의 현재 접속은 차단됩니다. 새로운 입장도 막으려면 입장 허용을 꺼주세요.</p>`);
  $("#mute-person").onclick = () => {
    admin("mute", { id, value: !p.muted });
    $("#dialog").close();
  };
  $('#rename-person').onclick = () => {
    admin('rename', { id });
    $('#dialog').close();
  };
  $("#kick-person").onclick = () => {
    admin("kick", { id });
    $("#dialog").close();
  };
}
async function inviteDialog() {
  const data = cloud ? { addresses: [] } :
    await fetch('/api/addresses').then(r => r.json()).catch(() => ({ addresses: [] }));
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  const origins = [...new Set(local ? [...data.addresses, location.origin] : [location.origin])];
  dialog("우리 교실로 초대하기", `<p class="muted">QR을 찍거나 주소를 열면 같은 교실로 입장해요.</p>
    <div class="invite-code">${esc(room.roomId)}</div>
    <canvas id="qr-canvas">
    </canvas>
    <label ${cloud ? 'hidden' : ''}>접속 주소<select id="invite-origin">${origins
      .map((o) => `<option>${esc(o)}</option>`).join("")}</select>
    </label>
    <input id="invite-url" readonly aria-label="초대 링크">
    <button class="button primary wide" id="copy-invite">초대 링크 복사</button>
    <p class="tiny muted">${cloud ? '휴대폰 데이터(LTE)나 어느 와이파이에서도 들어올 수 있어요.' : local ?
      "같은 와이파이에서는 PC의 네트워크 주소를 선택하세요. 학교망의 기기 간 통신 제한이나 PC 방화벽에 따라 접속이 막힐 수 있어요. 인터넷 어디서나 접속하려면 서버 배포가 필요합니다." : 
      "교실 코드만 공유하면 관리자 비밀번호는 전달되지 않아요."}</p>`);
  const update = async () => {
    const url = cloud ? `${location.origin}/?room=${room.roomId}` :
      $('#invite-origin').value + '/?room=' + room.roomId + '&avatar=' + avatarKind;
    $("#invite-url").value = url;
    await QRCode.toCanvas(
      $("#qr-canvas"), 
      url, 
      { width: cloud ? 320 : 220, errorCorrectionLevel: 'M', margin: 2,
        color: { dark: '#214e48', light: '#fffdf5' } }
    );
  };
  $("#invite-origin").onchange = update;
  await update();
  $("#copy-invite").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("#invite-url").value);
      toast("초대 링크를 복사했어요.");
    } catch {
      $("#invite-url").select();
      toast("주소를 선택했어요. 길게 누르거나 Ctrl+C로 복사해주세요.");
    }
  };
}
function leave() {
  leaveGuard.disable();
  audio.stopAll();
  roomSoundControl?.destroy();
  roomSoundControl = null;
  championFx.close();
  coopView?.destroy();
  coopView = null;
  coopLoading = null;
  void exitFullscreen();
  quizUI?.destroy();
  quizUI = null;
  intentional = true;
  room?.leave();
  world?.destroy();
  room = null;
  world = null;
  snapshot = null;
  renderHome();
}
let previewRequest = 0;
async function previewRoomKind(code) {
  const request = ++previewRequest;
  try {
    const response = await fetch(`/matchmake/avatarKind/${encodeURIComponent(code)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!response.ok) throw new Error(missingRoomMessage);
    const data = await response.json();
    if (request !== previewRequest || !$('#room-code') ||
      $('#room-code').value.trim().toUpperCase() !== code) return false;
    await selectAvatarKind(data.avatarKind === 'v05' ? 'v05' : 'v02');
    if (request !== previewRequest || !$('#avatar-preview')) return false;
    renderHomePreviews();
    $('#join-error').textContent = '';
    return true;
  } catch (error) {
    if (request === previewRequest && $('#join-error')) $('#join-error').textContent = error.message;
    return false;
  }
}

async function selectAvatarKind(kind) {
  if (kind !== avatarKind) photoFlow?.close();
  if (kind === "v05") await loadAvatarV05();
  if (kind !== avatarKind) {
    avatarKind = kind;
    const fromMemory = rememberAvatar && remembered?.avatarKind === kind;
    avatar = cleanAvatarForKind(fromMemory ? remembered.avatar : avatar, kind);
    if (kind === "v05" && !fromMemory) avatar = colorfulAvatarV05();
    photoCandidates = [];
  }
}
function renderHomePreviews() {
  drawAvatarForKind($("#avatar-preview"), avatar, avatarKind);
  const canvas = drawClassroom($("#room-preview"));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = avatarKind === "v05";
  const people = [
    { x: 384, y: 390, avatar },
    { 
      x: 744, 
      y: 399, 
      avatar: avatarKind === "v05" ? 
        { ...avatar, top: "sky", glasses: false } : 
        { ...DEFAULT_AVATAR, style: 2, shirt: PALETTE[2] } 
    },
    { 
      x: 570, 
      y: 566, 
      avatar: avatarKind === "v05" ? 
        { ...avatar, hair: "chestnut", top: "green" } : 
        { ...DEFAULT_AVATAR, glasses: true, shirt: PALETTE[1], style: 3 } 
    }
  ];
  for (const person of people) {
    const source = cachedAvatarCanvas(person.avatar, avatarKind);
    if (avatarKind === "v05") {
      const scale = TEMPLATE.displayHeight / TEMPLATE.characterHeight;
      ctx.drawImage(
        source,
        person.x - TEMPLATE.feet[0] * scale,
        person.y - TEMPLATE.feet[1] * scale,
        TEMPLATE.width * scale,
        TEMPLATE.height * scale
      );
    } else ctx.drawImage(source, person.x - 36, person.y - 96, 72, 96);
  }
}
async function applyRoomSnapshot(sourceRoom) {
  if (roomRenderPending) return;
  roomRenderPending = true;
  try {
    const kind = snapshot.avatarKind === "v05" ? "v05" : "v02";
    await selectAvatarKind(kind);
    if (room !== sourceRoom) return;
    if (!world || worldKind !== kind) {
      world?.destroy();
      world = createClassroom(
        $("#game"), 
        { me: () => myId, canMove: () => !!room?.connection?.isOpen && !room.reconnection.isReconnecting,
          move: p => {
            // SDK의 오프라인 큐에 이동을 넣지 않는다. 다음 프레임에서 마지막 위치만 다시 시도한다.
            if (!room?.connection?.isOpen || room.reconnection.isReconnecting ||
                room.connection.transport.ws?.bufferedAmount > 0) return false;
            room.send('move', p);
            return true;
          }, avatarKind: kind }
      );
      worldKind = kind;
      requestAnimationFrame(() => setQuizCovered(quizCovered));
    }
    const self = snapshot.people.find((person) => person.id === myId);
    if (self) avatar = cleanAvatarForKind(self.avatar, kind);
    history.replaceState(history.state, '', `${role === 'host' ? '/teacher' : '/'}?room=${room.roomId}&avatar=${kind}`);
    renderState();
  } catch (error) {
    toast(error.message);
  } finally {
    roomRenderPending = false;
  }
}
function renderChat(messages) {
  // 기존 줄은 건드리지 않아 스크롤·선택·접근성 읽기 위치를 유지한다.
  const box = $("#chat-messages");
  const unseen = messages.filter((message) => !chatIds.has(message.id));
  if (!unseen.length) return;
  const bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 45;
  const fragment = document.createDocumentFragment();
  for (const message of unseen) {
    const row = document.createElement("div");
    row.className = `chat-line ${message.system ? "system" : ""} ${message.playerId === myId ? "mine" : ""}`;
    row.dataset.chatId = message.id;
    const time = new Date(message.time).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    row.innerHTML = (message.system ? 
      "" : 
      `<b class="${message.host ? 
      "teacher-name" : 
      ""}">${esc(message.name)}</b>`) + `<span>${esc(message.text)}</span>
    <time>${time}</time>`;
    fragment.append(row);
    chatIds.add(message.id);
  }
  box.append(fragment);
  while (box.children.length > 80) {
    chatIds.delete(box.firstElementChild.dataset.chatId);
    box.firstElementChild.remove();
  }
  if (bottom || messages.at(-1)?.playerId === myId) box.scrollTop = box.scrollHeight;
}
function renderPeople() {
  // 숨겨진 패널은 snapshot만 보관하고, 열 때 최신 행을 한 번 반영한다.
  if (!snapshot || $("#side-panel").hidden) return;
  const list = snapshot.people.filter((person) => person.role === "guest");
  // 순위는 점수 합계(빠를수록 높고 틀리면 0점) → 맞힌 수 → 걸린 시간
  list.sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || b.score - a.score || a.elapsed - b.elapsed);
  $("#participant-total").textContent = `${list.length}명`;
  const container = $("#people-list");
  const ids = new Set(list.map((person) => person.id));
  for (const [id, entry] of peopleRows) {
    if (ids.has(id)) continue;
    entry.row.remove();
    peopleRows.delete(id);
  }
  container.querySelector(".empty-list")?.remove();
  list.forEach((person, index) => {
    const appearance = JSON.stringify(person.avatar);
    const key = JSON.stringify([index, person.name, person.score, person.points, person.firsts, person.connected, person.muted]);
    let entry = peopleRows.get(person.id);
    if (!entry) {
      const row = document.createElement("div");
      row.className = "person-row";
      row.dataset.personId = person.id;
      row.innerHTML = `<span class="rank">
    </span>
    <canvas class="mini-avatar">
    </canvas>
        <div class="person-name">
    <b>
    </b>
    <small>
    </small>
    </div>
    <strong>
    </strong>`;
      if (role === "host") {
        const button = document.createElement("button");
        button.className = "icon-button person-manage";
        button.setAttribute("aria-label", person.name + " 관리");
        button.innerHTML = icon("settings");
        button.onclick = () => managePerson(person.id);
        row.append(button);
      }
      entry = { row };
      peopleRows.set(person.id, entry);
    }
    if (entry.key !== key) {
      entry.row.querySelector(".rank").textContent = index + 1;
      entry.row.querySelector(".person-name b").textContent = person.name + (person.id === myId ? 
        " (나)" : 
        "");
      entry.row.querySelector(".person-name small").textContent = (person.connected ? 
        "접속 중" : 
        "잠시 자리 비움") + (person.muted ? 
        " · 채팅 제한" : 
        "");
      entry.row.querySelector("strong").innerHTML = `${(person.points ?? 0).toLocaleString('ko-KR')}<small>점</small>`;
      entry.row.querySelector('.person-name small').textContent += ` · 정답 ${person.score} · 1등 ${person.firsts || 0}회`;
      entry.row.querySelector('.person-manage')?.setAttribute('aria-label', person.name + ' 관리');
      entry.key = key;
    }
    if (entry.appearance !== appearance) {
      drawAvatarForKind(entry.row.querySelector("canvas"), person.avatar, avatarKind);
      entry.appearance = appearance;
    }
    const current = container.children[index];
    if (current !== entry.row) container.insertBefore(entry.row, current || null);
  });
  if (!list.length) container.innerHTML = '<p class="empty-list">초대 코드로 친구들을 불러보세요.</p>';
}
renderHome();
