@echo off
rem Starts the Kill Lap server and opens the game in your browser.
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000
start "" "http://localhost:%PORT%"
node server\server.js
pause
