'use client';

// 내 디자인: 이 기기에 저장한 최근 디자인 + 다른 기기에서 받은 코드 조회
import { useEffect, useState, useTransition } from 'react';
import { kstLabel } from '@/lib/kst.ts';
import { forgetDesign, loadSavedDesigns, orderUrl, type SavedDesign } from '@/packaging/client.ts';
import { lookupDesignAction, type LookupResult } from '../actions.ts';

type Found = Extract<LookupResult, { ok: true }>['design'];

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

export function MineView({ initialCode }: { initialCode: string }) {
  const [saved, setSaved] = useState<SavedDesign[]>([]);
  const [code, setCode] = useState(initialCode);
  const [found, setFound] = useState<Found | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => setSaved(loadSavedDesigns()), []);

  const lookup = (value: string) => start(async () => {
    setMessage(null);
    setFound(null);
    const res = await lookupDesignAction(value);
    if (res.ok) setFound(res.design);
    else setMessage(res.message);
  });

  useEffect(() => {
    if (initialCode) lookup(initialCode);
  }, []); // 주소로 코드가 넘어오면 바로 조회 (처음 한 번)

  return (
    <>
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
            <div className="spread">
              <b className="serif num" style={{ fontSize: 20, letterSpacing: '0.03em' }}>{found.code}</b>
              <span className="pill">{found.status}</span>
            </div>
            <div style={{ marginTop: 8, fontWeight: 600 }}>{found.productName}</div>
            <div className="small muted">{found.quantity.toLocaleString('ko-KR')}개, {found.styleName} 포장, {found.sticker}</div>
            <div className="small muted">{kstLabel(found.createdAt)} 저장</div>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              {found.productUrl && <a className="btn small" href={orderUrl(found.productUrl, found.code, found.quantity)}>주문하러 가기</a>}
              <CopyButton code={found.code} />
            </div>
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
            {saved.map((d) => (
              <article key={d.code} className="alt">
                {d.thumb ? <img src={d.thumb} alt="저장한 스티커" style={{ objectFit: 'contain', background: 'var(--paper-deep)' }} /> : <span className="ph" />}
                <div style={{ minWidth: 0 }}>
                  <b className="serif num" style={{ letterSpacing: '0.03em' }}>{d.code}</b>
                  <div className="small" style={{ marginTop: 2, lineHeight: 1.4 }}>{d.productName}</div>
                  <div className="small muted">{d.quantity.toLocaleString('ko-KR')}개, {kstLabel(d.savedAt)}</div>
                  <div className="alt-actions" style={{ flexWrap: 'wrap' }}>
                    <a className="btn small" href={orderUrl(d.productUrl, d.code, d.quantity)}>주문하러 가기</a>
                    <CopyButton code={d.code} />
                    <button type="button" className="btn ghost small" style={{ border: 'none' }} onClick={() => { forgetDesign(d.code); setSaved(loadSavedDesigns()); }}>목록에서 빼기</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
