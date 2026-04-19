/** Map raw SQLite / IPC errors to user-facing Uzbek messages for promotions UI */
export function formatPromotionDbError(message: string): string {
  const m = String(message || '');
  if (/FOREIGN KEY|constraint failed|SQLITE_CONSTRAINT/i.test(m)) {
    return (
      "Ma'lumotlar bazasi cheklovi: boshqa jadval bilan bog'liq yozuv bor yoki noto'g'ri havola. " +
      "Agar muammo takrorlansa, dasturni yangilang yoki administratorga murojaat qiling."
    );
  }
  if (/UNIQUE|unique constraint/i.test(m)) {
    return "Bu kod yoki nom allaqachon mavjud. Boshqa kod tanlang.";
  }
  return m || "Noma'lum xatolik yuz berdi.";
}
