# Browser Skill
> Membaca halaman web statis (browser.search/browser.open) atau berinteraksi dengan halaman JS-heavy lewat tab interaktif (browser.new_tab dst).

Dua jalur, pilih sesuai kebutuhan:

**Baca cepat, halaman statis** — `browser.search` lalu `browser.open`:
1. Kalau user kasih URL langsung, langsung `browser.open` URL itu.
2. Kalau user kasih topik/pertanyaan, `browser.search` dulu, pilih hasil paling relevan, baru `browser.open`.
3. Ekstrak hanya bagian relevan, jangan tempel seluruh halaman ke jawaban.

**Interaksi nyata (form, login, klik, halaman butuh JavaScript)** — tab interaktif:
1. `browser.new_tab` dengan `url` (atau kosong lalu `browser.navigate`).
2. `browser.observe` untuk melihat elemen interaktif yang ada beserta id numeriknya — panggil ini lagi setiap kali halaman berubah (setelah klik/navigasi), id lama tidak berlaku lagi.
3. `browser.click`/`browser.type` pakai id dari `browser.observe`. Klik/ketik yang konsekuensial (submit, beli, hapus, kirim) akan minta izin user seperti aksi sensitif lainnya — itu memang disengaja.
4. `browser.wait` setelah aksi yang memicu perubahan halaman, sebelum `browser.observe` lagi.
5. `browser.get_text`/`browser.get_links` untuk membaca isi tanpa perlu daftar elemen interaktif.
6. `browser.screenshot` kalau perlu bukti visual — hasilnya tersimpan sebagai artifact.
7. Tutup tab (`browser.close_tab`) kalau sudah tidak dipakai, terutama sebelum banyak tab menumpuk.

Catatan: bagian tab interaktif ini baru — belum divalidasi berjalan di layar sungguhan sejauh yang tercatat di README.


## Structured browser expansion (38 browser tools total)
Prefer structured DOM reads over vision whenever possible:
- Page inspection: `browser.get_html`, `browser.get_metadata`, `browser.get_page_state`, `browser.element_info`.
- Forms/UI structure: `browser.get_forms`, `browser.get_inputs`, `browser.get_buttons`, `browser.get_images`, `browser.get_tables`.
- Structured extraction: `browser.extract_data` with named CSS selectors.
- Form actions: `browser.fill_form`, `browser.select_option`, `browser.check`.
- File transfer: `browser.upload_file` (workspace/artifacts only) and `browser.download` (artifact output; public http/https only).
- Synchronization/navigation: `browser.wait_for`, `browser.history`, `browser.back`, `browser.forward`, `browser.reload`.

Security rules: never bypass permission prompts. Re-observe after DOM-changing actions. `browser.get_html` is sanitized before Tool Sense sees it; file upload is intentionally restricted to approved workspace/artifact roots. Use `browser.vision_rescue` only when structured DOM inspection cannot solve the task.
