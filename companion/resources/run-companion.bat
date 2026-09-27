@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "GLYPHMEND_TESSDATA_DIR=%SCRIPT_DIR%tessdata"
set "PATH=%SCRIPT_DIR%;%SCRIPT_DIR%lib;%PATH%"
"%SCRIPT_DIR%glyphmend-companion.exe" %*
