import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../src/lib/safe-next.ts';

test('관리자 경로는 그대로 허용', () => {
  assert.equal(safeNext('/admin'), '/admin');
  assert.equal(safeNext('/admin/verify?event=birth&relation=family'), '/admin/verify?event=birth&relation=family');
  assert.equal(safeNext('/admin/weights#top'), '/admin/weights#top');
});

test('외부로 나가는 주소는 /admin으로 바꾼다', () => {
  for (const evil of [
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    '/\\/evil.com',
    '\\\\evil.com',
    '/%5Cevil.com',
    '/\tevil.com',
    '/\n/evil.com',
    'javascript:alert(1)',
  ]) {
    assert.equal(safeNext(evil), '/admin', evil);
  }
});

test('관리자 밖의 내부 경로나 이상한 값도 /admin으로', () => {
  assert.equal(safeNext('/'), '/admin');
  assert.equal(safeNext('/result?event=x'), '/admin');
  assert.equal(safeNext('/administrator'), '/admin');
  assert.equal(safeNext('/admin/../result'), '/admin');
  assert.equal(safeNext(null), '/admin');
  assert.equal(safeNext(''), '/admin');
});
