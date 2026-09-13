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
    <main class="site">
      <header class="site-header">
        <h1>Status Rodeo</h1>
        <p>A tiny status service.</p>
      </header>

      <section id="login" class="login">
        <label for="email-input">Email</label>
        <input id="email-input" type="email" />

        <label for="password-input">Password</label>
        <input id="password-input" type="password" />

        <button type="button">Sign in</button>
      </section>

      <div class="auth-info">
        <span id="auth-status"></span>
        <span id="auth-separator" hidden>·</span>
        <button id="sign-out-button" type="button" hidden>Sign out</button>
      </div>

      <section class="composer" hidden>
        <label for="status-input">What's your status?</label>
        <textarea
          id="status-input"
          rows="2"
          placeholder="This ain't my first rodeo."
        ></textarea>
        <button type="button">Post status</button>
      </section>

      <section class="feed"></section>
    </main>
  `;

  const loginSection = document.querySelector('#login');
  const composer = document.querySelector('.composer');
  const signOutButton = document.querySelector('#sign-out-button');
  const authStatus = document.querySelector('#auth-status');
  const authSeparator = document.querySelector('#auth-separator');
  const statusInput = document.querySelector('#status-input');
  const postButton = document.querySelector('.composer button');
  const feed = document.querySelector('.feed');
  const emailInput = document.querySelector('#email-input');
  const passwordInput = document.querySelector('#password-input');
  const signInButton = document.querySelector('.login button');

  function updateAuthUI(session) {
    if (session) {
      loginSection.hidden = true;
      composer.hidden = false;
      signOutButton.hidden = false;
      authSeparator.hidden = false;
      authStatus.textContent = 'Signed in';
    } else {
      loginSection.hidden = false;
      composer.hidden = true;
      signOutButton.hidden = true;
      authSeparator.hidden = true;
      authStatus.textContent = '';
    }
  }

  async function postStatus() {
    const content = statusInput.value.trim();

    if (!content) {
      return;
    }

    const { data, error } = await supabase.auth.getUser();

    if (error) {
      console.error(error);
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
      const article = document.createElement('article');
      article.className = 'status';

      const name = document.createElement('a');
      name.href = `/users/${status.profiles.username}`;
      name.textContent = status.profiles.display_name;

      const paragraph = document.createElement('p');
      paragraph.textContent = status.content;

      const time = createTimeElement(status.created_at);

      article.append(name, paragraph, time);
      feed.append(article);
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
    const { data } = await supabase.auth.getSession();

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
    <main class="site">
      <header class="site-header">
        <h1><a href="/">Status Rodeo</a></h1>
        <p>A tiny status service.</p>
      </header>

      <section class="profile">
        <h2 id="profile-name"></h2>
        <p id="profile-username"></p>
      </section>

      <section class="feed"></section>
    </main>
  `;

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
    const article = document.createElement('article');
    article.className = 'status';

    const paragraph = document.createElement('p');
    paragraph.textContent = status.content;

    const time = createTimeElement(status.created_at);

    article.append(paragraph, time);
    feed.append(article);
  }
}

function renderNotFound() {
  app.innerHTML = `
    <main class="site">
      <header class="site-header">
        <h1><a href="/">Status Rodeo</a></h1>
        <p>A tiny status service.</p>
      </header>

      <h2>Page not found</h2>
      <p><a href="/">Back to Status Rodeo</a></p>
    </main>
  `;
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