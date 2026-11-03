import './quiz-import.css';
import { checkImportFile, parseCSV, decodeCSV, parseTable, parseXLSX, parseJSON, parseExamText,
  inspectDraft, templateCSV } from '../shared/quiz-import.js';

export function createQuizImporter({ host, capacity, add, toast }) {
  const $ = selector => host.querySelector(selector);
  const dialog = document.createElement('dialog');
  dialog.id = 'quiz-import-dialog';
  dialog.setAttribute('aria-labelledby', 'quiz-import-title');
  dialog.innerHTML = `<header><div><h2 id="quiz-import-title">문항 미리보기·고치기</h2>
    <p>칸을 눌러 바로 고칠 수 있어요. 정답과 보기를 확인한 뒤 추가해 주세요.</p></div>
    <button type="button" id="quiz-import-close" aria-label="미리보기 닫기">닫기</button></header>
    <section id="quiz-paste-panel" hidden><label for="quiz-paste-text">한글·워드·PDF에서 복사한 문제와 정답</label>
    <textarea id="quiz-paste-text" rows="8" placeholder="1. 훈민정음을 창제한 왕은?&#10;정답: 세종대왕&#10;&#10;2. 2 + 3은?&#10;① 4 ② 5 ③ 6 ④ 7&#10;정답: ②"></textarea>
    <button type="button" id="quiz-paste-read">문항 읽기</button></section>
    <p id="quiz-import-message" role="status" aria-live="polite"></p>
    <div id="quiz-import-preview" hidden><div class="quiz-import-tools">
    <label><input id="quiz-import-all" type="checkbox" checked> 모두 선택</label>
    <span>보기는 한 줄에 하나 · 다른 정답은 쉼표 / 줄바꿈으로 구분</span></div>
    <div class="quiz-import-scroll" tabindex="0" role="region" aria-label="수정 가능한 문항 표. 가로로 스크롤할 수 있어요.">
    <table><caption>가져온 문항 — 경고가 있는 문항은 원본과 비교해 주세요</caption>
    <thead><tr><th>선택·번호</th><th>유형</th><th>문제</th><th>정답·다른 정답</th><th>보기·정답 번호</th><th>시간·기회</th><th>해설·경고</th></tr></thead>
    <tbody id="quiz-import-rows"></tbody></table></div></div>
    <footer><p id="quiz-import-count"></p><button type="button" id="quiz-import-add">선택한 문항을 목록에 추가</button></footer>`;
  document.body.append(dialog);
  const d = selector => dialog.querySelector(selector);
  let drafts = [], disposed = false, busy = false, token = 0;
  const message = value => { d('#quiz-import-message').textContent = value; };
  function summary() {
    const selected = drafts.filter(row => row.selected), valid = selected.filter(row => inspectDraft(row).valid).length;
    d('#quiz-import-count').textContent = `읽은 문항 ${drafts.length}개 · 선택 ${selected.length}개 · 추가 가능 ${valid}개 · 목록 여유 ${capacity()}개`;
    d('#quiz-import-add').disabled = busy || !valid || capacity() <= 0;
    d('#quiz-import-all').checked = selected.length === drafts.length;
    d('#quiz-import-all').indeterminate = selected.length > 0 && selected.length < drafts.length;
  }
  function show() { if (!dialog.open) dialog.showModal(); }
  function preview(rows, name) {
    drafts = rows;
    d('#quiz-paste-panel').hidden = true;
    d('#quiz-import-preview').hidden = false;
    message(rows.length ? `${name}에서 ${rows.length}문항을 읽었어요. 파일은 이 브라우저 안에서만 읽어요.` : '읽은 문항이 없어요. 문제와 정답을 넣어 주세요.');
    render(); show();
  }
  function render() {
    const body = d('#quiz-import-rows'); body.replaceChildren();
    drafts.forEach((draft, i) => {
      const row = document.createElement('tr'); row.dataset.row = i;
      const cells = Array.from({ length: 7 }, () => row.appendChild(document.createElement('td')));
      const select = document.createElement('input'); select.type = 'checkbox'; select.checked = draft.selected;
      select.setAttribute('aria-label', `${i + 1}번 문항 선택`);
      select.onchange = () => { draft.selected = select.checked; summary(); };
      cells[0].append(select, document.createTextNode(` ${draft.sourceNumber ?? i + 1}`));
      function field(cell, key, label, kind = 'textarea') {
        const wrap = document.createElement('label'); wrap.textContent = label;
        const input = document.createElement(kind);
        input.dataset.field = key; input.setAttribute('aria-label', `${i + 1}번 ${label}`);
        if (kind === 'select') for (const [value, name] of [['short', '단답'], ['choice', '객관식'], ...!['short', 'choice'].includes(draft.type) ? [[draft.type, draft.type]] : []]) {
          const option = document.createElement('option'); option.value = value; option.textContent = name; input.append(option);
        }
        if (kind === 'textarea') input.rows = key === 'question' || key === 'options' ? 4 : 2;
        if (kind === 'input') input.type = 'text';
        input.value = key === 'options' ? draft.options.join('\n') : draft[key];
        input.oninput = () => {
          draft[key] = key === 'options' ? (input.value.trim() ? input.value.replace(/\r/g, '').split('\n') : []) : input.value;
          refresh(); summary();
        };
        wrap.append(input); cell.append(wrap); return wrap;
      }
      field(cells[1], 'type', '유형', 'select');
      field(cells[2], 'question', '문제');
      const answer = field(cells[3], 'answer', '정답');
      const alternates = field(cells[3], 'alternates', '다른 정답');
      const options = field(cells[4], 'options', '보기');
      const correct = field(cells[4], 'correct', '정답 번호', 'input');
      field(cells[5], 'seconds', '시간(초)', 'input');
      const attempts = field(cells[5], 'attempts', '기회', 'input');
      field(cells[6], 'explanation', '해설');
      const warnings = document.createElement('p'); warnings.className = 'quiz-import-warnings';
      warnings.setAttribute('aria-live', 'polite'); cells[6].append(warnings);
      function refresh() {
        const check = inspectDraft(draft);
        warnings.textContent = check.warnings.join('\n') || '추가할 수 있어요';
        row.dataset.valid = String(check.valid);
        answer.hidden = alternates.hidden = attempts.hidden = draft.type === 'choice';
        options.hidden = correct.hidden = draft.type !== 'choice';
      }
      refresh(); body.append(row);
    });
    summary();
  }
  d('#quiz-import-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { token++; drafts = []; d('#quiz-import-rows').replaceChildren(); d('#quiz-paste-text').value = ''; });
  d('#quiz-import-all').onchange = event => { for (const draft of drafts) draft.selected = event.target.checked; render(); };
  d('#quiz-import-add').onclick = () => {
    const accepted = [], remaining = []; let invalid = 0, overflow = 0;
    const room = capacity();
    for (const draft of drafts) {
      const check = inspectDraft(draft);
      if (!draft.selected) { remaining.push(draft); continue; }
      if (!check.valid) { invalid++; remaining.push(draft); }
      else if (accepted.length >= room) { overflow++; remaining.push(draft); }
      else accepted.push(check.spec);
    }
    if (accepted.length) add(accepted);
    drafts = remaining;
    const result = `${accepted.length}문항을 추가했어요.${invalid ? ` 오류가 있는 ${invalid}문항은 고쳐 주세요.` : ''}${overflow ? ` 목록은 200개까지예요. 남은 ${overflow}문항은 추가하지 않았어요.` : ''}`;
    if (!drafts.length) { dialog.close(); toast(result); }
    else { render(); message(result); }
  };
  d('#quiz-paste-read').onclick = () => {
    try { preview(parseExamText(d('#quiz-paste-text').value), '붙여넣은 글'); }
    catch (e) { message(e.message); }
  };
  $('#quiz-paste').onclick = () => {
    drafts = []; d('#quiz-paste-panel').hidden = false; d('#quiz-import-preview').hidden = true;
    message('문항 번호, 보기, 정답을 함께 붙여 넣어 주세요.'); summary(); show(); d('#quiz-paste-text').focus();
  };
  $('#quiz-template').onclick = () => {
    const url = URL.createObjectURL(new Blob([templateCSV()], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = '문제_엑셀양식.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('#quiz-import').onchange = async event => {
    const input = event.target, file = input.files[0]; if (!file || busy) return;
    const request = ++token; busy = true; input.disabled = true; $('#quiz-paste').disabled = true;
    const status = $('#quiz-import-status'); status.textContent = '파일 읽는 중…';
    try {
      const ext = checkImportFile(file);
      let rows;
      if (ext === 'xlsx') rows = await parseXLSX(await file.arrayBuffer());
      else if (ext === 'csv') rows = parseTable(parseCSV(decodeCSV(await file.arrayBuffer())));
      else if (ext === 'json') rows = parseJSON(await file.text());
      else {
        const { readPDF } = await import('./quiz-import-pdf.js');
        rows = await readPDF(file, value => { if (!disposed) status.textContent = value; });
      }
      if (!disposed && request === token) preview(rows, file.name);
      status.textContent = `${rows.length}문항을 읽었어요. 미리보기에서 확인해 주세요.`;
    } catch (e) { status.textContent = e.message || '파일을 읽지 못했어요. 양식 파일로 다시 저장해 주세요.'; }
    finally { busy = false; input.disabled = false; input.value = ''; $('#quiz-paste').disabled = false; if (!disposed) summary(); }
  };
  return { destroy() { disposed = true; token++; dialog.remove(); } };
}
