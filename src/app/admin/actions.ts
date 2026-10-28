"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  authenticateStaff,
  endAdminSession,
  getLoginAddressKey,
  requireAdmin,
} from "@/lib/admin-auth";
import {
  getBusinessConfiguration,
  saveBusinessConfiguration,
  type BusinessDay,
  type BusinessHour,
} from "@/data/business";
import { getMenuProducts, saveMenuProduct, type MenuProduct } from "@/data/menu";
import {
  updateOrderStatus,
  type OrderStatus,
} from "@/lib/orders";

const weekdays: BusinessDay[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function textField(formData: FormData, name: string, maxLength: number) {
  const value = formData.get(name);
  if (typeof value !== "string") throw new Error(`The ${name} field is invalid.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`The ${name} field is too long.`);
  return trimmed;
}

function optionalNumber(formData: FormData, name: string, max: number) {
  const raw = textField(formData, name, 12);
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0 || number > max) {
    throw new Error(`Enter a valid ${name}.`);
  }
  return number;
}

function checked(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function inPaise(formData: FormData, name: string, maxRupees: number) {
  const amount = optionalNumber(formData, name, maxRupees);
  if (Math.round(amount * 100) !== amount * 100) {
    throw new Error(`${name} must have no more than two decimal places.`);
  }
  return Math.round(amount * 100);
}

export async function signIn(formData: FormData) {
  const email = textField(formData, "email", 254);
  const password = formData.get("password");
  if (typeof password !== "string" || password.length > 128) {
    redirect("/admin/login?error=1");
  }

  const requestHeaders = await headers();
  const address =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  const authenticated = await authenticateStaff(
    email,
    password,
    getLoginAddressKey(address),
  );
  if (!authenticated) redirect("/admin/login?error=1");
  redirect("/admin");
}

export async function signOut() {
  await requireAdmin();
  await endAdminSession();
  redirect("/admin/login");
}

function parsePortions(raw: string) {
  const portions = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d{2,4})\s*:\s*(\d{1,5}(?:\.\d{1,2})?)$/.exec(line);
      if (!match) throw new Error("Portions must use one ml:price pair per line.");
      const sizeInMl = Number(match[1]);
      const priceInPaise = Math.round(Number(match[2]) * 100);
      if (sizeInMl < 50 || sizeInMl > 5000 || priceInPaise < 100 || priceInPaise > 10000000) {
        throw new Error("A portion size or price is outside the allowed range.");
      }
      return { sizeInMl, priceInPaise };
    });
  if (portions.length < 1 || portions.length > 10) {
    throw new Error("A product needs between 1 and 10 portion sizes.");
  }
  if (new Set(portions.map((portion) => portion.sizeInMl)).size !== portions.length) {
    throw new Error("Portion sizes must be unique.");
  }
  return portions;
}

function getSafeImageUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a valid image URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Product images must use an HTTPS URL.");
  }
  return parsed.toString();
}

export async function saveProduct(formData: FormData) {
  await requireAdmin();
  const idField = formData.get("id");
  if (idField !== null && typeof idField !== "string") {
    throw new Error("The id field is invalid.");
  }
  const id = idField?.trim() ?? "";
  if (id.length > 100) throw new Error("The id field is too long.");
  const name = textField(formData, "name", 100);
  const description = textField(formData, "description", 1200);
  const imageUrl = getSafeImageUrl(textField(formData, "imageUrl", 2048));
  const imageAlt = textField(formData, "imageAlt", 200);
  const portions = parsePortions(textField(formData, "portions", 1000));
  const availability = textField(formData, "availability", 20);
  if (name.length < 2 || description.length < 10 || imageAlt.length < 3) {
    throw new Error("Enter a product name, description, and image description.");
  }
  if (availability !== "available" && availability !== "sold-out") {
    throw new Error("Choose a valid availability.");
  }

  const products = await getMenuProducts({ includeInactive: true });
  const existing = id ? products.find((product) => product.id === id) : undefined;
  if (id && !existing) throw new Error("That product no longer exists.");
  const productId =
    existing?.id ??
    `${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54) || "soup"}-${randomUUID().slice(0, 8)}`;

  const product: MenuProduct = {
    id: productId,
    name,
    description,
    imageUrl,
    imageAlt,
    portions,
    ingredients: existing?.ingredients ?? [],
    availability,
    active: checked(formData, "active"),
    preparationTimeMinutes: existing?.preparationTimeMinutes ?? null,
    ...(existing?.customizations
      ? { customizations: existing.customizations }
      : {}),
    ...(existing?.addOns ? { addOns: existing.addOns } : {}),
  };
  saveMenuProduct(product);
  revalidatePath("/");
  revalidatePath("/admin");
  redirect("/admin?notice=product-saved");
}

export async function setProductAvailability(formData: FormData) {
  await requireAdmin();
  const id = textField(formData, "id", 100);
  const availability = textField(formData, "availability", 20);
  if (availability !== "available" && availability !== "sold-out") {
    throw new Error("Choose a valid availability.");
  }
  const products = await getMenuProducts({ includeInactive: true });
  const product = products.find((entry) => entry.id === id);
  if (!product) throw new Error("That product no longer exists.");
  saveMenuProduct({ ...product, availability });
  revalidatePath("/");
  revalidatePath("/admin");
  redirect("/admin?notice=availability-updated");
}

function parseHours(raw: string): BusinessHour[] {
  const entries: BusinessHour[] = [];
  for (const line of raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const closedMatch = /^([A-Za-z]+)\s*:\s*closed$/i.exec(line);
    const openMatch = /^([A-Za-z]+)\s*:\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/i.exec(line);
    const dayName = closedMatch?.[1] ?? openMatch?.[1];
    const day = weekdays.find(
      (weekday) => weekday.toLocaleLowerCase() === dayName?.toLocaleLowerCase(),
    );
    if (!day || (!closedMatch && !openMatch)) {
      throw new Error("Hours must use 'Monday: 09:00-17:00' or 'Monday: closed' format.");
    }
    if (entries.some((entry) => entry.day === day)) {
      throw new Error("Each weekday can only have one business-hours entry.");
    }
    if (closedMatch) {
      entries.push({ day, closed: true, opensAt: "", closesAt: "" });
      continue;
    }
    const opensAt = openMatch?.[2] ?? "";
    const closesAt = openMatch?.[3] ?? "";
    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(opensAt) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(closesAt) ||
      opensAt >= closesAt
    ) {
      throw new Error("Opening and closing times must be valid and same-day.");
    }
    entries.push({ day, closed: false, opensAt, closesAt });
  }
  return entries;
}

function parseDeliveryZones(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [name, postalCodesText, feeText, ...extra] = line.split("|").map((part) => part.trim());
      if (!name || !feeText || extra.length > 0) {
        throw new Error(`Delivery zone ${index + 1} must use locality|PIN codes|fee.`);
      }
      const postalCodes = postalCodesText
        ? postalCodesText.split(",").map((code) => code.trim())
        : [];
      if (
        postalCodes.some((code) => !/^\d{6}$/.test(code)) ||
        (name === "*" && postalCodes.length === 0)
      ) {
        throw new Error(`Delivery zone ${index + 1} has invalid PIN codes.`);
      }
      const fee = Number(feeText);
      if (!Number.isFinite(fee) || fee < 0 || fee > 10000 || Math.round(fee * 100) !== fee * 100) {
        throw new Error(`Delivery zone ${index + 1} has an invalid fee.`);
      }
      return {
        id: `zone-${index + 1}`,
        name,
        localities: name === "*" ? [] : [name],
        postalCodes,
        deliveryFeeInPaise: Math.round(fee * 100),
      };
    });
}

export async function saveBusinessSettings(formData: FormData) {
  await requireAdmin();
  const current = getBusinessConfiguration();
  const promotionCode = textField(formData, "promotionCode", 40).toUpperCase();
  const promotionEnabled = checked(formData, "promotionEnabled");
  const discountInPaise = inPaise(formData, "discountRupees", 100000);
  if (promotionEnabled && (!/^[A-Z0-9_-]{3,40}$/.test(promotionCode) || discountInPaise < 1)) {
    throw new Error("An active promotion needs a valid code and a discount greater than zero.");
  }
  const taxRate = optionalNumber(formData, "taxRatePercent", 100);
  const configuration = {
    ...current,
    kitchenOpen: checked(formData, "kitchenOpen"),
    temporarilyClosed: checked(formData, "temporarilyClosed"),
    closureNote: textField(formData, "closureNote", 300),
    hours: parseHours(textField(formData, "hours", 2000)),
    fulfillment: {
      ...current.fulfillment,
      deliveryEnabled: checked(formData, "deliveryEnabled"),
      pickupEnabled: checked(formData, "pickupEnabled"),
      deliveryZones: parseDeliveryZones(textField(formData, "deliveryZones", 4000)),
      pickupFeeInPaise: inPaise(formData, "pickupFeeRupees", 10000),
    },
    taxes: {
      ratePercent: taxRate,
      applyToDeliveryFee: checked(formData, "taxDeliveryFee"),
    },
    discountInPaise,
    promotion: { enabled: promotionEnabled, code: promotionCode },
  };
  saveBusinessConfiguration(configuration);
  revalidatePath("/");
  revalidatePath("/checkout");
  revalidatePath("/admin");
  redirect("/admin?notice=settings-saved");
}

const orderStatuses: OrderStatus[] = [
  "new",
  "confirmed",
  "preparing",
  "ready",
  "dispatched",
  "delivered",
  "cancelled",
];

export async function changeOrderStatus(formData: FormData) {
  await requireAdmin();
  const orderId = textField(formData, "orderId", 100);
  const nextStatus = textField(formData, "status", 20);
  if (!orderStatuses.includes(nextStatus as OrderStatus)) {
    throw new Error("Choose a valid order status.");
  }
  updateOrderStatus(orderId, nextStatus as OrderStatus);
  revalidatePath("/admin");
  redirect("/admin?notice=order-updated");
}
