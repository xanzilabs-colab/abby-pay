"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) { setMessage("Supabase authentication is not configured yet."); return; }
    const { error } = await createBrowserClient(url, key).auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setMessage(error ? error.message : "Check your email for the secure sign-in link.");
  }
  return <main className="min-h-screen bg-stone-100 px-6 py-16 text-stone-900"><form onSubmit={submit} className="mx-auto max-w-md border border-stone-300 bg-white p-8 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">AbbyPay</p><h1 className="mt-3 text-3xl font-semibold">Admin access</h1><p className="mt-2 text-sm text-stone-600">Only approved team emails can access operations.</p><label className="mt-8 block text-sm font-medium">Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full border border-stone-300 px-3 py-2 outline-none focus:border-emerald-700" /></label><button className="mt-5 w-full bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Send magic link</button>{message && <p className="mt-4 text-sm text-stone-600">{message}</p>}</form></main>;
}