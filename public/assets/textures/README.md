# Custom textures (optional)

Drop **seamless (tileable), top-down** images in this folder to replace the built-in procedural look of the terrain.
Formats: `.png` `.jpg` `.webp`. Square images work best - 512x512 or 1024x1024. Reload the page after adding files.
Anything you don't supply keeps the built-in look, so you can add them one at a time.

## File names

| File | Used for | One tile covers |
|---|---|---|
| `ground.jpg` | Terrain on every map (fallback) | 512 px (a car is ~40 px) |
| `ground_desert` `ground_forest` `ground_snow` `ground_city` `ground_industrial` `ground_volcano` `ground_coast` `ground_mesa` `ground_warzone` | Terrain on maps of that theme (beats `ground`) | 512 px |
| `road.jpg` | Tarmac on every map (fallback) | 256 px |
| `road_city` `road_desert` ... (same theme names) | Tarmac for one theme | 256 px |
| `verge.jpg` | Grass / dirt / gravel strip beside the road | 256 px |
| `verge_forest` `verge_snow` ... | Verge for one theme | 256 px |

Example: `ground_desert.jpg`, `ground_forest.jpg`, `road.jpg`, `verge.jpg`.

Textures are blended over the existing colours, so keep them fairly neutral in brightness; the game still adds
its own soft colour patches, noise, skid marks and scorch marks on top. Road markings, kerbs, barriers, buildings,
decks and the mountain earthworks are always drawn by the game.

## Where to get free ones (all CC0 / public domain, no attribution needed)

* **ambientCG** - ambientcg.com - search *Asphalt*, *Grass*, *Ground*, *Sand*, *Snow*, *Gravel*, *Rock*, *Concrete*, *Lava*. Download the **1K-JPG** zip and use the `..._Color.jpg` file.
* **Poly Haven** - polyhaven.com/textures - same idea (download 1K JPG diffuse).
* **Kenney** - kenney.nl/assets - free 2D texture and tile packs.
* **OpenGameArt** - opengameart.org - filter by CC0.

Avoid sites that don't allow redistribution if you plan to share the game.

## Static hosting without the Node server
Add a `manifest.json` here containing a JSON array of your file names, e.g. `["ground_desert.jpg","road.jpg"]`.

## Bundled textures

This folder ships with 20 pixel-art textures taken from the "PNG - Pixel Art Textures" pack supplied by the project owner:
per-theme terrain (`ground_*`), `road`, `road_city`, `road_industrial`, `verge`, `verge_*`, `rock` (mountain earthworks and tunnels),
`wall` (deck shoulders) and `water` (the ford). The pack's licence allows use in games but not redistribution of the pack itself,
so only the files the game uses are included. Delete any file to fall back to the procedural look; drop in a same-named file to replace it.
Pixel art is drawn with smoothing off so it stays crisp.
