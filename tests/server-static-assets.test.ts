import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

describe("production server serves the client build", () => {
  it("serves fingerprinted assets from build/client/assets as immutable", () => {
    expect(server).toContain('app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }))');
  });

  it("serves the rest of build/client and public", () => {
    expect(server).toContain('express.static("build/client", { maxAge: "1h" })');
    expect(server).toContain('express.static("public", { maxAge: "1h" })');
  });

  it("registers static middleware before the React Router handler", () => {
    const staticAt = server.indexOf('express.static("build/client/assets"');
    const handlerAt = server.indexOf("createRequestHandler({");
    expect(staticAt).toBeGreaterThan(-1);
    expect(handlerAt).toBeGreaterThan(staticAt);
  });

  it("keeps trusting the single Railway proxy hop", () => {
    expect(server).toContain('app.set("trust proxy", 1)');
  });
});
