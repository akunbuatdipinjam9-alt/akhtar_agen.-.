# Presentations Skill
> Menyusun slide deck sebagai artifact .html (bisa dibuka & dinavigasi seperti presentasi) atau .md (outline).

Gunakan tool `presentation.create`:
1. Susun `slides`: setiap slide punya `title` singkat dan `bullets` (poin pendek, bukan paragraf).
2. Slide pertama otomatis jadi judul presentasi (dari parameter `title`) — jangan duplikasi sebagai slide biasa.
3. Default `format` adalah `html` — hasilnya file mandiri yang bisa dibuka di browser apa pun dan dinavigasi pakai panah kiri/kanan. Pakai `pptx` untuk file PowerPoint asli yang bisa diedit lebih lanjut, atau `md` untuk outline teks saja.
4. Sumber slide selalu tersimpan, jadi format lain bisa dibuat belakangan lewat `presentation.export`.
5. Satu ide utama per slide. Tanyakan jumlah slide/target durasi ke user kalau belum jelas.

Catatan: PPTX yang dihasilkan pakai satu layout sederhana (judul + bullet), belum ada styling custom per slide atau gambar.
