import express from "express";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";
import http from "http";
import https from "https";

// ====== Конфигурация ======
const PORT = process.env.PORT || 10000;

// API-Football ключят се пази само тук (ENV в Render)
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

// MJPEG камера URL (можеш да override-неш с ENV MJPEG_URL)
const MJPEG_URL =
  process.env.MJPEG_URL ||
  "http://212.112.136.4:83/mjpg/video.mjpg?camera=1";

// ====== Инициализация ======
const app = express();
app.disable("x-powered-by");
app.use(cors());

// Healthcheck
app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ====== MJPEG /cam proxy ======
// Проксирa multipart/x-mixed-replace към браузъра + CORS
app.get("/cam", (req, res) => {
  try {
    const target = new URL(MJPEG_URL);
    const client = target.protocol === "https:" ? https : http;

    // Някои клиенти държат на no-cache
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");

    const upstreamReq = client.get(target, (upstreamRes) => {
      // Препращаме status + headers от камерата
      const headers = {
        ...upstreamRes.headers,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache"
      };

      // Ако камерата не върне content-type, задаваме дефолтен за MJPEG
      if (!headers["content-type"]) {
        headers["content-type"] =
          "multipart/x-mixed-replace; boundary=--myboundary";
      }

      res.writeHead(upstreamRes.statusCode || 200, headers);
      upstreamRes.pipe(res);
    });

    upstreamReq.on("error", (err) => {
      console.error("MJPEG upstream error:", err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: "mjpeg_upstream_error" });
      } else {
        res.end();
      }
    });

    // Ако клиентът затвори - затваряме и към камерата
    req.on("close", () => {
      try {
        upstreamReq.destroy();
      } catch {}
    });
  } catch (e) {
    console.error("MJPEG proxy error:", e);
    res.status(500).json({ error: "mjpeg_proxy_error", message: e.message });
  }
});

// ====== /api/football proxy към API-Sports ======
if (!API_FOOTBALL_KEY) {
  console.warn(
    "⚠️  Missing env var API_FOOTBALL_KEY — /api/football ще връща 500."
  );
}

// Проксирa всичко от /api/football/* към https://v3.football.api-sports.io/*
app.use(
  "/api/football",
  createProxyMiddleware({
    target: "https://v3.football.api-sports.io",
    changeOrigin: true,
    // махаме префикса /api/football
    pathRewrite: (path) => path.replace(/^\/api\/football/, ""),
    onProxyReq: (proxyReq, req, res) => {
      if (!API_FOOTBALL_KEY) {
        // Няма ключ -> отрязваме заявката с 500 (без да удряме външния API)
        res.status(500).json({ error: "missing_api_key" });
        proxyReq.destroy();
        return;
      }
      // добавяме ключа само от сървъра
      proxyReq.setHeader("x-apisports-key", API_FOOTBALL_KEY);
    },
    onError: (err, req, res) => {
      console.error("API proxy error:", err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: "api_proxy_error" });
      }
    },
    // по-вербални логове при нужда
    logLevel: "warn"
  })
);

// ====== Старт ======
app.listen(PORT, () => {
  console.log(`Proxy listening on :${PORT}`);
  console.log(`- MJPEG:       GET /cam  -> ${MJPEG_URL}`);
  console.log(`- API-Football: /api/football/* -> https://v3.football.api-sports.io/*`);
});
