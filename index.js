import express from "express";
import cors from "cors";
import morgan from "morgan";
import http from "http";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();

// ---- Config (env или стойности по подразбиране)
const PORT = process.env.PORT || 3000;
const MJPEG_URL =
  process.env.MJPEG_URL || "http://212.112.136.4:83/mjpg/video.mjpg?camera=1";
const API_FOOTBALL_TARGET = "https://v3.football.api-sports.io";
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

// ---- Логове + CORS (вкл. префлайт)
app.use(morgan("dev"));
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["*"],
    exposedHeaders: ["*"],
    credentials: false
  })
);
app.options("*", cors());

// ---- Healthcheck
app.get("/", (req, res) => {
  res.type("text/plain").send("camera-proxy-server: OK");
});

// ---- MJPEG proxy (/cam)
app.get("/cam", (req, res) => {
  // Отговор за CORS към клиента
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Content-Type",
    "multipart/x-mixed-replace; boundary=--myboundary"
  );
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "close");

  const mjpegReq = http.get(MJPEG_URL, (mjpegRes) => {
    // Прехвърляме байтовете на MJPEG-а директно към клиента
    mjpegRes.pipe(res);
  });

  mjpegReq.on("error", (err) => {
    console.error("MJPEG stream error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "MJPEG upstream error" }));
  });

  req.on("close", () => {
    mjpegReq.destroy();
  });
});

// ---- API-Football proxy (/api/football/**)
app.use(
  "/api/football",
  createProxyMiddleware({
    target: API_FOOTBALL_TARGET,
    changeOrigin: true,
    secure: true,
    // важен rewrite: НЕ подавай пълен URL като път (иначе path-to-regexp хвърля грешка)
    pathRewrite: { "^/api/football": "" },

    // Слагаме ключа от сървъра, за да не минава през браузъра (и да няма префлайт за custom headers).
    onProxyReq: (proxyReq, req) => {
      if (API_FOOTBALL_KEY && !proxyReq.getHeader("x-apisports-key")) {
        proxyReq.setHeader("x-apisports-key", API_FOOTBALL_KEY);
      }
      proxyReq.setHeader("accept", "application/json");
      // Никога не пращаме content-type при GET, за да не тригърваме префлайт излишно.
      if (proxyReq.method === "GET") {
        proxyReq.removeHeader?.("content-type");
      }
    },

    // Инжектираме CORS хедъри върху отговора към клиента
    onProxyRes: (proxyRes, req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Headers",
        req.headers["access-control-request-headers"] ||
          "origin, x-requested-with, content-type, accept, authorization, x-apisports-key"
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS"
      );
      res.setHeader("Access-Control-Expose-Headers", "*");
    },

    onError: (err, _req, res) => {
      if (!res.headersSent) {
        res.writeHead(502, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        });
      }
      res.end(
        JSON.stringify({ error: "Upstream API error", detail: err.message })
      );
    },

    logger: console
  })
);

// ---- 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`camera-proxy-server running on :${PORT}`);
});
