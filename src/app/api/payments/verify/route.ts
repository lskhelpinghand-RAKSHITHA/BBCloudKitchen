import {
  PaymentRequestError,
  verifyCustomerPayment,
} from "@/lib/payments";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: ["Payment verification data is invalid."] }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ errors: ["Payment verification data is invalid."] }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  if (
    typeof input.orderId !== "string" ||
    typeof input.trackingToken !== "string" ||
    typeof input.gatewayOrderId !== "string" ||
    typeof input.gatewayPaymentId !== "string" ||
    (input.signature !== undefined && typeof input.signature !== "string")
  ) {
    return Response.json({ errors: ["Payment verification data is invalid."] }, { status: 400 });
  }

  try {
    const result = await verifyCustomerPayment({
      orderId: input.orderId,
      trackingToken: input.trackingToken,
      gatewayOrderId: input.gatewayOrderId,
      gatewayPaymentId: input.gatewayPaymentId,
      signature: input.signature,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PaymentRequestError) {
      return Response.json({ errors: [error.message] }, { status: error.status });
    }
    console.error("Unable to verify Razorpay payment.", error);
    return Response.json(
      { errors: ["Payment status could not be verified. Please retry shortly."] },
      { status: 500 },
    );
  }
}
