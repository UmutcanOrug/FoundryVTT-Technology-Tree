# Research Tech Tree

Research Tech Tree, Foundry Virtual Tabletop v13 dünyalarında ülkelerin, araştırma tesislerinin ve kişisel araştırmaların teknoloji geliştirmesini yönetir. Dinamik teknoloji kategorileri, ön koşullu teknoloji ağaçları, haftalık projeler, SWADE karakter skill zarları ve araştırma bonus/cezaları aynı çalışma alanında yönetilir.

## Uyumluluk

- Foundry Virtual Tabletop: v13
- Minimum sürüm: 13
- Doğrulanan sürüm: 13.351
- Modül sürümü: 0.1.5
- Oyun sistemi: SWADE (karakter skilli zar modu için)
- Zorunlu modül bağımlılığı: yok

Modül native ES modules, ApplicationV2, Handlebars, Foundry settings, module socket, File Picker, Roll ve ChatMessage API'lerini kullanır. Harici CDN veya UI framework kullanmaz.

## Kurulum

### Yerel Foundry kurulumu

1. Foundry'yi kapatın.
2. Foundry kullanıcı veri dizininizdeki `Data/modules` klasörünü açın.
3. Burada `research-tech-tree` adlı bir klasör oluşturun.
4. Dağıtım ZIP'inin içeriğini bu klasöre çıkarın. Sonuçta dosya yolu `Data/modules/research-tech-tree/module.json` olmalıdır; arada ikinci bir `research-tech-tree` klasörü bulunmamalıdır.
5. Foundry'yi başlatın ve hedef dünyayı açın.
6. **Game Settings → Manage Modules** altında **Research Tech Tree** modülünü etkinleştirin.
7. İstendiğinde dünyayı yeniden yükleyin.

### Geliştirme klasöründen kurulum

Bu repository içindeki `research-tech-tree` klasörünü Foundry'nin `Data/modules/research-tech-tree` konumuna kopyalayabilir veya geliştirme sırasında bu konuma bir dizin bağlantısı oluşturabilirsiniz. Foundry yeniden başlatıldığında modül, Manage Modules listesinde görünür.

### The Forge

- Yayınlanmış bir manifest URL'niz varsa Forge'daki **Bazaar → Custom Modules** alanından bu URL'yi kullanın.
- Yerel/özel bir yapı kullanıyorsanız Forge **Import Wizard** üzerinden oluşturulan ZIP'i özel modül olarak yükleyin.
- Yükleme sonrasında dünya yapılandırmasında modülü etkinleştirip dünyayı yeniden başlatın.

ZIP'in kökünde `module.json` bulunmalıdır. `npm run package` komutu bu yerleşime uygun bir arşiv üretir.

## Pencereyi açma

Varsayılan kısayol `L` tuşudur. Aynı tuşa yeniden basmak pencereyi kapatır. Bir input, textarea veya düzenlenebilir metin alanına yazarken kısayol devreye girmez.

Kısayolu değiştirmek için:

1. **Game Settings → Configure Controls** ekranını açın.
2. **Research Tech Tree** grubunu bulun.
3. **Toggle Research Tree** eylemine istediğiniz tuşu atayın.

Modül API'si de aynı pencere örneğini yönetir:

```js
game.modules.get("research-tech-tree").api.open();
game.modules.get("research-tech-tree").api.close();
game.modules.get("research-tech-tree").api.toggle();
```

## Çalışma alanı

Pencere dört ana bölüme ayrılır:

- Üst araç çubuğu mevcut haftayı, seçili araştırma kaydını, zoom bilgisini ve GM işlemlerini gösterir.
- Sol panel ülkeleri, araştırma tesislerini ve kişisel araştırmaları ayrı listeler; arama alanı ve kayıt özetleri sağlar.
- Orta alan Genel Bilgi sayfasını veya seçili kategorinin teknoloji ağacını gösterir.
- Sağ panel seçili teknolojinin ön koşullarını, maliyetini, ilerlemesini, çalışanlarını, mühendislerini ve modifierlarını gösterir.

Teknoloji ağacı boş alandan sürüklenerek kaydırılabilir, mouse tekerleğiyle yakınlaştırılabilir ve **Fit to View** ile görünür düğümlere sığdırılabilir. Teknoloji durumları renk yanında ikon, çerçeve ve metin etiketiyle de ayrılır.

## İlk araştırma kaydını oluşturma

Kalıcı katalog değişiklikleri yalnızca GM tarafından yapılır.

1. `L` ile pencereyi açın.
2. **Düzenleme Modu**nu etkinleştirin.
3. Veri yoksa ilk kayıt çağrısını, aksi hâlde entity ekleme düğmesini kullanın.
4. Tür olarak **Country**, **Research Facility** veya **Personal Research** seçin.
5. İsim, kullanılacak SWADE araştırma skillini, raise başına kazanılacak araştırma puanını, açıklama, rol yapma bilgisi, temel çalışan puanı ve aynı anda yürütülebilecek proje sayısını girin.
6. İkon ve banner için Foundry File Picker'ı kullanın.
7. Herkese açık veya yalnızca seçili kullanıcılara açık görünürlüğü belirleyin.
8. Kaydedin.

Sol listedeki kayıtlar düzenleme modunda yeniden sıralanabilir. Silme gibi geri alınması zor işlemler onay ister.

## Kategori oluşturma

1. Sol listeden bir ülke veya tesis seçin.
2. Düzenleme modunda kategori yönetimini açın.
3. İsim, ikon ve açıklama girin.
4. Kategorinin gösterileceği ülke/tesisleri seçin.
5. Kaydedin ve kategori sekmelerini istediğiniz sıraya taşıyın.

`Overview`/`Genel Bilgi` sekmesi her zaman ilk sıradadır. Teknoloji kategorileri bu sekmeden sonra gelir ve pencereye sığmadıklarında yatay kaydırılır.

İçinde teknoloji bulunan bir kategori silinirken teknolojileri başka kategoriye taşıma seçeneği sunulur.

## Teknoloji oluşturma ve bağlama

1. Entity ve kategori seçiliyken düzenleme moduna girin.
2. Teknoloji ekleme eylemini kullanın.
3. İsim, ikon, açıklama ve Research Point maliyetini girin.
4. Görünürlüğü belirleyin:
   - `public`: İzinli oyuncular her durumda görebilir.
   - `hidden`: Yalnızca GM görür.
   - `secretUntilAvailable`: Ön koşulları tamamlanana kadar oyuncu görünümüne eklenmez.
5. Etiketleri ve varsa tamamlanınca etkinleşecek/devre dışı kalacak modifierları seçin.
6. Aynı entity içindeki teknolojilerden ön koşulları seçin. Ön koşul başka bir kategoride olabilir.
7. Kaydedin.

Dairesel bağımlılıklar kaydedilmez. Kartlar düzenleme modunda sürüklenebilir; yeni koordinat drag bittiğinde world verisine yazılır ve diğer bağlı istemcilere yansır.

Bir teknolojinin sağ panelde listelenen ön koşulları bağlantı olarak çalışır. Ön koşul adına tıklandığında modül gerekirse kategori sekmesini değiştirir ve ilgili teknolojiyi doğrudan açar.

## Araştırma projesi başlatma

Bir teknoloji şu koşullarda başlatılabilir:

- Henüz tamamlanmamıştır.
- Aynı teknoloji için başka aktif proje yoktur.
- Bütün zorunlu ön koşulları tamamlanmıştır.
- Entity aktif proje sınırına ulaşmamıştır.
- İşlemi yapan kullanıcı GM'dir.

Teknolojiyi seçip sağ paneldeki **Start Research** düğmesini kullanın. Proje başladıktan sonra çalışan sayısı, iki baş mühendis yuvası, duraklatma, iptal ve manuel ilerleme düzeltmesi aynı panelden yönetilir. Çalışan sayısı sıfır veya pozitif tam sayı olmalıdır.

## Baş araştırmacı atama ve zar atma

Her projede iki baş araştırmacı yuvası vardır. Araştırmacılar Foundry Actor UUID'siyle saklanır. Actor sonradan silinirse proje korunur ve ilgili yuva **Missing Actor** olarak gösterilir.

Bir mühendis zarını:

- GM,
- Atanmış Actor üzerinde Owner yetkisi bulunan kullanıcı

atabilir. Her proje, mühendis yuvası ve hafta için yalnızca bir sonuç kaydedilir. Oyuncu isteği aktif GM'ye modül socket'i üzerinden iletilir; GM proje, hafta, slot, Actor eşleşmesi ve sahipliği yeniden doğrular.

Varsayılan zar modu `swadeSkill`dır. Kuruluşta seçilen skill hem SWID hem görünen skill adıyla saklanır; zar anında atanmış baş araştırmacının kendi karakter kağıdındaki embedded Skill öğesi kesin ad, SWID ve geriye uyumlu slug eşleştirmesiyle bulunur. Ardından SWADE `Actor.rollSkill` akışı kullanılır ve dönen `TraitRoll`, toplam okunmadan önce değerlendirilir. Böylece Trait Die, Wild Die, ace ve skill üzerindeki `+1` gibi SWADE değiştiricileri uygulanır; özel isimli veya standart olmayan SWID kullanan custom skiller de desteklenir.

SWADE sonucunda hedef sayı 4'tür ve hedef üzerindeki her tam 4 puan bir raise sayılır: 4–7 arası başarı ve 0 raise, 8–11 arası başarı ve 1 raise, 12–15 arası başarı ve 2 raise üretir. Kazanılan araştırma puanı `başarı AP'si + (raise sayısı × raise başına AP)` olarak hesaplanır. Başarı AP'si ve raise başına AP her ülke, araştırma tesisi veya kişisel araştırma için ayrı ayrı ayarlanabilir. Sonuç; araştırmacı, proje, teknoloji, hafta, başarı durumu, raise ve kazanılan puan bilgileriyle proje ekranına ve sohbet mesajına yazılır.

İlk SWADE zarı kaydedildikten sonra araştırmacının Benny'si varsa proje kartında **Benny ile Yeniden At** düğmesi görünür. İşlem bir Benny harcar, SWADE'nin Benny yeniden atış modifierlarını uygular ve eski sonuçla yeni sonuçtan yüksek olanı araştırma kaydında tutar. Birden fazla Benny kullanılabilir; son yeniden atış ve korunan en iyi sonuç kartta gösterilir.

Eski dünyalardaki dokunulmamış `1d20` varsayılanı otomatik taşınır; özellikle özelleştirilmiş Formula, Manual ve System Adapter seçenekleri korunur. `resultBands` yalnızca bu diğer zar modlarının sonuç dönüşümü için kullanılmaya devam eder.

`resultBands` seçildiğinde zar toplamı GM'nin yapılandırdığı aralığa göre araştırma puanına çevrilir.

## Haftayı ilerletme

Yalnızca GM **Advance Week / Haftayı İlerlet** eylemini kullanabilir.

1. Mevcut haftadaki aktif ve duraklatılmamış projeler toplanır.
2. Atanmış fakat zar atmamış mühendisler varsa GM'ye üç seçenek sunulur:
   - Eksik sonuçları 0 kabul et ve devam et.
   - Eksik zarları otomatik at.
   - İşlemi iptal et.
3. Çalışanların pasif puanı hesaplanır.
4. Pasif, mühendis ve haftalık toplam modifierları deterministik sırada uygulanır; ondalık sonuçlar aşağı yuvarlanır ve toplam negatif olamaz.
5. Progress güncellenir ve tamamlanan teknolojiler belirlenir.
6. Tamamlanma ödülleri modifierları etkinleştirir veya devre dışı bırakır.
7. Haftalık özet geçmişe ve sohbete yazılır.
8. Bütün işlemler başarıyla kaydedildikten sonra hafta bir artar.

Geçmiş varsayılan olarak son 100 haftayla sınırlıdır; limit modül yapılandırmasından değiştirilebilir.

GM üst araç çubuğundaki **Haftayı Sıfırla** düğmesiyle sayacı yeniden 1. haftaya alabilir. Bu işlem aktif projelerin haftalık zarlarını ve işlenmiş hafta geçmişini temizler; mevcut proje ilerlemesini, tamamlanmış teknolojileri ve katalog verisini korur. İşlem uygulanmadan önce açıklayıcı bir onay gösterilir.

## Buff ve debuff oluşturma

Modifier yönetiminde şu alanlar kullanılır:

- Operation: `add` veya `multiply`
- Target: pasif puan, mühendis puanı, haftalık toplam, çalışan verimliliği veya araştırma maliyeti
- Scope: tüm araştırmalar, kategori, teknoloji, etiket veya proje
- Süre: isteğe bağlı başlangıç ve bitiş haftası

Çarpanlarda `1.20` yüzde 20 bonusu, `0.75` yüzde 25 cezayı ifade eder. Toplama modifierında pozitif değer bonus, negatif değer ceza üretir. Modifierlar Overview ekranında açıklama ve kaynaklarıyla bonus/ceza olarak gösterilir.

Bir teknoloji tamamlandığında `onComplete` alanındaki modifierlar otomatik olarak etkinleştirilebilir veya devre dışı bırakılabilir.

## İzinler ve çok oyunculu kullanım

GM bütün entity ve teknolojileri görür, katalog ve proje durumunu değiştirir, haftayı ilerletir, modifierları yönetir ve import/export yapar.

Oyuncular:

- `public` entityleri görebilir.
- Özel entityleri yalnızca `allowedUserIds` listesinde bulunuyorsa görebilir.
- Kendilerine görünür teknolojileri inceleyebilir.
- Owner oldukları atanmış Actor için mühendis zarı isteyebilir.
- Kalıcı katalog/proje verisini veya haftayı doğrudan değiştiremez.

World setting değişiklikleri bağlı istemcilere Foundry tarafından iletilir. Oyuncu zarları için yalnızca seçilmiş aktif GM kalıcı sonuç yazar; tekrar eden request ve aynı hafta/slot için ikinci roll uygulanmaz.

## Import ve export

GM, üst araç çubuğunda seçili ülke, araştırma tesisi veya kişisel araştırmayı **Seçili Teknoloji Ağacını Dışa Aktar** düğmesiyle tek başına indirebilir. Bu taşınabilir ağaç dosyası kuruluşu, kategorilerini, teknolojilerini, ön koşullarını ve modifier bağlantılarını içerir; devam eden projeleri, ilerlemeyi, zar geçmişini veya tamamlanma durumunu içermez.

**Teknoloji Ağacı Ekle** ile içe aktarma sırasında:

1. Dosya okunur ve JSON yapısı doğrulanır.
2. Dosyanın tam olarak bir kuruluş ağacı içerdiği doğrulanır.
3. Entity, kategori, teknoloji ve modifier ID'leri yeniden üretilir; ön koşullar, ödüller ve scope bağlantıları yeni ID'lere taşınır.
4. Mevcut world verisinin otomatik yedeği indirilir.
5. GM onayı alındıktan sonra ağaç mevcut katalog silinmeden eklenir.

Parse, doğrulama veya ID/reference hatasında mevcut world verisi değiştirilmez. Aynı ağaç tekrar içe aktarılırsa bağımsız yeni ID'lerle ikinci bir kopya oluşturulur; aynı isim varsa ayırt edici “İçe Aktarıldı” eki kullanılır. Başarılı import sonrasında eklenen ağaç seçilir ve açık pencereler yeni veriyi gösterir.

Araç çubuğundaki **Tam Yedeği Dışa Aktar** bütün katalog, proje durumu, geçmiş ve yapılandırmayı saklar. **Tam Yedeği Geri Yükle** ise açıkça ayrı ve yıkıcı bir işlemdir; mevcut dünya verisini seçilen tam yedekle değiştirir. Böylece günlük tek-ağaç aktarımı ile tam dünya kurtarma akışı birbirine karışmaz.

## Veri saklama ve yedekleme

Katalog, araştırma durumu, module config ve schema version world-scoped Foundry settings içinde saklanır. Son seçili entity, aktif sekmeler ve pan/zoom görünümü client-scoped ayarda tutulur.

Önemli dünya değişikliklerinden ve özellikle modül güncellemesinden önce Foundry dünya yedeği alınması önerilir. Tam JSON yedeği bütün modül verisini saklar; tek-ağaç export dosyası ise yeni veya mevcut bir dünyaya eklenebilen taşınabilir bir teknoloji ağacıdır.

## Geliştirme

Node tabanlı saf mantık testlerini çalıştırmak için:

```powershell
npm test
```

Kurulabilir ZIP oluşturmak için:

```powershell
npm run package
```

Varsayılan çıktı:

```text
research-tech-tree-v0.1.5.zip
```

Paket komutu gerekli manifest girişlerini kontrol eder, yalnızca runtime/dokümantasyon dosyalarını ZIP'e ekler ve SHA-256 özetini ekrana yazar.

## Mimari

Ana sorumluluklar ayrı ES module katmanlarında tutulur:

- `scripts/main.mjs`: Foundry `init` ve `ready` yaşam döngüsü.
- `scripts/store/`: world settings, normalizasyon, doğrulama, migration ve seri yazım kuyruğu.
- `scripts/services/`: proje, hafta, roll, modifier, izin, socket ve import/export kuralları.
- `scripts/app/`: ApplicationV2 çalışma alanı ve dialoglar.
- `scripts/utils/`: saf doğrulama ve teknoloji grafiği yardımcıları.
- `templates/`: Handlebars uygulama parçaları ve formlar.
- `styles/`: pencere, teknoloji ağacı, durum ve responsive stiller.
- `lang/`: İngilizce ve Türkçe localization.

UI kalıcı veriye doğrudan `game.settings.set` çağrısı yapmaz; bütün değişiklikler `ResearchStore` ve ilgili service katmanından geçer.

## Manuel doğrulama listesi

Testleri temiz bir Foundry v13.351 dünyasında, bir GM ve en az bir oyuncu istemcisiyle gerçekleştirin.

### Yükleme ve pencere

- Modülü etkinleştirin; konsolda module kaynaklı hata olmadığını doğrulayın.
- `L` ile pencereyi açıp kapatın.
- Art arda açma denemelerinde ikinci pencere oluşmadığını doğrulayın.
- Bir metin alanına yazarken `L` tuşunun pencereyi değiştirmediğini doğrulayın.
- Configure Controls üzerinden kısayolu değiştirin.

### Katalog ve ağaç

- Bir ülke ve bir araştırma tesisi oluşturun.
- İki entity için farklı kategori ve teknoloji ağaçları oluşturun.
- Kategori sekmelerini ve sol listedeki entityleri yeniden sıralayın.
- File Picker ile entity ve teknoloji ikonlarını değiştirin.
- Başka kategorideki bir teknolojiyi ön koşul olarak atayın.
- A↔B döngüsü oluşturmayı deneyin ve kaydın reddedildiğini doğrulayın.
- Kartı sürükleyip bırakın; sayfayı yenileyince konumun korunduğunu kontrol edin.
- İkinci istemcide kart koordinatının güncellendiğini doğrulayın.
- Pan, zoom ve Fit to View işlemlerini büyük bir ağaçta deneyin.

### Görünürlük ve izinler

- Public ve private entityleri oyuncu hesabıyla kontrol edin.
- `hidden` teknolojinin oyuncu DOM'una eklenmediğini doğrulayın.
- `secretUntilAvailable` teknolojinin ön koşul tamamlanınca göründüğünü kontrol edin.
- Oyuncunun GM düğmelerini görmediğini ve world verisini değiştiremediğini doğrulayın.

### Proje ve zarlar

- Ön koşulu eksik teknolojiyi başlatmayı deneyin.
- Araştırılabilir teknoloji için proje başlatın.
- Çalışan sayısını değiştirin ve negatif/kesirli değerin kabul edilmediğini doğrulayın.
- İki farklı Actor'u mühendis yuvalarına atayın.
- Owner oyuncuyla bir zar atın; aynı hafta aynı slotta ikinci zarın reddedildiğini kontrol edin.
- Yetkisiz oyuncuyla zar isteği deneyin.
- Atanmış Actor'u silin ve projenin bozulmadan Missing Actor gösterdiğini doğrulayın.

### Hafta ve modifierlar

- Eksik mühendis zarı varken haftayı ilerletin ve üç seçeneğin de doğru davrandığını test edin.
- Pasif puan, mühendis puanı, toplama ve çarpma modifierlarını bilinen sayılarla karşılaştırın.
- Negatif haftalık sonucun sıfıra sınırlandığını doğrulayın.
- Teknolojiyi tamamlayın; completion haftasını, yeni açılan teknolojiyi, bildirimi ve sohbet mesajını kontrol edin.
- Completion ödülünün ilgili modifierı etkinleştirdiğini/devre dışı bıraktığını doğrulayın.
- Overview ekranında son hafta özetini ve buff/debuff açıklamalarını kontrol edin.

### Kalıcılık ve aktarım

- Sayfayı yenileyin ve bütün katalog/proje verisinin korunduğunu doğrulayın.
- Seçili ağacı dışa aktarın; başka ağaçların bulunduğu dünyaya içe aktarıp mevcut ağaçların korunarak yeni ağacın eklendiğini doğrulayın.
- Tam yedek dışa aktarıp ayrı **Tam Yedeği Geri Yükle** akışıyla geri yükleyin.
- Bozuk JSON ve geçersiz referanslı import deneyin; mevcut verinin değişmediğini kontrol edin.
- Geçmiş limitini düşürüp eski kayıtların sınırlandığını doğrulayın.
- Foundry dilini İngilizce ve Türkçe yaparak görünen metinleri kontrol edin.
- Modülü devre dışı bırakıp dünyanın geri kalanında module kaynaklı hata kalmadığını doğrulayın.

## Bilinen sınırlar

- Mobil arayüz birincil hedef değildir; düşük çözünürlükte kullanılabilir düzen korunur ancak geniş ekran önerilir.
- Kalıcı katalog world-scoped settings içinde tutulduğu için teknoloji gizliliği oyuncu arayüzü ve DOM filtrelemesi düzeyindedir; world verisine geliştirici konsolundan erişebilen kötü niyetli bir istemciye karşı sunucu tarafı sır saklama sağlamaz.
- Native module socket iş akışı kalıcı yazımı aktif GM'ye bırakır; internet bağlantısı kesilen istemci isteğini yeniden göndermek zorunda kalabilir.

## Lisans

Research Tech Tree, [MIT License](LICENSE) koşullarıyla dağıtılır.
