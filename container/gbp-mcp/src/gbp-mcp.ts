/**
 * GBP (Google Business Profile) MCP Server for NanoClaw
 * Provides review monitoring, reading, and reply posting.
 * Reuses OAuth credentials from the email MCP mount (lam account).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

// --- Constants ---

// Reuses the same credential mount as email MCP
export const CREDS_BASE = '/workspace/email/creds';
const DEFAULT_ACCOUNT = 'lam';

// --- Credential Loading (same pattern as email-mcp) ---

export function loadOAuthCredentials(
  accountName: string,
): { clientId: string; clientSecret: string; refreshToken: string } | null {
  const credDir = path.join(CREDS_BASE, accountName);

  const keysPath = path.join(credDir, 'gcp-oauth.keys.json');
  if (!fs.existsSync(keysPath)) return null;
  const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
  const installed = keys.installed || keys.web;
  if (!installed) return null;

  const credsPath = path.join(credDir, 'credentials.json');
  if (!fs.existsSync(credsPath)) return null;
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));

  return {
    clientId: installed.client_id,
    clientSecret: installed.client_secret,
    refreshToken: creds.refresh_token,
  };
}

export function createAuthClient(accountName: string) {
  const creds = loadOAuthCredentials(accountName);
  if (!creds) {
    throw new Error(
      `No OAuth credentials found for account "${accountName}". Run scripts/gbp-oauth.mjs first.`,
    );
  }

  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  auth.setCredentials({ refresh_token: creds.refreshToken });
  return auth;
}

// --- GBP API Helpers ---

async function getAccountId(auth: ReturnType<typeof createAuthClient>): Promise<string> {
  const mybusiness = google.mybusinessaccountmanagement({ version: 'v1', auth });
  const res = await mybusiness.accounts.list();
  const accounts = res.data.accounts;
  if (!accounts || accounts.length === 0) {
    throw new Error('No GBP accounts found for this user.');
  }
  return accounts[0].name!;
}

async function getLocationId(
  auth: ReturnType<typeof createAuthClient>,
  accountId: string,
): Promise<string> {
  const mybusinessinfo = google.mybusinessbusinessinformation({ version: 'v1', auth });
  const res = await mybusinessinfo.accounts.locations.list({
    parent: accountId,
    readMask: 'name,title',
  });
  const locations = res.data.locations;
  if (!locations || locations.length === 0) {
    throw new Error('No GBP locations found for this account.');
  }
  return locations[0].name!;
}

// --- MCP Server ---

const server = new McpServer({
  name: 'gbp',
  version: '1.0.0',
});

// Tool: List reviews
server.tool(
  'list_reviews',
  'List recent Google Business Profile reviews. Returns reviewer name, rating, text, review ID, and whether a reply exists.',
  {
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Number of reviews to return (default 10, max 50)'),
    order_by: z
      .enum(['update_time_descending', 'rating_ascending', 'rating_descending'])
      .optional()
      .default('update_time_descending')
      .describe('Sort order for reviews'),
  },
  async (args) => {
    try {
      const auth = createAuthClient(DEFAULT_ACCOUNT);
      const accountId = await getAccountId(auth);

      // Reviews API uses the v4 mybusiness endpoint
      const mybusiness = google.mybusinessaccountmanagement({ version: 'v1', auth });
      const locRes = await google.mybusinessbusinessinformation({ version: 'v1', auth })
        .accounts.locations.list({
          parent: accountId,
          readMask: 'name,title',
        });

      const locations = locRes.data.locations;
      if (!locations || locations.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No GBP locations found.' }],
        };
      }

      // Use the REST API directly for reviews (not yet in googleapis typed client)
      const accessToken = (await auth.getAccessToken()).token;
      const locationName = locations[0].name;
      const url = `https://mybusiness.googleapis.com/v4/${accountId}/${locationName}/reviews?pageSize=${args.limit}&orderBy=${args.order_by}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [{ type: 'text' as const, text: `GBP API error (${response.status}): ${errorText}` }],
          isError: true,
        };
      }

      const data = await response.json();
      const reviews = data.reviews || [];

      const formatted = reviews.map((r: any) => {
        const reviewer = r.reviewer?.displayName || 'Anonymous';
        const rating = r.starRating || 'UNRATED';
        const comment = r.comment || '(no text)';
        const reviewId = r.reviewId || r.name?.split('/').pop() || 'unknown';
        const hasReply = !!r.reviewReply;
        const replyText = r.reviewReply?.comment || '';
        const createTime = r.createTime || '';

        return [
          `Review ID: ${reviewId}`,
          `Reviewer: ${reviewer}`,
          `Rating: ${rating}`,
          `Date: ${createTime}`,
          `Text: ${comment}`,
          `Has Reply: ${hasReply}${hasReply ? `\nReply: ${replyText}` : ''}`,
        ].join('\n');
      });

      const summary = `Found ${reviews.length} reviews.\n\n${formatted.join('\n---\n')}`;

      return {
        content: [{ type: 'text' as const, text: summary }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `Error listing reviews: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// Tool: Get single review
server.tool(
  'get_review',
  'Get details of a specific Google Business Profile review by ID.',
  {
    review_id: z.string().describe('The review ID to look up'),
  },
  async (args) => {
    try {
      const auth = createAuthClient(DEFAULT_ACCOUNT);
      const accountId = await getAccountId(auth);
      const locRes = await google.mybusinessbusinessinformation({ version: 'v1', auth })
        .accounts.locations.list({
          parent: accountId,
          readMask: 'name,title',
        });

      const locations = locRes.data.locations;
      if (!locations || locations.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No GBP locations found.' }],
          isError: true,
        };
      }

      const accessToken = (await auth.getAccessToken()).token;
      const locationName = locations[0].name;
      const url = `https://mybusiness.googleapis.com/v4/${accountId}/${locationName}/reviews/${args.review_id}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [{ type: 'text' as const, text: `GBP API error (${response.status}): ${errorText}` }],
          isError: true,
        };
      }

      const review = await response.json();
      const text = JSON.stringify(review, null, 2);

      return {
        content: [{ type: 'text' as const, text }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `Error getting review: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// Tool: Reply to review
server.tool(
  'reply_to_review',
  'Post a reply to a Google Business Profile review. HARD RULE: Only call this AFTER Nirbhay has explicitly approved the response text.',
  {
    review_id: z.string().describe('The review ID to reply to'),
    comment: z
      .string()
      .max(1600)
      .describe('The reply text (max 1600 characters)'),
  },
  async (args) => {
    try {
      const auth = createAuthClient(DEFAULT_ACCOUNT);
      const accountId = await getAccountId(auth);
      const locRes = await google.mybusinessbusinessinformation({ version: 'v1', auth })
        .accounts.locations.list({
          parent: accountId,
          readMask: 'name,title',
        });

      const locations = locRes.data.locations;
      if (!locations || locations.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No GBP locations found.' }],
          isError: true,
        };
      }

      const accessToken = (await auth.getAccessToken()).token;
      const locationName = locations[0].name;
      const url = `https://mybusiness.googleapis.com/v4/${accountId}/${locationName}/reviews/${args.review_id}/reply`;

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment: args.comment }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [{ type: 'text' as const, text: `Failed to post reply (${response.status}): ${errorText}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: `Reply posted successfully to review ${args.review_id}.` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `Error posting reply: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// Tool: List existing owner replies (for learning response style)
server.tool(
  'list_owner_replies',
  'List existing owner replies to reviews. Use this to learn the response voice and style.',
  {
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Number of reviews to check for replies'),
  },
  async (args) => {
    try {
      const auth = createAuthClient(DEFAULT_ACCOUNT);
      const accountId = await getAccountId(auth);
      const locRes = await google.mybusinessbusinessinformation({ version: 'v1', auth })
        .accounts.locations.list({
          parent: accountId,
          readMask: 'name,title',
        });

      const locations = locRes.data.locations;
      if (!locations || locations.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No GBP locations found.' }],
        };
      }

      const accessToken = (await auth.getAccessToken()).token;
      const locationName = locations[0].name;
      const url = `https://mybusiness.googleapis.com/v4/${accountId}/${locationName}/reviews?pageSize=${args.limit}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [{ type: 'text' as const, text: `GBP API error (${response.status}): ${errorText}` }],
          isError: true,
        };
      }

      const data = await response.json();
      const reviews = (data.reviews || []).filter((r: any) => r.reviewReply);

      const formatted = reviews.map((r: any) => {
        const rating = r.starRating || 'UNRATED';
        const comment = r.comment || '(no text)';
        const reply = r.reviewReply?.comment || '';
        return `[${rating}] "${comment}"\nReply: "${reply}"`;
      });

      return {
        content: [{
          type: 'text' as const,
          text: `Found ${reviews.length} reviews with replies:\n\n${formatted.join('\n\n---\n\n')}`,
        }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `Error listing replies: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// --- Start Server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('GBP MCP server failed to start:', err);
  process.exit(1);
});
