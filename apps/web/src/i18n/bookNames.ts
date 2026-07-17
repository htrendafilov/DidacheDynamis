// Localized Bible book names keyed by canonical OSIS code, so book labels follow the
// interface language even when the Bible text itself is in another language (e.g. the
// English WEB shown with a Bulgarian interface).
//
// Bulgarian names use Protestant conventions (as in the Веren / ББД tradition):
// 1-2 Царе = Samuel, 3-4 Царе = Kings; Летописи = Chronicles.

const EN: Record<string, string> = {
  Gen: "Genesis", Exod: "Exodus", Lev: "Leviticus", Num: "Numbers", Deut: "Deuteronomy",
  Josh: "Joshua", Judg: "Judges", Ruth: "Ruth", "1Sam": "1 Samuel", "2Sam": "2 Samuel",
  "1Kgs": "1 Kings", "2Kgs": "2 Kings", "1Chr": "1 Chronicles", "2Chr": "2 Chronicles",
  Ezra: "Ezra", Neh: "Nehemiah", Esth: "Esther", Job: "Job", Ps: "Psalms", Prov: "Proverbs",
  Eccl: "Ecclesiastes", Song: "Song of Solomon", Isa: "Isaiah", Jer: "Jeremiah",
  Lam: "Lamentations", Ezek: "Ezekiel", Dan: "Daniel", Hos: "Hosea", Joel: "Joel", Amos: "Amos",
  Obad: "Obadiah", Jonah: "Jonah", Mic: "Micah", Nah: "Nahum", Hab: "Habakkuk", Zeph: "Zephaniah",
  Hag: "Haggai", Zech: "Zechariah", Mal: "Malachi", Matt: "Matthew", Mark: "Mark", Luke: "Luke",
  John: "John", Acts: "Acts", Rom: "Romans", "1Cor": "1 Corinthians", "2Cor": "2 Corinthians",
  Gal: "Galatians", Eph: "Ephesians", Phil: "Philippians", Col: "Colossians",
  "1Thess": "1 Thessalonians", "2Thess": "2 Thessalonians", "1Tim": "1 Timothy",
  "2Tim": "2 Timothy", Titus: "Titus", Phlm: "Philemon", Heb: "Hebrews", Jas: "James",
  "1Pet": "1 Peter", "2Pet": "2 Peter", "1John": "1 John", "2John": "2 John", "3John": "3 John",
  Jude: "Jude", Rev: "Revelation",
};

const BG: Record<string, string> = {
  Gen: "Битие", Exod: "Изход", Lev: "Левит", Num: "Числа", Deut: "Второзаконие",
  Josh: "Исус Навиев", Judg: "Съдии", Ruth: "Рут", "1Sam": "1 Царе", "2Sam": "2 Царе",
  "1Kgs": "3 Царе", "2Kgs": "4 Царе", "1Chr": "1 Летописи", "2Chr": "2 Летописи",
  Ezra: "Ездра", Neh: "Неемия", Esth: "Естир", Job: "Йов", Ps: "Псалми", Prov: "Притчи",
  Eccl: "Еклисиаст", Song: "Песен на песните", Isa: "Исая", Jer: "Еремия", Lam: "Плач Еремиев",
  Ezek: "Езекиил", Dan: "Даниил", Hos: "Осия", Joel: "Йоил", Amos: "Амос", Obad: "Авдий",
  Jonah: "Йона", Mic: "Михей", Nah: "Наум", Hab: "Авакум", Zeph: "Софония", Hag: "Агей",
  Zech: "Захария", Mal: "Малахия", Matt: "Матей", Mark: "Марк", Luke: "Лука", John: "Йоан",
  Acts: "Деяния на апостолите", Rom: "Римляни", "1Cor": "1 Коринтяни", "2Cor": "2 Коринтяни",
  Gal: "Галатяни", Eph: "Ефесяни", Phil: "Филипяни", Col: "Колосяни", "1Thess": "1 Солунци",
  "2Thess": "2 Солунци", "1Tim": "1 Тимотей", "2Tim": "2 Тимотей", Titus: "Тит", Phlm: "Филимон",
  Heb: "Евреи", Jas: "Яков", "1Pet": "1 Петрово", "2Pet": "2 Петрово", "1John": "1 Йоаново",
  "2John": "2 Йоаново", "3John": "3 Йоаново", Jude: "Юда", Rev: "Откровение",
};

const MAPS: Record<string, Record<string, string>> = { en: EN, bg: BG };

/** Localized display name for a book by OSIS code, following the interface language. */
export function bookName(osis: string, lang: string, fallback?: string): string {
  const map = MAPS[lang] ?? EN;
  return map[osis] ?? fallback ?? osis;
}
