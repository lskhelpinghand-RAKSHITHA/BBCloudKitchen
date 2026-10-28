import { getTrackedOrder } from "@/lib/orders";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: ["Order status request is invalid."] }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return Response.json({ errors: ["Order status request is invalid."] }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  if (
    typeof input.orderId !== "string" ||
    typeof input.trackingToken !== "string"
  ) {
    return Response.json({ errors: ["Order status request is invalid."] }, { status: 400 });
  }
  const order = getTrackedOrder(
    input.orderId,
    input.trackingToken,
  );
  if (!order) {
    return Response.json({ errors: ["The order could not be found."] }, { status: 404 });
  }
  return Response.json(
    {
      paymentStatus: order.payment.status,
      gatewayOrderId: order.payment.gatewayOrderId ?? null,
      totalInPaise: order.quote.totalInPaise,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
