'use strict';
// External script keeps CSP intact; both standalone and OS package layouts work.
window.akhtarChartsReady = (async () => {
  for (const src of ['../../node_modules/chart.js/dist/chart.umd.js', '../../../../node_modules/chart.js/dist/chart.umd.js']) {
    const loaded = await new Promise(resolve => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve(true);
      script.onerror = () => { script.remove(); resolve(false); };
      document.head.appendChild(script);
    });
    if (loaded && typeof Chart === 'function') return true;
  }
  return false;
})();
