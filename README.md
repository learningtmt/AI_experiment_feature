# Tạo thí nghiệm tương tác (prototype)

Ứng dụng web chạy local để thử luồng **"Tạo thí nghiệm tương tác"** của Edmicro AI và kiểm thử hai prompt đi kèm.

Thầy cô chọn Môn, Lớp, Bài (sách Kết nối tri thức với cuộc sống), nhập mô tả thí nghiệm và/hoặc nhờ AI viết mô tả, rồi AI sinh một file HTML mô phỏng tương tác để chiếu trên lớp.

Đây là prototype để kiểm chứng **luồng, dữ liệu giữa các bước và chất lượng prompt**. Không có đăng nhập, không có database, không lưu lịch sử. Dev của Edmicro sẽ làm lại trên stack riêng.

> **Dữ liệu mẫu:** mọi môn, lớp, chương, bài trong `fixtures/` là dữ liệu mẫu để chạy thử, **không đối chiếu với SGK**. Mã môn ngoài Sinh học (`SDT_VATLI`, `SDT_HOAHOC`...) là suy đoán, chỉ dùng cho mock.

## Yêu cầu

- Node.js 18 trở lên (`node -v`). Đã chạy thử với Node 26.
- Một khoá API của model. Ứng dụng gọi qua gói `openai` chính thức, nên dùng được với OpenAI hoặc bất kỳ endpoint tương thích OpenAI (ví dụ Gemini, xem bên dưới).
- Playwright Chromium (cho bộ kiểm tra tự động và test e2e).

## Cài đặt

```bash
npm install
npx playwright install chromium
```

## Tạo `.env`

```bash
cp .env.example .env
```

Mở `.env` bằng trình soạn thảo và điền `OPENAI_API_KEY`. **Không gõ khoá vào chat, không commit `.env`** (đã nằm trong `.gitignore`). Chỉ `.env.example` (không có khoá) được commit.

| Biến | Ý nghĩa |
|---|---|
| `OPENAI_API_KEY` | Khoá API. Chỉ đọc từ biến môi trường, không bao giờ in ra log hay gửi xuống front-end. |
| `OPENAI_BASE_URL` | Để trống nếu dùng OpenAI. Điền URL gốc nếu dùng cổng/nhà cung cấp tương thích OpenAI. |
| `MODEL_ID` | Tên model. |
| `PORT` | Cổng web, mặc định 3000. Server chỉ nghe trên `127.0.0.1`. |
| `EXPERIMENT_PROMPT_VARIANT` | `vi` hoặc `en`: chọn file prompt 2. |
| `MAX_ATTEMPTS` | Số lần thử tối đa khi kiểm tra bắt buộc không đạt. |
| `REQUEST_TIMEOUT_MS` | Thời gian chờ tối đa cho **một lần gọi model**. Model "suy nghĩ" có thể mất 3 đến 4 phút để sinh HTML, nên cân nhắc đặt 360000 trở lên. |
| `ENABLE_CHECKER` | `true`/`false`: bật tắt bộ kiểm tra Playwright. |
| `LLM_MOCK` | `1`: không gọi model thật (xem mục LLM_MOCK). |
| `DATA_PROVIDER` | `mock` (mặc định) hoặc `real` (chưa cài đặt). |
| `TEMPERATURE`, `MAX_OUTPUT_TOKENS` | Chỉ đặt khi cần. Mặc định không gửi vì một số model từ chối các tham số này. |

Biến môi trường có sẵn trong shell thắng giá trị trong `.env` (cách dotenv hoạt động). Cách này cũng là cách đặt khoá khi chạy trong phiên cloud.

### Dùng Gemini thay cho OpenAI (tạm thời)

Gemini có endpoint tương thích OpenAI. Tên biến vẫn là `OPENAI_*`:

```
OPENAI_API_KEY=<khoá Gemini>
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
MODEL_ID=gemini-3.5-flash
```

Endpoint này chỉ có Chat Completions (không có Responses API). Mỗi lần đổi model hoặc nhà cung cấp, **chạy lại `npm run smoke`** để `config/app.json` ghi đúng API.

Lưu ý khi dùng model có bước "suy nghĩ" (như Gemini): `usage.completion_tokens` không gồm token suy nghĩ, nên hãy nhìn `total_tokens`.

## Chạy ứng dụng

```bash
npm start
```

Mở http://localhost:3000. Khi khởi động, server in ra danh sách môn **bị loại** bởi bộ lọc để bạn rà với danh sách thật.

Luồng: Màn 1 (chọn Môn, Lớp, Bài, nhập mô tả) → màn "brain" chặn thao tác trong lúc AI chạy → Màn 2 (xem trước thí nghiệm, tải file, toàn màn hình, công cụ kiểm thử).

### Hai ô mô tả: quy tắc dữ liệu

- **Ô A "Mô tả của thầy cô"**: chỉ thầy cô sửa. Ứng dụng không bao giờ ghi vào ô này.
- **Ô B "Mô tả AI"**: ẩn cho đến lần AI chạy thành công đầu tiên; là đầu ra của AI, thầy cô sửa tay được.
- Cần **ít nhất một trong hai** ô có nội dung (chuỗi chỉ gồm khoảng trắng coi như rỗng).
- **Prompt 1** (`{current}`) luôn lấy từ **ô A**, kể cả khi ô B đang có nội dung hay đây là lần AI thứ mấy. Ô A rỗng thì AI tạo mới, có nội dung thì AI hoàn thiện.
- **Prompt 2** (`{experiment}`) lấy **ô B nếu có nội dung, không thì ô A**, tại thời điểm bấm "Tiếp tục" hoặc "Tạo lại thí nghiệm".
- Ô A đổi sau khi AI tạo mà ô B còn nội dung thì hiện cảnh báo (vì ô B được ưu tiên hơn).

Ba hàm quyết định nằm ở `server/resolve.js` (dùng chung cho server và front-end).

## Smoke test

```bash
npm run smoke
```

Gọi `MODEL_ID` với một câu hỏi ngắn, in ra: thành công hay không, API nào chạy được (thử `chat.completions` trước, rồi Responses API), nội dung trả về, `usage`, lỗi nếu có. Khoá luôn được che. Khi thành công, API dùng được được ghi vào `config/app.json` (`llmApi`) và `server/llm.js` dùng đúng API đó.

## Test

```bash
npm test            # toàn bộ: unit + checker + e2e + eval (mock), khoảng 40 giây
npm run test:unit   # chỉ phần nhanh, không mở trình duyệt
npm run test:e2e    # chỉ e2e luồng giao diện (T1 trong tests/test_cases.md)
```

Các test dùng `LLM_MOCK=1` nên không tốn lượt gọi model. E2E tự khởi động server ở cổng trống và ghi `runs` vào thư mục tạm.

## Eval (kiểm thử hai prompt với model thật)

```bash
node eval/run-eval.js --variants vi,en                 # toàn bộ eval/cases.json
node eval/run-eval.js --variants vi,en --limit 3       # 3 case đầu
node eval/run-eval.js --variants vi --only T5-nem-ngang,T6-lo-xo-g10
node eval/run-eval.js --variants vi,en --attempts 1    # mặc định: đo độ ổn định lần thử đầu
```

Đầu ra trong `eval/results/<thời gian>/`:

- `report.md`: bảng case × variant với cờ H1..H9, số cảnh báo S1..S5, thời gian, token; tỉ lệ đạt từng kiểm tra bắt buộc và số từ tiếng Anh bị bắt cho mỗi variant.
- `gallery.html`: mỗi case một hàng (mô tả đã dùng, danh sách `expect`, các variant đặt cạnh nhau với iframe sandbox và ảnh chụp, hai cột trống để người rà soát ghi tay AC1/AC2). Mở trực tiếp bằng trình duyệt, không cần server.
- `summary.json`, `runs/`.

Quy trình đề xuất: chạy eval, mở `gallery.html`, đối chiếu từng mục `expect` và G6 đến G8 trong `tests/test_cases.md` bằng mắt người.

## LLM_MOCK

`LLM_MOCK=1` (trong `.env` hoặc đầu lệnh) làm `server/llm.js` không gọi model mà trả đầu ra cố định:

- Prompt 1: một mô tả đủ 5 mục ("Tên thí nghiệm: Thí nghiệm thử").
- Prompt 2: một HTML nhỏ, hợp lệ, qua mọi kiểm tra bắt buộc (`server/mock-html.js`).
- Nếu prompt đã ghép chứa chuỗi `KHONG_PHU_HOP_TEST` (gõ vào ô A), cả hai trả đúng một dòng `KHONG_PHU_HOP: ...` để thử nhánh từ chối.

```bash
LLM_MOCK=1 npm start
```

## Bộ kiểm tra tự động (checker)

Mỗi HTML sinh ra được nạp vào Chromium (Playwright), chặn mọi request mạng, kiểm tra ở 1366×768 và 1920×1080.

Bắt buộc (không đạt thì tính lỗi và thử lại, tối đa `MAX_ATTEMPTS` lần): H1 cấu trúc, H2 không lỗi JS/console, H3 `window.gameReady` và không có `#gameErrorBox`, H4 không cuộn, H5 không gọi mạng, H6 không có từ tiếng Anh trong `config/english-stoplist.json`, H7 thử thao tác không lỗi, H8 có nút "Làm lại", H9 không dùng localStorage/sessionStorage/cookie.

Cảnh báo (chỉ ghi báo cáo): S1 nghi tiếng Anh, S2 `onclick=`... trong mã nguồn, S3 chữ nhỏ hơn 14px, S4 nút nghi là nút chết, S5 dấu hiệu LaTeX/markdown.

Ảnh chụp và báo cáo của từng lần gọi nằm ở `runs/<thời gian>_<describe|experiment>_<slug>/` (`prompt.txt`, `raw.txt`, `output.html`, `report.json`, `screens/`). Thư mục `runs/` không được commit. Server chỉ log metadata, không log nội dung prompt hay khoá.

## Thêm case eval

Thêm một object vào mảng trong `eval/cases.json`:

```json
{
  "id": "T11-ten-case",
  "test": "T11",
  "ac": ["AC1"],
  "flow": "experiment-only",
  "subject": "Vật lí",
  "class": "Lớp 10",
  "explain": "Chuyển động > Chuyển động ném",
  "teacherDescription": "Mô tả thầy cô nhập (có thể để rỗng với describe+experiment)",
  "note": "",
  "expect": ["Điều cần kiểm 1", "Điều cần kiểm 2"]
}
```

`flow`: `describe+experiment` (prompt 1 rồi prompt 2; `teacherDescription` rỗng thì AI tạo mới, có nội dung thì AI hoàn thiện), `describe-only` (chỉ prompt 1), `experiment-only` (dùng thẳng `teacherDescription` làm `{experiment}`). `explain` là chuỗi tổ tiên và tên bài nối bằng ` > `. Nếu case dùng bài mới, thêm bài đó vào `fixtures/node-knowledge/` để giao diện chọn được (test `lessons.test.js` kiểm mọi `explain` trong `cases.json` đều có trong fixtures).

## Đổi sang provider dữ liệu thật

Lớp `server/data-provider.js` có 3 hàm khớp tài liệu API Edmicro:

| Hàm | API |
|---|---|
| `getSubjects()` | `GET /api/ai-prompt/list-subject` |
| `getBookGroups(subjectCode)` | `GET /api/book-group-ai?subjectCode=...` |
| `getNodeKnowledge({subjectCode, bookGroupCode, gradeCodes})` | `POST /api/node-knowledge` |

Hiện chọn bằng `DATA_PROVIDER=mock` (đọc `fixtures/`). Để dùng dữ liệu thật:

1. Cài đặt `realProvider` trong `server/data-provider.js` (đang là stub ném lỗi "chưa cài đặt", có TODO ghi base URL và header xác thực). Đọc base URL và token từ biến môi trường, không hard-code.
2. Giữ nguyên hình dạng dữ liệu trả về (xem fixtures làm mẫu): `list-subject` là mảng `{_id, name, ...}`; `book-group-ai` là mảng `{id, name, itemClasses:[{id,name}]}`; `node-knowledge` là `{success, data:[{id,name,isLeaf,childData}]}`.
3. Đặt `DATA_PROVIDER=real` rồi khởi động lại.

Lưu ý: ứng dụng truyền **`_id` của môn** (ví dụ `SDT_SINHHOC`) làm `subjectCode` cho cả hai API sau. Nếu API thật cần `subjectCodeCore` (ví dụ `SINH`), đổi ở `server/index.js` (các route `/api/classes` và `/api/lessons`).

Bộ lọc môn nằm ở `config/subjects-whitelist.json` (so khớp chính xác sau khi bỏ tiền tố và bỏ dấu). Bộ sách cố định KNTT ở `config/app.json`.

## Cấu trúc thư mục

```
config/        app.json, subjects-whitelist.json, english-stoplist.json
fixtures/      dữ liệu mẫu (môn, bộ sách, cây bài học)
prompts/       3 file prompt (đối tượng kiểm thử, không sửa trong quá trình test)
server/        index.js, llm.js, prompts.js, data-provider.js, postprocess.js, checker.js, resolve.js
               + pipeline.js, subjects.js, lessons.js, text-checks.js, vn-text.js, runs.js, env.js, mock-html.js
public/        index.html, app.js, styles.css (HTML/CSS/JS thuần, không CDN)
scripts/       smoke-test.js
eval/          cases.json (đầu vào), run-eval.js
tests/         test_cases.md (tài liệu test)
test/          *.test.js (node:test) và e2e-flow.test.js
runs/, eval/results/   (không commit)
```

## Chạy trong phiên cloud (Claude Code trên web)

Xem hướng dẫn trong tin nhắn bàn giao. Tóm tắt: cần `npm ci`, `npx playwright install --with-deps chromium`, đặt `OPENAI_API_KEY` (và `OPENAI_BASE_URL`, `MODEL_ID` nếu cần) trong cấu hình môi trường cloud, và cho phép mạng tới nhà cung cấp model và CDN của Playwright. Giá trị biến môi trường cloud hiển thị với mọi người dùng chung môi trường đó, nên dùng môi trường cá nhân.
