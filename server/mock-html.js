'use strict';
// Small valid experiment page used by LLM_MOCK=1. It passes every hard check of the checker.
// The first <script> block is the safety script from prompt 2, kept verbatim.
const MOCK_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thí nghiệm thử</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; font-family: system-ui, "Segoe UI", Arial, sans-serif; background: #f4f7fb; color: #12263a; }
  #app { height: 100vh; display: flex; flex-direction: column; gap: 2vh; padding: 3vh 3vw; box-sizing: border-box; }
  h1 { margin: 0; font-size: clamp(24px, 3vw, 44px); }
  .row { display: flex; align-items: center; gap: 1.5vw; font-size: clamp(18px, 1.6vw, 28px); }
  #tube { flex: 1; min-height: 0; border: 4px solid #12263a; border-radius: 12px; background: #ffffff; transition: background 0.4s; display: flex; align-items: center; justify-content: center; font-size: clamp(22px, 2.4vw, 40px); }
  button, select { font-size: clamp(18px, 1.6vw, 26px); padding: 0.6vh 1vw; }
</style>
</head>
<body>
<script>
window.gameReady = false;
function showGameError() {
  if (window.gameReady || document.getElementById("gameErrorBox")) return;
  var box = document.createElement("div");
  box.id = "gameErrorBox";
  box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#1b1f3a;color:#ffffff;display:flex;align-items:center;justify-content:center;text-align:center;padding:32px;font:600 26px/1.5 sans-serif";
  box.textContent = "Thí nghiệm gặp lỗi kỹ thuật nên chưa hiển thị được. Thầy cô vui lòng bấm tạo lại thí nghiệm.";
  document.body.appendChild(box);
}
window.addEventListener("error", showGameError);
window.addEventListener("load", function () { if (!window.gameReady) showGameError(); });
</script>
<div id="app">
  <h1>Thí nghiệm thử</h1>
  <div class="row">
    <label for="level">Nồng độ</label>
    <input id="level" type="range" min="1" max="5" step="1" value="1">
    <span id="levelText"></span>
    <label for="kind">Chất thử</label>
    <select id="kind"><option value="a">Dung dịch X</option><option value="b">Dung dịch Y</option></select>
    <button id="startBtn" type="button">Bắt đầu</button>
    <button id="resetBtn" type="button">Làm lại</button>
  </div>
  <div id="tube"></div>
</div>
<script>
var COLORS = ["#ffffff", "#ffe9a8", "#ffd166", "#ff9f43", "#ee6c4d"];
var state = { level: 1, kind: "a", running: false };
var tubeEl, levelEl, levelTextEl, kindEl;
function fmt(n) { return String(n).replace(".", ","); }
function render() {
  levelTextEl.textContent = fmt(state.level) + " mol/L";
  tubeEl.style.background = state.running ? COLORS[state.level - 1] : "#ffffff";
  tubeEl.textContent = state.running ? "Kết quả: mức " + fmt(state.level) : "Chưa bắt đầu";
}
function init() {
  tubeEl = document.getElementById("tube");
  levelEl = document.getElementById("level");
  levelTextEl = document.getElementById("levelText");
  kindEl = document.getElementById("kind");
  levelEl.addEventListener("input", function () { state.level = Number(levelEl.value); render(); });
  kindEl.addEventListener("change", function () { state.kind = kindEl.value; render(); });
  document.getElementById("startBtn").addEventListener("click", function () { state.running = true; render(); });
  document.getElementById("resetBtn").addEventListener("click", function () {
    state.level = 1; state.kind = "a"; state.running = false;
    levelEl.value = "1"; kindEl.value = "a"; render();
  });
  render();
}
init();
window.gameReady = true;
</script>
</body>
</html>`;

module.exports = { MOCK_HTML };
