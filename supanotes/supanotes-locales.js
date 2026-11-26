/*
 * Munetios SupaNotes interface strings for the 17 global Munetios locales that the table in index.html lacks.
 * index.html composes them with shared/munetios-locales.js (zh-TW, es-US, es-ES, fr-CA, pt-PT, en-GB are derived).
 */
(() => {
  "use strict";
  const L = window.MunetiosLocales;
  const zip = (keys, list, label) => {
    if (keys.length !== list.length) throw new Error(`SupaNotes ${label}: ${list.length} strings for ${keys.length} keys`);
    return L.rows(keys, list);
  };
  const SHARE = ["share", "print", "shareTitle", "shareVia", "shareCopied", "shareNotSupported"];
  const ALL = ["languageChanged", "notes", "tags", "favorites", "trash", "newLabel", "searchPlaceholder", "favoritesTitle", "favoritesSubtitle", "tagsTitle", "tagsSubtitle", "trashTitle", "trashSubtitle",
    "newNote", "editNote", "noteTitlePlaceholder", "noteContentPlaceholder", "saveNote", "voiceNote", "tapRecord", "recording", "paused", "recordSaved", "paint", "insertLink", "displayTextPlaceholder",
    "newTagPlaceholder", "addTag", "settingsTitle", "noteFontLabel", "languageLabel", "lightModeLabel", "moveToTrashAll", "exportAll", "importNotes", "resetEncKey", "deleteAll", "addToTag",
    "addToFavorites", "removeFavorite", "edit", "moveToTrash", "restore", ...SHARE];

  window.SupaNotesLocaleExtras = {
    "zh-CN": zip(SHARE, ["分享", "打印", "分享笔记", "分享方式：", "已复制笔记内容！", "此设备不支持分享。"], "zh"),
    ar: zip(SHARE, ["مشاركة", "طباعة", "مشاركة الملاحظة", "المشاركة عبر:", "تم نسخ محتوى الملاحظة!", "المشاركة غير مدعومة على هذا الجهاز."], "ar"),
    ko: zip(ALL, ["언어를 변경했습니다", "메모", "태그", "즐겨찾기", "휴지통", "새로 만들기", "메모 검색", "즐겨찾기", "별표한 메모가 여기에 표시됩니다.", "태그", "태그로 메모를 정리하세요.", "휴지통", "삭제한 메모입니다. 복원하거나 영구 삭제하세요.",
      "새 메모", "메모 편집", "메모 제목...", "여기에 메모를 입력하세요...", "새 메모", "음성 메모", "녹음을 눌러 시작하세요", "녹음 중...", "일시정지됨", "녹음이 저장되었습니다. 완료를 눌러 삽입하세요", "그리기", "링크 삽입", "표시할 텍스트(선택 사항)",
      "새 태그 이름...", "태그 추가", "설정", "메모 글꼴:", "언어:", "라이트 모드:", "모든 메모를 휴지통으로 이동", "모든 메모 내보내기", "메모 가져오기", "암호화 키 재설정", "모두 삭제", "태그에 추가",
      "즐겨찾기에 추가", "즐겨찾기에서 삭제", "편집", "휴지통으로 이동", "복원", "공유", "인쇄", "메모 공유", "공유 방법:", "메모 내용을 복사했습니다!", "이 기기에서는 공유를 지원하지 않습니다."], "ko"),
    hi: zip(ALL, ["भाषा बदली गई", "नोट्स", "टैग", "पसंदीदा", "ट्रैश", "नया", "नोट्स खोजें", "पसंदीदा", "आपके स्टार किए नोट्स यहाँ दिखते हैं।", "टैग", "अपने नोट्स को टैग से व्यवस्थित करें।", "ट्रैश", "हटाए गए नोट्स। इन्हें वापस लाएँ या हमेशा के लिए हटाएँ।",
      "नया नोट", "नोट संपादित करें", "नोट का शीर्षक...", "अपना नोट यहाँ लिखें...", "नया नोट", "वॉइस नोट", "शुरू करने के लिए रिकॉर्ड पर टैप करें", "रिकॉर्ड हो रहा है...", "रुका हुआ", "रिकॉर्डिंग सहेजी गई - जोड़ने के लिए हो गया पर टैप करें", "पेंट", "लिंक जोड़ें", "दिखने वाला टेक्स्ट (वैकल्पिक)",
      "नए टैग का नाम...", "टैग जोड़ें", "सेटिंग", "नोट का फ़ॉन्ट:", "भाषा:", "लाइट मोड:", "सभी नोट्स ट्रैश में ले जाएँ", "सभी नोट्स एक्सपोर्ट करें", "नोट्स इंपोर्ट करें", "एन्क्रिप्शन कुंजी रीसेट करें", "सब कुछ हटाएँ", "टैग में जोड़ें",
      "पसंदीदा में जोड़ें", "पसंदीदा से हटाएँ", "संपादित करें", "ट्रैश में ले जाएँ", "वापस लाएँ", "शेयर करें", "प्रिंट करें", "नोट शेयर करें", "इसके ज़रिए शेयर करें:", "नोट की सामग्री कॉपी हो गई!", "इस डिवाइस पर शेयर करना समर्थित नहीं है।"], "hi"),
    co: zip(ALL, ["Lingua cambiata", "Note", "Etichette", "Favuriti", "Rumenzula", "Novu", "Circà note", "Favuriti", "E note marcate cù una stella cumparenu quì.", "Etichette", "Urganizate e vostre note cù etichette.", "Rumenzula", "Note sguassate. Ristabilitele o sguassatele per sempre.",
      "Nota nova", "Mudificà a nota", "Titulu di a nota...", "Scrivite a vostra nota quì...", "Nota nova", "Nota vocale", "Toccate arregistrà per principià", "Arregistramentu...", "In pausa", "Arregistramentu salvatu - toccate Fattu per inserillu", "Pittura", "Inserisce un ligame", "Testu à mustrà (facultativu)",
      "Nome di l’etichetta nova...", "Aghjunghje un’etichetta", "Parametri", "Caratteru di e note:", "Lingua:", "Modu chjaru:", "Mette tutte e note in a rumenzula", "Espurtà tutte e note", "Impurtà note", "Rinizià a chjave di cifratura", "Sguassà tuttu", "Aghjunghje à un’etichetta",
      "Mette in i favuriti", "Caccià da i favuriti", "Mudificà", "Mette in a rumenzula", "Ristabilisce", "Sparte", "Stampà", "Sparte a nota", "Sparte cù:", "Cuntenutu di a nota cupiatu!", "A spartera ùn hè micca supportata nant’à st’apparechju."], "co"),
  };
})();
