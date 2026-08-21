import { GoogleGenerativeAI } from "@google/generative-ai";

export interface EvidenceMatch { confidence: number; notes: string; }

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