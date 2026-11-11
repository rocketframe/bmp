// Procedural club crests (SVG) from colours, shape and initials.
import { esc } from './dom.js';
const SHAPES = {
  shield: 'M50 4 L92 14 L92 52 C92 76 72 90 50 98 C28 90 8 76 8 52 L8 14 Z',
  round: 'M50 4 A46 46 0 1 1 49.9 4 Z',
  diamond: 'M50 2 L96 50 L50 98 L4 50 Z',
  pointed: 'M10 6 L90 6 L90 58 L50 98 L10 58 Z',
  square: 'M10 8 Q10 4 14 4 L86 4 Q90 4 90 8 L90 70 Q90 92 50 98 Q10 92 10 70 Z',
};
let n = 0;
export function crest(club, size = 40) {
  const c = club.colors, shape = SHAPES[club.crest?.shape] || SHAPES.shield;
  const id = 'cr' + (++n);
  const init = esc((club.short || club.name || '?').slice(0, 3));
  const motif = club.crest?.motif ?? 0;
  const pat = c.pattern === 'stripes' || c.pattern === 'pinstripe'
    ? [20, 40, 60, 80].map(x => `<rect x="${x - 5}" y="0" width="10" height="100" fill="${c.secondary}"/>`).join('')
    : c.pattern === 'hoops' ? [25, 50, 75].map(y => `<rect x="0" y="${y - 6}" width="100" height="12" fill="${c.secondary}"/>`).join('')
    : c.pattern === 'halves' ? `<rect x="50" y="0" width="50" height="100" fill="${c.secondary}"/>`
    : c.pattern === 'sash' ? `<path d="M0 10 L20 0 L100 80 L80 100 Z" fill="${c.secondary}"/>`
    : `<rect x="0" y="62" width="100" height="40" fill="${c.secondary}"/>`;
  const star = motif % 3 === 0 ? `<path d="M50 14 l3 7 7 .5 -5.5 4.5 2 7 -6.5 -4 -6.5 4 2 -7 -5.5 -4.5 7 -.5z" fill="${c.secondary}" stroke="${c.primary}" stroke-width="1"/>` : '';
  return `<svg class="crest" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><defs><clipPath id="${id}"><path d="${shape}"/></clipPath></defs>
<g clip-path="url(#${id})"><rect width="100" height="100" fill="${c.primary}"/>${pat}<rect x="18" y="36" width="64" height="30" rx="6" fill="rgba(0,0,0,.55)"/></g>
<path d="${shape}" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="4"/>${star}
<text x="50" y="58" text-anchor="middle" font-family="Big Shoulders Display, Barlow Condensed, sans-serif" font-weight="800" font-size="24" fill="#fff" letter-spacing="1">${init}</text></svg>`;
}
