'use strict';
// Front-end for the experiment generator. Plain JS, no build step, no network libraries.
// Box A = "Mô tả của thầy cô" (teacher only), box B = "Mô tả AI" (output of AI, editable afterwards).
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var R = window.Resolve;

  var el = {
    app: $('app'), screenInput: $('screen-input'), screenResult: $('screen-result'),
    subject: $('subject'), cls: $('class'), classNote: $('class-note'), lesson: $('lesson'),
    a: $('teacher-description'), b: $('ai-description'), aiBlock: $('ai-block'),
    aiButton: $('ai-button'), aiMessage: $('ai-message'), aiMessageText: $('ai-message-text'), aiRetry: $('ai-retry'),
    aiUndo: $('ai-undo'), aiClear: $('ai-clear'), aiStale: $('ai-stale-warning'), aiWarnings: $('ai-warnings'),
    extraToggle: $('extra-toggle'), extraNote: $('extra-note'), hint: $('description-hint'),
    cont: $('continue'), contMsg: $('continue-message'), contMsgText: $('continue-message-text'), contRetry: $('continue-retry'),
    back: $('back-to-edit'), resultTitle: $('result-title'), effective: $('effective-description'), regenerate: $('regenerate'),
    download: $('download'), fullscreen: $('fullscreen'), previewWrap: $('preview-wrap'),
    expMsg: $('experiment-message'), expMsgText: $('experiment-message-text'), expRetry: $('experiment-retry'),
    devBody: $('dev-body'), brain: $('brain-overlay'),
  };

  var state = {
    config: null,
    lessons: [],            // lessons of the current subject + class
    lastAiA: null,          // value of box A used for the latest successful AI run
    prev: null,             // { b, lastAiA } before the latest AI run, for "Hoàn tác"
    bShown: false,
    html: null,             // html of the current experiment
    blobUrl: null,
    used: '',               // description used for the current experiment
    lessonName: '',
    seq: { class: 0, lesson: 0 },
  };

  // ---- small helpers ---------------------------------------------------------------------------
  function h(tag, props) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') node.textContent = props[k];
      else if (k === 'class') node.className = props[k];
      else node.setAttribute(k, props[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function fillSelect(select, placeholder, items, valueKey, labelKey) {
    select.innerHTML = '';
    select.appendChild(h('option', { value: '', text: placeholder }));
    items.forEach(function (it) { select.appendChild(h('option', { value: it[valueKey], text: it[labelKey] })); });
  }

  function getJson(url) {
    return fetch(url).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.ok === false) throw new Error(d.error || ('Lỗi ' + r.status));
        return d;
      });
    }, function () { throw new Error('Không kết nối được máy chủ.'); });
  }

  // POST with a client-side deadline. A timeout aborts the request (the server then cancels the model call).
  function postJson(url, body, timeoutMs) {
    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, timeoutMs);
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok || d.ok === false) throw new Error(d.error || ('Lỗi ' + r.status));
          return d;
        });
      }, function () {
        if (ac.signal.aborted) throw new Error('Quá thời gian chờ (' + Math.round(timeoutMs / 1000) + ' giây). Vui lòng thử lại.');
        throw new Error('Không kết nối được máy chủ.');
      })
      .finally(function () { clearTimeout(timer); });
  }

  // ---- brain screen -------------------------------------------------------------------------------
  var brainDepth = 0;
  function showBrain() {
    brainDepth++;
    el.brain.hidden = false;
    el.app.inert = true;
    el.app.setAttribute('aria-busy', 'true');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  function hideBrain() {
    brainDepth = Math.max(0, brainDepth - 1);
    if (brainDepth > 0) return;
    el.brain.hidden = true;
    el.app.inert = false;
    el.app.removeAttribute('aria-busy');
  }

  // ---- derived UI state (single place that decides what is enabled / visible) ----------------------
  function selectionComplete() {
    return !!(el.subject.value && el.cls.value && el.lesson.value);
  }

  function updateUI() {
    var a = el.a.value;
    var b = el.b.value;
    var ok = selectionComplete();
    el.aiButton.disabled = !ok;
    el.aiButton.textContent = a.trim() === '' ? 'AI tạo mô tả' : 'AI hoàn thiện mô tả';
    el.cont.disabled = !(ok && R.hasDescription(a, b));
    el.hint.hidden = R.hasDescription(a, b);
    el.aiBlock.hidden = !state.bShown;
    el.aiUndo.hidden = !(state.prev && state.prev.b.trim() !== '');
    // Stale warning: box B outranks box A, so tell the teacher when A changed after the AI wrote B.
    el.aiStale.hidden = !(b.trim() !== '' && state.lastAiA !== null && a.trim() !== state.lastAiA.trim());
  }

  function showAiMessage(kind, text, withRetry) {
    el.aiMessage.className = 'msg ' + kind;
    el.aiMessageText.textContent = text;
    el.aiRetry.hidden = !withRetry;
    el.aiMessage.hidden = false;
  }
  function clearAiMessage() { el.aiMessage.hidden = true; }

  // ---- Màn 1: Môn / Lớp / Bài ----------------------------------------------------------------------
  function resetLesson(message) {
    state.lessons = [];
    el.lesson.innerHTML = '';
    el.lesson.appendChild(h('option', { value: '', text: message || 'Chọn bài học' }));
    el.lesson.disabled = true;
  }

  function loadSubjects() {
    return getJson('/api/subjects').then(function (d) {
      fillSelect(el.subject, 'Chọn môn học', d.subjects, 'id', 'name');
    }).catch(function (e) { showAiMessage('error', 'Không tải được danh sách môn: ' + e.message, false); });
  }

  function onSubjectChange() {
    var previousClass = el.cls.value;
    el.classNote.hidden = true;
    resetLesson();
    updateUI();
    if (!el.subject.value) {
      fillSelect(el.cls, 'Chọn lớp', [], 'id', 'name');
      el.cls.disabled = true;
      updateUI();
      return;
    }
    var token = ++state.seq.class;
    getJson('/api/classes?subjectCode=' + encodeURIComponent(el.subject.value)).then(function (d) {
      if (token !== state.seq.class) return;
      fillSelect(el.cls, 'Chọn lớp', d.classes, 'id', 'name');
      if (d.noBook || !d.classes.length) {
        el.cls.disabled = true;
        el.classNote.textContent = d.message || 'Môn này chưa có sách Kết nối tri thức';
        el.classNote.hidden = false;
      } else {
        el.cls.disabled = false;
        // Keep the class when the new subject has it, then reload its lessons.
        if (previousClass && d.classes.some(function (c) { return c.id === previousClass; })) el.cls.value = previousClass;
      }
      updateUI();
      if (el.cls.value) onClassChange();
    }).catch(function (e) {
      if (token !== state.seq.class) return;
      el.classNote.textContent = 'Không tải được danh sách lớp: ' + e.message;
      el.classNote.hidden = false;
    });
  }

  function onClassChange() {
    resetLesson();
    updateUI();
    if (!el.subject.value || !el.cls.value) return;
    var token = ++state.seq.lesson;
    fetch('/api/lessons', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectCode: el.subject.value, gradeCode: el.cls.value }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (token !== state.seq.lesson) return;
      if (!d.ok) throw new Error(d.error || 'Lỗi');
      state.lessons = d.lessons;
      if (!d.lessons.length) { resetLesson('Chưa có dữ liệu bài học cho lớp này'); updateUI(); return; }
      el.lesson.innerHTML = '';
      el.lesson.appendChild(h('option', { value: '', text: 'Chọn bài học' }));
      var groups = {};
      d.lessons.forEach(function (l) {
        var parent = el.lesson;
        if (l.group) {
          if (!groups[l.group]) { groups[l.group] = h('optgroup', { label: l.group }); el.lesson.appendChild(groups[l.group]); }
          parent = groups[l.group];
        }
        parent.appendChild(h('option', { value: l.id, text: l.name }));
      });
      el.lesson.disabled = false;
      updateUI();
    }).catch(function (e) {
      if (token !== state.seq.lesson) return;
      resetLesson('Không tải được danh sách bài học');
      showAiMessage('error', 'Không tải được danh sách bài học: ' + e.message, false);
      updateUI();
    });
  }

  function currentInputs() {
    var subjectName = el.subject.options[el.subject.selectedIndex].text;
    var className = el.cls.options[el.cls.selectedIndex].text;
    var lesson = state.lessons.filter(function (l) { return l.id === el.lesson.value; })[0];
    return {
      subject: subjectName, class: className,
      explain: lesson ? lesson.path.join(' > ') : '',
      lessonName: lesson ? lesson.name : '',
      note: el.extraNote.value,
    };
  }

  // ---- AI describe -------------------------------------------------------------------------------
  function runAi() {
    if (el.aiButton.disabled) return;
    var inp = currentInputs();
    var sentA = el.a.value;                       // prompt 1 always reads box A
    var payload = { subject: inp.subject, class: inp.class, explain: inp.explain, current: R.aiInput(sentA), note: inp.note };
    clearAiMessage();
    showBrain();
    postJson('/api/describe', payload, state.config.describeTimeoutMs).then(function (res) {
      hideBrain();
      if (res.kind === 'description') {
        state.prev = { b: el.b.value, lastAiA: state.lastAiA };
        el.b.value = res.text;
        state.lastAiA = sentA;
        state.bShown = true;
        if (res.warnings && res.warnings.length) {
          el.aiWarnings.textContent = 'Lưu ý: ' + res.warnings.join('; ');
          el.aiWarnings.hidden = false;
        } else el.aiWarnings.hidden = true;
      } else {
        showAiMessage('warn', 'AI chưa tạo được mô tả: ' + res.reason, false);
      }
      updateUI();
    }).catch(function (e) {
      hideBrain();
      showAiMessage('error', 'Lỗi khi nhờ AI: ' + e.message, true);
      updateUI();
    });
  }

  // ---- experiment ----------------------------------------------------------------------------------
  function showScreen(name) {
    el.screenInput.hidden = name !== 'input';
    el.screenResult.hidden = name !== 'result';
    window.scrollTo(0, 0);
  }

  function revokeBlob() {
    if (state.blobUrl) { URL.revokeObjectURL(state.blobUrl); state.blobUrl = null; }
  }

  function generateExperiment(origin) {
    var inp = currentInputs();
    var experiment = R.effectiveDescription(el.a.value, el.b.value);   // taken at click time
    var payload = { subject: inp.subject, class: inp.class, explain: inp.explain, experiment: experiment, note: inp.note, variant: state.config.defaultVariant };
    el.contMsg.hidden = true;
    el.expMsg.hidden = true;
    showBrain();
    postJson('/api/experiment', payload, state.config.experimentTimeoutMs).then(function (res) {
      hideBrain();
      state.used = experiment;
      state.lessonName = inp.lessonName;
      renderResult(res, inp);
      showScreen('result');
    }).catch(function (e) {
      hideBrain();
      if (origin === 'continue') {
        el.contMsgText.textContent = 'Không tạo được thí nghiệm: ' + e.message;
        el.contMsg.hidden = false;
      } else {
        showExpMessage('error', 'Không tạo được thí nghiệm: ' + e.message, true);
      }
    });
  }

  function showExpMessage(kind, text, withRetry) {
    el.expMsg.className = 'msg ' + kind;
    el.expMsgText.textContent = text;
    el.expRetry.hidden = !withRetry;
    el.expMsg.hidden = false;
  }

  function renderResult(res, inp) {
    el.resultTitle.textContent = inp.subject + ' · ' + inp.class + ' · ' + inp.lessonName;
    el.effective.value = state.used;
    el.previewWrap.innerHTML = '';
    el.expMsg.hidden = true;
    revokeBlob();
    state.html = null;
    if (res.kind === 'html') {
      state.html = res.html;
      var frame = h('iframe', { id: 'preview-frame', sandbox: 'allow-scripts', title: 'Xem trước thí nghiệm' });
      frame.srcdoc = res.html;
      var box = h('div', { class: 'frame-box' }, frame);
      el.previewWrap.appendChild(box);
      var fit = function () { frame.style.transform = 'scale(' + (box.clientWidth / 1920) + ')'; };
      fit();
      if (window.ResizeObserver) new ResizeObserver(fit).observe(box);
    } else if (res.kind === 'not_suitable') {
      showExpMessage('warn', 'Chưa tạo được thí nghiệm: ' + res.reason, false);
    } else {
      showExpMessage('error', 'Không tạo được thí nghiệm ổn định. Thầy Cô vui lòng thử lại.', false);
    }
    el.download.disabled = !state.html;
    el.fullscreen.disabled = !state.html;
    renderDevPanel(res);
  }

  function downloadHtml() {
    if (!state.html) return;
    var blob = new Blob([state.html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: 'thi-nghiem-' + window.VnText.slugify(state.lessonName) + '.html' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function openFullscreen() {
    if (!state.html) return;
    revokeBlob();
    state.blobUrl = URL.createObjectURL(new Blob([state.html], { type: 'text/html;charset=utf-8' }));
    window.open(state.blobUrl, '_blank');
  }

  // ---- dev panel -------------------------------------------------------------------------------------
  function fmtMs(ms) { return (ms / 1000).toFixed(1).replace('.', ',') + ' giây'; }
  function fmtTokens(u) {
    if (!u) return 'không có số token';
    return 'token: tổng ' + u.total_tokens + ' (vào ' + u.prompt_tokens + ', ra ' + u.completion_tokens + ')';
  }

  function runFile(runId, file, pre, button, labelOpen) {
    if (!pre.hidden) { pre.hidden = true; button.textContent = labelOpen; return; }
    pre.textContent = 'Đang tải…';
    pre.hidden = false;
    button.textContent = 'Ẩn';
    fetch('/api/run-file?dir=' + encodeURIComponent(runId) + '&file=' + encodeURIComponent(file))
      .then(function (r) { return r.text(); }).then(function (t) { pre.textContent = t; })
      .catch(function () { pre.textContent = 'Không đọc được file.'; });
  }

  function renderAttempt(a) {
    var box = h('div', { class: 'attempt' });
    var verdict = a.kind === 'error' ? h('span', { class: 'bad', text: 'LỖI GỌI MODEL' })
      : a.kind === 'not_suitable' ? h('span', { class: 'ok', text: 'KHÔNG PHÙ HỢP (model từ chối)' })
      : h('span', { class: a.passed ? 'ok' : 'bad', text: a.passed ? 'ĐẠT' : 'KHÔNG ĐẠT' });
    box.appendChild(h('div', {}, h('strong', { text: 'Lần thử ' + a.n }), ' · ' + fmtMs(a.ms) + ' · ' + fmtTokens(a.usage) + ' · variant ' + a.variant + ' · ', verdict));
    if (a.retries && a.retries.length) {
      box.appendChild(h('div', { class: 'note', text: 'Có ' + a.retries.length + ' lần gọi model bị lỗi rồi tự thử lại (' + a.retries.map(function (r) { return (r.status || r.kind) + ' sau ' + fmtMs(r.ms); }).join(', ') + '). Tổng thời gian chờ model: ' + fmtMs(a.wallMs) + '.' }));
    }
    if (a.error) box.appendChild(h('div', { class: 'bad', text: a.error }));
    if (a.checkerError) box.appendChild(h('div', { class: 'bad', text: 'Bộ kiểm tra gặp lỗi: ' + a.checkerError }));
    if (a.checker) {
      var ul = h('ul');
      Object.keys(a.checker.checks).forEach(function (id) {
        var c = a.checker.checks[id];
        ul.appendChild(h('li', {}, h('span', { class: c.pass ? 'ok' : 'bad', text: (c.pass ? '✔ ' : '✖ ') + id }), ' ' + c.title + (c.details.length ? ' — ' + c.details.join(' | ') : '')));
      });
      box.appendChild(ul);
    } else if (a.hardFailures && a.hardFailures.length) {
      var ul2 = h('ul');
      a.hardFailures.forEach(function (f) { ul2.appendChild(h('li', {}, h('span', { class: 'bad', text: '✖ ' + f.id }), ' ' + f.message)); });
      box.appendChild(ul2);
    }
    if (a.softWarnings && a.softWarnings.length) {
      var w = h('div', { class: 'note' }, h('strong', { text: 'Cảnh báo: ' }));
      a.softWarnings.forEach(function (s) { w.appendChild(h('div', { text: s.id + ' (' + s.count + ') ' + s.title + (s.message ? ': ' + s.message : '') })); });
      box.appendChild(w);
    }
    box.appendChild(h('div', { class: 'note' }, 'Thư mục: ', h('code', { text: 'runs/' + a.runId })));
    var promptPre = h('pre', { hidden: '' });
    var rawPre = h('pre', { hidden: '' });
    var bPrompt = h('button', { type: 'button', text: 'Xem prompt đã ghép' });
    var bRaw = h('button', { type: 'button', text: 'Xem đầu ra thô' });
    bPrompt.addEventListener('click', function () { runFile(a.runId, 'prompt.txt', promptPre, bPrompt, 'Xem prompt đã ghép'); });
    bRaw.addEventListener('click', function () { runFile(a.runId, 'raw.txt', rawPre, bRaw, 'Xem đầu ra thô'); });
    var row = h('div', {}, bPrompt, bRaw);
    (a.screens || []).forEach(function (s) {
      row.appendChild(h('a', { href: '/api/run-file?dir=' + encodeURIComponent(a.runId) + '&file=' + encodeURIComponent(s), target: '_blank', rel: 'noopener', text: s.replace('screens/', '') + '  ' }));
    });
    box.appendChild(row);
    box.appendChild(promptPre);
    box.appendChild(rawPre);
    return box;
  }

  function renderDevPanel(res) {
    el.devBody.innerHTML = '';
    (res.attempts || []).forEach(function (a) { el.devBody.appendChild(renderAttempt(a)); });
    if (!(res.attempts || []).length) el.devBody.textContent = 'Chưa có lần thử nào.';
  }

  // ---- events -------------------------------------------------------------------------------------
  function bind() {
    el.subject.addEventListener('change', onSubjectChange);
    el.cls.addEventListener('change', onClassChange);
    el.lesson.addEventListener('change', updateUI);
    el.a.addEventListener('input', updateUI);
    el.b.addEventListener('input', updateUI);
    el.aiButton.addEventListener('click', runAi);
    el.aiRetry.addEventListener('click', runAi);
    el.aiUndo.addEventListener('click', function () {
      if (!state.prev) return;
      el.b.value = state.prev.b;
      state.lastAiA = state.prev.lastAiA;
      state.prev = null;
      updateUI();
    });
    el.aiClear.addEventListener('click', function () { el.b.value = ''; updateUI(); });
    el.extraToggle.addEventListener('click', function () {
      el.extraNote.hidden = !el.extraNote.hidden;
      el.extraToggle.textContent = el.extraNote.hidden ? '+ Thêm yêu cầu' : '− Ẩn yêu cầu thêm';
    });
    el.cont.addEventListener('click', function () { if (!el.cont.disabled) generateExperiment('continue'); });
    el.contRetry.addEventListener('click', function () { generateExperiment('continue'); });
    el.regenerate.addEventListener('click', function () { generateExperiment('regenerate'); });
    el.expRetry.addEventListener('click', function () { generateExperiment('regenerate'); });
    el.back.addEventListener('click', function () { showScreen('input'); });
    el.download.addEventListener('click', downloadHtml);
    el.fullscreen.addEventListener('click', openFullscreen);
  }

  function init() {
    bind();
    getJson('/api/config').then(function (cfg) {
      state.config = cfg;
      return loadSubjects();
    }).then(updateUI);
    updateUI();
  }

  init();
})();
