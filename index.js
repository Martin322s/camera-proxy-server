import express from "express";
import cors from "cors";
import morgan from "morgan";
import http from "http";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = "30b35d10551986274e707cc2124b2ae5";
const API_FOOTBALL_TARGET = "https://v3.football.api-sports.io";

const MJPEG_URL = "http://212.112.136.4:83/mjpg/video.mjpg?camera=1";

app.use(morgan("dev"));
app.use(cors({
  origin: "*",
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type", "x-apisports-key", "Authorization", "Accept"]
}));
app.options("*", cors());
app.disable("x-powered-by");

app.get("/", (_req, res) => res.json({ ok: true, apiKey: "embedded" }));

app.use((req, _res, next) => {
  console.log("Incoming:", req.method, req.originalUrl);
  next();
});

app.get("/cam", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=--myboundary");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "close");

  const mjpegReq = http.get(MJPEG_URL, (mjpegRes) => mjpegRes.pipe(res));

  mjpegReq.on("error", (err) => {
    console.error("MJPEG stream error:", err.message);
    res.end();
  });

  req.on("close", () => mjpegReq.destroy());
});

app.use(
  "/api/football",
  createProxyMiddleware({
    target: API_FOOTBALL_TARGET,
    changeOrigin: true,
    secure: true,
    xfwd: true,
    logLevel: "debug",
    pathRewrite: (path, _req) => {
      const rewritten = path.replace(/^\/api\/football\/?/, "/");
      if (rewritten === "/") {
        return "/status";
      }
      return rewritten;
    },
    headers: {
      "x-apisports-key": API_KEY,
      "accept": "application/json"
    },
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader("x-apisports-key", API_KEY);
      proxyReq.setHeader("accept", "application/json");

      console.log("[proxyReq] ->", proxyReq.method, proxyReq.path);
      const sentKey = proxyReq.getHeader("x-apisports-key");
      console.log("[proxyReq] header x-apisports-key present:", !!sentKey);
    },
    onProxyRes: (proxyRes, req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*,x-apisports-key,Content-Type,Authorization,Accept");
      console.log("[proxyRes] <-", proxyRes.statusCode, req.method, req.originalUrl);
    },
    onError: (err, _req, res) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: "Upstream error", message: err.message }));
    },
  })
);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => console.log(`🚀 Proxy running on port ${PORT}`));
