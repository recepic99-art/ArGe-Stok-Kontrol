# Ar-Ge Numune Depo

GitHub Pages üzerinde çalışan ve ortak veriyi Firebase Realtime Database'de
saklayan stok takip uygulamasıdır.

## Firebase kurulumu

1. Firebase Console > Authentication > Sign-in method bölümünde
   `Email/Password` sağlayıcısını etkinleştirin.
2. Realtime Database > Rules bölümüne `firebase-database-rules.json`
   dosyasının içeriğini yapıştırıp Publish düğmesine basın.
3. İlk kullanıcı giriş ekranındaki Kaydol sekmesinden hesabını oluşturur.
4. Firebase veritabanı boşsa mevcut 167 malzemelik başlangıç listesi otomatik
   olarak yüklenir.

Kullanıcılar e-posta yazmaz. Uygulama, kullanıcı adını Firebase'in istediği
teknik e-posta kimliğine arka planda dönüştürür.

## Veri düzeni

- Kullanıcı profilleri, listeler, stok kartları ve hareketler Firebase'de ortaktır.
- Şifreler Firebase Authentication tarafından saklanır.
- Tema, açık sekmeler ve panel ölçüleri her tarayıcıda ayrı tutulur.
- JSON içe/dışa aktarma yedekleme amacıyla kullanılabilir.

## GitHub Pages

Depo ayarlarında Settings > Pages > Deploy from a branch seçin. `main` dalı
ve `/(root)` klasörüyle yayınlayın.
