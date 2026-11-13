const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const number = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
const labels = { BOOK: 'Книга', COUNTRY: 'Страна', PRODUCT: 'Товар' };
const icons = { BOOK: '▤', COUNTRY: '◎', PRODUCT: '◇' };
const state = { page: 1, totalPages: 0, tab: 'catalog', selectedId: null, collections: [], token: sessionStorage.getItem('atlas-token') || '' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function notice(message) {
  $('#notice').textContent = message; $('#notice').hidden = !message;
  let modalNotice = $('#detail .dialog-error');
  if ($('#detail').open && message) {
    if (!modalNotice) { modalNotice = document.createElement('p'); modalNotice.className = 'dialog-error'; modalNotice.setAttribute('role','alert'); $('#detail').prepend(modalNotice); }
    modalNotice.textContent = message;
  } else modalNotice?.remove();
}
async function gql(query, variables = {}) {
  const response = await fetch('/graphql', { method: 'POST', headers: { 'content-type': 'application/json', ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(25000) });
  const result = await response.json();
  if (!response.ok || result.errors?.length) throw new Error((result.errors || []).map(e => e.message).join('\n') || `HTTP ${response.status}`);
  return { data: result.data, traceId: response.headers.get('x-trace-id') };
}
async function act(action) { try { notice(''); await action(); } catch (error) { notice(error.message); } }
const entryFields = `id title kind description url year value tags authors { name } source { id name } book { editionCount languages } country { capital region population area languages } product { brand price rating stock }`;
const catalogQuery = `query Catalog($filter: EntryFilter, $sort: EntrySort, $page: Int!, $pageSize: Int!) { entries(filter: $filter, sort: $sort, page: $page, pageSize: $pageSize) { total pageInfo { page totalPages hasNextPage } items { ${entryFields} } } }`;
async function stats() {
  const { data } = await gql('query Stats { catalogStats { total kinds { kind count } sources { id name url count } } }');
  const counts = data.catalogStats;
  $('#stats').innerHTML = [['Всего записей', counts.total], ...['BOOK', 'COUNTRY', 'PRODUCT'].map(kind => [({BOOK:'Книги',COUNTRY:'Страны',PRODUCT:'Товары'})[kind], counts.kinds.find(k => k.kind === kind)?.count || 0])].map(([label,count]) => `<div><b>${number(count)}</b><span>${label}</span></div>`).join('');
  $('#source-list').innerHTML = counts.sources.map(s => `<article class="card"><div class="card-top"><span class="pill">EXTERNAL SOURCE</span></div><h3>${esc(s.name)}</h3><p>${esc(s.url)}</p><b>${number(s.count)} записей</b></article>`).join('');
}
let catalogVersion = 0;
function filterVariables() {
  const filter = {};
  for (const [key,id] of [['search','search'],['kind','kind'],['sourceId','source'],['tag','tag']]) if ($('#'+id).value.trim()) filter[key] = $('#'+id).value.trim();
  for (const [key,id] of [['minYear','min-year'],['maxYear','max-year'],['minValue','min-value'],['maxValue','max-value']]) if ($('#'+id).value !== '') filter[key] = Number($('#'+id).value);
  const [field,direction] = $('#sort').value.split(':');
  return { filter, sort: { field,direction }, page: state.page, pageSize: Number($('#page-size').value) };
}
async function catalog() {
  const version = ++catalogVersion;
  $('#entries').setAttribute('aria-busy', 'true');
  try {
    const { data } = await gql(catalogQuery, filterVariables());
    if (version !== catalogVersion) return;
    const result = data.entries;
    state.totalPages = result.pageInfo.totalPages;
    $('#results-label').textContent = `${number(result.total)} записей · три разных взгляда на мир`;
    $('#entries').innerHTML = result.items.map(entry => `<article class="card"><div class="card-top"><span class="kind-icon" aria-label="${labels[entry.kind]}">${icons[entry.kind]}</span><span class="source-name">${esc(entry.source.name)}</span></div><h3>${esc(entry.title)}</h3><p>${esc(entry.description)}</p><div class="tags">${entry.tags.slice(0,3).map(tag => `<span class="tag">${esc(tag)}</span>`).join('') || `<span class="tag">${labels[entry.kind]}</span>`}</div><div class="card-bottom"><span>${entry.kind === 'BOOK' ? entry.year || 'Год не указан' : entry.kind === 'COUNTRY' ? number(entry.value) + ' км²' : '$' + number(entry.value)}</span><button data-open="${esc(entry.id)}">Подробнее ↗</button></div></article>`).join('') || '<div class="empty">Записей пока нет. Запустите импорт в разделе «Источники и импорт» или измените фильтры.</div>';
    $('#page-label').textContent = `Страница ${result.total ? state.page : 0} из ${state.totalPages}`;
    $('#prev').disabled = state.page <= 1; $('#next').disabled = !result.pageInfo.hasNextPage;
  } finally { if (version === catalogVersion) $('#entries').removeAttribute('aria-busy'); }
}
let collectionOffset = 0;
async function collections() {
  const { data } = await gql(`query Collections($offset: Int!) { collectionCount collections(limit:20, offset:$offset) { id name createdAt items { id title kind source { name } noteCount } } }`, {offset: collectionOffset});
  if (collectionOffset > 0 && collectionOffset >= data.collectionCount) { collectionOffset = Math.max(0, Math.floor((data.collectionCount - 1) / 20) * 20); return collections(); }
  state.collections = data.collections;
  $('#collection-prev').disabled = collectionOffset === 0;
  $('#collection-next').disabled = collectionOffset + 20 >= data.collectionCount;
  $('#collection-page').textContent = `${Math.floor(collectionOffset / 20) + 1} / ${Math.max(1, Math.ceil(data.collectionCount / 20))}`;
  $('#collection-list').innerHTML = data.collections.map(c => `<article class="collection"><div class="collection-header"><div><h3>${esc(c.name)}</h3><small>${c.items.length} / 100 записей</small></div><div><button class="quiet" data-rename="${c.id}">Переименовать</button> <button class="quiet" data-delete-collection="${c.id}">Удалить</button></div></div>${c.items.map(e => `<div class="collection-item"><span><b>${esc(e.title)}</b><br><small>${labels[e.kind]} · ${esc(e.source.name)} · заметок: ${e.noteCount}</small></span><button data-open="${esc(e.id)}" class="quiet">Открыть</button><button data-remove="${esc(e.id)}" data-collection="${c.id}" class="quiet">Убрать</button></div>`).join('') || '<p class="muted">Откройте запись каталога, чтобы добавить её сюда.</p>'}</article>`).join('') || '<div class="empty">Создайте первую подборку.</div>';
}
async function detail(id) {
  const { data } = await gql(`query Detail($id: ID!) { entry(id: $id) { ${entryFields} notes { id text createdAt } } collections { id name } }`, { id });
  if (!data.entry) throw new Error('Запись не найдена');
  state.selectedId = id;
  const e = data.entry;
  const metadata = [['Тип', labels[e.kind]], ['Источник', e.source.name], ['Год', e.year], ['Авторы', e.authors.map(a => a.name).join(', ')], ['Издания', e.book?.editionCount], ['Языки', (e.book?.languages || e.country?.languages || []).join(', ')], ['Площадь, км²', e.country?.area], ['Регион', e.country?.region], ['Столица', e.country?.capital.join(', ')], ['Население', e.country?.population != null ? number(e.country.population) : null], ['Бренд', e.product?.brand], ['Цена, USD', e.product?.price], ['Рейтинг', e.product?.rating], ['Остаток', e.product?.stock]].filter(([,v]) => v != null && v !== '');
  $('#detail-content').innerHTML = `<span class="pill">${labels[e.kind]}</span><h2>${esc(e.title)}</h2><p>${esc(e.description)}</p><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Открыть первоисточник ↗</a><div class="detail-meta">${metadata.map(([key,value]) => `<div><small>${key}</small>${esc(value)}</div>`).join('')}</div><div class="tags">${e.tags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</div><h3>Добавить в подборку</h3>${data.collections.length ? `<form id="add-to-collection" class="inline-form"><select name="collectionId">${data.collections.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button>Добавить +</button></form>` : '<p class="muted">Сначала создайте подборку в соответствующем разделе.</p>'}<h3>Заметки <small>(последние 20)</small></h3><form id="add-note"><textarea name="text" maxlength="2000" placeholder="Что стоит запомнить об этой записи?" required rows="3"></textarea><button>Добавить заметку</button></form>${e.notes.map(n => `<div class="note"><button class="quiet" data-delete-note="${n.id}">Удалить</button><small>${new Date(n.createdAt).toLocaleString('ru-RU')}</small><p>${esc(n.text)}</p></div>`).join('')}`;
  if (!$('#detail').open) $('#detail').showModal();
}
async function imports() {
  const { data } = await gql('query Imports { importJobs { id status target error createdAt progress { sourceId fetched page done error } } }');
  $('#job-list').innerHTML = data.importJobs.map(job => {
    const books = job.progress.find(p => p.sourceId === 'openlibrary')?.fetched || 0;
    return `<article class="job"><div class="job-header"><div><b>${esc(job.status)}</b> <small>${new Date(job.createdAt).toLocaleString('ru-RU')}</small></div>${['QUEUED','RUNNING'].includes(job.status) ? `<button data-cancel="${job.id}" class="quiet">Остановить</button>` : ''}</div><progress max="${job.target}" value="${Math.min(books,job.target)}"></progress>${job.progress.map(p => `<div class="job-row"><span>${esc(p.sourceId)} ${p.done ? '✓' : ''}</span><span>${number(p.fetched)} записей · страница ${p.page}</span></div>${p.error ? `<pre>${esc(p.error)}</pre>` : ''}`).join('')}${job.error ? `<pre>${esc(job.error)}</pre>` : ''}</article>`;
  }).join('') || '<div class="empty">Задач пока нет. Запустите сбор данных.</div>';
}
async function monitor(traceId = '') {
  const { data } = await gql('query Monitor($traceId: String) { diagnostics(traceId: $traceId) { requests errors rejected rateLimited overloaded p95Ms uptimeSeconds services { name status requests errors rejected inflight lastSeen } spans { id traceId parentId service operation durationMs errors status code at } } }', { traceId: traceId || null });
  const m = data.diagnostics;
  $('#services').innerHTML = m.services.map(s => `<article class="card"><div class="card-top"><span class="pill ${s.status === 'UP' ? 'status-up' : 'status-down'}">${s.status}</span><span class="source-name">SERVICE</span></div><h3>${s.name}</h3><p>Запросы / задачи: ${number(s.requests)} · Ошибки: ${number(s.errors)} · Отклонено: ${number(s.rejected)} · Выполняется: ${number(s.inflight)}</p><small>${s.lastSeen ? new Date(s.lastSeen).toLocaleTimeString('ru-RU') : 'Нет heartbeat'}</small></article>`).join('');
  $('#metrics').innerHTML = [['Запросы за окно',m.requests],['Ошибки / 429 / 503',`${m.errors} / ${m.rateLimited} / ${m.overloaded}`],['p95, мс',m.p95Ms],['Uptime, сек',m.uptimeSeconds]].map(([label,value]) => `<div><b>${typeof value === 'number' ? number(value) : esc(value)}</b><span>${label}</span></div>`).join('');
  $('#spans').innerHTML = m.spans.map(s => `<tr><td><b>${esc(s.service)}</b><small>${esc(s.operation)}</small></td><td>${new Date(s.at).toLocaleTimeString('ru-RU')}</td><td>${number(s.durationMs)} мс</td><td>${s.errors}<small>${s.status || '—'} ${esc(s.code || '')}</small></td><td><code>${esc(s.traceId)}</code><small>${esc(s.parentId || 'root')}</small></td></tr>`).join('');
}
function buildQuery() {
  $('#query').value = `query Explore($page: Int!, $pageSize: Int!) {\n  entries(page: $page, pageSize: $pageSize) {\n    total\n    pageInfo { page totalPages hasNextPage }\n    items {\n      id title kind year tags\n${$('#field-source').checked ? '      source { name url }\n' : ''}${$('#field-details').checked ? '      authors { name }\n      book { editionCount languages }\n      country { capital region population area }\n      product { brand price rating }\n' : ''}${$('#field-notes').checked ? '      notes { id text entry { id title } }\n' : ''}    }\n  }\n}`;
  $('#variables').value = '{"page":1,"pageSize":12}';
}
$$('[data-tab]').forEach(button => button.addEventListener('click', () => act(async () => {
  state.tab = button.dataset.tab;
  $$('.panel').forEach(panel => { panel.hidden = panel.id !== state.tab; });
  $$('[data-tab]').forEach(b => b.classList.toggle('active', b === button));
  if (state.tab === 'catalog') await Promise.all([catalog(), stats()]);
  if (state.tab === 'collections') await collections();
  if (state.tab === 'imports') await Promise.all([stats(), imports()]);
  if (state.tab === 'monitor') await monitor();
})));
$('#filters').addEventListener('submit', event => { event.preventDefault(); state.page = 1; act(catalog); });
$('#prev').onclick = () => { if (state.page > 1) { state.page--; act(catalog); } };
$('#next').onclick = () => { if (state.page < state.totalPages) { state.page++; act(catalog); } };
$('#close-detail').onclick = () => $('#detail').close();
$('#token-button').onclick = () => { $('#token').value = state.token; $('#token-dialog').showModal(); };
$('#close-token').onclick = () => $('#token-dialog').close();
$('#token-form').onsubmit = event => { event.preventDefault(); state.token = $('#token').value.trim(); sessionStorage.setItem('atlas-token',state.token); $('#token-dialog').close(); };
$('#collection-prev').onclick = () => { collectionOffset = Math.max(0, collectionOffset - 20); act(collections); };
$('#collection-next').onclick = () => { collectionOffset += 20; act(collections); };
$('#create-collection').onsubmit = event => { event.preventDefault(); const form = event.target; act(async () => { await gql('mutation Create($name: String!) { createCollection(name: $name) { id } }', { name: form.elements.name.value }); form.reset(); await collections(); }); };
$('#start-import').onsubmit = event => { event.preventDefault(); act(async () => { await gql('mutation Import($target: Int!) { startImport(target: $target) { id } }', { target: Number(event.target.elements.target.value) }); await imports(); }); };
$('#refresh-import').onclick = () => act(async () => { await Promise.all([imports(),stats()]); });
$('#refresh-monitor').onclick = () => act(() => monitor($('#trace-filter').elements.traceId.value));
$('#trace-filter').onsubmit = event => { event.preventDefault(); act(() => monitor(event.target.elements.traceId.value)); };
$('#build-query').onclick = buildQuery;
$('#nested-query').onclick = () => { $('#query').value = 'query FederatedCollections {\n  collections(limit:5) {\n    id name\n    items(limit:10) {\n      id title source { name }\n      notes(limit:5) { text entry { id title authors { name } } }\n    }\n  }\n}'; $('#variables').value = '{}'; };
$('#run-query').onclick = () => act(async () => { const start = performance.now(); const response = await fetch('/graphql', { method: 'POST', headers: { 'content-type':'application/json', ...(state.token ? { authorization:`Bearer ${state.token}` } : {}) }, body: JSON.stringify({ query: $('#query').value, variables: JSON.parse($('#variables').value || '{}') }), signal: AbortSignal.timeout(25000) }); $('#query-result').textContent = JSON.stringify(await response.json(),null,2); $('#query-time').textContent = `${Math.round(performance.now()-start)} мс · Trace ID: ${response.headers.get('x-trace-id')}`; });
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.open) act(() => detail(button.dataset.open));
  if (button.dataset.cancel) act(async () => { await gql('mutation Cancel($id: ID!) { cancelImport(id: $id) { id } }', { id: button.dataset.cancel }); await imports(); });
  if (button.dataset.deleteNote) act(async () => { await gql('mutation Delete($id: ID!) { deleteNote(id: $id) }', { id: button.dataset.deleteNote }); await detail(state.selectedId); });
  if (button.dataset.deleteCollection && confirm('Удалить подборку?')) act(async () => { await gql('mutation Delete($id: ID!) { deleteCollection(id: $id) }', { id: button.dataset.deleteCollection }); await collections(); });
  if (button.dataset.rename) { const name = prompt('Новое название подборки'); if (name) act(async () => { await gql('mutation Rename($id: ID!, $name: String!) { renameCollection(id: $id, name: $name) { id } }', { id: button.dataset.rename, name }); await collections(); }); }
  if (button.dataset.remove) act(async () => { await gql('mutation Remove($collectionId: ID!, $entryId: ID!) { removeFromCollection(collectionId: $collectionId, entryId: $entryId) { id } }', { collectionId: button.dataset.collection, entryId: button.dataset.remove }); await collections(); });
});
document.addEventListener('submit', event => {
  if (event.target.id === 'add-note') { event.preventDefault(); act(async () => { await gql('mutation Note($entryId: ID!, $text: String!) { addNote(entryId: $entryId, text: $text) { id } }', { entryId: state.selectedId, text: event.target.elements.text.value }); await detail(state.selectedId); }); }
  if (event.target.id === 'add-to-collection') { event.preventDefault(); act(async () => { await gql('mutation Add($collectionId: ID!, $entryId: ID!) { addToCollection(collectionId: $collectionId, entryId: $entryId) { id } }', { collectionId: event.target.elements.collectionId.value, entryId: state.selectedId }); event.target.querySelector('button').textContent = 'Добавлено ✓'; }); }
});
buildQuery();
await act(async () => { await Promise.all([stats(),catalog()]); });
let refreshing = false;
setInterval(async () => {
  if (document.hidden || refreshing || !['imports','monitor'].includes(state.tab)) return;
  refreshing = true;
  try { if (state.tab === 'imports') await Promise.all([imports(),stats()]); else await monitor($('#trace-filter').elements.traceId.value); }
  catch (error) { notice(error.message); }
  finally { refreshing = false; }
},5000);
