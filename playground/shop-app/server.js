// Port 3000, localhost only. Handles Ctrl+C gracefully (to test "graceful stop").
const http = require('http');
const PORT = 3000;
const server = http.createServer((_, res) => res.end('<h1>shop-app :3000</h1>'));
server.listen(PORT, '127.0.0.1', () => console.log(`shop-app running at http://localhost:${PORT}`));
process.on('SIGINT', () => {
  console.log('shop-app: received Ctrl+C, closing gracefully...');
  server.close(() => process.exit(0));
});
