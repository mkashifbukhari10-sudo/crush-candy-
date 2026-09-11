import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * Driver portal UI primitives. Presentation only — no data access, no auth, no business rules.
 * Styling lives in app/styles/driver.css so the classes stay shared rather than re-inlined.
 */

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** Delivery status → badge tone. Labels are humanised; the underlying status is unchanged. */
const STATUS_TONE: Record<string, Tone> = {
  PENDING: "warning",
  ASSIGNED: "info",
  SCHEDULED: "info",
  OUT_FOR_DELIVERY: "info",
  DELIVERED: "success",
  FAILED: "danger",
  CANCELLED: "danger",
};

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`drv-badge drv-badge--${STATUS_TONE[status] ?? "neutral"}`}>{statusLabel(status)}</span>;
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`drv-badge drv-badge--${tone}`}>{children}</span>;
}

export function UnreadCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="drv-count" aria-label={`${count} unread ${count === 1 ? "message" : "messages"}`}>
      {count}
    </span>
  );
}

export function PageHeader({ eyebrow, title, subtitle, back }: { eyebrow?: string; title: string; subtitle?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="drv-page__header">
      {back ? <Link className="drv-back" to={back.to}>← {back.label}</Link> : null}
      {eyebrow ? <p className="drv-page__eyebrow">{eyebrow}</p> : null}
      <h1 className="drv-page__title">{title}</h1>
      {subtitle ? <p className="drv-page__subtitle">{subtitle}</p> : null}
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`drv-card ${className}`.trim()}>{children}</div>;
}

/** A whole card that acts as one large tap target. */
export function RowLink({ to, title, badge, meta, children }: { to: string; title: ReactNode; badge?: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <Link className="drv-card drv-row" to={to}>
      <span className="drv-row__top">
        <span className="drv-row__title">{title}</span>
        {badge ?? <span className="drv-row__chevron" aria-hidden="true">›</span>}
      </span>
      {meta ? <span className="drv-card__meta">{meta}</span> : null}
      {children}
    </Link>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="drv-empty">
      <p className="drv-empty__title">{title}</p>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

/** Errors keep role="alert" so they are announced; successes use role="status". */
export function Alert({ tone, children }: { tone: "success" | "error" | "info"; children: ReactNode }) {
  return (
    <p className={`drv-alert drv-alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="drv-field">
      <span className="drv-field__label">{label}</span>
      {children}
      {hint ? <span className="drv-field__hint">{hint}</span> : null}
    </label>
  );
}

export function DetailGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="drv-detail__group">
      <p className="drv-detail__label">{label}</p>
      {children}
    </div>
  );
}

const PERTH = { timeZone: "Australia/Perth" } as const;
export const formatDateTime = (value: string | Date) => new Date(value).toLocaleString("en-AU", { ...PERTH, dateStyle: "medium", timeStyle: "short" });
export const formatTime = (value: string | Date) => new Date(value).toLocaleTimeString("en-AU", { ...PERTH, hour: "numeric", minute: "2-digit" });
export const formatDay = (key: string) => new Date(`${key}T00:00:00+08:00`).toLocaleDateString("en-AU", { ...PERTH, weekday: "long", day: "numeric", month: "long" });
