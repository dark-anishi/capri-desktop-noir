'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { TUN_DEFAULTS, DNS_DEFAULTS } = require('./config');
class VpnStore {
  constructor(root, cipher) {
    this.root = root; this.file = path.join(root, 'profiles.dat'); this.cipher = cipher;
    fs.mkdirSync(root, { recursive: true });
    if (!cipher.isEncryptionAvailable()) throw new Error('Windows DPAPI недоступен. Профили не будут сохранены открытым текстом.');
    this.data = fs.existsSync(this.file) ? JSON.parse(cipher.decryptString(fs.readFileSync(this.file))) : { profiles: [], activeId: null, settings: { tun: structuredClone(TUN_DEFAULTS), dns: structuredClone(DNS_DEFAULTS), mode: 'rule', ipv6: false, proxyPort: 7897 }, selections: {} };
    if (!Array.isArray(this.data.profiles) || !this.data.settings) throw new Error('Хранилище VPN повреждено. Данные сохранены для восстановления.');
  }
  commit(next) {
    fs.writeFileSync(this.file + '.tmp', this.cipher.encryptString(JSON.stringify(next)), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file); this.data = next;
  }
  profile(id = this.data.activeId) { const profile = this.data.profiles.find((p) => p.id === id); if (!profile) throw new Error('Сначала импортируй и выбери профиль VPN.'); return profile; }
  publicProfiles() { return this.data.profiles.map((p) => ({ id: p.id, name: p.name, subscription: Boolean(p.url), canRollback: Boolean(p.previousConfig), updatedAt: p.updatedAt, servers: p.config.proxies?.length || 0, protocols: [...new Set((p.config.proxies || []).map((v) => v.type))] })); }
  add(name, config, url) {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Название профиля: от 1 до 80 символов.');
    const profile = { id: randomUUID(), name: name.trim(), config, url: url || null, updatedAt: Date.now() };
    this.commit({ ...this.data, profiles: [...this.data.profiles, profile], activeId: this.data.activeId || profile.id });
    return profile.id;
  }
}
module.exports = { VpnStore };
