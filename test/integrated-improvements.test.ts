import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productOrderUrl } from '../src/lib/order-link.ts';
import { validateProductSnapshot } from '../src/cafe24/sync-rules.ts';
import { fetchAllProducts } from '../src/cafe24/client.ts';
import { matchesTarget, cleanTargeting, presetText } from '../src/packaging/presets.ts';
import { cronAuthorized } from '../src/lib/cron-auth.ts';
import { operationEvent } from '../src/lib/operations.ts';
import { readPages } from '../src/data/db.ts';
import { BACKUP_TABLES, sha256, safeBackupPath, validateSnapshot, restoreSql, type Snapshot } from '../src/lib/backup.ts';
import { product } from './fixtures.ts';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('상품 링크는 수량 1/여러 개와 모바일 경로를 보존하고 이전 코드를 제거한다', () => {
  const url = new URL(productOrderUrl('https://shop.cafe24.com/product/detail.html?product_no=12&ondap_code=OD-AAAA-AAAA', 10));
  assert.equal(url.searchParams.get('ondap_qty'), '10');
  assert.equal(url.searchParams.get('ondap_code'), null);
  assert.equal(url.searchParams.get('ondap_order'), '1');
  assert.equal(new URL(productOrderUrl(url.href, 1, 'OD-BBBB-BBBB', true)).pathname, '/m/product/detail.html');
  assert.equal(new URL(productOrderUrl(url.href, Infinity)).searchParams.get('ondap_qty'), '1');
});

test('동기화는 빈 응답·중복·가격 오류·20% 초과 누락을 거부한다', () => {
  const before = Array.from({ length: 10 }, (_, i) => product(i + 1, 10000));
  assert.throws(() => validateProductSnapshot([], before));
  assert.throws(() => validateProductSnapshot([before[0], before[0]]));
  assert.throws(() => validateProductSnapshot([{ ...before[0], price: NaN }]));
  assert.throws(() => validateProductSnapshot(before.slice(0, 7), before), /20%/);
  assert.doesNotThrow(() => validateProductSnapshot(before.slice(0, 8), before));
});

test('카페24 페이지 일부 누락·조회 중 개수 변경은 적용할 목록으로 반환하지 않는다', async () => {
  const original = globalThis.fetch;
  const raw = { product_no: 1, product_name: '시험', price: '10000', display: 'T', selling: 'T', sold_out: 'F' };
  let counts = 0;
  try {
    globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).endsWith('/count') ? { count: 2 } : { products: [raw] }), { status: 200 });
    await assert.rejects(fetchAllProducts({ mallId: 'test', clientId: 'test' }), /일부 응답/);
    globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).endsWith('/count') ? { count: ++counts } : { products: [raw] }), { status: 200 });
    await assert.rejects(fetchAllProducts({ mallId: 'test', clientId: 'test' }), /개수가 바뀌/);
    globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).endsWith('/count') ? { count: 1 } : { products: [raw] }), { status: 200 });
    assert.equal((await fetchAllProducts({ mallId: 'test', clientId: 'test' }))[0].productNo, 1);
  } finally { globalThis.fetch = original; }
});

test('포장 추천은 확인되지 않은 목적·다른 상품·다른 행사를 추천하지 않는다', () => {
  assert.equal(matchesTarget({ category: 'wedding' }, 'wedding', 'return', 12), false);
  const targeting = cleanTargeting({ events: ['wedding'], purposes: ['return'], productNos: [12] });
  assert.equal(matchesTarget({ targeting }, 'wedding', 'return', 12), true);
  assert.equal(matchesTarget({ targeting }, 'wedding', 'celebration', 12), false);
  assert.equal(matchesTarget({ targeting }, 'funeral', 'return', 12), false);
  assert.equal(matchesTarget({ targeting }, 'wedding', 'return', 13), false);
  assert.equal(matchesTarget({ targeting: { events: ['common'], purposes: ['neutral'], productNos: [] } }, null, 'return', 1), true);
  assert.match(presetText('wedding', 'return'), /감사/);
  assert.doesNotMatch(presetText('wedding', 'return'), /기념일/);
  assert.doesNotMatch(presetText('funeral', 'celebration'), /축하/);
});

test('조회 상한을 넘긴 자료는 전체 자료인 척 반환하지 않는다', async () => {
  const list = [1, 2, 3];
  const page = async (from: number, to: number) => ({ data: list.slice(from, to + 1), error: null });
  const result = await readPages(page, 2, true);
  assert.equal(result.error?.code, 'limit_exceeded');
  assert.deepEqual(result.rows, []);
  assert.deepEqual((await readPages(page, 3, true)).rows, list);
});

test('예약 작업은 비어 있거나 짧은 인증값을 거부하고 비교한다', () => {
  const secret = 's'.repeat(32);
  assert.equal(cronAuthorized(null, secret), false);
  assert.equal(cronAuthorized('Bearer tiny', 'tiny'), false);
  assert.equal(cronAuthorized('Bearer ' + secret, secret), true);
  assert.equal(cronAuthorized('Bearer ' + 't'.repeat(32), secret), false);
  assert.equal(operationEvent('feedback_save', 'error', Date.now(), 'customer@example.com token=private').code, 'unknown');
});

test('백업은 경로 이탈과 재주문 원본 누락을 거부하고 복구를 트랜잭션으로 만든다', () => {
  assert.equal(safeBackupPath('../secret'), false);
  assert.equal(safeBackupPath('design-files/../../secret'), false);
  assert.equal(safeBackupPath('C:/secret'), false);
  assert.equal(safeBackupPath('design-files/OD-AAAA-AAAA.png'), true);
  const snapshot = { schemaVersion: '20261027', capturedAt: new Date().toISOString(), tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])) } as unknown as Snapshot;
  snapshot.tables.designs.push({ code: 'OD-AAAA-AAAA', source_code: 'OD-BBBB-BBBB' });
  assert.throws(() => validateSnapshot(snapshot), /원본 접수/);
  snapshot.tables.designs = [];
  snapshot.tables.products = [{ product_no: 1, name: "quote ' ; drop table public.products; --" }];
  const sql = restoreSql(snapshot);
  assert.match(sql, /begin;/);
  assert.match(sql, /commit;$/);
  assert.ok(sql.includes("quote '' ; drop"));
  assert.equal(sha256('same'), sha256(Buffer.from('same')));
});

test('백업 검증 도구는 파일 변조를 잡고 정상 백업에서만 복구 SQL을 만든다', () => {
  const dir = mkdtempSync(join(tmpdir(),'ondap-backup-test-'));
  const file = 'design-files/OD-AAAA-AAAA.png';
  const bytes = Buffer.from('fixture-image-bytes');
  const snapshot = { schemaVersion: '20261027', capturedAt: new Date().toISOString(), tables: Object.fromEntries(BACKUP_TABLES.map(t=>[t,[]])) } as unknown as Snapshot;
  snapshot.tables.designs.push({ code:'OD-AAAA-AAAA',source_code:null,print_path:'OD-AAAA-AAAA.png' });
  mkdirSync(join(dir,'files','design-files'),{recursive:true});
  writeFileSync(join(dir,'files',file),bytes);
  const raw=JSON.stringify(snapshot);
  writeFileSync(join(dir,'snapshot.json'),raw);
  writeFileSync(join(dir,'manifest.json'),JSON.stringify({schemaVersion:'20261027',sourceUrl:'https://source.supabase.co',snapshotSha256:sha256(raw),files:[{path:file,sha256:sha256(bytes),bytes:bytes.length}]}));
  const result=spawnSync(process.execPath,['scripts/ops-verify-backup.ts',dir,'https://staging.supabase.co'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.ok(existsSync(join(dir,'restore-staging.sql')));
  writeFileSync(join(dir,'files',file),'corrupt');
  const corrupt=spawnSync(process.execPath,['scripts/ops-verify-backup.ts',dir],{encoding:'utf8'});
  assert.notEqual(corrupt.status,0);
  assert.match(corrupt.stderr,/백업 파일 검증 실패/);
});
