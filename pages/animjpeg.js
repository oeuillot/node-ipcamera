function swapJPEG(id, src) {
	var div = document.getElementById(id);
	var ds = div.style;

	function loadImg() {
		var img = document.createElement("IMG");
		var is = img.style;
		is.width = ds.width;
		is.height = ds.height;
		is.position = "absolute";
		is.left = "-10000px";
		is.top = "-10000px";
		is.border = "0";

		img.src = src + "?" + (+new Date());
		img.onload = function() {
			is.left = "0";
			is.top = "0";

			if (div.childNodes.length > 1) {
				setTimeout(function() {
					div.firstChild.style.display = "none";

					div.removeChild(div.firstChild);
				}, 20);
			}

			setTimeout(loadImg, 10);
		};
		div.appendChild(img);
	}

	loadImg();
}
