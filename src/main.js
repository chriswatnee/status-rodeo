import './style.css';

document.querySelector('#app').innerHTML = `
  <main class="site">
    <header class="site-header">
      <h1>Status Rodeo</h1>
      <p>A tiny status service.</p>
    </header>

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

postButton.addEventListener('click', () => {
  const content = statusInput.value.trim();

  if (!content) {
    return;
  }

  statusText.textContent = content;
  statusInput.value = '';
});