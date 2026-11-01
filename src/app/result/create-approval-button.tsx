'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ResultQuery } from '@/lib/result-query.ts';

interface CandidateExpected {
  productNo: number;
  price: number;
}

export function CreateApprovalButton({
  query,
  candidates,
  className = 'btn ghost',
  label = '결재 문서(품의서) 작성하기',
}: {
  query: ResultQuery;
  candidates: CandidateExpected[];
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleCreate() {
    if (loading) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          expectedCandidates: candidates,
        }),
      });

      if (res.status === 409) {
        const data = await res.json();
        alert(data.message || '추천 상품 정보가 변경되었습니다. 최신 추천을 확인해 주세요.');
        window.location.reload();
        return;
      }

      if (!res.ok) {
        throw new Error('문서 생성 요청에 실패했습니다.');
      }

      const data = await res.json();
      router.push(`/approval/${data.id}`);
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : '결재 문서 생성에 실패했습니다.';
      setErrorMsg(msg);
    }
  }

  const isBlock = className.includes('block');

  return (
    <div style={{ display: isBlock ? 'block' : 'inline-block', width: isBlock ? '100%' : undefined }}>
      <button
        type="button"
        className={className}
        disabled={loading}
        onClick={handleCreate}
        style={{ cursor: loading ? 'wait' : 'pointer' }}
      >
        {loading ? '문서 초안 준비 중…' : label}
      </button>
      {errorMsg && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 4 }}>{errorMsg}</p>}
    </div>
  );
}
