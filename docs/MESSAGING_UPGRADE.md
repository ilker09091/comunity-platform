# Mesajlaşma güncellemesi

## Kurulum

Sunucu başlangıcındaki mevcut migration adımı `1760192400000-GroupMessaging`
göçünü uygular. Bu göç DM düzenleme zamanını, grup sohbetlerini, üyelikleri ve
grup mesajlarını ekler; mevcut mesajlar korunur.

GIF anahtarı proje kökündeki özel `.env.giphy` dosyasına kaydedildi. Dosya Git'e
alınmaz ve tarayıcıya verilmez. VPS'e ayrıca kopyalayın veya VPS'in kök `.env`
dosyasında `GIPHY_API_KEY` tanımlayın. İsteğe bağlı `.env.giphy` için Docker
Compose 2.24 veya üzeri gerekir. Yerel API de aynı dosyayı okur.

Mevcut veritabanı çalışırken güncelleme:

```sh
docker compose up -d --build --no-deps web api turn
docker compose ps web api turn
docker compose logs --tail=50 turn
```

Yeni kurulumda veritabanı dahil tüm servisleri başlatın; `--no-deps` yalnızca
mevcut kurulumun uygulama servislerini yenilemek içindir. TURN portları ve canlı
ağ kontrolü [arama belgesinde](CALL_EXPERIENCE.md) açıklanır.

## Davranış

- GIF araması sunucudan GIPHY'ye gider. Sonuçlar varsayılan `pg-13` sınırındadır;
  gönderilen kimlik tekrar doğrulanır. Yalnızca GIPHY medya adresleri kabul edilir.
  MP4 oynatılamazsa animasyonlu görsele geçilir; sağlayıcı hatasında tekrar denenebilir.
- Kendi metin mesajınızın menüsündeki **Edit message**, DM ve grupta metni
  değiştirir; iki tarafta **Edited** görünür. Karşı tarafın mesajı düzenlenemez.
  Engellenen birine eski DM'yi düzenleyerek ulaşmak da engellenir.
- Dokunmatik menü, açan basılı tutmanın bırakılmasını bir seçim saymaz.
  Arka alana dokunarak kapanır. Sesli mesajı kaydırma hareketi menüyü açmaz.
- HTTP(S) ve `www.` bağlantıları tıklanabilir. Aynı alan adındaki Circle daveti
  uygulama içinde açılır. Metin HTML olarak çalıştırılmaz.
- Nota verilen yanıt, notun görüntüsünü taşıyan DM oluşturur ve o sohbete geçer.
  Süresi dolan, görünmeyen veya engellenen kişinin notuna yanıt verilemez.
- Profil kapak fotoğrafı mobilde yeniden görünür. Açık temanın mobil arka planı
  beyazdır. Mesaj yazarken ek araçlar gizlenip gönderme düğmesi öne çıkar.
- Sayfalı listeler ve eski sohbet mesajları görünür sınıra gelindiğinde otomatik
  yüklenir. Elle yükleme düğmesi destekleyici seçenek olarak kalır.
- Circle'ın **Invite → Send in Circle** menüsü, birden fazla DM veya gruba davet
  gönderebilir. Kısmen başarısız gönderimde yalnızca başarısız hedefler seçili kalır.
  Davet gönderilmesi üyelik vermez; mevcut katılma izinleri uygulanır.

## Grup kuralları

Grup sohbeti **Messages → New group chat** ile kurulur. 3–32 kişi desteklenir.
Eklenen kişiler karşılıklı takip veya kabul edilmiş mesaj ilişkisine sahip
olmalıdır. Engellenmiş kişiler aynı yeni gruba eklenemez. Kişi başına en fazla
50 grup vardır.

Üyeler metin, fotoğraf/video, GIF, sticker ve sesli mesaj gönderebilir; yanıt
verebilir, kendi metnini düzenleyebilir ve kendi mesajını geri alabilir.
Alınan özel sticker favorilere eklenebilir. Tek görüntülemelik medya gruplarda
desteklenmez. Grup araması bu güncellemenin kapsamında değildir.

Yalnızca grup sahibi ad değiştirebilir ve üye ekleyip çıkarabilir. Ayrılan veya
çıkarılan kişinin gruba erişimi hemen kesilir. Sahip ayrılırsa sahiplik kalan
en eski üyeye geçer; son üye ayrılınca grup ve sahipsiz ekler temizlenir.
Sahibin hesabı tamamen silinirse sahibi olduğu grup da silinir.

Sonradan engellenen grup üyesinin profili, mesajları, son mesaj önizlemesi ve
alıntı metni o kişiye gizlenir. Mesaj teslimi cihazın aldığı kimlikleri açıkça
onaylamasına bağlıdır. Grup mesajında çift işaret tüm diğer mevcut üyelerin
teslim almasıyla, mavi işaret tümünün okumasıyla görünür. Gelen mesajı yalnızca
listelemek veya okunmamış sayısını istemek, okundu sayılmaz.

## Doğrulama

API testleri yalnızca `_test` son ekli yerel veritabanıyla çalıştırılmalıdır:

```sh
cd server
npm run test:e2e -- messaging-upgrade gifs-replies dm-attachments-receipts
npm test -- gifs.spec
cd ../client
npm run lint
npm run build
npm run test:calls
```

`tools/test_messaging_upgrade_browser.py` mobil basılı tutmayı, düzenlemeyi,
bağlantıları, otomatik geçmiş yüklemeyi, not yanıtını, grup oluşturmayı ve Circle
davetini gerçek Chrome'da kontrol eder. `tools/test_gifs_replies_browser.py` GIF
mesajlarını ve yorumlarını yerel sağlayıcı taklidiyle sınar.
`tools/test_call_experience_browser.py` iki Chrome WebRTC ucu ve yapay kamera/
mikrofonla arama, ekran paylaşımı ve küçük pencereyi kontrol eder. Bunlar
3014/3015 portlarını kullandığı için sırayla çalıştırılır.

Canlı VPS'te Docker imajının başlatılması, fiziksel telefon klavyesi ve operatör
üzerinden TURN bağlantısı bu yerel testlerin yerine geçmez; dağıtım sonrasında
bu ortamlar ayrıca doğrulanmalıdır.
