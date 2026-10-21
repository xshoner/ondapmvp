// 관리자 인쇄 파일 내려받기: /admin/packaging/print/OD-XXXX-XXXX
//   ?inline=1 미리보기(브라우저에서 열기), ?thumb=1 목록용 작은 그림(160px webp, 약 10KB)
// 라우트 핸들러에는 admin/layout.tsx 확인이 적용되지 않으므로 여기서 직접 확인한다.

import { readPrintFile } from '@/data/packaging-repository.ts';
import { getAdminStatus } from '@/lib/admin-guard.ts';
import { normalizeDesignCode } from '@/packaging/rules.ts';

// 인쇄 파일은 저장 뒤 바뀌지 않으므로 썸네일은 브라우저에 하루 둔다(관리자 본인 브라우저만)
async function thumbnail(png: Uint8Array): Promise<Response | null> {
  try {
    const sharp = (await import('sharp')).default;
    const webp = await sharp(png).resize(160, 160, { fit: 'inside' }).webp({ quality: 75 }).toBuffer();
    return new Response(new Uint8Array(webp), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400' } });
  } catch (e) {
    console.warn('[포장 디자인] 썸네일 생성 실패, 원본으로 대신함:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const status = await getAdminStatus();
  if (!status.allowed) return new Response('관리자만 내려받을 수 있습니다.', { status: 403 });

  const code = normalizeDesignCode((await params).code);
  if (!code) return new Response('잘못된 디자인 코드입니다.', { status: 400 });
  const bytes = await readPrintFile(code);
  if (!bytes) return new Response('인쇄 파일이 없습니다.', { status: 404 });

  const q = new URL(request.url).searchParams;
  if (q.get('thumb') === '1') {
    const thumb = await thumbnail(bytes);
    if (thumb) return thumb;
  }
  const inline = q.get('inline') === '1' || q.get('thumb') === '1';
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${code}.png"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
