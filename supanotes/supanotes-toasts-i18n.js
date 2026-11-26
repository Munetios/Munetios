/* Munetios SupaNotes toast messages. The main script still passes English text;
   window.SupaNotesToast matches it and returns the translated text and the right toast type. */
(() => {
  "use strict";
  // [English pattern, key, type]
  const PATTERNS = [
    [/^Image inserted$/, "imageInserted", "success"],
    [/^Please enter a URL$/, "enterUrl", "error"],
    [/^Link inserted$/, "linkInserted", "success"],
    [/^Microphone access denied$/, "micDenied", "error"],
    [/^Voice note inserted$/, "voiceInserted", "success"],
    [/^Drawing inserted$/, "drawingInserted", "success"],
    [/^Note is empty$/, "noteEmpty", "error"],
    [/^Note updated$/, "noteUpdated", "success"],
    [/^Note saved$/, "noteSaved", "success"],
    [/^Note restored$/, "noteRestored", "success"],
    [/^Moved to Trash$/, "movedToTrash", "info"],
    [/^Tag removed$/, "tagRemoved", "info"],
    [/^Tag added$/, "tagAdded", "success"],
    [/^Tag deleted$/, "tagDeleted", "info"],
    [/^Enter a tag name$/, "enterTagName", "error"],
    [/^Tag created$/, "tagCreated", "success"],
    [/^Permanently deleted$/, "deletedForever", "info"],
    [/^Enter a font name$/, "enterFontName", "error"],
    [/^All notes moved to Trash$/, "allMovedToTrash", "info"],
    [/^Notes exported$/, "notesExported", "success"],
    [/^Key reset\. Reloading\.\.\.$/, "keyReset", "info"],
    [/^All notes deleted$/, "allDeleted", "info"],
    [/^Added to Favorites$/, "addedFavorites", "success"],
    [/^Removed from Favorites$/, "removedFavorites", "info"],
    [/^Font: (.+)$/, "font", "success", "name"],
    [/^Imported (\d+) notes$/, "imported", "success", "count"],
    [/^Import failed: (.*)$/, "importFailed", "error", "error"],
    [/^Init error: (.*)$/, "initError", "error", "error"],
  ];
  const T = {
    en: { imageInserted: "Image inserted", enterUrl: "Enter a web address", linkInserted: "Link inserted", micDenied: "Microphone access was denied", voiceInserted: "Voice note inserted", drawingInserted: "Drawing inserted", noteEmpty: "This note is empty", noteUpdated: "Note updated", noteSaved: "Note saved", noteRestored: "Note restored", movedToTrash: "Moved to trash", tagRemoved: "Tag removed", tagAdded: "Tag added", tagDeleted: "Tag deleted", enterTagName: "Enter a tag name", tagCreated: "Tag created", deletedForever: "Deleted permanently", enterFontName: "Enter a font name", allMovedToTrash: "All notes moved to trash", notesExported: "Notes exported", keyReset: "Key reset. Reloading…", allDeleted: "All notes deleted", addedFavorites: "Added to favorites", removedFavorites: "Removed from favorites", font: "Font: {name}", imported: "Imported: {count}", importFailed: "Couldn't import: {error}", initError: "Couldn't start SupaNotes: {error}" },
    es: { imageInserted: "Imagen insertada", enterUrl: "Ingresa una dirección web", linkInserted: "Enlace insertado", micDenied: "Se denegó el acceso al micrófono", voiceInserted: "Nota de voz insertada", drawingInserted: "Dibujo insertado", noteEmpty: "Esta nota está vacía", noteUpdated: "Nota actualizada", noteSaved: "Nota guardada", noteRestored: "Nota restaurada", movedToTrash: "Se movió a la papelera", tagRemoved: "Etiqueta quitada", tagAdded: "Etiqueta agregada", tagDeleted: "Etiqueta eliminada", enterTagName: "Ingresa un nombre de etiqueta", tagCreated: "Etiqueta creada", deletedForever: "Se eliminó definitivamente", enterFontName: "Ingresa un nombre de fuente", allMovedToTrash: "Todas las notas se movieron a la papelera", notesExported: "Notas exportadas", keyReset: "Clave restablecida. Recargando…", allDeleted: "Se eliminaron todas las notas", addedFavorites: "Se agregó a favoritos", removedFavorites: "Se quitó de favoritos", font: "Fuente: {name}", imported: "Importadas: {count}", importFailed: "No se pudo importar: {error}", initError: "No se pudo iniciar SupaNotes: {error}" },
    fr: { imageInserted: "Image insérée", enterUrl: "Saisissez une adresse web", linkInserted: "Lien inséré", micDenied: "L’accès au micro a été refusé", voiceInserted: "Note vocale insérée", drawingInserted: "Dessin inséré", noteEmpty: "Cette note est vide", noteUpdated: "Note mise à jour", noteSaved: "Note enregistrée", noteRestored: "Note restaurée", movedToTrash: "Déplacée dans la corbeille", tagRemoved: "Étiquette retirée", tagAdded: "Étiquette ajoutée", tagDeleted: "Étiquette supprimée", enterTagName: "Saisissez un nom d’étiquette", tagCreated: "Étiquette créée", deletedForever: "Supprimée définitivement", enterFontName: "Saisissez un nom de police", allMovedToTrash: "Toutes les notes ont été déplacées dans la corbeille", notesExported: "Notes exportées", keyReset: "Clé réinitialisée. Rechargement…", allDeleted: "Toutes les notes ont été supprimées", addedFavorites: "Ajoutée aux favoris", removedFavorites: "Retirée des favoris", font: "Police : {name}", imported: "Importées : {count}", importFailed: "Importation impossible : {error}", initError: "Impossible de démarrer SupaNotes : {error}" },
    de: { imageInserted: "Bild eingefügt", enterUrl: "Gib eine Webadresse ein", linkInserted: "Link eingefügt", micDenied: "Der Mikrofonzugriff wurde verweigert", voiceInserted: "Sprachnotiz eingefügt", drawingInserted: "Zeichnung eingefügt", noteEmpty: "Diese Notiz ist leer", noteUpdated: "Notiz aktualisiert", noteSaved: "Notiz gespeichert", noteRestored: "Notiz wiederhergestellt", movedToTrash: "In den Papierkorb verschoben", tagRemoved: "Tag entfernt", tagAdded: "Tag hinzugefügt", tagDeleted: "Tag gelöscht", enterTagName: "Gib einen Tag-Namen ein", tagCreated: "Tag erstellt", deletedForever: "Endgültig gelöscht", enterFontName: "Gib einen Schriftnamen ein", allMovedToTrash: "Alle Notizen in den Papierkorb verschoben", notesExported: "Notizen exportiert", keyReset: "Schlüssel zurückgesetzt. Wird neu geladen…", allDeleted: "Alle Notizen gelöscht", addedFavorites: "Zu Favoriten hinzugefügt", removedFavorites: "Aus Favoriten entfernt", font: "Schrift: {name}", imported: "Importiert: {count}", importFailed: "Import nicht möglich: {error}", initError: "SupaNotes konnte nicht gestartet werden: {error}" },
    it: { imageInserted: "Immagine inserita", enterUrl: "Inserisci un indirizzo web", linkInserted: "Link inserito", micDenied: "L’accesso al microfono è stato negato", voiceInserted: "Nota vocale inserita", drawingInserted: "Disegno inserito", noteEmpty: "Questa nota è vuota", noteUpdated: "Nota aggiornata", noteSaved: "Nota salvata", noteRestored: "Nota ripristinata", movedToTrash: "Spostata nel cestino", tagRemoved: "Etichetta rimossa", tagAdded: "Etichetta aggiunta", tagDeleted: "Etichetta eliminata", enterTagName: "Inserisci un nome per l’etichetta", tagCreated: "Etichetta creata", deletedForever: "Eliminata definitivamente", enterFontName: "Inserisci il nome di un carattere", allMovedToTrash: "Tutte le note spostate nel cestino", notesExported: "Note esportate", keyReset: "Chiave reimpostata. Ricaricamento…", allDeleted: "Tutte le note eliminate", addedFavorites: "Aggiunta ai preferiti", removedFavorites: "Rimossa dai preferiti", font: "Carattere: {name}", imported: "Importate: {count}", importFailed: "Impossibile importare: {error}", initError: "Impossibile avviare SupaNotes: {error}" },
    pt: { imageInserted: "Imagem inserida", enterUrl: "Digite um endereço da web", linkInserted: "Link inserido", micDenied: "O acesso ao microfone foi negado", voiceInserted: "Nota de voz inserida", drawingInserted: "Desenho inserido", noteEmpty: "Esta nota está vazia", noteUpdated: "Nota atualizada", noteSaved: "Nota salva", noteRestored: "Nota restaurada", movedToTrash: "Movida para a lixeira", tagRemoved: "Etiqueta removida", tagAdded: "Etiqueta adicionada", tagDeleted: "Etiqueta excluída", enterTagName: "Digite um nome de etiqueta", tagCreated: "Etiqueta criada", deletedForever: "Excluída permanentemente", enterFontName: "Digite o nome de uma fonte", allMovedToTrash: "Todas as notas foram movidas para a lixeira", notesExported: "Notas exportadas", keyReset: "Chave redefinida. Recarregando…", allDeleted: "Todas as notas foram excluídas", addedFavorites: "Adicionada aos favoritos", removedFavorites: "Removida dos favoritos", font: "Fonte: {name}", imported: "Importadas: {count}", importFailed: "Não foi possível importar: {error}", initError: "Não foi possível iniciar o SupaNotes: {error}" },
    ja: { imageInserted: "画像を挿入しました", enterUrl: "ウェブアドレスを入力してください", linkInserted: "リンクを挿入しました", micDenied: "マイクへのアクセスが拒否されました", voiceInserted: "ボイスメモを挿入しました", drawingInserted: "描画を挿入しました", noteEmpty: "このメモは空です", noteUpdated: "メモを更新しました", noteSaved: "メモを保存しました", noteRestored: "メモを復元しました", movedToTrash: "ゴミ箱に移動しました", tagRemoved: "タグを外しました", tagAdded: "タグを追加しました", tagDeleted: "タグを削除しました", enterTagName: "タグ名を入力してください", tagCreated: "タグを作成しました", deletedForever: "完全に削除しました", enterFontName: "フォント名を入力してください", allMovedToTrash: "すべてのメモをゴミ箱に移動しました", notesExported: "メモをエクスポートしました", keyReset: "キーをリセットしました。再読み込みしています…", allDeleted: "すべてのメモを削除しました", addedFavorites: "お気に入りに追加しました", removedFavorites: "お気に入りから削除しました", font: "フォント: {name}", imported: "インポート: {count}", importFailed: "インポートできませんでした: {error}", initError: "SupaNotes を起動できませんでした: {error}" },
    zh: { imageInserted: "已插入图片", enterUrl: "请输入网址", linkInserted: "已插入链接", micDenied: "麦克风访问被拒绝", voiceInserted: "已插入语音笔记", drawingInserted: "已插入绘图", noteEmpty: "此笔记为空", noteUpdated: "笔记已更新", noteSaved: "笔记已保存", noteRestored: "笔记已恢复", movedToTrash: "已移到回收站", tagRemoved: "已移除标签", tagAdded: "已添加标签", tagDeleted: "已删除标签", enterTagName: "请输入标签名称", tagCreated: "已创建标签", deletedForever: "已永久删除", enterFontName: "请输入字体名称", allMovedToTrash: "所有笔记已移到回收站", notesExported: "笔记已导出", keyReset: "密钥已重置，正在重新加载…", allDeleted: "所有笔记已删除", addedFavorites: "已添加到收藏", removedFavorites: "已从收藏中移除", font: "字体：{name}", imported: "已导入：{count}", importFailed: "无法导入：{error}", initError: "无法启动 SupaNotes：{error}" },
    ru: { imageInserted: "Изображение вставлено", enterUrl: "Введите веб-адрес", linkInserted: "Ссылка вставлена", micDenied: "Доступ к микрофону запрещен", voiceInserted: "Голосовая заметка вставлена", drawingInserted: "Рисунок вставлен", noteEmpty: "Эта заметка пуста", noteUpdated: "Заметка обновлена", noteSaved: "Заметка сохранена", noteRestored: "Заметка восстановлена", movedToTrash: "Перемещено в корзину", tagRemoved: "Метка снята", tagAdded: "Метка добавлена", tagDeleted: "Метка удалена", enterTagName: "Введите название метки", tagCreated: "Метка создана", deletedForever: "Удалено навсегда", enterFontName: "Введите название шрифта", allMovedToTrash: "Все заметки перемещены в корзину", notesExported: "Заметки экспортированы", keyReset: "Ключ сброшен. Перезагрузка…", allDeleted: "Все заметки удалены", addedFavorites: "Добавлено в избранное", removedFavorites: "Удалено из избранного", font: "Шрифт: {name}", imported: "Импортировано: {count}", importFailed: "Не удалось импортировать: {error}", initError: "Не удалось запустить SupaNotes: {error}" },
    ar: { imageInserted: "تم إدراج الصورة", enterUrl: "أدخل عنوان ويب", linkInserted: "تم إدراج الرابط", micDenied: "تم رفض الوصول إلى الميكروفون", voiceInserted: "تم إدراج الملاحظة الصوتية", drawingInserted: "تم إدراج الرسم", noteEmpty: "هذه الملاحظة فارغة", noteUpdated: "تم تحديث الملاحظة", noteSaved: "تم حفظ الملاحظة", noteRestored: "تمت استعادة الملاحظة", movedToTrash: "نُقلت إلى سلة المهملات", tagRemoved: "تمت إزالة الوسم", tagAdded: "تمت إضافة الوسم", tagDeleted: "تم حذف الوسم", enterTagName: "أدخل اسم الوسم", tagCreated: "تم إنشاء الوسم", deletedForever: "حُذفت نهائيًا", enterFontName: "أدخل اسم الخط", allMovedToTrash: "نُقلت كل الملاحظات إلى سلة المهملات", notesExported: "تم تصدير الملاحظات", keyReset: "تمت إعادة ضبط المفتاح. جارٍ إعادة التحميل…", allDeleted: "تم حذف كل الملاحظات", addedFavorites: "تمت الإضافة إلى المفضلة", removedFavorites: "تمت الإزالة من المفضلة", font: "الخط: {name}", imported: "تم الاستيراد: {count}", importFailed: "تعذّر الاستيراد: {error}", initError: "تعذّر تشغيل SupaNotes: {error}" },
  };
  const lang = () => {
    let l = "en";
    try { l = (window.SupaNotesApp && window.SupaNotesApp.language()) || localStorage.getItem("sn_language") || "en"; } catch {}
    return T[l] ? l : "en";
  };
  const ERROR_HINT = /error|fail|invalid|denied|couldn't|could not|empty|please|enter /i;
  window.SupaNotesToast = function (message) {
    const text = String(message);
    for (const [re, key, type, varName] of PATTERNS) {
      const m = text.match(re);
      if (!m) continue;
      let value = T[lang()][key] || T.en[key];
      if (varName) value = value.split("{" + varName + "}").join(m[1]);
      return { text: value, type };
    }
    return { text, type: ERROR_HINT.test(text) ? "error" : "success" };
  };
})();
