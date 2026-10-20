'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveExpectationAction } from '../actions.ts';

type Option = { productNo: number; name: string };

// 시나리오별 "1위여야 하는 상품"을 지정한다 (심이사 검토용)
export function ExpectationPicker({ scenarioKey, expected, options }: { scenarioKey: string; expected: number | null; options: Option[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="small" style={{ display: 'grid', gap: 4, minWidth: 280 }}>
      <span style={{ fontWeight: 600 }}>기대 정답 (이 상황의 1위여야 할 상품)</span>
      <select
        value={expected ?? ''}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          startTransition(async () => {
            await saveExpectationAction(scenarioKey, v ? Number(v) : null);
            router.refresh();
          });
        }}
        style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px' }}
      >
        <option value="">지정 안 함</option>
        {options.map((o) => <option key={o.productNo} value={o.productNo}>{o.name}</option>)}
      </select>
    </label>
  );
}
