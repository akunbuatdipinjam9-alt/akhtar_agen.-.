# AI Travel Guide
> Panduan perjalanan berbasis rute, cuaca, kuliner, oleh-oleh, tempat menarik, dan titik singgah tanpa mengarang rating atau kondisi live.

Gunakan skill ini saat user meminta panduan perjalanan, road trip, itinerary berbasis rute, rekomendasi makanan/oleh-oleh di tujuan, atau tempat berhenti sepanjang perjalanan.

## Alur utama

1. Untuk permintaan lengkap dari kota A ke kota B, gunakan `travel.guide` terlebih dahulu.
2. Gunakan asal dan tujuan yang disebut user apa adanya. Tambahkan wilayah/negara hanya jika nama tempat ambigu.
3. Default yang bagus: `interests=["food","souvenir","attraction"]`, `route_stop_zones=2`, dan `show_on_map=true`.
4. Presentasikan hasil seperti pemandu perjalanan: ringkas rute, cuaca, saran berhenti, lalu kuliner/oleh-oleh/tempat menarik.
5. Jangan menyebut sebuah tempat “paling enak”, “rating tertinggi”, “pasti buka”, atau “paling murah” jika tool tidak memberi data tersebut.
6. Kalau user hanya meminta satu kategori di satu kota, gunakan `travel.search_nearby` agar lebih hemat.
7. Kalau user fokus ke tempat berhenti di perjalanan, gunakan `travel.route_stops`.
8. Untuk navigasi aktif setelah user memilih tujuan, lanjutkan dengan tool `navigation.start` / `map.routes` bila sesuai.
9. ETA route adalah estimasi OSRM dan bukan data macet real-time. Selalu jelaskan caveat ini saat relevan.
10. Untuk tanggal keberangkatan yang masih dalam jangkauan forecast, cuaca dari `travel.guide` / `weather.forecast` boleh dipakai. Jangan mengklaim cuaca jangka panjang pasti akurat.

## Gaya jawaban

Utamakan informasi yang bisa dipakai langsung: jarak, estimasi waktu, cuaca, 2–5 pilihan kuliner, 2–5 oleh-oleh/toko, tempat menarik, dan titik istirahat. Sesuaikan dengan `travel_style` dan catatan user seperti keluarga, budget, halal, atau adventure. Bila OSM tidak punya data cukup untuk satu bagian, bilang datanya terbatas dan jangan mengarang nama tempat.
