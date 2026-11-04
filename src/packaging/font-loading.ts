// 글꼴 서버 장애가 인쇄 이미지 생성까지 막지 않도록, 사용 중인 글꼴만 제한 시간 동안 기다린다.
export async function loadCanvasFonts(
  fonts: Pick<FontFaceSet, 'load'>,
  requests: { font: string; text: string }[],
  timeoutMs = 4000,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(requests.map(async ({ font, text }) => fonts.load(font, text)))
        .then((results) => results.every((result) => result.status === 'fulfilled')),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
