@echo off
title CampusWay server (app + admin)
rem Starts the CampusWay local server and opens the admin screen.
rem Data is saved on this PC in server\db\. Close this window to stop the server.
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is needed to run the CampusWay server. Install it from https://nodejs.org and try again.
  pause
  goto :eof
)
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8080/admin.html'"
node server\campusway-server.js %*
pause
