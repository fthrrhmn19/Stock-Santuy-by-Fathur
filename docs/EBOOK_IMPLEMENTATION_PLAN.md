# E-Book Implementation Plan

Tanggal audit: 7 Juni 2026. ZIP diekstrak ke `.ebook_work/source`, lalu setiap PDF diproses page-by-page dengan `tools/extract_ebooks.py`. Hanya PDF berstatus `readable` yang dipakai untuk aturan web. PDF `low_text` berarti halaman terdeteksi tetapi teks tidak bisa diekstrak tanpa OCR, jadi tidak dijadikan sumber rumus.

Ringkasan ekstraksi: 54 PDF total, 38 readable, 15 low_text/image-only, 1 failed.

| No | Nama E-Book | Bab/Halaman | Temuan Utama | Kondisi Web Saat Ini | Implementasi yang Akan Dibuat | Data yang Dibutuhkan | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A Complete Guide To Volume Price Analysis - Anna Coulling | hlm 40, 43, 74, 108-110 | VPA membaca validasi/anomali antara price spread, posisi close, dan volume; no demand dan stopping volume perlu konfirmasi. | Sudah ada relative volume, candle, breakout. | Dibuat VPA engine: bullish validation, breakout volume, no demand warning, effort-result anomaly, stopping volume watch. | OHLCV historis. | Implemented |
| 2 | Analisis Laporan Keuangan Konsep & Aplikasi - Toto Prihadi | 674 hlm, low_text | PDF tidak terbaca teks. | Fundamental web masih proxy. | Tidak diimplementasikan sampai ada OCR. | OCR + data laporan keuangan. | Blocked OCR |
| 3 | Bandarmology - Ryan Filbert | 208 hlm, low_text | PDF tidak terbaca teks. | Belum ada broker flow. | Tidak diimplementasikan. | OCR + broker summary/foreign/local flow resmi. | Blocked OCR |
| 4 | Bandarmology vs Teknikal - William Hartanto | 242 hlm, low_text | PDF tidak terbaca teks. | Belum ada broker flow. | Tidak diimplementasikan. | OCR + broker/foreign flow. | Blocked OCR |
| 5 | Behind Investing Ideas - Parahita Irawan | readable | Materi ide investasi lebih kualitatif. | News ekspansi dan bagger sudah ada. | Dipetakan sebagai checklist validasi, bukan rumus skor otomatis. | Lapkeu, aksi korporasi, berita ekspansi. | Data needed |
| 6 | Cara Mudah Memahami Laporan Keuangan - Joeliardi Sunendar | 199 hlm, low_text | PDF tidak terbaca teks. | Fundamental web belum punya full lapkeu. | Tidak diimplementasikan sampai OCR. | OCR + financial statement API. | Blocked OCR |
| 7 | Common Stocks and Uncommon Profits - Philip A Fisher | hlm 15-18, 100 | 15 points menekankan sales potential, margin, manajemen, moat/paten, dan scuttlebutt. | Web punya news, belum punya growth/margin multi-tahun. | Ditampilkan sebagai data gap fundamental wajib untuk bagger/long term. | Sales/laba 5 tahun, margin, debt, news ekspansi. | Mapped gap |
| 8 | Dividends Still Don't Lie - Kelley Wright | readable | Fokus dividend/value membutuhkan histori dividend yield dan valuasi. | Belum ada dividend data. | Tidak dihitung agar tidak dummy. | Dividend history, payout, yield. | Data needed |
| 9 | Dragon Slayer Trading Strategy - William Win Yang | 304 hlm, low_text | PDF tidak terbaca teks. | N/A | Tidak diimplementasikan. | OCR. | Blocked OCR |
| 10 | Fundamental Analisis Untuk Pemula - Stockbit | readable | Dasar fundamental/perbandingan rasio. | Web punya market cap/turnover, belum EPS/PER/PBV valid. | Masuk daftar data fundamental yang dibutuhkan. | EPS, PER, PBV, ROE, DER. | Mapped gap |
| 11 | Fundamental Analysis for Investors - Raghu Palat | readable | Valuasi dan kualitas bisnis membutuhkan statement data. | Web belum punya full statement. | Tidak dihitung; dijadikan requirement data. | Income statement, balance sheet, cash flow. | Data needed |
| 12 | Investasi Saham dalam Ilustrasi - Parahita Irawan | readable | Edukasi investasi dan risk mindset. | Position sizing sudah ada. | Tidak ada rumus baru yang aman dari OHLCV saja. | N/A | Reviewed |
| 13 | Investor-Sibuk - Ferdie Darmawan | 300 hlm, low_text | PDF tidak terbaca teks. | N/A | Tidak diimplementasikan. | OCR. | Blocked OCR |
| 14 | Jurus-jurus Valuasi Saham - Raymond Budiman | 138 hlm, low_text | PDF tidak terbaca teks. | Valuasi web masih proxy teknikal. | Tidak diimplementasikan. | OCR + lapkeu. | Blocked OCR |
| 15 | Keuntungan Menjadi Individual Investor - Joeliardi Sunendar | readable | Kelebihan individual investor; tidak ada formula OHLCV spesifik. | N/A | Tidak menjadi fitur skor. | N/A | Reviewed |
| 16 | Manajemen Investasi dan Portofolio | readable | Portofolio dan risk allocation. | Position size sudah ada. | Dipertahankan; tidak tambah backtest dummy. | Data portofolio user jika mau fitur lanjutan. | Existing |
| 17 | Margin of Safety - Seth Klarman | readable | Margin of safety butuh valuasi bisnis. | Web punya fair value teknikal proxy. | Tidak mengklaim margin of safety fundamental. | Fair value fundamental, cash flow, asset value. | Data needed |
| 18 | Mastering the Market Cycle - Howard Marks | readable | Siklus pasar dan risk awareness. | IHSG chart sudah ada. | Belum jadi skor baru; bisa dikembangkan ke market regime. | Breadth IDX, sector index, macro. | Future |
| 19 | Method of Tape Reading - Wyckoff | readable | Tape reading menekankan supply/demand dan price-volume. | Ada OHLCV dan relative volume. | Dipakai sebagai dasar VPA/effort-result bersama Coulling. | OHLCV; order flow untuk versi penuh. | Partial implemented |
| 20 | Metode Value Investing Untuk Pemula - Rivan Kurniawan | hlm 3, 8, 20-29 | Margin of safety, PER, cash flow, debt. | Web belum punya full lapkeu. | Ditampilkan sebagai data fundamental wajib. | PER/PBV/ROE/cash flow/debt/growth. | Mapped gap |
| 21 | Mindful Trader - William Hartanto | 231 hlm, low_text | PDF tidak terbaca teks. | N/A | Tidak diimplementasikan. | OCR. | Blocked OCR |
| 22 | MULTIBAGGER - Cara Meraih Profit > 100% - Rivan Kurniawan | 196 hlm, low_text | PDF tidak terbaca teks. | Bagger masih berbasis teknikal + news. | Tidak dijadikan rumus karena teks tidak terbaca. | OCR + lapkeu ekspansi. | Blocked OCR |
| 23 | One Up on Wall Street - Peter Lynch (Bhs Indonesia) | hlm 39-43, 58, 72 | Kategori slow/stalwart/fast grower; fast grower butuh laba/penjualan bagus, margin, utang, dan growth. | Bagger punya validasi news/lapkeu. | Ditampilkan sebagai gap growth quality. | Growth sales/laba, margin, debt, ekspansi. | Mapped gap |
| 24 | One Up on Wall Street - Peter Lynch | readable | Kategori saham dan growth valuation. | Sama seperti nomor 23. | Tidak dihitung tanpa data fundamental. | EPS growth, PEG, debt, cash flow. | Data needed |
| 25 | Paham Saham - TICMI | readable | Edukasi pasar modal dasar. | Web sudah edukatif. | Tidak ada rumus baru. | N/A | Reviewed |
| 26 | Panduan Investasi Reksadana - Melvin Mumpuni | failed | Gagal ekstraksi PDF. | N/A | Tidak diimplementasikan. | File valid/OCR. | Failed |
| 27 | Panduan Investor Sibuk, 5 Analisis Terbaik - INVESTABOOK | readable | Analisis multi-aspek untuk investor. | Banyak komponen sudah proxy. | Tidak tambah rumus tanpa sumber formula yang eksplisit. | Lapkeu lengkap. | Reviewed |
| 28 | Profitable Day and Swing Trading - Harry Boxer | hlm 25, 44-48, 60 | Persiapan sesi, price/volume thrust, low-volume ebb, flag/coil/wedge, MA/trendline untuk entry/exit. | Ada intraday/day score, volume spike, breakout. | Dibuat Boxer price-volume surge dan low-volume ebb watch. | OHLCV intraday/daily. | Implemented |
| 29 | Rahasia Analisis Fundamental Saham - Raymond Budiman | 104 hlm, low_text | PDF tidak terbaca teks. | Fundamental web belum penuh. | Tidak diimplementasikan. | OCR + lapkeu. | Blocked OCR |
| 30 | Rasio Penting Dalam Menilai Perusahaan | hlm 1-2 | EPS, PER, PBV, sales, earning, cash flow, ROE/rasio bertumbuh minimal multi-tahun. | Web belum punya EPS/PER/PBV valid dari source resmi. | Ditampilkan sebagai data gap, bukan dihitung palsu. | EPS, PER, PBV, ROE, OCF, growth 5 tahun. | Mapped gap |
| 31 | Sebuah Seni untuk Bersikap Bodo Amat - Mark Manson | readable | Bukan buku saham/analisis. | N/A | Tidak diimplementasikan. | N/A | Not relevant |
| 32 | Secrets for Profiting in Bull and Bear Markets - Stan Weinstein | hlm 24-31, 42-43 | 30-week MA, stage chart, breakout resistance dengan volume meningkat, hindari saham di bawah MA turun. | Web punya EMA dan breakout, belum stage. | Dibuat Weinstein Stage proxy memakai SMA150 harian sebagai 30-week MA. | OHLCV 150-200+ candle. | Implemented |
| 33 | Security Analysis - Ben Graham | hlm 20, 27, 32-33 | Margin of safety/valuation membutuhkan angka bisnis. | Fair value teknikal hanya proxy. | Tidak diklaim sebagai Graham valuation. | Asset value, earnings, debt, cash flow. | Data needed |
| 34 | Seeking Wisdom From Darwin To Munger - Peter Bevelin | readable | Psikologi dan decision quality. | Risk disclaimer ada. | Tidak menjadi skor otomatis. | N/A | Reviewed |
| 35 | Simple Trading, Simple Investing - Ryan Filbert Team | 268 hlm, low_text | PDF tidak terbaca teks. | N/A | Tidak diimplementasikan. | OCR. | Blocked OCR |
| 36 | Stock Market 101 - Michele Cagan | readable | Dasar market/investing. | Web sudah punya edukasi metodologi. | Tidak tambah formula. | N/A | Reviewed |
| 37 | Street Investing - Parahita Irawan | readable | Edukasi singkat. | N/A | Tidak tambah formula. | N/A | Reviewed |
| 38 | Structures, Volume Profile and Order Flow Trading - Wyckoff | hlm 14-15, 24, 26, 28, 36, 80, 84 | Accumulation/distribution, failed structure, effort/result, volume profile/order flow. | Web punya OHLCV, tidak punya order flow resmi. | Effort/result dipakai di VPA; order flow ditandai butuh data. | OHLCV; order book/order flow/volume profile untuk versi lengkap. | Partial implemented |
| 39 | Swing Trading for Dummies - Omar Bassal | readable | Swing trading/risk management. | Web punya swing setup dan stop/target ATR. | Tidak tambah formula baru tanpa rule eksplisit yang lebih kuat. | N/A | Existing |
| 40 | Technical Analysis for Mega Profit - Edianto Ong | 385 hlm, low_text | PDF tidak terbaca teks. | N/A | Tidak diimplementasikan. | OCR. | Blocked OCR |
| 41 | The Deals Of Warren Buffett Vol 1 - Glen Arnold (Bhs Indonesia) | readable | Case study kualitas bisnis/valuasi. | Bagger butuh lapkeu. | Dipetakan sebagai validasi kualitatif, tidak otomatis. | Moat, growth, valuation. | Data needed |
| 42 | The Fundamental Puzzle - Parahita Irawan | readable | Fundamental investing. | Fundamental masih terbatas. | Tidak dihitung tanpa API lapkeu. | Full financial statement. | Data needed |
| 43 | The Intelligent Investor - Benjamin Graham | hlm 6, 13, 311, 315 | Margin of safety dan investor defensif. | Web disclaimer ada; valuasi fundamental belum. | Ditampilkan sebagai data gap. | Earnings history, debt, dividend, asset value. | Data needed |
| 44 | The Little Book That Beats the Market - Joel Greenblatt | hlm 64-70 | Magic Formula: earnings yield tinggi + return on capital tinggi. | Web belum punya EBIT/EV/ROC. | Ditampilkan sebagai gap data Magic Formula. | EBIT/EPS, enterprise value, working capital, fixed assets. | Mapped gap |
| 45 | The Psychology of Money - Morgan Housel | readable | Perilaku, risiko, time horizon. | Disclaimer/risk management ada. | Tidak menjadi sinyal saham. | N/A | Reviewed |
| 46 | The Tao of Warren Buffett - Mary Buffett, David Clark | readable | Prinsip Buffett kualitatif. | N/A | Tidak menjadi rumus otomatis. | N/A | Reviewed |
| 47 | The Warren Buffett Way - Robert Hagstrom | readable | Moat, manajemen, valuation. | Bagger butuh lapkeu/news. | Ditandai butuh data fundamental. | Moat proxy, ROE, debt, owner earnings. | Data needed |
| 48 | Trade Like A Stock Market Wizard - Mark Minervini | hlm 94, 213-218 | Trend Template, Stage 2, volatility contraction pattern, pivot buy point dengan volume meningkat. | Ada trend EMA, belum template. | Dibuat Minervini Trend Template proxy 7 kriteria; VCP hanya parsial/Boxer karena butuh struktur base. | OHLCV 252 candle; RS ranking belum tersedia. | Implemented |
| 49 | Warren Buffett Speaks - Janet Lowe | readable | Prinsip investasi kualitatif. | N/A | Tidak jadi skor otomatis. | N/A | Reviewed |
| 50 | Who Wants to be A Smiling Investor - Lukas SA | 245 hlm, low_text | PDF tidak terbaca teks. | N/A | Tidak diimplementasikan. | OCR. | Blocked OCR |
| 51 | Why Didn't They Teach Me This in School - Cary Siegel | readable | Personal finance umum. | N/A | Tidak relevan ke analisa saham. | N/A | Not relevant |
| 52 | Workbook Analisis Teknikal - Ryan Filbert | 204 hlm, low_text | PDF tidak terbaca teks. | N/A | Tidak diimplementasikan. | OCR. | Blocked OCR |
| 53 | Yuk Nabung Saham - Lukas SA | 26 hlm, low_text | PDF tidak terbaca teks. | N/A | Tidak diimplementasikan. | OCR. | Blocked OCR |
| 54 | Zero to One - Peter Thiel | readable | Strategi bisnis/startup, bukan rule saham publik. | N/A | Tidak menjadi sinyal otomatis. | N/A | Not relevant |

## Prioritas Implementasi

1. OHLCV-based dan bisa diaudit sekarang: VPA Coulling/Wyckoff, Weinstein Stage, Minervini Trend Template, Boxer price-volume surge.
2. Fundamental yang tidak boleh dipalsukan: Greenblatt, Fisher, Lynch, Graham, Rivan, dan rasio Indonesia hanya ditampilkan sebagai data gap sampai ada API lapkeu.
3. Low_text/failed: perlu OCR sebelum boleh dijadikan sumber fitur.
