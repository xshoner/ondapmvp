import crypto from 'node:crypto';
import { isApprovalEnabled, isValidApprovalOrigin } from '../../../approval/guard.ts';
import { loadCatalog, loadSyncInfo } from '../../../data/catalog.ts';
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
import {
  generateCreatorToken,
  hashCreatorToken,
  buildCreatorCookie,
} from '../../../approval/auth.ts';
import { recommendForCustomer } from '../../../recommendation/server.ts';
import type { RecommendationRequest, EventId, RelationId } from '../../../recommendation/contracts.ts';
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
  const syncInfo = loadSyncInfo();

  // 고객 /result와 완전히 동일한 공통 추천 서버(recommendForCustomer) 호출
  const recRequest: RecommendationRequest = {
    event: query.event as EventId,
    relation: query.relation as RelationId,
    quantity: query.qty,
    budget:
      query.budgetMode === 'total' && query.totalBudget != null
        ? { mode: 'total', amount: query.totalBudget }
        : query.budget != null
        ? { mode: 'per_item', amount: query.budget }
        : { mode: 'none' },
    excludedProductNos: query.exclude ?? [],
  };

  const recResult = await recommendForCustomer(recRequest);
  if (!recResult.ok) {
    return Response.json(
      { error: recResult.error.code, message: recResult.error.message },
      { status: 400 },
    );
  }

  const { items, policyVersion, notices, exclusions } = recResult.data;

  if (items.length === 0) {
    return Response.json(
      { error: 'no_candidates', message: '추천 결과가 없습니다. 조건을 확인해 주세요.' },
      { status: 400 },
    );
  }

  // 화면 기대값(expectedCandidates)과 최신 추천 결과 비교 (조용히 다른 문서가 만들어지는 것 방지)
  if (body.expectedCandidates && Array.isArray(body.expectedCandidates) && body.expectedCandidates.length > 0) {
    const isMatched =
      body.expectedCandidates.length === items.length &&
      body.expectedCandidates.every((exp, idx) => {
        const actual = items[idx];
        return actual && exp.productNo === actual.productNo && exp.price === actual.unitPrice;
      });

    if (!isMatched) {
      return Response.json(
        {
          error: 'catalog_changed',
          message: '추천 상품 또는 판매가가 변경되었습니다. 최신 추천 결과를 확인해 주세요.',
          currentCandidates: items.map((r) => ({
            productNo: r.productNo,
            productName: r.name,
            price: r.unitPrice,
          })),
        },
        { status: 409 },
      );
    }
  }

  const draftId = crypto.randomUUID();
  const creatorToken = generateCreatorToken();
  const creatorTokenHash = hashCreatorToken(creatorToken);
  const snapshotAt = new Date().toISOString();

  let catalogData: ReturnType<typeof loadCatalog> | null = null;
  try {
    catalogData = loadCatalog();
  } catch {}

  // 후보 상품 사본 고정 (R: 상품 희소값, S: 추천점수 구분 보관)
  const candidates: ApprovalCandidate[] = await Promise.all(
    items.map(async (r, idx) => {
      let localImageFilename: string | undefined;

      if (r.imageUrl) {
        const cached = await cacheProductImage(r.imageUrl, draftId, r.productNo).catch(() => null);
        if (cached) localImageFilename = cached;
      }

      const attr = catalogData?.attributes.find((a) => a.productNo === r.productNo);
      const region = attr?.region || '기타';
      const category = attr?.category || '일반';
      const story = attr?.story || undefined;
      const isDepop = catalogData ? isDepopulationArea(catalogData.config, region) : false;

      return {
        model: 'core-contract-v1',
        rank: r.rank ?? idx + 1,
        productNo: r.productNo,
        productName: r.name,
        price: r.unitPrice,
        imageUrl: r.imageUrl || '',
        localImageFilename,
        tier: `추천 ${idx + 1}순위`,
        matchScore: r.recommendationScore,
        recommendationScore: r.recommendationScore, // S (추천점수)
        rarityValue: r.rarityValue, // R (상품 희소값)
        eventFormality: r.eventFormality, // F (행사 격식)
        eventFitScore: r.eventFitScore, // E (행사 적합도)
        priceValueScore: r.priceValueScore, // V (가격 적합도)
        evidenceCount: r.evidenceCount,
        assessmentMethod: r.assessmentMethod,
        reasons: r.reasons,
        reason: r.reasons?.[0] || '자리에 알맞은 격식과 실용성을 갖춘 상품입니다.',
        region,
        category,
        isDepopulationArea: isDepop,
        story,
        attributesReviewed: r.evidenceCount >= 2,
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
    creatorTokenHash,
    source: {
      query,
      budgetMode: (query.budgetMode ?? (query.budget == null ? 'none' : 'per_item')) as 'per_item' | 'total' | 'none',
      originalTotalBudget: query.totalBudget ?? null,
      modelVersion: 'core-contract-v1',
      policyVersion,
      catalogSyncedAt: syncInfo.syncedAt || snapshotAt,
      snapshotAt,
      candidates,
      recommendNotice: notices && notices.length > 0 ? notices.map((n) => n.message).join('\n') : null,
      exclusions,
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

  const cookieHeader = buildCreatorCookie(draft.id, creatorToken);

  return Response.json(
    {
      id: draft.id,
      token: creatorToken,
      draft,
      model,
    },
    {
      status: 200,
      headers: {
        'Set-Cookie': cookieHeader,
      },
    },
  );
}
