/**
 * ============================================================
 *  config.js — shared by every page. Loaded as file:// or
 *  hosted on GitHub Pages, it talks to the Apps Script Web App.
 * ============================================================
 */

// PASTE your deployed Apps Script Web App URL here (ends in /exec)
const API_URL = 'https://script.google.com/macros/s/AKfycbz9Rq9CfcKylvWFa4EYAFesCt1gJGEu95iT01vYULPTPy_lVQM4o-w-K4PnbfD6Hko0eA/exec';

const SCHOOL = {
  name: 'JangAfrika',
  established: 2025,
  location: 'Gunjur, The Gambia',
  email: 'info.jangafrica@gmail.com',
  phone: '(+220) 2630798 / 5944287',
  logo: 'logo.png',
  poweredBy: 'JangAfrika'
};

/**
 * Calls the Apps Script API.
 * Uses POST + Content-Type: text/plain so the browser treats it as a
 * CORS "simple request" (no pre-flight OPTIONS, which Apps Script Web
 * Apps do not support).
 *
 * Apps Script Web Apps can be flaky under concurrent load from the same
 * deployment (a burst of simultaneous requests can cause a "Failed to
 * fetch" network error rather than a real API error). To smooth that
 * over, a request that fails at the network level is retried a couple
 * of times with a short backoff before giving up.
 */
async function api(action, params, _retries) {
  if (_retries === undefined) _retries = 2;
  const body = Object.assign({ action: action, token: getToken() }, params || {});
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
  } catch (networkErr) {
    if (_retries > 0) {
      await new Promise(function (r) { setTimeout(r, 600); });
      return api(action, params, _retries - 1);
    }
    throw new Error('Could not reach the server. Check your internet connection and that the Apps Script Web App is deployed, then try again.');
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Request failed');
  return json.data;
}

// ---- Session helpers (kept in localStorage; each static page is standalone) ---

function getToken() { return localStorage.getItem('ja_token') || ''; }
function getUser() {
  try { return JSON.parse(localStorage.getItem('ja_user') || 'null'); } catch (e) { return null; }
}
function setSession(token, user) {
  localStorage.setItem('ja_token', token);
  localStorage.setItem('ja_user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('ja_token');
  localStorage.removeItem('ja_user');
}

/** Redirects to index.html if not logged in, or if role doesn't match. Call at top of each dashboard page.
 *  Also fills in any element with id="whoamiName" / "whoamiRole" so every dashboard shows who's logged in. */
function requirePage(allowedRoles) {
  const user = getUser();
  if (!user || !getToken()) { window.location.href = 'index.html'; return null; }
  if (allowedRoles && allowedRoles.indexOf(user.Role) === -1) {
    alert('You do not have access to this page.');
    window.location.href = 'index.html';
    return null;
  }
  const nameEl = document.getElementById('whoamiName');
  const roleEl = document.getElementById('whoamiRole');
  if (nameEl) nameEl.textContent = user.FullName;
  if (roleEl) roleEl.textContent = user.Role;

  // Sidebar profile block (photo + name + role), if this page has one.
  const sbPhoto = document.getElementById('sidebarPhoto');
  const sbName = document.getElementById('sidebarName');
  const sbRole = document.getElementById('sidebarRole');
  if (sbPhoto) sbPhoto.src = user.PhotoURL || 'https://placehold.co/64x64?text=%20';
  if (sbName) sbName.textContent = user.FullName;
  if (sbRole) sbRole.textContent = user.Role;
  return user;
}

/**
 * Wraps a <form>'s submit handler so a double-click (or a slow network
 * response) can't submit the same data twice. Disables the submit button
 * for the duration of the async handler, re-enabling it afterwards
 * (success or failure). Use in place of a raw addEventListener('submit', ...).
 */
function guardSubmit(form, handler) {
  if (!form) return;
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]') || form.querySelector('button');
    if (btn && btn.disabled) return; // a submit is already in flight
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Please wait…'; }
    try {
      await handler(e);
    } catch (err) {
      console.error('Form submit failed:', err);
      toast(err.message || 'Something went wrong. Please try again.', true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  });
}

/** Same idea as guardSubmit but for a plain button (not inside a <form>),
 *  e.g. "Save attendance", "Save task", "Generate". */
function guardClick(button, handler) {
  if (!button) return;
  button.addEventListener('click', async function (e) {
    if (button.disabled) return;
    const originalText = button.textContent;
    button.disabled = true; button.textContent = 'Please wait…';
    try {
      await handler(e);
    } catch (err) {
      console.error('Action failed:', err);
      toast(err.message || 'Something went wrong. Please try again.', true);
    } finally {
      button.disabled = false; button.textContent = originalText;
    }
  });
}

/** Reads a <input type=file> as a base64 data URL, for sending to the API. */
function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('en-GB');
}

function toast(msg, isError) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
    'background:' + (isError ? '#b3261e' : '#0b5d3b') + ';color:#fff;padding:12px 20px;' +
    'border-radius:8px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2);font-family:sans-serif;';
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 3500);
}

/** Wraps a table-loading function so a failed API call shows a visible error
 *  row instead of leaving "Loading…" spinning forever. bodyId is the
 *  <tbody> to write the error into if loaderFn throws; colspan matches its
 *  table's column count. */
async function safeLoad(bodyId, colspan, loaderFn) {
  try {
    await loaderFn();
  } catch (err) {
    const body = document.getElementById(bodyId);
    if (body) {
      body.innerHTML = '<tr><td colspan="' + colspan + '" style="color:#b3261e;">' +
        'Could not load this: ' + err.message + '</td></tr>';
    }
    console.error('safeLoad failed for #' + bodyId + ':', err);
  }
}

/** Simpler sibling of safeLoad for when the loader doesn't map to one clean
 *  table (e.g. renders several cards, or writes into a dynamic container).
 *  Catches the failure, logs it, and toasts it instead of leaving that
 *  section of the page stuck on whatever its initial "Loading…" state was. */
async function safeCall(fn, label) {
  try {
    await fn();
  } catch (err) {
    console.error((label || 'A section') + ' failed to load:', err);
    toast('Could not load ' + (label || 'this section') + ': ' + err.message, true);
  }
}

function logout() {
  api('logout', {}).catch(function () {}).finally(function () {
    clearSession();
    window.location.href = 'index.html';
  });
}

/** Triggers a browser download of tabular data as a real .csv file the
 *  user can open and edit in Excel/Sheets. rows = array of arrays. */
function downloadCSV(filename, rows) {
  const csv = rows.map(function (row) {
    return row.map(function (cell) {
      const s = String(cell === undefined || cell === null ? '' : cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename.endsWith('.csv') ? filename : filename + '.csv');
}

/** Triggers a browser download of an HTML snippet as a .doc file. Word (and
 *  Google Docs' "Open with Word") opens HTML-content .doc files just fine,
 *  so this gives users a genuinely editable Word document with no server
 *  round-trip or extra libraries needed. */
function downloadWordDoc(filename, title, bodyHtml) {
  const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
    '<head><meta charset="utf-8"><title>' + title + '</title></head>' +
    '<body style="font-family:Calibri,Arial,sans-serif;">' + bodyHtml + '</body></html>';
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
  triggerDownload(blob, filename.endsWith('.doc') ? filename : filename + '.doc');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

/** Human-readable payment tier badge info: { label, className }. */
function paymentTierBadge(tier) {
  if (tier === 'Paid') return { label: 'Fully Paid', className: 'paid' };
  if (tier === 'Partial') return { label: 'Partially Paid (50%+)', className: 'pending' };
  return { label: 'Unpaid', className: 'unpaid' };
}

/** Fetches a watermarked past-paper PDF from the backend (base64) and
 *  triggers a real file download. Shared by the Past Questions page and
 *  the student dashboard's assigned-tasks tiles. */
async function downloadPastPaperPdf(paperId) {
  toast('Preparing your PDF…');
  const result = await api('downloadPastPaperPdf', { paperId: paperId });
  const bytes = atob(result.base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: 'application/pdf' });
  triggerDownload(blob, result.fileName);
}

/** Wires up the hamburger button on dashboard pages so the sidebar nav
 *  (the same .tabs element used for desktop tab-switching) slides in as an
 *  off-canvas drawer on small screens. No-ops harmlessly on pages that
 *  don't have this markup (login, register, etc). Closing on backdrop
 *  click and after picking a tab keeps the drawer from covering content. */
function initSidebarToggle() {
  const hamburger = document.getElementById('hamburgerBtn');
  const tabs = document.querySelector('.tabs');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!hamburger || !tabs || !backdrop) return;
  function closeSidebar() { tabs.classList.remove('open'); backdrop.classList.remove('open'); }
  function openSidebar() { tabs.classList.add('open'); backdrop.classList.add('open'); }
  hamburger.addEventListener('click', function () {
    if (tabs.classList.contains('open')) closeSidebar(); else openSidebar();
  });
  backdrop.addEventListener('click', closeSidebar);
  tabs.querySelectorAll('button').forEach(function (btn) {
    btn.addEventListener('click', closeSidebar);
  });
}
initSidebarToggle();

/** Wires a dashboard's search box to filter the currently-visible tab's
 *  table rows and card/tile elements by plain text match — a lightweight,
 *  genuinely functional "quick find" rather than a decorative input. */
function initDashSearch(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('input', function () {
    const q = input.value.trim().toLowerCase();
    const activePane = document.querySelector('.tabpane:not(.hidden)');
    if (!activePane) return;
    activePane.querySelectorAll('table tbody tr').forEach(function (tr) {
      const text = tr.textContent.toLowerCase();
      tr.style.display = (!q || text.indexOf(q) > -1) ? '' : 'none';
    });
    activePane.querySelectorAll('.task-tile, .course-card').forEach(function (el) {
      const text = el.textContent.toLowerCase();
      el.style.display = (!q || text.indexOf(q) > -1) ? '' : 'none';
    });
  });
}
