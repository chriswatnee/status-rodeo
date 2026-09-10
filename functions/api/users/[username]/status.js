import { createClient } from '@supabase/supabase-js';

export async function onRequest({ env, params }) {
  const supabase = createClient(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_PUBLISHABLE_KEY
  );

  const { username } = params;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('username', username)
    .single();

  if (profileError) {
    console.error(profileError);

    return Response.json(
      { error: 'User not found.' },
      { status: 404 }
    );
  }

  const { data, error } = await supabase
    .from('statuses')
    .select('content, created_at')
    .eq('user_id', profile.user_id)
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