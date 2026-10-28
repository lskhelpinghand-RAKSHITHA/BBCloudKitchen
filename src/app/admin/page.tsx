import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  getBusinessConfiguration,
  isKitchenAcceptingOrders,
} from "@/data/business";
import { getMenuProducts } from "@/data/menu";
import {
  getAdminSession,
} from "@/lib/admin-auth";
import {
  getAllowedOrderTransitionsForOrder,
  listAdminOrders,
  type OrderStatus,
} from "@/lib/orders";
import {
  changeOrderStatus,
  saveBusinessSettings,
  saveProduct,
  setProductAvailability,
  signOut,
} from "./actions";

export const metadata: Metadata = {
  title: "Kitchen dashboard | BB Cloud Kitchen",
  robots: { index: false, follow: false },
};

const statuses: OrderStatus[] = [
  "new",
  "confirmed",
  "preparing",
  "ready",
  "dispatched",
  "delivered",
  "cancelled",
];

function formatPrice(priceInPaise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(priceInPaise / 100);
}

function formatHours(hours: ReturnType<typeof getBusinessConfiguration>["hours"]) {
  return hours
    .map((entry) =>
      entry.closed
        ? `${entry.day}: closed`
        : `${entry.day}: ${entry.opensAt}-${entry.closesAt}`,
    )
    .join("\n");
}

const notices: Record<string, string> = {
  "product-saved": "Product details saved.",
  "availability-updated": "Product availability updated.",
  "settings-saved": "Business settings saved.",
  "order-updated": "Order status updated.",
};

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  const [products, query] = await Promise.all([
    getMenuProducts({ includeInactive: true }),
    searchParams,
  ]);
  const configuration = getBusinessConfiguration();
  const isAcceptingOrders = isKitchenAcceptingOrders(configuration);
  const orders = listAdminOrders();
  const paidOrders = orders.filter((order) => order.payment.status === "paid");
  const paidRevenue = paidOrders.reduce(
    (total, order) => total + order.quote.totalInPaise,
    0,
  );
  const statusCounts = statuses.map((status) => ({
    status,
    count: orders.filter((order) => order.status === status).length,
  }));
  const deliveryZones = configuration.fulfillment.deliveryZones
    .map((zone) =>
      `${zone.name === "*" ? "" : zone.name}|${zone.postalCodes.join(",")}|${(zone.deliveryFeeInPaise / 100).toFixed(2)}`,
    )
    .join("\n");

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <a className="admin-brand" href="/admin">
          <span className="brand-mark">BB</span>
          <span>BB Cloud Kitchen <small>STAFF CONSOLE</small></span>
        </a>
        <div className="admin-header-actions">
          <span className="admin-user">{session.email}</span>
          <form action={signOut}>
            <button className="admin-button admin-button-quiet" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="admin-content">
        <section className="admin-welcome">
          <div>
            <p className="admin-eyebrow">KITCHEN OPERATIONS</p>
            <h1>Good service starts <em>here.</em></h1>
            <p className="admin-muted">
              Orders, menu, fulfillment, and sales at a glance. Customer details
              are visible only in this authenticated staff dashboard. Checkout
              remains in test mode.
            </p>
          </div>
          <div className={`admin-open-state ${isAcceptingOrders ? "is-open" : "is-closed"}`}>
            <span />
            {configuration.temporarilyClosed
              ? "Temporarily closed"
              : isAcceptingOrders
                ? "Accepting orders"
                : "Not accepting orders"}
          </div>
        </section>

        {query.notice && notices[query.notice] && (
          <p className="admin-success" role="status">{notices[query.notice]}</p>
        )}

        <section className="admin-metrics" aria-label="Order and sales summary">
          <article><span>Orders shown</span><strong>{orders.length}</strong><small>Latest 100</small></article>
          <article><span>New orders</span><strong>{orders.filter((order) => order.status === "new").length}</strong><small>Awaiting confirmation</small></article>
          <article><span>Paid orders</span><strong>{paidOrders.length}</strong><small>Payment status: paid</small></article>
          <article><span>Paid sales</span><strong>{formatPrice(paidRevenue)}</strong><small>Latest 100 orders</small></article>
        </section>

        <section className="admin-panel" id="orders">
          <div className="admin-section-heading">
            <div>
              <p className="admin-eyebrow">ORDER MANAGEMENT</p>
              <h2>Orders</h2>
            </div>
            <span className="admin-muted">Order status changes follow valid kitchen transitions.</span>
          </div>
          <div className="admin-status-counts">
            {statusCounts.map(({ status, count }) => (
              <span key={status}><b>{count}</b> {status}</span>
            ))}
          </div>
          {orders.length === 0 ? (
            <p className="admin-empty">No orders have been received yet.</p>
          ) : (
            <div className="admin-order-list">
              {orders.map((order) => {
                const allowed = getAllowedOrderTransitionsForOrder(order);
                return (
                  <article className="admin-order-card" key={order.id}>
                    <div className="admin-order-head">
                      <div>
                        <span className={`admin-status status-${order.status}`}>{order.status}</span>
                        <span className="admin-status status-test-order">sandbox</span>
                        <h3>{order.id}</h3>
                        <p>{new Date(order.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
                      </div>
                      <strong className="admin-order-total">{formatPrice(order.quote.totalInPaise)}</strong>
                    </div>
                    <div className="admin-order-grid">
                      <div>
                        <h4>Items</h4>
                        <ul className="admin-order-items">
                          {order.quote.items.map((item, index) => (
                            <li key={`${item.productId}-${index}`}>
                              <span>{item.productName} · {item.portionSizeMl} ml × {item.quantity}</span>
                              <strong>{formatPrice(item.lineTotalInPaise)}</strong>
                            </li>
                          ))}
                        </ul>
                        <p className="admin-order-totals">
                          Subtotal {formatPrice(order.quote.subtotalInPaise)} ·
                          {order.quote.fulfillmentMethod === "delivery" ? " Delivery " : " Pickup "}
                          {formatPrice(order.quote.deliveryFeeInPaise)} · Tax {formatPrice(order.quote.taxInPaise)}
                        </p>
                      </div>
                      <div>
                        <h4>Fulfillment & customer</h4>
                        <p><b>{order.customer.name}</b> · {order.customer.mobile}</p>
                        <p>{order.quote.fulfillmentMethod === "delivery" ? [
                          order.customer.address,
                          order.customer.landmark,
                          order.customer.locality,
                          order.customer.postalCode,
                        ].filter(Boolean).join(", ") : "Pickup"}</p>
                        {order.customer.instructions && <p>Note: {order.customer.instructions}</p>}
                      </div>
                      <div>
                        <h4>Payment</h4>
                        <p><b>{order.payment.status}</b> · {order.payment.provider}</p>
                        <p>Gateway order: {order.payment.gatewayOrderId ?? "Not created"}</p>
                        <p>Payment reference: {order.payment.gatewayPaymentIds.join(", ") || "None"}</p>
                        {order.payment.refunds.map((refund) => (
                          <p key={refund.id}>Refund {refund.id} · {formatPrice(refund.amountInPaise)} · {refund.status}</p>
                        ))}
                      </div>
                    </div>
                    {allowed.length > 0 && (
                      <form className="admin-status-form" action={changeOrderStatus}>
                        <input type="hidden" name="orderId" value={order.id} />
                        <label>
                          <span>Next status</span>
                          <select name="status" defaultValue={allowed[0]}>
                            {allowed.map((status) => <option key={status} value={status}>{status}</option>)}
                          </select>
                        </label>
                        <button className="admin-button admin-button-primary" type="submit">
                          Update order
                        </button>
                      </form>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="admin-panel" id="menu">
          <div className="admin-section-heading">
            <div>
              <p className="admin-eyebrow">CATALOG</p>
              <h2>Goat bone soup menu</h2>
            </div>
            <span className="admin-muted">Changes are saved to the database and reflected in the public menu.</span>
          </div>
          <div className="admin-product-grid">
            {products.map((product) => (
              <article className="admin-product-card" key={product.id}>
                <div className="admin-product-top">
                  <h3>{product.name}</h3>
                  <span className={`admin-status ${product.active ? "status-active" : "status-inactive"}`}>
                    {product.active ? product.availability : "deactivated"}
                  </span>
                </div>
                <form action={saveProduct} className="admin-form">
                  <input type="hidden" name="id" value={product.id} />
                  <label><span>Product name</span><input name="name" required minLength={2} maxLength={100} defaultValue={product.name} /></label>
                  <label><span>Description</span><textarea name="description" required minLength={10} maxLength={1200} defaultValue={product.description} /></label>
                  <label><span>Image URL (HTTPS)</span><input name="imageUrl" type="url" required defaultValue={product.imageUrl} /></label>
                  <label><span>Image description</span><input name="imageAlt" required maxLength={200} defaultValue={product.imageAlt} /></label>
                  <label>
                    <span>Portions (ml:price in INR, one per line)</span>
                    <textarea name="portions" required defaultValue={product.portions.map((portion) => `${portion.sizeInMl}:${(portion.priceInPaise / 100).toFixed(2)}`).join("\n")} />
                  </label>
                  <label>
                    <span>Availability</span>
                    <select name="availability" defaultValue={product.availability}>
                      <option value="available">Available</option>
                      <option value="sold-out">Sold out</option>
                    </select>
                  </label>
                  <label className="admin-checkbox">
                    <input type="checkbox" name="active" defaultChecked={product.active} />
                    <span>Listed on public menu</span>
                  </label>
                  <button className="admin-button admin-button-primary" type="submit">Save product</button>
                </form>
                <form action={setProductAvailability} className="admin-quick-action">
                  <input type="hidden" name="id" value={product.id} />
                  <input type="hidden" name="availability" value={product.availability === "sold-out" ? "available" : "sold-out"} />
                  <button className="admin-button admin-button-quiet" type="submit">
                    {product.availability === "sold-out" ? "Mark available" : "Mark sold out now"}
                  </button>
                </form>
              </article>
            ))}
            <article className="admin-product-card admin-new-product">
              <div className="admin-product-top"><h3>Create product</h3><span className="admin-status">new</span></div>
              <form action={saveProduct} className="admin-form">
                <label><span>Product name</span><input name="name" required minLength={2} maxLength={100} /></label>
                <label><span>Description</span><textarea name="description" required minLength={10} maxLength={1200} /></label>
                <label><span>Image URL (HTTPS)</span><input name="imageUrl" type="url" required /></label>
                <label><span>Image description</span><input name="imageAlt" required maxLength={200} /></label>
                <label><span>Portions (ml:price in INR, one per line)</span><textarea name="portions" required placeholder={"250:159.00\n400:229.00"} /></label>
                <label><span>Availability</span><select name="availability" defaultValue="available"><option value="available">Available</option><option value="sold-out">Sold out</option></select></label>
                <label className="admin-checkbox"><input type="checkbox" name="active" defaultChecked /><span>List on public menu</span></label>
                <button className="admin-button admin-button-primary" type="submit">Create product</button>
              </form>
            </article>
          </div>
        </section>

        <section className="admin-panel" id="business">
          <div className="admin-section-heading">
            <div>
              <p className="admin-eyebrow">OPERATIONS SETTINGS</p>
              <h2>Business & fulfillment</h2>
            </div>
            <span className="admin-muted">Settings are private and server-validated.</span>
          </div>
          <form action={saveBusinessSettings} className="admin-settings-grid admin-form">
            <div className="admin-settings-group">
              <h3>Hours & service state</h3>
              <label className="admin-checkbox"><input type="checkbox" name="kitchenOpen" defaultChecked={configuration.kitchenOpen} /><span>Kitchen accepting orders</span></label>
              <label className="admin-checkbox"><input type="checkbox" name="temporarilyClosed" defaultChecked={configuration.temporarilyClosed} /><span>Temporary closure (takes effect immediately)</span></label>
              <label><span>Closure note</span><input name="closureNote" maxLength={300} defaultValue={configuration.closureNote} /></label>
              <label><span>Business hours (Asia/Kolkata; one day per line)</span><textarea name="hours" placeholder={"Monday: 10:00-21:00\nTuesday: closed"} defaultValue={formatHours(configuration.hours)} /></label>
              <p className="admin-help">When hours are set, checkout is available only during the configured time. An empty schedule uses the kitchen switch above.</p>
            </div>
            <div className="admin-settings-group">
              <h3>Delivery & pickup</h3>
              <label className="admin-checkbox"><input type="checkbox" name="deliveryEnabled" defaultChecked={configuration.fulfillment.deliveryEnabled} /><span>Enable delivery</span></label>
              <label><span>Delivery zones (locality|PIN codes|fee in INR per line)</span><textarea name="deliveryZones" placeholder={"Mancherial|504208,504209|30.00\n*|504210|50.00"} defaultValue={deliveryZones} /></label>
              <label className="admin-checkbox"><input type="checkbox" name="pickupEnabled" defaultChecked={configuration.fulfillment.pickupEnabled} /><span>Enable pickup</span></label>
              <label><span>Pickup fee (INR)</span><input name="pickupFeeRupees" type="number" min="0" step="0.01" defaultValue={(configuration.fulfillment.pickupFeeInPaise / 100).toFixed(2)} /></label>
            </div>
            <div className="admin-settings-group">
              <h3>Taxes & promotions</h3>
              <label><span>Tax rate (%)</span><input name="taxRatePercent" type="number" min="0" max="100" step="0.01" defaultValue={configuration.taxes.ratePercent} /></label>
              <label className="admin-checkbox"><input type="checkbox" name="taxDeliveryFee" defaultChecked={configuration.taxes.applyToDeliveryFee} /><span>Apply tax to delivery fee</span></label>
              <label className="admin-checkbox"><input type="checkbox" name="promotionEnabled" defaultChecked={configuration.promotion.enabled} /><span>Enable flat discount promotion</span></label>
              <label><span>Promotion code</span><input name="promotionCode" maxLength={40} defaultValue={configuration.promotion.code} /></label>
              <label><span>Discount amount (INR)</span><input name="discountRupees" type="number" min="0" step="0.01" defaultValue={(configuration.discountInPaise / 100).toFixed(2)} /></label>
            </div>
            <div className="admin-settings-submit">
              <button className="admin-button admin-button-primary" type="submit">Save business settings</button>
            </div>
          </form>
        </section>
        <footer className="admin-footer">
          Signed in as {session.email}. Gateway secrets are not stored in or displayed by this dashboard.
        </footer>
      </div>
    </main>
  );
}
