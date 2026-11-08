import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('디자인 저장과 재주문은 결제 대기로 남고 관리자 접수에는 표시되지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dapryeq-pending-'));
  process.env.ONDAP_TEST_DATA_DIR = dir;
  process.env.ONDAP_DATA_SOURCE = 'local';
  try {
    const { createDesign, listDesigns, lookupDesign, reorderDesign, getDesignTodo, updateDesign } = await import('../src/data/packaging-repository.ts');
    const base = { code: 'OD-AAAA-AAAA', productNo: 1, productName: '상품', quantity: 2, event: null, styleId: '', styleName: '포장', sticker: null, draft: null };
    assert.equal(await createDesign(base, null), 'ok');
    assert.equal((await lookupDesign(base.code))?.status, 'pending');
    assert.deepEqual(await listDesigns(), []);
    assert.equal((await getDesignTodo({ received: new Date().toISOString(), confirmed: new Date().toISOString() })).received, 0);
    assert.equal(await reorderDesign(base.code, 'OD-BBBB-BBBB', 3), 'ok');
    assert.equal((await lookupDesign('OD-BBBB-BBBB'))?.status, 'pending');
    assert.deepEqual(await listDesigns(), []);
    await updateDesign(base.code, { status: 'order_confirmed', orderNo: '20261108-0000001', memo: '' });
    assert.deepEqual((await listDesigns()).map((d) => d.code), [base.code]);
    assert.equal((await getDesignTodo({ received: new Date().toISOString(), confirmed: new Date().toISOString() })).confirmed, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
