import { notFound } from 'next/navigation';
import { isApprovalEnabled } from '@/approval/guard.ts';
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

  // 레거시 초안 호환성: 이전 시스템 기본값으로 생성된 문구가 남아있다면 행사에 맞게 자동 보정 (사용자 직접 입력 문구는 보존)
  if (draft.editable.purpose && isLegacyDefaultPurpose(draft.editable.purpose, draft.source.query.event, draft.source.query.relation)) {
    draft.editable.purpose = sanitizePurposeText(draft.editable.purpose, draft.source.query.event, draft.source.query.relation);
  }

  const initialModel = buildDocumentModel(draft);

  return <ApprovalEditorView initialDraft={draft} initialModel={initialModel} />;
}
