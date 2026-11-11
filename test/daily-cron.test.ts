import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDailyTasks, runDailyTasksDetailed } from '../src/lib/daily-cron.ts';

test('하루 한 번 한국 시간 18시에 동기화 후 상태 점검을 실행한다', async () => {
  const schedule = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).crons;
  assert.deepEqual(schedule, [{ path: '/api/cron/daily', schedule: '0 9 * * *' }]);
  const called: string[] = [];
  const result = await runDailyTasks(async () => { called.push('sync'); return new Response(null, { status: 200 }); }, async () => { called.push('health'); return new Response(null, { status: 200 }); });
  assert.deepEqual(called, ['sync', 'health']);
  assert.deepEqual(result, { sync: 200, health: 200 });
});

test('상품 동기화가 실패해도 상태 점검과 결제 재처리를 계속한다', async () => {
  const result = await runDailyTasks(async () => { throw new Error('offline'); }, async () => new Response(null, { status: 200 }));
  assert.deepEqual(result, { sync: 503, health: 200 });

  const detailed = await runDailyTasksDetailed(
    async () => { throw new Error('sync_timeout'); },
    async () => Response.json({ ok: false, failedPayments: 2 }, { status: 503 }),
  );
  assert.equal(detailed.sync, 503);
  assert.equal(detailed.health, 503);
  assert.equal(detailed.details.sync.error, 'sync_timeout');
  assert.deepEqual(detailed.details.health.body, { ok: false, failedPayments: 2 });
});
