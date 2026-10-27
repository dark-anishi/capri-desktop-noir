# Windows 10/11 x64: administrator acceptance checklist

These are manual tests, NOT passed automated results. Do them on a recoverable Windows test machine with a valid test subscription and a way to regain local network access. The automated real-core smoke uses only loopback HTTP with TUN disabled.

For 0.5.3, UAC service update/start and authenticated pipe access were checked on Windows. The explicit `node tools/test-vpn-service.cjs --test-interface` gate passed real adapter creation/Up/cleanup and local proxy forwarding for all three stacks, with Auto Route/Strict Route/DNS Hijack disabled. This does not mark the system routing/DNS/leak matrix below as passed. See TEST-REPORT.md for exact coverage.

## Baseline and installation

1. Save the output of `Get-NetAdapter`, `Get-NetRoute`, `Get-DnsClientServerAddress` and `Get-NetIPConfiguration` before connecting. Record the active physical adapter, default IPv4/IPv6 routes and DNS servers.
2. Install the Capri build normally. Verify Capri.exe is not elevated. Open VPN → Service and diagnostics → Install/repair. Approve the native helper in Windows UAC. Verify the fixed `CapriVpn` service runs as LocalSystem; its image is in Program Files/CapriVPN, not AppData or a writable temporary directory.
3. Confirm an ordinary user cannot modify the installed service/helper/core or its protected ProgramData directory, cannot replace them with reparse points and cannot connect through another Windows account. Verify cancelling UAC produces a visible error without starting a privileged process.
4. Tamper with a COPY of the core in an isolated installation. The checksum gate must reject it. Restore the official file; do not weaken filesystem ACLs to continue.

## Connect, DNS and routes

1. Import a real YAML profile or HTTPS subscription. Check the profile server count and selector groups. Choose a known working server, measure latency and verify its protocol (VLESS+Reality, VMess, Trojan and Shadowsocks should each have a separate real test profile).
2. Enable TUN, Auto Route, Strict Route and Auto Detect Interface; use DNS hijack `any:53` and `tcp://any:53`. Connect. Confirm exactly one named CapriVPN adapter exists and its CIDRs/MTU match settings. Check the real public IPv4/IPv6 and application traffic follow the selected server/rules.
3. Test each supported stack: `system`, `gvisor`, `mixed`. If Windows Firewall rejects a stack, inspect the core's firewall permission; never disable Windows Firewall globally as a workaround.
4. Compare routes with baseline. Test the default route and each configured route exclusion against a controlled host. Test LAN access intentionally included/excluded by the chosen rules.
5. Perform controlled DNS leak checks with UDP/TCP 53 and configured DoH. Capture on physical and TUN adapters using an administrator-approved capture tool. Confirm Strict Route and DNS hijack behave as intended. Test IPv6 both enabled and disabled, including a host with working IPv6. Do not infer leak protection from a green UI indicator.
6. Test CIDR/interface exclusions and a deliberately conflicting interface name/address. An error must leave the previous working configuration recoverable. Do not reuse a real system adapter name.

## Disconnect and recovery

1. Disconnect normally. Verify the core process and its proxy/API sockets close, the owned TUN adapter/routes disappear and physical adapter DNS settings match baseline. The app never changes unrelated adapters' DNS or the Windows global proxy settings.
2. Switch Wi-Fi ↔ Ethernet, disconnect/reconnect networking and change the upstream address. Confirm recovery does not create duplicate adapters or enter a self-triggered TUN restart loop.
3. Suspend/resume and hibernate/resume Windows while connected, then repeat while disconnected. A disconnected session must remain disconnected. A connected session must recover or show a visible failure.
4. In a test machine, terminate the core, then the sidecar/service host, then Capri. Verify Windows Job Objects kill owned child processes; the service's owner lease stops an abandoned core after at most 30 seconds without an authenticated heartbeat. Check routes/DNS again. This interval is not a kill switch or a no-leak guarantee.
5. Reopen Capri, reconnect, change profiles and repeat Connect/Disconnect rapidly. Ensure no duplicate processes or stale API ports remain. Occupy the chosen proxy port deliberately and verify automatic selection of a saved free port without overwriting another program's settings.

## Updates, rollback and uninstall

1. Apply a malformed/unreachable subscription and unsupported settings. Check the prior profile is retained and can be rolled back. Inspect diagnostics for absence of passwords, UUIDs, private keys, subscription tokens and API secrets.
2. Update an installed application while a service exists. Reinstall/repair the service if the core version changes. Check no old executable is used accidentally.
3. Stop the service from Capri, start it again, remove it and reinstall it. A different non-administrator account must not control the installing account's service.
4. Uninstall Capri with a service present. Approve the helper's UAC request and verify the service registration, core, protected service configuration and owned processes are removed. If an executable is in use, Windows may finish its scheduled deletion at reboot. If UAC is declined, uninstall must abort instead of silently leaving an active service.

## Status for this build

- Compiled helper/service, policy and IPC validation: automated checks.
- Real Mihomo unprivileged local-proxy traffic, stop/restart/crash recovery: automated real-core smoke.
- Real Electron UI, Windows DPAPI and window minimize/restore: automated UI checks.
- Service installation/UAC, administrator TUN, physical routes/DNS, real remote VPN protocols, sleep/network transitions and privileged uninstall: NOT EXECUTED. No test subscription or administrator service session was used. No production-grade kill switch is claimed.
