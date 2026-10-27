'use strict';
// A page exception must also cover its music API and audio delivery hosts. Keep this
// scoped to service/CDN families, rather than bypassing all of *.yandex.net.
const MUSIC_SITES = ['music.yandex.ru', 'music.yandex.com', 'music.yandex.by', 'music.yandex.kz', 'music.yandex.uz', 'music.yandex.com.tr'];
const MUSIC_DELIVERY = Object.freeze(['music.yandex.net', 'storage.yandex.net', 'storage.mds.yandex.net', 'storage.mdst.yandex.net', 'strm.yandex.net', 'strm.yandex.ru', 'cdn.yandex.net', 'ott-clear-key.ott.yandex.net', 'yastatic.net']);
function expandSiteBypass(sites) {
  const result = new Set(sites);
  if (sites.some((site) => MUSIC_SITES.some((host) => host === site || host.endsWith('.' + site)))) for (const host of MUSIC_DELIVERY) result.add(host);
  return [...result];
}
module.exports = { expandSiteBypass, MUSIC_DELIVERY };
