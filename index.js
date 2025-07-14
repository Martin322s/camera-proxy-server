import http from "http";
import express from "express";

const app = express();

const MJPEG_URL = "http://212.112.136.4:83/mjpg/video.mjpg?camera=1";

app.get("/cam", (req, res) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=--myboundary");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "close");

	const mjpegReq = http.get(MJPEG_URL, (mjpegRes) => {
		mjpegRes.pipe(res);
	});

	mjpegReq.on("error", (err) => {
		console.error("MJPEG stream error:", err.message);
		res.end();
	});

	req.on("close", () => {
		mjpegReq.destroy();
	});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`MJPEG proxy server is running on port ${PORT}`);
});