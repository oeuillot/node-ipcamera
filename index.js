var program = require('commander');
var url = require('url');
var fs = require('fs');
var http = require('http');
var child = require('child_process');
var express = require('express');

var IPCamStream = require('./lib/ipCamStream');
var MpegStream = require('./lib/mpegStream');
var MjpegStream = require('./lib/mjpegStream');

program.option("-u, --url <url>", "Camera URL");
program.option("-f, --ffmpeg <path>", "FFmpeg executable path");
program.option("-p, --ffmpegArgs <parameters>", "FFmpeg arguments");

program.parse(process.argv);

if (!program.url) {
	throw new Error("URL must be specified");
}

if (!program.ffmpeg) {
	throw new Error("FFmpeg path must be specified");
}

program.ffmpegArgs = program.ffmpegArgs || "-an -f m4v -i - -r 5 -qmin 1 -qscale 2 -s 720x576 -f mjpeg -";

var videoURL = url.parse(program.url);
videoURL.headers = {
	accept: '*/*'
};

var lastMjpegStream;

var request = http.request(videoURL, function(response) {
	console.log('STATUS: ', response.statusCode);
	console.log('HEADERS: ', response.headers);

	var mpegStream = new MpegStream();
	if (false) {
		mpegStream.on('frame', function(frame) {
			console.log("Get frame ", frame);
		});
	}

	var mjpegStream = new MjpegStream();

	var ipCamStream = new IPCamStream();

	lastMjpegStream = mjpegStream;

	var readable = response.pipe(ipCamStream).pipe(mpegStream);

	var ffmpeg = child.spawn(program.ffmpeg, program.ffmpegArgs.split(" "));

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
});

request.end();

var mimeBoudary = "--YOYOVAENVACANCES--";

var app = express();

app.get("/mjpeg", function(req, res) {

	res.writeHead(200, {
		'Content-Type': 'multipart/x-mixed-replace; boundary="' + mimeBoudary + '"',
		'Transfer-Encoding': 'chunked',
		'Cache-Control': 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0'
	});

	lastMjpegStream.once("jpeg", function sendJpeg(jpeg) {

		res.write(mimeBoudary + '\r\nContent-Type: image/jpeg\r\nContent-Length: ' + jpeg.size + '\r\n\r\n');
		res.write(jpeg.data);
		res.write('\r\n');

		// res.socket.flush();

		lastMjpegStream.once("jpeg", sendJpeg);
	});
});

app.get("/jpeg", function(req, res) {

	lastMjpegStream.once("jpeg", function sendJpeg(jpeg) {

		res.writeHead(200, {
			'Content-Type': 'image/jpeg',
			'Content-Length': jpeg.size,
			'Cache-Control': 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0'
		});

		res.write(jpeg.data);
		res.end();
	});
});
app.listen(8080);
