DO $$
BEGIN
  IF current_setting('app.environment', true) IS DISTINCT FROM 'development' THEN
    RAISE EXCEPTION 'Development seed data may only be loaded with app.environment=development';
  END IF;
END;
$$;

INSERT INTO public.menu_products
  (id, name, description, image_url, image_alt, active, is_demo)
VALUES
  ('classic-goat-bone-soup', 'Classic Goat Bone Soup',
   'DEMO ONLY. Replace with owner-approved product details before launch.',
   'https://images.unsplash.com/photo-1603105037880-880cd4edfb0d?auto=format&fit=crop&w=1200&q=85',
   'Illustrative image for a demo listing', true, true),
  ('spicy-goat-bone-soup', 'Spicy Goat Bone Soup',
   'DEMO ONLY. Replace with owner-approved product details before launch.',
   'https://images.unsplash.com/photo-1603105037880-880cd4edfb0d?auto=format&fit=crop&w=1200&q=85',
   'Illustrative image for a demo listing', true, true),
  ('pepper-goat-bone-soup', 'Pepper Goat Bone Soup',
   'DEMO ONLY. Replace with owner-approved product details before launch.',
   'https://images.unsplash.com/photo-1603105037880-880cd4edfb0d?auto=format&fit=crop&w=1200&q=85',
   'Illustrative image for a demo listing', true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.product_portions (product_id, size_in_ml, price_in_paise)
VALUES
  ('classic-goat-bone-soup', 250, 15900),
  ('classic-goat-bone-soup', 400, 22900),
  ('classic-goat-bone-soup', 750, 38900),
  ('spicy-goat-bone-soup', 250, 16900),
  ('spicy-goat-bone-soup', 400, 23900),
  ('spicy-goat-bone-soup', 750, 39900),
  ('pepper-goat-bone-soup', 250, 16900),
  ('pepper-goat-bone-soup', 400, 23900),
  ('pepper-goat-bone-soup', 750, 39900)
ON CONFLICT (product_id, size_in_ml) DO NOTHING;

INSERT INTO public.product_availability (product_id, status)
VALUES
  ('classic-goat-bone-soup', 'available'),
  ('spicy-goat-bone-soup', 'available'),
  ('pepper-goat-bone-soup', 'sold-out')
ON CONFLICT (product_id) DO NOTHING;

INSERT INTO public.business_configuration (id, configuration)
VALUES (1, '{"mode":"development-test","kitchenOpen":true,"temporarilyClosed":false,"closureNote":"","hours":[],"fulfillment":{"deliveryEnabled":false,"pickupEnabled":true,"deliveryZones":[],"pickupFeeInPaise":0},"taxes":{"ratePercent":0,"applyToDeliveryFee":false},"discountInPaise":0,"promotion":{"enabled":false,"code":""}}'::jsonb)
ON CONFLICT (id) DO NOTHING;
