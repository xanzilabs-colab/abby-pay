import { NextRequest, NextResponse } from "next/server";
import { validatePayFastNotification, verifyPayFastSignature } from "@/lib/payfast";
import { createServiceClient } from "@/lib/supabase";
import { botResponses } from "@/lib/bot-responses";
import { sendZernioMessage } from "@/lib/zernio";

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
  await Promise.all([
    sendZernioMessage(transaction.buyer_whatsapp_number, botResponses.paymentReceived, { merchantId: transaction.merchant_id, transactionId: transaction.id }),
    merchant?.whatsapp_number ? sendZernioMessage(merchant.whatsapp_number, botResponses.sellerFulfil, { merchantId: transaction.merchant_id, transactionId: transaction.id }) : Promise.resolve(),
  ]);
  return NextResponse.json({ received: true });
}