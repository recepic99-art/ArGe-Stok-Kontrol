# Ar-Ge Numune Depo Web Demo

Bu klasör, v17 masaüstü uygulamasına dokunmadan hazırlanmış yerel web demosudur.

## Açma

`Web_Demoyu_Baslat.cmd` dosyasına çift tıklayın. Yerel adres Chrome veya Edge'de otomatik açılır.

İlk ekranda:

1. Var olan `.json` dosyasını açın veya `Yeni JSON Oluştur` ile bir dosya oluşturun.
2. Kullanıcı adı ve şifrenizle giriş yapın.

Demo hesabı:

- Kullanıcı adı: `recep`
- Şifre: `demo123`

## Veri

- Ana veri kaynağı kullanıcının seçtiği `.json` dosyasıdır.
- Kullanıcılar, şifreler, listeler, malzemeler, hareketler ve görünüm ayarları bu dosyada tutulur.
- Yapılan değişiklikler aynı JSON dosyasına otomatik yazılır.
- Dosya bağlantısı tarayıcı tarafından hatırlanır. Tarayıcı yeniden izin isterse giriş ekranındaki `JSON Dosyası Aç` düğmesine basılır.
- `Dosya > JSON dışa aktar` ile tam yedek alınabilir.
- `Dosya > JSON içe aktar` ile alınan yedeğe dönülebilir.
- Aktif stok tablosu `Dosya > Aktif tabloyu CSV aktar` ile Excel'in açabileceği CSV dosyasına çevrilebilir.

## Demo kapsamı

- Giriş ve kayıt
- Ortak liste grubu ve birden fazla liste
- Aynı anda birden fazla liste sekmesi
- Stok kartı ekleme, düzenleme ve silme
- Checkbox ile toplu seçim
- Toplu giriş/çıkış ve hareket geçmişi
- Kritik stok için kırmızı, yaklaşan stok için sarı satır işareti
- Yazım hatasına toleranslı arama
- Sütun görünürlüğü, sıralama ve sürükleyerek sütun taşıma
- Aydınlık ve karanlık tema
- JSON yedek, CSV aktarım ve temel BOM CSV/TXT işlemi
- Kaydedilen panel boyutları

Bu sürümde gerçek sunucu veya merkezi veritabanı yoktur. Aynı JSON dosyasını ağ klasöründen iki kişi aynı anda açarsa son kaydeden kişinin verisi diğer değişikliği ezebilir.
