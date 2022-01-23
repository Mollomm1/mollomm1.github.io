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
    return xmlHttp.responseText;
    }catch (NetworkError){
      return('')
    }
    
}

// VARIABLES //
  
  const text = "",
  const status_code = "500",
  
///////////////

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
        }
      ]
    };
  }
  
  GetHTTPS(args) {
    const url=args.ONE;
    return httpGet(url)
  }
  
  GetHTTPSproxied(args) {
    const url=args.ONE;
    const urlfix = url.replace('https://','https:/').replace('http://','http:/')
    return httpGet("https://turbowarphttps-proxy.mollomm1.repl.co/"+urlfix)
  }
}

// Call Scratch.extensions.register to register your extension
// Make sure to register each extension exactly once
Scratch.extensions.register(new MyExtension());
