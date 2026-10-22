'use client';

// 결과 화면의 작은 브라우저 기능: 지난 조건 기억(CR-01), 찜(CR-12), 조건 창 닫기(CR-04)
import { useEffect, useState } from 'react';
import { isPicked, rememberQuery, togglePick, type SavedPick } from '@/lib/device.ts';
import type { ResultQuery } from '@/lib/result-query.ts';

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
