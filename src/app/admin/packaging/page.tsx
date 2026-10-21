import { getCatalog } from '@/data/repository.ts';
import { getPackagingAssets, listDesigns } from '@/data/packaging-repository.ts';
import { CATEGORY_ORDER, categoryName } from '@/packaging/rules.ts';
import { parseDesignFilter } from '@/packaging/design-filter.ts';
import type { Design, PackagingAssets } from '@/packaging/types.ts';
import { AssetManager } from './asset-manager.tsx';
import { DesignsTable } from './designs-table.tsx';

export const dynamic = 'force-dynamic';

const TABS = [
  { id: 'designs', label: '디자인 접수' },
  { id: 'styles', label: '포장 스타일' },
  { id: 'images', label: '추천 이미지' },
  { id: 'texts', label: '추천 문구' },
] as const;
type Tab = (typeof TABS)[number]['id'];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PackagingAdminPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : 'designs';
  const filter = parseDesignFilter(sp);

  const { config } = await getCatalog();
  const eventNames = Object.fromEntries(Object.entries(config.events).map(([k, v]) => [k, v.name]));
  const categoryNames = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, categoryName(c, eventNames)]));

  let assets: PackagingAssets | null = null;
  let designs: Design[] = [];
  let error: string | null = null;
  try {
    assets = await getPackagingAssets({ includeInactive: true });
    if (tab === 'designs' && !filter.codeInvalid) designs = await listDesigns(filter);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <header className="page-head">
        <h1>포장 디자인</h1>
        <p>고객이 포장지를 고르고 스티커를 꾸미면 디자인 코드가 나오고, 그 코드가 카페24 주문서에 함께 들어옵니다.</p>
      </header>

      <nav className="admin-tabs" style={{ marginBottom: 20 }} aria-label="포장 디자인 메뉴">
        {TABS.map((t) => (
          <a key={t.id} href={`/admin/packaging?tab=${t.id}`} aria-selected={tab === t.id}>{t.label}</a>
        ))}
      </nav>

      {error ? (
        <div className="notice">
          포장 디자인 데이터를 읽지 못했습니다: {error}
          <br />Supabase를 쓴다면 SQL Editor에서 <code>supabase/migrations/20261021000000_packaging.sql</code>을 실행했는지 확인하세요.
        </div>
      ) : assets && tab === 'designs' ? (
        <DesignsTable designs={designs} eventNames={eventNames} filter={filter} />
      ) : assets ? (
        <AssetManager key={tab} kind={tab as 'styles' | 'images' | 'texts'} assets={assets} categoryNames={categoryNames} />
      ) : null}
    </>
  );
}
