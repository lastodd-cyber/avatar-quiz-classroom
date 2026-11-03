import express from 'express';
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Classroom } from './classroom.mjs';
import { preferredIPv4Addresses } from '../shared/world.js';
import { readConfig } from './config.mjs';
import { staticFiles } from './static.mjs';

const production = process.argv.includes('--production');
let config;
try {
  config = readConfig();
  if (config.cloudMode && !production) throw new Error('클라우드에서는 --production으로 실행해 주세요.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
Classroom.config = config;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const port = config.port;
const server = http.createServer(app);
const host = production || process.env.CLASSROOM_LAN === '1' ? '0.0.0.0' : '127.0.0.1';
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.get('/api/health', (_, res) => res.json({ ok: true }));
app.get('/api/config', (_, res) => res.json({
  mode: config.cloudMode ? 'cloud' : 'local',
  teacherKeyRequired: config.cloudMode,
  maxRooms: config.maxRooms,
  photoAssets: config.photoAssets,
  publicUrl: config.publicUrl
}));
app.get('/api/addresses', (_, res) => {
  if (config.cloudMode) return res.json({ mode: 'cloud', addresses: [] });
  const ips = host === '127.0.0.1' ? [`http://127.0.0.1:${port}`] :
    preferredIPv4Addresses(networkInterfaces()).map(ip => `http://${ip}:${port}`);
  res.json({ addresses: ips });
});
const game = new Server({ transport: new WebSocketTransport({ server, maxPayload: 16 * 1024 }), greet: false });
game.define('classroom', Classroom);
if (production) {
  // 검증용 외부 빌드 경로만 선택적으로 받으며 운영 기본값은 dist를 유지한다.
  const dist = process.env.CLASSROOM_DIST ? path.resolve(process.env.CLASSROOM_DIST) : path.join(root, 'dist');
  app.use(staticFiles(dist, { config }));
} else {
  const { createServer } = await import('vite');
  // 게임 소켓과 개발 화면 갱신 소켓은 별도 포트를 쓴다.
  const hmrPort = Number(process.env.HMR_PORT || port + 1);
  if (!Number.isInteger(hmrPort) || hmrPort < 1 || hmrPort > 65535 || hmrPort === port) {
    throw new Error('HMR_PORT는 PORT와 다른 유효한 포트여야 합니다.');
  }
  // ESM 설정을 직접 읽어 상위 디렉터리 탐색을 피한다.
  const vite = await createServer({ root, configLoader: 'native', server: {
    host, middlewareMode: true, hmr: { port: hmrPort, host: host === '127.0.0.1' ? host : undefined },
    fs: { strict: true, allow: [root], deny: ['.env', '.env.*', '**/.git/**', '**/Handoff/**',
      '**/References/**', '**/Art/**', '**/History/**', '**/test-results/**', '**/server/**', '**/*.md'] }
  }, appType: 'spa' });
  app.use(vite.middlewares);
}
await game.listen(port, host);
console.log(`우리의 교실: http://localhost:${port}`);
