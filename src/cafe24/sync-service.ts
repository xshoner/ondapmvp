import type { Cafe24Product } from '../engine/types.ts';
import type { ActionResult } from '../recommendation/contracts.ts';
import { buildSyncPreview, computeSnapshotHash, type SyncPreviewResult } from './sync-preview.ts';
import type { Cafe24Config } from './client.ts';

export interface AdminSyncDependencies {
  requireAdmin: () => Promise<void>;
  getCafe24Config: () => Cafe24Config;
  fetchAllProducts: (config: Cafe24Config) => Promise<Cafe24Product[]>;
  loadCurrentState: () => Promise<{
    products: Cafe24Product[];
    syncedAt: string | null;
    evidenceMap: Map<number, { reviewed: boolean; hasEvidence: boolean }>;
  }>;
  saveProducts: (
    mallId: string,
    products: Cafe24Product[],
    expectedSyncedAt: string | null,
    previewToken?: string,
  ) => Promise<{ count: number }>;
}

export function createAdminSyncServices(deps: AdminSyncDependencies) {
  return {
    async preview(): Promise<ActionResult<SyncPreviewResult>> {
      try {
        await deps.requireAdmin();
      } catch {
        return {
          ok: false,
          error: { code: 'unauthorized', message: '관리자 권한이 필요합니다.' },
        };
      }

      let config: Cafe24Config;
      try {
        config = deps.getCafe24Config();
      } catch (e) {
        return {
          ok: false,
          error: {
            code: 'unavailable',
            message: e instanceof Error ? e.message : '카페24 연동 환경변수가 올바르지 않습니다.',
          },
        };
      }

      let fetchedProducts: Cafe24Product[];
      try {
        fetchedProducts = await deps.fetchAllProducts(config);
      } catch (e) {
        return {
          ok: false,
          error: {
            code: 'unavailable',
            message: e instanceof Error ? e.message : '카페24 상품을 불러오지 못했습니다.',
          },
        };
      }

      if (!Array.isArray(fetchedProducts) || fetchedProducts.length === 0) {
        return {
          ok: false,
          error: {
            code: 'unavailable',
            message: '카페24 상품 목록이 비어 있거나 응답이 올바르지 않습니다. 기존 목록을 유지합니다.',
          },
        };
      }

      try {
        const { products: currentProducts, syncedAt, evidenceMap } = await deps.loadCurrentState();
        const preview = buildSyncPreview(currentProducts, fetchedProducts, evidenceMap, syncedAt);
        return { ok: true, data: preview };
      } catch (e) {
        return {
          ok: false,
          error: {
            code: 'unavailable',
            message: e instanceof Error ? e.message : '현재 등록 상품 정보를 읽지 못했습니다.',
          },
        };
      }
    },

    async apply(command: {
      snapshotHash: string;
      expectedSyncedAt: string | null;
      products: Cafe24Product[];
    }): Promise<ActionResult<{ count: number; syncedAt: string }>> {
      try {
        await deps.requireAdmin();
      } catch {
        return {
          ok: false,
          error: { code: 'unauthorized', message: '관리자 권한이 필요합니다.' },
        };
      }

      if (!command || !command.snapshotHash || !Array.isArray(command.products) || command.products.length === 0) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: '적용할 상품 정보가 올바르지 않습니다.' },
        };
      }

      const inputHash = computeSnapshotHash(command.products);
      if (inputHash !== command.snapshotHash) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: '검토한 스냅샷 정보와 일치하지 않습니다.' },
        };
      }

      let config: Cafe24Config;
      try {
        config = deps.getCafe24Config();
      } catch (e) {
        return {
          ok: false,
          error: {
            code: 'unavailable',
            message: e instanceof Error ? e.message : '카페24 연동 환경변수가 올바르지 않습니다.',
          },
        };
      }

      // 검토 이후 카페24 목록 변경 방어 (재조회 및 해시 대조)
      let currentCafe24: Cafe24Product[];
      try {
        currentCafe24 = await deps.fetchAllProducts(config);
      } catch (e) {
        return {
          ok: false,
          error: {
            code: 'unavailable',
            message: e instanceof Error ? e.message : '카페24 최신 상태 확인에 실패했습니다.',
          },
        };
      }

      const currentHash = computeSnapshotHash(currentCafe24);
      if (currentHash !== command.snapshotHash) {
        return {
          ok: false,
          error: {
            code: 'revision_conflict',
            message: '검토 이후 카페24 상품 목록이 변경되었습니다. 최신 목록을 다시 불러와 검토해 주세요.',
          },
        };
      }

      try {
        const result = await deps.saveProducts(
          config.mallId,
          currentCafe24,
          command.expectedSyncedAt,
          command.snapshotHash,
        );
        return { ok: true, data: { count: result.count, syncedAt: new Date().toISOString() } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : '상품 동기화 반영 중 오류가 발생했습니다.';
        const code = msg.includes('다른 작업') ? 'revision_conflict' : 'save_failed';
        return { ok: false, error: { code, message: msg } };
      }
    },
  };
}
