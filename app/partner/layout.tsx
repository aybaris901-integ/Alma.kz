import Image from "next/image";
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
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            {/*
              The asset is a wide wordmark (440x167), not a square icon, so it
              matches the old avatar's height and keeps its own aspect ratio
              rather than being squeezed into a 36x36 box.
            */}
            <Image
              src="/logo.svg.png"
              alt={RESTAURANT_NAME}
              width={440}
              height={167}
              priority
              className="h-9 w-auto"
            />
            <div className="leading-tight">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Alma Partner
              </div>
              <div className="text-base font-bold text-gray-900">{RESTAURANT_NAME}</div>
            </div>
          </div>
          <Clock />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
