const main = document.getElementById('main');
const nav = document.getElementById('nav');
const logoutButton = document.getElementById('logout');
const flashEl = document.getElementById('flash');

const numberFormat = new Intl.NumberFormat('id-ID');
const dateFormat = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

const LEVEL_LABEL = { info: 'Info', warn: 'Peringatan', error: 'Error' };

/* Token admin: sessionStorage supaya hilang saat tab ditutup, memori sebagai cadangan. */

let memoryToken = null;
const session = {
  get() {
    try { return sessionStorage.getItem('nexus.admin') ?? memoryToken; } catch { return memoryToken; }
  },
  set(value) {
    memoryToken = value;
    try { sessionStorage.setItem('nexus.admin', value); } catch { /* penyimpanan diblokir, token tetap di memori */ }
  },
  clear() {
    memoryToken = null;
    try { sessionStorage.removeItem('nexus.admin'); } catch { /* tidak ada yang perlu dihapus */ }
  },
};

class ApiError extends Error {
  constructor(status, code, message, hint) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

async function api(path, { method = 'GET', body, token = session.get() } = {}) {
  let res;
  try {
    res = await fetch(`/admin${path}`, {
      method,
      headers: { 'x-admin-token': token ?? '', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'unreachable', 'Server Nexus tidak terjangkau.', 'Cek apakah Nexus masih berjalan dan koneksi internetmu aktif, lalu coba lagi.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error, data.message ?? `Server membalas dengan status ${res.status}.`, data.hint);
  return data;
}

const explain = (err) => [err.message, err.hint].filter(Boolean).join(' ');

/* Pembangun elemen. Semua teks lewat node teks, jadi nama key dari pengguna tidak bisa menyuntik HTML. */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((child) => child != null && child !== false));
  return el;
}

function timeAgo(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'baru saja';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return dateFormat.format(new Date(iso));
}

function formatDuration(seconds) {
  if (seconds < 60) return 'kurang dari semenit';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} jam ${minutes % 60} menit` : `${hours} jam`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} hari ${hours % 24} jam` : `${days} hari`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* clipboard API butuh HTTPS atau localhost, lanjut ke cara lama */ }
  const area = h('textarea', { class: 'offscreen', readonly: true, 'aria-hidden': 'true', tabindex: '-1' });
  area.value = text;
  document.body.append(area);
  area.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { copied = false; }
  area.remove();
  return copied;
}

function copyControl(label, getText) {
  const status = h('span', { class: 'inline-status', role: 'status' });
  const button = h('button', {
    type: 'button',
    class: 'btn',
    onclick: async () => {
      status.textContent = (await copyText(getText())) ? 'Tersalin.' : 'Browser menolak menyalin. Blok teksnya lalu salin manual.';
    },
  }, label);
  return [button, status];
}

function flash(message, isError = false) {
  flashEl.textContent = message ? (isError ? `Gagal: ${message}` : message) : '';
  flashEl.classList.toggle('flash-error', Boolean(message) && isError);
}

function handleAuthLost(err) {
  if (err.status !== 401) return false;
  session.clear();
  renderLogin(err.code === 'admin_token_invalid' ? 'Token ditolak server. Masuk lagi dengan ADMIN_TOKEN yang terbaru.' : explain(err));
  return true;
}

// Dipakai tombol aksi: kunci tombol selama request, lalu laporkan hasilnya lewat flash.
async function runAction(button, work, successMessage) {
  button.disabled = true;
  flash('');
  try {
    await work();
    flash(successMessage);
  } catch (err) {
    if (!handleAuthLost(err)) flash(explain(err), true);
  } finally {
    button.disabled = false;
  }
}

const pageHead = (title, lede) => [
  h('h1', { tabindex: '-1' }, title),
  lede ? h('p', { class: 'lede' }, lede) : null,
];

const errorBox = (err) =>
  h('div', { class: 'notice', role: 'alert' },
    h('p', {}, h('strong', {}, 'Halaman ini gagal dimuat. '), err.message),
    err.hint ? h('p', {}, err.hint) : null,
    h('button', { type: 'button', class: 'btn', onclick: () => show() }, 'Coba lagi'));

const statusTag = (on, onLabel = 'Aktif', offLabel = 'Nonaktif') =>
  h('span', { class: 'tag' }, h('span', { class: `lamp${on ? '' : ' lamp-off'}`, 'aria-hidden': 'true' }), on ? onLabel : offLabel);

/* Masuk */

function renderLogin(message) {
  nav.hidden = true;
  logoutButton.hidden = true;
  document.title = 'Masuk · Nexus';
  flash('');

  const input = h('input', {
    id: 'token', name: 'admin-token', type: 'password', autocomplete: 'current-password',
    spellcheck: 'false', required: true, 'aria-describedby': 'token-hint',
  });
  const error = h('p', { class: 'field-error', role: 'alert' }, message ?? '');
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Masuk');

  const form = h('form', { class: 'panel stack', novalidate: true },
    h('div', {},
      h('label', { for: 'token' }, 'Token admin'),
      input,
      h('p', { class: 'hint', id: 'token-hint' }, 'Nilai ADMIN_TOKEN dari file .env di server. Token hanya disimpan di tab ini.')),
    error,
    submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      error.textContent = 'Isi token admin dulu.';
      input.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Memeriksa…';
    error.textContent = '';
    try {
      await api('/summary', { token: value });
      session.set(value);
      history.replaceState(null, '', '#/beranda');
      show();
    } catch (err) {
      error.textContent = err.status === 401 || err.status === 429
        ? `${err.message} ${err.hint ?? ''}`.trim()
        : explain(err);
      input.focus();
    } finally {
      submit.disabled = false;
      submit.textContent = 'Masuk';
    }
  });

  main.replaceChildren(
    ...pageHead('Masuk ke Nexus', 'Panel ini mengelola API key, modul, dan log hub pribadimu.'),
    form,
  );
  if (message) input.focus();
}

/* Beranda */

async function renderHome() {
  const summary = await api('/summary');
  const origin = location.origin;
  const example = [
    `curl -X POST ${origin}/v1/notify \\`,
    '  -H "x-api-key: nxs_KEY_KAMU" \\',
    '  -H "content-type: application/json" \\',
    '  -d \'{"title":"Tes dari Nexus","message":"Halo dari curl"}\'',
  ].join('\n');

  const meter = (label, value, note, alert = false) =>
    h('div', { class: `meter${alert ? ' meter-alert' : ''}` },
      h('dt', {}, label),
      h('dd', {}, numberFormat.format(value), note ? h('small', {}, note) : null));

  const nodes = [
    ...pageHead('Beranda', `Nexus v${summary.version} sudah menyala ${formatDuration(summary.uptime_s)}.`),
    h('dl', { class: 'meters' },
      meter('Key aktif', summary.keys.active, `dari ${summary.keys.total}`),
      meter('Modul menyala', summary.modules.enabled, `dari ${summary.modules.total}`),
      meter('Request 24 jam', summary.requests_24h),
      meter('Error 24 jam', summary.errors_24h, summary.errors_24h ? 'cek di Log' : 'tidak ada', summary.errors_24h > 0)),
  ];

  if (summary.keys.total === 0) {
    nodes.push(h('div', { class: 'empty' },
      h('p', {}, h('strong', {}, 'Belum ada API key.')),
      h('p', {}, 'Tanpa key, project lain tidak bisa memanggil Nexus. Buat key pertama untuk satu project, lalu salin sekali saat tampil.'),
      h('a', { class: 'btn btn-primary', href: '#/keys' }, 'Buat key pertama')));
  }
  if (summary.modules.enabled === 0) {
    nodes.push(h('div', { class: 'notice', role: 'status' },
      h('p', {}, h('strong', {}, 'Semua modul mati. '), 'Panggilan ke /v1 akan ditolak dengan kode 503.'),
      h('a', { class: 'btn', href: '#/modul' }, 'Buka halaman Modul')));
  }

  nodes.push(h('section', { class: 'panel', 'aria-labelledby': 'call-title' },
    h('h2', { id: 'call-title' }, 'Cara memanggil Nexus'),
    h('p', { class: 'lede' }, 'Contoh ini memakai modul Notifier. Ganti nxs_KEY_KAMU dengan key dari halaman API Keys.'),
    h('pre', { class: 'code', tabindex: '0', 'aria-label': 'Contoh perintah curl' }, example),
    h('div', { class: 'toolbar' },
      ...copyControl('Salin contoh', () => example),
      h('a', { href: '/docs' }, 'Buka dokumentasi API'))));

  return nodes;
}

/* API Keys */

async function renderKeys() {
  const [summary, { modules }, { keys }] = await Promise.all([api('/summary'), api('/modules'), api('/keys')]);

  const listHost = h('div');
  const revealHost = h('div');

  async function reloadList() {
    try {
      fillList((await api('/keys')).keys);
    } catch (err) {
      if (!handleAuthLost(err)) flash(explain(err), true);
    }
  }

  function keyRow(key) {
    const scopes = key.scopes.includes('*') ? 'Semua modul' : key.scopes.join(', ');
    const toggleLabel = key.active ? 'Nonaktifkan' : 'Aktifkan';
    const toggle = h('button', {
      type: 'button', class: 'btn', 'aria-label': `${toggleLabel} key ${key.name}`,
      onclick: (event) => runAction(event.currentTarget, async () => {
        await api(`/keys/${key.id}`, { method: 'PATCH', body: { active: !key.active } });
        await reloadList();
      }, `Key "${key.name}" ${key.active ? 'dinonaktifkan. Panggilan dengan key ini ditolak.' : 'diaktifkan lagi.'}`),
    }, toggleLabel);
    const remove = h('button', {
      type: 'button', class: 'btn', 'aria-label': `Hapus key ${key.name}`,
      onclick: (event) => {
        if (!confirm(`Hapus key "${key.name}" permanen? Project yang memakainya langsung ditolak dan key ini tidak bisa dikembalikan.`)) return;
        runAction(event.currentTarget, async () => {
          await api(`/keys/${key.id}`, { method: 'DELETE' });
          await reloadList();
        }, `Key "${key.name}" dihapus.`);
      },
    }, 'Hapus');

    return h('li', { class: 'row row-keys' },
      h('div', { class: 'stack-sm' },
        h('div', { class: 'row-head' }, h('span', { class: 'row-name' }, key.name), statusTag(key.active)),
        h('p', { class: 'mono' }, `${key.prefix}…`),
        h('p', { class: 'meta' },
          h('span', {}, `Akses: ${scopes}`),
          h('span', {}, `${numberFormat.format(key.rate_limit)} request per menit`),
          h('span', {}, key.last_used_at ? `Terakhir dipakai ${timeAgo(key.last_used_at)}` : 'Belum pernah dipakai'))),
      h('div', { class: 'actions' }, toggle, remove));
  }

  function fillList(items) {
    if (items.length === 0) {
      listHost.replaceChildren(h('div', { class: 'empty' },
        h('p', {}, h('strong', {}, 'Belum ada key.')),
        h('p', {}, 'Isi formulir di atas untuk membuat key pertama. Satu key untuk satu project memudahkanmu mencabut akses tanpa mengganggu project lain.')));
      return;
    }
    listHost.replaceChildren(h('ul', { class: 'panel' }, items.map(keyRow)));
  }

  function showReveal(secret, name) {
    const field = h('p', { id: 'new-secret', class: 'secret mono', tabindex: '0', 'aria-labelledby': 'reveal-title' }, secret);
    const done = h('button', { type: 'button', class: 'btn', onclick: () => revealHost.replaceChildren() }, 'Sudah kusimpan');
    const box = h('section', { class: 'reveal', tabindex: '-1', 'aria-labelledby': 'reveal-title' },
      h('h2', { id: 'reveal-title' }, `Key "${name}" siap dipakai`),
      h('p', {}, 'Simpan sekarang. Key lengkap tidak akan tampil lagi, server hanya menyimpan hash-nya. Kalau hilang, buat key baru.'),
      h('div', { class: 'reveal-row' }, field, ...copyControl('Salin key', () => secret)),
      h('div', { class: 'toolbar' }, done));
    revealHost.replaceChildren(box);
    box.focus();
  }

  /* Formulir buat key */

  const nameInput = h('input', { id: 'key-name', name: 'name', type: 'text', maxlength: '60', required: true, autocomplete: 'off', placeholder: 'Contoh: Bot Telegram' });
  const limitInput = h('input', {
    id: 'key-limit', name: 'rate_limit', type: 'number', inputmode: 'numeric', min: '1', max: '10000', step: '1',
    placeholder: String(summary.default_rate_limit), 'aria-describedby': 'limit-hint',
  });
  const allBox = h('input', { type: 'checkbox', id: 'scope-all', checked: true });
  const moduleBoxes = modules.map((m) => ({ id: m.id, box: h('input', { type: 'checkbox', id: `scope-${m.id}`, disabled: true }) }));
  allBox.addEventListener('change', () => {
    for (const { box } of moduleBoxes) {
      box.disabled = allBox.checked;
      if (allBox.checked) box.checked = false;
    }
  });

  const formError = h('p', { class: 'field-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Buat key');

  const form = h('form', { class: 'panel stack', novalidate: true, 'aria-labelledby': 'create-title' },
    h('h2', { id: 'create-title' }, 'Buat key baru'),
    h('div', { class: 'fields fields-2' },
      h('div', {}, h('label', { for: 'key-name' }, 'Nama key'), nameInput,
        h('p', { class: 'hint' }, 'Nama project yang akan memakainya, supaya mudah dikenali di Log.')),
      h('div', {}, h('label', { for: 'key-limit' }, 'Batas request per menit'), limitInput,
        h('p', { class: 'hint', id: 'limit-hint' }, `Kosongkan untuk memakai bawaan server: ${numberFormat.format(summary.default_rate_limit)}.`))),
    h('fieldset', {},
      h('legend', {}, 'Modul yang boleh dipakai'),
      h('label', { class: 'check', for: 'scope-all' }, allBox, 'Semua modul'),
      moduleBoxes.map(({ id, box }) => h('label', { class: 'check', for: `scope-${id}` }, box, modules.find((m) => m.id === id).name))),
    formError,
    h('div', {}, submit));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formError.textContent = '';
    const name = nameInput.value.trim();
    const scopes = allBox.checked ? ['*'] : moduleBoxes.filter(({ box }) => box.checked).map(({ id }) => id);
    const limit = limitInput.value === '' ? null : Number(limitInput.value);

    if (!name) { formError.textContent = 'Isi nama key dulu.'; nameInput.focus(); return; }
    if (scopes.length === 0) { formError.textContent = 'Pilih minimal satu modul, atau centang Semua modul.'; allBox.focus(); return; }
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 10000)) {
      formError.textContent = 'Batas request harus bilangan bulat antara 1 dan 10.000.';
      limitInput.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Membuat…';
    flash('');
    try {
      const created = await api('/keys', { method: 'POST', body: { name, scopes, ...(limit === null ? {} : { rate_limit: limit }) } });
      form.reset();
      allBox.dispatchEvent(new Event('change'));
      await reloadList();
      showReveal(created.secret, created.key.name);
    } catch (err) {
      if (!handleAuthLost(err)) formError.textContent = explain(err);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Buat key';
    }
  });

  fillList(keys);

  return [
    ...pageHead('API Keys', 'Satu key untuk satu project. Key lengkap hanya tampil sekali, tepat setelah dibuat.'),
    form,
    revealHost,
    h('h2', { class: 'section-title' }, 'Key yang ada'),
    listHost,
  ];
}

/* Modul */

async function renderModules() {
  const { modules } = await api('/modules');

  const listHost = h('ul', { class: 'panel' });

  function fill(items) {
    listHost.replaceChildren(...items.map((m) => {
      const label = m.enabled ? 'Matikan' : 'Nyalakan';
      const toggle = h('button', {
        type: 'button', class: 'btn', 'aria-label': `${label} modul ${m.name}`,
        onclick: (event) => runAction(event.currentTarget, async () => {
          const { module: updated } = await api(`/modules/${m.id}`, { method: 'PATCH', body: { enabled: !m.enabled } });
          Object.assign(m, updated);
          fill(items);
        }, `Modul ${m.name} ${m.enabled ? 'dimatikan. Panggilan ke modul ini ditolak dengan kode 503.' : 'dinyalakan.'}`),
      }, label);

      return h('li', { class: 'port' },
        h('span', { class: `socket${m.enabled ? '' : ' socket-off'}`, 'aria-hidden': 'true' }),
        h('div', { class: 'port-body' },
          h('div', { class: 'row-head' }, h('h2', {}, m.name), statusTag(m.enabled, 'Menyala', 'Mati')),
          h('p', {}, m.description),
          h('p', { class: 'meta' }, h('span', { class: 'mono' }, m.path), h('span', {}, `Versi ${m.version}`)),
          h('p', { class: 'meta' }, m.ready ? 'Siap dipakai.' : `Perlu diatur: ${m.note}`)),
        h('div', { class: 'port-actions' }, toggle));
    }));
  }

  if (modules.length === 0) {
    return [
      ...pageHead('Modul'),
      h('div', { class: 'empty' },
        h('p', {}, h('strong', {}, 'Belum ada modul terpasang.')),
        h('p', {}, 'Taruh folder modul di src/modules lalu restart Nexus. Langkahnya ada di bagian "Menambah modul" pada README.')),
    ];
  }

  fill(modules);
  return [
    ...pageHead('Modul', 'Tiap modul adalah satu fitur. Modul yang dimatikan menolak semua panggilan dengan kode 503, tanpa menghapus pengaturannya.'),
    listHost,
  ];
}

/* Log */

let logLevel = '';

async function renderLogs() {
  const entries = h('ol', { class: 'panel' });
  const moreHost = h('div', { class: 'toolbar' });
  const emptyHost = h('div');
  let cursor = null;

  function logRow(l) {
    return h('li', { class: 'row' },
      h('div', { class: 'row-head' },
        h('span', { class: `chip chip-${l.level}` }, h('span', { class: 'mono' }, String(l.status)), LEVEL_LABEL[l.level]),
        h('span', { class: 'mono route' }, `${l.method} ${l.path}`)),
      h('p', { class: 'meta' },
        h('time', { datetime: l.ts }, dateFormat.format(new Date(l.ts))),
        h('span', {}, l.key_id == null ? 'Tanpa key' : l.key_name ? `Key: ${l.key_name}` : `Key #${l.key_id} (sudah dihapus)`),
        l.module ? h('span', {}, `Modul: ${l.module}`) : null,
        h('span', {}, `${numberFormat.format(l.ms)} ms`),
        l.message ? h('span', { class: 'mono' }, l.message) : null));
  }

  async function load({ append }) {
    const query = new URLSearchParams({ limit: '30' });
    if (logLevel) query.set('level', logLevel);
    if (append && cursor) query.set('before', String(cursor));
    const data = await api(`/logs?${query}`);
    cursor = data.next_before;

    if (!append) entries.replaceChildren();
    entries.append(...data.logs.map(logRow));
    entries.hidden = entries.children.length === 0;

    emptyHost.replaceChildren(entries.children.length === 0
      ? h('div', { class: 'empty' },
        h('p', {}, h('strong', {}, logLevel ? `Tidak ada log level ${LEVEL_LABEL[logLevel]}.` : 'Belum ada log.')),
        h('p', {}, logLevel
          ? 'Pilih level lain atau Semua level.'
          : 'Log muncul saat ada panggilan ke /v1. Panggil API dengan key dari halaman API Keys, lalu tekan Segarkan.'))
      : '');

    moreHost.replaceChildren(cursor
      ? h('button', { type: 'button', class: 'btn', id: 'more', onclick: (event) => runAction(event.currentTarget, () => load({ append: true }), '') }, 'Muat lebih lama')
      : '');
  }

  const select = h('select', { id: 'level', name: 'level' },
    h('option', { value: '' }, 'Semua level'),
    ...Object.entries(LEVEL_LABEL).map(([value, text]) => h('option', { value, selected: value === logLevel }, text)));
  select.addEventListener('change', () => {
    logLevel = select.value;
    runAction(select, () => load({ append: false }), '');
  });

  const refresh = h('button', { type: 'button', class: 'btn', onclick: (event) => runAction(event.currentTarget, () => load({ append: false }), 'Log disegarkan.') }, 'Segarkan');

  await load({ append: false });

  return [
    ...pageHead('Log', 'Panggilan ke /v1 dan percobaan masuk admin yang ditolak, terbaru di atas. Log yang lewat batas retensi dihapus otomatis.'),
    h('div', { class: 'panel fields fields-2' },
      h('div', {}, h('label', { for: 'level' }, 'Level'), select),
      h('div', { class: 'toolbar' }, refresh)),
    emptyHost,
    entries,
    moreHost,
  ];
}

/* Router */

const ROUTES = {
  beranda: { title: 'Beranda', render: renderHome },
  keys: { title: 'API Keys', render: renderKeys },
  modul: { title: 'Modul', render: renderModules },
  log: { title: 'Log', render: renderLogs },
};

let renderSeq = 0;

async function show({ focusHeading = false } = {}) {
  const mine = ++renderSeq;
  flash('');

  if (!session.get()) {
    renderLogin();
    return;
  }

  const name = Object.hasOwn(ROUTES, location.hash.slice(2)) ? location.hash.slice(2) : 'beranda';
  const route = ROUTES[name];
  nav.hidden = false;
  logoutButton.hidden = false;
  for (const link of nav.querySelectorAll('a')) {
    if (link.getAttribute('href') === `#/${name}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${route.title} · Nexus`;

  main.setAttribute('aria-busy', 'true');
  main.replaceChildren(...pageHead(route.title), h('p', { class: 'state', role: 'status' }, 'Memuat data dari server…'));

  try {
    const nodes = await route.render();
    if (mine !== renderSeq) return;
    main.replaceChildren(...nodes);
    if (focusHeading) main.querySelector('h1')?.focus({ preventScroll: true });
  } catch (err) {
    if (mine !== renderSeq || handleAuthLost(err)) return;
    main.replaceChildren(...pageHead(route.title), errorBox(err));
  } finally {
    if (mine === renderSeq) main.removeAttribute('aria-busy');
  }
}

logoutButton.addEventListener('click', () => {
  session.clear();
  history.replaceState(null, '', location.pathname);
  show();
});
window.addEventListener('hashchange', () => show({ focusHeading: true }));
show();
