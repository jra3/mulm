// Issue #19 Phase 2 — client-side CSRF token delivery.
//
// Reads the per-session token from <meta name="csrf-token"> (rendered into
// authenticated pages) and echoes it back on every same-origin, state-changing
// request as the `X-CSRF-Token` header. Covers both HTMX requests and raw
// fetch() calls (image upload, passkey registration, collection images) so no
// individual call site needs to be touched.
(function () {
  "use strict";

  var meta = document.querySelector('meta[name="csrf-token"]');
  var token = meta ? meta.getAttribute("content") : null;
  if (!token) {
    // Anonymous pages have no token; nothing to attach.
    return;
  }
  window.csrfToken = token;

  var UNSAFE = /^(POST|PUT|PATCH|DELETE)$/i;

  // HTMX: hx-post / hx-patch / hx-delete all fire this event before sending.
  document.addEventListener("htmx:configRequest", function (evt) {
    if (evt.detail && evt.detail.headers && UNSAFE.test(evt.detail.verb || "")) {
      evt.detail.headers["X-CSRF-Token"] = token;
    }
  });

  // fetch(): wrap so same-origin mutating requests carry the header too.
  if (typeof window.fetch === "function") {
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      init = init || {};
      var method =
        (init.method ||
          (typeof input !== "string" && input && input.method) ||
          "GET").toUpperCase();

      var url = typeof input === "string" ? input : (input && input.url) || "";
      // Same-origin if relative (no scheme) or it starts with our origin.
      var isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
      var sameOrigin = !isAbsolute || url.indexOf(window.location.origin) === 0;

      if (sameOrigin && UNSAFE.test(method)) {
        var headers = new Headers(
          init.headers || (typeof input !== "string" && input && input.headers) || {}
        );
        if (!headers.has("X-CSRF-Token")) {
          headers.set("X-CSRF-Token", token);
        }
        init.headers = headers;
      }
      return originalFetch(input, init);
    };
  }
})();
