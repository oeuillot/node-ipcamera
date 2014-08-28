var Util = require('util');
var Stream = require('stream');

var useSlice = false; // Node 0.10.x has a memory leak

var logBuffers = false;

var BuffersStream = function() {
	Stream.call(this);

	this.writable = true;
	this.readable = true;

	this.buffers = [];
	this.bufferSize = 0;
	this.bufferStart = 0;

	this.pause = false;
	this.ended = false;
}

Util.inherits(BuffersStream, Stream);
module.exports = BuffersStream;

var proto = {
	pause: function() {
		this.pause = true;
	},
	resume: function() {
		this.pause = false;
	},
	end: function() {
		if (this.ended) {
			return;
		}
		this.ended = true;

		this.emit('finish');
	},
	destroy: function() {
		this.end();

		this.buffers = null;
		this.bufferSize = 0;
		this.bufferStart = 0;
	},
	write: function(chunk) {
		if (this.ended) {
			return;
		}
		this.buffers.push(chunk);
		this.bufferSize += chunk.length;

		this.emit('bufferReady');
	},
	skip: function(size) {
		if (size < 1) {
			return;
		}

		if (size >= this.bufferSize) {
			// console.log("SKIP overflow");
			this.bufferSize = 0;
			this.buffers = [];
			this.bufferStart = 0;
			return;
		}

		var buffers = this.buffers;
		var bufferStart = this.bufferStart;
		var bufferSize = this.bufferSize;

		for (; buffers.length;) {
			var buf = buffers[0];
			var len = buf.length - bufferStart;

			if (len <= size) {
				bufferStart = 0;
				bufferSize -= len;
				size -= len;

				buffers.shift();
				if (size) {
					continue;
				}
				break;
			}

			bufferStart += size;
			bufferSize -= size;
			break;
		}

		this.bufferStart = bufferStart;
		this.bufferSize = bufferSize;
	},

	peek: function(position) {

		if (position >= this.bufferSize || position < 0) {
			return -1;
		}

		var buffers = this.buffers;

		var bufferStart = this.bufferStart;

		for (var i = 0; i < buffers.length; i++) {
			var buf = buffers[i];

			var len = buf.length - bufferStart;

			if (position >= len) {
				position -= len;
				bufferStart = 0;
				continue;
			}

			var ret = buf[position + bufferStart];
			return ret;
		}

		throw new Error("Invalid position");
	},
	read: function(size) {

		if (size === undefined) {
			size = this.bufferSize;
		}

		if (size > this.bufferSize || size < 1) {
			return null;
		}

		var ret = null;
		if (!useSlice) {
			ret = new Buffer(size);
		}

		var contentLength = 0;
		var bufferStart = this.bufferStart;

		var buffers = this.buffers;
		for (; buffers.length;) {
			var buf = buffers[0];
			var len = buf.length - bufferStart;

			if (logBuffers) {
				console.error("Try len=", len, "size=", size, "contentLength=", contentLength);
			}

			if (len <= size) {
				if (logBuffers) {
					console
							.error("Merge buffer contentLength=", contentLength, "/", size, " buf.size=", buf.length, " buf=", buf);
				}

				buffers.shift();

				if (!ret) {
					if (len == size) {
						ret = buf.slice(bufferStart, bufferStart + len);
						contentLength += len;
						size = 0;
						bufferStart = 0;

						break;
					}

					ret = new Buffer(size);
				}

				buf.copy(ret, contentLength, bufferStart, bufferStart + len);
				contentLength += len;
				size -= len;
				bufferStart = 0;

				if (size) {
					continue;
				}
				break;
			}

			if (logBuffers) {
				console.error("Append buffer contentLength=", contentLength, "/", size, " buf.size=", buf.length);
			}
			if (!ret) {
				ret = buf.slice(bufferStart, bufferStart + size);
			} else {
				buf.copy(ret, contentLength, bufferStart, bufferStart + size);
			}
			contentLength += size;
			bufferStart += size;

			break;
		}

		if (logBuffers) {
			console.error("Exit len=", len, "size=", size, "contentLength=", contentLength, "ret=", ret.length);
		}

		if (contentLength !== ret.length) {
			// debugger;
			throw new Error("Invalid size ! computed length=" + contentLength + "return length=" + ret.length);
		}

		this.bufferSize -= contentLength;
		this.bufferStart = bufferStart;

		if (logBuffers) {
			console.error("Return bufferSize=", this.bufferSize, " ret.size=", ret.length, " ret=", ret);
		}
		return ret;
	},
	unshift: function(buffer) {
		var bufferStart = this.bufferStart;
		var buffers = this.buffers;

		if (bufferStart && buffers.length) {
			var lastBuf = buffers[0];
			var buf = new Buffer(lastBuf.length - bufferStart);
			lastBuf.copy(buf, 0, bufferStart);

			buffers[0] = buf;
			this.bufferStart = 0;
		}

		this.buffers.unshift(buffer);
	},
	toString: function() {
		return "[BufferStream size=" + this.bufferSize + "]";
	}
};

for ( var i in proto) {
	BuffersStream.prototype[i] = proto[i];
}
