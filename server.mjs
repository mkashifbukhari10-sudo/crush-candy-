import express from "express";
import { createRequestHandler } from "@react-router/express";

const build = await import("./build/server/index.js");
const app = express();
// Railway terminates TLS at one trusted reverse proxy. Trust that single hop
// so Express req.protocol reflects X-Forwarded-Proto for React Router URLs.
app.set("trust proxy", 1);
const port = Number(process.env.PORT || 3000);

app.use(express.static("public", { maxAge: "1h" }));
app.all("*", createRequestHandler({ build, mode: process.env.NODE_ENV ?? "production" }));

app.listen(port, "0.0.0.0");
