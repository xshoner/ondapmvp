// Gemini 호출 (서버 전용)
// 키: 환경변수 ondap_ai
// 모델: ONDAP_AI_MODEL(기본 gemini-3.6-flash) → 실패하면 ONDAP_AI_FALLBACK_MODEL(기본 gemini-flash-latest, 빈 값이면 끔)
// 일시 오류(429·500·503·504)는 잠깐 기다렸다 다시 시도하고, 그래도 안 되면 대체 모델로 넘어간다.

import { ApiError, GoogleGenAI } from '@google/genai';

export const DEFAULT_AI_MODEL = 'gemini-3.6-flash';
export const DEFAULT_FALLBACK_MODEL = 'gemini-flash-latest';
const RETRYABLE = new Set([429, 500, 503, 504]);
// 한 번 호출의 최대 대기 시간. 넘으면 끊고 다음 모델로 (응답이 늦어 화면이 마냥 '검토 중'에 머무는 것 방지)
export const CALL_TIMEOUT_MS = 40_000;

export function aiModels(env: Record<string, string | undefined> = process.env): string[] {
  const primary = env.ONDAP_AI_MODEL || DEFAULT_AI_MODEL;
  const fallback = env.ONDAP_AI_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL;
  return [...new Set([primary, fallback].filter((m): m is string => Boolean(m && m.trim())))];
}

export type ModelCall = (model: string) => Promise<string | undefined>;

export interface RetryOptions {
  attemptsPerModel?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const statusOf = (e: unknown): number | null => (e instanceof ApiError ? e.status : typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : null);

const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

function friendly(status: number | null, model: string, timedOut = false): string {
  if (timedOut) return 'AI 응답이 너무 늦습니다. 잠시 뒤 다시 시도하세요.';
  if (status === 429) return 'AI 무료 사용량 한도를 넘었습니다. 1분쯤 뒤 다시 시도하세요.';
  if (status === 503 || status === 500 || status === 504) return 'AI 서버가 지금 붐빕니다. 잠시 뒤 다시 시도하세요.';
  if (status === 404) return `모델 ${model}을 찾을 수 없습니다. 환경변수 ONDAP_AI_MODEL을 확인하세요.`;
  if (status === 400 || status === 401 || status === 403) return 'AI 키 또는 요청이 거부됐습니다. 환경변수 ondap_ai를 확인하세요.';
  return 'AI 호출에 실패했습니다.';
}

// 모델 목록을 차례로 시도한다. 일시 오류는 같은 모델로 재시도, 404·최종 실패는 다음 모델로
export async function callWithRetry(
  models: string[],
  call: ModelCall,
  opts: RetryOptions = {},
): Promise<{ text: string; model: string }> {
  const attempts = opts.attemptsPerModel ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = opts.log ?? ((m) => console.warn(m));
  let last: { status: number | null; model: string; timedOut?: boolean } = { status: null, model: models[0] ?? '' };

  for (const model of models) {
    for (let i = 0; i < attempts; i++) {
      try {
        const text = await call(model);
        if (!text) throw Object.assign(new Error('빈 응답'), { status: null });
        return { text, model };
      } catch (e) {
        const status = statusOf(e);
        last = { status, model, timedOut: isTimeout(e) };
        log(`[ondap_ai] ${model} 시도 ${i + 1}/${attempts} 실패: ${status ?? '-'} ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
        if (status === null || !RETRYABLE.has(status)) break; // 재시도해도 소용없는 오류 → 다음 모델
        if (i < attempts - 1) await sleep(base * 2 ** i);
      }
    }
  }
  const tried = models.length > 1 ? ` (시도한 모델: ${models.join(', ')})` : '';
  throw new Error(`${friendly(last.status, last.model, last.timedOut)}${last.status ? ` [${last.status}]` : ''}${tried}`);
}

export async function generateJson(args: { system: string; user: string; schema: Record<string, unknown> }): Promise<{ data: unknown; model: string }> {
  const apiKey = process.env.ondap_ai;
  if (!apiKey) throw new Error('AI 키가 없습니다. 환경변수 ondap_ai를 설정하세요.');
  const ai = new GoogleGenAI({ apiKey });

  const { text, model } = await callWithRetry(aiModels(), async (m) => {
    const res = await ai.models.generateContent({
      model: m,
      contents: args.user,
      config: {
        systemInstruction: args.system,
        responseMimeType: 'application/json',
        responseJsonSchema: args.schema,
        temperature: 0.2,
        maxOutputTokens: 4096,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      },
    });
    return res.text;
  });

  try {
    return { data: JSON.parse(text), model };
  } catch {
    throw new Error('AI 응답을 JSON으로 읽지 못했습니다.');
  }
}
