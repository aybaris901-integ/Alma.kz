import type { OrderStatus } from "@/types/shared";

// NOTE: every class name in this file must be written out literally (no string
// concatenation) AND `lib/` must stay in tailwind.config.ts `content`, or the
// JIT will not emit the CSS and the colours silently vanish.

// ---------------------------------------------------------------------------
// Status → position in the kitchen pipeline
// ---------------------------------------------------------------------------

/**
 * The linear kitchen pipeline: Created → Preparing → Ready → PickedUp.
 *
 * One step per status. A step's `label` is the ACTION staff take while the
 * order is in that status (it advances the order to the next step); the last
 * step is the terminal state, so its label is a past-tense marker and it is
 * never actionable. This is THE mapping from status to meaning — the card
 * buttons, the card accent and the compact list all derive from it, so they
 * can never disagree about what a status is.
 */
export const PIPELINE: { status: OrderStatus; label: string }[] = [
  { status: "Created", label: "Начать готовить" },
  { status: "Preparing", label: "Готово" },
  { status: "Ready", label: "Выдать" },
  { status: "PickedUp", label: "Выдан" },
];

/**
 * Index into PIPELINE of the order's current step. `null` means the order has
 * left the pipeline (cancelled / rejected / no-show).
 */
export function pipelineIndex(status: OrderStatus): number | null {
  switch (status) {
    case "Created":
      return 0;
    case "Preparing":
    case "Delayed": // still being prepared, just late
      return 1;
    case "Ready":
      return 2;
    case "PickedUp":
      return 3;
    case "Cancelled":
    case "Rejected":
    case "NoShow":
      return null;
  }
}

/** Status written when staff tap the active step; undefined at the end of the pipeline. */
export function nextStatus(status: OrderStatus): OrderStatus | undefined {
  const i = pipelineIndex(status);
  if (i === null) return undefined;
  return PIPELINE[i + 1]?.status;
}

// ---------------------------------------------------------------------------
// Pipeline position → visual tone
// ---------------------------------------------------------------------------

/**
 * What a status *means* visually. Surfaces map a tone to their own
 * presentation — the order cards draw it as a thin left border and dot, the
 * rush-hour compact list as a bold full-row background — but they all agree
 * here on which tone a status gets.
 *
 *   neutral — nothing started yet (Created)
 *   active  — the kitchen is working on it (Preparing / Delayed)
 *   ready   — waiting for the guest (Ready)
 *   done    — handed over (PickedUp)
 *   void    — will not be handed over (Cancelled / Rejected / NoShow)
 */
export type StatusTone = "neutral" | "active" | "ready" | "done" | "void";

/** Derived from `pipelineIndex` rather than a second switch on status. */
export function statusTone(status: OrderStatus): StatusTone {
  const i = pipelineIndex(status);
  if (i === null) return "void";
  if (i === 0) return "neutral";
  if (i === 1) return "active";
  if (i === 2) return "ready";
  return "done";
}

/** Order-card presentation: thin coloured left border + the dot by the number. */
export const TONE_ACCENT: Record<StatusTone, { border: string; dot: string }> = {
  neutral: { border: "border-l-gray-400", dot: "bg-gray-400" },
  active: { border: "border-l-amber-400", dot: "bg-amber-400" },
  ready: { border: "border-l-emerald-500", dot: "bg-emerald-500" },
  done: { border: "border-l-gray-300", dot: "bg-gray-300" }, // muted vs neutral
  void: { border: "border-l-rose-300", dot: "bg-rose-300" },
};

/**
 * Compact-view presentation: bold, high-contrast full-row backgrounds, kept
 * deliberately louder than the card accents because kitchen staff read this
 * list at a glance from a distance.
 *
 * Note `void` is a soft rose wash, NOT the solid red used for the urgency
 * override in the orders page — a cancelled order must not read as urgent.
 */
export const TONE_ROW: Record<StatusTone, string> = {
  neutral: "bg-white text-slate-900",
  active: "bg-yellow-200 text-slate-900",
  ready: "bg-green-200 text-slate-900",
  done: "bg-slate-200 text-slate-600",
  void: "bg-rose-100 text-rose-700",
};
