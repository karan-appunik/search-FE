import { useEffect } from "react";
import { redirect, useNavigate } from "react-router";

import landingCss from "./landing.css?url";
import landingHtml from "./landing.html?raw";

// Public landing page (askmerce.space). Installation must start
// from a Shopify-owned surface (App Store requirement 2.3.1), so
// there is no "enter your shop domain" form here; merchants
// install and open the app from Shopify.
// Any sign the request comes from the Shopify admin: open the
// app (the dashboard) straight away.
const ADMIN_PARAMS = ["shop", "host", "embedded", "id_token", "hmac"];

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (ADMIN_PARAMS.some((name) => url.searchParams.has(name))) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export const meta = () => [
  { title: "Askmerce — Search that understands people" },
  {
    name: "description",
    content:
      "Askmerce lets shoppers search your Shopify store the way they talk — typos, everyday words and budgets — and shows the right products.",
  },
];

export const links = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
  },
  { rel: "stylesheet", href: landingCss },
];

// Shown inside the Shopify admin only for a moment if the admin
// loaded this address without its usual parameters: it goes on
// to the dashboard. Outside Shopify (e.g. someone opening the
// app's address directly) the landing page below shows.
function useOpenDashboardWhenEmbedded() {
  const navigate = useNavigate();

  useEffect(() => {
    let embedded = false;

    try {
      embedded = window.top !== window.self;
    } catch {
      embedded = true;
    }

    if (!embedded) {
      return;
    }

    if (window.location.search) {
      window.location.replace(`/app${window.location.search}`);
    } else {
      // Reached from inside the app (e.g. a link to "/"): stay in
      // the app so its Shopify session is kept.
      navigate("/app", { replace: true });
    }
  }, [navigate]);
}

// Starts the page's animations and the light/dark switch in the
// browser, and stops them when the page is left.
function useLandingBehaviour() {
  useEffect(() => {
    let stop = null;
    let cancelled = false;

    import("./landing-script.js").then(({ startLanding }) => {
      if (!cancelled) {
        stop = startLanding();
      }
    });

    return () => {
      cancelled = true;
      if (stop) {
        stop();
      }
      document.documentElement.removeAttribute("data-theme");
    };
  }, []);
}

// Runs before the page paints: inside the admin it hides the page
// while going on to the dashboard; outside it picks the colour
// theme (light unless the visitor chose dark before).
const BEFORE_PAINT = [
  "(function(){var s=window.location.search;if(!s)return;var e=true;try{e=window.top!==window.self;}catch(x){}if(e){document.documentElement.style.visibility='hidden';window.location.replace('/app'+s);}})();",
  "(function(){var t='light';try{var v=localStorage.getItem('askmerce-theme');if(v==='light'||v==='dark')t=v;}catch(e){}document.documentElement.setAttribute('data-theme',t);})();",
].join("");

export default function App() {
  useOpenDashboardWhenEmbedded();
  useLandingBehaviour();

  return (
    <>
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }}
      />
      <div
        // Static marketing markup kept as HTML so the design stays
        // exactly as approved; it contains no user input.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: landingHtml }}
      />
    </>
  );
}
