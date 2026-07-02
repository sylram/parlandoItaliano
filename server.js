const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const chatHandler = require('./api/chat');
const flashcardsHandler = require('./api/flashcards');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const PORT = process.env.PORT || 5000;

const ENV_PATH = path.join(__dirname, '.env');
const KEY_FILE = path.join(__dirname, 'key.txt');

function cleanValue(value) {
  return value.replace(/^[\uFEFF\s]+|[\uFEFF\s]+$/g, '');
}

function loadLocalEnv() {
  // Load every KEY=VALUE from .env into process.env (without overriding
  // anything already set in the real environment).
  if (fs.existsSync(ENV_PATH)) {
    const envContents = fs.readFileSync(ENV_PATH, 'utf8');
    envContents.split(/\r?\n/).forEach((line) => {
      const trimmed = cleanValue(line);
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;

      const [key, ...rest] = trimmed.split('=');
      const normalizedKey = cleanValue(key).replace(/^export\s+/i, '');
      let value = cleanValue(rest.join('='));
      value = value.replace(/^["']|["']$/g, ''); // strip surrounding quotes

      if (normalizedKey && !(normalizedKey in process.env)) {
        process.env[normalizedKey] = value;
      }
    });
  }

  // key.txt is a convenience fallback just for the Anthropic key.
  if (!process.env.ANTHROPIC_API_KEY && fs.existsSync(KEY_FILE)) {
    const fileValue = cleanValue(fs.readFileSync(KEY_FILE, 'utf8'));
    if (fileValue) process.env.ANTHROPIC_API_KEY = fileValue;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Anthropic API key loaded.');
  } else {
    console.warn('No Anthropic API key found. Check .env or key.txt in the project root.');
  }
  console.log(process.env.SUPABASE_URL ? 'Supabase configured.' : 'Supabase not configured — using local JSON fallback.');
}

loadLocalEnv();

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// The handlers in api/*.js are written for Vercel (@vercel/node), which adds
// res.status() and res.json() to the response. The raw Node response has
// neither, so we shim them here before dispatching.
function enhanceResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(data));
    return res;
  };
}

async function parseRequestBody(req) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
    return null;
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch (err) {
    return null;
  }
}

async function serveStaticFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.normalize(filePath);

  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const stat = await fs.promises.stat(fullPath);
    if (stat.isDirectory()) {
      res.writeHead(301, { Location: '/index.html' });
      res.end();
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': getMimeType(fullPath) });
    fs.createReadStream(fullPath).pipe(res);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/chat') || req.url.startsWith('/api/flashcards')) {
    enhanceResponse(res);
    req.body = await parseRequestBody(req);

    try {
      if (req.url.startsWith('/api/chat')) {
        return await chatHandler(req, res);
      }
      return await flashcardsHandler(req, res);
    } catch (err) {
      console.error('API handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
      return;
    }
  }

  serveStaticFile(req, res);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Use Ctrl+C to stop it.');
});
