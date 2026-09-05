import { Outlet } from "react-router";

export default function DriverLayout() {
  return (
    <div style={{ minHeight: "100vh", background: "#f5f1f4", color: "#2e2028", fontFamily: "Arial, sans-serif" }}>
      <Outlet />
    </div>
  );
}

export function headers() {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex, nofollow",
  };
}
