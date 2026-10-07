// 最小 i18n：缺失翻译回退到中文原文，不抛错；记录缺失键以便补译。
export const LANGS = ['zh', 'en', 'tai'] ; // 汉/英/傣语示例
const FALLBACK_CHAIN = { en: ['en', 'zh'], tai: ['tai', 'zh'], zh: ['zh'] };

export function translate(record, lang, missing = []) {
  if (!record) return '';
  if (typeof record === 'string') return lang === 'zh' ? record : '';
  const chain = FALLBACK_CHAIN[lang] || ['zh'];
  for (const l of chain) {
    if (record[l] != null && record[l] !== '') {
      // 命中非请求语言（回退）时记录一次缺失，便于后续补译。
      if (l !== lang && record.zh != null) missing.push(record.zh);
      return { value: record[l], lang: l, fellBack: l !== lang };
    }
  }
  if (record.zh != null) {
    missing.push(record.zh);
    return { value: record.zh, lang: 'zh', fellBack: true };
  }
  return { value: '', lang: null, fellBack: true };
}

// 选择字段并返回带提示的结构：{ value, lang, fellBack }
export function pickLocalized(record, lang, missing = []) {
  return translate(record, lang, missing);
}
