import crypto from "node:crypto";

type PayFastFields = Record<string, string | number | undefined>;

function encodeFields(fields: PayFastFields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value).trim()).replace(/%20/g, "+")}`)
    .join("&");
}

function sign(fields: PayFastFields) {
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  const payload = `${encodeFields(fields)}${passphrase ? `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}` : ""}`;
  return crypto.createHash("md5").update(payload).digest("hex");
}

function getPublicAppUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  if (!configuredUrl) throw new Error("NEXT_PUBLIC_APP_URL must be configured with the public HTTPS deployment URL.");
  const appUrl = configuredUrl.startsWith("http") ? configuredUrl : `https://${configuredUrl}`;
  const parsed = new URL(appUrl);
  if (parsed.protocol !== "https:" || parsed.hostname === "localhost") {
    throw new Error("PayFast callbacks require a public HTTPS NEXT_PUBLIC_APP_URL, not localhost.");
  }
  return appUrl.replace(/\/$/, "");
}

function isSandboxMode() {
  return process.env.PAYFAST_MODE?.toLowerCase() === "sandbox";
}

export function createPayFastPaymentUrl(transactionId: string, amountCents: number, itemName: string) {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  if (!merchantId || !merchantKey) throw new Error("PayFast merchant credentials are not configured.");
  const appUrl = getPublicAppUrl();
  const fields: PayFastFields = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: `${appUrl}/payment/complete`,
    cancel_url: `${appUrl}/payment/cancelled`,
    notify_url: `${appUrl}/api/webhooks/payfast`,
    m_payment_id: transactionId,
    amount: (amountCents / 100).toFixed(2),
    item_name: itemName,
  };
  const host = isSandboxMode() ? "sandbox.payfast.co.za" : "www.payfast.co.za";
  return `https://${host}/eng/process?${encodeFields({ ...fields, signature: sign(fields) })}`;
}

export function verifyPayFastSignature(fields: Record<string, string>) {
  const { signature, ...unsigned } = fields;
  return Boolean(signature) && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(unsigned)));
}

export async function validatePayFastNotification(rawBody: string) {
  const host = isSandboxMode() ? "sandbox.payfast.co.za" : "www.payfast.co.za";
  const response = await fetch(`https://${host}/eng/query/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: rawBody,
  });
  return response.ok && (await response.text()).trim() === "VALID";
}