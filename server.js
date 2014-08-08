var program = require('commander');
var url = require('url');
var fs = require('fs');
var http = require('http');
var child = require('child_process');
var express = require('express');
var Events = require('events');

var IPCamDecoderStream = require('./lib/ipCamDecoderStream');
var MpegDecoderStream = require('./lib/mpegDecoderStream');
var MjpegDecoderStream = require('./lib/mjpegDecoderStream');

program.option("-u, --url <url>", "Camera URL");
program.option("-f, --ffmpeg <path>", "FFmpeg executable path");
program.option("-a, --ffmpegArgs <parameters>", "FFmpeg arguments");
program.option("-p, --port <port>", "Http server port");
program.option("-r, --outputRate <rate>", "FFMpeg video output rate");
program.option("--inputRate <rate>", "FFMpeg video input rate");
program.option("--localtime", "Add localtime on frame");
program.option("--fontPath <fontPath>", "Font path used by localtime");

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

debugger;

if (program.localtime && program.fontPath) {
	ffmpegArgs.push("-vf", "drawtext=text='%{localtime}': fontfile='" + program.fontPath +
			"': fontsize=20: fontcolor=white@1: x=8: y=8");
}

ffmpegArgs.push("-")

console.log("args=", ffmpegArgs);

var lastJpegEventEmitter = new Events.EventEmitter();

var mimeBoudary = "--YOYOVAENVACANCES--";

var app = express();

app.get("/mjpeg", function(req, res) {

	res.writeHead(200, {
		'Content-Type': 'multipart/x-mixed-replace; boundary="' + mimeBoudary + '"',
		'Transfer-Encoding': 'chunked',
		'Cache-Control': 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0'
	});

	lastJpegEventEmitter.once("jpeg", function sendJpeg(jpeg) {

		res.write(mimeBoudary + '\r\nContent-Type: image/jpeg\r\nContent-Length: ' + jpeg.size + '\r\n\r\n');
		res.write(jpeg.data);
		res.write('\r\n');

		lastJpegEventEmitter.once("jpeg", sendJpeg);
	});
});

app.get("/mjpeg.html", function(req, res) {

	res.writeHead(200, {
		'Content-Type': 'text/html'
	});

	res.end('<html><head></head><body><img style="width: 720px; height: 576px" src="mjpeg" /></body></html>');
});

app.get("/jpeg", function(req, res) {

	lastJpegEventEmitter.once("jpeg", function sendJpeg(jpeg) {

		res.writeHead(200, {
			'Content-Type': 'image/jpeg',
			'Content-Length': jpeg.size,
			'Transfer-Encoding': 'chunked',
			'Cache-Control': 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0'
		});

		res.write(jpeg.data);
		res.end();
	});
});

app.get("/jpeg.html", function(req, res) {

	res.writeHead(200, {
		'Content-Type': 'text/html'
	});

	res.end('<html><head></head><body><img style="width: 720px; height: 576px" src="jpeg" /></body></html>');
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
