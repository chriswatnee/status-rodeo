import { createClient } from '@supabase/supabase-js';

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
    .single();

  if (error) {
    console.error(error);

    return Response.json(
      { error: 'Unable to load status.' },
      { status: 500 }
    );
  }

  return Response.json(data, {
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  });
}