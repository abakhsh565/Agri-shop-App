// Force IPv4 DNS resolution for CI (GitHub Actions lacks IPv6 support)
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

// Mock localStorage for Node.js test environment
const store = {};
global.localStorage = {
  getItem: (key) => store[key] || null,
  setItem: (key, value) => { store[key] = value; },
  removeItem: (key) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i) => Object.keys(store)[i] || null,
};
