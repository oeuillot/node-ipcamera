var Events = require('events');
var Util = require('util');
var fs = require('fs');
var BuffersStream = require('./buffersStream');

var logPositions = false;

var MjpegDecoderStream = function() {
	BuffersStream.call(this);

	var self = this;

	this.on('jpeg', function(vop) {
		setImmediate(self.readNextJpeg.bind(self));
	});

	this.readNextJpeg();
}

Util.inherits(MjpegDecoderStream, BuffersStream);
module.exports = MjpegDecoderStream;

var cnt = 0;

var proto = {
	readNextJpeg: function(start, lastSearch) {
		if (start === undefined || start < 0) {
			start = this.searchMark(0, 0xFF, 0xD8);
			if (start < 0) {
				this.once('bufferReady', this.readNextJpeg.bind(this));
				return null;
			}
		}

		if (logPositions) {
			console.log("Start=", start);
		}

		if (start) {
			if (logPositions) {
				console.log("***** SKIP", start);
			}

			this.skip(start);
		}

		if (!lastSearch || lastSearch < 4) {
			lastSearch = 4;
		}

		var end = this.searchMark(lastSearch, 0xFF, 0xD9);
		if (logPositions) {
			console.log("End=", end);
		}

		if (end < 0) {
			this.once('bufferReady', this.readNextJpeg.bind(this, 0, this.bufferSize - 1));
			return null;
		}
		end += 2;

		var buffer = this.read(end);

		if (logPositions) {
			console.log("Make buffer to ", end, " => ", buffer);
		}

		var frame = {
			data: buffer,
			size: buffer.length,
			timestamp: Date.now()
		}

		this.emit('jpeg', frame);

		this.emit('data', buffer);

		if (false) {
			var writable = fs.createWriteStream('c:/temp/j' + (cnt++) + '.jpg');
			writable.write(buffer);
			writable.close();
		}

		return frame;
	},

	searchMark: function(position, firstValue, secondValue) {
		for (;; position += 2) {
			var p = this.peek(position);
			if (p < 0) {
				return -1;
			}

			if (p == firstValue) {
				if (this.peek(position + 1) == secondValue) {
					return position;
				}
				continue;
			}

			if (p == secondValue) {
				if (this.peek(position - 1) == firstValue) {
					return position - 1;
				}
				continue;
			}
		}
	}

};

for ( var i in proto) {
	MjpegDecoderStream.prototype[i] = proto[i];
}
