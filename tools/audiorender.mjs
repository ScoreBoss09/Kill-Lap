// Renders every song + sfx offline in Chromium and writes mono 16-bit WAVs to a directory (for analysis): node tools/audiorender.mjs outdir
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const outdir = process.argv[2] || '/tmp/audio'; fs.mkdirSync(outdir, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:3000/'); await p.waitForTimeout(800);
const names = await p.evaluate(async () => { const m = await import('/js/audio.js'); return { songs: Object.keys(m.SONGS), sfx: Object.keys(m.SYN) }; });
async function render(kind, name) {
  return p.evaluate(async ([kind, name]) => {
    const m = await import('/js/audio.js'); const A = m.default;
    const dur = kind === 'song' ? 22 : 2.5, SR = 44100;
    const off = new OfflineAudioContext(2, SR * dur, SR);
    const Real = window.AudioContext; window.AudioContext = function () { return off; };
    A.ctx = null; A.ready = false; A.init(); window.AudioContext = Real; A.ready = true;
    if (kind === 'song') { const spec = m.SONGS[name], song = m.buildSong(spec), sd = 60 / spec.bpm / 4; for (let n = 0; n * sd < dur - 1; n++) A._step(song, n, 0.05 + n * sd, sd); }
    else { const d = off.createGain(); d.connect(A.sfxG); m.SYN[name](A, d); }
    const buf = await off.startRendering(); const L = buf.getChannelData(0), R = buf.getChannelData(1); const out = new Int16Array(L.length);
    for (let i = 0; i < L.length; i++) out[i] = Math.max(-32768, Math.min(32767, ((L[i] + R[i]) / 2) * 32767));
    let bin = ''; const u8 = new Uint8Array(out.buffer); for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(bin);
  }, [kind, name]);
}
const wav = (b64, sr = 44100) => { const pcm = Buffer.from(b64, 'base64'); const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]); };
for (const n of names.songs) fs.writeFileSync(`${outdir}/song_${n}.wav`, wav(await render('song', n)));
for (const n of names.sfx) fs.writeFileSync(`${outdir}/sfx_${n}.wav`, wav(await render('sfx', n)));
console.log(errs.length ? errs.join('\n') : 'rendered ' + names.songs.length + ' songs, ' + names.sfx.length + ' sfx, no errors'); await b.close();
