# Çemberler (Circles)

3–30 kişilik kapalı gruplar. Her çemberin günlük sorusu, ortak serisi, akışı ve süreli
albümleri vardır. Menüde **Circles** (`/circles`) sayfasından erişilir.

## Kurulum

`Circles1760192100000` migration'ı gerekir (Compose API açılışında otomatik çalıştırır):

```sh
cd server && npm run migration:run
```

## Kurallar

- **Roller:** sahip, yönetici, üye. Sahip rolleri değiştirir ve sahipliği devredebilir;
  yöneticiler ayarları, daveti ve günlük soruyu yönetir, üyeleri çıkarabilir.
  Sahip ayrılır veya hesabı silinirse sahiplik en eski yöneticiye (yoksa en eski üyeye)
  bir veritabanı tetikleyicisiyle geçer. Son kişi ayrılınca çember ve yüklemeleri silinir.
- **Davet:** 8 karakterlik kod / `/circles/join/<kod>` bağlantısı. Yöneticiler bağlantıyı
  sıfırlayabilir; "Members can invite" kapalıysa üyeler kodu görmez. En fazla 30 üye,
  kişi başı en fazla 30 çember.
- **Günlük soru:** UTC gününe göre her çembere yerleşik havuzdan (yalnızca olumlu sorular;
  kimseyi hedef alan anket yok) bir soru düşer. Türler: yazı, fotoğraf, anket. Bugünün
  cevapları siz cevaplayana kadar kilitlidir. Yöneticiler kendi sorusunu sorabilir: bugün
  kimse cevaplamadıysa bugünün sorusu olur, aksi halde yarının.
- **Ortak seri:** Çember için yapılan her şey (soruya cevap, akış gönderisi, albüme ekleme)
  o gün bir kez sayılır. Günlük hedef: "Smart" (6 kişiye kadar herkes, üstünde üçte iki),
  herkes, üçte iki veya yarı; en az 2 kişi. DM serileri gibi bir günlük tolerans vardır;
  seriyi bozan kişi kimseye gösterilmez, yalnızca "N kişi daha gerekiyor" yazılır.
- **Albümler:** 24 saat – 1 hafta açık kalır, bu sürede herkes fotoğraf/video ekler, sonra
  kapanır. Aynı anda en fazla 5 açık albüm. Silinen albüm/gönderi medyasını da siler.
- **Gizlilik:** Üye olmayanlar çemberi göremez (404). Engellediğiniz/sizi engelleyen
  kişilerin gönderileri ve cevapları size gösterilmez. Çember medyası saatlik sahipsiz
  medya temizliğinden korunur; yönetim panelinde kullanım türü `CIRCLE` görünür.

## Testler

```sh
# Sunucu (yalnızca *_test veritabanı; DB_* ile yerel bir PostgreSQL'e yönlendirin)
cd server && npx vitest run --config ./vitest.config.e2e.ts test/circles.e2e-spec.ts
# Gerçek Chrome: oluşturma, davet, katılma, cevap kilidi, seri, albüm, mobil taşma
cd tools && python test_circles_browser.py
```

## Sonraki adımlar

- Çember bildirimleri (yeni soru, "seri bu gece bitiyor") ve okul saatinde sessiz mod.
- Davet için QR kodu (şu an bağlantı kopyalama ve sistem paylaşımı var).
- Çember gönderileri için şikâyet akışı.
