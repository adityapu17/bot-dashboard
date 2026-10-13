export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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
