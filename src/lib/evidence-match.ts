import { GoogleGenerativeAI } from "@google/generative-ai";

export interface EvidenceMatch { confidence: number; notes: string; }
export interface ImportedListing { title: string; priceCents: number; description: string; }

export async function extractListingsFromDocument(documentUrl: string, mimeType: string): Promise<ImportedListing[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini is not configured.");
  const response = await fetch(documentUrl);
  if (!response.ok) throw new Error("Could not download the menu or price list.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("The menu or price list is too large. Please send a file smaller than 20 MB.");
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent([
    "Extract sellable items from this menu, offering sheet, or price list. Return only JSON: {\"items\":[{\"title\":string,\"priceCents\":integer,\"description\":string}]}. Prices are South African rand; convert to cents. Include only items with a clear positive price. Use a short description only when present; do not invent details. Return at most 20 items.",
    { inlineData: { data: Buffer.from(bytes).toString("base64"), mimeType } },
  ]);
  const text = result.response.text().replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(text) as { items?: unknown[] };
  return (parsed.items ?? []).flatMap((item) => {
    const candidate = item as Partial<ImportedListing>;
    const title = String(candidate.title ?? "").trim();
    const priceCents = Math.round(Number(candidate.priceCents));
    if (!title || !Number.isFinite(priceCents) || priceCents <= 0) return [];
    return [{ title: title.slice(0, 160), priceCents, description: String(candidate.description ?? "").trim().slice(0, 500) }];
  });
}

export async function askGemini(message: string, context: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "I can help with a direct listing code, secure payment, or handover evidence. Reply SELL or BUY to begin.";
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent(`You are AbbyPay, a WhatsApp payment-hold assistant. ${context} AbbyPay has no marketplace, browsing, or search. Keep replies brief, accurate, and on topic. User: ${message}`);
  return result.response.text().slice(0, 1000);
}

export async function matchEvidence(sellerImageUrl: string, buyerImageUrl: string): Promise<EvidenceMatch> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini is not configured.");
  const [sellerResponse, buyerResponse] = await Promise.all([fetch(sellerImageUrl), fetch(buyerImageUrl)]);
  if (!sellerResponse.ok || !buyerResponse.ok) throw new Error("Could not fetch evidence images.");
  const [sellerBytes, buyerBytes] = await Promise.all([sellerResponse.arrayBuffer(), buyerResponse.arrayBuffer()]);
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent([
    "Compare these two handover evidence photos. Return only JSON: {\"confidence\": number from 0 to 1, \"notes\": \"brief explanation\"}. Be conservative; they must plausibly show the same item or handover.",
    { inlineData: { data: Buffer.from(sellerBytes).toString("base64"), mimeType: sellerResponse.headers.get("content-type") || "image/jpeg" } },
    { inlineData: { data: Buffer.from(buyerBytes).toString("base64"), mimeType: buyerResponse.headers.get("content-type") || "image/jpeg" } },
  ]);
  const text = result.response.text().replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(text) as EvidenceMatch;
  return { confidence: Math.max(0, Math.min(1, Number(parsed.confidence))), notes: String(parsed.notes).slice(0, 500) };
}