# Coding Skill
> Membaca, memahami, dan memperbaiki kode di dalam project yang sedang dibuka.

Saat bekerja pada kode:
1. Jangan langsung mengedit. Mulai dengan memahami struktur project: `folder.list` root, baca `package.json`/`README` bila ada, kenali bahasa & framework.
2. Baca file yang relevan (`file.read`) sebelum mengubahnya — jangan menebak isi file.
3. Untuk perubahan kecil, gunakan `file.edit` (diff-based) agar user bisa melihat perubahan sebelum menyetujui. Untuk file baru, gunakan `file.create`.
4. Setelah mengubah kode, verifikasi: jalankan build/test yang relevan lewat `terminal.run` (mis. `npm test`, `npm run build`). Jangan mengklaim "selesai" tanpa menjalankan verifikasi ini jika tersedia.
5. Jika terjadi error, baca output terminal dengan teliti, perbaiki, lalu verifikasi ulang — jangan berhenti di percobaan pertama.
6. Untuk task multi-langkah, buat todo list (`todo.create`) di awal dan perbarui statusnya saat mengerjakan setiap langkah.
7. Laporkan perubahan secara ringkas: file apa saja yang diubah dan apa hasil verifikasinya.
