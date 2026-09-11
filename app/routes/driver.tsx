import { Link, NavLink, Outlet, isRouteErrorResponse, useLocation, useRouteError } from "react-router";

import "../styles/driver.css";

/** Public driver pages: signed-out, so they get the shell chrome without navigation. */
const PUBLIC_PATHS = ["/driver/login", "/driver/activate", "/driver/forgot-password", "/driver/reset-password"];

export function isPublicDriverPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

const NAV = [
  ["/driver", "Home"],
  ["/driver/upcoming", "Upcoming"],
  ["/driver/scheduled", "Scheduled"],
  ["/driver/chat", "Chat"],
  ["/driver/notice", "Notices"],
  ["/driver/account", "Account"],
] as const;

function DriverNav() {
  return (
    <nav className="drv-nav" aria-label="Driver portal">
      {NAV.map(([to, label]) => (
        <NavLink key={to} className="drv-nav__item" to={to} end={to === "/driver"}>
          <span className="drv-nav__label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function DriverLayout() {
  const signedOut = isPublicDriverPath(useLocation().pathname);

  return (
    <div className="drv">
      <div className="drv-shell">
        <div className="drv-brand">
          <Link className="drv-brand__mark" to={signedOut ? "/driver/login" : "/driver"}>Crush Candy Supplies</Link>
          {signedOut ? null : <Link className="drv-brand__link" to="/driver/account">Account</Link>}
        </div>
        {signedOut ? null : <DriverNav />}
        <main className="drv-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Driver-plane error page. Kept inside this route so a failure renders in the driver shell and
 * under this route's security headers. Only the status is shown — never the underlying error.
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
    <div className="drv">
      <div className="drv-shell">
        <div className="drv-brand">
          <Link className="drv-brand__mark" to="/driver">Crush Candy Supplies</Link>
        </div>
        <main className="drv-main">
          <h1 className="drv-page__title">{heading}</h1>
          <p className="drv-page__subtitle">{detail}</p>
          <div className="drv-actions">
            <Link className="drv-btn drv-btn--primary" to="/driver">Back to driver portal</Link>
            <Link className="drv-btn drv-btn--secondary" to="/driver/login">Sign in</Link>
          </div>
        </main>
      </div>
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
