sol-telnet
==========

A server side TELNET stream implementation for node. This is intended for use creating a MUSH.

## Installing

    npm install sol-telnet
    
## Usage

    var net = require('net')
      , SolTelnet = require('sol-telnet');
      
    server = net.createServer(function(sock) {
      SolTelnet.TelnetStream(sock, function(ts) {
        // Greet the player.
        ts.sendLine("Welcome…");
        
        ts.on('lineReceived', function(line) {
          console.log('Command: ', line);
        })
        
        ts.on('MCCP2Activated', function() {
		  console.log('This user activated compression. MCCP2');
		})
		
		// The player resized their client.
		ts.on('windowSizeChange', function(width, height){})
		
		// The connection was closed.
		ts.on('end', function(){})
	  })
	})
	server.listen(3000);
	
## Methods

### .sendLine(string)
Appends a CR-LF to the end of your string and calls the **send** method for you.

    ts.sendLine('Your corpse splatters on the wall.');
    
### .send(string)
Sends a string out the stream. This will automatically escape any *IAC* characters and handle compressing the string if enabled.

    ts.send("You swing…");
    
## Events

### lineReceived(line)
This event is emitted when a line of text is sent to the server from the client.

    ts.on('lineReceived', function(line) {
      // Parse the line here...
    })

### windowSizeChange(width, height)
This event is emitted if the client supports NAWS and they resize their client. 

    ts.on('windowSizeChange', function(width, height){
      // Window resized...
    })
    
### MCCP2Activated
This event is emitted when the users client successfully enables the MCCP2 protocol. This protocol will gzip compress outgoing data sent from your server. Some game clients such as **tintin++** support this.

    ts.on('MCCP2Activated', function(){
      // User is using compression. Give them a buff… :)
    })

### unhandledCommand(details)
This event is emitted when the server gets a request for an unhandled command.

### unknownSubNegotiation(options, bytes)
This event is emitted when the server gets a sub negotiation it does not know how to handle.

### RFC854Error
This event is emitted when a client breaks RFC854. All CR characters must be followed by a NULL or a LF.
