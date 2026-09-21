'use client';

import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { X, Search, Command, ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none';
  const variants: Record<string, string> = {
    primary: 'bg-primary text-primary-text hover:opacity-90',
    secondary: 'bg-surface border border-border text-text-primary hover:bg-surface-muted',
    ghost: 'text-text-secondary hover:text-text-primary hover:bg-surface-muted',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  const sizes: Record<string, string> = {
    sm: 'text-xs px-2.5 py-1.5 rounded-control',
    md: 'text-sm px-3.5 py-2 rounded-control',
    lg: 'text-base px-5 py-2.5 rounded-control',
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// ── Card ──────────────────────────────────────────────
//
// The variant controls the surface token explicitly. Never pass a competing
// `bg-*` class through `className`: Tailwind emits same-property utilities in
// alphabetical order, so a second background class silently wins.

interface CardProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'hero' | 'accent' | 'muted';
  as?: 'div' | 'section' | 'article';
  onClick?: () => void;
  role?: string;
  tabIndex?: number;
  'aria-label'?: string;
}

const CARD_VARIANTS: Record<string, string> = {
  default: 'bg-surface border border-border',
  hero: 'bg-hero border border-hero-border text-hero-foreground',
  accent: 'bg-accent-tint border border-transparent',
  muted: 'bg-surface-muted border border-transparent',
};

export function Card({
  children,
  className = '',
  variant = 'default',
  as: Tag = 'div',
  onClick,
  ...props
}: CardProps) {
  return (
    <Tag
      className={`${CARD_VARIANTS[variant]} rounded-card ${onClick ? 'cursor-pointer hover:shadow-sm transition-shadow' : ''} ${className}`}
      onClick={onClick}
      {...props}
    >
      {children}
    </Tag>
  );
}

// ── Badge / Pill ──────────────────────────────────────

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'info' | 'hero';
  className?: string;
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const variants: Record<string, string> = {
    default: 'bg-surface-muted text-text-secondary',
    accent: 'bg-accent-tint text-primary',
    hero: 'bg-hero-muted/15 text-hero-muted',
    success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    warning: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
    info: 'bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}

// ── Pill (for navigation active states) ───────────────

interface PillProps {
  children: ReactNode;
  active?: boolean;
  className?: string;
}

export function Pill({ children, active = false, className = '' }: PillProps) {
  return (
    <span className={`inline-flex items-center px-3 py-1.5 text-sm rounded-full transition-colors ${
      active
        ? 'bg-accent-tint text-primary font-medium'
        : 'text-text-secondary hover:text-text-primary hover:bg-surface-muted'
    } ${className}`}>
      {children}
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: boolean;
}

export function Skeleton({ className = '', width, height, rounded = true }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-surface-muted ${rounded ? 'rounded-lg' : ''} ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** Screen-reader-friendly loading region. */
export function LoadingState({ label = 'Loading data' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      <Skeleton height={16} width="40%" />
      <Skeleton height={120} />
    </div>
  );
}

// ── EmptyState ─────────────────────────────────────────

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {icon && <div className="mb-4 text-text-secondary">{icon}</div>}
      <h3 className="text-lg font-semibold text-text-primary mb-1">{title}</h3>
      {description && <p className="text-sm text-text-secondary max-w-md">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── ErrorState ─────────────────────────────────────────

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'Could not load this data. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <h3 className="text-lg font-semibold text-text-primary mb-1">{title}</h3>
      <p className="text-sm text-text-secondary max-w-md mb-4">{message}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

// ── InsufficientDataState ────────────────────────────

interface InsufficientDataProps {
  metricName?: string;
  message?: string;
}

export function InsufficientDataState({
  metricName = 'this metric',
  message,
}: InsufficientDataProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
      <h3 className="text-sm font-medium text-text-secondary">Not Enough Data</h3>
      <p className="text-xs text-text-secondary mt-1 max-w-sm">
        {message || `There isn't enough data available for ${metricName} to show a meaningful view. Data may be sparse or the collection period is too short.`}
      </p>
    </div>
  );
}

// ── Stale notice ─────────────────────────────────────

/**
 * Staleness is expressed in whole calendar days (`days`) computed by the caller
 * in the user's timezone. A one-day gap is reported plainly, without an alarm:
 * the wording only becomes a stale warning from two days onward.
 */
export function StaleBadge({ days }: { days: number }) {
  if (days < 1) return null;
  const label = days === 1 ? '1d since last reading' : days <= 3 ? `${days}d stale` : `Last reading ${days}d ago`;
  const tone =
    days === 1
      ? 'bg-surface-muted text-text-secondary'
      : days <= 3
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
        : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${tone}`}>
      {label}
    </span>
  );
}

/** Explicit, honest data-quality states required by SPEC §6. */
export function DataStateNote({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'attention' }) {
  return (
    <p
      className={`text-[11px] leading-relaxed ${
        tone === 'attention' ? 'text-category-attention' : 'text-text-secondary'
      }`}
    >
      {children}
    </p>
  );
}

// ── SegmentedControl ─────────────────────────────────

interface SegmentedControlOption {
  value: string;
  label: string;
}

interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}

export function SegmentedControl({ options, value, onChange, className = '', ariaLabel }: SegmentedControlProps) {
  return (
    <div className={`inline-flex bg-surface-muted rounded-control p-0.5 gap-0.5 flex-wrap ${className}`} role="tablist" aria-label={ariaLabel}>
      {options.map(opt => (
        <button
          key={opt.value}
          role="tab"
          type="button"
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-xs font-medium rounded-[10px] transition-colors min-h-[32px] ${
            value === opt.value
              ? 'bg-surface text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────

interface Tab {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className = '' }: TabsProps) {
  return (
    <div className={`flex border-b border-border gap-0 overflow-x-auto ${className}`} role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors min-h-[44px] whitespace-nowrap ${
            active === tab.id
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Select ────────────────────────────────────────────

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  'aria-label'?: string;
}

export function Select({ value, onChange, options, className = '', 'aria-label': ariaLabel }: SelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-surface border border-border rounded-control px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent min-h-[44px] ${className}`}
      aria-label={ariaLabel}
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

// ── Tooltip ──────────────────────────────────────────

interface TooltipProps {
  content: string;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <div className="relative group inline-flex">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-tooltip text-tooltip-foreground text-[11px] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
        {content}
      </div>
    </div>
  );
}

// ── Sparkline (inline mini chart) ────────────────────

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  color?: string;
}

export function Sparkline({ data, width = 80, height = 28, className = '', color }: SparklineProps) {
  const strokeColor = color || 'var(--color-category-activity)';
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  });
  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Change cue (neutral direction, never a judgement) ─

export function ChangeCue({
  direction,
  value,
  percent,
  className = '',
}: {
  direction: 'above' | 'below' | 'none';
  value: string;
  percent?: string | null;
  className?: string;
}) {
  const Icon = direction === 'above' ? ArrowUp : direction === 'below' ? ArrowDown : ArrowRight;
  // The screen-reader text states the direction only; the visible text already
  // carries the value, so it is never repeated.
  const srText =
    direction === 'above' ? 'Higher than baseline' : direction === 'below' ? 'Lower than baseline' : '';
  return (
    <span className={`inline-flex items-center gap-1 tnum ${className}`}>
      <Icon size={12} aria-hidden="true" className="shrink-0 opacity-70" />
      {srText && <span className="sr-only">{srText}: </span>}
      <span>{value}</span>
      {percent && <span className="text-text-secondary">{percent}</span>}
    </span>
  );
}

// ── Dialog / Sheet ───────────────────────────────────

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement as HTMLElement;
      ref.current?.focus();
    } else {
      // Focus is restored to whatever opened the dialog.
      prevFocusRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap: Tab cycles inside the dialog and never escapes to the page.
      const root = ref.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      );
      const items = Array.from(focusable).filter(el => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className="relative bg-surface border border-border rounded-card p-6 max-w-lg w-full mx-4 shadow-xl focus:outline-none max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4 gap-3">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-surface-muted text-text-secondary min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
            aria-label={`Close ${title}`}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Re-exported so consumers can build their own palette triggers.
export { Search, Command };