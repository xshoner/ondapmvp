import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kstDate, summarize, summaryCsv } from '../src/stats/summary.ts';

test('실적 집계: 한국 날짜로 묶고, 취소 접수는 빼고, 1위·3위 안 횟수를 센다', () => {
  const recs = [
    { createdAt: '2026-10-20T16:00:00Z', event: 'funeral', relation: 'business', resultProductNos: [27, 39, 48] }, // 한국 10/21 01시
    { createdAt: '2026-10-21T02:00:00Z', event: 'funeral', relation: 'senior', resultProductNos: [27, 48] },
    { createdAt: '2026-10-21T03:00:00Z', event: 'wedding', relation: 'business', resultProductNos: [39] },
  ];
  const designs = [
    { createdAt: '2026-10-21T01:00:00Z', status: 'received', orderNo: null, hasSticker: true },
    { createdAt: '2026-10-21T01:00:00Z', status: 'order_confirmed', orderNo: '1', hasSticker: false },
    { createdAt: '2026-10-21T01:00:00Z', status: 'printed', orderNo: null, hasSticker: true },
    { createdAt: '2026-10-21T01:00:00Z', status: 'canceled', orderNo: null, hasSticker: true },
  ];
  const s = summarize(recs, designs, { from: '2026-10-20', to: '2026-10-22' });
  assert.equal(kstDate('2026-10-20T16:00:00Z'), '2026-10-21');
  assert.deepEqual(s.days.map((d) => [d.date, d.recommendations, d.designs]), [['2026-10-20', 0, 0], ['2026-10-21', 3, 3], ['2026-10-22', 0, 0]]);
  assert.deepEqual(s.totals, { recommendations: 3, designs: 3, ordered: 2, printed: 1, withSticker: 2 });
  assert.deepEqual(s.byEvent, [{ id: 'funeral', count: 2 }, { id: 'wedding', count: 1 }]);
  assert.deepEqual(s.topProducts[0], { productNo: 27, first: 2, top3: 2 });
  assert.ok(summaryCsv(s).startsWith('﻿날짜,추천 사용,포장 디자인 접수\r\n2026-10-20,0,0'));
});
