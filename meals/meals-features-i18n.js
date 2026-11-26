/* Munetios Meals feature strings. Each language lists the strings in KEYS order. */
(() => {
  "use strict";
  const KEYS = [
    "week", "weekPlanner", "weekPlannerHelp", "shoppingList", "shoppingHelp", "when", "servings", "prepTime", "cookTime", "nutrition",
    "calories", "protein", "carbs", "fat", "dietaryTags", "dietVegetarian", "dietVegan", "dietGlutenFree", "dietDairyFree", "dietHighProtein",
    "dietLowCarb", "dietNutFree", "steps", "stepsPlaceholder", "kcalValue", "proteinShort", "carbsShort", "fatShort", "minutesValue", "servingsValue",
    "rating", "rateStars", "viewRecipe", "planAgain", "planned", "close", "prepValue", "cookValue", "fewerServings", "moreServings",
    "ingredients", "noIngredients", "noSteps", "notes", "print", "edit", "sortBy", "sortNewest", "sortOldest", "sortName",
    "sortRating", "sortCalories", "filterDiet", "allMeals", "calorieGoal", "todayCalories", "overGoal", "leftToGoal", "previousWeek", "nextWeek",
    "thisWeek", "addMealTo", "range", "next7Days", "allUpcoming", "addItemPlaceholder", "addItem", "copied", "copyFailed", "copyList",
    "download", "clearChecked", "shoppingEmpty", "removeItem", "dailyCalorieGoal", "dailyCalorieGoalHelp",
  ];
  const DATA = {
    en: [
      "Week", "Week planner", "Plan breakfast, lunch, dinner, and snacks for the whole week.", "Shopping list", "Ingredients from your upcoming meals, combined into one list.", "Date and time", "Servings", "Prep time (minutes)", "Cook time (minutes)", "Nutrition",
      "Calories (kcal)", "Protein (g)", "Carbs (g)", "Fat (g)", "Dietary tags", "Vegetarian", "Vegan", "Gluten-free", "Dairy-free", "High protein",
      "Low carb", "Nut-free", "Steps", "One step per line", "{value} kcal", "Protein {value} g", "Carbs {value} g", "Fat {value} g", "{value} min", "Servings: {value}",
      "Rating", "Rate {count} out of 5", "View recipe", "Plan again", "Planned for {date}", "Close", "Prep: {value} min", "Cook: {value} min", "Fewer servings", "More servings",
      "Ingredients", "No ingredients added", "No steps added", "Notes", "Print", "Edit", "Sort by", "Newest first", "Oldest first", "Name",
      "Rating", "Calories", "Filter by dietary tag", "All meals", "Calorie goal", "Today: {kcal} of {goal} kcal", "Over your goal by {value} kcal", "Left for today: {value} kcal", "Previous week", "Next week",
      "This week", "Add {type} on {day}", "Range", "Next 7 days", "All upcoming", "Add an item, like paper towels", "Add item", "Copied", "Couldn't copy", "Copy list",
      "Download", "Clear checked", "No ingredients from upcoming meals yet", "Remove item", "Daily calorie goal (kcal)", "Used for the Today summary on All Meals.",
    ],
    es: [
      "Semana", "Planificador semanal", "Planifica el desayuno, el almuerzo, la cena y los refrigerios de toda la semana.", "Lista de compras", "Los ingredientes de tus próximas comidas, reunidos en una sola lista.", "Fecha y hora", "Porciones", "Tiempo de preparación (minutos)", "Tiempo de cocción (minutos)", "Nutrición",
      "Calorías (kcal)", "Proteínas (g)", "Carbohidratos (g)", "Grasas (g)", "Etiquetas alimentarias", "Vegetariana", "Vegana", "Sin gluten", "Sin lácteos", "Alta en proteínas",
      "Baja en carbohidratos", "Sin frutos secos", "Pasos", "Un paso por línea", "{value} kcal", "Proteínas {value} g", "Carbohidratos {value} g", "Grasas {value} g", "{value} min", "Porciones: {value}",
      "Calificación", "Calificar con {count} de 5", "Ver receta", "Volver a planificar", "Planificada para el {date}", "Cerrar", "Preparación: {value} min", "Cocción: {value} min", "Menos porciones", "Más porciones",
      "Ingredientes", "No se agregaron ingredientes", "No se agregaron pasos", "Notas", "Imprimir", "Editar", "Ordenar por", "Más recientes primero", "Más antiguas primero", "Nombre",
      "Calificación", "Calorías", "Filtrar por etiqueta alimentaria", "Todas las comidas", "Meta de calorías", "Hoy: {kcal} de {goal} kcal", "Superaste tu meta por {value} kcal", "Te quedan hoy: {value} kcal", "Semana anterior", "Semana siguiente",
      "Esta semana", "Agregar {type} el {day}", "Período", "Próximos 7 días", "Todas las próximas", "Agrega un artículo, como toallas de papel", "Agregar artículo", "Copiado", "No se pudo copiar", "Copiar lista",
      "Descargar", "Borrar marcados", "Aún no hay ingredientes de próximas comidas", "Quitar artículo", "Meta diaria de calorías (kcal)", "Se usa en el resumen de hoy de Todas las comidas.",
    ],
    fr: [
      "Semaine", "Planificateur de la semaine", "Planifiez le petit-déjeuner, le déjeuner, le dîner et les collations de toute la semaine.", "Liste de courses", "Les ingrédients de vos prochains repas, regroupés dans une seule liste.", "Date et heure", "Portions", "Préparation (minutes)", "Cuisson (minutes)", "Nutrition",
      "Calories (kcal)", "Protéines (g)", "Glucides (g)", "Lipides (g)", "Régimes alimentaires", "Végétarien", "Végan", "Sans gluten", "Sans lactose", "Riche en protéines",
      "Pauvre en glucides", "Sans fruits à coque", "Étapes", "Une étape par ligne", "{value} kcal", "Protéines {value} g", "Glucides {value} g", "Lipides {value} g", "{value} min", "Portions : {value}",
      "Note", "Noter {count} sur 5", "Voir la recette", "Replanifier", "Prévu le {date}", "Fermer", "Préparation : {value} min", "Cuisson : {value} min", "Moins de portions", "Plus de portions",
      "Ingrédients", "Aucun ingrédient ajouté", "Aucune étape ajoutée", "Notes", "Imprimer", "Modifier", "Trier par", "Plus récents d’abord", "Plus anciens d’abord", "Nom",
      "Note", "Calories", "Filtrer par régime", "Tous les repas", "Objectif calorique", "Aujourd’hui : {kcal} sur {goal} kcal", "Objectif dépassé de {value} kcal", "Reste pour aujourd’hui : {value} kcal", "Semaine précédente", "Semaine suivante",
      "Cette semaine", "Ajouter : {type}, {day}", "Période", "7 prochains jours", "Tous les repas à venir", "Ajoutez un article, par exemple de l’essuie-tout", "Ajouter un article", "Copié", "Impossible de copier", "Copier la liste",
      "Télécharger", "Effacer les articles cochés", "Aucun ingrédient pour les prochains repas", "Retirer l’article", "Objectif calorique quotidien (kcal)", "Utilisé pour le résumé du jour dans Tous les repas.",
    ],
    de: [
      "Woche", "Wochenplaner", "Plane Frühstück, Mittagessen, Abendessen und Snacks für die ganze Woche.", "Einkaufsliste", "Zutaten aus deinen kommenden Mahlzeiten in einer Liste.", "Datum und Uhrzeit", "Portionen", "Vorbereitung (Minuten)", "Kochzeit (Minuten)", "Nährwerte",
      "Kalorien (kcal)", "Eiweiß (g)", "Kohlenhydrate (g)", "Fett (g)", "Ernährungsmerkmale", "Vegetarisch", "Vegan", "Glutenfrei", "Laktosefrei", "Eiweißreich",
      "Kohlenhydratarm", "Nussfrei", "Schritte", "Ein Schritt pro Zeile", "{value} kcal", "Eiweiß {value} g", "Kohlenhydrate {value} g", "Fett {value} g", "{value} Min.", "Portionen: {value}",
      "Bewertung", "Mit {count} von 5 bewerten", "Rezept ansehen", "Erneut planen", "Geplant für {date}", "Schließen", "Vorbereitung: {value} Min.", "Kochen: {value} Min.", "Weniger Portionen", "Mehr Portionen",
      "Zutaten", "Keine Zutaten hinzugefügt", "Keine Schritte hinzugefügt", "Notizen", "Drucken", "Bearbeiten", "Sortieren nach", "Neueste zuerst", "Älteste zuerst", "Name",
      "Bewertung", "Kalorien", "Nach Ernährungsmerkmal filtern", "Alle Mahlzeiten", "Kalorienziel", "Heute: {kcal} von {goal} kcal", "Ziel um {value} kcal überschritten", "Heute noch übrig: {value} kcal", "Vorherige Woche", "Nächste Woche",
      "Diese Woche", "{type} am {day} hinzufügen", "Zeitraum", "Nächste 7 Tage", "Alle kommenden", "Artikel hinzufügen, z. B. Küchenrolle", "Artikel hinzufügen", "Kopiert", "Kopieren nicht möglich", "Liste kopieren",
      "Herunterladen", "Abgehakte entfernen", "Noch keine Zutaten aus kommenden Mahlzeiten", "Artikel entfernen", "Tägliches Kalorienziel (kcal)", "Wird für die Tagesübersicht unter „Alle Mahlzeiten“ verwendet.",
    ],
    pt: [
      "Semana", "Planejador semanal", "Planeje café da manhã, almoço, jantar e lanches da semana inteira.", "Lista de compras", "Os ingredientes das suas próximas refeições, reunidos em uma lista.", "Data e hora", "Porções", "Preparo (minutos)", "Cozimento (minutos)", "Nutrição",
      "Calorias (kcal)", "Proteínas (g)", "Carboidratos (g)", "Gorduras (g)", "Restrições alimentares", "Vegetariana", "Vegana", "Sem glúten", "Sem lactose", "Rica em proteínas",
      "Baixo carboidrato", "Sem oleaginosas", "Etapas", "Uma etapa por linha", "{value} kcal", "Proteínas {value} g", "Carboidratos {value} g", "Gorduras {value} g", "{value} min", "Porções: {value}",
      "Avaliação", "Avaliar com {count} de 5", "Ver receita", "Planejar de novo", "Planejada para {date}", "Fechar", "Preparo: {value} min", "Cozimento: {value} min", "Menos porções", "Mais porções",
      "Ingredientes", "Nenhum ingrediente adicionado", "Nenhuma etapa adicionada", "Observações", "Imprimir", "Editar", "Ordenar por", "Mais recentes primeiro", "Mais antigas primeiro", "Nome",
      "Avaliação", "Calorias", "Filtrar por restrição alimentar", "Todas as refeições", "Meta de calorias", "Hoje: {kcal} de {goal} kcal", "Você passou da meta em {value} kcal", "Restam hoje: {value} kcal", "Semana anterior", "Próxima semana",
      "Esta semana", "Adicionar {type} em {day}", "Período", "Próximos 7 dias", "Todas as próximas", "Adicione um item, como papel-toalha", "Adicionar item", "Copiado", "Não foi possível copiar", "Copiar lista",
      "Baixar", "Limpar marcados", "Ainda não há ingredientes das próximas refeições", "Remover item", "Meta diária de calorias (kcal)", "Usada no resumo de hoje em Todas as refeições.",
    ],
    it: [
      "Settimana", "Pianificatore settimanale", "Pianifica colazione, pranzo, cena e spuntini per tutta la settimana.", "Lista della spesa", "Gli ingredienti dei prossimi pasti, riuniti in un’unica lista.", "Data e ora", "Porzioni", "Preparazione (minuti)", "Cottura (minuti)", "Valori nutrizionali",
      "Calorie (kcal)", "Proteine (g)", "Carboidrati (g)", "Grassi (g)", "Esigenze alimentari", "Vegetariano", "Vegano", "Senza glutine", "Senza lattosio", "Ricco di proteine",
      "Povero di carboidrati", "Senza frutta a guscio", "Passaggi", "Un passaggio per riga", "{value} kcal", "Proteine {value} g", "Carboidrati {value} g", "Grassi {value} g", "{value} min", "Porzioni: {value}",
      "Valutazione", "Valuta {count} su 5", "Vedi ricetta", "Pianifica di nuovo", "Pianificato per {date}", "Chiudi", "Preparazione: {value} min", "Cottura: {value} min", "Meno porzioni", "Più porzioni",
      "Ingredienti", "Nessun ingrediente aggiunto", "Nessun passaggio aggiunto", "Note", "Stampa", "Modifica", "Ordina per", "Più recenti prima", "Meno recenti prima", "Nome",
      "Valutazione", "Calorie", "Filtra per esigenza alimentare", "Tutti i pasti", "Obiettivo calorico", "Oggi: {kcal} di {goal} kcal", "Obiettivo superato di {value} kcal", "Rimangono oggi: {value} kcal", "Settimana precedente", "Settimana successiva",
      "Questa settimana", "Aggiungi {type} il {day}", "Periodo", "Prossimi 7 giorni", "Tutti i prossimi", "Aggiungi un articolo, ad esempio carta da cucina", "Aggiungi articolo", "Copiato", "Impossibile copiare", "Copia lista",
      "Scarica", "Cancella selezionati", "Ancora nessun ingrediente dai prossimi pasti", "Rimuovi articolo", "Obiettivo calorico giornaliero (kcal)", "Usato per il riepilogo di oggi in Tutti i pasti.",
    ],
    zh: [
      "周", "每周计划", "规划整周的早餐、午餐、晚餐和零食。", "购物清单", "将即将到来的餐食所需食材汇总到一个清单中。", "日期和时间", "份数", "准备时间（分钟）", "烹饪时间（分钟）", "营养",
      "热量（千卡）", "蛋白质（克）", "碳水化合物（克）", "脂肪（克）", "饮食标签", "素食", "纯素", "无麸质", "无乳制品", "高蛋白",
      "低碳水", "无坚果", "步骤", "每行一个步骤", "{value} 千卡", "蛋白质 {value} 克", "碳水 {value} 克", "脂肪 {value} 克", "{value} 分钟", "份数：{value}",
      "评分", "评为 {count} 星（满分 5 星）", "查看食谱", "再次安排", "已安排在 {date}", "关闭", "准备：{value} 分钟", "烹饪：{value} 分钟", "减少份数", "增加份数",
      "食材", "未添加食材", "未添加步骤", "备注", "打印", "编辑", "排序方式", "最新优先", "最早优先", "名称",
      "评分", "热量", "按饮食标签筛选", "所有餐食", "热量目标", "今天：{kcal} / {goal} 千卡", "已超出目标 {value} 千卡", "今天还剩：{value} 千卡", "上一周", "下一周",
      "本周", "在{day}添加{type}", "范围", "未来 7 天", "所有即将到来的", "添加物品，例如厨房纸巾", "添加物品", "已复制", "无法复制", "复制清单",
      "下载", "清除已勾选", "即将到来的餐食中还没有食材", "移除物品", "每日热量目标（千卡）", "用于“所有餐食”中的今日摘要。",
    ],
    ja: [
      "週", "週間プランナー", "1 週間分の朝食、昼食、夕食、間食を計画します。", "買い物リスト", "予定している食事の材料を 1 つのリストにまとめます。", "日時", "人数分", "下ごしらえ（分）", "調理時間（分）", "栄養",
      "カロリー（kcal）", "たんぱく質（g）", "炭水化物（g）", "脂質（g）", "食事タグ", "ベジタリアン", "ヴィーガン", "グルテンフリー", "乳製品不使用", "高たんぱく",
      "低糖質", "ナッツ不使用", "手順", "1 行に 1 手順", "{value} kcal", "たんぱく質 {value} g", "炭水化物 {value} g", "脂質 {value} g", "{value} 分", "人数分: {value}",
      "評価", "5 段階中 {count} で評価", "レシピを表示", "もう一度予定する", "{date} に予定しました", "閉じる", "下ごしらえ: {value} 分", "調理: {value} 分", "人数を減らす", "人数を増やす",
      "材料", "材料は追加されていません", "手順は追加されていません", "メモ", "印刷", "編集", "並べ替え", "新しい順", "古い順", "名前",
      "評価", "カロリー", "食事タグで絞り込む", "すべての食事", "カロリー目標", "今日: {goal} kcal 中 {kcal} kcal", "目標を {value} kcal 超えています", "今日の残り: {value} kcal", "前の週", "次の週",
      "今週", "{day}に{type}を追加", "期間", "今後 7 日間", "今後のすべて", "キッチンペーパーなどの項目を追加", "項目を追加", "コピーしました", "コピーできませんでした", "リストをコピー",
      "ダウンロード", "チェック済みを削除", "予定している食事の材料はまだありません", "項目を削除", "1 日のカロリー目標（kcal）", "［すべての食事］の今日のまとめに使われます。",
    ],
    sv: [
      "Vecka", "Veckoplanerare", "Planera frukost, lunch, middag och mellanmål för hela veckan.", "Inköpslista", "Ingredienser från dina kommande måltider samlade i en lista.", "Datum och tid", "Portioner", "Förberedelse (minuter)", "Tillagning (minuter)", "Näring",
      "Kalorier (kcal)", "Protein (g)", "Kolhydrater (g)", "Fett (g)", "Kosttaggar", "Vegetarisk", "Vegansk", "Glutenfri", "Mjölkfri", "Proteinrik",
      "Lågkolhydrat", "Nötfri", "Steg", "Ett steg per rad", "{value} kcal", "Protein {value} g", "Kolhydrater {value} g", "Fett {value} g", "{value} min", "Portioner: {value}",
      "Betyg", "Ge {count} av 5", "Visa recept", "Planera igen", "Planerad till {date}", "Stäng", "Förberedelse: {value} min", "Tillagning: {value} min", "Färre portioner", "Fler portioner",
      "Ingredienser", "Inga ingredienser tillagda", "Inga steg tillagda", "Anteckningar", "Skriv ut", "Redigera", "Sortera efter", "Nyast först", "Äldst först", "Namn",
      "Betyg", "Kalorier", "Filtrera efter kosttagg", "Alla måltider", "Kalorimål", "I dag: {kcal} av {goal} kcal", "Över målet med {value} kcal", "Kvar i dag: {value} kcal", "Föregående vecka", "Nästa vecka",
      "Den här veckan", "Lägg till {type} på {day}", "Period", "Kommande 7 dagar", "Alla kommande", "Lägg till en vara, till exempel hushållspapper", "Lägg till vara", "Kopierat", "Kunde inte kopiera", "Kopiera lista",
      "Ladda ned", "Rensa markerade", "Inga ingredienser från kommande måltider än", "Ta bort vara", "Dagligt kalorimål (kcal)", "Används för dagens sammanfattning under Alla måltider.",
    ],
    da: [
      "Uge", "Ugeplanlægger", "Planlæg morgenmad, frokost, aftensmad og snacks for hele ugen.", "Indkøbsliste", "Ingredienser fra dine kommende måltider samlet i én liste.", "Dato og klokkeslæt", "Portioner", "Forberedelse (minutter)", "Tilberedning (minutter)", "Ernæring",
      "Kalorier (kcal)", "Protein (g)", "Kulhydrater (g)", "Fedt (g)", "Kostmærker", "Vegetarisk", "Vegansk", "Glutenfri", "Mælkefri", "Proteinrig",
      "Lav-kulhydrat", "Nøddefri", "Trin", "Ét trin pr. linje", "{value} kcal", "Protein {value} g", "Kulhydrater {value} g", "Fedt {value} g", "{value} min", "Portioner: {value}",
      "Bedømmelse", "Giv {count} ud af 5", "Vis opskrift", "Planlæg igen", "Planlagt til {date}", "Luk", "Forberedelse: {value} min", "Tilberedning: {value} min", "Færre portioner", "Flere portioner",
      "Ingredienser", "Ingen ingredienser tilføjet", "Ingen trin tilføjet", "Noter", "Udskriv", "Rediger", "Sortér efter", "Nyeste først", "Ældste først", "Navn",
      "Bedømmelse", "Kalorier", "Filtrér efter kostmærke", "Alle måltider", "Kaloriemål", "I dag: {kcal} af {goal} kcal", "Over målet med {value} kcal", "Tilbage i dag: {value} kcal", "Forrige uge", "Næste uge",
      "Denne uge", "Tilføj {type} {day}", "Periode", "De næste 7 dage", "Alle kommende", "Tilføj en vare, f.eks. køkkenrulle", "Tilføj vare", "Kopieret", "Kunne ikke kopiere", "Kopiér liste",
      "Download", "Ryd afkrydsede", "Ingen ingredienser fra kommende måltider endnu", "Fjern vare", "Dagligt kaloriemål (kcal)", "Bruges til dagens oversigt under Alle måltider.",
    ],
  };
  Object.assign(DATA, {"ko":["주","주간 계획","한 주 동안의 아침, 점심, 저녁, 간식을 계획하세요.","장보기 목록","다가오는 식사의 재료를 하나의 목록으로 모았습니다.","날짜 및 시간","인분","준비 시간(분)","조리 시간(분)","영양","칼로리(kcal)","단백질(g)","탄수화물(g)","지방(g)","식단 태그","채식","비건","글루텐 프리","유제품 프리","고단백","저탄수화물","견과류 프리","조리 단계","한 줄에 한 단계","{value}kcal","단백질 {value}g","탄수화물 {value}g","지방 {value}g","{value}분","인분: {value}","평점","5점 중 {count}점 주기","레시피 보기","다시 계획","{date}에 계획됨","닫기","준비: {value}분","조리: {value}분","인분 줄이기","인분 늘리기","재료","추가한 재료 없음","추가한 단계 없음","메모","인쇄","편집","정렬 기준","최신순","오래된순","이름","평점","칼로리","식단 태그로 필터","모든 식사","칼로리 목표","오늘: {goal}kcal 중 {kcal}kcal","목표보다 {value}kcal 초과","오늘 남은 양: {value}kcal","이전 주","다음 주","이번 주","{day}에 {type} 추가","기간","다음 7일","예정된 모든 식사","항목 추가(예: 키친타월)","항목 추가","복사됨","복사할 수 없음","목록 복사","다운로드","체크한 항목 지우기","다가오는 식사의 재료가 아직 없습니다","항목 삭제","일일 칼로리 목표(kcal)","모든 식사의 오늘 요약에 사용됩니다."],
    "ar":["الأسبوع","مخطط الأسبوع","خطط للفطور والغداء والعشاء والوجبات الخفيفة طوال الأسبوع.","قائمة التسوق","مكونات وجباتك القادمة مجمّعة في قائمة واحدة.","التاريخ والوقت","الحصص","وقت التحضير (دقائق)","وقت الطهي (دقائق)","القيمة الغذائية","السعرات (kcal)","البروتين (غ)","الكربوهيدرات (غ)","الدهون (غ)","وسوم غذائية","نباتي","نباتي صرف","خالٍ من الغلوتين","خالٍ من الألبان","غني بالبروتين","منخفض الكربوهيدرات","خالٍ من المكسرات","الخطوات","خطوة واحدة في كل سطر","{value} kcal","بروتين {value} غ","كربوهيدرات {value} غ","دهون {value} غ","{value} د","الحصص: {value}","التقييم","قيّم بـ {count} من 5","عرض الوصفة","التخطيط مجددًا","مخطط لـ {date}","إغلاق","التحضير: {value} د","الطهي: {value} د","حصص أقل","حصص أكثر","المكونات","لم تُضف مكونات","لم تُضف خطوات","ملاحظات","طباعة","تعديل","الترتيب حسب","الأحدث أولًا","الأقدم أولًا","الاسم","التقييم","السعرات","التصفية حسب الوسم الغذائي","كل الوجبات","هدف السعرات","اليوم: {kcal} من {goal} kcal","تجاوزت هدفك بـ {value} kcal","المتبقي اليوم: {value} kcal","الأسبوع السابق","الأسبوع التالي","هذا الأسبوع","إضافة {type} يوم {day}","النطاق","الأيام السبعة القادمة","كل القادم","أضف عنصرًا، مثل المناديل الورقية","إضافة عنصر","تم النسخ","تعذّر النسخ","نسخ القائمة","تنزيل","مسح المحدد","لا توجد مكونات من الوجبات القادمة بعد","إزالة العنصر","هدف السعرات اليومي (kcal)","يُستخدم لملخص اليوم في كل الوجبات."],
    "hi":["सप्ताह","साप्ताहिक प्लानर","पूरे सप्ताह का नाश्ता, दोपहर का खाना, रात का खाना और स्नैक्स प्लान करें।","शॉपिंग सूची","आने वाले भोजन की सामग्री, एक ही सूची में।","तारीख और समय","सर्विंग","तैयारी का समय (मिनट)","पकाने का समय (मिनट)","पोषण","कैलोरी (kcal)","प्रोटीन (g)","कार्ब्स (g)","वसा (g)","आहार टैग","शाकाहारी","वीगन","ग्लूटेन-मुक्त","डेयरी-मुक्त","हाई प्रोटीन","लो कार्ब","नट-मुक्त","चरण","हर पंक्ति में एक चरण","{value} kcal","प्रोटीन {value} g","कार्ब्स {value} g","वसा {value} g","{value} मिनट","सर्विंग: {value}","रेटिंग","5 में से {count} रेटिंग दें","रेसिपी देखें","फिर से प्लान करें","{date} के लिए प्लान किया गया","बंद करें","तैयारी: {value} मिनट","पकाना: {value} मिनट","कम सर्विंग","ज़्यादा सर्विंग","सामग्री","कोई सामग्री नहीं जोड़ी गई","कोई चरण नहीं जोड़ा गया","नोट्स","प्रिंट करें","संपादित करें","इसके अनुसार क्रमबद्ध करें","सबसे नए पहले","सबसे पुराने पहले","नाम","रेटिंग","कैलोरी","आहार टैग से फ़िल्टर करें","सभी भोजन","कैलोरी लक्ष्य","आज: {goal} में से {kcal} kcal","लक्ष्य से {value} kcal ज़्यादा","आज के लिए बाकी: {value} kcal","पिछला सप्ताह","अगला सप्ताह","यह सप्ताह","{day} को {type} जोड़ें","अवधि","अगले 7 दिन","सभी आने वाले","आइटम जोड़ें, जैसे पेपर टॉवल","आइटम जोड़ें","कॉपी किया गया","कॉपी नहीं हो सका","सूची कॉपी करें","डाउनलोड करें","चुने गए हटाएँ","आने वाले भोजन की कोई सामग्री अभी नहीं","आइटम हटाएँ","रोज़ का कैलोरी लक्ष्य (kcal)","सभी भोजन में आज के सारांश के लिए उपयोग होता है।"],
    "co":["Settimana","Pianificatore di a settimana","Pianificate a clazione, u pranzu, a cena è i spuntini per tutta a settimana.","Lista di e compre","L’ingredienti di i vostri prossimi pasti, riuniti in una lista sola.","Data è ora","Porzioni","Tempu di preparazione (minuti)","Tempu di cottura (minuti)","Nutrizione","Calurie (kcal)","Prutei (g)","Carboidrati (g)","Grassi (g)","Etichette alimentarie","Vegetarianu","Veganu","Senza glutine","Senza latticini","Riccu in prutei","Pocu carboidrati","Senza frutta secca","Tappe","Una tappa per linea","{value} kcal","Prutei {value} g","Carboidrati {value} g","Grassi {value} g","{value} min","Porzioni: {value}","Valutazione","Valutà {count} nant’à 5","Vede a ricetta","Pianificà torna","Pianificatu per u {date}","Chjode","Preparazione: {value} min","Cottura: {value} min","Menu porzioni","Più porzioni","Ingredienti","Nisunu ingrediente aghjuntu","Nisuna tappa aghjunta","Note","Stampà","Mudificà","Ordinà per","I più recenti prima","I più antichi prima","Nome","Valutazione","Calurie","Filtrà per etichetta alimentaria","Tutti i pasti","Scopu di calurie","Oghje: {kcal} nant’à {goal} kcal","Sopra à u vostru scopu di {value} kcal","Restu per oghje: {value} kcal","Settimana precedente","Settimana seguente","Sta settimana","Aghjunghje {type} u {day}","Periodu","I prossimi 7 ghjorni","Tutti i prossimi","Aghjunghjite un elementu, cum’è carta da cucina","Aghjunghje un elementu","Cupiatu","Ùn hè micca statu pussibule di cupià","Cupià a lista","Scaricà","Sguassà i spuntati","Nisunu ingrediente da i prossimi pasti per avà","Caccià l’elementu","Scopu cutidianu di calurie (kcal)","Adupratu per u riassuntu d’Oghje in Tutti i pasti."]});
  const strings = {};
  for (const [lang, list] of Object.entries(DATA)) {
    strings[lang] = {};
    KEYS.forEach((key, i) => { if (list[i] !== undefined) strings[lang][key] = list[i]; });
  }
  // All 17 global Munetios locales (shared/munetios-locales.js); es is Latin American Spanish here.
  const L = window.MunetiosLocales;
  window.MealsFeatureStrings = Object.freeze(L ? L.compose(strings, {}, { es: "419", pt: "BR" }) : strings);
  window.MealsFeatureStringKeys = KEYS;
})();
