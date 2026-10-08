# KILL LAP

**Top-down vehicular combat racing for PC** - drive fast, shoot first, finish first.
A tribute to the 1996 classic *Death Rally*: fixed angled-top-down camera, arcade drifting handling, machine guns, homing rockets, mines, nitro, wrecks and cash.

Single player, a full career with a garage and upgrades, **online multiplayer**, a **map editor** with a community Workshop, **leaderboards**, ghosts, a daily challenge, **full gamepad support**, and a **procedurally generated soundtrack and sound effects** (with a drop-in folder if you want to use your own audio).

No installs, no dependencies, no build step - just Node.js.

---

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm start            # or:  node server/server.js
```

Then open **http://localhost:3000** in Chrome, Edge or Firefox (Chrome/Edge recommended).
Double-click **`play.bat`** (Windows) or run **`./play.sh`** (Mac/Linux) to start the server *and* open the browser for you.

Tip: press **F11** for fullscreen, or use *Settings -> Toggle fullscreen*. In Chrome/Edge you can also "Install" the page as an app for a borderless window.

## Controls

| Action | Keyboard | Gamepad (Xbox layout) |
|---|---|---|
| Accelerate / brake-reverse | `W` `S` or `↑` `↓` | `RT` / `LT` |
| Steer | `A` `D` or `←` `→` | Left stick / D-pad |
| Machine gun | `Space` | `A` |
| Rocket (homing lock-on) | `E` or `Ctrl` | `X` |
| Drop mine | `F` or `Alt` | `B` |
| Nitro boost | `Shift` | `Y` |
| Special weapon (homing missiles / cluster bombs) | `G` or `Right Ctrl` | `D-pad up` |
| Switch special weapon | `Q` | `D-pad down` |
| Handbrake (drift) | `C` | `RB` |
| Respawn on track (hold) | `R` | `LB` |
| Scoreboard | `Tab` | `Back / View` |
| Pause | `Esc` or `P` | `Start` |

Keyboard bindings can be changed in *Controls*. Gamepad dead-zone, steering sensitivity and rumble are in *Settings*. Menus work with keyboard, mouse and controller; the game switches prompts automatically.

## Game modes

* **Quick Race** - pick any track, 1-11 AI opponents, 4 difficulties, weapons on/off.
* **Career** - four series (Rookie Cup, Pro Circuit, Elite League, Legend Run) against the same seven named rivals. Championship points decide the title, prize money buys cars and upgrades. Your overall position is shown on the career cards, the series screen and the main menu. Races can't be re-run (quitting forfeits it). **Finishing a series earns new equipment** (see below) and unlocks the next series.
* **Garage** - six cars (Scrapper, Hornet, Bruiser, Phantom, Reaper, Warlord), paint colours, sell-back, and two kinds of upgrade:
  * *Performance* (always available): engine, tyres, armour plating (visible on the car), machine gun, rockets & mines, nitro.
  * *Equipment* (**earned by finishing career series**): front / rear / wheel **spikes** (Rookie Cup), roof **auto-turret** and **rear guard** that shoots down rockets from behind (Pro Circuit), **homing missiles** and **cluster bombs** (Elite League). Everything you fit is drawn on your car.
* **Weapons are locked on the first lap** for everyone. The rocket is unguided; homing missiles are the guided option.
* **Rivals with personalities** - 16 named drivers with portraits, bios and driving styles (aggressive, precise, defensive...). A "Meet the field" screen shows who you're racing.
* **Track hazards** - a **railway that runs right across the map** with a train that flattens anything in its way, and a working level crossing (signals, barriers, bell) everywhere the line meets the road, a **pedestrian crossing** in the city, **water fords**, **jump ramps**, erupting **lava vents**, a **tidal wave** sweeping the coast road, and an **air raid** in the Warzone where a bomber drops bombs (marked on the road a moment before they land).
* **Raised roads, banking and mountains** - flyovers where the track crosses over itself, tunnels through hills, real 3D barriers, **banked curves** (the road surface tilts and the outer edge rises) and two **mountain maps** (Alpine Ascent, Red Summit) where switchback roads climb higher and higher up a mountain. Climbs slow you down and descents speed you up.
* **Time Trial** - chase your **ghost**; your best lap is saved per track.
* **Daily Challenge** - a new generated track every day, one global leaderboard.
* **Multiplayer** - lobby, rooms (with optional password), chat, ready-up, host settings (track, laps, AI bots, upgrades on/off, weapons on/off), up to 12 racers.
* **Map Editor** - build your own tracks; test-drive instantly; export/import JSON; publish to the Workshop.
* **Leaderboards** - global fastest laps and race times per track, plus driver rankings (wins / kills / podiums). Personal bests, statistics and 15 achievements are tracked locally.

## Multiplayer

The server relays player state and keeps leaderboards. To host a game for friends:

1. Run `npm start` on the host machine.
2. **Same network (LAN):** friends open `http://<host-ip>:3000` (find your IP with `ipconfig` / `ifconfig`).
3. **Over the internet:** forward TCP port 3000 on your router to the host, or deploy the folder to any Node host (a `Dockerfile` is included). Friends open your public address.
4. Everyone picks **Multiplayer**, one player **Creates a room**, the others join and ready up, and the host presses **Start**.

Players can also use their own page and point it at someone else's server via *Settings -> Server address* (e.g. `192.168.1.20:3000`).

Environment variables: `PORT` (default 3000), `KILLLAP_DATA` (where leaderboards / Workshop maps are stored, default `./data`).

Netcode: each client simulates its own car and broadcasts it at 20 Hz; projectiles and mines are broadcast as events and simulated everywhere; the car that gets hit applies its own damage. AI bots are run by the room host. It is built for friendly games - the server sanity-checks lap times but is not a cheat-proof competitive platform.

## Making maps

Open **Map Editor** from the main menu.

* **Road mode (1)** - click to add points (new points are inserted into the nearest part of the loop), drag to move, right-click to delete. The road is a smooth closed spline. `Shift+wheel` or `[` `]` changes the width at the selected point. With a point selected, the side panel has **Road height** (raise neighbouring points to build a flyover; where roads cross, one must be 50+ higher) and **Tunnel here**. Reverse, scale and subdivide buttons are in the panel.
* **Pickups mode (2)** - repair, ammo, cash, nitro, boost pads, oil slicks, plus hazards: jump ramps, fords, train crossings, pedestrian crossings, lava vents, tidal waves and air raids. Automatic pickups and hazards can be turned off if you want to place everything by hand.
* **Scenery mode (3)** - place trees, buildings, rocks, containers, palm trees... anywhere outside the barriers.
* 9 themes (desert, forest, alpine, neon city, foundry, inferno, coastal, red canyon, warzone); the editor warns if the road crosses itself or has an impossible corner.
* **Test Drive (T)** saves and drops you straight on the track; quit returns to the editor.
* **Export / Import** share maps as `.killlap.json` files. **Publish** uploads to the server Workshop, where it appears under *Workshop* in any track picker (and in multiplayer rooms).
* Mouse: wheel = zoom, middle-drag or `Space`-drag = pan. **Gamepad:** left stick = cursor, right stick = pan, `A` = place/grab, `X` = delete, `Y` = switch tool, `LB/RB` = width, `Start` = test drive, and **`View/Back` switches to menu mode** so the stick/D-pad can reach the top toolbar and side panel (`A` presses, left/right changes values, `B` returns to the map).

Track file format (what you can hand-edit):

```json
{ "name": "My Track", "theme": "desert", "width": 160, "laps": 3, "seed": 123,
  "pts":   [[x, y], [x, y, widthOverride|null, height, tunnel(0|1)], ...],
  "items": [{ "t": "repair|ammo|cash|nitro|boost|oil", "x": 0, "y": 0 }],
  "props": [{ "type": "pine", "x": 0, "y": 0, "s": 1, "r": 0 }],
  "auto": true, "hazards": true, "bomber": false, "dens": 1.0 }
```

## Your own music and sound effects

The game works with **no audio files** - everything is synthesised live (engine sounds, guns, explosions, UI and a rock soundtrack with 7 tunes). To replace any of it, drop files into **`public/assets/audio/`** and restart the page. Supported: `.ogg .mp3 .wav .m4a .flac`.

| File name (any extension) | Replaces |
|---|---|
| `music_menu` | Menu music |
| `music_race*` (e.g. `music_race_1`, `music_race_2`...) | Race playlist (shuffled; one file loops) |
| `music_results` | Results screen music |
| `engine_loop` | Engine sound (looped, pitch follows RPM) |
| `sfx_gun` `sfx_rocket` `sfx_explosion` `sfx_smallboom` `sfx_mine` | Weapons |
| `sfx_crash` `sfx_hit` `sfx_scrape` `sfx_boost` `sfx_nitro` `sfx_oil` `sfx_respawn` | Car sounds |
| `sfx_pickup` `sfx_cash` `sfx_empty` | Pickups / dry-fire |
| `sfx_beep` `sfx_go` `sfx_lap` `sfx_bestlap` `sfx_win` `sfx_lose` | Race events |
| `sfx_click` `sfx_move` `sfx_select` `sfx_back` `sfx_chat` `sfx_warn` | UI |

Anything you do not provide keeps using the built-in synth. See `public/assets/audio/README.md`.

## Textures

The game draws everything procedurally, but you can drop your own seamless top-down images into `public/assets/textures/` (ground per theme, road, verge). See the README in that folder for the exact names and free CC0 sources (ambientCG, Poly Haven, Kenney).

## Project layout

```
server/server.js        zero-dependency HTTP + WebSocket server (rooms, relay, leaderboards, Workshop)
public/index.html       the game page
public/css/style.css    menu styling
public/js/main.js       app shell: main loop, race lifecycle, career, rewards
public/js/game.js       race simulation: physics, weapons, AI, laps, pickups, net sync, world rendering
public/js/tracks.js     track format, spline compiler, collision queries, scenery, 23 built-in maps, generator
public/js/ground.js     lazily baked terrain tiles (road, kerbs, decals), minimap
public/js/structures.js 3D barriers, raised decks, pillars, tunnels
public/js/hazards.js    trains, pedestrians, fords, ramps, lava, tidal wave, bomber
public/js/drivers.js    rival roster and procedural portraits
public/js/sprites.js    pseudo-3D props/buildings/cars/particles
public/js/hud.js        in-race HUD
public/js/ui.js         menu system (keyboard + mouse + gamepad navigation)
public/js/editor.js     map editor
public/js/audio.js      synthesised SFX, engines and procedural music (+ file overrides)
public/js/input.js      keyboard / gamepad input and rumble
public/js/storage.js    profile, settings, career, achievements (localStorage)
public/js/textures.js   optional image textures
public/js/net.js        WebSocket client + REST helpers
tools/                  dev tools: track validator, headless smoke/flow/multiplayer tests, audio renderer
```

Run `npm test` to validate every built-in and 40 generated tracks. The scripts in `tools/` (`smoke.mjs`, `sim.mjs`, `mptest.mjs`, `flowtest.mjs`, `padtest.mjs`, ...) are headless-Chromium tests that were used to develop the game; they need [Playwright](https://playwright.dev) and a running server.

## Troubleshooting

* **No sound** - browsers only start audio after you click or press a key; do that once. Check *Settings -> volumes*.
* **Low frame rate** - lower *Graphics quality* in Settings (it also lowers render resolution) or pick a wider camera. The game also auto-lowers resolution if FPS stays low. Make sure browser hardware acceleration is on.
* **Controller not detected** - press any button once with the page focused. Standard-mapping (XInput / most modern pads) is expected.
* **Can't join a friend** - check the address, that port 3000 is reachable, and that you are not mixing `https` pages with a plain `ws` server.
* Your progress is stored in the browser (localStorage) per address - `localhost:3000` and `192.168.x.x:3000` have separate profiles.
