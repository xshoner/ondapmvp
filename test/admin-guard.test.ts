import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalAdmin, isLocalAdminAllowed } from '../src/lib/admin-guard.ts';

const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, ONDAP_ALLOW_LOCAL_ADMIN: env.ONDAP_ALLOW_LOCAL_ADMIN };

afterEach(() => {
  env.NODE_ENV = saved.NODE_ENV;
  env.ONDAP_ALLOW_LOCAL_ADMIN = saved.ONDAP_ALLOW_LOCAL_ADMIN;
});

test('개발 환경에서는 관리자 기능 허용', () => {
  env.NODE_ENV = 'development';
  delete env.ONDAP_ALLOW_LOCAL_ADMIN;
  assert.equal(isLocalAdminAllowed(), true);
  assert.doesNotThrow(() => assertLocalAdmin());
});

test('운영 환경에서는 관리자 기능 차단', () => {
  env.NODE_ENV = 'production';
  delete env.ONDAP_ALLOW_LOCAL_ADMIN;
  assert.equal(isLocalAdminAllowed(), false);
  assert.throws(() => assertLocalAdmin(), /로컬 개발 환경에서만/);
});

test('운영 환경이라도 명시적으로 허용하면 통과', () => {
  env.NODE_ENV = 'production';
  env.ONDAP_ALLOW_LOCAL_ADMIN = '1';
  assert.equal(isLocalAdminAllowed(), true);
});
