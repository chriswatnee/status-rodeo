import './style.css';
import { supabase } from './supabase.js';
import { STATUS_LIMIT, countCharacters, truncateToLimit } from './status-limit.js';
import { submitStatus } from './post-status.js';
import { avatarLetter } from './avatar-letter.js';

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
const pathParts = window.location.pathname
  .split('/')
  .filter(Boolean);

if (pathParts.length === 0) {
  renderHome();
} else if (pathParts.length === 2 && pathParts[0] === 'users') {
  renderUserPage(pathParts[1]);
} else {
  renderNotFound();
}

function renderHome() {
  app.innerHTML = `
    ${masthead(false)}
    <main class="site">

      <div class="app-layout">
        ${sidebarMarkup('home')}

        <div class="main-content">
          <section class="composer" hidden>
            <span id="composer-avatar"></span>
            <div class="composer-fields">
              <label class="visually-hidden" for="status-input">What's your status?</label>
              <textarea
                id="status-input"
                rows="1"
                placeholder="This ain't my first rodeo."
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
            <h2 class="panel-heading">Recent Statuses</h2>
            <div class="feed" aria-busy="true">${feedPlaceholder()}</div>
          </section>
        </div>
      </div>
    </main>
  `;

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
  initSidebar({
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

  async function loadStatus() {
    const { data, error } = await supabase
      .from('statuses')
      .select(`
        *,
        profiles (
          display_name,
          username
        )
      `)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(5);

    feed.removeAttribute('aria-busy');

    if (error) {
      console.error(error);
      feed.replaceChildren();
      return;
    }

    feed.innerHTML = '';

    for (const status of data) {
      feed.append(
        createStatusRow({
          username: status.profiles.username,
          displayName: status.profiles.display_name,
          content: status.content,
          createdAt: status.created_at,
        })
      );
    }
  }

  postButton.addEventListener('click', postStatus);

  loadStatus();
}

async function renderUserPage(username) {
  app.innerHTML = `
    ${masthead(true)}
    <main class="site">

      <div class="app-layout">
        ${sidebarMarkup()}

        <div class="main-content">
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
            <h2 class="panel-heading">Recent Statuses</h2>
            <div class="feed" aria-busy="true">${feedPlaceholder()}</div>
          </section>
        </div>
      </div>
    </main>
  `;

  initSidebar({ currentUsername: username });

  const profileAvatar = document.querySelector('#profile-avatar');
  const profileName = document.querySelector('#profile-name');
  const profileUsername = document.querySelector('#profile-username');
  const profileMeta = document.querySelector('#profile-meta');
  const feed = document.querySelector('.feed');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, created_at')
    .eq('username', username)
    .single();

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

  const [{ data: statuses, error: statusesError }, { count, error: countError }] =
    await Promise.all([
      supabase
        .from('statuses')
        .select('content, created_at')
        .eq('user_id', profile.user_id)
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('statuses')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.user_id)
        .eq('visibility', 'public'),
    ]);

  if (countError) {
    console.error(countError);
  } else if (count !== null) {
    profileMeta.textContent = `${joined} · ${count} ${count === 1 ? 'status' : 'statuses'}`;
  }

  feed.removeAttribute('aria-busy');
  feed.replaceChildren();

  if (statusesError) {
    console.error(statusesError);
    feed.append(createFeedMessage("Couldn't load statuses."));
    return;
  }

  if (statuses.length === 0) {
    feed.append(createFeedMessage(`${profile.display_name} hasn't posted yet.`));
    return;
  }

  for (const status of statuses) {
    feed.append(
      createStatusRow({
        username: profile.username,
        displayName: profile.display_name,
        content: status.content,
        createdAt: status.created_at,
      })
    );
  }
}

// The sidebar is the same on the home page and on profile pages: the signed-in
// user's identity or the sign-in form, the navigation, and Sign out.
function sidebarMarkup(current) {
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
            <a href="/"${current === 'home' ? ' aria-current="page"' : ''}>Home</a>
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

// Wires up the sidebar. `onSession(session)` runs whenever the signed-in state
// is known or changes, and `onProfile(profile)` when the signed-in user's profile
// has loaded (or failed to, with null). `currentUsername` is the profile being
// viewed, so "My profile" is marked as the current page on your own profile.
function initSidebar({ onSession, onProfile, currentUsername } = {}) {
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
      onProfile?.(null);
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

    if (currentUsername === profile.username) {
      profileLink.setAttribute('aria-current', 'page');
    }

    sidebarProfile.hidden = false;
    profileLink.hidden = false;

    onProfile?.(profile);
  }

  function updateAuthUI(session) {
    onSession?.(session);

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
      profileLink.removeAttribute('aria-current');

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
  app.innerHTML = `
    ${masthead(true)}
    <main class="site">

      <h2>Page not found</h2>
      <p><a href="/">Back to Status Rodeo</a></p>
    </main>
  `;
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
  time.textContent = new Date(createdAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return time;
}

// The illustrated masthead is its own image asset (public/masthead.webp, with a
// tighter phone crop in public/masthead-mobile.webp). The words "Status Rodeo" are part of the artwork, so the h1 is visually hidden.
// It links home everywhere except the home page itself.
function masthead(linkHome) {
  // Phones get a tighter crop (cowboy, horse, dog and sign) so the sign stays
  // readable. Desktop uses the full-width image.
  const image = `<picture>
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
      </picture>`;

  return `
    <header class="masthead">
      <h1 class="visually-hidden">Status Rodeo</h1>
      ${linkHome ? `<a href="/">${image}</a>` : image}
    </header>
  `;
}
