import { listDesigns } from '@/data/packaging-repository.ts';
import { STATUS_LABEL } from '@/packaging/design-filter.ts';
import { normalizeDesignCode } from '@/packaging/rules.ts';
import { ScanView } from './scan-view.tsx';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// 인쇄 시트 QR로 '인쇄 완료' 처리: 휴대폰 기본 카메라로 찍으면 /s/코드 → 이 화면(?code=)이 열린다
export default async function ScanPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const code = typeof sp.code === 'string' ? normalizeDesignCode(sp.code) : null;
  const [design] = code ? await listDesigns({ code, limit: 1 }) : [];
  return (
    <div style={{ maxWidth: 560, display: 'grid', gap: 16 }}>
      <header className="page-head" style={{ marginBottom: 0 }}>
        <h1>QR로 완료 처리</h1>
        <p>인쇄를 마친 시트 오른쪽 위의 QR을 찍으면 그 접수가 ‘인쇄 완료’로 바뀝니다. 잘못 찍었으면 바로 되돌릴 수 있습니다.</p>
      </header>
      <ScanView
        initial={design ? {
          code: design.code, productName: design.productName, quantity: design.quantity, status: design.status,
          statusLabel: STATUS_LABEL[design.status], orderNo: design.orderNo,
        } : null}
        missing={code && !design ? code : null}
      />
    </div>
  );
}
