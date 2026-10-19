# Arama güncellemesi ve TURN kurulumu

Arama penceresinin üstündeki küçültme düğmesi aramayı köşeye alır. Uygulamanın
bağlantılarıyla gezinirken aynı WebRTC bağlantısı ve ses öğesi açık kalır; büyütme
düğmesi aramaya döner. Sayfayı tamamen yenilemek, sekmeyi kapatmak veya çıkış
yapmak aramayı bitirir.

Kamera kapatıldığında karşı tarafa veri kanalı üzerinden kaynak değişikliği
bildirilir; donmuş video gizlenir. İki kamera da kapalıysa sesli arama görünümü
gösterilir. Bir katılımcı kamera/ekran gönderiyorsa onun görüntüsü görünür.

Ekran paylaşımı tarayıcının kendi seçim penceresini kullanır. Paylaşım sırasında
sağdaki kalite panelinden 720p/30 FPS, 720p/60 FPS, 1080p/30 FPS veya 1080p/60 FPS
seçilebilir. Mobilde panel alt tarafta, arama düğmelerinin üzerinde gösterilir.
Varsayılan 1080p/30 FPS'tir. Seçim, aynı yakalama izine canlı uygulanır; mikrofonu
ve bağlantıyı yeniden açmaz. Sırasıyla 3,5/6/6/10 Mbit/sn üst sınırları ve
çözünürlüğü koruma tercihi uygulanır. Gerçek çözünürlük ve
kalite seçilen kaynağa, tarayıcıya ve bağlantıya bağlıdır. Mikrofon açık kalır;
paylaşımı bitirmek daha önce açık olan kamerayı geri açar. Tarayıcının paylaşımı
durdurma düğmesi de aynı işlemi yapar. Ekran paylaşımı API'si bulunmayan mobil
tarayıcılarda düğme devre dışıdır; bu cihazlar karşı tarafın paylaşımını izleyebilir.

Geçici sinyalleşme hataları yeniden denenir; başarısız/kopmuş ICE bağlantısı yeniden
kurulmaya çalışılır. Çevrimiçi olma/ağ değişimi ve uygulamaya dönüş olayları da
iyileşmeyi tetikler. Kısıtlı mobil ağlarda bunların çalışması için erişilebilir bir
TURN aktarıcısı gerekir.

## VPS: 13.140.148.251

TURN, ana `docker-compose.yml` dosyasındadır; ek Compose dosyası, `.env.turn`
veya elle anahtar oluşturmak gerekmez. Mevcut çalışan PostgreSQL'in bulunduğu
Linux VPS'te, proje dizininde şu komutu çalıştırın:

```sh
docker compose up -d --build --no-deps web api turn
```

API ilk açılışta rastgele anahtarı `turn_control` adlı kalıcı Docker volume'üne
yazar. TURN bu dosya hazır olana kadar bekler ve volume'ü salt okunur bağlar.
Yeniden derleme/başlatma aynı anahtarı korur. İki imajdaki bağlama dizininin
sahibi aynıdır; `--no-deps` ile eşzamanlı ilk başlatma da desteklenir.
Tarayıcıya yalnızca süreli HMAC kimlik bilgileri gönderilir.

`--no-deps`, PostgreSQL'i başlatmaz; ilk kurulumda `docker compose up -d --build`
kullanın. Volume'leri silmeyin. IP değişirse `.env` içinde `TURN_PUBLIC_IP` ayarlayıp
aynı güncelleme komutunu çalıştırın. Özel dış TURN için mevcut `CALL_TURN_URLS` ve
`CALL_TURN_SECRET` seçenekleri korunur; belirtilen anahtar yerleşik TURN'e de verilir.
Canlı VPS'e bu çalışma sırasında bağlanılmadı.

VPS güvenlik duvarında **ve sağlayıcının güvenlik grubunda** gelen trafiğe açın:

| Port | Protokol | İşlev |
| --- | --- | --- |
| 3478 | UDP ve TCP | TURN istemci bağlantısı |
| 49160–49260 | UDP | Ses/video aktarımı |

Linux host ağı kullanılır. VPS NAT arkasındaysa dış portlar aynı iç portlara
yönlendirilmelidir.
Bu yapılandırma `turn:` UDP/TCP sağlar. HTTPS alan adının 443 portuna giden normal
HTTP proxy'si TURN trafiğini aktaramaz. Yalnızca TLS/443'e izin veren ağlar için
ayrı TURN alan adı, geçerli sertifika ve uygun TLS portu ayrıca yapılandırılmalıdır;
yerleşik servis, sertifika olmadan `turns:` adresi ilan etmez.

Kontrol:

```sh
docker compose ps turn api
docker compose logs --tail=50 turn
```

Giriş yapılmış tarayıcıda `/api/backend/api/calls/config` yanıtında
`relayConfigured: true` görülmelidir. Bu yalnızca ayarın yüklendiğini gösterir.
Farklı mobil/Wi-Fi ağlarındaki iki cihazla arama yapın; `chrome://webrtc-internals`
üzerinden seçilen aday çiftinde `relay` adayının kullanıldığını doğrulayın.
Fiziksel iOS/Android, operatör ağı ve canlı TURN erişimi ayrıca doğrulanmalıdır.

Coturn seçenekleri [resmî Docker belgesi](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md)
ve [resmî yapılandırma örneğine](https://github.com/coturn/coturn/blob/master/docker/coturn/turnserver.conf)
göre hazırlanmıştır.

## Yerel doğrulama

```sh
cd client
npm run lint
npm run build
npm run test:calls
```

`tools/test_call_experience_browser.py`, mevcut yerel PostgreSQL `127.0.0.1:55433`
ve `.tools/tiktok` Playwright kurulumuyla yalnızca `circle_call_experience_test`
veritabanını kullanır. Derlenmiş API ve Next'i 3014/3015 portlarında başlatır.
İki gerçek Chrome WebRTC ucu, yapay kamera/mikrofon ve tarayıcının otomatik test yakalama kaynağı ile
çalışır; canlı kullanıcı hesaplarını veya uygulamanın asıl veritabanını kullanmaz.

Bu değişiklikte geçen kontroller:

- İstemci lint/üretim derlemesi, sunucu derlemesi ve `test:calls`.
- İki Chrome arasında gerçek ses paketleri; aramayı yanıtlarken iki geçici yapılandırma
  isteği hatasından kurtulma; kamera kapanırken aynı ses öğesini/akışını koruma.
- `getDisplayMedia` yakalamasının karşı tarafta çözülmesi; paylaşımı durdurma ve önceki
  kamerayı geri getirme; izin iptali ve arama kapandıktan sonra gelen izin sonucunun temizlenmesi.
- Aramayı küçültüp Next bağlantısıyla Explore'a gitme ve aynı bağlantı/ses öğesiyle büyütme.
- Beş saniyelik çevrimdışı sinyalleşme sonrası ICE yeniden başlatma ve devam eden ses paketleri.
- 320×568, 390×844 ve 844×390 ekranlarında kontrollerin ve küçük pencerenin sınırlar içinde kalması.
- Doğrudan görüntülü başlayan aramanın iki kamera kapatılınca sesli görünüme dönmesi;
  arama sonunda iki bağlantının da kapanması. Tarayıcı sayfa hatası oluşmadı.
- Ortak Modal bileşeninin kullanıldığı mevcut `test:discovery` kontrolleri.
- Dört kalite seçeneğinin yakalama çözünürlüğü, FPS ve gönderici sınırlarını canlı değiştirmesi;
  mikrofonu/yakalama izini koruması; mobil panelin kontrollerle çakışmaması.
- API'nin ilk açılışta anahtarı oluşturması, yeniden başlatmalarda koruması ve açıkça verilen
  anahtar değişikliğini uygulaması; ana Compose dosyası ve TURN başlangıç betiğinin doğrulaması.

Bu makinede Docker olmadığı için Coturn konteyneri başlatılmadı; canlı VPS/TURN,
operatör ağları ve fiziksel mobil cihazlar test kapsamına girmedi.
