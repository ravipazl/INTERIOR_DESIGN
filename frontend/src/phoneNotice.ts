// On a phone the Designer (floor plan, 3D, render) is too small to work in.
// Say so, with a way back; "Continue anyway" leaves everything working as it
// is and is remembered for this visit. Phones only (css/phone.css styles it).

const PHONE = "(max-width: 640px)";
const KEY = "pz.phone.designer.ok";
const ID = "pz-phone-note";

function show() {
  if (!window.matchMedia(PHONE).matches) return;
  if (!/^\/design\/draw/.test(window.location.pathname)) return;
  try {
    if (window.sessionStorage.getItem(KEY) === "1") return;
  } catch {
    /* no storage: ask again next time */
  }
  if (document.getElementById(ID)) return;

  const note = document.createElement("div");
  note.id = ID;
  note.className = "pz-phone-note";
  note.setAttribute("role", "dialog");
  note.setAttribute("aria-modal", "true");
  note.setAttribute("aria-labelledby", ID + "-title");
  note.innerHTML = `
    <div class="pz-phone-note-box">
      <div class="pz-phone-note-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>
        </svg>
      </div>
      <h2 id="${ID}-title">Best on a tablet or computer</h2>
      <p>The floor plan, 3D and render tools need a bigger screen. You can still look around here, or go back to your projects.</p>
      <div class="pz-phone-note-actions">
        <button type="button" class="is-primary" data-act="back">Back to projects</button>
        <button type="button" class="is-plain" data-act="stay">Continue anyway</button>
      </div>
    </div>`;
  note.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest("button")?.getAttribute("data-act");
    if (act === "stay") {
      try {
        window.sessionStorage.setItem(KEY, "1");
      } catch {
        /* closes now; may ask again */
      }
      note.remove();
    } else if (act === "back") {
      window.location.href = "/";
    }
  });
  document.body.appendChild(note);
}

/** Watch for the Designer opening on a phone (also after in-app navigation). */
export function phoneDesignerNotice() {
  if (!window.matchMedia(PHONE).matches) return;
  show();
  // The Designer is opened by in-app links that do not reload the page.
  let last = window.location.pathname;
  window.setInterval(() => {
    if (window.location.pathname !== last) {
      last = window.location.pathname;
      show();
    }
  }, 800);
}
