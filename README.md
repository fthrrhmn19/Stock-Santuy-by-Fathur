# Stock Santuy by Fathur

Dashboard analisis saham berbasis HTML, CSS, Vanilla JavaScript, Vite, dan Netlify Functions. Rekomendasi day trade, swing, long term, dan potential bagger dihitung rules-based dari OHLCV, news, dan risk scoring.

## Fitur yang sudah dibuat
- Login opsional melalui Netlify Function dan cookie HttpOnly.
- Pencarian ticker saham IDX.
- Navbar sticky dan flow analisa cepat agar tidak perlu scroll jauh.
- Screener day trade, swing, long term, dan potential bagger.
- Tombol Harian untuk membuat gambar PNG rekomendasi saham hari itu.
- News feed dari RSS gratis dan deteksi kata kunci ekspansi/lapkeu.
- Rasio valuasi/fundamental EPS, PER, PBV, ROE, dan DER dari scanner publik untuk validasi awal lapkeu.
- Email alert otomatis via scheduled Netlify Function jika env email sudah diisi.
- Grafik candlestick live intraday saat Sesi I/II IDX berjalan, lalu pause saat istirahat/tutup.
- Grafik candlestick, volume, EMA20, stop loss, dan target.
- RSI, MACD, ATR, relative volume, support, resistance, dan scoring swing.
- Area entry, stop loss, target 1-2, serta kalkulator position sizing.
- Label data delayed dan pencegahan klaim day trade real-time.
- Responsive desktop dan mobile.

## Penting tentang Twelve Data Indonesia
Cakupan saham Indonesia pada Twelve Data ditandai EOD delayed. Gunakan untuk analisis harian/swing dan eksperimen long-term. Jangan memakai hasil ini sebagai sinyal day trade real-time.

## Provider data
Dashboard mendukung dua jalur data:
- Twelve Data jika `TWELVE_DATA_API_KEY` diisi dengan key valid.
- Yahoo Finance chart fallback jika `ENABLE_YAHOO_FALLBACK=true`.
- TradingView Indonesia scanner publik untuk rasio fundamental EPS, PER, PBV, ROE, dan DER.

Fallback Yahoo gratis dan bisa mengambil candle IDX seperti `BBCA.JK`, termasuk intraday saat tersedia. Namun fallback ini bukan API resmi exchange, sehingga dashboard memberi label `realtime not guaranteed`. Untuk data IDX real-time yang resmi dan reliabel, gunakan lisensi IDX Data Services atau provider data IDX berbayar/berlisensi.
Rasio fundamental dari scanner publik dipakai sebagai validasi awal, bukan pengganti laporan keuangan resmi emiten/IDX.

## Instalasi
```bash
npm install
```

Buat `.env` dari contoh:
```bash
cp .env.example .env
```

Isi:
```env
MARKET_DATA_PROVIDER=twelvedata
TWELVE_DATA_API_KEY=API_KEY_ANDA
ENABLE_YAHOO_FALLBACK=true
IDX_API_BASE_URL=
IDX_API_KEY=
IDX_CLIENT_ID=
IDX_CLIENT_SECRET=

ACCESS_PASSWORD_HASH=pbkdf2_sha256$...
SESSION_SECRET=ganti_dengan_string_acak_panjang
ALLOWED_ORIGIN=https://stock-santuy.netlify.app

CACHE_TTL_QUOTE=60
CACHE_TTL_INTRADAY=60
CACHE_TTL_DAILY=3600
LIVE_REFRESH_MS=60000

RESEND_API_KEY=
ALERT_EMAIL_TO=email_anda@example.com
ALERT_EMAIL_FROM=Stock Santuy <onboarding@resend.dev>
ALERT_MIN_SCORE=78
ALERT_MANUAL_SECRET=
HARMONIC_ALERT_LOOKBACK=20
HARMONIC_ALERT_RECENT_LOOKBACK=1
WATCH_HARMONIC_COOLDOWN_HOURS=4
IDX_HOLIDAYS=
SITE_URL=https://stock-santuy.netlify.app
```

Email alert memakai Resend API dari server-side Netlify Function. Jadwal Netlify memakai UTC: `signal-morning` berjalan 00:00 WIB untuk menu pagi, `signal-midday` 12:00 WIB, `signal-afternoon` 15:40 WIB, dan `signal-watch` tiap 5 menit sekitar jam market. Menu pagi/siang/sore berisi rekomendasi sesuai sesi, sedangkan realtime watch hanya mengirim saham yang baru membentuk harmonic pattern intraday 15 menit. Sinyal watch yang sama masuk cooldown `WATCH_HARMONIC_COOLDOWN_HOURS` agar tidak mengirim saham yang sama berulang. Function akan skip email saat weekend atau tanggal libur nasional/cuti bersama dari API Hari Libur Indonesia, dan watch alert pause saat pasar reguler sedang istirahat atau tutup. Untuk libur khusus BEI, isi `IDX_HOLIDAYS` dengan format `YYYY-MM-DD:Nama Libur`. Jika ingin sender domain sendiri, verifikasi domain di Resend lalu ganti `ALERT_EMAIL_FROM`.

Chart saham dan IHSG memakai endpoint `/api/market-schedule` untuk mengikuti jam pasar reguler IDX: Senin-Kamis Sesi I 09:00-12:00 dan Sesi II 13:30-15:49:59 WIB; Jumat Sesi I 09:00-11:30 dan Sesi II 14:00-15:49:59 WIB. Saat sesi aktif, chart memakai candle intraday 5 menit dan auto-refresh sesuai `LIVE_REFRESH_MS`/`CACHE_TTL_INTRADAY`; di luar sesi, status berubah pause dan chart tidak di-refresh otomatis.

Untuk password login `stocksantuyanalisis`, `.env` lokal sudah berisi hash yang sesuai. Jika ingin membuat hash baru:
```bash
node -e "const crypto=require('crypto');const p='password_anda';const s=crypto.randomBytes(16).toString('hex');const i=210000;console.log('pbkdf2_sha256$'+i+'$'+s+'$'+crypto.pbkdf2Sync(p,s,i,32,'sha256').toString('hex'))"
```

Jalankan dengan Netlify Dev agar Functions ikut aktif:
```bash
npx netlify dev
```

Buka `http://localhost:8888`.

## Deploy Netlify
1. Upload project ke GitHub.
2. Hubungkan repository ke Netlify.
3. Build command: `npm run build`.
4. Publish directory: `dist`.
5. Functions directory: `netlify/functions`.
6. Di Project configuration -> Environment variables, tambahkan variabel dari `.env.example`.
7. Deploy ulang.

Jangan memasukkan `.env` atau API key ke GitHub.

## Keterbatasan
- Potential bagger memakai proxy teknikal, likuiditas, dan news keyword. Validasi final tetap perlu laporan keuangan resmi, aksi korporasi, dan prospek bisnis.
- API gratis IDX biasanya delayed atau tidak resmi. Untuk real-time resmi, pakai IDX Data Services atau provider berlisensi.
- Skor adalah alat bantu, bukan jaminan hasil.

## Disclaimer
Stock Santuy merupakan alat bantu analisis dan edukasi. Seluruh data, skor, entry, target, dan stop loss bukan jaminan keuntungan dan bukan ajakan membeli atau menjual efek.
