-- ============================================================
--  BACKFILL: cria storydoing_locacoes para contratos Storydoing
--  já assinados via ZapSign mas que ainda não geraram locação.
--
--  PRÉ-REQUISITO: rodar migracao_storydoing_zapsign.sql antes
--  (adiciona zapsign_doc_token + cliente_id na tabela)
-- ============================================================

with contratos_sd as (
  select
    c.id              as contrato_id,
    c.cliente_id,
    c.zapsign_doc_token,
    c.texto_contrato  as doc_name,
    c.payload_zapsign as payload,
    c.assinado_at,
    case
      when lower(coalesce(c.texto_contrato,'')) like '%black%' then 'black'
      when lower(coalesce(c.texto_contrato,'')) like '%white%' then 'white'
      else null
    end as sala
  from public.contratos c
  where c.assinado = true
    and c.cliente_id is not null
    and (
      lower(coalesce(c.texto_contrato,'')) like '%storydoing%' or
      lower(coalesce(c.texto_contrato,'')) like '%locação%' or
      lower(coalesce(c.texto_contrato,'')) like '%locacao%' or
      lower(coalesce(c.texto_contrato,'')) like '%sala black%' or
      lower(coalesce(c.texto_contrato,'')) like '%sala white%'
    )
)
insert into public.storydoing_locacoes (
  sala, data_locacao, valor, locador_nome, locador_telefone, locador_email,
  locador_documento, observacoes, status_pagamento, cliente_id, zapsign_doc_token
)
select
  cs.sala,
  coalesce(cs.assinado_at::date, current_date) as data_locacao,
  0 as valor,
  coalesce(cl.nome, 'Locador') as locador_nome,
  cl.telefone,
  cl.email,
  cl.cpf as locador_documento,
  concat(
    'Contrato ZapSign: ', coalesce(cs.doc_name, '(sem nome)'),
    ' • ⚠ BACKFILL: preencher valor/forma de pagamento/data manualmente'
  ) as observacoes,
  'Pendente' as status_pagamento,
  cs.cliente_id,
  cs.zapsign_doc_token
from contratos_sd cs
join public.clientes cl on cl.id = cs.cliente_id
where cs.sala is not null
  and not exists (
    select 1 from public.storydoing_locacoes sl
    where (cs.zapsign_doc_token is not null and sl.zapsign_doc_token = cs.zapsign_doc_token)
       or (sl.cliente_id = cs.cliente_id and sl.created_at::date = coalesce(cs.assinado_at::date, current_date))
  );

-- Mostra o que foi criado
select id, sala, data_locacao, locador_nome, cliente_id, observacoes
from public.storydoing_locacoes
where observacoes like '%BACKFILL%'
order by created_at desc;
