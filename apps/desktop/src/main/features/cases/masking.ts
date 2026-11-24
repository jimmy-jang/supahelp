export type CaseMaskingField = { id: string; text: string };

function card(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19 || /^0+$/.test(digits))
    return false;
  let total = 0;
  for (
    let i = digits.length - 1, double = false;
    i >= 0;
    i--, double = !double
  ) {
    let n = Number(digits[i]);
    if (double) n *= 2;
    total += n > 9 ? n - 9 : n;
  }
  return total % 10 === 0;
}

// shortcut: these formats are finite; expand with regression fixtures when new leaks are found.
export function maskCasePatterns(text: string): string {
  return text
    .replace(
      /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/g,
      '[SECRET]',
    )
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"`]+/gi, (value) => {
      try {
        const url = new URL(value);
        return url.username || url.password || url.search || url.hash
          ? '[LINK]'
          : value;
      } catch {
        return '[LINK]';
      }
    })
    .replace(
      /\b(authorization|proxy-authorization|cookie|set-cookie)[ \t]*[:=][ \t]*[^\r\n]+/gi,
      '$1: [SECRET]',
    )
    .replace(/\bBearer[ \t]+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [SECRET]')
    .replace(
      /\b(password|passwd|pwd|secret|client[_ -]?secret|(?:access|refresh|auth|session)[_ -]?(?:token|key)|token|api[_ -]?key)\b["']?([ \t]*[:=][ \t]*)(?:"[^"\r\n]*"|'[^'\r\n]*'|\[[^\]\r\n]*\]|[^\s,;}\r\n]+)/gi,
      '$1$2[SECRET]',
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|[sr]k_(?:live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|npm_[A-Za-z0-9]{8,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35})\b/g,
      '[SECRET]',
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[SECRET]',
    )
    .replace(
      /(?<![\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-])[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,63}/gu,
      '[EMAIL]',
    )
    .replace(
      /(?<![\p{L}\p{N}_])(?:\d[ -]?){12,18}\d(?![\p{L}\p{N}_])/gu,
      (value) => (card(value) ? '[CARD]' : value),
    )
    .replace(/\+\d[\d ().-]{5,25}\d\b/g, (value) => {
      const length = value.replace(/\D/g, '').length;
      return length >= 7 && length <= 15 ? '[PHONE]' : value;
    })
    .replace(
      /\b(phone|mobile|tel|call)([ \t]*:?[ \t]*)(\(?\d[\d ().-]{5,25}\d)\b/gi,
      (value, label: string, gap: string, phone: string) => {
        const length = phone.replace(/\D/g, '').length;
        return length >= 7 && length <= 15 ? `${label}${gap}[PHONE]` : value;
      },
    );
}
