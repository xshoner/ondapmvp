import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCanvasFonts } from '../src/packaging/font-loading.ts';

test('캔버스 글꼴: 성공·거절·동기 오류·응답 없음에도 내보내기를 계속할 수 있다', async () => {
  const requests = [{ font: 'bold 32px sans-serif', text: '감사합니다' }];
  assert.equal(await loadCanvasFonts({ load: async () => [] }, requests), true);
  assert.equal(await loadCanvasFonts({ load: async () => { throw new DOMException('font unavailable', 'NetworkError'); } }, requests), false);
  assert.equal(await loadCanvasFonts({ load: () => { throw new Error('font unavailable'); } }, requests), false);
  assert.equal(await loadCanvasFonts({ load: () => new Promise(() => {}) }, requests, 10), false);
  assert.equal(await loadCanvasFonts({ load: () => { throw new Error('not called'); } }, []), true);
});
