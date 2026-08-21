export const botResponses = {
  welcome: "Welcome to AbbyPay. Are you selling or buying? Reply SELL or BUY.",
  sellerBusiness: "Seller onboarding - Step 1 of 5: What is your business name?",
  sellerTitle: "New listing - Step 1 of 4: What is the item called?",
  sellerPrice: "New listing - Step 2 of 4: What is the price in rand? Reply with a number, for example 250.",
  sellerDescription: "New listing - Step 3 of 4: Send a short description of the item.",
  sellerPhoto: "New listing - Step 4 of 4: Send one clear photo of the item.",
  sellerImport: "Menu import: send a menu, price list, or offerings sheet as an image or PDF. I will extract draft listings and ask you to confirm before publishing anything.",
  sellerImportReview: (items: string) => `I found these draft listings:\n${items}\n\nReply YES to create them, or NO to cancel.`,
  sellerImportNoItems: "I could not find any clearly priced items. Send a clearer image or PDF, or create a listing step by step with SELL.",
  sellerImportComplete: (count: number) => `Created ${count} listing${count === 1 ? "" : "s"}. Reply SELL to create another listing.`,
  buyerListingMissing: "Send the Listing ID from the seller, for example L-4F2A.",
  buyerConfirm: (title: string, price: string, trust: number) =>
    `${title} costs ${price}. Seller trust score: ${trust.toFixed(2)}. Reply YES to pay securely or NO to cancel.`,
  paymentLink: (url: string) => `Your payment is protected by AbbyPay. Open your secure checkout: ${url}\n\nThis link is for this transaction only.`,
  paymentReceived: "Payment received and secured. We have asked the seller to fulfil your order.",
  sellerFulfil: "Payment is secured. Hand over the item, then send a clear photo as fulfilment evidence.",
  buyerEvidence: "The seller marked the handover complete. Please send a photo of the item you received.",
  evidenceConfirm: "We could not verify the handover automatically. Does this look right? Reply YES or NO.",
  fundsReleased: "The handover was confirmed. Funds have been released to the merchant.",
  disputeOpened: "Thanks. Your transaction has been escalated for manual review.",
  listingCreated: (listingId: string, deepLink: string) =>
    `Listing created: ${listingId}\nShare this direct buyer link: ${deepLink}\nAbbyPay does not publish listings or provide browsing.`,
} as const;