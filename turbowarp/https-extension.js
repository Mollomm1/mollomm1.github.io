function sleep(milliseconds) {
  const date = Date.now();
  let currentDate = null;
  do {
      currentDate = Date.now();
  } while (currentDate - date < milliseconds);
}

function httpGet(theUrl)
{
    try{
      var xmlHttp = new XMLHttpRequest();
    xmlHttp.open( "GET", ""+theUrl, false ); // false for synchronous request
    xmlHttp.send( null );
    return xmlHttp;
    }catch (NetworkError){
      return('')
    }
    
}

// VARIABLES
var _text = "";
var _status_code = "500";


class MyExtension {
  
  getInfo() {
    return {
      id: 'httpsv2',

      name: 'Mollomm1\'s HTTPS (V2.0 WIP)',

      blocks: [
        {
          opcode: 'GetHTTPS',
          blockType: Scratch.BlockType.COMMAND,
          text: 'Request Get (not proxied) [ONE]',
          arguments: {
            ONE: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'https://turbowarp.org/'
            }
          }
        },
        {
          opcode: 'GetHTTPSproxied',
          blockType: Scratch.BlockType.COMMAND,
          text: 'Request Get (Proxied) [ONE]',
          arguments: {
            ONE: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'https://turbowarp.org/proxied'
            }
          }
        },
        {
          opcode: 'textrecived',
          blockType: Scratch.BlockType.REPORTER,
          text: 'Text Recived'
        },
        {
          opcode: 'statusrecived',
          blockType: Scratch.BlockType.REPORTER,
          text: 'Status Code Recived'
        },
        {
          opcode: 'jsondecode',
          blockType: Scratch.BlockType.REPORTER,
          text: '{JSON} Decode in the string [ONE] : [TWO]',
          arguments: {
            ONE: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: '{text: "Hello World !"}'
            },
            TWO: {
              type: Scratch.ArgumentType.STRING,
              defaultValue: 'text'
            }
          }
        }
      ]
    };
  }
  
  GetHTTPS(args) {
    const url=args.ONE;
    const recived = httpGet(url);
    
    _status_code = recived.status;
    _text = recived.responseText;
    return ''
  }
  
  GetHTTPSproxied(args) {
    
    const url=args.ONE;
    const urlfix = url.replace('https://','https:/').replace('http://','http:/')
    
    const recived = httpGet("https://turbowarphttps-proxy.mollomm1.repl.co/v2/"+urlfix)
    _status_code = recived.status;
    _text = recived.responseText;
    return ""
  }
  
  textrecived() {
    return _text
  }
  
  statusrecived() {
    return _status_code
  }
  
  jsondecode(args) {
    
    return('')
  }
}

// Call Scratch.extensions.register to register your extension
// Make sure to register each extension exactly once
Scratch.extensions.register(new MyExtension());
