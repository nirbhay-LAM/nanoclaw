/**
 * Gmail OAuth helper — opens browser for consent, saves refresh token.
 * Usage: node scripts/gmail-oauth.mjs <account-name>
 *   account-name: directory name under ~/.gmail-mcp/ (e.g., "personal", "lam")
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { google } from 'googleapis';
import open from 'open';

const accountName = process.argv[2];
if (!accountName) {
  console.error('Usage: node scripts/gmail-oauth.mjs <account-name>');
  console.error('  e.g., node scripts/gmail-oauth.mjs personal');
  process.exit(1);
}

const credDir = path.join(process.env.HOME, '.gmail-mcp', accountName);
const keysPath = path.join(credDir, 'gcp-oauth.keys.json');
const credsPath = path.join(credDir, 'credentials.json');

if (!fs.existsSync(keysPath)) {
  console.error(`No OAuth keys found at ${keysPath}`);
  console.error('Download the JSON from GCP Console first.');
  process.exit(1);
}

const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
const installed = keys.installed || keys.web;
if (!installed) {
  console.error('Invalid keys file — expected "installed" or "web" key.');
  process.exit(1);
}

// Start server first to get the actual port, then build the redirect URI
const server = http.createServer();
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const redirectUri = `http://localhost:${port}`;

const oauth2 = new google.auth.OAuth2(
  installed.client_id,
  installed.client_secret,
  redirectUri,
);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/gmail.send'],
});

console.log(`\nOpening browser for "${accountName}" OAuth consent...`);
console.log(`Listening on ${redirectUri}\n`);

server.on('request', async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('No authorization code received.');
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    fs.writeFileSync(credsPath, JSON.stringify(tokens, null, 2));
    console.log(`✓ Credentials saved to ${credsPath}`);
    console.log(`  Refresh token: ${tokens.refresh_token ? 'present' : 'MISSING'}`);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Authenticated!</h1><p>You can close this tab.</p>');
  } catch (err) {
    console.error('Failed to exchange code for tokens:', err.message);
    res.writeHead(500);
    res.end('Authentication failed.');
  }

  server.close();
  process.exit(0);
});

open(authUrl);

// Timeout after 5 minutes
setTimeout(() => {
  console.error('\nTimeout — no OAuth callback received after 5 minutes.');
  server.close();
  process.exit(1);
}, 300000);
