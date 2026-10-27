'use strict';
const YAML = require('yaml');
const crypto = require('node:crypto');
const net = require('node:net');
const { expandSiteBypass } = require('./site-bypass');
const MAX_BYTES = 2 * 1024 * 1024;
const TUN_DEFAULTS = { enable: false, stack: 'mixed', device: 'CapriVPN', 'auto-route': true, 'strict-route': true, 'auto-detect-interface': true, 'dns-hijack': ['any:53', 'tcp://any:53'], mtu: 1500, 'inet4-address': ['172.30.0.1/30'], 'inet6-address': [], 'route-address': [], 'route-exclude-address': [], 'exclude-interface': [] };
const DNS_DEFAULTS = { enable: true, listen: '127.0.0.1:1053', ipv6: false, 'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16', 'default-nameserver': ['1.1.1.1', '8.8.8.8'], nameserver: ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query'], 'proxy-server-nameserver': ['https://cloudflare-dns.com/dns-query'] };
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor', 'script', 'command', 'executable', 'plugin', 'external-ui', 'external-ui-url', 'external-controller-unix', 'external-controller-pipe', 'private-key-file', 'certificate', 'ca', 'safe-paths', 'geox-url', 'mmdb-url']);
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: нужен объект.`); return value; }
function walk(value, parent = '', depth = 0) {
  if (depth > 32) throw new Error('Слишком сложная конфигурация.');
  if (typeof value === 'string' && /^(?:file:|[a-z]:[\\/]|\\\\)/i.test(value)) throw new Error('Локальные пути из профиля запрещены.');
  if (Array.isArray(value)) { value.forEach((child) => walk(child, parent, depth + 1)); return; }
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.has(key)) throw new Error(`Небезопасное поле профиля: ${key}.`);
    if (key === 'path' && !['ws-opts', 'h2-opts'].includes(parent) && !parent.startsWith('provider:')) throw new Error('Локальные пути из профиля запрещены.');
    walk(child, ['proxy-providers', 'rule-providers'].includes(parent) ? 'provider:' + key : key, depth + 1);
  }
}
function list(value, label, max = 20000) { if (!Array.isArray(value) || value.length > max) throw new Error(`${label}: неверный список.`); return value; }
function httpsUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Нужна корректная HTTPS-ссылка.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' || isPrivate(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Разрешены только HTTPS-ссылки на внешние серверы.');
  return url;
}
function isPrivate(ip) {
  if (!net.isIP(ip)) return false;
  return /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|224\.|240\.)/.test(ip) || ip === '::' || ip === '::1' || /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(ip) || /^::ffff:/i.test(ip);
}
function providers(source, kind) {
  object(source, kind); const result = {};
  for (const [name, value] of Object.entries(source)) {
    const provider = structuredClone(object(value, 'Provider'));
    if (provider.type !== 'http') throw new Error('Для provider поддерживается HTTPS-источник; локальные файлы не импортируются.');
    httpsUrl(provider.url);
    const allowed = new Set(['type', 'url', 'interval', 'path', 'header', 'headers', 'health-check', 'override', 'filter', 'exclude-filter', 'exclude-type', 'format', 'behavior', 'size-limit']);
    for (const key of Object.keys(provider)) if (!allowed.has(key)) throw new Error(`Неподдерживаемое поле provider: ${key}.`);
    provider.path = './providers/' + crypto.createHash('sha256').update(kind + name).digest('hex') + (provider.format === 'mrs' ? '.mrs' : '.yaml');
    result[name] = provider;
  }
  return result;
}
function parseProfile(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('Размер профиля ограничен 2 МБ.');
  const doc = YAML.parseDocument(text, { uniqueKeys: true, maxAliasCount: 40 });
  if (doc.errors.length) throw new Error('Профиль содержит ошибку YAML.');
  const source = object(doc.toJS({ maxAliasCount: 40 }), 'Профиль');
  const out = {};
  for (const key of ['proxies', 'proxy-groups', 'rules', 'hosts']) if (source[key] !== undefined) out[key] = structuredClone(source[key]);
  for (const key of ['proxy-providers', 'rule-providers']) if (source[key]) out[key] = providers(source[key], key);
  walk(out);
  if (out.proxies) {
    const names = new Set();
    for (const proxy of list(out.proxies, 'Серверы', 5000)) {
      object(proxy, 'Сервер');
      if (typeof proxy.name !== 'string' || !proxy.name.trim() || proxy.name.length > 200 || typeof proxy.type !== 'string' || names.has(proxy.name)) throw new Error('У серверов должны быть уникальные имена и протокол.');
      names.add(proxy.name);
    }
  }
  if (!out.proxies?.length && !Object.keys(out['proxy-providers'] || {}).length) throw new Error('В профиле нет серверов. Нужен YAML Mihomo/Clash, а не HTML или список share-ссылок.');
  if (!out['proxy-groups']?.length) {
    const all = (out.proxies || []).map((proxy) => proxy.name);
    out['proxy-groups'] = [{ name: 'CAPRI', type: 'select', proxies: [...all, 'DIRECT'], ...(out['proxy-providers'] ? { use: Object.keys(out['proxy-providers']) } : {}) }];
  }
  list(out['proxy-groups'], 'Группы', 1000).forEach((group) => object(group, 'Группа'));
  if (!out.rules?.length) out.rules = ['MATCH,' + out['proxy-groups'][0].name];
  list(out.rules, 'Правила', 100000).forEach((rule) => { if (typeof rule !== 'string' || rule.length > 4096) throw new Error('Некорректное правило маршрутизации.'); });
  const importedFields = Object.keys(source).filter((key) => !Object.hasOwn(out, key));
  return { config: out, ignoredFields: importedFields, protocols: [...new Set((out.proxies || []).map((p) => p.type))] };
}
function cidr(value) {
  const [ip, size, extra] = String(value).split('/'); const version = net.isIP(ip);
  return !extra && version && /^\d+$/.test(size || '') && Number(size) >= 0 && Number(size) <= (version === 4 ? 32 : 128);
}
function tunSettings(input) {
  object(input, 'TUN');
  for (const key of Object.keys(input)) if (!Object.hasOwn(TUN_DEFAULTS, key)) throw new Error(`Неизвестный параметр TUN: ${key}.`);
  const out = { ...structuredClone(TUN_DEFAULTS), ...structuredClone(input) };
  for (const key of ['enable', 'auto-route', 'strict-route', 'auto-detect-interface']) if (typeof out[key] !== 'boolean') throw new Error('Переключатели TUN должны быть логическими.');
  if (!['system', 'gvisor', 'mixed'].includes(out.stack) || !/^[a-z0-9 _-]{1,40}$/i.test(out.device)) throw new Error('Некорректный стек или имя интерфейса TUN.');
  if (!Number.isInteger(out.mtu) || out.mtu < 1280 || out.mtu > 9000) throw new Error('MTU должен быть от 1280 до 9000.');
  for (const key of ['inet4-address', 'inet6-address', 'route-address', 'route-exclude-address']) list(out[key], key, 1000).forEach((v) => { if (!cidr(v)) throw new Error(`Неверный адрес CIDR в ${key}.`); });
  list(out['dns-hijack'], 'DNS Hijack', 10).forEach((v) => { if (!/^(?:tcp:\/\/)?(?:any|[0-9.]+):53$/.test(v)) throw new Error('DNS Hijack: используй any:53 или tcp://any:53.'); });
  list(out['exclude-interface'], 'Интерфейсы', 30).forEach((v) => { if (typeof v !== 'string' || !/^[\p{L}\p{N} _().-]{1,100}$/u.test(v)) throw new Error('Неверное исключение интерфейса.'); });
  return out;
}
function dnsSettings(input) {
  object(input, 'DNS');
  const allowed = new Set(['enable', 'listen', 'fake-ip-range', 'ipv6', 'enhanced-mode', 'nameserver', 'default-nameserver', 'proxy-server-nameserver', 'fallback', 'fake-ip-filter', 'nameserver-policy', 'respect-rules']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Неизвестный параметр DNS: ${key}.`);
  const out = { ...structuredClone(DNS_DEFAULTS), ...structuredClone(input), enable: true, listen: '127.0.0.1:1053' };
  if (!['fake-ip', 'redir-host'].includes(out['enhanced-mode']) || typeof out.ipv6 !== 'boolean') throw new Error('Неверный режим DNS.');
  for (const key of ['nameserver', 'default-nameserver', 'proxy-server-nameserver', 'fallback']) if (out[key]) list(out[key], key, 30).forEach((v) => { if (typeof v !== 'string' || (!net.isIP(v) && !/^(?:https|tls|quic):\/\/[a-z0-9.:\[\]/_-]+$/i.test(v))) throw new Error('Неверный DNS-сервер.'); });
  if (!out.nameserver.length || !out['default-nameserver'].length) throw new Error('Укажи DNS-серверы.');
  walk(out);
  return out;
}
function runtime(profile, settings, endpoint, secret) {
  const tun = tunSettings(settings.tun);
  const dns = dnsSettings(settings.dns);
  const config = { ...structuredClone(profile), mode: settings.mode || 'rule', 'log-level': 'warning', ipv6: Boolean(settings.ipv6), 'mixed-port': settings.proxyPort || 7897, 'allow-lan': false, 'bind-address': '127.0.0.1', 'external-controller': endpoint, secret, dns, tun, profile: { 'store-selected': false, 'store-fake-ip': false }, 'unified-delay': true, 'tcp-concurrent': true };
  if (!['rule', 'global', 'direct'].includes(config.mode) || !Number.isInteger(config['mixed-port']) || config['mixed-port'] < 1024 || config['mixed-port'] > 65535) throw new Error('Некорректный режим или порт прокси.');
  if (settings.rules?.length) config.rules = structuredClone(settings.rules);
  const bypass = expandSiteBypass(bypassSites(settings.bypassSites || []));
  if (bypass.length && config.mode !== 'direct') {
    const rules = bypass.map((host) => net.isIP(host) ? `${net.isIP(host) === 4 ? 'IP-CIDR' : 'IP-CIDR6'},${host}/${net.isIP(host) === 4 ? 32 : 128},DIRECT,no-resolve` : `DOMAIN-SUFFIX,${host},DIRECT`);
    // Mihomo's native global mode skips rules. Keep GLOBAL as the fallback
    // selector while evaluating explicit direct exceptions first.
    config.rules = [...rules, ...(config.mode === 'global' ? ['MATCH,GLOBAL'] : config.rules)];
    config.mode = 'rule';
  }
  walk(config);
  return config;
}
function bypassSites(input) {
  list(input, 'Сайты без VPN', 500);
  const result = new Set();
  for (const value of input) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f,]/.test(value.trim())) throw new Error('Сайты без VPN: укажи домен или HTTP/HTTPS-адрес, по одному на строку.');
    const text = value.trim().replace(/^\*\./, ''); if (!text) continue;
    let url;
    try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : 'https://' + text); }
    catch { throw new Error('Сайты без VPN: неверный адрес сайта.'); }
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (!net.isIP(host) && (host.length > 253 || !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))))) throw new Error('Сайты без VPN: нужен домен без паролей, масок и команд.');
    result.add(host);
  }
  return [...result];
}
module.exports = { parseProfile, runtime, tunSettings, dnsSettings, bypassSites, TUN_DEFAULTS, DNS_DEFAULTS, httpsUrl, isPrivate, MAX_BYTES };
