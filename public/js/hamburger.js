// Hamburger menu toggle (moved from inline script for CSP compliance)
const hamburgerBtn = document.getElementById('hamburger-btn');
const mobileNavMenu = document.getElementById('mobile-nav-menu');
if (hamburgerBtn && mobileNavMenu) {
  hamburgerBtn.addEventListener('click', () => {
    const isOpen = mobileNavMenu.classList.toggle('open');
    hamburgerBtn.classList.toggle('open', isOpen);
    hamburgerBtn.setAttribute('aria-expanded', String(isOpen));
  });
  document.addEventListener('click', (e) => {
    if (!hamburgerBtn.contains(e.target) && !mobileNavMenu.contains(e.target)) {
      mobileNavMenu.classList.remove('open');
      hamburgerBtn.classList.remove('open');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

// Round 93: header scroll-aware shrink
(function() {
  const hdr = document.querySelector('header');
  if (!hdr) return;
  var ticking = false;
  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(function() {
        hdr.classList.toggle('scrolled', window.scrollY > 40);
        ticking = false;
      });
      ticking = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // initial state
})();
