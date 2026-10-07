#!/bin/sh
# Starts the Kill Lap server and opens the game in your browser.
cd "$(dirname "$0")"
PORT="${PORT:-3000}"
( sleep 1; (xdg-open "http://localhost:$PORT" || open "http://localhost:$PORT") >/dev/null 2>&1 ) &
exec node server/server.js
