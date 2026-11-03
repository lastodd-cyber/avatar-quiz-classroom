import { validateQuizSpec } from './quiz-spec.js';
import { splitAcceptedInput } from './quiz-core.js';

// No DOM or network: the same parser runs in browsers and Node.
const text = value => String(value ?? '').trim();
const MAX_ROWS = 1000;
const MAX_TEXT = 5 * 1024 * 1024;
export const IMPORT_LIMITS = { json: 500000, xlsx: MAX_TEXT, csv: MAX_TEXT, pdf: 20 * 1024 * 1024 };
export function checkImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!(ext in IMPORT_LIMITS)) throw new Error('JSON, XLSX, CSV, PDF 파일을 골라 주세요.');
  if (file.size > IMPORT_LIMITS[ext]) throw new Error(`${ext.toUpperCase()} 파일은 ${ext === 'json' ? '500KB' : ext === 'pdf' ? '20MB' : '5MB'} 이하로 골라 주세요.`);
  if (!file.size) throw new Error('빈 파일이에요. 내용이 있는 파일을 골라 주세요.');
  return ext;
}
// 쉼표·줄바꿈은 직접 입력칸과 같은 규칙(1,000 보존)으로 나눈다. '/'는 가져오기 양식용 구분자라 1/2 같은 분수는 나누지 않는다.
const altSlash = /(?<!(?:^|[^\d.,/])[-+]?\d+\s*)\/|\/(?!\s*\d+(?![\d.,]))/;
export function splitAlternates(value) {
  return splitAcceptedInput(text(value).replace(/\r\n?/g, '\n')).flatMap(v => v.split(altSlash)).map(text).filter(Boolean);
}
// 보기가 숫자면 '2' 같은 정답이 보기 내용인지 번호인지 헷갈릴 수 있다.
function numberNote(answer, options) {
  const v = text(answer), at = options.indexOf(v), n = Number(v) - 1;
  return /^[1-5]$/.test(v) && at >= 0 && n !== at && n < options.length ? `읽은 정답: ${v} — 보기 내용과 같아서 ${at + 1}번으로 넣었어요. ${v}번 보기라면 정답 번호를 고쳐 주세요.` : '';
}
export function correctIndex(value, options) {
  const v = text(value);
  // Exact option text takes precedence (including numeric answers like "2").
  const exact = options.indexOf(v);
  if (v && exact !== -1) return exact;
  const m = v.match(/^(?:([1-5])\s*(?:번|[.)])?|([①②③④⑤])|([A-Ea-e])|([㉠㉡㉢㉣㉤])|([가나다라마])\.?)$/);
  if (!m) return -1;
  if (m[1]) return Number(m[1]) - 1;
  if (m[2]) return '①②③④⑤'.indexOf(m[2]);
  if (m[3]) return m[3].toUpperCase().charCodeAt(0) - 65;
  return m[4] ? '㉠㉡㉢㉣㉤'.indexOf(m[4]) : '가나다라마'.indexOf(m[5]);
}
export function makeDraft(values = {}) {
  return { type: 'short', question: '', answer: '', alternates: '', options: [], correct: '',
    seconds: '20', attempts: '3', explanation: '', notes: [], selected: true, ...values };
}
export function draftToSpec(draft) {
  const q = { type: draft.type, question: text(draft.question), seconds: Number(draft.seconds),
    explanation: text(draft.explanation), strict: draft.strict === true,
    practice: draft.practice === true, numeric: draft.numeric === true };
  if (q.type === 'choice') {
    q.options = draft.options.map(text);
    // The preview field is explicitly a number, so numeric options cannot change its meaning.
    q.correct = /^\d+$/.test(text(draft.correct)) ? Number(draft.correct) - 1 : correctIndex(draft.correct, q.options);
  } else {
    const alternates = draft.alternateValues && draft.alternates === draft.alternateOriginal ? draft.alternateValues : splitAlternates(draft.alternates);
    q.answers = [text(draft.answer), ...alternates];
    q.attempts = Number(draft.attempts);
  }
  return q;
}
export function inspectDraft(draft) {
  const spec = draftToSpec(draft), errors = [];
  if (!spec.question || spec.question.length > 200) errors.push('문제는 1~200자로 적어 주세요.');
  if (spec.type === 'short') {
    if (!spec.answers[0]) errors.push('정답 없음 — 정답을 적어 주세요.');
    if (spec.answers.length > 10 || spec.answers.some(a => a.length > 40)) errors.push('정답은 각 40자, 다른 정답을 포함해 10개까지예요.');
  } else if (spec.type === 'choice') {
    if (spec.options.length === 5) errors.push('보기 5개 — 하나를 빼 주세요.');
    else if (spec.options.length < 2 || spec.options.length > 4) errors.push('보기는 2~4개여야 해요.');
    if (spec.options.some(o => !o || o.length > 200)) errors.push('각 보기는 1~200자로 적어 주세요.');
    if (spec.correct < 0 || spec.correct >= spec.options.length) errors.push('정답 없음 또는 정답 번호 오류 — 보기를 확인해 주세요.');
  }
  try { validateQuizSpec(spec); } catch (e) { if (!errors.includes(e.message)) errors.push(e.message); }
  const notes = [...(draft.notes || [])];
  if (/(?:그림|도표|그래프|사진|다음\s*표|아래\s*표|위\s*표|표를|표에서)/.test(spec.question)) notes.push('그림·표가 필요한지 확인해 주세요. 그림·표는 가져오지 않아요.');
  return { spec, errors, warnings: [...new Set([...errors, ...notes])], valid: errors.length === 0 };
}

const aliases = {
  type: ['유형', '종류', '문제유형', 'type'], question: ['문제', '질문', '문항', 'question'],
  answer: ['정답', '답', 'answer'], alternates: ['다른정답', '허용답', '다른정답도인정', '허용정답', 'alternates'],
  correct: ['정답번호', '정답보기', 'correct'], seconds: ['제한시간', '제한시간초', '시간', '시간초', '초', 'seconds'],
  attempts: ['기회', '시도횟수', 'attempts'], explanation: ['해설', '설명', 'explanation'],
};
function columnKey(value) {
  const v = text(value).toLowerCase().replace(/[\s()（）_\-]/g, '');
  for (const [key, names] of Object.entries(aliases)) if (names.includes(v)) return key;
  const idx = '①②③④⑤'.indexOf(v);
  if (v && idx >= 0) return `option${idx}`;
  if (/^[a-e]$/.test(v)) return `option${v.charCodeAt(0) - 97}`;
  const m = v.match(/^(?:보기|선택지|option)([1-5])$/);
  return m ? `option${Number(m[1]) - 1}` : '';
}
export function parseTable(rows) {
  const nonempty = rows.filter(row => row.some(v => text(v)));
  if (!nonempty.length) throw new Error('읽을 내용이 없어요. 문제와 정답을 넣어 주세요.');
  const keys = nonempty[0].map(columnKey);
  const header = keys.includes('question') && keys.some(k => k && k !== 'question');
  const data = header ? nonempty.slice(1) : nonempty;
  if (data.length > MAX_ROWS) throw new Error('한 번에 1,000문항 이하로 나눠 올려 주세요. 목록에는 최대 200개를 추가할 수 있어요.');
  return data.map((row, index) => {
    const fields = {};
    (header ? keys : ['question', 'answer', 'explanation']).forEach((key, i) => { if (key) fields[key] = text(row[i]); });
    const options = Array.from({ length: 5 }, (_, i) => fields[`option${i}`] || '');
    while (options.length && !options.at(-1)) options.pop();
    const typeValue = fields.type || '';
    const type = options.length || /^(객관식|객관|선택형|choice)$/i.test(typeValue) ? 'choice' :
      !typeValue || /^(단답|단답형|주관식|short)$/i.test(typeValue) ? 'short' : typeValue;
    const correct = fields.correct ? (/^[1-5](?:번|[.)])?$/.test(fields.correct) ? correctIndex(fields.correct, []) : correctIndex(fields.correct, options)) : correctIndex(fields.answer, options);
    const note = fields.correct ? '' : numberNote(fields.answer, options);
    return makeDraft({ ...fields, type, options, correct: correct >= 0 ? String(correct + 1) : fields.correct || '',
      seconds: fields.seconds || '20', attempts: fields.attempts || '3', sourceNumber: index + 1, notes: note ? [note] : [] });
  });
}
export function parseCSV(source) {
  if (source.length > MAX_TEXT) throw new Error('글이 너무 길어요. 파일을 나눠 주세요.');
  const s = source.replace(/^\uFEFF/, '');
  const delimiter = s.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const rows = [], row = [];
  let cell = '', quoted = false, afterQuote = false;
  function field() { row.push(cell); cell = ''; afterQuote = false; }
  function record() { field(); rows.push(row.splice(0)); if (rows.length > MAX_ROWS + 2) throw new Error('표는 1,000문항 이하로 나눠 주세요.'); }
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; afterQuote = true; } }
      else cell += c;
    } else if (c === delimiter) field();
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; record(); }
    else if (c === '"' && !cell && !afterQuote) quoted = true;
    else if (afterQuote && !/\s/.test(c)) throw new Error('CSV 따옴표 형식을 확인해 주세요. 엑셀에서 CSV UTF-8로 다시 저장해 보세요.');
    else if (!afterQuote) cell += c;
  }
  if (quoted) throw new Error('CSV의 닫히지 않은 따옴표를 확인해 주세요.');
  if (cell || row.length || afterQuote) record();
  return rows;
}
export function decodeCSV(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('euc-kr').decode(bytes); }
}
export function parseJSON(source) {
  let list;
  try { list = JSON.parse(source); } catch { throw new Error('JSON 파일을 읽지 못했어요. 문제 목록 JSON인지 확인해 주세요.'); }
  if (!Array.isArray(list) || list.length > MAX_ROWS) throw new Error('JSON은 문제 배열(최대 1,000개)이어야 해요.');
  return list.map((q, i) => {
    if (!q || typeof q !== 'object' || Array.isArray(q)) return makeDraft({ sourceNumber: i + 1, notes: ['문제 객체가 아닌 행이에요. 내용을 입력해 주세요.'] });
    return makeDraft({ type: q.type ?? (Array.isArray(q.options) ? 'choice' : 'short'), question: text(q.question),
      answer: Array.isArray(q.answers) ? text(q.answers[0]) : '', alternates: Array.isArray(q.answers) ? q.answers.slice(1).map(text).join('\n') : '',
      alternateValues: Array.isArray(q.answers) ? q.answers.slice(1).map(text) : [],
      alternateOriginal: Array.isArray(q.answers) ? q.answers.slice(1).map(text).join('\n') : '',
      options: Array.isArray(q.options) ? q.options.map(text) : [], correct: Number.isInteger(q.correct) ? String(q.correct + 1) : text(q.correct),
      seconds: String(q.seconds ?? 20), attempts: String(q.attempts ?? 3), explanation: text(q.explanation),
      strict: q.strict === true, practice: q.practice === true, numeric: q.numeric === true, sourceNumber: i + 1 });
  });
}

// Line-based exam parser. Ambiguous numbered lists are retained with a review note.
const startPattern = /^(?:문제\s*(\d+)\s*[.):：]?|Q\s*(\d+)\s*[.):：]?|\[(\d+)\]\s*|(?:(\d+)[.)]\s*))(.*)$/i;
const optionPattern = /[①②③④⑤㉠㉡㉢㉣㉤]|(?:^|\s)(?:[1-5]\)|[가나다라마]\.)\s*/g;
export function parseExamText(source) {
  if (source.length > MAX_TEXT) throw new Error('글이 너무 길어요. 5MB 이하로 나눠 주세요.');
  const lines = source.replace(/\r\n?/g, '\n').split('\n').map(text).filter(Boolean);
  const drafts = [], answerMap = new Map();
  let current = null, table = false, continuation = 'question', preamble = null;
  function begin(number, question) {
    if (drafts.length >= MAX_ROWS) throw new Error('한 번에 1,000문항 이하로 나눠 주세요.');
    current = makeDraft({ sourceNumber: number, question }); drafts.push(current); continuation = 'question';
  }
  function body(line) {
    const answer = line.match(/^(?:정답\s*[:：]|답\s*[:：]|\(정답\)\s*[:：]?)\s*(.*)$/);
    const explain = line.match(/^해설\s*[:：]\s*(.*)$/);
    if (answer) { current.answer = answer[1]; continuation = 'answer'; return; }
    if (explain) { current.explanation = explain[1]; continuation = 'explanation'; return; }
    // 해설·정답의 다음 줄은 ①·㉠이 있어도 보기로 읽지 않는다.
    if (continuation === 'explanation') { current.explanation += `\n${line}`; return; }
    if (continuation === 'answer') { current.answer += ` ${line}`; return; }
    const marks = [...line.matchAll(optionPattern)];
    if (marks.length) {
      const prefix = line.slice(0, marks[0].index).trim();
      if (prefix) current.question += `${current.question ? ' ' : ''}${prefix}`;
      for (let i = 0; i < marks.length; i++) {
        current.options.push(line.slice(marks[i].index + marks[i][0].length, marks[i + 1]?.index ?? line.length).trim());
      }
      current.type = 'choice'; continuation = 'option'; return;
    }
    if (continuation === 'option') current.options[current.options.length - 1] += ` ${line}`;
    else current.question += `${current.question ? '\n' : ''}${line}`;
  }
  for (const line of lines) {
    const heading = line.match(/^(?:정답표|정답(?:\s*및\s*해설)?)\s*[:：]?\s*(.*)$/);
    if (heading && (!heading[1] || /^\d+\s*[.\-):]/.test(heading[1])) && !/^정답\s*[:：]\s*\S/.test(line)) {
      table = true;
      if (!heading[1]) continue;
    }
    if (table) {
      const entries = [...line.matchAll(/(?:^|\s)(\d+)\s*[.\-):]\s*/g)];
      entries.forEach((entry, i) => answerMap.set(Number(entry[1]), line.slice(entry.index + entry[0].length, entries[i + 1]?.index ?? line.length).trim()));
      continue;
    }
    const found = line.match(startPattern);
    // 문항 번호는 1~1000만 본다. 머리글의 날짜 '2026. 10. 20.' 같은 줄을 2026번 문제로 읽지 않게.
    const start = found && Number(found[1] || found[2] || found[3] || found[4]) <= MAX_ROWS ? found : null;
    // "1)" inside an unanswered question is an option. A subsequent question should use "2." or a Q/문제 prefix.
    const numericOption = current && !current.answer && !current.explanation && /^([1-5])\)/.test(line) &&
      (Number(RegExp.$1) === current.options.length + 1);
    if (start && !numericOption) {
      begin(Number(start[1] || start[2] || start[3] || start[4]), '');
      if (start[5]) body(start[5]);
    } else if (current) body(line);
    else { begin(drafts.length + 1, line); preamble = current; }
  }
  // 첫 문항 번호 앞의 글(학교·학년·반·과목 등)은 고르지 않고 정답표 1번도 주지 않는다. 번호 없는 글 하나면 예전처럼 둔다.
  if (preamble && drafts.length > 1) Object.assign(preamble, { sourceNumber: 0, selected: false,
    notes: ['첫 문항 앞의 글(학교·이름·과목 등)이라 선택하지 않았어요. 문제라면 고친 뒤 선택해 주세요.'] });
  for (const draft of drafts) {
    const mapped = draft.sourceNumber ? answerMap.get(draft.sourceNumber) : undefined;
    if (mapped && draft.answer && mapped !== draft.answer) draft.notes.push('문항 아래 정답과 정답표가 달라요. 문항 아래 정답을 먼저 넣었어요.');
    draft.answer ||= mapped || '';
    if (draft.type === 'choice') {
      const correct = correctIndex(draft.answer, draft.options);
      draft.correct = correct >= 0 ? String(correct + 1) : '';
      if (draft.answer && correct < 0) draft.notes.push(`읽은 정답: ${draft.answer} — 보기 번호를 확인해 주세요.`);
      const note = numberNote(draft.answer, draft.options);
      if (note) draft.notes.push(note);
    }
  }
  return drafts;
}

export function templateCSV() {
  const rows = [
    ['유형', '문제', '정답', '다른 정답', '보기1', '보기2', '보기3', '보기4', '정답 번호', '제한 시간(초)', '기회', '해설'],
    ['단답', '훈민정음을 창제한 왕은?', '세종대왕', '세종/세종 대왕', '', '', '', '', '', '20', '3', '세종대왕이 훈민정음을 창제했어요.'],
    ['객관식', '2 + 3은?', '', '', '4', '5', '6', '7', '2', '20', '1', '2 + 3 = 5예요.'],
  ];
  return '\uFEFF' + rows.map(row => row.map(v => `"${v.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}

const xmlText = value => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] ?? '';
});
function attr(tag, key) { return xmlText(tag.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*["']([^"']*)["']`))?.[1] || ''); }
function textRuns(xml) { return [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m => xmlText(m[1])).join(''); }
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function unzipXML(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > IMPORT_LIMITS.xlsx) throw new Error('XLSX 파일은 5MB 이하로 골라 주세요.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => { throw new Error('엑셀 파일을 읽지 못했어요. 암호 없이 .xlsx로 다시 저장해 주세요.'); };
  const u16 = n => n >= 0 && n + 2 <= bytes.length ? view.getUint16(n, true) : invalid();
  const u32 = n => n >= 0 && n + 4 <= bytes.length ? view.getUint32(n, true) : invalid();
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50) end--;
  if (end < 0 || u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length || u16(end + 4) || u16(end + 6)) invalid();
  const count = u16(end + 10), centralEnd = u32(end + 16) + u32(end + 12);
  if (count > 4096 || count !== u16(end + 8) || centralEnd > end) invalid();
  const entries = new Map(); let offset = u32(end + 16), total = 0;
  for (let i = 0; i < count; i++) {
    if (u32(offset) !== 0x02014b50) invalid();
    const flags = u16(offset + 8), method = u16(offset + 10), crc = u32(offset + 16), packed = u32(offset + 20), size = u32(offset + 24);
    const nameLength = u16(offset + 28), name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const local = u32(offset + 42);
    total += size;
    if (flags & 1 || ![0, 8].includes(method) || size > 16 * 1024 * 1024 || total > 40 * 1024 * 1024) throw new Error('암호가 있거나 압축을 푼 내용이 너무 큰 엑셀이에요. 첫 시트만 새 파일로 저장해 주세요.');
    if (u32(local) !== 0x04034b50) invalid();
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + packed > u32(end + 16) || entries.has(name)) invalid();
    entries.set(name, { start, packed, size, method, crc });
    offset += 46 + nameLength + u16(offset + 30) + u16(offset + 32);
    if (offset > centralEnd) invalid();
  }
  return async name => {
    const entry = entries.get(name);
    if (!entry) return null;
    let data = bytes.subarray(entry.start, entry.start + entry.packed);
    if (entry.method === 8) {
      let stream;
      try { stream = new DecompressionStream('deflate-raw'); }
      catch { throw new Error('이 브라우저에서는 엑셀 압축을 읽을 수 없어요. 최신 Chrome·Edge 또는 CSV 파일을 써 주세요.'); }
      const reader = new Blob([data]).stream().pipeThrough(stream).getReader();
      const chunks = []; let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.length;
          if (length > entry.size || length > 16 * 1024 * 1024) { await reader.cancel(); invalid(); }
          chunks.push(value);
        }
      } catch { invalid(); }
      data = new Uint8Array(length); let at = 0;
      for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
    }
    if (data.length !== entry.size || crc32(data) !== entry.crc) invalid();
    const xml = new TextDecoder().decode(data);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) invalid();
    return xml;
  };
}
export async function parseXLSX(input) {
  const read = await unzipXML(input);
  const workbook = await read('xl/workbook.xml'), rels = await read('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new Error('XLSX 통합 문서가 아니에요. 엑셀에서 .xlsx로 다시 저장해 주세요.');
  const sheet = workbook.match(/<(?:\w+:)?sheet\s[^>]*\/?\s*>/)?.[0];
  const id = attr(sheet || '', 'r:id');
  const rel = [...rels.matchAll(/<(?:\w+:)?Relationship\s[^>]*\/?\s*>/g)].map(m => m[0]).find(tag => attr(tag, 'Id') === id);
  const target = attr(rel || '', 'Target');
  if (!target || attr(rel, 'TargetMode') === 'External') throw new Error('첫 번째 시트를 찾을 수 없어요. 일반 워크시트로 저장해 주세요.');
  const parts = (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/'), normalized = [];
  for (const part of parts) { if (part === '..') normalized.pop(); else if (part && part !== '.') normalized.push(part); }
  if (normalized[0] !== 'xl') throw new Error('시트 경로가 올바르지 않아요.');
  const xml = await read(normalized.join('/'));
  if (!xml) throw new Error('첫 번째 시트 내용이 없어요.');
  const stringsXML = await read('xl/sharedStrings.xml') || '';
  const strings = [...stringsXML.matchAll(/<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m => textRuns(m[1]));
  const rows = [];
  for (const match of xml.matchAll(/<(?:\w+:)?row(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const row = [];
    for (const cell of match[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = attr(cell[1], 'r'), kind = attr(cell[1], 't'), content = cell[2] || '';
      let col = 0;
      for (const c of ref.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '') col = col * 26 + c.charCodeAt(0) - 64;
      col = col ? col - 1 : row.length;
      if (col > 255) throw new Error('열이 너무 많아요. 문제에 필요한 열만 남겨 주세요.');
      const value = xmlText(content.match(/<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] || '');
      row[col] = kind === 's' ? strings[Number(value)] ?? '' : kind === 'inlineStr' ? textRuns(content) : value;
    }
    rows.push(Array.from(row, v => v ?? ''));
    if (rows.length > MAX_ROWS + 1) throw new Error('첫 시트를 1,000문항 이하로 나눠 주세요.');
  }
  return parseTable(rows);
}

// PDF text items are ordered geometrically, independently of pdf.js's item order.
export function pdfItemsToLines(items) {
  const lines = [];
  for (const item of items.filter(i => typeof i.str === 'string' && i.str.trim()).sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
    const y = item.transform[5];
    let line = lines.at(-1);
    if (!line || Math.abs(line.y - y) > Math.max(2, Math.min(Math.abs(item.height || 10) * 0.25, 4))) { line = { y, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  return lines.map(line => {
    let result = '', end = null;
    for (const item of line.items.sort((a, b) => a.transform[4] - b.transform[4])) {
      const x = item.transform[4];
      if (end !== null && x - end > 1 && !/\s$/.test(result) && !/^\s/.test(item.str)) result += ' ';
      result += item.str; end = x + (item.width || 0);
    }
    return result;
  }).join('\n');
}
