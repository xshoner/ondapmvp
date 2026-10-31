import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordError } from '../src/lib/password-validation.ts';

test('비밀번호 변경은 현재 값, 길이, 일치 여부와 새 값을 검사한다', () => {
  assert.ok(passwordError('', 'new-password', 'new-password'));
  assert.ok(passwordError('old-password', 'short', 'short'));
  assert.ok(passwordError('old-password', 'a'.repeat(73), 'a'.repeat(73)));
  assert.ok(passwordError('old-password', 'new-password', 'different'));
  assert.ok(passwordError('old-password', 'old-password', 'old-password'));
  assert.equal(passwordError('old-password', 'new-password', 'new-password'), null);
});
