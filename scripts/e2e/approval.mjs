import { launch } from './cdp.mjs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? ' — ' + detail : ''}`);
};

const b = await launch({ port: 9336, mobile: false });

try {
  // 1. 추천 결과 화면 접속 및 결재 문서 만들기 버튼 확인
  await b.goto(`${BASE}/result?event=wedding&relation=senior&budget=50000&qty=30`);
  await b.sleep(500);

  const btnText = await b.evaluate(
    `return [...document.querySelectorAll('button')].find(b => b.textContent.includes('결재 문서 만들기'))?.textContent`,
  );
  check('추천 결과 화면에 결재 문서 만들기 버튼 노출', Boolean(btnText), btnText);

  // 2. 결재 문서 생성 클릭 및 페이지 이동
  await b.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('결재 문서 만들기')).click()`);

  // /approval/ 로 이동할 때까지 대기
  let approvalUrl = '';
  for (let i = 0; i < 30; i++) {
    await b.sleep(300);
    approvalUrl = await b.evaluate(`return window.location.pathname`);
    if (approvalUrl.startsWith('/approval/')) break;
  }
  check('결재 문서 페이지(/approval/[id])로 이동', approvalUrl.startsWith('/approval/'), approvalUrl);

  const draftId = approvalUrl.split('/')[2];

  // 3. A4 미리보기 렌더링 확인 (공문서 서식: 제목 중앙, 우측 결재란, 12pt 내외)
  const previewInfo = await b.evaluate(`
    return {
      h1: document.querySelector('.a4-sheet h1')?.textContent,
      headers: [...document.querySelectorAll('.a4-sheet th')].map(t => t.textContent.trim()),
      selectedPlan: [...document.querySelectorAll('.a4-sheet td')].find(t => t.textContent.includes('[선택]'))?.textContent,
      saveText: document.querySelector('header span')?.textContent
    };
  `);
  check('A4 공문서 서식 미리보기 기본 렌더링', previewInfo.h1 === '답례품 선정 검토서', JSON.stringify(previewInfo));

  // 4. 대안 선택 변경 (2안 클릭)
  const candidateButtons = await b.evaluate(`
    return [...document.querySelectorAll('.approval-form-panel button')].filter(b => b.textContent.includes('안')).length;
  `);
  check('대안 선택 라디오 버튼 목록 확인', candidateButtons >= 2, `${candidateButtons}개 대안`);

  // 2안 라디오 버튼 클릭
  await b.evaluate(`
    const btns = [...document.querySelectorAll('.approval-form-panel button')].filter(b => b.textContent.includes('안'));
    if (btns[1]) btns[1].click();
  `);
  await b.sleep(400);

  const afterSwitch = await b.evaluate(`
    return {
      selectedPlan: [...document.querySelectorAll('.a4-sheet td')].find(t => t.textContent.includes('[선택]'))?.textContent,
      itemTotal: [...document.querySelectorAll('.a4-sheet td')].find(t => t.textContent.includes('상품 합계'))?.textContent
    };
  `);
  check('대안 선택 2안으로 변경 반영', afterSwitch.selectedPlan?.includes('2안'), JSON.stringify(afterSwitch));

  // 5. 수량 보완 입력 (30 -> 50)
  await b.evaluate(`
    const input = document.querySelector('.approval-form-panel input[type="number"]');
    const proto = HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(input, '50');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  `);
  await b.sleep(1200); // 디바운스 자동 저장 대기

  const afterQty = await b.evaluate(`
    return {
      itemTotal: [...document.querySelectorAll('.a4-sheet td')].find(t => t.textContent.includes('개 ='))?.textContent,
      saveBadge: document.querySelector('header span:nth-of-type(3)')?.textContent
    };
  `);
  check('수량 50개 변경 및 자동 저장 반영', afterQty.itemTotal?.includes('50개'), JSON.stringify(afterQty));

  // 6. 공식 행사명 및 추가 의견 입력
  await b.evaluate(`
    const textInputs = document.querySelectorAll('.approval-form-panel input[type="text"]');
    if (textInputs[0]) {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(textInputs[0], 'E2E 자동검증 공식 행사명');
      textInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    }
    const textareas = document.querySelectorAll('.approval-form-panel textarea');
    if (textareas[1]) {
      const descArea = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      descArea.set.call(textareas[1], 'E2E 작성자 추가 의견 메모입니다.');
      textareas[1].dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await b.sleep(1200); // 자동 저장 대기

  const afterText = await b.evaluate(`
    return {
      eventName: document.querySelector('.a4-sheet b')?.textContent,
      note: [...document.querySelectorAll('.a4-sheet td')].find(t => t.textContent.includes('E2E 작성자 추가 의견'))?.textContent
    };
  `);
  check('공식 행사명 및 추가 의견 A4 반영', afterText.eventName === 'E2E 자동검증 공식 행사명' && Boolean(afterText.note), JSON.stringify(afterText));

  // 7. 한글(HWPX), Word(DOCX), PDF 다운로드 API 응답 검증
  const hwpxRes = await fetch(`${BASE}/api/approval/${draftId}/hwpx`, { headers: { Origin: BASE } });
  const hwpxBytes = new Uint8Array(await hwpxRes.arrayBuffer());
  check(
    '한글(.hwpx) 다운로드 응답 및 ZIP 매직넘버',
    hwpxRes.status === 200 && hwpxBytes[0] === 0x50 && hwpxBytes[1] === 0x4b,
    `Status ${hwpxRes.status}, ${hwpxBytes.length} bytes`,
  );

  const docxRes = await fetch(`${BASE}/api/approval/${draftId}/docx`, { headers: { Origin: BASE } });
  const docxBytes = new Uint8Array(await docxRes.arrayBuffer());
  check(
    'Word(.docx) 다운로드 응답 및 ZIP 매직넘버',
    docxRes.status === 200 && docxBytes[0] === 0x50 && docxBytes[1] === 0x4b,
    `Status ${docxRes.status}, ${docxBytes.length} bytes`,
  );

  const pdfRes = await fetch(`${BASE}/api/approval/${draftId}/pdf`, { headers: { Origin: BASE } });
  const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
  check(
    'PDF 다운로드 응답 및 %PDF 매직넘버',
    pdfRes.status === 200 && pdfBytes[0] === 0x25 && pdfBytes[1] === 0x50 && pdfBytes[2] === 0x44,
    `Status ${pdfRes.status}, ${pdfBytes.length} bytes`,
  );

  // 8. 포장·스티커 꾸미기 링크 연결 확인
  const packagingLink = await b.evaluate(`
    return document.querySelector('header a[href*="/packaging"]')?.getAttribute('href');
  `);
  check('포장·스티커 꾸미기 링크 생성', Boolean(packagingLink) && packagingLink.includes('qty=50') && packagingLink.includes('product='), packagingLink);

  // 9. 품의 요약 복사 버튼 존재 확인
  const copyBtn = await b.evaluate(`
    return [...document.querySelectorAll('button')].find(b => b.textContent.includes('품의요약 복사'))?.textContent;
  `);
  check('품의요약 복사 버튼 확인', Boolean(copyBtn), copyBtn);

  // 10. 초안 삭제
  await b.evaluate(`
    window.confirm = () => true;
    window.alert = () => {};
    document.querySelector('header button[title="초안 삭제"]').click();
  `);
  let afterDeleteUrl = '';
  for (let i = 0; i < 25; i++) {
    await b.sleep(200);
    afterDeleteUrl = await b.evaluate(`return window.location.pathname`);
    if (afterDeleteUrl.startsWith('/result')) break;
  }
  check('초안 삭제 후 결과 페이지로 이동', afterDeleteUrl.startsWith('/result'), afterDeleteUrl);

  const getDeleted = await fetch(`${BASE}/api/approval/${draftId}`, { headers: { Origin: BASE } });
  check('삭제된 초안 조회 시 404 차단', getDeleted.status === 404, `Status ${getDeleted.status}`);
} finally {
  await b.close();
}

const failed = results.filter((r) => !r);
console.log(failed.length ? `approval 검증 실패 (${failed.length}건)` : 'approval 검증 전체 통과');
process.exitCode = failed.length ? 1 : 0;
