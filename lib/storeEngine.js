var Util = require('util');
var Events = require('events');
var fs = require('fs');
var path = require('path');
var os = require('os');
var MultipartMjpegEncoderStream = require('./multipartMjpegEncoderStream');

var StoreEngine = function(configuration) {
	Events.EventEmitter.call(this);

	this._configuration = configuration || {};
}

Util.inherits(StoreEngine, Events.EventEmitter);
module.exports = StoreEngine;

var mimeBoudary = "--OLIVIERVAENVACANCES--";

var proto = {
	start: function(jpegEmitter) {

		var stream;
		var secondKey = 0;
		var nextMs = 1000 / (this._configuration.framePerSecond || 10);
		var indexBySecond = 0;
		var firstImageTimestamp;
		var keyMod = (this._configuration.fileDuration || 60) * 1000;

		var storePath = this._configuration.path || os.tmpdir();

		var self = this;

		jpegEmitter.once("jpeg", function writeJpeg(jpeg) {

			function writeBuffer() {
				stream.writeJpeg(jpeg, function(error) {
					if (error) {
						console.error("Can not write head of file '" + p + "': " + error);
						return;
					}

					jpegEmitter.once("jpeg", writeJpeg);
				});
			}

			var timestamp = (jpeg.date && jpeg.date.getTime()) || Date.now();

			var dKey = Math.floor(timestamp / keyMod);

			if (dKey == secondKey) {

				var diffMs = timestamp - firstImageTimestamp;
				if (diffMs < indexBySecond * nextMs) {
					jpegEmitter.once("jpeg", writeJpeg);
					return;
				}

				indexBySecond++;

				writeBuffer();
				return;
			}

			secondKey = dKey;
			if (stream) {
				stream.close();
				stream = null;
			}
			indexBySecond = 1;
			firstImageTimestamp = timestamp;

			var date = new Date(timestamp);

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

			var fsStream = fs.createWriteStream(p);
			stream = new MultipartMjpegEncoderStream({}, fsStream);

			writeBuffer();
		});
	}
};

for ( var i in proto) {
	StoreEngine.prototype[i] = proto[i];
}
