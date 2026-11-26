(() => {
  'use strict';

  // The 17 global Munetios locales (shared/munetios-locales.js). Home is the main page here:
  // Principal in Latin American Spanish, Inicio in Spain.
  const messages = {
    'en-US': ['Page not found', 'This link may be outdated, or the page may have moved.', 'Back to home'],
    'en-GB': ['Page not found', 'This link may be out of date, or the page may have moved.', 'Back to home'],
    'es-419': ['Página no encontrada', 'Es posible que el enlace esté desactualizado o que la página se haya movido.', 'Volver a Principal'],
    'es-ES': ['Página no encontrada', 'Puede que el enlace esté desactualizado o que la página haya cambiado de dirección.', 'Volver al inicio'],
    'es-US': ['Página no encontrada', 'Es posible que el enlace esté desactualizado o que la página se haya movido.', 'Volver a Principal'],
    'fr-FR': ['Page introuvable', 'Ce lien est peut-être obsolète ou la page a peut-être été déplacée.', 'Retour à l’accueil'],
    'fr-CA': ['Page introuvable', 'Ce lien est peut-être périmé ou la page a peut-être été déplacée.', 'Retour à l’accueil'],
    de: ['Seite nicht gefunden', 'Dieser Link ist möglicherweise veraltet oder die Seite wurde verschoben.', 'Zurück zur Startseite'],
    it: ['Pagina non trovata', 'Il link potrebbe essere obsoleto oppure la pagina potrebbe essere stata spostata.', 'Torna alla pagina iniziale'],
    'pt-BR': ['Página não encontrada', 'O link pode estar desatualizado ou a página pode ter mudado de endereço.', 'Voltar ao início'],
    'pt-PT': ['Página não encontrada', 'A ligação pode estar desatualizada ou a página pode ter mudado de endereço.', 'Voltar à página inicial'],
    'zh-CN': ['找不到页面', '此链接可能已失效，或者页面可能已移至其他位置。', '返回首页'],
    'zh-TW': ['找不到頁面', '這個連結可能已失效，或頁面已移至其他位置。', '返回首頁'],
    ko: ['페이지를 찾을 수 없습니다', '이 링크가 오래되었거나 페이지가 이동했을 수 있습니다.', '홈으로 돌아가기'],
    ar: ['الصفحة غير موجودة', 'قد يكون هذا الرابط قديمًا، أو ربما نُقلت الصفحة.', 'العودة إلى الصفحة الرئيسية'],
    hi: ['पेज नहीं मिला', 'हो सकता है कि यह लिंक पुराना हो या पेज किसी दूसरी जगह चला गया हो।', 'होम पर वापस जाएँ'],
    co: ['Pagina micca truvata', 'Stu ligame pò esse vechju o a pagina pò esse stata spiazzata.', 'Turnà à a pagina iniziale'],
  };

  const L = window.MunetiosLocales;
  let preferred = '';
  try { preferred = localStorage.getItem('munetiosLanguage') || ''; } catch {}
  const locale = (L && ((preferred && L.resolve(preferred)) || L.detect())) || 'en-US';
  const [title, description, home] = messages[locale] || messages['en-US'];
  const labels = { title, description, home };

  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  document.title = `${title} · Munetios`;
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = labels[element.dataset.i18n];
  }
})();
