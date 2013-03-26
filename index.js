/*
 * sol-telnet
 * A telnet server stream module for MUSH/MUD.
 */

var zlib = require('zlib');
var Duplex = require('stream').Duplex;

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

function TelnetServerProtocolStream(options) {
  if (!(this instanceof TelnetServerProtocolStream))
    return new TelnetServerProtocolStream(options);
  
  Duplex.call(this, options);
  
  this._telnet = {
    state: 'data',     // Track the state of our parser.
    last_byte: '',     // Used for detecting broken clients.
    parsed_bytes: [],  // Hold bytes that have been processed.
    command: '',       // Holds the cur negotiation type WILL|WONT|DO|DONT
    commands: [],      // Holds telnet options and negotiations that are being processed.
    negotiated: {      // Holds the state of negotiated telnet options.
      86: false, // mccp2
      31: false  // naws
    },
    client: {width: -1, height: -1},
    mccp2_deflate: null // zlib stream for the MCCP2 protocol.
  }

}

TelnetServerProtocolStream.prototype = Object.create(
  Duplex.prototype, { constructor: { value: TelnetServerProtocolStream }});

TelnetServerProtocolStream.prototype._sendToConsumer = function(data) {
  // Send data to our consumer. Data requiring IAC escapes should be
  // sent using the .send(data) command which calls this.
  
  // Make sure that data is a buffer.
  if(!Buffer.isBuffer(data)) {
    data = new Buffer(data);
  }
  
  /* When MCCP2 is enabled write the data using self.mccp2_deflate.write(data).
   * when we are not using MCCP2 write the data directly out the socket. */
  if(this._telnet.mccp2_deflate) {
     this._telnet.mccp2_deflate.write(data);
     this._telnet.mccp2_deflate.flush();
  } else {
    this._destination.write(data);
  }
  
}

TelnetServerProtocolStream.prototype.send = function(data) {
  // Send data to the consumer and properly escape IAC characters in the data.
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
  this._sendToConsumer(data);
}

TelnetServerProtocolStream.prototype.sendCommand = function(command, bytes) {
  //
  // Send a telnet command to the consumer.
  //
  var out_bytes = [IAC, command];
  if(bytes instanceof Array) {
    out_bytes.push.apply(out_bytes, bytes);
  } else {
    out_bytes.push(bytes);
  }
  this._sendToConsumer(out_bytes);
  out_bytes = [];  
}


TelnetServerProtocolStream.prototype._handleCommand = function(command, option) {
  // Todo: Pass these commands to our negotiation map. 
  switch(command) {
    case WILL:
      switch(option) {
        case OPT_NAWS:
          if(this._telnet.negotiated[OPT_NAWS] === false) {
            this._telnet.negotiated[OPT_NAWS] = true;
            this.sendCommand(DO, OPT_NAWS);
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
          this._telnet.negotiated[OPT_COMPRESS2] = true;
          this.sendCommand(SB, [OPT_COMPRESS2, IAC, SE]);
          this._telnet.mccp2_deflate = zlib.createDeflate({'level': 9});
          this._telnet.mccp2_deflate.pipe(this._destination);
          this.emit('optionMCCP2Enabled');
          break;
      }
      break;
    case DONT:
      break;
    default:
      // Commands that are not handled by this telnet object are passed as events.
      this.emit('unhandledCommand', {'command':command, 'option':option});
  }
}


TelnetServerProtocolStream.prototype._handleSubNegotiation = function(option, bytes) {
  // This function is called by the Telnet parser when a subnegotiation is sent from the client.
  switch(option) {
    case OPT_NAWS:
       // Handle the NAWS sub-negotiation if the client negotiated the option. 
       if(this._telnet.negotiated[OPT_NAWS] === true) {
         bytes = new Buffer(bytes); // Convert bytes into a Buffer object.
         // Get the width and height of the remote window by fetching the two 16bit integers from the buffer.
         var width = bytes.readInt16BE(0);
         var height = bytes.readInt16BE(2);
         // Todo: Only emit an event if size changed.
         this.emit('clientWindowChangedSize', width, height);
         this._telnet.client.width = width;
         this._telnet.client.height = height;
       } 
       break;
    default:
      this.emit('unknownSubNegotiation', option, bytes);
  }
}


TelnetServerProtocolStream.prototype._read = function(size) {}

TelnetServerProtocolStream.prototype.pipe = function(destination, options) {
  // We need to save this in a useful location incase the client enables the MCCP2 protocol
  // which has a gzip stream for the outgoing data.
  this._destination = destination;
  
  // This might be a useful location for starting up our telnet negotiations.
  this.sendCommand(DO, OPT_NAWS);
  this.sendCommand(WILL, OPT_COMPRESS2);

}

TelnetServerProtocolStream.prototype._write = function(chunk, encoding, callback) {
  
  	// This function parses incoming bytes from the client and detects commands, negotiations and text.
  var cur_byte; // I hold the current byte that is being processed.

  for(var pos=0; pos < chunk.length; pos++) {

    cur_byte = chunk[pos];

    switch(this._telnet.state) {
      case 'data':
        if(cur_byte == IAC) {
          this._telnet.state = 'data-escape';
        } else if(cur_byte === CR) {
          this._telnet.state = 'newline';
        } else if(cur_byte === LF) {
          // Some clients are only sending a LF for newlines.
          
          var out_data = new Buffer(this._telnet.parsed_bytes).toString();
          this._telnet.parsed_bytes = [];
          this.emit('lineReceived', out_data);
        } else {
          this._telnet.parsed_bytes.push(cur_byte);
        }
        break;

      case 'newline':
        this._telnet.state = 'data';
        switch(cur_byte) {
          case NULL:
            /* A CR NULL indicates that the client wanted to send just a CR.
             * For now I will treat a CR NULL like the client intended a CR LF. */
          case LF:
            /* The sequence "CR LF" was sent from the client. The cursor should be positioned at
             * the left margin of the next print line. RFC 854. Track the cursor position? */
           
            // Emit a lineReceived event sending all of the previously parsed bytes.
            var out_data = new Buffer(this._telnet.parsed_bytes).toString();
            this._telnet.parsed_bytes = []; // Erase the parsed bytes.
            this.emit('lineReceived', out_data); 
            break;

          default:
            /* The connected client may be breaking RFC 854. A CR must be followed by a LF or a NULL.*/
						//this.emit('RFC854Error', "The remote client is breaking RFC 854.");
            break;

        }
        break;

      case 'data-escape':
        // Bytes that follow the IAC character.
        switch(cur_byte) {
          case IAC:
            this._telnet.parsed_bytes.push(cur_byte); // The client sent an escaped IAC
            break;

          // Some clients transmit IAC NOP as a keep-alive.
          case NOP:
            this._telnet.state = 'data';
            this.emit('noOperation'); // Alert the server that a keep-alive was sent.
            break;

          // Option negotiations.
          case WILL:
          case WONT:
          case DO:
          case DONT:
            this._telnet.state = 'option-negotiation';
            this._telnet.command = cur_byte;
            break;
          
          case SB:
            // The client is starting a sub-negotiation.
            this._telnet.state = 'sub-negotiation-option';
            this._telnet.commands = [];
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
            this._telnet.state = 'data';
            break;

          default:
            // Anything we might not expect...
						this._telnet.state = 'data';  
        }
        break;
      case 'option-negotiation':
        // Todo: Check for IAC as the option and handle RFC861 here?
        // IAC [WILL|WONT|DO|DONT] OPTION
        this._telnet.state = 'data';
        var out_command = this._telnet.command;
        this._telnet.command = '';
        this._handleCommand(out_command, cur_byte);
        break;

      case 'sub-negotiation-option':
        // The cur_byte should be our telnet option.
        this._telnet.state = 'sub-negotiation';
        this._telnet.command = cur_byte;
        break;

      case 'sub-negotiation':
        switch(cur_byte) {
           case IAC:
             this._telnet.state = 'sub-negotiation-escape';
             this._telnet.last_byte = cur_byte;
             break;
           default:
             this._telnet.commands.push(cur_byte);
        }
        break;

      case 'sub-negotiation-escape':
        switch (cur_byte) {
          case IAC:
            // The client properly escaped their IAC in the sub-negotiation.
            this._telnet.state = 'sub-negotiation';
            this._telnet.commands.push(cur_byte);
            break;

          case SE:
            // We should be done with the sub-negotiation now.
            this._telnet.state = 'data';
            var out_option = this._telnet.command;
            var out_bytes = this._telnet.commands;
						this._telnet.command = '';
            this._telnet.commands = [];
            this._handleSubNegotiation(out_option, out_bytes);
            break;

          default:
            if(this._telnet.last_byte === IAC) {
              // Detect if the telnet client did not properly escape their IAC character inside the sub-negotiation.
              this._telnet.last_byte = '';
              this._telnet.commands.push(IAC);  // Append the missing data-byte 255 to the commands list. 
            }
            this._telnet.state = 'sub-negotiation';
            this._telnet.commands.push(cur_byte);
        }
        break;
    }
  }
  callback();
}

module.exports = TelnetServerProtocolStream;

