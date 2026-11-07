import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPackagingOption, resolvePackagingOptionFromVariants } from '../src/cafe24/client.ts';
import { calcExpectedOrderTotal } from '../src/packaging/pricing.ts';

const item = (value: string, amount: string) => ({
  variant_code: 'P00000BW000B', options: [{ name: '포장 디자인 서비스', value }],
  additional_amount: amount, display: 'T' as const, selling: 'T' as const,
});

test('포장 신청 금액은 상품별로 계산하고 불확실한 값은 확정하지 않는다', () => {
  assert.equal(resolvePackagingOptionFromVariants(48, [item('신청', '150.00'), item('신청안함', '0.00')]).unitPrice, 150);
  assert.equal(calcExpectedOrderTotal(38000, 150, 13), 495950);
  assert.equal(resolvePackagingOptionFromVariants(48, [item('신청', '0.00')]).unitPrice, 0);
  for (const text of ['신청하지 않음', '불필요', '신청안함']) {
    assert.equal(resolvePackagingOptionFromVariants(48, [item(text, '150.00')]).status, 'unconfirmed');
  }
  assert.equal(resolvePackagingOptionFromVariants(48, [item('신청', '1.50')]).status, 'unconfirmed');
  assert.equal(resolvePackagingOptionFromVariants(48, [item('신청', '100.00'), item('포장 신청', '100.00')]).status, 'unconfirmed');
  assert.equal(resolvePackagingOptionFromVariants(48, [{ ...item('신청', '100.00'), options: [{ name: '맛', value: '기본' }, { name: '포장 디자인 서비스', value: '신청' }] }]).status, 'unconfirmed');
});

test('Front API 인증 오류는 Client ID 방식으로 재시도하고 오류는 미확인 처리한다', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async (_url, init) => {
      calls++;
      const h = new Headers(init?.headers);
      if (calls === 1) { assert.ok(h.get('Authorization')); return new Response('', { status: 401 }); }
      assert.equal(h.get('X-Cafe24-Client-Id'), 'client');
      return Response.json({ variants: [item('신청', '300.00')] });
    }) as typeof fetch;
    const result = await fetchPackagingOption({ mallId: 'example', clientId: 'client', frontApiKey: 'key' }, 45, { refresh: true });
    assert.equal(result.unitPrice, 300);
    assert.equal(calls, 2);
    globalThis.fetch = (async () => new Response('', { status: 403 })) as typeof fetch;
    const failed = await fetchPackagingOption({ mallId: 'example', clientId: 'client' }, 45, { refresh: true });
    assert.equal(failed.status, 'unconfirmed');
    assert.equal(failed.unitPrice, null);
  } finally { globalThis.fetch = oldFetch; }
});
