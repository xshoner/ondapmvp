import { findDesignCode, normalizeDesignCode } from '../packaging/rules.ts';
import {
  hasPackagingOption,
  isItemCanceledOrRefunded,
  isOrderCanceled,
  isOrderPaid,
  type Cafe24AdminOrder,
  type Cafe24AdminOrderItem,
} from './admin-orders.ts';
import { getValidAccessToken, refreshAccessToken } from './oauth.ts';

export type ReadOnlyErrorCode =
  | 'AUTH_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'NETWORK_ERROR'
  | 'CONFIG_MISSING'
  | 'API_ERROR';

export interface ReadOnlyOrdersResult {
  ok: boolean;
  orders: Cafe24AdminOrder[];
  total: number;
  error?: string;
  errorCode?: ReadOnlyErrorCode;
  hasMore?: boolean;
  checkedDays?: number;
  failedCount?: number;
}

export interface FetchReadOnlyOrdersOptions {
  days?: number;
  customToken?: string;
  timeoutMs?: number;
  maxPages?: number;
}

/**
 * 카페24 주문 상태 코드를 한국어 관리자 친화적 라벨로 변환 (실제 응답 기반)
 */
export function getCafe24OrderStatusLabel(status?: string): string {
  if (!status) return '상태 미확인';
  const code = status.toUpperCase();
  if (code === 'N00') return '입금전';
  if (code === 'N10') return '상품준비중';
  if (code === 'N20') return '배송준비중';
  if (code === 'N21') return '배송보류';
  if (code === 'N22') return '배송대기';
  if (code === 'N30') return '배송중';
  if (code === 'N40') return '배송완료';
  if (code.startsWith('C')) return '주문취소';
  if (code.startsWith('R')) return '반품/환불';
  if (code.startsWith('E')) return '교환';
  return status;
}

/**
 * 카페24 결제 상태 코드를 한국어 라벨로 변환 (실제 응답 기반)
 */
export function getCafe24PaymentStatusLabel(order: Cafe24AdminOrder): string {
  if (isOrderCanceled(order)) return '취소/환불';
  if (isOrderPaid(order)) return '결제완료';
  if (order.paid === 'F' || order.order_status === 'N00' || order.payment_status === 'F') {
    return '미결제 (입금대기)';
  }
  if (order.payment_status === 'M') return '추가입금대기';
  return '결제확인필요';
}

/**
 * 단일 품목에서 디자인 코드 추출
 */
export function extractItemDesignCode(item: Cafe24AdminOrderItem): string | null {
  if (!item) return null;

  if (Array.isArray(item.options)) {
    for (const opt of item.options as Record<string, unknown>[]) {
      if (!opt) continue;
      const v = typeof opt.value === 'string' ? opt.value : (typeof opt.option_value === 'string' ? opt.option_value : '');
      if (v) {
        const code = normalizeDesignCode(v) || findDesignCode(v);
        if (code) return code;
      }
    }
  }

  if (Array.isArray(item.additional_option)) {
    for (const opt of item.additional_option as Record<string, unknown>[]) {
      if (!opt) continue;
      const v = typeof opt.value === 'string' ? opt.value : (typeof opt.option_value === 'string' ? opt.option_value : '');
      if (v) {
        const code = normalizeDesignCode(v) || findDesignCode(v);
        if (code) return code;
      }
    }
  }

  if (typeof item.option_value === 'string' && item.option_value) {
    const code = normalizeDesignCode(item.option_value) || findDesignCode(item.option_value);
    if (code) return code;
  }

  return null;
}

/**
 * 주문 전체에서 추출 가능한 모든 고유 디자인 코드 목록 추출 (다품목/다디자인 대응)
 */
export function extractAllDesignCodes(order: Cafe24AdminOrder): string[] {
  if (!order) return [];
  const found = new Set<string>();

  // 1. 주문 공통 추가 정보
  if (Array.isArray(order.additional_order_info_list)) {
    for (const info of order.additional_order_info_list) {
      if (!info || typeof info.value !== 'string') continue;
      const val = info.value.trim();
      const code = normalizeDesignCode(val) || findDesignCode(val);
      if (code) found.add(code);
    }
  }

  // 2. 각 품목별 옵션
  if (Array.isArray(order.items)) {
    for (const item of order.items) {
      if (Array.isArray(item.options)) {
        for (const opt of item.options as Record<string, unknown>[]) {
          if (!opt) continue;
          const v = typeof opt.value === 'string' ? opt.value : (typeof opt.option_value === 'string' ? opt.option_value : '');
          if (v) {
            const code = normalizeDesignCode(v) || findDesignCode(v);
            if (code) found.add(code);
          }
        }
      }
      if (Array.isArray(item.additional_option)) {
        for (const opt of item.additional_option as Record<string, unknown>[]) {
          if (!opt) continue;
          const v = typeof opt.value === 'string' ? opt.value : (typeof opt.option_value === 'string' ? opt.option_value : '');
          if (v) {
            const code = normalizeDesignCode(v) || findDesignCode(v);
            if (code) found.add(code);
          }
        }
      }
      const code = extractItemDesignCode(item);
      if (code) found.add(code);
    }
  }

  return Array.from(found);
}

/**
 * 카페24 Admin API로부터 최근 주문 및 품목을 읽기 전용으로 안전하게 가져옴.
 * DB 쓰기나 자동 상태 변경을 절대 수행하지 않음.
 */
export async function fetchRecentCafe24OrdersReadOnly(
  options: FetchReadOnlyOrdersOptions = {},
): Promise<ReadOnlyOrdersResult> {
  const mallId = (process.env.CAFE24_MALL_ID || '').trim();
  if (!mallId) {
    return {
      ok: false,
      orders: [],
      total: 0,
      error: 'CAFE24_MALL_ID 환경변수가 설정되지 않았습니다.',
      errorCode: 'CONFIG_MISSING',
    };
  }

  const days = Math.max(1, Math.min(options.days ?? 7, 30));
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 8000, 30000));
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 10, 20));

  let token: string;
  try {
    token = options.customToken || (await getValidAccessToken());
  } catch {
    return {
      ok: false,
      orders: [],
      total: 0,
      checkedDays: days,
      error: '카페24 쇼핑몰 계정 연동을 확인해 주세요. (운영 상태 메뉴에서 다시 연결할 수 있습니다)',
      errorCode: 'AUTH_EXPIRED',
    };
  }

  // 한국 표준시(KST: UTC+9) 기준으로 조회 기간 산출
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const today = kstNow.toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() + 9 * 3600 * 1000 - days * 86400000);
  const from = fromDate.toISOString().slice(0, 10);
  const apiVersion = (process.env.CAFE24_API_VERSION || '2026-09-01').trim();

  const allOrders: Cafe24AdminOrder[] = [];
  let offset = 0;
  const limit = 100;
  let reachedMaxPages = false;

  for (let page = 0; page < maxPages; page++) {
    const url = `https://${mallId}.cafe24api.com/api/v2/admin/orders?start_date=${from}&end_date=${today}&embed=items,additional_order_info_list&limit=${limit}&offset=${offset}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Cafe24-Api-Version': apiVersion,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return {
        ok: false,
        orders: allOrders,
        total: allOrders.length,
        checkedDays: days,
        error: '카페24 주문 서버에 연결할 수 없습니다. 잠시 후 다시 확인해 주세요.',
        errorCode: 'NETWORK_ERROR',
      };
    }

    // 401 시 리프레시 후 1회 재시도
    if (res.status === 401 && !options.customToken) {
      try {
        const refreshed = await refreshAccessToken();
        token = refreshed.access_token;
        res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Cafe24-Api-Version': apiVersion,
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return {
          ok: false,
          orders: allOrders,
          total: allOrders.length,
          checkedDays: days,
          error: '카페24 연동 계정이 만료되었습니다. 관리자 메뉴(운영 상태)에서 다시 연결해 주세요.',
          errorCode: 'AUTH_EXPIRED',
        };
      }
    }

    if (res.status === 403) {
      return {
        ok: false,
        orders: allOrders,
        total: allOrders.length,
        checkedDays: days,
        error: '카페24 주문 조회 권한이 부족합니다. 관리자 권한 및 주문 조회 설정을 확인해 주세요.',
        errorCode: 'PERMISSION_DENIED',
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        orders: allOrders,
        total: allOrders.length,
        checkedDays: days,
        error: '카페24 주문 목록을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.',
        errorCode: 'API_ERROR',
      };
    }

    const data = (await res.json()) as { orders?: Cafe24AdminOrder[] };
    const batch = data.orders || [];
    allOrders.push(...batch);

    if (batch.length < limit) break;
    if (page === maxPages - 1 && batch.length >= limit) {
      reachedMaxPages = true;
    }
    offset += limit;
  }

  return {
    ok: true,
    orders: allOrders,
    total: allOrders.length,
    checkedDays: days,
    hasMore: reachedMaxPages,
  };
}
