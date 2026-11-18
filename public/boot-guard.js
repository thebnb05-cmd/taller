(function () {
  var mounted = false;
  var shownError = false;
  var watchdogTimer = null;

  function clearCachesAndReload(preserveUrl) {
    var tasks = [];
    try {
      if (window.navigator && window.navigator.serviceWorker && window.navigator.serviceWorker.getRegistrations) {
        tasks.push(
          window.navigator.serviceWorker.getRegistrations().then(function (regs) {
            var list = [];
            for (var i = 0; i < regs.length; i++) {
              list.push(regs[i].unregister().catch(function () { return false; }));
            }
            return Promise.all(list);
          }).catch(function () {})
        );
      }
    } catch (e) {}

    try {
      if (window.caches && window.caches.keys) {
        tasks.push(
          window.caches.keys().then(function (names) {
            var list = [];
            for (var i = 0; i < names.length; i++) {
              list.push(window.caches.delete(names[i]).catch(function () { return false; }));
            }
            return Promise.all(list);
          }).catch(function () {})
        );
      }
    } catch (e) {}

    Promise.all(tasks).then(function () {
      if (preserveUrl) {
        window.location.reload();
        return;
      }
      try {
        var url = window.location.href.split('#')[0];
        var sep = url.indexOf('?') === -1 ? '?' : '&';
        window.location.replace(url + sep + '_cb=' + Date.now());
      } catch (e) {
        window.location.reload();
      }
    });
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showBootFailure(title, detail, isSyntaxOrCompat) {
    if (mounted || shownError) return;
    shownError = true;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }

    var root = document.getElementById('root');
    if (!root) return;

    var ua = '';
    try {
      ua = String(window.navigator.userAgent || '').slice(0, 180);
    } catch (e) {}

    var compatHint = isSyntaxOrCompat
      ? '<p style="margin:10px 0 0;font-size:12px;line-height:1.45;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;">' +
        'Este navegador parece estar desactualizado para la app. En Android 11 abrí la app desde <strong>Google Chrome actualizado</strong> (o actualizá Chrome y "Android System WebView" en Play Store).' +
        '</p>'
      : '';

    root.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:#f8fafc;color:#0f172a;font-family:system-ui,-apple-system,sans-serif;">' +
      '  <div style="width:100%;max-width:440px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:22px;box-shadow:0 4px 20px rgba(15,23,42,0.06);">' +
      '    <h2 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#0f172a;">' + escapeHtml(title) + '</h2>' +
      '    <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#475569;">No se pudo terminar de cargar la pantalla en este dispositivo.</p>' +
      '    <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;font-family:monospace;font-size:11px;color:#334155;word-break:break-word;">' +
             escapeHtml(detail) +
      '    </div>' +
           compatHint +
      (ua
        ? '<p style="margin:10px 0 0;font-size:11px;color:#64748b;word-break:break-word;">Navegador: ' + escapeHtml(ua) + '</p>'
        : '') +
      '    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">' +
      '      <button id="th3-boot-retry" type="button" style="flex:1;min-width:160px;height:40px;border:none;border-radius:10px;background:#0072BB;color:#ffffff;font-size:13px;font-weight:600;cursor:pointer;">Limpiar caché y recargar</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    var btn = document.getElementById('th3-boot-retry');
    if (btn) {
      btn.onclick = function () {
        btn.disabled = true;
        btn.textContent = 'Limpiando caché...';
        clearCachesAndReload(false);
      };
    }
  }

  window.__th3MarkMounted = function () {
    mounted = true;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };

  window.addEventListener(
    'error',
    function (event) {
      if (mounted) return;
      var target = event && event.target;
      if (target && target.tagName === 'SCRIPT') {
        var src = target.src || 'script principal';
        try {
          if (!window.sessionStorage.getItem('th3_sw_recover_once')) {
            window.sessionStorage.setItem('th3_sw_recover_once', '1');
            clearCachesAndReload(true);
            return;
          }
        } catch (e) {}
        showBootFailure(
          'No se pudo descargar la aplicación',
          'Fallo al cargar: ' + src,
          false
        );
        return;
      }

      var msg = (event && (event.message || (event.error && event.error.message))) || 'Error de ejecución al iniciar';
      var lower = String(msg).toLowerCase();
      var isCompat =
        lower.indexOf('syntaxerror') !== -1 ||
        lower.indexOf('unexpected token') !== -1 ||
        lower.indexOf('is not a function') !== -1 ||
        lower.indexOf('not supported') !== -1;
      showBootFailure('Error al iniciar en este dispositivo', msg, isCompat);
    },
    true
  );

  window.addEventListener('unhandledrejection', function (event) {
    if (mounted) return;
    var reason = event && event.reason;
    var msg = (reason && reason.message) ? reason.message : String(reason || 'Error asíncrono al iniciar');
    showBootFailure('Error al conectar la aplicación', msg, false);
  });

  watchdogTimer = setTimeout(function () {
    if (mounted) return;
    var root = document.getElementById('root');
    if (root && root.getAttribute('data-mounted') === '1') {
      mounted = true;
      return;
    }
    showBootFailure(
      'La aplicación tardó demasiado en iniciar',
      'El código principal no terminó de ejecutarse (posible caché viejo o navegador incompatible).',
      true
    );
  }, 9000);
})();
