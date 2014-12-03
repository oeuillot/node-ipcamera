var Events = require('events');
var Util = require('util');
var BuffersStream = require('my-buffers-stream');

var logVOL = false;
var logVOP = false;

var IPCamDecoderStream = function() {
	BuffersStream.call(this);

	var self = this;

	this.once('vol', function(vol) {
		// console.log("Get VOL ", vol);

		setImmediate(self.decodeVOPHeader.bind(self));
	});

	this.on('vop', function(vop) {
		// console.log("Get VOP ", vop);

		setImmediate(self.decodeVOPHeader.bind(self));
	});

	this.decodeVOLHeader();
}

Util.inherits(IPCamDecoderStream, BuffersStream);
module.exports = IPCamDecoderStream;

var proto = {
	decodeVOLHeader: function() {
		if (logVOL) {
			console.log("Wait VOL");
		}

		var buffer = this.read(16);

		if (logVOL) {
			console.log("Wait VOL => ", buffer);
		}
		if (!buffer) {
			this.once('bufferReady', this.decodeVOLHeader.bind(this));
			return;
		}

		if (buffer[0] != 0x00 || buffer[1] != 0x00 || buffer[2] != 0x01 || buffer[3] != 0xa5) {
			var newBuffer = buffer.slice(1);
			this.unshift(newBuffer);

			if (true) {
				console.log("Unshift VOL => ", newBuffer);
			}
			setImmediate(this.decodeVOLHeader.bind(this));
			return;
		}

		var header = {
			dataSize: buffer[5] | (buffer[6] << 8) | (buffer[7] << 16),
			controlData: (buffer[8] & 0x1) > 0,

			singleIFrameIndication: (buffer[8] & 0x2) > 0,
			displayResolution: buffer[9] | ((buffer[10] & 0x80) << 1),

			audioFormat: buffer[11] & 0x01,
			audioCompression: (buffer[11] & 0x06) >> 1
		};

		if (logVOL) {
			console.log("Get VOL => ", header);
		}

		this.emit('volHeader', header);

		this.decodeVOLData(header);
	},

	decodeVOLData: function(volHeader) {

		if (logVOL) {
			console.log("Wait VOL.Data");
		}

		var volData = this.read(volHeader.dataSize);

		if (logVOL) {
			console.log("Wait VOL.Data => ", volData);
		}

		if (!volData) {
			this.once('bufferReady', this.decodeVOLData.bind(this, volHeader));
			return;
		}

		this.emit('volData', volData);

		volHeader.data = volData;
		volHeader.timestamp = Date.now();

		if (logVOL) {
			console.log("Wait VOL completed ", volHeader);
		}

		this.emit('vol', volHeader);

		this.emit('data', volData);
	},
	decodeVOPHeader: function() {
		if (logVOP) {
			console.log("Wait VOP");
		}

		var buffer = this.read(16);

		if (logVOP) {
			console.log("Wait VOP => ", buffer);
		}

		if (!buffer) {
			this.once('bufferReady', this.decodeVOPHeader.bind(this));
			return;
		}

		if (buffer[0] != 0x00 || buffer[1] != 0x00 || buffer[2] != 0x01 || buffer[3] != 0xa5) {
			var newBuffer = buffer.slice(1);
			this.unshift(newBuffer);
			setImmediate(this.decodeVOPHeader.bind(this));

			if (true) {
				console.log("Unshift VOP => ", newBuffer);
			}
			return;
		}

		var header = {
			dataDefinition: (buffer[4] & 0x1),
			videoAudioIndicator: (buffer[4] & 0x6) >> 1,
			wayAudioIndicator: (buffer[4] & 0x18) >> 3,
			dataSize: buffer[5] | (buffer[6] << 8) | (buffer[7] << 16),

			controlDataIndicator: (buffer[8] & 0x1),
			frameRate: (buffer[8] & 0x76) >> 2,
			frameType: (buffer[9] & 0x20) >> 6,
			startOfFrame: (buffer[9] & 0x40) > 0,
			endOfFrame: (buffer[9] & 0x80) > 0
		};

		this.emit('vopHeader', header);

		if (logVOP) {
			console.log("Wait VOP header => ", header);
		}

		this.decodeVOPData(header);
	},

	decodeVOPData: function(vopHeader) {
		if (logVOP) {
			console.log("Wait VOP.Data");
		}

		var vopData = this.read(vopHeader.dataSize);

		if (logVOP) {
			console.log("Wait VOP.Data => ", vopData);
		}

		if (!vopData) {
			this.once('bufferReady', this.decodeVOPData.bind(this, vopHeader));
			return;
		}

		this.emit('vopData', vopData);

		vopHeader.data = vopData;
		vopHeader.timestamp = Date.now();

		if (logVOP) {
			console.log("Wait VOP.Data completed ", vopData);
		}

		this.emit('vop', vopHeader);

		this.emit('data', vopData);
	}
};

for ( var i in proto) {
	IPCamDecoderStream.prototype[i] = proto[i];
}
