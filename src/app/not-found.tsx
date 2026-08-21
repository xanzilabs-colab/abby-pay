import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-stone-100 px-6 py-12 text-stone-900">
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(to_right,#d6d3d1_1px,transparent_1px),linear-gradient(to_bottom,#d6d3d1_1px,transparent_1px)] [background-size:32px_32px]" />
      <section className="relative w-full max-w-2xl border border-stone-300 bg-white p-8 shadow-[8px_8px_0_0_#065f46] sm:p-12">
        <div className="flex items-center justify-between border-b border-stone-200 pb-5">
          <span className="text-lg font-bold tracking-tight text-emerald-800">AbbyPay</span>
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-stone-500">System notice</span>
        </div>
        <p className="mt-10 font-mono text-sm font-semibold text-emerald-700">ERROR 404</p>
        <h1 className="mt-3 max-w-lg text-4xl font-semibold leading-tight sm:text-5xl">This route is not part of the AbbyPay workflow.</h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-stone-600">Buyer and seller activity happens in WhatsApp. The web application is reserved for authorised operations staff.</p>
        <Link href="/admin" className="mt-9 inline-flex items-center gap-3 bg-emerald-800 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700">
          Return to operations <span aria-hidden="true">&rarr;</span>
        </Link>
      </section>
    </main>
  );
}