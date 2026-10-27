'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {expandSiteBypass,MUSIC_DELIVERY}=require('../src/main/vpn/site-bypass');
const {createVpnNarrator}=require('../src/main/vpn/speech');
test('music exception includes its delivery hosts only when the actual music page is covered',()=>{
 for(const site of ['music.yandex.ru','yandex.ru','music.yandex.com']){
  const result=expandSiteBypass([site]);assert.ok(MUSIC_DELIVERY.every((host)=>result.includes(host)));assert.equal(new Set(result).size,result.length);
 }
 for(const site of ['example.com','evilmusic.yandex.ru','music.yandex.ru.evil.test','sub.music.yandex.ru'])assert.deepEqual(expandSiteBypass([site]),[site]);
 assert.deepEqual(expandSiteBypass([]),[]);assert.ok(!expandSiteBypass(['yandex.ru']).includes('yandex.net'));
});
test('VPN speech follows transitions and selections without repeating on traffic ticks or leaking error details',()=>{
 const spoken=[],narrate=createVpnNarrator((action,details)=>spoken.push({action,details}));
 const state=(phase,now='Sweden')=>({phase,activeId:'p',settings:{mode:'rule'},proxies:[{name:'GLOBAL',type:'Selector',now:'DIRECT'},{name:'VPN',type:'Selector',now}],error:'https://private.example/secret-token'});
 narrate(state('disconnected'));assert.equal(spoken.length,0);
 narrate(state('connecting'));narrate(state('connecting'));narrate(state('connected'));
 for(let i=0;i<30;i++)narrate(state('connected'));
 narrate(state('connected','Germany'));narrate(state('connected','Germany'));
 narrate(state('reconnecting'));narrate(state('connecting'));narrate(state('connected','Germany'));
 narrate(state('error'));narrate(state('error'));narrate(state('disconnected'));
 assert.deepEqual(spoken.map(s=>s.action),['vpnConnecting','vpnConnected','vpnLocation','vpnReconnecting','vpnConnected','vpnError','vpnDisconnected']);
 assert.equal(spoken[2].details.location,'Germany');assert.ok(!JSON.stringify(spoken).includes('secret-token'));
});

test('global VPN speech follows nested active selectors and ignores unused groups',()=>{
 const actions=[],speak=createVpnNarrator((action,details)=>actions.push({action,details}));
 const state=(active,unused)=>({phase:'connected',activeId:'p',settings:{mode:'global'},proxies:[{name:'GLOBAL',type:'Selector',now:'Active'},{name:'Active',type:'Selector',now:active},{name:'Unused',type:'Selector',now:unused}]});
 speak(state('Sweden','One'));speak(state('Sweden','Two'));speak(state('Germany','Two'));
 assert.deepEqual(actions.map(a=>a.action),['vpnConnected','vpnLocation']);assert.equal(actions[1].details.location,'Germany');
});
