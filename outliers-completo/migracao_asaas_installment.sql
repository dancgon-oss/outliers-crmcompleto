-- Adiciona rastreio do "installment" do Asaas (ID do parcelamento pai)
-- para que parcelas emitidas como grupo no Asaas saibam a qual venda
-- parcelada pertencem. Cada parcela continua tendo seu proprio
-- asaas_payment_id; o installment_id e' compartilhado entre as N parcelas
-- do mesmo parcelamento.
ALTER TABLE parcelas
  ADD COLUMN IF NOT EXISTS asaas_installment_id TEXT;

CREATE INDEX IF NOT EXISTS idx_parcelas_asaas_installment_id
  ON parcelas (asaas_installment_id);
