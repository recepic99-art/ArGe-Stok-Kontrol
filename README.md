# Ar-Ge Numune Depo

GitHub Pages üzerinde çalışan ve ortak veriyi Firebase Realtime Database'de
saklayan stok takip uygulamasıdır.

## Firebase düzeni

- Kullanıcı hesapları Firebase Authentication tarafından yönetilir.
- Stok listeleri, hareketler, kategori/kılıf tanımları ve kullanıcı profilleri
  Realtime Database'de ortaktır.
- Kullanıcı profilleri `appState/userDirectory` altında tutulur.
- Yetkilerin tek kaynağı `appState/rolesByUid` düğümüdür.
- İlk kullanıcı yönetici, sonraki kullanıcılar üye olarak oluşturulur.
- Yönetici Kullanıcılar panelinden kullanıcı rollerini değiştirebilir.
- Üyeler mevcut malzemelerden yalnızca çıkış yapabilir.
- Kategori ve kılıf tanımlarını yalnızca yöneticiler düzenleyebilir.

## Güvenlik

`firebase-database-rules.json` kuralları şu ayrımı uygular:

- Oturum açmış kullanıcılar stok ve hareket verilerini kullanabilir.
- Kategori ve kılıf tanımlarını yalnızca yöneticiler yazabilir.
- Her kullanıcı yalnızca kendi profilini yazabilir.
- Kullanıcı rollerini yalnızca yönetici değiştirebilir.
- Eski bir tarayıcı oturumu kullanıcı dizininin tamamını ezemez.

## GitHub Pages güncellemesi

1. Bu klasördeki `index.html`, `firebase-store-v4.js`,
   `firebase-database-rules.json` ve `assets` klasörünü GitHub deposundaki aynı
   yolların üzerine yükleyin.
2. Değişiklikleri doğrudan `main` dalına kaydedin.
3. Firebase Realtime Database kurallarını `firebase-database-rules.json`
   içeriğiyle güncelleyin. Bu adım yapılmazsa kategori tanımları kaydedilemez.
4. Uygulamada yönetici hesabıyla `Dosya > JSON içe aktar` yolunu kullanıp
   `arge-numune-depo-yedek-2026-08-10-combobox.json` dosyasını bir kez aktarın.
5. GitHub Pages yayımlaması tamamlandıktan sonra sayfayı `Ctrl+F5` ile yenileyin.

`index.html` içindeki dosya sürüm etiketleri tarayıcı önbelleğini yeniler.

## Yerel çalışma

`Web_Demoyu_Baslat.cmd` dosyasını çalıştırın veya bu klasörde bir HTTP sunucusu
başlatın. Uygulama doğrudan `file://` adresinden açılmamalıdır.
