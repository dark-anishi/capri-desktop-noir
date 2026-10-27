# NOIR situational drawings

`seated.png`, `thinking.png`, and `wave.png` were generated from the existing NOIR full-body and mask references for Capri 0.6.0. The original generated transparent PNGs are kept intact. They are loaded only for the NOIR skin.

For 0.6.1, the built-in ImageGen tool generated two sibling PNGs from `seated.png` and the mask reference:

- `sleep-seated.png`: preserve the 1024×1536 framing, scale, pelvis at approximately y=915, knees, pointed feet, giant white mane and black/white panels; close both angular eyes, gently bow the head, relax the shoulders/hands; fully transparent background, no scenery, props, color or text.
- `music-seated.png`: preserve the same framing, registration, legs and identity; raise one claw hand lightly to the ear, keep the other on the invisible ledge and give her a relaxed head tilt; no headphones/extra props, notes, scenery, color or text; fully transparent background.

These are asset-generation prompt specifications. Runtime animation is implemented independently through the existing exposure sheets and WebGL rig, not by playing a generated video.

`src/renderer/js/pose-art.js` registers the drawings to the existing sprite coordinates at runtime. The seated pelvis stays at y=232, the current window anchor. The shader keeps the drawn thighs/body intact and moves the lower legs independently around y=244; hit testing uses the same transforms. Standing gestures retain the original face/feet anchors, head/mane motion and whole-body acting.

The existing cut-out is retained for pointing, hacking, teleporting, dragging, falling, peeking and unsupported acts, so its original articulated limbs remain available. Window movement/closure and user-selected skins keep their existing behavior. Reduced motion stops the seated leg swing.


0.6.4: `sleep-lying.png` is a new transparent 1536×1024 horizontal sleeping drawing, mapped into two canonical canvases with support at y=418 (floor) and y=232 (window ledge). It is displayed with uniform 1.5× scale around the support pivot, and click-through tests use the inverse scale. Zzz are runtime CSS text, respecting reduced motion. `gaze-seated.png` is a registered 1024×1536 pointing-up frame retaining the x510/y915 hip contact and original seated legs. Generated from the existing NOIR sprite references; original `sleep-seated.png` is retained as source art.
