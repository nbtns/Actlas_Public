import { createHmac, timingSafeEqual } from "crypto";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

type StripeFormValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | StripeFormValue[]
  | { [key: string]: StripeFormValue };

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  status?: string | null;
  payment_status?: string | null;
};

type StripeRefund = {
  id?: string;
  status?: string | null;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  account?: string;
  data: {
    object: unknown;
  };
};

export type StripeCheckoutSessionObject = {
  id?: string;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  payment_intent?: string | { id?: string } | null;
  payment_status?: string | null;
  status?: string | null;
};

type CreateCheckoutSessionInput = {
  reservationId: string;
  studentId: string;
  studentEmail?: string | null;
  connectedAccountId?: string | null;
  lessonMenuId: string;
  menuName: string;
  amountUsd: number;
  durationMinutes: number;
  successUrl: string;
  cancelUrl: string;
};

type StripeApiRequestInput = {
  method?: "GET" | "POST";
  path: string;
  connectedAccountId?: string | null;
  body?: URLSearchParams;
  idempotencyKey?: string;
};

function getStripeSecretKey() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  return secretKey;
}

function getStripeConnectedAccountId(overrideConnectedAccountId?: string | null) {
  const connectedAccountId = overrideConnectedAccountId || process.env.STRIPE_CONNECTED_ACCOUNT_ID;
  if (!connectedAccountId) {
    throw new Error("STRIPE_CONNECTED_ACCOUNT_ID is not set.");
  }
  return connectedAccountId;
}

export function getStripeOAuthClientId() {
  const clientId = process.env.STRIPE_CLIENT_ID;
  if (!clientId) {
    throw new Error("STRIPE_CLIENT_ID is not set.");
  }
  return clientId;
}

function appendFormValue(params: URLSearchParams, key: string, value: StripeFormValue) {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => appendFormValue(params, `${key}[${index}]`, item));
    return;
  }

  if (typeof value === "object") {
    Object.entries(value).forEach(([childKey, childValue]) => {
      appendFormValue(params, `${key}[${childKey}]`, childValue);
    });
    return;
  }

  params.append(key, String(value));
}

function toStripeFormBody(values: Record<string, StripeFormValue>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => appendFormValue(params, key, value));
  return params;
}

function getStripeErrorMessage(parsed: unknown, fallback: string) {
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "error" in parsed &&
    typeof parsed.error === "object" &&
    parsed.error !== null &&
    "message" in parsed.error &&
    typeof parsed.error.message === "string"
  ) {
    return parsed.error.message;
  }
  return fallback;
}

async function requestStripeApi(input: StripeApiRequestInput) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getStripeSecretKey()}`,
  };
  if (input.body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (input.connectedAccountId) headers["Stripe-Account"] = input.connectedAccountId;
  if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;

  const response = await fetch(`${STRIPE_API_BASE}${input.path}`, {
    method: input.method || "GET",
    headers,
    ...(input.body ? { body: input.body } : {}),
  });

  const responseText = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(getStripeErrorMessage(parsed, responseText));
  }

  return parsed;
}

function getApplicationFeeAmount(unitAmountCents: number) {
  const rawRate = process.env.STRIPE_APPLICATION_FEE_PERCENT || process.env.SYSTEM_FEE_RATE;
  const feeRate = rawRate ? Number(rawRate) : 15;
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 100) {
    throw new Error("Stripe application fee percent must be at least 0 and less than 100.");
  }
  if (feeRate === 0) return null;

  const feeAmount = Math.round(unitAmountCents * (feeRate / 100));
  if (feeAmount <= 0) return null;
  if (feeAmount >= unitAmountCents) {
    throw new Error("Stripe application fee amount must be less than the checkout amount.");
  }
  return feeAmount;
}

export async function createStripeCheckoutSession(input: CreateCheckoutSessionInput) {
  const unitAmountCents = input.amountUsd * 100;
  if (!Number.isInteger(unitAmountCents) || unitAmountCents <= 0) {
    throw new Error("Invalid Stripe checkout amount.");
  }

  const connectedAccountId = getStripeConnectedAccountId(input.connectedAccountId);
  const applicationFeeAmount = getApplicationFeeAmount(unitAmountCents);

  const body = toStripeFormBody({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.reservationId,
    customer_email: input.studentEmail || undefined,
    "metadata": {
      reservationId: input.reservationId,
      studentId: input.studentId,
      lessonMenuId: input.lessonMenuId,
    },
    "line_items": [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: unitAmountCents,
          product_data: {
            name: input.menuName,
            description: `${input.durationMinutes} min online lesson`,
          },
        },
      },
    ],
    "payment_intent_data": {
      application_fee_amount: applicationFeeAmount || undefined,
      metadata: {
        reservationId: input.reservationId,
        studentId: input.studentId,
        lessonMenuId: input.lessonMenuId,
      },
    },
  });

  const parsed = await requestStripeApi({
    method: "POST",
    path: "/checkout/sessions",
    connectedAccountId,
    body,
  });

  const session = parsed as StripeCheckoutSession;
  if (!session.id || !session.url) {
    throw new Error("Stripe checkout session response did not include a redirect URL.");
  }

  return session;
}

export async function retrieveStripeCheckoutSession(
  sessionId: string,
  connectedAccountId?: string | null
) {
  const parsed = await requestStripeApi({
    path: `/checkout/sessions/${encodeURIComponent(sessionId)}`,
    connectedAccountId: getStripeConnectedAccountId(connectedAccountId),
  });
  return parsed as StripeCheckoutSession;
}

export async function expireStripeCheckoutSession(
  sessionId: string,
  connectedAccountId?: string | null
) {
  const accountId = getStripeConnectedAccountId(connectedAccountId);
  try {
    const parsed = await requestStripeApi({
      method: "POST",
      path: `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
      connectedAccountId: accountId,
    });
    return { session: parsed as StripeCheckoutSession, paid: false };
  } catch (error) {
    const session = await retrieveStripeCheckoutSession(sessionId, accountId);
    if (session.payment_status === "paid" || session.status === "complete") {
      return { session, paid: true };
    }
    if (session.status === "expired") {
      return { session, paid: false };
    }
    throw error;
  }
}

export async function refundStripePayment(input: {
  paymentIntentId: string;
  connectedAccountId?: string | null;
  reservationId: string;
}) {
  const connectedAccountId = getStripeConnectedAccountId(input.connectedAccountId);
  const body = toStripeFormBody({
    payment_intent: input.paymentIntentId,
    refund_application_fee: true,
    reason: "requested_by_customer",
    metadata: {
      reservationId: input.reservationId,
    },
  });

  const parsed = await requestStripeApi({
    method: "POST",
    path: "/refunds",
    connectedAccountId,
    body,
    idempotencyKey: `reservation-refund-${input.reservationId}`,
  });
  return parsed as StripeRefund;
}

export type StripeOAuthTokenResponse = {
  stripe_user_id?: string;
  livemode?: boolean;
  scope?: string;
};

export async function exchangeStripeOAuthCode(code: string) {
  const body = toStripeFormBody({
    grant_type: "authorization_code",
    code,
    client_secret: getStripeSecretKey(),
  });

  const response = await fetch("https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const responseText = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const errorMessage =
      typeof parsed === "object" &&
      parsed !== null &&
      "error_description" in parsed &&
      typeof parsed.error_description === "string"
        ? parsed.error_description
        : responseText;
    throw new Error(`Stripe OAuth connection failed: ${errorMessage}`);
  }

  const tokenResponse = parsed as StripeOAuthTokenResponse;
  if (!tokenResponse.stripe_user_id) {
    throw new Error("Stripe OAuth response did not include a connected account ID.");
  }

  return tokenResponse;
}

function parseStripeSignatureHeader(signatureHeader: string) {
  const parsed = new Map<string, string[]>();
  signatureHeader.split(",").forEach((part) => {
    const [key, value] = part.split("=", 2);
    if (!key || !value) return;
    const values = parsed.get(key) || [];
    values.push(value);
    parsed.set(key, values);
  });
  return parsed;
}

function timingSafeHexEqual(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function constructStripeWebhookEvent(payload: string, signatureHeader: string | null) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
  }
  if (!signatureHeader) {
    throw new Error("Missing Stripe signature header.");
  }

  const parsedSignature = parseStripeSignatureHeader(signatureHeader);
  const timestampText = parsedSignature.get("t")?.[0];
  const signatures = parsedSignature.get("v1") || [];
  const timestamp = timestampText ? Number(timestampText) : NaN;
  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new Error("Invalid Stripe signature header.");
  }

  const toleranceSeconds = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS || 300);
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    throw new Error("Stripe webhook signature timestamp is outside the tolerance window.");
  }

  const expectedSignature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
  const isValid = signatures.some((signature) => timingSafeHexEqual(expectedSignature, signature));
  if (!isValid) {
    throw new Error("Invalid Stripe webhook signature.");
  }

  return JSON.parse(payload) as StripeWebhookEvent;
}

export function getStripePaymentIntentId(session: StripeCheckoutSessionObject) {
  if (typeof session.payment_intent === "string") return session.payment_intent;
  if (session.payment_intent && typeof session.payment_intent.id === "string") {
    return session.payment_intent.id;
  }
  return null;
}
