import type { LucideIcon } from 'lucide-react';

/** Large glyph on a tinted disc, the `hero` of onboarding steps without the wordmark (04 §8). */
export function HeroIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-16 items-center justify-center rounded-full bg-accent-tint text-accent-fg"
    >
      <Icon size={28} strokeWidth={1.75} absoluteStrokeWidth />
    </span>
  );
}
