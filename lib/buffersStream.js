var Events = require('events');
var Util = require('util');
var Stream = require('stream');

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

			return buf[position + bufferStart];
		}
	},
	read: function(size) {

		if (logBuffers) {
			console.log("Request bufferSize=", this.bufferSize, " size=", size);
		}

		if (size === undefined) {
			size = this.bufferSize;
		}

		if (size > this.bufferSize || size < 1) {
			return null;
		}

		var ret = new Buffer(size);
		var contentLength = 0;
		var bufferStart = this.bufferStart;

		var buffers = this.buffers;
		for (; buffers.length;) {
			var buf = buffers[0];
			var len = buf.length - bufferStart;

			if (len <= size) {
				if (logBuffers) {
					console.log("Merge buffer contentLength=", contentLength, "/", size, " buf.size=", buf.length, " buf=", buf);
				}
				buf.copy(ret, contentLength, bufferStart, bufferStart + len);
				contentLength += len;
				size -= len;
				bufferStart = 0;

				buffers.shift();
				if (size) {
					continue;
				}
				break;
			}

			if (logBuffers) {
				console.log("Append buffer contentLength=", contentLength, "/", size, " buf.size=", buf.length, " buf=", buf);
			}
			buf.copy(ret, contentLength, bufferStart, bufferStart + size);
			contentLength += size;
			bufferStart += size;

			break;
		}

		if (contentLength != ret.length) {
			throw new Error("Invalid size !");
		}

		this.bufferSize -= contentLength;
		this.bufferStart = bufferStart;

		if (logBuffers) {
			console.log("Return bufferSize=", this.bufferSize, " ret.size=", ret.length, " ret=", ret);
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
