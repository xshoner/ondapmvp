import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOAuthState,
  verifyOAuthState,
  getCafe24OAuthAuthorizeUrl,
  setLocalTokenCacheForTesting,
  readStoredToken,
  saveStoredToken,
} from '../src/cafe24/oauth.ts';

test('OAuth state 생성과 검증이 정상 동작한다', () => {
  const state = createOAuthState();
  assert.equal(typeof state, 'string');
  assert.equal(verifyOAuthState(state), true);
  assert.equal(verifyOAuthState('tampered.state.signature'), false);
  assert.equal(verifyOAuthState(''), false);
  assert.equal(verifyOAuthState(null), false);
});

test('Cafe24 OAuth Authorize URL을 생성한다', () => {
  process.env.CAFE24_MALL_ID = 'axopenlab';
  process.env.CAFE24_CLIENT_ID = 'test-client-id';
  process.env.CAFE24_REDIRECT_URI = 'https://ondapmvp.vercel.app/api/cafe24/callback';

  const state = 'valid-state';
  const url = getCafe24OAuthAuthorizeUrl(state);
  assert.ok(url.startsWith('https://axopenlab.cafe24api.com/api/v2/oauth/authorize'));
  assert.ok(url.includes('client_id=test-client-id'));
  assert.ok(url.includes('state=valid-state'));
  assert.ok(url.includes('scope=mall.read_product%2Cmall.read_order'));
});

test('로컬 환경에서 토큰 저장 및 조회가 정상 동작한다', async () => {
  process.env.ONDAP_DATA_SOURCE = 'local';
  setLocalTokenCacheForTesting(null);

  const sample = {
    mall_id: 'axopenlab',
    shop_no: 1,
    access_token: 'acc_sample',
    refresh_token: 'ref_sample',
    expires_at: new Date(Date.now() + 7200000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
    scope: 'mall.read_order',
  };

  await saveStoredToken(sample);
  const read = await readStoredToken('axopenlab');
  assert.equal(read?.access_token, 'acc_sample');
  assert.equal(read?.mall_id, 'axopenlab');
});

test('parseCafe24Date: 타임존이 누락된 카페24 날짜를 KST(+09:00)로 정확히 해석한다', async () => {
  const { parseCafe24Date } = await import('../src/cafe24/oauth.ts');

  // 카페24 응답 형식 (타임존 없는 ISO 문자열)
  const cafe24Time = '2026-11-08T21:30:00.000';
  const parsedMs = parseCafe24Date(cafe24Time);

  // KST 21:30은 UTC 12:30과 동일해야 함
  const expectedUtcMs = Date.parse('2026-11-08T12:30:00.000Z');
  assert.equal(parsedMs, expectedUtcMs);

  // 공백 형식 ("2026-11-08 21:30:00")
  const spaceTime = '2026-11-08 21:30:00';
  assert.equal(parseCafe24Date(spaceTime), expectedUtcMs);

  // 이미 타임존이 포함된 경우 원본 유지
  const utcTime = '2026-11-08T12:30:00.000Z';
  assert.equal(parseCafe24Date(utcTime), expectedUtcMs);
});
