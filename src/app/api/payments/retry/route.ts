import { getTrackedOrder } from "@/lib/orders";
import {
  ensureRazorpayOrder,
  getRazorpayTestKeyId,
  PaymentRequestError,
} from "@/lib/payments";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: ["Payment retry request is invalid."] }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return Response.json({ errors: ["Payment retry request is invalid."] }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  if (
    typeof input.orderId !== "string" ||
    typeof input.trackingToken !== "string"
  ) {
    return Response.json({ errors: ["Payment retry request is invalid."] }, { status: 400 });
  }
  const order = getTrackedOrder(
    input.orderId,
    input.trackingToken,
  );
  if (!order) {
    return Response.json({ errors: ["The order could not be found."] }, { status: 404 });
  }
  const razorpayKeyId = getRazorpayTestKeyId();
  if (!razorpayKeyId) {
    return Response.json(
      { errors: ["Sandbox payments are not configured on this server."] },
      { status: 503 },
    );
  }

  try {
    const gatewayOrderId = await ensureRazorpayOrder(order.id);
    return Response.json(
      {
        gatewayOrderId,
        razorpayKeyId,
        paymentStatus: order.payment.status,
        totalInPaise: order.quote.totalInPaise,
        customer: { name: order.customer.name, mobile: order.customer.mobile },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PaymentRequestError) {
      return Response.json({ errors: [error.message] }, { status: error.status });
    }
    console.error("Unable to prepare Razorpay payment retry.", error);
    return Response.json(
      { errors: ["Payment retry could not be prepared. Please try again."] },
      { status: 500 },
    );
  }
}
