-- ============================================================
--  AJUSTE: financeiro_modalidade_check
--  Permite os valores que o CRM usa hoje: 'A Vista', 'À Vista'
--  e 'Parcelado'. Idempotente.
-- ============================================================

alter table public.financeiro
  drop constraint if exists financeiro_modalidade_check;

alter table public.financeiro
  add constraint financeiro_modalidade_check
  check (modalidade is null or modalidade in ('A Vista', 'À Vista', 'Parcelado'));
