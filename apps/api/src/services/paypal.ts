/**
 * PayPal: Orders (one-time packs), Subscriptions (plans), Vault (saved cards), webhook verification.
 * Card entry happens in the browser via Advanced Card Fields; the server only sees order ids and vault tokens.
 */
import { env } from "../lib/env.js";
const BASE = env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
let tok: { v: string; exp: number } | null = null;
async function token() {
  if (tok && tok.exp > Date.now()) return tok.v;
  const r = await fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const j = (await r.json()) as { access_token: string; expires_in: number }; tok = { v: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 }; return tok.v;
}
async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${await token()}`, "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`PayPal ${method} ${path} ${r.status}: ${await r.text()}`);
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
}
/** Create an order for a credit pack; the client confirms it with card fields / Google Pay / PayPal button. */
export const createOrder = (amountUsd: number, description: string, customId: string, vault: boolean) => call<{ id: string }>("POST", "/v2/checkout/orders", {
  intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: amountUsd.toFixed(2) }, description, custom_id: customId }],
  payment_source: vault ? { card: { attributes: { vault: { store_in_vault: "ON_SUCCESS" } } } } : undefined,
}, { "PayPal-Request-Id": customId });
export const captureOrder = (orderId: string) => call<{ id: string; status: string; payment_source?: { card?: { brand?: string; last_digits?: string; expiry?: string; attributes?: { vault?: { id: string } } } }; purchase_units: { payments: { captures: { id: string; amount: { value: string } }[] } }[] }>("POST", `/v2/checkout/orders/${orderId}/capture`, undefined, { "PayPal-Request-Id": `cap-${orderId}` });
/** Charge a vaulted card without the user present (renewals, one-tap top-ups). */
export const chargeVault = (vaultId: string, amountUsd: number, description: string, customId: string) => call<{ id: string; status: string }>("POST", "/v2/checkout/orders", {
  intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: amountUsd.toFixed(2) }, description, custom_id: customId }], payment_source: { card: { vault_id: vaultId } },
}, { "PayPal-Request-Id": customId });
export const createSubscription = (planId: string, customId: string) => call<{ id: string; status: string }>("POST", "/v1/billing/subscriptions", { plan_id: planId, custom_id: customId, application_context: { user_action: "SUBSCRIBE_NOW" } });
export const cancelSubscription = (id: string, reason: string) => call<void>("POST", `/v1/billing/subscriptions/${id}/cancel`, { reason });
export const suspendSubscription = (id: string) => call<void>("POST", `/v1/billing/subscriptions/${id}/suspend`, { reason: "Paused by user" });
export const activateSubscription = (id: string) => call<void>("POST", `/v1/billing/subscriptions/${id}/activate`, { reason: "Resumed by user" });
export const revisePlan = (id: string, planId: string) => call<{ id: string }>("POST", `/v1/billing/subscriptions/${id}/revise`, { plan_id: planId });
export const refund = (captureId: string, amountUsd?: number) => call<{ id: string }>("POST", `/v2/payments/captures/${captureId}/refund`, amountUsd ? { amount: { currency_code: "USD", value: amountUsd.toFixed(2) } } : {});
export const deleteVault = (vaultId: string) => call<void>("DELETE", `/v3/vault/payment-tokens/${vaultId}`);
export async function verifyWebhook(headers: Record<string, string | string[] | undefined>, body: unknown) {
  const h = (k: string) => String(headers[k] ?? "");
  const r = await call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"), transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"), webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: body,
  });
  return r.verification_status === "SUCCESS";
}
