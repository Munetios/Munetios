/*
 * Munetios Meals strings that the main tables in index.html lack, for the 17 global Munetios locales.
 * index.html composes these with shared/munetios-locales.js (zh-TW, es-US, es-ES, fr-CA, pt-PT, en-GB are derived).
 */
(() => {
  "use strict";
  const L = window.MunetiosLocales;
  const zip = (keys, list, label) => {
    if (keys.length !== list.length) throw new Error(`Meals ${label}: ${list.length} strings for ${keys.length} keys`);
    return L.rows(keys, list);
  };

  const TOASTS = ["mealSavedToast", "mealUpdatedToast", "mealDeletedToast", "bookmarkAddedToast", "bookmarkRemovedToast", "storageUnavailable", "mealTypeSnack", "calendarDateLabel"];
  const GAP = ["itemSingular", "itemPlural", "mealSingular", "mealPlural", "dateSingular", "datePlural", "bookmarkedMealSingular", "bookmarkedMealPlural", "remove", "edit", "close",
    "closeHelpModal", "closeDeleteModal", "closeSettingsModal", "closeAppsModal", "themeSaved", "dateFormatSaved", "languageSaved", "dataExported", "dataImported", "importFailed", "bookmarksRemoved",
    "mealsDeleted", "mealNameRequired", "validMealTypeRequired", "imageFileRequired", "selectedImage", "savedImage", "noFileSelected", "imageMeta", "editMealAction", "deleteMealAction",
    "addBookmarkAction", "removeBookmarkAction", "previousMonth", "nextMonth", "allBookmarksLabel", "allMealsLabel", "deleteAllBookmarksTitle", "deleteAllBookmarksCopy", "deleteAllMealsTitle",
    "deleteAllMealsCopy", "deleteMealButton", "mealDeleteEyebrow", "deleteMealTitle", "deleteMealCopy", "todayButton", "themeLight", "themeDark", "themeSystem", "howToAddMealTitle", "howToAddMealBody",
    "howBookmarksWorkTitle", "howBookmarksWorkBody", "howCalendarWorksTitle", "howCalendarWorksBody", "whereDataStoredTitle", "whereDataStoredBody", "moveDataTitle", "moveDataBody",
    "whatCountsAsPastTitle", "whatCountsAsPastBody", "logoText", "logoAlt", "mealsRegion", "calendarRegion", "searchMealsLabel", "mealsStatusLabel", "calendarStatusLabel", "mealListLabel",
    "calendarGridLabel", "openMenu", "openSearch", "openBookmarks", "openHelp", "openSettings", "openApps", "autoDetectLanguage", "calendarEventSyncFailedToast"];
  const REST = ["meals", "calendar", "addMeal", "bookmarks", "help", "settings", "create", "saveMeal", "saveChanges", "cancel", "searchPlaceholder", "loadingMeals", "loadingCalendar",
    "noMealsTitle", "noMealsBody", "noBookmarksTitle", "noBookmarksBody", "mealsLoadErrorTitle", "mealsLoadErrorBody", "exportData", "importData", "deleteAllBookmarks", "deleteAllMeals",
    "preferencesStored", "newMealEyebrow", "newMealTitle", "editMealEyebrow", "editMealTitle", "monthView", "optionalImageUpload", "theme", "dateFormat", "language", "appearance", "advanced",
    "support", "allMeals", "currentMeals", "pastLabel", "saved", "mealTag", "today", "past", "inLabel", "plannerEyebrow", "timelineEyebrow", "savedMealsEyebrow", "mealName", "mealType",
    "mealTypeOptions", "foodsIngredients", "separateItems", "notesLabel", "mealImage", "mealNamePlaceholder", "ingredientsPlaceholder", "notesPlaceholder", "mealPreviewAlt", "calendarDescription",
    "mealTypeBreakfast", "mealTypeLunch", "mealTypeDinner", "preferencesEyebrow", "appsEyebrow", "appsCopy", "back"];

  const extras = {
    "es-419": zip(TOASTS, ["Comida guardada.", "Comida actualizada.", "Comida eliminada.", "Marcador agregado.", "Marcador quitado.", "Almacenamiento no disponible", "Merienda", "{date}. {count} {mealWord}. {items}"], "es-419"),
    "es-ES": zip(TOASTS, ["Comida guardada.", "Comida actualizada.", "Comida eliminada.", "Marcador añadido.", "Marcador quitado.", "Almacenamiento no disponible", "Tentempié", "{date}. {count} {mealWord}. {items}"], "es-ES"),
    "fr-FR": { ...zip(TOASTS, ["Repas enregistré.", "Repas mis à jour.", "Repas supprimé.", "Favori ajouté.", "Favori retiré.", "Stockage indisponible", "Collation", "{date}. {count} {mealWord}. {items}"], "fr"), dateSingular: "date", datePlural: "dates", notesLabel: "Notes" },
    de: { ...zip(TOASTS, ["Mahlzeit gespeichert.", "Mahlzeit aktualisiert.", "Mahlzeit gelöscht.", "Lesezeichen hinzugefügt.", "Lesezeichen entfernt.", "Speicher nicht verfügbar", "Snack", "{date}. {count} {mealWord}. {items}"], "de"), themeSystem: "System", appsEyebrow: "Munetios-Apps" },
    "pt-BR": { ...zip(TOASTS, ["Refeição salva.", "Refeição atualizada.", "Refeição excluída.", "Favorito adicionado.", "Favorito removido.", "Armazenamento indisponível", "Lanche", "{date}. {count} {mealWord}. {items}"], "pt"), itemSingular: "item" },
    "pt-PT": zip(TOASTS, ["Refeição guardada.", "Refeição atualizada.", "Refeição eliminada.", "Marcador adicionado.", "Marcador removido.", "Armazenamento indisponível", "Lanche", "{date}. {count} {mealWord}. {items}"], "pt-PT"),
    it: { ...zip(TOASTS, ["Pasto salvato.", "Pasto aggiornato.", "Pasto eliminato.", "Segnalibro aggiunto.", "Segnalibro rimosso.", "Archiviazione non disponibile", "Spuntino", "{date}. {count} {mealWord}. {items}"], "it t"), ...zip(GAP, [
      "elemento", "elementi", "pasto", "pasti", "data", "date", "pasto nei segnalibri", "pasti nei segnalibri", "Rimuovi", "Modifica", "Chiudi",
      "Chiudi la guida", "Chiudi la conferma di eliminazione", "Chiudi le impostazioni", "Chiudi le app", "Tema salvato.", "Formato data salvato.", "Lingua salvata.", "Dati esportati.", "Dati importati.", "Importazione non riuscita. Usa un file di esportazione valido.", "Tutti i segnalibri rimossi.",
      "Tutti i pasti eliminati.", "Il nome del pasto è obbligatorio.", "Scegli un tipo di pasto valido.", "Il file caricato deve essere un'immagine.", "Immagine selezionata", "Immagine salvata", "Nessun file selezionato", "Aggiungi un'immagine facoltativa.", "Modifica pasto", "Elimina pasto",
      "Aggiungi segnalibro", "Rimuovi segnalibro", "Mese precedente", "Mese successivo", "Tutti i segnalibri", "Tutti i pasti", "Eliminare tutti i segnalibri?", "Questa azione rimuove il segnalibro da ogni pasto salvato.", "Eliminare tutti i pasti?",
      "Questa azione rimuove ogni pasto da IndexedDB e non può essere annullata.", "Elimina pasto", "Elimina pasto", "Rimuovere questo pasto?", "Questa azione rimuove il pasto da IndexedDB e non può essere annullata.", "Oggi", "Chiaro", "Scuro", "Sistema", "Come aggiungere un pasto", "Apri il pulsante Aggiungi, inserisci titolo, tipo, ingredienti e note e, se vuoi, allega un'immagine.",
      "Come funzionano i segnalibri", "Usa il pulsante segnalibro su qualsiasi scheda. I pasti salvati compaiono nella finestra dei segnalibri e nel filtro dei segnalibri.", "Come funziona il calendario", "Il calendario mostra i pasti per data reale. Usa i controlli precedente e successivo per cambiare mese.", "Dove sono archiviati i dati?", "Pasti e preferenze sono archiviati localmente in IndexedDB e nella memoria locale.", "Posso spostare i dati su un altro dispositivo?", "Sì. Esporta dalle impostazioni, poi importa il file JSON sull'altro dispositivo.",
      "Cosa conta come passato?", "Ogni pasto creato prima di oggi passa automaticamente tra i passati.", "Munetios Meals", "Logo di Munetios Meals", "Contenuto dei pasti", "Contenuto del calendario", "Cerca pasti", "Stato dei pasti", "Stato del calendario", "Elenco dei pasti",
      "Vista mensile del calendario", "Mostra o nascondi il menu laterale", "Apri la ricerca", "Apri i segnalibri", "Apri la guida", "Apri le impostazioni", "Apri le app", "Rilevamento automatico", "Pasto salvato, ma non è stato possibile sincronizzare l'evento del Calendario."], "it") },
    "zh-CN": { ...zip(TOASTS, ["已保存餐食。", "已更新餐食。", "已删除餐食。", "已添加书签。", "已移除书签。", "存储不可用", "加餐", "{date}。{count} {mealWord}。{items}"], "zh t"), ...zip(GAP, [
      "项", "项", "顿餐食", "顿餐食", "个日期", "个日期", "个已加书签的餐食", "个已加书签的餐食", "移除", "编辑", "关闭",
      "关闭帮助窗口", "关闭删除确认", "关闭设置窗口", "关闭应用窗口", "已保存主题偏好。", "已保存日期格式偏好。", "已保存语言偏好。", "数据已导出。", "数据已导入。", "导入失败。请使用有效的导出文件。", "已移除所有书签。",
      "已删除所有餐食。", "请填写餐食名称。", "请选择有效的餐食类型。", "上传的文件必须是图片。", "已选图片", "已保存的图片", "未选择文件", "可添加一张图片。", "编辑餐食", "删除餐食",
      "添加书签", "移除书签", "上个月", "下个月", "所有书签", "所有餐食", "删除所有书签？", "这会移除每个已保存餐食的书签状态。", "删除所有餐食？",
      "这会从 IndexedDB 中移除所有餐食，且无法撤销。", "删除餐食", "删除餐食", "删除此餐食？", "这会从 IndexedDB 中移除此餐食，且无法撤销。", "今天", "浅色", "深色", "跟随系统", "如何添加餐食", "点按添加按钮，输入名称、类型、食材和备注，也可以附加一张图片。",
      "书签如何使用", "在任意餐食卡片上使用书签按钮。已保存的餐食会显示在书签窗口和书签筛选中。", "日历如何使用", "日历按实际日期显示餐食。使用上一个和下一个按钮切换月份。", "数据存储在哪里？", "餐食和偏好设置存储在本地的 IndexedDB 和本地存储中。", "可以把数据移到其他设备吗？", "可以。在设置中导出，然后在其他设备上导入 JSON 文件。",
      "什么算作过去？", "今天之前创建的餐食会自动移到过去。", "Munetios 餐食", "Munetios 餐食标志", "餐食内容", "日历内容", "搜索餐食", "餐食状态", "日历状态", "餐食列表",
      "日历月视图", "显示或隐藏侧边栏菜单", "打开搜索", "打开书签", "打开帮助", "打开设置", "打开应用", "自动检测", "餐食已保存，但无法同步日历事件。"], "zh") },
    ko: { ...zip(TOASTS, ["식사를 저장했습니다.", "식사를 업데이트했습니다.", "식사를 삭제했습니다.", "북마크를 추가했습니다.", "북마크를 삭제했습니다.", "저장소를 사용할 수 없음", "간식", "{date}. {count}{mealWord}. {items}"], "ko t"), ...zip(GAP, [
      "개 항목", "개 항목", "끼 식사", "끼 식사", "개 날짜", "개 날짜", "개 북마크한 식사", "개 북마크한 식사", "삭제", "편집", "닫기",
      "도움말 닫기", "삭제 확인 닫기", "설정 닫기", "앱 닫기", "테마 설정을 저장했습니다.", "날짜 형식을 저장했습니다.", "언어 설정을 저장했습니다.", "데이터를 내보냈습니다.", "데이터를 가져왔습니다.", "가져오지 못했습니다. 올바른 내보내기 파일을 사용하세요.", "모든 북마크를 삭제했습니다.",
      "모든 식사를 삭제했습니다.", "식사 이름을 입력하세요.", "올바른 식사 유형을 선택하세요.", "업로드한 파일은 이미지여야 합니다.", "선택한 이미지", "저장된 이미지", "선택한 파일 없음", "이미지 파일을 추가할 수 있습니다.", "식사 편집", "식사 삭제",
      "북마크 추가", "북마크 삭제", "이전 달", "다음 달", "모든 북마크", "모든 식사", "모든 북마크를 삭제할까요?", "저장된 모든 식사에서 북마크 상태가 삭제됩니다.", "모든 식사를 삭제할까요?",
      "IndexedDB에서 모든 식사가 삭제되며 되돌릴 수 없습니다.", "식사 삭제", "식사 삭제", "이 식사를 삭제할까요?", "IndexedDB에서 이 식사가 삭제되며 되돌릴 수 없습니다.", "오늘", "라이트", "다크", "시스템", "식사를 추가하는 방법", "추가 버튼을 누르고 이름, 유형, 재료, 메모를 입력한 뒤 원하면 이미지를 첨부하세요.",
      "북마크 사용 방법", "식사 카드의 북마크 버튼을 사용하세요. 저장한 식사는 북마크 창과 북마크 필터에 표시됩니다.", "캘린더 사용 방법", "캘린더는 실제 날짜별로 식사를 보여 줍니다. 이전/다음 버튼으로 달을 이동하세요.", "데이터는 어디에 저장되나요?", "식사와 설정은 IndexedDB와 로컬 저장소에 로컬로 저장됩니다.", "데이터를 다른 기기로 옮길 수 있나요?", "네. 설정에서 내보낸 후 다른 기기에서 JSON 파일을 가져오세요.",
      "무엇이 지난 식사인가요?", "오늘 이전에 만든 식사는 자동으로 지난 식사로 이동합니다.", "Munetios 식사", "Munetios 식사 로고", "식사 콘텐츠", "캘린더 콘텐츠", "식사 검색", "식사 상태", "캘린더 상태", "식사 목록",
      "캘린더 월 보기", "사이드바 메뉴 표시/숨기기", "검색 열기", "북마크 열기", "도움말 열기", "설정 열기", "앱 열기", "자동 감지", "식사를 저장했지만 캘린더 일정을 동기화하지 못했습니다."], "ko") },
    ar: { ...zip(TOASTS, ["تم حفظ الوجبة.", "تم تحديث الوجبة.", "تم حذف الوجبة.", "تمت إضافة الإشارة المرجعية.", "تمت إزالة الإشارة المرجعية.", "التخزين غير متاح", "وجبة خفيفة", "{date}. {count} {mealWord}. {items}"], "ar t"), ...zip(GAP, [
      "عنصر", "عناصر", "وجبة", "وجبات", "تاريخ", "تواريخ", "وجبة محفوظة", "وجبات محفوظة", "إزالة", "تعديل", "إغلاق",
      "إغلاق نافذة المساعدة", "إغلاق تأكيد الحذف", "إغلاق نافذة الإعدادات", "إغلاق نافذة التطبيقات", "تم حفظ تفضيل المظهر.", "تم حفظ تنسيق التاريخ.", "تم حفظ تفضيل اللغة.", "تم تصدير البيانات.", "تم استيراد البيانات.", "فشل الاستيراد. استخدم ملف تصدير صالحًا.", "تمت إزالة كل الإشارات المرجعية.",
      "تم حذف كل الوجبات.", "اسم الوجبة مطلوب.", "اختر نوع وجبة صالحًا.", "يجب أن يكون الملف المرفوع صورة.", "الصورة المحددة", "الصورة المحفوظة", "لم يتم اختيار ملف", "أضف صورة اختيارية.", "تعديل الوجبة", "حذف الوجبة",
      "إضافة إشارة مرجعية", "إزالة الإشارة المرجعية", "الشهر السابق", "الشهر التالي", "كل الإشارات المرجعية", "كل الوجبات", "حذف كل الإشارات المرجعية؟", "سيؤدي هذا إلى إزالة الإشارة المرجعية من كل وجبة محفوظة.", "حذف كل الوجبات؟",
      "سيؤدي هذا إلى حذف كل الوجبات من IndexedDB، ولا يمكن التراجع عنه.", "حذف الوجبة", "حذف الوجبة", "إزالة هذه الوجبة؟", "سيؤدي هذا إلى حذف الوجبة من IndexedDB، ولا يمكن التراجع عنه.", "اليوم", "فاتح", "داكن", "النظام", "كيفية إضافة وجبة", "افتح زر الإضافة وأدخل الاسم والنوع والمكونات والملاحظات، ويمكنك إرفاق صورة.",
      "كيف تعمل الإشارات المرجعية", "استخدم زر الإشارة المرجعية في أي بطاقة وجبة. تظهر الوجبات المحفوظة في نافذة الإشارات المرجعية وفي التصفية.", "كيف يعمل التقويم", "يعرض التقويم الوجبات حسب تواريخها الفعلية. استخدم زري السابق والتالي للتنقل بين الأشهر.", "أين تُخزَّن البيانات؟", "تُخزَّن الوجبات والتفضيلات محليًا في IndexedDB والتخزين المحلي.", "هل يمكنني نقل البيانات إلى جهاز آخر؟", "نعم. صدّر من الإعدادات، ثم استورد ملف JSON على الجهاز الآخر.",
      "ما الذي يُعد سابقًا؟", "تنتقل أي وجبة أُنشئت قبل اليوم إلى السابقة تلقائيًا.", "وجبات Munetios", "شعار وجبات Munetios", "محتوى الوجبات", "محتوى التقويم", "البحث في الوجبات", "حالة الوجبات", "حالة التقويم", "قائمة الوجبات",
      "عرض الشهر في التقويم", "إظهار القائمة الجانبية أو إخفاؤها", "فتح البحث", "فتح الإشارات المرجعية", "فتح المساعدة", "فتح الإعدادات", "فتح التطبيقات", "اكتشاف تلقائي", "تم حفظ الوجبة، لكن تعذّرت مزامنة حدث التقويم."], "ar") },
    hi: { ...zip(TOASTS, ["भोजन सहेजा गया।", "भोजन अपडेट हुआ।", "भोजन हटाया गया।", "बुकमार्क जोड़ा गया।", "बुकमार्क हटाया गया।", "स्टोरेज उपलब्ध नहीं", "नाश्ता", "{date}. {count} {mealWord}. {items}"], "hi t"), ...zip(GAP, [
      "आइटम", "आइटम", "भोजन", "भोजन", "तारीख", "तारीखें", "बुकमार्क किया भोजन", "बुकमार्क किए भोजन", "हटाएँ", "संपादित करें", "बंद करें",
      "सहायता विंडो बंद करें", "हटाने की पुष्टि बंद करें", "सेटिंग विंडो बंद करें", "ऐप्स विंडो बंद करें", "थीम सहेजी गई।", "तारीख का फ़ॉर्मैट सहेजा गया।", "भाषा सहेजी गई।", "डेटा एक्सपोर्ट हुआ।", "डेटा इंपोर्ट हुआ।", "इंपोर्ट नहीं हो सका। सही एक्सपोर्ट फ़ाइल का उपयोग करें।", "सभी बुकमार्क हटाए गए।",
      "सभी भोजन हटाए गए।", "भोजन का नाम ज़रूरी है।", "भोजन का सही प्रकार चुनें।", "अपलोड की गई फ़ाइल इमेज होनी चाहिए।", "चुनी गई इमेज", "सहेजी गई इमेज", "कोई फ़ाइल नहीं चुनी गई", "चाहें तो इमेज फ़ाइल जोड़ें।", "भोजन संपादित करें", "भोजन हटाएँ",
      "बुकमार्क जोड़ें", "बुकमार्क हटाएँ", "पिछला महीना", "अगला महीना", "सभी बुकमार्क", "सभी भोजन", "सभी बुकमार्क हटाएँ?", "इससे हर सहेजे गए भोजन से बुकमार्क हट जाएगा।", "सभी भोजन हटाएँ?",
      "इससे IndexedDB से हर भोजन हट जाएगा। इसे पहले जैसा नहीं किया जा सकता।", "भोजन हटाएँ", "भोजन हटाएँ", "यह भोजन हटाएँ?", "इससे IndexedDB से यह भोजन हट जाएगा। इसे पहले जैसा नहीं किया जा सकता।", "आज", "लाइट", "डार्क", "सिस्टम", "भोजन कैसे जोड़ें", "जोड़ें बटन खोलें, नाम, प्रकार, सामग्री और नोट्स लिखें, और चाहें तो इमेज फ़ाइल जोड़ें।",
      "बुकमार्क कैसे काम करते हैं", "किसी भी भोजन कार्ड पर बुकमार्क बटन का उपयोग करें। सहेजे गए भोजन बुकमार्क विंडो और बुकमार्क फ़िल्टर में दिखते हैं।", "कैलेंडर कैसे काम करता है", "कैलेंडर भोजन को असली तारीखों के अनुसार दिखाता है। महीने बदलने के लिए पिछला और अगला बटन इस्तेमाल करें।", "डेटा कहाँ सेव होता है?", "भोजन और प्राथमिकताएँ IndexedDB और लोकल स्टोरेज में डिवाइस पर ही सेव होती हैं।", "क्या मैं डेटा दूसरे डिवाइस पर ले जा सकता हूँ?", "हाँ। सेटिंग में एक्सपोर्ट करें, फिर दूसरे डिवाइस पर JSON फ़ाइल इंपोर्ट करें।",
      "पिछला किसे माना जाता है?", "आज से पहले बना कोई भी भोजन अपने-आप पिछले में चला जाता है।", "Munetios मील्स", "Munetios मील्स लोगो", "भोजन सामग्री", "कैलेंडर सामग्री", "भोजन खोजें", "भोजन की स्थिति", "कैलेंडर की स्थिति", "भोजन सूची",
      "कैलेंडर का महीना दृश्य", "साइडबार मेनू दिखाएँ या छिपाएँ", "खोज खोलें", "बुकमार्क खोलें", "सहायता खोलें", "सेटिंग खोलें", "ऐप्स खोलें", "अपने-आप पहचानें", "भोजन सहेजा गया, लेकिन कैलेंडर इवेंट सिंक नहीं हो सका।"], "hi"), ...zip(REST, [
      "भोजन", "कैलेंडर", "भोजन जोड़ें", "बुकमार्क", "सहायता", "सेटिंग", "बनाएँ", "भोजन सहेजें", "बदलाव सहेजें", "रद्द करें", "भोजन खोजें", "भोजन लोड हो रहे हैं", "कैलेंडर लोड हो रहा है",
      "कोई भोजन नहीं मिला", "दूसरी खोज आज़माएँ, फ़िल्टर बदलें, या अपनी सूची में नया भोजन जोड़ें।", "अभी कोई बुकमार्क नहीं", "जल्दी पहुँच के लिए सूची से भोजन बुकमार्क करें।", "भोजन लोड नहीं हो सके", "आपके ब्राउज़र ने इस पेज के लिए IndexedDB ब्लॉक कर दिया। लोकल स्टोरेज की अनुमति देकर पेज फिर से लोड करें।", "डेटा एक्सपोर्ट करें", "डेटा इंपोर्ट करें", "सभी बुकमार्क हटाएँ", "सभी भोजन हटाएँ",
      "प्राथमिकताएँ इसी डिवाइस पर सेव होती हैं।", "नया भोजन", "भोजन जोड़ें", "भोजन संपादित करें", "भोजन अपडेट करें", "महीना दृश्य", "वैकल्पिक। भोजन कार्ड में इमेज चाहिए तो फ़ाइल अपलोड करें।", "थीम", "तारीख का फ़ॉर्मैट", "भाषा", "रूप-रंग", "उन्नत",
      "सहायता", "सभी भोजन", "मौजूदा भोजन", "पिछले भोजन", "सहेजे गए", "भोजन", "आज", "पिछले", "में", "IndexedDB भोजन प्लानर", "भोजन टाइमलाइन", "सहेजे गए भोजन", "भोजन का नाम", "भोजन का प्रकार",
      "भोजन के प्रकार", "खाना या सामग्री", "आइटम को कॉमा से अलग करें।", "नोट्स", "भोजन की इमेज", "चिकन राइस बाउल", "चावल, चिकन, खीरा, चिली ऑयल", "जल्दी बनने वाला, ज़्यादा प्रोटीन, एक साथ ज़्यादा बनाने के लिए अच्छा।", "चुने गए भोजन का पूर्वावलोकन", "सहेजे गए भोजन उनके बनाए जाने के दिन के अनुसार देखें।",
      "सुबह का नाश्ता", "दोपहर का खाना", "रात का खाना", "प्राथमिकताएँ", "Munetios ऐप्स", "भोजन वर्कस्पेस में Munetios ऐप्स देखें।", "वापस"], "hi rest") },
    co: { ...zip(TOASTS, ["Pastu arregistratu.", "Pastu aghjurnatu.", "Pastu sguassatu.", "Favuritu aghjuntu.", "Favuritu cacciatu.", "Almacenamentu micca dispunibule", "Spuntinu", "{date}. {count} {mealWord}. {items}"], "co t"), ...zip(GAP, [
      "elementu", "elementi", "pastu", "pasti", "data", "date", "pastu in i favuriti", "pasti in i favuriti", "Caccià", "Mudificà", "Chjode",
      "Chjode l’aiutu", "Chjode a cunferma di suppressione", "Chjode i parametri", "Chjode l’applicazioni", "Tema arregistratu.", "Furmatu di data arregistratu.", "Lingua arregistrata.", "Dati espurtati.", "Dati impurtati.", "L’impurtazione hà fiascatu. Aduprate un schedariu d’espurtazione validu.", "Tutti i favuriti cacciati.",
      "Tutti i pasti sguassati.", "U nome di u pastu hè ubligatoriu.", "Sceglite un tipu di pastu validu.", "U schedariu caricatu deve esse un’imagine.", "Imagine scelta", "Imagine arregistrata", "Nisunu schedariu sceltu", "Aghjunghjite un’imagine facultativa.", "Mudificà u pastu", "Sguassà u pastu",
      "Aghjunghje à i favuriti", "Caccià da i favuriti", "Mese precedente", "Mese seguente", "Tutti i favuriti", "Tutti i pasti", "Sguassà tutti i favuriti?", "Questu caccia u favuritu da ogni pastu arregistratu.", "Sguassà tutti i pasti?",
      "Questu caccia ogni pastu da IndexedDB. Ùn si pò micca annullà.", "Sguassà u pastu", "Sguassà u pastu", "Caccià stu pastu?", "Questu caccia u pastu da IndexedDB. Ùn si pò micca annullà.", "Oghje", "Chjaru", "Scuru", "Sistema", "Cumu aghjunghje un pastu", "Apria u buttone Aghjunghje, scrivite un titulu, un tipu, l’ingredienti è e note, è s’è vo vulete, aghjunghjite un’imagine.",
      "Cumu funziunanu i favuriti", "Aduprate u buttone favuritu nant’à una carta di pastu. I pasti arregistrati cumparenu in a finestra di i favuriti è in u filtru.", "Cumu funziona u calendariu", "U calendariu mostra i pasti secondu e date vere. Aduprate i buttoni precedente è seguente per cambià di mese.", "Induve sò arregistrati i dati?", "I pasti è e preferenze sò arregistrati lucalmente in IndexedDB è in a memoria lucale.", "Possu trasferisce i dati nant’à un altru apparechju?", "Iè. Espurtate da i parametri, po impurtate u schedariu JSON nant’à l’altru apparechju.",
      "Chì conta cum’è passatu?", "Ogni pastu creatu nanzu oghje passa automaticamente in u passatu.", "Munetios Pasti", "Logo di Munetios Pasti", "Cuntenutu di i pasti", "Cuntenutu di u calendariu", "Circà pasti", "Statu di i pasti", "Statu di u calendariu", "Lista di i pasti",
      "Veduta mensile di u calendariu", "Mustrà o piattà u menu laterale", "Apre a ricerca", "Apre i favuriti", "Apre l’aiutu", "Apre i parametri", "Apre l’applicazioni", "Rilevazione autumatica", "Pastu arregistratu, ma l’avvenimentu di u Calendariu ùn hè micca statu sincrunizatu."], "co"), ...zip(REST, [
      "Pasti", "Calendariu", "Aghjunghje un pastu", "Favuriti", "Aiutu", "Parametri", "Creà", "Arregistrà u pastu", "Arregistrà i cambiamenti", "Annullà", "Circà pasti", "Caricamentu di i pasti", "Caricamentu di u calendariu",
      "Nisunu pastu trovu", "Pruvate un’altra ricerca, cambiate i filtri, o aghjunghjite un pastu novu à a vostra lista.", "Nisunu favuritu per avà", "Mettite pasti in i favuriti da a lista per ritruvalli quì in furia.", "I pasti ùn si sò micca caricati", "U vostru navigatore hà bluccatu IndexedDB per sta pagina. Ricaricate dopu avè permessu a memoria lucale.", "Espurtà i dati", "Impurtà i dati", "Sguassà tutti i favuriti", "Sguassà tutti i pasti",
      "E preferenze sò arregistrate nant’à st’apparechju.", "Pastu novu", "Aghjunghje un pastu", "Mudificà u pastu", "Aghjurnà u pastu", "Veduta mensile", "Facultativu. Caricate un schedariu s’è vo vulete un’imagine nant’à a carta di u pastu.", "Tema", "Furmatu di data", "Lingua", "Aspettu", "Avanzatu",
      "Aiutu", "Tutti i pasti", "Pasti attuali", "Pasti passati", "Arregistrati", "Pastu", "Oghje", "Passatu", "in", "Pianificatore di pasti IndexedDB", "Cronolugia di i pasti", "Pasti arregistrati", "Nome di u pastu", "Tipu di pastu",
      "Tipi di pastu", "Alimenti o ingredienti", "Separate l’elementi cù virgule.", "Note", "Imagine di u pastu", "Ciotula di risu è pollu", "Risu, pollu, cucumaru, oliu piccante", "Prestu fattu, ricu in prutei, bonu da cucinà in quantità.", "Anteprima di u pastu sceltu", "Fighjate i pasti arregistrati raggruppati secondu u ghjornu di creazione.",
      "Clazione", "Pranzu", "Cena", "Preferenze", "Applicazioni Munetios", "Fighjate l’applicazioni Munetios in u spaziu di i pasti.", "Ritornu"], "co rest") },
  };
  extras["es-US"] = extras["es-419"];
  extras["fr-CA"] = { mealTypeSnack: "Collation" };
  window.MealsLocaleExtras = extras;
})();
