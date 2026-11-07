// 포장·스티커 서비스 요금 정의 및 계산 모듈
// 카페24 상품별 포장 디자인 서비스 옵션의 실제 추가금액을 동적으로 참조한다.

export type PackagingOptionStatus = 'loading' | 'confirmed' | 'unconfirmed';

export interface PackagingOptionInfo {
  status: PackagingOptionStatus;
  productNo?: number;
  unitPrice: number | null; // 확정된 경우 원화 정수 (0원 포함), 미확인 시 null
  optionName?: string | null;
  optionValue?: string | null;
  variantCode?: string | null;
  reason?:
    | 'confirmed'
    | 'no_option'
    | 'composite_ambiguous'
    | 'not_sellable'
    | 'invalid_amount'
    | 'duplicate_candidates'
    | 'api_error'
    | 'loading';
  fetchedAt?: number;
}

/**
 * 포장 서비스 총액 계산 (개당 포장비 × 수량)
 * 포장비가 null이거나 유효하지 않은 경우 null 반환 (임의 0원 처리 금지)
 */
export function calcPackagingTotal(
  unitPrice: number | null | undefined,
  quantity: number,
): number | null {
  if (unitPrice === null || unitPrice === undefined || !Number.isSafeInteger(unitPrice) || unitPrice < 0) {
    return null;
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return null;
  }
  const total = unitPrice * quantity;
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * 상품 금액 + 포장 서비스 예상 합계 계산
 * 포장비가 미확인이면 합계도 null(확인 필요)로 반환하여 왜곡된 합계를 표시하지 않는다.
 */
export function calcExpectedOrderTotal(
  productUnitPrice: number,
  packagingUnitPrice: number | null | undefined,
  quantity: number,
): number | null {
  if (!Number.isSafeInteger(productUnitPrice) || productUnitPrice < 0) return null;
  const pkgTotal = calcPackagingTotal(packagingUnitPrice, quantity);
  if (pkgTotal === null) return null;
  const total = productUnitPrice * quantity + pkgTotal;
  return Number.isSafeInteger(total) ? total : null;
}
