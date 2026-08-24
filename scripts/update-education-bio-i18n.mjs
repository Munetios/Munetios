import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const directory = join(process.cwd(), "app", "languages");
const translations = {
  ar: "يتولى معلمك إدارة اسمك وبريدك الإلكتروني وتاريخ ميلادك وتفاصيل حسابك. يمكنك تعديل نبذتك.",
  da: "Dit navn, din mailadresse, din fødselsdag og dine kontooplysninger administreres af din lærer. Du kan redigere din biografi.",
  de: "Dein Name, deine E-Mail-Adresse, dein Geburtstag und deine Kontodaten werden von deiner Lehrkraft verwaltet. Du kannst deine Biografie bearbeiten.",
  el: "Ο εκπαιδευτικός σας διαχειρίζεται το όνομα, το email, την ημερομηνία γέννησης και τα στοιχεία του λογαριασμού σας. Μπορείτε να επεξεργαστείτε το βιογραφικό σας.",
  en: "Your name, email, birthday, and account details are managed by your teacher. You can edit your bio.",
  es: "Tu docente administra tu nombre, correo electrónico, fecha de nacimiento y datos de la cuenta. Puedes editar tu biografía.",
  fr: "Votre nom, votre adresse e-mail, votre date de naissance et les informations de votre compte sont gérés par votre enseignant. Vous pouvez modifier votre biographie.",
  he: "השם, הדוא״ל, תאריך הלידה ופרטי החשבון שלך מנוהלים על ידי המורה. אפשר לערוך את הביוגרפיה שלך.",
  hi: "आपका नाम, ईमेल, जन्मदिन और खाते की जानकारी आपके शिक्षक प्रबंधित करते हैं। आप अपना परिचय संपादित कर सकते हैं।",
  id: "Nama, email, tanggal lahir, dan detail akun Anda dikelola oleh guru. Anda dapat mengedit bio.",
  it: "Il tuo nome, l’email, la data di nascita e i dettagli dell’account sono gestiti dal tuo insegnante. Puoi modificare la biografia.",
  ja: "名前、メールアドレス、生年月日、アカウント情報は教師が管理しています。自己紹介は編集できます。",
  ko: "이름, 이메일, 생년월일 및 계정 정보는 교사가 관리합니다. 자기소개는 수정할 수 있습니다.",
  ms: "Nama, e-mel, tarikh lahir dan butiran akaun anda diurus oleh guru. Anda boleh mengedit biodata anda.",
  nl: "Je naam, e-mailadres, geboortedatum en accountgegevens worden beheerd door je leraar. Je kunt je bio bewerken.",
  pl: "Twoje imię i nazwisko, adres e-mail, data urodzenia oraz dane konta są zarządzane przez nauczyciela. Możesz edytować swój opis.",
  pt: "Seu nome, e-mail, data de nascimento e dados da conta são gerenciados pelo professor. Você pode editar sua biografia.",
  ru: "Ваши имя, адрес электронной почты, дата рождения и данные учетной записи управляются учителем. Вы можете изменить информацию о себе.",
  sv: "Ditt namn, din e-postadress, din födelsedag och dina kontouppgifter hanteras av din lärare. Du kan redigera din biografi.",
  th: "ชื่อ อีเมล วันเกิด และรายละเอียดบัญชีของคุณได้รับการจัดการโดยครู คุณแก้ไขประวัติส่วนตัวได้",
  tr: "Adınız, e-postanız, doğum gününüz ve hesap bilgileriniz öğretmeniniz tarafından yönetilir. Biyografinizi düzenleyebilirsiniz.",
  vi: "Tên, email, ngày sinh và thông tin tài khoản của bạn do giáo viên quản lý. Bạn có thể chỉnh sửa tiểu sử.",
  zh: "你的姓名、电子邮件、生日和帐户信息由教师管理。你可以编辑个人简介。",
};
const aliases = { co: "fr", fur: "it", gl: "es" };
const files = (await readdir(directory)).filter((file) =>
  file.endsWith(".json"),
);

for (const file of files) {
  const prefix = file.replace(/\.json$/u, "").split("_")[0];
  const value = translations[aliases[prefix] || prefix];
  if (!value) throw new Error(`Missing translation for ${file}`);
  const path = join(directory, file);
  const data = JSON.parse(await readFile(path, "utf8"));
  data.educationSettingsManagedByTeacher = value;
  const sorted = Object.fromEntries(
    Object.entries(data).sort(([left], [right]) => left.localeCompare(right)),
  );
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

console.log(`Updated the Education bio notice in ${files.length} locales.`);
