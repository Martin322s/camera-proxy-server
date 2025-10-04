import express from "express";
import cors from "cors";
import morgan from "morgan";
import http from "http";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 сложи си твоя ключ тук ↓↓↓
const API_KEY = "30b35d10551986274e707cc2124b2ae5";

// 🌍 базов URL за API Football
const API_FOOTBALL_TARGET = "https://v3.football.api-sports.io";

// 🎥 камера стрийм
const MJPEG_URL = "http://212.112.136.4:83/mjpg/video.mjpg?camera=1";

app.use(morgan("dev"));
app.use(cors({ origin: "*", methods: "GET,POST,OPTIONS", allowedHeaders: "*" }));
app.options("*", cors());
app.disable("x-powered-by");

// Healthcheck
app.get("/", (_req, res) => res.json({ ok: true, apiKey: "embedded" }));

// MJPEG proxy
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

// Football API proxy (ключът се добавя автоматично)
app.use(
	"/api/football",
	createProxyMiddleware({
		target: API_FOOTBALL_TARGET,
		changeOrigin: true,
		secure: true,
		pathRewrite: { "^/api/football": "" },
		onProxyReq: (proxyReq) => {
			proxyReq.setHeader("x-apisports-key", API_KEY);
			proxyReq.setHeader("accept", "application/json");
		},
		onProxyRes: (_proxyRes, _req, res) => {
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "*");
		},
		onError: (err, _req, res) => {
			if (!res.headersSent) {
				res.writeHead(502, { "Content-Type": "application/json" });
			}
			res.end(JSON.stringify({ error: "Upstream error", message: err.message }));
		},
	})
);

// 404 fallback
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => console.log(`🚀 Proxy running on port ${PORT}`));
