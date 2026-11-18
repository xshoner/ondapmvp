import { getCatalog } from '@/data/repository.ts';
import { getPackagingAssets, listDesigns } from '@/data/packaging-repository.ts';
import { listBanners, type MainBanner } from '@/data/banner-repository.ts';
import { CATEGORY_ORDER, categoryName } from '@/packaging/rules.ts';
import { parseDesignFilter } from '@/packaging/design-filter.ts';
import type { Design, PackagingAssets } from '@/packaging/types.ts';
import { fetchRecentCafe24OrdersReadOnly } from '@/cafe24/readonly-orders.ts';
import { mergeDesignsAndOrders, type MergedBoardItem } from '@/packaging/order-board-merge.ts';
import { AssetManager } from './asset-manager.tsx';
import { DesignsTable } from './designs-table.tsx';
import { BannerManager } from './banner-manager.tsx';

export const dynamic = 'force-dynamic';

const TABS = [
  { id: 'designs', label: '디자인 접수' },
  { id: 'styles', label: '포장 스타일' },
  { id: 'images', label: '추천 이미지' },
  { id: 'texts', label: '추천 문구' },
  { id: 'banners', label: '메인 배너' },
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
  let mergedItems: MergedBoardItem[] = [];
  let banners: MainBanner[] = [];
  let error: string | null = null;
  let cafe24Error: string | null = null;

  try {
    if (tab === 'designs') {
      if (!filter.codeInvalid) {
        designs = await listDesigns({ ...filter, includePending: true, intakeOnly: true });

        // 카페24 최근 주문·품목을 읽기 전용으로 안전하게 가져와 디자인 접수와 결합
        // DB 쓰기나 가짜 데이터 생성을 절대 하지 않음
        try {
          const cafe24Res = await fetchRecentCafe24OrdersReadOnly({ days: 7 });
          if (cafe24Res.ok) {
            mergedItems = mergeDesignsAndOrders(designs, cafe24Res.orders);
          } else {
            cafe24Error = cafe24Res.error || '카페24 주문 목록을 가져오지 못했습니다.';
            mergedItems = mergeDesignsAndOrders(designs, []);
          }
        } catch (c24Err) {
          cafe24Error = c24Err instanceof Error ? c24Err.message : String(c24Err);
          mergedItems = mergeDesignsAndOrders(designs, []);
        }
      }
    } else if (tab === 'banners') {
      banners = await listBanners();
    } else {
      assets = await getPackagingAssets({ includeInactive: true });
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <header className="page-head">
        <h1>포장 디자인 및 접수</h1>
      </header>

      <nav className="admin-tabs" style={{ marginBottom: 20 }} aria-label="포장 디자인 및 접수 메뉴">
        {TABS.map((t) => (
          <a key={t.id} href={`/admin/packaging?tab=${t.id}`} aria-selected={tab === t.id}>{t.label}</a>
        ))}
      </nav>

      {error ? (
        <div className="notice">
          데이터를 읽지 못했습니다: {error}
          <br />Supabase를 쓴다면 SQL Editor에서 최신 마이그레이션이 실행되었는지 확인하세요.
        </div>
      ) : tab === 'designs' ? (
        <DesignsTable
          designs={designs}
          mergedItems={mergedItems}
          cafe24Error={cafe24Error}
          eventNames={eventNames}
          filter={filter}
          now={Date.now()}
        />
      ) : tab === 'banners' ? (
        <BannerManager banners={banners} />
      ) : assets ? (
        <AssetManager key={tab} kind={tab as 'styles' | 'images' | 'texts'} assets={assets} categoryNames={categoryNames} />
      ) : null}
    </>
  );
}
