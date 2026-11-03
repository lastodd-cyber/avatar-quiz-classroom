import Phaser from 'phaser';
import { drawClassroom, spriteSheet, cachedAvatarCanvas, avatarAppearanceKey } from './art.js';
import { DIRECTIONS } from '../shared/avatar-catalog.js';
import { TEMPLATE } from '../shared/avatar-v05.js';
import { WORLD, walkable } from '../shared/world.js';

export const MOBILE_CAMERA_ZOOM = 2;
const MOBILE_BREAKPOINT = 768;
const V05_SCALE = TEMPLATE.displayHeight / TEMPLATE.characterHeight;

export function createClassroom(container, { me, move, canMove = () => true, avatarKind = 'v02' }) {
  let scene;
  let pending = [];
  let lastSend = 0;
  let lastSentPosition = null;
  let userZoom = 1;
  const v05 = avatarKind === 'v05';

  class ClassroomScene extends Phaser.Scene {
    create() {
      scene = this;
      this.actors = new Map();
      this.target = null;
      this.textureSerial = 0;
      this.avatarTextures = new Map();
      this.textures.addCanvas('room', drawClassroom(document.createElement('canvas')));
      this.add.image(0, 0, 'room').setOrigin(0);
      this.marker = this.add.ellipse(0, 0, 30, 12).setStrokeStyle(2, 0x568d86, .6).setVisible(false);
      this.input.on('pointerdown', pointer => {
        if (pointer.wasTouch) return; // 터치는 탭과 두 손가락 확대를 구분한 뒤 처리한다.
        // pointer.worldX는 직전 프레임의 카메라일 수 있으므로 현재 카메라로 다시 변환한다.
        const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        if (!walkable(point.x, point.y)) return;
        this.target = { x: point.x, y: point.y };
        this.marker.setPosition(point.x, point.y).setVisible(true);
      });
      this.keys = this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D');
      this.input.keyboard.disableGlobalCapture();
      this.scale.on('resize', this.configureCamera, this);
      this.updatePeople(pending);
      this.configureCamera();
      const removeTouch = this.bindTouchZoom();
      // 자동 검증에서도 실제 화면과 동일한 씬을 관찰할 수 있다.
      container.classroomScene = this;
      this.events.once('shutdown', () => {
        delete container.classroomScene;
        this.scale.off('resize', this.configureCamera, this);
        removeTouch();
      });
    }

    configureCamera() {
      const camera = this.cameras.main;
      const self = this.actors.get(me());
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      const immersive = document.body.classList.contains('student-immersive');
      camera.stopFollow();
      camera.setBounds(0, 0, WORLD.width, WORLD.height);
      const baseZoom = Math.max(mobile ? MOBILE_CAMERA_ZOOM : 1, immersive ? this.scale.height / WORLD.height : 1);
      camera.setZoom(baseZoom * userZoom);
      if ((mobile || immersive || userZoom !== 1) && self) camera.startFollow(self.group, false, 1, 1);
      else camera.centerOn(WORLD.width / 2, WORLD.height / 2);
      const label = document.querySelector('#zoom-level');
      if (label) label.textContent = `${Math.round(userZoom * 100)}%`;
    }

    setUserZoom(value) {
      userZoom = Phaser.Math.Clamp(value, .75, 2.5);
      this.configureCamera();
    }

    bindTouchZoom() {
      const canvas = this.game.canvas;
      let start = null, pinched = false, distance = 0, initialZoom = 1;
      const span = touches => Math.hypot(touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY);
      const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
      const down = event => {
        stop(event);
        if (!canMove()) return;
        if (event.touches.length === 1) {
          const point = event.touches[0];
          start = { x: point.clientX, y: point.clientY, at: performance.now(), moved: false };
          pinched = false;
        } else if (event.touches.length >= 2) {
          pinched = true;
          distance = span(event.touches);
          initialZoom = userZoom;
          this.target = null;
          this.marker.setVisible(false);
        }
      };
      const drag = event => {
        stop(event);
        if (!canMove()) return;
        if (event.touches.length >= 2 && distance > 0) {
          this.setUserZoom(initialZoom * span(event.touches) / distance);
        } else if (start && event.touches[0]) {
          start.moved ||= Math.hypot(event.touches[0].clientX - start.x, event.touches[0].clientY - start.y) > 12;
        }
      };
      const up = event => {
        stop(event);
        if (!event.touches.length) {
          if (!pinched && start && !start.moved && performance.now() - start.at < 600 && canMove()) {
            const rect = canvas.getBoundingClientRect();
            const point = this.cameras.main.getWorldPoint((start.x - rect.left) * this.scale.width / rect.width,
              (start.y - rect.top) * this.scale.height / rect.height);
            if (walkable(point.x, point.y)) {
              this.target = point;
              this.marker.setPosition(point.x, point.y).setVisible(true);
            }
          }
          start = null;
          distance = 0;
        }
      };
      const cancel = event => { stop(event); start = null; distance = 0; pinched = true; };
      const listeners = { touchstart: down, touchmove: drag, touchend: up, touchcancel: cancel };
      for (const [type, handler] of Object.entries(listeners)) canvas.addEventListener(type, handler, { capture: true, passive: false });
      return () => {
        for (const [type, handler] of Object.entries(listeners)) canvas.removeEventListener(type, handler, true);
      };
    }

    acquireTexture(avatar) {
      const key = avatarAppearanceKey(avatar, avatarKind);
      let entry = this.avatarTextures.get(key);
      if (!entry) {
        const id = `avatar-${++this.textureSerial}`;
        const canvas = v05 ? cachedAvatarCanvas(avatar, avatarKind) : spriteSheet(avatar);
        const texture = this.textures.addCanvas(id, canvas);
        const filter = v05 ? Phaser.Textures.FilterMode.LINEAR : Phaser.Textures.FilterMode.NEAREST;
        texture.setFilter(filter);
        if (!v05) {
          for (let row = 0; row < 4; row++) {
            for (let frame = 0; frame < 4; frame++) {
              texture.add(row * 4 + frame, 0, frame * 48, row * 64, 48, 64);
            }
          }
        }
        entry = { id, users: 0 };
        this.avatarTextures.set(key, entry);
      }
      entry.users++;
      return { key, id: entry.id };
    }

    releaseTexture(key) {
      const entry = this.avatarTextures.get(key);
      if (!entry || --entry.users > 0) return;
      this.textures.remove(entry.id);
      this.avatarTextures.delete(key);
    }

    updatePeople(people) {
      const ids = new Set();
      let selfAdded = false;
      for (const p of people) {
        if (!p.connected) continue;
        ids.add(p.id);
        let actor = this.actors.get(p.id);
        const key = avatarAppearanceKey(p.avatar, avatarKind);
        if (!actor) {
          const texture = this.acquireTexture(p.avatar);
          const isMe = p.id === me();
          const shadow = this.add.ellipse(0, v05 ? -3 : -5, v05 ? 43 : 38, 13,
            isMe ? 0x4b8277 : 0x665641, isMe ? .30 : .12);
          const sprite = this.add.image(0, v05 ? 0 : -38, texture.id, v05 ? undefined : 0);
          if (v05) {
            sprite.setOrigin(TEMPLATE.feet[0] / TEMPLATE.width, TEMPLATE.feet[1] / TEMPLATE.height);
            sprite.setScale(V05_SCALE);
          } else {
            sprite.setDisplaySize(57, 76);
          }
          const label = this.add.text(0, v05 ? 5 : 0, `${p.role === 'host' ? '관리자 · ' : ''}${p.name}`, {
            fontFamily: 'Pretendard', fontSize: '12px', color: '#ffffff', stroke: '#36322e',
            strokeThickness: 2, padding: { x: 3, y: 0 }
          }).setOrigin(.5, 0);
          const group = this.add.container(p.x, p.y, [shadow, sprite, label]);
          if (isMe) {
            const markY = v05 ? -TEMPLATE.displayHeight - 14 : -88;
            group.add(this.add.triangle(0, markY, 0, 0, 10, 0, 5, 7, 0x387668));
            selfAdded = true;
          }
          actor = { group, sprite, label, tx: p.x, ty: p.y, dir: p.direction || 'down', avatarKey: key };
          this.actors.set(p.id, actor);
        } else if (actor.avatarKey !== key) {
          const texture = this.acquireTexture(p.avatar);
          actor.sprite.setTexture(texture.id, v05 ? undefined : 0);
          this.releaseTexture(actor.avatarKey);
          actor.avatarKey = key;
        }
        actor.tx = p.x;
        actor.ty = p.y;
      }
      for (const [id, actor] of this.actors) {
        if (ids.has(id)) continue;
        actor.group.destroy();
        this.releaseTexture(actor.avatarKey);
        this.actors.delete(id);
      }
      if (selfAdded) this.configureCamera();
    }

    positions(people) {
      for (const p of people) {
        const actor = this.actors.get(p.id);
        if (!actor) continue;
        actor.tx = p.x;
        actor.ty = p.y;
        if (p.id !== me() && DIRECTIONS.includes(p.direction)) actor.dir = p.direction;
        if (p.id === me() && Math.hypot(actor.group.x - p.x, actor.group.y - p.y) > 85) {
          actor.group.setPosition(p.x, p.y);
        }
      }
    }

    correctPosition(p) {
      const actor = this.actors.get(p.id);
      if (!actor) return;
      actor.group.setPosition(p.x, p.y);
      actor.tx = p.x;
      actor.ty = p.y;
      if (p.id === me()) {
        this.target = null;
        this.marker.setVisible(false);
        lastSentPosition = { x: p.x, y: p.y, direction: p.direction };
      }
    }

    bubble(id, message) {
      const actor = this.actors.get(id);
      if (!actor) return;
      actor.bubble?.destroy();
      const short = message.length > 40 ? message.slice(0, 40) + '…' : message;
      const text = this.add.text(0, 0, short, {
        fontFamily: 'Pretendard', fontSize: '15px', color: '#38343a',
        padding: { x: 10, y: 8 }, wordWrap: { width: 180 }, align: 'center'
      }).setOrigin(.5, 1);
      const width = text.width;
      const height = text.height;
      const border = this.add.graphics();
      border.fillStyle(0x302e35, 1);
      border.fillRect(-width / 2 - 2, -height - 2, width + 4, height + 4);
      border.fillTriangle(-5, 0, 5, 0, 0, 7);
      border.fillStyle(0xfffdf5, 1);
      border.fillRect(-width / 2, -height, width, height);
      border.fillTriangle(-3, -1, 3, -1, 0, 4);
      const bubbleY = v05 ? -TEMPLATE.displayHeight - 20 : -96;
      const bubble = this.add.container(0, bubbleY, [border, text]);
      actor.bubble = bubble;
      actor.group.add(bubble);
      this.time.delayedCall(4200, () => {
        if (actor.bubble !== bubble) return;
        bubble.destroy();
        actor.bubble = null;
      });
    }

    update(time, dt) {
      if (!this.actors) return;
      const self = this.actors.get(me());
      if (self) this.updateSelf(self, time, dt);
      for (const [id, actor] of this.actors) {
        if (id !== me()) {
          const delta = Math.hypot(actor.group.x - actor.tx, actor.group.y - actor.ty);
          actor.group.x = Phaser.Math.Linear(actor.group.x, actor.tx, .22);
          actor.group.y = Phaser.Math.Linear(actor.group.y, actor.ty, .22);
          actor.moving = delta > 2;
        }
        if (v05) {
          actor.sprite.y = actor.moving ? -Math.abs(Math.sin(time / 110)) * 3 : 0;
          actor.sprite.angle = actor.moving ? Math.sin(time / 140) * 2.5 : 0;
        } else {
          const frame = Math.max(0, DIRECTIONS.indexOf(actor.dir)) * 4;
          actor.sprite.setFrame(frame + (actor.moving ? Math.floor(time / 130) % 4 : 0));
        }
        actor.group.setDepth(actor.group.y);
      }
    }

    updateSelf(self, time, dt) {
      if (!canMove()) {
        self.moving = false;
        this.target = null;
        this.marker.setVisible(false);
        return;
      }
      const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) ||
        document.querySelector('dialog[open]');
      let dx = 0;
      let dy = 0;
      if (!editing) {
        dx = Number(this.keys.RIGHT.isDown || this.keys.D.isDown) - Number(this.keys.LEFT.isDown || this.keys.A.isDown);
        dy = Number(this.keys.DOWN.isDown || this.keys.S.isDown) - Number(this.keys.UP.isDown || this.keys.W.isDown);
      }
      if (dx || dy) {
        this.target = null;
        this.marker.setVisible(false);
      } else if (this.target && !editing) {
        dx = this.target.x - self.group.x;
        dy = this.target.y - self.group.y;
        if (Math.hypot(dx, dy) < 5) {
          this.target = null;
          dx = 0;
          dy = 0;
          this.marker.setVisible(false);
        }
      }
      const length = Math.hypot(dx, dy);
      self.moving = false;
      if (length) {
        const speed = WORLD.speed * Math.min(dt, 40) / 1000;
        const travel = this.target ? Math.min(speed, length) : speed;
        const x = self.group.x + dx / length * travel;
        const y = self.group.y + dy / length * travel;
        if (walkable(x, self.group.y)) {
          self.group.x = x;
          self.moving = true;
        }
        if (walkable(self.group.x, y)) {
          self.group.y = y;
          self.moving = true;
        }
        self.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        if (!self.moving) {
          this.target = null;
          this.marker.setVisible(false);
        }
      }
      const previous = lastSentPosition || { x: self.tx, y: self.ty, direction: self.dir };
      // 서버가 폭주한 마지막 메시지를 버렸다면 정지한 뒤에도 최종 좌표가 수렴해야 한다.
      const unconfirmed = time - lastSend > 500 && Math.hypot(self.group.x - self.tx, self.group.y - self.ty) > 1;
      if (time - lastSend > 85 && (Math.hypot(self.group.x - previous.x, self.group.y - previous.y) > .01 ||
          self.dir !== previous.direction || unconfirmed)) {
        const position = { x: self.group.x, y: self.group.y, direction: self.dir };
        if (move(position) !== false) lastSentPosition = position;
        lastSend = time;
      }
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO, parent: container, width: WORLD.width, height: WORLD.height,
    backgroundColor: '#ddc4a4', scene: ClassroomScene,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true }, input: { activePointers: 2 }, audio: { noAudio: true }
  });
  // 휴대폰은 세로 공간도 교실로 채운다. 2배 카메라가 교실보다 커지지 않도록 높이를 제한한다.
  const resizeObserver = new ResizeObserver(() => {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const height = document.body.classList.contains('student-immersive') ?
      Math.max(1, Math.round(WORLD.width * rect.height / rect.width)) : window.innerWidth < MOBILE_BREAKPOINT ?
      Math.min(WORLD.height * MOBILE_CAMERA_ZOOM, Math.round(WORLD.width * rect.height / rect.width)) :
      WORLD.height;
    if (game.scale.gameSize.height !== height) game.scale.setGameSize(WORLD.width, height);
  });
  resizeObserver.observe(container);
  return {
    update(people) {
      pending = people;
      scene?.updatePeople(people);
    },
    positions(people) { scene?.positions(people); },
    correctPosition(person) { scene?.correctPosition(person); },
    bubble(id, text) { scene?.bubble(id, text); },
    zoomBy(factor) { scene?.setUserZoom(userZoom * factor); },
    resetZoom() { scene?.setUserZoom(1); },
    destroy() {
      resizeObserver.disconnect();
      game.destroy(true);
    }
  };
}
