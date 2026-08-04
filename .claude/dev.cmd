@echo off
set "PATH=C:\nvm4w\nodejs;%PATH%"
cd /d "%~dp0.."
call npm run dev
