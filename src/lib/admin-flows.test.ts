import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getMenuProducts, saveMenuProduct } from "@/data/menu";
import { saveBusinessConfiguration } from "@/data/business";
import { createTestOrder, getTrackedOrder, updateOrderStatus } from "@/lib/orders";
import { getDatabase } from "@/lib/database";

const testDirectory = mkdtempSync(join(tmpdir(), "bb-cloud-kitchen-admin-"));
process.env.DATABASE_PATH = join(testDirectory, "test.sqlite");
saveBusinessConfiguration({
  mode: "development-test",
  kitchenOpen: true,
  temporarilyClosed: false,
  closureNote: "",
  hours: [],
  fulfillment: {
    deliveryEnabled: false,
    pickupEnabled: true,
    deliveryZones: [],
    pickupFeeInPaise: 0,
  },
  taxes: { ratePercent: 0, applyToDeliveryFee: false },
  discountInPaise: 0,
  promotion: { enabled: false, code: "" },
});

after(() => {
  globalThis.bbCloudKitchenDatabase?.close();
  globalThis.bbCloudKitchenDatabase = undefined;
  rmSync(testDirectory, { recursive: true, force: true });
});

test("creates and edits a soup, marks it sold out, receives an order, and advances its status", async () => {
  const product = {
    id: "admin-flow-test-soup",
    name: "Admin Flow Soup",
    description: "A test soup product for staff dashboard acceptance checks.",
    imageUrl: "https://example.com/soup.jpg",
    imageAlt: "Soup product test image",
    portions: [{ sizeInMl: 300, priceInPaise: 18500 }],
    ingredients: [],
    availability: "available" as const,
    active: true,
    preparationTimeMinutes: 20,
  };

  saveMenuProduct(product);
  let storedProduct = (await getMenuProducts({ includeInactive: true })).find(
    (entry) => entry.id === product.id,
  );
  assert.ok(storedProduct, "product is created in persistent storage");

  const repricedProduct = {
    ...storedProduct,
    portions: [{ sizeInMl: 300, priceInPaise: 19900 }],
  };
  saveMenuProduct(repricedProduct);
  storedProduct = (await getMenuProducts({ includeInactive: true })).find(
    (entry) => entry.id === product.id,
  );
  assert.equal(storedProduct?.portions[0]?.priceInPaise, 19900);

  saveMenuProduct({ ...repricedProduct, availability: "sold-out" });
  storedProduct = (await getMenuProducts()).find((entry) => entry.id === product.id);
  assert.equal(storedProduct?.availability, "sold-out");

  saveMenuProduct({ ...repricedProduct, availability: "available" });
  const orderRequest = {
    fulfillmentMethod: "pickup" as const,
    items: [{ productId: product.id, portionSizeMl: 300, quantity: 2 }],
    customer: { name: "Test Customer", mobile: "9876543210" },
  };
  const { order, trackingToken } = await createTestOrder(
    orderRequest,
    randomUUID(),
  );
  assert.equal(order.status, "new");
  assert.equal(order.quote.items[0]?.quantity, 2);
  assert.equal(order.quote.subtotalInPaise, 39800);
  assert.equal(getTrackedOrder(order.id, trackingToken)?.id, order.id);

  assert.equal(updateOrderStatus(order.id, "confirmed").status, "confirmed");
  assert.equal(updateOrderStatus(order.id, "preparing").status, "preparing");
  assert.equal(updateOrderStatus(order.id, "ready").status, "ready");
  assert.throws(
    () => updateOrderStatus(order.id, "dispatched"),
    /cannot move from ready to dispatched/,
  );
  assert.equal(updateOrderStatus(order.id, "delivered").status, "delivered");
  assert.throws(
    () => updateOrderStatus(order.id, "cancelled"),
    /cannot move from delivered to cancelled/,
  );
});

test("persists orders across database connections", () => {
  getDatabase().close();
  globalThis.bbCloudKitchenDatabase = undefined;
  const database = getDatabase();
  const savedCount = database
    .prepare("SELECT COUNT(*) AS count FROM orders")
    .get() as { count: number };
  assert.equal(savedCount.count, 1);
});
