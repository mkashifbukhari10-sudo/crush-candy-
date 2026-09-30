import { Link } from "react-router";

/**
 * Admin metric card. Presentation only: the value comes from a loader, the link keeps whatever
 * embedded-admin context the caller passes. Shows "—" when the value is unavailable.
 */
export function StatCard({ label, value, to }: { label: string; value: number | null; to?: string }) {
  const body = (
    <>
      <span className="adm-stat__label">{label}</span>
      <span className="adm-stat__value">{value ?? "—"}</span>
    </>
  );
  return to ? (
    <Link className="adm-stat adm-stat--link" to={to} aria-label={`${label}: ${value ?? "unavailable"}`}>
      {body}
    </Link>
  ) : (
    <div className="adm-stat">{body}</div>
  );
}
