'use client';
import { motion } from 'framer-motion';

/**
 * Illustrations 2.5D : chaque volume = face avant (dégradé + reflet) + épaisseur décalée (face arrière sombre)
 * + ombre de contact douce. Tout est vectoriel (SVG), donc parfaitement lisse à toutes les tailles.
 */

const D = 9; // profondeur d'extrusion (px SVG)

/** Dalle arrondie extrudée : épaisseur, face avant dégradée, liseré clair haut-gauche, reflet. */
function Slab({ x, y, w, h, r, face, side, depth = D, gloss = true, stroke = 'rgba(255,255,255,.85)' }: { x: number; y: number; w: number; h: number; r: number; face: string; side: string; depth?: number; gloss?: boolean; stroke?: string }) {
  return (
    <g>
      <rect x={x + depth} y={y + depth} width={w} height={h} rx={r} fill={side} />
      <rect x={x + depth / 2} y={y + depth / 2} width={w} height={h} rx={r} fill={side} opacity=".55" />
      <rect x={x} y={y} width={w} height={h} rx={r} fill={face} />
      <rect x={x + 1} y={y + 1} width={w - 2} height={h - 2} rx={r - 1} fill="none" stroke={stroke} strokeWidth="1.6" opacity=".9" />
      {gloss && <path d={`M${x + r * 0.7} ${y + h * 0.3} Q${x + w * 0.5} ${y - h * 0.02} ${x + w - r * 0.7} ${y + h * 0.22}`} stroke="#fff" strokeWidth="3.2" strokeLinecap="round" fill="none" opacity=".55" />}
    </g>
  );
}

/** Capsule 2.5D (membres) : tube avec ombrage cylindrique. */
function Tube({ d, w, from = '#ffffff', to = 'color-mix(in srgb, rgb(var(--b-violet)) 38%, #fff)' }: { d: string; w: number; from?: string; to?: string }) {
  return (
    <g strokeLinecap="round" fill="none">
      <path d={d} stroke="color-mix(in srgb, rgb(var(--b-violet)) 55%, #9a92d0)" strokeWidth={w + 3} transform="translate(3 4)" opacity=".7" />
      <path d={d} stroke={to} strokeWidth={w} />
      <path d={d} stroke={from} strokeWidth={w * 0.45} transform="translate(-1.2 -1.6)" opacity=".85" />
    </g>
  );
}

function Orb({ cx, cy, r, id }: { cx: number; cy: number; r: number; id: string }) {
  return (
    <g>
      <circle cx={cx + 2.5} cy={cy + 3.5} r={r} fill="#2a2f6e" opacity=".22" />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />
      <ellipse cx={cx - r * 0.35} cy={cy - r * 0.42} rx={r * 0.34} ry={r * 0.2} fill="#fff" opacity=".7" transform={`rotate(-30 ${cx - r * 0.35} ${cy - r * 0.42})`} />
    </g>
  );
}

const orbDef = (id: string, c1: string, c2: string, c3: string) => (
  <radialGradient id={id} cx=".35" cy=".3" r=".95"><stop offset="0" stopColor={c1} /><stop offset=".55" stopColor={c2} /><stop offset="1" stopColor={c3} /></radialGradient>
);

/** Mascotte originale « Bibo » : petit robot analyste en 2.5D. */
export function Robot({ size = 220, waving = true, className = '' }: { size?: number; waving?: boolean; className?: string }) {
  return (
    <motion.svg width={size} height={size * 1.2} viewBox="0 0 220 264" className={className} animate={{ y: [0, -7, 0] }} transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut' }} aria-label="Bibo, le robot BI Advisor" shapeRendering="geometricPrecision">
      <defs>
        <linearGradient id="r-head" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset=".6" stopColor="color-mix(in srgb, rgb(var(--b-violet)) 12%, #fff)" /><stop offset="1" stopColor="color-mix(in srgb, rgb(var(--b-violet)) 32%, #fff)" /></linearGradient>
        <linearGradient id="r-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset=".55" stopColor="color-mix(in srgb, rgb(var(--b-pink)) 16%, #fff)" /><stop offset="1" stopColor="color-mix(in srgb, rgb(var(--b-pink)) 48%, #fff)" /></linearGradient>
        <linearGradient id="r-screen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#242a5e" /><stop offset="1" stopColor="#0f1233" /></linearGradient>
        <linearGradient id="r-foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="color-mix(in srgb, rgb(var(--b-violet)) 80%, #fff)" /><stop offset="1" stopColor="color-mix(in srgb, rgb(var(--b-violet)) 80%, #000)" /></linearGradient>
        <linearGradient id="r-ear" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="color-mix(in srgb, rgb(var(--b-blue)) 85%, #fff)" /><stop offset="1" stopColor="color-mix(in srgb, rgb(var(--b-blue)) 60%, #000)" /></linearGradient>
        {orbDef('r-pink', 'color-mix(in srgb, rgb(var(--b-pink)) 28%, #fff)', 'rgb(var(--b-pink))', 'color-mix(in srgb, rgb(var(--b-pink)) 70%, #000)')}
        {orbDef('r-blue', 'color-mix(in srgb, rgb(var(--b-blue)) 30%, #fff)', 'rgb(var(--b-blue))', 'color-mix(in srgb, rgb(var(--b-blue)) 70%, #000)')}
        <radialGradient id="r-shadow"><stop offset="0" stopColor="#3b3f9e" stopOpacity=".34" /><stop offset="1" stopColor="#3b3f9e" stopOpacity="0" /></radialGradient>
        <filter id="r-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <ellipse cx="108" cy="250" rx="66" ry="9" fill="url(#r-shadow)" />
      {/* jambes */}
      <Tube d="M88 196 L88 232" w={18} />
      <Tube d="M118 196 L118 232" w={18} />
      <ellipse cx="92" cy="237" rx="17" ry="8" fill="color-mix(in srgb, rgb(var(--b-violet)) 60%, #000)" /><ellipse cx="88" cy="234" rx="16" ry="8" fill="url(#r-foot)" />
      <ellipse cx="122" cy="237" rx="17" ry="8" fill="color-mix(in srgb, rgb(var(--b-violet)) 60%, #000)" /><ellipse cx="118" cy="234" rx="16" ry="8" fill="url(#r-foot)" />
      {/* bras gauche */}
      <Tube d="M66 150 Q42 156 32 180" w={14} />
      <Orb cx={31} cy={183} r={10} id="r-pink" />
      {/* corps */}
      <Slab x={62} y={130} w={80} h={70} r={30} face="url(#r-body)" side="color-mix(in srgb, rgb(var(--b-pink)) 55%, #7a6aa8)" />
      <rect x="80" y="150" width="44" height="26" rx="13" fill="url(#r-screen)" />
      <path d="M87 166 l8 -7 l7 5 l9 -9" stroke="rgb(var(--b-eye))" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" filter="url(#r-glow)" />
      <circle cx="102" cy="187" r="3.4" fill="rgb(var(--b-pink))" /><circle cx="102" cy="186" r="1.2" fill="#fff" opacity=".8" />
      {/* bras droit (salue) */}
      <motion.g style={{ originX: '140px', originY: '150px' }} animate={waving ? { rotate: [0, -16, 0, -16, 0] } : {}} transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.6 }}>
        <Tube d="M142 150 Q172 144 184 118" w={14} />
        <Orb cx={185} cy={113} r={10} id="r-blue" />
      </motion.g>
      {/* antenne */}
      <path d="M104 46 Q108 28 118 20" stroke="color-mix(in srgb, rgb(var(--b-violet)) 60%, #8d85d6)" strokeWidth="4.5" strokeLinecap="round" fill="none" transform="translate(2 3)" opacity=".6" />
      <path d="M104 46 Q108 28 118 20" stroke="color-mix(in srgb, rgb(var(--b-violet)) 30%, #fff)" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <motion.g animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1.7, repeat: Infinity }} style={{ originX: '120px', originY: '16px' }}><Orb cx={120} cy={16} r={8} id="r-pink" /></motion.g>
      {/* oreillettes */}
      <rect x="36" y="76" width="18" height="40" rx="9" fill="#2a3470" transform="translate(4 4)" opacity=".7" /><rect x="36" y="76" width="18" height="40" rx="9" fill="url(#r-ear)" />
      <rect x="158" y="76" width="18" height="40" rx="9" fill="#2a3470" transform="translate(4 4)" opacity=".7" /><rect x="158" y="76" width="18" height="40" rx="9" fill="url(#r-ear)" />
      {/* tête */}
      <Slab x={50} y={44} w={112} h={92} r={42} face="url(#r-head)" side="color-mix(in srgb, rgb(var(--b-violet)) 45%, #b8b0e0)" depth={10} />
      <rect x="62" y="58" width="88" height="56" rx="26" fill="url(#r-screen)" />
      <rect x="62" y="58" width="88" height="56" rx="26" fill="none" stroke="#4a55a8" strokeWidth="1.5" />
      <path d="M72 68 Q100 56 138 66" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" opacity=".16" />
      <g filter="url(#r-glow)">
        <motion.g animate={{ scaleY: [1, 1, 0.1, 1, 1] }} transition={{ duration: 4.5, repeat: Infinity, times: [0, 0.9, 0.94, 0.98, 1] }} style={{ originX: '106px', originY: '86px' }}>
          <circle cx="88" cy="86" r="12" fill="none" stroke="rgb(var(--b-eye))" strokeWidth="4.8" /><circle cx="88" cy="86" r="4.4" fill="color-mix(in srgb, rgb(var(--b-eye)) 22%, #fff)" />
          <circle cx="126" cy="86" r="12" fill="none" stroke="rgb(var(--b-eye))" strokeWidth="4.8" /><circle cx="126" cy="86" r="4.4" fill="color-mix(in srgb, rgb(var(--b-eye)) 22%, #fff)" />
        </motion.g>
        <path d="M95 102 Q107 111 119 102" stroke="rgb(var(--b-eye))" strokeWidth="3.6" strokeLinecap="round" fill="none" />
      </g>
      <circle cx="60" cy="104" r="5.5" fill="color-mix(in srgb, rgb(var(--b-pink)) 55%, #fff)" opacity=".7" /><circle cx="152" cy="104" r="5.5" fill="color-mix(in srgb, rgb(var(--b-pink)) 55%, #fff)" opacity=".7" />
    </motion.svg>
  );
}

/** Pastille robot compacte pour le logo (tête seule, 2.5D). */
export function RobotMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden shapeRendering="geometricPrecision">
      <defs>
        <linearGradient id="m-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="rgb(var(--b-aqua))" /><stop offset="1" stopColor="rgb(var(--b-pink))" /></linearGradient>
        <linearGradient id="m-head" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="color-mix(in srgb, rgb(var(--b-violet)) 32%, #fff)" /></linearGradient>
      </defs>
      <rect x="2" y="5" width="58" height="56" rx="18" fill="color-mix(in srgb, rgb(var(--b-violet)) 80%, #4a3a90)" opacity=".55" />
      <rect x="2" y="2" width="58" height="56" rx="18" fill="url(#m-bg)" />
      <rect x="3" y="3" width="56" height="54" rx="17" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.4" />
      <rect x="14" y="16" width="34" height="28" rx="12" fill="color-mix(in srgb, rgb(var(--b-violet)) 70%, #8c80d0)" transform="translate(2.5 3)" />
      <rect x="14" y="16" width="34" height="28" rx="12" fill="url(#m-head)" />
      <rect x="18" y="21" width="26" height="17" rx="8" fill="#14183a" />
      <circle cx="26" cy="29.5" r="3.4" fill="none" stroke="rgb(var(--b-eye))" strokeWidth="2" /><circle cx="36" cy="29.5" r="3.4" fill="none" stroke="rgb(var(--b-eye))" strokeWidth="2" />
      <circle cx="32" cy="12" r="2.6" fill="#fff" />
    </svg>
  );
}

export function Bulb({ size = 220 }: { size?: number }) {
  return (
    <motion.svg width={size} height={size * 1.15} viewBox="0 0 200 230" animate={{ rotate: [-2, 2, -2] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }} aria-label="Ampoule idée" shapeRendering="geometricPrecision">
      <defs>
        <radialGradient id="b-glass" cx=".38" cy=".3" r=".85"><stop offset="0" stopColor="#ffffff" stopOpacity=".98" /><stop offset=".55" stopColor="color-mix(in srgb, rgb(var(--b-violet)) 22%, #fff)" stopOpacity=".7" /><stop offset="1" stopColor="color-mix(in srgb, rgb(var(--b-blue)) 50%, #fff)" stopOpacity=".75" /></radialGradient>
        <linearGradient id="b-fil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="rgb(var(--b-pink))" /><stop offset=".5" stopColor="#ffd36e" /><stop offset="1" stopColor="rgb(var(--b-aqua))" /></linearGradient>
        <linearGradient id="b-cyl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#9ea3b8" /><stop offset=".35" stopColor="#f7f8fc" /><stop offset=".7" stopColor="#c4c8d8" /><stop offset="1" stopColor="#8a8fa6" /></linearGradient>
        <radialGradient id="b-halo"><stop offset="0" stopColor="#ffe9a8" stopOpacity=".65" /><stop offset="1" stopColor="#ffe9a8" stopOpacity="0" /></radialGradient>
        <filter id="b-glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <ellipse cx="100" cy="222" rx="46" ry="7" fill="#3b3f9e" opacity=".2" />
      <circle cx="100" cy="92" r="84" fill="url(#b-halo)" />
      {/* épaisseur du verre */}
      <path d="M100 14 C150 14 184 52 184 94 C184 124 166 140 156 158 C150 168 148 176 148 186 L52 186 C52 176 50 168 44 158 C34 140 16 124 16 94 C16 52 50 14 100 14 Z" fill="color-mix(in srgb, rgb(var(--b-violet)) 70%, #8f8be0)" transform="translate(5 6)" opacity=".55" />
      <path d="M100 14 C150 14 184 52 184 94 C184 124 166 140 156 158 C150 168 148 176 148 186 L52 186 C52 176 50 168 44 158 C34 140 16 124 16 94 C16 52 50 14 100 14 Z" fill="url(#b-glass)" stroke="#fff" strokeWidth="2.4" />
      <motion.path d="M78 178 L78 132 M122 178 L122 132 M78 132 C70 120 90 114 100 122 C110 130 130 114 122 102 C114 90 86 94 82 84 C78 72 120 68 118 58 C116 48 88 52 90 42" stroke="url(#b-fil)" strokeWidth="9" strokeLinecap="round" fill="none" filter="url(#b-glow)" animate={{ opacity: [0.85, 1, 0.85] }} transition={{ duration: 2.2, repeat: Infinity }} />
      <path d="M42 64 C50 44 70 30 94 26" stroke="#fff" strokeWidth="7" strokeLinecap="round" fill="none" opacity=".85" />
      <ellipse cx="160" cy="120" rx="5" ry="14" fill="#fff" opacity=".35" transform="rotate(20 160 120)" />
      {/* culot en cylindres */}
      {[[186, 88, 14], [200, 80, 12]].map(([y, w, h], i) => (
        <g key={i}><rect x={100 - w / 2} y={y} width={w} height={h} rx="6" fill="url(#b-cyl)" /><rect x={100 - w / 2} y={y + 3} width={w} height="3" fill="#000" opacity=".08" /></g>
      ))}
      <rect x="72" y="212" width="56" height="10" rx="5" fill="#4a4d66" />
    </motion.svg>
  );
}

export function Bubbles({ size = 240 }: { size?: number }) {
  const orb = (cx: number, cy: number, r: number, id: string, c: [string, string, string], delay: number, icon: React.ReactNode) => (
    <motion.g animate={{ y: [0, -7, 0] }} transition={{ duration: 3.4, repeat: Infinity, delay, ease: 'easeInOut' }}>
      <ellipse cx={cx + 4} cy={cy + r + 8} rx={r * 0.7} ry={5} fill="#3b3f9e" opacity=".18" />
      <circle cx={cx + 4} cy={cy + 6} r={r} fill={c[2]} opacity=".5" />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />
      <circle cx={cx} cy={cy} r={r - 1} fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="1.6" />
      <ellipse cx={cx - r * 0.38} cy={cy - r * 0.5} rx={r * 0.3} ry={r * 0.16} fill="#fff" opacity=".65" transform={`rotate(-35 ${cx - r * 0.38} ${cy - r * 0.5})`} />
      {icon}
      <defs>{orbDef(id, c[0], 'color-mix(in srgb, rgb(var(--b-blue)) 40%, #fff)', c[1])}</defs>
    </motion.g>
  );
  const Bubble = ({ x, y, w, h, tail }: { x: number; y: number; w: number; h: number; tail: string }) => (
    <g><rect x={x + 3} y={y + 4} width={w} height={h} rx="13" fill="color-mix(in srgb, rgb(var(--b-blue)) 50%, #000)" opacity=".5" /><rect x={x} y={y} width={w} height={h} rx="13" fill="rgb(var(--b-blue))" /><path d={tail} fill="rgb(var(--b-blue))" /><rect x={x + 1} y={y + 1} width={w - 2} height={h * 0.45} rx="12" fill="#fff" opacity=".22" /></g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" aria-label="Chat, voix et image" shapeRendering="geometricPrecision">
      {orb(86, 150, 54, 'o1', ['#ffffff', 'rgb(var(--b-blue))', 'color-mix(in srgb, rgb(var(--b-blue)) 70%, #000)'], 0, <g><Bubble x={62} y={132} w={48} h={34} tail="M76 164 l-4 14 l18 -14 z" /><circle cx="78" cy="149" r="3.2" fill="#fff" /><circle cx="86" cy="149" r="3.2" fill="#fff" /><circle cx="94" cy="149" r="3.2" fill="#fff" /></g>)}
      {orb(158, 70, 58, 'o2', ['#ffffff', 'rgb(var(--b-blue))', 'color-mix(in srgb, rgb(var(--b-blue)) 75%, #000)'], 0.6, <g><Bubble x={130} y={52} w={52} h={34} tail="M170 84 l6 14 l-18 -14 z" />{[0, 1, 2, 3, 4].map((i) => <rect key={i} x={140 + i * 7} y={i % 2 ? 65 : 61} width="3.4" height={i % 2 ? 8 : 14} rx="1.7" fill="#fff" />)}</g>)}
      {orb(166, 172, 46, 'o3', ['#ffffff', 'color-mix(in srgb, rgb(var(--b-blue)) 90%, #fff)', 'color-mix(in srgb, rgb(var(--b-blue)) 85%, #000)'], 1.2, <g><Bubble x={143} y={153} w={46} h={36} tail="M150 186 l-2 0 z" /><circle cx="166" cy="171" r="9" fill="none" stroke="#fff" strokeWidth="3.4" /><rect x="157" y="150" width="14" height="6" rx="3" fill="rgb(var(--b-blue))" /></g>)}
    </svg>
  );
}
