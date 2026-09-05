import express from "express";
import { createRequestHandler } from "@react-router/express";

const build = await import("./build/server/index.js");
const app = express();
const port = Number(process.env.PORT || 3000);

const safeHost = (value) => {
  if (!value) return "";
  try {
    return new URL(value).host;
  } catch {
    return String(value).split("/")[0].split("?")[0];
  }
};

console.error("RR_ALLOWED_ACTION_ORIGINS", build.allowedActionOrigins ?? []);

app.use((request, _response, next) => {
  const requestPath = request.url.split("?")[0];
  if (request.method === "POST" && requestPath.endsWith(".data")) {
    console.error("RR_ORIGIN_HOST", safeHost(request.get("origin")));
    console.error("RR_REQUEST_URL_HOST", request.get("host") ?? "");
    console.error("RR_HOST_HEADER", request.get("host") ?? "");
    console.error("RR_X_FORWARDED_HOST", request.get("x-forwarded-host") ?? "");
    console.error("RR_X_FORWARDED_PROTO", request.get("x-forwarded-proto") ?? "");
  }
  next();
});

app.use(express.static("public", { maxAge: "1h" }));
app.all("*", createRequestHandler({ build, mode: process.env.NODE_ENV ?? "production" }));

app.listen(port, "0.0.0.0", () => {
  console.error(`Production server listening on ${port}`);
});
