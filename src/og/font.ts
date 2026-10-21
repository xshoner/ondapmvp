// 공유 미리보기 그림(ImageResponse)에 쓸 한글 글꼴: 그림에 들어갈 글자만 Google Fonts에서 받는다.
// ImageResponse는 woff2를 못 읽으므로, 옛 브라우저인 척 요청해 woff를 받는다. 실패하면 null(글꼴 없이 그림).

const OLD_UA = 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Chrome/12.0.742.112 Safari/534.30';
const cache = new Map<string, Promise<ArrayBuffer | null>>();

export function loadGoogleFont(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  const chars = [...new Set(text)].join('');
  const key = `${family}:${weight}:${chars}`;
  if (!cache.has(key)) {
    if (cache.size > 200) cache.clear();
    cache.set(key, (async () => {
      try {
        const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weight}&text=${encodeURIComponent(chars)}`;
        const css = await (await fetch(url, { headers: { 'User-Agent': OLD_UA }, signal: AbortSignal.timeout(5000) })).text();
        const src = css.match(/src: url\((.+?)\) format\('(?:woff|truetype|opentype)'\)/)?.[1];
        if (!src) return null;
        return await (await fetch(src, { signal: AbortSignal.timeout(5000) })).arrayBuffer();
      } catch {
        return null;
      }
    })());
  }
  return cache.get(key)!;
}

type FontEntry = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700; style: 'normal' };

// 제목(명조)·본문(고딕) 두 벌을 받아 ImageResponse fonts 옵션으로
export async function ogFonts(serifText: string, sansText: string): Promise<FontEntry[]> {
  const [serif, sans] = await Promise.all([
    loadGoogleFont('Hahmlet', 600, serifText),
    loadGoogleFont('Noto Sans KR', 600, sansText),
  ]);
  const out: FontEntry[] = [];
  if (serif) out.push({ name: 'Hahmlet', data: serif, weight: 600, style: 'normal' });
  if (sans) out.push({ name: 'Noto Sans KR', data: sans, weight: 600, style: 'normal' });
  return out;
}

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_COLORS = { paper: '#f3f4f1', ink: '#1c2420', muted: '#66706a', pine: '#1f4436', brass: '#8a6a35', seal: '#b03a2e', line: '#dde0d9' };
