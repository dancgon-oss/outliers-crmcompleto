-- ============================================================
--  STORYDOING ↔ ZAPSIGN: liga locações ao contrato assinado
--  + permite associar cliente diretamente
--  Idempotente
-- ============================================================

alter table public.storydoing_locacoes
  add column if not exists zapsign_doc_token text,
  add column if not exists cliente_id        uuid references public.clientes(id) on delete set null;

create index if not exists storydoing_zapsign_token_idx on public.storydoing_locacoes (zapsign_doc_token);
create index if not exists storydoing_cliente_idx       on public.storydoing_locacoes (cliente_id);

-- Garante que data_locacao aceita ser preenchida sem hora (já é o caso)
-- Garante que valor pode ser 0 (pra placeholder quando ZapSign não trouxe valor)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='storydoing_locacoes'
      and column_name='valor' and is_nullable='NO'
  ) then
    -- Mantém NOT NULL, mas valor=0 é aceito; não precisa ajustar.
    null;
  end if;
end$$;
