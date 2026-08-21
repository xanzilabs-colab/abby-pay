import { createServiceClient } from "@/lib/supabase";

const ZERNIO_BASE_URL = "https://zernio.com/api/v1";
type ZernioResource = Record<string, unknown>;

export interface InboundZernioMessage {
  from: string;
  text: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  messageType: "text" | "image";
  conversationId: string;
  accountId: string;
  raw: Record<string, unknown>;
}

export function parseZernioMessage(payload: ZernioResource): InboundZernioMessage | null {
  const root = payload as { message?: ZernioResource; messages?: ZernioResource[]; data?: ZernioResource; conversation?: ZernioResource; account?: ZernioResource; from?: string; sender?: ZernioResource; media?: ZernioResource; text?: string };
  const data = root.data ?? {};
  const message = root.message ?? root.messages?.[0] ?? data.message as ZernioResource ?? (data.messages as ZernioResource[] | undefined)?.[0] ?? {};
  const conversation = root.conversation ?? data.conversation as ZernioResource ?? {};
  const account = root.account ?? data.account as ZernioResource ?? {};
  const text = message.text as ZernioResource | string | undefined;
  const image = message.image as ZernioResource | undefined;
  const media = message.media as ZernioResource | undefined;
  const attachment = (message.attachments as ZernioResource[] | undefined)?.[0];
  const from = message.from ?? message.senderPhone ?? conversation.participantPhone ?? conversation.participantId ?? root.from ?? (root.sender?.phone as string | undefined) ?? data.from;
  const conversationId = conversation.id ?? conversation._id ?? message.conversationId;
  const accountId = account._id ?? account.id ?? message.accountId;
  if (!from || !conversationId || !accountId) return null;
  const mediaUrl = image?.url ?? media?.url ?? attachment?.url ?? attachment?.refreshUrl ?? root.media?.url;
  const attachmentType = attachment?.type ?? attachment?.mimeType ?? media?.type;
  return {
    from: String(from),
    text: String((typeof text === "string" ? text : text?.body) ?? message.message ?? root.text ?? "").trim(),
    mediaUrl: mediaUrl ? String(mediaUrl) : undefined,
    mediaMimeType: attachmentType ? String(attachmentType) : undefined,
    messageType: mediaUrl ? "image" : "text",
    conversationId: String(conversationId),
    accountId: String(accountId),
    raw: payload,
  };
}

function zernioHeaders() {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) throw new Error("Zernio is not configured.");
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

export async function listZernioAccounts() {
  const response = await fetch(`${ZERNIO_BASE_URL}/accounts`, { headers: zernioHeaders(), cache: "no-store" });
  if (!response.ok) throw new Error(`Zernio account lookup failed: ${response.status}`);
  const payload = await response.json();
  return (Array.isArray(payload) ? payload : payload.data ?? payload.accounts ?? []) as ZernioResource[];
}

export async function listZernioConversations() {
  const response = await fetch(`${ZERNIO_BASE_URL}/inbox/conversations`, { headers: zernioHeaders(), cache: "no-store" });
  if (!response.ok) throw new Error(`Zernio conversation lookup failed: ${response.status}`);
  const payload = await response.json();
  return (Array.isArray(payload) ? payload : payload.data ?? payload.conversations ?? []) as ZernioResource[];
}

export async function sendZernioMessage(to: string, body: string, context: { conversationId?: string; accountId?: string; merchantId?: string; transactionId?: string } = {}) {
  if (!context.conversationId || !context.accountId) throw new Error("A Zernio conversation ID and account ID are required to reply.");
  const response = await fetch(`${ZERNIO_BASE_URL}/inbox/conversations/${context.conversationId}/messages`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify({ accountId: context.accountId, message: body }),
  });
  if (!response.ok) throw new Error(`Zernio message send failed: ${response.status}`);
  await createServiceClient().from("messages").insert({
    whatsapp_number: to,
    direction: "outbound",
    merchant_id: context.merchantId ?? null,
    transaction_id: context.transactionId ?? null,
    message_type: "text",
    body,
  });
}

export async function verifyZernioAccount(accountId: string) {
  try {
    const accounts = await listZernioAccounts();
    const account = accounts.find((item) => String(item._id ?? item.id) === accountId);
    if (!account) return "Not Found";
    const active = account.isActive === true || account.enabled === true || account.status === "active";
    if (account.needsReconnection === true || account.intentionalDisconnectAt) return "Not Found";
    return active ? "Connected" : "Not Found";
  } catch {
    return "Error";
  }
}

export async function getZernioWhatsAppNumber(accountId: string) {
  const accounts = await listZernioAccounts();
  const account = accounts.find((item) => String(item._id ?? item.id) === accountId);
  return String(account?.phone_number ?? account?.phone ?? account?.whatsapp_number ?? "").replace(/\D/g, "");
}