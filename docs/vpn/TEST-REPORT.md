# Validation report for Capri 0.5.4

## Site routing exceptions (0.5.4)

- All 25 automated tests pass. Added a local, validated and persisted list of direct sites. Domain/URL/IDN/IP normalization, injection rejection, rule precedence and global-mode fallback have automated coverage.
- The real Mihomo routing test uses owned loopback HTTP origins and a CONNECT proxy: an exempt domain and its subdomain reach the direct origin, an unrelated and lookalike domain reach the GLOBAL proxy, rule-mode exceptions precede REJECT, and clearing the list restores global routing. This is actual forwarded traffic, not a mocked routing decision. System TUN was not used for this gate.
- The Electron UI test checks normalized saving, rejection of injected rules and persistence after restart. A live user's connection and subscription settings are not modified by these tests. Real Yandex playback and TUN routing of individual website domains are not established by this local gate.

## Favorites and Windows service repair (0.5.3)

- All 22 automated tests pass. Added per-profile favorite persistence/removal/isolation, strict favorite IPC validation, differentiated service failure codes (mock elevation), and a real .NET regression harness with invalid console handles. The console harness fails with `System.IO.IOException` on the old installed helper and succeeds with the corrected helper.
- Windows logs established the actual startup failure: .NET Runtime event 1026 at `Console.set_InputEncoding`, followed by SCM 7009/7000 timeouts. The service now enters the SCM dispatcher without accessing console streams. Elevated CLI operations also tolerate absent console handles.
- The real UAC installation/update path completed and Windows reported CapriVpn Running as LocalSystem. Standard-user pipe authentication then exposed a second access failure opening the LocalSystem process. The corrected client verifies the pipe PID and registered fixed executable path through SCM without requiring process access or weakening process permissions. The real authenticated status request passed.
- Explicit `node tools/test-vpn-service.cjs --test-interface` passed for system, gvisor and mixed. Each run created a real Windows adapter (Up), forwarded real loopback HTTP through the service-owned core, stopped the core and removed the adapter. Auto Route, Strict Route and DNS Hijack were disabled for these limited checks; no remote VPN connectivity or full-system routing/leak protection is established by them. The service was left running idle, with no core or test adapter.
- The real Electron UI test passed: star/unstar controls, favorite-only selector filtering, absence of the server text dump, and favorite persistence across an application restart. Existing icon, launcher, proxy-port fallback, DPAPI and music checks passed too.

## Proxy port conflict patch (0.5.2)

- All 19 automated tests pass. The real unprivileged core test now binds a competing listener, requests its occupied port, and verifies automatic fallback, persisted port settings, the correct public proxy address, actual forwarding through the new port, and reuse after restart. The competing listener remains reachable throughout.
- No user's running VPN processes are stopped or modified by the fix or tests. System TUN coexistence with another VPN is not established by resolving a proxy port conflict.

## Subscription compatibility patch (0.5.1)

- All 19 automated tests pass, including a regression test for the Mihomo User-Agent on initial requests and redirects.
- A user-provided HTTPS subscription was fetched with the production downloader, parsed (539 VLESS/Hysteria2 entries), and accepted by the pinned Mihomo core's `-t` validation. The URL, credentials and profile contents are omitted from this report and test fixtures. Temporary runtime files were removed.
- This subscription check did not start a VPN connection, enable TUN, or test server reachability. Earlier privileged Windows test limitations below still apply.

Environment: Windows x64, Node 22, Electron 44.9.3, official Mihomo 1.19.33 amd64-v1 (`with_gvisor`), independently compiled .NET Framework Windows helper.

## Automated coverage

- Node test suite: YAML sanitization, VLESS Reality data retention, protected local settings, TUN/DNS validation, encrypted profile storage with a test cipher, HTTPS subscription limits/redirects/private destinations, explicit IPC action schemas, authenticated REST errors, mocked subscription rollback, mocked privileged disconnect failure, native configuration policy and native REST allowlist.
- Real unprivileged core smoke: pinned binary verification, native sidecar/Windows Job Object ownership, actual Mihomo configuration validation, authenticated controller, real proxy selector changes, real loopback HTTP traffic, real byte counters, duplicate Connect deduplication, forced sidecar crash/recovery, stop/restart, released proxy port and cleanup. TUN was false throughout.
- Real Electron UI: native shortcut icons and drag/drop, category context menus, silent restore, minimize/restore, actual Windows DPAPI encryption on profile import, sender-checked VPN IPC, real unprivileged core connect/disconnect, safe public state, skins and isolated embedded music.
- Installer/resource checks: core/helper live outside ASAR, manifests/hashes match, exact core source/dependency archives and license are included. NSIS service cleanup hook is compiled into the uninstaller.

## Explicitly not executed

Beyond the limited service/adapter checks above, physical DNS/routing/leak checks with Auto Route and DNS Hijack enabled, real remote VLESS/Reality/VMess/Trojan/SS account connectivity, suspend/hibernate, network-adapter changes, cross-account isolation and privileged uninstall remain manual acceptance tests. A real subscription was parsed and validated without starting a connection; all actual traffic checks used local fixtures.

Mock lifecycle/policy tests are not evidence that administrator TUN or DNS leak prevention works. Follow WINDOWS-TUN-TESTS.md before treating this build as a validated system VPN. A full kill switch is not claimed.
