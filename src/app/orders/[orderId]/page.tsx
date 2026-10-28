import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTrackedOrder } from "@/lib/orders";
import { getRazorpayTestKeyId } from "@/lib/payments";
import PaymentStatusPanel from "./PaymentStatusPanel";

export const metadata: Metadata = {
  title: "Test payment status | BB Cloud Kitchen",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function OrderStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const token = typeof query.token === "string" ? query.token : "";
  const order = getTrackedOrder(orderId, token);
  if (!order) notFound();

  const formatPrice = (priceInPaise: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(priceInPaise / 100);

  return (
    <main className="order-status-page">
      <header className="checkout-header">
        <a className="brand" href="/" aria-label="BB Cloud Kitchen home">
          <span className="brand-mark">BB</span>
          <span className="brand-copy">
            BB <span>Cloud Kitchen</span>
          </span>
        </a>
        <span className="test-order-label">RAZORPAY SANDBOX</span>
      </header>
      <section className="order-confirmation">
        <p className="eyebrow">SANDBOX PAYMENT · NOT A REAL CUSTOMER ORDER</p>
        <div className="confirmation-mark" aria-hidden="true">
          {order.payment.status === "paid" ? "✓" : "…"}
        </div>
        <h1>Test payment <em>status.</em></h1>
        <PaymentStatusPanel
          orderId={order.id}
          trackingToken={token}
          initialStatus={order.payment.status}
          gatewayOrderId={order.payment.gatewayOrderId ?? null}
          razorpayKeyId={getRazorpayTestKeyId()}
          totalInPaise={order.quote.totalInPaise}
          customerName={order.customer.name}
          customerMobile={order.customer.mobile}
        />
        <dl className="confirmation-details">
          <div>
            <dt>Order ID</dt>
            <dd>{order.id}</dd>
          </div>
          <div>
            <dt>Fulfillment</dt>
            <dd>{order.quote.fulfillmentMethod === "pickup" ? "Test pickup" : "Test delivery"}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatPrice(order.quote.totalInPaise)}</dd>
          </div>
        </dl>
        <a className="button button-copper" href="/">
          Return to BB Cloud Kitchen <span aria-hidden="true">↗</span>
        </a>
      </section>
    </main>
  );
}
