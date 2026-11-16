// Port 5173 bound to 0.0.0.0 -> shows the "⚠ LAN" marker.
const http = require('http');
const PORT = 5173;
http.createServer((_, res) => res.end('<h1>landing-page :5173</h1>'))
  .listen(PORT, '0.0.0.0', () => console.log(`landing-page running at http://localhost:${PORT} (exposed to LAN)`));
