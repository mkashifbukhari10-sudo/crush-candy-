import { describe, expect, it } from "vitest";
import { AnnouncementStatus, isAnnouncementVisible, isSupportStatusTransitionAllowed, sanitizeSupportText, SupportStatus } from "../app/services/content-support.server";

describe("M7 content/support boundaries", () => {
  it("only exposes published announcements at or after their publish time", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(isAnnouncementVisible(AnnouncementStatus.DRAFT, null, now)).toBe(false);
    expect(isAnnouncementVisible(AnnouncementStatus.PUBLISHED, new Date("2026-01-02T00:00:00Z"), now)).toBe(false);
    expect(isAnnouncementVisible(AnnouncementStatus.PUBLISHED, new Date("2025-12-31T00:00:00Z"), now)).toBe(true);
  });
  it("keeps support status terminal and bounds unsafe input", () => {
    expect(isSupportStatusTransitionAllowed(SupportStatus.CLOSED, SupportStatus.OPEN)).toBe(false);
    expect(isSupportStatusTransitionAllowed(SupportStatus.OPEN, SupportStatus.ANSWERED)).toBe(true);
    expect(sanitizeSupportText("  <script>alert(1)</script>  ")).toContain("<script>");
    expect(sanitizeSupportText("x".repeat(5000))).toHaveLength(4000);
  });
});
