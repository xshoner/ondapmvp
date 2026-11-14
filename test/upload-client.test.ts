import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadPrintBlob } from '../src/app/packaging/upload-client.ts';

test('서명 업로드는 공개 API 키와 이미지 데이터를 전송한다', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal((init?.headers as Record<string, string>).apikey, 'public-test-key');
      assert.equal(init?.method, 'PUT');
      assert.ok(init?.body instanceof FormData);
      assert.ok(init.body.get('') instanceof Blob);
      return new Response('', { status: 200 });
    };
    await uploadPrintBlob({ signedUrl: 'https://example.invalid/object/upload/sign/file?token=test', path: 'file', maxBytes: 100 }, new Blob(['png']));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  }
});
