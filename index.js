// server.mjs
import http from "http";
import https from "https";
import express from "express";
import cors from "cors";

// ====== Конфигурация ======
const PORT = process.env.PORT || 3000;
const API_SPORTS_BASE = process.env.API_SPORTS_BASE || "https://v3.football.api-sports.io";
const API_SPORTS_KEY  = process.env.API_SPORTS_KEY || "bcc59e56fb2a06c97bd272d304809cb3";

// MJPEG източник (оставям твоя по подразбиране)
const MJPEG_URL = process.env.MJPEG_URL || "http://212.112.136.4:83/mjpg/video.mjpg?camera=1";

// Кеш (просто in-memory, опц.)
const ENABLE_CACHE = process.env.ENABLE_CACHE === "1"; // "1" за вкл.
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 7000); // 7s live

const app = express();
app.disable("x-powered-by");
app.use(cors()); // позволяваме фронтенда да ни вика
app.use(express.json());

// Малък healthcheck
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ====== MJPEG ПРОКСИ (/cam) ======
// Проксира MJPEG stream от външен източник към клиента, mTLS не е нужен.
app.get("/cam", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Нека препратим content-type от източника, защото границата (boundary) често е специфична.
  // Ще го зададем след като получим отговора от източника.

  const client = MJPEG_URL.startsWith("https") ? https : http;

  const upstreamReq = client.get(MJPEG_URL, (upstreamRes) => {
    // Препращаме заглавките (без hop-by-hop)
    const ct = upstreamRes.headers["content-type"] || "multipart/x-mixed-replace";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "close");

    upstreamRes.pipe(res);
  });

  upstreamReq.on("error", (err) => {
    console.error("[MJPEG] stream error:", err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: "mjpeg_upstream_failed" });
    } else {
      res.end();
    }
  });

  // ако клиентът се затвори – спираме и upstream-а
  req.on("close", () => {
    upstreamReq.destroy();
  });
});

// ====== FOOTBALL API ПРОКСИ (/api/football/*) ======
// Пример: /api/football/fixtures?date=2025-10-04
// Frontend: fetch('/api/football/fixtures?...')
//
// По-добре е GET заявки да минават през този прокси, за да няма CORS
// и за да пазим ключа на доставчика от фронтенда.
const cache = new Map(); // key -> { expires:number, body:string, status:number, headers:object }

function cacheKey(req) {
  return `${req.method}:${req.originalUrl}`;
}

app.options("/api/football/*", (req, res) => {
  // CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.sendStatus(204);
});

app.all("/api/football/*", async (req, res) => {
  try {
    // Само GET има смисъл да кешираме в този MVP
    const isGet = req.method === "GET";
    const key = cacheKey(req);

    // -> кеш хит
    if (ENABLE_CACHE && isGet && cache.has(key)) {
      const entry = cache.get(key);
      if (Date.now() < entry.expires) {
        // върни кеширания отговор
        res.status(entry.status);
        for (const [h, v] of Object.entries(entry.headers || {})) {
          if (h.toLowerCase() === "transfer-encoding") continue;
          res.setHeader(h, v);
        }
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.send(entry.body);
      } else {
        cache.delete(key);
      }
    }

    // Пресмятаме пътя към upstream: взимаме всичко след "/api/football/"
    const rest = req.params[0]; // напр. "fixtures"
    const search = req.url.split("?")[1] || "";
    const targetUrl = `${API_SPORTS_BASE}/${rest}${search ? "?" + search : ""}`;

    // Изграждаме опции за fetch
    const headers = {
      "x-apisports-key": API_SPORTS_KEY,
      // Препращане на content-type ако има тяло (за POST и т.н.)
      ...(req.headers["content-type"] ? { "Content-Type": req.headers["content-type"] } : {}),
    };

    const upstreamRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
      // Таймаут чрез AbortController (за всеки случай)
      signal: AbortSignal.timeout(15000),
    });

    const rawBody = await upstreamRes.text();

    // Препращаме назад
    res.status(upstreamRes.status);
    // Задаваме content-type към клиента (ако е наличен)
    const contentType = upstreamRes.headers.get("content-type") || "application/json; charset=utf-8";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");

    // -> кеш запис
    if (ENABLE_CACHE && isGet && upstreamRes.ok) {
      cache.set(key, {
        body: rawBody,
        status: upstreamRes.status,
        headers: { "Content-Type": contentType },
        expires: Date.now() + CACHE_TTL_MS,
      });
    }

    res.send(rawBody);
  } catch (err) {
    console.error("[FOOTBALL PROXY] error:", err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: "football_upstream_failed" });
    }
  }
});

// Глобален handler (за всеки случай)
app.use((err, req, res, next) => {
  console.error("[SERVER] unhandled:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "server_error" });
  }
});

// ====== СТАРТ ======
app.listen(PORT, () => {
  console.log(`Proxy server up on :${PORT}`);
  console.log(`- MJPEG:        GET http://localhost:${PORT}/cam`);
  console.log(`- Football API: GET http://localhost:${PORT}/api/football/fixtures?date=YYYY-MM-DD`);
});
