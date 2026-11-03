import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
const textTypes = new Set(['.js', '.mjs', '.css', '.wasm', '.html', '.json', '.svg', '.txt', '.otf', '.ttf']);
const modelTypes = new Set(['.task', '.tflite']);

export async function precompress(directory) {
  const rows = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const filename = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('압축 대상에 심볼릭 링크를 넣을 수 없습니다.');
      if (entry.isDirectory()) {
        await walk(filename);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!textTypes.has(ext) && !modelTypes.has(ext)) continue;
      const source = await readFile(filename);
      const row = { file: path.relative(directory, filename), original: source.length, br: 0, gzip: 0 };
      // 이전 빌드의 압축 사본이 원본과 어긋나지 않도록 먼저 지운다.
      await rm(`${filename}.br`, { force: true });
      await rm(`${filename}.gz`, { force: true });
      if (source.length >= 1024) {
        const gz = await compressGzip(source, { level: 9 });
        if (gz.length < source.length * 0.9) {
          await writeFile(`${filename}.gz`, gz);
          row.gzip = gz.length;
        }
        if (textTypes.has(ext)) {
          const br = await compressBrotli(source, { params: {
            [constants.BROTLI_PARAM_QUALITY]: source.length <= 4 * 1024 ** 2 ? 11 : 9,
            [constants.BROTLI_PARAM_SIZE_HINT]: source.length
          } });
          if (br.length < source.length * 0.9) {
            await writeFile(`${filename}.br`, br);
            row.br = br.length;
          }
        }
      }
      rows.push(row);
    }
  }
  await walk(path.resolve(directory));
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.table(await precompress(process.argv[2] || 'dist'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
