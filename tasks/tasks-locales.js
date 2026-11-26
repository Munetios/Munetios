/*
 * Munetios Tasks strings for the 17 global Munetios locales that the tables in index.html lack.
 * Keys are flat paths into the nested tables ("messages.taskCreated"). index.html composes them with
 * shared/munetios-locales.js, which derives zh-TW, es-US, es-ES, fr-CA, pt-PT, and en-GB.
 */
(() => {
  "use strict";
  const L = window.MunetiosLocales;
  const zip = (keys, list, label) => {
    if (keys.length !== list.length) throw new Error(`Tasks ${label}: ${list.length} strings for ${keys.length} keys`);
    return L.rows(keys, list);
  };
  const NOTIFY = ["buttons.enableNotifications", "labels.reminderTime", "labels.taskReminderTime", "labels.dueNow", "modals.notifications", "messages.notificationIntro", "messages.notificationsEnabled",
    "messages.notificationsBlocked", "messages.notificationsUnavailable", "messages.noNotifications", "messages.reminderDue"];
  const ALL = ["sidebar.tasks", "sidebar.completed", "sidebar.favorites", "sidebar.categories", "sidebar.inProgress", "sidebar.archived", "sidebar.trash", "sidebar.settings", "pages.completedTasks", "pages.archivedTasks", "pages.inProgressTasks",
    "buttons.createTask", "buttons.addCategory", "buttons.addOption", "buttons.setDueDate", "buttons.selectCategory", "buttons.printAllTasks", "buttons.save", "buttons.cancel", "buttons.confirm", "buttons.add", "buttons.archiveAll",
    "buttons.deleteAllCompleted", "buttons.exportTasks", "buttons.importTasks", "buttons.resetKey", "buttons.deleteAllData", "buttons.close", "placeholders.taskTitle", "placeholders.taskDescription", "placeholders.categoryName",
    "placeholders.searchTasks", "placeholders.option", "placeholders.newOption", "placeholders.subtaskName", "labels.theme", "labels.language", "labels.reduceTransparency", "labels.dueDate", "actions.markComplete", "actions.favorite",
    "actions.unfavorite", "actions.archive", "actions.unarchive", "actions.edit", "actions.print", "actions.moveToTrash", "actions.restore", "actions.deletePermanently", "actions.addSubtask", "actions.share", "modals.editTask",
    "modals.addSubtask", "modals.customColor", "modals.help", "modals.apps", "messages.noTasks", "messages.noCompleted", "messages.noFavorites", "messages.noInProgress", "messages.noArchived", "messages.trashEmpty",
    "messages.noTasksFound", "messages.categoryAdded", "messages.imageAdded", "messages.taskCreated", "messages.taskCompleted", "messages.addedToFavorites", "messages.removedFromFavorites", "messages.archived", "messages.unarchived",
    "messages.movedToTrash", "messages.restored", "messages.permanentlyDeleted", "messages.taskUpdated", "messages.subtaskAdded", "messages.allDataDeleted", "messages.transparencyReduced", "messages.transparencyRestored",
    "messages.encryptionKeyReset", "messages.tasksExported", "messages.tasksImported", "messages.shareNotSupported", "messages.noTasksToArchive", "messages.noCompletedToDelete", "messages.tasksArchived", "messages.tasksDeleted",
    "messages.errorImporting", "messages.taskMovedToProgress", "messages.typeToSearch", "messages.titleCannotBeEmpty", "messages.subtaskCannotBeEmpty", "messages.enterTaskTitle", "messages.customColorApplied",
    "messages.themeChangedTo", "messages.languageChangedTo", "messages.allItemsChecked", "confirm.archiveTasks", "confirm.completedTasks", "confirm.task", "confirm.resetEncryption", "confirm.deleteAllConfirm", "confirm.deletePermanentConfirm"];

  const extras = {
    "zh-CN": zip(NOTIFY, ["启用桌面通知", "提醒时间", "任务提醒时间", "现在到期", "通知", "开启权限后，任务提醒会使用桌面通知。", "已启用桌面通知", "通知已被阻止", "此浏览器不支持桌面通知", "没有已安排的提醒", "任务提醒"], "zh"),
    ko: zip(NOTIFY, ["데스크톱 알림 사용", "알림 시간", "할 일 알림 시간", "지금 마감", "알림", "권한을 허용하면 할 일 알림이 데스크톱 알림으로 표시됩니다.", "데스크톱 알림을 사용합니다", "알림이 차단되었습니다", "이 브라우저에서는 데스크톱 알림을 사용할 수 없습니다", "예약된 알림 없음", "할 일 알림"], "ko"),
    hi: zip(NOTIFY, ["डेस्कटॉप सूचनाएँ चालू करें", "रिमाइंडर का समय", "कार्य रिमाइंडर का समय", "अभी देय", "सूचनाएँ", "अनुमति चालू होने पर कार्य रिमाइंडर डेस्कटॉप सूचनाओं से आते हैं।", "डेस्कटॉप सूचनाएँ चालू हैं", "सूचनाएँ ब्लॉक हैं", "इस ब्राउज़र में डेस्कटॉप सूचनाएँ उपलब्ध नहीं हैं", "कोई रिमाइंडर शेड्यूल नहीं है", "कार्य रिमाइंडर"], "hi"),
    de: { "modals.apps": "Munetios-Apps" },
    ar: { ...zip(NOTIFY, ["تفعيل إشعارات سطح المكتب", "وقت التذكير", "وقت تذكير المهمة", "مستحقة الآن", "الإشعارات", "تستخدم تذكيرات المهام إشعارات سطح المكتب عند منح الإذن.", "تم تفعيل إشعارات سطح المكتب", "الإشعارات محظورة", "إشعارات سطح المكتب غير متاحة في هذا المتصفح", "لا توجد تذكيرات مجدولة", "تذكير بمهمة"], "ar n"), ...zip(ALL, [
      "المهام", "المكتملة", "المفضلة", "الفئات", "قيد التنفيذ", "المؤرشفة", "سلة المهملات", "الإعدادات", "المهام المكتملة", "المهام المؤرشفة", "قيد التنفيذ",
      "إنشاء مهمة", "إضافة فئة", "إضافة خيار", "تحديد تاريخ الاستحقاق", "اختيار فئة", "طباعة كل المهام", "حفظ", "إلغاء", "تأكيد", "إضافة", "أرشفة كل المهام",
      "حذف كل المهام المكتملة", "تصدير المهام", "استيراد المهام", "إعادة تعيين مفتاح التشفير", "حذف كل البيانات", "إغلاق", "عنوان المهمة", "وصف المهمة", "اسم الفئة",
      "البحث في المهام", "خيار", "خيار جديد", "اسم المهمة الفرعية", "المظهر", "اللغة", "تقليل الشفافية", "الاستحقاق:", "وضع علامة مكتملة", "إضافة إلى المفضلة",
      "إزالة من المفضلة", "أرشفة", "إلغاء الأرشفة", "تعديل", "طباعة", "نقل إلى سلة المهملات", "استعادة", "حذف نهائي", "إضافة مهمة فرعية", "مشاركة", "تعديل المهمة",
      "إضافة مهمة فرعية", "لون مميز مخصص", "المساعدة", "تطبيقات Munetios", "لا توجد مهام بعد. أنشئ مهمة في الأعلى!", "لا توجد مهام مكتملة", "لا توجد مهام مفضلة", "لا توجد مهام قيد التنفيذ", "لا توجد مهام مؤرشفة", "سلة المهملات فارغة",
      "لم يُعثر على مهام لـ", "تمت إضافة الفئة!", "تمت إضافة الصورة!", "تم إنشاء المهمة!", "اكتملت المهمة!", "تمت الإضافة إلى المفضلة!", "تمت الإزالة من المفضلة", "تمت أرشفة المهمة!", "تم إلغاء الأرشفة!",
      "تم النقل إلى سلة المهملات!", "تمت الاستعادة من سلة المهملات!", "تم حذف المهمة نهائيًا!", "تم تحديث المهمة!", "تمت إضافة المهمة الفرعية!", "تم حذف كل البيانات!", "تم تقليل الشفافية", "تمت استعادة الشفافية",
      "تمت إعادة تعيين مفتاح التشفير!", "تم تصدير المهام بنجاح!", "تم استيراد المهام بنجاح!", "المشاركة غير مدعومة", "لا توجد مهام لأرشفتها", "لا توجد مهام مكتملة لحذفها", "مهمة (مهام) مؤرشفة!", "مهمة (مهام) محذوفة!",
      "تعذّر استيراد المهام: تنسيق الملف غير صالح", "تم نقل المهمة إلى قيد التنفيذ.", "اكتب للبحث في المهام...", "لا يمكن ترك العنوان فارغًا", "لا يمكن ترك المهمة الفرعية فارغة", "يُرجى إدخال عنوان المهمة", "تم تطبيق اللون المخصص!",
      "تم تغيير المظهر إلى", "تم تغيير اللغة إلى", "تم تحديد كل العناصر.", "أرشفة", "مهمة (مهام) مكتملة؟", "مهمة (مهام)؟", "إعادة تعيين مفتاح التشفير؟ سيؤدي هذا إلى مسح كل المهام والفئات!", "حذف كل البيانات؟ لا يمكن التراجع عن هذا الإجراء!", "هل تريد بالتأكيد حذف هذه المهمة نهائيًا؟"], "ar") },
    co: { ...zip(NOTIFY, ["Attivà e nutificazioni di l’urdinatore", "Ora di u rammentu", "Ora di u rammentu di u compitu", "À fà avà", "Nutificazioni", "I rammenti di i compiti adupranu e nutificazioni di l’urdinatore quandu u permessu hè attivu.", "Nutificazioni attivate", "E nutificazioni sò bluccate", "E nutificazioni ùn sò micca dispunibule in stu navigatore", "Nisunu rammentu pianificatu", "Rammentu di compitu"], "co n"), ...zip(ALL, [
      "Compiti", "Compiuti", "Favuriti", "Categurie", "In corsu", "Archiviati", "Rumenzula", "Parametri", "Compiti compiuti", "Compiti archiviati", "In corsu",
      "Creà un compitu", "Aghjunghje una categuria", "Aghjunghje un’opzione", "Definisce a scadenza", "Sceglie una categuria", "Stampà tutti i compiti", "Arregistrà", "Annullà", "Cunfirmà", "Aghjunghje", "Archivià tutti i compiti",
      "Sguassà tutti i compiti compiuti", "Espurtà i compiti", "Impurtà i compiti", "Rinizià a chjave di cifratura", "Sguassà tutti i dati", "Chjode", "Titulu di u compitu", "Discrizzione di u compitu", "Nome di a categuria",
      "Circà compiti", "Opzione", "Opzione nova", "Nome di u sottucompitu", "Tema", "Lingua", "Riduce a trasparenza", "Scadenza:", "Marcà cum’è compiutu", "Mette in i favuriti",
      "Caccià da i favuriti", "Archivià", "Disarchivià", "Mudificà", "Stampà", "Mette in a rumenzula", "Ristabilisce", "Sguassà per sempre", "Aghjunghje un sottucompitu", "Sparte", "Mudificà u compitu",
      "Aghjunghje un sottucompitu", "Culore d’accentu persunalizatu", "Aiutu", "Applicazioni Munetios", "Nisunu compitu per avà. Createne unu quì sopra!", "Nisunu compitu compiutu", "Nisunu compitu favuritu", "Nisunu compitu in corsu", "Nisunu compitu archiviatu", "A rumenzula hè viota",
      "Nisunu compitu trovu per", "Categuria aghjunta!", "Imagine aghjunta!", "Compitu creatu!", "Compitu compiutu!", "Messu in i favuriti!", "Cacciatu da i favuriti", "Compitu archiviatu!", "Disarchiviatu!",
      "Messu in a rumenzula!", "Ristabilitu da a rumenzula!", "Compitu sguassatu per sempre!", "Compitu aghjurnatu!", "Sottucompitu aghjuntu!", "Tutti i dati sguassati!", "Trasparenza ridotta", "Trasparenza ristabilita",
      "Chjave di cifratura riniziata!", "Compiti espurtati!", "Compiti impurtati!", "Spartera micca supportata", "Nisunu compitu à archivià", "Nisunu compitu compiutu à sguassà", "compitu(i) archiviatu(i)!", "compitu(i) sguassatu(i)!",
      "Ùn hè micca statu pussibule d’impurtà i compiti: furmatu di schedariu micca validu", "Compitu passatu in corsu.", "Scrivite per circà compiti...", "U titulu ùn pò micca esse viotu", "U sottucompitu ùn pò micca esse viotu", "Scrivite un titulu di compitu", "Culore persunalizatu applicatu!",
      "Tema cambiatu in", "Lingua cambiata in", "Tutti l’elementi spuntati.", "Archivià", "compitu(i) compiutu(i)?", "compitu(i)?", "Rinizià a chjave di cifratura? Questu sguasserà tutti i compiti è e categurie!", "Sguassà TUTTI i dati? Ùn si pò micca annullà!", "Vulete daveru sguassà stu compitu per sempre?"], "co") },
  };
  // The "name" entry is the language's own name.
  for (const { code, name } of L.LOCALES) extras[code] = { ...(extras[code] || {}), name };
  window.TasksLocaleExtras = extras;
})();
