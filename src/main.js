import './style.css';
import { supabase } from './supabase.js';

document.querySelector('#app').innerHTML = `
  <main class="site">
    <header class="site-header">
      <h1>Status Rodeo</h1>
      <p>A tiny status service.</p>
    </header>

    <section class="login">
      <label for="email-input">Email</label>
      <input id="email-input" type="email" />

      <label for="password-input">Password</label>
      <input id="password-input" type="password" />

      <button type="button">Sign in</button>
    </section>

    <section class="composer">
      <label for="status-input">What's your status?</label>
      <textarea id="status-input" rows="3" placeholder="This ain't my first rodeo."></textarea>
      <button type="button">Post status</button>
    </section>

    <section class="feed">
      <article class="status">
        <p>This ain't my first rodeo.</p>
        <time datetime="2026-08-28T21:00">just now</time>
      </article>
    </section>
  </main>
`;

const statusInput = document.querySelector('#status-input');
const postButton = document.querySelector('.composer button');
const statusText = document.querySelector('.status p');
const emailInput = document.querySelector('#email-input');
const passwordInput = document.querySelector('#password-input');
const signInButton = document.querySelector('.login button');

postButton.addEventListener('click', () => {
  const content = statusInput.value.trim();

  if (!content) {
    return;
  }

  statusText.textContent = content;
  statusInput.value = '';
});

async function loadStatus() {
  const { data, error } = await supabase
    .from('statuses')
    .select('*')
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error(error);
    return;
  }

  if (data.length > 0) {
    statusText.textContent = data[0].content;
  }
}

loadStatus();

async function signIn() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailInput.value,
    password: passwordInput.value,
  });

  console.log('sign in data:', data);
  console.log('sign in error:', error);
}

signInButton.addEventListener('click', signIn);