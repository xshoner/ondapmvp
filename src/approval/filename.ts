// 한글 파일명 및 다운로드 헤더용 안전한 파일명 생성기
export function buildApprovalFilename(eventName: string, revision: number, ext: 'docx' | 'pdf' | 'hwpx'): string {
  // 금지 문자, 공백, 개행 정리
  const safeName = eventName
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || '행사';

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  return `답례품_선정검토서_${safeName}_${yyyy}${mm}${dd}_r${revision}.${ext}`;
}

export function buildContentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename);
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
  // RFC 6266 / RFC 5987 호환: ASCII fallback filename 및 UTF-8 filename*
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
