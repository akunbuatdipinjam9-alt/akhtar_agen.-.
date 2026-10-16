# Documents Skill
> Menyusun dokumen (laporan, catatan, ringkasan) sebagai artifact .md/.txt/.pdf.

Gunakan tool `document.create` untuk menghasilkan dokumen:
1. Tulis `content` dalam Markdown (heading `##`, bullet `-`, dst) — judul dikirim terpisah lewat `title`, jangan diulang di `content`.
2. Pilih `format` sesuai kebutuhan: `md` (default, sumber kanonik), `txt` (teks polos), `pdf` (siap cetak/kirim), atau `docx` (Word, bisa diedit lagi).
3. Sumber Markdown selalu tersimpan otomatis, jadi format lain bisa dibuat belakangan lewat `document.export` tanpa menulis ulang seluruh isi.
4. Untuk dokumen panjang, susun dengan heading yang jelas agar enak dibaca di semua format.
5. Setelah membuat, sebutkan path file ke user dan tandai todo terkait sebagai selesai.
