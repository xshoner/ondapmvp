// 관리자 인쇄 파일 내려받기: /admin/packaging/print/OD-XXXX-XXXX (?inline=1이면 미리보기)
// 라우트 핸들러에는 admin/layout.tsx 확인이 적용되지 않으므로 여기서 직접 확인한다.

import { readPrintFile } from '@/data/packaging-repository.ts';
import { getAdminStatus } from '@/lib/admin-guard.ts';
import { normalizeDesignCode } from '@/packaging/rules.ts';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const status = await getAdminStatus();
  if (!status.allowed) return new Response('관리자만 내려받을 수 있습니다.', { status: 403 });

  const code = normalizeDesignCode((await params).code);
  if (!code) return new Response('잘못된 디자인 코드입니다.', { status: 400 });
  const bytes = await readPrintFile(code);
  if (!bytes) return new Response('인쇄 파일이 없습니다.', { status: 404 });

  const inline = new URL(request.url).searchParams.get('inline') === '1';
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${code}.png"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
