/**
 * GBP OAuth helper — extends existing Gmail OAuth with business.manage scope.
 * Reuses the same GCP project keys from ~/.gmail-mcp/lam/.
 * Usage: node scripts/gbp-oauth.mjs
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { google } from 'googleapis';
import open from 'open';

const accountName = 'lam';
const credDir = path.join(process.env.HOME, '.gmail-mcp', accountName);
const keysPath = path.join(credDir, 'gcp-oauth.keys.json');
const credsPath = path.join(credDir, 'credentials.json');

if (!fs.existsSync(keysPath)) {
  console.error(`No OAuth keys found at ${keysPath}`);
  console.error('Expected existing GCP OAuth keys from email setup.');
  process.exit(1);
}

const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
const installed = keys.installed || keys.web;
if (!installed) {
  console.error('Invalid keys file — expected "installed" or "web" key.');
  process.exit(1);
}

const server = http.createServer();
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const redirectUri = `http://localhost:${port}`;

const oauth2 = new google.auth.OAuth2(
  installed.client_id,
  installed.client_secret,
  redirectUri,
);

// All scopes: existing email/drive + new business.manage
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/business.manage',
  ],
});

console.log(`\nOpening browser for GBP OAuth consent (${accountName} account)...`);
console.log(`This will re-authorize with all existing scopes plus business.manage.`);
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
    console.log(`\nCredentials saved to ${credsPath}`);
    console.log(`  Refresh token: ${tokens.refresh_token ? 'present' : 'MISSING'}`);
    console.log(`  Scopes: ${tokens.scope || 'not reported'}`);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>GBP Authenticated!</h1><p>business.manage scope added. You can close this tab.</p>');
  } catch (err) {
    console.error('Failed to exchange code for tokens:', err.message);
    res.writeHead(500);
    res.end('Authentication failed.');
  }

  server.close();
  process.exit(0);
});

open(authUrl);

setTimeout(() => {
  console.error('\nTimeout — no OAuth callback received after 5 minutes.');
  server.close();
  process.exit(1);
}, 300000);
