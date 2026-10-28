import { getMenuProducts } from "@/data/menu";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const products = await getMenuProducts();
  return Response.json(
    { products },
    { headers: { "Cache-Control": "no-store" } },
  );
}
