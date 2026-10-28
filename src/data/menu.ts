import "server-only";

import { getDatabase } from "@/lib/database";

export type MenuAvailability = "available" | "sold-out";

export type MenuPortion = {
  sizeInMl: number;
  priceInPaise: number;
};

export type MenuCustomization = {
  id: string;
  label: string;
  options: {
    id: string;
    name: string;
    priceInPaise?: number;
  }[];
};

export type MenuAddOn = {
  id: string;
  name: string;
  description?: string;
  priceInPaise: number;
};

export type MenuProduct = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  imageAlt: string;
  portions: MenuPortion[];
  ingredients: string[];
  spiceLevel?: string;
  availability: MenuAvailability;
  active: boolean;
  preparationTimeMinutes: number | null;
  customizations?: MenuCustomization[];
  addOns?: MenuAddOn[];
};

const demoImage =
  "https://images.unsplash.com/photo-1603105037880-880cd4edfb0d?auto=format&fit=crop&w=1200&q=85";

// Replace these clearly marked examples with owner-approved menu data before launch.
export const demoMenuProducts: MenuProduct[] = [
  {
    id: "classic-goat-bone-soup",
    name: "Classic Goat Bone Soup",
    description:
      "Demo product. The final description and product details are awaiting kitchen approval.",
    imageUrl: demoImage,
    imageAlt: "Illustrative soup image for a demo goat bone soup listing",
    portions: [
      { sizeInMl: 250, priceInPaise: 15900 },
      { sizeInMl: 400, priceInPaise: 22900 },
      { sizeInMl: 750, priceInPaise: 38900 },
    ],
    ingredients: [],
    availability: "available",
    active: true,
    preparationTimeMinutes: null,
  },
  {
    id: "spicy-goat-bone-soup",
    name: "Spicy Goat Bone Soup",
    description:
      "Demo product. The final description and product details are awaiting kitchen approval.",
    imageUrl: demoImage,
    imageAlt: "Illustrative soup image for a demo goat bone soup listing",
    portions: [
      { sizeInMl: 250, priceInPaise: 16900 },
      { sizeInMl: 400, priceInPaise: 23900 },
      { sizeInMl: 750, priceInPaise: 39900 },
    ],
    ingredients: [],
    availability: "available",
    active: true,
    preparationTimeMinutes: null,
  },
  {
    id: "pepper-goat-bone-soup",
    name: "Pepper Goat Bone Soup",
    description:
      "Demo product. The final description and product details are awaiting kitchen approval.",
    imageUrl: demoImage,
    imageAlt: "Illustrative soup image for a demo goat bone soup listing",
    portions: [
      { sizeInMl: 250, priceInPaise: 16900 },
      { sizeInMl: 400, priceInPaise: 23900 },
      { sizeInMl: 750, priceInPaise: 39900 },
    ],
    ingredients: [],
    availability: "sold-out",
    active: true,
    preparationTimeMinutes: null,
  },
];

export async function getMenuProducts(options?: {
  includeInactive?: boolean;
}): Promise<MenuProduct[]> {
  const db = getDatabase();
  const row = db.prepare("SELECT 1 AS found FROM products LIMIT 1").get();
  if (!row) {
    const insert = db.prepare(
      "INSERT INTO products (id, data, active, updated_at) VALUES (?, ?, ?, ?)",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!db.prepare("SELECT 1 AS found FROM products LIMIT 1").get()) {
        for (const product of demoMenuProducts) {
          insert.run(
            product.id,
            JSON.stringify(product),
            Number(product.active),
            new Date().toISOString(),
          );
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const rows = db
    .prepare(
      options?.includeInactive
        ? "SELECT data FROM products ORDER BY id"
        : "SELECT data FROM products WHERE active = 1 ORDER BY id",
    )
    .all() as { data: string }[];
  return rows.map((entry) => {
    const product = JSON.parse(entry.data) as MenuProduct;
    return { ...product, active: product.active ?? true };
  });
}

export function saveMenuProduct(product: MenuProduct) {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO products (id, data, active, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data,
       active = excluded.active,
       updated_at = excluded.updated_at`,
  ).run(
    product.id,
    JSON.stringify(product),
    Number(product.active),
    new Date().toISOString(),
  );
}
