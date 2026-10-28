import {
  getBusinessConfiguration,
  isKitchenAcceptingOrders,
} from "@/data/business";
import { getMenuProducts } from "@/data/menu";
import { createTestOrder, validateCheckoutRequest } from "@/lib/orders";
import {
  ensureRazorpayOrder,
  getRazorpayTestKeyId,
} from "@/lib/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const [configuration, products] = await Promise.all([
    Promise.resolve(getBusinessConfiguration()),
    getMenuProducts(),
  ]);
  const publicConfiguration = {
    ...configuration,
    kitchenOpen: isKitchenAcceptingOrders(configuration),
    discountInPaise: 0,
    promotion: { enabled: configuration.promotion.enabled, code: "" },
  };
  return Response.json(
    {
      configuration: publicConfiguration,
      products,
      payments: {
        enabled: Boolean(getRazorpayTestKeyId()),
        mode: "test",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { errors: ["Checkout details must be valid JSON."] },
      { status: 400 },
    );
  }

  const validated = validateCheckoutRequest(body);
  if (!validated.request) {
    return Response.json({ errors: validated.errors }, { status: 422 });
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (
    !idempotencyKey ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idempotencyKey,
    )
  ) {
    return Response.json(
      { errors: ["A valid checkout request key is required."] },
      { status: 400 },
    );
  }

  try {
    const razorpayKeyId = getRazorpayTestKeyId();
    if (!razorpayKeyId) {
      return Response.json(
        {
          errors: [
            "Sandbox payments are not configured. Add Razorpay test credentials to the server environment before placing a test order.",
          ],
        },
        { status: 503 },
      );
    }
    const { order, trackingToken, duplicate } = await createTestOrder(
      validated.request,
      idempotencyKey,
    );
    const gatewayOrderId = await ensureRazorpayOrder(order.id);
    const origin = new URL(request.url).origin;
    return Response.json(
      {
        orderId: order.id,
        paymentStatus: order.payment.status,
        isTestOrder: order.isTestOrder,
        totalInPaise: order.quote.totalInPaise,
        gatewayOrderId,
        razorpayKeyId,
        trackingUrl: `${origin}/orders/${encodeURIComponent(order.id)}?token=${encodeURIComponent(trackingToken)}`,
        duplicate,
      },
      { status: duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number"
    ) {
      return Response.json({ errors: [error.message] }, { status: error.status });
    }
    console.error("Unable to create a test order.", error);
    return Response.json(
      { errors: ["The order could not be saved. Please try again."] },
      { status: 500 },
    );
  }
}
