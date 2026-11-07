'use server';

import { requireAdmin } from '@/lib/admin-guard.ts';
import { dataSource } from '@/lib/supabase/env.ts';
import { createServiceClient } from '@/lib/supabase/service.ts';
import { readPages } from '@/data/db.ts';
import { cafe24ConfigFromEnv, fetchAllProducts } from '@/cafe24/client.ts';
import type { Cafe24Product } from '@/engine/types.ts';
import type { ActionResult } from '@/recommendation/contracts.ts';
import type { SyncPreviewResult } from '@/cafe24/sync-preview.ts';
import { createAdminSyncServices } from '@/cafe24/sync-service.ts';
import { getCatalog, getFormalityData, getSyncInfo, saveProductsWithAdminOverride } from '@/data/repository.ts';

const adminSyncServices = createAdminSyncServices({
  requireAdmin,
  getCafe24Config() {
    return cafe24ConfigFromEnv(process.env as Record<string, string>);
  },
  fetchAllProducts,
  async loadCurrentState() {
    if (dataSource() === 'local') {
      const catalog = await getCatalog();
      const syncInfo = await getSyncInfo();
      const formalityData = await getFormalityData();
      const evidenceMap = new Map<number, { reviewed: boolean; hasEvidence: boolean }>();
      for (const [no, item] of Object.entries(formalityData.items)) {
        const hasEvidence = Boolean(
          item.reviewed ||
          (item.description && item.description.trim()) ||
          (item.factors && Object.keys(item.factors).length > 0)
        );
        evidenceMap.set(Number(no), { reviewed: Boolean(item.reviewed), hasEvidence });
      }
      return {
        products: catalog.products,
        syncedAt: syncInfo.syncedAt,
        evidenceMap,
      };
    }

    const serviceDb = createServiceClient();
    const [pRes, evRes] = await Promise.all([
      readPages(
        (from, to) =>
          serviceDb
            .from('products')
            .select('product_no, name, price, display, selling, sold_out, image, detail_image, url, synced_at')
            .order('product_no')
            .range(from, to),
        5000,
        true,
      ),
      readPages(
        (from, to) =>
          serviceDb
            .from('product_evidence')
            .select('product_no, reviewed, factors, description')
            .order('product_no')
            .range(from, to),
        5000,
        true,
      ),
    ]);

    if (pRes.error) throw new Error(`상품 목록 조회 실패: ${pRes.error.message}`);
    if (evRes.error) throw new Error(`검수 근거 조회 실패: ${evRes.error.message}`);

    const rows = (pRes.rows ?? []) as any[];
    const syncedAt = rows.reduce<string | null>((max, r) => {
      if (!r.synced_at) return max;
      return !max || r.synced_at > max ? r.synced_at : max;
    }, null);

    const evidenceMap = new Map<number, { reviewed: boolean; hasEvidence: boolean }>();
    for (const ev of (evRes.rows ?? []) as any[]) {
      const hasEvidence = Boolean(
        ev.reviewed ||
        (ev.description && String(ev.description).trim()) ||
        (ev.factors && Object.keys(ev.factors).length > 0)
      );
      evidenceMap.set(ev.product_no, { reviewed: Boolean(ev.reviewed), hasEvidence });
    }

    const products: Cafe24Product[] = rows.map((r) => ({
      productNo: r.product_no,
      name: r.name,
      price: Number(r.price),
      display: r.display,
      selling: r.selling,
      soldOut: r.sold_out,
      image: r.image,
      detailImage: r.detail_image,
      url: r.url,
    }));

    return { products, syncedAt, evidenceMap };
  },
  async saveProducts(mallId, products, expectedSyncedAt, previewToken) {
    return saveProductsWithAdminOverride(mallId, products, expectedSyncedAt, previewToken);
  },
});

export async function previewCafe24SyncAction(): Promise<ActionResult<SyncPreviewResult>> {
  return adminSyncServices.preview();
}

export async function applyCafe24SyncAction(cmd: {
  snapshotHash: string;
  expectedSyncedAt: string | null;
  products: Cafe24Product[];
}): Promise<ActionResult<{ count: number; syncedAt: string }>> {
  return adminSyncServices.apply(cmd);
}
