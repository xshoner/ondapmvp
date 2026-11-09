'use client';

// 디자인 접수 목록: 카페24 주문서의 '온답 포장 디자인 코드'로 찾아 주문번호를 잇고, 인쇄 파일을 내려받는다.
// 여러 건 상태 바꾸기, 늦어지는 건 표시, 키보드(j·k·x·p·s·?)로 빠르게 처리한다.
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { isTyping, saveBlob } from '@/lib/device.ts';
import { kstLabel } from '@/lib/kst.ts';
import { MAX_SHEETS, sheetLayout, sheetsNeeded, type Paper } from '@/packaging/sheet.ts';
import { STATUS_LABEL, designStatusLabel, filterQuery, isLate, type DesignFilter } from '@/packaging/design-filter.ts';
import type { Design, DesignStatus } from '@/packaging/types.ts';
import { updateDesignAction, updateDesignsStatusAction, syncCafe24OrdersAction } from './actions.ts';

type PrintOptions = { paper: Paper; fill: boolean };
type Props = { designs: Design[]; eventNames: Record<string, string>; filter: DesignFilter & { rawCode: string; codeInvalid: boolean }; now: number };

const fileUrl = (code: string) => `/admin/packaging/print/${code}`;
const sheetUrl = (code: string, o: PrintOptions, test = false) => `${fileUrl(code)}/sheet?paper=${o.paper}${o.fill && !test ? '&fill=1' : ''}${test ? '&count=1&test=1' : ''}`;
const daysSince = (iso: string, now: number) => Math.floor((now - Date.parse(iso)) / 86400000);

const SHORTCUTS: [string, string][] = [
  ['j / k', '다음 / 이전 접수로'],
  ['x', '선택하기·풀기'],
  ['p', '인쇄 PDF 받기'],
  ['t', '시험 인쇄 1장'],
  ['s', '상태 고르기로 이동'],
  ['Esc', '선택 모두 풀기'],
  ['?', '이 안내 열고 닫기'],
];

export function DesignsTable({ designs, eventNames, filter, now }: Props) {
  const router = useRouter();
  const filtered = Boolean(filter.rawCode || filter.status || filter.from || filter.to || filter.late);
  const exportQuery = filterQuery(filter);
  const [options, setOptions] = useState<PrintOptions>({ paper: 'A4', fill: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  const [help, setHelp] = useState(false);
  const [batchStatus, setBatchStatus] = useState<DesignStatus>('order_confirmed');
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchPending, startBatch] = useTransition();
  const [syncPending, startSync] = useTransition();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const syncing = useRef(false);
  const printableSelected = designs.filter((d) => selected.has(d.code) && d.printCode && d.sticker);
  const allSelected = designs.length > 0 && designs.every((d) => selected.has(d.code));

  useEffect(() => {
    let active = true;
    const sync = async () => {
      if (syncing.current || document.hidden) return;
      syncing.current = true;
      setAutoSyncing(true);
      try {
        const result = await syncCafe24OrdersAction();
        if (active) {
          if (!result.ok) setSyncMessage(result.message);
          else setSyncMessage(null);
          router.refresh();
        }
      } catch {
        if (active) setSyncMessage('자동 동기화에 실패했습니다. 카페24 주문 동기화 버튼으로 다시 시도해 주세요.');
      } finally { syncing.current = false; if (active) setAutoSyncing(false); }
    };
    void sync();
    const timer = setInterval(() => void sync(), 30000);
    return () => { active = false; clearInterval(timer); };
  }, [router]);

  const toggle = (c: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    return next;
  });

  // 키보드로 목록 다루기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const d = designs[cursor];
      const go = (i: number) => {
        e.preventDefault();
        const next = Math.max(0, Math.min(designs.length - 1, i));
        setCursor(next);
        document.querySelector(`[data-row="${designs[next]?.code}"]`)?.scrollIntoView({ block: 'nearest' });
      };
      if (e.key === 'j') go(cursor + 1);
      else if (e.key === 'k') go(cursor - 1);
      else if (e.key === '?') setHelp((h) => !h);
      else if (e.key === 'Escape') { setSelected(new Set()); setHelp(false); }
      else if (!d) return;
      else if (e.key === 'x') toggle(d.code);
      else if ((e.key === 'p' || e.key === 't') && d.printCode && d.sticker) location.href = sheetUrl(d.code, options, e.key === 't');
      else if (e.key === 's') { e.preventDefault(); document.querySelector<HTMLSelectElement>(`[data-row="${d.code}"] select`)?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [designs, cursor, options]);

  const changeStatus = () => startBatch(async () => {
    setBatchMessage(null);
    const res = await updateDesignsStatusAction([...selected], batchStatus);
    if (!res.ok) return setBatchMessage(res.message);
    setBatchMessage(`${res.updated.length}건을 ‘${STATUS_LABEL[batchStatus]}’(으)로 바꿨습니다.${res.missing.length ? ` 바꾸지 못함: ${res.missing.join(', ')}` : ''}`);
    setSelected(new Set());
    router.refresh();
  });

  // 서버 응답 한도(4.5MB)를 넘지 않도록 파일은 한 건씩 받고, 묶기는 브라우저에서 한다
  const downloadZip = async () => {
    const list = printableSelected;
    if (list.length === 0) return;
    try {
      const { zipSync } = await import('fflate');
      const files: Record<string, [Uint8Array, { level: 0 }]> = {};
      for (let i = 0; i < list.length; i++) {
        const { code, printCode } = list[i];
        setZipping(`${i + 1}/${list.length}`);
        for (const [name, url] of [[`${code}.png`, fileUrl(printCode!)], [`${code}-${options.paper}.pdf`, sheetUrl(code, options)]]) {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${code}: ${await res.text()}`);
          files[name] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }]; // PNG·PDF는 이미 압축돼 있다
        }
      }
      const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replaceAll('-', '');
      saveBlob(new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), `ondap-print-${stamp}-${list.length}건.zip`);
    } catch (e) {
      alert(`묶어 받기 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setZipping(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <form className="panel filter-bar" method="get" action="/admin/packaging">
        <input type="hidden" name="tab" value="designs" />
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">디자인 코드</span>
          <input type="text" name="code" defaultValue={filter.rawCode} placeholder="OD-XXXX-XXXX" style={{ width: 170 }} />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">상태</span>
          <select name="status" defaultValue={filter.status ?? ''}>
            <option value="">전체</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">접수일 (부터)</span>
          <input type="date" name="from" defaultValue={filter.from ?? ''} />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">접수일 (까지)</span>
          <input type="date" name="to" defaultValue={filter.to ?? ''} />
        </label>
        <div className="row" style={{ gap: 8, alignSelf: 'end' }}>
          <button type="submit" className="btn small">조회하기</button>
          {filtered && <a className="btn ghost small" href="/admin/packaging?tab=designs">조건 지우기</a>}
          <a className="btn ghost small" href={`/admin/packaging/export${exportQuery ? `?${exportQuery}` : ''}`}>CSV 내려받기</a>
          <button
            type="button"
            className="btn small"
            style={{ background: '#2563eb', color: '#fff', fontWeight: 600 }}
            disabled={syncPending || autoSyncing}
            onClick={() => {
              if (syncing.current) return setSyncMessage('자동 동기화가 진행 중입니다. 잠시만 기다려 주세요.');
              syncing.current = true;
              setSyncMessage(null);
              startSync(async () => {
                try {
                  const res = await syncCafe24OrdersAction();
                  setSyncMessage(res.message);
                  router.refresh();
                } catch {
                  setSyncMessage('동기화에 실패했습니다. 다시 시도해 주세요.');
                } finally { syncing.current = false; }
              });
            }}
          >
            {syncPending || autoSyncing ? '카페24 동기화 중...' : '🔄 카페24 주문 동기화'}
          </button>
        </div>
        {syncMessage && (
          <div className="panel" style={{ flexBasis: '100%', padding: '8px 12px', background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 13, marginTop: 4 }}>
            {syncMessage}
          </div>
        )}
        {designs.length >= 200 && <span className="small muted" style={{ flexBasis: '100%' }}>최근 200건까지 표시합니다. CSV는 최대 5,000건까지 내려받을 수 있습니다.</span>}
      </form>
      {filter.codeInvalid && <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>코드 형식이 맞지 않습니다. 예: OD-7QDF-3P6M</p>}

      {help && (
        <div className="panel shortcut-help" role="dialog" aria-label="단축키">
          <b className="small">단축키</b>
          <dl>{SHORTCUTS.map(([k, v]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
        </div>
      )}

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
        <span className="small muted">
          실제 크기 mm로 만듭니다. 인쇄할 때 ‘실제 크기(100%)’로 뽑으세요. 마젠타 선은 칼선, 오른쪽 위 QR을 찍으면 인쇄 완료로 바뀝니다.
        </span>
      </div>

      {selected.size > 0 && (
        <div className="panel batch-bar" role="region" aria-label="선택한 접수 처리">
          <b className="small">선택 {selected.size}건</b>
          <select value={batchStatus} onChange={(e) => setBatchStatus(e.target.value as DesignStatus)} aria-label="바꿀 상태">
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button type="button" className="btn small" disabled={batchPending} onClick={changeStatus}>{batchPending ? '바꾸는 중' : '상태 변경하기'}</button>
          <button type="button" className="btn ghost small" disabled={printableSelected.length === 0 || zipping !== null} onClick={() => void downloadZip()}>
            {zipping ? `묶는 중 ${zipping}` : `인쇄 파일 묶어 받기 ${printableSelected.length}건 (PNG+PDF)`}
          </button>
          <button type="button" className="btn ghost small" style={{ border: 'none' }} onClick={() => setSelected(new Set())}>선택 풀기</button>
        </div>
      )}
      {batchMessage && <p className="small" role="status" style={{ margin: 0 }}>{batchMessage}</p>}

      {designs.length === 0 ? (
        <p className="small muted">{filtered ? '조건에 맞는 접수가 없습니다.' : '아직 접수된 디자인이 없습니다.'}</p>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data designs-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="보이는 접수 모두 선택"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(designs.map((d) => d.code)))}
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
              {designs.map((d, i) => (
                <DesignRow
                  key={d.code} design={d} eventNames={eventNames} options={options} now={now} active={i === cursor}
                  selected={selected.has(d.code)} onToggle={() => toggle(d.code)} onFocusRow={() => setCursor(i)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DesignRow({ design: d, eventNames, options, now, active, selected, onToggle, onFocusRow }: {
  design: Design; eventNames: Record<string, string>; options: PrintOptions; now: number; active: boolean;
  selected: boolean; onToggle(): void; onFocusRow(): void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(d.status);
  const [orderNo, setOrderNo] = useState(d.orderNo ?? '');
  const [memo, setMemo] = useState(d.memo);
  const [message, setMessage] = useState<string | null>(null);
  // 목록이 새로 그려지면(한꺼번에 바꾸기 등) 고치지 않은 칸만 새 값으로. 고치던 칸은 그대로 두어 저장 단추로 반영한다
  const server = useRef({ status: d.status, orderNo: d.orderNo ?? '', memo: d.memo });
  useEffect(() => {
    const prev = server.current;
    const next = { status: d.status, orderNo: d.orderNo ?? '', memo: d.memo };
    setStatus((v) => (v === prev.status ? next.status : v));
    setOrderNo((v) => (v === prev.orderNo ? next.orderNo : v));
    setMemo((v) => (v === prev.memo ? next.memo : v));
    server.current = next;
  }, [d.status, d.orderNo, d.memo]);
  const dirty = status !== d.status || orderNo !== (d.orderNo ?? '') || memo !== d.memo;
  const printable = Boolean(d.printCode && d.sticker);
  const sheets = d.sticker ? sheetsNeeded(sheetLayout(d.sticker, options.paper), d.quantity) : 0;
  const late = isLate(d, now);
  const isAwaitingPayment = d.status === 'pending' && Boolean(d.orderNo || d.memo?.includes('카페24 주문') || d.memo?.includes('무통장 입금 대기'));

  const save = () => start(async () => {
    setMessage(null);
    const res = await updateDesignAction(d.code, { status, orderNo, memo });
    setMessage(res.ok ? '저장했습니다.' : res.message);
    if (res.ok) router.refresh();
  });

  return (
    <tr data-row={d.code} className={[active ? 'cursor' : '', late ? 'late' : ''].join(' ')} style={{ opacity: d.status === 'canceled' ? 0.55 : 1 }} onFocusCapture={onFocusRow}>
      <td><input type="checkbox" checked={selected} onChange={onToggle} aria-label={`${d.code} 선택`} /></td>
      <td>
        {d.printCode ? (
          <a href={`${fileUrl(d.printCode)}?inline=1`} target="_blank" rel="noreferrer" title="크게 보기">
            <img src={`${fileUrl(d.printCode)}?thumb=1`} alt="" loading="lazy" width={72} height={72} style={{ objectFit: 'contain', background: '#eee', borderRadius: 8, display: 'block' }} />
          </a>
        ) : (
          <span className="small muted">스티커 없음</span>
        )}
      </td>
      <td>
        <b className="mono" style={{ fontSize: 14 }}>{d.code}</b>
        <div className="small muted">{kstLabel(d.createdAt)}</div>
        {d.status === 'pending' && (
          isAwaitingPayment ? (
            <span className="badge" style={{ display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', fontSize: 12, fontWeight: 600 }}>
              무통장 입금 대기
            </span>
          ) : (
            <span className="badge" style={{ display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 4, background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb', fontSize: 12, fontWeight: 600 }}>
              디자인 저장 (주문서 미접수)
            </span>
          )
        )}
        {d.sourceCode && <div className="small muted">{d.sourceCode} 다시 주문</div>}
        {late && (
          <div className="late-badge">
            {d.status === 'received' ? `접수 ${daysSince(d.createdAt, now)}일째 주문 확인 전` : `주문 확인 ${daysSince(d.statusChangedAt, now)}일째 인쇄 전`}
          </div>
        )}
        {printable && d.status === 'pending' && (
          isAwaitingPayment ? (
            <div className="small" style={{ color: '#b45309', marginTop: 6, fontWeight: 500 }}>
              ⚠️ 무통장 입금 대기 (카페24 결제 확인 전)
            </div>
          ) : (
            <div className="small muted" style={{ marginTop: 6 }}>
              ℹ️ 주문서 작성 전 (디자인 보관 상태)
            </div>
          )
        )}
        {printable && d.status !== 'pending' && (
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {sheets > MAX_SHEETS ? (
              <span className="small" style={{ color: 'var(--red)' }}>{sheets}장 필요 · 한 번에 {MAX_SHEETS}장까지</span>
            ) : (
              <a className="btn small" href={sheetUrl(d.code, options)} title={`${options.paper} ${sheets}장`}>인쇄 PDF {options.paper}·{sheets}장</a>
            )}
            <a className="btn ghost small" href={sheetUrl(d.code, options, true)} title="칼선·색 확인용으로 스티커 한 칸만">시험 1장</a>
            <a className="btn ghost small" href={fileUrl(d.printCode!)}>PNG</a>
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
        {d.status !== 'received' && <div className="small muted" style={{ marginTop: 4 }}>{designStatusLabel(d)} {kstLabel(d.statusChangedAt)}</div>}
        {message && <div className="small" style={{ marginTop: 4 }}>{message}</div>}
      </td>
    </tr>
  );
}
