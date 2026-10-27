const $ = (id) => document.getElementById(id);
let issueItems = [];
let activeFilter = 'All';
let currentUser = null;
let authMode = 'login';
async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error([data.error || 'Request failed', ...(data.details || [])].join(': '));
  return data;
}
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function when(iso) { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function remaining(s) {
  if (s.remainingMs === null) return s.met ? 'Resolved within SLA' : 'Resolved after SLA deadline';
  const h = Math.floor(Math.abs(s.remainingMs) / 3600000), m = Math.floor((Math.abs(s.remainingMs) % 3600000) / 60000);
  return s.overdue ? `Overdue by ${h}h ${m}m` : `${h}h ${m}m left`;
}
function categoryClass(category) {
  return ({ 'Roads and Potholes': 'roads', 'Water Supply': 'water', 'Garbage and Sanitation': 'sanitation', Drainage: 'drainage', Streetlights: 'streetlights' })[category] || 'roads';
}
function showTab(tab) {
  if (tab === 'dashboard' && (!currentUser || !['staff', 'admin'].includes(currentUser.role))) {
    openAuth('login');
    return;
  }
  if (tab === 'register' && (!currentUser || currentUser.role !== 'resident')) {
    openAuth('login');
    return;
  }
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((section) => { section.hidden = section.id !== tab; });
  const names = { feed: 'Community feed', register: 'Report an issue', track: 'Track a report', dashboard: currentUser?.role === 'admin' ? 'Admin dashboard' : 'Staff dashboard' };
  $('pageName').textContent = names[tab];
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'feed') loadFeed();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.go)));
function fill(sel, first, values) {
  sel.replaceChildren(...[first, ...values].map((v, i) => { const o = el('option', v); o.value = i === 0 ? '' : v; return o; }));
}
async function init() {
  $('footerYear').textContent = new Date().getFullYear();
  const meta = await api('/api/departments');
  const cat = $('category'); cat.replaceChildren(...meta.categories.map((c) => { const o = el('option', c); o.value = c; return o; }));
  fill($('fStatus'), 'All statuses', meta.statuses);
  fill($('fCategory'), 'All categories', meta.categories);
  fill($('fDept'), 'All departments', meta.departments);
  $('staffDepartment').replaceChildren(...meta.departments.map((department) => { const option = el('option', department); option.value = department; return option; }));
  $('staffRole').addEventListener('change', () => { $('staffDepartment').disabled = $('staffRole').value === 'admin'; });
  ['fStatus', 'fCategory', 'fDept'].forEach((id) => $(id).addEventListener('change', loadDashboard));
  window.STATUSES = meta.statuses;
  await refreshUser();
  loadFeed();
}
function renderUser() {
  const signedIn = Boolean(currentUser);
  $('profileName').textContent = currentUser ? currentUser.name : 'Community visitor';
  $('profileRole').textContent = currentUser ? `${currentUser.role[0].toUpperCase()}${currentUser.role.slice(1)}${currentUser.department ? ` · ${currentUser.department}` : ''}` : 'Browse public issues';
  $('profileAvatar').textContent = currentUser ? currentUser.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() : 'CR';
  $('signInButton').hidden = signedIn;
  $('signOutButton').hidden = !signedIn;
  const dashboardNav = document.querySelector('[data-tab="dashboard"]');
  dashboardNav.hidden = !currentUser || !['staff', 'admin'].includes(currentUser.role);
  $('dashboardNavLabel').textContent = currentUser?.role === 'admin' ? 'Admin dashboard' : 'Staff dashboard';
  $('adminUsersPanel').hidden = currentUser?.role !== 'admin';
  $('fDept').disabled = currentUser?.role !== 'admin';
  $('dashboardHeading').textContent = currentUser?.role === 'admin' ? 'Administrator dashboard' : 'Department dashboard';
  $('dashboardDescription').textContent = currentUser?.role === 'admin' ? 'Manage reports, staff accounts, and department access.' : `Review and update reports assigned to ${currentUser?.department || 'your department'}.`;
}
async function refreshUser() {
  const result = await api('/api/auth/me');
  currentUser = result.user;
  renderUser();
}
function openAuth(mode = 'login') {
  setAuthMode(mode);
  $('authMsg').textContent = '';
  $('authDialog').showModal();
}
function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === 'register';
  document.querySelectorAll('[data-auth-mode]').forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode));
  $('authHeading').textContent = registering ? 'Join your community' : 'Welcome back';
  $('authDescription').textContent = registering ? 'Create a resident account to report and support local issues.' : 'Sign in to participate in your community.';
  $('authNameLabel').hidden = !registering;
  $('authName').hidden = !registering;
  $('authName').required = registering;
  $('authPassword').autocomplete = registering ? 'new-password' : 'current-password';
  $('authSubmit').textContent = registering ? 'Create resident account' : 'Sign in';
  $('demoAccess').hidden = registering;
}
document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
$('signInButton').addEventListener('click', () => openAuth());
$('closeAuth').addEventListener('click', () => $('authDialog').close());
$('authDialog').addEventListener('click', (event) => { if (event.target === $('authDialog')) $('authDialog').close(); });
$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('authMsg');
  message.textContent = authMode === 'register' ? 'Creating your account...' : 'Signing in...';
  message.className = 'inline-message';
  const body = { email: $('authEmail').value, password: $('authPassword').value };
  if (authMode === 'register') body.name = $('authName').value;
  try {
    const result = await api(authMode === 'register' ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
    currentUser = result.user;
    renderUser();
    $('authDialog').close();
    $('loginForm').reset();
    if (currentUser.role === 'staff' || currentUser.role === 'admin') showTab('dashboard');
    else showTab('feed');
  } catch (err) {
    message.textContent = err.message;
    message.className = 'inline-message error';
  }
});
$('signOutButton').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    renderUser();
    showTab('feed');
  } catch (err) {
    $('feedMsg').textContent = err.message;
    $('feedMsg').className = 'inline-message error';
  }
});
async function loadFeed() {
  const message = $('feedMsg');
  message.textContent = 'Loading community issues...';
  message.className = 'inline-message';
  try {
    const data = await api('/api/complaints/feed');
    issueItems = data.items;
    $('statActive').textContent = data.stats.active;
    $('statResolved').textContent = data.stats.resolved;
    $('statVotes').textContent = data.stats.votes;
    $('allCount').textContent = data.stats.total;
    message.textContent = '';
    renderFeed();
  } catch (err) {
    message.textContent = err.message;
    message.className = 'inline-message error';
  }
}
function renderFeed() {
  const search = $('feedSearch').value.trim().toLowerCase();
  const sort = $('feedSort').value;
  const matches = issueItems.filter((item) => {
    const matchesCategory = activeFilter === 'All' || item.category === activeFilter;
    const matchesText = !search || [item.title, item.description, item.location, item.category].join(' ').toLowerCase().includes(search);
    return matchesCategory && matchesText;
  });
  if (sort === 'recent') matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else matches.sort((a, b) => b.voteCount - a.voteCount || b.createdAt.localeCompare(a.createdAt));
  $('emptyState').hidden = matches.length > 0;
  $('issueGrid').hidden = matches.length === 0;
  $('issueGrid').replaceChildren(...matches.map(renderIssue));
}
function renderIssue(issue) {
  const card = el('article', undefined, 'issue-card');
  const topline = el('div', undefined, 'issue-topline');
  topline.append(el('span', undefined, `category-tag category-${categoryClass(issue.category)}`));
  topline.firstChild.append(el('i', undefined, 'category-dot'), document.createTextNode(issue.category));
  topline.append(el('span', issue.priority, `priority-tag priority-${issue.priority.toLowerCase()}`));
  card.append(topline, el('h3', issue.title), el('p', issue.description, 'issue-description'));
  const meta = el('div', undefined, 'issue-meta');
  meta.append(el('span', `⌖ ${issue.location}`), el('span', `◷ ${new Date(issue.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`));
  meta.append(el('span', issue.department, 'department'));
  card.append(meta);
  const bottom = el('div', undefined, 'card-bottom');
  const support = el('span', undefined, 'support-copy');
  support.append(el('strong', `${issue.voteCount} ${issue.voteCount === 1 ? 'neighbor' : 'neighbors'}`), document.createTextNode(' supporting'));
  const reference = el('span', issue.referenceNumber, 'issue-reference');
  const hasVoted = issue.viewerHasVoted;
  const button = el('button', undefined, `vote-button${hasVoted ? ' voted' : ''}`);
  button.type = 'button'; button.disabled = hasVoted || Boolean(currentUser && currentUser.role !== 'resident');
  const voteLabel = !currentUser ? 'Sign in to support' : hasVoted ? 'Supported' : currentUser.role !== 'resident' ? 'Residents support' : 'Support issue';
  button.append(el('span', hasVoted ? '♥' : '♡', 'vote-heart'), document.createTextNode(voteLabel));
  if (!currentUser) button.addEventListener('click', () => openAuth());
  else if (currentUser.role === 'resident' && !hasVoted) button.addEventListener('click', () => castVote(issue.referenceNumber, button));
  bottom.append(support, reference, button);
  card.append(bottom);
  return card;
}
async function castVote(ref, button) {
  button.disabled = true;
  try {
    const result = await api(`/api/complaints/${encodeURIComponent(ref)}/vote`, { method: 'POST' });
    const issue = issueItems.find((item) => item.referenceNumber === ref);
    if (issue) { issue.voteCount = result.voteCount; issue.priority = result.priority; issue.viewerHasVoted = true; }
    loadFeed();
  } catch (err) {
    button.disabled = !currentUser || currentUser.role !== 'resident';
    $('feedMsg').textContent = err.message;
    $('feedMsg').className = 'inline-message error';
  }
}
$('feedFilters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  activeFilter = button.dataset.filter;
  $('feedFilters').querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('selected', chip === button));
  renderFeed();
});
$('feedSearch').addEventListener('input', renderFeed);
$('feedSort').addEventListener('change', renderFeed);

$('regForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(['title', 'category', 'location', 'description', 'contact'].map((key) => [key, $(key).value]));
  const message = $('regMsg');
  message.textContent = 'Submitting your report...';
  message.className = 'form-message';
  try {
    const complaint = await api('/api/complaints', { method: 'POST', body: JSON.stringify(body) });
    message.className = 'form-message ok';
    message.replaceChildren(el('strong', `Report submitted — ${complaint.referenceNumber}`), el('p', `Routed to ${complaint.department}. You can track its progress from the Track a report page.`));
    $('refInput').value = complaint.referenceNumber;
    $('regForm').reset();
    loadFeed();
  } catch (err) {
    message.textContent = err.message;
    message.className = 'form-message error';
    if (err.message.includes('Sign in')) openAuth();
  }
});
function renderTrack(complaint) {
  const card = el('article', undefined, 'track-result');
  const heading = el('div', undefined, 'track-result-heading');
  const titleWrap = el('div');
  titleWrap.append(el('span', complaint.referenceNumber, 'issue-reference'), el('h2', complaint.title), el('p', `${complaint.category} · ${complaint.location}`));
  heading.append(titleWrap, el('span', complaint.priority, `priority-tag priority-${complaint.priority.toLowerCase()}`));
  card.append(heading);
  const details = el('div', undefined, 'track-details');
  [['Department', complaint.department], ['Current status', complaint.status], ['Community support', `${complaint.voteCount} votes`], ['Submitted', when(complaint.createdAt)], ['SLA deadline', when(complaint.slaDeadline)], ['Response target', remaining(complaint.sla)]].forEach(([label, value]) => {
    const cell = el('div', undefined, 'detail-cell'); cell.append(el('small', label), el('strong', value)); details.append(cell);
  });
  card.append(details, el('h3', 'Status history', 'timeline-title'));
  const timeline = el('ol', undefined, 'timeline');
  [...complaint.history].reverse().forEach((entry) => {
    const row = el('li');
    row.append(el('strong', `${entry.from || 'Report created'} → ${entry.to}`));
    if (entry.note) row.append(el('span', ` · ${entry.note}`));
    row.append(el('time', `${when(entry.at)} · ${entry.by}`));
    timeline.append(row);
  });
  card.append(timeline);
  $('trackResult').replaceChildren(card);
}
$('trackForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('trackMsg');
  message.textContent = 'Looking up your report...';
  message.className = 'inline-message';
  $('trackResult').replaceChildren();
  try {
    renderTrack(await api('/api/complaints/' + encodeURIComponent($('refInput').value.trim())));
    message.textContent = '';
  } catch (err) {
    message.textContent = err.message;
    message.className = 'inline-message error';
  }
});
async function loadDashboard() {
  const message = $('dashMsg');
  message.textContent = 'Loading reports...';
  message.className = 'inline-message';
  const query = new URLSearchParams();
  [['status', 'fStatus'], ['category', 'fCategory'], ['department', 'fDept']].forEach(([key, id]) => { if ($(id).value) query.set(key, $(id).value); });
  try {
    const data = await api('/api/complaints?' + query);
    const stats = data.stats;
    $('stats').replaceChildren(...[['Total reports', stats.total], ['Submitted', stats.Submitted], ['In progress', stats['In Progress']], ['Resolved', stats.Resolved], ['Overdue', stats.overdue]].map(([label, value]) => {
      const item = el('div'); item.append(el('b', value), label); return item;
    }));
    message.textContent = data.items.length ? '' : 'No reports match these filters.';
    $('rows').replaceChildren(...data.items.map((complaint) => {
      const row = el('tr');
      row.append(el('td', complaint.referenceNumber), el('td', complaint.title), el('td', complaint.department), el('td', complaint.voteCount), el('td', complaint.priority, `priority-cell priority-${complaint.priority.toLowerCase()}`));
      const status = el('td'); status.append(el('span', complaint.status, 'badge')); row.append(status);
      const slaCell = el('td', `${when(complaint.slaDeadline)} · ${remaining(complaint.sla)}`); if (complaint.sla.overdue) slaCell.className = 'late'; row.append(slaCell);
      const action = el('td'); const select = el('select'); select.setAttribute('aria-label', 'New status for ' + complaint.referenceNumber);
      window.STATUSES.slice(window.STATUSES.indexOf(complaint.status) + 1).forEach((statusName) => { const option = el('option', statusName); option.value = statusName; select.append(option); });
      if (select.options.length) { const update = el('button', 'Update'); update.addEventListener('click', () => setStatus(complaint.referenceNumber, select.value)); action.append(select, update); } else action.textContent = 'Final';
      row.append(action);
      return row;
    }));
    if (currentUser.role === 'admin') loadUsers();
  } catch (err) {
    message.textContent = err.message;
    message.className = 'inline-message error';
    if (err.message.includes('Sign in')) openAuth('login');
  }
}
async function setStatus(ref, status) {
  try {
    await api(`/api/complaints/${encodeURIComponent(ref)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    loadDashboard();
    loadFeed();
  } catch (err) {
    $('dashMsg').textContent = err.message;
    $('dashMsg').className = 'inline-message error';
  }
}
$('staffForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('adminMsg');
  message.textContent = 'Creating account...';
  message.className = 'inline-message';
  const body = { name: $('staffName').value, email: $('staffEmail').value, password: $('staffPassword').value, role: $('staffRole').value };
  if (body.role === 'staff') body.department = $('staffDepartment').value;
  try {
    const result = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
    message.textContent = `${result.user.role} account created for ${result.user.email}.`;
    $('staffForm').reset();
    $('staffDepartment').disabled = false;
    loadUsers();
  } catch (err) {
    message.textContent = err.message;
    message.className = 'inline-message error';
  }
});
async function loadUsers() {
  if (currentUser?.role !== 'admin') return;
  try {
    const result = await api('/api/admin/users');
    $('userList').replaceChildren(...result.items.map((user) => {
      const row = el('div', undefined, 'user-row');
      const identity = el('span');
      identity.append(el('strong', user.name), el('small', user.email));
      row.append(identity, el('span', `${user.role}${user.department ? ` · ${user.department}` : ''}`, 'user-role'));
      return row;
    }));
  } catch (err) {
    $('adminMsg').textContent = err.message;
    $('adminMsg').className = 'inline-message error';
  }
}
init().catch((err) => {
  $('feedMsg').textContent = 'Could not reach the server: ' + err.message;
  $('feedMsg').className = 'inline-message error';
});
