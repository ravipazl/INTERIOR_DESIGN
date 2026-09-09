import { useEffect, useState } from "react";

/**
 * Where the canvas row starts, in viewport pixels.
 *
 * The Designer's side panels are position:fixed, so they need an explicit
 * `top`, while the docked Floor plan panel gets one for free from the layout.
 * Hardcoding it (top-48, top: 90) left panels misaligned the moment the
 * toolbar moved into the navbar.
 *
 * Measuring #bp3d-js-app instead means every fixed panel lines up with the
 * canvas whatever the header height turns out to be, and keeps lining up if it
 * changes again.
 *
 * Shared so the render panel and the model catalogue cannot drift apart.
 */
export default function useDockTop(fallback = 192) {
  const [top, setTop] = useState<number>(fallback);

  useEffect(() => {
    const measure = () => {
      const el = document.getElementById("bp3d-js-app");
      if (el) setTop(Math.round(el.getBoundingClientRect().top));
    };
    measure();
    window.addEventListener("resize", measure);
    // The header renders its toolbar through a portal, so its height can settle
    // a tick after mount; re-measure once the layout is done.
    const t = setTimeout(measure, 250);
    return () => {
      window.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, []);

  return top;
}
