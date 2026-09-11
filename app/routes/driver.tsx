import { Link, Outlet, isRouteErrorResponse, useRouteError } from "react-router";

const SHELL = { minHeight: "100vh", background: "#f5f1f4", color: "#2e2028", fontFamily: "Arial, sans-serif" } as const;

export default function DriverLayout() {
  return (
    <div style={SHELL}>
      <Outlet />
    </div>
  );
}

/**
 * Driver-plane error page. Kept inside this route so a failure renders in the driver shell and
 * under this route's security headers, rather than falling through to the generic root boundary.
 * Only the status is shown — never the underlying error.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const heading = status === 404 ? "Page not found" : status === 401 || status === 403 ? "Sign in again" : "Something went wrong";
  const detail =
    status === 404
      ? "That page or delivery is not available to you."
      : status === 401 || status === 403
        ? "Your driver session is no longer valid."
        : "The request could not be completed. Please try again.";

  return (
    <div style={SHELL}>
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px" }}>
        <p style={{ textTransform: "uppercase", letterSpacing: ".12em", fontSize: 12 }}>Crush Candy Supplies</p>
        <h1>{heading}</h1>
        <p>{detail}</p>
        <p>
          <Link to="/driver">Back to driver portal</Link> · <Link to="/driver/login">Sign in</Link>
        </p>
      </main>
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
