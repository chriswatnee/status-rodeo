// The feed endpoints' logic: read public statuses, build the XML (src/rss.js) and
// answer the request. The Supabase client is passed in so this can be unit tested
// with a fake (tests/feed.test.js); the Cloudflare entry points in functions/ only
// create the client and call these.
//
// Only public statuses are ever read: both queries filter on visibility = 'public'
// and the public key is subject to the same Row Level Security as the website.
// Nothing here selects or outputs user ids or emails.
import { FEED_LIMIT, SITE_URL, buildFeed, userUrl } from './rss.js';

// Readers and browsers may reuse a feed for 5 minutes.
const FEED_CACHE = 'public, max-age=300';

// A username the feed will look up. Anything else is "not found" without asking the
// database. (Lookups are exact, so the case must match too.)
const USERNAME = /^[A-Za-z0-9_.-]{1,50}$/;

function respond(request, status, body, headers) {
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}

function feedResponse(request, xml) {
  return respond(request, 200, xml, {
    'Content-Type': 'application/rss+xml; charset=utf-8',
    'Cache-Control': FEED_CACHE,
  });
}

function textResponse(request, status, message, cache = 'no-store') {
  return respond(request, status, message, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': cache,
  });
}

function methodNotAllowed() {
  return new Response('Method not allowed.', {
    status: 405,
    headers: { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function isReadMethod(request) {
  return request.method === 'GET' || request.method === 'HEAD';
}

// Newest first. Statuses posted in the same instant are ordered by id, so the order
// is the same on every request.
function newestPublic(query) {
  return query
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(FEED_LIMIT);
}

export async function sitewideFeed(supabase, request) {
  if (!isReadMethod(request)) return methodNotAllowed();

  try {
    const { data, error } = await newestPublic(
      supabase.from('statuses').select('id, content, created_at, profiles(display_name, username)')
    );

    if (error) throw error;

    const xml = buildFeed({
      title: 'Status Rodeo',
      description: 'Recent public statuses on Status Rodeo.',
      link: `${SITE_URL}/`,
      path: '/feed.xml',
      items: data.map((status) => ({
        id: status.id,
        content: status.content,
        createdAt: status.created_at,
        author: status.profiles?.display_name,
      })),
    });

    return feedResponse(request, xml);
  } catch (error) {
    console.error(error);

    return textResponse(request, 500, 'Unable to load feed.');
  }
}

export async function userFeed(supabase, request, username) {
  if (!isReadMethod(request)) return methodNotAllowed();

  if (typeof username !== 'string' || !USERNAME.test(username)) {
    return textResponse(request, 404, 'User not found.', 'public, max-age=60');
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, username, display_name')
      .eq('username', username)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) return textResponse(request, 404, 'User not found.', 'public, max-age=60');

    const { data, error } = await newestPublic(
      supabase.from('statuses').select('id, content, created_at').eq('user_id', profile.user_id)
    );

    if (error) throw error;

    const xml = buildFeed({
      title: `${profile.display_name} (@${profile.username}) · Status Rodeo`,
      description: `Recent public statuses from ${profile.display_name} on Status Rodeo.`,
      link: userUrl(profile.username),
      path: `/users/${encodeURIComponent(profile.username)}/feed.xml`,
      items: data.map((status) => ({
        id: status.id,
        content: status.content,
        createdAt: status.created_at,
        author: profile.display_name,
      })),
    });

    return feedResponse(request, xml);
  } catch (error) {
    console.error(error);

    return textResponse(request, 500, 'Unable to load feed.');
  }
}
