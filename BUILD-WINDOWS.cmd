@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Akhtar Agent - Build Windows

echo ========================================================
echo   AKHTAR AGENT - BUILD WINDOWS (.EXE)
echo ========================================================
echo Folder: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js belum tersedia di PATH.
  echo Instal Node.js LTS, kemudian buka ulang terminal.
  goto :fail
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm belum tersedia di PATH.
  goto :fail
)

if not exist "package.json" (
  echo [ERROR] package.json tidak ditemukan.
  echo Jalankan skrip dari folder Akhtar-Agent-Open-Source.
  goto :fail
)

echo [1/4] Memasang dependensi tanpa menjalankan install scripts...
echo        Download Electron dilakukan terpisah agar mudah diulang.
call npm install --ignore-scripts
if errorlevel 1 (
  echo [ERROR] npm install gagal. Cek koneksi internet dan pesan error.
  goto :fail
)

echo.
echo [2/4] Memeriksa binary Electron untuk Windows...
if exist "node_modules\electron\dist\electron.exe" (
  if exist "node_modules\electron\path.txt" (
    echo [OK] Electron sudah terpasang.
    goto :electron_ready
  )
)

echo [INFO] Binary belum lengkap. Mengunduh dari sumber resmi...
call npm rebuild electron
if not errorlevel 1 goto :check_electron

echo.
echo [WARN] Gagal unduh Electron dari sumber resmi.
echo        Error ECONNRESET menandakan koneksi terputus.
echo        Mirror di bawah ini pihak ketiga, bukan situs resmi Electron.
choice /C YN /N /M "Coba ulang lewat mirror npmmirror.com? [Y/N]: "
if errorlevel 2 goto :fail
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
echo [INFO] Mengulangi download Electron via mirror...
call npm rebuild electron
set "ELECTRON_MIRROR="
if errorlevel 1 goto :fail

:check_electron
if not exist "node_modules\electron\dist\electron.exe" (
  echo [ERROR] electron.exe masih belum tersedia setelah instalasi.
  goto :fail
)
if not exist "node_modules\electron\path.txt" (
  echo [ERROR] path.txt Electron belum tersedia.
  goto :fail
)

:electron_ready
echo.
echo [3/4] Menguji binary Electron...
call node -e "const e = require('electron'); if (typeof e !== 'string') process.exit(1); console.log('[OK] Electron binary:',e)"
if errorlevel 1 (
  echo [ERROR] Modul Electron belum bisa ditemukan dengan benar.
  goto :fail
)

echo.
echo [4/4] Membuat installer Windows (NSIS)...
call npm run dist:win
if errorlevel 1 (
  echo [ERROR] electron-builder gagal. Salin error terakhir untuk diperiksa.
  echo         Builder mungkin juga perlu mengunduh komponen dari internet.
  goto :fail
)

echo.
echo ========================================================
echo   BERHASIL! Periksa folder release\ untuk file .exe
 echo ========================================================
pause
exit /b 0

:fail
echo.
echo Build belum selesai. Jangan jalankan npm audit fix --force.
echo Kirim bagian akhir log untuk diperiksa.
pause
exit /b 1
