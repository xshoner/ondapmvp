// Gemini 호출 (서버 전용). 키는 환경변수 ondap_ai, 모델은 ONDAP_AI_MODEL(기본 gemini-3.6-flash)

import { ApiError, GoogleGenAI } from '@google/genai';

export const DEFAULT_AI_MODEL = 'gemini-3.6-flash';

export function aiModel(): string {
  return process.env.ONDAP_AI_MODEL || DEFAULT_AI_MODEL;
}

export async function generateJson(args: { system: string; user: string; schema: Record<string, unknown> }): Promise<{ data: unknown; model: string }> {
  const apiKey = process.env.ondap_ai;
  if (!apiKey) throw new Error('AI 키가 없습니다. 환경변수 ondap_ai를 설정하세요.');
  const model = aiModel();
  const ai = new GoogleGenAI({ apiKey });

  let text: string | undefined;
  try {
    const res = await ai.models.generateContent({
      model,
      contents: args.user,
      config: {
        systemInstruction: args.system,
        responseMimeType: 'application/json',
        responseJsonSchema: args.schema,
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
    });
    text = res.text;
  } catch (e) {
    if (e instanceof ApiError) {
      const hint = e.status === 429 ? ' (무료 사용량 한도를 넘었습니다. 잠시 후 다시 시도하세요)'
        : e.status === 404 ? ` (모델 ${model}을 찾을 수 없습니다. ONDAP_AI_MODEL을 확인하세요)`
          : e.status === 400 || e.status === 403 ? ' (키 또는 요청을 확인하세요)' : '';
      throw new Error(`AI 호출 실패 ${e.status}${hint}`);
    }
    throw new Error(`AI 호출 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!text) throw new Error('AI 응답이 비어 있습니다.');
  try {
    return { data: JSON.parse(text), model };
  } catch {
    throw new Error('AI 응답을 JSON으로 읽지 못했습니다.');
  }
}
