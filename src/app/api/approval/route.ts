import crypto from 'node:crypto';
import { isApprovalEnabled, isValidApprovalOrigin } from '../../../approval/guard.ts';
import { loadRecommendationCatalog, loadSyncInfo } from '../../../data/catalog.ts';
import { recommend } from '../../../engine/recommend.ts';
import { isDepopulationArea } from '../../../engine/formality.ts';
import { parseResultQuery, type ResultQuery } from '../../../lib/result-query.ts';
import {
  saveDraft,
  cacheProductImage,
} from '../../../data/approval-repository.ts';
import {
  buildDocumentModel,
  defaultPurposeText,
  getEventName,
} from '../../../approval/calc.ts';
import type { ApprovalCandidate, ApprovalDraft } from '../../../approval/types.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isApprovalEnabled()) {
    return new Response(null, { status: 404 });
  }

  if (!isValidApprovalOrigin(req)) {
    return new Response(JSON.stringify({ error: 'forbidden_origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: {
    query?: ResultQuery;
    expectedCandidates?: { productNo: number; price: number }[];
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.query || !body.query.event || !body.query.relation) {
    return Response.json({ error: 'missing_query' }, { status: 400 });
  }

  const query = parseResultQuery(body.query as unknown as Record<string, string | string[] | undefined>);
  const catalog = loadRecommendationCatalog();
  const syncInfo = loadSyncInfo();
  const result = recommend(catalog, {
    event: query.event as any,
    relation: query.relation as any,
    budgetMax: query.budget ?? undefined,
    quantity: query.qty,
    exclude: query.exclude,
  });

  if (result.results.length === 0) {
    return Response.json(
      { error: 'no_candidates', message: '추천 결과가 없습니다. 조건을 확인해 주세요.' },
      { status: 400 },
    );
  }

  // 화면 기대값(expectedCandidates)과 현재 카탈로그 추천 결과 비교
  if (body.expectedCandidates && Array.isArray(body.expectedCandidates) && body.expectedCandidates.length > 0) {
    const isMatched =
      body.expectedCandidates.length === result.results.length &&
      body.expectedCandidates.every((exp, idx) => {
        const actual = result.results[idx];
        return actual && exp.productNo === actual.product.productNo && exp.price === actual.product.price;
      });

    if (!isMatched) {
      return Response.json(
        {
          error: 'catalog_changed',
          message: '추천 상품 또는 판매가가 변경되었습니다. 최신 추천 결과를 확인해 주세요.',
          currentCandidates: result.results.map((r) => ({
            productNo: r.product.productNo,
            productName: r.product.name,
            price: r.product.price,
          })),
        },
        { status: 409 },
      );
    }
  }

  const draftId = crypto.randomUUID();
  const snapshotAt = new Date().toISOString();

  // 후보 상품 사본 고정 및 이미지 캐싱 시도
  const candidates: ApprovalCandidate[] = await Promise.all(
    result.results.map(async (r, idx) => {
      const p = r.product;
      const attr = r.attributes;
      let localImageFilename: string | undefined;

      if (p.image) {
        const cached = await cacheProductImage(p.image, draftId, p.productNo).catch(() => null);
        if (cached) localImageFilename = cached;
      }

      return {
        rank: idx + 1,
        model: r.model,
        productNo: p.productNo,
        productName: p.name,
        price: p.price,
        imageUrl: p.image || '',
        localImageFilename,
        tier: r.tier,
        matchScore: r.matchScore,
        reason: r.reason,
        region: attr.region,
        category: attr.category,
        isDepopulationArea: isDepopulationArea(catalog.config, attr.region),
        story: attr.story,
        attributesReviewed: attr.reviewed,
      };
    }),
  );

  const initialQuantity = query.qty;
  const firstCandidate = candidates[0];

  const draft: ApprovalDraft = {
    schemaVersion: 1,
    id: draftId,
    revision: 1,
    createdAt: snapshotAt,
    updatedAt: snapshotAt,
    source: {
      query,
      budgetMode: query.budgetMode,
      originalTotalBudget: query.totalBudget ?? null,
      modelVersion: catalog.formalityEvidence ? 'v2' : catalog.config.modelVersion,
      catalogSyncedAt: syncInfo.syncedAt || snapshotAt,
      snapshotAt,
      candidates,
      recommendNotice: result.notice,
    },
    editable: {
      eventName: `${getEventName(query.event)} 답례품`,
      eventDate: null,
      organization: '',
      department: '',
      author: '',
      purpose: defaultPurposeText(query.event, query.relation),
      quantity: initialQuantity,
      selectedProductNo: firstCandidate.productNo,
      additionalNote: '',
      approverTitles: ['담당', '팀장', '과장'],
      internalPerPersonLimit: null,
      internalRuleMemo: '',
    },
  };

  await saveDraft(draft);
  const model = buildDocumentModel(draft);

  return Response.json({
    id: draft.id,
    draft,
    model,
  });
}
