# Circle Video Importer

## Başlatma

Proje kökündeki `start-importer.cmd` dosyasını çift tıkla; http://localhost:4317
açılır. `index.html` dosyasını doğrudan `file://` olarak açma. Python 3.10+, Node.js
ve Edge/Chrome gerekir. İlk çalıştırmada paketler `.tools/tiktok` içine kurulur.
Circle frontend ve NestJS backend çalışıyor olmalı. Veritabanı paneli backend’i
başlatabilir; frontend’i normal geliştirme komutuyla ayrıca başlat.

## Kendi Keşfetinden otomatik yayınlama

1. Aynı tarayıcıda http://localhost:3000 üzerinden Circle hesabına giriş yap.
2. Importer’da **Circle oturumunu bağla** düğmesine bas. Kullanıcı ID/token/parola
   yazman gerekmez; hedef hesap mevcut Circle oturumundan alınır.
3. **TikTok hesabını bağla** düğmesine bas. Açılan araca ait TikTok penceresinde
   kendi hesabına giriş yap, doğrulamayı tamamla ve pencereyi kapat.
4. **Keşfet otomasyonu** bölümünde **Benim Keşfetim**, turdaki video sayısı,
   tur aralığı, günlük yayın limiti ve tur sınırı seç. 0 tur sınırı sınırsızdır.
5. **Otomasyonu başlat** düğmesine bas. **Tek tur çalıştır** bir kez toplar.

İlk tur hemen başlar. Sonraki toplama seçtiğin dakika aralığında yapılır;
önceki kuyruk bitmeden yeni tur başlamaz. Adet üst sınırdır: daha az video yüklenirse
veya tekrarlar varsa yalnızca bulunan yeni videolar yayınlanır. Videolar bağlı
Circle hesabında herkese açık yayınlanır. Açıklamaya ayrıca TikTok bağlantısı
konmaz. Günlük sınır Asia/Tbilisi saatine göre yayın gününü sayar; bekleyen
otomatik kuyruklar ertesi gün devam etse de günlük sınır korunur.

Sayfayı/tarayıcıyı kapatabilirsin; ayrı yerel Python servisi devam eder. Bilgisayar,
servis ve Circle açık olmalı. Uyku/kapalı bilgisayarda çalışmaz.
**Windows oturum açıldığında servisi sessizce başlat** isteğe bağlıdır ve varsayılan
olarak etkinleştirilmez. Yalnızca importer’ı başlatır; Circle da ayrıca çalışmalı.
Yeniden başlatma sonrası kuyruk ve zamanlama devam eder; kaçırılan tüm turlar
birden yayınlanmaz.

TikTok, `.tools/importer/tiktok-browser` içindeki ayrı kalıcı tarayıcı profilini
kullanır ([Playwright persistent context](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-persistent-context)).
Normal tarayıcı profilin/çerezlerin kopyalanmaz. Aynı TikTok hesabının Sizin İçin
akışı okunur; başka sekmedeki video sırasının birebir aynı olması garanti edilmez.
Giriş yoksa hata verir; genel Keşfet’e otomatik geçmez. Arka plan toplama için
TikTok giriş penceresini kapatmalısın.

Circle için bağımsız refresh zincirine sahip arka plan oturumu oluşturulur;
tarayıcının token yenilemesiyle çakışmaz. Yerel kayıt Windows kullanıcısına bağlı
DPAPI ile şifrelenir. Circle’da tüm oturumlardan çıkış, parola değişimi veya hesap
kısıtlaması bunu da geçersiz kılar. Normal tarayıcı oturumundan çıkmak ayrı
otomasyonu durdurmaz; durmak için importer düğmelerini kullan.

## Kuyruk, hatalar ve tekrar kontrolü

Arka plan kuyruğu gerçek indirme/yükleme/yayınlama durumlarını ve hataları gösterir.
Duraklat, devam et, iptal et, başarısızları tekrar dene seçenekleri vardır.
**Yeni turları durdur** mevcut kuyruğu bırakır. **Tüm işleri duraklat / Tüm bekleyen
işleri iptal et** Circle’a giriş yapamasan bile yerel araçtan kullanılabilir.
Devam eden video tamamlanır; sonraki işler durur.

Geçici aktarım hataları sınırlı olarak yeniden denenir. Giriş hataları kuyruğu
duraklatır. Üst üste üç toplama hatası otomasyonu durdurur; eksik TikTok/Circle
girişi tespit edilirse hemen durur. Sorunu düzeltip oturumu yeniden bağla ve devam et.
Aynı TikTok video ID, hedef Circle bağlantısı ve hesabı için tekrar aktarılmaz.
Yanıt kaybında tekrar deneme önceki medyayı kullanıp oluşturulan gönderiyi arar.
Tek proje için ikinci işçi kilitle engellenir. Günlük sınır otomatik yayınlara
uygulanır; manuel seçili aktarım ayrı işlerdir.

Tamamlanan/iptal edilen kuyruk ayrıntıları oluşturulmalarından 30 gün sonra
temizlenir; tekrar kontrol kayıtları korunur. `.tools/importer/imports.sqlite3`
dosyasında MP4 yoktur: metadata, kuyruk, zamanlama ve şifreli Circle oturumları
vardır. Bu dosyayı silmek tekrar kontrolünü kaybettirir.

## Manuel ve diğer kaynaklar

Üstteki aramadan kişisel arka plan Keşfet, TikTok profili veya genel Keşfet seçip
1–100 video getir. Profilde `@username`, tam profil/video adresi kabul edilir;
Load More sonraki sayfayı getirir. Önizle, kutucuklardan seç ve **Import Selected**
ile kalıcı arka plan kuyruğuna ekle.

**Açık TikTok sekmem (yer imi)** eski manuel yöntemdir. **Circle Keşfetimi Al**
bağlantısını yer imi çubuğuna sürükle. Hesabının açık olduğu
https://www.tiktok.com/foryou sekmesinde yer imine tıkla ve adedi seç. Yalnızca
video metadata’sı aktarılır; şifre/token/çerez okunmaz. Bu yöntem kendi başına
zamanlanamaz; importer’da videoları seçmen gerekir.

Gerçek TikTok sayfaları okunur; uydurma endpoint veya sahte sonuç yoktur.
Genel Keşfet Explore sayfasındaki gerçek yanıtları, kişisel Keşfet otomasyon
profilindeki görünür kartları okur. yt-dlp dosyaları indirir. CAPTCHA, IP engeli,
erişim kısıtlaması veya indirilemeyen video gerçek hata olarak gösterilir.
Kısıtlı dosyaların erişimi açılmaz; yalnızca yayınlama iznin olan içerikleri aktar.
Kişisel akışın çalışması giriş sonrasında TikTok’un gerçek sayfasına ve erişim
durumuna bağlıdır; kullanıcı girişi yapılmadan canlı kişisel toplama doğrulanamaz.

## PostgreSQL bağlantısı

**Bağlantı ve PostgreSQL ayarları** alanında host, port, DB adı, kullanıcı, parola
ve TLS ayarlanır. Mevcut parola gösterilmez; boş alan mevcut parolayı korur.
Parolayı kaldırmak ayrı kutucukla seçilir. Parola tarayıcı localStorage’ına yazılmaz.

**Bağlantıyı test et** gerçek bağlantıyı, Circle tablolarını, derlenmiş backend’in
migration listesini ve gerekli tablo izinlerini kontrol eder; kayıt/ayar değiştirmez.
**Test et, kaydet ve Circle’ı yeniden başlat** başarılı testten sonra sadece
`server/.env` içindeki `DB_*` ayarlarını yazar ve bu projenin derlenmiş NestJS
backend’ini yeniden başlatır. Yeni bağlantı başlamazsa eski ayarlar geri yüklenir
ve eski backend tekrar başlatılır. Log: `.tools/importer/circle-backend.log`.

Önce otomasyonu durdur ve açık kuyrukları bitir/iptal et. Hedefte mevcut Circle
şeması/migrationları kurulmuş olmalı. Araç DB oluşturmaz; şema veya mevcut
verileri taşımaz. Farklı DB’ye geçtiğinde Circle’a yeniden giriş yap ve arka plan
oturumunu bağla. Başarılı bağlantı değişiminde eski arka plan oturum kayıtları silinir.

Mevcut `posts.author_id`, `media.owner_id`, `post_media` ilişkileri ve Circle
API yetkilendirmesi kullanılır. MP4 mevcut media storage’a gider (varsayılan
`server/storage/media`); PostgreSQL yalnızca metadata/ilişkileri tutar. Geçici
MP4 normal aktarım bitince temizlenir. Circle’ın kalıcı silme mekanizması gönderiye
bağlı medya dosyasını storage’dan da kaldırır.

## İsteğe bağlı yapılandırma

```powershell
$env:CIRCLE_WEB_URL = 'http://localhost:3000'
$env:IMPORTER_PORT = '4317'
$env:IMPORTER_MAX_VIDEO_BYTES = '104857600'
python tools/tiktok_importer.py
```

Circle için NestJS portu yerine frontend/session gateway adresini kullan.
Her iki uygulamada `localhost` kullan; mevcut HttpOnly Circle çerezleri
`/api/backend` yolunda paylaşılır. Başka uyumlu helper için `index.html` içindeki
`API_CONFIG.base` ayarlanabilir. DB paneli bu yerel projeyi yönetir; uzak sunucu
yönetimi yapmaz. Helper yalnızca 127.0.0.1’de çalışır ve kendi origin/Host’una
ait istekleri kabul eder. Ayar değişince helper’ı yeniden başlat.

## Kontroller

`python tools/test_tiktok_importer.py`: izole test sunucusuyla HTTP/oturum,
Circle medya/gönderi sözleşmeleri, tekrar önleme, kayıp yanıt, kalıcı kuyruk/kurtarma,
duraklat/iptal, zamanlama, günlük limit, hata durdurma ve DB geri alma testleri.
Gerçek Circle verisi değiştirilmez. NestJS auth e2e testleri ayrı `_test` DB’de
arka plan oturumunun hesap bağını, bağımsız refresh zincirini ve normal iptalini doğrular.
