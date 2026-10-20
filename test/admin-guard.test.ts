import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getAdminStatus, isLocalAdminAllowed, requireAdmin } from '../src/lib/admin-guard.ts';

const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, ONDAP_ALLOW_LOCAL_ADMIN: env.ONDAP_ALLOW_LOCAL_ADMIN, ONDAP_DATA_SOURCE: env.ONDAP_DATA_SOURCE };

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

test('로컬 모드 + 개발 환경: 관리자 허용', async () => {
  env.NODE_ENV = 'development';
  delete env.ONDAP_DATA_SOURCE;
  delete env.ONDAP_ALLOW_LOCAL_ADMIN;
  assert.equal(isLocalAdminAllowed(), true);
  assert.deepEqual(await getAdminStatus(), { allowed: true, mode: 'local' });
  await assert.doesNotReject(requireAdmin());
});

test('로컬 모드 + 운영 환경: 관리자 차단', async () => {
  env.NODE_ENV = 'production';
  delete env.ONDAP_DATA_SOURCE;
  delete env.ONDAP_ALLOW_LOCAL_ADMIN;
  assert.deepEqual(await getAdminStatus(), { allowed: false, reason: 'production' });
  await assert.rejects(requireAdmin(), /운영 환경/);
});

test('로컬 모드 + 운영 환경이라도 명시적으로 허용하면 통과', () => {
  env.NODE_ENV = 'production';
  env.ONDAP_ALLOW_LOCAL_ADMIN = '1';
  assert.equal(isLocalAdminAllowed(), true);
});
