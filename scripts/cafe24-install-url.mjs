// 카페24 앱 설치(운영자 동의)용 주소 만들기
// 사용법: node scripts/cafe24-install-url.mjs
// 출력된 주소를 쇼핑몰 운영자 계정으로 로그인된 브라우저에서 열고 동의하면 앱이 설치됩니다.
// 동의 후 Redirect URI로 돌아오며 주소창에 code=...가 붙습니다(1분 유효, 지금은 사용하지 않음).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const { CAFE24_MALL_ID: mallId, CAFE24_CLIENT_ID: clientId, CAFE24_REDIRECT_URI: redirectUri } = env;
const scope = env.CAFE24_SCOPE || 'mall.read_product';

if (!mallId || !clientId || !redirectUri) {
  console.error('.env.local에 CAFE24_MALL_ID, CAFE24_CLIENT_ID, CAFE24_REDIRECT_URI를 채워 주세요.');
  process.exit(1);
}

const params = new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  state: randomBytes(12).toString('hex'),
  redirect_uri: redirectUri,
  scope,
});

console.log(`https://${mallId}.cafe24api.com/api/v2/oauth/authorize?${params}`);
