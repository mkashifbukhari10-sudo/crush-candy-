/**
 * The driver plane sets a strict `style-src 'self' 'unsafe-inline'` and styles itself with a
 * system font stack, so the remote Shopify font stylesheet would be blocked there anyway. Skipping
 * the tag on driver routes removes the CSP violation and a pointless external request, without
 * weakening the policy for any plane.
 */
export function usesRemoteFont(pathname: string): boolean {
  return !(pathname === "/driver" || pathname.startsWith("/driver/"));
}
