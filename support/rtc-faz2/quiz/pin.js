/* RTC Faz 2 — shared numeric PIN gate (client-side). */
(function (global) {
  var PIN = '7722';
  var KEY = 'rtc_faz2_unlocked_v1';
  var LEN = 4;

  function unlocked() {
    try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function unlock() {
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
  }

  function mount(opts) {
    opts = opts || {};
    var onOk = typeof opts.onOk === 'function' ? opts.onOk : function () {};
    if (unlocked()) { onOk(); return; }

    var root = document.createElement('div');
    root.id = 'rtcPinGate';
    root.innerHTML =
      '<div class="rtc-gate">' +
        '<div class="rtc-gate-card">' +
          '<div class="rtc-gate-brand">FlyFam · study</div>' +
          '<h1>RTC Faz 2</h1>' +
          '<p class="rtc-gate-sub">Giriş için 4 haneli şifre</p>' +
          '<input id="rtcPinInput" class="rtc-gate-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="4" enterkeyhint="done" aria-label="Şifre" />' +
          '<div class="rtc-dots" id="rtcDots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
          '<div class="rtc-gate-msg" id="rtcGateMsg"></div>' +
          '<div class="rtc-pad" id="rtcPad">' +
            '<button type="button" data-k="1">1</button>' +
            '<button type="button" data-k="2">2</button>' +
            '<button type="button" data-k="3">3</button>' +
            '<button type="button" data-k="4">4</button>' +
            '<button type="button" data-k="5">5</button>' +
            '<button type="button" data-k="6">6</button>' +
            '<button type="button" data-k="7">7</button>' +
            '<button type="button" data-k="8">8</button>' +
            '<button type="button" data-k="9">9</button>' +
            '<button type="button" data-k="clear" class="muted">C</button>' +
            '<button type="button" data-k="0">0</button>' +
            '<button type="button" data-k="del" class="muted">⌫</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    document.documentElement.classList.add('rtc-gated');

    var pin = '';
    var dots = root.querySelector('#rtcDots');
    var msg = root.querySelector('#rtcGateMsg');
    var input = root.querySelector('#rtcPinInput');

    function paint() {
      var kids = dots.children;
      for (var i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i < pin.length);
      input.value = pin;
    }
    function fail(text) {
      dots.classList.remove('shake');
      void dots.offsetWidth;
      dots.classList.add('shake');
      msg.textContent = text || 'Yanlış şifre';
      pin = '';
      paint();
      input.focus();
    }
    function trySubmit() {
      if (pin.length !== LEN) return;
      if (pin === PIN) {
        unlock();
        document.documentElement.classList.remove('rtc-gated');
        root.remove();
        onOk();
        return;
      }
      fail('Yanlış şifre');
    }
    function addDigit(d) {
      if (pin.length >= LEN) return;
      pin += d;
      msg.textContent = '';
      paint();
      if (pin.length === LEN) trySubmit();
    }

    root.querySelector('#rtcPad').addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]');
      if (!b) return;
      var k = b.getAttribute('data-k');
      if (k === 'del') { pin = pin.slice(0, -1); msg.textContent = ''; paint(); }
      else if (k === 'clear') { pin = ''; msg.textContent = ''; paint(); }
      else if (/^\d$/.test(k)) addDigit(k);
    });

    input.addEventListener('input', function () {
      var v = String(input.value || '').replace(/\D/g, '').slice(0, LEN);
      pin = v;
      paint();
      if (pin.length === LEN) trySubmit();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); trySubmit(); }
      // block non-digits except controls
      if (e.key.length === 1 && !/\d/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
      }
    });
    document.addEventListener('keydown', function onKey(e) {
      if (!document.getElementById('rtcPinGate')) {
        document.removeEventListener('keydown', onKey);
        return;
      }
      if (e.target === input) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); addDigit(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); pin = pin.slice(0, -1); paint(); }
      else if (e.key === 'Escape') { pin = ''; paint(); }
    });

    paint();
    setTimeout(function () { input.focus(); }, 30);
  }

  global.RtcFaz2Pin = { mount: mount, unlocked: unlocked };
})(window);
