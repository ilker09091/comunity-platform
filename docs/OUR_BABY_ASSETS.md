# "Bebeğimiz": ChatGPT görsel promptları

Bu dosyadaki promptları **sırayla, hepsini AYNI ChatGPT sohbetinde** gönder. Aynı sohbette
kalınca ChatGPT karakteri hatırlar ve bütün görsellerde aynı çocuk çıkar.

İndirdiğin her PNG'yi verilen isimle şu klasöre koy:

```
client/public/baby/raw/
```

Izgaralı (grid) görselleri ben otomatik olarak tek tek parçalara ayıracağım. Hücreleri tam
hizalamana gerek yok, sadece karakterler birbirine değmesin.

## Kurallar ve ipuçları

- Sonuç arka planlı gelirse: **"Make the background transparent, keep everything else the same."**
- Karakter değişirse: **"Keep the exact same child as in the reference sheet, only change the outfit."**
- Şeffaf arka plan hiç olmazsa: **"Use a solid pure magenta (#FF00FF) background instead."** de, magentayı ben silerim.
- Yazı, logo veya filigran çıkarsa: **"Remove all text."**
- İstersen ilk prompttan önce ikinizin birer fotoğrafını yükleyip şunu ekleyebilirsin:
  *"Give the child a cartoon mix of these two people's features (hair color, eye color, skin tone)."*
  Böylece çocuk ikinize benzer. İsteğe bağlı.

Her prompt aynı stil bloğuyla bitiyor, onu silme. Tutarlılığı bu sağlıyor.

---

## 1. Kız: referans sayfası → `ref-girl.png`

```
Create a character reference sheet of ONE little girl shown at four ages in a single row, left to right:
1) baby about 8 months old, sitting
2) toddler about 2 years old, standing
3) child about 6 years old, standing
4) child about 10 years old, standing
It must clearly be the same person growing up: same face shape, same warm brown hair, same dark brown eyes, same skin tone. Each wears a simple plain white outfit. Four equal columns, equal spacing, all facing the viewer, friendly smile.
Landscape image, 1536x1024.

Style: cute flat 2D vector illustration, kawaii chibi proportions (big head, small body), soft rounded shapes, clean thin dark-brown outlines, flat solid colors only. No gradients, no textures, no ground shadows, no text, no watermark. Warm pastel palette. Transparent background (PNG with alpha). Every figure fully visible and centered in its own column, nothing touching.
```

## 2. Erkek: referans sayfası → `ref-boy.png`

```
Now create the same kind of reference sheet for ONE little boy, the sibling of the girl above (same art style, similar features, warm brown hair, dark brown eyes, same skin tone), at the same four ages in a single row, left to right:
1) baby about 8 months old, sitting
2) toddler about 2 years old, standing
3) child about 6 years old, standing
4) child about 10 years old, standing
Simple plain white outfit, four equal columns, all facing the viewer, friendly smile.
Landscape image, 1536x1024.

Style: cute flat 2D vector illustration, kawaii chibi proportions (big head, small body), soft rounded shapes, clean thin dark-brown outlines, flat solid colors only. No gradients, no textures, no ground shadows, no text, no watermark. Warm pastel palette. Transparent background (PNG with alpha). Every figure fully visible and centered in its own column, nothing touching.
```

---

## 3. Kıyafet sayfaları: 8 görsel (her yaş × kız/erkek)

Aşağıdaki kalıbı kullan, sadece `[...]` kısımlarını değiştir. Her biri 3 sütun × 2 satır,
toplam 6 kıyafet. **Sıra önemli.** 1. kıyafet varsayılan kıyafet.

```
Using the exact same [girl / boy] from the reference sheet, at age [AGE], draw them 6 times in a grid of 3 columns and 2 rows. Same pose, same size and same position in every cell; only the outfit changes. Outfits in this order (left to right, top row first):
1. [OUTFIT 1]
2. [OUTFIT 2]
3. [OUTFIT 3]
4. [OUTFIT 4]
5. [OUTFIT 5]
6. [OUTFIT 6]
Landscape image, 1536x1024.

Style: cute flat 2D vector illustration, kawaii chibi proportions (big head, small body), soft rounded shapes, clean thin dark-brown outlines, flat solid colors only. No gradients, no textures, no ground shadows, no text, no watermark. Warm pastel palette. Transparent background (PNG with alpha). Every figure fully visible and centered in its own cell, nothing touching.
```

| Dosya | [AGE] | Kıyafetler (1 → 6) |
|---|---|---|
| `girl-stage1.png` | stage 1: baby about 8 months, sitting | 1 plain white onesie · 2 pink bunny-ear hooded onesie · 3 yellow duckling romper · 4 knitted cream sweater with a beanie · 5 teddy bear costume with round hood ears · 6 little white-and-navy sailor dress |
| `boy-stage1.png` | stage 1: baby about 8 months, sitting | 1 plain white onesie · 2 light blue bunny-ear hooded onesie · 3 yellow duckling romper · 4 knitted cream sweater with a beanie · 5 teddy bear costume with round hood ears · 6 little white-and-navy sailor suit |
| `girl-stage2.png` | stage 2: toddler about 2 years, standing | 1 striped t-shirt with denim overalls · 2 green dinosaur costume with hood · 3 yellow raincoat with red rain boots · 4 pajamas with little stars · 5 red strawberry dress · 6 puffy winter coat with a pom-pom beanie |
| `boy-stage2.png` | stage 2: toddler about 2 years, standing | 1 striped t-shirt with denim overalls · 2 green dinosaur costume with hood · 3 yellow raincoat with red rain boots · 4 pajamas with little stars · 5 shirt with suspenders and a bow tie · 6 puffy winter coat with a pom-pom beanie |
| `girl-stage3.png` | stage 3: child about 6 years, standing | 1 t-shirt, jeans and sneakers · 2 school uniform with a small backpack · 3 superhero costume with cape and mask · 4 football jersey and shorts · 5 party dress with a hair bow · 6 cozy pajamas holding a small pillow |
| `boy-stage3.png` | stage 3: child about 6 years, standing | 1 t-shirt, jeans and sneakers · 2 school uniform with a small backpack · 3 superhero costume with cape and mask · 4 football jersey and shorts · 5 mini blazer with a bow tie · 6 cozy pajamas holding a small pillow |
| `girl-stage4.png` | stage 4: child about 10 years, standing | 1 hoodie, joggers and sneakers · 2 school uniform with backpack · 3 summer beach outfit with sun hat · 4 elegant dress for a special day · 5 chunky knit winter sweater and scarf · 6 tennis outfit with a racket |
| `boy-stage4.png` | stage 4: child about 10 years, standing | 1 hoodie, joggers and sneakers · 2 school uniform with backpack · 3 summer beach outfit with sun hat · 4 smart shirt and trousers for a special day · 5 chunky knit winter sweater and scarf · 6 tennis outfit with a racket |

---

## 4. Ruh halleri: 2 görsel → `girl-moods.png`, `boy-moods.png`

```
Using the exact same [girl / boy] from the reference sheet, make a grid of 4 columns and 3 rows. Columns are the four ages from the reference sheet (baby sitting, toddler, 6 years, 10 years) in the same order. Rows are moods, all in the plain white outfit:
row 1: sleeping peacefully, eyes closed, head slightly tilted
row 2: eating happily, holding a spoon, cheeks full
row 3: a little sad, small tear, pouting
Same scale in every cell, nothing touching. Landscape image, 1536x1024.

Style: cute flat 2D vector illustration, kawaii chibi proportions (big head, small body), soft rounded shapes, clean thin dark-brown outlines, flat solid colors only. No gradients, no textures, no ground shadows, no text, no watermark. Warm pastel palette. Transparent background (PNG with alpha).
```

---

## 5. Yiyecekler → `food.png`

```
A grid of 4 columns and 3 rows with 12 separate food items, one per cell, same size, centered, nothing touching. In this order (left to right, top row first):
baby milk bottle, baby food jar with a spoon, red apple, banana, chocolate chip cookie, slice of pizza, slice of strawberry cake, carrot, bowl of soup, glass of orange juice, ice cream cone, sandwich.
Landscape image, 1536x1024.

Style: cute flat 2D vector illustration, kawaii style with tiny happy faces on the food, soft rounded shapes, clean thin dark-brown outlines, flat solid colors only. No gradients, no textures, no shadows, no text, no watermark. Warm pastel palette. Transparent background (PNG with alpha).
```

## 6. Oyuncaklar → `toys.png`

```
A grid of 3 columns and 2 rows with 6 separate toys, one per cell, same size, centered, nothing touching. In this order:
teddy bear, rubber duck, colorful stacking blocks, red ball, kite, picture book.
Landscape image, 1536x1024.

Style: cute flat 2D vector illustration, soft rounded shapes, clean thin dark-brown outlines, flat solid colors only. No gradients, no textures, no shadows, no text, no watermark. Warm pastel palette. Transparent background (PNG with alpha).
```

---

## 7. Oda: gündüz → `room-day.png`

```
A cozy child's bedroom interior, seen from the front, no people. Soft pastel walls, a big window with daylight and clouds, a small bed on the left, shelves with toys and books on the right, a plant, a round rug on the floor in the lower middle. Keep the center of the floor and the area above it empty and uncluttered, because the child will be placed standing there.
Portrait image, 1024x1536.

Style: flat 2D vector illustration, soft rounded shapes, clean thin dark-brown outlines, flat solid colors only. No gradients, no textures, no text, no watermark. Warm pastel palette. Full opaque background (this one is NOT transparent).
```

## 8. Oda: gece → `room-night.png`

```
The exact same bedroom as the previous image, at night: dark blue sky with stars and a moon through the window, a warm bedside lamp switched on, cozy and calm. Everything else in the same place, the center of the floor still empty.
Portrait image, 1024x1536.

Style: flat 2D vector illustration, soft rounded shapes, clean thin dark-brown outlines, flat solid colors only. No gradients, no textures, no text, no watermark. Full opaque background.
```

---

## 9. Doğum anı (leylek) → `stork.png`

```
A friendly white stork flying to the right, wings spread, carrying a small cloth bundle in its beak; a tiny pink-and-blue heart floats near the bundle. No baby visible, only the bundle.
Square image, 1024x1024.

Style: cute flat 2D vector illustration, soft rounded shapes, clean thin dark-brown outlines, flat solid colors only. No gradients, no textures, no shadows, no text, no watermark. Transparent background (PNG with alpha).
```

---

## Kontrol listesi (toplam 17 dosya)

- [ ] ref-girl.png
- [ ] ref-boy.png
- [ ] girl-stage1.png … girl-stage4.png
- [ ] boy-stage1.png … boy-stage4.png
- [ ] girl-moods.png
- [ ] boy-moods.png
- [ ] food.png
- [ ] toys.png
- [ ] room-day.png
- [ ] room-night.png
- [ ] stork.png
