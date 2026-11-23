// Indian national flag on a pole, waving (same as the Store Management System login).
// The cloth is drawn once as an SVG (3:2: saffron, white with the navy Ashoka Chakra of 24 spokes, India green)
// and shown through thin vertical strips that ripple one after another, so the wave travels away from the pole.
import type { CSSProperties } from 'react';

const W = 900;
const H = 600;

function flagSvg() {
  const cx = W / 2;
  const cy = H / 2;
  const r = 92;
  const spokes = Array.from({ length: 24 }, (_, i) => {
    const a = (i * 15 * Math.PI) / 180;
    return `<line x1="${cx}" y1="${cy}" x2="${(cx + r * Math.cos(a)).toFixed(1)}" y2="${(cy + r * Math.sin(a)).toFixed(1)}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="200" fill="#FF9933"/>
<rect y="200" width="${W}" height="200" fill="#FFFFFF"/>
<rect y="400" width="${W}" height="200" fill="#138808"/>
<g stroke="#000080" fill="none">
<circle cx="${cx}" cy="${cy}" r="${r}" stroke-width="12"/>
<g stroke-width="5">${spokes}</g>
</g>
<circle cx="${cx}" cy="${cy}" r="17" fill="#000080"/>
</svg>`;
}

const FLAG_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(flagSvg())}")`;
const STRIPS = 14;

/** `side="left"`: pole on the left, flying right. `side="right"`: pole on the right, flying left. */
export default function IndianFlag({ side = 'left' }: { side?: 'left' | 'right' }) {
  return (
    <span className={`in-flag ${side}`} role="img" aria-label="National flag of India">
      <span className="in-flag-pole" aria-hidden="true" />
      <span className="in-flag-cloth" aria-hidden="true">
        {Array.from({ length: STRIPS }, (_, i) => {
          const fromPole = side === 'left' ? i : STRIPS - 1 - i;
          return (
            <span
              key={i}
              className="in-flag-strip"
              style={
                {
                  backgroundImage: FLAG_URL,
                  backgroundSize: `${STRIPS * 100}% 100%`,
                  backgroundPosition: `${(100 * i) / (STRIPS - 1)}% 0`,
                  '--d': `${fromPole * -0.11}s`,
                  '--amp': `${(fromPole / (STRIPS - 1)) * 3.2}px`,
                } as CSSProperties
              }
            />
          );
        })}
      </span>
    </span>
  );
}
