// repository.ts·packaging-repository.ts가 함께 쓰는 Supabase 읽기 도우미

type DbError = { message: string; code?: string };
export type DbPage<T> = PromiseLike<{ data: T[] | null; error: DbError | null }>;

export function fail(what: string, error: DbError | null): never {
  throw new Error(`${what} 실패: ${error?.message ?? '알 수 없는 오류'}`);
}

// PostgREST는 한 번에 1,000행까지만 준다: limit까지 1,000행씩 나눠 읽는다. 중간에 오류가 나면 그때까지 읽은 행과 오류를 돌려준다
export async function readPages<T>(
  page: (from: number, to: number) => DbPage<T>,
  limit = 20000,
  requireComplete = false,
): Promise<{ rows: T[]; error: DbError | null }> {
  const rows: T[] = [];
  for (let from = 0; from < limit; from += 1000) {
    const { data, error } = await page(from, Math.min(limit, from + 1000) - 1);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  if (requireComplete && rows.length === limit) {
    const extra = await page(limit, limit);
    if (extra.error) return { rows, error: extra.error };
    if (extra.data?.length) return { rows: [], error: { code: 'limit_exceeded', message: '조회 상한을 넘어 전체 자료를 확인하지 못했습니다.' } };
  }
  return { rows, error: null };
}
