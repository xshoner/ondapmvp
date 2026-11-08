import { normalizeDesignCode } from '../packaging/rules.ts';
import { PACKAGING_NEGATIVE_VALUE_REGEX, PACKAGING_OPTION_NAME_REGEX, PACKAGING_POSITIVE_VALUE_REGEX } from './client.ts';
import { getValidAccessToken } from './oauth.ts';

export interface Cafe24AdminOrderItem {
  item_no?: number;
  order_item_code?: string;
  product_no: number;
  product_name: string;
  quantity: number;
  status?: string;
  options?: { name: string; value: string }[];
  additional_option?: { name: string; value: string }[] | Record<string, unknown>[];
  option_value?: string;
}

export interface Cafe24AdditionalOrderInfo {
  id?: number;
  name: string;
  value: string;
}

export interface Cafe24AdminOrder {
  order_id: string;
  shop_no: number;
  order_date: string;
  paid?: string;          // 'T': 결제완료, 'F': 미결제
  canceled?: string;      // 'T': 취소, 'F': 정상
  payment_status?: string; // 'F': 미결제, 'M': 추가입금대기, 'T': 수동입금, 'A': 자동입금, 'P': 결제완료
  order_status?: string;   // 'N00': 입금전, 'N10': 상품준비중, 'C00'-'C49': 취소
  items: Cafe24AdminOrderItem[];
  additional_order_info_list?: Cafe24AdditionalOrderInfo[];
}

export function isOrderPaid(order: Cafe24AdminOrder): boolean {
  if (!order) return false;
  // 1. 취소 주문 제외
  if (order.canceled === 'T') return false;
  if (typeof order.order_status === 'string' && order.order_status.startsWith('C')) return false;

  // 2. paid 필드 확인 (Cafe24 2026-09-01 사양)
  if (order.paid === 'F') return false;
  if (order.paid === 'T') return true;

  // 3. payment_status / order_status 필드 확인 (호환성)
  if (order.payment_status && ['F', 'M'].includes(order.payment_status)) return false;
  if (order.order_status === 'N00') return false;
  if (order.payment_status && ['T', 'A', 'P'].includes(order.payment_status)) return true;

  return false;
}

export function isOrderCanceled(order: Cafe24AdminOrder): boolean {
  if (!order) return false;
  if (order.canceled === 'T') return true;
  if (typeof order.order_status === 'string' && order.order_status.startsWith('C')) return true;
  return false;
}

export function extractDesignCode(order: Cafe24AdminOrder): string | null {
  if (!order) return null;

  // 1. 주문 공통 추가 정보(additional_order_info_list)에서 탐색
  if (Array.isArray(order.additional_order_info_list)) {
    for (const info of order.additional_order_info_list) {
      if (!info || typeof info.value !== 'string') continue;
      const val = info.value.trim();
      const code = normalizeDesignCode(val);
      if (code) return code;
    }
  }

  // 2. 품목별 옵션(options 또는 additional_option)에서 탐색
  if (Array.isArray(order.items)) {
    for (const item of order.items) {
      if (Array.isArray(item.options)) {
        for (const opt of item.options) {
          const code = normalizeDesignCode(opt.value);
          if (code) return code;
        }
      }
      if (Array.isArray(item.additional_option)) {
        for (const opt of item.additional_option as { name?: string; value?: string }[]) {
          if (typeof opt?.value === 'string') {
            const code = normalizeDesignCode(opt.value);
            if (code) return code;
          }
        }
      }
      if (typeof item.option_value === 'string') {
        const match = item.option_value.match(/OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/);
        if (match) return normalizeDesignCode(match[0]);
      }
    }
  }

  return null;
}

export function hasPackagingOption(item: Cafe24AdminOrderItem): boolean {
  if (!item) return false;

  const check = (name: string, value: string): boolean => {
    if (!PACKAGING_OPTION_NAME_REGEX.test(name)) return false;
    if (PACKAGING_NEGATIVE_VALUE_REGEX.test(value)) return false;
    return PACKAGING_POSITIVE_VALUE_REGEX.test(value);
  };

  if (typeof item.option_value === 'string') {
    if (PACKAGING_OPTION_NAME_REGEX.test(item.option_value) && !PACKAGING_NEGATIVE_VALUE_REGEX.test(item.option_value)) {
      return true;
    }
  }

  if (Array.isArray(item.options)) {
    for (const opt of item.options as Record<string, unknown>[]) {
      const name = String(opt.option_name || opt.name || '');
      let val = '';
      if (typeof opt.option_value === 'object' && opt.option_value !== null) {
        val = String((opt.option_value as { option_text?: unknown }).option_text || '');
      } else if (typeof opt.option_value === 'string') {
        val = opt.option_value;
      } else if (typeof opt.value === 'string') {
        val = opt.value;
      }
      if (check(name, val)) return true;
    }
  }

  if (Array.isArray(item.additional_option)) {
    for (const opt of item.additional_option as Record<string, unknown>[]) {
      const name = String(opt.option_name || opt.name || '');
      const val = String(opt.value || '');
      if (check(name, val)) return true;
    }
  }

  return false;
}

export async function fetchAdminOrder(orderId: string, customToken?: string): Promise<Cafe24AdminOrder> {
  const mallId = (process.env.CAFE24_MALL_ID || '').trim();
  if (!mallId) throw new Error('CAFE24_MALL_ID 환경변수가 필요합니다.');
  if (!/^20\d{6}-\d{7}$/.test(orderId)) throw new Error('주문번호 형식이 올바르지 않습니다.');

  const token = customToken || (await getValidAccessToken());
  const apiVersion = (process.env.CAFE24_API_VERSION || '2026-09-01').trim();

  const url = `https://${mallId}.cafe24api.com/api/v2/admin/orders/${orderId}?embed=items`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Cafe24-Api-Version': apiVersion,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`카페24 주문 조회 실패 (${res.status})`);
  }

  const body = (await res.json()) as { order?: Cafe24AdminOrder };
  if (!body || !body.order) throw new Error('카페24 주문 데이터가 비어 있습니다.');

  const order = body.order;
  // items가 embed 되지 않았거나 비어있는 경우 별도 items 엔드포인트 조회
  if (!Array.isArray(order.items) || order.items.length === 0) {
    const itemsUrl = `https://${mallId}.cafe24api.com/api/v2/admin/orders/${orderId}/items`;
    const itemsRes = await fetch(itemsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Cafe24-Api-Version': apiVersion,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
    if (itemsRes.ok) {
      const itemsBody = (await itemsRes.json()) as { items?: Cafe24AdminOrderItem[] };
      if (Array.isArray(itemsBody?.items)) {
        order.items = itemsBody.items;
      }
    }
  }

  return order;
}
