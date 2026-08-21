"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { verifyZernioAccount } from "@/lib/zernio";

export async function resolveDispute(formData: FormData) {
  const { client, email } = await requireAdmin();
  const disputeId = String(formData.get("disputeId") ?? "");
  const transactionId = String(formData.get("transactionId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const adminNotes = String(formData.get("adminNotes") ?? "").trim();
  if (!disputeId || !transactionId || !["release", "refund"].includes(outcome)) return;
  const released = outcome === "release";
  await client.from("disputes").update({ status: released ? "resolved_release" : "resolved_refund", admin_notes: adminNotes || null, resolved_by: email, resolved_at: new Date().toISOString() }).eq("id", disputeId);
  await client.from("transactions").update({ status: released ? "released" : "refunded", released_at: released ? new Date().toISOString() : null }).eq("id", transactionId);
  revalidatePath("/admin/disputes");
  revalidatePath(`/admin/transactions/${transactionId}`);
}

export async function saveZernioConnection(formData: FormData) {
  const { client } = await requireAdmin();
  const accountId = String(formData.get("accountId") ?? "").trim();
  const status = accountId ? await verifyZernioAccount(accountId) : "Not Found";
  await client.from("app_settings").upsert({ key: "zernio_connection", value: { account_id: accountId, status, last_checked_at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  revalidatePath("/admin/settings");
  revalidatePath("/admin");
}