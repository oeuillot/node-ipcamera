var MultipartMjpegDecoderStream = require('./lib/multipartMjpegDecoderStream');
var http = require('http');

var multipartStream = new MultipartMjpegDecoderStream();

multipartStream.on('jpeg', function(jpeg) {
	console.error("Receive jpeg: ", jpeg.date.getTime());
});

var request = http.request("http://delabarre3.oeuillot.net:8089/mjpeg", function(response) {

	if (response.statusCode != 200) {
		throw new Error("Invalid status code of response " + response.statusCode);
	}

	response.pipe(multipartStream);
});

request.end();
