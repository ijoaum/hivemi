import http from 'http';
import httpProxy from 'http-proxy';

const proxy = httpProxy.createProxyServer({});

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  
  // Root redirects to /dashboard
  if (url === '/') {
    res.writeHead(302, { Location: '/dashboard' });
    res.end();
    return;
  }
  
  // API routes -> Manager (port 4000)
  if (url.startsWith('/api/')) {
    proxy.web(req, res, { target: 'http://localhost:4000' });
    return;
  }
  
  // Health check
  if (url === '/health') {
    proxy.web(req, res, { target: 'http://localhost:4000' });
    return;
  }
  
  // Dashboard routes -> Next.js (port 3000)
  if (url.startsWith('/dashboard') || url.startsWith('/_next')) {
    proxy.web(req, res, { target: 'http://localhost:3000' });
    return;
  }
  
  // Default to Next.js
  proxy.web(req, res, { target: 'http://localhost:3000' });
});

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  
  if (url.startsWith('/api/')) {
    proxy.ws(req, socket, head, { target: 'http://localhost:4000' });
  } else {
    proxy.ws(req, socket, head, { target: 'http://localhost:3000' });
  }
});

proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err.message);
  if (res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  }
});

const PORT = 8080;
server.listen(PORT, () => {
  console.log(`🦞 Unified proxy running on http://localhost:${PORT}`);
  console.log('  / -> /dashboard');
  console.log('  /api/* -> localhost:4000');
  console.log('  /dashboard/* -> localhost:3000');
});
