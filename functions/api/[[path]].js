const enc = new TextEncoder();

function hex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

function getCookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  for (const part of c.split(';')) {
    const kv = part.trim().split('=');
    if (kv[0] === name) return kv.slice(1).join('=');
  }
  return null;
}

async function isAuthed(request, env) {
  const botToken = request.headers.get('x-bot-token');
  if (env.BOT_TOKEN && botToken && botToken === env.BOT_TOKEN) return true;
  const tok = getCookie(request, 'bdauth');
  if (!tok || !env.AUTH_SECRET) return false;
  const idx = tok.lastIndexOf('.');
  if (idx < 0) return false;
  const payload = tok.slice(0, idx);
  const sig = tok.slice(idx + 1);
  const sep = payload.indexOf('|');
  if (sep < 0) return false;
  const exp = parseInt(payload.slice(sep + 1), 10);
  if (!exp || Date.now() > exp) return false;
  const expect = await hmac(env.AUTH_SECRET, payload);
  return sig === expect;
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bot-Token',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!(await isAuthed(request, env))) return jsonError(401, 'unauthorized');

  try {
    if (path === '/api/bots' || path === '/api/bots/') {
      const { results } = await env.DB.prepare(
        'SELECT id, name, status, last_update, details FROM bot_status ORDER BY last_update DESC'
      ).all();
      return Response.json({ bots: results }, { headers: corsHeaders });
    }

    if (path.startsWith('/api/bots/')) {
      const botId = path.split('/api/bots/')[1];
      if (botId) {
        const bot = await env.DB.prepare(
          'SELECT id, name, status, last_update, details FROM bot_status WHERE id = ?'
        ).bind(botId).first();
        if (!bot) {
          return new Response(JSON.stringify({ error: 'Bot not found' }), { 
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }
        const { results: logs } = await env.DB.prepare(
          'SELECT level, message, timestamp FROM bot_logs WHERE bot_id = ? ORDER BY timestamp DESC LIMIT 50'
        ).bind(botId).all();
        return Response.json({ bot, logs }, { headers: corsHeaders });
      }
    }

    if (path === '/api/logs') {
      const botId = url.searchParams.get('bot_id');
      let query = 'SELECT bot_id, level, message, timestamp FROM bot_logs';
      let bindings = [];
      if (botId) {
        query += ' WHERE bot_id = ?';
        bindings.push(botId);
      }
      query += ' ORDER BY timestamp DESC LIMIT 200';
      const { results } = await env.DB.prepare(query).bind(...bindings).all();
      return Response.json({ logs: results }, { headers: corsHeaders });
    }

    if (path === '/api/jobs') {
      const botId = url.searchParams.get('bot_id');
      let query = 'SELECT bot_id, job_id, name, schedule, enabled, state, last_status, last_run_at, next_run_at FROM bot_jobs';
      let bindings = [];
      if (botId) {
        query += ' WHERE bot_id = ?';
        bindings.push(botId);
      }
      query += ' ORDER BY bot_id, name';
      const { results } = await env.DB.prepare(query).bind(...bindings).all();
      return Response.json({ jobs: results }, { headers: corsHeaders });
    }

    if (path === '/api/jobs') {
      const { bot_id, jobs } = body;
      if (!bot_id || !Array.isArray(jobs)) {
        return new Response(JSON.stringify({ error: 'bot_id and jobs array required' }), { 
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
      const stmts = [env.DB.prepare('DELETE FROM bot_jobs WHERE bot_id = ?').bind(bot_id)];
      const now = Date.now();
      for (const j of jobs) {
        if (!j.job_id || !j.name) continue;
        stmts.push(env.DB.prepare(
          'INSERT INTO bot_jobs (bot_id, job_id, name, schedule, enabled, state, last_status, last_run_at, next_run_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
        ).bind(bot_id, String(j.job_id), String(j.name), j.schedule || null,
               j.enabled ? 1 : 0, j.state || null, j.last_status || null,
               j.last_run_at || null, j.next_run_at || null, now));
      }
      await env.DB.batch(stmts);
      return Response.json({ ok: true, count: stmts.length - 1 }, { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { 
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (e) {
    console.error('API error:', e);
    return new Response(JSON.stringify({ error: e.message }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bot-Token',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (path === '/api/auth' || path === '/api/auth/') {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonError(400, 'Invalid JSON');
    }
    const { user, pass } = body;
    if (!env.AUTH_USER || !env.AUTH_PASS || !env.AUTH_SECRET) {
      return jsonError(500, 'Auth belum dikonfigurasi di server (set AUTH_USER / AUTH_PASS / AUTH_SECRET)');
    }
    if (user !== env.AUTH_USER || pass !== env.AUTH_PASS) {
      return jsonError(401, 'Username atau password salah');
    }
    const exp = Date.now() + 7 * 24 * 3600 * 1000;
    const payload = user + '|' + exp;
    const sig = await hmac(env.AUTH_SECRET, payload);
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Set-Cookie': 'bdauth=' + payload + '.' + sig + '; HttpOnly; Secure; Path=/; Max-Age=604800; SameSite=Lax',
      },
    });
  }

  if (!(await isAuthed(request, env))) return jsonError(401, 'unauthorized');

  try {
    const body = await request.json();

    if (path === '/api/bots' || path === '/api/bots/') {
      const { id, name, status, details } = body;
      if (!id || !name || !status) {
        return new Response(JSON.stringify({ error: 'id, name, status required' }), { 
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO bot_status (id, name, status, last_update, details)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET 
           name = excluded.name,
           status = excluded.status,
           last_update = excluded.last_update,
           details = excluded.details`
      ).bind(id, name, status, now, details ? JSON.stringify(details) : null).run();

      return Response.json({ ok: true, id }, { headers: corsHeaders });
    }

    if (path === '/api/logs') {
      const { bot_id, level, message } = body;
      if (!bot_id || !level || !message) {
        return new Response(JSON.stringify({ error: 'bot_id, level, message required' }), { 
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
      const now = Date.now();
      await env.DB.prepare(
        'INSERT INTO bot_logs (bot_id, level, message, timestamp) VALUES (?, ?, ?, ?)'
      ).bind(bot_id, level, message, now).run();

      return Response.json({ ok: true }, { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { 
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (e) {
    console.error('API error:', e);
    return new Response(JSON.stringify({ error: e.message }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
}

export async function onRequestDelete() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Set-Cookie': 'bdauth=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax',
    },
  });
}
