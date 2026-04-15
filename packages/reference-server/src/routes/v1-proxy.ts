/**
 * v2.2 harness — V1 Legacy static + reverse-proxy handlers.
 *
 *   /v1/*       — serves v1's HTML files from test-harness/public/ with an
 *                 on-the-fly rewrite: fetch('/api/...') → fetch('/v1-api/...').
 *                 This lets v1's pages make their original merchant-convention
 *                 calls without any changes to v1's source.
 *
 *   /v1-api/*   — transparent reverse proxy to http://localhost:3847/api/*.
 *                 Forwards every method, preserves headers (minus host/origin),
 *                 streams the response body back.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const V1_PUBLIC = resolve(__dirname, '..', '..', '..', '..', '..', 'test-harness', 'public');
const V1_PORT = 3847;

/**
 * Serves v1's HTML files with an on-the-fly rewrite so every `fetch('/api/`
 * call is transformed to `fetch('/v1-api/'`. For non-HTML files (images,
 * CSS, JS) it serves them directly.
 */
export function createV1StaticHandler(): RequestHandler {
  return (req, res, next) => {
    // Only accept GET for the static handler
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const rawPath = req.path === '/' ? '/index.html' : req.path;
    // Reject path traversal attempts
    if (rawPath.includes('..')) {
      res.status(400).json({ error: 'invalid path' });
      return;
    }

    const absPath = resolve(V1_PUBLIC, '.' + rawPath);
    if (!absPath.startsWith(V1_PUBLIC)) {
      res.status(400).json({ error: 'invalid path' });
      return;
    }

    if (!existsSync(absPath)) {
      res.status(404).json({ error: 'v1 file not found', path: rawPath });
      return;
    }

    const ext = extname(absPath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
    };
    const ct = contentTypeMap[ext] ?? 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'no-store');

    // For HTML files, rewrite fetch('/api/') → fetch('/v1-api/')
    if (ext === '.html') {
      let body = readFileSync(absPath, 'utf8');
      body = rewriteHtml(body);
      res.send(body);
      return;
    }

    res.sendFile(absPath);
  };
}

function rewriteHtml(html: string): string {
  // Rewrite every `/api/` reference to `/v1-api/` so v1's fetch calls hit
  // the reverse proxy instead of 404ing against the v2.2 server.
  // Covers: fetch('/api/...'), fetch("/api/..."), fetch(`/api/...`),
  //         new EventSource('/api/...'), url: '/api/...', href="/api/..."
  return html
    .replace(/(['"`])\/api\//g, '$1/v1-api/')
    .replace(/\bfetch\(\s*(['"`])\/api\//g, "fetch($1/v1-api/")
    .replace(/EventSource\(\s*(['"`])\/api\//g, 'EventSource($1/v1-api/');
}

/**
 * Reverse proxy middleware: forwards /v1-api/* → http://127.0.0.1:3847/api/*.
 * Streams in both directions, preserves methods + headers (minus host).
 */
export function createV1ApiProxy(): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    // req.url here is already stripped of the /v1-api mount prefix by Express
    // so /v1-api/klarna/session → req.url = '/klarna/session'
    const upstreamPath = '/api' + (req.url || '/');

    const forwardHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!v) continue;
      const key = k.toLowerCase();
      if (key === 'host' || key === 'connection' || key === 'content-length') continue;
      forwardHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    forwardHeaders['host'] = `127.0.0.1:${V1_PORT}`;

    const upstreamReq = http.request(
      {
        hostname: '127.0.0.1',
        port: V1_PORT,
        path: upstreamPath,
        method: req.method,
        headers: forwardHeaders,
      },
      (upstreamRes) => {
        res.status(upstreamRes.statusCode ?? 502);
        for (const [k, v] of Object.entries(upstreamRes.headers)) {
          if (v == null) continue;
          try {
            res.setHeader(k, v as string | string[]);
          } catch {
            /* hop-by-hop header, ignore */
          }
        }
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({
          error: 'v1_upstream_unreachable',
          message: err.message,
          note: 'v1 server may not be running on :3847 yet. Check /v2/harness/v1-status.',
        });
      } else {
        res.destroy();
      }
    });

    // Forward the request body (for POST/PUT/PATCH)
    req.pipe(upstreamReq);
  };
}
