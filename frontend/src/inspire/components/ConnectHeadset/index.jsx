import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "@pazl/components/Dialog/dialog.css";
import { approveHeadsetCode, cleanCode } from "../../services/deviceLoginService";
import "./index.css";

const CODE_LENGTH = 6;

const HeadsetIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 10a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-4l-2-2.5h-2L9 17H5a2 2 0 0 1-2-2z" />
    <path d="M7.5 12.5h.01M16.5 12.5h.01" />
  </svg>
);

/**
 * "Connect a headset": type the code the Pazl HoloLens app shows, and it signs
 * in as you. A header button (beside the bell) opens it.
 */
const ConnectHeadset = () => {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [state, setState] = useState("idle"); // idle | busy | done | error
  const [message, setMessage] = useState("");
  const input = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const show = () => {
    setCode("");
    setState("idle");
    setMessage("");
    setOpen(true);
  };
  const close = () => setOpen(false);

  // Shown as "K7P 2QM": three, a space, three.
  const typed = cleanCode(code).slice(0, CODE_LENGTH);
  const shown = typed.length > 3 ? typed.slice(0, 3) + " " + typed.slice(3) : typed;

  const connect = async (e) => {
    e?.preventDefault();
    if (typed.length !== CODE_LENGTH || state === "busy") return;
    setState("busy");
    setMessage("");
    try {
      await approveHeadsetCode(typed);
      setState("done");
    } catch (err) {
      setState("error");
      setMessage(err.message);
      input.current?.focus();
    }
  };

  return (
    <>
      <button
        type="button"
        className="pz-headset-btn"
        onClick={show}
        title="Connect a headset"
        aria-label="Connect a headset"
      >
        <HeadsetIcon />
      </button>
      {open
        ? createPortal(
            <div className="pz-dlg-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
              <form
                className="pz-dlg pz-dlg--sm pz-headset"
                role="dialog"
                aria-modal="true"
                aria-labelledby="pz-headset-title"
                onSubmit={connect}
              >
                <div className="pz-dlg-head">
                  <div className="pz-dlg-head-row">
                    <span className="pz-dlg-badge pz-dlg-badge--violet" aria-hidden="true">
                      <HeadsetIcon size={20} />
                    </span>
                    <h3 id="pz-headset-title" className="pz-dlg-title">
                      Connect a headset
                    </h3>
                    <button type="button" className="pz-dlg-close" onClick={close} aria-label="Close">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="pz-dlg-body">
                  {state === "done" ? (
                    <div className="pz-headset-done" role="status">
                      <span className="pz-headset-tick" aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 12 5 5L20 7" />
                        </svg>
                      </span>
                      <strong>Connected</strong>
                      <span>The headset signs in as you in a few seconds.</span>
                    </div>
                  ) : (
                    <>
                      <p className="pz-headset-help">
                        On the HoloLens, open <b>Pazl Real Wall</b> and choose{" "}
                        <b>Sign in with a code</b>. Type the code it shows.
                      </p>
                      <label className="pz-headset-label" htmlFor="pz-headset-code">
                        Code
                      </label>
                      <input
                        id="pz-headset-code"
                        ref={input}
                        className={`pz-headset-code${state === "error" ? " is-bad" : ""}`}
                        value={shown}
                        onChange={(e) => {
                          setCode(e.target.value);
                          if (state === "error") setState("idle");
                        }}
                        placeholder="ABC 123"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        inputMode="text"
                        maxLength={CODE_LENGTH + 1}
                        autoFocus
                        aria-describedby={message ? "pz-headset-err" : undefined}
                      />
                      {message ? (
                        <p id="pz-headset-err" className="pz-headset-err" role="alert">
                          {message}
                        </p>
                      ) : null}
                      <p className="pz-headset-note">
                        Only type a code from a headset you are holding. The code lasts 10 minutes.
                      </p>
                    </>
                  )}
                </div>

                <div className="pz-dlg-foot">
                  {state === "done" ? (
                    <button type="button" className="pz-dlg-btn pz-dlg-btn--primary" onClick={close}>
                      Done
                    </button>
                  ) : (
                    <>
                      <button type="button" className="pz-dlg-btn pz-dlg-btn--ghost" onClick={close}>
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="pz-dlg-btn pz-dlg-btn--primary"
                        disabled={typed.length !== CODE_LENGTH || state === "busy"}
                      >
                        {state === "busy" ? "Connecting…" : "Connect"}
                      </button>
                    </>
                  )}
                </div>
              </form>
            </div>,
            document.body
          )
        : null}
    </>
  );
};

export default ConnectHeadset;
