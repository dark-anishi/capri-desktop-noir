'use strict';
// Loaded only by isolated loopback routing/core tests, before VpnManager imports
// runtime(). These gates do not test DNS, and must not bind the live user's1053.
// Real DNS TCP/UDP readiness has its own test-vpn-startup-native.cjs gate.
const config = require('../src/main/vpn/config');
const runtime = config.runtime;
config.runtime = (...args) => {
  const result = runtime(...args); result.dns.enable = false; return result;
};
