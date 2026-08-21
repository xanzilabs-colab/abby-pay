export type MerchantStatus = "onboarding" | "active" | "suspended";
export type ListingStatus = "active" | "sold" | "inactive";
export type TransactionStatus =
  | "pending_payment"
  | "paid"
  | "awaiting_fulfilment"
  | "awaiting_buyer_confirmation"
  | "released"
  | "disputed"
  | "refunded"
  | "cancelled";
export type DisputeStatus =
  | "open"
  | "investigating"
  | "resolved_refund"
  | "resolved_release";

export interface Merchant {
  id: string;
  merchant_id: string;
  whatsapp_number: string;
  business_name: string;
  status: MerchantStatus;
  trust_score: number;
  created_at: string;
}

export interface Listing {
  id: string;
  listing_id: string;
  merchant_id: string;
  title: string;
  description: string;
  price_cents: number;
  photo_url: string | null;
  status: ListingStatus;
  created_at: string;
}

export interface Transaction {
  id: string;
  transaction_id: string;
  listing_id: string;
  merchant_id: string;
  buyer_whatsapp_number: string;
  amount_cents: number;
  status: TransactionStatus;
  payfast_payment_id: string | null;
  payfast_pf_payment_id: string | null;
  seller_evidence_url: string | null;
  buyer_evidence_url: string | null;
  ai_match_confidence: number | null;
  ai_match_notes: string | null;
  created_at: string;
  paid_at: string | null;
  released_at: string | null;
}