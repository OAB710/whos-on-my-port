# Backlog — việc nên làm, chưa làm

Cập nhật: 2026-11-16 · Phiên bản hiện tại: **0.2.2** (đã lên VS Code Marketplace, publisher `OAB714`)

Thứ tự trong mỗi nhóm = thứ tự đề xuất. Mỗi mục ghi rõ **vì sao** và **cần gì** để làm.

## 1. Phát hành & phân phối

### 1.1 Đăng lên Open VSX ⭐ nên làm sớm
- **Vì sao:** người dùng Cursor, Windsurf, VSCodium, Gitpod **không** cài được từ VS Code Marketplace, chỉ cài từ Open VSX. Đây là một tệp người dùng lớn, nhất là Cursor.
- **Cần bạn làm:**
  1. Đăng nhập https://open-vsx.org bằng GitHub, ký *Publisher Agreement* (cần tài khoản Eclipse miễn phí).
  2. *Settings → Access Tokens → Generate New Token*.
  3. Tạo namespace: `npx ovsx create-namespace OAB714 -p <token>`.
  4. Lưu token vào GitHub: repo → *Settings → Secrets and variables → Actions* → `OVSX_PAT`.
- **Sau đó:** mỗi lần push tag `v*`, CI tự đăng lên Open VSX (đã cấu hình sẵn trong `.github/workflows/ci.yml`). Bản đầu có thể đăng tay: `npx ovsx publish whos-on-my-port-0.2.2.vsix -p <token>`.
- Khi xong: sửa dòng "once the extension is on Open VSX" trong README.

### 1.2 Tự động đăng lên VS Code Marketplace từ CI
- **Hiện tại:** mỗi bản mới phải tải `.vsix` lên tay (Marketplace → extension → *Update*).
- **Hướng 1, Trusted Publishing** (tab có sẵn trên trang publisher): GitHub Actions đăng mà không cần token. Cần tìm hiểu cách cấu hình rồi sửa CI.
- **Hướng 2, token `VSCE_PAT`:** cần tạo organization Azure DevOps. Màn hình tạo đang đòi Azure subscription nên tạm bỏ qua.

### 1.3 Dọn GitHub Releases cũ
- Các Release **v0.2.0** và **v0.2.1** có file `.vsix` mang publisher cũ (`whos-on-my-port`). Không cài được lên Marketplace và dễ gây nhầm lẫn.
- **Cần làm:** xoá 2 release này trên GitHub (giữ tag cũng được) hoặc ghi chú "dùng bản 0.2.2 trở lên".

## 2. Marketing & ra mắt

### 2.1 Bài giới thiệu
- **Ở đâu:** r/vscode, r/webdev, r/node, dev.to, Viblo, các nhóm Facebook dev Việt Nam.
- **Nội dung chính:** GIF demo + 3 điểm "Know who's on your port / Free it safely / Kill & Retry".
- Claude có thể soạn sẵn bài (tiếng Anh + tiếng Việt).

### 2.2 Ảnh chụp cho trang Marketplace
- 2–3 ảnh sidebar trên nền tối và sáng (bổ sung cho GIF).

## 3. Tính năng — nền tảng

### 3.1 macOS & Linux ⭐ mở rộng thị trường nhiều nhất
- Viết provider mới cạnh `src/providers/windowsProvider.ts`: `lsof -iTCP -sTCP:LISTEN -P -n` (macOS), `ss -ltnp` (Linux), `ps -o pid,ppid,lstart,rss,command`.
- Kill: `kill -TERM` rồi `kill -KILL` theo cây tiến trình. Bỏ các phần chỉ có trên Windows (excludedportrange, UAC).
- Cần máy hoặc CI macOS/Linux để test.

### 3.2 Docker
- Ánh xạ port → container qua `docker ps --format`, hành động `docker stop` / `docker restart` thay vì khoá như hiện tại.

### 3.3 Remote (WSL / SSH / Dev Container)
- Hiện extension chạy phía máy Windows (`extensionKind: ui`). Cần provider chạy phía remote.

### 3.4 UDP
- Hiện chỉ có TCP.

## 4. Tính năng — cải tiến nhỏ

- **Ghi chú Firewall dưới mã QR:** khi mạng đang là *Public*, ghi ngay dưới QR: "Windows Firewall có thể chặn điện thoại, hãy chuyển mạng sang Private". Không dùng popup.
- **Trusted Publishing / CI:** xem 1.2.
- **Hook của impeccable:** đã cài skill `/impeccable` (toàn máy) nhưng **chưa** cài hook tự chạy. Chỉ cài khi làm web frontend thường xuyên.

## 5. Đã quyết định KHÔNG làm (để khỏi bàn lại)

- Telemetry: không thu thập.
- Webview / dashboard: không, giữ TreeView nhẹ.
- Menu nhanh (QuickPick) trên status bar: đã bỏ, dùng chọn nhiều trong sidebar.
- Lưu lịch sử vào `.vscode/` trong dự án: không (rủi ro lộ token khi commit). Lịch sử lưu trong bộ nhớ của VS Code.
- Popup thông báo kiểu "báo tin": thay bằng status bar. Popup chỉ dùng khi cần người dùng quyết định.
