'use client';

// 결과 화면의 작은 브라우저 기능: 지난 조건 기억(CR-01), 찜(CR-12), 조건 창 닫기(CR-04), 추천 의견(AS-07)
import { useEffect, useState, useTransition } from 'react';
import { feedbackSent, isPicked, rememberFeedback, rememberQuery, togglePick, type SavedPick } from '@/lib/device.ts';
import { FEEDBACK_REASONS, type FeedbackReason } from '@/lib/feedback.ts';
import type { ResultQuery } from '@/lib/result-query.ts';
import { sendFeedbackAction } from './actions.ts';

// 결과를 본 조건을 이 기기에 기억해 다음에 첫 화면에서 "지난번 조건으로 보기"를 띄운다
export function RememberQuery({ query }: { query: ResultQuery }) {
  const key = JSON.stringify(query);
  useEffect(() => rememberQuery(query), [key]); // 조건 값이 바뀔 때만 (매번 새 객체가 와도 다시 쓰지 않게)
  return null;
}

// 조건 칩 창(<details class="cond">)은 바깥을 누르거나 Esc를 누르면 닫는다
export function CloseCondOnOutside() {
  useEffect(() => {
    const close = (e: Event) => {
      for (const d of document.querySelectorAll<HTMLDetailsElement>('details.cond[open]')) {
        if (e instanceof KeyboardEvent ? e.key === 'Escape' : !d.contains(e.target as Node)) d.open = false;
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return null;
}

export function SavePickButton({ pick, variant }: { pick: Omit<SavedPick, 'savedAt'>; variant: 'overlay' | 'inline' }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isPicked(pick.productNo)), [pick.productNo]);
  const toggle = () => setOn(togglePick(pick));
  const label = on ? `${pick.name} 찜 해제` : `${pick.name} 찜하기`;

  if (variant === 'overlay') {
    return (
      <button type="button" className="save-pick" aria-pressed={on} aria-label={label} title={on ? '찜 해제' : '찜하기'} onClick={toggle}>
        <span aria-hidden>{on ? '♥' : '♡'}</span>
      </button>
    );
  }
  return (
    <button type="button" className="btn ghost small save-pick-inline" aria-pressed={on} aria-label={label} onClick={toggle}>
      <span aria-hidden>{on ? '♥' : '♡'}</span> {on ? '찜함' : '찜'}
    </button>
  );
}

// 이 추천이 도움이 됐나요? 아쉬우면 이유를 고르게만 한다 (글 입력 없음). 같은 결과에는 한 번만 묻는다
export function FeedbackBox({ query, productNos }: { query: ResultQuery; productNos: number[] }) {
  const key = [query.event, query.relation, query.budget ?? '', query.qty, productNos.join('.')].join('|');
  const [step, setStep] = useState<'hidden' | 'ask' | 'why' | 'done'>('hidden');
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [pending, start] = useTransition();
  useEffect(() => setStep(feedbackSent(key) ? 'hidden' : 'ask'), [key]);

  const send = (helpful: boolean) => start(async () => {
    await sendFeedbackAction({ event: query.event, relation: query.relation, budget: query.budget, qty: query.qty, productNos, helpful, reasons: helpful ? [] : reasons })
      .catch(() => {}); // 연결이 끊겨도 결과 화면은 그대로
    rememberFeedback(key); // 저장이 안 됐어도 다시 묻지 않는다 (고객을 귀찮게 하지 않게)
    setStep('done');
  });
  const toggle = (r: FeedbackReason) => setReasons((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));

  if (step === 'hidden') return null;
  return (
    <section className="feedback" aria-live="polite">
      {step === 'done' ? (
        <p className="small" style={{ margin: 0 }}>의견 고맙습니다. 더 알맞은 추천을 만드는 데 쓰겠습니다.</p>
      ) : step === 'ask' ? (
        <>
          <p className="feedback-q">이 추천이 도움이 됐나요?</p>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn ghost small" disabled={pending} onClick={() => send(true)}>도움 됐어요</button>
            <button type="button" className="btn ghost small" disabled={pending} onClick={() => setStep('why')}>아쉬워요</button>
          </div>
        </>
      ) : (
        <>
          <p className="feedback-q">어떤 점이 아쉬웠나요? <span className="small muted">여러 개 골라도 돼요</span></p>
          <div className="chips">
            {(Object.keys(FEEDBACK_REASONS) as FeedbackReason[]).map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={reasons.includes(r)} onClick={() => toggle(r)}>{FEEDBACK_REASONS[r]}</button>
            ))}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button type="button" className="btn small" disabled={pending} onClick={() => send(false)}>{pending ? '보내는 중' : '보내기'}</button>
            <button type="button" className="btn ghost small" style={{ border: 'none' }} disabled={pending} onClick={() => setStep('ask')}>취소</button>
          </div>
        </>
      )}
    </section>
  );
}
