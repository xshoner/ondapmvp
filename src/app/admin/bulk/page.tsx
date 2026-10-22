import { getCatalog } from '@/data/repository.ts';
import { BulkEditor } from './bulk-editor.tsx';

export const dynamic = 'force-dynamic';

// 엑셀로 한꺼번에: 지표 전체를 CSV로 받아 엑셀에서 고치고, 올리기 전에 바뀐 칸만 미리 본 뒤 한 번에 저장한다
export default async function BulkPage() {
  const catalog = await getCatalog();
  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 1100 }}>
      <header className="page-head" style={{ marginBottom: 0 }}>
        <h1>엑셀로 한꺼번에</h1>
        <p>상품 지표 전체를 엑셀 파일(CSV)로 받아 고친 뒤 올리면, 바뀐 칸만 보여 주고 확인을 받아 한 번에 저장합니다.</p>
      </header>
      <BulkEditor catalog={catalog} />
    </div>
  );
}
