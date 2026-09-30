import { Outlet, useLocation, useMatches } from "react-router";

import tokensCss from "../styles/tokens.css?raw";
import customerCss from "../styles/customer.css?raw";

/**
 * Customer portal shell. Pages are served through the Shopify App Proxy on the storefront domain,
 * where the app's /assets files may not load, so the styles are embedded in the page. Links are
 * plain anchors because these pages must work without client JavaScript.
 *
 * Presentation only: every child route still authenticates the App Proxy request and re-checks
 * approval itself. Hiding the navigation below secures nothing and is not meant to.
 */
const PORTAL_CSS = `html,body{margin:0;background:#09090b}\n${tokensCss}\n${customerCss}`;

const NAV = [
  ["/apps/portal/orders", "Orders"],
  ["/apps/portal/delivery", "Delivery"],
  ["/apps/portal/help", "Help"],
  ["/apps/portal/announcements", "Announcements"],
] as const;

export default function CustomerPortalLayout() {
  const { pathname } = useLocation();
  // Pages that know the visitor is signed out or unapproved say so; hide the member navigation then.
  const leaf = useMatches().at(-1)?.data as { authenticated?: boolean; approved?: boolean } | undefined;
  const showNav = leaf?.authenticated !== false && leaf?.approved !== false;

  return (
    <div className="ccs">
      <style dangerouslySetInnerHTML={{ __html: PORTAL_CSS }} />
      <header className="ccs-header">
        <div className="ccs-header__bar">
          <a className="ccs-brand" href="/apps/portal">Crush Candy Supplies</a>
          <a className="ccs-header__link" href="/">Back to store</a>
        </div>
        {showNav ? (
          <nav className="ccs-nav" aria-label="Customer portal">
            {NAV.map(([href, label]) => (
              <a key={href} className="ccs-nav__item" href={href} aria-current={pathname.startsWith(href) ? "page" : undefined}>
                {label}
              </a>
            ))}
          </nav>
        ) : null}
      </header>
      <main className="ccs-main">
        <Outlet />
      </main>
    </div>
  );
}
