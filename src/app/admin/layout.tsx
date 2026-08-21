import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";

const links = [["Overview", "/admin"], ["Merchants", "/admin/merchants"], ["Transactions", "/admin/transactions"], ["Disputes", "/admin/disputes"], ["Settings", "/admin/settings"]];
export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { email } = await requireAdmin();
  return <div className="min-h-screen bg-stone-100 text-stone-900"><header className="border-b border-stone-300 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4"><Link href="/admin" className="text-lg font-bold tracking-tight text-emerald-800">AbbyPay <span className="font-normal text-stone-500">Operations</span></Link><span className="text-sm text-stone-500">{email}</span></div><nav className="mx-auto flex max-w-7xl gap-5 overflow-x-auto px-6"><>{links.map(([label, href]) => <Link key={href} href={href} className="border-b-2 border-transparent py-3 text-sm font-medium text-stone-600 hover:border-emerald-700 hover:text-emerald-800">{label}</Link>)}</></nav></header><main className="mx-auto max-w-7xl px-6 py-8">{children}</main></div>;
}