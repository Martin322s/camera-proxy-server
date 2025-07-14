import express from 'express';
import cors from 'cors';
import request from 'request';

const app = express();
app.use(cors());

const MJPEG_SOURCE = 'http://212.112.136.4:83/mjpg/video.mjpg?camera=1';

app.get('/', (req, res) => {
	req.pipe(request(MJPEG_SOURCE)).pipe(res);
});

app.listen(process.env.PORT || 3000, () => {
	console.log('MJPEG proxy server is running');
});
