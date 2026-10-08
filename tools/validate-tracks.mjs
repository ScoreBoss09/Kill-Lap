import { BUILTIN_TRACKS, compileTrack, validateTrack, generateTrack } from '../public/js/tracks.js';
let bad = 0;
const all = [...BUILTIN_TRACKS]; for (let s = 1; s <= 40; s++) all.push(generateTrack(s));
for (const d of all) {
  const T = compileTrack(d); const v = validateTrack(T);
  const line = `${d.id.padEnd(12)} ${String(Math.round(T.length)).padStart(6)}px  world ${T.W}x${T.H}  gap ${v.minGap.toFixed(0)}  maxK ${v.maxK.toFixed(2)}  props ${T.props.length} items ${T.items.length}`;
  { // nothing in the environment may sit on a railway line
    let clash = 0; for (const h of T.hazards) if (h.t === 'train') for (const p of T.props) if (Math.abs((p.x - h.x) * -h.ry + (p.y - h.y) * h.rx) < 120) clash++;
    if (clash) { bad++; console.log('FAIL', d.id, clash, 'props on a railway'); } }
  if (!v.ok) { bad++; console.log('FAIL', line, v.issues.join(' | ')); } else if (!d.generated) console.log('ok  ', line);
}
console.log(bad ? `${bad} track(s) failed` : 'all tracks valid'); process.exit(bad ? 1 : 0);
