var events = require('events'),
    util = require('util'),
    zlib = require('zlib');

// Basic telnet commands.
var IAC  = 255; // Marks the start of a negotiation sequence or data byte 255.
var WILL = 251; // Confirm willingness to negotiate.
var WONT = 252; // Confirm unwillingness to negotiate.
var DO   = 253; // Indicate willingness to negotiate.
var DONT = 254; // Indicate unwillingness to negotiate.
var NOP  = 241; // No operation.
var SB   = 250; // The start of sub-negotiation options.
var SE   = 240; // The end of sub-negotiation options.

// Other telnet commands.
var DM  = 242; // The data stream portion of a Synch.
var BRK = 243; // Break
var IP  = 244; // Interrupt Process
var AO  = 245; // Abort output
var AYT = 246; // Are You There?
var EC  = 247; // Erase character
var EL  = 248; // Erase line
var GA  = 249; // Go ahead

// Telnet newline characters.
var CR = 13; // Moves the NVT printer to the left marginof the current line.
var LF = 10; // Moves the NVT printer to the next print line, keeping the same horizontal position.
var NULL = 0; // Used to indicate that just a CR character was requested from the client.  

// Telnet Options http://www.iana.org/assignments/telnet-options
var OPT_ECHO = 1;  // Echo RFC 857
var OPT_SGA  = 3;  // Suppress Go Ahead RFC 858 
var OPT_TT   = 24; // Terminal Type RFC 1091
var OPT_NAWS = 31; // Negotiate About Window Size RFC 1073
var OPT_TS   = 32; // Terminal Speed RFC 1079
var OPT_NEO  = 39; // New Environment Option RFC 1572
var OPT_EXOPL = 255; // Extended-Options-List RFC 861

// MUD related telnet options
var OPT_COMPRESS2 = 86; // Used for the MCCP2 protocol.

function TelnetStream() {
	events.EventEmitter.call(this);
	this.__defineGetter__('readable', function() {
    return this.stream.readable;
  });
  this.__defineGetter__('writable', function() {
    return this.stream.writable;
  });
	var self = this;
	// Define our vars here...
  self.state_ = 'data'; // I track the state of the telnet protocol.
  self.last_byte_ = ''; // I help detect broken telnet clients.
  self.parsed_bytes = []; // I hold the bytes that have been processed.
  self.command_ = ''; // Holds the cur negotiation type WILL|WONT|DO|DONT
  self.commands_ = []; // Holds telnet options and negotiations that are being processed. 
	
	// Telnet / Mud Options
  self.naws_ = false;
}
util.inherits(TelnetStream, events.EventEmitter);

TelnetStream.prototype.end = function (string, encoding) {
  this.stream.end(string, encoding);
};

TelnetStream.prototype.setEncoding = function (encoding) {
  this.stream.setEncoding(encoding);
};

TelnetStream.prototype.pause = function () {
  this.stream.pause();
};
TelnetStream.prototype.resume = function () {
  this.stream.resume();
};
TelnetStream.prototype.destroy = function () {
  this.stream.destroy();
};
TelnetStream.prototype.destroySoon = function () {
  this.stream.destroySoon();
};
TelnetStream.prototype.pipe = function (destination, options) {
  util.pump(this, destination);
  return destination;
};

// Write data out the socket.
TelnetStream.prototype.write_ = function(data) {
  var self = this;
  // If data is not a buffer convert it before the write.
  if(!Buffer.isBuffer(data)) {
    data = new Buffer(data);
  }

  /* When MCCP2 is enabled write the data using self.mccp2_deflate.write(data).
   * when we are not using MCCP2 write the data directly out the socket. */
  if(self.mccp2_deflate) {
     self.mccp2_deflate.write(data);
     self.mccp2_deflate.flush();
  } else {
     self.stream.write(data);
  }
  
}

TelnetStream.prototype.send = function(data) {
  // This function will send data and escape any IAC characters.
  var self = this;
  if(!Buffer.isBuffer(data)) {
    data = new Buffer(data);
  }
  var out_buffer = [];
  for(var i = 0; i < data.length; i++) {
    if(data[i] == IAC) {
      out_buffer.push(IAC);
    }
    out_buffer.push(data[i]);
  }
  
  data = out_buffer;
  out_buffer = null;
  self.write_(data);
}

TelnetStream.prototype.sendLine = function(line) {
  // Sends a line of text followed by a newline.
  line += "\r\n";
  var self = this;
  self.send(line);
}

// Send a telnet command.
TelnetStream.prototype.sendCommand = function(command, bytes) {
  var self = this;
  var out_bytes = [IAC, command];
  if(bytes instanceof Array) {
    out_bytes.push.apply(out_bytes, bytes);
  } else {
    out_bytes.push(bytes);
  }
  self.write_(out_bytes);
  out_bytes = [];  
}

TelnetStream.prototype.handleCommand = function(command, option) {
  // This function is called by the Telnet parser when a command is detected.
  var self = this;
  // Todo: Pass these commands to our negotiation map. 
  switch(command) {
    case WILL:
      switch(option) {
        case OPT_NAWS:
          if(self.naws_ == false) {
            self.naws_ = true;
            self.sendCommand(DO, OPT_NAWS);
          } 
          break;
      }
      break;
    case WONT:
      break;
    case DO:
      switch(option) {
        case OPT_COMPRESS2:
          /* Activate MCCP2: 
           * 1. Inform the client that we will now start compressing the output of this socket.
           * 2. Create a new zlib object and pipe it to our socket object. */
          self.sendCommand(SB, [OPT_COMPRESS2, IAC, SE]);
          self.mccp2_deflate = zlib.createDeflate({'level': 9});
          self.mccp2_deflate.pipe(self.stream);
          self.emit('MCCP2Activated');
          break;
      }
      break;
    case DONT:
      break;
    default:
      // Commands that are not handled by this telnet object are passed as events.
      self.emit('unhandledCommand', {'command':command, 'option':option});
  }

}

TelnetStream.prototype.handleSubNegotiation = function(option, bytes) {
  // This function is called by the Telnet parser when a subnegotiation is sent from the client.
  var self = this;
  switch(option) {
    case OPT_NAWS: 
       // Handle the NAWS sub-negotiation if the client negotiated the option. 
       if(self.naws_ == true) {
         bytes = new Buffer(bytes); // Convert bytes into a Buffer object.
         // Get the width and height of the remote window by fetching the two 16bit integers from the buffer.
         var width = bytes.readInt16BE(0);
         var height = bytes.readInt16BE(2);
         self.emit('windowSizeChange', width, height);
       } 
       break;
    default:
      self.emit('unknownSubNegotiation', option, bytes);
  }
}

TelnetStream.prototype.parseData = function(data, encoding) {	
	// This function parses incoming bytes from the client and detects commands, negotiations and text.
  var self = this;
  var cur_byte; // I hold the current byte that is being processed.

  for(var pos=0; pos < data.length; pos++) {

    cur_byte = data[pos];

    switch(self.state_) {
      case 'data':
        if(cur_byte == IAC) {
          self.state_ = 'data-escape';
        } else if(cur_byte == CR) {
          self.state_ = 'newline';
        } else if(cur_byte == LF) {
          // Some clients are only sending a LF for newlines.
          var out_data = new Buffer(self.parsed_bytes).toString();
          self.parsed_bytes = [];
          self.emit('lineReceived', out_data);
        } else {
          self.parsed_bytes.push(cur_byte);
        }
        break;

      case 'newline':
        self.state_ = 'data';
        switch(cur_byte) {
          case NULL:
            /* A CR NULL indicates that the client wanted to send just a CR.
             * For now I will treat a CR NULL like the client intended a CR LF. */
          case LF:
            /* The sequence "CR LF" was sent from the client. The cursor should be positioned at
             * the left margin of the next print line. RFC 854. Track the cursor position? */
           
            // Emit a lineReceived event sending all of the previously parsed bytes.
            var out_data = new Buffer(self.parsed_bytes).toString();
            self.parsed_bytes = []; // Erase the parsed bytes.
            self.emit('lineReceived', out_data); 
            break;

          default:
            /* The connected client may be breaking RFC 854. A CR must be followed by a LF or a NULL.*/
						self.emit('RFC854Error', "The remote client is breaking RFC 854.");
            break;

        }
        break;

      case 'data-escape':
        // Bytes that follow the IAC character.
        switch(cur_byte) {
          case IAC:
            self.parsed_bytes.push(cur_byte); // The client sent an escaped IAC
            break;

          // Some clients transmit IAC NOP as a keep-alive.
          case NOP:
            self.state_ = 'data';
            self.emit('noOperation'); // Alert the server that a keep-alive was sent.
            break;

          // Option negotiations.
          case WILL:
          case WONT:
          case DO:
          case DONT:
            self.state_ = 'option-negotiation';
            self.command_ = cur_byte;
            break;
          
          case SB:
            // The client is starting a sub-negotiation.
            self.state_ = 'sub-negotiation-option';
            self.commands_ = [];
            break;

          // Unhandled telnet commands.
          case DM:
          case BRK:
          case IP:
          case AO:
          case AYT:
          case EC:
          case EL:
          case GA:
            self.state_ = 'data';
            break;

          default:
            // Anything we might not expect...
						self.state_ = 'data';  
        }
        break;
      case 'option-negotiation':
        // Todo: Check for IAC as the option and handle RFC861 here?
        // IAC [WILL|WONT|DO|DONT] OPTION
        self.state_ = 'data';
        var out_command = self.command_;
        self.command_ = '';
        self.handleCommand(out_command, cur_byte);
        break;

      case 'sub-negotiation-option':
        // The cur_byte should be our telnet option.
        self.state_ = 'sub-negotiation';
        self.command_ = cur_byte;
        break;

      case 'sub-negotiation':
        switch(cur_byte) {
           case IAC:
             self.state_ = 'sub-negotiation-escape';
             self.last_byte_ = cur_byte;
             break;
           default:
             self.commands_.push(cur_byte);
        }
        break;

      case 'sub-negotiation-escape':
        switch (cur_byte) {
          case IAC:
            // The client properly escaped their IAC in the sub-negotiation.
            self.state_ = 'sub-negotiation';
            self.commands_.push(cur_byte);
            break;

          case SE:
            // We should be done with the sub-negotiation now.
            self.state_ = 'data';
            var out_option = self.command_;
            var out_bytes = self.commands_;
						self.command_ = '';
            self.commands_ = [];
            self.handleSubNegotiation(out_option, out_bytes);
            break;

          default:
            if(self.last_byte_ == IAC) {
              // Detect if the telnet client did not properly escape their IAC character inside the sub-negotiation.
              self.last_byte_ = '';
              self.commands_.push(IAC);  // Append the missing data-byte 255 to the commands list. 
            }
            self.state_ = 'sub-negotiation';
            self.commands_.push(cur_byte);
        }
        break;

    }

  }
	
	
}

TelnetStream.prototype.attachStream = function(sock, callback) {
	var self = this;
	this.stream = sock;
	this.stream.on('data', function(data, encoding) {
		self.parseData(data, encoding);
	});
	
	// Pass socket events back to the server.
  self.stream.on('end', function() { self.emit('end'); });
  self.stream.on('error', function(exception) { self.emit('error', exception); });
	callback();
}

function TelnetStreamHelper(sock, callback) {
	var ts = new TelnetStream();
	ts.attachStream(sock, function(){
		// For now I will pass telnet negotiation here.
    // Negotiate NAWS / RFC 1073
    ts.sendCommand(DO, OPT_NAWS); 

    // Negotiate MCCP2 (Mud Client Compression Protocol version 2)
    ts.sendCommand(WILL, OPT_COMPRESS2);
		callback(ts);
	});
}

exports.TelnetStream = TelnetStreamHelper;

