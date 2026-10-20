import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiModels, callWithRetry } from '../src/ai/gemini.ts';

const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const noSleep = { sleep: async () => {}, log: () => {} };

test('모델 목록: 기본 + 대체, 중복·빈 값 제거', () => {
  assert.deepEqual(aiModels({}), ['gemini-3.6-flash', 'gemini-flash-latest']);
  assert.deepEqual(aiModels({ ONDAP_AI_MODEL: 'a', ONDAP_AI_FALLBACK_MODEL: 'a' }), ['a']);
  assert.deepEqual(aiModels({ ONDAP_AI_MODEL: 'a', ONDAP_AI_FALLBACK_MODEL: '' }), ['a']);
});

test('503이면 기다렸다 다시 시도해서 성공', async () => {
  let n = 0;
  const waits: number[] = [];
  const r = await callWithRetry(['m1'], async () => (++n < 3 ? Promise.reject(fail(503)) : '{"ok":1}'), {
    sleep: async (ms) => { waits.push(ms); },
    log: () => {},
  });
  assert.deepEqual(r, { text: '{"ok":1}', model: 'm1' });
  assert.equal(n, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('기본 모델이 계속 503이면 대체 모델로 넘어간다', async () => {
  const calls: string[] = [];
  const r = await callWithRetry(['m1', 'm2'], async (m) => {
    calls.push(m);
    if (m === 'm1') throw fail(503);
    return 'ok';
  }, noSleep);
  assert.equal(r.model, 'm2');
  assert.deepEqual(calls, ['m1', 'm1', 'm1', 'm2']);
});

test('404는 재시도하지 않고 바로 다음 모델', async () => {
  const calls: string[] = [];
  await callWithRetry(['m1', 'm2'], async (m) => {
    calls.push(m);
    if (m === 'm1') throw fail(404);
    return 'ok';
  }, noSleep);
  assert.deepEqual(calls, ['m1', 'm2']);
});

test('모두 실패하면 이해하기 쉬운 메시지', async () => {
  await assert.rejects(
    callWithRetry(['m1', 'm2'], async () => { throw fail(503); }, noSleep),
    /AI 서버가 지금 붐빕니다.*\[503\].*m1, m2/,
  );
  await assert.rejects(callWithRetry(['m1'], async () => { throw fail(403); }, noSleep), /ondap_ai를 확인/);
});

test('빈 응답도 실패로 보고 다음 모델', async () => {
  const r = await callWithRetry(['m1', 'm2'], async (m) => (m === 'm1' ? '' : 'ok'), noSleep);
  assert.equal(r.model, 'm2');
});
