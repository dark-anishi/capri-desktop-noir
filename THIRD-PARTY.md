# Third-party distribution inventory

Capri's original Electron/JavaScript code and its independently written Windows helper retain the project's MIT license. No source code, UI, Rust/Tauri service code or assets from Clash Verge Rev were copied. Its GPLv3 implementation was inspected only as an architectural reference.

Mihomo 1.19.33 is distributed as an unmodified, independently executed program communicating through its documented localhost API. It is licensed under GPLv3. The installer includes these files under `resources/vpn/`:

- `mihomo.exe`: official Windows amd64-v1 build, Go 1.26.10, `with_gvisor`.
- `LICENSE`: complete upstream GPLv3 text.
- `source.tar.gz`: exact v1.19.33 source archive, including `go.mod`, `go.sum` and build workflows.
- `vendor.tar.gz`: the release's complete dependency source archive, including third-party notices and embedded Wintun DLLs.
- `manifest.json`: fixed release URLs, archive and executable SHA-256 values.

The same source and dependency archives are conveyed alongside the executable, rather than relying on a future availability promise. Rebuild instructions are in the upstream source's workflows and Go module files. The official build toolchain release asset is available at https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.33 . The dependency archive carries its individual licenses; preserve those notices when redistributing. The selected Windows TUN implementation embeds Wintun inside the core, so Capri does not download or substitute a DLL at runtime.

Sources inspected on 2026-10-26:

- https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.33
- https://github.com/MetaCubeX/mihomo/blob/v1.19.33/LICENSE
- https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/v2.5.8
- https://github.com/clash-verge-rev/clash-verge-rev/blob/main/LICENSE
- https://wiki.metacubex.one/en/config/inbound/tun/
- https://wiki.metacubex.one/api/

`yaml` is ISC-licensed. Existing Electron, electron-builder and font package notices remain in their distributed packages. The .NET Framework helper uses Windows-provided framework libraries, not a bundled replacement runtime.
