var net = require('net')
  , SolTelnet = require('./index.js');
	
server = net.createServer(function(sock){
	SolTelnet.TelnetStream(sock, function(ts) {
		
		// Send a line of text to the user.
		ts.sendLine("Welcome to the game...");

	  // Called when a line of text is sent to the server.
		ts.on('lineReceived', function(data) {
			console.log('Got Line> ', data);
			ts.sendLine("ok>");
		})

		// Some clients send a funny telnet noop
		ts.on('noOperation', function(){ console.log('noOperation');})
		// Called when gzip compression is enabled.
	  ts.on('MCCP2Activated', function() {
			console.log('MCCP2Activated');
		})
		ts.on('unhandledCommand', function(data){ console.log('unhandledCommand', data);})
		ts.on('unknownSubNegotiation', function(option, bytes) {
			console.log('unknownSubNegotiation', option, bytes);
		})
		
		ts.on('windowSizeChange', function(width, height) {
			console.log('Window size is now: ', width, ',', height);
		})
		
		ts.on('end', function(){
			console.log('Session closed...');
		})
		
	});

})
server.listen(3000);
