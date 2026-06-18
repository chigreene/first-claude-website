/* =====================================================================
   Portfolio — interaction layer
   Everything here is progressive enhancement. If JS fails, the page
   still reads, navigates, and submits.
   ===================================================================== */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer  = window.matchMedia("(pointer: fine)").matches;

  /* ---- Current year ---- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---- Mobile nav toggle ---- */
  var toggle = document.querySelector(".nav__toggle");
  var menu = document.getElementById("nav-menu");
  if (toggle && menu) {
    var closeMenu = function () {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
      menu.classList.remove("is-open");
    };
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      toggle.setAttribute("aria-label", open ? "Open menu" : "Close menu");
      menu.classList.toggle("is-open", !open);
    });
    // Close after choosing a destination, or on Escape.
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) closeMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });
  }

  /* ---- Nav background once scrolled ---- */
  var nav = document.querySelector(".nav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("is-stuck", window.scrollY > 24);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- Scroll reveal ---- */
  var revealEls = document.querySelectorAll("[data-reveal]");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          obs.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.12 });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---- Active section in HUD rail ---- */
  var railItems = Array.prototype.slice.call(document.querySelectorAll(".rail__item"));
  if (railItems.length && "IntersectionObserver" in window) {
    var byId = {};
    railItems.forEach(function (item) {
      var id = (item.getAttribute("href") || "").replace("#", "");
      if (id) byId[id] = item;
    });
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          railItems.forEach(function (i) { i.classList.remove("is-active"); });
          var active = byId[entry.target.id];
          if (active) active.classList.add("is-active");
        }
      });
    }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });
    Object.keys(byId).forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) sectionObserver.observe(sec);
    });
  }

  /* ---- Pointer-reactive spotlight (hero/background) ---- */
  if (finePointer && !reduceMotion) {
    var spot = document.querySelector(".field__spot");
    if (spot) {
      var rafSpot = null;
      window.addEventListener("pointermove", function (e) {
        if (rafSpot) return;
        rafSpot = requestAnimationFrame(function () {
          spot.style.setProperty("--mx", (e.clientX) + "px");
          spot.style.setProperty("--my", (e.clientY) + "px");
          rafSpot = null;
        });
      }, { passive: true });
    }

    /* ---- Pointer-aware glow on project cards ---- */
    document.querySelectorAll("[data-tilt]").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", (e.clientX - r.left) + "px");
        card.style.setProperty("--my", (e.clientY - r.top) + "px");
      });
    });
  }
})();
