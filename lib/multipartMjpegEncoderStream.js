var Util = require('util');
var stream = require('stream');

var bufEnd = new Buffer('\r\n');

var MultipartMjpegEncoderStream = function(configuration, stream) {

	this._writableStream = stream;

	this._configuration = configuration || {};

	this._mimeBoundary = this._configuration.mimeBoundary || "--OLIVIERVAENVACANCES--";
	this._generateHttpHeader = (this._configuration.generateHttpHeader !== false);
}

Util.inherits(MultipartMjpegEncoderStream, stream.Writable);
module.exports = MultipartMjpegEncoderStream;

var proto = {
	writeJpeg: function(jpeg, callback) {

		var self = this;
		var stream = this._writableStream;

		function writeBody() {
			var headers = 'Content-Type: image/jpeg\r\nContent-Length: ' + jpeg.size + '\r\n';

			if (jpeg.date) {
				headers += 'X-Image-Date: ' + jpeg.date.toISOString() + '\r\n';
			}

			var buf = new Buffer(self._mimeBoundary + '\r\n' + headers + '\r\n');

			stream.write(buf, function(error) {
				if (error) {
					return callback("Can not write head : " + error);
				}

				stream.write(jpeg.data, function(error) {
					if (error) {
						return callback("Can not write data : " + error);
					}

					stream.write(bufEnd, function(error) {
						if (error) {
							return callback("Can not write separator : " + error);
						}

						return callback();
					});
				});
			});
		}

		if (this._generateHttpHeader) {
			this._generateHttpHeader = false;

			var buf = new Buffer('Content-Type: multipart/x-mixed-replace; boundary="' + this._mimeBoundary + '"\r\n\r\n');

			stream.write(buf, function(error) {
				if (error) {
					return callback("Can not write http header : " + error);
				}

				return writeBody();
			});
			return;
		}

		return writeBody();
	},

	close: function() {
		this._writableStream.close();
	}
}

for ( var i in proto) {
	MultipartMjpegEncoderStream.prototype[i] = proto[i];
}
