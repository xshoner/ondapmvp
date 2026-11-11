'use client';

import { useState, useTransition } from 'react';
import { kstLabel } from '@/lib/kst.ts';
import type { PaymentEventIssue } from '@/data/operations-repository.ts';
import { resolvePaymentEventAction, retryPaymentEventAction } from './actions.ts';

export function PaymentIssues({ issues }: { issues: PaymentEventIssue[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (issues.length === 0) return null;

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => {
    startTransition(async () => {
      const res = await fn();
      setMessage(res.message);
    });
  };

  return (
    <div style={{ marginTop: 16 }}>
      <h3>확인 필요한 결제 알림 ({issues.length}건)</h3>
      <p className="small muted">주문번호와 오류 사유만 표시됩니다. 주문서 확인 후 다시 조회하거나 확인 완료로 정리할 수 있습니다.</p>
      {message && <p className="notice" role="status">{message}</p>}
      <table className="data">
        <thead>
          <tr>
            <th>주문번호</th>
            <th>이벤트</th>
            <th>상태</th>
            <th>시도</th>
            <th>사유</th>
            <th>시각</th>
            <th>조치</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((item) => (
            <tr key={`${item.shopNo}:${item.orderNo}`}>
              <td className="num">{item.orderNo}</td>
              <td className="num">{item.eventNo}</td>
              <td>{item.status}</td>
              <td className="num">{item.attempts}</td>
              <td>{item.lastError || '-'}</td>
              <td>{item.updatedAt ? kstLabel(item.updatedAt) : '-'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button
                  type="button"
                  className="btn small"
                  disabled={pending}
                  onClick={() => run(() => retryPaymentEventAction(item.shopNo, item.orderNo))}
                >
                  다시 확인
                </button>{' '}
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={pending}
                  onClick={() => run(() => resolvePaymentEventAction(item.shopNo, item.orderNo))}
                >
                  확인 완료
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
