// Node-based smoke test for WimpyAI image generation
// Usage: node scripts/smoke-image-test-node.js "A whimsical castle made of clouds"
// Requires dev server running at http://localhost:3000 and OPENROUTER_API_KEY set in environment

const http = require('http');
const url = require('url');

const API_HOST = process.env.API_HOST || 'http://localhost:3000';
const PROMPT = process.argv[2] || 'A whimsical castle made of clouds';

async function run() {
  const payload = JSON.stringify({ prompt: PROMPT, persona: 'Creative' });
  const u = new URL('/api/chat', API_HOST);

  const req = http.request(
    u,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        process.stdout.write(chunk);
      });
      res.on('end', () => {
        console.log('\n-- stream ended');
      });
    }
  );

  req.on('error', (err) => {
    console.error('Request error', err);
  });

  req.write(payload);
  req.end();
}

run();
