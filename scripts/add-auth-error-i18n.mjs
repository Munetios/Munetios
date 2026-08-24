import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const directory = join(process.cwd(), "app", "languages");
const translations = {
  ar: [
    "يرجى إدخال البيانات المطلوبة.",
    "طلبات تسجيل الدخول كثيرة جدًا.",
    "طلبات كثيرة جدًا. يرجى المحاولة مرة أخرى لاحقًا.",
  ],
  da: [
    "Indtast de påkrævede oplysninger.",
    "For mange loginanmodninger.",
    "For mange anmodninger. Prøv igen senere.",
  ],
  de: [
    "Bitte geben Sie die erforderlichen Angaben ein.",
    "Zu viele Anmeldeanfragen.",
    "Zu viele Anfragen. Bitte versuchen Sie es später erneut.",
  ],
  el: [
    "Συμπληρώστε τα απαιτούμενα στοιχεία.",
    "Πάρα πολλά αιτήματα σύνδεσης.",
    "Πάρα πολλά αιτήματα. Δοκιμάστε ξανά αργότερα.",
  ],
  en: [
    "Please enter required details.",
    "Too many sign in requests.",
    "Too many requests. Please try again later.",
  ],
  es: [
    "Introduce los datos obligatorios.",
    "Demasiadas solicitudes de inicio de sesión.",
    "Demasiadas solicitudes. Inténtalo de nuevo más tarde.",
  ],
  fr: [
    "Veuillez saisir les informations requises.",
    "Trop de demandes de connexion.",
    "Trop de demandes. Veuillez réessayer plus tard.",
  ],
  he: [
    "נא להזין את הפרטים הנדרשים.",
    "יותר מדי בקשות כניסה.",
    "יותר מדי בקשות. נסו שוב מאוחר יותר.",
  ],
  hi: [
    "कृपया आवश्यक विवरण दर्ज करें।",
    "साइन इन के बहुत अधिक अनुरोध किए गए हैं।",
    "बहुत अधिक अनुरोध किए गए हैं। कृपया बाद में फिर से कोशिश करें।",
  ],
  id: [
    "Masukkan detail yang diperlukan.",
    "Terlalu banyak permintaan masuk.",
    "Terlalu banyak permintaan. Coba lagi nanti.",
  ],
  it: [
    "Inserisci i dati richiesti.",
    "Troppe richieste di accesso.",
    "Troppe richieste. Riprova più tardi.",
  ],
  ja: [
    "必須情報を入力してください。",
    "ログインのリクエストが多すぎます。",
    "リクエストが多すぎます。しばらくしてからもう一度お試しください。",
  ],
  ko: [
    "필수 정보를 입력해 주세요.",
    "로그인 요청이 너무 많습니다.",
    "요청이 너무 많습니다. 나중에 다시 시도해 주세요.",
  ],
  ms: [
    "Sila masukkan butiran yang diperlukan.",
    "Terlalu banyak permintaan log masuk.",
    "Terlalu banyak permintaan. Cuba lagi kemudian.",
  ],
  nl: [
    "Vul de vereiste gegevens in.",
    "Te veel aanmeldverzoeken.",
    "Te veel verzoeken. Probeer het later opnieuw.",
  ],
  pl: [
    "Wprowadź wymagane dane.",
    "Zbyt wiele próśb o zalogowanie.",
    "Zbyt wiele próśb. Spróbuj ponownie później.",
  ],
  pt: [
    "Introduza os dados obrigatórios.",
    "Demasiados pedidos de início de sessão.",
    "Demasiados pedidos. Tente novamente mais tarde.",
  ],
  ru: [
    "Введите обязательные данные.",
    "Слишком много запросов на вход.",
    "Слишком много запросов. Повторите попытку позже.",
  ],
  sv: [
    "Ange de obligatoriska uppgifterna.",
    "För många inloggningsförfrågningar.",
    "För många förfrågningar. Försök igen senare.",
  ],
  th: [
    "โปรดกรอกข้อมูลที่จำเป็น",
    "มีคำขอลงชื่อเข้าใช้มากเกินไป",
    "มีคำขอมากเกินไป โปรดลองอีกครั้งในภายหลัง",
  ],
  tr: [
    "Lütfen gerekli bilgileri girin.",
    "Çok fazla oturum açma isteği var.",
    "Çok fazla istek var. Lütfen daha sonra tekrar deneyin.",
  ],
  vi: [
    "Vui lòng nhập các thông tin bắt buộc.",
    "Có quá nhiều yêu cầu đăng nhập.",
    "Có quá nhiều yêu cầu. Vui lòng thử lại sau.",
  ],
  zh: ["请输入必填信息。", "登录请求过多。", "请求过多，请稍后重试。"],
};

const fallbackLanguages = { co: "fr", fur: "it", gl: "es" };
const files = (await readdir(directory)).filter((file) =>
  file.endsWith(".json"),
);

for (const file of files) {
  const path = join(directory, file);
  const locale = file.replace(/\.json$/u, "");
  const prefix = locale.split("_")[0];
  const language = fallbackLanguages[prefix] || prefix;
  const [requiredDetails, tooManySignIns, tooManyRequests] =
    translations[language] || translations.en;
  const data = JSON.parse(await readFile(path, "utf8"));
  Object.assign(data, {
    authRequiredDetails: requiredDetails,
    authTooManyRequests: tooManyRequests,
    authTooManySignInRequests: tooManySignIns,
  });
  if (language === "en") {
    data.incorrectSignIn = "Incorrect email or password";
  }
  const sorted = Object.fromEntries(
    Object.entries(data).sort(([left], [right]) => left.localeCompare(right)),
  );
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}
