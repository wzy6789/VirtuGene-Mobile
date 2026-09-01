@echo off
REM npm shim for VirtuGene-Mobile release (this machine has no real npm).
REM Only supports `npm run mobile:build`; everything else fails loudly.
if "%~1"=="run" if "%~2"=="mobile:build" (
  call "F:\VirtuGene-Mobile\node_modules\.bin\vite.cmd" build
  if errorlevel 1 exit /b 1
  call "F:\VirtuGene-Mobile\node_modules\.bin\cap.cmd" sync android
  if errorlevel 1 exit /b 1
  pushd "F:\VirtuGene-Mobile\android"
  call gradlew.bat assembleDebug
  set code=%errorlevel%
  popd
  exit /b %code%
)
echo npm shim: unsupported command: %* >&2
exit /b 1
