import "server-only";

import { getDatabase } from "@/lib/database";

export type FulfillmentMethod = "delivery" | "pickup";
export type BusinessDay =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export type BusinessHour = {
  day: BusinessDay;
  closed: boolean;
  opensAt: string;
  closesAt: string;
};

export type DeliveryZone = {
  id: string;
  name: string;
  localities: string[];
  postalCodes: string[];
  deliveryFeeInPaise: number;
};

export type BusinessConfiguration = {
  mode: "development-test" | "unconfigured";
  kitchenOpen: boolean;
  temporarilyClosed: boolean;
  closureNote: string;
  hours: BusinessHour[];
  fulfillment: {
    deliveryEnabled: boolean;
    pickupEnabled: boolean;
    deliveryZones: DeliveryZone[];
    pickupFeeInPaise: number;
  };
  taxes: {
    ratePercent: number;
    applyToDeliveryFee: boolean;
  };
  discountInPaise: number;
  promotion: {
    enabled: boolean;
    code: string;
  };
};

const developmentTestConfiguration: BusinessConfiguration = {
  mode: "development-test",
  kitchenOpen: true,
  temporarilyClosed: false,
  closureNote: "",
  hours: [],
  fulfillment: {
    deliveryEnabled: false,
    pickupEnabled: true,
    deliveryZones: [],
    pickupFeeInPaise: 0,
  },
  taxes: {
    ratePercent: 0,
    applyToDeliveryFee: false,
  },
  discountInPaise: 0,
  promotion: { enabled: false, code: "" },
};

const unconfiguredBusiness: BusinessConfiguration = {
  mode: "unconfigured",
  kitchenOpen: false,
  temporarilyClosed: false,
  closureNote: "",
  hours: [],
  fulfillment: {
    deliveryEnabled: false,
    pickupEnabled: false,
    deliveryZones: [],
    pickupFeeInPaise: 0,
  },
  taxes: {
    ratePercent: 0,
    applyToDeliveryFee: false,
  },
  discountInPaise: 0,
  promotion: { enabled: false, code: "" },
};

export function getBusinessConfiguration(): BusinessConfiguration {
  const row = getDatabase()
    .prepare("SELECT data FROM business_configuration WHERE id = 1")
    .get() as { data: string } | undefined;
  if (row) return JSON.parse(row.data) as BusinessConfiguration;
  return process.env.NODE_ENV === "development"
    ? developmentTestConfiguration
    : unconfiguredBusiness;
}

export function saveBusinessConfiguration(configuration: BusinessConfiguration) {
  getDatabase()
    .prepare(
      `INSERT INTO business_configuration (id, data, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(configuration), new Date().toISOString());
}

export function isKitchenAcceptingOrders(
  configuration: BusinessConfiguration,
  now = new Date(),
) {
  if (
    configuration.mode !== "development-test" ||
    !configuration.kitchenOpen ||
    configuration.temporarilyClosed
  ) {
    return false;
  }
  if (configuration.hours.length === 0) return true;

  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "Asia/Kolkata",
  }).format(now) as BusinessDay;
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Kolkata",
  }).format(now);
  const today = configuration.hours.find((entry) => entry.day === weekday);
  return Boolean(
    today &&
      !today.closed &&
      today.opensAt <= time &&
      time < today.closesAt,
  );
}
