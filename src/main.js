import './style.css';
import { supabase } from './supabase.js';

document.querySelector('#app').innerHTML = `
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

    <p id="auth-status"></p>

    <button id="sign-out-button" type="button" hidden>Sign out</button>

    <section class="composer" hidden>
      <label for="status-input">What's your status?</label>
      <textarea id="status-input" rows="3" placeholder="This ain't my first rodeo."></textarea>
      <button type="button">Post status</button>
    </section>

    <section class="feed"></section>
  </main>
`;

const loginSection = document.querySelector('#login');
const composer = document.querySelector('.composer');
const signOutButton = document.querySelector('#sign-out-button');
const authStatus = document.querySelector('#auth-status');
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
    authStatus.textContent = 'Signed in';
  } else {
    loginSection.hidden = false;
    composer.hidden = true;
    signOutButton.hidden = true;
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

postButton.addEventListener('click', postStatus);

async function loadStatus() {
  const { data, error } = await supabase
    .from('statuses')
    .select('*')
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

    const paragraph = document.createElement('p');
    paragraph.textContent = status.content;

    const time = document.createElement('time');
    time.dateTime = status.created_at;
    time.textContent = new Date(status.created_at).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    article.append(paragraph, time);
    feed.append(article);
  }
}

loadStatus();

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

signInButton.addEventListener('click', signIn);

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

signOutButton.addEventListener('click', signOut);

async function loadSession() {
  const { data } = await supabase.auth.getSession();

  updateAuthUI(data.session);
}

loadSession();