-- ============================================================
--  PARCELAS: garante coluna `forma_pagamento` para suportar
--  multiplas formas dentro da mesma venda (ex: entrada PIX +
--  restante metade cartao metade boleto).
--
--  Idempotente.
-- ============================================================

alter table public.parcelas add column if not exists forma_pagamento text;

-- Indice util pra relatorios por forma
create index if not exists parcelas_forma_pagamento_idx on public.parcelas (forma_pagamento);
