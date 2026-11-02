import crypto from 'node:crypto';
import { isApprovalEnabled, isValidApprovalOrigin } from '../../../approval/guard.ts';
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
import { loadCafe24Features } from '../../../approval/cafe24-features.ts';
import { requestFromSearchParams, recommendationResultHref } from '../../../recommendation/query.ts';
import { parseRecommendationRequest } from '../../../recommendation/validation.ts';
import type { RecommendationResponse, RecommendationRequest } from '../../../recommendation/contracts.ts';
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
    request?: RecommendationRequest;
    expectedResponse?: RecommendationResponse;
    expectedCandidates?: { productNo: number; price: number }[];
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body || (!body.request && (!body.query || !body.query.event || !body.query.relation))) {
    return Response.json({ error: 'missing_query' }, { status: 400 });
  }

  let recRequest: RecommendationRequest;
  try {
    const raw = body.query!;
    recRequest = body.request ? parseRecommendationRequest(body.request) : requestFromSearchParams({
      ...Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'exclude').map(([key, value]) => [key, String(value ?? '')])),
      exclude: Array.isArray(raw.exclude) ? raw.exclude.join(',') : '',
    });
  } catch { return Response.json({ error: 'invalid_query', message: '추천 조건을 다시 확인해 주세요.' }, { status: 400 }); }
  const query = parseResultQuery(Object.fromEntries(new URLSearchParams(recommendationResultHref(recRequest).split('?')[1])));

  const recResult = await recommendForCustomer(recRequest);
  if (!recResult.ok) {
    return Response.json(
      { error: recResult.error.code, message: recResult.error.message },
      { status: 400 },
    );
  }

  const { items, policyVersion, notices, exclusions } = recResult.data;
  if (body.expectedResponse && (body.expectedResponse.policyVersion !== policyVersion || JSON.stringify(body.expectedResponse.items) !== JSON.stringify(items))) {
    return Response.json({ error: 'catalog_changed', message: '추천 기준이나 상품 정보가 변경되었습니다. 최신 추천 결과를 확인해 주세요.' }, { status: 409 });
  }


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

  // 외부 서비스 지연이 결재 문서 생성을 막지 않도록 한다.
  let featureTimeout: ReturnType<typeof setTimeout> | undefined;
  const features = await Promise.race([
    loadCafe24Features(items.map((item) => item.productNo)),
    new Promise<Map<number, string>>((resolve) => { featureTimeout = setTimeout(() => resolve(new Map()), 15000); }),
  ]);
  clearTimeout(featureTimeout);

  // 후보 상품 사본 고정 (R: 상품 희소값, S: 추천점수 구분 보관)
  const candidates: ApprovalCandidate[] = await Promise.all(
    items.map(async (r, idx) => {
      let localImageFilename: string | undefined;

      if (r.imageUrl) {
        const cached = await cacheProductImage(r.imageUrl, draftId, r.productNo).catch(() => null);
        if (cached) localImageFilename = cached;
      }

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
        story: features.get(r.productNo),
        region: '',
        category: '',
        isDepopulationArea: false,
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
      catalogSyncedAt: snapshotAt,
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
