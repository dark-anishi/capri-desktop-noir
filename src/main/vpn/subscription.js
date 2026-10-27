'use strict';
const dns = require('node:dns/promises');
const { httpsUrl, isPrivate, MAX_BYTES } = require('./config');
// Subscription services use this to choose a core-compatible configuration.
const USER_AGENT = 'mihomo/1.19.33';
async function downloadSubscription(value, { fetchImpl = fetch, lookup = dns.lookup } = {}) {
  let url = httpsUrl(value);
  for (let hop = 0; hop < 5; hop++) {
    let addresses;
    try { addresses = await lookup(url.hostname, { all: true }); }
    catch { throw new Error('Не удалось найти сервер подписки через DNS.'); }
    if (!addresses.length || addresses.some((item) => isPrivate(item.address))) throw new Error('Подписка указывает на локальную сеть.');
    let response;
    try { response = await fetchImpl(url.href, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT, Accept: 'application/yaml,text/yaml,text/plain' }, signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error('Не удалось загрузить подписку: проверь подключение и адрес.'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); url = httpsUrl(new URL(response.headers.get('location'), url).href); continue; }
    if (!response.ok) throw new Error('Сервер подписки ответил HTTP ' + response.status + '.');
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_BYTES) { await response.body?.cancel(); throw new Error('Подписка превышает 2 МБ.'); }
    let size = 0; const chunks = [];
    for await (const chunk of response.body) { size += chunk.length; if (size > MAX_BYTES) throw new Error('Подписка превышает 2 МБ.'); chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Слишком много перенаправлений подписки.');
}
module.exports = { downloadSubscription };
