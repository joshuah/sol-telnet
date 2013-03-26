var net = require('net')
  , TelnetServerProtocolStream = require('../index.js');

//
// Teset Server.
//

var net = require("net");
var server = net.createServer(function(sock){
  var ts = new TelnetServerProtocolStream();
  
  sock.pipe(ts).pipe(sock)
  
	// Every time you get a NULL LF you get a line. 
  ts.on('lineReceived', function(line){
    console.log(line);
    this.send("Ok there.." + line + "\n")
  })
  
	// Resize your telnet window and this should change.
  ts.on('clientWindowChangedSize', function(width, height) {
    console.log("NAWS:", width, height);
  })
	
	// Something odd...
	ts.on("unhandledCommand", function(data) {
	  console.log(data);
	})
  
})
server.listen(3000);

