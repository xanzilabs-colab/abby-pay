import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase";

export async function requireMerchant() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) redirect("/merchant/login?reason=configuration");
  const cookieStore = cookies();
  const auth = createServerClient(url, key, { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } });
  const { data: { user } } = await auth.auth.getUser();
  if (!user?.email) redirect("/merchant/login");
  const client = createServiceClient();
  const { data: merchant } = await client.from("merchants").select("*").eq("portal_email", user.email.toLowerCase()).maybeSingle();
  if (!merchant) redirect("/merchant/login?reason=unlinked");
  return { client, merchant, email: user.email };
}