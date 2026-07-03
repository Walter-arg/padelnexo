@echo off
setlocal

cd /d "%~dp0.."

set "HOST_IP=%~1"
if "%HOST_IP%"=="" (
  for /f "tokens=4" %%A in ('route print -4 ^| findstr /R /C:"^[ ]*0.0.0.0[ ]*0.0.0.0"') do (
    if not defined HOST_IP set "HOST_IP=%%A"
  )
)
if "%HOST_IP%"=="" set "HOST_IP=172.17.0.11"

set "EXPO_TEMP_DIR=D:\PROYECTO-APP\temp-expo-9"

taskkill /F /IM node.exe /T >nul 2>nul
if not exist "%EXPO_TEMP_DIR%" mkdir "%EXPO_TEMP_DIR%"

set "TEMP=%EXPO_TEMP_DIR%"
set "TMP=%EXPO_TEMP_DIR%"
set "TMPDIR=%EXPO_TEMP_DIR%"
set "REACT_NATIVE_PACKAGER_HOSTNAME=%HOST_IP%"
set "EXPO_NO_DEPENDENCY_VALIDATION=1"

echo Using Metro host IP: %REACT_NATIVE_PACKAGER_HOSTNAME%
npx expo start --dev-client --lan --clear --port 8081
