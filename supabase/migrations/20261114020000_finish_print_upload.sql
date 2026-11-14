-- 파일 검증 후 접수와 업로드 세션 완료를 한 트랜잭션으로 기록한다.
alter table public.design_upload_sessions add column cleaned_at timestamptz;
create or replace function public.finish_design_upload(p_session_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.design_upload_sessions%rowtype;
begin
  select * into s from public.design_upload_sessions where id = p_session_id for update;
  if not found then raise exception '업로드 세션을 찾을 수 없습니다.'; end if;
  if s.status = 'completed' then return s.code; end if;
  if s.status <> 'pending' or s.expires_at <= now() then
    raise exception '업로드 세션이 만료되었거나 완료할 수 없습니다.';
  end if;
  insert into public.designs (code, product_no, product_name, quantity, event, style_id, style_name, sticker, draft, print_path, card, card_draft, card_print_path)
  values (s.code, (s.meta->>'productNo')::integer, s.meta->>'productName', (s.meta->>'quantity')::integer,
    s.meta->>'event', nullif(s.meta->>'styleId', '')::uuid, s.meta->>'styleName',
    nullif(s.meta->'sticker', 'null'::jsonb), nullif(s.meta->'draft', 'null'::jsonb),
    case when s.files_expected ? 'sticker' then s.code || '.png' end,
    nullif(s.meta->'card', 'null'::jsonb), nullif(s.meta->'cardDraft', 'null'::jsonb),
    case when s.files_expected ? 'card' then s.code || '-card.png' end);
  update public.design_upload_sessions set status = 'completed' where id = s.id;
  return s.code;
end;
$$;
revoke all on function public.finish_design_upload(text) from public, anon, authenticated;
grant execute on function public.finish_design_upload(text) to service_role;
