'use client';

// 디자인 접수 목록: 카페24 주문서의 '온답 포장 디자인 코드'로 찾아 주문번호를 잇고, 인쇄 파일을 내려받는다
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { kstLabel } from '@/lib/kst.ts';
import { sheetLayout, type Paper } from '@/packaging/sheet.ts';
import type { Design, DesignStatus } from '@/packaging/types.ts';
import { updateDesignAction } from './actions.ts';

const STATUS_LABEL: Record<DesignStatus, string> = {
  received: '접수',
  order_confirmed: '주문 확인',
  printed: '인쇄 완료',
  canceled: '취소',
};

type PrintOptions = { paper: Paper; fill: boolean };
type Props = { designs: Design[]; eventNames: Record<string, string>; code: string; codeInvalid: boolean };

const fileUrl = (code: string) => `/admin/packaging/print/${code}`;
const sheetUrl = (code: string, o: PrintOptions) => `${fileUrl(code)}/sheet?paper=${o.paper}${o.fill ? '&fill=1' : ''}`;

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function DesignsTable({ designs, eventNames, code, codeInvalid }: Props) {
  const [options, setOptions] = useState<PrintOptions>({ paper: 'A4', fill: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState<string | null>(null);
  const printable = designs.filter((d) => d.hasPrintFile && d.sticker);
  const allSelected = printable.length > 0 && printable.every((d) => selected.has(d.code));

  const toggle = (c: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    return next;
  });

  // 서버 응답 한도(4.5MB)를 넘지 않도록 파일은 한 건씩 받고, 묶기는 브라우저에서 한다
  const downloadZip = async () => {
    const codes = printable.map((d) => d.code).filter((c) => selected.has(c));
    if (codes.length === 0) return;
    try {
      const { zipSync } = await import('fflate');
      const files: Record<string, [Uint8Array, { level: 0 }]> = {};
      for (let i = 0; i < codes.length; i++) {
        setZipping(`${i + 1}/${codes.length}`);
        for (const [name, url] of [[`${codes[i]}.png`, fileUrl(codes[i])], [`${codes[i]}-${options.paper}.pdf`, sheetUrl(codes[i], options)]]) {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${codes[i]}: ${await res.text()}`);
          files[name] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }]; // PNG·PDF는 이미 압축돼 있다
        }
      }
      const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replaceAll('-', '');
      saveBlob(new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), `ondap-print-${stamp}-${codes.length}건.zip`);
    } catch (e) {
      alert(`묶어 받기 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setZipping(null);
    }
  };

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

      <div className="panel print-bar">
        <b className="small">인쇄 PDF</b>
        <div className="chips">
          {(['A4', 'A3'] as const).map((p) => (
            <button key={p} type="button" className="chip" aria-pressed={options.paper === p} onClick={() => setOptions({ ...options, paper: p })}>{p}</button>
          ))}
        </div>
        <label className="small row" style={{ gap: 4 }}>
          <input type="checkbox" checked={options.fill} onChange={(e) => setOptions({ ...options, fill: e.target.checked })} />
          마지막 장 남는 칸도 채우기(여분)
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn small" disabled={selected.size === 0 || zipping !== null} onClick={() => void downloadZip()}>
          {zipping ? `묶는 중 ${zipping}` : `선택한 ${selected.size}건 묶어 받기 (PNG+PDF)`}
        </button>
        <span className="small muted" style={{ flexBasis: '100%' }}>
          실제 크기 mm로 만듭니다. 인쇄할 때 ‘실제 크기(100%)’로 뽑으세요. 마젠타 선은 자르는 선(칼선)입니다.
        </span>
      </div>

      {designs.length === 0 ? (
        <p className="small muted">{code ? '해당 코드의 디자인이 없습니다.' : '아직 접수된 디자인이 없습니다.'}</p>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data designs-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="인쇄 파일 있는 접수 모두 선택"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(printable.map((d) => d.code)))}
                  />
                </th>
                <th>스티커</th>
                <th>디자인 코드 · 접수</th>
                <th>상품 · 수량</th>
                <th>포장 · 스티커</th>
                <th>상태 · 주문번호 · 메모</th>
              </tr>
            </thead>
            <tbody>
              {designs.map((d) => (
                <DesignRow key={d.code} design={d} eventNames={eventNames} options={options} selected={selected.has(d.code)} onToggle={() => toggle(d.code)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DesignRow({ design: d, eventNames, options, selected, onToggle }: {
  design: Design; eventNames: Record<string, string>; options: PrintOptions; selected: boolean; onToggle(): void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(d.status);
  const [orderNo, setOrderNo] = useState(d.orderNo ?? '');
  const [memo, setMemo] = useState(d.memo);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = status !== d.status || orderNo !== (d.orderNo ?? '') || memo !== d.memo;
  const file = fileUrl(d.code);
  const printable = d.hasPrintFile && d.sticker;
  const sheets = d.sticker ? Math.ceil(d.quantity / sheetLayout(d.sticker, options.paper).perSheet) : 0;

  const save = () => start(async () => {
    setMessage(null);
    const res = await updateDesignAction(d.code, { status, orderNo, memo });
    setMessage(res.ok ? '저장했습니다.' : res.message);
    if (res.ok) router.refresh();
  });

  return (
    <tr style={{ opacity: d.status === 'canceled' ? 0.55 : 1 }}>
      <td>{printable && <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`${d.code} 선택`} />}</td>
      <td>
        {d.hasPrintFile ? (
          <a href={`${file}?inline=1`} target="_blank" rel="noreferrer" title="크게 보기">
            <img src={`${file}?thumb=1`} alt="" loading="lazy" width={72} height={72} style={{ objectFit: 'contain', background: '#eee', borderRadius: 8, display: 'block' }} />
          </a>
        ) : (
          <span className="small muted">스티커 없음</span>
        )}
      </td>
      <td>
        <b style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 14 }}>{d.code}</b>
        <div className="small muted">{kstLabel(d.createdAt)}</div>
        {printable && (
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <a className="btn small" href={sheetUrl(d.code, options)} title={`${options.paper} ${sheets}장`}>인쇄 PDF {options.paper}·{sheets}장</a>
            <a className="btn ghost small" href={file}>PNG</a>
          </div>
        )}
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
