"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireMerchant } from "@/lib/merchant-auth";

function hashPin(pin: string, salt = crypto.randomBytes(16).toString("hex")) { return `${salt}:${crypto.scryptSync(pin, salt, 64).toString("hex")}`; }
function pinMatches(pin: string, stored: string) { const [salt, hash] = stored.split(":"); return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hashPin(pin, salt).split(":")[1])); }

export async function saveMerchantSecurity(formData: FormData) {
  const { client, merchant } = await requireMerchant();
  const pin = String(formData.get("pin") ?? "");
  const payoutDetails = { bank_name: String(formData.get("bankName") ?? "").trim(), account_holder: String(formData.get("accountHolder") ?? "").trim(), account_number: String(formData.get("accountNumber") ?? "").trim() };
  if (!/^\d{6}$/.test(pin) || !Object.values(payoutDetails).every(Boolean)) return;
  await client.from("merchants").update({ payout_pin_hash: hashPin(pin), payout_details: payoutDetails, payout_details_updated_at: new Date().toISOString(), payout_pin_failed_attempts: 0, payout_pin_locked_until: null }).eq("id", merchant.id);
  revalidatePath("/merchant");
}

export async function requestPayout(formData: FormData) {
  const { client, merchant } = await requireMerchant();
  const pin = String(formData.get("pin") ?? "");
  const amountCents = Math.round(Number(formData.get("amount")) * 100);
  if (!merchant.payout_pin_hash || !Number.isFinite(amountCents) || amountCents <= 0) return;
  if (merchant.payout_pin_locked_until && new Date(merchant.payout_pin_locked_until) > new Date()) return;
  if (!pinMatches(pin, merchant.payout_pin_hash)) {
    const attempts = Number(merchant.payout_pin_failed_attempts) + 1;
    await client.from("merchants").update({ payout_pin_failed_attempts: attempts, payout_pin_locked_until: attempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null }).eq("id", merchant.id);
    return;
  }
  const [{ data: releases }, { data: payouts }] = await Promise.all([client.from("merchant_ledger_entries").select("amount_cents").eq("merchant_id", merchant.id).eq("entry_type", "release"), client.from("payout_requests").select("amount_cents").eq("merchant_id", merchant.id).in("status", ["pending_review", "processing", "paid"])]);
  const available = (releases ?? []).reduce((sum, entry) => sum + entry.amount_cents, 0) - (payouts ?? []).reduce((sum, payout) => sum + payout.amount_cents, 0);
  if (amountCents > available) return;
  await client.from("payout_requests").insert({ merchant_id: merchant.id, amount_cents: amountCents, payout_snapshot: merchant.payout_details });
  await client.from("merchant_ledger_entries").insert({ merchant_id: merchant.id, entry_type: "payout_request", amount_cents: -amountCents });
  await client.from("merchants").update({ payout_pin_failed_attempts: 0 }).eq("id", merchant.id);
  revalidatePath("/merchant");
}