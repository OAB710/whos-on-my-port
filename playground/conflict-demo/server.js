// Tries to use port 3000 (same as shop-app) -> crashes with EADDRINUSE,
// which should trigger the "Kill & Retry" notification.
const http = require('http');
const PORT = 3000;
http.createServer((_, res) => res.end('<h1>conflict-demo :3000</h1>'))
  .listen(PORT, '127.0.0.1', () => console.log(`conflict-demo running at http://localhost:${PORT}`));
