#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const PORT = 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json']);

function sendResponse(req, res, filePath, data) {
  const ext = path.extname(filePath);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };

  if (ext === '.json') {
    headers['Cache-Control'] = 'public, max-age=300';
  } else if (COMPRESSIBLE.has(ext)) {
    headers['Cache-Control'] = 'public, max-age=3600';
  }

  const acceptGzip = (req.headers['accept-encoding'] || '').includes('gzip');
  if (COMPRESSIBLE.has(ext) && acceptGzip && data.length > 1024) {
    zlib.gzip(data, function (err, compressed) {
      if (err) {
        res.writeHead(200, headers);
        res.end(data);
        return;
      }
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      res.writeHead(200, headers);
      res.end(compressed);
    });
    return;
  }

  res.writeHead(200, headers);
  res.end(data);
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    sendResponse(req, res, filePath, data);
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
