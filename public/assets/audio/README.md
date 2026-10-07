# Custom audio

Put your own sound files in this folder to replace Kill Lap's built-in synthesised audio.
Formats: `.ogg` `.mp3` `.wav` `.m4a` `.flac`. File *names* decide what they replace (the extension does not matter).
Reload the game after adding files. Anything missing falls back to the built-in sound.

## Music
| Name | Used for |
|---|---|
| `music_menu.mp3` | main menu / lobby / editor |
| `music_race_1.mp3`, `music_race_2.mp3`, ... | in-race playlist (any file starting with `music_race`; shuffled and chained; a single file loops) |
| `music_results.mp3` | results screen |

## Engine
`engine_loop.wav` - a seamless loop of an engine at mid revs. Pitch is automatically raised/lowered with speed.

## Sound effects (short, ideally mono, normalised)
```
sfx_gun        sfx_rocket     sfx_explosion  sfx_smallboom  sfx_mine
sfx_crash      sfx_hit        sfx_scrape     sfx_boost      sfx_nitro
sfx_oil        sfx_respawn    sfx_pickup     sfx_cash       sfx_empty
sfx_beep       sfx_go         sfx_lap        sfx_bestlap    sfx_win
sfx_lose       sfx_click      sfx_move       sfx_select     sfx_back
sfx_chat       sfx_warn
```
`sfx_gun` fires up to ~12 times a second, so keep it very short.

Static hosting without the Node server? Add a `manifest.json` here containing a JSON array of your file names, e.g. `["music_menu.mp3","sfx_gun.wav"]`.
