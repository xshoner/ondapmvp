'use client';

// 내 디자인: 이 기기에 저장한 최근 디자인 + 다른 기기에서 받은 코드 조회.
// 진행 단계(접수 → 주문 확인 → 인쇄 완료)를 보여 주고, 같은 디자인으로 다시 주문하거나 스티커 그림을 받을 수 있다
import { useEffect, useState, useTransition } from 'react';
import { saveBlob } from '@/lib/device.ts';
import { kstLabel } from '@/lib/kst.ts';
import { forgetDesign, loadSavedDesigns, orderUrl, rememberDesign, type SavedDesign } from '@/packaging/client.ts';
import { QtyInput } from '../../components/qty-input.tsx';
import { lookupDesignAction, lookupDesignsAction, reorderDesignAction, type CustomerDesign } from '../actions.ts';
import { getPreview, previewCodes, savePreview } from '../editor-store.ts';

function CopyButton({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost small"
      onClick={() => void navigator.clipboard.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); }, () => setDone(false))}
    >
      {done ? '복사했습니다' : '코드 복사'}
    </button>
  );
}

const STEPS = [
  { id: 'received', label: '접수' },
  { id: 'order_confirmed', label: '주문 확인' },
  { id: 'printed', label: '인쇄 완료' },
] as const;

const NEXT_HINT: Record<string, string> = {
  received: '쇼핑몰 주문서에 코드가 들어오면 ‘주문 확인’으로 바뀌어요. 아직 주문 전이면 ‘주문하러 가기’를 눌러 주세요.',
  order_confirmed: '주문을 확인했어요. 스티커를 인쇄하는 중이에요.',
  printed: '스티커 인쇄를 마쳤어요. 상품과 함께 정성껏 포장해 보내 드려요.',
};

const date = (iso: string) => kstLabel(iso).replace(/ \d{2}:\d{2}$/, '');
const shortDate = (iso: string) => kstLabel(iso).slice(5, 10).replace('-', '/'); // 10/22

function Progress({ design: d, compact = false }: { design: CustomerDesign; compact?: boolean }) {
  if (d.status === 'canceled') {
    return <p className="small progress-canceled" role="status">취소된 접수예요{compact ? '' : `. 다시 꾸미거나 새로 저장하면 새 코드로 주문할 수 있어요.`}</p>;
  }
  const at = STEPS.findIndex((s) => s.id === d.status);
  if (compact) return <span className="pill">{STEPS[at]?.label ?? d.status} {shortDate(at === 0 ? d.createdAt : d.statusChangedAt)}</span>;
  return (
    <div>
      <ol className="progress" aria-label="진행 상황">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>
            <span className="dot" aria-hidden />
            <b>{s.label}</b>
            <span className="small muted">{i === 0 ? date(d.createdAt) : i === at ? date(d.statusChangedAt) : ''}</span>
          </li>
        ))}
      </ol>
      <p className="small muted" style={{ margin: '8px 0 0' }}>{NEXT_HINT[d.status]}</p>
    </div>
  );
}

// 연결이 끊기거나 새로 배포되는 사이에 누르면 서버 호출이 실패한다: 화면 전체 오류 대신 이 문장을 보여 준다
const NETWORK_ERROR = '연결이 잠시 불안정해요. 다시 시도해 주세요.';

// 같은 디자인으로 다시 주문: 수량만 정하면 새 코드로 접수된다 (지난 주문과 인쇄·주문이 섞이지 않게)
function Reorder({ design, onDone, link = false }: { design: CustomerDesign; onDone(next: CustomerDesign): void; link?: boolean }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(design.quantity);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (design.status === 'canceled' || !design.canOrder) return null;
  if (!open) return <button type="button" className={link ? 'link-btn' : 'btn ghost small'} onClick={() => setOpen(true)}>{link ? '다시 주문' : '같은 디자인으로 다시 주문'}</button>;
  const go = () => start(async () => {
    setError(null);
    const res = await reorderDesignAction(design.code, qty).catch(() => ({ ok: false as const, message: NETWORK_ERROR }));
    if (!res.ok) return setError(res.message);
    setOpen(false);
    onDone(res.design);
  });
  return (
    <div className="reorder" role="group" aria-label="같은 디자인으로 다시 주문">
      <label className="small row" style={{ gap: 6 }}>
        수량
        <QtyInput className="qty-input" value={qty} onValue={setQty} />
        개
      </label>
      <button type="button" className="btn small" disabled={pending} onClick={go}>{pending ? '만드는 중' : '새 코드 받기'}</button>
      <button type="button" className="btn ghost small" style={{ border: 'none' }} onClick={() => setOpen(false)}>닫기</button>
      {error && <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0, flexBasis: '100%' }}>{error}</p>}
    </div>
  );
}

// 스티커 그림(화면용 480px)을 휴대폰 공유 창으로 보내거나 내려받는다
async function shareSticker(code: string, productName: string): Promise<string | null> {
  const blob = await getPreview(code);
  if (!blob) return '이 기기에 스티커 그림이 남아 있지 않아요.';
  const file = new File([blob], `ondap-${code}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `${productName} 포장 스티커` });
      return null;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
  }
  saveBlob(file, file.name);
  return null;
}

export function MineView({ initialCode }: { initialCode: string }) {
  const [saved, setSaved] = useState<SavedDesign[]>([]);
  const [status, setStatus] = useState<Record<string, CustomerDesign>>({});
  const [previews, setPreviews] = useState<Set<string>>(new Set());
  const [code, setCode] = useState(initialCode);
  const [found, setFound] = useState<CustomerDesign | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fresh, setFresh] = useState<CustomerDesign | null>(null); // 방금 다시 주문해 받은 새 코드
  const [pending, start] = useTransition();

  const refreshSaved = () => {
    const list = loadSavedDesigns();
    setSaved(list);
    void previewCodes().then(setPreviews);
    if (list.length) void lookupDesignsAction(list.map((d) => d.code)).then((s) => setStatus((old) => ({ ...old, ...s })), () => {}); // 못 읽으면 진행 상태만 빠진다
  };
  useEffect(refreshSaved, []);

  const lookup = (value: string) => start(async () => {
    setMessage(null);
    setFound(null);
    const res = await lookupDesignAction(value).catch(() => ({ ok: false as const, message: NETWORK_ERROR }));
    if (res.ok) setFound(res.design);
    else setMessage(res.message);
  });

  useEffect(() => {
    if (initialCode) lookup(initialCode);
  }, []); // 주소로 코드가 넘어오면 바로 조회 (처음 한 번)

  // 다시 주문으로 받은 새 코드: 이 기기 목록에 남기고(원본의 그림·편집 내용을 이어받음) 위에 크게 보여 준다
  const reordered = (from: string) => (next: CustomerDesign) => {
    const src = loadSavedDesigns().find((d) => d.code === from);
    rememberDesign({
      code: next.code, productName: next.productName, productUrl: next.productUrl ?? src?.productUrl ?? '', quantity: next.quantity,
      savedAt: new Date().toISOString(), thumb: src?.thumb ?? null, productNo: next.productNo, snapshot: src?.snapshot,
    });
    void getPreview(from).then((b) => b && savePreview(next.code, b)).then(refreshSaved);
    setFresh(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {fresh && (
        <section className="card fresh-code" role="status">
          <b>새 코드로 다시 접수했어요</b>
          <div className="design-code">{fresh.code}</div>
          <p className="small muted" style={{ textAlign: 'center', margin: '4px 0 0' }}>{fresh.productName} · {fresh.quantity.toLocaleString('ko-KR')}개 · 지난번과 같은 디자인</p>
          <div className="row" style={{ gap: 8, justifyContent: 'center', marginTop: 12 }}>
            {fresh.productUrl && <a className="btn small" href={orderUrl(fresh.productUrl, fresh.code, fresh.quantity)}>주문하러 가기</a>}
            <CopyButton code={fresh.code} />
          </div>
        </section>
      )}

      <section className="step" style={{ marginTop: 28 }}>
        <h2 className="step-label">코드로 찾기</h2>
        <form
          className="row"
          style={{ gap: 8, flexWrap: 'nowrap' }}
          onSubmit={(e) => { e.preventDefault(); lookup(code); }}
        >
          <input
            className="num-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="OD-XXXX-XXXX"
            aria-label="디자인 코드"
            autoCapitalize="characters"
            style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
          />
          <button type="submit" className="btn" style={{ flex: 'none' }} disabled={pending || !code.trim()}>{pending ? '찾는 중' : '찾기'}</button>
        </form>
        {message && <p className="small" role="alert" style={{ color: 'var(--danger)', margin: '8px 0 0' }}>{message}</p>}
        {found && (
          <article className="card" style={{ padding: 18, marginTop: 14 }}>
            <b className="serif num" style={{ fontSize: 20, letterSpacing: '0.03em' }}>{found.code}</b>
            <div style={{ marginTop: 8, fontWeight: 600 }}>{found.productName}</div>
            <div className="small muted">{found.quantity.toLocaleString('ko-KR')}개, {found.styleName} 포장, {found.sticker}</div>
            <div style={{ marginTop: 14 }}><Progress design={found} /></div>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              {found.productUrl && found.status === 'received' && found.canOrder && <a className="btn small" href={orderUrl(found.productUrl, found.code, found.quantity)}>주문하러 가기</a>}
              {found.status !== 'canceled' && <CopyButton code={found.code} />}
              <Reorder design={found} onDone={reordered(found.code)} />
            </div>
            {!found.canOrder && found.status !== 'canceled' && <p className="small muted" style={{ margin: '8px 0 0' }}>이 상품은 지금 쇼핑몰에서 주문할 수 없어요(품절·판매중지).</p>}
          </article>
        )}
      </section>

      <section className="step">
        <h2 className="step-label">이 기기에서 저장한 디자인</h2>
        {saved.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            아직 없습니다. 포장을 꾸미고 저장하면 여기에 남습니다. 다른 기기에서 저장했다면 위에서 코드로 찾아 주세요.
          </p>
        ) : (
          <div className="alt-list" style={{ marginTop: 0 }}>
            {saved.map((d) => {
              const s = status[d.code];
              return (
                <article key={d.code} className="alt mine-card">
                  {d.thumb ? <img src={d.thumb} alt="저장한 스티커" style={{ objectFit: 'contain', background: 'var(--paper-deep)' }} /> : <span className="ph" />}
                  <div style={{ minWidth: 0 }}>
                    <b className="serif num mine-code">{d.code}</b>
                    {s && <div style={{ marginTop: 2 }}><Progress design={s} compact /></div>}
                    <div className="small" style={{ marginTop: 4, lineHeight: 1.4 }}>{d.productName}</div>
                    <div className="small muted">{d.quantity.toLocaleString('ko-KR')}개 · {kstLabel(d.savedAt)} 저장</div>
                    <div className="alt-actions" style={{ flexWrap: 'wrap' }}>
                      {d.productUrl && (!s || (s.status === 'received' && s.canOrder)) && <a className="btn small" href={orderUrl(d.productUrl, d.code, d.quantity)}>주문하러 가기</a>}
                      <CopyButton code={d.code} />
                    </div>
                    <div className="mine-more small">
                      {d.productNo && d.snapshot ? (
                        <a className="link-btn" href={`/packaging?product=${d.productNo}&qty=${d.quantity}&from=mine&restore=${encodeURIComponent(d.code)}`}>다시 꾸미기</a>
                      ) : null}
                      {s && <Reorder design={s} onDone={reordered(d.code)} link />}
                      {previews.has(d.code) && (
                        <button type="button" className="link-btn" onClick={() => void shareSticker(d.code, d.productName).then((m) => m && alert(m))}>스티커 그림 받기</button>
                      )}
                      <button type="button" className="link-btn muted" onClick={() => { forgetDesign(d.code); refreshSaved(); }}>목록에서 빼기</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
