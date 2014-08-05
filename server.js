var program = require('commander');
var url = require('url');
var fs = require('fs');
var http = require('http');
var child = require('child_process');
var express = require('express');
var Events = require('events');

var IPCamStream = require('./lib/ipCamStream');
var MpegStream = require('./lib/mpegStream');
var MjpegStream = require('./lib/mjpegStream');

program.option("-u, --url <url>", "Camera URL");
program.option("-f, --ffmpeg <path>", "FFmpeg executable path");
program.option("-a, --ffmpegArgs <parameters>", "FFmpeg arguments");
program.option("-p, --port <port>", "Http server port");
program.option("-r, --rate <rate>", "FFMpeg video rate");

program.parse(process.argv);

if (!program.url) {
	throw new Error("URL must be specified");
}

if (!program.ffmpeg) {
	throw new Error("FFmpeg path must be specified");
}

program.ffmpegArgs = program.ffmpegArgs ||
		("-an -r 20 -f m4v -i - -r " + (program.rate || 20) + " -qmin 1 -q:v 2 -s 720x576 -f mjpeg -");

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

	var request = http.request(videoURL, function(response) {
		// console.log('STATUS: ', response.statusCode);
		// console.log('HEADERS: ', response.headers);

		if (response.statusCode != 200) {
			throw new Error("Invalid status code of response " + response.statusCode);
		}

		var mpegStream = new MpegStream();

		var mjpegStream = new MjpegStream();
		mjpegStream.on('jpeg', function(jpeg) {
			lastJpegEventEmitter.emit('jpeg', jpeg);
		});

		var ipCamStream = new IPCamStream();

		var readable = response.pipe(ipCamStream).pipe(mpegStream);

		ffmpeg = child.spawn(program.ffmpeg, program.ffmpegArgs.split(" "));

		var cnt1 = 0;
		var cnt2 = 0;

		// readable.pipe(ffmpeg.stdin);
		readable.on("data", function(data) {
			// console.log("Send mpeg " + (cnt1++));
			ffmpeg.stdin.write(data);
		});

		ffmpeg.stdout.on('data', function(data) {
			// console.log("Get jpeg " + (cnt2++));

			mjpegStream.write(data);
		});

		ffmpeg.stderr.pipe(process.stderr);
	});

	request.on('error', function(e) {
		console.log('problem with request: ' + e.message);

		if (e.code == 'ECONNRESET') {
			if (ffmpeg) {
				try {
					ffmpeg.kill();
				} catch (x) {
				}
			}

			newRequest();
			return;
		}
	});

	request.end();

	return request;
}
