'use client';

// 포장 스타일·추천 이미지·추천 문구 관리. 이미지·문구는 행사 분류별로 '사용' 최대 10개
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CATEGORY_ORDER, MAX_ACTIVE } from '@/packaging/rules.ts';
import type { DesignCategory, PackagingAssets } from '@/packaging/types.ts';
import { deleteAssetAction, saveAssetAction, uploadAssetAction } from './actions.ts';

type Kind = 'styles' | 'images' | 'texts';
type Item = { id: string; active: boolean; sort: number; name?: string; description?: string; imageUrl?: string; category?: DesignCategory; text?: string };

type Props = { kind: Kind; assets: PackagingAssets; categoryNames: Record<string, string> };

const HELP: Record<Kind, string> = {
  styles: '고객이 고르는 실물 포장(포장지·보자기 등) 사진입니다. 정사각형 사진을 권장하며, 올리면 1200px로 줄여 저장합니다.',
  images: '스티커 바탕으로 쓰는 추천 이미지입니다. 고객 행사에 맞는 분류가 먼저 보이고, ‘공통’은 모든 행사에 보입니다. 정사각형 800px 이상 권장.',
  texts: '스티커에 넣는 추천 문구입니다. {받는분} {보내는분} {날짜}를 쓰면 고객이 적은 이름으로 바뀝니다. 줄바꿈도 그대로 들어갑니다.',
};

// 올리기 전에 브라우저에서 줄여 용량을 낮춘다 (서버 액션 본문 한도, 고객 화면 속도)
async function shrink(file: File, max: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const toBlob = (type: string, q: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  const webp = await toBlob('image/webp', 0.85);
  if (webp && webp.type === 'image/webp') return webp;
  const jpg = await toBlob('image/jpeg', 0.88);
  if (!jpg) throw new Error('이미지를 변환하지 못했습니다.');
  return jpg;
}

export function AssetManager({ kind, assets, categoryNames }: Props) {
  const all = assets[kind] as Item[];
  const byCategory = kind !== 'styles';
  const [category, setCategory] = useState<DesignCategory>(() => (all[0]?.category as DesignCategory) ?? 'common');
  const items = byCategory ? all.filter((x) => x.category === category) : all;
  const activeCount = items.filter((x) => x.active).length;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p className="small muted" style={{ margin: 0 }}>{HELP[kind]}</p>

      {byCategory && (
        <div className="chips">
          {CATEGORY_ORDER.map((c) => {
            const list = all.filter((x) => x.category === c);
            return (
              <button key={c} type="button" className="chip" aria-pressed={c === category} onClick={() => setCategory(c)}>
                {categoryNames[c]} <span className="small" style={{ opacity: 0.7 }}>{list.filter((x) => x.active).length}/{list.length}</span>
              </button>
            );
          })}
        </div>
      )}

      <AddForm kind={kind} category={category} categoryName={categoryNames[category]} nextSort={Math.max(0, ...items.map((x) => x.sort)) + 1} />

      <div className="spread">
        <b className="small">{byCategory ? `${categoryNames[category]} ` : ''}사용 {activeCount}/{MAX_ACTIVE}</b>
        <span className="small muted">순서 숫자가 작을수록 먼저 보입니다</span>
      </div>
      {items.length === 0 ? (
        <p className="small muted">아직 없습니다.</p>
      ) : (
        <div className={kind === 'texts' ? 'asset-list' : 'asset-grid'}>
          {items.map((item) => <AssetCard key={item.id} kind={kind} item={item} categoryNames={categoryNames} />)}
        </div>
      )}
    </div>
  );
}

function AddForm({ kind, category, categoryName, nextSort }: { kind: Kind; category: DesignCategory; categoryName: string; nextSort: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = () => start(async () => {
    setMessage(null);
    try {
      let imageUrl: string | undefined;
      if (kind !== 'texts') {
        const file = fileRef.current?.files?.[0];
        if (!file) return setMessage('이미지 파일을 골라 주세요.');
        const form = new FormData();
        form.set('folder', kind === 'styles' ? 'styles' : 'images');
        form.set('file', await shrink(file, kind === 'styles' ? 1200 : 1000));
        const up = await uploadAssetAction(form);
        if (!up.ok) return setMessage(up.message);
        imageUrl = up.url;
      }
      const res = await saveAssetAction(kind, { id: '', active: true, sort: nextSort, name, description, text, category, imageUrl });
      if (!res.ok) return setMessage(res.message);
      setName(''); setDescription(''); setText('');
      if (fileRef.current) fileRef.current.value = '';
      setMessage('추가했습니다.');
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  });

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="field-label" style={{ marginBottom: 10 }}>
        {kind === 'styles' ? '새 포장 스타일' : `${categoryName}에 ${kind === 'images' ? '추천 이미지' : '추천 문구'} 추가`}
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        {kind !== 'texts' && (
          <div className="field" style={{ margin: 0, width: 200 }}>
            <label>{kind === 'styles' ? '스타일 이름' : '이름 (관리용)'}</label>
            <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        {kind === 'styles' && (
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 220 }}>
            <label>설명 (고객에게 보임)</label>
            <input type="text" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
          </div>
        )}
        {kind === 'texts' && (
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 260 }}>
            <label>문구</label>
            <textarea value={text} maxLength={200} rows={2} onChange={(e) => setText(e.target.value)} placeholder={'예: 와주셔서 감사합니다\n{보내는분} 올림'} />
          </div>
        )}
        {kind !== 'texts' && (
          <div className="field" style={{ margin: 0 }}>
            <label>이미지 (PNG·JPG·WEBP)</label>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" />
          </div>
        )}
        <button type="button" className="btn small" disabled={pending} onClick={submit}>{pending ? '추가하는 중…' : '추가'}</button>
      </div>
      {message && <p className="small" style={{ margin: '8px 0 0' }}>{message}</p>}
    </div>
  );
}

function AssetCard({ kind, item, categoryNames }: { kind: Kind; item: Item; categoryNames: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(item);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(item);

  const save = (next: Item) => start(async () => {
    setMessage(null);
    const res = await saveAssetAction(kind, next);
    if (!res.ok) {
      setMessage(res.message);
      setDraft(item);
      return;
    }
    router.refresh();
  });

  const remove = () => {
    if (!confirm('삭제할까요? 이미 저장된 고객 디자인에는 영향이 없습니다.')) return;
    start(async () => {
      const res = await deleteAssetAction(kind, item.id);
      if (!res.ok) setMessage(res.message);
      else router.refresh();
    });
  };

  return (
    <div className="panel asset-card" style={{ opacity: draft.active ? 1 : 0.6 }}>
      {draft.imageUrl && <img src={draft.imageUrl} alt="" />}
      <div className="asset-body">
        {kind === 'texts' ? (
          <textarea value={draft.text} rows={2} maxLength={200} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        ) : (
          <input type="text" value={draft.name ?? ''} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="이름" />
        )}
        {kind === 'styles' && (
          <input type="text" value={draft.description ?? ''} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} aria-label="설명" />
        )}
        <div className="row" style={{ gap: 8 }}>
          <label className="small row" style={{ gap: 4 }}>
            <input type="checkbox" checked={draft.active} disabled={pending} onChange={(e) => { const next = { ...draft, active: e.target.checked }; setDraft(next); save(next); }} />
            사용
          </label>
          <label className="small row" style={{ gap: 4 }}>
            순서
            <input type="number" value={draft.sort} style={{ width: 56 }} onChange={(e) => setDraft({ ...draft, sort: Number(e.target.value) })} />
          </label>
          {kind !== 'styles' && (
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as DesignCategory })} aria-label="분류">
              {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{categoryNames[c]}</option>)}
            </select>
          )}
          <span style={{ flex: 1 }} />
          {dirty && <button type="button" className="btn small" disabled={pending} onClick={() => save(draft)}>저장</button>}
          <button type="button" className="btn ghost small" disabled={pending} style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={remove}>삭제</button>
        </div>
        {message && <p className="small" style={{ margin: 0, color: 'var(--red)' }}>{message}</p>}
      </div>
    </div>
  );
}
