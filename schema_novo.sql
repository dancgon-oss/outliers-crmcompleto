-- ============================================================
--  OUTLIERS CRM — Schema v4 — ADIÇÕES E MELHORIAS
--  Execute este arquivo no SQL Editor do Supabase
--  APÓS já ter executado o schema_completo.sql
-- ============================================================

-- ── ATUALIZA ROLES (adiciona comercial e financeiro) ─────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','operacional','comercial','financeiro'));

-- ── CATÁLOGO DE CURSOS / PRODUTOS ────────────────────────────
CREATE TABLE IF NOT EXISTS public.cursos (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome          text NOT NULL,
  descricao     text,
  preco_padrao  numeric(10,2) NOT NULL DEFAULT 0,
  categoria     text NOT NULL DEFAULT 'Outliers'
                CHECK (categoria IN ('Imersao','Outliers','Avulso')),
  ativo         boolean DEFAULT true,
  ordem         integer DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Produtos padrão do Outliers
INSERT INTO public.cursos (nome, descricao, preco_padrao, categoria, ordem) VALUES
('Imersão Paradigma',           'Evento presencial 3 dias — Inteligência Emocional, Coaching e PNL',   997.00,   'Imersao',  1),
('PQV — Qualificação de Vendas','Coaching de vendas de alta performance',                              3000.00,  'Outliers', 2),
('Método Cash',                 'Coaching de inteligência financeira',                                 3000.00,  'Outliers', 3),
('EVR — Empresário Vida Real',  'Mentoria para empresários e líderes',                                 5000.00,  'Outliers', 4),
('Speakrs Play',                'Formação de palestrantes profissionais',                              3000.00,  'Outliers', 5),
('Encontro Semanal em Grupo',   'Acompanhamento semanal em grupo durante o programa',                     0.00, 'Outliers', 6),
('Outliers Completo',           'Pacote completo: todos os cursos Outliers + acompanhamento 6 meses', 30000.00, 'Outliers', 7)
ON CONFLICT DO NOTHING;

-- ── CHECK-IN POR DIA ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checkin_dias (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  participante_id uuid REFERENCES public.participantes(id) ON DELETE CASCADE NOT NULL,
  evento_id       uuid REFERENCES public.eventos(id) NOT NULL,
  dia             integer NOT NULL CHECK (dia BETWEEN 1 AND 3),
  checkin_at      timestamptz DEFAULT now(),
  checkin_por     uuid REFERENCES public.profiles(id),
  observacao      text,
  UNIQUE(participante_id, dia)
);

CREATE INDEX IF NOT EXISTS idx_checkin_dias_participante ON public.checkin_dias(participante_id);
CREATE INDEX IF NOT EXISTS idx_checkin_dias_evento       ON public.checkin_dias(evento_id);

-- ── VENDAS (o que cada cliente comprou) ──────────────────────
CREATE TABLE IF NOT EXISTS public.vendas (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id  uuid REFERENCES public.clientes(id) ON DELETE CASCADE NOT NULL,
  curso_id    uuid REFERENCES public.cursos(id) NOT NULL,
  evento_id   uuid REFERENCES public.eventos(id),
  valor       numeric(10,2) NOT NULL,
  desconto    numeric(10,2) DEFAULT 0,
  data_venda  date DEFAULT current_date,
  observacoes text,
  criado_por  uuid REFERENCES public.profiles(id),
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendas_cliente ON public.vendas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_vendas_curso   ON public.vendas(curso_id);
CREATE INDEX IF NOT EXISTS idx_vendas_evento  ON public.vendas(evento_id);

-- ── CAMPOS EXTRAS EM PARTICIPANTES ───────────────────────────
ALTER TABLE public.participantes
  ADD COLUMN IF NOT EXISTS qr_enviado      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_aprovado     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_aprovado_por uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS qr_aprovado_at  timestamptz,
  ADD COLUMN IF NOT EXISTS financeiro_aprovado boolean DEFAULT false;

-- ── CAMPOS EXTRAS EM EVENTOS ─────────────────────────────────
ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS num_dias       integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS capacidade     integer,
  ADD COLUMN IF NOT EXISTS preco_ingresso numeric(10,2),
  ADD COLUMN IF NOT EXISTS observacoes    text;

-- ── RLS PARA NOVAS TABELAS ────────────────────────────────────
ALTER TABLE public.cursos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_dias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendas       ENABLE ROW LEVEL SECURITY;

-- Cursos: todos autenticados lêem; só admin/comercial editam
CREATE POLICY IF NOT EXISTS "cursos_read"   ON public.cursos FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "cursos_insert" ON public.cursos FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','comercial'))
);
CREATE POLICY IF NOT EXISTS "cursos_update" ON public.cursos FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','comercial'))
);
CREATE POLICY IF NOT EXISTS "cursos_delete" ON public.cursos FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Check-in dias: autenticados operam
CREATE POLICY IF NOT EXISTS "checkin_dias_read"   ON public.checkin_dias FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "checkin_dias_insert" ON public.checkin_dias FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "checkin_dias_update" ON public.checkin_dias FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "checkin_dias_delete" ON public.checkin_dias FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Vendas: autenticados operam
CREATE POLICY IF NOT EXISTS "vendas_read"   ON public.vendas FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "vendas_insert" ON public.vendas FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "vendas_update" ON public.vendas FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "vendas_delete" ON public.vendas FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ── TRIGGER updated_at em cursos ────────────────────────────
DROP TRIGGER IF EXISTS cursos_upd ON public.cursos;
CREATE TRIGGER cursos_upd BEFORE UPDATE ON public.cursos
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
