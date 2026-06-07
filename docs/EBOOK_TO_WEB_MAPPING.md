# E-Book To Web Mapping

Dokumen ini mencatat aturan e-book yang benar-benar masuk ke web. Semua fitur di bawah memakai data OHLCV atau menampilkan kebutuhan data; tidak ada backtest dummy dan tidak ada angka fundamental palsu.

## Implemented Rules

| Fitur Web | Sumber E-Book | Formula / Logika Web | File |
| --- | --- | --- | --- |
| VPA bullish validation | Anna Coulling, `A Complete Guide To Volume Price Analysis`, hlm 40 dan 43 | Candle bullish, spread >= 1.15x rata-rata 20 candle, volume >= 1.45x rata-rata 20 candle, close di 65% atas range. | `src/js/ebook-rules.js`, `src/js/analysis.js`, `netlify/functions/_shared/engine.mjs` |
| Breakout volume confirmation | Coulling hlm 43; Stan Weinstein hlm 25 dan 31 | Close menembus resistance 30 candle sebelumnya, volume >= 1.45x rata-rata, close di 60% atas range. | `src/js/ebook-rules.js` |
| No demand warning | Coulling hlm 74 | Setelah short uptrend, candle naik dengan spread <= 0.78x rata-rata dan volume <= 0.78x rata-rata diberi warning demand lemah. | `src/js/ebook-rules.js` |
| Stopping volume watch | Coulling hlm 108-110 | Setelah short downtrend, candle bearish volume >= 1.7x rata-rata, lower wick cukup dalam, dan close tidak di low ekstrem menjadi watch reversal, perlu konfirmasi. | `src/js/ebook-rules.js` |
| Effort-result anomaly | Coulling hlm 43; Wyckoff Structures hlm 36, 80, 84 | Volume sangat besar dengan spread sempit dan close lemah dibaca sebagai supply/anomali effort-result. | `src/js/ebook-rules.js` |
| Weinstein Stage proxy | Stan Weinstein, `Secrets for Profiting in Bull and Bear Markets`, hlm 24-31, 42-43 | SMA150 harian dipakai sebagai proxy 30-week MA. Stage 2 jika harga di atas SMA150 yang naik dan mendekati/menembus resistance. Stage 4 jika harga di bawah SMA150 yang turun. | `src/js/ebook-rules.js` |
| Minervini Trend Template proxy | Mark Minervini, `Trade Like A Stock Market Wizard`, hlm 94 | 7 kriteria: harga di atas MA150/MA200, MA150 > MA200, MA200 naik, MA50 > MA150/MA200, harga di atas MA50, harga >= 25% dari 52w low, harga dalam 25% dari 52w high. RS ranking ditandai belum tersedia. | `src/js/ebook-rules.js` |
| Boxer price-volume surge | Harry Boxer, `Profitable Day and Swing Trading`, hlm 25, 44-48, 60 | Surge aktif jika change >= 2.5%, volume >= 1.6x, close kuat. Low-volume ebb watch jika 5 candle sebelumnya range dan volume menyempit sebelum breakout. | `src/js/ebook-rules.js` |
| Scanner score adjustment | Semua sumber implemented di atas | Skor day/swing/long ditambah saat Stage 2, Trend Template kuat, VPA bullish, atau Boxer surge; dikurangi saat Stage 4 atau VPA warning. | `src/js/analysis.js`, `netlify/functions/_shared/engine.mjs`, `netlify/functions/scan-market.mjs` |
| Bagger validation text | Minervini hlm 94; Fisher hlm 15-18; Lynch Indonesia hlm 39-43 | Kandidat bagger sekarang menampilkan stage e-book dan tetap meminta validasi news/lapkeu ekspansi. | `netlify/functions/scan-market.mjs`, `src/js/main.js` |
| UI E-book Strategy Engine | Semua sumber implemented + gap fundamental | Panel detail saham menampilkan VPA, Weinstein, Minervini, Boxer, dan data fundamental yang belum tersedia. | `index.html`, `src/css/style.css`, `src/js/main.js` |

## Data Gaps Shown In UI

| Aturan | Sumber | Kenapa Belum Dihitung | Data Wajib |
| --- | --- | --- | --- |
| Magic Formula | Joel Greenblatt, hlm 64-70 | Butuh earnings yield dan return on capital; OHLCV tidak cukup. | EBIT/EPS, enterprise value, working capital, fixed assets. |
| Fisher quality/growth | Philip Fisher, hlm 15-18, 100 | Butuh sales potential, profit margin, moat, management/scuttlebutt. | Sales/laba 5 tahun, margin, debt, news/aksi korporasi. |
| Lynch fast grower / stalwart | Peter Lynch Indonesia, hlm 39-43, 58, 72 | Butuh growth rate, margin, debt/pension/quality. | EPS/sales growth, margin, debt, PEG. |
| Rasio fundamental Indonesia | `Rasio Penting Dalam Menilai Perusahaan`, hlm 1-2 | Butuh data laporan keuangan, bukan hanya harga. | EPS, PER, PBV, ROE, DER, OCF, sales/earning/book value growth 5 tahun. |
| Graham margin of safety | Graham/Klarman value materials | Fair value teknikal web bukan intrinsic value. | Asset value, earnings power, debt, cash flow, dividend history. |

## UI/UX Mapping

| Request User | Implementasi |
| --- | --- |
| Chart timeframe seperti TradingView | Tombol `1D`, `1W`, `1Bln`, `3Bln`, `6Bln`, `1Th`; data 20 tahun saat provider memberi histori panjang. |
| Chart lebih panjang | Chart detail dibuat full-width dan tinggi desktop 640px. Mobile tetap 430px supaya tidak overflow. |
| Navbar tetap tampil saat scroll | Navbar `position: fixed`; diverifikasi top tetap 10px saat scroll. |
| Alert otomatis tanpa tombol kirim email | Tombol kirim email manual sudah dihapus. Jadwal Netlify tetap via `signal-morning`, `signal-midday`, `signal-afternoon`, `signal-watch`. |
| Bagger dan harmonic masuk email | Alert backend tetap membaca harmonic dan bagger; bagger sekarang mendapat konteks stage e-book. |

## Known Limits

- Data gratis Yahoo/Pluang dapat delayed/EOD dan bukan lisensi realtime IDX resmi.
- RS ranking Minervini belum lengkap karena butuh ranking semua saham terhadap IHSG/market universe.
- Order flow, broker flow, volume profile penuh, dan foreign/local flow belum dihitung karena tidak ada feed resmi.
- PDF `low_text` belum menjadi sumber aturan sampai OCR dilakukan.
