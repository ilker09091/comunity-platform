"use client";
/**
 * "How it works" for the baby: what each action does, the daily limits, how growing, coins,
 * words and colds work. Written in both languages here (not via the page translator).
 */
import { useLang } from "@/lib/i18n";

type Row = { icon: string; title: [string, string]; text: [string, string]; tag?: [string, string] };

const CARE: Row[] = [
  { icon: "🍼", title: ["Feed", "Besle"], tag: ["3 a day each", "Günde 3 (kişi başı)"],
    text: ["Fills the tummy by 35%. +4 XP, +2 coins. Below 25% they get hungry and grow at half speed.",
      "Karnı %35 doyar. +4 XP, +2 altın. %25'in altına düşerse acıkır ve yarı hızda büyür."] },
  { icon: "🧸", title: ["Play", "Oyna"], tag: ["3 a day each", "Günde 3 (kişi başı)"],
    text: ["Happiness +25. +3 XP, +2 coins. More toys open up in the shop.",
      "Mutluluk +25. +3 XP, +2 altın. Dükkândan yeni oyuncaklar açılır."] },
  { icon: "🛁", title: ["Bath", "Banyo"], tag: ["2 a day each", "Günde 2 (kişi başı)"],
    text: ["Rub all the bubbles off to finish. +3 XP, +3 coins. Below 20% clean they get dirty and grumpy.",
      "Bitirmek için köpüklerin hepsini parmağınla sil. +3 XP, +3 altın. Temizlik %20'nin altına düşerse kirlenir, huysuzlaşır."] },
  { icon: "🌙", title: ["Sleep", "Uyut"], tag: ["once a day each", "Günde 1 (kişi başı)"],
    text: ["Energy fills up in about 8 hours. Waking them too early makes them grumpy; after 11 hours they wake up on their own. +3 XP, +3 coins.",
      "Enerji yaklaşık 8 saatte dolar. Erken uyandırırsan huysuz kalkar; 11 saat sonra kendiliğinden uyanır. +3 XP, +3 altın."] },
  { icon: "🤗", title: ["Hug", "Sarıl"], tag: ["any time", "Sınırsız"],
    text: ["Happiness +4. If you both hug within 5 minutes it's a family hug: +15 XP, +20 coins and +15 happiness.",
      "Mutluluk +4. İkiniz 5 dakika içinde sarılırsanız aile sarılması olur: +15 XP, +20 altın ve +15 mutluluk."] },
  { icon: "💬", title: ["Chat", "Sohbet"], tag: ["10 a day each", "Günde 10 (kişi başı)"],
    text: ["Messages you send each other count too: +1 XP and +1 coin each, and they cheer the baby up a little.",
      "Birbirinize attığınız mesajlar da sayılır: her biri +1 XP, +1 altın ve bebeği biraz mutlu eder."] },
  { icon: "🎮", title: ["Games", "Oyunlar"], tag: ["2 a day each", "Günde 2 (kişi başı)"],
    text: ["Finishing a chat game together: +5 XP, +5 coins.",
      "Sohbette birlikte bir oyunu bitirmek: +5 XP, +5 altın."] },
];

const MORE: Row[] = [
  { icon: "💞", title: ["Both of you", "İkiniz birlikte"],
    text: ["On a day you both look after the baby you get a bonus: +10 XP and +10 coins.",
      "Aynı gün ikiniz de bebekle ilgilenince bonus gelir: +10 XP ve +10 altın."] },
  { icon: "🌱", title: ["Growing up", "Büyüme"],
    text: ["Baby → Toddler at 800 XP, Child at 2,000, Big kid at 4,500. Every new stage gives +100 coins and a memory.",
      "Bebek → 800 XP'de Yürümeye başlayan, 2.000'de Çocuk, 4.500'de Büyük çocuk olur. Her yeni aşamada +100 altın ve bir anı."] },
  { icon: "🤒", title: ["Catching a cold", "Hastalanma"],
    text: ["If the tummy reaches 0 while they're very dirty or very sad, they catch a cold. Each of you gives one dose of medicine and they're better; a single dose works after 12 hours.",
      "Karnı 0'a inip çok kirli ya da çok üzgünse hastalanır. İkiniz birer doz ilaç verince iyileşir; tek doz da 12 saat sonra iyileştirir."] },
  { icon: "🗣️", title: ["Words", "Kelimeler"],
    text: ["From the Toddler stage they pick up words from your chat (love words first) and say a first word. Each of you can also teach 3 words a day.",
      "Yürümeye başlayan aşamasından itibaren sohbetinizden kelime kapar (önce sevgi sözcükleri) ve ilk kelimesini söyler. Ayrıca her biriniz günde 3 kelime öğretebilir."] },
  { icon: "🪙", title: ["Coins & shop", "Altın ve dükkân"],
    text: ["Coins go into one shared piggy bank. Spend them on toys, wallpapers, decorations and a photo frame for the room.",
      "Altınlar ortak kumbaraya gider. Oyuncak, duvar kâğıdı, süs ve odaya fotoğraf çerçevesi almak için harca."] },
  { icon: "👆", title: ["Touch", "Dokun"],
    text: ["Tap the head for a pat, the tummy to tickle, the nose for a sneeze and the feet for a kick. Don't poke too much!",
      "Başına dokun okşa, karnına dokun gıdıkla, burnuna dokun hapşırsın, ayağına dokun tekmelesin. Çok dürtme ama!"] },
  { icon: "🏡", title: ["Places", "Mekânlar"],
    text: ["Walk between the room, kitchen, bathroom, garden and park. When you're both in, you see each other and can send hearts and waves.",
      "Oda, mutfak, banyo, bahçe ve park arasında gez. İkiniz aynı anda içerideyseniz birbirinizi görür, kalp ve el sallama gönderebilirsiniz."] },
  { icon: "📖", title: ["Memories", "Anılar"],
    text: ["Birth, new stages, first words and new things in the room are saved in your memory book (under Us).",
      "Doğum, yeni aşamalar, ilk kelimeler ve odaya gelen yenilikler anı defterine kaydedilir (Biz menüsünde)."] },
];

export function BabyGuide() {
  const i = useLang() === "tr" ? 1 : 0;
  const list = (rows: Row[]) => (
    <ul className="dm-baby-guide-list">
      {rows.map((r) => (
        <li key={r.title[0]}>
          <span className="dm-baby-guide-icon" aria-hidden="true">{r.icon}</span>
          <div>
            <strong>{r.title[i]}{r.tag && <em>{r.tag[i]}</em>}</strong>
            <p>{r.text[i]}</p>
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="dm-baby-guide" translate="no">
      <p className="dm-baby-guide-lead">
        {i
          ? "Bebeğiniz birlikte bakınca büyür. Asla ölmez; ihmal edilirse sadece yavaş büyür. Limitler her gün sıfırlanır."
          : "Your baby grows when you look after them together. They never die; if forgotten they just grow slower. Limits reset every day."}
      </p>
      <h3 className="dm-set-label">{i ? "Bakım" : "Care"}</h3>
      {list(CARE)}
      <h3 className="dm-set-label">{i ? "Bilmen gerekenler" : "Good to know"}</h3>
      {list(MORE)}
    </div>
  );
}
