"use client";

import { useEffect, useState } from "react";

const formatter = new Intl.DateTimeFormat("ru-KZ", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("ru-KZ", {
  weekday: "short",
  day: "numeric",
  month: "long",
});

/** Live wall clock for the partner top bar. Rendered empty on the server to avoid hydration mismatch. */
export default function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="text-right leading-tight" suppressHydrationWarning>
      <div className="font-mono text-base font-medium tabular-nums text-gray-500">
        {now ? formatter.format(now) : "--:--:--"}
      </div>
      <div className="text-xs text-gray-400">
        {now ? dateFormatter.format(now) : "\u00a0"}
      </div>
    </div>
  );
}
