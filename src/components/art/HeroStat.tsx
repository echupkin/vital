import type { ReactNode } from 'react';

/**
 * The headline card in a page banner for a figure that is not a dataset metric
 * (a plan's phase, a path's light, a recovery status). Same shell as HeroFigure;
 * the caller supplies every value, so this never formats or invents one.
 */
export function HeroStat({
  label, value, sub, children,
}: { label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="w-full max-w-[260px] rounded-2xl border border-border bg-surface/80 p-4 shadow-card backdrop-blur-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">{label}</div>
      <div className="mt-1 text-[28px] font-semibold leading-none tnum tracking-[-0.03em] text-text-primary">{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-text-secondary">{sub}</div>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
