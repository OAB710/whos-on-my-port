# Playground — kịch bản test thủ công

Các dự án mẫu dùng Node thuần, **không cần `npm install`**.

| Thư mục | Port | Mục đích test |
|---|---|---|
| `shop-app` | 3000 (localhost) | Nhóm Current, graceful stop (Ctrl+C) |
| `api-multi` | 4000 + 4001 | 1 tiến trình giữ 2 port |
| `conflict-demo` | 3000 | Gây lỗi EADDRINUSE → Kill & Retry |
| `orphan-demo` | 4500 | Server tách rời (detached) → nhóm Orphaned |
| `landing-page` | 5173 (0.0.0.0) | Cửa sổ thứ 2, cờ ⚠ LAN |

## Mở cửa sổ test (không cần F5)

1. Nhấp đúp `playground\start-dev-host.cmd` → compile và mở **Extension Development Host** với workspace gồm 4 dự án (shop-app, api-multi, conflict-demo, orphan-demo).
2. (Cho kịch bản đa cửa sổ) Nhấp đúp `playground\open-second-window.cmd` → mở `landing-page` ở cửa sổ thứ 2.
3. Bấm biểu tượng phích cắm trên Activity Bar.

> Cách khác: `File → Open Folder… → d:\IT\whos-on-my-port` (mở **riêng** thư mục này), rồi bấm F5.

Mỗi lần mở terminal, VS Code hỏi chọn folder (multi-root) → chọn đúng dự án.

## Kịch bản

| # | Thao tác | Kỳ vọng |
|---|---|---|
| 1 | Terminal `shop-app`: `npm run dev` → bấm Refresh | `:3000 — node.exe` nằm trong **Current Workspace**, icon terminal; status bar `🔌 1` |
| 2 | Terminal `api-multi`: `npm run dev` | 2 dòng `:4000`, `:4001` cùng PID |
| 3 | Di chuột vào một dòng | Tooltip có command line, PID cha, số kết nối |
| 4 | Bấm 🌐 trên `:3000` | Trình duyệt mở `http://localhost:3000` |
| 5 | Terminal `conflict-demo`: `npm run dev` | Thông báo *"Port 3000 is used by node.exe…"* với [Kill & Retry] |
| 6 | Bấm **Kill & Retry** | shop-app tắt (terminal shop-app in *"closing gracefully"*), conflict-demo tự chạy lại và chiếm :3000 |
| 7 | Chạy lại shop-app, bấm 🔥 trên `:3000` | Hỏi xác nhận → terminal shop-app in *"received Ctrl+C, closing gracefully"* (graceful stop) |
| 8 | Cửa sổ 2: terminal `landing-page`: `npm run dev`. Quay về cửa sổ 1, Refresh | `:5173` nằm trong **Other Projects**, nhãn `landing-page`, cờ `⚠ LAN` |
| 9 | Terminal `orphan-demo`: `npm run dev` | Launcher thoát ngay; `:4500` xuất hiện trong **Orphaned**, status bar nền vàng |
| 10 | Menu `…` → *Clean Up Orphaned Processes* | Hỏi 1 lần → `:4500` biến mất |
| 11 | Chuột phải `:4000` → *Pin Port*; tắt api-multi | Nhóm **Pinned** hiện `:4000 rảnh` |
| 12 | `Ctrl+Shift+P` → *Kill Port...* → gõ `4001` | Dừng đúng tiến trình; gõ port trống → *"Port … is free"* |
| 13 | Menu `…` → *Kill All Ports in Workspace* | Dừng mọi port của cửa sổ 1, **không** đụng `:5173` của cửa sổ 2 |
| 14 | Nút filter trên title bar | Hiện/ẩn nhóm **System / Background** (svchost, lsass… có icon khoá, không có nút kill) |
| 15 | Đổi ngôn ngữ VS Code sang Tiếng Việt (*Configure Display Language*) | UI hiển thị tiếng Việt |

Log chi tiết: `…` → *Show Logs* (Output "Who's On My Port").

## Lưu ý
- Kill & Retry cần **shell integration**: dùng PowerShell / pwsh / Git Bash, không dùng `cmd.exe`.
- Nếu `:4500` (orphan) còn sót sau khi test: dùng chính extension để dọn (kịch bản 10).
