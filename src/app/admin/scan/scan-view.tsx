'use client';

// 인쇄 완료 처리: 주소로 열린 한 건은 버튼으로, 화면 안 카메라(BarcodeDetector)로는 찍는 대로 연달아 처리한다
import { useEffect, useRef, useState, useTransition } from 'react';
import { STATUS_LABEL } from '@/packaging/design-filter.ts';
import type { DesignStatus } from '@/packaging/types.ts';
import { markPrintedAction, updateDesignsStatusAction } from '../packaging/actions.ts';

type Initial = { code: string; productName: string; quantity: number; status: DesignStatus; statusLabel: string; orderNo: string | null } | null;
type Done = { code: string; productName: string; quantity: number; previous: DesignStatus; already: boolean; undone?: boolean };

// QR 내용(주소 또는 코드)에서 디자인 코드를 꺼낸다
const codeIn = (text: string) => text.toUpperCase().match(/OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/)?.[0] ?? null;

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };
declare global {
  interface Window { BarcodeDetector?: { new (opts: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }
}

export function ScanView({ initial, missing }: { initial: Initial; missing: string | null }) {
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState<string | null>(missing ? `${missing} 접수를 찾을 수 없습니다.` : null);
  const [manual, setManual] = useState('');
  const [pending, start] = useTransition();
  const [camera, setCamera] = useState<'off' | 'on' | 'unsupported'>('off');
  const videoRef = useRef<HTMLVideoElement>(null);
  const busy = useRef(new Set<string>()); // 같은 QR을 여러 번 읽어도 한 번만 처리

  const mark = (code: string) => start(async () => {
    setError(null);
    const res = await markPrintedAction(code);
    if (!res.ok) {
      busy.current.delete(code);
      return setError(res.message);
    }
    if (navigator.vibrate) navigator.vibrate(60);
    setDone((list) => [{ code: res.code, productName: res.productName, quantity: res.quantity, previous: res.previous, already: res.already }, ...list.filter((d) => d.code !== res.code)]);
  });

  const undo = (d: Done) => start(async () => {
    const res = await updateDesignsStatusAction([d.code], d.previous);
    if (!res.ok) return setError(res.message);
    busy.current.delete(d.code);
    setDone((list) => list.map((x) => (x.code === d.code ? { ...x, undone: true } : x)));
  });

  // 화면 안 카메라: 0.3초마다 QR을 찾는다. 지원 안 하는 브라우저(아이폰 사파리 등)는 기본 카메라 앱으로 찍으면 된다
  useEffect(() => {
    if (camera !== 'on') return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    void (async () => {
      try {
        const BD = window.BarcodeDetector;
        if (!BD || !(await BD.getSupportedFormats()).includes('qr_code')) return setCamera('unsupported');
        const detector = new BD({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          const found = await detector.detect(videoRef.current).catch(() => []);
          for (const f of found) {
            const code = codeIn(f.rawValue);
            if (code && !busy.current.has(code)) {
              busy.current.add(code);
              mark(code);
            }
          }
          timer = window.setTimeout(() => void tick(), 300);
        };
        void tick();
      } catch (e) {
        setError(`카메라를 켜지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
        setCamera('off');
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera]);

  const one = initial && !done.some((d) => d.code === initial.code) ? initial : null;

  return (
    <>
      {one && (
        <section className="panel">
          <b className="mono" style={{ fontSize: 18 }}>{one.code}</b>
          <div style={{ marginTop: 4 }}>{one.productName} · {one.quantity.toLocaleString('ko-KR')}개</div>
          <div className="small muted">지금 상태: {one.statusLabel}{one.orderNo ? ` · 주문 ${one.orderNo}` : ''}</div>
          {one.status === 'printed' ? (
            <p className="small" style={{ margin: '12px 0 0', color: 'var(--green)' }}>이미 인쇄 완료입니다.</p>
          ) : one.status === 'canceled' ? (
            <p className="small" style={{ margin: '12px 0 0', color: 'var(--danger)' }}>취소된 접수입니다. 인쇄 완료로 바꾸지 않습니다.</p>
          ) : (
            <button type="button" className="btn block" style={{ marginTop: 14 }} disabled={pending} onClick={() => mark(one.code)}>인쇄 완료로 바꾸기</button>
          )}
        </section>
      )}

      <section className="panel">
        <div className="spread">
          <b>여러 장 연달아 찍기</b>
          {camera === 'on'
            ? <button type="button" className="btn ghost small" onClick={() => setCamera('off')}>카메라 끄기</button>
            : <button type="button" className="btn small" onClick={() => setCamera('on')}>카메라 켜기</button>}
        </div>
        {camera === 'on' && <video ref={videoRef} className="scan-video" muted playsInline aria-label="QR 찍는 카메라" />}
        {camera === 'unsupported' && (
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            이 브라우저는 화면 안에서 QR을 읽지 못합니다. 휴대폰 기본 카메라 앱으로 시트의 QR을 찍으면 이 화면이 열립니다. 아래에 코드를 적어도 됩니다.
          </p>
        )}
        <form className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); const c = codeIn(manual); if (c) { mark(c); setManual(''); } else setError('코드 형식이 맞지 않습니다. 예: OD-7QDF-3P6M'); }}>
          <input className="num-input" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="OD-XXXX-XXXX" aria-label="디자인 코드 직접 입력" style={{ textTransform: 'uppercase' }} />
          <button type="submit" className="btn" style={{ flex: 'none' }} disabled={pending}>완료 처리</button>
        </form>
      </section>

      {error && <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}

      {done.length > 0 && (
        <section className="panel" aria-live="polite">
          <b className="small">이번에 처리한 접수 {done.filter((d) => !d.undone).length}건</b>
          <ul className="scan-log">
            {done.map((d) => (
              <li key={d.code} style={{ opacity: d.undone ? 0.5 : 1 }}>
                <div>
                  <b className="mono">{d.code}</b> <span className="small">{d.productName} · {d.quantity}개</span>
                  <div className="small muted">
                    {d.undone ? `되돌림 (${STATUS_LABEL[d.previous]})` : d.already ? '이미 인쇄 완료였음' : `${STATUS_LABEL[d.previous]} → 인쇄 완료`}
                  </div>
                </div>
                {!d.undone && !d.already && <button type="button" className="btn ghost small" disabled={pending} onClick={() => undo(d)}>되돌리기</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="small muted" style={{ margin: 0 }}><a className="text-link" href="/admin/packaging?tab=designs">디자인 접수 목록으로</a></p>
    </>
  );
}
