import { BUILTIN_TRACKS, compileTrack, validateTrack, generateTrack } from '../public/js/tracks.js';
let bad = 0;
const all = [...BUILTIN_TRACKS]; for (let s = 1; s <= 40; s++) all.push(generateTrack(s));
for (const d of all) {
  const T = compileTrack(d); const v = validateTrack(T);
  const line = `${d.id.padEnd(12)} ${String(Math.round(T.length)).padStart(6)}px  world ${T.W}x${T.H}  gap ${v.minGap.toFixed(0)}  maxK ${v.maxK.toFixed(2)}  props ${T.props.length} items ${T.items.length}`;
  if (!v.ok) { bad++; console.log('FAIL', line, v.issues.join(' | ')); } else if (!d.generated) console.log('ok  ', line);
}
console.log(bad ? `${bad} track(s) failed` : 'all tracks valid'); process.exit(bad ? 1 : 0);
