'use client';

// 추천 결과 공유: 휴대폰은 기기 공유 창(카카오톡·문자 등), 그 밖에는 주소 복사
import { useState } from 'react';
import { isMobileUA } from '@/lib/device.ts';

export function ShareButton({ title }: { title: string }) {
  const [done, setDone] = useState<string | null>(null);

  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share && isMobileUA()) {
        await navigator.share({ title, text: `${title} 온답 답례 추천 결과입니다.`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setDone('주소를 복사했습니다');
    } catch (e) {
      // 공유 창을 닫은 경우는 조용히 넘어간다
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setDone('복사가 막혀 있어요. 주소창의 주소를 복사해 주세요');
    }
    setTimeout(() => setDone(null), 2500);
  };

  return (
    <span className="row" style={{ gap: 8 }}>
      <button type="button" className="btn ghost small" onClick={() => void share()}>결과 공유</button>
      {done && <span className="small muted" role="status">{done}</span>}
    </span>
  );
}
