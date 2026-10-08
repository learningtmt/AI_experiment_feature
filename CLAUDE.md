# Hướng dẫn cho Claude (dự án AI_experiment_feature)

Prototype web chạy local để thử luồng "Tạo thí nghiệm tương tác" và kiểm thử hai prompt. Đọc `README.md` trước.

## Quy tắc bất biến
1. **Không sửa** nội dung `prompts/*.txt`, `eval/cases.json`, `tests/test_cases.md`. Đó là đối tượng và thước đo của việc kiểm thử. Thấy vấn đề thì ghi vào báo cáo, không sửa.
2. Không hard-code nội dung khoa học (hiện tượng, công thức, tên thí nghiệm) vào code. Nội dung đó chỉ đến từ AI hoặc từ mock (`LLM_MOCK`).
3. Khoá API chỉ đọc từ biến môi trường `OPENAI_API_KEY` (`.env` hoặc cấu hình môi trường cloud). Không in ra log, không ghi vào file, không gửi xuống front-end, không commit `.env`.
4. Front-end là HTML, CSS, JavaScript thuần, không CDN, không bước build.
5. Ô A "Mô tả của thầy cô" không bao giờ bị ứng dụng ghi đè. Prompt 1 luôn lấy `{current}` từ ô A; prompt 2 lấy ô B nếu có nội dung, không thì ô A (`server/resolve.js`).
6. Chữ trên giao diện bằng tiếng Việt có dấu, comment trong code bằng tiếng Anh, README bằng tiếng Việt.

## Lệnh thường dùng
- Cài: `npm ci && npx playwright install --with-deps chromium`
- Test (không tốn lượt gọi model): `npm test` (khoảng 40 giây)
- Smoke test model: `npm run smoke` (ghi API dùng được vào `config/app.json`)
- Eval với model thật: `node eval/run-eval.js --variants vi,en [--limit N] [--only id1,id2]`. Mỗi lần gọi model có thể mất 1 đến 4 phút; nên chạy nền và đặt `REQUEST_TIMEOUT_MS=420000`.
- Kết quả eval nằm ở `eval/results/` và `runs/` (đã gitignore). Muốn giữ lại thì copy vào thư mục riêng và `git add -f`.

## Ghi chú
- Model đang dùng tạm là Gemini qua endpoint tương thích OpenAI (xem README). Đổi nhà cung cấp thì chạy lại `npm run smoke`.
- Dữ liệu trong `fixtures/` là dữ liệu mẫu, không đối chiếu SGK.
