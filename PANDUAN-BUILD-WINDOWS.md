# Akhtar Agent — Build Windows (Perbaikan instalasi Electron)

## Cara paling mudah

1. **Ekstrak ZIP** ke folder biasa (misalnya `Downloads`). Jangan menjalankan skrip langsung dari tampilan ZIP.
2. Buka folder **`Akhtar-Agent-Open-Source`**.
3. Pastikan **Node.js dan npm** sudah tersedia. Koneksi internet dibutuhkan saat instalasi dan pembuatan installer.
4. Klik dua kali **`BUILD-WINDOWS.cmd`**, atau buka PowerShell di folder itu dan jalankan:

   ```powershell
   .\BUILD-WINDOWS.cmd
   ```

5. Kalau unduhan Electron dari server resmi gagal karena `ECONNRESET`, skrip akan **bertanya dulu** apakah boleh mencoba mirror `npmmirror.com`. Mirror adalah layanan pihak ketiga; kamu boleh menjawab `N`.
6. Jika berhasil, installer ada di folder **`release`** (nama diperkirakan `Akhtar Agent-Setup-1.0.0-alpha.1.exe`).

## Kalau mau manual di PowerShell

```powershell
npm install --ignore-scripts
npm rebuild electron
npm start
npm run dist:win
```

Jika `npm rebuild electron` gagal karena `ECONNRESET`, kamu bisa coba jaringan lain. Jika memilih mirror pihak ketiga secara sadar:

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm rebuild electron
Remove-Item Env:ELECTRON_MIRROR
```

## Apa yang direvisi?

- `package.json`: versi Electron dibuat konsisten dengan `37.10.3` yang ada di log, dan **hanya** postinstall Electron yang diizinkan (`allowScripts`).
- Ditambah `BUILD-WINDOWS.cmd`: pemasangan dependensi, retry unduhan Electron, dan build Windows dalam satu perintah.
- Alur instalasi memakai `--ignore-scripts` terlebih dahulu agar masalah download dapat ditangani terpisah, lalu menjalankan `npm rebuild electron` khusus untuk paket yang disetujui.
- Script build asli (`npm run dist:win`) dan source code aplikasi tetap dipertahankan.

## Batasan

`ECONNRESET` biasanya merupakan **masalah jaringan**, bukan bug aplikasi. Perubahan ini membuat proses pemulihan lebih mudah tetapi tidak dapat menjamin unduhan sukses di semua jaringan. Electron Builder juga bisa memerlukan unduhan tambahan untuk NSIS. Installer yang dihasilkan belum diuji pada Windows di lingkungan ini.

**Peringatan security**: keluaran `npm audit` menunjukkan kerentanan dependensi. Jangan jalankan `npm audit fix --force` tanpa pengujian karena bisa mematahkan dependensi. Lakukan audit, prioritaskan risiko, dan uji sebelum mendistribusikan aplikasi.
