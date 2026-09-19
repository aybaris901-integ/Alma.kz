import Clock from "@/components/partner/Clock";

// TODO: replace with the authenticated partner's restaurant once auth/backend exist.
const RESTAURANT_NAME = "Qazan House";

export default function PartnerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
              A
            </div>
            <div className="leading-tight">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Alma Partner
              </div>
              <div className="text-base font-semibold text-slate-900">
                {RESTAURANT_NAME}
              </div>
            </div>
          </div>
          <Clock />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
