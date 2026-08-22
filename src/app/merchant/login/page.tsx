"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";

export default function MerchantLogin() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) { setMessage("Portal authentication is not configured."); return; }
    const { error } = await createBrowserClient(url, key).auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/merchant` } });
    setMessage(error ? error.message : "Check your email for your secure sign-in link.");
  }
  return <main className="grid min-h-screen place-items-center bg-stone-100 p-6 text-stone-900"><form onSubmit={submit} className="w-full max-w-md border border-stone-300 bg-white p-8 shadow-[6px_6px_0_0_#047857]"><p className="text-xs font-semibold uppercase tracking-[.15em] text-emerald-700">AbbyPay merchant portal</p><h1 className="mt-3 text-3xl font-semibold">Secure account access</h1><p className="mt-3 text-sm leading-6 text-stone-600">Use the email linked to your merchant account. Payouts require a separate withdrawal PIN.</p><label className="mt-7 block text-sm font-medium">Business email<input className="mt-2 w-full border border-stone-300 p-3 outline-none focus:border-emerald-700" value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /></label><button className="mt-5 w-full bg-emerald-800 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700">Send secure sign-in link</button>{message && <p className="mt-4 text-sm text-stone-600">{message}</p>}</form></main>;
}