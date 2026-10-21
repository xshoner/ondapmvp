import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designsCsv, filterQuery, kstRange, parseDesignFilter } from '../src/packaging/design-filter.ts';
import type { Design } from '../src/packaging/types.ts';

test('거르기 조건: 잘못된 값은 버리고 코드는 정리한다', () => {
  const f = parseDesignFilter({ code: ' od-7qdf-3p6m ', status: 'printed', from: '2026-10-01', to: 'x' });
  assert.equal(f.code, 'OD-7QDF-3P6M');
  assert.equal(f.status, 'printed');
  assert.equal(f.from, '2026-10-01');
  assert.equal(f.to, null);
  assert.equal(parseDesignFilter({ status: 'hacked' }).status, null);
  assert.equal(parseDesignFilter({ code: 'nope' }).codeInvalid, true);
  assert.equal(filterQuery(f), 'code=OD-7QDF-3P6M&status=printed&from=2026-10-01');
});

test('한국 날짜 범위: 10/21 하루 = UTC 10/20 15:00 이상 10/21 15:00 미만', () => {
  assert.deepEqual(kstRange({ from: '2026-10-21', to: '2026-10-21' }), { gte: '2026-10-20T15:00:00.000Z', lt: '2026-10-21T15:00:00.000Z' });
  assert.deepEqual(kstRange({ from: null, to: null }), { gte: null, lt: null });
});

test('CSV: 엑셀용 BOM, 쉼표·따옴표 감싸기, 수식으로 읽히는 값 막기', () => {
  const d = {
    code: 'OD-AAAA-BBBB', createdAt: '2026-10-21T01:00:00Z', productNo: 27, productName: '멸치, "특"', quantity: 30, event: 'thanks',
    styleId: 's1', styleName: '송학 장생', sticker: { shape: 'circle', sizeCm: 6 }, draft: null, hasPrintFile: true,
    status: 'order_confirmed', orderNo: '20261021-0000123', memo: '=HYPERLINK("x")',
  } as Design;
  const csv = designsCsv([d], { thanks: '감사선물' }, (iso) => iso.slice(0, 10));
  assert.ok(csv.startsWith('﻿접수일시,'));
  assert.ok(csv.includes('"멸치, ""특"""'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('주문 확인,20261021-0000123,27'));
  assert.ok(csv.includes('원형 6cm'));
});
