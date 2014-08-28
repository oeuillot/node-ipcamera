var Events = require('events');
var Util = require('util');
var BuffersStream = require('./buffersStream');

var logPositions = false;

var MpegDecoderStream = function() {
	BuffersStream.call(this);

	var self = this;
	/*
	 * this.on('vol', function(vol) { console.log("Get VOL ", vol); });
	 * 
	 * this.on('vop', function(vop) { console.log("Get VOP ", vop); });
	 */
	this.on('frame', function(vop) {
		setImmediate(self.readNextFrame.bind(self));
	});

	this.readNextFrame();
}

Util.inherits(MpegDecoderStream, BuffersStream);
module.exports = MpegDecoderStream;

var proto = {
	readNextFrame: function(start, lastSearch) {
		if (start === undefined || start < 0) {
			start = this.searchMark(0);
			if (start < 0) {
				this.once('bufferReady', this.readNextFrame.bind(this));
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

		if (!lastSearch || lastSearch < 7) {
			lastSearch = 7;
		}

		var end = this.searchMark(lastSearch);
		if (logPositions) {
			console.log("End=", end);
		}

		if (end < 0) {
			this.once('bufferReady', this.readNextFrame.bind(this, 0, this.bufferSize - 2));
			return null;
		}

		var buffer = this.read(end);

		if (logPositions) {
			console.log("Make buffer to ", end, " => ", buffer);
		}

		var frame = {
			data: buffer,
			size: buffer.length,
			date: new Date()
		}

		var type = buffer[3];
		if (type >= 0 && type <= 0x1F) {
			frame.type = "VO";

		} else if (type >= 20 && type <= 0x2F) {
			frame.type = "VOL";

		} else if (type == 0xb6) {
			frame.type = "VOP";

			var ft = (buffer[4] >> 6) & 0x03;
			switch (ft) {
			case 0:
				frame.frameType = "I";
				break;
			case 1:
				frame.frameType = "P";
				break;
			case 2:
				frame.frameType = "B";
				break;
			case 3:
				frame.frameType = "S";
				break;
			}
		}

		this.emit('frame', frame);

		// if (frame.type == "VO" || frame.frameType == "I") {
		this.emit('data', buffer);
		// }

		return frame;
	},

	searchMark: function(position) {
		for (;; position += 3) {
			var p = this.peek(position);
			if (p < 0) {
				return -1;
			}

			if (p == 1) {
				if (this.peek(position - 1) == 0 && this.peek(position - 2) == 0) {
					return position - 2;
				}
				continue;
			}

			if (p) {
				continue;
			}

			var next1 = this.peek(position + 1);

			if (next1 == 1) {
				if (this.peek(position - 1) == 0) {
					return position - 1;
				}

				continue;
			}

			if (next1 == 0) {
				if (this.peek(position + 2) == 1) {
					return position;
				}
				continue;
			}
		}
	}

};

for ( var i in proto) {
	MpegDecoderStream.prototype[i] = proto[i];
}
