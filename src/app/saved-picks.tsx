'use client';

// 찜한 답례: 결과 화면에서 하트로 모아 둔 상품을 첫 화면에서 다시 본다 (이 기기에만 저장)
import { useEffect, useState } from 'react';
import { loadPicks, removePick, type SavedPick } from '@/lib/device.ts';
import { won } from '@/lib/result-query.ts';

export function SavedPicks() {
  const [picks, setPicks] = useState<SavedPick[]>([]);
  useEffect(() => setPicks(loadPicks()), []);
  if (picks.length === 0) return null;

  return (
    <details className="saved-picks">
      <summary>
        <span className="heart-icon" aria-hidden>♥</span>
        찜한 답례 <b className="num">{picks.length}</b>개
      </summary>
      <ul>
        {picks.map((p) => (
          <li key={p.productNo}>
            {p.image ? <img src={p.image} alt="" width={56} height={56} /> : <span className="ph" />}
            <div style={{ minWidth: 0 }}>
              <a className="alt-name" href={p.url} target="_blank" rel="noreferrer">{p.name}</a>
              <div className="small muted num">{won(p.price)} (찜할 때 가격)</div>
              <div className="alt-actions">
                <a className="btn ghost small" href={`/packaging?product=${p.productNo}&from=pick`}>포장 꾸미기</a>
                <button type="button" className="btn ghost small" style={{ border: 'none' }} onClick={() => { removePick(p.productNo); setPicks(loadPicks()); }}>빼기</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
