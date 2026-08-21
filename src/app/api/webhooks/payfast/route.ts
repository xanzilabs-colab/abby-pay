import { NextRequest, NextResponse } from "next/server";
import { validatePayFastNotification, verifyPayFastSignature } from "@/lib/payfast";
import { createServiceClient } from "@/lib/supabase";
import { botResponses } from "@/lib/bot-responses";
import { sendZernioMessage } from "@/lib/zernio";

async function getReplyContext(whatsappNumber: string) {
  const { data } = await createServiceClient().from("messages")
    .select("raw_payload")
    .eq("whatsapp_number", whatsappNumber)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const payload = data?.raw_payload as { conversation?: { id?: string }; account?: { id?: string; accountId?: string }; message?: { conversationId?: string; accountId?: string } } | null;
  const conversationId = payload?.conversation?.id ?? payload?.message?.conversationId;
  const accountId = payload?.account?.id ?? payload?.account?.accountId ?? payload?.message?.accountId;
  return conversationId && accountId ? { conversationId, accountId } : null;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const fields = Object.fromEntries(new URLSearchParams(rawBody).entries());
  if (!verifyPayFastSignature(fields) || !(await validatePayFastNotification(rawBody))) {
    return NextResponse.json({ error: "Invalid ITN" }, { status: 400 });
  }
  if (fields.payment_status !== "COMPLETE") return NextResponse.json({ received: true });

  const supabase = createServiceClient();
  const { data: transaction, error } = await supabase
    .from("transactions")
    .update({ status: "awaiting_fulfilment", paid_at: new Date().toISOString(), payfast_pf_payment_id: fields.pf_payment_id })
    .eq("transaction_id", fields.m_payment_id)
    .eq("status", "pending_payment")
    .select("id, merchant_id, buyer_whatsapp_number, merchants(whatsapp_number)")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!transaction) return NextResponse.json({ received: true });
  const merchant = Array.isArray(transaction.merchants) ? transaction.merchants[0] : transaction.merchants;
  const [buyerContext, merchantContext] = await Promise.all([
    getReplyContext(transaction.buyer_whatsapp_number),
    merchant?.whatsapp_number ? getReplyContext(merchant.whatsapp_number) : Promise.resolve(null),
  ]);
  const notifications = [
    buyerContext ? sendZernioMessage(transaction.buyer_whatsapp_number, botResponses.paymentReceived, { ...buyerContext, merchantId: transaction.merchant_id, transactionId: transaction.id }) : Promise.resolve(),
    merchant?.whatsapp_number && merchantContext ? sendZernioMessage(merchant.whatsapp_number, botResponses.sellerFulfil, { ...merchantContext, merchantId: transaction.merchant_id, transactionId: transaction.id }) : Promise.resolve(),
  ];
  await Promise.allSettled(notifications);
  return NextResponse.json({ received: true });
}