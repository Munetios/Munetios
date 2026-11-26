const TASKS_ACCOUNT_STRINGS = {
  co: "Per sincrunizà i compiti è e categurie trà l’apparechji, cunnettitevi è sbluccate a sincrunizazione. I compiti d’invitatu restanu nant’à st’apparechju.",
  en: "To sync tasks and categories across devices, sign in and unlock sync. Guest tasks stay on this device.",
  es: "Para sincronizar tus tareas y categorías entre dispositivos, inicia sesión y desbloquea la sincronización. Las tareas de invitado se quedan en este dispositivo.",
  fr: "Pour synchroniser les tâches et les catégories entre vos appareils, connectez-vous et déverrouillez la synchronisation. Les tâches créées en mode invité restent sur cet appareil.",
  de: "Melde dich an und entsperre die Synchronisierung, um Aufgaben und Kategorien geräteübergreifend zu synchronisieren. Gastaufgaben bleiben auf diesem Gerät.",
  zh: "登录并解锁同步，即可在设备间同步任务和类别。访客任务会保留在此设备上。",
  ja: "タスクとカテゴリを端末間で同期するには、ログインして同期のロックを解除してください。ゲストのタスクはこの端末に残ります。",
  it: "Per sincronizzare attività e categorie tra dispositivi, accedi e sblocca la sincronizzazione. Le attività create come ospite restano su questo dispositivo.",
  pt: "Para sincronizar tarefas e categorias entre dispositivos, faça login e desbloqueie a sincronização. As tarefas criadas como visitante ficam neste dispositivo.",
  ru: "Чтобы синхронизировать задачи и категории между устройствами, войдите в аккаунт и разблокируйте синхронизацию. Гостевые задачи остаются на этом устройстве.",
  ar: "لمزامنة المهام والفئات بين الأجهزة، سجّل الدخول وافتح قفل المزامنة. تبقى مهام الضيف على هذا الجهاز.",
  hi: "अलग-अलग डिवाइस पर कार्य और श्रेणियाँ सिंक करने के लिए साइन इन करें और सिंक अनलॉक करें। अतिथि के कार्य इस डिवाइस पर ही रहते हैं।",
  ko: "기기 간에 할 일과 카테고리를 동기화하려면 로그인하고 동기화 잠금을 해제하세요. 게스트의 할 일은 이 기기에 남습니다.",
  tr: "Görevleri ve kategorileri cihazlar arasında eşitlemek için oturum açıp eşitlemenin kilidini açın. Misafir görevleri bu cihazda kalır.",
  nl: "Log in en ontgrendel synchronisatie om taken en categorieën tussen apparaten te synchroniseren. Gasttaken blijven op dit apparaat.",
  pl: "Aby synchronizować zadania i kategorie między urządzeniami, zaloguj się i odblokuj synchronizację. Zadania gościa pozostają na tym urządzeniu.",
  sv: "Logga in och lås upp synkroniseringen för att synkronisera uppgifter och kategorier mellan enheter. Gästuppgifter stannar på den här enheten.",
  fi: "Synkronoi tehtävät ja luokat laitteiden välillä kirjautumalla sisään ja avaamalla synkronoinnin lukitus. Vieraan tehtävät jäävät tälle laitteelle.",
  no: "Logg på og lås opp synkronisering for å synkronisere oppgaver og kategorier mellom enheter. Gjesteoppgaver blir værende på denne enheten.",
  da: "Log ind, og lås synkronisering op for at synkronisere opgaver og kategorier mellem enheder. Gæsteopgaver bliver på denne enhed.",
  cs: "Chcete-li synchronizovat úkoly a kategorie mezi zařízeními, přihlaste se a odemkněte synchronizaci. Úkoly hosta zůstanou v tomto zařízení.",
  el: "Για να συγχρονίσετε εργασίες και κατηγορίες μεταξύ συσκευών, συνδεθείτε και ξεκλειδώστε τον συγχρονισμό. Οι εργασίες επισκέπτη παραμένουν σε αυτήν τη συσκευή.",
  he: "כדי לסנכרן משימות וקטגוריות בין מכשירים, יש להיכנס לחשבון ולבטל את נעילת הסנכרון. משימות של אורחים נשארות במכשיר הזה.",
  th: "หากต้องการซิงค์งานและหมวดหมู่ระหว่างอุปกรณ์ ให้ลงชื่อเข้าใช้และปลดล็อกการซิงค์ งานของผู้เยี่ยมชมจะอยู่ในอุปกรณ์นี้",
  vi: "Để đồng bộ công việc và danh mục giữa các thiết bị, hãy đăng nhập và mở khóa tính năng đồng bộ. Công việc của khách vẫn nằm trên thiết bị này.",
  id: "Untuk menyinkronkan tugas dan kategori di berbagai perangkat, masuk dan buka kunci sinkronisasi. Tugas tamu tetap ada di perangkat ini.",
  uk: "Щоб синхронізувати завдання й категорії між пристроями, увійдіть в обліковий запис і розблокуйте синхронізацію. Гостьові завдання залишаються на цьому пристрої.",
  ro: "Pentru a sincroniza sarcinile și categoriile între dispozitive, autentifică-te și deblochează sincronizarea. Sarcinile de invitat rămân pe acest dispozitiv.",
  hu: "A feladatok és kategóriák eszközök közötti szinkronizálásához jelentkezz be, és oldd fel a szinkronizálás zárolását. A vendégfeladatok ezen az eszközön maradnak.",
  bg: "За да синхронизирате задачи и категории между устройства, влезте в профила си и отключете синхронизирането. Задачите на госта остават на това устройство.",
  hr: "Za sinkronizaciju zadataka i kategorija na više uređaja prijavite se i otključajte sinkronizaciju. Zadaci gosta ostaju na ovom uređaju.",
};
// One sentence per global Munetios locale (shared/munetios-locales.js).
{
  const L = window.MunetiosLocales;
  const wrapped = Object.fromEntries(Object.entries(TASKS_ACCOUNT_STRINGS).map(([k, v]) => [k, { text: v }]));
  const composed = L ? L.compose(wrapped, {}, { es: "419", pt: "BR" }) : wrapped;
  window.MunetiosTasksAccountStrings = Object.freeze(Object.fromEntries(Object.entries(composed).map(([k, v]) => [k, v.text])));
}
