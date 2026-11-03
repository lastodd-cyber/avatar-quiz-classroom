import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { readConfig } from './config.mjs';

const HOUR = 3600000;
const LARGE_FILE = 256 * 1024;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

export function cacheControlFor(urlPath) {
  if (urlPath === '/api' || urlPath.startsWith('/api/')) return 'no-store';
  if (urlPath === '/' || urlPath.endsWith('.html') || urlPath === '/content.json') return 'no-cache';
  if (/^\/assets\/.*-[A-Za-z0-9_-]{8,}\.(?:js|css|wasm|svg|png|webp|woff2?)$/.test(urlPath)) {
    return 'public, max-age=31536000, immutable';
  }
  if (/^\/(?:models|wasm|fonts)\//.test(urlPath)) return 'public, max-age=2592000';
  return 'public, max-age=3600';
}

export function selectEncoding(header, available) {
  const values = new Map();
  for (const part of String(header || '').toLowerCase().split(',')) {
    const [name, ...parameters] = part.trim().split(';');
    if (!name) continue;
    let q = 1;
    for (const parameter of parameters) {
      if (!parameter.trim().startsWith('q=')) continue;
      const raw = parameter.trim().slice(2);
      q = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw) ? Number(raw) : 0;
    }
    values.set(name.trim(), q);
  }
  const quality = name => {
    if (values.has(name)) return values.get(name);
    if (name === 'identity') return values.get('*') === 0 ? 0 : 1;
    return values.get('*') || 0;
  };
  const candidates = ['br', 'gzip', 'identity'].filter(name => available.includes(name) && quality(name) > 0);
  candidates.sort((a, b) => quality(b) - quality(a));
  return candidates[0] || null;
}

export function createAssetBudget(limit, { now = Date.now, windowMs = HOUR } = {}) {
  if (!(limit === Infinity || (Number.isSafeInteger(limit) && limit >= 0))) {
    throw new Error('전송 상한 설정값을 확인해 주세요.');
  }
  let started = now();
  let used = 0;
  return {
    reserve(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('전송 크기가 올바르지 않습니다.');
      const time = now();
      if (time - started >= windowMs) {
        started = time;
        used = 0;
      }
      const retryAfter = Math.max(1, Math.ceil((started + windowMs - time) / 1000));
      if (used + bytes > limit) return { allowed: false, retryAfter };
      used += bytes;
      return { allowed: true, retryAfter: 0 };
    },
    get used() {
      return used;
    }
  };
}

function jsonResponse(req, res, status, body, retryAfter) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', bytes.length);
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

async function fileInfo(root, relative) {
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(`${root}${path.sep}`)) return null;
  try {
    // 별칭 링크로 비공개 파일이나 상한 대상에 접근하는 것도 막는다.
    const canonical = await realpath(filename);
    if (path.relative(filename, canonical) !== '') return null;
    const info = await stat(filename);
    return info.isFile() ? { filename, info } : null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return null;
    throw error;
  }
}

export function staticFiles(distDir, { config = readConfig(), now = Date.now,
  budget = createAssetBudget(config.assetBytesPerHour, { now }) } = {}) {
  const rootPromise = realpath(distDir);
  // 잘못된 dist 경로의 거부가 첫 요청 전에 미처리 예외가 되지 않게 한다.
  rootPromise.catch(() => {});
  return async (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    try {
      let urlPath;
      try {
        urlPath = decodeURIComponent(String(req.url || '/').split('?')[0]);
      } catch {
        return jsonResponse(req, res, 400, { error: 'BAD_PATH' });
      }
      if (!urlPath.startsWith('/') || /[\\\u0000-\u001f]/.test(urlPath)
        || urlPath.split('/').some(part => part.startsWith('.'))) {
        return jsonResponse(req, res, 404, { error: 'NOT_FOUND' });
      }
      if (urlPath === '/api' || urlPath.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        return next();
      }
      if (/\.(?:br|gz)$/i.test(urlPath)) return jsonResponse(req, res, 404, { error: 'NOT_FOUND' });
      const photo = /^\/(?:models|wasm)(?:\/|$)/.test(urlPath);
      if (photo && !config.photoAssets) {
        return jsonResponse(req, res, 503, {
          error: 'PHOTO_ASSETS_DISABLED', fallback: 'manual-avatar',
          message: '지금은 사진 분석을 쓸 수 없어요. 직접 꾸며 주세요.'
        }, 600);
      }
      const root = await rootPromise;
      let original = await fileInfo(root, urlPath.slice(1));
      if (!original && !path.posix.extname(urlPath) && !photo) {
        urlPath = '/index.html';
        original = await fileInfo(root, 'index.html');
      }
      if (!original) return jsonResponse(req, res, 404, { error: 'NOT_FOUND' });
      const variants = { identity: original };
      for (const [name, suffix] of [['br', '.br'], ['gzip', '.gz']]) {
        const variant = await fileInfo(root, urlPath.slice(1) + suffix);
        if (variant) variants[name] = variant;
      }
      res.setHeader('Vary', 'Accept-Encoding');
      const encoding = selectEncoding(req.headers?.['accept-encoding'], Object.keys(variants));
      if (!encoding) return jsonResponse(req, res, 406, { error: 'ENCODING_NOT_ACCEPTABLE' });
      const selected = variants[encoding];
      const etag = `W/"${selected.info.size}-${selected.info.mtimeMs}-${encoding}"`;
      const match = req.headers?.['if-none-match'];
      const unmodified = match && (match.trim() === '*' || match.split(',').some(tag => {
        return tag.trim().replace(/^W\//, '') === etag.replace(/^W\//, '');
      }));
      if (!unmodified && req.method === 'GET' && original.info.size >= LARGE_FILE) {
        // 원본 크기로 대상을 정하고 압축 후 크기를 선점한다. 끊긴 응답도 보수적으로 계산한다.
        const reservation = budget.reserve(selected.info.size);
        if (!reservation.allowed) {
          return jsonResponse(req, res, 503, {
            error: 'ASSET_BUDGET_EXCEEDED', fallback: photo ? 'manual-avatar' : null,
            message: photo ? '지금은 사진 분석을 쓸 수 없어요. 직접 꾸며 주세요.' : '파일 전송량 상한에 도달했어요.'
          }, reservation.retryAfter);
        }
      }
      res.setHeader('Cache-Control', cacheControlFor(urlPath));
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', selected.info.mtime.toUTCString());
      res.setHeader('Content-Type', types[path.extname(urlPath)] || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // 부분 요청은 전체 200 응답으로 처리하여 압축과 전송량 계산을 일치시킨다.
      res.setHeader('Accept-Ranges', 'none');
      if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding);
      if (unmodified) {
        res.statusCode = 304;
        return res.end();
      }
      res.statusCode = 200;
      res.setHeader('Content-Length', selected.info.size);
      if (req.method === 'HEAD') return res.end();
      await pipeline(createReadStream(selected.filename), res);
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        res.destroy(error);
        return;
      }
      next(error);
    }
  };
}
