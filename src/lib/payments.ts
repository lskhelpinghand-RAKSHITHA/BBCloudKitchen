import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  claimPaymentEvent,
  findOrderByGatewayOrderId,
  findOrderByGatewayPaymentId,
  hasProcessedPaymentEvent,
  getOrderForPayment,
  getTrackedOrder,
  setGatewayOrderId,
  updateOrderPayment,
  updateOrderRefund,
  type PaymentStatus,
} from "@/lib/orders";

type RazorpayTestConfiguration = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
};

type RazorpayPayment = {
  id?: unknown;
  order_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
};

type RazorpayOrder = {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
};

export class PaymentConfigurationError extends Error {
  readonly status = 503;
}

export class PaymentRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const inFlightOrderCreations = new Map<string, Promise<string>>();

function getTestConfiguration(): RazorpayTestConfiguration {
  const { RAZORPAY_MODE, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } =
    process.env;
  if (
    RAZORPAY_MODE !== "test" ||
    !RAZORPAY_KEY_ID ||
    !RAZORPAY_KEY_SECRET ||
    !RAZORPAY_WEBHOOK_SECRET
  ) {
    throw new PaymentConfigurationError(
      "Sandbox payments are not configured. Set RAZORPAY_MODE=test and the three Razorpay test credentials on the server.",
    );
  }
  if (!RAZORPAY_KEY_ID.startsWith("rzp_test_")) {
    throw new PaymentConfigurationError(
      "Only Razorpay test-mode keys are accepted. Live payments are disabled.",
    );
  }
  return {
    keyId: RAZORPAY_KEY_ID,
    keySecret: RAZORPAY_KEY_SECRET,
    webhookSecret: RAZORPAY_WEBHOOK_SECRET,
  };
}

export function getRazorpayTestKeyId() {
  const { RAZORPAY_MODE, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } =
    process.env;
  return RAZORPAY_MODE === "test" &&
    RAZORPAY_KEY_ID?.startsWith("rzp_test_") &&
    RAZORPAY_KEY_SECRET &&
    RAZORPAY_WEBHOOK_SECRET
    ? RAZORPAY_KEY_ID
    : null;
}

function authHeader(configuration: RazorpayTestConfiguration) {
  return `Basic ${Buffer.from(
    `${configuration.keyId}:${configuration.keySecret}`,
  ).toString("base64")}`;
}

async function parseProviderResponse<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PaymentRequestError(
      "The payment provider returned an invalid response.",
      502,
    );
  }
  if (!response.ok) {
    console.error("Razorpay API request failed.", { status: response.status });
    throw new PaymentRequestError(
      "The payment provider could not process this request. Please retry shortly.",
      502,
    );
  }
  return body as T;
}

export async function ensureRazorpayOrder(orderId: string) {
  const configuration = getTestConfiguration();
  const order = getOrderForPayment(orderId);
  if (!order) throw new PaymentRequestError("The order could not be found.", 404);
  if (
    order.payment.status === "paid" ||
    order.payment.status === "refund_pending" ||
    order.payment.status === "partially_refunded" ||
    order.payment.status === "refunded"
  ) {
    throw new PaymentRequestError("This order has already been paid.", 409);
  }
  if (order.payment.gatewayOrderId) return order.payment.gatewayOrderId;

  const existingRequest = inFlightOrderCreations.get(orderId);
  if (existingRequest) return existingRequest;

  const createRequest = (async () => {
    let response: Response;
    try {
      response = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          Authorization: authHeader(configuration),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: order.quote.totalInPaise,
          currency: "INR",
          receipt: `BB${order.id.replace(/[^A-Za-z0-9]/g, "").slice(-32)}`,
          notes: { internal_order_id: order.id },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      console.error("Unable to reach Razorpay while creating a test payment order.", error);
      throw new PaymentRequestError(
        "The payment provider could not be reached. No payment has been taken; retry this order.",
        502,
      );
    }
    const gatewayOrder = await parseProviderResponse<RazorpayOrder>(response);
    if (
      typeof gatewayOrder.id !== "string" ||
      !/^order_[A-Za-z0-9]+$/.test(gatewayOrder.id) ||
      gatewayOrder.amount !== order.quote.totalInPaise ||
      gatewayOrder.currency !== "INR" ||
      gatewayOrder.status !== "created"
    ) {
      console.error("Razorpay returned an unexpected test order response.");
      throw new PaymentRequestError(
        "The payment provider returned an invalid order. Please retry.",
        502,
      );
    }
    setGatewayOrderId(order.id, gatewayOrder.id);
    return gatewayOrder.id;
  })();

  inFlightOrderCreations.set(orderId, createRequest);
  try {
    return await createRequest;
  } finally {
    inFlightOrderCreations.delete(orderId);
  }
}

function signatureMatches(value: string, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(value) || !/^[a-f0-9]{64}$/i.test(expected)) {
    return false;
  }
  const received = Buffer.from(value, "hex");
  const wanted = Buffer.from(expected, "hex");
  return received.length === wanted.length && timingSafeEqual(received, wanted);
}

function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  configuration: RazorpayTestConfiguration,
) {
  const expected = createHmac("sha256", configuration.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return signatureMatches(signature, expected);
}

async function fetchRazorpayPayment(
  paymentId: string,
  configuration: RazorpayTestConfiguration,
) {
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
    throw new PaymentRequestError("The payment reference is invalid.", 400);
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: { Authorization: authHeader(configuration) },
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    console.error("Unable to reach Razorpay while verifying a test payment.", error);
    throw new PaymentRequestError(
      "Payment status could not be checked right now. Please refresh and try again.",
      502,
    );
  }
  return parseProviderResponse<RazorpayPayment>(response);
}

function paymentStatusFromProvider(status: unknown): PaymentStatus {
  switch (status) {
    case "captured":
      return "paid";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    case "authorized":
    case "created":
    default:
      return "pending";
  }
}

export async function verifyCustomerPayment(input: {
  orderId: string;
  trackingToken: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  signature?: string;
}) {
  const configuration = getTestConfiguration();
  const order = getTrackedOrder(input.orderId, input.trackingToken);
  if (!order) throw new PaymentRequestError("The order could not be found.", 404);
  if (
    !order.payment.gatewayOrderId ||
    order.payment.gatewayOrderId !== input.gatewayOrderId
  ) {
    throw new PaymentRequestError("The payment does not match this order.", 400);
  }
  if (
    input.signature &&
    !verifyCheckoutSignature(
      input.gatewayOrderId,
      input.gatewayPaymentId,
      input.signature,
      configuration,
    )
  ) {
    throw new PaymentRequestError("The payment signature is invalid.", 400);
  }

  const payment = await fetchRazorpayPayment(input.gatewayPaymentId, configuration);
  if (
    payment.id !== input.gatewayPaymentId ||
    payment.order_id !== input.gatewayOrderId ||
    payment.amount !== order.quote.totalInPaise ||
    payment.currency !== "INR" ||
    !["created", "authorized", "captured", "failed", "refunded"].includes(
      String(payment.status),
    )
  ) {
    throw new PaymentRequestError(
      "The provider payment details do not match this order.",
      400,
    );
  }
  if (payment.status === "captured" && !input.signature) {
    throw new PaymentRequestError(
      "A valid checkout signature is required to confirm this payment.",
      400,
    );
  }
  const updated = updateOrderPayment(
    order.id,
    paymentStatusFromProvider(payment.status),
    input.gatewayPaymentId,
  );
  return { status: updated.payment.status };
}

export function cancelCustomerPayment(input: {
  orderId: string;
  trackingToken: string;
  gatewayOrderId: string;
}) {
  const order = getTrackedOrder(input.orderId, input.trackingToken);
  if (!order) throw new PaymentRequestError("The order could not be found.", 404);
  if (order.payment.gatewayOrderId !== input.gatewayOrderId) {
    throw new PaymentRequestError("The payment does not match this order.", 400);
  }
  if (order.payment.status === "pending") {
    updateOrderPayment(order.id, "cancelled");
  }
  return { status: getOrderForPayment(order.id)?.payment.status ?? "cancelled" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getEntity(event: Record<string, unknown>, key: string) {
  const payload = event.payload;
  if (!isRecord(payload) || !isRecord(payload[key])) return null;
  const wrapper = payload[key];
  return isRecord(wrapper.entity) ? wrapper.entity : null;
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string) {
  const configuration = getTestConfiguration();
  const expected = createHmac("sha256", configuration.webhookSecret)
    .update(rawBody)
    .digest("hex");
  if (!signatureMatches(signature, expected)) {
    throw new PaymentRequestError("The webhook signature is invalid.", 400);
  }
}

export async function processRazorpayWebhook(eventId: string, rawBody: string) {
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new PaymentRequestError("The webhook body is not valid JSON.", 400);
  }
  if (!isRecord(event) || typeof event.event !== "string") {
    throw new PaymentRequestError("The webhook event is invalid.", 400);
  }

  if (hasProcessedPaymentEvent(eventId)) return { duplicate: true };

  const paymentEventStatuses: Record<string, PaymentStatus> = {
    "payment.authorized": "pending",
    "payment.captured": "paid",
    "payment.failed": "failed",
  };
  const paymentStatus = paymentEventStatuses[event.event];
  if (paymentStatus) {
    const payment = getEntity(event, "payment");
    if (
      !payment ||
      typeof payment.id !== "string" ||
      typeof payment.order_id !== "string" ||
      typeof payment.amount !== "number" ||
      payment.currency !== "INR"
    ) {
      throw new PaymentRequestError("The payment webhook data is invalid.", 400);
    }
    const order = findOrderByGatewayOrderId(payment.order_id);
    if (!order) {
      console.error("A verified Razorpay event references an unknown test order.");
    } else if (payment.amount !== order.quote.totalInPaise) {
      throw new PaymentRequestError(
        "The webhook amount does not match the order.",
        400,
      );
    } else {
      updateOrderPayment(order.id, paymentStatus, payment.id);
    }
  } else if (
    event.event === "refund.created" ||
    event.event === "refund.processed" ||
    event.event === "refund.failed"
  ) {
    const refund = getEntity(event, "refund");
    if (
      !refund ||
      typeof refund.id !== "string" ||
      typeof refund.payment_id !== "string" ||
      typeof refund.amount !== "number"
    ) {
      throw new PaymentRequestError("The refund webhook data is invalid.", 400);
    }
    let order = findOrderByGatewayPaymentId(refund.payment_id);
    if (!order) {
      const configuration = getTestConfiguration();
      const payment = await fetchRazorpayPayment(refund.payment_id, configuration);
      if (
        payment.id !== refund.payment_id ||
        typeof payment.order_id !== "string" ||
        payment.currency !== "INR"
      ) {
        throw new PaymentRequestError("The refund payment reference is invalid.", 400);
      }
      order = findOrderByGatewayOrderId(payment.order_id);
      if (
        order &&
        (payment.amount !== order.quote.totalInPaise ||
          !["captured", "refunded"].includes(String(payment.status)))
      ) {
        throw new PaymentRequestError(
          "The refund payment does not match the order.",
          400,
        );
      }
      if (order) updateOrderPayment(order.id, "paid", refund.payment_id);
    }
    if (order) {
      if (event.event === "refund.created") {
        updateOrderRefund(order.id, refund.id, refund.amount, "pending");
      } else if (event.event === "refund.processed") {
        updateOrderRefund(order.id, refund.id, refund.amount, "processed");
      } else {
        updateOrderRefund(order.id, refund.id, refund.amount, "failed");
      }
    }
  }
  claimPaymentEvent(eventId);
  return { duplicate: false };
}
