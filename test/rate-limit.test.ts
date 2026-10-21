import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, createRateLimiter } from '../src/lib/rate-limit.ts';

test('요청 횟수 제한: 한도까지 허용, 넘으면 막고, 시간이 지나면 다시 허용', () => {
  const allow = createRateLimiter({ limit: 3, windowMs: 1000 });
  assert.deepEqual([allow('a', 0), allow('a', 10), allow('a', 20), allow('a', 30)], [true, true, true, false]);
  assert.equal(allow('b', 30), true); // 다른 주소는 따로 센다
  assert.equal(allow('a', 1015), true); // 첫 요청이 창 밖으로 나감
});

test('접속 주소: 프록시 헤더의 첫 값', () => {
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
  assert.equal(clientIp(new Headers({ 'x-real-ip': '5.6.7.8' })), '5.6.7.8');
  assert.equal(clientIp(new Headers()), 'unknown');
});
