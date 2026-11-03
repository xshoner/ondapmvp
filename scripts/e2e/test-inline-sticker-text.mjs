// 스티커 미리보기 문구 직접 편집 실제 브라우저 E2E 검증 스크립트
import { launch } from './cdp.mjs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const konva = `window.Konva?.stages?.[0]`;

async function run() {
  console.log('=== 스티커 미리보기 문구 직접 편집 실브라우저 E2E 검증 시작 ===');
  const b = await launch({ port: 9334, mobile: true });

  try {
    // 1. 에디터 진입
    await b.goto(`${BASE}/packaging?product=49&qty=30&event=wedding&relation=business`);
    await b.waitFor(`${konva} && ${konva}.find('Text').length > 0`, 30000);
    check('포장 편집기 정상 로드', true);

    // 2. 가로 넘침 점검 (320px, 375px, 390px, 430px, 1280px)
    const viewports = [
      { w: 320, h: 667, name: '320px 모바일' },
      { w: 375, h: 812, name: '375px 모바일 (iPhone SE)' },
      { w: 390, h: 844, name: '390px 모바일 (iPhone 14/15)' },
      { w: 430, h: 932, name: '430px 모바일 (iPhone Pro Max)' },
      { w: 1280, h: 900, name: '1280px 데스크톱' },
    ];

    for (const vp of viewports) {
      await b.send('Emulation.setDeviceMetricsOverride', {
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: vp.w < 600 ? 2 : 1,
        mobile: vp.w < 600,
      });
      await b.sleep(300);
      const overflow = await b.evaluate(`return document.documentElement.scrollWidth > document.documentElement.clientWidth`);
      check(`${vp.name} 가로 스크롤/넘침 없음`, !overflow, `scrollWidth: ${await b.evaluate(`return document.documentElement.scrollWidth`)}, clientWidth: ${await b.evaluate(`return document.documentElement.clientWidth`)}`);
    }

    // 375px 모바일 환경으로 복귀
    await b.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await b.sleep(300);

    // 3. 기존 '선택한 문구 편집' 별도 textarea 제거 확인
    const oldTextareaExists = await b.evaluate(`return Boolean(document.querySelector('textarea[aria-label="선택한 문구 편집"]'))`);
    check('기존 하단 "선택한 문구 편집" textarea 완전 삭제 확인', !oldTextareaExists);

    // 4. Step 2 (메시지 꾸미기)로 이동
    await b.click('button', '다음: 인쇄물 꾸미기');
    await b.sleep(400);

    // 5. 캔버스에서 메인 문구 클릭 시뮬레이션
    // Konva stage에서 text 노드의 클라이언트 좌표를 구하여 직접 클릭
    const textPos = await b.evaluate(`
      const textNode = ${konva}.find('Text')[0];
      if (!textNode) return null;
      const stage = ${konva};
      const container = stage.container().getBoundingClientRect();
      const nodePos = textNode.absolutePosition();
      return {
        x: container.left + nodePos.x,
        y: container.top + nodePos.y,
        id: textNode.id(),
        currentText: textNode.text()
      };
    `);
    check('Konva 텍스트 노드 탐색', Boolean(textPos), JSON.stringify(textPos));

    // 브라우저 마우스/터치 클릭 이벤트 발생 (mousedown + click 동기화)
    await b.evaluate(`
      const stage = ${konva};
      const textNode = stage.find('Text')[0];
      textNode.fire('mousedown', { evt: { clientX: 180, clientY: 200 } });
      textNode.fire('click', { evt: { clientX: 180, clientY: 200 } });
    `);
    await b.sleep(300);

    // 6. 인라인 에디터 등장 확인
    await b.waitFor(`document.querySelector('.pkg-inline-editor-card')`, 5000);
    const editorInfo = await b.evaluate(`
      const card = document.querySelector('.pkg-inline-editor-card');
      const textarea = document.querySelector('.pkg-inline-editor-textarea');
      const counter = document.querySelector('.pkg-inline-editor-counter');
      const cancelBtn = document.querySelector('.pkg-inline-cancel-btn');
      const doneBtn = document.querySelector('.pkg-inline-done-btn');
      const stageWrapper = document.querySelector('.pkg-canvas-stage-wrapper');
      const cardRect = card?.getBoundingClientRect();
      const wrapperRect = stageWrapper?.getBoundingClientRect();
      return {
        hasCard: Boolean(card),
        hasTextarea: Boolean(textarea),
        hasCounter: counter?.textContent,
        hasCancelBtn: Boolean(cancelBtn),
        hasDoneBtn: Boolean(doneBtn),
        value: textarea?.value,
        ariaLabel: textarea?.getAttribute('aria-label'),
        withinStage: cardRect && wrapperRect ? (
          cardRect.left >= wrapperRect.left - 2 &&
          cardRect.right <= wrapperRect.right + 2
        ) : false
      };
    `);

    check('인라인 에디터 카드 및 컨트롤 렌더링', editorInfo.hasCard && editorInfo.hasTextarea && editorInfo.hasDoneBtn);
    check('인라인 에디터가 캔버스 영역 내 클램핑됨', editorInfo.withinStage);
    check('접근성 aria-label 제공 ("스티커 문구 직접 편집")', editorInfo.ariaLabel === '스티커 문구 직접 편집');

    // 7. 한글 IME 및 줄바꿈(\n) 직접 입력
    const sampleKoreanMultiline = '마음 깊이\n감사드립니다';
    await b.evaluate(`
      const ta = document.querySelector('.pkg-inline-editor-textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(sampleKoreanMultiline)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await b.sleep(200);

    const counterText = await b.evaluate(`return document.querySelector('.pkg-inline-editor-counter')?.textContent`);
    check('글자 수 카운터 실시간 업데이트', counterText === `${sampleKoreanMultiline.length}/120자`, counterText);

    // 8. 완료 버튼 클릭으로 커밋
    await b.click('.pkg-inline-done-btn');
    await b.sleep(400);

    const konvaAfterCommit = await b.evaluate(`
      const t = ${konva}.find('Text')[0];
      return t ? t.text() : null;
    `);
    check('완료 후 Konva 캔버스에 한글 및 줄바꿈 문구 즉시 반영', konvaAfterCommit === sampleKoreanMultiline, konvaAfterCommit);

    // 8-1. 드래그 vs 탭 구분 검증: 20px 이상 드래그 이동 시 인라인 에디터가 열리지 않고 위치만 이동
    const dragTestResult = await b.evaluate(`
      const stage = ${konva};
      const textNode = stage.find('Text')[0];
      const initialPos = { x: textNode.x(), y: textNode.y() };
      
      // 드래그 시뮬레이션: mousedown at (100, 100), dragmove to (150, 150), dragend at (150, 150)
      textNode.fire('mousedown', { evt: { clientX: 100, clientY: 100 } });
      textNode.fire('dragstart');
      textNode.x(initialPos.x + 30);
      textNode.y(initialPos.y + 30);
      textNode.fire('dragmove');
      textNode.fire('dragend', { target: textNode });
      // 드래그 종료 직후 딸려오는 click 이벤트
      textNode.fire('click', { evt: { clientX: 150, clientY: 150 } });

      const hasEditor = Boolean(document.querySelector('.pkg-inline-editor-card'));
      return {
        moved: textNode.x() !== initialPos.x,
        hasEditor,
        finalX: textNode.x(),
        finalY: textNode.y()
      };
    `);
    check('드래그 조작 시 인라인 에디터가 열리지 않고 위치만 정상 이동', dragTestResult.moved && !dragTestResult.hasEditor, JSON.stringify(dragTestResult));

    // 9. 글자 서식 변경(폰트 크기/스타일) 후에도 편집 내용 보존
    await b.click('.pkg-step-btn', '+');
    await b.sleep(300);
    const konvaAfterStyle = await b.evaluate(`
      const t = ${konva}.find('Text')[0];
      return t ? t.text() : null;
    `);
    check('서식 변경(+ 버튼) 후에도 직접 편집한 문구 온전히 보존', konvaAfterStyle === sampleKoreanMultiline, konvaAfterStyle);

    // 10. 취소 동작 검증: 다시 열고 타이핑 후 취소 시 이전 내용 복원
    await b.evaluate(`
      const stage = ${konva};
      const textNode = stage.find('Text')[0];
      textNode.fire('mousedown', { evt: { clientX: 180, clientY: 200 } });
      textNode.fire('click', { evt: { clientX: 180, clientY: 200 } });
    `);
    await b.waitFor(`document.querySelector('.pkg-inline-editor-card')`, 5000);
    await b.evaluate(`
      const ta = document.querySelector('.pkg-inline-editor-textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '취소될 문구입니다');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await b.sleep(200);
    await b.click('.pkg-inline-cancel-btn');
    await b.sleep(400);

    const konvaAfterCancel = await b.evaluate(`
      const t = ${konva}.find('Text')[0];
      return t ? t.text() : null;
    `);
    check('취소 시 변경 내용 폐기 및 이전 문구 복원', konvaAfterCancel === sampleKoreanMultiline, konvaAfterCancel);

    // 11. 120자 초과 입력 방지 검증
    await b.evaluate(`
      const stage = ${konva};
      const textNode = stage.find('Text')[0];
      textNode.fire('mousedown', { evt: { clientX: 180, clientY: 200 } });
      textNode.fire('click', { evt: { clientX: 180, clientY: 200 } });
    `);
    await b.waitFor(`document.querySelector('.pkg-inline-editor-card')`, 5000);
    await b.evaluate(`
      const ta = document.querySelector('.pkg-inline-editor-textarea');
      const longText = '가'.repeat(150);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, longText);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await b.sleep(200);
    const clampedLength = await b.evaluate(`return document.querySelector('.pkg-inline-editor-textarea')?.value.length`);
    check('120자 초과 입력 차단 (최대 120자)', clampedLength === 120, `길이: ${clampedLength}`);
    await b.click('.pkg-inline-cancel-btn');
    await b.sleep(300);

    // 편집 중 배경을 터치하면 작성 내용을 잃지 않고 확정한다.
    await b.evaluate(`
      const stage = ${konva};
      const textNode = stage.find('Text')[0];
      textNode.fire('mousedown', { evt: { clientX: 180, clientY: 200 } });
      textNode.fire('click', { evt: { clientX: 180, clientY: 200 } });
    `);
    await b.waitFor(`document.querySelector('.pkg-inline-editor-textarea')`);
    await b.evaluate(`
      const ta = document.querySelector('.pkg-inline-editor-textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '배경 선택 후 보존');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await b.sleep(200);
    await b.evaluate(`const stage = ${konva}; stage.findOne('.bg').fire('touchstart', { evt: { touches: [] } }, true);`);
    await b.sleep(300);
    const afterOutsideTap = await b.evaluate(`return ${konva}.find('Text')[0]?.text()`);
    check('편집 중 배경 터치 시 입력 보존', afterOutsideTap === '배경 선택 후 보존', afterOutsideTap);
    await b.evaluate(`
      const stage = ${konva}; const node = stage.find('Text')[0];
      node.fire('mousedown', { evt: { clientX: 180, clientY: 200 } });
      node.fire('click', { evt: { clientX: 180, clientY: 200 } });
    `);
    await b.waitFor(`document.querySelector('.pkg-inline-editor-textarea')`);
    await b.evaluate(`
      const ta = document.querySelector('.pkg-inline-editor-textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(sampleKoreanMultiline)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await b.click('.pkg-inline-done-btn');
    await b.sleep(300);

    // 12. 최종 저장 및 코드 발급 검증
    await b.click('button', '다음: 최종 확인');
    await b.sleep(500);

    // 철자 확인 체크박스가 있으면 체크
    await b.evaluate(`
      const cb = document.querySelector('.pkg-check-label input[type="checkbox"]');
      if (cb && !cb.checked) cb.click();
    `);
    await b.sleep(300);

    // 저장 버튼 클릭
    await b.click('button', '디자인 완료하고 코드 받기');
    try {
      await b.waitFor(`document.querySelector('.pkg-result-code-card')`, 25000);
    } catch (e) {
      const pageAlert = await b.evaluate(`return document.querySelector('[role="alert"]')?.textContent || document.querySelector('.pkg-alert-box')?.textContent || '알림 없음'`);
      console.log('--- 저장 실패 시 화면 안내:', pageAlert);
      throw e;
    }

    const resultCode = await b.evaluate(`return document.querySelector('.design-code')?.textContent?.trim()`);
    check('디자인 저장 성공 및 디자인 코드 발급', Boolean(resultCode && (resultCode.startsWith('OD-') || resultCode.startsWith('PK-'))), resultCode);

    // 13. 발급된 디자인 코드 재조회 시 직접 편집한 문구 복원 검증
    await b.goto(`${BASE}/packaging?product=49&restore=${resultCode}`);
    await b.waitFor(`${konva} && ${konva}.find('Text').length > 0`, 30000);
    await b.sleep(500);

    const restoredKonvaText = await b.evaluate(`
      const t = ${konva}.find('Text')[0];
      return t ? t.text() : null;
    `);
    check('저장본 재조회 시 직접 편집한 한글·줄바꿈 문구 완전 복원', restoredKonvaText === sampleKoreanMultiline, restoredKonvaText);

  } catch (err) {
    check('E2E 실행 예외 발생', false, err.message);
  } finally {
    if (b.logs.length > 0) {
      console.log('--- 브라우저 로그 ---');
      for (const log of b.logs) console.log(log);
    }
    await b.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== 검증 요약: 전체 ${results.length}건 중 성공 ${results.length - failed.length}건, 실패 ${failed.length}건 ===`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

run();
