'use strict';
   
                                                             
                                                                    
                                            
  
                                                                    
                                                                   
                                                                   
                                                                     
                                                                     
  
                                                                       
                                                                
                                                   
                                                       
   
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

                                                                          
                                                                               
let cached = { token: null, expiresAt: 0 };

async function getToken(ctx) {
  if (cached.token && Date.now() < cached.expiresAt - 5000) return cached.token;
  const clientId = ctx.secrets.get('plugin:spotify:clientId');
  const clientSecret = ctx.secrets.get('plugin:spotify:clientSecret');
  if (!clientId || !clientSecret) {
    throw new Error('Spotify Client ID/Secret belum diset. Buat app gratis di developer.spotify.com/dashboard, lalu isi "plugin:spotify:clientId" dan "plugin:spotify:clientSecret" di Settings → Plugin Secrets.');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
    signal: ctx.signal,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`Spotify auth failed: HTTP ${res.status}${detail ? ' — ' + detail : ''}`);
  }
  const j = await res.json();
  cached = { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

async function spotifyGet(ctx, path) {
  const token = await getToken(ctx);
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctx.signal });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`Spotify API HTTP ${res.status}${detail ? ' — ' + detail : ''}`);
  }
  return res.json();
}

module.exports = [
  {
    name: 'spotify.search', group: 'spotify', permission: 'NETWORK', category: 'network.spotify',
    description: 'Search Spotify\'s public catalog for tracks, artists, or albums. Read-only — cannot play anything.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 200 },
        type: { type: 'string', enum: ['track', 'artist', 'album'], description: 'Default "track".' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
    async execute({ query, type = 'track', limit = 10 }, ctx) {
      const j = await spotifyGet(ctx, `/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`);
      const items = j[`${type}s`]?.items || [];
      return {
        results: items.map((it) => ({
          id: it.id,
          name: it.name,
          artists: it.artists ? it.artists.map((a) => a.name).join(', ') : undefined,
          url: it.external_urls?.spotify,
        })),
      };
    },
  },
  {
    name: 'spotify.track_info', group: 'spotify', permission: 'NETWORK', category: 'network.spotify',
    description: 'Get details (artists, album, duration, preview URL) for a track by its Spotify ID.',
    inputSchema: { type: 'object', properties: { track_id: { type: 'string' } }, required: ['track_id'] },
    async execute({ track_id }, ctx) {
      const j = await spotifyGet(ctx, `/tracks/${encodeURIComponent(track_id)}`);
      return {
        id: j.id, name: j.name, artists: j.artists?.map((a) => a.name).join(', '),
        album: j.album?.name, duration_ms: j.duration_ms, url: j.external_urls?.spotify, preview_url: j.preview_url,
      };
    },
  },
];
