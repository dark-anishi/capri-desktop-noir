# NOIR assets

The `mono/` SVG assets embed their existing PNG source and apply a silver-white palette: red hair and clothing and green accents become white or pale silver, while blue-heavy outlines remain dark. A component-transfer curve preserves black details. This code-native color treatment preserves the exact dimensions, transparency, pixel coordinates, portrait crops and animation rig. `tools/build-mono-assets.cjs` reproduces them. Procedural effects and the intro filmstrip receive the matching grayscale treatment in the renderer.

The separate application icon was created with the built-in ImageGen tool from `assets/icons/capri.png`, then saved as `assets/icons/capri-mono.png`. The original remains unchanged. `tools/build-icons.cjs` packages its resized PNG variants into the Windows ICO and a 32-pixel tray icon.

Version 0.6.0 adds three ImageGen drawings in `mono/poses/`: a drawn seated pose, a thoughtful approval-wait pose and a greeting/completion pose. They use transparent PNGs based on the existing NOIR full-body and mask references. Runtime registration preserves the window seat anchor; the renderer animates the two drawn shins independently. See `mono/poses/README.md` and `docs/NOIR-ANIMATIONS.md`. The SVG rebuild script does not overwrite these PNGs.

ImageGen prompt:

> Use case: identity-preserve. Edit target: the supplied square Capri app icon. Create a monochrome black, white and neutral-gray version of EXACTLY this icon. Keep the two round eyes, angular face markings, jagged grin, framing and all shapes in exactly their existing positions. Only convert its color palette to black and white with neutral grayscale shading. No colored pixels. Keep the original square opaque background and composition. No text, no border, no additional elements. This will be the Windows app icon for an animated character.
