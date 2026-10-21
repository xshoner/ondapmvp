'use client';

// 디자인 접수 목록: 카페24 주문서의 '온답 포장 디자인 코드'로 찾아 주문번호를 잇고, 인쇄 파일을 내려받는다
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { kstLabel } from '@/lib/kst.ts';
import type { Design, DesignStatus } from '@/packaging/types.ts';
import { updateDesignAction } from './actions.ts';

const STATUS_LABEL: Record<DesignStatus, string> = {
  received: '접수',
  order_confirmed: '주문 확인',
  printed: '인쇄 완료',
  canceled: '취소',
};

type Props = { designs: Design[]; eventNames: Record<string, string>; code: string; codeInvalid: boolean };

export function DesignsTable({ designs, eventNames, code, codeInvalid }: Props) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <form className="row" method="get" action="/admin/packaging">
        <input type="hidden" name="tab" value="designs" />
        <div className="field" style={{ margin: 0 }}>
          <input type="text" name="code" defaultValue={code} placeholder="디자인 코드 (OD-XXXX-XXXX)" style={{ width: 240 }} />
        </div>
        <button type="submit" className="btn small">찾기</button>
        {code && <a className="small" href="/admin/packaging?tab=designs">전체 보기</a>}
        <span style={{ flex: 1 }} />
        <span className="small muted">카페24 주문 상세의 추가항목 코드로 찾은 뒤 주문번호를 적고 ‘주문 확인’으로 바꾸세요.</span>
      </form>
      {codeInvalid && <p className="small" style={{ color: 'var(--red)', margin: 0 }}>코드 형식이 맞지 않습니다. 예: OD-7QDF-3P6M</p>}

      {designs.length === 0 ? (
        <p className="small muted">{code ? '해당 코드의 디자인이 없습니다.' : '아직 접수된 디자인이 없습니다.'}</p>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data designs-table">
            <thead>
              <tr>
                <th>스티커</th>
                <th>디자인 코드 · 접수</th>
                <th>상품 · 수량</th>
                <th>포장 · 스티커</th>
                <th>상태 · 주문번호 · 메모</th>
              </tr>
            </thead>
            <tbody>
              {designs.map((d) => <DesignRow key={d.code} design={d} eventNames={eventNames} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DesignRow({ design: d, eventNames }: { design: Design; eventNames: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(d.status);
  const [orderNo, setOrderNo] = useState(d.orderNo ?? '');
  const [memo, setMemo] = useState(d.memo);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = status !== d.status || orderNo !== (d.orderNo ?? '') || memo !== d.memo;
  const file = `/admin/packaging/print/${d.code}`;

  const save = () => start(async () => {
    setMessage(null);
    const res = await updateDesignAction(d.code, { status, orderNo, memo });
    setMessage(res.ok ? '저장했습니다.' : res.message);
    if (res.ok) router.refresh();
  });

  return (
    <tr style={{ opacity: d.status === 'canceled' ? 0.55 : 1 }}>
      <td>
        {d.hasPrintFile ? (
          <a href={`${file}?inline=1`} target="_blank" rel="noreferrer" title="크게 보기">
            <img src={`${file}?inline=1`} alt="" loading="lazy" style={{ width: 72, height: 72, objectFit: 'contain', background: '#eee', borderRadius: 8, display: 'block' }} />
          </a>
        ) : (
          <span className="small muted">스티커 없음</span>
        )}
      </td>
      <td>
        <b style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 14 }}>{d.code}</b>
        <div className="small muted">{kstLabel(d.createdAt)}</div>
        {d.hasPrintFile && <a className="btn ghost small" style={{ marginTop: 6 }} href={file}>인쇄 파일 받기</a>}
      </td>
      <td>
        <div>{d.productName}</div>
        <div className="small muted">상품번호 {d.productNo} · {d.quantity}개{d.event ? ` · ${eventNames[d.event] ?? d.event}` : ''}</div>
      </td>
      <td>
        <div>{d.styleName}</div>
        <div className="small muted">
          {d.sticker ? `${d.sticker.shape === 'circle' ? '원형' : '사각'} ${d.sticker.sizeCm}×${d.sticker.sizeCm}cm` : '인쇄물 없음'}
        </div>
      </td>
      <td style={{ minWidth: 300 }}>
        <div className="row" style={{ gap: 6 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value as DesignStatus)} aria-label="상태">
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="text" value={orderNo} maxLength={40} placeholder="카페24 주문번호" onChange={(e) => setOrderNo(e.target.value)} style={{ width: 170 }} />
        </div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <input type="text" value={memo} maxLength={500} placeholder="메모" onChange={(e) => setMemo(e.target.value)} style={{ flex: 1 }} />
          <button type="button" className="btn small" disabled={!dirty || pending} onClick={save}>{pending ? '저장 중' : '저장'}</button>
        </div>
        {message && <div className="small" style={{ marginTop: 4 }}>{message}</div>}
      </td>
    </tr>
  );
}
