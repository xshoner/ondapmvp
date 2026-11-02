import { isApprovalEnabled, isValidApprovalOrigin } from '../../../../../approval/guard.ts';
import { canAccessDraft } from '../../../../../approval/auth.ts';
import { getDraft, isValidUUID } from '../../../../../data/approval-repository.ts';
import { buildDocumentModel } from '../../../../../approval/calc.ts';
import { generateApprovalHwpx } from '../../../../../approval/hwpx.ts';
import { buildApprovalFilename, buildContentDisposition } from '../../../../../approval/filename.ts';

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
    return new Response(JSON.stringify({ error: 'forbidden', message: '문서 작성자만 다운로드할 수 있습니다.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const model = buildDocumentModel(draft);
  const hwpxBytes = await generateApprovalHwpx(model);
  const filename = buildApprovalFilename(model.eventName, model.revision, 'hwpx');

  return new Response(hwpxBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/hwp+zip',
      'Content-Disposition': buildContentDisposition(filename),
      'Cache-Control': 'no-store',
    },
  });
}
