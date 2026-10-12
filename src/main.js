import './style.css';
import { supabase } from './supabase.js';
import { STATUS_LIMIT, countCharacters, truncateToLimit, validateStatus } from './status-limit.js';
import { submitStatus } from './post-status.js';
import { readSortOrder, saveSortOrder } from './sort-order.js';
import { AVATAR_ICONS, avatarLabel, avatarName, avatarPath } from './avatar-icons.js';
import { setAvatar } from './set-avatar.js';
import { deleteStatus } from './delete-status.js';
import { updateStatus } from './update-status.js';
import { relativeTime, absoluteTime } from './relative-time.js';
import { iconMarkup } from './icons.js';
import { createHatTipStore, hatTipCountText } from './hat-tips.js';
import { parseStatusId } from './status-id.js';
import { linkify } from './linkify.js';
import { pickPlaceholder } from './placeholders.js';

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
      image.removeAttribute('srcset');
      image.removeAttribute('sizes');
      image.src = retryUrl(failedUrl, attempt + 1);
    }, IMAGE_RETRY_DELAYS[attempt]);
  },
  true,
);

// Runs a Supabase query again (after 1 s, then 3 s) if it fails, because a single
// dropped request would otherwise leave part of the page empty until a refresh.
// `shouldStop()` ends the retries early, for example after signing out. Returns
// the last result, which still carries the error if every attempt failed.
const LOAD_RETRY_DELAYS = [1000, 3000];

async function withRetry(run, shouldStop = () => false) {
  let result;

  for (let attempt = 0; ; attempt++) {
    try {
      result = await run();
    } catch (error) {
      result = { data: null, error };
    }

    if (!result.error || attempt >= LOAD_RETRY_DELAYS.length || shouldStop()) {
      return result;
    }

    console.warn(`Load failed (attempt ${attempt + 1}), retrying`, result.error);
    await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_DELAYS[attempt]));

    if (shouldStop()) return result;
  }
}

const app = document.querySelector('#app');

// Pages are drawn inside a shared frame (masthead and sidebar) that is built once,
// so moving between pages replaces only the content beside the sidebar and the
// masthead, sign-in state and avatars stay put. `route()` is called at the end
// of this file, once everything it uses exists.
let frame = null;
let navigation = 0;
let announceNext = false;
let pageHooks = {};
let authKnown = false;
let currentSession = null;
// undefined until the signed-in user's profile loads; null if it failed.
let currentProfile;
// What the hat tip buttons show, shared by every status on the page (see hat-tips.js).
const hatTips = createHatTipStore(supabase);
// Ends the signed-in state without asking the server; set by initSidebar().
let expireSession = async () => {};

// `moved` is true when the visitor navigated (not the first load), so the new
// page is announced and focus is moved into it.
function route(moved = false) {
  announceNext = moved;
  const id = ++navigation;
  const isCurrent = () => id === navigation;
  const parts = window.location.pathname.split('/').filter(Boolean);

  if (parts.length === 0) {
    renderHome();
  } else if (parts.length === 2 && parts[0] === 'users') {
    renderUserPage(parts[1], isCurrent);
  } else if (parts.length === 2 && parts[0] === 'statuses') {
    renderStatusPage(parts[1], isCurrent);
  } else if (parts.length === 2 && parts[0] === 'profile' && parts[1] === 'edit') {
    renderEditProfile();
  } else {
    renderNotFound();
  }

  updateNav();

  // Pages that load data (profiles) call pageReady() themselves once their title
  // is known.
  if (parts.length === 0) pageReady();
}

// Tells screen readers which page they are now on and, if the link that was
// clicked is gone, moves focus to the start of the new content so keyboard users
// don't start again from the top of the document.
function pageReady() {
  if (!announceNext) return;

  announceNext = false;

  const announcer = document.querySelector('#route-announcer');

  announcer.textContent = '';
  setTimeout(() => {
    announcer.textContent = document.title;
  }, 50);

  const active = document.activeElement;

  if (!active || active === document.body || !document.contains(active)) {
    frame.page.focus({ preventScroll: true });
  }
}

function navigate(path) {
  if (path !== window.location.pathname + window.location.search) {
    window.history.pushState({}, '', path);
    route(true);
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

  // "Skip to content" moves focus past the sidebar. It is handled here rather
  // than as a plain #page link, which would add a hash to the address and
  // trigger a popstate.
  if (link?.classList.contains('skip-link')) {
    event.preventDefault();
    frame.page.focus();
    return;
  }

  if (!link || link.target || link.hasAttribute('download')) return;
  if (link.getAttribute('href').startsWith('#')) return;

  const url = new URL(link.href, window.location.href);
  const parts = url.pathname.split('/').filter(Boolean);
  const isAppPage =
    parts.length === 0 ||
    (parts.length === 2 && (parts[0] === 'users' || parts[0] === 'statuses')) ||
    (parts.length === 2 && parts[0] === 'profile' && parts[1] === 'edit');

  if (url.origin !== window.location.origin || !isAppPage) return;

  event.preventDefault();
  navigate(url.pathname + url.search);
});

window.addEventListener('popstate', () => route(true));

// Builds the frame on first use, then swaps the page content. `linkHome` is
// whether the masthead links to the home page (everywhere except home).
function mount(markup, { linkHome }) {
  if (!frame) {
    app.innerHTML = `
      <a class="skip-link" href="#page">Skip to content</a>
      ${masthead()}
      <main class="site">
        <div class="app-layout">
          ${sidebarMarkup()}
          <div class="main-content" id="page" tabindex="-1"></div>
        </div>
        <p id="route-announcer" class="visually-hidden" role="status"></p>
        <p id="status-announcer" class="visually-hidden" role="status"></p>
      </main>
    `;
    frame = { page: app.querySelector('#page') };
    watchMasthead();
    initSidebar();
  }

  setMastheadLink(linkHome);
  pageHooks = {};
  frame.page.innerHTML = markup;

  // After a navigation (not the first load) the new content fades and slides in.
  // The class is removed and re-added so the animation restarts every time.
  frame.page.classList.remove('page-enter');

  if (announceNext) {
    void frame.page.offsetWidth;
    frame.page.classList.add('page-enter');
  }
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

// Typing and pasting into a status box stop at the 280-character limit. beforeinput lets the part
// of an insertion that fits go in, without removing any text that is already there. Shared by the
// composer and the editor on your own statuses.
function limitTyping(textarea) {
  textarea.addEventListener('beforeinput', (event) => {
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

    const { value, selectionStart, selectionEnd } = textarea;
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
      textarea.setRangeText(fitted, selectionStart, selectionEnd, 'end');
    }

    textarea.dispatchEvent(new Event('input'));
  });

  textarea.addEventListener('input', () => {
    // Safety net for input that beforeinput cannot cancel (IME, drag and drop).
    if (countCharacters(textarea.value) > STATUS_LIMIT) {
      const caret = textarea.selectionStart;

      textarea.value = truncateToLimit(textarea.value);
      textarea.setSelectionRange(
        Math.min(caret, textarea.value.length),
        Math.min(caret, textarea.value.length)
      );
    }
  });
}

// The composer hint is a random line from src/placeholders.js, different from the last one.
let lastPlaceholder = null;

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
                aria-describedby="char-help"
                aria-keyshortcuts="Control+Enter Meta+Enter"
              ></textarea>
              <span id="char-help" class="visually-hidden">${STATUS_LIMIT} characters maximum.</span>
              <div class="composer-actions">
                <span id="char-count" class="char-count" aria-hidden="true">0/${STATUS_LIMIT}</span>
                <button type="button">${iconMarkup('pencil')}Post</button>
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
  lastPlaceholder = pickPlaceholder(lastPlaceholder);
  statusInput.placeholder = lastPlaceholder;
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
          createAvatar(profile.avatar)
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

  // Typing and pasting stop at the limit (see limitTyping).
  limitTyping(statusInput);

  statusInput.addEventListener('input', () => {
    composerNote.textContent = '';
    updateCounter();
  });

  const postLabel = postButton.innerHTML; // static markup: icon and text

  // While a post is in flight the button says so, keeps its width so nothing
  // beside it moves, and ignores further clicks.
  function setPosting(busy) {
    posting = busy;

    if (busy) {
      postButton.style.width = `${postButton.getBoundingClientRect().width}px`;
      postButton.textContent = 'Posting…';
      postButton.setAttribute('aria-busy', 'true');
    } else {
      postButton.innerHTML = postLabel;
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

        setErrorNote(composerNote, postErrors[result.reason] ?? '');
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
        username,
        avatar
      )
    `,
    toRow: (status) => ({
      id: status.id,
      username: status.profiles.username,
      displayName: status.profiles.display_name,
      avatar: status.profiles.avatar,
      content: status.content,
      createdAt: status.created_at,
      editedAt: status.edited_at,
    }),
    emptyMessage: 'No statuses yet.',
  });

  // A new status belongs at the top of "Latest first", so posting switches back
  // to that order.
  function loadStatus() {
    return pager.load({ ascending: false, motion: 'pop' });
  }

  postButton.addEventListener('click', postStatus);

  // Ctrl+Enter (Cmd+Enter on a Mac) posts, the same as the Post button. Plain Enter still
  // adds a new line. Not while an input method is composing text (the key may only confirm
  // the composition), and not for a held-down key, so it can't post twice.
  statusInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.isComposing || event.repeat) {
      return;
    }

    event.preventDefault();
    postStatus();
  });

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
            <a class="profile-edit" id="profile-edit" href="/profile/edit" hidden>${iconMarkup('edit-profile')}Edit profile</a>
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
    .select('user_id, username, display_name, created_at, avatar')
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
  pageReady();
  profileName.textContent = profile.display_name;
  profileUsername.textContent = `@${profile.username}`;
  profileAvatar.replaceChildren(createAvatar(profile.avatar));

  // "Edit profile" is only for the signed-in owner of this profile.
  const editLink = document.querySelector('#profile-edit');

  setPageHooks({
    onSession(session) {
      editLink.hidden = session?.user.id !== profile.user_id;
    },
  });

  // "Joined Sep 2026 · 14 statuses". The word "Joined" is its own span so that on the very
  // smallest phones it can be dropped from view (kept for screen readers) to make the line fit.
  const joinedDate = new Date(profile.created_at).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });

  function setMeta(statusCount) {
    const joinedWord = document.createElement('span');
    joinedWord.className = 'joined-word';
    joinedWord.textContent = 'Joined ';

    const parts = [joinedWord, joinedDate];

    if (statusCount !== null) {
      parts.push(` · ${statusCount} ${statusCount === 1 ? 'status' : 'statuses'}`);
    }

    profileMeta.replaceChildren(...parts);
  }

  setMeta(null);
  profileMeta.hidden = false;

  const pager = createFeedPager({
    feed,
    more: feedMore,
    sortSelect: document.querySelector('.sort-select'),
    title: document.querySelector('.panel-title'),
    select: 'id, content, created_at, edited_at',
    filter: (query) => query.eq('user_id', profile.user_id),
    toRow: (status) => ({
      id: status.id,
      username: profile.username,
      displayName: profile.display_name,
      avatar: profile.avatar,
      content: status.content,
      createdAt: status.created_at,
      editedAt: status.edited_at,
    }),
    emptyMessage: `${profile.display_name} hasn't posted yet.`,
  });

  pager.load();

  // The profile's status count follows deletes made on this page.
  let statusCount = null;

  feed.addEventListener('statusdeleted', () => {
    if (statusCount !== null && statusCount > 0) {
      statusCount -= 1;
      setMeta(statusCount);
    }
  });

  const { count, error: countError } = await supabase
    .from('statuses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.user_id)
    .eq('visibility', 'public');

  if (countError) {
    console.error(countError);
  } else if (count !== null) {
    statusCount = count;
    setMeta(count);
  }
}

// Shows one user's avatar everywhere it is on the page: the sidebar, the composer, the profile
// card and any status rows by them. Used when you pick a new one, and to put the old one back if
// saving fails. The shared sidebar profile is kept in step so the composer is right on the home
// page afterwards.
function showAvatarEverywhere(username, avatar) {
  if (currentProfile && currentProfile.username === username) currentProfile.avatar = avatar;

  for (const selector of ['#sidebar-avatar', '#composer-avatar', '#profile-avatar', '#edit-avatar']) {
    const slot = document.querySelector(selector);

    if (slot && slot.childElementCount > 0) slot.replaceChildren(createAvatar(avatar));
  }

  for (const row of document.querySelectorAll('.status')) {
    if (row.dataset.username === username) row.querySelector(':scope > .avatar')?.replaceWith(createAvatar(avatar));
  }
}

// The Edit profile page (/profile/edit): your own profile, for the signed-in user (a signed-out
// visitor is told to sign in, and the page fills in when they do). For now the only thing to
// edit is the avatar: the twelve icons as buttons (aria-pressed marks the chosen one). Picking
// one only previews it on this page; Save stores it (and then the avatar changes everywhere),
// Cancel puts the saved one back, and leaving the page drops an unsaved choice. One save at a
// time. The database allows the same and nothing more: only your own row's avatar column can
// be updated.
function renderEditProfile() {
  mount(`
          <section class="feed-panel edit-profile">
            <div class="panel-heading">
              <h2 class="panel-title">Edit profile</h2>
            </div>
            <div class="edit-body"></div>
          </section>
  `, { linkHome: true });

  document.title = 'Edit profile · Status Rodeo';
  pageReady();

  const body = document.querySelector('.edit-body');
  // 'out' (signed out), 'in' (signed in, profile loading) or 'editing'. Signing in again or a
  // refreshed session must not rebuild the page under someone who is choosing.
  let state = '';

  setPageHooks({
    onSession(session) {
      const next = session ? 'in' : 'out';

      if (state === next || (state === 'editing' && next === 'in')) return;

      state = next;
      body.replaceChildren(createFeedMessage(session ? 'Loading your profile…' : 'Sign in to edit your profile.'));
    },
    onProfile(profile) {
      if (state === 'editing') return;

      if (!profile) {
        body.replaceChildren(createFeedMessage("Couldn't load your profile."));
        return;
      }

      state = 'editing';
      showAvatarEditor(body, { ...profile, user_id: currentSession.user.id });
    },
  });
}

function showAvatarEditor(body, me) {
  body.innerHTML = `
            <form class="edit-form" novalidate>
              <div class="edit-identity">
                <span id="edit-avatar"></span>
                <div>
                  <strong class="edit-name"></strong>
                  <span class="edit-username"></span>
                </div>
              </div>

              <h3 id="avatar-heading">Avatar</h3>
              <p id="avatar-help" class="edit-help">Pick the icon that shows beside your name.</p>
              <div class="avatar-choices" role="group" aria-labelledby="avatar-heading" aria-describedby="avatar-help"></div>
              <p class="edit-note" role="status"></p>

              <div class="edit-actions">
                <button type="submit" class="edit-save" disabled>Save</button>
                <button type="button" class="edit-cancel" disabled>Cancel</button>
              </div>

              <p class="edit-back"><a class="edit-back-link" href="">Back to my profile</a></p>
            </form>
  `;

  body.querySelector('.edit-name').textContent = me.display_name;
  body.querySelector('.edit-username').textContent = `@${me.username}`;
  body.querySelector('.edit-back-link').href = `/users/${me.username}`;
  body.querySelector('#edit-avatar').replaceChildren(createAvatar(me.avatar));

  const form = body.querySelector('.edit-form');
  const choices = form.querySelector('.avatar-choices');
  const note = form.querySelector('.edit-note');
  const saveButton = form.querySelector('.edit-save');
  const cancelButton = form.querySelector('.edit-cancel');
  let chosen = avatarName(me.avatar); // what is selected on this page
  let saving = false;

  const isChanged = () => chosen !== avatarName(me.avatar);

  // Selection, preview and the buttons all follow `chosen`. Only the avatar on this page
  // changes before Save; the sidebar, composer and feed keep the stored one.
  function refresh() {
    for (const button of choices.children) {
      button.setAttribute('aria-pressed', String(button.dataset.avatar === chosen));
    }

    form.querySelector('#edit-avatar').replaceChildren(createAvatar(chosen));
    saveButton.disabled = saving || !isChanged();
    cancelButton.disabled = saving || !isChanged();
  }

  function choose(name) {
    if (saving || name === chosen) return;

    chosen = name;
    setErrorNote(note, '');
    note.textContent = isChanged() ? 'Not saved yet.' : '';
    refresh();
  }

  cancelButton.addEventListener('click', () => {
    if (saving) return;

    chosen = avatarName(me.avatar);
    setErrorNote(note, '');
    note.textContent = '';
    refresh();
    choices.querySelector('[aria-pressed="true"]')?.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const userId = currentSession?.user.id;

    if (saving || !isChanged() || !userId || userId !== me.user_id) return;

    const name = chosen;
    const saveLabel = saveButton.textContent;

    saving = true;
    form.setAttribute('aria-busy', 'true');
    saveButton.style.width = `${saveButton.getBoundingClientRect().width}px`;
    saveButton.textContent = 'Saving…';
    saveButton.setAttribute('aria-busy', 'true');
    setErrorNote(note, '');
    refresh();

    const result = await setAvatar(supabase, { userId, avatar: name });

    saving = false;
    form.removeAttribute('aria-busy');
    saveButton.textContent = saveLabel;
    saveButton.removeAttribute('aria-busy');
    saveButton.style.width = '';

    if (result.ok) {
      me.avatar = name;
      showAvatarEverywhere(me.username, name);
      // The note is a live region, so this is also what a screen reader hears.
      note.textContent = `Avatar saved as ${avatarLabel(name).toLowerCase()}.`;
      refresh();
      // The Save button is disabled again, so keep the keyboard focus on the page.
      choices.querySelector('[aria-pressed="true"]')?.focus();
      return;
    }

    console.error(result.error);

    if (result.reason === 'session-expired') {
      // Signing out replaces this page's content, so the message goes with the sign-in form.
      await expireSession();

      const loginError = document.querySelector('#login-error');
      setErrorNote(loginError, 'Your session expired. Sign in again to change your avatar.');
      loginError.hidden = false;
      return;
    }

    // The choice stays selected so Save can be tried again.
    setErrorNote(note, "Couldn't save your avatar. Try again.");
    refresh();
  });

  for (const icon of AVATAR_ICONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'avatar-choice';
    button.dataset.avatar = icon.name;
    button.title = icon.label;
    button.setAttribute('aria-label', icon.label);

    const image = new Image();
    image.alt = '';
    image.src = avatarPath(icon.name);
    button.append(image);

    button.addEventListener('click', () => choose(icon.name));
    choices.append(button);
  }

  refresh();
}

// One status on its own page (/statuses/<id>), the stable address for a status. It
// shows the same row as the feeds, hat tip included. Anything that is not a public
// status (a bad id, a missing or non-public status) is "Page not found"; a failed
// request is not, so being offline doesn't look like a missing page.
async function renderStatusPage(segment, isCurrent) {
  const id = parseStatusId(segment);

  if (id === null) {
    renderNotFound();
    return;
  }

  mount(`
          <section class="feed-panel">
            <div class="panel-heading">
              <h2 class="panel-title">Status</h2>
            </div>
            <div class="feed" aria-busy="true">${feedPlaceholder(1)}</div>
          </section>
  `, { linkHome: true });

  const feed = document.querySelector('.feed');

  async function load() {
    feed.setAttribute('aria-busy', 'true');
    feed.innerHTML = feedPlaceholder(1);

    const { data: status, error } = await withRetry(
      () =>
        supabase
          .from('statuses')
          .select('id, content, created_at, edited_at, profiles(display_name, username, avatar)')
          .eq('id', id)
          .eq('visibility', 'public')
          .maybeSingle(),
      () => !isCurrent()
    );

    // The visitor may have moved to another page while this was loading.
    if (!isCurrent()) return;

    feed.removeAttribute('aria-busy');

    if (error) {
      console.error(error);

      document.title = 'Status · Status Rodeo';
      pageReady();

      const message = createFeedMessage("Couldn't load this status.");
      setErrorNote(message, "Couldn't load this status.");
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', load);
      message.append(' ', retry);
      feed.replaceChildren(message);
      return;
    }

    if (!status || !status.profiles) {
      renderNotFound();
      return;
    }

    const { display_name: displayName, username, avatar } = status.profiles;

    document.title = `Status by ${displayName} (@${username}) · Status Rodeo`;
    pageReady();
    feed.replaceChildren(
      createStatusRow({
        id: status.id,
        username,
        displayName,
        avatar,
        content: status.content,
        createdAt: status.created_at,
        editedAt: status.edited_at,
      })
    );
    syncStatusMenus();
    loadHatTips([status.id]);
    resolveMentions();
  }

  await load();
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
  // Starts in the order the visitor last picked (Latest first if none).
  let ascending = readSortOrder() === 'asc';
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

    const { data, error } = await withRetry(() => query);

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

    syncStatusMenus();

    cursor = rows[rows.length - 1].created_at;

    loadHatTips(rows.map((status) => status.id));
    resolveMentions();
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

      const message = createFeedMessage("Couldn't load statuses.");
      setErrorNote(message, "Couldn't load statuses.");
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => load());
      message.append(' ', retry);
      feed.append(message);
      return;
    }

    if (page.rows.length === 0) {
      feed.append(createFeedMessage(emptyMessage));
      return;
    }

    appendRows(page.rows, options.motion);
    more.hidden = !page.hasMore;
  }

  // A deleted status leaves the feed (see removeDeletedStatus). If that was the last row on
  // the page, start over: the next page of statuses (or the empty message) takes its place.
  feed.addEventListener('statusdeleted', () => {
    if (!feed.querySelector('.status')) load();
  });

  sortSelect.addEventListener('change', () => {
    saveSortOrder(sortSelect.value);
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

  // On an iPhone, a tap that lands while the page is still moving (a fling or the
  // bounce at the bottom) is used to stop the movement: the touch reaches the
  // button, but the browser never sends the click, so the first tap seems to do
  // nothing. If a short, still touch on the button ends with no click following,
  // press the button ourselves. A normal tap sets `clicked` first, so it never
  // runs twice.
  let lastPress = null;

  button.addEventListener('pointerdown', (event) => {
    lastPress = event.pointerType === 'touch'
      ? { x: event.clientX, y: event.clientY, at: performance.now(), clicked: false }
      : null;
  });

  button.addEventListener('click', () => {
    if (lastPress) lastPress.clicked = true;
  });

  button.addEventListener('pointercancel', () => {
    lastPress = null;
  });

  button.addEventListener('pointerup', (event) => {
    const press = lastPress;

    if (!press || event.pointerType !== 'touch') return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) return;
    if (performance.now() - press.at > 500) return;

    setTimeout(() => {
      if (!press.clicked) {
        press.clicked = true;
        button.click();
      }
    }, 80);
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
            </div>
          </section>

          <p id="profile-error" class="profile-error" role="status" hidden>
            ${iconMarkup('error', 'icon-error')}Couldn't load your profile.
            <button type="button">Try again</button>
          </p>

          <form id="login" class="login" novalidate hidden>
            <label for="email-input">Email</label>
            <input id="email-input" name="email" type="email"
              autocomplete="username" autocapitalize="none" spellcheck="false" />

            <label for="password-input">Password</label>
            <input id="password-input" name="password" type="password"
              autocomplete="current-password" />

            <p id="login-error" class="login-error" role="alert" hidden></p>

            <button type="submit">${iconMarkup('sign-in')}Sign in</button>
          </form>

          <nav class="site-nav">
            <a href="/">${iconMarkup('home')}Home</a>
            <a id="profile-link" href="#" hidden>${iconMarkup('profile')}My profile</a>
          </nav>

          <div class="auth-info">
            <span id="auth-status"></span>
            <span id="auth-separator" hidden>·</span>
            <button id="sign-out-button" type="button" hidden>
              ${iconMarkup('sign-out')}Sign out
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
  const profileLink = document.querySelector('#profile-link');
  const profileErrorNote = document.querySelector('#profile-error');

  const loginSection = document.querySelector('#login');
  const signOutButton = document.querySelector('#sign-out-button');
  const authStatus = document.querySelector('#auth-status');
  const authSeparator = document.querySelector('#auth-separator');
  const emailInput = document.querySelector('#email-input');
  const passwordInput = document.querySelector('#password-input');
  const signInButton = document.querySelector('.login button');
  const loginError = document.querySelector('#login-error');

  async function loadProfile(userId) {
    profileErrorNote.hidden = true;

    // Compared with the current session rather than asking Supabase again, which
    // could briefly answer "no session" and silently drop the profile.
    const signedOutMeanwhile = () => currentSession?.user.id !== userId;

    const { data: profile, error } = await withRetry(
      () =>
        supabase
          .from('profiles')
          .select('username, display_name, avatar')
          .eq('user_id', userId)
          .single(),
      signedOutMeanwhile
    );

    // Avoid displaying a profile if the user signed out
    // while the request was running.
    if (signedOutMeanwhile()) return;

    if (error) {
      console.error(error);
      currentProfile = null;
      profileErrorNote.hidden = false;
      pageHooks.onProfile?.(null);
      return;
    }

    sidebarDisplayName.textContent = profile.display_name;
    sidebarUsername.textContent = `@${profile.username}`;
    sidebarAvatar.replaceChildren(createAvatar(profile.avatar));

    profileLink.href = `/users/${profile.username}`;

    sidebarProfile.hidden = false;
    profileLink.hidden = false;

    currentProfile = profile;
    updateNav();
    syncStatusMenus();
    pageHooks.onProfile?.(profile);
  }

  function updateAuthUI(session) {
    authKnown = true;
    currentSession = session;
    if (!session) currentProfile = undefined;

    syncStatusMenus();
    pageHooks.onSession?.(session);
    syncHatTips(session);

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
      profileErrorNote.hidden = true;
      profileLink.hidden = true;
      updateNav();

      sidebarDisplayName.textContent = '';
      sidebarUsername.textContent = '';
      sidebarAvatar.replaceChildren();
      profileLink.href = '#';
    }
  }

  let signingIn = false;

  async function signIn(event) {
    event.preventDefault();
    if (signingIn) return;

    if (!emailInput.value.trim() || !passwordInput.value) {
      setErrorNote(loginError, 'Enter your email and password.');
      loginError.hidden = false;
      (emailInput.value.trim() ? passwordInput : emailInput).focus();
      return;
    }

    loginError.hidden = true;
    signingIn = true;
    const label = signInButton.innerHTML;
    signInButton.style.minWidth = `${signInButton.offsetWidth}px`;
    signInButton.setAttribute('aria-busy', 'true');
    signInButton.textContent = 'Signing in…';

    let result;
    try {
      result = await supabase.auth.signInWithPassword({
        email: emailInput.value.trim(),
        password: passwordInput.value,
      });
    } catch (error) {
      result = { error };
    }

    signingIn = false;
    signInButton.innerHTML = label;
    signInButton.style.minWidth = '';
    signInButton.removeAttribute('aria-busy');

    const { data, error } = result;

    if (error) {
      console.error(error);
      // 400 means the server rejected the credentials; anything else
      // (no status, 5xx, 429) is not the visitor's typing.
      const rejected = error.status === 400 || error.status === 401;
      setErrorNote(
        loginError,
        rejected
          ? 'Wrong email or password.'
          : "Couldn't sign in. Check your connection and try again."
      );
      loginError.hidden = false;
      if (rejected) {
        passwordInput.select();
      }
      return;
    }

    passwordInput.value = '';
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
    loginError.hidden = true;
    updateAuthUI(null);
  }

  // A hat tip save found the login no longer valid: sign out here without asking the
  // server (which may not be reachable or may no longer know the session).
  expireSession = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error) {
      console.error(error);
    }

    passwordInput.value = '';
    updateAuthUI(null);
  };

  async function loadSession() {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error(error);
      updateAuthUI(null);
      return;
    }

    updateAuthUI(data.session);
  }

  profileErrorNote.querySelector('button').addEventListener('click', () => {
    if (currentSession) loadProfile(currentSession.user.id);
  });

  loginSection.addEventListener('submit', signIn);
  signOutButton.addEventListener('click', signOut);

  loadSession();
}

function renderNotFound() {
  document.title = 'Page not found · Status Rodeo';
  mount(`
    <section class="notice">
      <h2>Page not found</h2>
      <p><a href="/">Back to Status Rodeo</a></p>
    </section>
  `, { linkHome: true });
  pageReady();
}

// A user's avatar: one of the Western icons (src/avatar-icons.js), /avatars/icons/<name>.webp. A
// value that is not one of them shows the default icon. While the file loads the slot shows a
// pulsing placeholder; once it loads the image replaces the placeholder. If it fails, or takes
// more than a few seconds, the slot stays a plain empty tile (there is no letter fallback) and
// the load is retried twice in the background; the image appears if a retry succeeds.
function createAvatar(avatar) {
  const slot = document.createElement('span');
  slot.className = 'avatar';
  slot.dataset.state = 'loading';

  const url = avatarPath(avatar);

  const giveUp = setTimeout(() => {
    slot.dataset.state = 'fallback';
  }, 8000);

  function load(attempt) {
    const image = new Image();
    image.alt = '';

    image.addEventListener('load', () => {
      clearTimeout(giveUp);
      slot.replaceChildren(image);
      slot.dataset.state = 'loaded';
    });

    image.addEventListener('error', () => {
      clearTimeout(giveUp);
      slot.dataset.state = 'fallback';
      warnImageFailed(url, attempt);

      if (attempt < IMAGE_RETRY_DELAYS.length) {
        setTimeout(() => load(attempt + 1), IMAGE_RETRY_DELAYS[attempt]);
      }
    });

    image.src = retryUrl(url, attempt);
  }

  load(0);

  return slot;
}

// An empty avatar in its loading state, for slots whose user is not known yet.
function createLoadingAvatar() {
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.dataset.state = 'loading';

  return avatar;
}

// Static placeholder rows shown in the feed until the statuses arrive.
function feedPlaceholder(rows = 3) {
  const row = `
    <div class="status-skeleton" aria-hidden="true">
      <span class="skeleton-avatar"></span>
      <span class="skeleton-lines"><span></span><span></span></span>
    </div>
  `;

  return `${row.repeat(rows)}<p class="visually-hidden" role="status">Loading statuses</p>`;
}

// A short line of text shown inside the feed panel instead of statuses.
// Sets an error message with the decorative error icon in front of it. An empty
// message clears the note (and the icon with it). The text goes in as text; only
// the static icon markup is inserted as HTML.
function setErrorNote(element, text) {
  element.textContent = text;

  if (text) element.insertAdjacentHTML('afterbegin', iconMarkup('error', 'icon-error'));
}

function createFeedMessage(text) {
  const message = document.createElement('p');
  message.className = 'feed-message';
  message.textContent = text;

  return message;
}

// The text of a status. Web addresses (http:// and https:// only, see linkify.js) become
// links; everything else is text. Nothing from a status is ever parsed as HTML: the
// parts become text nodes and link elements built here, and a link's shown text is the
// address exactly as typed. A link to another site opens in a new tab and carries
// noopener, noreferrer, nofollow and ugc; a link to this site is followed in the app
// like any other app link (the click handler picks up app pages).
function fillStatusText(element, content) {
  const parts = linkify(content);

  if (!parts.some((part) => part.type === 'mention')) {
    fillParts(element, content, parts);
    return;
  }

  // @mentions: a name already known to exist is a link at once; a known-missing one is
  // plain text; an unchecked one is a marked span of plain text until resolveMentions()
  // has asked the database (see below).
  element.replaceChildren(
    ...parts.map((part) => {
      if (part.type === 'mention') return mentionNode(part);
      return partNode(part);
    })
  );
}

function fillParts(element, content, parts) {
  if (parts.length === 1 && parts[0].type === 'text') {
    element.textContent = content;
    return;
  }

  element.replaceChildren(...parts.map(partNode));
}

function partNode(part) {
  if (part.type === 'text') return document.createTextNode(part.text);

  const link = document.createElement('a');
  link.className = 'status-link';
  link.href = part.href;
  link.textContent = part.text;

  if (new URL(part.href).origin !== window.location.origin) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer nofollow ugc';
    link.setAttribute('aria-label', `${part.text} (opens in a new tab)`);
  }

  return link;
}

// Which @names exist: true or false once the database has answered, absent until then.
// Profiles are public and usernames can't be changed from the app, so the answer is kept
// for as long as the page stays open.
const knownUsernames = new Map();

function mentionLink(username, text) {
  const link = document.createElement('a');
  link.className = 'status-link status-mention';
  link.href = `/users/${username}`;
  link.textContent = text;

  return link;
}

function mentionNode(part) {
  const known = knownUsernames.get(part.username);

  if (known === true) return mentionLink(part.username, part.text);
  if (known === false) return document.createTextNode(part.text);

  const pending = document.createElement('span');
  pending.dataset.mention = part.username;
  pending.textContent = part.text;

  return pending;
}

// One request for the @names on the page that haven't been checked. Only a name that is
// really a profile becomes a link, so no mention leads to "Page not found". If the request
// fails the names simply stay plain text and are tried again next time they are drawn.
async function resolveMentions() {
  const names = [...new Set([...document.querySelectorAll('[data-mention]')].map((el) => el.dataset.mention))].slice(0, 50);

  if (names.length === 0) return;

  const { data, error } = await withRetry(() => supabase.from('profiles').select('username').in('username', names));

  if (error) {
    console.error(error);
    return;
  }

  const found = new Set(data.map((row) => row.username));

  for (const name of names) knownUsernames.set(name, found.has(name));

  for (const pending of document.querySelectorAll('[data-mention]')) {
    const known = knownUsernames.get(pending.dataset.mention);

    if (known === true) pending.replaceWith(mentionLink(pending.dataset.mention, pending.textContent));
    else if (known === false) pending.replaceWith(document.createTextNode(pending.textContent));
  }
}

// The text and edit time each row shows, so the editor starts from what is on screen.
const statusTexts = new WeakMap();

// "· edited" after the time, on a status whose text was changed after posting. Plain text (not a
// <time>, so the minute refresh leaves it alone); the tooltip has when. `sub` is passed while the
// row is being built, before it is in the page.
function setEditedLabel(row, editedAt, sub = row.querySelector('.status-sub')) {
  sub.querySelector('.status-edited')?.remove();

  if (!editedAt) return;

  const label = document.createElement('span');
  label.className = 'status-edited';
  label.textContent = 'edited';
  label.title = `Edited ${absoluteTime(editedAt)}`;
  sub.append(label);
}

function createStatusRow({ id, username, displayName, avatar, content, createdAt, editedAt = null }) {
  const article = document.createElement('article');
  article.className = 'status';
  // So a changed avatar can be swapped in on rows already on the page.
  article.dataset.username = username;
  if (id !== undefined) article.dataset.statusId = String(id);

  const name = document.createElement('a');
  name.className = 'status-name';
  name.href = `/users/${username}`;
  name.textContent = displayName;

  // "@chris" beside the display name. Plain muted text: the name next to it is the link to the
  // profile, so a second link to the same place isn't needed.
  const handle = document.createElement('span');
  handle.className = 'status-handle';
  handle.textContent = `@${username}`;

  const meta = document.createElement('div');
  meta.className = 'status-meta';
  const time = createTimeElement(createdAt);

  // The time is the link to this status's own page, like the timestamp on other
  // social sites. It stays a plain, muted time (see .status-time).
  // "@chris · 3 days ago" is one unit: beside the name when the row is wide enough, otherwise
  // the whole unit moves to a second line, so the dot never starts a line.
  const sub = document.createElement('div');
  sub.className = 'status-sub';

  if (id !== undefined) {
    const permalink = document.createElement('a');
    permalink.className = 'status-time';
    permalink.href = `/statuses/${id}`;
    permalink.append(time);
    sub.append(handle, permalink);
  } else {
    sub.append(handle, time);
  }

  meta.append(name, sub);
  setEditedLabel(article, editedAt, sub);

  const paragraph = document.createElement('p');
  fillStatusText(paragraph, content);
  // What the row currently shows, for the editor (see startEdit).
  statusTexts.set(article, { content, editedAt });

  const body = document.createElement('div');
  body.className = 'status-body';
  body.append(meta, paragraph);

  if (id !== undefined) body.append(createHatTipActions(id));

  article.append(createAvatar(avatar), body);

  return article;
}

// Hat tips. Every status has a "Tip" button (named "Tip your hat") and its count. What they show
// lives in `hatTips` (hat-tips.js), so the same status reads the same wherever it is
// on the page, and a tap changes the count at once and is undone if the save fails.
// Signed-out visitors see the counts; the button tells them to sign in.
let hatTipSerial = 0;

function createHatTipActions(statusId) {
  const actions = document.createElement('div');
  actions.className = 'status-actions';
  actions.dataset.hatStatus = String(statusId);
  actions.dataset.state = 'loading'; // keeps its space, invisible, until the counts arrive

  // What is drawn beside the button is just the number. The full wording ("2 hat tips")
  // is in `.hat-count`, which only screen readers see; the button describes itself with it.
  const number = document.createElement('span');
  number.className = 'hat-number';
  number.setAttribute('aria-hidden', 'true');
  number.hidden = true;

  const count = document.createElement('span');
  count.className = 'hat-count visually-hidden';
  count.id = `hat-count-${++hatTipSerial}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hat-tip';
  button.setAttribute('aria-describedby', count.id);
  // Static markup. The label is there from the start, so the space reserved while the
  // counts load is the height of the finished button. The visible word is short because
  // the hat icon says the rest; the full phrase is the button's name and tooltip.
  button.innerHTML = `${iconMarkup('hat-tip')}<span class="hat-tip-label">Tip</span>`;
  button.setAttribute('aria-label', 'Tip your hat');
  button.title = 'Tip your hat';

  // A live region, so a message that appears under the button is read out.
  const note = document.createElement('div'); // not a <p>: `.status p` is the status text
  note.className = 'hat-note';
  note.setAttribute('role', 'status');

  actions.append(button, number, count, note);
  button.addEventListener('click', () => tipHat(statusId, actions));

  renderHatTipActions(actions);

  return actions;
}

function renderHatTipActions(actions) {
  const info = hatTips.get(Number(actions.dataset.hatStatus));

  if (!info) return;

  const button = actions.querySelector('.hat-tip');
  const count = actions.querySelector('.hat-count');
  const number = actions.querySelector('.hat-number');

  actions.dataset.state = 'ready';
  button.setAttribute('aria-pressed', String(info.tipped));
  button.setAttribute('aria-label', info.tipped ? 'Hat tipped' : 'Tip your hat');
  button.title = info.tipped ? 'Take back your hat tip' : 'Tip your hat';
  button.querySelector('.hat-tip-label').textContent = info.tipped ? 'Tipped' : 'Tip';

  if (info.pending) {
    button.setAttribute('aria-busy', 'true');
  } else {
    button.removeAttribute('aria-busy');
  }

  // With no tips no number is drawn, but the count is still there for screen readers.
  count.textContent = hatTipCountText(info.count);
  number.textContent = String(info.count);
  number.hidden = info.count === 0;
}

function renderHatTips(statusIds) {
  for (const id of statusIds) {
    for (const actions of document.querySelectorAll(`[data-hat-status="${id}"]`)) {
      renderHatTipActions(actions);
    }
  }
}

hatTips.subscribe(renderHatTips);

function showHatNote(actions, text, isError = false) {
  const note = actions.querySelector('.hat-note');

  if (isError && text) {
    setErrorNote(note, text);
  } else {
    note.textContent = text;
  }
}

async function tipHat(statusId, actions) {
  const userId = currentSession?.user?.id;

  if (!userId) {
    showHatNote(actions, 'Sign in to tip your hat.');
    return;
  }

  showHatNote(actions, '');

  const result = await hatTips.toggle(statusId, userId);

  if (result.ok || result.reason === 'busy' || result.reason === 'unknown') return;

  console.error(result.error);

  if (result.reason === 'session-expired') {
    // Signing out first, because it clears every note on the page.
    await expireSession();
    showHatNote(actions, 'Your session expired. Sign in again to tip your hat.', true);
    return;
  }

  showHatNote(actions, "Couldn't save your hat tip. Try again.", true);
}

// One request for the statuses just drawn. If it fails (after the usual retries) the
// feed stays as it is and those statuses simply have no hat tip button.
async function loadHatTips(statusIds) {
  const result = await withRetry(() => hatTips.load(statusIds));

  if (result.error) {
    console.error(result.error);
  }

  const unavailable = result.error ? statusIds.filter((id) => !hatTips.get(id)) : result.missing;

  for (const id of unavailable) {
    for (const actions of document.querySelectorAll(`[data-hat-status="${id}"]`)) {
      actions.dataset.state = 'unavailable';
    }
  }
}

// Which statuses the visitor has tipped depends on who is signed in, so when that
// changes the buttons already on the page are brought up to date. The first call
// (the session being found at page load) is skipped: the feed asks for its own
// hat tips with that same session.
let hatTipUser;

function syncHatTips(session) {
  const userId = session?.user.id ?? null;

  for (const note of document.querySelectorAll('.hat-note')) note.textContent = '';

  if (hatTipUser === undefined) {
    hatTipUser = userId;
    return;
  }

  if (userId === hatTipUser) return;

  hatTipUser = userId;

  if (!userId) {
    hatTips.clearTipped();
    return;
  }

  const ids = [...document.querySelectorAll('[data-hat-status]')].map((actions) => Number(actions.dataset.hatStatus));

  if (ids.length > 0) loadHatTips(ids);
}

// The "…" menu on your own statuses. It exists only on rows whose @username is the signed-in
// user's (syncStatusMenus adds and removes it when the signed-in state or the rows change), so
// other people and signed-out visitors never see it. The database allows the same and nothing
// more: only your own rows can be deleted. For now the only item is Delete.
let statusMenuSerial = 0;

function createStatusMenu(row) {
  const serial = ++statusMenuSerial;

  const wrap = document.createElement('div');
  wrap.className = 'status-menu';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'status-menu-button';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', `status-menu-${serial}`);
  button.setAttribute('aria-label', 'More actions for your status');
  button.title = 'More actions';
  button.innerHTML = iconMarkup('more');

  const list = document.createElement('div');
  list.className = 'status-menu-list';
  list.id = `status-menu-${serial}`;
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', 'Your status');
  list.hidden = true;

  const editItem = document.createElement('button');
  editItem.type = 'button';
  editItem.className = 'status-menu-item status-menu-edit';
  editItem.setAttribute('role', 'menuitem');
  editItem.innerHTML = `${iconMarkup('pencil')}<span>Edit</span>`;

  const deleteItem = document.createElement('button');
  deleteItem.type = 'button';
  deleteItem.className = 'status-menu-item status-menu-delete';
  deleteItem.setAttribute('role', 'menuitem');
  deleteItem.innerHTML = `${iconMarkup('delete')}<span>Delete</span>`;

  list.append(editItem, deleteItem);
  wrap.append(button, list);

  editItem.addEventListener('click', () => {
    closeStatusMenu(wrap);
    startEdit(row, button);
  });

  deleteItem.addEventListener('click', () => {
    closeStatusMenu(wrap);
    showDeleteConfirm(row, button);
  });

  return wrap;
}

function statusMenuItems(wrap) {
  return [...wrap.querySelectorAll('[role="menuitem"]')];
}

function openStatusMenu(wrap) {
  closeStatusMenus(wrap);

  wrap.querySelector('.status-menu-list').hidden = false;
  wrap.querySelector('.status-menu-button').setAttribute('aria-expanded', 'true');
  statusMenuItems(wrap)[0]?.focus();
}

function closeStatusMenu(wrap, returnFocus = false) {
  const list = wrap.querySelector('.status-menu-list');

  if (list.hidden) return;

  list.hidden = true;
  wrap.querySelector('.status-menu-button').setAttribute('aria-expanded', 'false');

  if (returnFocus) wrap.querySelector('.status-menu-button').focus();
}

// Closes every open menu (except `keep`), without moving focus.
function closeStatusMenus(keep = null) {
  for (const wrap of document.querySelectorAll('.status-menu')) {
    if (wrap !== keep) closeStatusMenu(wrap);
  }
}

// One set of listeners for every menu on the page (menus come and go with the rows).
document.addEventListener('click', (event) => {
  const button = event.target.closest?.('.status-menu-button');

  if (!button) return;

  const wrap = button.closest('.status-menu');

  if (button.getAttribute('aria-expanded') === 'true') {
    closeStatusMenu(wrap);
  } else {
    openStatusMenu(wrap);
  }
});

// Clicking or tapping anywhere outside an open menu closes it.
document.addEventListener('pointerdown', (event) => {
  for (const wrap of document.querySelectorAll('.status-menu')) {
    if (!wrap.contains(event.target)) closeStatusMenu(wrap);
  }
});

// Moving focus out of an open menu (Tab, a screen reader moving away) closes it. Not while a
// tap or click is under way: iOS Safari answers a tap on a button by focusing the nearest
// focusable ancestor (the page container) between the touch and the click, and closing the menu
// then made the tap land on the feed instead of the menu item (Edit and Delete did nothing).
// A pointer outside the menu closes it through the pointerdown listener above.
let lastPointerDown = -Infinity;

document.addEventListener(
  'pointerdown',
  () => {
    lastPointerDown = performance.now();
  },
  true
);

document.addEventListener('focusin', (event) => {
  if (performance.now() - lastPointerDown < 800) return;

  for (const wrap of document.querySelectorAll('.status-menu')) {
    if (!wrap.contains(event.target)) closeStatusMenu(wrap);
  }
});

document.addEventListener('keydown', (event) => {
  const wrap = event.target.closest?.('.status-menu');

  if (!wrap) return;

  const button = wrap.querySelector('.status-menu-button');
  const open = button.getAttribute('aria-expanded') === 'true';
  const items = statusMenuItems(wrap);

  if (event.key === 'Escape' && open) {
    event.preventDefault();
    closeStatusMenu(wrap, true);
    return;
  }

  if (event.target === button && !open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    openStatusMenu(wrap);
    return;
  }

  if (!open || !items.includes(event.target)) return;

  const index = items.indexOf(event.target);
  const target = {
    ArrowDown: items[(index + 1) % items.length],
    ArrowUp: items[(index - 1 + items.length) % items.length],
    Home: items[0],
    End: items[items.length - 1],
  }[event.key];

  if (target) {
    event.preventDefault();
    target.focus();
  } else if (event.key === 'Tab') {
    closeStatusMenu(wrap, true);
  }
});

// Gives your own rows their menu and takes it away from everyone else's. Run whenever rows are
// drawn and whenever the signed-in state or profile changes.
function syncStatusMenus() {
  const me = currentSession ? currentProfile?.username : undefined;

  for (const row of document.querySelectorAll('.status[data-status-id]')) {
    const mine = me !== undefined && row.dataset.username === me;
    const menu = row.querySelector('.status-menu');

    if (mine && !menu) {
      row.classList.add('has-menu');
      row.querySelector('.status-meta').after(createStatusMenu(row));
    } else if (!mine && menu) {
      menu.remove();
      row.classList.remove('has-menu', 'editing');
      row.querySelector('.status-confirm')?.remove();

      // An unsaved edit goes with the sign-in it belonged to.
      if (row.querySelector('.status-edit')) {
        row.querySelector('.status-edit').remove();
        row.querySelector('.status-body > p').hidden = false;
      }
    }
  }
}

// The editor for your own status: the text in the same kind of box as the composer, with the
// counter, Save and Cancel, in place of the status text. Save stays disabled until the text is
// valid (1 to 280 characters, not blank) and different from what is saved; Ctrl+Enter (Cmd+Enter
// on a Mac) saves; Escape and Cancel put things back. While saving, the text is read-only and the
// button says "Saving…". A failure keeps the editor and the text.
let statusEditSerial = 0;

function startEdit(row, menuButton) {
  const existing = row.querySelector('.status-edit');

  if (existing) {
    existing.querySelector('textarea').focus();
    return;
  }

  row.querySelector('.status-confirm')?.remove();

  const paragraph = row.querySelector('.status-body > p');
  const saved = statusTexts.get(row);
  const serial = ++statusEditSerial;

  const form = document.createElement('form');
  form.className = 'status-edit';
  form.noValidate = true;

  const box = document.createElement('div');
  box.className = 'composer-fields';

  const label = document.createElement('label');
  label.className = 'visually-hidden';
  label.htmlFor = `status-edit-text-${serial}`;
  label.textContent = 'Edit your status';

  const input = document.createElement('textarea');
  input.id = `status-edit-text-${serial}`;
  input.rows = 3;
  input.value = saved.content;
  input.setAttribute('aria-describedby', `status-edit-help-${serial}`);
  input.setAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');

  const help = document.createElement('span');
  help.id = `status-edit-help-${serial}`;
  help.className = 'visually-hidden';
  help.textContent = `${STATUS_LIMIT} characters maximum.`;

  const counter = document.createElement('span');
  counter.className = 'char-count';
  counter.setAttribute('aria-hidden', 'true');

  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'edit-save';
  saveButton.textContent = 'Save';
  saveButton.disabled = true;

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'edit-cancel';
  cancelButton.textContent = 'Cancel';

  const buttons = document.createElement('div');
  buttons.className = 'status-edit-buttons';
  buttons.append(saveButton, cancelButton);

  const actions = document.createElement('div');
  actions.className = 'composer-actions';
  actions.append(counter, buttons);

  box.append(label, input, help, actions);

  const note = document.createElement('div'); // a live region: failures are read out
  note.className = 'status-edit-note';
  note.setAttribute('role', 'status');

  const announce = document.createElement('div'); // "n characters left", only near the limit
  announce.className = 'visually-hidden';
  announce.setAttribute('role', 'status');

  form.append(box, note, announce);

  paragraph.hidden = true;
  paragraph.after(form);
  row.classList.add('editing');

  limitTyping(input);

  let saving = false;
  let announceTimer;

  function refresh() {
    const count = countCharacters(input.value);
    const remaining = STATUS_LIMIT - count;
    const checked = validateStatus(input.value);

    counter.textContent = `${count}/${STATUS_LIMIT}`;
    counter.classList.toggle('char-count-near', remaining <= 20);
    saveButton.disabled = saving || !checked.ok || checked.content === saved.content;

    // Screen readers hear nothing until the limit is close, and then only the settled value.
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      if (remaining > 20) announce.textContent = '';
      else if (remaining <= 0) announce.textContent = 'Character limit reached.';
      else announce.textContent = `${remaining} characters left.`;
    }, 500);
  }

  function close(returnFocus) {
    clearTimeout(announceTimer);
    form.remove();
    paragraph.hidden = false;
    row.classList.remove('editing');

    if (returnFocus && menuButton.isConnected) menuButton.focus();
  }

  function setSaving(busy) {
    saving = busy;
    input.readOnly = busy;
    cancelButton.disabled = busy;

    if (busy) {
      saveButton.style.width = `${saveButton.getBoundingClientRect().width}px`;
      saveButton.textContent = 'Saving…';
      saveButton.setAttribute('aria-busy', 'true');
    } else {
      saveButton.textContent = 'Save';
      saveButton.removeAttribute('aria-busy');
      saveButton.style.width = '';
    }

    refresh();
  }

  async function save() {
    if (saving || saveButton.disabled) return;

    setSaving(true);
    note.textContent = '';

    const result = await updateStatus(supabase, { id: Number(row.dataset.statusId), content: input.value });

    // Signed out (which removes the editor) or moved on while it was saving.
    if (!form.isConnected) {
      if (result.reason === 'session-expired') showSessionExpired('save your edit');
      return;
    }

    if (result.ok) {
      statusTexts.set(row, { content: result.content, editedAt: result.editedAt });
      fillStatusText(paragraph, result.content);
      setEditedLabel(row, result.editedAt);
      close(true);
      resolveMentions();
      announceStatus('Status saved.');
      return;
    }

    setSaving(false);

    if (result.reason === 'session-expired') {
      showSessionExpired('save your edit');
      return;
    }

    if (result.reason === 'gone') {
      setErrorNote(note, 'This status no longer exists.');
      return;
    }

    if (result.reason === 'failed') console.error(result.error);

    setErrorNote(note, "Couldn't save your edit. Try again.");
  }

  input.addEventListener('input', () => {
    note.textContent = '';
    refresh();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });

  // Ctrl+Enter (Cmd+Enter on a Mac) saves, like the composer. Plain Enter is a new line. Not while
  // an input method is composing text, and not for a held-down key.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.isComposing || event.repeat) return;

    event.preventDefault();
    save();
  });

  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault();
      close(true);
    }
  });

  cancelButton.addEventListener('click', () => {
    if (!saving) close(true);
  });

  refresh();
  announce.textContent = '';
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// The question under the status text: "Delete this status?" with Delete and Cancel. Cancel has the
// focus, so Enter by mistake doesn't delete anything. Escape cancels.
function showDeleteConfirm(row, menuButton) {
  const existing = row.querySelector('.status-confirm');

  if (existing) {
    existing.querySelector('.status-confirm-cancel').focus();
    return;
  }

  const confirm = document.createElement('div');
  confirm.className = 'status-confirm';
  confirm.setAttribute('role', 'group');
  confirm.setAttribute('aria-label', 'Delete this status');

  const text = document.createElement('div');
  text.className = 'status-confirm-text';
  text.textContent = "Delete this status? This can't be undone.";

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'status-confirm-delete';
  deleteButton.textContent = 'Delete';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'status-confirm-cancel';
  cancelButton.textContent = 'Cancel';

  const actions = document.createElement('div');
  actions.className = 'status-confirm-actions';
  actions.append(deleteButton, cancelButton);

  const note = document.createElement('div'); // a live region: failures are read out
  note.className = 'status-confirm-note';
  note.setAttribute('role', 'status');

  confirm.append(text, actions, note);
  row.querySelector('.status-body > p').after(confirm);
  cancelButton.focus();

  let deleting = false;

  function cancel() {
    if (deleting) return;

    const returnTo = menuButton.isConnected ? menuButton : null;

    confirm.remove();
    returnTo?.focus();
  }

  cancelButton.addEventListener('click', cancel);

  confirm.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (deleting) return;

    deleting = true;
    deleteButton.textContent = 'Deleting…';
    deleteButton.setAttribute('aria-busy', 'true');
    deleteButton.disabled = true;
    cancelButton.disabled = true;
    note.textContent = '';

    const result = await deleteStatus(supabase, { id: Number(row.dataset.statusId) });

    // The visitor may have moved on, or signed out (which removes the question), meanwhile.
    if (!confirm.isConnected && !result.ok) {
      if (result.reason === 'session-expired') showSessionExpired('delete your status');
      return;
    }

    if (result.ok) {
      removeDeletedStatus(row);
      return;
    }

    deleting = false;
    deleteButton.textContent = 'Delete';
    deleteButton.removeAttribute('aria-busy');
    deleteButton.disabled = false;
    cancelButton.disabled = false;

    if (result.reason === 'session-expired') {
      showSessionExpired('delete your status');
      return;
    }

    console.error(result.error);
    setErrorNote(note, "Couldn't delete this status. Try again.");
  });
}

// The login is gone: sign out here and say so in the sign-in form, like the other saves.
async function showSessionExpired(what) {
  await expireSession();

  const loginError = document.querySelector('#login-error');
  setErrorNote(loginError, `Your session expired. Sign in again to ${what}.`);
  loginError.hidden = false;
}

function announceStatus(text) {
  const announcer = document.querySelector('#status-announcer');

  announcer.textContent = '';
  setTimeout(() => {
    announcer.textContent = text;
  }, 50);
}

// The status is deleted: take its row out of the page. On its own page there is nothing left to
// show, so go home. In a feed, focus goes to the next row (or the one before it) so a keyboard
// user keeps their place; the feed and the profile's status count find out through an event.
function removeDeletedStatus(row) {
  const feed = row.parentElement;
  const neighbour = row.nextElementSibling?.matches('.status') ? row.nextElementSibling : row.previousElementSibling;
  const onStatusPage = window.location.pathname.split('/').filter(Boolean)[0] === 'statuses';

  row.remove();
  announceStatus('Status deleted.');

  if (onStatusPage) {
    navigate('/');
    return;
  }

  const focusTarget = neighbour?.matches?.('.status') ? neighbour.querySelector('.status-name') : null;

  (focusTarget ?? frame.page).focus({ preventScroll: true });
  feed.dispatchEvent(new Event('statusdeleted', { bubbles: true }));
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

// The masthead is an illustrated picture of a blank wooden sign (public/masthead-1700.webp,
// -2550 and -3400, chosen by the browser from the screen size and density, with a 3.1:1
// crop for phones in public/masthead-mobile.webp). The words "Status Rodeo"
// are real text, the page's h1, laid over the sign by the CSS, so the picture itself is
// decorative (empty alt text). The h1 links home everywhere except the home page, and the
// link covers the whole masthead.
function masthead() {
  return `
    <header class="masthead">
      <picture>
        <source
          media="(max-width: 639px)"
          srcset="/masthead-mobile.webp"
          width="1250"
          height="402"
        />
        <img
          class="masthead-image"
          src="/masthead-2550.webp"
          srcset="/masthead-1700.webp 1700w, /masthead-2550.webp 2550w, /masthead-3400.webp 3400w"
          sizes="min(1698px, calc(100vw - 28px))"
          width="2550"
          height="479"
          alt=""
          fetchpriority="high"
        />
      </picture>
      <h1 class="masthead-title">Status Rodeo</h1>
    </header>
  `;
}

// Until the picture has arrived the masthead is an empty box in the page colour with
// the title hidden (`data-loaded` missing), then the picture and title fade in together.
// If the picture still hasn't loaded after 8 s (or every retry failed) the masthead falls
// back to dark wood with the title showing (`data-loaded="failed"`), so it never stays blank.
function watchMasthead() {
  const header = app.querySelector('.masthead');
  const image = header.querySelector('.masthead-image');
  const show = () => header.setAttribute('data-loaded', 'true');

  if (image.complete && image.naturalWidth > 0) {
    show();
    return;
  }

  image.addEventListener('load', show, { once: true });
  setTimeout(() => {
    if (!header.hasAttribute('data-loaded')) header.setAttribute('data-loaded', 'failed');
  }, 8000);
}

// Makes the title a link home, or plain text again. The picture is not touched, so it
// doesn't reload between pages.
function setMastheadLink(linkHome) {
  const title = document.querySelector('.masthead-title');
  const link = title.querySelector('a');

  if (linkHome && !link) {
    const anchor = document.createElement('a');
    anchor.href = '/';
    anchor.textContent = title.textContent;
    title.replaceChildren(anchor);
  } else if (!linkHome && link) {
    title.textContent = link.textContent;
  }
}

route();
