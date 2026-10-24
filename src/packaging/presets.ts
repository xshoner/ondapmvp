import type { AssetTargeting, DesignCategory, GiftPurpose } from './types.ts';
const EVENTS = ['funeral','wedding','longevity','birth','promotion','opening','thanks','birthday','common'];

export function cleanTargeting(raw: unknown): AssetTargeting {
  const v = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    events: [...new Set((Array.isArray(v.events) ? v.events : []).filter((x): x is DesignCategory => typeof x === 'string' && EVENTS.includes(x)))],
    purposes: [...new Set((Array.isArray(v.purposes) ? v.purposes : []).filter((x): x is GiftPurpose | 'neutral' => ['return','celebration','neutral'].includes(x)))],
    productNos: [...new Set((Array.isArray(v.productNos) ? v.productNos : []).filter((x): x is number => Number.isSafeInteger(x) && x > 0))].slice(0, 100),
  };
}
export function matchesTarget(item: { targeting?: AssetTargeting; category?: DesignCategory }, event: DesignCategory | null, purpose: GiftPurpose, productNo: number): boolean {
  const t = cleanTargeting(item.targeting);
  if (!t.purposes.includes(purpose) && !t.purposes.includes('neutral')) return false;
  if (t.productNos.length && !t.productNos.includes(productNo)) return false;
  const events = t.events.length ? t.events : item.category ? [item.category] : [];
  return events.includes('common') || Boolean(event && events.includes(event));
}

// 감사 답례와 축하 선물을 섞지 않는 기본 문구. 관리자 자료가 없을 때에도 안전한 텍스트로 시작한다.
const RETURN_TEXT: Partial<Record<DesignCategory, string>> = {
  funeral: '보내주신 위로에\n깊이 감사드립니다',
  wedding: '저희의 새 출발을\n축복해 주셔서 감사합니다',
  longevity: '소중한 자리를 함께해 주셔서\n감사합니다',
  birth: '보내주신 축하에\n감사의 마음을 전합니다',
  promotion: '보내주신 응원에\n감사드립니다',
  opening: '새로운 시작을 함께해 주셔서\n감사합니다',
  birthday: '생일을 축하해 주셔서\n고맙습니다',
};
export function presetText(event: DesignCategory | null, purpose: GiftPurpose): string {
  if (purpose === 'return') return (event && RETURN_TEXT[event]) || '감사의 마음을\n전합니다';
  if (event === 'funeral') return '삼가 위로의 마음을\n전합니다';
  return event === 'longevity' ? '늘 건강하시고\n평안하세요' : '소중한 시작을\n축하드립니다';
}
