'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('NOIR ICO includes PNG frames for Windows sizes and its tray frame matches the exported PNG',()=>{
 const root=path.resolve(__dirname,'../assets/icons'),ico=fs.readFileSync(path.join(root,'capri-mono.ico'));
 assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);const count=ico.readUInt16LE(4),sizes=[];
 for(let i=0;i<count;i++){const at=6+i*16,size=ico[at]||256,length=ico.readUInt32LE(at+8),offset=ico.readUInt32LE(at+12);assert.ok(offset+length<=ico.length);const png=ico.subarray(offset,offset+length);assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);if(size===32)assert.ok(png.equals(fs.readFileSync(path.join(root,'tray-mono.png'))));sizes.push(size);}
 assert.deepEqual(sizes,[16,24,32,48,64,128,256]);const png=fs.readFileSync(path.join(root,'capri-mono.png'));assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512);
});
