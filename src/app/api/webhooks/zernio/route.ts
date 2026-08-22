import { NextRequest, NextResponse } from "next/server";
import { askGemini, extractListingsFromDocument, ImportedListing, matchEvidence } from "@/lib/evidence-match";
import { botResponses } from "@/lib/bot-responses";
import { createServiceClient } from "@/lib/supabase";
import { getZernioWhatsAppNumber, isZernioMediaUrl, parseZernioMessage, sendZernioMessage } from "@/lib/zernio";

type Draft = { stage: string; listingId?: string; title?: string; priceCents?: number; description?: string; importedItems?: ImportedListing[] };
const listingCode = /^L-[A-Z0-9]{4}$/i;

function shortCode(prefix: "M" | "L" | "T") {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

async function saveState(phone: string, state: Draft, merchantId?: string, transactionId?: string) {
  await createServiceClient().from("messages").insert({
    whatsapp_number: phone, direction: "outbound", merchant_id: merchantId ?? null, transaction_id: transactionId ?? null,
    message_type: "system", raw_payload: { kind: "conversation_state", ...state },
  });
}

async function getState(phone: string): Promise<Draft> {
  const { data } = await createServiceClient().from("messages").select("raw_payload")
    .eq("whatsapp_number", phone).eq("message_type", "system").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const value = data?.raw_payload as Record<string, unknown> | null;
  return value?.kind === "conversation_state" ? value as Draft : { stage: "idle" };
}

async function copyMediaToStorage(url: string, path: string) {
  const zernioApiKey = process.env.ZERNIO_API_KEY;
  const response = await fetch(url, {
    headers: isZernioMediaUrl(url) && zernioApiKey ? { Authorization: `Bearer ${zernioApiKey}` } : undefined,
  });
  if (!response.ok) throw new Error("Unable to download image from Zernio.");
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  const bytes = new Uint8Array(await response.arrayBuffer());
  const supabase = createServiceClient();
  const { error } = await supabase.storage.from("abbypay-media").upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
  return supabase.storage.from("abbypay-media").getPublicUrl(path).data.publicUrl;
}

async function respond(inbound: { from: string; conversationId: string; accountId: string }, body: string, merchantId?: string, transactionId?: string, attachmentUrl?: string) {
  await sendZernioMessage(inbound.from, body, { conversationId: inbound.conversationId, accountId: inbound.accountId, merchantId, transactionId, attachmentUrl });
}

async function notifyMerchantOfRelease(merchantId: string, transactionId: string) {
  const supabase = createServiceClient();
  const { data: merchant } = await supabase.from("merchants").select("whatsapp_number").eq("id", merchantId).maybeSingle();
  if (!merchant) return;
  const { data: message } = await supabase.from("messages").select("raw_payload")
    .eq("whatsapp_number", merchant.whatsapp_number).eq("direction", "inbound")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const payload = message?.raw_payload as { conversation?: { id?: string }; account?: { id?: string; accountId?: string }; message?: { conversationId?: string; accountId?: string } } | null;
  const conversationId = payload?.conversation?.id ?? payload?.message?.conversationId;
  const accountId = payload?.account?.id ?? payload?.account?.accountId ?? payload?.message?.accountId;
  if (!conversationId || !accountId) return;
  await sendZernioMessage(merchant.whatsapp_number, botResponses.merchantFundsReleased, { conversationId, accountId, merchantId, transactionId });
}

async function releaseFunds(inbound: { from: string; conversationId: string; accountId: string }, transaction: { id: string; merchant_id: string; amount_cents: number }) {
  const supabase = createServiceClient();
  await supabase.from("transactions").update({ status: "released", released_at: new Date().toISOString() }).eq("id", transaction.id);
  const { data: existingCredit } = await supabase.from("merchant_ledger_entries").select("id").eq("transaction_id", transaction.id).eq("entry_type", "release").maybeSingle();
  if (!existingCredit) await supabase.from("merchant_ledger_entries").insert({ merchant_id: transaction.merchant_id, transaction_id: transaction.id, entry_type: "release", amount_cents: transaction.amount_cents });
  await respond(inbound, botResponses.fundsReleased, transaction.merchant_id, transaction.id);
  await notifyMerchantOfRelease(transaction.merchant_id, transaction.id).catch((error) => console.error("Merchant release notification failed", { transactionId: transaction.id, error }));
}

export async function GET(request: NextRequest) {
  void request;
  return NextResponse.json({ received: true });
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const inbound = parseZernioMessage(payload);
    if (!inbound) return NextResponse.json({ received: true });
    const supabase = createServiceClient();
    const eventId = typeof payload.id === "string" ? payload.id : null;
    if (eventId) {
      const { data: previousEvent } = await supabase.from("messages").select("id").eq("direction", "inbound").contains("raw_payload", { id: eventId }).maybeSingle();
      if (previousEvent) return NextResponse.json({ received: true, duplicate: true });
    }
    const { error: inboundInsertError } = await supabase.from("messages").insert({ whatsapp_number: inbound.from, direction: "inbound", message_type: inbound.messageType, body: inbound.text || null, media_url: inbound.mediaUrl ?? null, raw_payload: inbound.raw });
    if (inboundInsertError?.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    if (inboundInsertError) throw inboundInsertError;

    const normalizedText = inbound.text.toUpperCase();
    const state = await getState(inbound.from);
    const { data: merchant } = await supabase.from("merchants").select("*").eq("whatsapp_number", inbound.from).maybeSingle();
    const { data: buyerTransaction } = await supabase.from("transactions").select("*, listings(*), merchants(*)")
      .eq("buyer_whatsapp_number", inbound.from).in("status", ["awaiting_buyer_confirmation", "pending_payment"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: merchantTransaction } = merchant ? await supabase.from("transactions").select("*").eq("merchant_id", merchant.id)
      .eq("status", "awaiting_fulfilment").order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };

    // Commands always start a fresh intent, even if a prior draft was interrupted.
    if (normalizedText === "SELL") {
      if (merchant) {
        await saveState(inbound.from, { stage: "seller_title" }, merchant.id);
        await respond(inbound, botResponses.sellerTitle, merchant.id);
      } else {
        await saveState(inbound.from, { stage: "seller_business" });
        await respond(inbound, botResponses.sellerBusiness);
      }
      return NextResponse.json({ received: true });
    }

    if (normalizedText === "MENU") {
      await respond(inbound, merchant ? botResponses.sellerMenu : botResponses.buyerMenu, merchant?.id);
      return NextResponse.json({ received: true });
    }

    if (merchant && normalizedText === "PAYOUT") {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (!merchant.portal_email || !appUrl) await respond(inbound, botResponses.portalEmailNeeded, merchant.id);
      else await respond(inbound, botResponses.portalLinked(`${appUrl.replace(/\/$/, "")}/merchant`), merchant.id);
      return NextResponse.json({ received: true });
    }

    if (merchant && normalizedText.startsWith("PORTAL")) {
      const email = inbound.text.slice(6).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) { await respond(inbound, botResponses.portalEmailNeeded, merchant.id); return NextResponse.json({ received: true }); }
      const { error } = await supabase.from("merchants").update({ portal_email: email }).eq("id", merchant.id);
      if (error) throw error;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      await respond(inbound, botResponses.portalLinked(`${appUrl?.replace(/\/$/, "") ?? ""}/merchant/login`), merchant.id);
      return NextResponse.json({ received: true });
    }

    if (!merchant && normalizedText.startsWith("SEARCH ")) {
      const term = inbound.text.slice(7).trim();
      if (term.length < 2) { await respond(inbound, "Type SEARCH followed by an item or business name."); return NextResponse.json({ received: true }); }
      const { data: matches } = await supabase.from("listings").select("listing_id,title,price_cents,merchants(business_name)").eq("status", "active").or(`title.ilike.%${term}%,description.ilike.%${term}%`).limit(8);
      const results = (matches ?? []).map((listing) => `${listing.listing_id} - ${listing.title} · R${(listing.price_cents / 100).toFixed(2)}${(Array.isArray(listing.merchants) ? listing.merchants[0] : listing.merchants)?.business_name ? ` · ${(Array.isArray(listing.merchants) ? listing.merchants[0] : listing.merchants)?.business_name}` : ""}`).join("\n");
      await respond(inbound, results || "No active listings matched that search. Try a different item or business name.");
      return NextResponse.json({ received: true });
    }

    if (merchant && normalizedText === "IMPORT") {
      await saveState(inbound.from, { stage: "seller_import" }, merchant.id);
      await respond(inbound, botResponses.sellerImport, merchant.id);
      return NextResponse.json({ received: true });
    }

    if (merchant && state.stage === "seller_import") {
      if (!inbound.mediaUrl) {
        await respond(inbound, botResponses.sellerImport, merchant.id);
        return NextResponse.json({ received: true });
      }
      const mimeType = inbound.mediaMimeType?.includes("pdf") ? "application/pdf" : "image/jpeg";
      const importedItems = await extractListingsFromDocument(inbound.mediaUrl, mimeType);
      if (!importedItems.length) {
        await respond(inbound, botResponses.sellerImportNoItems, merchant.id);
        return NextResponse.json({ received: true });
      }
      const summary = importedItems.map((item, index) => `${index + 1}. ${item.title} - R${(item.priceCents / 100).toFixed(2)}${item.description ? ` (${item.description})` : ""}`).join("\n");
      await saveState(inbound.from, { stage: "seller_import_confirm", importedItems }, merchant.id);
      await respond(inbound, botResponses.sellerImportReview(summary), merchant.id);
      return NextResponse.json({ received: true });
    }

    if (merchant && state.stage === "seller_import_confirm") {
      if (normalizedText !== "YES") {
        await saveState(inbound.from, { stage: "idle" }, merchant.id);
        await respond(inbound, "Menu import cancelled. Reply IMPORT to try another file, or SELL to create one listing.", merchant.id);
        return NextResponse.json({ received: true });
      }
      const importedItems = state.importedItems ?? [];
      if (!importedItems.length) {
        await saveState(inbound.from, { stage: "idle" }, merchant.id);
        await respond(inbound, botResponses.sellerImportNoItems, merchant.id);
        return NextResponse.json({ received: true });
      }
      const { error } = await supabase.from("listings").insert(importedItems.map((item) => ({ listing_id: shortCode("L"), merchant_id: merchant.id, title: item.title, description: item.description, price_cents: item.priceCents })));
      if (error) throw error;
      await saveState(inbound.from, { stage: "idle" }, merchant.id);
      await respond(inbound, botResponses.sellerImportComplete(importedItems.length), merchant.id);
      return NextResponse.json({ received: true });
    }

    if (state.stage === "seller_business") {
      if (["SELL", "BUY"].includes(normalizedText) || !inbound.text.trim()) {
        await respond(inbound, botResponses.sellerBusiness);
        return NextResponse.json({ received: true });
      }
      const { data: newMerchant, error } = await supabase.from("merchants").insert({ merchant_id: shortCode("M"), whatsapp_number: inbound.from, business_name: inbound.text, status: "active" }).select().single();
      if (error) throw error;
      await saveState(inbound.from, { stage: "seller_title" }, newMerchant.id);
      await respond(inbound, botResponses.sellerTitle, newMerchant.id);
      return NextResponse.json({ received: true });
    }
    if (merchant && state.stage === "seller_title") {
      await saveState(inbound.from, { stage: "seller_price", title: inbound.text }, merchant.id);
      await respond(inbound, botResponses.sellerPrice, merchant.id);
      return NextResponse.json({ received: true });
    }
    if (merchant && state.stage === "seller_price") {
      const priceCents = Math.round(Number(inbound.text.replace(/[^\d.]/g, "")) * 100);
      if (!Number.isFinite(priceCents) || priceCents <= 0) { await respond(inbound, botResponses.sellerPrice, merchant.id); return NextResponse.json({ received: true }); }
      await saveState(inbound.from, { ...state, stage: "seller_description", priceCents }, merchant.id);
      await respond(inbound, botResponses.sellerDescription, merchant.id);
      return NextResponse.json({ received: true });
    }
    if (merchant && state.stage === "seller_description") {
      await saveState(inbound.from, { ...state, stage: "seller_photo", description: inbound.text }, merchant.id);
      await respond(inbound, botResponses.sellerPhoto, merchant.id);
      return NextResponse.json({ received: true });
    }
    if (merchant && state.stage === "seller_photo") {
      if (!inbound.mediaUrl) { await respond(inbound, botResponses.sellerPhoto, merchant.id); return NextResponse.json({ received: true }); }
      const listingId = shortCode("L");
      const photoUrl = await copyMediaToStorage(inbound.mediaUrl, `listings/${listingId}.jpg`);
      const { error } = await supabase.from("listings").insert({ listing_id: listingId, merchant_id: merchant.id, title: state.title, description: state.description, price_cents: state.priceCents, photo_url: photoUrl });
      if (error) throw error;
      const { data: connection } = await supabase.from("app_settings").select("value").eq("key", "zernio_connection").maybeSingle();
      const accountId = String((connection?.value as { account_id?: string } | null)?.account_id ?? "");
      const botNumber = accountId ? await getZernioWhatsAppNumber(accountId) : "";
      const deepLink = `https://wa.me/${botNumber}?text=${encodeURIComponent(listingId)}`;
      await saveState(inbound.from, { stage: "idle" }, merchant.id);
      await respond(inbound, botResponses.listingCreated(listingId, deepLink), merchant.id, undefined, photoUrl);
      return NextResponse.json({ received: true });
    }
    if (state.stage === "buyer_confirm" && state.listingId) {
      if (normalizedText !== "YES") { await saveState(inbound.from, { stage: "idle" }); await respond(inbound, botResponses.buyerListingMissing); return NextResponse.json({ received: true }); }
      const { data: listing } = await supabase.from("listings").select("*").eq("listing_id", state.listingId).eq("status", "active").single();
      if (!listing) { await respond(inbound, botResponses.buyerListingMissing); return NextResponse.json({ received: true }); }
      const transactionId = shortCode("T");
      const { data: transaction, error } = await supabase.from("transactions").insert({ transaction_id: transactionId, listing_id: listing.id, merchant_id: listing.merchant_id, buyer_whatsapp_number: inbound.from, amount_cents: listing.price_cents, payfast_payment_id: transactionId }).select().single();
      if (error) throw error;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (!appUrl || !transaction.checkout_token) throw new Error("Secure checkout is not configured.");
      const paymentUrl = `${appUrl.replace(/\/$/, "")}/pay/${transaction.checkout_token}`;
      await saveState(inbound.from, { stage: "awaiting_payment" }, undefined, transaction.id);
      await respond(inbound, botResponses.paymentLink(paymentUrl), undefined, transaction.id);
      return NextResponse.json({ received: true });
    }
    if (merchantTransaction && inbound.mediaUrl) {
      const evidenceUrl = await copyMediaToStorage(inbound.mediaUrl, `evidence/${merchantTransaction.transaction_id}-seller-proof.jpg`);
      const fulfilmentMethod = merchantTransaction.fulfilment_method ?? "handover";
      await supabase.from("transactions").update({ seller_evidence_url: evidenceUrl, delivery_evidence_url: fulfilmentMethod === "courier" ? evidenceUrl : null, status: "awaiting_buyer_confirmation" }).eq("id", merchantTransaction.id);
      await respond(inbound, fulfilmentMethod === "courier" ? botResponses.buyerCourierEvidence : botResponses.buyerEvidence, merchant.id, merchantTransaction.id);
      return NextResponse.json({ received: true });
    }
    if (merchantTransaction && ["HANDOVER", "COURIER"].includes(normalizedText)) {
      const fulfilmentMethod = normalizedText.toLowerCase();
      await supabase.from("transactions").update({ fulfilment_method: fulfilmentMethod }).eq("id", merchantTransaction.id);
      await saveState(inbound.from, { stage: fulfilmentMethod === "courier" ? "seller_courier_proof" : "seller_handover_proof" }, merchant.id, merchantTransaction.id);
      await respond(inbound, fulfilmentMethod === "courier" ? botResponses.sellerCourierProof : botResponses.sellerHandoverProof, merchant.id, merchantTransaction.id);
      return NextResponse.json({ received: true });
    }
    if (merchantTransaction && state.stage === "seller_handover_proof" && normalizedText === "DELIVERED") {
      await supabase.from("transactions").update({ fulfilment_method: "handover", status: "awaiting_buyer_confirmation" }).eq("id", merchantTransaction.id);
      await respond(inbound, botResponses.buyerEvidence, merchant.id, merchantTransaction.id);
      return NextResponse.json({ received: true });
    }
    if (merchantTransaction && state.stage === "seller_courier_proof" && inbound.text.trim()) {
      const reference = inbound.text.replace(/\s+DELIVERED$/i, "").trim();
      const delivered = /\bDELIVERED\b/i.test(inbound.text);
      await supabase.from("transactions").update({ fulfilment_method: "courier", fulfilment_reference: reference || null, ...(delivered ? { status: "awaiting_buyer_confirmation" } : {}) }).eq("id", merchantTransaction.id);
      if (delivered) await respond(inbound, botResponses.buyerCourierEvidence, merchant.id, merchantTransaction.id);
      else await respond(inbound, "Tracking reference saved. Reply DELIVERED when the courier confirms delivery, or send courier proof.", merchant.id, merchantTransaction.id);
      return NextResponse.json({ received: true });
    }
    if (buyerTransaction?.status === "awaiting_buyer_confirmation" && inbound.mediaUrl && buyerTransaction.seller_evidence_url) {
      try {
        const evidenceUrl = await copyMediaToStorage(inbound.mediaUrl, `evidence/${buyerTransaction.transaction_id}-buyer.jpg`);
        await supabase.from("transactions").update({ buyer_evidence_url: evidenceUrl }).eq("id", buyerTransaction.id);
        await respond(inbound, "Evidence received. Checking it now...", buyerTransaction.merchant_id, buyerTransaction.id);
        const match = await matchEvidence(buyerTransaction.seller_evidence_url, evidenceUrl);
        const updates: Record<string, unknown> = { ai_match_confidence: match.confidence, ai_match_notes: match.notes };
        if (match.confidence >= 0.85) { updates.status = "released"; updates.released_at = new Date().toISOString(); }
        await supabase.from("transactions").update(updates).eq("id", buyerTransaction.id);
        if (match.confidence >= 0.85) {
          const { data: trustMerchant } = await supabase.from("merchants").select("trust_score").eq("id", buyerTransaction.merchant_id).maybeSingle();
          if (trustMerchant) await supabase.from("merchants").update({ trust_score: Number(trustMerchant.trust_score) + 1 }).eq("id", buyerTransaction.merchant_id);
          const { data: existingCredit } = await supabase.from("merchant_ledger_entries").select("id").eq("transaction_id", buyerTransaction.id).eq("entry_type", "release").maybeSingle();
          if (!existingCredit) await supabase.from("merchant_ledger_entries").insert({ merchant_id: buyerTransaction.merchant_id, transaction_id: buyerTransaction.id, entry_type: "release", amount_cents: buyerTransaction.amount_cents });
          await respond(inbound, botResponses.fundsReleased, buyerTransaction.merchant_id, buyerTransaction.id);
          await notifyMerchantOfRelease(buyerTransaction.merchant_id, buyerTransaction.id).catch((error) => console.error("Merchant release notification failed", { transactionId: buyerTransaction.id, error }));
        } else {
          await saveState(inbound.from, { stage: "buyer_evidence_confirmation" }, buyerTransaction.merchant_id, buyerTransaction.id);
          await respond(inbound, botResponses.evidenceConfirm, buyerTransaction.merchant_id, buyerTransaction.id);
        }
      } catch (error) {
        console.error("Buyer evidence processing failed", { transactionId: buyerTransaction.transaction_id, error });
        await saveState(inbound.from, { stage: "buyer_evidence_confirmation" }, buyerTransaction.merchant_id, buyerTransaction.id);
        await respond(inbound, botResponses.buyerEvidenceFallback, buyerTransaction.merchant_id, buyerTransaction.id);
      }
      return NextResponse.json({ received: true });
    }
    if (state.stage === "buyer_evidence_confirmation" && buyerTransaction) {
      if (normalizedText === "YES") {
        await releaseFunds(inbound, buyerTransaction);
      } else {
        await supabase.from("transactions").update({ status: "disputed" }).eq("id", buyerTransaction.id);
        await supabase.from("disputes").insert({ transaction_id: buyerTransaction.id, reason: "Buyer rejected evidence confirmation" });
        await respond(inbound, botResponses.disputeOpened, buyerTransaction.merchant_id, buyerTransaction.id);
      }
      await saveState(inbound.from, { stage: "idle" }, buyerTransaction.merchant_id, buyerTransaction.id);
      return NextResponse.json({ received: true });
    }
    if (buyerTransaction?.status === "awaiting_buyer_confirmation" && ["YES", "NO"].includes(normalizedText)) {
      if (normalizedText === "YES") {
        await releaseFunds(inbound, buyerTransaction);
      } else {
        await supabase.from("transactions").update({ status: "disputed" }).eq("id", buyerTransaction.id);
        await supabase.from("disputes").insert({ transaction_id: buyerTransaction.id, reason: "Buyer rejected fulfilment confirmation" });
        await respond(inbound, botResponses.disputeOpened, buyerTransaction.merchant_id, buyerTransaction.id);
      }
      await saveState(inbound.from, { stage: "idle" }, buyerTransaction.merchant_id, buyerTransaction.id);
      return NextResponse.json({ received: true });
    }
    if (listingCode.test(normalizedText)) {
      const { data: listing } = await supabase.from("listings").select("*, merchants(trust_score)").eq("listing_id", normalizedText).eq("status", "active").maybeSingle();
      if (!listing) { await respond(inbound, botResponses.buyerListingMissing); return NextResponse.json({ received: true }); }
      const merchantInfo = Array.isArray(listing.merchants) ? listing.merchants[0] : listing.merchants;
      await saveState(inbound.from, { stage: "buyer_confirm", listingId: listing.listing_id });
      await respond(inbound, botResponses.buyerConfirm(listing.title, `R${(listing.price_cents / 100).toFixed(2)}`, Number(merchantInfo?.trust_score ?? 0)), undefined, undefined, listing.photo_url ?? undefined);
      return NextResponse.json({ received: true });
    }
    if (!merchant && normalizedText === "BUY") { await saveState(inbound.from, { stage: "idle" }); await respond(inbound, botResponses.buyerListingMissing); return NextResponse.json({ received: true }); }
    if (merchant && state.stage === "idle") { await saveState(inbound.from, { stage: "seller_title" }, merchant.id); await respond(inbound, botResponses.sellerTitle, merchant.id); return NextResponse.json({ received: true }); }
    if (!merchant && state.stage === "idle") { await respond(inbound, botResponses.welcome); return NextResponse.json({ received: true }); }
    await respond(inbound, await askGemini(inbound.text, `Current stage: ${state.stage}.`), merchant?.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Zernio webhook error", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}