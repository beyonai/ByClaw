@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "LOG_DIR=%ROOT%\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "INSTALL_DEPS=0"
set "START_FE=0"
set "START_BE=0"
set "START_EXE=0"
set "BE_PROFILE=%BE_PROFILE%"
if "%BE_PROFILE%"=="" set "BE_PROFILE=local"

if "%~1"=="" goto :default_all

:parse_args
if "%~1"=="" goto :after_parse
if /I "%~1"=="--all" (
  set "START_FE=1"
  set "START_BE=1"
  set "START_EXE=1"
  shift
  goto :parse_args
)
if /I "%~1"=="--fe" (
  set "START_FE=1"
  shift
  goto :parse_args
)
if /I "%~1"=="--be" (
  set "START_BE=1"
  shift
  goto :parse_args
)
if /I "%~1"=="--exe" (
  set "START_EXE=1"
  shift
  goto :parse_args
)
if /I "%~1"=="--install" (
  set "INSTALL_DEPS=1"
  shift
  goto :parse_args
)
if /I "%~1"=="--help" goto :usage
if /I "%~1"=="-h" goto :usage

echo Unknown argument: %~1
goto :usage

:default_all
set "START_FE=1"
set "START_BE=1"
set "START_EXE=1"

:after_parse
echo.
echo BYCLAW - Windows Starter
echo Root: %ROOT%
echo Logs: %LOG_DIR%
echo.

if "%START_FE%"=="1" call :start_fe
if "%START_BE%"=="1" call :start_be
if "%START_EXE%"=="1" call :start_exe

echo.
echo Done. Processes started in background.
echo Tail logs:
if "%START_FE%"=="1" echo   type "%LOG_DIR%\fe-dev.log"
if "%START_BE%"=="1" echo   type "%LOG_DIR%\be-run.log"
echo.
exit /b 0

:start_fe
set "FE_DIR=%ROOT%\byclaw-fe"
if not exist "%FE_DIR%\package.json" (
  echo [skip] byclaw-fe not initialized - missing package.json
  exit /b 0
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [skip] pnpm not found.
  echo        Install pnpm, then run:
  echo        scripts\start.bat --install --fe
  exit /b 0
)

if not exist "%FE_DIR%\node_modules" (
  if "%INSTALL_DEPS%"=="1" (
    echo [deps] Installing byclaw-fe dependencies...
    pushd "%FE_DIR%"
    call pnpm install --frozen-lockfile >"%LOG_DIR%\fe-install.log" 2>&1
    if errorlevel 1 (
      call pnpm install --no-frozen-lockfile >>"%LOG_DIR%\fe-install.log" 2>&1
    )
    popd
  ) else (
    echo [warn] byclaw-fe dependencies are not installed.
    echo        Run: scripts\start.bat --install --fe
    exit /b 0
  )
)

echo [start] fe-dev
start "" /b cmd /c "cd /d "%FE_DIR%" && pnpm run dev 1>>"%LOG_DIR%\fe-dev.log" 2>&1"
echo [log]   %LOG_DIR%\fe-dev.log
exit /b 0

:start_be
set "BE_DIR=%ROOT%\byclaw-be"
set "SERVICE_POM=%BE_DIR%\pom.xml"
set "TOOLCHAINS_FILE=%BE_DIR%\.mvn\toolchains.xml"
if not exist "%SERVICE_POM%" (
  echo [skip] byclaw-be not initialized - missing pom.xml
  exit /b 0
)
if not exist "%TOOLCHAINS_FILE%" (
  echo [skip] Toolchains file not found: %TOOLCHAINS_FILE%
  exit /b 0
)

where mvn >nul 2>nul
if errorlevel 1 (
  echo [skip] mvn not found. Install Maven + JDK 21+, then run:
  echo        scripts\start.bat --be
  exit /b 0
)

set "BE_RUN_ARGS=%BE_DIR%\config\application --spring.profiles.active=%BE_PROFILE% --logging.config=%BE_DIR%\config\logback.xml"
set "BE_CMD=mvn -B --global-toolchains="%TOOLCHAINS_FILE%" -f pom.xml spring-boot:run -Dspring-boot.run.arguments="%BE_RUN_ARGS%" -Denv.file="%ROOT%\.env""

echo [start] be-run
start "" /b cmd /c "cd /d "%BE_DIR%" && %BE_CMD% 1>>"%LOG_DIR%\be-run.log" 2>&1"
echo [log]   %LOG_DIR%\be-run.log
exit /b 0

:start_exe
set "EXE_DIR=%ROOT%\byclaw-exe"
if exist "%EXE_DIR%\pyproject.toml" (
  echo [info] byclaw-exe detected. Add a concrete start command in scripts\start.bat.
  exit /b 0
)
if exist "%EXE_DIR%\requirements.txt" (
  echo [info] byclaw-exe detected. Add a concrete start command in scripts\start.bat.
  exit /b 0
)
echo [skip] byclaw-exe not initialized.
exit /b 0

:usage
echo Usage: scripts\start.bat [options]
echo.
echo Options:
echo   --all      Start available modules (default).
echo   --fe       Start frontend (byclaw-fe).
echo   --be       Start backend (byclaw-be).
echo   --exe      Start Python tooling (byclaw-exe), if initialized.
echo   --install  Install FE deps before start if needed.
echo   --help     Show this message.
echo.
exit /b 0

