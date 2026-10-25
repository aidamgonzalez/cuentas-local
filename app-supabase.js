/* Cuentas del Local · puente entre la página y Supabase:
   inicio de sesión, acceso por correo, datos en vivo, facturas, descargas y respaldo. */
(function () {
  const URL_ = window.SUPABASE_URL || '', KEY = window.SUPABASE_ANON_KEY || '';
  const configured = !!(window.supabase && window.supabase.createClient && /^https:\/\//.test(URL_) && KEY && !/PEGA_AQUI/.test(URL_ + KEY));
  const sb = configured ? window.supabase.createClient(URL_, KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cuentas-local-auth' }
  }) : null;
  const T = 'inv_docs', BUCKET = 'inv-facturas';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const domReady = new Promise(r => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r, { once: true }) : r());
  let resolveReady; const ready = new Promise(r => resolveReady = r);
  let me = null;

  /* ---------- caché local + avisos a la página ---------- */
  const cache = new Map(), docL = new Map(), colL = new Map();
  let loaded = false;
  const colOf = p => p.replace(/\/[^/]+$/, ''), idOf = p => p.split('/').pop();
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const meta = { fromCache: false, hasPendingWrites: false };
  const snapDoc = p => ({ id: idOf(p), exists: cache.has(p), data: () => clone(cache.get(p)), metadata: meta });
  const snapCol = c => { const docs = [...cache.keys()].filter(p => colOf(p) === c).sort().map(snapDoc); return { docs, size: docs.length, empty: !docs.length, metadata: meta, docChanges: () => [] }; };
  const fire = (set, v) => (set || []).forEach(f => { try { f(v); } catch (e) { console.error(e); } });
  function emit(p) { fire(docL.get(p), snapDoc(p)); const c = colOf(p); fire(colL.get(c), snapCol(c)); }
  function put(p, d) { if (d == null) cache.delete(p); else cache.set(p, d); emit(p); }
  const mapErr = e => ({ code: e && (e.code === '42501' || /row-level security|permission/i.test(e.message || '')) ? 'invalid_argument' : 'unavailable', message: (e && e.message) || '' });
  async function q(pr) { const { data, error } = await pr; if (error) throw mapErr(error); return data; }

  async function loadAll() {
    const rows = await q(sb.from(T).select('path,data').limit(10000));
    cache.clear(); rows.forEach(r => cache.set(r.path, r.data)); loaded = true;
    docL.forEach((set, p) => fire(set, snapDoc(p)));
    colL.forEach((set, c) => fire(set, snapCol(c)));
  }
  let channel = null;
  function startRealtime() {
    if (channel) return;
    channel = sb.channel('inv-docs-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: T }, ev => {
        if (ev.eventType === 'DELETE') { const p = ev.old && ev.old.path; if (p) put(p, null); }
        else if (ev.new && ev.new.path) put(ev.new.path, ev.new.data);
      })
      .subscribe(st => { if (st === 'SUBSCRIBED' && loaded) loadAll().catch(() => {}); });
    // al volver a la app, trae lo que cambió mientras estaba en segundo plano
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadAll().catch(() => {}); });
    window.addEventListener('online', () => loadAll().catch(() => {}));
  }

  function listen(map, key, fn, snap) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(fn);
    if (loaded) setTimeout(() => { if (map.get(key)?.has(fn)) fn(snap(key)); }, 0);
    return () => map.get(key)?.delete(fn);
  }
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function docRef(path) {
    return {
      id: idOf(path), path,
      async get() { const rows = await q(sb.from(T).select('path,data').eq('path', path)); put(path, rows[0] ? rows[0].data : null); return snapDoc(path); },
      async set(d) { const rows = await q(sb.from(T).upsert({ path, data: d, updated_at: new Date().toISOString() }).select('path,data')); put(path, rows[0].data); },
      async update(patch) {
        let cur = cache.get(path);
        if (!cur) { const rows = await q(sb.from(T).select('data').eq('path', path)); cur = rows[0] && rows[0].data; }
        if (!cur) throw { code: 'invalid_argument', message: 'no existe' };
        await this.set({ ...cur, ...patch });
      },
      async delete() { await q(sb.from(T).delete().eq('path', path)); put(path, null); },
      onSnapshot(next) { return listen(docL, path, next, snapDoc); },
      collection(sub) { return colRef(path + '/' + sub); }
    };
  }
  function colRef(c) {
    return {
      path: c,
      doc: id => docRef(c + '/' + (id || rid())),
      async add(d) { const r = docRef(c + '/' + rid()); await r.set(d); return r; },
      async get() { return snapCol(c); },
      onSnapshot(next) { return listen(colL, c, next, snapCol); }
    };
  }
  const db = { doc: docRef, collection: colRef };

  /* ---------- facturas (Supabase Storage) ---------- */
  const urlCache = new Map();
  async function fileUrl(id) {
    const c = urlCache.get(id);
    if (c && c.exp > Date.now()) return c.url;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(id, 3600);
    if (error) throw error;
    urlCache.set(id, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
  }
  const hex32 = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const assets = {
    async upload(blob, opts) {
      const type = (opts && opts.type) || blob.type;
      if (blob.size > 20 * 1048576) throw { code: 'too_large', message: '' };
      const id = hex32();
      const { error } = await sb.storage.from(BUCKET).upload(id, blob, { contentType: type, upsert: false });
      if (error) {
        const m = (error.message || '') + ' ' + (error.statusCode || '');
        throw { code: /size|413|large/i.test(m) ? 'too_large' : /mime|type|415/i.test(m) ? 'unsupported_type' : /security|403|401/i.test(m) ? 'not_granted' : 'store_unavailable', message: error.message };
      }
      return { id, url: '', sizeBytes: blob.size, contentType: type };
    },
    async delete(id) {
      const { data, error } = await sb.storage.from(BUCKET).remove([id]);
      if (error) throw { code: 'upstream_error', message: error.message };
      urlCache.delete(id);
      return { deleted: !!(data && data.length) };
    },
    async list() { return { assets: [], usage: {} }; }
  };

  /* ---------- descargas ---------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { status: 'saved' };
    }
  };

  window.__fileUrl = configured ? fileUrl : null;
  window.claude = {
    async use(name) {
      if (!configured) return null;
      await ready;
      return { db, assets, downloads }[name] || null;
    }
  };

  /* ---------- pantalla de entrada ---------- */
  const css = `
.auth{position:fixed;inset:0;z-index:80;background:var(--bg);display:grid;place-items:center;padding:calc(20px + env(safe-area-inset-top,0px)) 18px calc(20px + env(safe-area-inset-bottom,0px));overflow:auto}
.auth-card{width:100%;max-width:400px;background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);overflow:hidden}
.auth-top{background:var(--hero);color:var(--hero-ink);padding:24px 24px 20px;position:relative;overflow:hidden}
.auth-top::after{content:"";position:absolute;right:-50px;top:-70px;width:180px;height:180px;border-radius:50%;background:var(--s2);opacity:.22}
.auth-top h1{font-size:30px;margin:4px 0 0}
.auth-body{padding:20px 24px 24px;display:grid;gap:14px}
.auth-body form{display:grid;gap:12px}
.auth-body .btn{width:100%}
.auth-alt{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}
.auth-alt button{background:none;border:0;color:var(--accent);font:600 13px var(--body);cursor:pointer;padding:4px 0}
.auth-msg{font-size:13px;margin:0;min-height:1.2em;color:var(--muted)}
.auth-msg.err{color:var(--bad)}
.who{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.who span{font-size:12px;color:var(--hero-muted);overflow-wrap:anywhere}
.who button{font:600 12px var(--body);background:rgba(255,255,255,.14);color:var(--hero-ink);border:0;border-radius:999px;padding:6px 12px;cursor:pointer}
.mlist{display:grid;gap:6px;margin:6px 0 12px}
.mrow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line)}
.mrow:first-child{border-top:0}
.mrow b{display:block;font-size:14px}
.mrow small{color:var(--muted);overflow-wrap:anywhere}
.row-btns{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.copybox{display:flex;gap:8px;margin-top:6px}
.copybox input{flex:1;font-family:var(--mono);font-size:13px}`;

  function authHTML() {
    return `<div class="auth" id="auth" role="dialog" aria-modal="true" aria-labelledby="authTitle">
  <div class="auth-card">
    <div class="auth-top"><div class="eyebrow">Inversión del local comercial</div><h1 id="authTitle">Cuentas del Local</h1></div>
    <div class="auth-body">
      <p class="note" id="authLead">Entra con tu correo y tu clave.</p>
      <form id="authForm" novalidate>
        <label for="aEmail" id="aEmailLbl">Correo<input id="aEmail" type="email" autocomplete="email" inputmode="email" required></label>
        <label for="aPass">Clave<input id="aPass" type="password" autocomplete="current-password" minlength="6" required></label>
        <label for="aPass2" id="aPass2Lbl" hidden>Repite la clave<input id="aPass2" type="password" autocomplete="new-password" minlength="6"></label>
        <button class="btn" type="submit" id="aBtn">Entrar</button>
      </form>
      <p class="auth-msg" id="aMsg" role="status" aria-live="polite"></p>
      <div class="auth-alt" id="aAlt">
        <button type="button" id="aModo">Primera vez: crear mi clave</button>
        <button type="button" id="aOlvide">Olvidé mi clave</button>
      </div>
      <button type="button" class="ghost" id="aSalir" hidden>Salir y entrar con otro correo</button>
    </div>
  </div>
</div>`;
  }
  let modo = 'entrar';
  function msg(t, err) { const m = $('#aMsg'); if (m) { m.textContent = t || ''; m.className = 'auth-msg' + (err ? ' err' : ''); } }
  function setModo(m) {
    modo = m;
    const crear = m === 'crear', nueva = m === 'nueva';
    $('#authLead').textContent = crear ? 'Crea tu clave con el correo que tiene acceso a la app (mínimo 6 caracteres).' : nueva ? 'Escribe tu nueva clave.' : 'Entra con tu correo y tu clave.';
    $('#aBtn').textContent = crear ? 'Crear mi clave' : nueva ? 'Guardar nueva clave' : 'Entrar';
    $('#aPass2Lbl').hidden = !(crear || nueva);
    $('#aEmailLbl').hidden = nueva;
    $('#aPass').autocomplete = crear || nueva ? 'new-password' : 'current-password';
    $('#aModo').textContent = crear ? 'Ya tengo clave: entrar' : 'Primera vez: crear mi clave';
    $('#aAlt').hidden = nueva;
    msg('');
  }
  function showAuth() { const a = $('#auth'); if (a) a.hidden = false; }
  function hideAuth() { const a = $('#auth'); if (a) a.hidden = true; }
  const traducir = e => {
    const m = (e && e.message) || '';
    if (/invalid login|invalid credentials/i.test(m)) return 'Correo o clave incorrectos.';
    if (/already registered|already exists/i.test(m)) return 'Ese correo ya tiene clave. Usa “Entrar” o “Olvidé mi clave”.';
    if (/at least 6|password should/i.test(m)) return 'La clave debe tener al menos 6 caracteres.';
    if (/email not confirmed/i.test(m)) return 'Falta confirmar el correo. Revisa tu bandeja de entrada.';
    if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera un minuto y prueba otra vez.';
    if (/fetch|network/i.test(m)) return 'Sin conexión a internet.';
    return m || 'No se pudo completar. Intenta de nuevo.';
  };

  let entrado = false;
  async function entrar(session) {
    if (!session || entrado) return;
    me = session.user;
    const email = (me.email || '').toLowerCase();
    msg('Comprobando acceso…');
    let rows;
    try { rows = await q(sb.from('inv_miembros').select('email').eq('email', email)); }
    catch (e) { msg('No se pudo comprobar el acceso. Revisa tu conexión.', true); return; }
    if (!rows.length) {
      showAuth();
      $('#authForm').hidden = true; $('#aAlt').hidden = true; $('#aSalir').hidden = false;
      $('#authLead').textContent = '';
      msg(`El correo ${email} todavía no tiene acceso. Pide a tu socia que lo agregue en “Socias y reglas → Acceso a la app”.`, true);
      return;
    }
    entrado = true;
    try { await loadAll(); } catch (e) { msg('No se pudieron cargar los datos. Revisa tu conexión.', true); entrado = false; return; }
    startRealtime();
    hideAuth();
    pintarUsuario(email);
    pintarConfig();
    resolveReady();
  }

  async function iniciarAuth() {
    await domReady;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    if (!configured) {
      resolveReady();
      return;
    }
    document.body.insertAdjacentHTML('beforeend', authHTML());
    $('#aModo').onclick = () => setModo(modo === 'crear' ? 'entrar' : 'crear');
    $('#aSalir').onclick = async () => { await sb.auth.signOut(); location.reload(); };
    $('#aOlvide').onclick = async () => {
      const em = $('#aEmail').value.trim();
      if (!em) { msg('Escribe tu correo y vuelve a tocar “Olvidé mi clave”.', true); $('#aEmail').focus(); return; }
      msg('Enviando correo…');
      const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname });
      msg(error ? traducir(error) : 'Te enviamos un correo con un enlace para crear una clave nueva.', !!error);
    };
    $('#authForm').addEventListener('submit', async e => {
      e.preventDefault();
      const em = $('#aEmail').value.trim().toLowerCase(), pw = $('#aPass').value, pw2 = $('#aPass2').value;
      if ((modo === 'crear' || modo === 'nueva') && pw !== pw2) { msg('Las dos claves no coinciden.', true); return; }
      if (pw.length < 6) { msg('La clave debe tener al menos 6 caracteres.', true); return; }
      if (modo !== 'nueva' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { msg('Escribe un correo válido.', true); return; }
      const btn = $('#aBtn'); btn.disabled = true; msg(modo === 'entrar' ? 'Entrando…' : 'Guardando…');
      try {
        if (modo === 'entrar') {
          const { data, error } = await sb.auth.signInWithPassword({ email: em, password: pw });
          if (error) throw error; await entrar(data.session);
        } else if (modo === 'crear') {
          const { data, error } = await sb.auth.signUp({ email: em, password: pw, options: { emailRedirectTo: location.origin + location.pathname } });
          if (error) throw error;
          if (data.session) await entrar(data.session);
          else msg('Listo. Revisa tu correo para confirmar la cuenta y luego entra.');
        } else {
          const { data, error } = await sb.auth.updateUser({ password: pw });
          if (error) throw error;
          history.replaceState(null, '', location.pathname);
          setModo('entrar'); const s = await sb.auth.getSession(); await entrar(s.data.session);
        }
      } catch (err) { msg(traducir(err), true); }
      btn.disabled = false;
    });
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { showAuth(); setModo('nueva'); return; }
      if (event === 'SIGNED_OUT') { if (entrado) location.reload(); return; }
      if (session && modo !== 'nueva') setTimeout(() => entrar(session), 0);
    });
    const { data } = await sb.auth.getSession();
    if (data.session && !/type=recovery/.test(location.hash)) entrar(data.session);
    else { $('#aEmail').focus(); }
  }

  function pintarUsuario(email) {
    const h = $('header.top'); if (!h || $('#who')) return;
    const st = $('#status');
    const box = document.createElement('div'); box.className = 'who'; box.id = 'who';
    box.innerHTML = `<span>${esc(email)}</span><button type="button" id="logout">Salir</button>`;
    if (st) { st.parentNode.insertBefore(box, st); box.prepend(st); } else h.appendChild(box);
    $('#logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  }

  /* ---------- Socias y reglas: acceso y respaldo ---------- */
  const toast = t => { const el = $('#toast'); if (!el) return; el.textContent = t; el.classList.add('show'); clearTimeout(el._h); el._h = setTimeout(() => el.classList.remove('show'), 2600); };
  function pintarConfig() {
    const p = $('#p-config'); if (!p || $('#accesoCard')) return;
    const wrap = document.createElement('div'); wrap.className = 'split';
    const appUrl = location.origin + location.pathname;
    wrap.innerHTML = `
      <div class="card" id="accesoCard">
        <h3>Acceso a la app</h3>
        <p class="note">Solo estos correos pueden entrar. La persona abre la app, toca “Primera vez: crear mi clave” y usa este mismo correo.</p>
        <div class="mlist" id="mList"><span class="note">Cargando…</span></div>
        <form class="entry" id="fMiembro">
          <label for="mEmail">Correo<input id="mEmail" type="email" inputmode="email" required placeholder="correo@ejemplo.com"></label>
          <label for="mNombre">Nombre<input id="mNombre" placeholder="Ej. Maria"></label>
          <button class="btn" type="submit">Dar acceso</button>
        </form>
        <label for="appUrl" style="margin-top:14px">Enlace de la app<span class="copybox"><input id="appUrl" readonly value="${esc(appUrl)}"><button class="ghost" type="button" id="copyUrl">Copiar</button></span></label>
      </div>
      <div class="card" id="respaldoCard">
        <h3>Respaldo</h3>
        <p class="note">Descarga una copia completa (registros y facturas) para guardarla en tu teléfono o computadora. Con “Importar” se cargan los datos de un respaldo.</p>
        <div class="row-btns" style="margin-top:10px">
          <button class="btn" type="button" id="bkDown">Descargar respaldo</button>
          <button class="ghost" type="button" id="bkImp" style="padding:9px 14px">Importar respaldo</button>
          <input id="bkFile" type="file" accept="application/json,.json" hidden>
        </div>
        <p class="note" id="bkMsg" style="margin-top:10px" aria-live="polite"></p>
      </div>`;
    p.appendChild(wrap);
    $('#copyUrl').onclick = async () => { try { await navigator.clipboard.writeText(appUrl); toast('Enlace copiado'); } catch (_) { $('#appUrl').select(); } };
    cargarMiembros();
    $('#fMiembro').addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#mEmail').value.trim().toLowerCase(), nombre = $('#mNombre').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Escribe un correo válido.'); return; }
      const { error } = await sb.from('inv_miembros').upsert({ email, nombre });
      if (error) { toast('No se pudo dar acceso. Intenta de nuevo.'); return; }
      $('#mEmail').value = ''; $('#mNombre').value = ''; toast('Acceso dado a ' + email); cargarMiembros();
    });
    $('#mList').addEventListener('click', async e => {
      const b = e.target.closest('[data-quitar]'); if (!b) return;
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '¿Seguro?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Quitar'; } }, 3000); return; }
      const { error } = await sb.from('inv_miembros').delete().eq('email', b.dataset.quitar);
      toast(error ? 'No se pudo quitar el acceso.' : 'Acceso quitado'); cargarMiembros();
    });
    $('#bkDown').onclick = descargarRespaldo;
    $('#bkImp').onclick = () => $('#bkFile').click();
    $('#bkFile').addEventListener('change', importarRespaldo);
  }
  async function cargarMiembros() {
    const { data, error } = await sb.from('inv_miembros').select('email,nombre').order('creado');
    const yo = (me && me.email || '').toLowerCase();
    $('#mList').innerHTML = error ? '<span class="note">No se pudo cargar la lista.</span>' :
      data.map(m => `<div class="mrow"><div><b>${esc(m.nombre || m.email)}${m.email === yo ? ' (tú)' : ''}</b><small>${esc(m.email)}</small></div>${m.email === yo ? '' : `<button class="link" type="button" data-quitar="${esc(m.email)}">Quitar</button>`}</div>`).join('');
  }
  const toB64 = blob => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(blob); });
  async function descargarRespaldo() {
    const out = $('#bkMsg'), btn = $('#bkDown'); btn.disabled = true;
    try {
      await loadAll();
      const docs = {}; cache.forEach((d, p) => { docs[p] = d; });
      const ids = [...new Set([...cache.entries()].filter(([p]) => colOf(p) === 'facturas').map(([, d]) => d.assetId).filter(Boolean))];
      const archivos = {};
      for (const [i, id] of ids.entries()) {
        out.textContent = `Preparando facturas ${i + 1} de ${ids.length}…`;
        const { data, error } = await sb.storage.from(BUCKET).download(id);
        if (!error && data) archivos[id] = { tipo: data.type, base64: await toB64(data) };
      }
      const json = JSON.stringify({ app: 'cuentas-local', version: 1, exportado: new Date().toISOString(), docs, archivos });
      const d = new Date(), f = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await downloads.save({ filename: `respaldo-cuentas-local-${f}.json`, data: new Blob([json], { type: 'application/json' }) });
      out.textContent = `Respaldo listo: ${Object.keys(docs).length} registros y ${Object.keys(archivos).length} facturas.`;
    } catch (e) { out.textContent = 'No se pudo preparar el respaldo. Intenta de nuevo.'; }
    btn.disabled = false;
  }
  async function importarRespaldo(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    const out = $('#bkMsg');
    let bk; try { bk = JSON.parse(await file.text()); } catch (_) { out.textContent = 'Ese archivo no es un respaldo válido.'; return; }
    if (!bk || typeof bk.docs !== 'object') { out.textContent = 'Ese archivo no es un respaldo válido.'; return; }
    const paths = Object.keys(bk.docs), files = Object.entries(bk.archivos || {});
    let n = 0, fOk = 0, fErr = 0;
    try {
      for (const [i, [id, a]] of files.entries()) {
        out.textContent = `Subiendo facturas ${i + 1} de ${files.length}…`;
        const blob = await (await fetch(`data:${a.tipo};base64,${a.base64}`)).blob();
        const { error } = await sb.storage.from(BUCKET).upload(id, blob, { contentType: a.tipo, upsert: true });
        if (error) fErr++; else fOk++;
      }
      for (let i = 0; i < paths.length; i += 100) {
        out.textContent = `Guardando registros ${Math.min(i + 100, paths.length)} de ${paths.length}…`;
        const rows = paths.slice(i, i + 100).map(p => ({ path: p, data: bk.docs[p], updated_at: new Date().toISOString() }));
        await q(sb.from(T).upsert(rows)); n += rows.length;
      }
      await loadAll();
      out.textContent = `Importado: ${n} registros y ${fOk} facturas.` + (fErr ? ` ${fErr} facturas no se pudieron subir.` : '');
      toast('Respaldo importado');
    } catch (err) { out.textContent = 'La importación se detuvo por un error. Puedes volver a intentarlo; no se duplica nada.'; }
  }

  iniciarAuth();
})();
