import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

// Confirmation dialogs (SweetAlert2) in the app's purple/gold style; colors come from the theme
// variables in styles.css (.mcu-swal), so they follow light/dark mode.

// Success toasts: green, top center, close by themselves (longer messages stay longer; hovering pauses)
const Toast = Swal.mixin({
  toast: true,
  position: 'top',
  icon: 'success',
  showConfirmButton: false,
  showCloseButton: true,
  timerProgressBar: true,
  customClass: { popup: 'mcu-toast', title: 'mcu-toast__text', closeButton: 'mcu-toast__close', timerProgressBar: 'mcu-toast__bar' },
  didOpen: (toast) => {
    toast.addEventListener('mouseenter', Swal.stopTimer);
    toast.addEventListener('mouseleave', Swal.resumeTimer);
  },
});

export function toastSuccess(message) {
  if (!message) return;
  Toast.fire({
    title: message,
    timer: Math.min(10000, 3000 + String(message).length * 40),
    target: document.fullscreenElement || 'body',
  });
}

const escapeHtml =(s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = { danger: 'warning', warning: 'warning', primary: 'question', info: 'info' };

/**
 * Asks for a short text (e.g. a new column's header). Resolves the trimmed text, or null on Cancel.
 * `validate(value)` returns an error message to show, or nothing when the value is fine.
 */
export async function promptDialog({ title, text = '', label = '', placeholder = '', value = '', confirmText = 'OK', maxLength = 100, validate }) {
  const result = await Swal.fire({
    target: document.fullscreenElement || 'body',
    // Always centered: the container is shared with toasts, which place it at the top
    position: 'center',
    title,
    html: text ? `<p class="mcu-swal__text">${escapeHtml(text)}</p>` : undefined,
    input: 'text',
    inputLabel: label,
    inputPlaceholder: placeholder,
    inputValue: value,
    inputAttributes: { maxlength: String(maxLength), autocomplete: 'off' },
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: 'Cancel',
    reverseButtons: true,
    buttonsStyling: false,
    customClass: {
      container: 'mcu-swal-backdrop',
      popup: 'mcu-swal',
      title: 'mcu-swal__title',
      htmlContainer: 'mcu-swal__body',
      input: 'input mcu-swal__input',
      inputLabel: 'mcu-swal__label',
      validationMessage: 'mcu-swal__error',
      actions: 'mcu-swal__actions',
      confirmButton: 'btn btn--primary',
      cancelButton: 'btn btn--ghost',
    },
    inputValidator: (value) => {
      const v = String(value || '').trim();
      if (!v) return 'Type a name first.';
      return validate ? validate(v) || undefined : undefined;
    },
  });
  return result.isConfirmed ? String(result.value).trim() : null;
}

/**
 * Asks the user to confirm; resolves true when they click the confirm button.
 *   title        question, e.g. 'Hide “Report.xlsx”?'
 *   text         explanation (plain text; line breaks are kept)
 *   items        optional list shown under the text (e.g. values that will be deleted)
 *   confirmText  label of the confirm button (default 'Continue')
 *   tone         'primary' (default), 'warning', or 'danger' (red button, Cancel focused)
 */
export async function confirmDialog({ title, text = '', items = [], confirmText = 'Continue', cancelText = 'Cancel', tone = 'primary' }) {
  const list = items.length
    ? `<ul class="mcu-swal__list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
    : '';
  const result = await Swal.fire({
    // A sheet in full screen only shows its own element, so the dialog goes inside it
    target: document.fullscreenElement || 'body',
    // Always centered: the container is shared with toasts, which place it at the top
    position: 'center',
    title,
    html: `<p class="mcu-swal__text">${escapeHtml(text)}</p>${list}`,
    icon: ICONS[tone] || 'question',
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    reverseButtons: true,
    focusCancel: tone === 'danger',
    buttonsStyling: false,
    customClass: {
      container: 'mcu-swal-backdrop',
      popup: 'mcu-swal',
      title: 'mcu-swal__title',
      htmlContainer: 'mcu-swal__body',
      icon: `mcu-swal__icon mcu-swal__icon--${tone}`,
      actions: 'mcu-swal__actions',
      confirmButton: `btn ${tone === 'danger' ? 'btn--danger-solid' : 'btn--primary'}`,
      cancelButton: 'btn btn--ghost',
    },
  });
  return result.isConfirmed;
}

// A message with a single OK button (e.g. why an action couldn't be done)
export async function alertDialog({ title, text = '', tone = 'warning', confirmText = 'OK' }) {
  await Swal.fire({
    target: document.fullscreenElement || 'body',
    position: 'center',
    title,
    html: `<p class="mcu-swal__text">${escapeHtml(text)}</p>`,
    icon: ICONS[tone] || 'warning',
    confirmButtonText: confirmText,
    buttonsStyling: false,
    customClass: {
      container: 'mcu-swal-backdrop',
      popup: 'mcu-swal',
      title: 'mcu-swal__title',
      htmlContainer: 'mcu-swal__body',
      icon: `mcu-swal__icon mcu-swal__icon--${tone}`,
      actions: 'mcu-swal__actions',
      confirmButton: 'btn btn--primary',
    },
  });
}
