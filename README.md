# Ar-Ge Numune Depo

GitHub Pages üzerinde çalışan, ortak veriyi Firebase Realtime Database'de
saklayan esnek liste ve stok takip uygulamasıdır.

## Erişim düzeni

- Uygulama açılırken kullanıcıdan hesap veya parola istemez. Firebase
  Authentication arka planda anonim bir oturum açar.
- Günlük işlemlerde hareket kaydına yazılacak ad, tarayıcıda yerel olarak tutulur.
- Liste, kart ve sütun düzenleme gibi yönetici işlemlerinde yönetici parolası
  istenir.
- Doğru parola girildiğinde yönetici modu 15 dakika açık kalır. Her yönetici
  işlemi süreyi yeniden başlatır.
- Yönetici modu kapatıldığında uygulama tekrar anonim Firebase oturumuna döner.
- Yönetici parolası kaynak kodunda veya Realtime Database'de tutulmaz; Firebase
  Authentication hesabı tarafından doğrulanır.

Yönetici e-posta adresi ve süre `assets/js/firebase-config.js` içindeki
`DepoAccessConfig` nesnesinden değiştirilebilir. Parola bu dosyaya yazılmaz.

## Firebase kurulumu

Firebase Console > Authentication > Sign-in method bölümünde iki sağlayıcı açık
olmalıdır:

1. Anonymous
2. Email/Password

`DepoAccessConfig.administratorEmail` ile aynı e-posta adresine sahip tek bir
Firebase Authentication hesabı yönetici hesabıdır. Realtime Database Rules
bölümüne `firebase-database-rules.json` içeriği uygulanmalıdır.

## Esnek listeler

- Her liste kendi sütun düzenini taşır; bir listedeki değişiklik diğer listeleri
  etkilemez.
- Yönetici `Düzen > Tanımlamalar` bölümünden sütun ekleyebilir, yeniden
  adlandırabilir veya silebilir.
- Sütun tipi metin, uzun metin, sayı, tarih, checkbox ya da combobox olabilir.
- Combobox seçenekleri aynı ekranda tanımlanır. Kategori ve kılıf da normal
  combobox sütunlarıdır; ayrı katalog tutulmaz.
- Sütun şeması, kayıtlar ve hareket geçmişi Firebase'de ortaktır.

## Güvenlik sınırı

Bu sürüm yedi kişilik şirket içi kullanım için sade tutulmuştur. Yönetici kapısı
normal kullanıcıların arayüzden tanım ve kart değiştirmesini engeller. Mevcut
Firebase veri yapısında listeler dizi halinde saklandığı için teknik bilgisi olan
bir kişi doğrudan Firebase API çağrısıyla arayüz kapısını aşabilir. Tam sunucu
taraflı yetkilendirme gerekirse verinin kayıt bazında ayrılması veya PHP/Cloud
Function gibi bir API katmanı eklenmesi gerekir.

Kurallardaki `users`, `userDirectory` ve `rolesByUid` yazma yasakları yalnız eski
sürümlerin bıraktığı alanların tekrar değiştirilmesini önler; uygulama bu alanları
okumaz veya üyelik amacıyla kullanmaz.

## Veri kaynağı

GitHub Pages yalnız uygulama dosyalarını yayınlar. Canlı listeler, stok miktarları
ve hareket geçmişi Firebase Realtime Database içinde tutulur; depoda ayrıca stok
JSON'u veya başlangıç verisi bulundurulmaz. JSON dışa aktarma yalnız kullanıcı
tarafından alınan yedek içindir.

## GitHub Pages güncellemesi

1. `index.html`, `firebase-store-v4.js`, `firebase-database-rules.json` ve
   `assets` klasörünü GitHub deposundaki aynı yolların üzerine yükleyin.
2. Değişiklikleri `main` dalına kaydedin.
3. Firebase kurallarını güncel dosyayla eşitleyin.
4. GitHub Pages yayımlandıktan sonra uygulama sayfasını bir kez zorla yenileyin.

## Yerel çalışma

`Web_Demoyu_Baslat.cmd` dosyasını çalıştırın veya klasörde bir HTTP sunucusu
başlatın. Uygulama doğrudan `file://` adresinden açılmamalıdır.
