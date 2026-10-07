import './style.css';
import { supabase } from './supabase.js';

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
        <aside class="sidebar">
          <section id="sidebar-profile" class="sidebar-profile" hidden>
            <span id="sidebar-avatar"></span>
            <div class="sidebar-identity">
              <strong id="sidebar-display-name"></strong>
              <span id="sidebar-username"></span>
              <a id="view-profile-link" href="#">View profile</a>
            </div>
          </section>

          <section id="login" class="login">
            <label for="email-input">Email</label>
            <input id="email-input" type="email" />

            <label for="password-input">Password</label>
            <input id="password-input" type="password" />

            <button type="button">Sign in</button>
          </section>

          <nav class="site-nav">
            <a href="/" aria-current="page">Home</a>
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

        <div class="main-content">
          <section class="composer" hidden>
            <span id="composer-avatar"></span>
            <div class="composer-fields">
              <label class="visually-hidden" for="status-input">What's your status?</label>
              <textarea
                id="status-input"
                rows="1"
                placeholder="This ain't my first rodeo."
              ></textarea>
              <div class="composer-actions">
                <button type="button">Post</button>
              </div>
            </div>
          </section>

          <section class="feed-panel">
            <h2 class="panel-heading">Recent Statuses</h2>
            <div class="feed"></div>
          </section>
        </div>
      </div>
    </main>
  `;

  const sidebarProfile = document.querySelector('#sidebar-profile');
  const sidebarAvatar = document.querySelector('#sidebar-avatar');
  const sidebarDisplayName = document.querySelector('#sidebar-display-name');
  const sidebarUsername = document.querySelector('#sidebar-username');
  const viewProfileLink = document.querySelector('#view-profile-link');
  const profileLink = document.querySelector('#profile-link');

  const loginSection = document.querySelector('#login');
  const composer = document.querySelector('.composer');
  const composerAvatar = document.querySelector('#composer-avatar');
  const signOutButton = document.querySelector('#sign-out-button');
  const authStatus = document.querySelector('#auth-status');
  const authSeparator = document.querySelector('#auth-separator');
  const statusInput = document.querySelector('#status-input');
  const postButton = document.querySelector('.composer button');
  const feed = document.querySelector('.feed');
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
    composerAvatar.replaceChildren(
      createAvatar(profile.username, profile.display_name)
    );

    viewProfileLink.href = `/users/${profile.username}`;
    profileLink.href = `/users/${profile.username}`;

    sidebarProfile.hidden = false;
    profileLink.hidden = false;
  }

  function updateAuthUI(session) {
    if (session) {
      loginSection.hidden = true;
      composer.hidden = false;
      signOutButton.hidden = false;
      authSeparator.hidden = false;
      authStatus.textContent = 'Signed in';

      loadProfile(session.user.id);
    } else {
      loginSection.hidden = false;
      composer.hidden = true;
      signOutButton.hidden = true;
      authSeparator.hidden = true;
      authStatus.textContent = '';

      sidebarProfile.hidden = true;
      profileLink.hidden = true;

      sidebarDisplayName.textContent = '';
      sidebarUsername.textContent = '';
      sidebarAvatar.replaceChildren();
      composerAvatar.replaceChildren();
      viewProfileLink.href = '#';
      profileLink.href = '#';
    }
  }

  async function postStatus() {
    const content = statusInput.value.trim();

    if (!content) {
      return;
    }

    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      console.error(error || 'Not signed in.');
      return;
    }

    const user = data.user;

    const { error: insertError } = await supabase
      .from('statuses')
      .insert({
        user_id: user.id,
        content,
      });

    if (insertError) {
      console.error(insertError);
      return;
    }

    statusInput.value = '';
    await loadStatus();
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

    if (error) {
      console.error(error);
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
      return;
    }

    updateAuthUI(data.session);
  }

  postButton.addEventListener('click', postStatus);
  signInButton.addEventListener('click', signIn);
  signOutButton.addEventListener('click', signOut);

  loadStatus();
  loadSession();
}

async function renderUserPage(username) {
  app.innerHTML = `
    ${masthead(true)}
    <main class="site">

      <div class="app-layout">
        <aside class="sidebar">
          <nav class="site-nav">
            <a href="/">Home</a>
          </nav>
        </aside>

        <div class="main-content">
          <section class="profile">
            <span id="profile-avatar"></span>
            <div>
              <h2 id="profile-name"></h2>
              <p id="profile-username"></p>
            </div>
          </section>

          <section class="feed-panel">
            <h2 class="panel-heading">Recent Statuses</h2>
            <div class="feed"></div>
          </section>
        </div>
      </div>
    </main>
  `;

  const profileAvatar = document.querySelector('#profile-avatar');
  const profileName = document.querySelector('#profile-name');
  const profileUsername = document.querySelector('#profile-username');
  const feed = document.querySelector('.feed');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, username, display_name')
    .eq('username', username)
    .single();

  if (profileError) {
    console.error(profileError);
    renderNotFound();
    return;
  }

  profileName.textContent = profile.display_name;
  profileUsername.textContent = `@${profile.username}`;
  profileAvatar.replaceChildren(
    createAvatar(profile.username, profile.display_name)
  );

  const { data: statuses, error: statusesError } = await supabase
    .from('statuses')
    .select('content, created_at')
    .eq('user_id', profile.user_id)
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(5);

  if (statusesError) {
    console.error(statusesError);
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

function renderNotFound() {
  app.innerHTML = `
    ${masthead(true)}
    <main class="site">

      <h2>Page not found</h2>
      <p><a href="/">Back to Status Rodeo</a></p>
    </main>
  `;
}

// A user's avatar, expected at /avatars/<username>.png. Until that file exists
// the slot shows the first letter of the display name. The image only replaces
// the letter once it has loaded, so a missing file never shows a broken image.
function createAvatar(username, displayName) {
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = (displayName || username || '?').charAt(0).toUpperCase();

  const image = new Image();
  image.alt = '';
  image.addEventListener('load', () => {
    avatar.textContent = '';
    avatar.append(image);
  });
  image.src = `/avatars/${encodeURIComponent(username)}.png`;

  return avatar;
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

// The illustrated masthead is its own image asset (public/masthead.webp). The
// words "Status Rodeo" are part of the artwork, so the h1 is visually hidden.
// It links home everywhere except the home page itself.
function masthead(linkHome) {
  const image = `<img
        src="/masthead.webp"
        width="3072"
        height="768"
        alt="Status Rodeo: a cowboy on horseback and a dog look out over a desert valley at sunset"
        fetchpriority="high"
      />`;

  return `
    <header class="masthead">
      <h1 class="visually-hidden">Status Rodeo</h1>
      ${linkHome ? `<a href="/">${image}</a>` : image}
    </header>
  `;
}
