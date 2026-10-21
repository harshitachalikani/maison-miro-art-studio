-- Draft migration for persistent painting approvals and checkout links.
-- Apply only after reviewing the target Supabase schema and after 001_unified_checkout.sql.
-- This migration does not delete or update customer/order rows.
BEGIN;

CREATE TABLE IF NOT EXISTS public.painting_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  painting_id TEXT NOT NULL REFERENCES public.paintings(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined', 'cancelled', 'purchased')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  order_item_id BIGINT
);

ALTER TABLE public.painting_requests
  ADD COLUMN IF NOT EXISTS order_item_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS painting_requests_order_item_id_unique
  ON public.painting_requests(order_item_id)
  WHERE order_item_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'painting_requests_order_item_id_fkey'
      AND conrelid = 'public.painting_requests'::regclass
  ) THEN
    ALTER TABLE public.painting_requests
      ADD CONSTRAINT painting_requests_order_item_id_fkey
      FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS painting_requests_customer_created_idx
  ON public.painting_requests(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS painting_requests_admin_status_created_idx
  ON public.painting_requests(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS painting_requests_one_active_per_customer_idx
  ON public.painting_requests(user_id, painting_id)
  WHERE status IN ('pending', 'approved');

CREATE UNIQUE INDEX IF NOT EXISTS painting_requests_one_approved_per_painting_idx
  ON public.painting_requests(painting_id)
  WHERE status = 'approved';

ALTER TABLE public.wall_bookings
  ADD COLUMN IF NOT EXISTS order_item_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS wall_bookings_order_item_id_unique
  ON public.wall_bookings(order_item_id)
  WHERE order_item_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wall_bookings_order_item_id_fkey'
      AND conrelid = 'public.wall_bookings'::regclass
  ) THEN
    ALTER TABLE public.wall_bookings
      ADD CONSTRAINT wall_bookings_order_item_id_fkey
      FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Accepted pottery requests can enter checkout once. Cancelling the whole order
-- releases the link while preserving the accepted request for a later retry.
ALTER TABLE public.pottery_requests
  ADD COLUMN IF NOT EXISTS order_item_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS pottery_requests_order_item_id_unique
  ON public.pottery_requests(order_item_id)
  WHERE order_item_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pottery_requests_order_item_id_fkey'
      AND conrelid = 'public.pottery_requests'::regclass
  ) THEN
    ALTER TABLE public.pottery_requests
      ADD CONSTRAINT pottery_requests_order_item_id_fkey
      FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE SET NULL;
  END IF;
END $$;

-- The existing index predicate is status <> 'cancelled', which also reserves
-- declined dates. Replace it so only requested and confirmed bookings reserve
-- a date. This changes an index only; it does not delete or update bookings.
DROP INDEX IF EXISTS public.one_active_wall_booking_per_date;
CREATE UNIQUE INDEX one_active_wall_booking_per_date
  ON public.wall_bookings(booking_date)
  WHERE status IN ('requested', 'confirmed');

COMMIT;
