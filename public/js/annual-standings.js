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
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? window.innerWidth);
    const bottom = top + (viewport?.height ?? window.innerHeight);

    // A menu without a visible anchor is confusing, especially after scrolling.
    if (bounds.bottom <= top || bounds.top >= bottom || bounds.right <= left || bounds.left >= right) {
      if (menu.matches(":popover-open")) menu.hidePopover();
      return false;
    }

    menu.style.maxWidth = `${Math.max(0, right - left - margin * 2)}px`;
    const width = parseFloat(getComputedStyle(menu).width);
    const belowTop = Math.max(top + margin, bounds.bottom + gap);
    const aboveBottom = Math.min(bottom - margin, bounds.top - gap);
    const below = Math.max(0, bottom - margin - belowTop);
    const above = Math.max(0, aboveBottom - top - margin);
    const opensBelow = below >= 176 || below >= above;
    const heightLimit = Math.min(264, opensBelow ? below : above);
    menu.style.maxHeight = `${heightLimit}px`;
    menu.style.left = `${Math.max(left + margin, Math.min(bounds.right - width, right - width - margin))}px`;
    // Closed popovers have no layout box. The toggle handler refines the height.
    const height = menu.offsetHeight || heightLimit;
    const preferredTop = opensBelow ? belowTop : aboveBottom - height;
    menu.style.top = `${Math.max(top + margin, Math.min(preferredTop, bottom - margin - height))}px`;
    return true;
  }

  menu.addEventListener("beforetoggle", (event) => {
    if (event.newState === "open" && !positionMenu()) event.preventDefault();
  });
  menu.addEventListener("toggle", (event) => {
    const open = event.newState === "open";
    trigger.setAttribute("aria-expanded", String(open));
    if (!open) return;
    if (!positionMenu()) return;
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
