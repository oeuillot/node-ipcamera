var MultipartMjpegDecoderStream = require('./lib/multipartMjpegDecoderStream');
var http = require('http');
var program = require('commander');

program.option("-u, --url <url>", "Mjpeg stream URL");

program.parse(process.argv);

if (!program.url) {
	throw new Error("URL must be specified");
}

var multipartStream = new MultipartMjpegDecoderStream();

multipartStream.on('jpeg', function(jpeg) {
	console.error("Receive jpeg: ", jpeg.date.getTime());
});

var request = http.request(program.url, function(response) {

	if (response.statusCode != 200) {
		throw new Error("Invalid status code of response " + response.statusCode);
	}

	response.pipe(multipartStream);
});

request.end();
