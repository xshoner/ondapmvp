// 카페24 포장 디자인 옵션 자동 선택 및 총액 자동 합산 실환경 E2E 검증
// 대상 상품: 46 (P00000BU, 청정 신안 토판에서 생산한 명품 천일염)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const helperCode = readFileSync(new URL('../../public/cafe24/ondap-helper.js', import.meta.url), 'utf8');

async function testCafe24PackagingOption() {
  console.log('=== 카페24 포장 디자인 옵션 자동 선택 및 총액 합산 E2E 검증 시작 ===');
  const b = await launch({ port: 9388, mobile: false });

  try {
    // 1. PC 환경 검증: 수량 10개 선택 시
    console.log('\n[테스트 1] PC 환경: 10개 수량 선택 및 포장 디자인 코드 진입');
    const url10 = 'https://axopenlab.cafe24.com/product/detail.html?product_no=46&ondap_qty=10&ondap_order=1&ondap_code=OD-A2B3-4C5D';
    await b.goto(url10);
    await b.sleep(3000);

    // 최신 ondap-helper.js 실행
    await b.evaluate(helperCode);
    await b.sleep(2500);

    const pcState10 = await b.evaluate(`
      const sel = document.querySelector('select[name="option1"], #product_option_id1');
      const optText = sel ? sel.options[sel.selectedIndex]?.text?.trim() : '';
      const optQty = document.querySelector('input.quantity_opt, input[name="quantity_opt[]"]')?.value;
      const total = document.querySelector('#totalPrice, .totalPrice, .total')?.innerText.replace(/\\s+/g, ' ').trim() || '';
      const banner = document.querySelector('#ondap-banner')?.innerText || '';
      return { selValue: sel?.value, optText, optQty, total, banner };
    `);

    console.log('PC 10개 결과:', pcState10);
    assert.equal(pcState10.selValue, 'P00000BU000B', '포장디자인 옵션(P00000BU000B)이 자동 선택되어야 함');
    assert.match(pcState10.optText, /포장디자인/, '선택된 옵션명에 포장디자인이 포함되어야 함');
    assert.equal(pcState10.optQty, '10', '옵션 품목 수량이 고객이 설정한 10개로 자동 입력되어야 함');
    assert.match(pcState10.total, /221,000원/, '22,100원 × 10개 = 221,000원으로 총액이 자동 합산되어야 함');
    assert.match(pcState10.banner, /자동으로 선택/, '배너에 옵션 및 수량 자동 선택 완료 문구가 표기되어야 함');
    console.log('✓ PASS: PC 환경 10개 주문 시 포장 옵션 자동 선택 및 총액 221,000원 합산 확인');

    // 2. 다른 임의의 수량(예: 25개) 동적 반영 검증
    console.log('\n[테스트 2] 임의 수량(25개) 선택 시 총액 동적 합산 검증');
    const url25 = 'https://axopenlab.cafe24.com/product/detail.html?product_no=46&ondap_qty=25&ondap_order=1&ondap_code=OD-E6F7-8G9H';
    await b.goto(url25);
    await b.sleep(3000);

    await b.evaluate(helperCode);
    await b.sleep(2500);

    const pcState25 = await b.evaluate(`
      const sel = document.querySelector('select[name="option1"], #product_option_id1');
      const optQty = document.querySelector('input.quantity_opt, input[name="quantity_opt[]"]')?.value;
      const total = document.querySelector('#totalPrice, .totalPrice, .total')?.innerText.replace(/\\s+/g, ' ').trim() || '';
      return { selValue: sel?.value, optQty, total };
    `);

    console.log('PC 25개 결과:', pcState25);
    assert.equal(pcState25.selValue, 'P00000BU000B', '25개 주문 시에도 포장디자인 옵션이 자동 선택되어야 함');
    assert.equal(pcState25.optQty, '25', '옵션 수량이 25개로 자동 입력되어야 함');
    assert.match(pcState25.total, /552,500원/, '22,100원 × 25개 = 552,500원으로 총액이 자동 합산되어야 함');
    console.log('✓ PASS: PC 환경 25개 주문 시 포장 옵션 자동 선택 및 총액 552,500원 합산 확인');

    // 3. 모바일 환경(375px) 검증
    console.log('\n[테스트 3] 모바일 환경(375px): 10개 수량 선택 및 포장 옵션 자동 선택');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    const mobileUrl = 'https://axopenlab.cafe24.com/m/product/detail.html?product_no=46&ondap_qty=10&ondap_order=1&ondap_code=OD-J2K3-4M5N';
    await b.goto(mobileUrl);
    await b.sleep(3000);

    await b.evaluate(helperCode);
    await b.sleep(2500);

    const mobileState = await b.evaluate(`
      const sel = document.querySelector('select[name="option1"], #product_option_id1');
      const optQty = document.querySelector('input.quantity_opt, input[name="quantity_opt[]"]')?.value;
      const total = document.querySelector('#totalPrice, .totalPrice, .total')?.innerText.replace(/\\s+/g, ' ').trim() || '';
      return { selValue: sel?.value, optQty, total };
    `);

    console.log('모바일 10개 결과:', mobileState);
    assert.equal(mobileState.selValue, 'P00000BU000B', '모바일에서도 포장디자인 옵션이 자동 선택되어야 함');
    assert.equal(mobileState.optQty, '10', '모바일 옵션 수량이 10개로 자동 입력되어야 함');
    assert.match(mobileState.total, /221,000원/, '모바일에서도 총액 221,000원이 자동 합산 표기되어야 함');
    console.log('✓ PASS: 모바일 환경 10개 주문 시 포장 옵션 자동 선택 및 총액 221,000원 합산 확인');

    // 옵션 제목은 ‘포장 디자인 서비스’, 선택지는 ‘신청 (+100원)’인 실제 상품.
    await b.goto('https://axopenlab.cafe24.com/m/product/detail.html?product_no=53&ondap_qty=13&ondap_order=1&ondap_code=OD-A2B3-4C5D');
    await b.sleep(3000);
    await b.evaluate(helperCode);
    await b.sleep(2500);
    const grouped = await b.evaluate(`
      const sel = document.querySelector('#product_option_id1');
      return { value: sel?.value, qty: document.querySelector('input.quantity_opt, input[name="quantity_opt[]"]:not(#quantity)')?.value, total: document.querySelector('#totalPrice')?.innerText };
    `);
    assert.equal(grouped.value, 'P00000CB000B');
    assert.equal(grouped.qty, '13');
    assert.match(grouped.total, /507,000원/);
    console.log('✓ PASS: 옵션 그룹의 신청 항목과 13개 총액');

    // 포장 옵션이 없는 상품에서는 수량만 맞추고 포장비 적용을 주장하지 않는다.
    await b.goto('https://axopenlab.cafe24.com/m/product/detail.html?product_no=48&ondap_qty=13&ondap_order=1&ondap_code=OD-A2B3-4C5D');
    await b.sleep(3000);
    await b.evaluate(helperCode);
    await b.sleep(2500);
    const unavailable = await b.evaluate(`
      return { qty: document.querySelector('#quantity')?.value, banner: document.querySelector('#ondap-banner')?.innerText };
    `);
    assert.equal(unavailable.qty, '13');
    assert.match(unavailable.banner, /자동 적용되지 않았어요/);
    console.log('✓ PASS: 옵션 없는 상품은 미적용 안내');

  } finally {
    await b.close();
  }

  console.log('\n=== 카페24 포장 디자인 옵션 자동 선택 및 총액 합산 모든 검증 통과 ===');
}

testCafe24PackagingOption().catch((err) => {
  console.error('검증 실패:', err);
  process.exit(1);
});
