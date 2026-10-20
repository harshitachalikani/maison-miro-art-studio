-- Additive migration for COD checkout. Apply once to the existing database;
-- it preserves every current order and leaves legacy painting purchases intact.
BEGIN;

ALTER TABLE public.orders
  ALTER COLUMN painting_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS delivery_address JSONB,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS checkout_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_key_unique
  ON public.orders(checkout_key)
  WHERE checkout_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('painting', 'pottery', 'mural')),
  painting_id TEXT REFERENCES public.paintings(id),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 12),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
  status TEXT NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'pending_confirmation', 'cancelled')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((item_type = 'painting' AND painting_id IS NOT NULL) OR item_type <> 'painting')
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON public.order_items(order_id);

COMMIT;
