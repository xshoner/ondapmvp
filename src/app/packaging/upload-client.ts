// 클라이언트 인쇄 파일 직접 업로드 헬퍼
// 서버리스 메모리 한도를 우회하기 위해 스토리지 서명 URL(또는 로컬 업로드 엔드포인트)로 직접 전송한다.

export interface UploadTarget {
  signedUrl: string;
  token?: string;
  path: string;
  maxBytes: number;
}

export async function uploadPrintBlob(target: UploadTarget, blob: Blob): Promise<void> {
  const uploadUrl = target.signedUrl;

  // Supabase Storage 서명 업로드 URL인 경우: FormData 기반 전송
  if (uploadUrl.includes('/object/upload/sign/')) {
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!key) throw new Error('업로드 설정을 확인하지 못했습니다.');
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', blob);
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { apikey: key },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`스토리지 업로드 실패 (${res.status}): ${text || res.statusText}`);
    }
    return;
  }

  // 로컬 엔드포인트 또는 일반 바이너리 PUT 전송
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/png',
    },
    body: blob,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const msg = data?.message || res.statusText;
    throw new Error(`파일 전송 실패 (${res.status}): ${msg}`);
  }
}
