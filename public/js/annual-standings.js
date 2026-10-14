// Render the year choices in the page so browser-native popup positioning cannot
// separate them from the heading in a scaled mobile viewport.
(() => {
  const trigger = document.getElementById("annual-year-trigger");
  const menu = document.getElementById("annual-year-menu");
  if (!trigger || !menu) return;

  function positionMenu() {
    const bounds = trigger.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const width = parseFloat(getComputedStyle(menu).width);
    const below = window.innerHeight - bounds.bottom - gap - margin;
    const above = bounds.top - gap - margin;
    const opensBelow = below >= 176 || below >= above;
    menu.style.maxHeight = `${Math.min(264, Math.max(0, opensBelow ? below : above))}px`;
    menu.style.left = `${Math.max(margin, Math.min(bounds.right - width, window.innerWidth - width - margin))}px`;
    menu.style.top = `${opensBelow ? bounds.bottom + gap : Math.max(margin, bounds.top - gap - menu.offsetHeight)}px`;
  }

  menu.addEventListener("beforetoggle", (event) => {
    if (event.newState === "open") {
      positionMenu();
    }
  });
  menu.addEventListener("toggle", (event) => {
    const open = event.newState === "open";
    trigger.setAttribute("aria-expanded", String(open));
    if (!open) return;
    positionMenu();
    const selected = menu.querySelector('[aria-current="page"]') || menu.querySelector("a");
    selected?.focus({ preventScroll: true });
    if (selected) menu.scrollTop = selected.offsetTop - menu.clientHeight / 2 + selected.offsetHeight / 2;
  });

  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      menu.hidePopover();
      trigger.focus();
      return;
    }
    const links = [...menu.querySelectorAll("a")];
    let index = links.indexOf(document.activeElement);
    if (event.key === "ArrowDown") index = Math.min(index + 1, links.length - 1);
    else if (event.key === "ArrowUp") index = Math.max(index - 1, 0);
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = links.length - 1;
    else return;
    event.preventDefault();
    links[index]?.focus();
  });

  function repositionIfOpen() {
    if (menu.matches(":popover-open")) positionMenu();
  }
  window.addEventListener("resize", repositionIfOpen);
  window.addEventListener("scroll", repositionIfOpen, { passive: true });
  window.visualViewport?.addEventListener("resize", repositionIfOpen);
  window.visualViewport?.addEventListener("scroll", repositionIfOpen);
})();
