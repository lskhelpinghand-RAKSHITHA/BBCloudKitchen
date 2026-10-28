import {
  PaymentRequestError,
  processRazorpayWebhook,
  verifyRazorpayWebhookSignature,
} from "@/lib/payments";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 1_000_000) {
    return Response.json({ errors: ["Webhook payload is too large."] }, { status: 413 });
  }

  const eventId = request.headers.get("x-razorpay-event-id");
  const signature = request.headers.get("x-razorpay-signature");
  if (!eventId || eventId.length > 200 || !signature) {
    return Response.json({ errors: ["Webhook headers are invalid."] }, { status: 400 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ errors: ["Webhook body could not be read."] }, { status: 400 });
  }
  if (Buffer.byteLength(rawBody, "utf8") > 1_000_000) {
    return Response.json({ errors: ["Webhook payload is too large."] }, { status: 413 });
  }

  try {
    verifyRazorpayWebhookSignature(rawBody, signature);
    const result = await processRazorpayWebhook(eventId, rawBody);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PaymentRequestError) {
      return Response.json({ errors: [error.message] }, { status: error.status });
    }
    console.error("Unable to process Razorpay webhook.", error);
    return Response.json(
      { errors: ["Webhook processing failed."] },
      { status: 500 },
    );
  }
}
