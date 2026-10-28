import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  getBusinessConfiguration,
  isKitchenAcceptingOrders,
  type FulfillmentMethod,
} from "@/data/business";
import { getMenuProducts, type MenuProduct } from "@/data/menu";
import { getDatabase } from "@/lib/database";

export type CheckoutLineInput = {
  productId: string;
  portionSizeMl: number;
  quantity: number;
  customizationSelections?: Record<string, string>;
  addOnIds?: string[];
};

export type CheckoutCustomer = {
  name: string;
  mobile: string;
  address?: string;
  landmark?: string;
  locality?: string;
  postalCode?: string;
  instructions?: string;
};

export type CheckoutRequest = {
  fulfillmentMethod: FulfillmentMethod;
  items: CheckoutLineInput[];
  customer: CheckoutCustomer;
  promotionCode?: string;
};

export type OrderLine = {
  productId: string;
  productName: string;
  portionSizeMl: number;
  quantity: number;
  unitPriceInPaise: number;
  lineTotalInPaise: number;
};

export type OrderQuote = {
  items: OrderLine[];
  subtotalInPaise: number;
  deliveryFeeInPaise: number;
  discountInPaise: number;
  taxInPaise: number;
  totalInPaise: number;
  fulfillmentMethod: FulfillmentMethod;
};

export type PaymentStatus =
  | "pending"
  | "failed"
  | "cancelled"
  | "paid"
  | "refund_pending"
  | "partially_refunded"
  | "refunded";

export type OrderRefund = {
  id: string;
  amountInPaise: number;
  status: "pending" | "processed" | "failed";
};

export type OrderPayment = {
  provider: "razorpay";
  status: PaymentStatus;
  gatewayOrderId?: string;
  gatewayPaymentIds: string[];
  refunds: OrderRefund[];
  updatedAt: string;
};

export type StoredOrder = {
  id: string;
  customer: CheckoutCustomer;
  quote: OrderQuote;
  status: OrderStatus;
  payment: OrderPayment;
  createdAt: string;
  trackingTokenHash: string;
  isTestOrder: true;
};

export type OrderStatus =
  | "new"
  | "confirmed"
  | "preparing"
  | "ready"
  | "dispatched"
  | "delivered"
  | "cancelled";

const allowedOrderTransitions: Record<OrderStatus, OrderStatus[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["dispatched", "delivered", "cancelled"],
  dispatched: ["delivered"],
  delivered: [],
  cancelled: [],
};

export class CheckoutRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function orderFromJson(value: string) {
  return JSON.parse(value) as StoredOrder;
}

function saveOrder(order: StoredOrder) {
  getDatabase()
    .prepare("UPDATE orders SET data = ?, status = ? WHERE id = ?")
    .run(JSON.stringify(order), order.status, order.id);
}

function getOrder(orderId: string) {
  const row = getDatabase()
    .prepare("SELECT data FROM orders WHERE id = ?")
    .get(orderId) as { data: string } | undefined;
  return row ? orderFromJson(row.data) : null;
}

function listOrders() {
  const rows = getDatabase()
    .prepare("SELECT data FROM orders ORDER BY created_at DESC")
    .all() as { data: string }[];
  return rows.map((row) => orderFromJson(row.data));
}

export function listAdminOrders() {
  const rows = getDatabase()
    .prepare("SELECT data FROM orders ORDER BY created_at DESC LIMIT 100")
    .all() as { data: string }[];
  return rows.map((row) => orderFromJson(row.data));
}

export function getAllowedOrderTransitions(status: OrderStatus) {
  return allowedOrderTransitions[status];
}

export function getAllowedOrderTransitionsForOrder(order: StoredOrder) {
  return getAllowedOrderTransitions(order.status).filter(
    (status) =>
      status !== "dispatched" ||
      order.quote.fulfillmentMethod === "delivery",
  );
}

export function updateOrderStatus(orderId: string, nextStatus: OrderStatus) {
  const order = getOrder(orderId);
  if (!order) throw new CheckoutRequestError("The order could not be found.", 404);
  if (!getAllowedOrderTransitionsForOrder(order).includes(nextStatus)) {
    throw new CheckoutRequestError(
      `An order cannot move from ${order.status} to ${nextStatus}.`,
      409,
    );
  }
  const updated = { ...order, status: nextStatus };
  saveOrder(updated);
  return updated;
}

export function validateCheckoutRequest(value: unknown): {
  request?: CheckoutRequest;
  errors: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["Please review your checkout details and try again."] };
  }
  const body = value as Record<string, unknown>;
  const errors: string[] = [];

  if (body.fulfillmentMethod !== "delivery" && body.fulfillmentMethod !== "pickup") {
    errors.push("Choose delivery or pickup.");
  }

  const promotionCode =
    body.promotionCode === undefined
      ? ""
      : typeof body.promotionCode === "string"
        ? body.promotionCode.trim().slice(0, 40)
        : "";
  if (body.promotionCode !== undefined && typeof body.promotionCode !== "string") {
    errors.push("The promotion code is invalid.");
  }

  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    errors.push("Your cart must contain between 1 and 20 items.");
  }

  const customerValue = body.customer;
  if (!customerValue || typeof customerValue !== "object" || Array.isArray(customerValue)) {
    errors.push("Enter your contact and fulfillment details.");
  }

  if (errors.length > 0) return { errors };

  const customerBody = customerValue as Record<string, unknown>;
  const name = typeof customerBody.name === "string" ? customerBody.name.trim() : "";
  const mobile = typeof customerBody.mobile === "string" ? customerBody.mobile.trim() : "";
  const normalizedMobile = mobile.replace(/[()\s-]/g, "");
  const mobileIsValid =
    /^[6-9]\d{9}$/.test(normalizedMobile) ||
    /^\+91[6-9]\d{9}$/.test(normalizedMobile);

  if (name.length < 2 || name.length > 100) {
    errors.push("Enter your name (2 to 100 characters).");
  }
  if (!mobileIsValid) {
    errors.push("Enter a valid 10-digit Indian mobile number.");
  }

  const optionalText = (field: string, maxLength: number) => {
    const fieldValue = customerBody[field];
    if (fieldValue === undefined) return "";
    if (typeof fieldValue !== "string" || fieldValue.trim().length > maxLength) {
      errors.push(`${field} must be no more than ${maxLength} characters.`);
      return "";
    }
    return fieldValue.trim();
  };

  const address = optionalText("address", 500);
  const landmark = optionalText("landmark", 160);
  const locality = optionalText("locality", 120);
  const postalCode = optionalText("postalCode", 10).replace(/\s/g, "");
  const instructions = optionalText("instructions", 500);

  if (body.fulfillmentMethod === "delivery") {
    if (!address) errors.push("Enter the delivery address.");
    if (!locality) errors.push("Enter the delivery area or locality.");
    if (!/^\d{6}$/.test(postalCode)) errors.push("Enter a valid 6-digit delivery PIN code.");
  }

  const items: CheckoutLineInput[] = [];
  if (Array.isArray(body.items)) {
    body.items.forEach((rawItem, index) => {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        errors.push(`Cart item ${index + 1} is invalid.`);
        return;
      }
      const item = rawItem as Record<string, unknown>;
      if (
        typeof item.productId !== "string" ||
        !Number.isSafeInteger(item.portionSizeMl) ||
        !Number.isSafeInteger(item.quantity) ||
        (item.quantity as number) < 1 ||
        (item.quantity as number) > 20
      ) {
        errors.push(`Cart item ${index + 1} has an invalid product, portion, or quantity.`);
        return;
      }

      const customizationSelections: Record<string, string> = {};
      if (
        item.customizationSelections !== undefined &&
        (!item.customizationSelections ||
          typeof item.customizationSelections !== "object" ||
          Array.isArray(item.customizationSelections))
      ) {
        errors.push(`Cart item ${index + 1} has invalid options.`);
        return;
      }
      if (item.customizationSelections) {
        for (const [key, selected] of Object.entries(
          item.customizationSelections as Record<string, unknown>,
        )) {
          if (typeof selected !== "string") {
            errors.push(`Cart item ${index + 1} has invalid options.`);
            return;
          }
          customizationSelections[key] = selected;
        }
      }

      const addOnIds = item.addOnIds ?? [];
      if (
        !Array.isArray(addOnIds) ||
        !addOnIds.every((addOnId) => typeof addOnId === "string")
      ) {
        errors.push(`Cart item ${index + 1} has invalid add-ons.`);
        return;
      }
      items.push({
        productId: item.productId,
        portionSizeMl: item.portionSizeMl as number,
        quantity: item.quantity as number,
        customizationSelections,
        addOnIds: addOnIds as string[],
      });
    });
  }

  if (errors.length > 0) return { errors };
  return {
    request: {
      fulfillmentMethod: body.fulfillmentMethod as FulfillmentMethod,
      items,
      customer: {
        name,
        mobile: normalizedMobile,
        address,
        landmark,
        locality,
        postalCode,
        instructions,
      },
      ...(promotionCode ? { promotionCode } : {}),
    },
    errors,
  };
}

export async function calculateOrderQuote(
  request: CheckoutRequest,
): Promise<{ quote?: OrderQuote; errors: string[] }> {
  const configuration = getBusinessConfiguration();
  const errors: string[] = [];

  if (configuration.mode !== "development-test") {
    errors.push("Online ordering is not configured for real customer orders.");
  }
  if (!isKitchenAcceptingOrders(configuration)) {
    errors.push("The kitchen is currently closed and cannot accept orders.");
  }

  if (request.fulfillmentMethod === "delivery") {
    if (!configuration.fulfillment.deliveryEnabled) {
      errors.push("Delivery is not enabled in the business configuration.");
    }
  } else if (!configuration.fulfillment.pickupEnabled) {
    errors.push("Pickup is not enabled in the business configuration.");
  }

  const products = await getMenuProducts();
  const productById = new Map(products.map((product) => [product.id, product]));
  const orderLines: OrderLine[] = [];
  let subtotalInPaise = 0;

  for (const [index, line] of request.items.entries()) {
    const product = productById.get(line.productId);
    if (!product) {
      errors.push(`Cart item ${index + 1} is not on the current menu.`);
      continue;
    }
    if (product.availability !== "available") {
      errors.push(`${product.name} is currently unavailable.`);
      continue;
    }

    const portion = product.portions.find(
      (entry) => entry.sizeInMl === line.portionSizeMl,
    );
    if (!portion) {
      errors.push(`The selected portion for ${product.name} is no longer available.`);
      continue;
    }

    const modifiers = calculateModifierPrice(product, line, index, errors);
    const unitPriceInPaise = portion.priceInPaise + modifiers;
    const lineTotalInPaise = unitPriceInPaise * line.quantity;
    subtotalInPaise += lineTotalInPaise;
    orderLines.push({
      productId: product.id,
      productName: product.name,
      portionSizeMl: portion.sizeInMl,
      quantity: line.quantity,
      unitPriceInPaise,
      lineTotalInPaise,
    });
  }

  let deliveryFeeInPaise = 0;
  if (request.fulfillmentMethod === "delivery") {
    const matchingZone = configuration.fulfillment.deliveryZones.find(
      (zone) => {
        const localityMatches =
          zone.localities.length === 0 ||
          zone.localities.some(
            (locality) =>
              locality.toLocaleLowerCase() ===
              request.customer.locality?.toLocaleLowerCase(),
          );
        const postalCodeMatches =
          zone.postalCodes.length === 0 ||
          zone.postalCodes.includes(request.customer.postalCode ?? "");
        return (
          (zone.localities.length > 0 || zone.postalCodes.length > 0) &&
          localityMatches &&
          postalCodeMatches
        );
      },
    );
    if (!matchingZone) {
      errors.push("This address is outside the configured delivery zones.");
    } else {
      deliveryFeeInPaise = matchingZone.deliveryFeeInPaise;
    }
  } else {
    deliveryFeeInPaise = configuration.fulfillment.pickupFeeInPaise;
  }

  const requestedPromotion = request.promotionCode?.trim() ?? "";
  if (
    requestedPromotion &&
    (!configuration.promotion.enabled ||
      requestedPromotion.toLocaleLowerCase() !==
        configuration.promotion.code.toLocaleLowerCase())
  ) {
    errors.push("That promotion code is not valid.");
  }
  if (errors.length > 0) return { errors };
  const discountInPaise =
    requestedPromotion && configuration.promotion.enabled
      ? Math.min(configuration.discountInPaise, subtotalInPaise)
      : 0;
  const taxableAmount =
    subtotalInPaise -
    discountInPaise +
    (configuration.taxes.applyToDeliveryFee ? deliveryFeeInPaise : 0);
  const taxInPaise = Math.round(
    (taxableAmount * configuration.taxes.ratePercent) / 100,
  );

  return {
    quote: {
      items: orderLines,
      subtotalInPaise,
      deliveryFeeInPaise,
      discountInPaise,
      taxInPaise,
      totalInPaise:
        subtotalInPaise - discountInPaise + deliveryFeeInPaise + taxInPaise,
      fulfillmentMethod: request.fulfillmentMethod,
    },
    errors,
  };
}

function calculateModifierPrice(
  product: MenuProduct,
  line: CheckoutLineInput,
  index: number,
  errors: string[],
) {
  let modifierTotal = 0;
  const customizationSelections = line.customizationSelections ?? {};
  const availableCustomizations = product.customizations ?? [];

  for (const [customizationId, optionId] of Object.entries(customizationSelections)) {
    const customization = availableCustomizations.find(
      (entry) => entry.id === customizationId,
    );
    const option = customization?.options.find((entry) => entry.id === optionId);
    if (!option) {
      errors.push(`Cart item ${index + 1} has an unavailable customization.`);
    } else {
      modifierTotal += option.priceInPaise ?? 0;
    }
  }

  for (const customization of availableCustomizations) {
    if (
      customization.options.length > 0 &&
      !customizationSelections[customization.id]
    ) {
      errors.push(`Choose ${customization.label} for ${product.name}.`);
    }
  }

  const selectedAddOnIds = line.addOnIds ?? [];
  const availableAddOns = product.addOns ?? [];
  for (const addOnId of selectedAddOnIds) {
    const addOn = availableAddOns.find((entry) => entry.id === addOnId);
    if (!addOn) {
      errors.push(`Cart item ${index + 1} has an unavailable add-on.`);
    } else {
      modifierTotal += addOn.priceInPaise;
    }
  }

  return modifierTotal;
}

function fingerprint(request: CheckoutRequest) {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

function makeTrackingToken() {
  return randomBytes(32).toString("base64url");
}

function hashTrackingToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createTestOrder(
  request: CheckoutRequest,
  idempotencyKey: string,
): Promise<{ order: StoredOrder; trackingToken: string; duplicate: boolean }> {
  const db = getDatabase();
  const requestFingerprint = fingerprint(request);
  const existingOrder = getIdempotentOrder(
    idempotencyKey,
    requestFingerprint,
  );
  if (existingOrder) return existingOrder;

  let quote: OrderQuote;
  try {
    const result = await calculateOrderQuote(request);
    if (!result.quote || result.errors.length > 0) {
      throw new CheckoutRequestError(result.errors.join(" "), 422);
    }
    quote = result.quote;
  } catch (error) {
    throw error;
  }

  const trackingToken = makeTrackingToken();
  const order: StoredOrder = {
    id: `BB-${new Date().getFullYear()}-${randomUUID().toUpperCase()}`,
    customer: request.customer,
    quote,
    status: "new",
    payment: {
      provider: "razorpay",
      status: "pending",
      gatewayPaymentIds: [],
      refunds: [],
      updatedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
    trackingTokenHash: hashTrackingToken(trackingToken),
    isTestOrder: true,
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db
      .prepare(
        "SELECT order_id, fingerprint FROM order_idempotency WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as
      | { order_id: string; fingerprint: string }
      | undefined;
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw new CheckoutRequestError(
          "This checkout request was already used for different details.",
          409,
        );
      }
      const saved = getOrder(existing.order_id);
      if (!saved) {
        throw new CheckoutRequestError(
          "The existing order is no longer available.",
          409,
        );
      }
      const duplicateToken = makeTrackingToken();
      const updated = {
        ...saved,
        trackingTokenHash: hashTrackingToken(duplicateToken),
      };
      saveOrder(updated);
      db.exec("COMMIT");
      return { order: updated, trackingToken: duplicateToken, duplicate: true };
    }

    db.prepare(
      "INSERT INTO orders (id, data, status, created_at) VALUES (?, ?, ?, ?)",
    ).run(order.id, JSON.stringify(order), order.status, order.createdAt);
    db.prepare(
      "INSERT INTO order_idempotency (idempotency_key, order_id, fingerprint) VALUES (?, ?, ?)",
    ).run(idempotencyKey, order.id, requestFingerprint);
    db.exec("COMMIT");
    return { order, trackingToken, duplicate: false };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getIdempotentOrder(idempotencyKey: string, requestFingerprint: string) {
  const db = getDatabase();
  const existing = db
    .prepare(
      "SELECT order_id, fingerprint FROM order_idempotency WHERE idempotency_key = ?",
    )
    .get(idempotencyKey) as
    | { order_id: string; fingerprint: string }
    | undefined;
  if (!existing) return null;
  if (existing.fingerprint !== requestFingerprint) {
    throw new CheckoutRequestError(
      "This checkout request was already used for different details.",
      409,
    );
  }
  const order = getOrder(existing.order_id);
  if (!order) {
    throw new CheckoutRequestError(
      "The existing order is no longer available.",
      409,
    );
  }
  const trackingToken = makeTrackingToken();
  const updatedOrder = {
    ...order,
    trackingTokenHash: hashTrackingToken(trackingToken),
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    saveOrder(updatedOrder);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { order: updatedOrder, trackingToken, duplicate: true };
}

export function getOrderForPayment(orderId: string) {
  return getOrder(orderId);
}

export function setGatewayOrderId(orderId: string, gatewayOrderId: string) {
  const order = getOrder(orderId);
  if (!order) throw new CheckoutRequestError("The order could not be found.", 404);
  if (
    order.payment.gatewayOrderId &&
    order.payment.gatewayOrderId !== gatewayOrderId
  ) {
    throw new CheckoutRequestError(
      "A payment order already exists for this order.",
      409,
    );
  }
  const updated = {
    ...order,
    payment: {
      ...order.payment,
      gatewayOrderId,
      updatedAt: new Date().toISOString(),
    },
  };
  saveOrder(updated);
  return updated;
}

export function findOrderByGatewayOrderId(gatewayOrderId: string) {
  for (const order of listOrders()) {
    if (order.payment.gatewayOrderId === gatewayOrderId) return order;
  }
  return null;
}

export function findOrderByGatewayPaymentId(gatewayPaymentId: string) {
  for (const order of listOrders()) {
    if (order.payment.gatewayPaymentIds.includes(gatewayPaymentId)) return order;
  }
  return null;
}

export function updateOrderPayment(
  orderId: string,
  status: PaymentStatus,
  gatewayPaymentId?: string,
) {
  const order = getOrder(orderId);
  if (!order) throw new CheckoutRequestError("The order could not be found.", 404);

  const currentStatus = order.payment.status;
  const latestPaymentId =
    order.payment.gatewayPaymentIds[order.payment.gatewayPaymentIds.length - 1];
  const isStalePaymentAttempt =
    gatewayPaymentId &&
    order.payment.gatewayPaymentIds.includes(gatewayPaymentId) &&
    latestPaymentId !== gatewayPaymentId;
  if (
    currentStatus === "refunded" ||
    currentStatus === "partially_refunded" ||
    (currentStatus === "refund_pending" && status === "paid") ||
    (isStalePaymentAttempt && status !== "paid" && status !== "refunded") ||
    (currentStatus === "paid" &&
      (status === "pending" || status === "failed" || status === "cancelled")) ||
    (currentStatus === "paid" && status === "refund_pending")
  ) {
    return order;
  }

  const paymentIds = gatewayPaymentId
    ? [...new Set([...order.payment.gatewayPaymentIds, gatewayPaymentId])]
    : order.payment.gatewayPaymentIds;
  const updated = {
    ...order,
    payment: {
      ...order.payment,
      status,
      gatewayPaymentIds: paymentIds,
      updatedAt: new Date().toISOString(),
    },
  };
  saveOrder(updated);
  return updated;
}

export function updateOrderRefund(
  orderId: string,
  refundId: string,
  amountInPaise: number,
  status: OrderRefund["status"],
) {
  const order = getOrder(orderId);
  if (!order) throw new CheckoutRequestError("The order could not be found.", 404);
  if (
    !Number.isSafeInteger(amountInPaise) ||
    amountInPaise <= 0 ||
    amountInPaise > order.quote.totalInPaise
  ) {
    throw new CheckoutRequestError("The refund amount is invalid.", 400);
  }

  const refunds = [...order.payment.refunds];
  const existingIndex = refunds.findIndex((refund) => refund.id === refundId);
  if (existingIndex >= 0) {
    const existingRefund = refunds[existingIndex];
    if (existingRefund.amountInPaise !== amountInPaise) {
      throw new CheckoutRequestError("The refund amount changed unexpectedly.", 400);
    }
    refunds[existingIndex] = { ...existingRefund, status };
  } else {
    refunds.push({ id: refundId, amountInPaise, status });
  }

  const allocatedRefundTotal = refunds
    .filter((refund) => refund.status !== "failed")
    .reduce((sum, refund) => sum + refund.amountInPaise, 0);
  if (allocatedRefundTotal > order.quote.totalInPaise) {
    throw new CheckoutRequestError(
      "The total refund exceeds the order amount.",
      400,
    );
  }
  const processedRefundTotal = refunds
    .filter((refund) => refund.status === "processed")
    .reduce((sum, refund) => sum + refund.amountInPaise, 0);
  const hasPendingRefund = refunds.some((refund) => refund.status === "pending");
  const paymentStatus: PaymentStatus =
    order.payment.status === "refunded"
      ? "refunded"
      : hasPendingRefund
        ? "refund_pending"
        : processedRefundTotal >= order.quote.totalInPaise
          ? "refunded"
          : processedRefundTotal > 0
            ? "partially_refunded"
            : "paid";
  const updated = {
    ...order,
    payment: {
      ...order.payment,
      status: paymentStatus,
      refunds,
      updatedAt: new Date().toISOString(),
    },
  };
  saveOrder(updated);
  return updated;
}

export function claimPaymentEvent(eventId: string) {
  const result = getDatabase()
    .prepare("INSERT OR IGNORE INTO payment_events (event_id, created_at) VALUES (?, ?)")
    .run(eventId, new Date().toISOString());
  return result.changes === 1;
}

export function hasProcessedPaymentEvent(eventId: string) {
  return Boolean(
    getDatabase()
      .prepare("SELECT 1 AS found FROM payment_events WHERE event_id = ?")
      .get(eventId),
  );
}

export function getTrackedOrder(orderId: string, token: string) {
  const order = getOrder(orderId);
  if (!order || token.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return null;
  }
  const providedHash = Buffer.from(hashTrackingToken(token), "hex");
  const storedHash = Buffer.from(order.trackingTokenHash, "hex");
  if (
    providedHash.length !== storedHash.length ||
    !timingSafeEqual(providedHash, storedHash)
  ) {
    return null;
  }
  return order;
}
