const dateOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
} satisfies Intl.DateTimeFormatOptions;

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, dateOptions);
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    ...dateOptions,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}
