@echo off
rem Stops the servers started by start-all-servers.cmd (windows titled "WOM-*").
rem The orphan-demo server (:4500) has no window on purpose: stop it from the extension
rem ("Clean Up Orphaned Processes") - that is what it is there to test.
taskkill /FI "WINDOWTITLE eq WOM-*" /T /F >nul 2>&1
if errorlevel 1 (
  echo No sample server windows were running.
) else (
  echo Sample servers stopped.
)
echo The orphan-demo server on :4500 (if any) is left for the extension to clean up.
