import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { mountHome, mountTurntables, LAMINATES, HOME_PIECES, ROOMS } from "./kitchen";
import { BrandLogo, BrandName } from "@pazl/components/BrandLogo";
import "./landing.css";

/* The page signed-out visitors see at "/": what Pazl does, shown with the
   Designer's own 3D units and screens from the app. */

const SHOTS = "/landing/shots/";

// --- How it works: the steps the player walks through -----------------------
const STEPS = [
  { title: "Create the project", short: "Project", shot: "create",
    lead: "Client, site address and architect in one short form.",
    checks: ["Project and client details", "Architect assigned", "Project tracker started"],
    facts: [["Client", "Demo Client"], ["Site", "Chennai"], ["Status", "Open"]] },
  { title: "Start from a template", short: "Template", shot: "template",
    lead: "Rectangle, L or T room, or a saved plan of your own.",
    checks: ["Ready-made room shapes", "Your saved plans", "Sizes in feet or millimetres"],
    facts: [["Room", "Rectangle"], ["Size", "15 × 20 ft"], ["Area", "25.78 m²"]] },
  { title: "Draw the floor plan", short: "Floor plan", shot: "plan",
    lead: "Walls with exact lengths; doors and windows where they really are.",
    checks: ["Walls to the millimetre", "Doors and windows", "Import a plan you already have"],
    facts: [["Walls", "4"], ["Height", "3000 mm"], ["Units", "mm"]] },
  { title: "Furnish each room", short: "Furnish", shot: "kitchen",
    lead: "Kitchen layouts, wardrobes, TV units and beds — room by room.",
    checks: ["Kitchen: straight, L, U or parallel", "Bedroom and living-room planners", "Preview before placing"],
    facts: [["Rooms", "Kitchen · Bed · Living"], ["Layout", "L-shape"]] },
  { title: "Units placed for you", short: "Auto-place", shot: "placed",
    lead: "Pick the walls; base, wall and tall units fill them to size.",
    checks: ["Base units along both walls", "Wall units lined up above", "Tall unit at the end"],
    facts: [["Base", "11"], ["Wall", "12"], ["Tall", "1"]] },
  { title: "See it in 3D", short: "3D", shot: "model3d",
    lead: "Walk round the room; add from the catalogue by category.",
    checks: ["Kitchen, bedroom, living room catalogue", "Upload or generate your own model", "Swap a unit in place"],
    facts: [["Units", "24"], ["View", "3D"]] },
  { title: "Finishes and colours", short: "Finishes", shot: "finishes",
    lead: "Laminates for every shutter — kitchen, wardrobe, TV unit — and room colours.",
    checks: ["Laminate catalogues", "Wall, floor, ceiling", "Every unit, or one at a time"],
    facts: [["Laminate", "Wood 10002"], ["Walls", "Solid 21051"]] },
  { title: "A photo-real render", short: "Render", shot: "studio",
    lead: "Frame the shot, and AI turns the 3D view into a realistic image.",
    checks: ["Frame the shot", "Keep your colours and materials", "Download in 4K"],
    facts: [["Time", "15–30 s"], ["Size", "Up to 4K"]] },
  { title: "Bill of Quantity", short: "BOQ", shot: "boq",
    lead: "Every unit, size, material, rate and amount — from the design.",
    checks: ["Sizes from the 3D design", "Rates from your rate card", "PDF ready to send"],
    facts: [["Items", "10"], ["Area", "137.6 sq.ft"], ["Amount", "₹1,63,457"]] },
  { title: "Track to handover", short: "Tracker", shot: "detail",
    lead: "Quote, approval, production, installation — the client sees each step.",
    checks: ["Quote sent and approved", "Production and quality check", "Installation and handover"],
    facts: [["Steps", "10"], ["Client view", "Yes"]] },
];
const STEP_MS = 6500;

const UNITS = [
  { model: "base-600", room: "Kitchen", name: "Base unit", size: "600 × 850 × 582 mm", chips: ["Left or right opening", "Shelf inside"] },
  { model: "sink-1200", room: "Kitchen", name: "Sink unit", size: "1200 × 850 × 582 mm", chips: ["Sink and tap", "Under-sink space"] },
  { model: "wall-600", room: "Kitchen", name: "Wall unit", size: "600 × 600 × 325 mm", chips: ["1.45 m up", "Lined up for you"] },
  { model: "corner-1200", room: "Kitchen", name: "Corner unit", size: "1200 × 850 × 1200 mm", chips: ["L and U kitchens", "No dead corner"] },
  { model: "wardrobe-600-l", room: "Bedroom", name: "Wardrobe", size: "600 × 2080 × 593 mm", chips: ["Hanging and shelves", "Pairs into doubles"] },
  { model: "tall-600", room: "Kitchen · Utility", name: "Tall unit", size: "600 × 2080 × 600 mm", chips: ["Pantry or oven", "Floor to ceiling"] },
  { model: "tv-unit-1800", room: "Living room", name: "TV unit", size: "1800 × 350 × 450 mm", chips: ["Drawers, finger groove", "Matching wall panel"] },
  { model: "tv-panel-1800", room: "Living room", name: "TV wall panel", size: "1800 × 1500 mm", chips: ["Plain or grooved", "Any laminate"] },
];

const MODULES = [
  ["Projects & clients", "Every project with its client, site, architect and status.", "#a78bfa", "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  ["Floor plan", "Draw walls to the millimetre, or start from a template.", "#60a5fa", "M4 4h16v16H4zM4 12h8M12 4v16"],
  ["Room planners", "Kitchen, bedroom and living room — units placed for you.", "#f472b6", "M4 10h16M4 10V6h16v4M6 10v10M18 10v10M4 20h16"],
  ["3D catalogue", "Kitchen, bedroom and living-room units by category.", "#34d399", "M12 3 4 7.5v9L12 21l8-4.5v-9zM4 7.5 12 12l8-4.5M12 12v9"],
  ["Laminates & finishes", "Laminate catalogues for every shutter, room by room.", "#fbbf24", "M4 20 20 4M9 20l11-11M4 15 15 4"],
  ["AI render", "Photo-real images from your 3D view in seconds.", "#2dd4bf", "M4 7h3l2-2h6l2 2h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  ["BOQ", "Sizes, materials, rates and amounts from the design.", "#a78bfa", "M7 3h10v18l-2-1.5L13 21l-2-1.5L9 21l-2-1.5zM9.5 8h5M9.5 12h5"],
  ["Rate card", "Your prices for materials, hardware and labour.", "#60a5fa", "M20 12 12 20l-8-8V4h8zM8 8h.01"],
  ["Quotes & approval", "Send the quote; the client approves or asks for a change.", "#f472b6", "M4 12l5 5L20 6"],
  ["Project tracker", "Ten steps from start to handover, seen by the client.", "#34d399", "M4 12h4l3-8 4 16 3-8h2"],
  ["Workspace", "Documents, change requests, tasks and discussions.", "#fbbf24", "M4 5h16v11H8l-4 4z"],
  ["Headset view", "Stand the design in the real room on a HoloLens.", "#2dd4bf", "M3 10a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-4l-2-2.5h-2L9 17H5a2 2 0 0 1-2-2z"],
];

const TEAM = [
  ["Owners", "Every project, its quote and where it stands, at a glance."],
  ["Designers & architects", "Plan every room, furnish, render and send the quote from one place."],
  ["Clients", "See the design, approve the quote and follow the work."],
  ["Production", "Exact unit sizes and materials, straight from the BOQ."],
];

const FAQ = [
  ["Do I need to install anything?", "No. Pazl runs in the browser. The Designer is made for a computer or a tablet; on a phone you can follow projects, quotes and the tracker."],
  ["Can my clients see their design?", "Yes. A client signs in to their own project: they see the design and renders, approve the quote or ask for a change, and follow the tracker to handover."],
  ["Where do the prices in the BOQ come from?", "From your rate card: your rates for laminates, materials, hardware and labour. The sizes come from the 3D design, so the BOQ follows every change."],
  ["How long does a render take?", "About 15 to 30 seconds. Frame the shot in 3D, and the render keeps your colours and materials."],
  ["Can I start from a plan I already have?", "Yes. Import a floor plan, or start from a ready-made room and set the wall lengths."],
  ["Does it work with a headset?", "Yes. On a HoloLens 2 you can stand the design in the real room at life size and check that a unit fits a wall."],
];

const Icon = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

function Hero() {
  const canvas = useRef(null);
  const [ready, setReady] = useState(false);
  const [laminate, setLaminate] = useState(0);
  useEffect(() => {
    let k;
    try {
      k = mountHome(canvas.current, { onReady: () => setReady(true), onLaminate: setLaminate });
    } catch (e) {
      console.warn("landing: 3D unavailable", e);
    }
    return () => k && k.dispose();
  }, []);
  return (
    <section className="lp-hero" id="top">
      <div className="lp-wrap lp-hero-grid">
        <div className="lp-hero-copy">
          <span className="lp-eyebrow">Complete home interiors</span>
          <h1>
            Design every room.<br />Quote it. <span>Build it.</span>
          </h1>
          <p className="lp-lead">
            Kitchens, wardrobes, TV units, bedrooms and living rooms. Draw the home, furnish it
            in 3D, render it photo-real and send a Bill of Quantity your client can approve — then
            track the work to handover.
          </p>
          <div className="lp-cta-row">
            <Link className="lp-btn lp-btn--primary" to="/signup">Get started</Link>
            <a className="lp-btn lp-btn--ghost" href="#how">See how it works</a>
          </div>
          <ul className="lp-ticks">
            <li>Runs in the browser</li>
            <li>Your own rate card</li>
            <li>Clients approve online</li>
          </ul>
        </div>

        <div className="lp-hero-stage">
          <div className={`lp-stage${ready ? " is-ready" : ""}`}>
            <canvas ref={canvas} className="lp-stage-canvas" aria-label="A home designed in Pazl — kitchen, living room and bedroom — in 3D. Drag to look around." />
            {!ready ? <div className="lp-stage-loading">Loading the 3D home…</div> : null}
            <div className="lp-float lp-float--tl">
              <b>{ROOMS.length} rooms · {HOME_PIECES} pieces</b>
              <span>{ROOMS.join(" · ")}</span>
            </div>
            <div className="lp-float lp-float--tr">
              <span>Laminate</span>
              <b>{LAMINATES[laminate].name}</b>
            </div>
            <div className="lp-float lp-float--bl">
              <span>One design</span>
              <b>3D · Render · BOQ</b>
            </div>
            <div className="lp-drag-hint" aria-hidden="true">Drag to look around</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Strip() {
  const words = ["Kitchens", "Wardrobes", "Bedrooms", "Living rooms", "TV units", "Base units", "Wall units", "Tall units", "Corner units", "Laminates", "AI renders", "BOQ"];
  return (
    <div className="lp-strip" aria-label="What you can design">
      <div className="lp-strip-track">
        {[...words, ...words].map((w, i) => (
          <span key={i} aria-hidden={i >= words.length}>{w}</span>
        ))}
      </div>
    </div>
  );
}

function HowItWorks() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(
    () => !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
  const [elapsed, setElapsed] = useState(0); // ms into this step
  const visible = useRef(true);
  const box = useRef(null);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting));
    if (box.current) io.observe(box.current);
    return () => io.disconnect();
  }, []);
  // Time into the current step; runs only while playing and on screen.
  const into = useRef(0);
  useEffect(() => {
    if (!playing) return undefined;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      if (visible.current) into.current += now - last;
      last = now;
      if (into.current >= STEP_MS) {
        into.current = 0;
        setStep((s) => (s + 1) % STEPS.length);
      }
      setElapsed(into.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [playing]);

  const go = (i) => {
    setStep((i + STEPS.length) % STEPS.length);
    into.current = 0;
    setElapsed(0);
  };
  const s = STEPS[step];
  const pct = Math.min(1, elapsed / STEP_MS);
  const totalS = Math.round((STEPS.length * STEP_MS) / 1000);
  const nowS = Math.floor((step * STEP_MS + elapsed) / 1000);
  const mmss = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

  return (
    <section className="lp-section lp-how" id="how" ref={box}>
      <div className="lp-wrap">
        <div className="lp-head">
          <span className="lp-chip">How it works</span>
          <h2>From an empty room to an approved quote</h2>
          <p>Watch a home go through Pazl, step by step, in the app's own screens.</p>
        </div>

        <div className="lp-player">
          <div className="lp-player-screen">
            <div className="lp-browser">
              <div className="lp-browser-bar">
                <i /><i /><i />
                <span>design.pazl.info</span>
                <em className="lp-live">LIVE</em>
              </div>
              <div className="lp-browser-view">
                {STEPS.map((x, i) => (
                  <img
                    key={x.shot}
                    src={`${SHOTS}${x.shot}.webp`}
                    alt={i === step ? `${x.title} in the Pazl app` : ""}
                    className={i === step ? "is-on" : ""}
                    loading={i < 2 ? "eager" : "lazy"}
                    width="1600"
                    height="900"
                  />
                ))}
              </div>
            </div>
          </div>

          <aside className="lp-player-side">
            <div className="lp-step-no">Step {String(step + 1).padStart(2, "0")} of {STEPS.length}</div>
            <h3>{s.title}</h3>
            <p>{s.lead}</p>
            <ul className="lp-checks">
              {s.checks.map((c, i) => {
                // Each line fills in turn over the step.
                const share = 1 / s.checks.length;
                const fill = Math.max(0, Math.min(1, (pct - i * share * 0.8) / (share * 0.9)));
                return (
                  <li key={c}>
                    <span>{c}</span>
                    <b>{Math.round(fill * 100)}%</b>
                    <i style={{ transform: `scaleX(${fill})` }} />
                  </li>
                );
              })}
            </ul>
            <dl className="lp-facts">
              {s.facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="lp-player-controls">
              <button type="button" onClick={() => go(step - 1)} aria-label="Previous step">
                <Icon d="m15 18-6-6 6-6" />
              </button>
              <button type="button" className="is-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <Icon d="M8 5v14M16 5v14" /> : <Icon d="M7 5l12 7-12 7z" />}
              </button>
              <button type="button" onClick={() => go(step + 1)} aria-label="Next step">
                <Icon d="m9 18 6-6-6-6" />
              </button>
              <span className="lp-time">{mmss(nowS)} / {mmss(totalS)}</span>
            </div>
          </aside>
        </div>

        <ol className="lp-rail" aria-label="Steps">
          {STEPS.map((x, i) => (
            <li key={x.short}>
              <button
                type="button"
                className={i === step ? "is-on" : i < step ? "is-done" : ""}
                onClick={() => go(i)}
                aria-current={i === step ? "step" : undefined}
              >
                <small>Step {String(i + 1).padStart(2, "0")}</small>
                {x.short}
                <i style={i === step ? { transform: `scaleX(${pct})` } : undefined} />
              </button>
            </li>
          ))}
        </ol>

        <div className="lp-stats">
          <div><b>12</b><span>modules in one app</span></div>
          <div><b>10</b><span>steps, first sketch to handover</span></div>
          <div><b>15–30 s</b><span>per photo-real render</span></div>
          <div><b>1 : 1</b><span>life size on a real wall</span></div>
        </div>
      </div>
    </section>
  );
}

function Units() {
  const refs = useRef([]);
  useEffect(() => {
    let t;
    try {
      t = mountTurntables(UNITS.map((u, i) => ({ canvas: refs.current[i], model: u.model })));
    } catch (e) {
      console.warn("landing: 3D unavailable", e);
    }
    return () => t && t.dispose();
  }, []);
  return (
    <section className="lp-section" id="units">
      <div className="lp-wrap">
        <div className="lp-head">
          <span className="lp-chip">Units in 3D</span>
          <h2>Real units for every room, at their real sizes</h2>
          <p>The same models the Designer places — kitchen, bedroom and living room. Each one turns a full 360°; drag it to see the top, the sides and the back.</p>
        </div>
        <div className="lp-units">
          {UNITS.map((u, i) => (
            <article className="lp-unit" key={u.model}>
              <div className="lp-unit-stage">
                <canvas ref={(el) => (refs.current[i] = el)} aria-label={`${u.name}, in 3D. Drag to turn it.`} />
                <span className="lp-360">360°</span>
              </div>
              <div className="lp-unit-body">
                <small>{u.room}</small>
                <h3>{u.name}</h3>
                <p className="lp-unit-size">{u.size}</p>
                <div className="lp-unit-chips">
                  {u.chips.map((c) => <span key={c}>{c}</span>)}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Modules() {
  return (
    <section className="lp-section lp-modules-sec" id="features">
      <div className="lp-wrap">
        <div className="lp-head">
          <span className="lp-chip">Modules</span>
          <h2>Everything for a home, from the first sketch to handover</h2>
          <p>Twelve parts that work together, each one a page in the app.</p>
        </div>
        <div className="lp-modules">
          {MODULES.map(([title, text, colour, d]) => (
            <div className="lp-module" key={title} style={{ "--lp-ic": colour }}>
              <span className="lp-module-ic"><Icon d={d} /></span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RenderCompare() {
  const [pos, setPos] = useState(52);
  return (
    <section className="lp-section lp-split">
      <div className="lp-wrap lp-split-grid">
        <div>
          <span className="lp-chip">AI render</span>
          <h2>From the 3D view to a photo-real image</h2>
          <p>Frame any room in 3D and render it. Your colours and materials stay as you chose them, so what the client sees is what gets made.</p>
          <ul className="lp-list">
            <li>About 15–30 seconds a render</li>
            <li>Interior or exterior, with lighting to choose</li>
            <li>Every render saved to the project, ready to send</li>
          </ul>
        </div>
        <div className="lp-compare" style={{ "--lp-pos": `${pos}%` }}>
          <img src={`${SHOTS}render-after.webp`} alt="A room as a photo-real render" loading="lazy" />
          <img className="lp-compare-before" src={`${SHOTS}render-before.webp`} alt="The same room in the 3D view" loading="lazy" />
          <span className="lp-compare-tag lp-compare-tag--l">3D view</span>
          <span className="lp-compare-tag lp-compare-tag--r">Render</span>
          <span className="lp-compare-line" aria-hidden="true" />
          <input
            type="range"
            min="0"
            max="100"
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            aria-label="Slide between the 3D view and the render"
          />
        </div>
      </div>
    </section>
  );
}

function BoqAndWall() {
  return (
    <section className="lp-section">
      <div className="lp-wrap lp-duo">
        <div className="lp-card lp-boq">
          <span className="lp-chip">Bill of Quantity</span>
          <h3>Every unit, size and amount — for every room</h3>
          <div className="lp-boq-table" role="table" aria-label="Part of a Bill of Quantity">
            <div role="row" className="is-head"><span>Item</span><span>Area</span><span>Rate / sq.ft</span><span>Amount</span></div>
            <div role="row"><span>Wall unit 600 × 600</span><span>42.69</span><span>1,073.93</span><span>45,846.07</span></div>
            <div role="row"><span>Base unit 600 × 825</span><span>10.99</span><span>950.20</span><span>10,442.70</span></div>
            <div role="row"><span>Oil pull-out 200</span><span>3.68</span><span>1,343.38</span><span>4,943.64</span></div>
            <div role="row" className="is-total"><span>Kitchen · 10 items</span><span>137.6</span><span></span><span>₹1,63,457.14</span></div>
          </div>
          <p className="lp-note">Download as PDF, or send it to the client to approve.</p>
        </div>
        <div className="lp-card lp-wall">
          <span className="lp-chip">Headset view</span>
          <h3>Check it fits the real wall</h3>
          <p>On a HoloLens 2, stand a wardrobe, a TV unit or a whole kitchen run against the empty wall in the client's own room, at life size.</p>
          <div className="lp-wall-demo" aria-hidden="true">
            <div className="lp-wall-unit" />
            <div className="lp-wall-line" />
          </div>
          <div className="lp-fit">Fits · 1200 mm on 2430 mm · left 600 · right 630 mm</div>
        </div>
      </div>
    </section>
  );
}

function Team() {
  return (
    <section className="lp-section lp-team-sec">
      <div className="lp-wrap">
        <div className="lp-head">
          <span className="lp-chip">For the whole team</span>
          <h2>One project, a clear view for everyone</h2>
        </div>
        <div className="lp-team">
          {TEAM.map(([who, what]) => (
            <div key={who}>
              <h3>{who}</h3>
              <p>{what}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="lp-section" id="faq">
      <div className="lp-wrap lp-faq-wrap">
        <div className="lp-head">
          <span className="lp-chip">Questions</span>
          <h2>Good to know</h2>
        </div>
        <div className="lp-faq">
          {FAQ.map(([q, a], i) => (
            <details key={q} open={i === 0}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

const Landing = () => {
  useEffect(() => {
    const was = document.title;
    document.title = "Pazl — design, quote and build home interiors";
    return () => {
      document.title = was;
    };
  }, []);
  return (
    <div className="lp">
      <header className="lp-top">
        <div className="lp-wrap lp-top-row">
          <a className="lp-brand" href="#top" aria-label="Pazl, to the top">
            <BrandLogo fallback="/assets/icons/pazl_logo.svg" alt="" width="26" height="26" />
            <b>
              <BrandName />
            </b>
          </a>
          <nav className="lp-nav" aria-label="Page">
            <a href="#how">How it works</a>
            <a href="#units">Units</a>
            <a href="#features">Modules</a>
            <a href="#faq">Questions</a>
          </nav>
          <div className="lp-top-cta">
            <Link className="lp-link" to="/signin">Sign in</Link>
            <Link className="lp-btn lp-btn--light" to="/signup">Get started</Link>
          </div>
        </div>
      </header>
      <main>
        <Hero />
        <Strip />
        <HowItWorks />
        <Units />
        <Modules />
        <RenderCompare />
        <BoqAndWall />
        <Team />
        <Faq />
        <section className="lp-final">
          <div className="lp-wrap lp-final-row">
            <div>
              <h2>Start your first project</h2>
              <p>Draw the home, furnish every room and see it in 3D today.</p>
            </div>
            <div className="lp-cta-row">
              <Link className="lp-btn lp-btn--light" to="/signup">Get started</Link>
              <Link className="lp-btn lp-btn--outline-light" to="/signin">Sign in</Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-row">
          <span className="lp-brand lp-brand--dark">
            <BrandLogo fallback="/assets/icons/pazl_logo.svg" alt="" width="20" height="20" />
            <b>
              <BrandName />
            </b>
          </span>
          <span>© {new Date().getFullYear()} Pazl · Design, quote and build home interiors</span>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
