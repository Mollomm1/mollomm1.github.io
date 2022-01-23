// We use class syntax to define our extension object
// This isn't actually necessary, but it tends to look the best
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

class MyExtension {
  /**
   * Scratch will call this method *once* when the extension loads.
   * This method's job is to tell Scratch things like the extension's ID, name, and what blocks it supports.
   */
  getInfo() {
    return {
      // `id` is the internal ID of the extension
      // It should never change!
      // If you choose to make an actual extension, please change this to something else.
      // Only the characters a-z and 0-9 can be used. No spaces or special characters.
      id: 'https',

      // `name` is what the user sees in the toolbox
      // It can be changed without breaking projects.
      name: 'Mollomm1\'s HTTPS (legacy)',

      blocks: [
        {
          opcode: 'GetHTTPS',
          blockType: Scratch.BlockType.REPORTER,
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
          blockType: Scratch.BlockType.REPORTER,
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

  /**
   * Corresponds to `opcode: 'hello'` above
   */

  
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
