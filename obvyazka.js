var nodeServer = require('net').Server,
	Buffer = require('buffer').Buffer;

var logPrefix = 'obvyazka: ';
function log(s){
	console.log(logPrefix + s);
}

var HEADER_LENGTH = 3;
var MAX_MSG_LEN = 65500;

//connectionHanler вызывается на on('connection')
function Server(connectionHandler)
{
	var s = new nodeServer();

	this.listen = function(port,host)
	{
		s.listen(port,host);
	};

	s.on('listening',function()
	{
		log("Listening on " + s.address().address + ":" + s.address().port);
	});

	s.on('close',function()
	{
		log("close");
	});

	s.on('error',function(e)
	{
		log("error " + e.code);
	});

	var crossdomainPrefix = '<?xml version="1.0" encoding="UTF-8"?>' +
		'<!DOCTYPE cross-domain-policy SYSTEM "/xml/dtds/cross-domain-policy.dtd">' +
		'<cross-domain-policy>';
	var crossdomainDomains = [];
	var crossdomainSuffix = '</cross-domain-policy>';

	this.allowAccessFrom = function(domain)
	{
		crossdomainDomains.push(domain);
	};

	function getCrossdomainString()
	{
		var res = crossdomainPrefix;
		if (crossdomainDomains == [])
		{
			res += '<allow-access-from domain="*" to-ports="' + s.address().port + '"/>';
		}
		else
		{
			for (var ind in crossdomainDomains){
				res += '<allow-access-from domain="'+crossdomainDomains[ind]+'" to-ports="' + s.address().port + '"/>';
			}
		}
		res+=crossdomainSuffix;
		return res;
	}

	s.on('connection',function(c)
	{
		c.bufferSize = 0;
		c.setNoDelay();

		c.on('data',firstRequestListener);
		c.on('close',function(){log("CLOSE");});
		c.on('error',function(exc){
			console.log("ignoring exception: " + exc);
		});

		function firstRequestListener(dataReceived){
			var stringReceived = dataReceived.toString();
			if(/policy-file-request/.test( stringReceived )){
				c.end(getCrossdomainString());
				return;
			}

			c.sendU = function(type,str)
			{
				var buf = new Buffer(type + str, 'utf8');
				sendMessage(c,'U',buf.length,buf);
			};
			c.sendR = function(type,buf)
			{
				var sendBuf = new Buffer(type, 'utf8');
				sendBuf = Buffer.concat([sendBuf,buf],sendBuf.length+buf.length);
				sendMessage(c,'R',sendBuf.length,sendBuf);
			};
			c.sendJ = function(type,obj)
			{
				var sendObj = {};
				sendObj[type]=obj;
				var str = JSON.stringify(sendObj);
				var buf = new Buffer(str,'utf8');
				sendMessage(c,'J',buf.length,buf);
			};

			connectionHandler(c);

			mainSocketListener(dataReceived);

			c.removeListener( 'data', firstRequestListener );
			c.on( 'data', mainSocketListener );
		}

		function sendMessage(c,pre,len,msg)
		{
			if (len === 0 || msg.length === 0)
				return;
				
			if (len > MAX_MSG_LEN) {
				log("msg is too big");
				return;
			}

			var lenBuffer = new Buffer(2);
			lenBuffer.writeUInt16LE(len,0);
			
			c.write( pre );
			c.write( lenBuffer );
			c.write( msg );
		}

		var receiveBuffer = new Buffer("");

		function mainSocketListener(dataReceived)
		{
			var data;
			if (typeof dataReceived == "string")
			{
				data = new Buffer(dataReceived,'utf8');
			}
			else
			{
				data = dataReceived;
			}

			receiveBuffer = Buffer.concat([receiveBuffer,data],receiveBuffer.length+data.length);

			try
			{
				translateMessageCycle();
			}
			catch(err)
			{
				console.log("OBVYAZKA FATAL ERROR! \n" + err.stack() );
			}
		}

		function translateMessageCycle()
		{
			var format = "";
			var length = 0;
			var message = new Buffer("");
			while (receiveBuffer.length > HEADER_LENGTH)
			{
				format = receiveBuffer.toString('utf8',0,1);
				if (! isCorrectFormat(format)){
					c.end();
					return;
				}

				length = receiveBuffer.readUInt16LE(1);
				if (length > MAX_MSG_LEN){
					c.end();
					return;
				}

				if (length <= receiveBuffer.length-3){
					receiveBuffer = receiveBuffer.slice(3);
					message = receiveBuffer.slice(0,length);
					receiveBuffer = receiveBuffer.slice(length);

					translateMessage(format,message);
					message = new Buffer("");
					length = 0;
				}
				else
				{
					return;
				}
			}
		}

		function isCorrectFormat(format){
			return (["U","R","J"].indexOf(format) !== -1);
		}

		function translateMessage(f,m)
		{
			var type = "";
			var str = "";
			var obj;
			switch (f){
			case "U":
				str = m.toString('utf8');
				type = str.substr(0,2);
				obj = str.substr(2);
				break;
			case "R":
				type = m.toString('utf8',0,2);
				obj = m.slice(2);
				break;
			case "J":
				str = m.toString('utf8');
				var parsedObj = JSON.parse(str);
				for (var k in parsedObj){
					type = k;
					obj = parsedObj[k];
				}
				break;
			default:
				log("unknown message format");
				log("Connection should be dead already");
				return;
			}
			c.emit(type,obj);
			
		}
	});
}

exports.Server = Server;