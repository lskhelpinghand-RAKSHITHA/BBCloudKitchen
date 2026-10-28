CREATE TABLE public.business_configuration (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.menu_products (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  description text NOT NULL CHECK (length(description) <= 1200),
  image_url text NOT NULL,
  image_alt text NOT NULL,
  ingredients text[] NOT NULL DEFAULT '{}',
  spice_level text,
  preparation_time_minutes integer CHECK (preparation_time_minutes IS NULL OR preparation_time_minutes BETWEEN 1 AND 1440),
  active boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_portions (
  product_id text NOT NULL REFERENCES public.menu_products(id) ON DELETE CASCADE,
  size_in_ml integer NOT NULL CHECK (size_in_ml BETWEEN 50 AND 5000),
  price_in_paise integer NOT NULL CHECK (price_in_paise BETWEEN 100 AND 10000000),
  PRIMARY KEY (product_id, size_in_ml)
);

CREATE TABLE public.product_availability (
  product_id text PRIMARY KEY REFERENCES public.menu_products(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold-out')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_customizations (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES public.menu_products(id) ON DELETE CASCADE,
  label text NOT NULL,
  UNIQUE (product_id, id)
);

CREATE TABLE public.customization_options (
  id text PRIMARY KEY,
  customization_id text NOT NULL REFERENCES public.product_customizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_in_paise integer NOT NULL DEFAULT 0 CHECK (price_in_paise >= 0),
  UNIQUE (customization_id, id)
);

CREATE TABLE public.product_add_ons (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES public.menu_products(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_in_paise integer NOT NULL CHECK (price_in_paise >= 0),
  UNIQUE (product_id, id)
);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 100),
  mobile text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.delivery_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  address text NOT NULL,
  landmark text NOT NULL DEFAULT '',
  locality text NOT NULL,
  postal_code text NOT NULL CHECK (postal_code ~ '^[0-9]{6}$'),
  instructions text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemption_count integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  discount_type text NOT NULL CHECK (discount_type IN ('fixed', 'percent')),
  discount_value integer NOT NULL CHECK (discount_value > 0),
  is_demo boolean NOT NULL DEFAULT false
);

CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemption_count integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0)
);

CREATE TABLE public.orders (
  id text PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  delivery_address_id uuid REFERENCES public.delivery_addresses(id),
  status text NOT NULL CHECK (status IN ('new', 'confirmed', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled')),
  fulfillment_method text NOT NULL CHECK (fulfillment_method IN ('delivery', 'pickup')),
  subtotal_in_paise integer NOT NULL CHECK (subtotal_in_paise >= 0),
  delivery_fee_in_paise integer NOT NULL CHECK (delivery_fee_in_paise >= 0),
  discount_in_paise integer NOT NULL CHECK (discount_in_paise >= 0),
  tax_in_paise integer NOT NULL CHECK (tax_in_paise >= 0),
  total_in_paise integer NOT NULL CHECK (total_in_paise >= 0),
  promotion_id uuid REFERENCES public.promotions(id),
  tracking_token_hash text NOT NULL,
  idempotency_key uuid NOT NULL UNIQUE,
  request_fingerprint text NOT NULL,
  is_test boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((fulfillment_method = 'delivery' AND delivery_address_id IS NOT NULL) OR fulfillment_method = 'pickup')
);

CREATE TABLE public.order_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id text REFERENCES public.menu_products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  portion_size_ml integer NOT NULL CHECK (portion_size_ml BETWEEN 50 AND 5000),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  unit_price_in_paise integer NOT NULL CHECK (unit_price_in_paise >= 0),
  line_total_in_paise integer NOT NULL CHECK (line_total_in_paise = quantity * unit_price_in_paise)
);

CREATE TABLE public.order_item_customizations (
  order_line_item_id uuid NOT NULL REFERENCES public.order_line_items(id) ON DELETE CASCADE,
  customization_name text NOT NULL,
  option_name text NOT NULL,
  price_in_paise integer NOT NULL DEFAULT 0 CHECK (price_in_paise >= 0),
  PRIMARY KEY (order_line_item_id, customization_name)
);

CREATE TABLE public.order_item_add_ons (
  order_line_item_id uuid NOT NULL REFERENCES public.order_line_items(id) ON DELETE CASCADE,
  add_on_name text NOT NULL,
  price_in_paise integer NOT NULL CHECK (price_in_paise >= 0),
  PRIMARY KEY (order_line_item_id, add_on_name)
);

CREATE TABLE public.fulfillments (
  order_id text PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('delivery', 'pickup')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'ready', 'dispatched', 'completed', 'cancelled')),
  scheduled_for timestamptz,
  completed_at timestamptz
);

CREATE TABLE public.payment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('razorpay')),
  gateway_order_id text UNIQUE,
  gateway_payment_id text UNIQUE,
  amount_in_paise integer NOT NULL CHECK (amount_in_paise >= 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status text NOT NULL CHECK (status IN ('pending', 'failed', 'cancelled', 'paid', 'refund_pending', 'partially_refunded', 'refunded')),
  is_test boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payment_refunds (
  id text PRIMARY KEY,
  payment_record_id uuid NOT NULL REFERENCES public.payment_records(id) ON DELETE CASCADE,
  amount_in_paise integer NOT NULL CHECK (amount_in_paise > 0),
  status text NOT NULL CHECK (status IN ('pending', 'processed', 'failed')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payment_webhook_events (
  event_id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.authorized_administrators (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_authorized_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.authorized_administrators AS administrator
    WHERE administrator.user_id = (SELECT auth.uid())
      AND administrator.active
  );
$$;

CREATE INDEX orders_customer_created_idx ON public.orders(customer_id, created_at DESC);
CREATE INDEX orders_status_created_idx ON public.orders(status, created_at DESC);
CREATE INDEX order_line_items_order_idx ON public.order_line_items(order_id);
CREATE INDEX payment_records_order_idx ON public.payment_records(order_id);
CREATE INDEX delivery_addresses_customer_idx ON public.delivery_addresses(customer_id);

ALTER TABLE public.business_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_portions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_customizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customization_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_add_ons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_customizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_add_ons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authorized_administrators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active menu products" ON public.menu_products
  FOR SELECT TO anon, authenticated USING (active);
CREATE POLICY "Public can read portions of active products" ON public.product_portions
  FOR SELECT TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.menu_products p WHERE p.id = product_id AND p.active)
  );
CREATE POLICY "Public can read availability of active products" ON public.product_availability
  FOR SELECT TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.menu_products p WHERE p.id = product_id AND p.active)
  );
CREATE POLICY "Public can read options of active products" ON public.product_customizations
  FOR SELECT TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.menu_products p WHERE p.id = product_id AND p.active)
  );
CREATE POLICY "Public can read customization options of active products" ON public.customization_options
  FOR SELECT TO anon, authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.product_customizations c
      JOIN public.menu_products p ON p.id = c.product_id
      WHERE c.id = customization_id AND p.active
    )
  );
CREATE POLICY "Public can read add-ons of active products" ON public.product_add_ons
  FOR SELECT TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.menu_products p WHERE p.id = product_id AND p.active)
  );

CREATE POLICY "Administrators can manage business configuration" ON public.business_configuration
  FOR ALL TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can manage products" ON public.menu_products
  FOR ALL TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can manage portions" ON public.product_portions
  FOR ALL TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can manage availability" ON public.product_availability
  FOR ALL TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can manage customizations" ON public.product_customizations
  FOR ALL TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can manage customization options" ON public.customization_options
  FOR ALL TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can manage add-ons" ON public.product_add_ons
  FOR ALL TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can read customers" ON public.customers
  FOR SELECT TO authenticated USING ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can read delivery addresses" ON public.delivery_addresses
  FOR SELECT TO authenticated USING ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can manage promotions" ON public.promotions
  FOR ALL TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can manage coupons" ON public.coupons
  FOR ALL TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can read orders" ON public.orders
  FOR SELECT TO authenticated USING ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can manage orders" ON public.orders
  FOR UPDATE TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can read order line items" ON public.order_line_items
  FOR SELECT TO authenticated USING ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can manage order line items" ON public.order_line_items
  FOR ALL TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can read item customizations" ON public.order_item_customizations
  FOR SELECT TO authenticated USING ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can read item add-ons" ON public.order_item_add_ons
  FOR SELECT TO authenticated USING ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can read fulfillments" ON public.fulfillments
  FOR SELECT TO authenticated USING ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can update fulfillments" ON public.fulfillments
  FOR UPDATE TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can read payments" ON public.payment_records
  FOR SELECT TO authenticated USING ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can read refunds" ON public.payment_refunds
  FOR SELECT TO authenticated USING ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can read webhook events" ON public.payment_webhook_events
  FOR SELECT TO authenticated USING ((SELECT public.is_authorized_admin()));
CREATE POLICY "Administrators can manage administrator access" ON public.authorized_administrators
  FOR ALL TO authenticated USING ((SELECT public.is_authorized_admin()))
  WITH CHECK ((SELECT public.is_authorized_admin()));

REVOKE ALL ON public.business_configuration, public.menu_products, public.product_portions,
  public.product_availability, public.product_customizations, public.customization_options,
  public.product_add_ons, public.customers, public.delivery_addresses, public.promotions,
  public.coupons, public.orders, public.order_line_items, public.order_item_customizations,
  public.order_item_add_ons, public.fulfillments, public.payment_records,
  public.payment_refunds, public.payment_webhook_events, public.authorized_administrators
  FROM anon, authenticated;
GRANT SELECT ON public.menu_products, public.product_portions, public.product_availability,
  public.product_customizations, public.customization_options, public.product_add_ons
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_configuration, public.menu_products,
  public.product_portions, public.product_availability, public.product_customizations,
  public.customization_options, public.product_add_ons, public.customers,
  public.delivery_addresses, public.promotions, public.coupons, public.orders,
  public.order_line_items, public.order_item_customizations, public.order_item_add_ons,
  public.fulfillments, public.payment_records, public.payment_refunds,
  public.payment_webhook_events, public.authorized_administrators TO authenticated;
REVOKE ALL ON FUNCTION public.is_authorized_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_authorized_admin() TO authenticated;
