'use client';

// 예상하지 못한 오류가 나도 빈 화면 대신 안내와 다시 시도 버튼을 보여 준다 (Supabase·카페24 일시 장애 등)
import { useEffect } from 'react';

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mobile" style={{ paddingTop: 80, textAlign: 'center' }}>
      <h1 style={{ fontSize: 22 }}>잠시 문제가 생겼어요</h1>
      <p className="muted small" style={{ marginTop: 10 }}>
        잠깐 뒤에 다시 시도해 주세요. 계속되면 쇼핑몰 고객센터로 알려 주세요.
        {error.digest && <><br />오류 번호 {error.digest}</>}
      </p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
        <button type="button" className="btn" onClick={() => retry()}>다시 시도</button>
        <a className="btn ghost" href="/">처음으로</a>
      </div>
    </main>
  );
}
