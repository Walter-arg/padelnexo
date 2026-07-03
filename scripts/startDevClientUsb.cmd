@echo off
setlocal

cd /d "%~dp0.."

set "EXPO_TEMP_DIR=D:\PROYECTO-APP\temp-expo-usb"

taskkill /F /IM node.exe /T >nul 2>nul
if not exist "%EXPO_TEMP_DIR%" mkdir "%EXPO_TEMP_DIR%"

adb reverse tcp:8081 tcp:8081

set "TEMP=%EXPO_TEMP_DIR%"
set "TMP=%EXPO_TEMP_DIR%"
set "TMPDIR=%EXPO_TEMP_DIR%"
set "REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1"
set "EXPO_NO_DEPENDENCY_VALIDATION=1"

echo Using USB reverse on localhost:8081
npx expo start --dev-client --localhost --clear --port 8081
