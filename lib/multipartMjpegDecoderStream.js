var Util = require('util');
var BuffersStream = require('./buffersStream');

var logPositions = false;

var LF = 10;
var CR = 13;

var MultipartMjpegDecoderStream = function(configuration) {
	BuffersStream.call(this);

	var self = this;

	this._configuration = configuration || {};

	this._contentType = true;

	this.on('jpeg', function(vop) {
		setImmediate(self.readNextJpeg.bind(self));
	});

	this.readNextJpeg();
}

Util.inherits(MultipartMjpegDecoderStream, BuffersStream);
module.exports = MultipartMjpegDecoderStream;

var cnt = 0;

var proto = {
	readNextJpeg: function(start) {
		if (!this._contentType) {
			var endOfHeader = this.searchMark(start || 0);
			if (endOfHeader < 0) {
				this.once('bufferReady', this.readNextJpeg.bind(this, this.bufferSize));
				return null;
			}

			if (logPositions) {
				console.log("End of buffer=", endOfHeader);
			}

			debugger;

			var headerBuffer = this.read(endOfHeader);
			this._parseHeader(headerBuffer);
			start = 0;
		}

		var bufferSize = this.bufferSize;
		var endOfFrameHeader = this.searchMark(start || 0);
		if (endOfFrameHeader < 0) {
			this.once('bufferReady', this.readNextJpeg.bind(this, bufferSize));
			return null;
		}

		var frameHeaderBuffer = this.read(endOfFrameHeader);
		this.read(4); // Remove \r\n\r\n

		var infos = this._parseFrameHeader(frameHeaderBuffer);

		// console.error("Infos=", infos);

		var len = parseInt(infos['Content-Length'], 10);

		var date;
		var dh = infos['X-Image-Date'];
		if (dh) {
			date = new Date(dh);
		}

		var self = this;
		function readFrame() {
			var buffer = self.read(len + 2); // + \r \n

			if (!buffer) {
				self.once('bufferReady', readFrame);
				return;
			}

			buffer = buffer.slice(0, buffer.length - 2); // Remove \r \n

			var frame = {
				data: buffer,
				size: buffer.length,
				date: date
			};

			self.emit('jpeg', frame);

			self.emit('data', buffer);
		}

		readFrame();
	},

	searchMark: function(position) {
		for (;; position += 4) {
			var p = this.peek(position);
			if (p < 0) {
				return -1;
			}

			if (p == CR) {
				if (this.peek(position + 1) == LF) {
					if (this.peek(position + 2) == CR) {
						if (this.peek(position + 3) == LF) {
							return position;
						}
					}
				}
				if (this.peek(position - 1) == LF) {
					if (this.peek(position - 2) == CR) {
						if (this.peek(position + 1) == LF) {
							return position - 2;
						}
					}
				}
				continue;
			}

			if (p == LF) {
				if (this.peek(position - 1) == CR) {
					if (this.peek(position + 1) == CR) {
						if (this.peek(position + 2) == LF) {
							return position - 1;
						}
					}

					if (this.peek(position - 2) == LF) {
						if (this.peek(position - 3) == CR) {
							return position - 3;
						}
					}
				}

				continue;
			}
		}
	},
	_parseHeader: function(buffer) {
	},
	_parseFrameHeader: function(buffer) {
		// var buf = buffer.toString('binary');

		var buf = "";
		for (var i = 0; i < buffer.length; i++) {
			buf += String.fromCharCode(buffer[i]);
		}

		var sa = buf.replace(/\r\n/gm, "\n").split('\n');

		var boundary = sa.shift(); // Remove boundary !
		if (this._configuration.boundary) {
			// TODO verify boudary
		}

		var ret = {};
		sa.forEach(function(s) {
			var m = /^([^:]+): (.+)/g.exec(s);

			if (!m || m.length < 2) {
				return;
			}

			ret[m[1]] = m[2];
		});

		return ret;
	}
};

for ( var i in proto) {
	MultipartMjpegDecoderStream.prototype[i] = proto[i];
}
