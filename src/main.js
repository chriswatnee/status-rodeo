import './style.css';
import { supabase } from './supabase.js';
import { STATUS_LIMIT, countCharacters, truncateToLimit } from './status-limit.js';
import { submitStatus } from './post-status.js';
import { avatarLetter } from './avatar-letter.js';
import { relativeTime, absoluteTime } from './relative-time.js';

// Pauses before the second and third attempts at an image that failed to load.
// The query string keeps a retry from being answered by a cached failure.
const IMAGE_RETRY_DELAYS = [1500, 4000];

function retryUrl(url, attempt) {
  return attempt === 0 ? url : `${url}?retry=${attempt}`;
}

// Failed loads are logged so the cause can be traced from the browser console.
function warnImageFailed(url, attempt) {
  const willRetry = attempt < IMAGE_RETRY_DELAYS.length;

  console.warn(
    `Image failed to load: ${url} (attempt ${attempt + 1} of ${IMAGE_RETRY_DELAYS.length + 1}, ${willRetry ? 'will retry' : 'giving up'})`,
  );
}

// The masthead is rendered as markup, so its failed loads are caught here. The
// error event does not bubble, hence the capture phase.
document.addEventListener(
  'error',
  (event) => {
    const image = event.target;

    if (!(image instanceof HTMLImageElement) || !image.classList.contains('masthead-image')) return;

    const attempt = Number(image.dataset.retries || 0);
    // The file that failed: the phone crop or the desktop image, whichever the
    // browser chose.
    const failedUrl = image.currentSrc ? new URL(image.currentSrc).pathname : image.getAttribute('src');

    warnImageFailed(failedUrl, attempt);

    if (attempt >= IMAGE_RETRY_DELAYS.length) return;

    image.dataset.retries = String(attempt + 1);
    setTimeout(() => {
      // A <source> takes priority over src, so drop the sources before retrying
      // with the cache-busting URL.
      image.parentElement.querySelectorAll('source').forEach((source) => source.remove());
      image.src = retryUrl(failedUrl, attempt + 1);
    }, IMAGE_RETRY_DELAYS[attempt]);
  },
  true,
);

const app = document.querySelector('#app');

// Pages are drawn inside a shared frame (masthead and sidebar) that is built once,
// so moving between pages replaces only the content beside the sidebar and the
// masthead, sign-in state and avatars stay put. `route()` is called at the end
// of this file, once everything it uses exists.
let frame = null;
let navigation = 0;
let pageHooks = {};
let authKnown = false;
let currentSession = null;
// undefined until the signed-in user's profile loads; null if it failed.
let currentProfile;

function route() {
  const id = ++navigation;
  const isCurrent = () => id === navigation;
  const parts = window.location.pathname.split('/').filter(Boolean);

  if (parts.length === 0) {
    renderHome();
  } else if (parts.length === 2 && parts[0] === 'users') {
    renderUserPage(parts[1], isCurrent);
  } else {
    renderNotFound();
  }

  updateNav();
}

function navigate(path) {
  if (path !== window.location.pathname + window.location.search) {
    window.history.pushState({}, '', path);
    route();
  }

  window.scrollTo(0, 0);
}

// Links to pages of this app load without reloading the browser page. Anything
// else (other sites, new tabs, modified clicks, plain "#" links) behaves normally.
document.addEventListener('click', (event) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;

  if (!link || link.target || link.hasAttribute('download')) return;
  if (link.getAttribute('href').startsWith('#')) return;

  const url = new URL(link.href, window.location.href);
  const parts = url.pathname.split('/').filter(Boolean);
  const isAppPage = parts.length === 0 || (parts.length === 2 && parts[0] === 'users');

  if (url.origin !== window.location.origin || !isAppPage) return;

  event.preventDefault();
  navigate(url.pathname + url.search);
});

window.addEventListener('popstate', route);

// Builds the frame on first use, then swaps the page content. `linkHome` is
// whether the masthead links to the home page (everywhere except home).
function mount(markup, { linkHome }) {
  if (!frame) {
    app.innerHTML = `
      ${masthead()}
      <main class="site">
        <div class="app-layout">
          ${sidebarMarkup()}
          <div class="main-content" id="page"></div>
        </div>
      </main>
    `;
    frame = { page: app.querySelector('#page') };
    initSidebar();
  }

  setMastheadLink(linkHome);
  pageHooks = {};
  frame.page.innerHTML = markup;
}

// The home page and the profile page differ in what they do when the signed-in
// state is known. The hooks run now if it already is (the sidebar has been there
// since an earlier page), and again when it changes.
function setPageHooks(hooks) {
  pageHooks = hooks;

  if (!authKnown) return;

  hooks.onSession?.(currentSession);

  if (currentSession && currentProfile !== undefined) {
    hooks.onProfile?.(currentProfile);
  }
}

// Marks the current page in the navigation: "Home" on the home page, and
// "My profile" on your own profile.
function updateNav() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const homeLink = document.querySelector('.site-nav a[href="/"]');
  const profileLink = document.querySelector('#profile-link');

  if (!homeLink || !profileLink) return;

  if (parts.length === 0) {
    homeLink.setAttribute('aria-current', 'page');
  } else {
    homeLink.removeAttribute('aria-current');
  }

  if (currentProfile && parts.length === 2 && parts[0] === 'users' && parts[1] === currentProfile.username) {
    profileLink.setAttribute('aria-current', 'page');
  } else {
    profileLink.removeAttribute('aria-current');
  }
}

function renderHome() {
  document.title = 'Status Rodeo';
  mount(`
          <section class="composer" hidden>
            <span id="composer-avatar"></span>
            <div class="composer-fields">
              <label class="visually-hidden" for="status-input">What's your status?</label>
              <textarea
                id="status-input"
                rows="1"
                placeholder="What’s your status?"
                aria-describedby="char-help"
              ></textarea>
              <span id="char-help" class="visually-hidden">${STATUS_LIMIT} characters maximum.</span>
              <div class="composer-actions">
                <span id="char-count" class="char-count" aria-hidden="true">0/${STATUS_LIMIT}</span>
                <button type="button">Post</button>
              </div>
              <p id="composer-note" class="composer-note" role="status"></p>
              <p id="char-announce" class="visually-hidden" role="status"></p>
            </div>
          </section>

          <section class="feed-panel">
            <div class="panel-heading">
              <h2 class="panel-title">Recent Statuses</h2>
              ${sortSelectMarkup()}
            </div>
            <div class="feed" aria-busy="true">${feedPlaceholder()}</div>
            <div class="feed-more" hidden>
              <button type="button">Show older</button>
            </div>
          </section>
  `, { linkHome: false });

  const composer = document.querySelector('.composer');
  const composerAvatar = document.querySelector('#composer-avatar');
  const statusInput = document.querySelector('#status-input');
  const postButton = document.querySelector('.composer button');
  const charCount = document.querySelector('#char-count');
  const composerNote = document.querySelector('#composer-note');
  const charAnnounce = document.querySelector('#char-announce');
  const feed = document.querySelector('.feed');

  // The sidebar is shared with the profile page. The home page only adds what
  // belongs to the composer: it is shown when signed in and shows the user's avatar.
  setPageHooks({
    onSession(session) {
      composer.hidden = !session;

      if (session) {
        composerAvatar.replaceChildren(createLoadingAvatar());
      } else {
        composerAvatar.replaceChildren();
      }
    },
    onProfile(profile) {
      if (profile) {
        composerAvatar.replaceChildren(
          createAvatar(profile.username, profile.display_name)
        );
      } else {
        composerAvatar.replaceChildren();
      }
    },
  });

  let posting = false;
  let announceTimer;

  const postErrors = {
    'too-long': `Statuses can be at most ${STATUS_LIMIT} characters.`,
    'not-signed-in': 'Sign in again to post.',
    'insert-failed': "Couldn't post your status. Try again.",
  };

  function updateCounter() {
    const count = countCharacters(statusInput.value);
    const remaining = STATUS_LIMIT - count;

    charCount.textContent = `${count}/${STATUS_LIMIT}`;
    charCount.classList.toggle('char-count-near', remaining <= 20);

    // Screen readers hear nothing until the limit is close, and then only the
    // settled value, so typing does not produce a stream of announcements.
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      if (remaining > 20) {
        charAnnounce.textContent = '';
      } else if (remaining <= 0) {
        charAnnounce.textContent = 'Character limit reached.';
      } else {
        charAnnounce.textContent = `${remaining} characters left.`;
      }
    }, 500);
  }

  // Typing and pasting stop at the limit. beforeinput lets the part of an
  // insertion that fits go in, without removing any text that is already there.
  statusInput.addEventListener('beforeinput', (event) => {
    if (event.isComposing || !event.inputType.startsWith('insert')) {
      return;
    }

    let text = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';

    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
      text = '\n';
    }

    if (!text) {
      return;
    }

    const { value, selectionStart, selectionEnd } = statusInput;
    const room =
      STATUS_LIMIT -
      countCharacters(value) +
      countCharacters(value.slice(selectionStart, selectionEnd));

    if (countCharacters(text) <= room) {
      return;
    }

    event.preventDefault();

    const fitted = truncateToLimit(text, room);

    if (fitted) {
      statusInput.setRangeText(fitted, selectionStart, selectionEnd, 'end');
    }

    statusInput.dispatchEvent(new Event('input'));
  });

  statusInput.addEventListener('input', () => {
    // Safety net for input that beforeinput cannot cancel (IME, drag and drop).
    if (countCharacters(statusInput.value) > STATUS_LIMIT) {
      const caret = statusInput.selectionStart;

      statusInput.value = truncateToLimit(statusInput.value);
      statusInput.setSelectionRange(
        Math.min(caret, statusInput.value.length),
        Math.min(caret, statusInput.value.length)
      );
    }

    composerNote.textContent = '';
    updateCounter();
  });

  const postLabel = postButton.textContent;

  // While a post is in flight the button says so, keeps its width so nothing
  // beside it moves, and ignores further clicks.
  function setPosting(busy) {
    posting = busy;

    if (busy) {
      postButton.style.width = `${postButton.getBoundingClientRect().width}px`;
      postButton.textContent = 'Posting…';
      postButton.setAttribute('aria-busy', 'true');
    } else {
      postButton.textContent = postLabel;
      postButton.removeAttribute('aria-busy');
      postButton.style.width = '';
    }
  }

  async function postStatus() {
    if (posting) {
      return;
    }

    setPosting(true);
    statusInput.readOnly = true;
    composerNote.textContent = '';

    try {
      const result = await submitStatus(supabase, statusInput.value);

      statusInput.readOnly = false;

      if (!result.ok) {
        // The text stays in the composer so nothing the user wrote is lost.
        if (result.reason === 'insert-failed' || result.reason === 'not-signed-in') {
          console.error(result.error);
        }

        composerNote.textContent = postErrors[result.reason] ?? '';
        return;
      }

      statusInput.value = '';
      updateCounter();
      await loadStatus();
    } finally {
      statusInput.readOnly = false;
      setPosting(false);
    }
  }

  const pager = createFeedPager({
    feed,
    more: document.querySelector('.feed-more'),
    sortSelect: document.querySelector('.sort-select'),
    title: document.querySelector('.panel-title'),
    select: `
      *,
      profiles (
        display_name,
        username
      )
    `,
    toRow: (status) => ({
      username: status.profiles.username,
      displayName: status.profiles.display_name,
      content: status.content,
      createdAt: status.created_at,
    }),
    emptyMessage: 'No statuses yet.',
  });

  // A new status belongs at the top of "Latest first", so posting switches back
  // to that order.
  function loadStatus() {
    return pager.load({ ascending: false, motion: 'pop' });
  }

  postButton.addEventListener('click', postStatus);

  pager.load();
}

async function renderUserPage(username, isCurrent) {
  mount(`
          <section class="profile">
            <span id="profile-avatar"><span class="avatar" data-state="loading"></span></span>
            <div>
              <h2 id="profile-name"></h2>
              <p>
                <span id="profile-username"></span>
                <span id="profile-meta" class="profile-meta" hidden></span>
              </p>
            </div>
          </section>

          <section class="feed-panel">
            <div class="panel-heading">
              <h2 class="panel-title">Recent Statuses</h2>
              ${sortSelectMarkup()}
            </div>
            <div class="feed" aria-busy="true">${feedPlaceholder()}</div>
            <div class="feed-more" hidden>
              <button type="button">Show older</button>
            </div>
          </section>
  `, { linkHome: true });

  const profileAvatar = document.querySelector('#profile-avatar');
  const profileName = document.querySelector('#profile-name');
  const profileUsername = document.querySelector('#profile-username');
  const profileMeta = document.querySelector('#profile-meta');
  const feed = document.querySelector('.feed');
  const feedMore = document.querySelector('.feed-more');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, created_at')
    .eq('username', username)
    .single();

  // The visitor may have moved to another page while this was loading.
  if (!isCurrent()) return;

  if (profileError) {
    console.error(profileError);
    renderNotFound();
    return;
  }

  document.title = `${profile.display_name} (@${profile.username}) · Status Rodeo`;
  profileName.textContent = profile.display_name;
  profileUsername.textContent = `@${profile.username}`;
  profileAvatar.replaceChildren(
    createAvatar(profile.username, profile.display_name)
  );

  const joined = `Joined ${new Date(profile.created_at).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  })}`;
  profileMeta.textContent = joined;
  profileMeta.hidden = false;

  const pager = createFeedPager({
    feed,
    more: feedMore,
    sortSelect: document.querySelector('.sort-select'),
    title: document.querySelector('.panel-title'),
    select: 'content, created_at',
    filter: (query) => query.eq('user_id', profile.user_id),
    toRow: (status) => ({
      username: profile.username,
      displayName: profile.display_name,
      content: status.content,
      createdAt: status.created_at,
    }),
    emptyMessage: `${profile.display_name} hasn't posted yet.`,
  });

  pager.load();

  const { count, error: countError } = await supabase
    .from('statuses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.user_id)
    .eq('visibility', 'public');

  if (countError) {
    console.error(countError);
  } else if (count !== null) {
    profileMeta.textContent = `${joined} · ${count} ${count === 1 ? 'status' : 'statuses'}`;
  }
}

// The sort dropdown above a feed. It is the only control in the heading, so
// the heading text stays a real h2 beside it.
function sortSelectMarkup() {
  return `
    <select class="sort-select" aria-label="Sort statuses">
      <option value="desc">Latest first</option>
      <option value="asc">Oldest first</option>
    </select>
  `;
}

// A feed of public statuses, five at a time, in either order. One extra row is
// requested so we know whether there is another page, and the next page starts
// past the last status shown (compared on created_at exactly as the database
// returned it), so a status posted meanwhile can't shift or repeat rows. Results
// that arrive after the order was changed are dropped.
function createFeedPager({ feed, more, sortSelect, title, select, filter = (query) => query, toRow, emptyMessage }) {
  const PAGE_SIZE = 5;
  const button = more.querySelector('button');
  let ascending = false;
  let cursor = null;
  let generation = 0;

  async function fetchPage() {
    let query = filter(supabase.from('statuses').select(select))
      .eq('visibility', 'public')
      .order('created_at', { ascending })
      .limit(PAGE_SIZE + 1);

    if (cursor) {
      query = ascending ? query.gt('created_at', cursor) : query.lt('created_at', cursor);
    }

    const { data, error } = await query;

    if (error) return { error };

    return { rows: data.slice(0, PAGE_SIZE), hasMore: data.length > PAGE_SIZE };
  }

  // How rows appear: nothing for a plain load, "spring" (one after another) for
  // "Show older / newer", "pop" (the first row only) for a status you just
  // posted, "fade" (all rows together) after the order changes.
  function appendRows(rows, motion = null) {
    rows.forEach((status, index) => {
      const row = createStatusRow(toRow(status));

      if (motion === 'spring' || (motion === 'pop' && index === 0)) {
        row.classList.add('status-enter');
        row.style.setProperty('--i', motion === 'spring' ? index : 0);
      } else if (motion === 'fade') {
        row.classList.add('status-fade');
      }

      feed.append(row);
    });

    cursor = rows[rows.length - 1].created_at;
  }

  function moreLabel() {
    return ascending ? 'Show newer' : 'Show older';
  }

  async function load(options = {}) {
    if (options.ascending !== undefined) ascending = options.ascending;

    sortSelect.value = ascending ? 'asc' : 'desc';
    title.textContent = ascending ? 'Oldest Statuses' : 'Recent Statuses';
    cursor = null;
    const mine = ++generation;

    more.hidden = true;
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = moreLabel();
    feed.setAttribute('aria-busy', 'true');
    feed.innerHTML = feedPlaceholder();

    const page = await fetchPage();

    if (mine !== generation) return;

    feed.removeAttribute('aria-busy');
    feed.replaceChildren();

    if (page.error) {
      console.error(page.error);
      feed.append(createFeedMessage("Couldn't load statuses."));
      return;
    }

    if (page.rows.length === 0) {
      feed.append(createFeedMessage(emptyMessage));
      return;
    }

    appendRows(page.rows, options.motion);
    more.hidden = !page.hasMore;
  }

  sortSelect.addEventListener('change', () => {
    load({ ascending: sortSelect.value === 'asc', motion: 'fade' });
  });

  button.addEventListener('click', async () => {
    if (button.disabled) return;

    const mine = generation;

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Loading…';

    const page = await fetchPage();

    if (mine !== generation) return;

    button.disabled = false;
    button.removeAttribute('aria-busy');

    if (page.error) {
      console.error(page.error);
      button.textContent = "Couldn't load more statuses. Try again";
      return;
    }

    button.textContent = moreLabel();

    if (page.rows.length > 0) appendRows(page.rows, 'spring');

    more.hidden = !page.hasMore;
  });

  return { load };
}

// The sidebar is the same on the home page and on profile pages: the signed-in
// user's identity or the sign-in form, the navigation, and Sign out.
function sidebarMarkup() {
  return `
        <aside class="sidebar">
          <section id="sidebar-profile" class="sidebar-profile" hidden>
            <span id="sidebar-avatar"></span>
            <div class="sidebar-identity">
              <strong id="sidebar-display-name"></strong>
              <span id="sidebar-username"></span>
              <a id="view-profile-link" href="#">View profile</a>
            </div>
          </section>

          <section id="login" class="login" hidden>
            <label for="email-input">Email</label>
            <input id="email-input" type="email" />

            <label for="password-input">Password</label>
            <input id="password-input" type="password" />

            <button type="button">Sign in</button>
          </section>

          <nav class="site-nav">
            <a href="/">Home</a>
            <a id="profile-link" href="#" hidden>My profile</a>
          </nav>

          <div class="auth-info">
            <span id="auth-status"></span>
            <span id="auth-separator" hidden>·</span>
            <button id="sign-out-button" type="button" hidden>
              Sign out
            </button>
          </div>
        </aside>
  `;
}

// Wires up the sidebar, once, when the frame is built. The current page's hooks
// (`pageHooks.onSession(session)` whenever the signed-in state is known or
// changes, and `onProfile(profile)` when the signed-in user's profile has loaded,
// or failed to, with null) are set with `setPageHooks()`. `updateNav()` marks the
// current page in the navigation.
function initSidebar() {
  const sidebarProfile = document.querySelector('#sidebar-profile');
  const sidebarAvatar = document.querySelector('#sidebar-avatar');
  const sidebarDisplayName = document.querySelector('#sidebar-display-name');
  const sidebarUsername = document.querySelector('#sidebar-username');
  const viewProfileLink = document.querySelector('#view-profile-link');
  const profileLink = document.querySelector('#profile-link');

  const loginSection = document.querySelector('#login');
  const signOutButton = document.querySelector('#sign-out-button');
  const authStatus = document.querySelector('#auth-status');
  const authSeparator = document.querySelector('#auth-separator');
  const emailInput = document.querySelector('#email-input');
  const passwordInput = document.querySelector('#password-input');
  const signInButton = document.querySelector('.login button');

  async function loadProfile(userId) {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('username, display_name')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error(error);
      currentProfile = null;
      pageHooks.onProfile?.(null);
      return;
    }

    // Avoid displaying a profile if the user signed out
    // while the request was running.
    const { data: sessionData } = await supabase.auth.getSession();

    if (sessionData.session?.user.id !== userId) {
      return;
    }

    sidebarDisplayName.textContent = profile.display_name;
    sidebarUsername.textContent = `@${profile.username}`;
    sidebarAvatar.replaceChildren(
      createAvatar(profile.username, profile.display_name)
    );

    viewProfileLink.href = `/users/${profile.username}`;
    profileLink.href = `/users/${profile.username}`;

    sidebarProfile.hidden = false;
    profileLink.hidden = false;

    currentProfile = profile;
    updateNav();
    pageHooks.onProfile?.(profile);
  }

  function updateAuthUI(session) {
    authKnown = true;
    currentSession = session;
    if (!session) currentProfile = undefined;

    pageHooks.onSession?.(session);

    if (session) {
      loginSection.hidden = true;
      signOutButton.hidden = false;
      authSeparator.hidden = false;
      authStatus.textContent = 'Signed in';

      loadProfile(session.user.id);
    } else {
      loginSection.hidden = false;
      signOutButton.hidden = true;
      authSeparator.hidden = true;
      authStatus.textContent = '';

      sidebarProfile.hidden = true;
      profileLink.hidden = true;
      updateNav();

      sidebarDisplayName.textContent = '';
      sidebarUsername.textContent = '';
      sidebarAvatar.replaceChildren();
      viewProfileLink.href = '#';
      profileLink.href = '#';
    }
  }

  async function signIn() {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailInput.value,
      password: passwordInput.value,
    });

    if (error) {
      console.error(error);
      return;
    }

    updateAuthUI(data.session);
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error(error);
      return;
    }

    emailInput.value = '';
    passwordInput.value = '';
    updateAuthUI(null);
  }

  async function loadSession() {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error(error);
      updateAuthUI(null);
      return;
    }

    updateAuthUI(data.session);
  }

  signInButton.addEventListener('click', signIn);
  signOutButton.addEventListener('click', signOut);

  loadSession();
}

function renderNotFound() {
  document.title = 'Page not found · Status Rodeo';
  mount(`
    <h2>Page not found</h2>
    <p><a href="/">Back to Status Rodeo</a></p>
  `, { linkHome: true });
}

// A user's avatar, expected at /avatars/<username>.webp. While the file loads the
// slot shows a pulsing placeholder. Once it loads the image replaces the
// placeholder. If it fails, or takes more than a few seconds, the slot shows the
// first letter of the display name instead. A failed load is retried twice in the
// background, and the image replaces the letter if a retry succeeds. A user with
// no avatar file costs two extra small requests.
function createAvatar(username, displayName) {
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.dataset.state = 'loading';
  avatar.textContent = avatarLetter(displayName, username);

  const url = `/avatars/${encodeURIComponent(username)}.webp`;

  const giveUp = setTimeout(() => {
    avatar.dataset.state = 'fallback';
  }, 8000);

  function load(attempt) {
    const image = new Image();
    image.alt = '';

    image.addEventListener('load', () => {
      clearTimeout(giveUp);
      avatar.textContent = '';
      avatar.append(image);
      avatar.dataset.state = 'loaded';
    });

    image.addEventListener('error', () => {
      clearTimeout(giveUp);
      avatar.dataset.state = 'fallback';
      warnImageFailed(url, attempt);

      if (attempt < IMAGE_RETRY_DELAYS.length) {
        setTimeout(() => load(attempt + 1), IMAGE_RETRY_DELAYS[attempt]);
      }
    });

    image.src = retryUrl(url, attempt);
  }

  load(0);

  return avatar;
}

// An empty avatar in its loading state, for slots whose user is not known yet.
function createLoadingAvatar() {
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.dataset.state = 'loading';

  return avatar;
}

// Static placeholder rows shown in the feed until the statuses arrive.
function feedPlaceholder() {
  const row = `
    <div class="status-skeleton" aria-hidden="true">
      <span class="skeleton-avatar"></span>
      <span class="skeleton-lines"><span></span><span></span></span>
    </div>
  `;

  return `${row.repeat(3)}<p class="visually-hidden" role="status">Loading statuses</p>`;
}

// A short line of text shown inside the feed panel instead of statuses.
function createFeedMessage(text) {
  const message = document.createElement('p');
  message.className = 'feed-message';
  message.textContent = text;

  return message;
}

function createStatusRow({ username, displayName, content, createdAt }) {
  const article = document.createElement('article');
  article.className = 'status';

  const name = document.createElement('a');
  name.className = 'status-name';
  name.href = `/users/${username}`;
  name.textContent = displayName;

  const meta = document.createElement('div');
  meta.className = 'status-meta';
  meta.append(name, createTimeElement(createdAt));

  const paragraph = document.createElement('p');
  paragraph.textContent = content;

  const body = document.createElement('div');
  body.className = 'status-body';
  body.append(meta, paragraph);

  article.append(createAvatar(username, displayName), body);

  return article;
}

function createTimeElement(createdAt) {
  const time = document.createElement('time');

  time.dateTime = createdAt;
  time.title = absoluteTime(createdAt);
  time.textContent = relativeTime(createdAt);

  return time;
}

// Relative times go stale while a page stays open, so refresh them each minute.
function refreshTimes() {
  for (const time of document.querySelectorAll('time[datetime]')) {
    time.textContent = relativeTime(time.dateTime);
  }
}

setInterval(refreshTimes, 60 * 1000);

// The illustrated masthead is its own image asset (public/masthead.webp, with a
// tighter phone crop in public/masthead-mobile.webp). The words "Status Rodeo" are part of the artwork, so the h1 is visually hidden.
// It links home everywhere except the home page itself.
function masthead() {
  // Phones get a tighter crop (cowboy, horse, dog and sign) so the sign stays
  // readable. Desktop uses the full-width image.
  return `
    <header class="masthead">
      <h1 class="visually-hidden">Status Rodeo</h1>
      <picture>
        <source
          media="(max-width: 639px)"
          srcset="/masthead-mobile.webp"
          width="1536"
          height="768"
        />
        <img
          class="masthead-image"
          src="/masthead.webp"
          width="3072"
          height="768"
          alt="Status Rodeo: a cowboy on horseback and a dog look out over a desert valley at sunset"
          fetchpriority="high"
        />
      </picture>
    </header>
  `;
}

// Wraps the masthead picture in a link home, or unwraps it. The picture itself
// is moved, not rebuilt, so the image doesn't reload between pages.
function setMastheadLink(linkHome) {
  const header = document.querySelector('.masthead');
  const picture = header.querySelector('picture');
  const link = header.querySelector('a');

  if (linkHome && !link) {
    const anchor = document.createElement('a');
    anchor.href = '/';
    header.append(anchor);
    anchor.append(picture);
  } else if (!linkHome && link) {
    header.append(picture);
    link.remove();
  }
}

route();
