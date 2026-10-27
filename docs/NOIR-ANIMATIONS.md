# NOIR poses — Capri 0.6.1

Three transparent drawings were generated from the existing monochrome full-body and mask assets with the built-in image generation tool. The generated PNGs live inside the project and are packaged as normal assets.

Version 0.6.1 adds `sleep-seated.png` and `music-seated.png`, generated from the existing seated drawing and mask. Both keep the same seat registration and independent shin rig. The sleep drawing closes the eyes and relaxes the posture; the music drawing raises one hand to her ear. The originals remain intact. Built-in ImageGen was used; prompt specifications are recorded in `assets/skins/mono/poses/README.md`.

| Drawing | Situation | Motion |
| --- | --- | --- |
| Seated | Sitting on a visible window ledge, including while Codex works there | Independently swinging shins, a gentle hair cycle and a short pause between swings |
| Thinking | Waiting for a user answer/permission while standing | Small head/mane changes with a patient held pose |
| Greeting | Completion/victory, initial hook connection and an idle click when opening status | Pose-to-pose lean, nod and bounce around the greeting drawing |
| Seated sleep | Manual rest or idle sleep while sitting | Closed eyes, quiet breathing/head position, still legs; no mask dissolution |
| Seated music | Built-in player playing while Capri is idle | Head/mane cycle and alternating shin movement; pause restores normal sitting |

The drawn seat is registered to the existing hip anchor, not produced by compressing the standing figure. The window-following, drag/drop and fall logic are reused. Pointing, hacking, falling, peeking and teleporting retain the original articulated sprite. Seated characters keep sitting during approval waits; the standing thinking drawing is not forced onto a ledge. Original/color skin keeps its own source image.

Move a non-maximized window below the top of the screen so there is room for the character. Capri can choose its edge automatically, or the user can drag her so her hips are near its top edge and let go. In her middle-click quick menu, «Остаться здесь» binds to the sitting window or the suitable foreground window captured before the quick menu opens. «Открепить от окна» or dragging releases it. A pinned character follows the window, hides when its seat is covered, and returns when uncovered. Closing/minimizing/maximizing the window releases the binding and keeps the normal fall behavior. It is not persisted across app restarts, because native window handles can be reused. Reduced-motion preference stops the seated shin cycle.

«Подремать»/«Проснуться» provides immediate manual rest. Automatic idle sleep remains ten minutes and is suppressed while music is playing. NOIR sleepers use the lying drawing on either the ledge or floor with animated Zzz, with their support anchor preserved; only the classic skin retains the old mask behavior. Starting music also interrupts an in-progress transition into the mask. Pinning blocks idle wandering, window possession, automatic relocations for work/alerts and satellite acts, but keeps the normal work/alert state and speech.

The main process listens to native media/audio state events of the isolated music WebContents and sends only a boolean playback state to the overlay. No page script is injected for music metadata; remote pages gain no IPC, Node or filesystem access. This detects the built-in player's media state, not system-wide audio or track BPM. Hiding the menu retains playback; navigation, pause, crash and destruction clear the reaction.

## Validation

- All 27 Node tests passed, including situation/fallback selection, original-skin asset isolation, alpha format and seat registration.
- `tools/test-pose-ui.cjs` passed in real Electron/WebGL: changed lower-leg GPU pixels, transparent background, matching hit tests, the seat following a 60×30 window move, window-close fall, reduced motion, original-skin fallback, and actual application notification/completion triggers.
- The same renderer test covers pinning vs wandering/work/teleport, cover/uncover visibility and hit testing, persistent seated sleep with still legs, music wake/pause and the race when music starts during standing doze.
- `tools/test-companion-ui.cjs` exercises real menu pin/unpin/rest/wake IPC, a native Windows test window and its movement/closure, and real HTML audio play/pause in the music WebContents. The fixture continues while the menu is hidden, wakes a sleeper, and stops its reaction when the player is destroyed. External Yandex login, subscription and actual track playback are not part of this gate.
- The test uses a separate temporary userData folder. It does not import or alter a live subscription, service or VPN connection. Renderer movement checks use controlled window geometry so they are deterministic.
- `CAPRI_RECORD_POSES=1` also exports `captures/noir-window-seat.webm` from the actual WebGL sprite for visual review. These captures are previews, not application assets.

For another render check, set `CAPRI_PLAYWRIGHT_PATH` to the installed Playwright package and run `node tools/test-pose-ui.cjs`. `CAPRI_TEST_APP` can select a packaged Capri.exe instead of the source application.


0.6.4 quick controls use an isolated frameless BrowserWindow instead of a native Menu, to support a volume slider and middle-button toggle. Renderer actions are addressed by menu item IDs and checked against the current main-process model. Music controls capture the website's own Media Session handlers and detached HTMLMediaElements through a dedicated sandboxed preload; no privileged Electron/IPC API is exposed to the website.


0.6.7 manual rest is distinct from automatic idle sleep. Music and ordinary work updates do not interrupt a user-requested nap; explicit wake or an alert clears it. Window geometry uses the unprivileged native WinEvent watcher (16-ms batching, 500-ms recovery snapshot), with a 33-ms PowerShell fallback. An owned native-window test measured 59 movement updates, a 30-ms median interval and zero relative anchor drift in its source run; timing depends on the desktop scheduler.
