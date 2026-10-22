// 인쇄 시트의 QR이 여는 짧은 주소: /s/OD-XXXX-XXXX → 관리자 스캔 화면 (로그인·권한 확인은 관리자 화면이 한다)
// 접속한 주소(운영·미리보기·개발)를 그대로 쓰도록 상대 경로로 넘긴다
import { normalizeDesignCode } from '@/packaging/rules.ts';

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = normalizeDesignCode((await params).code);
  return new Response(null, { status: 307, headers: { Location: code ? `/admin/scan?code=${code}` : '/admin/scan' } });
}
