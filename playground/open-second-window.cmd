@echo off
rem Opens landing-page in a SECOND Extension Development Host window (multi-window test).
set ROOT=%~dp0..
start "" code --new-window --extensionDevelopmentPath="%ROOT%" "%ROOT%\playground\landing-page"
