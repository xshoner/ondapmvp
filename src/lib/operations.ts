// 원문 오류·URL·요청 본문·고객 정보를 기록하지 않는다. 수집기는 이 JSON 행을 경보로 연결할 수 있다.
export const OPERATIONS = ['catalog_sync', 'catalog_read', 'recommendation_log', 'feedback_save', 'design_save', 'design_lookup', 'print_export', 'health_check'] as const;
export type Operation = typeof OPERATIONS[number];
export type OperationEvent = { operation: Operation; outcome: 'ok' | 'error'; code: string; durationMs: number };

export function operationEvent(operation: Operation, outcome: 'ok' | 'error', startedAt: number, code = 'ok'): OperationEvent {
  return { operation, outcome, code: /^[a-z0-9_]{1,40}$/.test(code) ? code : 'unknown', durationMs: Math.max(0, Math.min(3600000, Date.now() - startedAt)) };
}

export function reportOperation(operation: Operation, outcome: 'ok' | 'error', startedAt: number, code = 'ok'): OperationEvent {
  const event = operationEvent(operation, outcome, startedAt, code);
  const line = JSON.stringify({ kind: 'ondap_operation', ...event });
  if (outcome === 'error') console.error(line);
  else console.info(line);
  return event;
}
