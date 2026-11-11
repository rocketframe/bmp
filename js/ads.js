// Ad slots. Fill in your AdSense publisher ID and slot IDs to switch from placeholders to live ads.
// AdSense needs an approved site, an ads.txt file, and (in the EU/UK) a Google-certified consent banner.
export const ADS = {
  provider: 'adsense',
  client: '',            // e.g. 'ca-pub-1234567890123456'
  slots: {               // AdSense ad unit IDs per placement
    top: '',             // leaderboard under the header (728x90 / responsive)
    rail: '',            // right rail (300x600 / 300x250)
    inline: '',          // between cards on the Today screen
    halftime: '',        // half-time interstitial card in the match
    fulltime: '',        // full-time summary
  },
};
const SIZES = { top: '728 × 90', rail: '300 × 600', inline: '300 × 250', halftime: '336 × 280', fulltime: '728 × 90' };
let loaded = false;
export function adSlot(name) {
  return `<aside class="ad ad-${name}" data-ad="${name}" aria-label="Advertisement"><span class="ad-tag">Advertisement</span><div class="ad-fill"><span>Ad space · ${SIZES[name] || ''}</span></div></aside>`;
}
export function mountAds(root = document) {
  if (!ADS.client) return;
  if (!loaded) {
    const s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS.client}`;
    document.head.appendChild(s); loaded = true;
  }
  root.querySelectorAll('[data-ad]').forEach(el => {
    if (el.dataset.mounted) return; const slot = ADS.slots[el.dataset.ad]; if (!slot) return;
    el.dataset.mounted = '1';
    el.querySelector('.ad-fill').innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${ADS.client}" data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
  });
}
