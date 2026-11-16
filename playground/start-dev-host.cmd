@echo off
rem Compiles the extension and opens an Extension Development Host (no F5 needed).
set ROOT=%~dp0..
cd /d "%ROOT%"
call npm run compile || goto :eof
start "" code --new-window --extensionDevelopmentPath="%ROOT%" "%ROOT%\playground\playground.code-workspace"
