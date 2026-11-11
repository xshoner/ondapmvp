import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventStatusFromDecision, processPaymentEventQueue, processSingleOrder } from '../src/cafe24/intake-worker.ts';

test('결제 재처리는 이벤트 개정을 조건으로 기록하고 저장 실패를 오류로 보고한다', async () => {
  const originalFetch = globalThis.fetch;
  const names = ['ONDAP_DATA_SOURCE', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CAFE24_MALL_ID'] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    ONDAP_DATA_SOURCE: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public', SUPABASE_SERVICE_ROLE_KEY: 'test-service', CAFE24_MALL_ID: 'dapcue',
  });
  let failUpdate = false;
  const patches: { url: URL; body: Record<string, unknown> }[] = [];
  const revision = '11111111-1111-4111-8111-111111111111';
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
      if (url.pathname.endsWith('/rpc/claim_payment_events')) return json([{ shop_no: 1, order_no: '20261108-0000010', event_revision: revision }]);
      if (url.pathname.endsWith('/cafe24_tokens')) return json([{ mall_id: 'dapcue', shop_no: 1, access_token: 'test', refresh_token: 'test', expires_at: '2099-01-01T00:00:00Z', refresh_token_expires_at: '2099-01-01T00:00:00Z', scope: 'mall.read_order' }]);
      if (url.hostname === 'dapcue.cafe24api.com') return json({ order: { order_id: '20261108-0000010', shop_no: 1, paid: 'F', items: [{ product_no: 11, quantity: 1 }], additional_order_info_list: [{ name: 'test', value: 'test' }] } });
      if (url.pathname.endsWith('/cafe24_payment_events') && init?.method === 'PATCH') {
        patches.push({ url, body: JSON.parse(String(init.body)) });
        if (failUpdate && patches.length === 1) return new Response('failed', { status: 500 });
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    };
    assert.deepEqual(await processPaymentEventQueue(), { processed: 1, confirmed: 0, errors: 0 });
    assert.equal(patches[0].body.status, 'waiting_payment');
    assert.equal(patches[0].url.searchParams.get('event_revision'), `eq.${revision}`);
    assert.equal(patches[0].url.searchParams.get('status'), 'eq.processing');

    patches.length = 0;
    failUpdate = true;
    assert.deepEqual(await processPaymentEventQueue(), { processed: 1, confirmed: 0, errors: 1 });
    assert.equal(patches[1].body.status, 'pending');
    assert.equal(patches[1].url.searchParams.get('event_revision'), `eq.${revision}`);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('결제 큐 상태 매핑·시간 제한 반환 및 shop_no 불일치 거절을 검증한다', async () => {
  assert.equal(eventStatusFromDecision({ status: 'not_applicable', message: '일반 주문' }).status, 'completed');
  assert.equal(eventStatusFromDecision({ status: 'canceled', message: '취소' }).status, 'completed');
  assert.equal(eventStatusFromDecision({ status: 'unpaid', message: '미결제' }).status, 'waiting_payment');
  assert.equal(eventStatusFromDecision({ status: 'no_design_code', message: '누락' }).status, 'failed');

  const originalFetch = globalThis.fetch;
  const names = ['ONDAP_DATA_SOURCE', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CAFE24_MALL_ID'] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    ONDAP_DATA_SOURCE: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public', SUPABASE_SERVICE_ROLE_KEY: 'test-service', CAFE24_MALL_ID: 'dapcue',
  });
  const patches: Record<string, unknown>[] = [];
  const rev1 = '11111111-1111-4111-8111-111111111111';
  const rev2 = '22222222-2222-4222-8222-222222222222';
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
      if (url.pathname.endsWith('/rpc/claim_payment_events')) {
        return json([
          { shop_no: 1, order_no: '20261108-0000010', attempts: 2, event_revision: rev1 },
          { shop_no: 1, order_no: '20261108-0000011', attempts: 3, event_revision: rev2 },
        ]);
      }
      if (url.pathname.endsWith('/cafe24_tokens')) {
        return json([{ mall_id: 'dapcue', shop_no: 1, access_token: 'test', refresh_token: 'test', expires_at: '2099-01-01T00:00:00Z', refresh_token_expires_at: '2099-01-01T00:00:00Z', scope: 'mall.read_order' }]);
      }
      if (url.hostname === 'dapcue.cafe24api.com') {
        if (url.pathname.includes('20261108-0000099')) {
          return json({ order: { order_id: '20261108-0000099', shop_no: 2, paid: 'T', items: [] } });
        }
        return json({ order: { order_id: '20261108-0000010', shop_no: 1, paid: 'T', items: [{ product_no: 11, quantity: 1, options: [{ name: '답례포장 서비스', value: '신청안함' }] }] } });
      }
      if (url.pathname.endsWith('/cafe24_payment_events') && init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    };

    const result = await processPaymentEventQueue(10, Date.now() - 1);
    assert.deepEqual(result, { processed: 1, confirmed: 0, errors: 0 });
    assert.equal(patches[0].status, 'completed');
    assert.equal(patches[1].status, 'pending');
    assert.equal(patches[1].attempts, 2);

    await assert.rejects(() => processSingleOrder('20261108-0000099', 1), /상점번호/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
