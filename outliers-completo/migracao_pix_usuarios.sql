-- ============================================================
--  PIX em PROFILES + telefone (opcional)
--  Adiciona campo `pix` para registrar chave PIX de cada usuario.
--  Usado para pagamento manual de comissoes.
--
--  Idempotente.
-- ============================================================

alter table public.profiles add column if not exists pix text;
alter table public.profiles add column if not exists telefone text;
