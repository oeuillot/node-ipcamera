var Util = require('util');
var Events = require('events');
var fs = require('fs');
var path = require('path');
var os = require('os');

var StoreEngine = function(configuration) {
	Events.EventEmitter.call(this);

	this._configuration = configuration || {};
}

Util.inherits(StoreEngine, Events.EventEmitter);
module.exports = StoreEngine;

var mimeBoudary = "--OLIVIERVAENVACANCES--";

var proto = {
	start: function(jpegEmitter) {

		var fdKey = 0;
		var secondKey = 0;
		var nextMs = 1000 / (this._configuration.framePerSecond || 10);
		var indexBySecond = 0;
		var firstImageDate;
		var keyMod = (this._configuration.fileDuration || 60) * 1000;

		var bufInit = new Buffer('Content-Type: multipart/x-mixed-replace; boundary="' + mimeBoudary + '"\r\n\r\n');
		var bufEnd = new Buffer('\r\n');

		var storePath = this._configuration.path || os.tmpdir();

		var self = this;

		jpegEmitter.once("jpeg", function writeJpeg(jpeg) {

			function writeBuffer() {
				var headers = 'Content-Type: image/jpeg\r\nContent-Length: ' + jpeg.size + '\r\n';

				if (jpeg.date) {
					headers += 'X-Image-Date: ' + date.toISOString() + '\r\n';
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

							jpegEmitter.once("jpeg", writeJpeg);
						});
					});
				});
			}

			var date = jpeg.date || Date.now();

			var dKey = Math.floor(date.getTime() / keyMod);

			if (dKey == secondKey) {

				var diffMs = date.getTime() - firstImageDate.getTime();
				if (diffMs < indexBySecond * nextMs) {
					jpegEmitter.once("jpeg", writeJpeg);
					return;
				}

				indexBySecond++;

				writeBuffer();
				return;
			}

			secondKey = dKey;
			if (fdKey) {
				fs.close(fdKey);
				fdKey = 0;
			}
			indexBySecond = 1;
			firstImageDate = date;

			var py = path.join(storePath, String(date.getFullYear()));
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
};

for ( var i in proto) {
	StoreEngine.prototype[i] = proto[i];
}
