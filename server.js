/*jslint node: true, esversion: 6 */

const program = require('commander');
const url = require('url');
const http = require('http');
const child = require('child_process');
const express = require('express');
const Events = require('events');
const SocketIO = require('socket.io');
const UUID = require('uuid');
const debug = require('debug');

var sharp = null;
try {
	sharp = require('sharp');
} catch (x) {
	// Optional library
}

const API = require('./lib/API');

const NO_CACHE_CONTROL = "no-cache, private, no-store, must-revalidate, max-stale=0, max-age=1,post-check=0, pre-check=0";

program.option("-u, --url <url>", "Camera URL");
program.option("-f, --ffmpeg <path>", "FFmpeg executable path");
program.option("-a, --ffmpegArgs <parameters>", "FFmpeg arguments");
program.option("-p, --port <port>", "Http server port", parseInt);
program.option("-r, --outputRate <rate>", "FFMpeg video output rate", parseInt);
program.option("--inputRate <rate>", "FFMpeg video input rate", parseInt);
program.option("--localtime", "Add localtime on frame");
program.option("--fontPath <fontPath>", "Font path used by localtime");
program.option("--storePath <storePath>", "Path where to store images");
program.option("--storeTimeout <minutes>", "Delay after which the images were deleted", parseInt);
program.option("--storeFPS <storeFPS>", "Stored frames per second", parseInt);
program.option("--storeFileDuration <second>", "Duration of each file", parseInt);
program.option("--socketIO", "Enable socketIO");

program.parse(process.argv);

if (!program.url) {
	throw new Error("URL must be specified");
}

if (!program.ffmpeg) {
	throw new Error("FFmpeg path must be specified");
}

program.ffmpegArgs = program.ffmpegArgs ||
	("-an -r " + (program.inputRate || 20) + " -f m4v -i - -r " + (program.outputRate || 20) + " -qmin 1 -q:v 2 -s 720x576 -f mjpeg");

var ffmpegArgs = program.ffmpegArgs.match(/([A-Za-z0-9\-\+:]+)|"(?:\\"|[^"])+"|\-/g);
for (var i = ffmpegArgs.length - 1; i; i--) {
	ffmpegArgs[i] = ffmpegArgs[i].replace(/"/g, "");
}

if (program.localtime && program.fontPath) {
	ffmpegArgs.push("-vf", "drawtext=text='%{localtime}': fontfile='" + program.fontPath + "': fontsize=20: fontcolor=white@1: x=8: y=8");
}

ffmpegArgs.push("-");

// console.log("args=", ffmpegArgs);

const lastJpegEventEmitter = new Events.EventEmitter();
lastJpegEventEmitter.setMaxListeners(256);

const mimeBoundary = "--OLIVIERVAENVACANCES--";

const app = express();

app.get("/mjpeg", (req, res) => {

	let width;
	let quality;
	if (req.query) {
		width = req.query.width && parseInt(req.query.width);
		quality = req.query.quality && parseInt(req.query.quality);
	}

	res.writeHead(200, {
		'Content-Type': 'multipart/x-mixed-replace; boundary="' + mimeBoundary + '"',
		'Transfer-Encoding': 'chunked',
		'Cache-Control': NO_CACHE_CONTROL
	});

	var stream = new API.MultipartMjpegEncoderStream({
		generateHttpHeader: false,
		mimeBoundary: mimeBoundary
	}, res);

	setTimeout(function () {
		sendJpeg(res, stream, width, quality);
	}, 5);
});

function sendJpeg(res, stream, width, quality) {
	lastJpegEventEmitter.once("jpeg", function sendJpeg(jpeg) {
		console.log('Sharp width=', width, 'quality=', quality);

		if ((width || quality !== undefined) && sharp) {
			let s = sharp(jpeg.data);
			if (width) {
				s = s.resize(width, undefined);
			}
			if (quality !== undefined) {
				s = s.jpeg({quality});
			}

			s.toBuffer((error, buffer) => {
				if (error) {
					console.error(error);
					res.end();
					return;
				}

				stream.writeJpeg({...jpeg, data: buffer}, function (error) {
					if (error) {
						console.error(error);
						res.end();
						return;
					}

					setTimeout(function () {
						sendJpeg(res, stream, width, quality);
					}, 5);
				});
			});
			return;
		}

		stream.writeJpeg(jpeg, function (error) {
			if (error) {
				console.error(error);
				res.end();
				return;
			}

			setTimeout(function () {
				sendJpeg(res, stream, width, quality);
			}, 5);
		});
	});

}

app.get("/jpeg", (req, res) => {

	function sendData(jpeg, buffer) {
		var headers = {
			'Content-Type': 'image/jpeg',
			'Content-Length': buffer.length,
			'Transfer-Encoding': 'chunked',
			'Cache-Control': NO_CACHE_CONTROL,
		};

		if (jpeg.date) {
			headers['X-Image-Date'] = jpeg.date.toISOString();
		}

		res.writeHead(200, headers);

		res.write(buffer);
		res.end();
	}

	lastJpegEventEmitter.once("jpeg", (jpeg) => {

		if (req.query) {
			const width = req.query.width;
			const quality = req.query.quality;

			console.log('Sharp width=', width, 'quality=', quality);

			if ((width || quality !== undefined) && sharp) {
				let s = sharp(jpeg.data);
				if (width) {
					s = s.resize(parseInt(width), undefined);
				}
				if (quality !== undefined) {
					s = s.jpeg({quality: parseInt(quality)});
				}

				s.toBuffer((error, buffer) => {
					if (error) {
						console.error(error);
						res.end();
						return;
					}
					sendData(jpeg, buffer);
				});
				return;
			}
		}

		sendData(jpeg, jpeg.data);
	});
});

const httpServer = http.createServer(app);

if (program.socketIO) {
	const io = SocketIO(httpServer, {
		path: '/ws'
	});

	console.log('Enable socketIO');

	io.on('connection', (socket) => {
		const clientUUID = UUID();
		socket.clientUUID = clientUUID;
		console.log('WS user connected uuid=', clientUUID, 'socket=', socket);

		function sendJpeg(jpeg) {
			console.log('conn=', socket.conn);
			if (!socket.conn.transport.writable) { // Volatile without resize jpeg
				console.log('conn not writable');
				return;
			}
			if ((socket.jpegWidth || socket.jpegQuality !== undefined) && sharp) {
				let g = sharp(jpeg.data);
				if (socket.jpegWidth) {
					g = g.resize(socket.jpegWidth, null);
				}
				if (socket.jpegQuality) {
					g = g.jpeg({quality: socket.jpegQuality});
				}

				g.toBuffer((error, buffer, info) => {
					if (error) {
						console.error(error);
						return;
					}

					socket.volatile.emit('jpeg', buffer);
				});
				return;
			}

			socket.volatile.emit('jpeg', jpeg.data);
		}

		socket.on('disconnect', () => {
			console.log('WS user disconnected uuid=', clientUUID);

			lastJpegEventEmitter.removeListener('jpeg', sendJpeg);
		});

		lastJpegEventEmitter.on('jpeg', sendJpeg);

		socket.on('set-width', (size) => {
			socket.jpegWidth = size;
		});

		socket.on('set-quality', (size) => {
			socket.jpegQuality = size;
		});
	});
}

app.use(express.static(__dirname + '/pages'));

httpServer.listen(program.port || 8080, (error) => {
	if (error) {
		console.error("Server can not listen", error);
		return;
	}
	debug("listen", "Server is listening ", httpServer.address());

//	callback&	callback(null, httpServer);
});

newRequest();

function newRequest() {

	var videoURL = url.parse(program.url);
	videoURL.headers = {
		accept: '*/*'
	};

	var ffmpeg;
	var running = true;
	var lastTimestamp;
	var watchdogInterval;
	var requestNewRequest = false;
	var mpegDecoderStream = new API.MpegDecoderStream();
	var mjpegDecoderStream = new API.MjpegDecoderStream();
	var ipCamDecoderStream = new API.IPCamDecoderStream();

	mjpegDecoderStream.on('jpeg', (jpeg) => {
		lastTimestamp = Date.now();

		lastJpegEventEmitter.emit('jpeg', jpeg);
	});

	/**
	 *
	 * @param response
	 * @param {boolean} restart
	 */
	function stop(response, restart) {
		if (!running) {
			if (restart && !requestNewRequest) {
				requestNewRequest = true;
				setTimeout(newRequest, 5000);
			}
			return;
		}
		running = false;

		if (watchdogInterval) {
			clearInterval(watchdogInterval);
		}

		if (ffmpeg) {
			ffmpeg.stdin.end();

			try {
				ffmpeg.kill('SIGTERM');
			} catch (x) {
			}
			ffmpeg = null;
		}

		mpegDecoderStream.destroy();
		mjpegDecoderStream.destroy();
		ipCamDecoderStream.destroy();

		if (response) {
			response.socket.destroy();
		}

		if (restart && !requestNewRequest) {
			requestNewRequest = true;
			setTimeout(newRequest, 5000);
			return;
		}
	}

	var request = http.request(videoURL, (response) => {
		// console.log('STATUS: ', response.statusCode);
		// console.log('HEADERS: ', response.headers);

		if (response.statusCode != 200) {
			throw new Error("Invalid status code of response " + response.statusCode);
		}

		watchdogInterval = setInterval(() => {
			if (Date.now() - lastTimestamp < 1000 * 20) {
				return;
			}

			console.error("Watchdog detect problem ...");

			stop(response, true);

		}, 1000 * 5);

		var readable = response.pipe(ipCamDecoderStream).pipe(mpegDecoderStream);

		ffmpeg = child.spawn(program.ffmpeg, ffmpegArgs);

		readable.on("data", (data) => ffmpeg.stdin.write(data));

		ffmpeg.stdout.on('data', (data) => mjpegDecoderStream.write(data));

		ffmpeg.stderr.pipe(process.stderr);

		ffmpeg.on("exit", () => {
			console.error("Process exited ! Restart conversion ...");

			stop(response, true);
		});
	});

	request.on('error', (e) => {
		console.error('problem with request: error=', e, 'code=', (e && e.code));

		if (e.code == 'ECONNRESET' || e.code == 'ECONNREFUSED' || e.code == 'EHOSTUNREACH') {
			stop(); //(null, true);
			process.exit(6);
			return;
		}

		stop();
		process.exit(5);
	});

	request.end();

	return request;
}

if (program.storePath) {
	var storeEngine = new API.StoreEngine({
		path: program.storePath,
		framePerSecond: program.storeFPS,
		fileDuration: program.storeFileDuration
	});

	storeEngine.start(lastJpegEventEmitter);
}
