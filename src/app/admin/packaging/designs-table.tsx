'use client';

// 주문·포장 디자인 통합 작업판
// 1) 상단 핵심 요약 카드 4종: 확인 필요, 일정 임박, 인쇄 대기, 포장 준비 중
// 2) 행사일·희망 수령일 기준 일정 관리 및 D-day/긴급도 우선순위 정렬
// 3) 단일 통합 검색(주문번호, 디자인코드, 상품명, 문구) 및 원클릭 상태 전환
// 4) 접힘 요약 행 + 펼침 상세 아코디언(문구 검수, 일정 수정, 주문 연결, 빠른 인쇄)
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { isTyping, saveBlob } from '@/lib/device.ts';
import { kstLabel } from '@/lib/kst.ts';
import { MAX_SHEETS, sheetLayout, sheetsNeeded, type Paper } from '@/packaging/sheet.ts';
import { STATUS_LABEL, designStatusLabel, filterQuery, isLate, type DesignFilter } from '@/packaging/design-filter.ts';
import type { Design, DesignStatus, TextLayer } from '@/packaging/types.ts';
import { calculateScheduleStatus, type ScheduleInfo } from '@/packaging/schedule.ts';
import { fillPlaceholders } from '@/packaging/rules.ts';
import {
  updateDesignAction,
  updateDesignsStatusAction,
  syncCafe24OrdersAction,
  linkDesignToOrderAction,
  dismissPackagingAction,
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

export type WorkTab = 'active' | 'needs_check' | 'imminent' | 'order_confirmed' | 'printed' | 'done' | 'canceled' | 'all';
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

  // 작업판 탭 및 필터 상태
  const [workTab, setWorkTab] = useState<WorkTab>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyImminent, setOnlyImminent] = useState(false);
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('schedule');

  // 일괄 작업 및 동기화 상태
  const [batchStatus, setBatchStatus] = useState<DesignStatus>('order_confirmed');
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchPending, startBatch] = useTransition();
  const [syncPending, startSync] = useTransition();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const syncing = useRef(false);

  // 카페24 주기적 백그라운드 동기화 (30초)
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
        if (active) setSyncMessage('자동 동기화에 실패했습니다. 수동 동기화 버튼으로 다시 시도해 주세요.');
      } finally {
        syncing.current = false;
        if (active) setAutoSyncing(false);
      }
    };
    void sync();
    const timer = setInterval(() => void sync(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [router]);

  // 각 디자인별 KST 일정 산출 맵
  const scheduleMap = useMemo(() => {
    const map = new Map<string, ScheduleInfo>();
    for (const d of designs) {
      map.set(d.code, calculateScheduleStatus(d, now));
    }
    return map;
  }, [designs, now]);

  // 상단 KPI 집계 (오늘 처리해야 할 주문 한눈에 파악)
  const counts = useMemo(() => {
    let needsCheck = 0;
    let imminent = 0;
    let orderConfirmed = 0;
    let printed = 0;
    let active = 0;
    let done = 0;
    let canceled = 0;

    for (const d of designs) {
      const isDone = d.status === 'completed' || d.status === 'no_packaging';
      const isCanceled = d.status === 'canceled';
      const info = scheduleMap.get(d.code);

      if (isDone) done++;
      else if (isCanceled) canceled++;
      else active++;

      // 확인 필요: 검수 대기이거나, 미완료인데 주문번호가 연결되지 않은 경우
      if (d.status === 'received' || (!d.orderNo && d.status !== 'pending' && !isDone && !isCanceled)) {
        needsCheck++;
      }

      // 일정 임박: 미완료 건 중 긴급 또는 임박 (D-3 이내 or 경과 or 날짜충돌)
      if (!isDone && !isCanceled && info && (info.urgency === 'emergency' || info.urgency === 'imminent')) {
        imminent++;
      }

      if (d.status === 'order_confirmed') orderConfirmed++;
      if (d.status === 'printed') printed++;
    }

    return { needsCheck, imminent, orderConfirmed, printed, active, done, canceled };
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
          (!d.orderNo && d.status !== 'pending' && d.status !== 'completed' && d.status !== 'no_packaging' && d.status !== 'canceled'),
      );
    } else if (workTab === 'imminent') {
      list = list.filter((d) => {
        const isDone = d.status === 'completed' || d.status === 'no_packaging';
        const isCanceled = d.status === 'canceled';
        const info = scheduleMap.get(d.code);
        return !isDone && !isCanceled && info && (info.urgency === 'emergency' || info.urgency === 'imminent');
      });
    } else if (workTab === 'order_confirmed') {
      list = list.filter((d) => d.status === 'order_confirmed');
    } else if (workTab === 'printed') {
      list = list.filter((d) => d.status === 'printed');
    } else if (workTab === 'done') {
      list = list.filter((d) => d.status === 'completed' || d.status === 'no_packaging');
    } else if (workTab === 'canceled') {
      list = list.filter((d) => d.status === 'canceled');
    }

    // 2. 빠른 토글 필터
    if (onlyImminent) {
      list = list.filter((d) => {
        const isDone = d.status === 'completed' || d.status === 'no_packaging';
        const isCanceled = d.status === 'canceled';
        const info = scheduleMap.get(d.code);
        return !isDone && !isCanceled && info && (info.urgency === 'emergency' || info.urgency === 'imminent');
      });
    }

    if (onlyUnlinked) {
      list = list.filter((d) => !d.orderNo && d.status !== 'no_packaging' && d.status !== 'canceled');
    }

    // 3. 단일 검색어 필터
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

    // 4. 정렬
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
  }, [designs, workTab, onlyImminent, onlyUnlinked, searchQuery, sortBy, scheduleMap]);

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
    (d) => selected.has(d.code) && d.printCode && (d.sticker || d.card) && d.status !== 'canceled',
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
      } else if ((e.key === 'p' || e.key === 't') && d.printCode && d.sticker && d.status !== 'canceled') {
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
          res.missing.length ? ` (변경 실패: ${res.missing.join(', ')})` : ''
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
      {/* 1. 상단 핵심 요약 카드 4종 (오늘 할 일 KPI) */}
      <div className="board-kpi-grid">
        <button
          type="button"
          className={`board-kpi-card ${workTab === 'needs_check' ? 'active' : ''}`}
          onClick={() => setWorkTab(workTab === 'needs_check' ? 'active' : 'needs_check')}
        >
          <div className="kpi-top">
            <span className="kpi-title">확인 필요</span>
            <span className="kpi-icon">⚠️</span>
          </div>
          <div className="kpi-num" style={{ color: counts.needsCheck > 0 ? '#dc2626' : 'var(--ink)' }}>
            {counts.needsCheck}건
          </div>
          <div className="kpi-desc">검수 대기 또는 주문번호 미연결</div>
        </button>

        <button
          type="button"
          className={`board-kpi-card ${workTab === 'imminent' ? 'active' : ''}`}
          onClick={() => setWorkTab(workTab === 'imminent' ? 'active' : 'imminent')}
        >
          <div className="kpi-top">
            <span className="kpi-title">일정 임박</span>
            <span className="kpi-icon">⏰</span>
          </div>
          <div className="kpi-num" style={{ color: counts.imminent > 0 ? '#ea580c' : 'var(--ink)' }}>
            {counts.imminent}건
          </div>
          <div className="kpi-desc">D-3 이내 및 기준일 경과</div>
        </button>

        <button
          type="button"
          className={`board-kpi-card ${workTab === 'order_confirmed' ? 'active' : ''}`}
          onClick={() => setWorkTab(workTab === 'order_confirmed' ? 'active' : 'order_confirmed')}
        >
          <div className="kpi-top">
            <span className="kpi-title">인쇄 대기</span>
            <span className="kpi-icon">🖨️</span>
          </div>
          <div className="kpi-num">{counts.orderConfirmed}건</div>
          <div className="kpi-desc">검수 완료 · 출력 진행 대기</div>
        </button>

        <button
          type="button"
          className={`board-kpi-card ${workTab === 'printed' ? 'active' : ''}`}
          onClick={() => setWorkTab(workTab === 'printed' ? 'active' : 'printed')}
        >
          <div className="kpi-top">
            <span className="kpi-title">포장 준비 중</span>
            <span className="kpi-icon">🎁</span>
          </div>
          <div className="kpi-num">{counts.printed}건</div>
          <div className="kpi-desc">인쇄 완료 · 상품 포장 진행</div>
        </button>
      </div>

      {/* 2. 네비게이션 & 검색 & 정렬 제어 바 */}
      <div className="panel" style={{ padding: '14px 16px', display: 'grid', gap: 12 }}>
        {/* 상태 탭 */}
        <div className="board-tab-bar" role="tablist">
          <button
            type="button"
            className={`board-tab-btn ${workTab === 'active' ? 'active' : ''}`}
            onClick={() => setWorkTab('active')}
          >
            미완료 전체 <span className="tab-pill">{counts.active}</span>
          </button>
          <button
            type="button"
            className={`board-tab-btn ${workTab === 'needs_check' ? 'active danger' : ''}`}
            onClick={() => setWorkTab('needs_check')}
          >
            확인 필요 <span className="tab-pill danger">{counts.needsCheck}</span>
          </button>
          <button
            type="button"
            className={`board-tab-btn ${workTab === 'imminent' ? 'active warning' : ''}`}
            onClick={() => setWorkTab('imminent')}
          >
            일정 임박 <span className="tab-pill warning">{counts.imminent}</span>
          </button>
          <button
            type="button"
            className={`board-tab-btn ${workTab === 'order_confirmed' ? 'active' : ''}`}
            onClick={() => setWorkTab('order_confirmed')}
          >
            인쇄 대기 <span className="tab-pill">{counts.orderConfirmed}</span>
          </button>
          <button
            type="button"
            className={`board-tab-btn ${workTab === 'printed' ? 'active' : ''}`}
            onClick={() => setWorkTab('printed')}
          >
            포장 준비 중 <span className="tab-pill">{counts.printed}</span>
          </button>
          <button
            type="button"
            className={`board-tab-btn ${workTab === 'done' ? 'active' : ''}`}
            onClick={() => setWorkTab('done')}
          >
            작업 완료 <span className="tab-pill">{counts.done}</span>
          </button>
          <button
            type="button"
            className={`board-tab-btn ${workTab === 'canceled' ? 'active' : ''}`}
            onClick={() => setWorkTab('canceled')}
          >
            취소 <span className="tab-pill">{counts.canceled}</span>
          </button>
          <button
            type="button"
            className={`board-tab-btn ${workTab === 'all' ? 'active' : ''}`}
            onClick={() => setWorkTab('all')}
          >
            전체 내역 <span className="tab-pill">{designs.length}</span>
          </button>
        </div>

        {/* 통합 검색 & 빠른 필터 & 정렬 */}
        <div className="board-search-row">
          <div className="board-search-wrap">
            <span style={{ fontSize: 14, color: 'var(--muted)', userSelect: 'none' }}>🔍</span>
            <input
              type="text"
              className="board-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="주문번호, 디자인코드, 상품명, 인쇄문구 검색..."
            />
            {searchQuery && (
              <button type="button" className="board-search-clear" onClick={() => setSearchQuery('')} title="검색어 지우기">
                ✕
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <label className="filter-toggle-label">
              <input type="checkbox" checked={onlyImminent} onChange={(e) => setOnlyImminent(e.target.checked)} />
              <span>⏰ 일정 임박·경과만</span>
            </label>

            <label className="filter-toggle-label">
              <input type="checkbox" checked={onlyUnlinked} onChange={(e) => setOnlyUnlinked(e.target.checked)} />
              <span>🔗 주문 미연결만</span>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
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

            <button type="button" className="btn ghost small" onClick={toggleAllExpand}>
              {expanded.size > 0 ? '모두 접기 ▲' : '모두 펼치기 ▼'}
            </button>
          </div>
        </div>

        {/* 카페24 동기화 및 CSV/도움말 컨트롤 바 */}
        <div className="board-action-bar">
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
                } finally {
                  syncing.current = false;
                }
              });
            }}
          >
            {syncPending || autoSyncing ? '카페24 동기화 중...' : '🔄 카페24 주문 동기화'}
          </button>

          <a className="btn ghost small" href={`/admin/packaging/export${exportQuery ? `?${exportQuery}` : ''}`}>
            CSV 내려받기
          </a>

          <button type="button" className="btn ghost small" onClick={() => setHelp((h) => !h)}>
            단축키 안내 (?)
          </button>

          <span style={{ flex: 1 }} />
          <span className="small muted">
            총 {designs.length}건 중 현재 <b>{displayDesigns.length}건</b> 표시 중
          </span>
        </div>

        {syncMessage && (
          <div
            style={{
              padding: '8px 12px',
              background: '#eff6ff',
              color: '#1e40af',
              border: '1px solid #bfdbfe',
              borderRadius: 6,
              fontSize: 13,
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
      <div className="panel print-bar" style={{ padding: '10px 16px' }}>
        <b className="small">인쇄 용지:</b>
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
        <span className="small muted">
          ⚠️ 인쇄 시 '실제 크기(100%)' 설정 필수 · 우측 상단 QR 촬영 시 즉시 인쇄 완료로 전진
        </span>
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
          <p className="small muted" style={{ fontSize: 15, margin: 0 }}>
            {searchQuery || onlyImminent || onlyUnlinked
              ? '조건에 맞는 주문·디자인이 없습니다. 검색어나 필터를 변경해 보세요.'
              : '해당 탭에 표시할 주문·디자인이 없습니다.'}
          </p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data designs-table board-table">
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: 'center' }}>
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
                <th style={{ width: 170 }}>주문번호 · 카페24 상태</th>
                <th style={{ minWidth: 200 }}>디자인 코드 · 상품 정보</th>
                <th style={{ width: 160 }}>포장 스타일 · 규격</th>
                <th style={{ width: 220 }}>내부 제작 상태 · 액션</th>
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
        .board-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        .board-kpi-card {
          display: grid;
          gap: 4px;
          padding: 16px;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: var(--radius);
          text-align: left;
          cursor: pointer;
          transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
        }
        .board-kpi-card:hover {
          border-color: var(--line-strong);
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }
        .board-kpi-card.active {
          border-color: #2563eb;
          box-shadow: 0 0 0 2px rgba(37,99,235,0.2);
          background: #f8faff;
        }
        .kpi-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .kpi-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--muted);
        }
        .kpi-icon {
          font-size: 16px;
        }
        .kpi-num {
          font-family: var(--font-serif), serif;
          font-size: 28px;
          font-weight: 700;
          line-height: 1.2;
          color: var(--ink);
        }
        .kpi-desc {
          font-size: 11.5px;
          color: var(--muted);
        }

        .board-tab-bar {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding-bottom: 4px;
          border-bottom: 1px solid var(--line);
        }
        .board-tab-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          border: 1px solid transparent;
          border-radius: 6px;
          background: transparent;
          font-size: 13.5px;
          font-weight: 500;
          color: var(--ink-soft);
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.12s, color 0.12s;
        }
        .board-tab-btn:hover {
          background: #f3f4f6;
          color: var(--ink);
        }
        .board-tab-btn.active {
          background: #e5e7eb;
          color: var(--ink);
          font-weight: 700;
        }
        .board-tab-btn.active.danger {
          background: #fee2e2;
          color: #991b1b;
        }
        .board-tab-btn.active.warning {
          background: #fef3c7;
          color: #92400e;
        }

        .tab-pill {
          display: inline-block;
          padding: 1px 6px;
          border-radius: 999px;
          background: rgba(0,0,0,0.06);
          font-size: 11.5px;
          font-weight: 600;
        }
        .tab-pill.danger {
          background: #fca5a5;
          color: #7f1d1d;
        }
        .tab-pill.warning {
          background: #fde68a;
          color: #78350f;
        }

        .board-search-row {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .board-search-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
          min-width: 240px;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 6px 10px;
        }
        .board-search-input {
          border: none !important;
          outline: none;
          width: 100%;
          font-size: 13.5px;
          background: transparent;
          padding: 0 !important;
        }
        .board-search-clear {
          border: none;
          background: transparent;
          cursor: pointer;
          color: var(--muted);
          font-size: 12px;
          padding: 2px 4px;
        }
        .filter-toggle-label {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 13px;
          font-weight: 500;
          color: var(--ink-soft);
          cursor: pointer;
          user-select: none;
        }

        .board-action-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          padding-top: 4px;
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

        /* 뱃지 톤 */
        .schedule-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
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
        .order-badge-paid {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          background: #eff6ff;
          color: #1d4ed8;
          border: 1px solid #dbeafe;
          font-size: 11.5px;
          font-weight: 600;
        }
        .order-badge-pending {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          background: #fefce8;
          color: #a16207;
          border: 1px solid #fef08a;
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
          grid-template-columns: 1.2fr 1.1fr 1fr;
          gap: 16px;
          padding: 16px 20px;
          border-top: 1px dashed #cbd5e1;
          border-bottom: 2px solid #94a3b8;
          background: #f8fafc;
        }
        .detail-col {
          display: grid;
          gap: 10px;
          align-content: start;
        }
        .detail-col-title {
          font-size: 12.5px;
          font-weight: 700;
          color: #475569;
          letter-spacing: -0.01em;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 4px;
        }
        .customer-msg-box {
          background: #fff;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 10px 12px;
          font-family: ui-monospace, Consolas, monospace;
          font-size: 13px;
          line-height: 1.5;
          color: #0f172a;
          white-space: pre-wrap;
          word-break: break-all;
          max-height: 220px;
          overflow-y: auto;
        }

        /* 모바일 반응형 */
        @media (max-width: 768px) {
          .board-kpi-grid {
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
          .board-detail-box {
            grid-template-columns: 1fr;
            gap: 14px;
            padding: 12px 14px;
          }
          .board-search-row {
            flex-direction: column;
            align-items: stretch;
          }
          .board-search-wrap {
            min-width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

// 각 주문·디자인 행 컴포넌트 (접힘 요약 + 펼침 아코디언)
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

  // 인라인 수정 상태
  const [status, setStatus] = useState<DesignStatus>(d.status);
  const [orderNo, setOrderNo] = useState(d.orderNo ?? '');
  const [memo, setMemo] = useState(d.memo ?? '');
  const [eventDate, setEventDate] = useState(d.eventDate ?? '');
  const [desiredDeliveryDate, setDesiredDeliveryDate] = useState(d.desiredDeliveryDate ?? '');
  const [message, setMessage] = useState<string | null>(null);

  // 서버 동기화 반영
  useEffect(() => {
    setStatus(d.status);
    setOrderNo(d.orderNo ?? '');
    setMemo(d.memo ?? '');
    setEventDate(d.eventDate ?? '');
    setDesiredDeliveryDate(d.desiredDeliveryDate ?? '');
  }, [d.status, d.orderNo, d.memo, d.eventDate, d.desiredDeliveryDate]);

  const hasSticker = Boolean(d.printCode && d.sticker);
  const hasCard = Boolean(d.printCode && d.card);
  const printable = hasSticker || hasCard;
  const isCanceled = d.status === 'canceled';
  const stickerSheets = d.sticker ? sheetsNeeded(sheetLayout(d.sticker, options.paper), d.quantity) : 0;
  const cardSheets = d.card ? sheetsNeeded(sheetLayout(d.card, options.paper), d.quantity) : 0;

  const msgDetails = useMemo(() => getMessageDetails(d), [d]);

  // 상태 빠른 변경 액션
  const handleFastStatusChange = (nextStatus: DesignStatus) =>
    start(async () => {
      setMessage(null);
      const res = await updateDesignAction(d.code, {
        status: nextStatus,
        orderNo: orderNo || undefined,
        memo,
        eventDate: eventDate || null,
        desiredDeliveryDate: desiredDeliveryDate || null,
      });
      if (res.ok) {
        setStatus(nextStatus);
        setMessage(`‘${STATUS_LABEL[nextStatus]}’(으)로 변경했습니다.`);
        router.refresh();
      } else {
        setMessage(res.message);
      }
    });

  // 주문번호 연결 액션
  const handleLinkOrder = () =>
    start(async () => {
      setMessage(null);
      if (!orderNo.trim()) return setMessage('주문번호를 입력해 주세요.');
      const res = await linkDesignToOrderAction(d.code, orderNo.trim());
      if (res.ok) {
        setMessage('주문번호를 연결했습니다.');
        router.refresh();
      } else {
        setMessage(res.message);
      }
    });

  // 포장·인쇄 없음 확정 액션
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

  // 메모 및 일정 저장 액션
  const handleSaveDetails = () =>
    start(async () => {
      setMessage(null);
      const res = await updateDesignAction(d.code, {
        status,
        orderNo: orderNo || undefined,
        memo,
        eventDate: eventDate || null,
        desiredDeliveryDate: desiredDeliveryDate || null,
      });
      if (res.ok) {
        setMessage('저장했습니다.');
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
        {/* 체크박스 */}
        <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`${d.code} 선택`} />
        </td>

        {/* 일정 배지 & 요약 */}
        <td onClick={onToggleExpand}>
          <div style={{ display: 'grid', gap: 4 }}>
            <div>
              <span className={`schedule-badge ${info.badgeTone}`}>
                {info.urgency === 'emergency' ? '🔴 ' : info.urgency === 'imminent' ? '🟠 ' : ''}
                {info.badgeText}
              </span>
            </div>
            <div className="small" style={{ fontWeight: 600, color: '#334155' }}>
              {info.displayDateText}
            </div>
            {info.hasConflict && (
              <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>⚠️ {info.conflictMessage}</div>
            )}
          </div>
        </td>

        {/* 주문번호 & 카페24 상태 배지 */}
        <td onClick={onToggleExpand}>
          <div style={{ display: 'grid', gap: 4 }}>
            {d.orderNo ? (
              <div className="mono font-semibold" style={{ fontSize: 13, color: '#0f172a' }}>
                {d.orderNo}
              </div>
            ) : (
              <div>
                <span className="order-badge-unlinked">⚠️ 주문 미연결</span>
              </div>
            )}

            <div>
              {d.status === 'pending' ? (
                d.orderNo || d.memo?.includes('카페24 주문') ? (
                  <span className="order-badge-pending">무통장 입금 대기</span>
                ) : (
                  <span className="order-badge-pending">주문서 작성 전 (보관)</span>
                )
              ) : isCanceled ? (
                <span className="schedule-badge gray">취소됨</span>
              ) : d.orderNo ? (
                <span className="order-badge-paid">카페24 결제확인</span>
              ) : null}
            </div>
            <div className="small muted">{kstLabel(d.createdAt)} 접수</div>
          </div>
        </td>

        {/* 디자인 코드 & 상품 정보 */}
        <td onClick={onToggleExpand}>
          <div style={{ display: 'grid', gap: 2 }}>
            <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
              {d.code}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1e293b' }}>{d.productName}</div>
            <div className="small muted">
              상품 #{d.productNo} · <b>{d.quantity}개</b>
              {d.event ? ` · ${eventNames[d.event] ?? d.event}` : ''}
            </div>
          </div>
        </td>

        {/* 포장 스타일 & 인쇄 규격 */}
        <td onClick={onToggleExpand}>
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{d.styleName}</div>
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
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              <select
                value={status}
                onChange={(e) => handleFastStatusChange(e.target.value as DesignStatus)}
                disabled={pending}
                aria-label="상태"
                style={{
                  fontSize: 12.5,
                  padding: '4px 6px',
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
                style={{ padding: '3px 8px', fontSize: 12 }}
              >
                {expanded ? '접기 ▲' : '상세 ▼'}
              </button>
            </div>

            {/* 빠른 인쇄 버튼 (취소 건은 비활성화 및 경고) */}
            {printable && (
              <div>
                {isCanceled ? (
                  <span className="small" style={{ color: '#dc2626', fontWeight: 600 }}>
                    ⚠️ 취소 주문 (인쇄 금지)
                  </span>
                ) : d.status === 'pending' ? (
                  <span className="small muted">입금 확인 후 인쇄</span>
                ) : (
                  <a
                    className="btn small"
                    href={sheetUrl(d.code, options)}
                    style={{ padding: '3px 8px', fontSize: 12, background: 'var(--pine)', color: '#fff' }}
                  >
                    🖨️ PDF {options.paper}·{Math.max(stickerSheets, cardSheets)}장
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
              {/* 컬럼 1: 고객 인쇄 문구 검수 & 시안 미리보기 */}
              <div className="detail-col">
                <div className="detail-col-title">고객 인쇄 문구 검수 & 시안 미리보기</div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {hasSticker && (
                    <div>
                      <a href={`${fileUrl(d.printCode!)}?inline=1`} target="_blank" rel="noreferrer" title="스티커 원본 보기">
                        <img
                          src={`${fileUrl(d.printCode!)}?thumb=1`}
                          alt="스티커 시안"
                          width={72}
                          height={72}
                          style={{ objectFit: 'contain', background: '#eee', borderRadius: 6, border: '1px solid #cbd5e1' }}
                        />
                      </a>
                      <div className="small muted" style={{ textAlign: 'center', marginTop: 2 }}>
                        스티커
                      </div>
                    </div>
                  )}

                  {hasCard && (
                    <div>
                      <a href={`${fileUrl(d.printCode!)}?inline=1&item=card`} target="_blank" rel="noreferrer" title="카드 원본 보기">
                        <img
                          src={`${fileUrl(d.printCode!)}?thumb=1&item=card`}
                          alt="카드 시안"
                          width={72}
                          height={50}
                          style={{ objectFit: 'contain', background: '#eee', borderRadius: 6, border: '1px solid #cbd5e1' }}
                        />
                      </a>
                      <div className="small muted" style={{ textAlign: 'center', marginTop: 2 }}>
                        카드
                      </div>
                    </div>
                  )}

                  {!hasSticker && !hasCard && <div className="small muted">인쇄물 없는 일반 포장입니다.</div>}
                </div>

                {/* 고객 입력 문구 박스 (가독성 높은 monospace 폰트) */}
                <div className="customer-msg-box">
                  {msgDetails.recipient && <div>[받는 분] {msgDetails.recipient}</div>}
                  {msgDetails.stickerTexts.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      [스티커 문구]
                      <br />
                      {msgDetails.stickerTexts.join('\n')}
                    </div>
                  )}
                  {msgDetails.cardTexts.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      [카드 문구]
                      <br />
                      {msgDetails.cardTexts.join('\n')}
                    </div>
                  )}
                  {msgDetails.sender && <div style={{ marginTop: 4 }}>[보내는 분] {msgDetails.sender}</div>}
                  {msgDetails.printDate && <div style={{ marginTop: 4 }}>[인쇄 일자] {msgDetails.printDate}</div>}
                  {!msgDetails.recipient &&
                    !msgDetails.sender &&
                    msgDetails.stickerTexts.length === 0 &&
                    msgDetails.cardTexts.length === 0 && <span className="muted">작성된 문구가 없습니다.</span>}
                </div>

                {/* 검수 완료 원클릭 버튼 */}
                {d.status === 'received' && (
                  <button
                    type="button"
                    className="btn small"
                    disabled={pending}
                    onClick={() => handleFastStatusChange('order_confirmed')}
                    style={{ background: '#16a34a', color: '#fff', fontWeight: 600, width: '100%' }}
                  >
                    ✓ 문구 검수 완료 → [인쇄 대기]로 변경
                  </button>
                )}
              </div>

              {/* 컬럼 2: 일정 관리 & 카페24 주문 연결 조치 */}
              <div className="detail-col">
                <div className="detail-col-title">일정 관리 & 카페24 주문 연결</div>

                {/* 일정 인라인 편집 */}
                <div style={{ display: 'grid', gap: 6, background: '#fff', padding: 10, borderRadius: 6, border: '1px solid #cbd5e1' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                    행사일 및 희망 수령일 (고객 입력)
                  </div>

                  <div className="row" style={{ gap: 8 }}>
                    <label style={{ flex: 1, fontSize: 12 }}>
                      <span className="muted">희망 수령일:</span>
                      <input
                        type="date"
                        value={desiredDeliveryDate}
                        onChange={(e) => setDesiredDeliveryDate(e.target.value)}
                        style={{ width: '100%', marginTop: 2 }}
                      />
                    </label>

                    <label style={{ flex: 1, fontSize: 12 }}>
                      <span className="muted">행사일:</span>
                      <input
                        type="date"
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        style={{ width: '100%', marginTop: 2 }}
                      />
                    </label>
                  </div>

                  {info.hasConflict && (
                    <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', padding: 6, borderRadius: 4 }}>
                      ⚠️ {info.conflictMessage}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
                    <button type="button" className="btn ghost small" disabled={pending} onClick={handleSaveDetails}>
                      일정 저장
                    </button>
                  </div>
                </div>

                {/* 카페24 주문번호 연결 및 포장 없음 조치 */}
                <div style={{ display: 'grid', gap: 6, background: '#fff', padding: 10, borderRadius: 6, border: '1px solid #cbd5e1' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>카페24 주문번호 연결</div>

                  <div className="row" style={{ gap: 6 }}>
                    <input
                      type="text"
                      value={orderNo}
                      onChange={(e) => setOrderNo(e.target.value)}
                      placeholder="예: 20261117-0000123"
                      style={{ flex: 1, fontSize: 12.5 }}
                    />
                    <button type="button" className="btn small" disabled={pending} onClick={handleLinkOrder}>
                      연결하기
                    </button>
                  </div>

                  {!d.orderNo && (
                    <div style={{ marginTop: 4 }}>
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={pending}
                        onClick={handleDismissPackaging}
                        style={{ width: '100%', color: '#64748b' }}
                      >
                        포장·인쇄물 없음으로 확정 (일반 상품)
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 컬럼 3: 인쇄 파일 출력 & 빠른 작업 전진 & 관리자 메모 */}
              <div className="detail-col">
                <div className="detail-col-title">인쇄 파일 출력 & 작업 메모</div>

                {/* 인쇄 파일 다운로드 목록 */}
                <div style={{ display: 'grid', gap: 6 }}>
                  {isCanceled ? (
                    <div style={{ background: '#fef2f2', color: '#991b1b', padding: 8, borderRadius: 6, fontSize: 12.5, fontWeight: 600 }}>
                      ⚠️ 취소·환불된 주문입니다. 인쇄 및 출고가 차단됩니다.
                    </div>
                  ) : (
                    <>
                      {hasSticker && (
                        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                          <span className="small muted" style={{ minWidth: 46 }}>
                            스티커:
                          </span>
                          <a className="btn small" href={sheetUrl(d.code, options)} target="_blank" rel="noreferrer">
                            PDF ({options.paper})
                          </a>
                          <a className="btn ghost small" href={sheetUrl(d.code, options, true)} target="_blank" rel="noreferrer">
                            시험 1장
                          </a>
                          <a className="btn ghost small" href={fileUrl(d.printCode!)} target="_blank" rel="noreferrer">
                            PNG
                          </a>
                        </div>
                      )}

                      {hasCard && (
                        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                          <span className="small muted" style={{ minWidth: 46 }}>
                            카드:
                          </span>
                          <a className="btn small" href={`${sheetUrl(d.code, options)}&item=card`} target="_blank" rel="noreferrer">
                            PDF ({options.paper})
                          </a>
                          <a className="btn ghost small" href={`${sheetUrl(d.code, options, true)}&item=card`} target="_blank" rel="noreferrer">
                            시험 1장
                          </a>
                          <a className="btn ghost small" href={`${fileUrl(d.printCode!)}?item=card`} target="_blank" rel="noreferrer">
                            PNG
                          </a>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* 상태 빠른 전진 버튼 */}
                {!isCanceled && (
                  <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
                    {d.status === 'order_confirmed' && (
                      <button
                        type="button"
                        className="btn small"
                        disabled={pending}
                        onClick={() => handleFastStatusChange('printed')}
                        style={{ background: '#2563eb', color: '#fff', fontWeight: 600 }}
                      >
                        ✓ 인쇄 출력 완료 → [인쇄 완료]로 전진
                      </button>
                    )}
                    {d.status === 'printed' && (
                      <button
                        type="button"
                        className="btn small"
                        disabled={pending}
                        onClick={() => handleFastStatusChange('completed')}
                        style={{ background: '#16a34a', color: '#fff', fontWeight: 600 }}
                      >
                        ✓ 포장 작업 완료 → [포장 완료]로 확정
                      </button>
                    )}
                  </div>
                )}

                {/* 관리자 메모 */}
                <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                  <span className="small muted">관리자 한 줄 메모:</span>
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      type="text"
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      placeholder="특이사항 메모 입력"
                      style={{ flex: 1, fontSize: 12.5 }}
                    />
                    <button type="button" className="btn small" disabled={pending} onClick={handleSaveDetails}>
                      저장
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
