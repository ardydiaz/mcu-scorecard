export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatCell(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toLocaleString('en-PH', { maximumFractionDigits: 2 });
  return String(value);
}

export function capitalize(text = '') {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function plural(count, word) {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}
