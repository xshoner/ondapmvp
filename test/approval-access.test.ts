import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCreatorToken, hashCreatorToken, buildCreatorCookie, extractCreatorToken, canAccessDraftWithToken } from '../src/approval/auth.ts';
import { isValidApprovalOrigin } from '../src/approval/guard.ts';
import type { ApprovalDraft } from '../src/approval/types.ts';

test('approval access rejects public legacy drafts, URL tokens and malformed cookies; production cookie is secure', async () => {
  const env = process.env as Record<string, string | undefined>;
  const original = { node: process.env.NODE_ENV, mode: process.env.ONDAP_DATA_SOURCE };
  env.NODE_ENV = 'production'; process.env.ONDAP_DATA_SOURCE = 'local';
  try {
    const draft = { id: '11111111-2222-4333-8444-555555555555' } as ApprovalDraft;
    assert.equal(await canAccessDraftWithToken(null, draft), false);
    const token = generateCreatorToken(); draft.creatorTokenHash = hashCreatorToken(token);
    assert.equal(await canAccessDraftWithToken(token, draft), true);
    assert.equal(await canAccessDraftWithToken('wrong', draft), false);
    assert.equal(extractCreatorToken(new Request(`https://example.com/?token=${token}`), draft.id), null);
    assert.equal(extractCreatorToken(new Request('https://example.com/', { headers: { cookie: `ondap_approval_${draft.id}=%XX` } }), draft.id), null);
    assert.match(buildCreatorCookie(draft.id, token), /; Secure/);
  } finally { if (original.node === undefined) delete env.NODE_ENV; else env.NODE_ENV = original.node; if (original.mode === undefined) delete process.env.ONDAP_DATA_SOURCE; else process.env.ONDAP_DATA_SOURCE = original.mode; }
});

test('approval origin requires exact protocol, host and port', () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com';
  try {
    const request = (origin: string) => new Request('https://example.com/api/approval', { headers: { origin } });
    assert.equal(isValidApprovalOrigin(request('https://example.com')), true);
    assert.equal(isValidApprovalOrigin(new Request('http://localhost:3331/api/approval', { headers: { host: '127.0.0.1:3331', origin: 'http://127.0.0.1:3331' } })), true);
    for (const origin of ['https://child.example.com', 'https://example.com:444', 'http://example.com', 'http://localhost:3000']) assert.equal(isValidApprovalOrigin(request(origin)), false);
  } finally { if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = original; }
});
