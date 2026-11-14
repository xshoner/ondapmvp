// 로컬 모드용 임시 인쇄 파일 업로드 엔드포인트
// Supabase 모드에서는 브라우저가 Supabase Storage 서명 URL로 직접 업로드하므로 이 라우트를 거치지 않는다.

import { NextRequest, NextResponse } from 'next/server';
import { dataSource } from '@/lib/supabase/env.ts';
import { saveLocalSessionFile } from '@/data/upload-session-repository.ts';

export async function PUT(request: NextRequest) {
  return handleUpload(request);
}

export async function POST(request: NextRequest) {
  return handleUpload(request);
}

async function handleUpload(request: NextRequest) {
  if (dataSource() !== 'local') {
    return NextResponse.json({ ok: false, message: 'Supabase 모드에서는 스토리지 직접 업로드를 사용합니다.' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const session = searchParams.get('session');
  const item = searchParams.get('item');
  const secret = searchParams.get('secret');

  if (!session || !item || !secret || (item !== 'sticker' && item !== 'card')) {
    return NextResponse.json({ ok: false, message: '잘못된 업로드 파라미터입니다.' }, { status: 400 });
  }

  let bytes: Uint8Array;
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('') || formData.get('file');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, message: '파일이 전송되지 않았습니다.' }, { status: 400 });
    }
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    bytes = new Uint8Array(await request.arrayBuffer());
  }

  const res = saveLocalSessionFile(session, item, secret, bytes);
  if (!res.ok) {
    return NextResponse.json({ ok: false, message: res.message }, { status: res.status });
  }

  return NextResponse.json({ ok: true });
}
