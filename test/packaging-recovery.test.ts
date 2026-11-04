import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAutosave, saveRecovery } from '../src/app/packaging/editor-store.ts';
import type { EditorSnapshot } from '../src/app/packaging/editor-types.ts';

test('접수 실패 보관은 저장 가능할 때만 성공하고 같은 상품에서 복원한다', async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    setItem(key: string, value: string) { values.set(key, value); },
    getItem(key: string) { return values.get(key) ?? null; },
  } });
  const snap: EditorSnapshot = { styleId: 's1', withSticker: false, shape: 'circle', sizeCm: 6, background: '#fff', layers: [], fields: { recipient: '', sender: '', date: '' }, event: null, quantity: 3 };
  assert.equal(await saveRecovery(49, snap), true);
  assert.equal((loadAutosave(49) as EditorSnapshot).quantity, 3);
  assert.equal(loadAutosave(50), null);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() { throw new Error('quota'); } } });
  assert.equal(await saveRecovery(49, snap), false);
  delete (globalThis as { localStorage?: Storage }).localStorage;
});
