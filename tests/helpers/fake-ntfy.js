/* A local stand-in for an ntfy server that records what it receives. */
'use strict';
const http = require('http');

function startFakeNtfy() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let json = null;
      try {
        json = JSON.parse(body);
      } catch (_) {
        /* not JSON */
      }
      received.push({ method: req.method, url: req.url, headers: req.headers, body, json });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end('{"id":"fake"}');
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        received,
        close: () => new Promise((r) => server.close(r)),
      })
    )
  );
}

module.exports = { startFakeNtfy };
