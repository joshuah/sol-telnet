sol-telnet
==========

A server side TELNET stream implementation for node. This is intended for use creating a MUSH.

**Note:** This module is now intended to work with node 0.10.x. The events and how you use it have all changed.


## Installing

    npm install sol-telnet
    
## Usage

    var net = require('net')
    , TelnetServerProtocolStream = require('../index.js');

    //
    // Teset Server.
    //
    var net = require("net");
    var server = net.createServer(function(sock){
     
		  var ts = new TelnetServerProtocolStream();
  
      sock.pipe(ts).pipe(sock);
  
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
		
## Methods

### .send(string)
Escapes and sends your data out the piped socket. You should not write out the socket directly. 

    ts.send('Your corpse splatters on the wall.');
  
## Events

### lineReceived(line)
This event is emitted when a line of text is sent to the server from the client.

    ts.on('lineReceived', function(line) {
      // Parse the line here...
    })

### clientWindowChangedSize(width, height)
This event is emitted if the client supports NAWS and they resize their client. 

    ts.on('clientWindowChangedSize', function(width, height){
      // Window resized...
    })
    
### optionMCCP2Enabled
This event is emitted when the users client successfully enables the MCCP2 protocol. This protocol will gzip compress outgoing data sent from your server. Some game clients such as **tintin++** support this.

    ts.on('optionMCCP2Enabled', function(){
      // User is using compression. Give them a buff… :)
    })

### unhandledCommand(details)
This event is emitted when the server gets a request for an unhandled command.

### unknownSubNegotiation(options, bytes)
This event is emitted when the server gets a sub negotiation it does not know how to handle.
