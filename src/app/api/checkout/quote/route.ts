import { calculateOrderQuote, validateCheckoutRequest } from "@/lib/orders";

export const runtime = "nodejs";

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

  const { quote, errors } = await calculateOrderQuote(validated.request);
  if (!quote || errors.length > 0) {
    return Response.json({ errors }, { status: 422 });
  }
  return Response.json(
    { quote },
    { headers: { "Cache-Control": "no-store" } },
  );
}
