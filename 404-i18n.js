(() => {
  'use strict';

  const messages = {
    en: ['Page not found', 'This link may be outdated, or the page may have moved.', 'Back to home'],
    es: ['Página no encontrada', 'Puede que el enlace esté desactualizado o que la página haya cambiado de dirección.', 'Volver al inicio'],
    fr: ['Page introuvable', 'Ce lien est peut-être obsolète ou la page a peut-être été déplacée.', 'Retour à l’accueil'],
    de: ['Seite nicht gefunden', 'Dieser Link ist möglicherweise veraltet oder die Seite wurde verschoben.', 'Zurück zur Startseite'],
    it: ['Pagina non trovata', 'Il link potrebbe essere obsoleto oppure la pagina potrebbe essere stata spostata.', 'Torna alla pagina iniziale'],
    pt: ['Página não encontrada', 'O link pode estar desatualizado ou a página pode ter mudado de endereço.', 'Voltar ao início'],
    'pt-pt': ['Página não encontrada', 'A ligação pode estar desatualizada ou a página pode ter mudado de endereço.', 'Voltar à página inicial'],
    ru: ['Страница не найдена', 'Возможно, ссылка устарела или страница была перемещена.', 'На главную'],
    zh: ['找不到页面', '此链接可能已失效，或者页面可能已移至其他位置。', '返回首页'],
    'zh-hant': ['找不到頁面', '這個連結可能已失效，或頁面已移至其他位置。', '返回首頁'],
    ja: ['ページが見つかりません', 'リンクが古いか、ページが移動した可能性があります。', 'ホームに戻る'],
    ko: ['페이지를 찾을 수 없습니다', '이 링크가 오래되었거나 페이지가 이동했을 수 있습니다.', '홈으로 돌아가기'],
    ar: ['الصفحة غير موجودة', 'قد يكون هذا الرابط قديمًا، أو ربما نُقلت الصفحة.', 'العودة إلى الصفحة الرئيسية'],
    hi: ['पेज नहीं मिला', 'हो सकता है कि यह लिंक पुराना हो या पेज किसी दूसरी जगह चला गया हो।', 'होम पेज पर वापस जाएँ'],
    tr: ['Sayfa bulunamadı', 'Bu bağlantı güncelliğini yitirmiş veya sayfa taşınmış olabilir.', 'Ana sayfaya dön'],
    vi: ['Không tìm thấy trang', 'Liên kết này có thể đã lỗi thời hoặc trang đã được chuyển sang địa chỉ khác.', 'Về trang chủ'],
    nl: ['Pagina niet gevonden', 'Deze link is mogelijk verouderd of de pagina is verplaatst.', 'Terug naar de startpagina'],
    bn: ['পৃষ্ঠাটি পাওয়া যায়নি', 'লিংকটি পুরোনো হতে পারে অথবা পৃষ্ঠাটি অন্য ঠিকানায় সরানো হয়েছে।', 'মূল পাতায় ফিরুন'],
    pa: ['ਪੰਨਾ ਨਹੀਂ ਮਿਲਿਆ', 'ਇਹ ਲਿੰਕ ਪੁਰਾਣਾ ਹੋ ਸਕਦਾ ਹੈ ਜਾਂ ਪੰਨਾ ਕਿਸੇ ਹੋਰ ਪਤੇ ’ਤੇ ਚਲਾ ਗਿਆ ਹੋ ਸਕਦਾ ਹੈ।', 'ਮੁੱਖ ਪੰਨੇ ’ਤੇ ਵਾਪਸ ਜਾਓ'],
    pl: ['Nie znaleziono strony', 'Ten link może być nieaktualny lub strona została przeniesiona.', 'Wróć na stronę główną'],
    sv: ['Sidan hittades inte', 'Länken kan vara inaktuell eller så har sidan flyttats.', 'Till startsidan'],
    no: ['Fant ikke siden', 'Lenken kan være utdatert, eller siden kan ha blitt flyttet.', 'Tilbake til forsiden'],
    da: ['Siden blev ikke fundet', 'Linket kan være forældet, eller siden kan være flyttet.', 'Tilbage til forsiden'],
    fi: ['Sivua ei löytynyt', 'Linkki saattaa olla vanhentunut tai sivu on voitu siirtää.', 'Palaa etusivulle'],
    cs: ['Stránka nenalezena', 'Odkaz může být zastaralý nebo byla stránka přesunuta.', 'Zpět na úvodní stránku'],
    sk: ['Stránka sa nenašla', 'Odkaz môže byť zastaraný alebo bola stránka presunutá.', 'Späť na domovskú stránku'],
    hu: ['Az oldal nem található', 'Lehet, hogy a hivatkozás elavult, vagy az oldal új címre költözött.', 'Vissza a kezdőlapra'],
    ro: ['Pagina nu a fost găsită', 'Linkul poate fi învechit sau pagina poate să fi fost mutată.', 'Înapoi la pagina principală'],
    uk: ['Сторінку не знайдено', 'Можливо, посилання застаріло або сторінку переміщено.', 'На головну'],
    el: ['Η σελίδα δεν βρέθηκε', 'Ο σύνδεσμος μπορεί να είναι παλιός ή η σελίδα να έχει μετακινηθεί.', 'Επιστροφή στην αρχική σελίδα'],
    he: ['הדף לא נמצא', 'ייתכן שהקישור אינו עדכני או שהדף הועבר לכתובת אחרת.', 'חזרה לדף הבית'],
    th: ['ไม่พบหน้า', 'ลิงก์นี้อาจล้าสมัยหรือหน้านี้อาจถูกย้ายแล้ว', 'กลับไปหน้าแรก'],
    id: ['Halaman tidak ditemukan', 'Tautan ini mungkin sudah usang atau halamannya sudah dipindahkan.', 'Kembali ke beranda'],
    ms: ['Halaman tidak ditemui', 'Pautan ini mungkin sudah lapuk atau halaman ini telah dialihkan.', 'Kembali ke laman utama'],
    fa: ['صفحه پیدا نشد', 'ممکن است پیوند قدیمی باشد یا صفحه به نشانی دیگری منتقل شده باشد.', 'بازگشت به صفحهٔ اصلی'],
    ur: ['صفحہ نہیں ملا', 'ممکن ہے یہ لنک پرانا ہو یا صفحہ کسی اور پتے پر منتقل ہو گیا ہو۔', 'مرکزی صفحے پر واپس جائیں'],
    ta: ['பக்கம் கிடைக்கவில்லை', 'இந்த இணைப்பு பழையதாக இருக்கலாம் அல்லது பக்கம் வேறு முகவரிக்கு மாற்றப்பட்டிருக்கலாம்.', 'முகப்புப் பக்கத்திற்குத் திரும்பு'],
    te: ['పేజీ కనిపించలేదు', 'ఈ లింక్ పాతది కావచ్చు లేదా పేజీని మరో చిరునామాకు తరలించి ఉండవచ్చు.', 'హోమ్‌పేజీకి తిరిగి వెళ్లండి'],
    mr: ['पृष्ठ सापडले नाही', 'ही लिंक जुनी असू शकते किंवा पृष्ठ दुसऱ्या पत्त्यावर हलवले असू शकते.', 'मुख्यपृष्ठावर परत जा'],
    sw: ['Ukurasa haujapatikana', 'Huenda kiungo hiki kimepitwa na wakati au ukurasa umehamishwa.', 'Rudi kwenye ukurasa wa mwanzo'],
    af: ['Bladsy nie gevind nie', 'Hierdie skakel is dalk verouderd of die bladsy is verskuif.', 'Terug na die tuisblad'],
    ca: ['No s’ha trobat la pàgina', 'És possible que l’enllaç estigui desactualitzat o que la pàgina s’hagi mogut.', 'Torna a la pàgina d’inici'],
    hr: ['Stranica nije pronađena', 'Poveznica je možda zastarjela ili je stranica premještena.', 'Povratak na početnu stranicu'],
    bg: ['Страницата не е намерена', 'Връзката може да е остаряла или страницата да е преместена.', 'Към началната страница'],
    lt: ['Puslapis nerastas', 'Ši nuoroda gali būti pasenusi arba puslapis perkeltas.', 'Grįžti į pradžios puslapį'],
    lv: ['Lapa nav atrasta', 'Iespējams, saite ir novecojusi vai lapa ir pārvietota.', 'Atgriezties sākumlapā'],
    et: ['Lehte ei leitud', 'Link võib olla aegunud või leht on viidud teisele aadressile.', 'Tagasi avalehele'],
    sl: ['Stran ni bila najdena', 'Povezava je morda zastarela ali pa je bila stran premaknjena.', 'Nazaj na domačo stran'],
    sr: ['Страница није пронађена', 'Веза је можда застарела или је страница премештена.', 'Назад на почетну страницу'],
    co: ['Pagina micca truvata', 'Stu ligame pò esse vechju o a pagina pò esse stata spiazzata.', 'Turnà à a pagina iniziale'],
  };

  let preferred = '';
  try { preferred = localStorage.getItem('munetiosLanguage') || ''; } catch {}

  function matchLocale(language) {
    const locale = language.toLowerCase();
    if (/^zh-(?:hant|tw|hk|mo)(?:-|$)/.test(locale)) return 'zh-hant';
    return Object.hasOwn(messages, locale) ? locale : locale.split('-')[0];
  }

  const locale = [preferred, ...(navigator.languages || [navigator.language])]
    .filter(Boolean).map(matchLocale).find(language => Object.hasOwn(messages, language)) || 'en';
  const [title, description, home] = messages[locale];
  const labels = { title, description, home };

  document.documentElement.lang = locale;
  document.documentElement.dir = ['ar', 'fa', 'he', 'ur'].includes(locale) ? 'rtl' : 'ltr';
  document.title = `${title} · Munetios`;
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = labels[element.dataset.i18n];
  }
})();
