# BỘ TEST: Tạo thí nghiệm tương tác

10 test, mỗi test nhắm vào một nhóm AC khác nhau. Dữ liệu đầu vào của T2 đến T10 nằm trong `eval/cases.json` (cùng mã test). T1 kiểm luồng giao diện và dữ liệu giữa các bước, không cần model thật.

## Cách chạy

- **Qua giao diện:** nhập đúng Môn, Lớp, Bài, mô tả như bảng dưới, làm theo các bước và đối chiếu "Đạt khi".
- **Qua eval (khuyến nghị cho T2 đến T10):** `node eval/run-eval.js --variants vi,en --attempts 1`, rồi mở `eval/results/<thời gian>/gallery.html`. Mỗi case có sẵn checklist "expect" ngay cạnh kết quả.
- **T1:** chạy bằng `LLM_MOCK=1` (không tốn lượt gọi API): `npm run test:e2e`, hoặc làm tay theo các bước.

## Danh sách kiểm tra chung cho MỌI thí nghiệm HTML sinh ra (G1 đến G8)

| # | Kiểm tra | Cách kiểm | AC |
|---|---|---|---|
| G1 | Mở được, không lỗi, không trắng màn hình | Tự động: H1, H2, H3 | AC7 |
| G2 | Không cuộn trang ở 1366×768 và 1920×1080 | Tự động: H4 | AC8 |
| G3 | Không gọi mạng, không dùng localStorage | Tự động: H5, H9 | AC7 |
| G4 | Không có chữ tiếng Anh trên giao diện | Tự động: H6 (bắt buộc), S1 (cảnh báo) | AC2 |
| G5 | Mọi nút, điều khiển hoạt động; có nút Làm lại | Tự động: H7, H8, S4 | AC6 |
| G6 | Không chồng chéo, không tràn khung, nhãn gắn đúng vật, chữ đọc được từ xa | **Mắt người** (xem ảnh chụp trong gallery) | AC4, AC8 |
| G7 | Không có kết luận, bài tập, câu hỏi, lời dẫn thừa | **Mắt người** | Phạm vi màn 1 |
| G8 | Số thập phân dùng dấu phẩy; chỉ số dưới/trên hiển thị đúng | **Mắt người** | AC2 |

Một test chỉ tính **Đạt** khi đạt cả mục "Đạt khi" riêng và G1 đến G8.

---

## T1. Luồng "AI tạo mô tả", hai ô mô tả và nguồn đầu vào của prompt 1, 2

**Kiểm:** luồng giao diện và dữ liệu (không kiểm chất lượng AI). Quy tắc cần kiểm: prompt 1 **luôn** lấy từ ô A (Mô tả của thầy cô), prompt 2 lấy ô B nếu có nội dung, không thì ô A; cần **ít nhất một trong hai** ô có nội dung.

**Chuẩn bị:** `LLM_MOCK=1`. Chọn Môn Hóa học, Lớp 10, một Bài bất kỳ. Ghi chú: "ô A" là Mô tả của thầy cô, "ô B" là Mô tả AI.

| Bước | Thao tác | Đạt khi |
|---|---|---|
| a | Ô A nhập `Cho 5 g kẽm viên vào 50 mL HCl 2M`. Nhãn nút AI là "AI hoàn thiện mô tả". Bấm | Hiện màn "brain" che toàn trang. Trong lúc chạy không bấm, không gõ, không chọn được gì. `prompt.txt` của prompt 1: `{current}` đúng bằng ô A. |
| b | Chờ xong | Ô B xuất hiện, có nội dung. **Ô A giữ nguyên từng ký tự.** |
| c | Bấm "Tiếp tục" | `prompt.txt` của prompt 2: `{experiment}` bằng đúng nội dung ô B. |
| d | Quay lại ("Thay đổi mô tả"), sửa ô B (thêm `XYZ` vào cuối), "Tiếp tục" | `prompt.txt` mới có `XYZ`. |
| e | Quay lại, bấm AI lần nữa (ô B đang có `XYZ`) | `{current}` của prompt 1 **vẫn là ô A** (không có `XYZ`, không phải nội dung ô B). Ô B bị ghi đè bằng kết quả mới; "Hoàn tác" khôi phục bản có `XYZ`. Bấm AI lần thứ ba: `{current}` vẫn là ô A. |
| f | Xoá sạch ô B, "Tiếp tục" | `prompt.txt` của prompt 2 dùng **nội dung ô A**. |
| g | Tải lại trang. Chỉ nhập ô A, không bấm AI, "Tiếp tục" | `prompt.txt` của prompt 2 dùng nội dung ô A. |
| h | Tải lại trang. **Để trống ô A**. Nhãn nút là "AI tạo mô tả". Bấm AI | `{current}` rỗng; ô B có nội dung; "Tiếp tục" **bật** dù ô A rỗng. Bấm AI lần nữa: `{current}` vẫn rỗng (không lấy ô B). |
| i | Thử 5 tổ hợp (đã chọn đủ Môn/Lớp/Bài): (A rỗng, B rỗng); (A có, B rỗng); (A rỗng, B có); (A có, B có); (A và B chỉ khoảng trắng) | "Tiếp tục" tắt ở tổ hợp 1 và 5 (kèm dòng gợi ý "cần ít nhất một trong hai"), bật ở tổ hợp 2, 3, 4. Chưa chọn đủ Môn/Lớp/Bài thì tắt dù có mô tả. Nút AI bật/tắt chỉ theo Môn/Lớp/Bài. |
| j | AI chạy xong, rồi sửa ô A | Hiện cảnh báo "Mô tả của thầy cô đã thay đổi sau khi AI tạo..." cạnh ô B. Bấm AI lại hoặc xoá ô B thì cảnh báo tắt. Sửa ô A khi ô B rỗng thì không có cảnh báo. |
| k | Mở danh sách Môn học; chọn Lớp 6 ở môn có dữ liệu rỗng | Chỉ có 5 môn: Sinh học, Vật lí, Hóa học, Khoa học tự nhiên, Địa lí. Dữ liệu rỗng thì hiện "Chưa có dữ liệu bài học cho lớp này". |

---

## T2. Tạo mô tả mới từ tên bài (D1, D2, D3, D5, D7)

**Đầu vào:** Hóa học, Lớp 10, Bài `Tốc độ phản ứng hóa học > Các yếu tố ảnh hưởng đến tốc độ phản ứng`. Để trống mô tả.

**Cách chạy:** để ô A trống, bấm "AI tạo mô tả" **3 lần** (mỗi lần AI tạo mới chỉ từ Môn, Lớp, Bài và ghi đè ô B).

**Đạt khi (cả 3 lần):**
- Đúng một thí nghiệm; có dòng Tên thí nghiệm và 5 mục đúng tên, đúng thứ tự.
- Văn bản thuần: không `$`, `\`, `**`, `#`.
- Khoảng 150 đến 250 từ (ghi lại số từ).
- Mọi giá trị đều cụ thể; không có số trang hay bài tập SGK; không có kết luận hay bài tập.
- Mục "Đại lượng thay đổi được" có khoảng giá trị, đơn vị, bước và quy luật kết quả; chiều đúng (tăng nồng độ, nhiệt độ, diện tích bề mặt hoặc có xúc tác thì nhanh hơn).
- Ba lần có thể là ba thí nghiệm khác nhau, nhưng cả ba đều đạt các mục trên.

---

## T3. Hoàn thiện mô tả, giữ ý thầy cô (D8, D3)

**Đầu vào:** như T2; nhập vào ô A (Mô tả của thầy cô): `Cho 5 g kẽm viên vào 50 mL dung dịch HCl 2M ở 25°C và quan sát bọt khí.` Bấm AI hai lần: lần hai vẫn hoàn thiện từ ô A, không cộng dồn lên kết quả lần một.

**Đạt khi:**
- Giữ nguyên: 5 g, kẽm viên, 50 mL, HCl 2M, 25°C.
- Không đổi sang thí nghiệm khác; không đổi số liệu.
- Đủ 5 mục; phản ứng Zn + 2HCl → ZnCl₂ + H₂↑.
- Thí nghiệm HTML dùng đúng các giá trị mặc định trên.

---

## T4. Từ chối đúng (D6, AC9)

**T4a (prompt 1):** Vật lí, Lớp 10, Bài `Mở đầu > Vai trò của vật lí trong đời sống`, ô A trống, bấm "AI tạo mô tả". **Đạt khi:** hiện thông báo màu cam với lý do; ô B vẫn trống và không hiện; không có thí nghiệm bịa ra; `raw.txt` là đúng một dòng bắt đầu bằng `KHONG_PHU_HOP:`.

**T4b (prompt 2):** cùng Môn/Lớp/Bài, ô A nhập `Cả lớp thảo luận nhóm 5 phút về vai trò của vật lí trong đời sống, sau đó mỗi nhóm cử một đại diện trình bày.`, không dùng AI, bấm "Tiếp tục". **Đạt khi:** màn kết quả hiện thông báo cam nêu lý do, không có khung xem trước, `raw.txt` không chứa mã HTML.

---

## T5. Đại lượng thay đổi và số liệu (AC1, AC4, AC5, AC6, AC8)

**Đầu vào:** Vật lí, Lớp 10, Bài `Chuyển động > Chuyển động ném`; nhập vào ô A: xem case `T5-nem-ngang` (ném ngang, h = 20 m, g = 9,8 m/s², v₀ từ 5 đến 30 m/s).

**Đạt khi:**
- Có điều khiển chọn v₀ (5 đến 30 m/s, bước 5) kèm đơn vị.
- t luôn là **2,02 s** ở mọi v₀.
- L: v₀ = 5 → 10,1 m; 10 → 20,2 m; 20 → 40,4 m; 30 → 60,6 m (sai số ±0,1 m).
- Số hiển thị dùng dấu phẩy.
- Quỹ đạo parabol đúng, vật chạm đất; ở v₀ = 30 m/s vẫn nằm trong khung.
- Chỉ ném được sau khi chọn v₀; Làm lại hoạt động.

---

## T6. Bám đúng mô tả, kể cả khi khác "thông lệ" (AC3, AC1)

**Đầu vào:** Vật lí, Lớp 10, Bài `Lực > Lực đàn hồi, định luật Hooke`; nhập vào ô A: xem case `T6-lo-xo-g10` (k = 40 N/m, **g = 10 m/s²**).

**Đạt khi:**
- m = 0,1; 0,2; 0,3; 0,4; 0,5 kg cho F = 1; 2; 3; 4; 5 N và Δl = 2,5; 5,0; 7,5; 10,0; 12,5 cm.
- **Lỗi nếu** m = 0,2 kg cho Δl = 4,9 cm (nghĩa là AI tự dùng g = 9,8 thay vì g = 10 trong mô tả).
- Không thêm vật thể hay điều khiển không có trong mô tả.

---

## T7. Thí nghiệm không có đại lượng thay đổi (AC5 phản chứng, AC6, AC1, AC4)

**Đầu vào:** Hóa học, Lớp 11, Bài `Hydrocarbon không no > Alkene`; nhập vào ô A: xem case `T7-ethylene-bromine-co-dinh` (mục "Đại lượng thay đổi được: Không có").

**Đạt khi:**
- **Không** có thanh trượt, danh sách chọn hay điều khiển trang trí nào ngoài thao tác của các bước (nối ống, dẫn khí) và Làm lại.
- Dung dịch từ nâu đỏ sang không màu, đủ lớn và đủ lâu để cả lớp thấy; có bọt khí đi lên.
- Không bấm được "Dẫn khí" trước khi nối bình khí; Làm lại đưa nước bromine về nâu đỏ.
- Công thức C₂H₄, Br₂ đúng chỉ số dưới.

---

## T8. Nhiều trường hợp và trường hợp "không xảy ra" (AC5, AC2, AC1, AC7)

**Đầu vào:** Hóa học, Lớp 11, Bài `Hydrocarbon không no > Alkene`; nhập vào ô A: xem case `T8-chon-khi-bromine`.

**Đạt khi:**
- Đủ 3 lựa chọn khí đúng tên và công thức.
- **Ethane:** hiện "không có hiện tượng", dung dịch vẫn nâu đỏ; không báo lỗi, không trống.
- Ethylene và acetylene: mất màu.
- Đổi khí sau khi đã chạy: ống nghiệm trở về nước bromine mới, không còn tàn dư.
- Bấm Làm lại 5 lần liên tiếp rồi chạy lại: không lỗi, hoạt ảnh không chạy chồng.
- Đổi khí giữa lúc đang dẫn khí: không lỗi, kết quả không lẫn.

---

## T9. Mô tả ngắn thầy cô tự viết, không qua AI (AC3, AC5, AC1, AC2)

**Đầu vào:** Hóa học, Lớp 11, Bài `Cân bằng trong dung dịch nước > pH của dung dịch. Chất chỉ thị axit - bazơ`; nhập vào ô A: `Nhúng giấy quỳ tím vào dung dịch HCl 0,1 M và dung dịch NaOH 0,1 M.` Không bấm AI.

**Đạt khi:**
- Giữ đúng HCl 0,1 M và NaOH 0,1 M, giấy quỳ tím.
- HCl: quỳ chuyển đỏ. NaOH: quỳ chuyển xanh. Nếu hiển thị pH: khoảng 1 và khoảng 13.
- Có lựa chọn dung dịch (thực tế có hai trường hợp) nhưng không có điều khiển không liên quan.
- Chọn dung dịch khác: giấy quỳ mới, không tàn dư.

---

## T10. Chất lượng đều giữa các môn (AC10, D1, D4)

Hai case, mỗi case chạy cả hai prompt từ đầu (mô tả để trống, bấm "AI tạo mô tả", rồi "Tiếp tục"):
- **T10a:** Sinh học, Lớp 11, `Trao đổi chất và chuyển hoá năng lượng ở thực vật > Quang hợp ở thực vật`.
- **T10b:** Địa lí, Lớp 10, `Trái Đất > Hệ quả địa lí các chuyển động của Trái Đất`.

**Đạt khi:**
- T10a: chiều đúng (tăng cường độ ánh sáng thì lượng O₂ tăng, có thể bão hoà, không âm); thuật ngữ đúng lớp 11.
- T10b: hoặc mô phỏng đúng, hoặc `KHONG_PHU_HOP` có lý do hợp lý (ghi lại tỉ lệ từ chối). Nếu mô phỏng: 21/3 và 23/9 ngày bằng đêm ở mọi nơi; 22/6 Bắc bán cầu ngày dài hơn đêm, từ vĩ độ 66°33′B trở lên ngày dài 24 giờ; 22/12 ngược lại; xích đạo khoảng 12 giờ quanh năm.
- Cả hai đều đạt G1 đến G8 với mức ổn định tương đương các test môn Hóa và Vật lí.

---

## Bảng ghi kết quả

| Test | Lần chạy | Variant | Đạt/Không | G1-G8 | Ghi chú (lỗi, từ tiếng Anh lọt, số lần thử) |
|---|---|---|---|---|---|
| T1 | | | | | |
| T2 | | | | | |
| T3 | | | | | |
| T4a/T4b | | | | | |
| T5 | | | | | |
| T6 | | | | | |
| T7 | | | | | |
| T8 | | | | | |
| T9 | | | | | |
| T10a/T10b | | | | | |

**Quy ước đọc kết quả A/B (vi so với en):** ghi lại tỉ lệ đạt kiểm tra bắt buộc ở lần thử đầu cho mỗi variant, số từ tiếng Anh bị bắt, và số lỗi kiến thức người rà soát tìm thấy (AC1, AC2). Chưa đặt ngưỡng đạt cố định; chọn variant nào giảm lỗi ở lần thử đầu mà không tăng chữ tiếng Anh lọt và không tăng lỗi kiến thức.
