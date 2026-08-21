import { NextRequest, NextResponse } from "next/server";
import { createPayFastPaymentUrl } from "@/lib/payfast";
import { createServiceClient } from "@/lib/supabase";

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const supabase = createServiceClient();
  const { data: transaction } = await supabase.from("transactions")
    .select("transaction_id, amount_cents, status, listings(title)")
    .eq("checkout_token", params.token)
    .eq("status", "pending_payment")
    .maybeSingle();

  if (!transaction) return NextResponse.redirect(new URL("/payment/cancelled", request.url));
  const listing = Array.isArray(transaction.listings) ? transaction.listings[0] : transaction.listings;
  return NextResponse.redirect(createPayFastPaymentUrl(transaction.transaction_id, transaction.amount_cents, listing?.title ?? "AbbyPay purchase"));
}