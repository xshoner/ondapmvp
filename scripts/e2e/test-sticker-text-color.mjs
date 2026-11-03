// 스티커 문구 직접 편집 줄바꿈 차이 및 글자색/배경색 선택 실브라우저 E2E 검증 스크립트
import { launch } from './cdp.mjs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3350';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const konva = `window.Konva?.stages?.[0]`;

async function run() {
  console.log('=== 스티커 문구 편집 및 색상 선택 실브라우저 E2E 검증 시작 ===');
  const b = await launch({ port: 9350, mobile: true });

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

    // 3. Step 2 (인쇄물 꾸미기)로 이동
    await b.click('button', '다음: 인쇄물 꾸미기');
    await b.sleep(500);

    // 4. 글자색 및 배경색 OS 컬러 선택기 (input[type="color"]) 검증
    // 4-1. 임의의 글자색(#e74c3c) 선택
    const customTextColor = '#e74c3c';
    await b.evaluate(`
      const input = document.querySelector('input[type="color"][aria-label="글자색 직접 선택"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '${customTextColor}');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `);
    await b.sleep(400);

    const konvaTextColor = await b.evaluate(`
      const text = ${konva}.find('Text')[0];
      return text ? text.fill() : null;
    `);
    check('임의의 글자색(#e74c3c) 선택 시 Konva 캔버스 즉시 반영', konvaTextColor === customTextColor, konvaTextColor);

    const bgAfterTextColor = await b.evaluate(`
      const bgRect = ${konva}.find('Rect')[0];
      return bgRect ? bgRect.fill() : null;
    `);
    check('글자색 변경 시 배경색 미간섭(기존 흰색 유지)', bgAfterTextColor === '#ffffff', bgAfterTextColor);

    // 4-2. 임의의 배경색(#2c3e50) 선택
    const customBgColor = '#2c3e50';
    await b.evaluate(`
      const input = document.querySelector('input[type="color"][aria-label="배경색 직접 선택"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '${customBgColor}');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `);
    await b.sleep(400);

    const konvaBgColor = await b.evaluate(`
      const bgRect = ${konva}.find('Rect')[0];
      return bgRect ? bgRect.fill() : null;
    `);
    check('임의의 배경색(#2c3e50) 선택 시 Konva 캔버스 즉시 반영', konvaBgColor === customBgColor, konvaBgColor);

    const textAfterBgColor = await b.evaluate(`
      const text = ${konva}.find('Text')[0];
      return text ? text.fill() : null;
    `);
    check('배경색 변경 시 글자색 미간섭(선택한 #e74c3c 유지)', textAfterBgColor === customTextColor, textAfterBgColor);

    // 4-3. 글자 외곽선 및 그림자 토글 시 색상 유지 확인
    await b.evaluate(`
      const strokeCb = [...document.querySelectorAll('label')].find(l => l.textContent.includes('글자 외곽선'))?.querySelector('input');
      if (strokeCb && !strokeCb.checked) strokeCb.click();
      const shadowCb = [...document.querySelectorAll('label')].find(l => l.textContent.includes('그림자'))?.querySelector('input');
      if (shadowCb && !shadowCb.checked) shadowCb.click();
    `);
    await b.sleep(300);

    const textEffects = await b.evaluate(`
      const text = ${konva}.find('Text')[0];
      return {
        fill: text.fill(),
        stroke: text.stroke(),
        shadowEnabled: text.shadowEnabled()
      };
    `);
    check('외곽선 및 그림자 적용 시 글자색 보존', textEffects.fill === customTextColor && Boolean(textEffects.stroke) && textEffects.shadowEnabled, JSON.stringify(textEffects));

    // 5. 문구 직접 편집: 줄바꿈 차이 수정 및 가로 이동 검증
    // 5-1. Konva 텍스트 노드 클릭하여 인라인 에디터 오픈
    await b.evaluate(`
      const stage = ${konva};
      const textNode = stage.find('Text')[0];
      textNode.fire('mousedown', { evt: { clientX: 180, clientY: 200 } });
      textNode.fire('click', { evt: { clientX: 180, clientY: 200 } });
    `);
    await b.waitFor(`document.querySelector('.pkg-inline-editor-card')`, 5000);
    check('인라인 에디터 정상 오픈', true);

    // 5-2. 자동 줄바꿈을 유발하던 긴 단일 문장 입력
    const longSingleLine = '저희 두 사람의 새로운 출발을 축복해 주셔서 진심으로 감사드립니다';
    await b.evaluate(`
      const ta = document.querySelector('.pkg-inline-editor-textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(longSingleLine)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await b.sleep(300);

    const textareaWrapCheck = await b.evaluate(`
      const ta = document.querySelector('.pkg-inline-editor-textarea');
      const style = window.getComputedStyle(ta);
      return {
        wrap: ta.getAttribute('wrap'),
        whiteSpace: style.whiteSpace,
        scrollWidth: ta.scrollWidth,
        clientWidth: ta.clientWidth,
        hasHorizontalOverflow: ta.scrollWidth > ta.clientWidth,
        lineCount: ta.value.split('\\n').length
      };
    `);
    check('입력창 자동 줄바꿈 없음 (wrap="off", white-space: pre)', textareaWrapCheck.wrap === 'off' && textareaWrapCheck.whiteSpace === 'pre', JSON.stringify(textareaWrapCheck));
    check('장문 단일 행에서 개행 미생성 (1줄 유지, scrollWidth > clientWidth)', textareaWrapCheck.lineCount === 1 && textareaWrapCheck.hasHorizontalOverflow);

    // 5-3. 장문 가로 이동 버튼(◀ 앞, 뒤 ▶) 및 조작 검증
    const hasScrollButtons = await b.evaluate(`
      const leftBtn = document.querySelector('.pkg-inline-scroll-left');
      const rightBtn = document.querySelector('.pkg-inline-scroll-right');
      return Boolean(leftBtn && rightBtn);
    `);
    check('장문 감지 시 가로 이동 버튼(◀ 앞, 뒤 ▶) 표시', hasScrollButtons);

    // '뒤 ▶' 클릭으로 가로 스크롤 이동
    await b.click('.pkg-inline-scroll-right');
    await b.sleep(200);
    const scrollRightPos = await b.evaluate(`return document.querySelector('.pkg-inline-editor-textarea')?.scrollLeft`);
    check('가로 이동: "뒤 ▶" 클릭 시 scrollLeft 증가', scrollRightPos > 50, `scrollLeft: ${scrollRightPos}`);

    // '◀ 앞' 클릭으로 시작 위치 복귀
    await b.click('.pkg-inline-scroll-left');
    await b.sleep(200);
    const scrollLeftPos = await b.evaluate(`return document.querySelector('.pkg-inline-editor-textarea')?.scrollLeft`);
    check('가로 이동: "◀ 앞" 클릭 시 scrollLeft 0으로 복귀', scrollLeftPos === 0, `scrollLeft: ${scrollLeftPos}`);

    // 5-4. 명시적 줄바꿈('\n') 2줄 문장 입력
    const explicitTwoLines = '저희 두 사람의 새로운 출발을\n축복해 주셔서 진심으로 감사드립니다';
    await b.evaluate(`
      const ta = document.querySelector('.pkg-inline-editor-textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(explicitTwoLines)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await b.sleep(300);

    const multilineHeader = await b.evaluate(`return document.querySelector('.pkg-inline-editor-header')?.textContent`);
    check('명시적 개행 입력 시 헤더에 줄 수("2줄") 표시', multilineHeader.includes('2줄'), multilineHeader);

    // 5-5. 완료 버튼 클릭으로 캔버스 커밋
    await b.click('.pkg-inline-done-btn');
    await b.sleep(400);

    const konvaAfterTwoLines = await b.evaluate(`
      const t = ${konva}.find('Text')[0];
      return t ? t.text() : null;
    `);
    check('완료 후 Konva 캔버스에 명시적 줄바꿈 2줄 1:1 일치 반영', konvaAfterTwoLines === explicitTwoLines, konvaAfterTwoLines);
    check('문구 편집 완료 후에도 커스텀 글자색(#e74c3c) 및 배경색(#2c3e50) 유지', (await b.evaluate(`return ${konva}.find('Text')[0]?.fill()`)) === customTextColor && (await b.evaluate(`return ${konva}.find('Rect')[0]?.fill()`)) === customBgColor);

    // 6. 이미지 추가/제거 시 문구 및 커스텀 색상 보존 검증
    await b.click('.pkg-img-thumb');
    await b.sleep(500);
    const textAfterImg = await b.evaluate(`return ${konva}.find('Text')[0]?.text()`);
    const colorAfterImg = await b.evaluate(`return ${konva}.find('Text')[0]?.fill()`);
    check('추천 이미지 적용 후에도 문구 보존', textAfterImg === explicitTwoLines);
    check('추천 이미지 적용 후에도 커스텀 글자색 보존', colorAfterImg === customTextColor);

    await b.click('button', '이미지 삭제');
    await b.sleep(400);
    const textAfterImgDel = await b.evaluate(`return ${konva}.find('Text')[0]?.text()`);
    check('이미지 삭제 후에도 문구 온전히 유지', textAfterImgDel === explicitTwoLines);

    // 7. 최종 확인 및 저장 검증
    await b.click('button', '다음: 최종 확인');
    await b.sleep(500);

    // 철자 확인 체크
    await b.evaluate(`
      const cb = document.querySelector('.pkg-check-label input[type="checkbox"]');
      if (cb && !cb.checked) cb.click();
    `);
    await b.sleep(300);

    // 저장 버튼 클릭
    await b.click('button', '디자인 완료하고 코드 받기');
    await b.waitFor(`document.querySelector('.pkg-result-code-card')`, 25000);

    const resultCode = await b.evaluate(`return document.querySelector('.design-code')?.textContent?.trim()`);
    check('디자인 저장 성공 및 디자인 코드 발급', Boolean(resultCode && (resultCode.startsWith('OD-') || resultCode.startsWith('PK-'))), resultCode);

    // 8. 발급된 디자인 코드 재조회 시 커스텀 글자색, 배경색, 명시적 개행 복원 검증
    await b.goto(`${BASE}/packaging?product=49&restore=${resultCode}`);
    await b.waitFor(`${konva} && ${konva}.find('Text').length > 0`, 30000);
    await b.sleep(600);

    const restoredState = await b.evaluate(`
      const textNode = ${konva}.find('Text')[0];
      const bgRect = ${konva}.find('Rect')[0];
      return {
        text: textNode ? textNode.text() : null,
        textColor: textNode ? textNode.fill() : null,
        bgColor: bgRect ? bgRect.fill() : null
      };
    `);

    check('저장본 재조회: 명시적 개행 문구 완전 복원', restoredState.text === explicitTwoLines, restoredState.text);
    check('저장본 재조회: 커스텀 글자색(#e74c3c) 완전 복원', restoredState.textColor === customTextColor, restoredState.textColor);
    check('저장본 재조회: 커스텀 배경색(#2c3e50) 완전 복원', restoredState.bgColor === customBgColor, restoredState.bgColor);

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
