

var in_got_packet = false;
var changing_name = false;
var changing_color = false;

function get_appropriate_ws_url(extra_url) {
	var pcol;
	var u = document.URL;

	/*
	 * We open the websocket encrypted if this page came on an
	 * https:// url itself, otherwise unencrypted
	 */

	if (u.substring(0, 5) === "https") {
		pcol = "wss://";
		u = u.substr(8);
	} else {
		pcol = "ws://";
		if (u.substring(0, 4) === "http")
			u = u.substr(7);
	}

	u = u.split("/");

	/* + "/xxx" bit is for IE10 workaround */

	return pcol + u[0] + "/" + extra_url;
}

function new_ws(urlpath, protocol)
{
	return new WebSocket(urlpath, protocol);
}

var ws = null;
var ws_connected = false;
var ws_connecting = false;
var rq_queue = [];
var mem = [];

function rq_queue_push(cmd)
{
	rq_queue.push(cmd);
}

function rq_queue_send()
{
	if (!ws_connected) {
		if (!ws_connecting)
			attempt_ws();

		return;
	}

	while (rq_queue.length > 0) {
		var e = rq_queue.shift();
		var cmd = e[0];
		var cb = e[1];
		var data = e[2];
		if (!cb(data))
			continue;
		console.log("sending " + cmd);
		ws.send(cmd);
		break;
	}
}

function request_channels()
{
	for (var ch = 0; ch < 32; ch++) {
		// name
		rq_queue_push(["RQ1 " + (0x04000000 + ch * 0x10000).toString(16) + " 6", (x) => { return true; }, 0]);
	}

	for (var ch = 0; ch < 32; ch++) {
		// color
		rq_queue_push(["RQ1 " + (0x0400000E + ch * 0x10000).toString(16) + " 1", (x) => { return true; }, 0]);
	}

	rq_queue_send();
}

function senddt1(addr, data)
{
	msg = "DT1 " + addr.toString(16);
	for (var i = 0; i < data.length; i++) {
		msg = msg + " " + data[i].toString(16);
		mem[addr + i] = data[i];
	}
	console.log("sending " + msg);
	ws.send(msg);
}

var cache_ch_mute = new Array(32);

function got_ch_mute(ch, val) {
	console.log("got_ch_mute " + ch + " " + val);
	cache_ch_mute[ch] = !!val;
}

function got_ch_name(ch) {
	var a = 0x04000000 + (ch << 16);
	var name = String.fromCharCode(mem[a], mem[a+1], mem[a+2], mem[a+3], mem[a+4], mem[a+5]);
	console.log("got_ch_name " + ch + " '" + name + "'");
	var e = document.getElementById("channel_name_" + ch);
	if (e && !changing_name) {
		e.value = name.trimEnd();
	}
}

function on_submit_name(ch) {
	if (in_got_packet)
		return;
	var e = document.getElementById("channel_name_" + ch);
	var name = e ? e.value : '';
	while (name.length < 6)
		name = name + ' ';
	if (name.length > 6)
		name = name.substring(0, 6);
	console.log("on_submit_name " + ch + " '" + name + "'");

	changing_name = true;
	senddt1(0x04000000 + ch * 0x10000, [
		name.charCodeAt(0),
		name.charCodeAt(1),
		name.charCodeAt(2),
		name.charCodeAt(3),
		name.charCodeAt(4),
		name.charCodeAt(5) ]);
	changing_name = false;
}

function got_ch_color(ch, color)
{
	console.log("got_ch_color " + ch + " " + color);
	var e = document.getElementById("channel_label_" + ch);
	if (e) {
		for (var i = 0; i < 8; i++) {
			if (i != color)
				e.classList.remove("color-" + i);
		}
		e.classList.add("color-" + color);
	}

	var e = document.getElementById("channel_color_" + ch);
	if (e && !changing_color) {
		e.value = color;
	}
}

function on_submit_color(ch) {
	if (in_got_packet)
		return;
	var e = document.getElementById("channel_color_" + ch);
	var color = e.value;
	console.log("on_submit_color " + ch + " " + color);

	changing_color = true;
	senddt1(0x0400000E + ch * 0x10000, [color]);
	got_ch_color(ch, color);
	changing_color = false;
}

function attempt_ws()
{
	ws_connecting = true;

	ws = new_ws(get_appropriate_ws_url(""), "ws");
	try {
		ws.onopen = function() {
			ws_connected = true;
			ws_connecting = false;
			request_channels();
			setInterval(rq_queue_send, 1000);
			document.getElementById("message").textContent = '';
		};

		ws.onmessage = function got_packet(msg) {
			console.log("got_packet data='" + msg.data + "'");
			var words = msg.data.split(' ');
			if (words[0] == "DT1") {
				var addr = parseInt(words[1], 16);
				var data0 = parseInt(words[2], 16);
				var data1 = words.length > 3 ? parseInt(words[3], 16) : 0;
				console.log("got_packet DT1 addr=0x" + addr.toString(16));
				in_got_packet = true;
				for (var i = 0; i + 2 < words.length; i++) {
					var a = addr + i;
					mem[a] = parseInt(words[i + 2], 16);

					var ch = (a >> 16) & 0x7F;
					switch (a & 0xFFE0FFFF) {
						case 0x04000000:
						case 0x04000001:
						case 0x04000002:
						case 0x04000003:
						case 0x04000004:
						case 0x04000005: got_ch_name(ch); break;
						case 0x0400000E: got_ch_color(ch, mem[a]); break;
						case 0x04000014: got_ch_mute(ch, mem[a]); break;
						case 0x04000017: got_ch_fader(-1, ch, mem[a-1], mem[a]); break;
						case 0x0400001C: got_ch_send(-1, ch, mem[a]); break;
						case 0x06000000:
						case 0x06000001:
						case 0x06000002:
						case 0x06000003:
						case 0x06000004:
						case 0x06000005: got_aux_name(ch); break;
					}

					var chaux = (a >> 3) & 0x0F;
					switch(a & 0xFF00FF07) {
						case 0x04001200: got_ch_send(chaux, ch, mem[a]); break;
						case 0x04001203: got_ch_fader(chaux, ch, mem[a-1], mem[a]); break;
						case 0x04001300: got_ch_send(chaux + 8, ch, mem[a]); break;
						case 0x04001303: got_ch_fader(chaux + 8, ch, mem[a-1], mem[a]); break;
					}
				}
				in_got_packet = false;
			}
			rq_queue_send();
		};
	
		ws.onclose = function(){
			ws_connected = false;
			ws_connecting = false;
			document.getElementById("message").textContent = 'Disconnected.';
		};
	} catch(exception) {
		alert("<p>Error " + exception);  
	}
}

document.addEventListener("DOMContentLoaded", function() {
	attempt_ws();

	var tbody = document.getElementById("channel-holder");

	for (var ch = 0; ch < 32; ch++) {
		var tr = document.createElement("tr");
		var td, text, sel, opt;

		// number
		td = document.createElement("td");
		td.className = "channel-code";
		td.id = "channel_label_" + ch;
		text = document.createElement("span");
		text.textContent = "CH" + (ch+1);
		td.appendChild(text);
		tr.appendChild(td);

		// name
		td = document.createElement("td");
		td.className = "channel-label";
		text = document.createElement("input");
		text.id = "channel_name_" + ch;
		text.type = 'text';
		text.addEventListener('keypress', (e) => { var ch = e.target.id.substring(13); if (e.key==='Enter') on_submit_name(ch); });
		text.addEventListener('focusout', (e) => { var ch = e.target.id.substring(13); on_submit_name(ch); });
		td.appendChild(text);
		tr.appendChild(td);

		// color
		td = document.createElement("td");
		sel = document.createElement('select');
		var colors = ['dark blue', 'pure blue', 'brown', 'red', 'yellow', 'green', 'cyan', 'magenta'];
		for (var i = 0; i < 8; i++) {
			opt = document.createElement('option');
			opt.value = i;
			opt.textContent = colors[i];
			sel.appendChild(opt);
		}
		sel.id = 'channel_color_' + ch;
		sel.addEventListener('change', (e) => { var ch = e.target.id.substring(14); on_submit_color(ch); });
		td.appendChild(sel);
		tr.appendChild(td);

		tbody.appendChild(tr);
	}

}, false);

addEventListener("load", function() {
	window.scrollTo(0, 0);
}, false);
