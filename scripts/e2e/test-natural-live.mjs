import assert from 'node:assert/strict';
import { launch } from './cdp.mjs';

async function testNaturalLive() {
  console.log('=== 운영 배포 후 카페24 실환경 무개입(Natural) E2E 검증 시작 ===');
  const b = await launch({ port: 9385, mobile: false });

  try {
    // 1. PC 10개 검증
    console.log('\n[검증 1] PC 환경 10개: 카페24 상품 페이지 자연 로딩');
    const url10 = 'https://axopenlab.cafe24.com/product/detail.html?product_no=46&ondap_qty=10&ondap_order=1&ondap_code=OD-A2B3-4C5D';
    await b.goto(url10);

    // 카페24 및 ondap-helper.js 실행 대기 (3.5초)
    await b.sleep(3500);

    const pc10 = await b.evaluate(`
      const sel = document.querySelector('select[name="option1"], #product_option_id1');
      const optText = sel ? sel.options[sel.selectedIndex]?.text?.trim() : '';
      const optQty = document.querySelector('input.quantity_opt, input[name="quantity_opt[]"]')?.value;
      const total = document.querySelector('#totalPrice, .totalPrice, .total')?.innerText.replace(/\\s+/g, ' ').trim() || '';
      const banner = document.querySelector('#ondap-banner')?.innerText || '';
      return { selValue: sel?.value, optText, optQty, total, banner };
    `);

    console.log('PC 10개 결과:', pc10);
    assert.equal(pc10.selValue, 'P00000BU000B', '포장디자인 옵션이 자동 선택되어야 함');
    assert.match(pc10.optText, /포장디자인/, '포장디자인 옵션명이 일치해야 함');
    assert.equal(pc10.optQty, '10', '수량이 10개로 자동 입력되어야 함');
    assert.match(pc10.total, /221,000원/, '총 상품금액이 221,000원(10개)으로 합산되어야 함');
    assert.match(pc10.banner, /자동으로 선택/, '배너가 정상 노출되어야 함');
    console.log('✓ PASS: PC 10개 자연 로딩 검증 통과');

    // 2. PC 25개 동적 수량 검증
    console.log('\n[검증 2] PC 환경 임의 수량 25개: 카페24 상품 페이지 자연 로딩');
    const url25 = 'https://axopenlab.cafe24.com/product/detail.html?product_no=46&ondap_qty=25&ondap_order=1&ondap_code=OD-E6F7-8G9H';
    await b.goto(url25);
    await b.sleep(3500);

    const pc25 = await b.evaluate(`
      const sel = document.querySelector('select[name="option1"], #product_option_id1');
      const optQty = document.querySelector('input.quantity_opt, input[name="quantity_opt[]"]')?.value;
      const total = document.querySelector('#totalPrice, .totalPrice, .total')?.innerText.replace(/\\s+/g, ' ').trim() || '';
      return { selValue: sel?.value, optQty, total };
    `);

    console.log('PC 25개 결과:', pc25);
    assert.equal(pc25.selValue, 'P00000BU000B', '25개 주문 시 포장 옵션이 자동 선택되어야 함');
    assert.equal(pc25.optQty, '25', '수량이 25개로 자동 입력되어야 함');
    assert.match(pc25.total, /552,500원/, '총 상품금액이 552,500원(25개)으로 합산되어야 함');
    console.log('✓ PASS: PC 25개 자연 로딩 검증 통과');

    // 3. 모바일 10개 검증
    console.log('\n[검증 3] 모바일 환경(375px) 10개: 카페24 모바일 페이지 자연 로딩');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    const mobileUrl = 'https://axopenlab.cafe24.com/m/product/detail.html?product_no=46&ondap_qty=10&ondap_order=1&ondap_code=OD-J2K3-4M5N';
    await b.goto(mobileUrl);
    await b.sleep(3500);

    const m10 = await b.evaluate(`
      const sel = document.querySelector('select[name="option1"], #product_option_id1');
      const optQty = document.querySelector('input.quantity_opt, input[name="quantity_opt[]"]')?.value;
      const total = document.querySelector('#totalPrice, .totalPrice, .total')?.innerText.replace(/\\s+/g, ' ').trim() || '';
      return { selValue: sel?.value, optQty, total };
    `);

    console.log('모바일 10개 결과:', m10);
    assert.equal(m10.selValue, 'P00000BU000B', '모바일에서도 포장 옵션이 자동 선택되어야 함');
    assert.equal(m10.optQty, '10', '모바일 수량이 10개로 자동 입력되어야 함');
    assert.match(m10.total, /221,000원/, '모바일 총 상품금액이 221,000원(10개)으로 합산되어야 함');
    console.log('✓ PASS: 모바일 10개 자연 로딩 검증 통과');

  } finally {
    await b.close();
  }

  console.log('\n=== 운영 배포 실환경 모든 무개입 E2E 검증 통과! ===');
}

testNaturalLive().catch(err => {
  console.error('검증 실패:', err);
  process.exit(1);
});
