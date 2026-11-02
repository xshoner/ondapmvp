import { isApprovalEnabled, isValidApprovalOrigin } from '../../../../approval/guard.ts';
import { canAccessDraft } from '../../../../approval/auth.ts';
import {
  getDraft,
  updateDraftEditable,
  deleteDraft,
  isValidUUID,
  RevisionConflictError,
} from '../../../../data/approval-repository.ts';
import { buildDocumentModel, validateQuantity, sanitizePurposeText, isLegacyDefaultPurpose } from '../../../../approval/calc.ts';
import type { ApprovalDraftEditable } from '../../../../approval/types.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, context: RouteContext) {
  if (!isApprovalEnabled()) {
    return new Response(null, { status: 404 });
  }

  if (!isValidApprovalOrigin(req)) {
    return new Response(JSON.stringify({ error: 'forbidden_origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id } = await context.params;
  if (!isValidUUID(id)) {
    return new Response(null, { status: 404 });
  }

  const draft = await getDraft(id);
  if (!draft) {
    return new Response(null, { status: 404 });
  }

  if (!(await canAccessDraft(req, draft))) {
    return Response.json({ error: 'forbidden', message: '문서 작성자만 조회할 수 있습니다.' }, { status: 403 });
  }

  // 레거시 초안 호환성: 이전 시스템 기본값으로 생성된 문구가 남아있다면 행사에 맞게 자동 보정 (사용자 직접 입력 문구는 보존)
  if (draft.editable.purpose && isLegacyDefaultPurpose(draft.editable.purpose, draft.source.query.event, draft.source.query.relation)) {
    draft.editable.purpose = sanitizePurposeText(draft.editable.purpose, draft.source.query.event, draft.source.query.relation);
  }

  const model = buildDocumentModel(draft);
  return Response.json({ draft, model });
}

export async function PATCH(req: Request, context: RouteContext) {
  if (!isApprovalEnabled()) {
    return new Response(null, { status: 404 });
  }

  if (!isValidApprovalOrigin(req)) {
    return new Response(JSON.stringify({ error: 'forbidden_origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id } = await context.params;
  if (!isValidUUID(id)) {
    return new Response(null, { status: 404 });
  }

  const existing = await getDraft(id);
  if (!existing) {
    return new Response(null, { status: 404 });
  }

  if (!(await canAccessDraft(req, existing))) {
    return Response.json({ error: 'forbidden', message: '문서 작성자만 수정할 수 있습니다.' }, { status: 403 });
  }

  let body: {
    patch?: Partial<ApprovalDraftEditable>;
    expectedRevision?: number;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (typeof body.expectedRevision !== 'number') {
    return Response.json({ error: 'missing_expected_revision' }, { status: 400 });
  }

  const rawPatch = body.patch || {};
  const safePatch: Partial<ApprovalDraftEditable> = {};

  // 필드별 검증 및 새니타이징 (허용 필드만 반영, HTML 태그 및 비정상 데이터 방지)
  if (rawPatch.eventName !== undefined) {
    safePatch.eventName = String(rawPatch.eventName).replace(/<[^>]*>/g, '').trim().slice(0, 100);
  }

  if (rawPatch.eventDate !== undefined) {
    if (rawPatch.eventDate === null || rawPatch.eventDate === '') {
      safePatch.eventDate = null;
    } else {
      const dateStr = String(rawPatch.eventDate).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return Response.json({ error: 'invalid_event_date_format' }, { status: 400 });
      }
      safePatch.eventDate = dateStr;
    }
  }

  if (rawPatch.organization !== undefined) {
    safePatch.organization = String(rawPatch.organization).replace(/<[^>]*>/g, '').trim().slice(0, 50);
  }

  if (rawPatch.department !== undefined) {
    safePatch.department = String(rawPatch.department).replace(/<[^>]*>/g, '').trim().slice(0, 50);
  }

  if (rawPatch.author !== undefined) {
    safePatch.author = String(rawPatch.author).replace(/<[^>]*>/g, '').trim().slice(0, 50);
  }

  if (rawPatch.purpose !== undefined) {
    safePatch.purpose = String(rawPatch.purpose).replace(/<[^>]*>/g, '').trim().slice(0, 500);
  }

  if (rawPatch.additionalNote !== undefined) {
    safePatch.additionalNote = String(rawPatch.additionalNote).replace(/<[^>]*>/g, '').trim().slice(0, 1000);
  }

  if (rawPatch.internalRuleMemo !== undefined) {
    safePatch.internalRuleMemo = String(rawPatch.internalRuleMemo).replace(/<[^>]*>/g, '').trim().slice(0, 200);
  }

  if (rawPatch.internalPerPersonLimit !== undefined) {
    if (rawPatch.internalPerPersonLimit === null || rawPatch.internalPerPersonLimit === 0) {
      safePatch.internalPerPersonLimit = null;
    } else {
      const lim = Number(rawPatch.internalPerPersonLimit);
      if (!Number.isInteger(lim) || lim < 0 || lim > 100_000_000) {
        return Response.json({ error: 'invalid_per_person_limit' }, { status: 400 });
      }
      safePatch.internalPerPersonLimit = lim;
    }
  }

  if (rawPatch.quantity !== undefined) {
    try {
      safePatch.quantity = validateQuantity(rawPatch.quantity);
    } catch (e: any) {
      return Response.json({ error: 'invalid_quantity', message: e.message }, { status: 400 });
    }
  }

  if (rawPatch.selectedProductNo !== undefined) {
    const pNo = Number(rawPatch.selectedProductNo);
    const validProductNos = existing.source.candidates.map((c) => c.productNo);
    if (!validProductNos.includes(pNo)) {
      return Response.json({ error: 'invalid_selected_product_no' }, { status: 400 });
    }
    safePatch.selectedProductNo = pNo;
  }

  if (rawPatch.approverTitles !== undefined) {
    if (!Array.isArray(rawPatch.approverTitles)) {
      return Response.json({ error: 'invalid_approver_titles' }, { status: 400 });
    }
    safePatch.approverTitles = rawPatch.approverTitles
      .slice(0, 5)
      .map((t) => String(t).replace(/<[^>]*>/g, '').trim().slice(0, 20))
      .filter((t) => t.length > 0);
  }

  if (rawPatch.complianceChecks !== undefined) {
    if (typeof rawPatch.complianceChecks === 'object' && rawPatch.complianceChecks !== null) {
      safePatch.complianceChecks = {
        antiGraft: Boolean(rawPatch.complianceChecks.antiGraft),
        electionLaw: Boolean(rawPatch.complianceChecks.electionLaw),
        contract: Boolean(rawPatch.complianceChecks.contract),
      };
    }
  }

  try {
    const updatedDraft = await updateDraftEditable(id, safePatch, body.expectedRevision);
    const model = buildDocumentModel(updatedDraft);
    return Response.json({ draft: updatedDraft, model });
  } catch (err: unknown) {
    if (err instanceof RevisionConflictError) {
      return Response.json(
        {
          error: 'revision_conflict',
          message: err.message,
          currentRevision: err.currentRevision,
        },
        { status: 409 },
      );
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  if (!isApprovalEnabled()) {
    return new Response(null, { status: 404 });
  }

  if (!isValidApprovalOrigin(req)) {
    return new Response(JSON.stringify({ error: 'forbidden_origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id } = await context.params;
  if (!isValidUUID(id)) {
    return new Response(null, { status: 404 });
  }

  const existing = await getDraft(id);
  if (!existing) {
    return new Response(null, { status: 404 });
  }

  if (!(await canAccessDraft(req, existing))) {
    return Response.json({ error: 'forbidden', message: '문서 작성자만 삭제할 수 있습니다.' }, { status: 403 });
  }

  const deleted = await deleteDraft(id);
  if (!deleted) {
    return new Response(null, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
