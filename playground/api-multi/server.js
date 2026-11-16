// One process listening on two ports (4000 + 4001) -> two rows, same PID.
const http = require('http');
for (const port of [4000, 4001]) {
  http.createServer((_, res) => res.end(`<h1>api-multi :${port}</h1>`))
    .listen(port, '127.0.0.1', () => console.log(`api-multi listening on http://localhost:${port}`));
}
