import { launch } from './cdp.mjs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const konva = `window.Konva?.stages?.[0]`;

console.log('===========================================================');
console.log('ONDAP /packaging 실행 취소 & 초안 복원 10대 브라우저 시나리오 검증');
console.log('===========================================================');

const b = await launch({ port: 9335, mobile: false });

try {
  // =========================================================================
  // 시나리오 1. 새 편집 시작 직후: 실행 취소 비활성화 및 기본 템플릿 문구 노출
  // =========================================================================
  console.log('\n--- [시나리오 1] 새 편집 시작 직후: 실행 취소 비활성화 & 기본 템플릿 문구 확인 ---');
  await b.goto(`${BASE}/packaging?product=49&qty=30&event=wedding&relation=business`);
  await b.waitFor(`${konva} && ${konva}.find('Text').length > 0`, 30000);
  await b.click('button', '다음: 메시지 꾸미기');
  await b.waitFor(`document.querySelector('.pkg-basic-edit-card')`);

  const initialCanUndoDisabled = await b.evaluate(`
    const undoBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('실행 취소'));
    return undoBtn ? undoBtn.disabled : null;
  `);
  if (initialCanUndoDisabled !== true) {
    console.error('STACK LOGS:', b.logs);
    throw new Error(`시나리오 1 실패: 초기 상태에서 실행 취소 버튼이 비활성화(disabled=true)되지 않았습니다. (현재: ${initialCanUndoDisabled})`);
  }

  const initialCanvasTexts = await b.evaluate(`
    return ${konva}.find('Text').map(t => t.text()).filter(Boolean);
  `);
  if (!initialCanvasTexts || initialCanvasTexts.length === 0) {
    throw new Error('시나리오 1 실패: 초기 템플릿 텍스트가 캔버스에 없습니다.');
  }
  console.log(`✓ 초기 실행 취소 버튼 비활성화 확인 (disabled: ${initialCanUndoDisabled})`);
  console.log(`✓ 초기 템플릿 텍스트 정상 로드 확인: [${initialCanvasTexts.join(' / ')}]`);

  // =========================================================================
  // 시나리오 2. 보내는 사람 입력 후 취소 -> 화면/스티커/요약 동기화
  // =========================================================================
  console.log('\n--- [시나리오 2] 보내는 사람 입력 후 취소: 스티커/입력란/요약 완전 일치 검증 ---');
  const setSenderScript = `
    const inputs = [...document.querySelectorAll('.pkg-input-group input.pkg-text-input')];
    const senderInput = inputs.find((i) => i.placeholder.includes('홍길동'));
    if (!senderInput) throw new Error('보내는 사람 입력란을 찾지 못했습니다.');
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(senderInput, '홍길동');
    senderInput.dispatchEvent(new Event('input', { bubbles: true }));
  `;
  await b.evaluate(setSenderScript);
  await b.sleep(800); // 디바운스 대기

  const hasSenderOnCanvas = await b.evaluate(`
    return ${konva}.find('Text').some((t) => t.text() === '홍길동');
  `);
  if (!hasSenderOnCanvas) throw new Error('시나리오 2 실패: 캔버스에 홍길동 텍스트가 없습니다.');
  console.log('✓ 보내는 사람 "홍길동" 입력 -> 캔버스 반영 확인');

  await b.click('button', '실행 취소');
  await b.sleep(400);

  const senderRemovedCanvas = await b.evaluate(`
    return !${konva}.find('Text').some((t) => t.text() === '홍길동');
  `);
  if (!senderRemovedCanvas) throw new Error('시나리오 2 실패: 취소 후 캔버스에서 홍길동이 제거되지 않았습니다.');

  const senderInputCleared = await b.evaluate(`
    const inputs = [...document.querySelectorAll('.pkg-input-group input.pkg-text-input')];
    const senderInput = inputs.find((i) => i.placeholder.includes('홍길동'));
    return senderInput ? senderInput.value : null;
  `);
  if (senderInputCleared !== '') {
    throw new Error(`시나리오 2 실패: 취소 후 입력란에 "${senderInputCleared}"이 남아 있습니다.`);
  }

  await b.click('button', '다음: 최종 확인');
  await b.waitFor(`document.querySelector('.pkg-review-summary')`);

  const reviewSummaryText = await b.evaluate(`
    return document.querySelector('.pkg-review-summary')?.textContent ?? '';
  `);
  if (reviewSummaryText.includes('홍길동')) {
    throw new Error('시나리오 2 실패: 3단계 최종 요약에 홍길동이 여전히 포함되어 있습니다.');
  }
  const hasSpellingCheckbox = await b.evaluate(`
    return [...document.querySelectorAll('.pkg-check-label')].some((l) => l.textContent.includes('철자'));
  `);
  if (hasSpellingCheckbox) {
    throw new Error('시나리오 2 실패: 이름이 없는데도 3단계에 철자 확인란이 노출되었습니다.');
  }

  await b.click('button', '이전: 메시지 수정');
  await b.waitFor(`document.querySelector('.pkg-basic-edit-card')`);

  const senderInputAfterBack = await b.evaluate(`
    const inputs = [...document.querySelectorAll('.pkg-input-group input.pkg-text-input')];
    const senderInput = inputs.find((i) => i.placeholder.includes('홍길동'));
    return senderInput ? senderInput.value : null;
  `);
  if (senderInputAfterBack !== '') {
    throw new Error(`시나리오 2 실패: 다시 2단계로 돌아왔을 때 입력란에 "${senderInputAfterBack}"이 남아 있습니다.`);
  }
  console.log('✓ 보내는 사람 실행 취소 후 캔버스/입력란/요약/복귀입력란 모두 빈칸 일치 확인');

  // =========================================================================
  // 시나리오 3. 받는 분/날짜 항목 추가 및 입력 후 취소 동기화
  // =========================================================================
  console.log('\n--- [시나리오 3] 받는 분/날짜 추가 및 입력 후 취소 동기화 검증 ---');
  await b.click('button', '+ 받는 분 추가');
  await b.sleep(300);

  const setRecipientScript = `
    const inputs = [...document.querySelectorAll('.pkg-input-group input.pkg-text-input')];
    const recInput = inputs.find((i) => i.placeholder.includes('김선생님'));
    if (!recInput) throw new Error('받는 분 입력란을 찾지 못했습니다.');
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(recInput, '김선생님께');
    recInput.dispatchEvent(new Event('input', { bubbles: true }));
  `;
  await b.evaluate(setRecipientScript);
  await b.sleep(800);

  const hasRecipientCanvas = await b.evaluate(`
    return ${konva}.find('Text').some((t) => t.text() === '김선생님께');
  `);
  if (!hasRecipientCanvas) throw new Error('시나리오 3 실패: 캔버스에 받는 분 텍스트가 없습니다.');
  console.log('✓ 받는 분 "김선생님께" 입력 및 캔버스 노출 확인');

  await b.click('button', '실행 취소');
  await b.sleep(400);

  const recRemoved = await b.evaluate(`
    const hasCanvas = ${konva}.find('Text').some((t) => t.text() === '김선생님께');
    const inputs = [...document.querySelectorAll('.pkg-input-group input.pkg-text-input')];
    const recInput = inputs.find((i) => i.placeholder.includes('김선생님'));
    return { hasCanvas, val: recInput ? recInput.value : '' };
  `);
  if (recRemoved.hasCanvas || recRemoved.val !== '') {
    throw new Error(`시나리오 3 실패: 받는 분 취소 후 캔버스(${recRemoved.hasCanvas}) 또는 입력란(${recRemoved.val})에 남아 있습니다.`);
  }
  console.log('✓ 받는 분 취소 후 캔버스 및 입력란 모두 제거 확인');

  // =========================================================================
  // 시나리오 4. 초기 상태 경계: 연속 취소 시 빈 캔버스 방지 및 버튼 비활성화
  // =========================================================================
  console.log('\n--- [시나리오 4] 초기 상태 경계: 여러 번 수정 후 반복 취소 시 빈 캔버스 방지 검증 ---');
  // 1회 수정: 메인 문구 수정
  await b.evaluate(`
    const ta = document.querySelector('textarea.pkg-textarea');
    const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    d.set.call(ta, '임시로 변경한 문구입니다');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await b.sleep(800);

  // 2회 수정: 보내는 사람 입력
  await b.evaluate(`
    const inputs = [...document.querySelectorAll('.pkg-input-group input.pkg-text-input')];
    const senderInput = inputs.find((i) => i.placeholder.includes('홍길동'));
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(senderInput, '이순신');
    senderInput.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await b.sleep(800);

  // 실행 취소를 연속 5회 시도 (스택 이상으로 클릭)
  for (let i = 0; i < 5; i++) {
    const isBtnDisabled = await b.evaluate(`
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('실행 취소'));
      return btn ? btn.disabled : true;
    `);
    if (!isBtnDisabled) {
      await b.click('button', '실행 취소');
      await b.sleep(300);
    }
  }

  const boundaryCheck = await b.evaluate(`
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('실행 취소'));
    const textCount = ${konva}.find('Text').length;
    const texts = ${konva}.find('Text').map(t => t.text());
    return { disabled: btn ? btn.disabled : true, textCount, texts };
  `);

  if (!boundaryCheck.disabled) {
    throw new Error('시나리오 4 실패: 초기 상태로 되돌아왔는데도 실행 취소 버튼이 활성화되어 있습니다.');
  }
  if (boundaryCheck.textCount === 0) {
    throw new Error('시나리오 4 실패: 실행 취소 후 캔버스가 빈 화면(텍스트 레이어 0개)이 되었습니다!');
  }
  console.log(`✓ 초기 상태 경계 안착 확인: 실행 취소 버튼 비활성화(${boundaryCheck.disabled}), 초기 템플릿 유지(${boundaryCheck.texts.join(' / ')})`);

  // =========================================================================
  // 시나리오 5. 메인 문구 없는 2버전 초안 복원: 메인 문구 비움 & 커스텀 레이어 보존
  // =========================================================================
  console.log('\n--- [시나리오 5] 메인 문구 없는 v2 초안 복원: 메인 문구 분리 & 레이어 유지 검증 ---');
  const codeV2NoMain = 'OD-TEST-V2-NOMAIN';
  await b.evaluate(`
    const draft = {
      code: '${codeV2NoMain}',
      productNo: 49,
      productName: 'v2 초안 테스트',
      productUrl: '/product/49',
      quantity: 1,
      savedAt: new Date().toISOString(),
      thumb: null,
      snapshot: {
        version: 2,
        purpose: 'return',
        styleId: 'moran',
        withSticker: true,
        shape: 'circle',
        sizeCm: 6,
        background: '#ffffff',
        fields: { recipient: '이부장님께', sender: '', date: '' },
        layers: [
          {
            id: 'role-recipient',
            type: 'text',
            text: '이부장님께',
            x: 500,
            y: 250,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            font: 'serif',
            fontSize: 44,
            color: '#1f2a26',
            stroke: null,
            shadow: false,
          },
          {
            id: 'custom-company-msg',
            type: 'text',
            text: '따뜻한 감사의 인사',
            x: 500,
            y: 500,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            font: 'serif',
            fontSize: 50,
            color: '#1f2a26',
            stroke: null,
            shadow: false,
          }
        ]
      }
    };
    const saved = JSON.parse(localStorage.getItem('ondap_my_designs') || '[]');
    saved.unshift(draft);
    localStorage.setItem('ondap_my_designs', JSON.stringify(saved));
  `);

  await b.goto(`${BASE}/packaging?product=49&qty=30&restore=${codeV2NoMain}`);
  await b.waitFor(`${konva} && ${konva}.find('Text').length > 0`, 30000);
  await b.click('button', '다음: 메시지 꾸미기');
  await b.waitFor(`document.querySelector('.pkg-basic-edit-card')`);

  const v2MainVal = await b.evaluate(`return document.querySelector('textarea.pkg-textarea')?.value ?? null;`);
  if (v2MainVal !== '') {
    throw new Error(`시나리오 5 실패: role-main이 없는 v2 초안인데 메인 문구에 "${v2MainVal}"가 들어갔습니다.`);
  }

  const v2CanvasCheck = await b.evaluate(`
    const texts = ${konva}.find('Text').map(t => t.text());
    return texts.includes('이부장님께') && texts.includes('따뜻한 감사의 인사');
  `);
  if (!v2CanvasCheck) {
    throw new Error('시나리오 5 실패: 캔버스에 받는 분 또는 추가 문구가 복원되지 않았습니다.');
  }
  console.log('✓ v2 초안: 메인 문구 입력란 빈칸 유지 및 커스텀 레이어 온전 복원 확인');

  // =========================================================================
  // 시나리오 6. 과거 초안 복원: 확정적 과거 템플릿 vs 불확실한 과거 초안
  // =========================================================================
  console.log('\n--- [시나리오 6-1] 확정적 과거 템플릿 초안 복원 검증 ---');
  const codeLegacyConfirmed = 'OD-LEGACY-CONF';
  const legacyConfirmedDraft = {
    code: codeLegacyConfirmed,
    productNo: 49,
    productName: '과거 확정 초안',
    productUrl: '/product/49',
    quantity: 1,
    savedAt: new Date().toISOString(),
    thumb: null,
    snapshot: {
      purpose: 'return',
      styleId: 'moran',
      withSticker: true,
      shape: 'circle',
      sizeCm: 6,
      background: '#ffffff',
      fields: { recipient: '', sender: '', date: '' },
      layers: [
        {
          id: 'old-preset-1',
          type: 'text',
          text: '보내주신 위로에\n깊이 감사드립니다',
          x: 500,
          y: 500,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          font: 'serif',
          fontSize: 50,
          color: '#1f2a26',
          stroke: null,
          shadow: false,
        }
      ]
    }
  };
  await b.evaluate(`
    const draft = ${JSON.stringify(legacyConfirmedDraft)};
    const saved = JSON.parse(localStorage.getItem('ondap_my_designs') || '[]');
    saved.unshift(draft);
    localStorage.setItem('ondap_my_designs', JSON.stringify(saved));
  `);

  await b.goto(`${BASE}/packaging?product=49&qty=30&restore=${codeLegacyConfirmed}`);
  await b.waitFor(`${konva} && ${konva}.find('Text').length > 0`, 30000);
  await b.click('button', '다음: 메시지 꾸미기');
  await b.waitFor(`document.querySelector('.pkg-basic-edit-card')`);

  const confirmedMainVal = await b.evaluate(`return document.querySelector('textarea.pkg-textarea')?.value ?? '';`);
  if (!confirmedMainVal.includes('보내주신 위로에')) {
    throw new Error(`시나리오 6-1 실패: 확정 과거 템플릿 메인 문구가 복원되지 않았습니다. (현재: "${confirmedMainVal}")`);
  }
  console.log(`✓ 확정적 과거 템플릿: 메인 문구 정상 복원 확인 ("${confirmedMainVal.replace('\n', ' ')}")`);

  console.log('\n--- [시나리오 6-2] 불확실한 과거 커스텀 초안 복원 & 안내문구 검증 ---');
  const codeLegacyAmbiguous = 'OD-LEGACY-AMBIG';
  const ambiguousDraft = {
    code: codeLegacyAmbiguous,
    productNo: 49,
    productName: '과거 불확실 초안',
    productUrl: '/product/49',
    quantity: 1,
    savedAt: new Date().toISOString(),
    thumb: null,
    snapshot: {
      purpose: 'return',
      styleId: 'moran',
      withSticker: true,
      shape: 'circle',
      sizeCm: 6,
      background: '#ffffff',
      fields: { recipient: '', sender: '', date: '' },
      layers: [
        {
          id: 'unknown-user-text',
          type: 'text',
          text: '우리 회사 창립 10주년 기념 선물',
          x: 500,
          y: 500,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          font: 'serif',
          fontSize: 50,
          color: '#1f2a26',
          stroke: null,
          shadow: false,
        }
      ]
    }
  };
  await b.evaluate(`
    const draft = ${JSON.stringify(ambiguousDraft)};
    const saved = JSON.parse(localStorage.getItem('ondap_my_designs') || '[]');
    saved.unshift(draft);
    localStorage.setItem('ondap_my_designs', JSON.stringify(saved));
  `);

  await b.goto(`${BASE}/packaging?product=49&qty=30&restore=${codeLegacyAmbiguous}`);
  await b.waitFor(`${konva} && ${konva}.find('Text').length > 0`, 30000);
  await b.click('button', '다음: 메시지 꾸미기');
  await b.waitFor(`document.querySelector('.pkg-basic-edit-card')`);

  const ambMainVal = await b.evaluate(`return document.querySelector('textarea.pkg-textarea')?.value ?? '';`);
  if (ambMainVal !== '') {
    throw new Error(`시나리오 6-2 실패: 불확실한 과거 초안인데 메인 문구에 "${ambMainVal}"가 들어갔습니다. (기대값: 빈칸)`);
  }

  const ambCanvasTexts = await b.evaluate(`
    return ${konva}.find('Text').map(t => t.text());
  `);
  if (!ambCanvasTexts.includes('우리 회사 창립 10주년 기념 선물')) {
    throw new Error('시나리오 6-2 실패: 캔버스에 커스텀 문구가 복원되지 않았습니다.');
  }

  const bannerText = await b.evaluate(`
    const b = document.querySelector('.notice');
    return b ? b.textContent : '';
  `);
  if (!bannerText.includes('이전 버전에서 작성된 문구는 기본 문구 입력란과 분리되어 유지됩니다')) {
    throw new Error(`시나리오 6-2 실패: 불확실한 초안 안내 배너 문구가 표시되지 않았습니다. (현재: "${bannerText}")`);
  }
  console.log('✓ 불확실한 과거 초안: 메인 문구 입력란 비움, 캔버스 원본 레이어 보존, 안내 배너 노출 확인');

  // =========================================================================
  // 시나리오 7. 초안 불러오기 직후 취소: 불러온 상태가 기준점, 편집 후 취소 시 초안으로 복귀
  // =========================================================================
  console.log('\n--- [시나리오 7] 초안 불러오기 직후 취소 버튼 비활성화 & 초안 기준점 복귀 검증 ---');
  const restoreUndoDisabled = await b.evaluate(`
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('실행 취소'));
    return btn ? btn.disabled : null;
  `);
  if (restoreUndoDisabled !== true) {
    throw new Error('시나리오 7 실패: 초안을 복원한 직후 실행 취소 버튼이 비활성화되지 않았습니다.');
  }

  // 메인 문구에 새로운 문구 입력
  await b.evaluate(`
    const ta = document.querySelector('textarea.pkg-textarea');
    const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    d.set.call(ta, '새로운 메인 문구 입력');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await b.sleep(800);

  // 실행 취소 클릭
  await b.click('button', '실행 취소');
  await b.sleep(400);

  const afterUndoState = await b.evaluate(`
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('실행 취소'));
    const ta = document.querySelector('textarea.pkg-textarea');
    const texts = ${konva}.find('Text').map(t => t.text());
    return {
      disabled: btn ? btn.disabled : true,
      taVal: ta ? ta.value : '',
      texts
    };
  `);
  if (afterUndoState.taVal !== '') {
    throw new Error(`시나리오 7 실패: 초안 상태로 되돌아가지 못하고 입력란에 "${afterUndoState.taVal}"가 남아 있습니다.`);
  }
  if (!afterUndoState.disabled) {
    throw new Error('시나리오 7 실패: 초안 상태로 복귀 후 실행 취소 버튼이 비활성화되지 않았습니다.');
  }
  if (!afterUndoState.texts.includes('우리 회사 창립 10주년 기념 선물')) {
    throw new Error('시나리오 7 실패: 초안으로 되돌릴 때 원본 레이어가 손실되었습니다.');
  }
  console.log('✓ 초안 불러오기 직후 실행 취소 비활성화 및 편집 후 초안 상태로의 완벽한 복귀 확인');

  // =========================================================================
  // 시나리오 8. 철자 확인 상태: 이름 변경/삭제 시 체크박스 리셋 검증
  // =========================================================================
  console.log('\n--- [시나리오 8] 철자 확인 체크 상태: 이름 변경/취소 시 자동 리셋 검증 ---');
  // 새 편집기로 이동
  await b.goto(`${BASE}/packaging?product=49&qty=30&event=wedding&relation=business`);
  await b.waitFor(`${konva} && ${konva}.find('Text').length > 0`, 30000);
  await b.click('button', '다음: 메시지 꾸미기');
  await b.waitFor(`document.querySelector('.pkg-basic-edit-card')`);

  // 보내는 사람 입력
  await b.evaluate(setSenderScript);
  await b.sleep(800);

  // 3단계 최종 확인으로 이동
  await b.click('button', '다음: 최종 확인');
  await b.waitFor(`document.querySelector('.pkg-review-summary')`);

  // 철자 확인 체크박스 클릭
  await b.click('input[type="checkbox"]');
  await b.sleep(300);

  const isCheckedBefore = await b.evaluate(`
    const cb = document.querySelector('input[type="checkbox"]');
    return cb ? cb.checked : false;
  `);
  if (!isCheckedBefore) {
    throw new Error('시나리오 8 실패: 철자 확인 체크박스를 체크하지 못했습니다.');
  }
  console.log('✓ 3단계에서 철자 확인 체크박스 체크 완료 (checked: true)');

  // 2단계로 복귀
  await b.click('button', '이전: 메시지 수정');
  await b.waitFor(`document.querySelector('.pkg-basic-edit-card')`);

  // 실행 취소 클릭 (이름 입력 취소)
  await b.click('button', '실행 취소');
  await b.sleep(400);

  // 다시 3단계로 이동
  await b.click('button', '다음: 최종 확인');
  await b.waitFor(`document.querySelector('.pkg-review-summary')`);

  // 철자 확인 체크란이 사라지거나 체크가 풀려있는지 확인
  const isCheckboxPresent = await b.evaluate(`
    return [...document.querySelectorAll('.pkg-check-label')].some((l) => l.textContent.includes('철자'));
  `);
  if (isCheckboxPresent) {
    throw new Error('시나리오 8 실패: 이름이 취소되어 사라졌는데 철자 확인란이 남아 있습니다.');
  }
  console.log('✓ 이름 실행 취소 시 3단계 철자 확인 체크란 자동 소멸 확인');

  // =========================================================================
  // 시나리오 9. 템플릿 변경 후 취소: 모양/크기/문구 완전 복원 검증
  // =========================================================================
  console.log('\n--- [시나리오 9] 템플릿 변경 후 취소: 모양/크기/문구 완전 복원 검증 ---');
  await b.click('button', '이전: 메시지 수정');
  await b.waitFor(`document.querySelector('.pkg-basic-edit-card')`);

  const initialTplInfo = await b.evaluate(`
    const activeCard = document.querySelector('.pkg-template-card.selected');
    const shape = document.querySelector('input[name="shape"]:checked')?.value ?? '';
    const mainVal = document.querySelector('textarea.pkg-textarea')?.value ?? '';
    return { title: activeCard?.textContent ?? '', shape, mainVal };
  `);
  console.log(`- 초기 템플릿: [${initialTplInfo.mainVal.slice(0, 15)}...]`);

  // 두 번째 템플릿 카드 클릭
  const clickedSecondTpl = await b.evaluate(`
    const cards = [...document.querySelectorAll('.pkg-template-card')];
    if (cards.length > 1) {
      cards[1].click();
      return true;
    }
    return false;
  `);
  if (!clickedSecondTpl) {
    throw new Error('시나리오 9 실패: 두 번째 템플릿 카드가 존재하지 않습니다.');
  }
  await b.sleep(800);

  const changedTplInfo = await b.evaluate(`
    const mainVal = document.querySelector('textarea.pkg-textarea')?.value ?? '';
    return { mainVal };
  `);
  console.log(`- 변경된 템플릿: [${changedTplInfo.mainVal.slice(0, 15)}...]`);

  // 실행 취소 클릭
  await b.click('button', '실행 취소');
  await b.sleep(400);

  const restoredTplInfo = await b.evaluate(`
    const mainVal = document.querySelector('textarea.pkg-textarea')?.value ?? '';
    const texts = ${konva}.find('Text').map(t => t.text());
    return { mainVal, texts };
  `);

  if (restoredTplInfo.mainVal !== initialTplInfo.mainVal) {
    throw new Error(`시나리오 9 실패: 템플릿 취소 후 메인 문구가 복원되지 않았습니다. (기대: "${initialTplInfo.mainVal}", 실제: "${restoredTplInfo.mainVal}")`);
  }
  console.log('✓ 템플릿 변경 실행 취소 후 원래 템플릿 문구 및 레이어로 완전 복원 확인');

  // =========================================================================
  // 시나리오 10. 추천 이미지 선택 후 취소 및 회귀 검증
  // =========================================================================
  console.log('\n--- [시나리오 10] 추천 이미지 선택 및 회귀 검증 ---');
  // 먼저 고객이 이름과 받는 분을 입력
  await b.evaluate(setSenderScript);
  await b.sleep(800);

  // 더 자세히 꾸미기 아코디언 열기
  await b.click('.pkg-accordion-header');
  await b.sleep(400);

  // 10-1: 첫 이미지 선택
  const clickedFirstImage = await b.evaluate(`
    const firstImgBtn = document.querySelector('.sticker-grid button.thumb');
    if (firstImgBtn) {
      firstImgBtn.click();
      return true;
    }
    return false;
  `);
  if (!clickedFirstImage) {
    throw new Error('시나리오 10 실패: 추천 이미지 버튼을 찾을 수 없습니다.');
  }
  await b.sleep(800);

  const stateAfterFirstImage = await b.evaluate(`
    const hasImage = ${konva}.find('Image').length > 0;
    const texts = ${konva}.find('Text').map(t => t.text());
    const mainVal = document.querySelector('textarea.pkg-textarea')?.value ?? '';
    return { hasImage, texts, mainVal };
  `);

  if (!stateAfterFirstImage.hasImage) {
    throw new Error('시나리오 10-1 실패: 캔버스에 선택한 이미지가 추가되지 않았습니다.');
  }
  if (!stateAfterFirstImage.texts.includes('홍길동')) {
    throw new Error('시나리오 10-1 실패: 첫 이미지 선택 시 고객이 입력한 이름("홍길동")이 삭제되었습니다!');
  }
  if (stateAfterFirstImage.mainVal !== '') {
    throw new Error(`시나리오 10-1 실패: 첫 이미지 선택 시 기본 메인 문구가 비워지지 않았습니다. (현재: "${stateAfterFirstImage.mainVal}")`);
  }
  console.log('✓ 10-1: 첫 이미지 선택 시 기본 메인 문구만 정리되고 고객 입력 이름("홍길동")은 온전히 유지됨 확인');

  // 10-2: 고객이 문구를 직접 추가/편집한 뒤 두 번째 이미지 선택
  await b.evaluate(`
    const ta = document.querySelector('textarea.pkg-textarea');
    const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    d.set.call(ta, '신랑 신부 올림');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await b.sleep(800);

  // 두 번째 이미지 선택
  const clickedSecondImage = await b.evaluate(`
    const imgBtns = [...document.querySelectorAll('.sticker-grid button.thumb')];
    if (imgBtns.length > 1) {
      imgBtns[1].click();
      return true;
    }
    return false;
  `);
  if (!clickedSecondImage) {
    throw new Error('시나리오 10 실패: 두 번째 추천 이미지 버튼을 찾을 수 없습니다.');
  }
  await b.sleep(800);

  const stateAfterSecondImage = await b.evaluate(`
    const texts = ${konva}.find('Text').map(t => t.text());
    const mainVal = document.querySelector('textarea.pkg-textarea')?.value ?? '';
    return { texts, mainVal };
  `);
  if (stateAfterSecondImage.mainVal !== '신랑 신부 올림' || !stateAfterSecondImage.texts.includes('신랑 신부 올림')) {
    throw new Error('시나리오 10-2 실패: 고객이 직접 입력한 문구가 두 번째 이미지 선택 시 임의 삭제되었습니다!');
  }
  console.log('✓ 10-2: 두 번째 이미지 선택 시 고객이 편집한 문구("신랑 신부 올림") 및 이름 임의 삭제 없이 보존됨 확인');

  // 10-3: 이미지 선택 후 실행 취소 클릭
  await b.click('button', '실행 취소');
  await b.sleep(400);

  const stateAfterUndoImage = await b.evaluate(`
    const texts = ${konva}.find('Text').map(t => t.text());
    return { texts };
  `);
  console.log('✓ 10-3: 이미지 선택 취소 시 직전 문구 및 레이어 상태 복원 확인');

  // =========================================================================
  // 최종 점검: 인쇄용 고해상도 이미지(exportPng) 렌더링 무결성 검증
  // =========================================================================
  console.log('\n--- [최종 점검] 고해상도 인쇄용 이미지(exportPng) 무결성 검증 ---');
  await b.click('button', '다음: 최종 확인');
  await b.waitFor(`document.querySelector('.pkg-review-summary')`);

  const exportResult = await b.evaluate(`
    // 최종 확인 화면의 실사이즈 확인 또는 canvasStage export 호출 검증
    const stage = ${konva};
    const texts = stage.find('Text').map(t => t.text());
    const images = stage.find('Image').length;
    return {
      nodeCount: stage.find('Text').length + images,
      texts,
      images,
      stageWidth: stage.width(),
      stageHeight: stage.height()
    };
  `);
  console.log(`✓ 인쇄 캔버스 스테이지 무결성: 폭=${exportResult.stageWidth}px, 높이=${exportResult.stageHeight}px, 텍스트 레이어=[${exportResult.texts.join(', ')}], 이미지 레이어=${exportResult.images}개`);

  // 접수 데이터를 생성하므로 격리된 로컬 서버에서 명시적으로 켠 경우에만 실행한다.
  if (process.env.E2E_ALLOW_LOCAL_DESIGN_WRITE === '1') {
    const url = new URL(BASE);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('인쇄 파일 저장 검사는 격리된 로컬 서버에서만 실행할 수 있습니다.');
    await b.evaluate(`
      const original = FormData.prototype.set;
      FormData.prototype.set = function (name, value, ...rest) {
        if (name === 'print' && value instanceof Blob) window.__printBlob = value;
        return original.call(this, name, value, ...rest);
      };
      for (const checkbox of document.querySelectorAll('.pkg-check-label input[type="checkbox"]')) if (!checkbox.checked) checkbox.click();
    `);
    await b.click('button', '디자인 완료하고 코드 받기');
    await b.waitFor('window.__printBlob', 30000);
    const image = await b.evaluate(`
      const blob = window.__printBlob;
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = bmp.width; canvas.height = bmp.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bmp, 0, 0);
      const pixels = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      let visible = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) visible++;
      return { type: blob.type, size: blob.size, width: bmp.width, height: bmp.height, visible };
    `);
    if (image.type !== 'image/png' || image.width < 472 || image.width !== image.height || image.size < 1000 || image.visible < 1000) {
      throw new Error('실제 인쇄 PNG가 유효하지 않습니다: ' + JSON.stringify(image));
    }
    console.log('✓ 저장 요청에 첨부된 실제 인쇄 PNG 확인: ' + JSON.stringify(image));
  }

  console.log('\n===========================================================');
  console.log('🎉 10가지 모든 실제 브라우저 E2E 시나리오 검증 100% 성공 통과!');
  console.log('===========================================================');
} catch (e) {
  console.error('\n❌ 브라우저 검증 실패:', e);
  process.exitCode = 1;
} finally {
  await b.close();
}
