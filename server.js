var program = require('commander');
var url = require('url');
var fs = require('fs');
var http = require('http');
var child = require('child_process');
var express = require('express');
var Events = require('events');
var path = require('path');

var NO_CACHE_CONTROL = "no-cache, private, no-store, must-revalidate, max-stale=0, max-age=1,post-check=0, pre-check=0";

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

	var fdKey = 0;
	var secondKey = 0;
	var nextMs = 1000 / (program.storeFPS || 10);
	var indexBySecond = 0;
	var firstImageDate;

	var bufInit = new Buffer('Content-Type: multipart/x-mixed-replace; boundary="' + mimeBoudary + '"\r\n\r\n');
	var bufEnd = new Buffer('\r\n');

	lastJpegEventEmitter.once("jpeg", function writeJpeg(jpeg) {

		function writeBuffer() {
			var headers = 'Content-Type: image/jpeg\r\nContent-Length: ' + jpeg.size + '\r\nCache-Control: ' +
					NO_CACHE_CONTROL + '\r\n';

			if (jpeg.timestamp) {
				headers += 'X-Image-Date: ' + (new Date(jpeg.timestamp)).toISOString() + '\r\n';
			}

			var buf = new Buffer(mimeBoudary + '\r\n' + headers + '\r\n');

			fs.write(fdKey, buf, 0, buf.length, null, function(error) {
				if (error) {
					console.error("Can not write head of file '" + p + "': " + error);
					return;
				}

				fs.write(fdKey, jpeg.data, 0, jpeg.data.length, null, function(error) {
					if (error) {
						console.error("Can not write file '" + p + "': " + error);
						return;
					}

					fs.write(fdKey, bufEnd, 0, bufEnd.length, null, function(error) {
						if (error) {
							console.error("Can not write head of file '" + p + "': " + error);
							return;
						}

						lastJpegEventEmitter.once("jpeg", writeJpeg);
					});
				});
			});
		}

		var date = new Date(jpeg.timestamp || Date.now());

		var d = new Date(date.getTime());
		d.setMilliseconds(0);

		if (d.getTime() == secondKey) {

			var diffMs = date.getTime() - firstImageDate.getTime();
			if (diffMs < indexBySecond * nextMs) {
				lastJpegEventEmitter.once("jpeg", writeJpeg);
				return;
			}

			indexBySecond++;

			writeBuffer();
			return;
		}

		secondKey = d.getTime();
		if (fdKey) {
			fs.close(fdKey);
			fdKey = 0;
		}
		indexBySecond = 1;
		firstImageDate = date;

		var py = path.join(program.storePath, String(date.getFullYear()));
		try {
			fs.statSync(py);
		} catch (x) {
			if (x.code == 'ENOENT') {
				fs.mkdirSync(py);
			} else {
				console.log(x);
				throw x;
			}
		}

		var mn = date.getMonth() + 1;
		var md = date.getDate();
		var mh = date.getHours();
		var mi = date.getMinutes();
		var ms = date.getSeconds();

		var pm = path.join(py, ((mn < 10) ? "0" : "") + mn);
		try {
			fs.statSync(pm);
		} catch (x) {
			if (x.code == 'ENOENT') {
				fs.mkdirSync(pm);
			} else {
				console.log(x);
				throw x;
			}
		}

		var pd = path.join(pm, ((md < 10) ? "0" : "") + md);
		try {
			fs.statSync(pd);
		} catch (x) {
			if (x.code == 'ENOENT') {
				fs.mkdirSync(pd);
			} else {
				console.log(x);
				throw x;
			}
		}

		var ph = path.join(pd, ((mh < 10) ? "0" : "") + mh);
		try {
			fs.statSync(ph);
		} catch (x) {
			if (x.code == 'ENOENT') {
				fs.mkdirSync(ph);
			} else {
				console.log(x);
				throw x;
			}
		}

		var p = path.join(ph, "Image " + date.getFullYear() + "-" + ((mn < 10) ? "0" : "") + mn + "-" +
				((md < 10) ? "0" : "") + md + " " + ((mh < 10) ? "0" : "") + mh + "-" + ((mi < 10) ? "0" : "") + mi + "-" +
				((ms < 10) ? "0" : "") + ms + ".mjpeg");

		fs.open(p, "w", function(error, fd) {
			if (error) {
				console.error("Can not create file " + p);
				return;
			}
			fdKey = fd;

			fs.write(fdKey, bufInit, 0, bufInit.length, null, function(error) {
				if (error) {
					console.error("Can not write content header : " + error);
					return;
				}

				writeBuffer();
			});
		});
	});
}
