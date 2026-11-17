'use client';

// 주문·포장 디자인 통합 작업판 (간결하고 직관적인 관리자 업무 중심)
// 1) 상단 3대 핵심 지표: 오늘 처리할 작업 / 일정 임박 / 확인 필요
// 2) 명확한 4개 작업 탭: 오늘 할 일 (미완료) / 확인 필요 / 일정 임박 / 전체 목록
// 3) 단일 통합 검색 & 기준일 임박순 정렬
// 4) 접힘 요약 행 + 펼침 검수 패널 (문구 검수, 일정 수정, 주문번호 기록, 안전한 인쇄)
// 5) 취소·결제대기 건의 오출고 및 오처리 원천 차단
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { isTyping, saveBlob } from '@/lib/device.ts';
import { kstLabel } from '@/lib/kst.ts';
import { MAX_SHEETS, sheetLayout, sheetsNeeded, type Paper } from '@/packaging/sheet.ts';
import { STATUS_LABEL, filterQuery, type DesignFilter } from '@/packaging/design-filter.ts';
import type { Design, DesignStatus, TextLayer } from '@/packaging/types.ts';
import { calculateScheduleStatus, type ScheduleInfo } from '@/packaging/schedule.ts';
import { fillPlaceholders } from '@/packaging/rules.ts';
import {
  updateDesignAction,
  updateDesignsStatusAction,
  syncCafe24OrdersAction,
  dismissPackagingAction,
  getDesignDetailAction,
  linkDesignToOrderAction,
} from './actions.ts';

type PrintOptions = { paper: Paper; fill: boolean };
type Props = {
  designs: Design[];
  eventNames: Record<string, string>;
  filter: DesignFilter & { rawCode: string; codeInvalid: boolean };
  now: number;
};

const fileUrl = (code: string) => `/admin/packaging/print/${code}`;
const sheetUrl = (code: string, o: PrintOptions, test = false) =>
  `${fileUrl(code)}/sheet?paper=${o.paper}${o.fill && !test ? '&fill=1' : ''}${test ? '&count=1&test=1' : ''}`;

export type WorkTab = 'active' | 'needs_check' | 'imminent' | 'all';
export type SortOption = 'schedule' | 'newest' | 'oldest';

const SHORTCUTS: [string, string][] = [
  ['j / k', '다음 / 이전 접수로'],
  ['x', '선택하기·풀기'],
  ['p', '인쇄 PDF 받기'],
  ['t', '시험 인쇄 1장'],
  ['s', '상태 드롭다운으로 이동'],
  ['Enter', '상세 아코디언 열기·닫기'],
  ['Esc', '선택 모두 풀기'],
  ['?', '이 안내 열고 닫기'],
];

function getMessageDetails(d: Design) {
  const stickerTexts =
    d.draft?.layers
      ?.filter((l): l is TextLayer => Boolean(l && l.type === 'text'))
      ?.map((l) => fillPlaceholders(l.text, d.draft?.fields || { recipient: '', sender: '', date: '' })) || [];

  const cardTexts =
    d.cardDraft?.layers
      ?.filter((l): l is TextLayer => Boolean(l && l.type === 'text'))
      ?.map((l) => fillPlaceholders(l.text, d.cardDraft?.fields || { recipient: '', sender: '', date: '' })) || [];

  const recipient = d.draft?.fields?.recipient || d.cardDraft?.fields?.recipient || '';
  const sender = d.draft?.fields?.sender || d.cardDraft?.fields?.sender || '';
  const printDate = d.draft?.fields?.date || d.cardDraft?.fields?.date || '';

  return { stickerTexts, cardTexts, recipient, sender, printDate };
}

export function DesignsTable({ designs, eventNames, filter, now }: Props) {
  const router = useRouter();
  const exportQuery = filterQuery(filter);
  const [options, setOptions] = useState<PrintOptions>({ paper: 'A4', fill: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  const [help, setHelp] = useState(false);

  // 작업판 탭 및 필터 상태 (단순화: 4대 탭)
  const [workTab, setWorkTab] = useState<WorkTab>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('schedule');

  // 일괄 작업 및 동기화 상태
  const [batchStatus, setBatchStatus] = useState<DesignStatus>('order_confirmed');
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchPending, startBatch] = useTransition();
  const [syncPending, startSync] = useTransition();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const syncing = useRef(false);

  // 각 디자인별 KST 일정 산출 맵
  const scheduleMap = useMemo(() => {
    const map = new Map<string, ScheduleInfo>();
    for (const d of designs) {
      map.set(d.code, calculateScheduleStatus(d, now));
    }
    return map;
  }, [designs, now]);

  // 상단 3대 핵심 지표 집계
  const counts = useMemo(() => {
    let activeCount = 0;
    let imminentCount = 0;
    let needsCheckCount = 0;

    for (const d of designs) {
      const isDone = d.status === 'completed' || d.status === 'no_packaging';
      const isCanceled = d.status === 'canceled';
      const isPending = d.status === 'pending';
      const info = scheduleMap.get(d.code);

      // 오늘 처리할 작업 (미완료 제작 진행 건)
      if (!isDone && !isCanceled && !isPending) {
        activeCount++;
      }

      // 확인 필요 (검수 대기 또는 주문 미연결)
      if (d.status === 'received' || (!d.orderNo && !isDone && !isCanceled && !isPending)) {
        needsCheckCount++;
      }

      // 일정 임박 (미완료 건 중 긴급 또는 임박: D-3 이내, 당일, 경과)
      if (!isDone && !isCanceled && !isPending && info && (info.urgency === 'emergency' || info.urgency === 'imminent')) {
        imminentCount++;
      }
    }

    return { activeCount, imminentCount, needsCheckCount, totalCount: designs.length };
  }, [designs, scheduleMap]);

  // 실시간 필터링 및 기준일 임박순 정렬
  const displayDesigns = useMemo(() => {
    let list = [...designs];

    // 1. 작업 탭 필터
    if (workTab === 'active') {
      list = list.filter((d) => d.status !== 'completed' && d.status !== 'no_packaging' && d.status !== 'canceled');
    } else if (workTab === 'needs_check') {
      list = list.filter(
        (d) =>
          d.status === 'received' ||
          (!d.orderNo && d.status !== 'completed' && d.status !== 'no_packaging' && d.status !== 'canceled'),
      );
    } else if (workTab === 'imminent') {
      list = list.filter((d) => {
        const isDone = d.status === 'completed' || d.status === 'no_packaging';
        const isCanceled = d.status === 'canceled';
        const info = scheduleMap.get(d.code);
        return !isDone && !isCanceled && info && (info.urgency === 'emergency' || info.urgency === 'imminent');
      });
    }

    // 2. 단일 검색어 필터
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((d) => {
        if (d.code.toLowerCase().includes(q)) return true;
        if (d.orderNo && d.orderNo.toLowerCase().includes(q)) return true;
        if (d.productName.toLowerCase().includes(q)) return true;
        if (d.memo && d.memo.toLowerCase().includes(q)) return true;
        const texts = getMessageDetails(d);
        if (texts.recipient.toLowerCase().includes(q)) return true;
        if (texts.sender.toLowerCase().includes(q)) return true;
        if (texts.stickerTexts.some((t) => t.toLowerCase().includes(q))) return true;
        if (texts.cardTexts.some((t) => t.toLowerCase().includes(q))) return true;
        return false;
      });
    }

    // 3. 정렬 (기준일 임박순 기본)
    if (sortBy === 'schedule') {
      list.sort((a, b) => {
        const scoreA = scheduleMap.get(a.code)?.sortScore ?? 999999;
        const scoreB = scheduleMap.get(b.code)?.sortScore ?? 999999;
        if (scoreA !== scoreB) return scoreA - scoreB;
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
    } else if (sortBy === 'newest') {
      list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    } else if (sortBy === 'oldest') {
      list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    }

    return list;
  }, [designs, workTab, searchQuery, sortBy, scheduleMap]);

  const toggleSelect = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const toggleExpand = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const toggleAllExpand = () => {
    if (expanded.size > 0) setExpanded(new Set());
    else setExpanded(new Set(displayDesigns.map((d) => d.code)));
  };

  const printableSelected = displayDesigns.filter(
    (d) => selected.has(d.code) && d.printCode && (d.sticker || d.card) && d.status !== 'canceled' && d.status !== 'pending',
  );
  const allSelected = displayDesigns.length > 0 && displayDesigns.every((d) => selected.has(d.code));

  // 키보드 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const d = displayDesigns[cursor];
      const go = (i: number) => {
        e.preventDefault();
        const next = Math.max(0, Math.min(displayDesigns.length - 1, i));
        setCursor(next);
        document.querySelector(`[data-row="${displayDesigns[next]?.code}"]`)?.scrollIntoView({ block: 'nearest' });
      };
      if (e.key === 'j') go(cursor + 1);
      else if (e.key === 'k') go(cursor - 1);
      else if (e.key === '?') setHelp((h) => !h);
      else if (e.key === 'Escape') {
        setSelected(new Set());
        setHelp(false);
      } else if (!d) return;
      else if (e.key === 'x') toggleSelect(d.code);
      else if (e.key === 'Enter') {
        e.preventDefault();
        toggleExpand(d.code);
      } else if ((e.key === 'p' || e.key === 't') && d.printCode && d.sticker && d.status !== 'canceled' && d.status !== 'pending') {
        location.href = sheetUrl(d.code, options, e.key === 't');
      } else if (e.key === 's') {
        e.preventDefault();
        document.querySelector<HTMLSelectElement>(`[data-row="${d.code}"] select`)?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [displayDesigns, cursor, options]);

  // 일괄 상태 변경
  const changeBatchStatus = () =>
    startBatch(async () => {
      setBatchMessage(null);
      const res = await updateDesignsStatusAction([...selected], batchStatus);
      if (!res.ok) return setBatchMessage(res.message);
      setBatchMessage(
        `${res.updated.length}건을 ‘${STATUS_LABEL[batchStatus]}’(으)로 일괄 변경했습니다.${
          res.missing.length ? ` (제외 건수: ${res.missing.join(', ')})` : ''
        }`,
      );
      setSelected(new Set());
      router.refresh();
    });

  // 인쇄 파일 ZIP 일괄 다운로드
  const downloadZip = async () => {
    const list = printableSelected;
    if (list.length === 0) return;
    try {
      const { zipSync } = await import('fflate');
      const files: Record<string, [Uint8Array, { level: 0 }]> = {};
      for (let i = 0; i < list.length; i++) {
        const { code, printCode } = list[i];
        setZipping(`${i + 1}/${list.length}`);
        const targets: [string, string][] = [];
        if (list[i].sticker) {
          targets.push([`${code}.png`, fileUrl(printCode!)]);
          targets.push([`${code}-${options.paper}.pdf`, sheetUrl(code, options)]);
        }
        if (list[i].card) {
          targets.push([`${code}-card.png`, `${fileUrl(printCode!)}?item=card`]);
          targets.push([`${code}-card-${options.paper}.pdf`, `${sheetUrl(code, options)}&item=card`]);
        }
        for (const [name, url] of targets) {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${code}: ${await res.text()}`);
          files[name] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
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
      {/* 1. 간결한 3대 핵심 요약 바 (Dashboard Summary) */}
      <div className="board-kpi-summary">
        <button
          type="button"
          className={`summary-pill ${workTab === 'active' ? 'active' : ''}`}
          onClick={() => setWorkTab('active')}
        >
          <span className="summary-title">오늘 처리할 작업</span>
          <b className="summary-val">{counts.activeCount}건</b>
          <span className="summary-hint">미완료 제작 건</span>
        </button>

        <button
          type="button"
          className={`summary-pill warning ${workTab === 'imminent' ? 'active' : ''}`}
          onClick={() => setWorkTab('imminent')}
        >
          <span className="summary-title">⏰ 일정 임박</span>
          <b className="summary-val warning">{counts.imminentCount}건</b>
          <span className="summary-hint">D-3 이내 및 경과</span>
        </button>

        <button
          type="button"
          className={`summary-pill danger ${workTab === 'needs_check' ? 'active' : ''}`}
          onClick={() => setWorkTab('needs_check')}
        >
          <span className="summary-title">⚠️ 확인 필요</span>
          <b className="summary-val danger">{counts.needsCheckCount}건</b>
          <span className="summary-hint">미연결 / 검수 대기</span>
        </button>
      </div>

      {/* 2. 작업 탭 & 통합 검색창 & 액션 */}
      <div className="panel" style={{ padding: '12px 16px', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          {/* 간결한 4개 작업 탭 */}
          <div className="board-tabs" role="tablist">
            <button
              type="button"
              className={`board-tab ${workTab === 'active' ? 'active' : ''}`}
              onClick={() => setWorkTab('active')}
            >
              오늘 할 일 (미완료)
            </button>
            <button
              type="button"
              className={`board-tab ${workTab === 'needs_check' ? 'active' : ''}`}
              onClick={() => setWorkTab('needs_check')}
            >
              확인 필요 {counts.needsCheckCount > 0 && `(${counts.needsCheckCount})`}
            </button>
            <button
              type="button"
              className={`board-tab ${workTab === 'imminent' ? 'active' : ''}`}
              onClick={() => setWorkTab('imminent')}
            >
              일정 임박 {counts.imminentCount > 0 && `(${counts.imminentCount})`}
            </button>
            <button
              type="button"
              className={`board-tab ${workTab === 'all' ? 'active' : ''}`}
              onClick={() => setWorkTab('all')}
            >
              전체 목록
            </button>
          </div>

          {/* 우측 퀵 액션 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn small"
              style={{ background: '#2563eb', color: '#fff', fontWeight: 600 }}
              disabled={syncPending}
              onClick={() => {
                if (syncing.current) return;
                syncing.current = true;
                setSyncMessage(null);
                startSync(async () => {
                  try {
                    const res = await syncCafe24OrdersAction();
                    setSyncMessage(res.message);
                    router.refresh();
                  } catch {
                    setSyncMessage('동기화에 실패했습니다. 다시 시도해 주세요.');
                  } finally {
                    syncing.current = false;
                  }
                });
              }}
            >
              {syncPending ? '동기화 중...' : '🔄 카페24 동기화'}
            </button>

            <a className="btn ghost small" href={`/admin/packaging/export${exportQuery ? `?${exportQuery}` : ''}`}>
              CSV
            </a>

            <button type="button" className="btn ghost small" onClick={toggleAllExpand}>
              {expanded.size > 0 ? '모두 접기' : '모두 펼치기'}
            </button>
          </div>
        </div>

        {/* 단일 통합 검색 & 정렬 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="board-search-box">
            <span style={{ fontSize: 13, color: 'var(--muted)', userSelect: 'none' }}>🔍</span>
            <input
              type="text"
              className="board-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="주문번호, 디자인코드, 상품명, 고객문구 검색..."
            />
            {searchQuery && (
              <button type="button" className="board-search-clear" onClick={() => setSearchQuery('')} title="검색어 지우기">
                ✕
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <span className="small muted">정렬:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}
            >
              <option value="schedule">기준일 임박순 (기본)</option>
              <option value="newest">접수일 최신순</option>
              <option value="oldest">접수일 오래된순</option>
            </select>
          </div>
        </div>

        {syncMessage && (
          <div
            style={{
              padding: '6px 10px',
              background: '#eff6ff',
              color: '#1e40af',
              border: '1px solid #bfdbfe',
              borderRadius: 6,
              fontSize: 12.5,
            }}
          >
            {syncMessage}
          </div>
        )}
      </div>

      {help && (
        <div className="panel shortcut-help" role="dialog" aria-label="단축키">
          <b className="small">키보드 단축키</b>
          <dl>
            {SHORTCUTS.map(([k, v]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* 인쇄 옵션 바 */}
      <div className="panel print-bar" style={{ padding: '8px 16px' }}>
        <b className="small">인쇄 규격:</b>
        <div className="chips">
          {(['A4', 'A3'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className="chip"
              aria-pressed={options.paper === p}
              onClick={() => setOptions({ ...options, paper: p })}
            >
              {p}
            </button>
          ))}
        </div>
        <label className="small row" style={{ gap: 4 }}>
          <input type="checkbox" checked={options.fill} onChange={(e) => setOptions({ ...options, fill: e.target.checked })} />
          마지막 장 남는 칸도 채우기(여분)
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn ghost small" style={{ fontSize: 11.5 }} onClick={() => setHelp((h) => !h)}>
          단축키 (?)
        </button>
      </div>

      {/* 일괄 작업 바 */}
      {selected.size > 0 && (
        <div className="panel batch-bar" role="region" aria-label="선택한 접수 처리">
          <b className="small">선택 {selected.size}건</b>
          <select
            value={batchStatus}
            onChange={(e) => setBatchStatus(e.target.value as DesignStatus)}
            aria-label="바꿀 상태"
          >
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button type="button" className="btn small" disabled={batchPending} onClick={changeBatchStatus}>
            {batchPending ? '변경 중...' : '상태 일괄 변경'}
          </button>
          <button
            type="button"
            className="btn ghost small"
            disabled={printableSelected.length === 0 || zipping !== null}
            onClick={() => void downloadZip()}
          >
            {zipping ? `묶는 중 ${zipping}` : `인쇄 파일 묶어 받기 ${printableSelected.length}건 (PNG+PDF)`}
          </button>
          <button type="button" className="btn ghost small" style={{ border: 'none' }} onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
        </div>
      )}
      {batchMessage && (
        <p className="small" role="status" style={{ margin: 0, color: 'var(--pine)', fontWeight: 600 }}>
          {batchMessage}
        </p>
      )}

      {/* 3. 통합 작업판 메인 테이블 */}
      {displayDesigns.length === 0 ? (
        <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
          <p className="small muted" style={{ fontSize: 14, margin: 0 }}>
            {searchQuery
              ? '검색 결과와 일치하는 주문이 없습니다.'
              : '해당 탭에 표시할 주문이 없습니다.'}
          </p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data designs-table board-table">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    aria-label="보이는 접수 모두 선택"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(displayDesigns.map((d) => d.code)))
                    }
                  />
                </th>
                <th style={{ width: 140 }}>일정 · D-Day</th>
                <th style={{ width: 160 }}>주문번호</th>
                <th style={{ minWidth: 200 }}>디자인 코드 · 상품</th>
                <th style={{ width: 150 }}>포장 · 인쇄 규격</th>
                <th style={{ width: 220 }}>제작 상태 · 빠른 작업</th>
              </tr>
            </thead>
            <tbody>
              {displayDesigns.map((d, i) => (
                <BoardRow
                  key={d.code}
                  design={d}
                  scheduleInfo={scheduleMap.get(d.code)!}
                  eventNames={eventNames}
                  options={options}
                  now={now}
                  active={i === cursor}
                  selected={selected.has(d.code)}
                  expanded={expanded.has(d.code)}
                  onToggleSelect={() => toggleSelect(d.code)}
                  onToggleExpand={() => toggleExpand(d.code)}
                  onFocusRow={() => setCursor(i)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 작업판 전용 Scoped CSS */}
      <style>{`
        .board-kpi-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .summary-pill {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 12px 16px;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: var(--radius);
          text-align: left;
          cursor: pointer;
          transition: border-color 0.12s, box-shadow 0.12s;
        }
        .summary-pill:hover {
          border-color: var(--line-strong);
        }
        .summary-pill.active {
          border-color: #2563eb;
          box-shadow: 0 0 0 2px rgba(37,99,235,0.15);
          background: #f8faff;
        }
        .summary-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--muted);
        }
        .summary-val {
          font-family: var(--font-serif), serif;
          font-size: 24px;
          font-weight: 700;
          line-height: 1.2;
          color: var(--ink);
        }
        .summary-val.warning {
          color: #d97706;
        }
        .summary-val.danger {
          color: #dc2626;
        }
        .summary-hint {
          font-size: 11px;
          color: var(--muted);
        }

        .board-tabs {
          display: flex;
          gap: 4px;
        }
        .board-tab {
          padding: 6px 12px;
          border: 1px solid transparent;
          border-radius: 6px;
          background: transparent;
          font-size: 13px;
          font-weight: 500;
          color: var(--ink-soft);
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.12s, color 0.12s;
        }
        .board-tab:hover {
          background: #f3f4f6;
          color: var(--ink);
        }
        .board-tab.active {
          background: #e5e7eb;
          color: var(--ink);
          font-weight: 700;
        }

        .board-search-box {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
          min-width: 240px;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 5px 10px;
        }
        .board-search-input {
          border: none !important;
          outline: none;
          width: 100%;
          font-size: 13px;
          background: transparent;
          padding: 0 !important;
        }
        .board-search-clear {
          border: none;
          background: transparent;
          cursor: pointer;
          color: var(--muted);
          font-size: 11px;
          padding: 2px 4px;
        }

        /* 테이블 행 스타일 */
        .board-table tr.board-core-row {
          cursor: pointer;
          transition: background 0.12s;
        }
        .board-table tr.board-core-row:hover td {
          background: #f9fafb;
        }
        .board-table tr.board-core-row.expanded td {
          background: #f8fafc;
          border-bottom-color: transparent;
        }

        .schedule-badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: -0.01em;
          white-space: nowrap;
        }
        .schedule-badge.red {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fca5a5;
        }
        .schedule-badge.amber {
          background: #fffbeb;
          color: #b45309;
          border: 1px solid #fcd34d;
        }
        .schedule-badge.gray {
          background: #f3f4f6;
          color: #4b5563;
          border: 1px solid #e5e7eb;
        }
        .schedule-badge.green {
          background: #f0fdf4;
          color: #15803d;
          border: 1px solid #86efac;
        }

        .order-badge-unlinked {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          background: #fff7ed;
          color: #c2410c;
          border: 1px solid #ffedd5;
          font-size: 11.5px;
          font-weight: 600;
        }

        /* 상세 아코디언 패널 */
        .board-detail-row td {
          padding: 0 !important;
          background: #f8fafc !important;
        }
        .board-detail-box {
          display: grid;
          grid-template-columns: 1.1fr 1.1fr;
          gap: 16px;
          padding: 14px 18px;
          border-top: 1px dashed #cbd5e1;
          border-bottom: 2px solid #94a3b8;
          background: #f8fafc;
        }
        .detail-col {
          display: grid;
          gap: 8px;
          align-content: start;
        }
        .detail-col-title {
          font-size: 12px;
          font-weight: 700;
          color: #475569;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 4px;
        }
        .customer-msg-box {
          background: #fff;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 8px 10px;
          font-family: ui-monospace, Consolas, monospace;
          font-size: 12.5px;
          line-height: 1.5;
          color: #0f172a;
          white-space: pre-wrap;
          word-break: break-all;
          max-height: 180px;
          overflow-y: auto;
        }

        @media (max-width: 768px) {
          .board-kpi-summary {
            grid-template-columns: 1fr;
            gap: 6px;
          }
          .board-detail-box {
            grid-template-columns: 1fr;
            gap: 12px;
            padding: 10px 12px;
          }
        }
      `}</style>
    </div>
  );
}

// 각 주문·디자인 행 컴포넌트
function BoardRow({
  design: d,
  scheduleInfo: info,
  eventNames,
  options,
  now,
  active,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onFocusRow,
}: {
  design: Design;
  scheduleInfo: ScheduleInfo;
  eventNames: Record<string, string>;
  options: PrintOptions;
  now: number;
  active: boolean;
  selected: boolean;
  expanded: boolean;
  onToggleSelect(): void;
  onToggleExpand(): void;
  onFocusRow(): void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // 인라인 수정 상태 (각 필드 독립 분리 저장 지원)
  const [status, setStatus] = useState<DesignStatus>(d.status);
  const [orderNoInput, setOrderNoInput] = useState(d.orderNo ?? '');
  const [memoInput, setMemoInput] = useState(d.memo ?? '');
  const [eventDateInput, setEventDateInput] = useState(d.eventDate ?? '');
  const [desiredDeliveryDateInput, setDesiredDeliveryDateInput] = useState(d.desiredDeliveryDate ?? '');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setStatus(d.status);
    setOrderNoInput(d.orderNo ?? '');
    setMemoInput(d.memo ?? '');
    setEventDateInput(d.eventDate ?? '');
    setDesiredDeliveryDateInput(d.desiredDeliveryDate ?? '');
  }, [d.status, d.orderNo, d.memo, d.eventDate, d.desiredDeliveryDate]);

  const hasSticker = Boolean(d.printCode && d.sticker);
  const hasCard = Boolean(d.printCode && d.card);
  const printable = hasSticker || hasCard;
  const isCanceled = d.status === 'canceled';
  const isPending = d.status === 'pending';
  const stickerSheets = d.sticker ? sheetsNeeded(sheetLayout(d.sticker, options.paper), d.quantity) : 0;
  const cardSheets = d.card ? sheetsNeeded(sheetLayout(d.card, options.paper), d.quantity) : 0;

  // 관리자 단건 상세(고객 작성 문구) 온디맨드 로딩 상태
  const [detailDesign, setDetailDesign] = useState<Design | null>(() => (d.draft || d.cardDraft ? d : null));
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (expanded && !detailDesign && !loadingDetail) {
      let active = true;
      setLoadingDetail(true);
      void getDesignDetailAction(d.code).then((res) => {
        if (active) {
          setLoadingDetail(false);
          if (res.ok) setDetailDesign(res.design);
        }
      });
      return () => {
        active = false;
      };
    }
  }, [expanded, d.code, detailDesign, loadingDetail]);

  const activeDesign = detailDesign ?? d;
  const msgDetails = useMemo(() => getMessageDetails(activeDesign), [activeDesign]);

  // 상태 변경 (오직 status만 업데이트하여 memo, orderNo, 일정 유실 차단)
  const handleStatusChange = (nextStatus: DesignStatus) =>
    start(async () => {
      setMessage(null);
      const res = await updateDesignAction(d.code, { status: nextStatus });
      if (res.ok) {
        setStatus(nextStatus);
        setMessage(`‘${STATUS_LABEL[nextStatus]}’(으)로 변경 완료`);
        router.refresh();
      } else {
        setMessage(res.message);
      }
    });

  // 주문번호 연결 (카페24 결제·상품·수량·중복 5대 불변식 실시간 검증 후 연결)
  const handleSaveOrderNo = () =>
    start(async () => {
      setMessage(null);
      const target = orderNoInput.trim();
      if (!target) {
        const res = await updateDesignAction(d.code, { orderNo: null });
        if (res.ok) {
          setMessage('주문번호 연결을 해제했습니다.');
          router.refresh();
        } else {
          setMessage(res.message);
        }
        return;
      }
      const res = await linkDesignToOrderAction(d.code, target);
      if (res.ok) {
        setMessage('카페24 주문 검증 완료: 정상 연결되었습니다.');
        router.refresh();
      } else {
        setMessage(res.message);
      }
    });

  // 일정 저장 (오직 일정 필드만 저장)
  const handleSaveSchedule = () =>
    start(async () => {
      setMessage(null);
      const res = await updateDesignAction(d.code, {
        eventDate: eventDateInput || null,
        desiredDeliveryDate: desiredDeliveryDateInput || null,
      });
      if (res.ok) {
        setMessage('일정을 저장했습니다.');
        router.refresh();
      } else {
        setMessage(res.message);
      }
    });

  // 메모 저장 (오직 메모만 저장)
  const handleSaveMemo = () =>
    start(async () => {
      setMessage(null);
      const res = await updateDesignAction(d.code, { memo: memoInput });
      if (res.ok) {
        setMessage('메모를 저장했습니다.');
        router.refresh();
      } else {
        setMessage(res.message);
      }
    });

  // 포장·인쇄 없음 확정 (스티커/카드가 없는 경우만 허용)
  const handleDismissPackaging = () =>
    start(async () => {
      setMessage(null);
      const res = await dismissPackagingAction(d.code);
      if (res.ok) {
        setStatus('no_packaging');
        setMessage('‘포장 없음’으로 확정했습니다.');
        router.refresh();
      } else {
        setMessage(res.message);
      }
    });

  return (
    <>
      {/* 1. 접힌 요약 행 (Core Row) */}
      <tr
        data-row={d.code}
        className={`board-core-row ${active ? 'cursor' : ''} ${expanded ? 'expanded' : ''}`}
        style={{ opacity: isCanceled ? 0.55 : 1 }}
        onFocusCapture={onFocusRow}
      >
        <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`${d.code} 선택`} />
        </td>

        {/* 일정 배지 & 요약 */}
        <td onClick={onToggleExpand}>
          <div style={{ display: 'grid', gap: 3 }}>
            <div>
              <span className={`schedule-badge ${info.badgeTone}`}>
                {info.urgency === 'emergency' ? '🔴 ' : info.urgency === 'imminent' ? '🟠 ' : ''}
                {info.badgeText}
              </span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
              {info.displayDateText}
            </div>
            {info.hasConflict && (
              <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>⚠️ {info.conflictMessage}</div>
            )}
          </div>
        </td>

        {/* 주문번호 (사실 기반 표시) */}
        <td onClick={onToggleExpand}>
          <div style={{ display: 'grid', gap: 3 }}>
            {d.orderNo ? (
              <div className="mono font-semibold" style={{ fontSize: 12.5, color: '#0f172a' }}>
                {d.orderNo}
              </div>
            ) : (
              <div>
                <span className="order-badge-unlinked">⚠️ 미연결</span>
              </div>
            )}
            <div className="small muted">
              {isPending
                ? '결제 대기'
                : isCanceled
                ? '취소된 주문'
                : `디자인 생성: ${kstLabel(d.createdAt)}`}
            </div>
          </div>
        </td>

        {/* 디자인 코드 & 상품 정보 */}
        <td onClick={onToggleExpand}>
          <div style={{ display: 'grid', gap: 2 }}>
            <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
              {d.code}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{d.productName}</div>
            <div className="small muted">
              #{d.productNo} · <b>{d.quantity}개</b>
              {d.event ? ` · ${eventNames[d.event] ?? d.event}` : ''}
            </div>
          </div>
        </td>

        {/* 포장 스타일 & 인쇄 규격 */}
        <td onClick={onToggleExpand}>
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.styleName}</div>
            <div className="small muted">
              {(() => {
                const items: string[] = [];
                if (d.sticker) items.push(`${d.sticker.shape === 'circle' ? '원형' : '사각'} ${d.sticker.sizeCm}cm`);
                if (d.card) items.push(`카드 ${d.card.sizeMm}mm`);
                return items.length > 0 ? items.join(' + ') : '인쇄물 없음';
              })()}
            </div>
          </div>
        </td>

        {/* 내부 제작 상태 & 액션 */}
        <td onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'grid', gap: 5 }}>
            <div className="row" style={{ gap: 6 }}>
              <select
                value={status}
                onChange={(e) => handleStatusChange(e.target.value as DesignStatus)}
                disabled={pending || isCanceled}
                aria-label="상태"
                style={{
                  fontSize: 12,
                  padding: '3px 6px',
                  fontWeight: 600,
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                }}
              >
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="btn ghost small"
                onClick={onToggleExpand}
                style={{ padding: '2px 6px', fontSize: 11.5 }}
              >
                {expanded ? '접기 ▲' : '상세 ▼'}
              </button>
            </div>

            {/* 빠른 인쇄 버튼: 취소나 결제대기 건은 안전하게 차단 */}
            {printable && (
              <div>
                {isCanceled ? (
                  <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
                    ⚠️ 취소 주문 (인쇄 금지)
                  </span>
                ) : isPending ? (
                  <span style={{ fontSize: 11, color: '#b45309' }}>
                    결제 확인 후 인쇄 가능
                  </span>
                ) : (
                  <a
                    className="btn small"
                    href={sheetUrl(d.code, options)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ padding: '2px 8px', fontSize: 11.5, background: 'var(--pine)', color: '#fff' }}
                  >
                    🖨️ PDF {options.paper} ({Math.max(stickerSheets, cardSheets)}장)
                  </a>
                )}
              </div>
            )}

            {message && <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{message}</div>}
          </div>
        </td>
      </tr>

      {/* 2. 펼침 상세 아코디언 (Detail Accordion) */}
      {expanded && (
        <tr className="board-detail-row">
          <td colSpan={6}>
            <div className="board-detail-box">
              {/* 좌측: 고객 인쇄 문구 검수 & 시안 미리보기 */}
              <div className="detail-col">
                <div className="detail-col-title">고객 인쇄 문구 검수 & 시안</div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {hasSticker && (
                    <div>
                      <a href={`${fileUrl(d.printCode!)}?inline=1`} target="_blank" rel="noreferrer" title="스티커 크게 보기">
                        <img
                          src={`${fileUrl(d.printCode!)}?thumb=1`}
                          alt="스티커"
                          width={64}
                          height={64}
                          style={{ objectFit: 'contain', background: '#eee', borderRadius: 4, border: '1px solid #cbd5e1' }}
                        />
                      </a>
                    </div>
                  )}

                  {hasCard && (
                    <div>
                      <a href={`${fileUrl(d.printCode!)}?inline=1&item=card`} target="_blank" rel="noreferrer" title="카드 크게 보기">
                        <img
                          src={`${fileUrl(d.printCode!)}?thumb=1&item=card`}
                          alt="카드"
                          width={64}
                          height={44}
                          style={{ objectFit: 'contain', background: '#eee', borderRadius: 4, border: '1px solid #cbd5e1' }}
                        />
                      </a>
                    </div>
                  )}

                  {!hasSticker && !hasCard && <div className="small muted">인쇄물 없는 일반 포장입니다.</div>}
                </div>

                {/* 고객 입력 문구 원문 박스 */}
                <div className="customer-msg-box">
                  {loadingDetail ? (
                    <div className="small muted">고객 작성 문구 불러오는 중...</div>
                  ) : (
                    <>
                      {msgDetails.recipient && <div><b>[받는 분]</b> {msgDetails.recipient}</div>}
                      {msgDetails.stickerTexts.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <b>[스티커 문구]</b>
                          <br />
                          {msgDetails.stickerTexts.join('\n')}
                        </div>
                      )}
                      {msgDetails.cardTexts.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <b>[카드 문구]</b>
                          <br />
                          {msgDetails.cardTexts.join('\n')}
                        </div>
                      )}
                      {msgDetails.sender && <div style={{ marginTop: 4 }}><b>[보내는 분]</b> {msgDetails.sender}</div>}
                      {msgDetails.printDate && <div style={{ marginTop: 4 }}><b>[인쇄 일자]</b> {msgDetails.printDate}</div>}
                      {!msgDetails.recipient &&
                        !msgDetails.sender &&
                        msgDetails.stickerTexts.length === 0 &&
                        msgDetails.cardTexts.length === 0 && <span className="muted">작성된 문구가 없습니다.</span>}
                    </>
                  )}
                </div>

                {/* 검수 완료 원클릭 버튼 */}
                {d.status === 'received' && (
                  <button
                    type="button"
                    className="btn small"
                    disabled={pending}
                    onClick={() => handleStatusChange('order_confirmed')}
                    style={{ background: '#16a34a', color: '#fff', fontWeight: 600 }}
                  >
                    ✓ 문구 검수 완료 → [인쇄 대기]로 변경
                  </button>
                )}
              </div>

              {/* 우측: 일정 관리 & 주문번호 기록 & 인쇄 파일 & 메모 */}
              <div className="detail-col">
                <div className="detail-col-title">일정 확인 및 작업 관리</div>

                {/* 일정 인라인 편집 (희망 수령일 / 행사일) */}
                <div style={{ background: '#fff', padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', display: 'grid', gap: 6 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <label style={{ flex: 1, fontSize: 11.5 }}>
                      <span className="muted">희망 수령일 (고객 입력):</span>
                      <input
                        type="date"
                        value={desiredDeliveryDateInput}
                        onChange={(e) => setDesiredDeliveryDateInput(e.target.value)}
                        style={{ width: '100%', marginTop: 2 }}
                      />
                    </label>
                    <label style={{ flex: 1, fontSize: 11.5 }}>
                      <span className="muted">행사일 (고객 입력):</span>
                      <input
                        type="date"
                        value={eventDateInput}
                        onChange={(e) => setEventDateInput(e.target.value)}
                        style={{ width: '100%', marginTop: 2 }}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn ghost small" disabled={pending} onClick={handleSaveSchedule}>
                      일정 저장
                    </button>
                  </div>
                </div>

                {/* 주문번호 연결 (카페24 결제·상품·수량 5대 불변식 검증 후 연결) */}
                <div style={{ background: '#fff', padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>카페24 주문번호 연결 (결제·상품·수량 실시간 검증):</span>
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      type="text"
                      value={orderNoInput}
                      onChange={(e) => setOrderNoInput(e.target.value)}
                      placeholder="예: 20261117-0000123"
                      style={{ flex: 1, fontSize: 12 }}
                    />
                    <button type="button" className="btn small" disabled={pending} onClick={handleSaveOrderNo} style={{ fontWeight: 600 }}>
                      검증 후 연결
                    </button>
                  </div>
                  {!d.orderNo && !hasSticker && !hasCard && !d.hasPrintFile && !isPending && !isCanceled && (
                    <div style={{ marginTop: 2 }}>
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={pending}
                        onClick={handleDismissPackaging}
                        style={{ width: '100%', fontSize: 11.5 }}
                      >
                        포장·인쇄물 없음으로 확정
                      </button>
                    </div>
                  )}
                </div>

                {/* 인쇄 파일 링크 (취소/대기 건은 차단) */}
                {printable && !isCanceled && !isPending && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {hasSticker && (
                      <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                        <span className="small muted">스티커:</span>
                        <a className="btn small" href={sheetUrl(d.code, options)} target="_blank" rel="noreferrer">
                          PDF ({options.paper})
                        </a>
                        <a className="btn ghost small" href={sheetUrl(d.code, options, true)} target="_blank" rel="noreferrer">
                          시험1장
                        </a>
                        <a className="btn ghost small" href={fileUrl(d.printCode!)} target="_blank" rel="noreferrer">
                          PNG
                        </a>
                      </div>
                    )}
                    {hasCard && (
                      <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                        <span className="small muted">카드:</span>
                        <a className="btn small" href={`${sheetUrl(d.code, options)}&item=card`} target="_blank" rel="noreferrer">
                          PDF ({options.paper})
                        </a>
                        <a className="btn ghost small" href={`${sheetUrl(d.code, options, true)}&item=card`} target="_blank" rel="noreferrer">
                          시험1장
                        </a>
                        <a className="btn ghost small" href={`${fileUrl(d.printCode!)}?item=card`} target="_blank" rel="noreferrer">
                          PNG
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* 관리자 메모 인라인 입력 */}
                <div style={{ display: 'grid', gap: 2 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>관리자 메모:</span>
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      type="text"
                      value={memoInput}
                      onChange={(e) => setMemoInput(e.target.value)}
                      placeholder="특이사항 메모 입력"
                      style={{ flex: 1, fontSize: 12 }}
                    />
                    <button type="button" className="btn small" disabled={pending} onClick={handleSaveMemo}>
                      메모 저장
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
