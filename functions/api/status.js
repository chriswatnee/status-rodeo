import { createClient } from '@supabase/supabase-js';

const headers = {
  'Access-Control-Allow-Origin': '*',
};

function json(body, status = 200) {
  return Response.json(body, { status, headers });
}

export async function onRequest({ env }) {
  const supabase = createClient(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_PUBLISHABLE_KEY
  );

  const { data, error } = await supabase
    .from('statuses')
    .select('content, created_at')
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(error);

    return json({ error: 'Unable to load status.' }, 500);
  }

  if (!data) {
    return json({ error: 'No status found.' }, 404);
  }

  return json(data);
}
