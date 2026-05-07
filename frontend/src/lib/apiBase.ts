/**
 * API base URL.
 *
 * - In dev (vite serve), VITE_API_BASE is unset → returns '' so all fetches
 *   go to relative paths and the Vite proxy in vite.config.ts forwards
 *   /api/* and /health to localhost:8000.
 * - In prod (vite build, deployed to Vercel), VITE_API_BASE is set to the
 *   Render backend URL (e.g. https://rupeezy-voice-agent.onrender.com) and
 *   prefixes every fetch.
 *
 * Trailing slash is normalised away so 'https://x.com/' + '/api/foo' produces
 * 'https://x.com/api/foo', not '...com//api/foo'.
 */

const RAW = (import.meta.env.VITE_API_BASE ?? '').trim();
export const API_BASE = RAW.replace(/\/+$/, '');

/** Build a fully-qualified URL for a backend path that starts with '/'. */
export function api(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`api(): path must start with '/' — got ${path}`);
  }
  return `${API_BASE}${path}`;
}
