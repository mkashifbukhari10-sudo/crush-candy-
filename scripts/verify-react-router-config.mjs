import { readFile } from "node:fs/promises";

const serverBuild = await readFile("build/server/index.js", "utf8");
if (!serverBuild.includes('allowedActionOrigins = ["admin.shopify.com", "admin.shopify.com:443"]')) {
  throw new Error("React Router server build is missing the Shopify Admin action-origin allowlist");
}
console.log("React Router action-origin allowlist verified in server build");
