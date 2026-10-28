"use client";

import { useEffect, useState } from "react";
import type { PaymentStatus } from "@/lib/orders";

type Props = {
  orderId: string;
  trackingToken: string;
  initialStatus: PaymentStatus;
  gatewayOrderId: string | null;
  razorpayKeyId: string | null;
  totalInPaise: number;
  customerName: string;
  customerMobile: string;
};

type CheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type CheckoutOptions = {
  key: string;
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; contact: string };
  handler: (response: CheckoutResponse) => void;
  modal: { ondismiss: () => void };
};

type RazorpayInstance = {
  open: () => void;
  on: (event: "payment.failed", handler: (response: {
    error?: { metadata?: { payment_id?: string } };
  }) => void) => void;
};

type RazorpayConstructor = new (options: CheckoutOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let razorpayScript: Promise<RazorpayConstructor> | null = null;

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (!razorpayScript) {
    razorpayScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => {
        if (window.Razorpay) resolve(window.Razorpay);
        else reject(new Error("Razorpay Checkout did not load."));
      };
      script.onerror = () => {
        razorpayScript = null;
        reject(new Error("Razorpay Checkout could not be loaded."));
      };
      document.head.appendChild(script);
    });
  }
  return razorpayScript;
}

function statusMessage(status: PaymentStatus) {
  switch (status) {
    case "paid":
      return "Payment successful and verified by the server. This is a sandbox test only; no real order is sent to the kitchen.";
    case "failed":
      return "The payment attempt failed. No successful payment was confirmed. Retry safely using this same order.";
    case "cancelled":
      return "Checkout was cancelled. You can retry payment for this same order.";
    case "refund_pending":
      return "A refund is being processed. This sandbox order is not sent to the kitchen.";
    case "partially_refunded":
      return "A partial refund has been confirmed. This sandbox order is not sent to the kitchen.";
    case "refunded":
      return "The payment has been refunded. This sandbox order is not sent to the kitchen.";
    default:
      return "Payment is pending and this order is not yet confirmed. Keep this page open while the server checks the payment.";
  }
}

export default function PaymentStatusPanel({
  orderId,
  trackingToken,
  initialStatus,
  gatewayOrderId: initialGatewayOrderId,
  razorpayKeyId,
  totalInPaise,
  customerName,
  customerMobile,
}: Props) {
  const [paymentStatus, setPaymentStatus] = useState(initialStatus);
  const [gatewayOrderId, setGatewayOrderId] = useState(initialGatewayOrderId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/payments/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, trackingToken }),
          cache: "no-store",
        });
        if (!response.ok) return;
        const result = (await response.json()) as {
          paymentStatus: PaymentStatus;
          gatewayOrderId: string | null;
        };
        setPaymentStatus(result.paymentStatus);
        setGatewayOrderId(result.gatewayOrderId);
      } catch (statusError) {
        console.error("Unable to refresh payment status.", statusError);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [orderId, trackingToken]);

  async function refreshStatus() {
    const response = await fetch("/api/payments/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, trackingToken }),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("The latest payment status could not be loaded.");
    }
    const result = (await response.json()) as {
      paymentStatus: PaymentStatus;
      gatewayOrderId: string | null;
    };
    setPaymentStatus(result.paymentStatus);
    setGatewayOrderId(result.gatewayOrderId);
  }

  async function verifyPayment(response: CheckoutResponse) {
    const result = await fetch("/api/payments/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        trackingToken,
        gatewayOrderId: response.razorpay_order_id,
        gatewayPaymentId: response.razorpay_payment_id,
        signature: response.razorpay_signature,
      }),
    });
    if (!result.ok) {
      const details = (await result.json()) as { errors?: string[] };
      throw new Error(details.errors?.[0] ?? "Payment could not be verified yet.");
    }
    const verified = (await result.json()) as { status: PaymentStatus };
    setPaymentStatus(verified.status);
  }

  async function markCheckoutCancelled(orderToCancel: string) {
    await fetch("/api/payments/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        trackingToken,
        gatewayOrderId: orderToCancel,
      }),
    });
    await refreshStatus();
  }

  async function openCheckout(orderToPay: string, keyId: string) {
    const Razorpay = await loadRazorpayCheckout();
    const checkout = new Razorpay({
      key: keyId,
      amount: totalInPaise,
      currency: "INR",
      name: "BB Cloud Kitchen",
      description: `Test order ${orderId}`,
      order_id: orderToPay,
      prefill: { name: customerName, contact: customerMobile },
      handler: (response) => {
        void verifyPayment(response)
          .then(() => refreshStatus())
          .catch((verificationError: unknown) => {
            console.error("Unable to verify the Razorpay checkout response.", verificationError);
            setError(
              verificationError instanceof Error
                ? verificationError.message
                : "Payment status could not be verified. Keep this page open and retry.",
            );
          });
      },
      modal: {
        ondismiss: () => {
          void markCheckoutCancelled(orderToPay).catch((cancelError: unknown) => {
            console.error("Unable to refresh after Razorpay checkout was dismissed.", cancelError);
            setError("Checkout was closed. Refresh this page to check its payment status.");
          });
        },
      },
    });
    checkout.on("payment.failed", (response) => {
      const paymentId = response.error?.metadata?.payment_id;
      if (paymentId) {
        void verifyPayment({
          razorpay_order_id: orderToPay,
          razorpay_payment_id: paymentId,
          razorpay_signature: "",
        })
          .then(() => refreshStatus())
          .catch((verificationError: unknown) => {
            console.error("Unable to verify the failed Razorpay payment.", verificationError);
            setError("The payment result is being checked. Please wait or refresh this page.");
          });
      }
    });
    checkout.open();
  }

  async function retryPayment() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/payments/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, trackingToken }),
      });
      const result = (await response.json()) as {
        gatewayOrderId?: string;
        razorpayKeyId?: string;
        errors?: string[];
      };
      if (!response.ok || !result.gatewayOrderId || !result.razorpayKeyId) {
        throw new Error(result.errors?.[0] ?? "Payment retry could not be prepared.");
      }
      setGatewayOrderId(result.gatewayOrderId);
      await openCheckout(result.gatewayOrderId, result.razorpayKeyId);
    } catch (retryError) {
      console.error("Unable to start Razorpay checkout.", retryError);
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Payment retry could not be started. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const paymentComplete =
    paymentStatus === "paid" ||
    paymentStatus === "refund_pending" ||
    paymentStatus === "partially_refunded" ||
    paymentStatus === "refunded";

  return (
    <>
      <p className="confirmation-message" role="status">
        <strong>Payment {paymentStatus.replace("_", " ")}</strong>
        <br />
        {statusMessage(paymentStatus)}
      </p>
      {paymentStatus !== "paid" && paymentStatus !== "refunded" && (
        <p className="payment-test-warning">
          Razorpay sandbox only · Test credentials only · No real money is charged.
        </p>
      )}
      {error && <p className="checkout-alert" role="alert">{error}</p>}
      {!paymentComplete && razorpayKeyId && (
        <button
          className="button button-copper payment-retry-button"
          type="button"
          disabled={busy}
          onClick={() => void retryPayment()}
        >
          {busy
            ? "Preparing secure checkout…"
            : paymentStatus === "pending"
              ? "Continue to secure test payment"
              : "Retry payment for this order"}
        </button>
      )}
      {!razorpayKeyId && !paymentComplete && (
        <p className="checkout-alert" role="alert">
          Sandbox payment configuration is unavailable. No payment has been confirmed.
        </p>
      )}
      {gatewayOrderId && (
        <p className="payment-reference">Payment reference: {gatewayOrderId}</p>
      )}
    </>
  );
}
