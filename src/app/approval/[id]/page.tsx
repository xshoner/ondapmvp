import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { isApprovalEnabled } from '@/approval/guard.ts';
import { canAccessDraftWithToken } from '@/approval/auth.ts';
import { getDraft, isValidUUID } from '@/data/approval-repository.ts';
import { buildDocumentModel, sanitizePurposeText, isLegacyDefaultPurpose } from '@/approval/calc.ts';
import { ApprovalEditorView } from './approval-view.tsx';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ApprovalPage({ params }: PageProps) {
  if (!isApprovalEnabled()) {
    notFound();
  }

  const { id } = await params;
  if (!isValidUUID(id)) {
    notFound();
  }

  const draft = await getDraft(id);
  if (!draft) {
    notFound();
  }

  // 작성자 권한 확인 (작성자 쿠키 또는 관리자 권한)
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(`ondap_approval_${id}`)?.value;
  const token = cookieToken;

  const hasAccess = await canAccessDraftWithToken(token, draft);
  if (!hasAccess) {
    return (
      <main className="mobile" style={{ maxWidth: 600, margin: '60px auto', padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>접근 권한이 없습니다</h1>
        <p style={{ color: '#4B5563', lineHeight: 1.6, marginBottom: 24 }}>
          이 결재 문서는 비공개 초안입니다. 문서를 처음 기안한 브라우저에서 열람해 주세요.
        </p>
        <a href="/" className="btn block">홈으로 이동</a>
      </main>
    );
  }

  // 레거시 초안 호환성: 이전 시스템 기본값으로 생성된 문구가 남아있다면 행사에 맞게 자동 보정 (사용자 직접 입력 문구는 보존)
  if (draft.editable.purpose && isLegacyDefaultPurpose(draft.editable.purpose, draft.source.query.event, draft.source.query.relation)) {
    draft.editable.purpose = sanitizePurposeText(draft.editable.purpose, draft.source.query.event, draft.source.query.relation);
  }

  const initialModel = buildDocumentModel(draft);

  return <ApprovalEditorView initialDraft={draft} initialModel={initialModel} />;
}
