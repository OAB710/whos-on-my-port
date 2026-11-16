@echo off
rem Starts every sample server so you can check the Who's On My Port sidebar.
rem Each server runs in its own minimized window titled "WOM-<project>".
rem Stop them with stop-all-servers.cmd (or from the extension itself).
setlocal
set "PG=%~dp0"

echo Starting sample servers...
start "WOM-shop-app"     /min cmd /k node "%PG%shop-app\server.js"
start "WOM-api-multi"    /min cmd /k node "%PG%api-multi\server.js"
start "WOM-landing-page" /min cmd /k node "%PG%landing-page\server.js"

rem orphan-demo: its launcher exits right away and leaves a detached server on :4500
rem -> appears under "Orphaned" (use "Clean Up Orphaned Processes" to remove it).
node "%PG%orphan-demo\launcher.js"

echo.
echo   :3000        shop-app      (localhost)
echo   :4000 :4001  api-multi     (one process, two ports)
echo   :5173        landing-page  (0.0.0.0 - LAN / QR code)
echo   :4500        orphan-demo   (orphaned, no window)
echo.
echo Open the Ports view in VS Code and press Refresh.
echo Tip: Kill ^& Retry, Restart and Port History need servers started from a VS Code terminal
echo      (e.g. "npm run dev" in playground\shop-app).
endlocal
