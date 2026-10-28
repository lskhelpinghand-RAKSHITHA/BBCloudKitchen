"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BusinessConfiguration, FulfillmentMethod } from "@/data/business";
import type { MenuProduct } from "@/data/menu";
import type {
  CheckoutCustomer,
  CheckoutLineInput,
  OrderQuote,
} from "@/lib/orders";

type CartEntry = {
  id: string;
  productId: string;
  productName: string;
  portionSizeMl: number;
  quantity: number;
  unitPriceInPaise: number;
  selections?: string[];
  customizationSelections?: Record<string, string>;
  addOnIds?: string[];
};

type CheckoutData = {
  configuration: BusinessConfiguration;
  products: MenuProduct[];
  payments: { enabled: boolean; mode: "test" };
};

type QuoteResponse = {
  quote?: OrderQuote;
  errors?: string[];
};

const emptyCustomer: CheckoutCustomer = {
  name: "",
  mobile: "",
  address: "",
  landmark: "",
  locality: "",
  postalCode: "",
  instructions: "",
};

function formatPrice(priceInPaise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(priceInPaise / 100);
}

function isCartEntry(value: unknown): value is CartEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.productId === "string" &&
    typeof entry.productName === "string" &&
    Number.isSafeInteger(entry.portionSizeMl) &&
    Number.isSafeInteger(entry.quantity)
  );
}

function getCheckoutLines(items: CartEntry[]): CheckoutLineInput[] {
  return items.map((item) => ({
    productId: item.productId,
    portionSizeMl: item.portionSizeMl,
    quantity: item.quantity,
    customizationSelections: item.customizationSelections ?? {},
    addOnIds: item.addOnIds ?? [],
  }));
}

export default function CheckoutForm() {
  const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null);
  const [items, setItems] = useState<CartEntry[]>([]);
  const [customer, setCustomer] = useState(emptyCustomer);
  const [promotionCode, setPromotionCode] = useState("");
  const [fulfillmentMethod, setFulfillmentMethod] =
    useState<FulfillmentMethod | "">("");
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [quoteErrors, setQuoteErrors] = useState<string[]>([]);
  const [quoteState, setQuoteState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [pageError, setPageError] = useState("");
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadCheckout() {
      try {
        const [configResponse, storedCart] = await Promise.all([
          fetch("/api/checkout", { cache: "no-store" }),
          Promise.resolve(sessionStorage.getItem("bb-cloud-kitchen-cart")),
        ]);
        if (!configResponse.ok) {
          throw new Error("The checkout configuration could not be loaded.");
        }
        const data = (await configResponse.json()) as CheckoutData;
        const parsedCart: unknown = storedCart ? JSON.parse(storedCart) : [];
        if (
          !Array.isArray(parsedCart) ||
          !parsedCart.every(isCartEntry)
        ) {
          throw new Error("Your saved cart is invalid. Return to the menu and try again.");
        }
        if (!active) return;
        setCheckoutData(data);
        setItems(parsedCart);
        if (data.configuration.fulfillment.pickupEnabled) {
          setFulfillmentMethod("pickup");
        } else if (data.configuration.fulfillment.deliveryEnabled) {
          setFulfillmentMethod("delivery");
        }
        setQuoteState("ready");
      } catch (error) {
        console.error("Unable to load checkout.", error);
        if (active) {
          setPageError(
            error instanceof Error
              ? error.message
              : "Checkout could not be loaded. Please try again.",
          );
          setQuoteState("error");
        }
      }
    }
    void loadCheckout();
    return () => {
      active = false;
    };
  }, []);

  const availableProducts = useMemo(
    () => new Map((checkoutData?.products ?? []).map((product) => [product.id, product])),
    [checkoutData],
  );

  useEffect(() => {
    if (!checkoutData || items.length === 0 || !fulfillmentMethod) return;
    if (customer.name.trim().length < 2 || !customer.mobile.trim()) {
      setQuote(null);
      setQuoteErrors([]);
      setQuoteState("ready");
      return;
    }
    const timer = window.setTimeout(async () => {
      setQuoteState("loading");
      setQuoteErrors([]);
      try {
        const response = await fetch("/api/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fulfillmentMethod,
            items: getCheckoutLines(items),
            customer,
            ...(promotionCode.trim() ? { promotionCode: promotionCode.trim() } : {}),
          }),
        });
        const result = (await response.json()) as QuoteResponse;
        if (!response.ok) {
          setQuote(null);
          setQuoteErrors(result.errors ?? ["The server could not calculate this order."]);
        } else {
          setQuote(result.quote ?? null);
        }
      } catch (error) {
        console.error("Unable to calculate the order total.", error);
        setQuote(null);
        setQuoteErrors(["The server could not calculate this order. Check your connection and retry."]);
      } finally {
        setQuoteState("ready");
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [checkoutData, customer, fulfillmentMethod, items, promotionCode]);

  function updateCustomer(field: keyof CheckoutCustomer, value: string) {
    idempotencyKey.current = null;
    setSubmitErrors([]);
    setQuote(null);
    setQuoteErrors([]);
    setCustomer((current) => ({ ...current, [field]: value }));
  }

  function updateQuantity(id: string, quantity: number) {
    idempotencyKey.current = null;
    setSubmitErrors([]);
    setQuote(null);
    setQuoteErrors([]);
    setItems((current) =>
      current
        .map((item) => (item.id === id ? { ...item, quantity } : item))
        .filter((item) => item.quantity > 0),
    );
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitErrors([]);
    if (!checkoutData || !quote || !fulfillmentMethod) {
      setSubmitErrors(
        quoteErrors.length > 0
          ? quoteErrors
          : ["Complete the required details and wait for the server total before placing your test order."],
      );
      return;
    }

    setSubmitting(true);
    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          fulfillmentMethod,
          items: getCheckoutLines(items),
          customer,
          ...(promotionCode.trim() ? { promotionCode: promotionCode.trim() } : {}),
        }),
      });
      const result = (await response.json()) as {
        errors?: string[];
        trackingUrl?: string;
      };
      if (!response.ok || !result.trackingUrl) {
        setSubmitErrors(result.errors ?? ["The order could not be placed. Please try again."]);
        return;
      }
      sessionStorage.removeItem("bb-cloud-kitchen-cart");
      window.location.assign(result.trackingUrl);
    } catch (error) {
      console.error("Unable to submit the order.", error);
      setSubmitErrors([
        "The order could not be confirmed. Retry without changing your details to safely check whether it was received.",
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="checkout-page">
      <header className="checkout-header">
        <a className="brand" href="/" aria-label="BB Cloud Kitchen home">
          <span className="brand-mark">BB</span>
          <span className="brand-copy">
            BB <span>Cloud Kitchen</span>
          </span>
        </a>
        <span className="test-order-label">DEVELOPMENT TEST CHECKOUT</span>
      </header>

      <div className="checkout-content">
        <a className="checkout-back" href="/">← Return to menu</a>
        <div className="checkout-title">
          <p className="eyebrow">GOAT BONE SOUP · MANCHERIAL</p>
          <h1>Complete your <em>test order.</em></h1>
          <p>Server-calculated totals · Razorpay sandbox only · No real customer orders</p>
        </div>

        {pageError && <p className="checkout-alert" role="alert">{pageError}</p>}
        {!pageError && quoteState === "loading" && !checkoutData && (
          <p className="checkout-alert" role="status">Loading the test checkout…</p>
        )}
        {checkoutData && items.length === 0 && (
          <p className="checkout-alert" role="status">
            Your cart is empty. <a href="/">Return to the menu</a> to choose a soup.
          </p>
        )}

        {checkoutData && items.length > 0 && (
          <>
            {!checkoutData.payments.enabled && (
              <p className="checkout-alert" role="alert">
                Sandbox payments are not configured. Add RAZORPAY_MODE=test,
                RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET
                to the server environment before checkout.
              </p>
            )}
            {(!checkoutData.configuration.kitchenOpen ||
              checkoutData.configuration.mode !== "development-test") && (
              <p className="checkout-alert" role="alert">
                {checkoutData.configuration.mode !== "development-test"
                  ? "Real customer checkout is disabled until business settings and order storage are configured."
                  : checkoutData.configuration.closureNote ||
                    "The kitchen is closed. Checkout is unavailable."}
              </p>
            )}
            <form className="checkout-layout" onSubmit={submitOrder}>
              <div className="checkout-fields">
                <section className="checkout-card" aria-labelledby="fulfillment-heading">
                  <p className="checkout-step">01 · FULFILLMENT</p>
                  <h2 id="fulfillment-heading">How would you like your order?</h2>
                  {checkoutData.configuration.fulfillment.pickupEnabled && (
                    <label className="fulfillment-option">
                      <input
                        type="radio"
                        name="fulfillment"
                        value="pickup"
                        checked={fulfillmentMethod === "pickup"}
                        onChange={() => {
                          idempotencyKey.current = null;
                          setQuote(null);
                          setFulfillmentMethod("pickup");
                        }}
                      />
                      <span><strong>Pickup</strong><small>Development test pickup · No real pickup is arranged</small></span>
                    </label>
                  )}
                  {checkoutData.configuration.fulfillment.deliveryEnabled && (
                    <label className="fulfillment-option">
                      <input
                        type="radio"
                        name="fulfillment"
                        value="delivery"
                        checked={fulfillmentMethod === "delivery"}
                        onChange={() => {
                          idempotencyKey.current = null;
                          setQuote(null);
                          setFulfillmentMethod("delivery");
                        }}
                      />
                      <span><strong>Delivery</strong><small>Address must match a configured Mancherial delivery zone</small></span>
                    </label>
                  )}
                  {!checkoutData.configuration.fulfillment.pickupEnabled &&
                    !checkoutData.configuration.fulfillment.deliveryEnabled && (
                      <p className="checkout-field-note">
                        No fulfillment options are enabled in the business configuration.
                      </p>
                    )}
                  {!checkoutData.configuration.fulfillment.deliveryEnabled && (
                    <p className="checkout-field-note">
                      Delivery is not enabled: no service zones or delivery fee have been configured.
                    </p>
                  )}
                </section>

                <section className="checkout-card" aria-labelledby="customer-heading">
                  <p className="checkout-step">02 · CONTACT</p>
                  <h2 id="customer-heading">Your details</h2>
                  <div className="checkout-form-grid">
                    <label>
                      <span>Name *</span>
                      <input required minLength={2} maxLength={100} autoComplete="name" value={customer.name} onChange={(event) => updateCustomer("name", event.target.value)} />
                    </label>
                    <label>
                      <span>Mobile number *</span>
                      <input required type="tel" autoComplete="tel" maxLength={20} placeholder="10-digit Indian number" value={customer.mobile} onChange={(event) => updateCustomer("mobile", event.target.value)} />
                    </label>
                  </div>
                </section>

                {fulfillmentMethod === "delivery" && (
                  <section className="checkout-card" aria-labelledby="address-heading">
                    <p className="checkout-step">03 · DELIVERY ADDRESS</p>
                    <h2 id="address-heading">Where should we deliver?</h2>
                    <label className="checkout-full-field">
                      <span>Delivery address *</span>
                      <textarea required maxLength={500} autoComplete="street-address" value={customer.address} onChange={(event) => updateCustomer("address", event.target.value)} />
                    </label>
                    <div className="checkout-form-grid">
                      <label>
                        <span>Area / locality *</span>
                        <input required maxLength={120} autoComplete="address-level2" value={customer.locality} onChange={(event) => updateCustomer("locality", event.target.value)} />
                      </label>
                      <label>
                        <span>PIN code *</span>
                        <input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="postal-code" value={customer.postalCode} onChange={(event) => updateCustomer("postalCode", event.target.value)} />
                      </label>
                      <label>
                        <span>Landmark</span>
                        <input maxLength={160} value={customer.landmark} onChange={(event) => updateCustomer("landmark", event.target.value)} />
                      </label>
                      <label>
                        <span>Delivery instructions</span>
                        <input maxLength={500} value={customer.instructions} onChange={(event) => updateCustomer("instructions", event.target.value)} />
                      </label>
                    </div>
                  </section>
                )}

                {fulfillmentMethod === "pickup" && (
                  <section className="checkout-card" aria-labelledby="instructions-heading">
                    <p className="checkout-step">03 · OPTIONAL</p>
                    <h2 id="instructions-heading">Anything else?</h2>
                    <label className="checkout-full-field">
                      <span>Instructions (optional)</span>
                      <textarea maxLength={500} value={customer.instructions} onChange={(event) => updateCustomer("instructions", event.target.value)} />
                    </label>
                    <p className="checkout-field-note">
                      Pickup arrangements and times are not configured; this test order does not confirm a real pickup.
                    </p>
                  </section>
                )}
              </div>

              <aside className="checkout-summary" aria-labelledby="summary-heading">
                <p className="checkout-step">ORDER SUMMARY</p>
                <h2 id="summary-heading">Your soup</h2>
                <ul className="checkout-items">
                  {items.map((item, index) => {
                    const product = availableProducts.get(item.productId);
                    const line = quote?.items[index];
                    return (
                      <li key={item.id}>
                        <div>
                          <strong>{product?.name ?? "Menu item"}</strong>
                          <span>{item.portionSizeMl} ml · {line ? formatPrice(line.unitPriceInPaise) : "Server price pending"} each</span>
                        </div>
                        <div className="checkout-item-quantity">
                          <button type="button" disabled={item.quantity <= 1} onClick={() => updateQuantity(item.id, item.quantity - 1)} aria-label={`Decrease ${item.productName} quantity`}>−</button>
                          <span>{item.quantity}</span>
                          <button type="button" disabled={item.quantity >= 20} onClick={() => updateQuantity(item.id, item.quantity + 1)} aria-label={`Increase ${item.productName} quantity`}>+</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {checkoutData.configuration.promotion.enabled && (
                  <label className="checkout-full-field">
                    <span>Promotion code</span>
                    <input
                      maxLength={40}
                      autoComplete="off"
                      value={promotionCode}
                      onChange={(event) => {
                        idempotencyKey.current = null;
                        setQuote(null);
                        setPromotionCode(event.target.value);
                      }}
                    />
                  </label>
                )}
                <div className="checkout-totals">
                  <p><span>Subtotal</span><strong>{quote ? formatPrice(quote.subtotalInPaise) : "—"}</strong></p>
                  <p><span>{fulfillmentMethod === "delivery" ? "Delivery fee" : "Pickup fee"}</span><strong>{quote ? formatPrice(quote.deliveryFeeInPaise) : "—"}</strong></p>
                  <p><span>Discount</span><strong>{quote ? (quote.discountInPaise > 0 ? `−${formatPrice(quote.discountInPaise)}` : formatPrice(0)) : "—"}</strong></p>
                  <p><span>Applicable taxes</span><strong>{quote ? formatPrice(quote.taxInPaise) : "—"}</strong></p>
                  <p className="checkout-grand-total"><span>Total</span><strong>{quote ? formatPrice(quote.totalInPaise) : "—"}</strong></p>
                </div>
                {quoteState === "loading" && (
                  <p className="checkout-field-note" role="status">Updating server total…</p>
                )}
                {!quote && quoteErrors.length === 0 && (
                  <p className="checkout-field-note">
                    Enter your name and mobile number to calculate the server total.
                  </p>
                )}
                {quoteErrors.length > 0 && (
                  <ul className="checkout-errors" role="alert">
                    {quoteErrors.map((error) => <li key={error}>{error}</li>)}
                  </ul>
                )}
                {submitErrors.length > 0 && (
                  <ul className="checkout-errors" role="alert">
                    {submitErrors.map((error) => <li key={error}>{error}</li>)}
                  </ul>
                )}
                <button
                  className="checkout-submit"
                  type="submit"
                  disabled={
                    submitting ||
                    !quote ||
                    !checkoutData.payments.enabled ||
                    !checkoutData.configuration.kitchenOpen ||
                    checkoutData.configuration.mode !== "development-test"
                  }
                >
                  {submitting ? "Preparing secure test payment…" : "Continue to test payment"}
                </button>
                <p className="checkout-test-notice">
                  Razorpay test mode only. Test credentials do not charge real money.
                  Payment status is confirmed by the server; this demo does not notify
                  the kitchen or represent a real customer order.
                </p>
              </aside>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
