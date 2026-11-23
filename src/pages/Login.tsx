import { useEffect, useState, type CSSProperties } from 'react';
import { User, Lock, Eye, EyeOff, Loader2, AlertCircle, Info, ShieldCheck, Wifi, Database, KeyRound, House, FilePlus2, ClipboardCheck, Award, DoorOpen, ArrowRight } from 'lucide-react';
import { useAuth } from '../lib/context';
import IndianFlag from '../components/IndianFlag';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/playfair-display/600-italic.css';
import '../login.css';

/** How an application moves through AWAS (lights up step by step on the login page). */
const FLOW = [
  { icon: FilePlus2, label: 'Apply', note: 'New application' },
  { icon: ClipboardCheck, label: 'Scrutiny', note: 'As per policy' },
  { icon: Award, label: 'Seniority', note: 'Type & pool-wise' },
  { icon: KeyRound, label: 'Allotment', note: 'Order issued' },
  { icon: DoorOpen, label: 'Occupation', note: 'Take-over' },
];

const TRUST = [
  { icon: ShieldCheck, label: 'Secure Login' },
  { icon: Wifi, label: 'Works Offline' },
  { icon: Database, label: 'Data Backup' },
];

// "Remember Me" keeps only the username on this computer.
const REMEMBER_KEY = 'awas-login-username';
const readRemembered = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) || '';
  } catch {
    return '';
  }
};
const writeRemembered = (name: string) => {
  try {
    if (name) localStorage.setItem(REMEMBER_KEY, name);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* storage unavailable: nothing to remember */
  }
};

/** Large faint house silhouette ("shadow" picture) for the empty space between the title and the card. */
function ShadowHouse() {
  return (
    <svg className="aw-house" viewBox="0 0 520 380" aria-hidden="true">
      <ellipse cx="260" cy="352" rx="230" ry="16" className="gnd" />
      {/* tree */}
      <rect x="452" y="240" width="12" height="108" rx="4" className="sil" />
      <circle cx="458" cy="214" r="46" className="sil" />
      <circle cx="432" cy="240" r="30" className="sil" />
      <circle cx="486" cy="238" r="28" className="sil" />
      {/* chimney + smoke */}
      <rect x="292" y="58" width="26" height="60" className="sil" />
      <path className="smoke" d="M305 50 c-14 -14 14 -22 0 -38 c-12 -12 12 -20 2 -32" />
      {/* main two-storey block */}
      <path className="sil" d="M60 160 L210 52 L360 160 Z" />
      <rect x="82" y="156" width="256" height="196" className="sil" />
      {/* side wing */}
      <path className="sil" d="M330 214 L392 170 L438 214 Z" />
      <rect x="338" y="210" width="94" height="142" className="sil" />
      {/* windows and door (cut-outs) */}
      {[[108, 186], [176, 186], [244, 186], [108, 262], [244, 262]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="46" height="46" rx="3" className="cut" />
          <path className="pane" d={`M${x + 23} ${y} V${y + 46} M${x} ${y + 23} H${x + 46}`} />
        </g>
      ))}
      <rect x="180" y="262" width="42" height="90" rx="3" className="cut" />
      <circle cx="214" cy="310" r="3" className="sil" />
      <rect x="360" y="236" width="50" height="40" rx="3" className="cut" />
      <circle cx="210" cy="112" r="16" className="cut" />
      {/* fence */}
      <path className="fence" d="M20 352 V318 M44 352 V318 M68 352 V318 M8 330 H80 M8 344 H80" />
    </svg>
  );
}

/** Evening skyline of married-quarter blocks with windows lighting up, and a road with moving lane marks. */
function Skyline() {
  const blocks: [number, number, number, boolean][] = [
    // x, width, height, back row
    [0, 120, 120, true], [100, 90, 165, false], [185, 130, 110, true], [300, 110, 150, false], [400, 150, 95, true],
    [530, 100, 175, false], [620, 140, 120, true], [745, 120, 155, false], [850, 160, 105, true], [990, 110, 170, false],
    [1085, 140, 125, true], [1210, 120, 150, false], [1315, 150, 100, true], [1450, 150, 140, false],
  ];
  return (
    <svg className="aw-skyline" viewBox="0 0 1600 230" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {blocks.map(([x, w, h, back], i) => {
        const y = 200 - h;
        const cols = Math.floor((w - 16) / 22);
        const rows = Math.floor((h - 20) / 26);
        return (
          <g key={x}>
            <rect x={x} y={y} width={w} height={h} className={back ? 'bk2' : 'bk'} />
            {Array.from({ length: rows }, (_, r) =>
              Array.from({ length: cols }, (_, c) => (
                <rect
                  key={`${r}-${c}`}
                  x={x + 10 + c * 22}
                  y={y + 12 + r * 26}
                  width="11"
                  height="13"
                  rx="1.5"
                  className="win"
                  style={{ animationDelay: `${((i * 7 + r * 3 + c * 5) % 23) * -0.31}s` }}
                />
              )),
            )}
          </g>
        );
      })}
      <rect x="0" y="198" width="1600" height="32" className="road" />
      <line x1="0" y1="214" x2="1600" y2="214" className="lane" />
    </svg>
  );
}

// Kept short: they sit in the narrow space between the emblem and the flag.
const QUOTES_LEFT = ['Service Before Self', 'Fair & Transparent', 'Integrity First'];
const QUOTES_RIGHT = ['Every Quarter Counts', 'Seniority First', 'Homes for Families'];

function RotatingQuote({ quotes, side }: { quotes: string[]; side: 'left' | 'right' }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % quotes.length), 5000);
    return () => clearInterval(t);
  }, [quotes.length]);
  return (
    <div className={`lw-quote ${side}`} aria-live="off">
      <span key={i} className="lw-quote-text">
        <b>“</b>
        {quotes[i]}
        <b>”</b>
      </span>
    </div>
  );
}

/** Text split into letters that animate in one by one. */
/** Text split into letters that animate in one by one. */
function Letters({ text, delay = 0.2, step = 0.05 }: { text: string; delay?: number; step?: number }) {
  return (
    <span className="lw-letters" aria-hidden="true" style={{ '--delay': `${delay}s`, '--step': `${step}s` } as CSSProperties}>
      {[...text].map((ch, i) => (
        <span key={i} className={ch === ' ' ? 'sp' : 'ch'} style={{ '--i': i } as CSSProperties}>
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [org, setOrg] = useState({ organisation: 'CWE Shillong', office: '' });
  const [username, setUsername] = useState(readRemembered);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => !!readRemembered());
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/public-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setOrg(j))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const name = username.trim();
    try {
      await login(name, password);
      writeRemembered(remember ? name : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setShake(true);
      setBusy(false);
    }
  };

  const capsCheck = (e: React.KeyboardEvent) => setCaps(e.getModifierState?.('CapsLock') || false);
  const title = `HQ ${org.organisation}`.toUpperCase().replace(/^HQ HQ /, 'HQ ');

  return (
    <div className="lw-page aw">
      <header className="lw-head">
        <span className="lw-emb">
          <img className="lw-emblem" src="/logo-left.png" alt="Corps of Engineers emblem" />
        </span>
        <div className="lw-head-center">
          <RotatingQuote quotes={QUOTES_LEFT} side="left" />
          <span className="lw-divider" />
          <IndianFlag side="left" />
          <div className="lw-head-mid">
            <h1 aria-label={title}>
              <Letters text={title} />
            </h1>
            <span className="lw-gold-rule" />
            <p aria-label="ONE MEETING EXPECTATION">
              <Letters text="ONE MEETING EXPECTATION" delay={0.9} step={0.035} />
            </p>
          </div>
          <IndianFlag side="right" />
          <span className="lw-divider" />
          <RotatingQuote quotes={QUOTES_RIGHT} side="right" />
        </div>
        <span className="lw-emb right">
          <img className="lw-emblem" src="/logo-right.png" alt="Military Engineer Services emblem" />
        </span>
      </header>

      <main className="aw-body">
        <span className="aw-moon" aria-hidden="true" />
        <ShadowHouse />
        <Skyline />

        <section className="aw-hero">
          <span className="aw-chip">
            <House size={16} /> Govt Married Accommodation
          </span>
          <h2 className="aw-title" aria-label="AWAS">
            <Letters text="AWAS" delay={0.4} step={0.12} />
          </h2>
          <p className="aw-sub">
            Married Accommodation <span>Management System</span>
          </p>
          <span className="aw-rule" />
          <ol className="aw-flow" aria-label="Application process">
            {FLOW.map(({ icon: Icon, label, note }, i) => (
              <li key={label} style={{ '--i': i } as CSSProperties}>
                <span className="dot">
                  <Icon size={26} strokeWidth={1.9} />
                </span>
                <span>
                  {label}
                  <small>{note}</small>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className={`aw-card ${shake ? 'shake' : ''}`} onAnimationEnd={(e) => e.target === e.currentTarget && setShake(false)}>
          <div className="aw-card-head">
            <span className="aw-key">
              <KeyRound size={32} strokeWidth={2} />
            </span>
            <h3>Welcome</h3>
            <p>Sign in to continue to AWAS</p>
          </div>

          <form onSubmit={submit}>
            <div className="aw-field">
              <input
                id="username"
                placeholder=" "
                autoComplete="username"
                autoFocus={!username}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <label htmlFor="username">User ID / Login ID</label>
              <User className="ico" size={20} />
            </div>
            <div className="aw-field">
              <input
                id="password"
                placeholder=" "
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus={!!username}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={capsCheck}
                onKeyDown={capsCheck}
                onBlur={() => setCaps(false)}
                required
              />
              <label htmlFor="password">Password</label>
              <Lock className="ico" size={20} />
              <button type="button" className="aw-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {caps && <div className="aw-hint">Caps Lock is on</div>}

            <div className="aw-row">
              <label>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember Me
              </label>
              <button type="button" className="aw-link" onClick={() => setForgot((f) => !f)}>
                Forgot Password?
              </button>
            </div>
            {forgot && (
              <div className="aw-msg info">
                <Info size={18} /> Contact the Administrator to reset your password.
              </div>
            )}
            {error && (
              <div className="aw-msg err" role="alert">
                <AlertCircle size={18} /> {error}
              </div>
            )}

            <button className="aw-btn" disabled={busy}>
              {busy ? <Loader2 size={22} className="lw-spin" /> : null}
              {busy ? 'Signing in…' : 'Sign In'}
              {!busy && <ArrowRight size={22} className="arrow" />}
            </button>
          </form>

          <div className="aw-trust">
            {TRUST.map(({ icon: Icon, label }) => (
              <span key={label}>
                <Icon size={15} /> {label}
              </span>
            ))}
          </div>
        </section>
      </main>
      <footer className="lw-foot">AWAS — Govt Married Accommodation Management System{org.office ? ` · ${org.office}, ${org.organisation}` : ''}</footer>
    </div>
  );
}
