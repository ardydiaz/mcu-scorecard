import { useEffect, useRef } from 'react';
import Swal from 'sweetalert2';

// Signs the user out after 20 minutes without activity (mouse, keyboard, scroll, touch), with a
// one-minute warning first. The last activity time is kept in localStorage, so activity in any
// open tab of the app keeps every tab signed in, and they all sign out together.
export const IDLE_LIMIT_MS = 20 * 60 * 1000;
const WARNING_MS = 60 * 1000;
const CHECK_EVERY_MS = 5 * 1000;
const STORAGE_KEY = 'mcu-scorecard.lastActivity';
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'];

function readLastActivity() {
  try { return Number(localStorage.getItem(STORAGE_KEY)) || 0; } catch { return 0; }
}
function writeLastActivity(time) {
  try { localStorage.setItem(STORAGE_KEY, String(time)); } catch { /* storage unavailable: this tab only */ }
}

// A fresh sign-in starts a new inactivity period (otherwise the time saved before an automatic
// sign-out would count as inactivity and sign the user straight out again)
export function markSignedIn() {
  writeLastActivity(Date.now());
}

// Any sign-out forgets the last activity time
export function clearLastActivity() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}

// `active`: a user is signed in. `onTimeout` signs them out.
export default function useIdleLogout(active, onTimeout) {
  const timeoutRef = useRef(onTimeout);
  timeoutRef.current = onTimeout;

  useEffect(() => {
    if (!active) return undefined;
    let lastSeen = Date.now();
    let warning = false;
    let done = false;

    // A browser closed and reopened more than 20 minutes later starts signed out
    const stored = readLastActivity();
    if (stored && Date.now() - stored > IDLE_LIMIT_MS) lastSeen = stored;
    else writeLastActivity(lastSeen);

    // Activity is recorded at most every few seconds; ignored while the warning is open,
    // so only "Stay signed in" (a deliberate click) keeps the session
    let lastWrite = 0;
    const onActivity = () => {
      if (warning || done) return;
      const now = Date.now();
      lastSeen = now;
      if (now - lastWrite > 3000) { lastWrite = now; writeLastActivity(now); }
    };

    const idleFor = () => Date.now() - Math.max(lastSeen, readLastActivity());

    function signOut() {
      if (done) return;
      done = true;
      Swal.close();
      timeoutRef.current();
    }

    async function showWarning() {
      warning = true;
      let timer;
      const result = await Swal.fire({
        target: document.fullscreenElement || 'body',
        title: 'Are you still there?',
        html: '<p class="mcu-swal__text">For your security you will be signed out in <strong id="idle-countdown">60</strong> seconds because of inactivity.</p>',
        icon: 'warning',
        confirmButtonText: 'Stay signed in',
        showCancelButton: true,
        cancelButtonText: 'Sign out now',
        reverseButtons: true,
        allowOutsideClick: false,
        buttonsStyling: false,
        customClass: {
          container: 'mcu-swal-backdrop',
          popup: 'mcu-swal',
          title: 'mcu-swal__title',
          htmlContainer: 'mcu-swal__body',
          icon: 'mcu-swal__icon mcu-swal__icon--warning',
          actions: 'mcu-swal__actions',
          confirmButton: 'btn btn--primary',
          cancelButton: 'btn btn--ghost',
        },
        didOpen: () => {
          timer = setInterval(() => {
            const left = Math.max(0, Math.ceil((IDLE_LIMIT_MS - idleFor()) / 1000));
            const el = document.getElementById('idle-countdown');
            if (el) el.textContent = String(left);
          }, 1000);
        },
        willClose: () => clearInterval(timer),
      });
      warning = false;
      if (done) return;
      if (result.isConfirmed) {
        lastSeen = Date.now();
        writeLastActivity(lastSeen);
      } else if (result.dismiss === Swal.DismissReason.cancel) {
        signOut();
      }
    }

    function check() {
      if (done) return;
      const idle = idleFor();
      if (idle >= IDLE_LIMIT_MS) signOut();
      else if (idle >= IDLE_LIMIT_MS - WARNING_MS && !warning) showWarning();
      // Another tab kept the session alive: close this tab's warning
      else if (warning && idle < IDLE_LIMIT_MS - WARNING_MS) Swal.close();
    }

    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const interval = setInterval(check, CHECK_EVERY_MS);
    check();

    return () => {
      done = true;
      clearInterval(interval);
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      if (warning) Swal.close();
    };
  }, [active]);
}
