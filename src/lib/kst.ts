// 서버와 브라우저의 로캘 차이로 hydration이 어긋나지 않도록 직접 포맷 (한국 시간)
export function kstLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
