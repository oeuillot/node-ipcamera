var program = require('commander');
var url = require('url');
var http = require('http');
var child = require('child_process');
var express = require('express');
var Events = require('events');

var IPCamDecoderStream = require('./lib/ipCamDecoderStream');
var MpegDecoderStream = require('./lib/mpegDecoderStream');
var MjpegDecoderStream = require('./lib/mjpegDecoderStream');
var StoreEngine = require('./lib/storeEngine');

var NO_CACHE_CONTROL = "no-cache, private, no-store, must-revalidate, max-stale=0, max-age=1,post-check=0, pre-check=0";

program.option("-u, --url <url>", "Camera URL");
program.option("-f, --ffmpeg <path>", "FFmpeg executable path");
program.option("-a, --ffmpegArgs <parameters>", "FFmpeg arguments");
program.option("-p, --port <port>", "Http server port");
program.option("-r, --outputRate <rate>", "FFMpeg video output rate");
program.option("--inputRate <rate>", "FFMpeg video input rate");
program.option("--localtime", "Add localtime on frame");
program.option("--fontPath <fontPath>", "Font path used by localtime");
program.option("--storePath <storePath>", "Path where to store images");
program.option("--storeTimeout <minutes>", "Delay after which the images were deleted");
program.option("--storeFPS <storeFPS>", "Stored frames per second", parseInt);

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
	ffmpegArgs.push("-vf", "drawtext=text='%{localtime}': fontfile='" + program.fontPath +
			"': fontsize=20: fontcolor=white@1: x=8: y=8");
}

ffmpegArgs.push("-")

// console.log("args=", ffmpegArgs);

var lastJpegEventEmitter = new Events.EventEmitter();

var mimeBoudary = "--OLIVIERVAENVACANCES--";

var app = express();

app.get("/mjpeg", function(req, res) {

	res.writeHead(200, {
		'Content-Type': 'multipart/x-mixed-replace; boundary="' + mimeBoudary + '"',
		'Transfer-Encoding': 'chunked',
		'Cache-Control': NO_CACHE_CONTROL
	});

	lastJpegEventEmitter.once("jpeg", function sendJpeg(jpeg) {

		var headers = 'Content-Type: image/jpeg\r\nContent-Length: ' + jpeg.size + '\r\nCache-Control: ' +
				NO_CACHE_CONTROL + '\r\n';

		if (jpeg.timestamp) {
			headers += 'X-Image-Date: ' + (new Date(jpeg.timestamp)).toISOString() + '\r\n';
		}

		res.write(mimeBoudary + '\r\n' + headers + '\r\n');
		res.write(jpeg.data);
		res.write('\r\n');

		lastJpegEventEmitter.once("jpeg", sendJpeg);
	});
});

app.get("/mjpeg.html", function(req, res) {
	res.sendfile('pages/mjpeg.html');
});

app.get("/jpeg", function(req, res) {

	lastJpegEventEmitter.once("jpeg", function sendJpeg(jpeg) {

		var headers = {
			'Content-Type': 'image/jpeg',
			'Content-Length': jpeg.size,
			'Transfer-Encoding': 'chunked',
			'Cache-Control': NO_CACHE_CONTROL,
		};

		if (jpeg.timestamp) {
			headers['X-Image-Date'] = (new Date(jpeg.timestamp)).toISOString();
		}

		res.writeHead(200, headers);

		res.write(jpeg.data);
		res.end();
	});
});

app.get("/jpeg.html", function(req, res) {
	res.sendfile('pages/jpeg.html');
});

app.get("/animjpeg.html", function(req, res) {
	res.sendfile('pages/animjpeg.html');
});

app.listen(program.port || 8080);

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
	var mpegDecoderStream = new MpegDecoderStream();
	var mjpegDecoderStream = new MjpegDecoderStream();
	var ipCamDecoderStream = new IPCamDecoderStream();

	mjpegDecoderStream.on('jpeg', function(jpeg) {
		lastTimestamp = Date.now();

		lastJpegEventEmitter.emit('jpeg', jpeg);
	});

	function stop(response, restart) {
		if (!running) {
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

		if (restart) {
			setImmediate(newRequest);
		}
	}

	var request = http.request(videoURL, function(response) {
		// console.log('STATUS: ', response.statusCode);
		// console.log('HEADERS: ', response.headers);

		if (response.statusCode != 200) {
			throw new Error("Invalid status code of response " + response.statusCode);
		}
		watchdogInterval = setInterval(function() {
			if (Date.now() - lastTimestamp < 1000 * 20) {
				return;
			}

			console.log("Watchdog detect problem ...")

			stop(response, true);

		}, 1000 * 5);

		var readable = response.pipe(ipCamDecoderStream).pipe(mpegDecoderStream);

		ffmpeg = child.spawn(program.ffmpeg, ffmpegArgs);

		readable.on("data", function(data) {
			ffmpeg.stdin.write(data);
		});

		ffmpeg.stdout.on('data', function(data) {
			mjpegDecoderStream.write(data);
		});

		ffmpeg.stderr.pipe(process.stderr);

		ffmpeg.on("exit", function() {
			console.log("Process exited ! Restart conversion ...")

			stop(response, true);
		});

	});

	request.on('error', function(e) {
		console.log('problem with request: ' + e.message);

		if (e.code == 'ECONNRESET') {
			stop(null, true);
			return;
		}

		stop();
	});

	request.end();

	return request;
}

if (program.storePath) {
	var storeEngine = new StoreEngine({
		path: program.storePath,
		framePerSecond: program.storeFPS
	});

	storeEngine.start(lastJpegEventEmitter);
}
