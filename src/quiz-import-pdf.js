// Loaded only after the teacher selects a PDF; all assets are bundled locally.
// 학교 PC의 오래된 크롬·엣지·웨일도 읽도록 legacy 빌드를 쓴다(toHex 등 보완 포함).
import pdfURL from 'pdfjs-dist/legacy/build/pdf.mjs?url';
import workerURL from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { pdfItemsToLines, parseExamText } from '../shared/quiz-import.js';

const OLD_BROWSER = '이 브라우저에서는 PDF를 읽지 못해요. 브라우저를 업데이트하거나 글로 붙여넣기를 써 주세요.';
const cmaps = import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url', import: 'default' });
// pdf.js 6은 한글 등 내장 CMap을 BinaryDataFactory.fetch({ kind, filename })로 요청한다. 묶어 둔 파일만 쓴다.
class LocalBinaryData {
  async fetch({ kind, filename }) {
    const asset = kind === 'cMapUrl' && cmaps[`/node_modules/pdfjs-dist/cmaps/${filename}`];
    if (!asset) throw new Error('지원하지 않는 PDF 글꼴이에요.');
    const response = await fetch(await asset());
    if (!response.ok) throw new Error('PDF 글꼴 자료를 읽지 못했어요.');
    return new Uint8Array(await response.arrayBuffer());
  }
}
export async function readPDF(file, onProgress = () => {}) {
  // PDF.js is a self-contained ESM asset. Loading its URL also avoids dev-time
  // dependency re-optimization interrupting a teacher's existing classroom.
  const { getDocument, GlobalWorkerOptions } = await import(/* @vite-ignore */ pdfURL)
    .catch(e => { throw e instanceof SyntaxError ? new Error(OLD_BROWSER) : e; });
  GlobalWorkerOptions.workerSrc = workerURL;
  const data = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(data.subarray(0, 1024)).includes('%PDF-')) throw new Error('PDF 파일 형식을 확인해 주세요.');
  const task = getDocument({ data, useWorkerFetch: false, BinaryDataFactory: LocalBinaryData,
    isEvalSupported: false, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 200) throw new Error('PDF는 200쪽 이하로 나눠 올려 주세요.');
    const pages = []; let size = 0, empty = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress(`PDF ${n}/${pdf.numPages}쪽 읽는 중…`);
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const lines = pdfItemsToLines(content.items);
      if (!lines.trim()) empty++;
      size += lines.length;
      if (size > 5 * 1024 * 1024) throw new Error('PDF 글이 너무 많아요. 여러 파일로 나눠 주세요.');
      pages.push(lines); page.cleanup();
    }
    if (empty === pages.length) throw new Error('글자를 읽을 수 없는 PDF예요(스캔본). 글로 붙여넣기나 엑셀을 써 주세요');
    const drafts = parseExamText(pages.join('\n'));
    for (const draft of drafts) {
      draft.notes.push('PDF의 그림·표·단 나눔은 원본과 비교해 주세요.');
      if (empty) draft.notes.push(`글자가 없는 ${empty}쪽은 읽지 못했어요. 원본을 확인해 주세요.`);
    }
    return drafts;
  } catch (e) {
    if (e.name === 'PasswordException') throw new Error('암호가 있는 PDF예요. 암호 없이 저장한 파일을 골라 주세요.');
    // 브라우저에 없는 기능을 부른 경우: 파일 탓으로 안내하지 않는다.
    if (/is not a function/.test(e.message)) throw new Error(OLD_BROWSER);
    if (['InvalidPDFException', 'UnknownErrorException'].includes(e.name)) throw new Error('PDF를 읽지 못했어요. 다시 저장하거나 글로 붙여넣기를 써 주세요.');
    throw e;
  } finally { await task.destroy(); }
}
