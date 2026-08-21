import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";

function Stat({ label, value, detail }: { label: string; value: number; detail: string }) { return <section className="border border-stone-300 bg-white p-5"><p className="text-sm text-stone-600">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-stone-500">{detail}</p></section>; }
export default async function AdminOverview() {
  const { client } = await requireAdmin();
  const [merchants, transactions, disputes, recent] = await Promise.all([
    client.from("merchants").select("status", { count: "exact" }), client.from("transactions").select("status", { count: "exact" }), client.from("disputes").select("id", { count: "exact" }).in("status", ["open", "investigating"]), client.from("transactions").select("created_at").order("created_at", { ascending: false }).limit(1000),
  ]);
  const merchantRows = merchants.data ?? [], transactionRows = transactions.data ?? [];
  const active = merchantRows.filter((row) => row.status === "active").length;
  const open = disputes.count ?? 0;
  const days = new Map<string, number>();
  for (const row of recent.data ?? []) { const day = new Date(row.created_at).toLocaleDateString("en-ZA", { month: "short", day: "numeric" }); days.set(day, (days.get(day) ?? 0) + 1); }
  return <><div className="flex items-baseline justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">System overview</p><h1 className="mt-1 text-3xl font-semibold">Operations dashboard</h1></div><Link href="/admin/disputes" className="text-sm font-semibold text-emerald-800">{open} open disputes</Link></div><div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Merchants" value={merchants.count ?? 0} detail={`${active} active`} /><Stat label="Transactions" value={transactions.count ?? 0} detail={`${transactionRows.filter((row) => row.status === "released").length} released`} /><Stat label="Awaiting fulfilment" value={transactionRows.filter((row) => row.status === "awaiting_fulfilment").length} detail="seller action needed" /><Stat label="Open disputes" value={open} detail="requires review" /></div><section className="mt-8 border border-stone-300 bg-white p-5"><h2 className="font-semibold">Transactions over time</h2><div className="mt-6 flex h-44 items-end gap-2">{Array.from(days.entries()).slice(-14).map(([day, count]) => <div key={day} className="flex min-w-0 flex-1 flex-col items-center gap-2"><span className="text-xs tabular-nums">{count}</span><div className="w-full bg-emerald-700" style={{ height: `${Math.max(8, count * 20)}px` }} /><span className="truncate text-[10px] text-stone-500">{day}</span></div>)}</div></section></>;
}