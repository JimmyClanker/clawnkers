// Round 79: scroll-to-top button
(function() {
  var btn = document.getElementById('scroll-top-btn');
  if (!btn) return;
  window.addEventListener('scroll', function() {
    var show = window.scrollY > 400;
    btn.style.opacity = show ? '1' : '0';
    btn.style.pointerEvents = show ? 'auto' : 'none';
  }, { passive: true });
  btn.addEventListener('click', function() { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  btn.addEventListener('mouseenter', function() {
    btn.style.borderColor = 'rgba(212,88,10,0.4)';
    btn.style.color = '#D4580A';
    btn.style.transform = 'translateY(-2px)';
  });
  btn.addEventListener('mouseleave', function() {
    btn.style.borderColor = '';
    btn.style.color = '';
    btn.style.transform = '';
  });
})();

// Round 91: Global toast notification system
window.showToast = (function() {
  var container = null;
  function getContainer() {
    if (!container) container = document.getElementById('toast-container');
    return container;
  }
  return function showToast(message, type, durationMs) {
    var c = getContainer();
    if (!c) return;
    type = type || 'info'; // 'success' | 'error' | 'info'
    durationMs = durationMs || 3000;
    var colors = {
      success: { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)', color: '#86efac', icon: '✓' },
      error:   { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', color: '#f87171', icon: '✕' },
      info:    { bg: 'rgba(212,88,10,0.12)', border: 'rgba(212,88,10,0.3)', color: '#ffd3b6', icon: 'ℹ' },
    };
    var s = colors[type] || colors.info;
    var toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    Object.assign(toast.style, {
      background: s.bg,
      border: '1px solid ' + s.border,
      borderRadius: '10px',
      padding: '10px 16px',
      fontSize: '0.85rem',
      fontFamily: 'Inter, sans-serif',
      color: s.color,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      pointerEvents: 'auto',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      opacity: '0',
      transform: 'translateY(8px)',
      transition: 'opacity 0.22s ease, transform 0.22s ease',
      maxWidth: '300px',
      wordBreak: 'break-word',
    });
    toast.innerHTML = '<span style="font-weight:700;flex-shrink:0;">' + s.icon + '</span><span>' + String(message) + '</span>';
    c.appendChild(toast);
    // Animate in
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });
    });
    // Animate out + remove
    var timer = setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, durationMs);
    // Click to dismiss
    toast.addEventListener('click', function() {
      clearTimeout(timer);
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    });
  };
})();
