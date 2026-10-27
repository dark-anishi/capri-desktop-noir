'use strict';
const { nativeImage } = require('electron');
for (const file of process.argv.slice(2)) {
  const image = nativeImage.createFromPath(file), { width, height } = image.getSize(), data = image.toBitmap();
  let clear = 0, partial = 0, solid = 0, left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = data[(y * width + x) * 4 + 3]; if (!a) clear++; else if (a === 255) solid++; else partial++;
    if (a > 200) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  console.log(JSON.stringify({ file, width, height, clear, partial, solid, corners: [data[3], data[(width - 1) * 4 + 3], data[((height - 1) * width) * 4 + 3]], samples: [[300,1100],[200,800],[500,300],[400,1100]].map(([x,y])=>({x,y,bgra:[...data.subarray((y*width+x)*4,(y*width+x)*4+4)]})), solidBounds: { left, top, right, bottom } }));
}
require('electron').app.quit();
