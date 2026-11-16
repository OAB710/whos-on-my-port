# Who's On My Port — Đặc tả Sản phẩm & Kỹ thuật (v2)

| Mục | Giá trị |
|---|---|
| Phiên bản tài liệu | 2.0 (thay thế bản đặc tả "Port & Process Killer" v1) |
| Phiên bản sản phẩm mục tiêu | 1.0.0 (MVP) |
| Nền tảng | Windows 10/11 (MVP). Kiến trúc provider sẵn sàng cho macOS/Linux (v1.1+) |
| VS Code tối thiểu | 1.93 (cần Shell Integration API ổn định) |
| Giấy phép / Mô hình | MIT, miễn phí, mã nguồn mở. **Không telemetry** |
| Kênh phát hành | VS Code Marketplace + Open VSX (Cursor, Windsurf, VSCodium) |
| Ngôn ngữ UI | English (mặc định), Tiếng Việt |

---

## 1. Tổng quan

### 1.1. Vấn đề
Dev chạy nhiều dự án cùng lúc (nhiều cửa sổ VS Code) thường gặp:
1. `Error: listen EADDRINUSE :::3000` — không biết tiến trình nào đang giữ port.
2. Mở Terminal gõ `netstat -ano | findstr 3000` → `taskkill /F /PID ...` — chậm, dễ gõ nhầm.
3. **Tắt nhầm** dev server của dự án đang mở ở cửa sổ khác.
4. **Tiến trình mồ côi**: đóng terminal/cửa sổ nhưng `node.exe` vẫn sống và giữ port (đặc biệt phổ biến trên Windows).

### 1.2. Giải pháp
Một view trên Activity Bar liệt kê port TCP đang LISTEN, **phân loại theo cửa sổ/dự án**, cho phép dừng tiến trình an toàn (graceful trước, force sau), tự bắt lỗi port bận trong terminal và đề xuất "Kill & Retry".

### 1.3. Điểm khác biệt (USP)
| # | USP | Đối thủ thường có? |
|---|---|---|
| 1 | Nhận diện port thuộc **cửa sổ VS Code nào** (qua cây tiến trình + registry giữa các cửa sổ) | Không |
| 2 | **Kill & Retry** khi terminal báo port bận | Hiếm |
| 3 | **Graceful stop** (Ctrl+C) cho tiến trình nằm trong terminal của cửa sổ | Không |
| 4 | Phát hiện **tiến trình mồ côi** | Không |
| 5 | **Lưới an toàn**: không cho kill tiến trình hệ thống, chính VS Code, Docker/WSL | Một phần |
| 6 | Zero-bloat: không Webview, 0% CPU khi nghỉ, không telemetry | Một phần |

### 1.4. Phạm vi
**Trong phạm vi v1.0**: TCP LISTEN trên Windows; TreeView; phân loại; kill (graceful/force/admin); EADDRINUSE detect; orphan detect; Kill Port từ Command Palette; status bar; ghim port; Kill All in Workspace; cảnh báo LAN; i18n EN/VI.

**Ngoài phạm vi v1.0** (roadmap §14): ánh xạ port → Docker container + `docker stop`; macOS/Linux; UDP; Remote (SSH/WSL/Dev Container) chạy phía remote; telemetry.

---

## 2. Người dùng mục tiêu

| Persona | Mô tả | Nhu cầu chính |
|---|---|---|
| **P1 – Fullstack dev Windows** | Chạy FE (vite :5173) + BE (node :3000) + DB (mysql :3306) cùng lúc, 2–4 cửa sổ VS Code | Biết port thuộc dự án nào, kill nhanh không nhầm |
| **P2 – Dev XAMPP/PHP/Python** | Apache :80, MySQL :3306, Django :8000 | Giải phóng port bị service cũ giữ |
| **P3 – Dev doanh nghiệp** | Máy bị GPO/AV quản lý, không có quyền Admin | Thông báo lỗi rõ ràng, không "treo" |

---

## 3. Thuật ngữ

| Thuật ngữ | Định nghĩa |
|---|---|
| **Listener** | Cặp (port, PID) đang ở trạng thái LISTEN. Nhiều địa chỉ bind (IPv4/IPv6) của cùng (port, PID) được gộp thành 1 listener |
| **Chuỗi tổ tiên** | Danh sách cha → ông → … của một tiến trình, đi theo `ParentProcessId` |
| **Chuỗi đứt (broken)** | Tiến trình cha không còn tồn tại, hoặc PID cha đã bị **tái sử dụng** (`CreationDate` của cha > của con) |
| **Terminal PID** | `Terminal.processId` — PID của shell trong Integrated Terminal |
| **Window registry** | File JSON dùng chung giữa các cửa sổ VS Code (trong `globalStorage`) chứa folder + terminal PID của mỗi cửa sổ |
| **Dev process** | Tiến trình có tên trong danh sách dev mặc định (§9.2) hoặc `customDevProcesses` |
| **Orphan** | Dev process, chuỗi tổ tiên đứt, không thuộc terminal nào đang sống, và đường dẫn trong CommandLine nằm trong một workspace đã biết |
| **Blocked** | Listener không được phép kill (§6) |

---

## 4. Kiến trúc

### 4.1. Sơ đồ module
```text
src/
├── extension.ts               # activate/deactivate, wiring
├── types.ts                   # Interfaces dùng chung (không import vscode)
├── providers/
│   ├── processProvider.ts     # interface ProcessProvider + factory theo OS
│   ├── windowsProvider.ts     # netstat + CIM + taskkill
│   └── windowsParse.ts        # parser thuần (unit-testable)
├── core/
│   ├── classifier.ts          # phân loại Current/Other/Orphan/System (thuần)
│   ├── safety.ts              # danh sách tiến trình cấm kill (thuần)
│   ├── pathUtils.ts           # chuẩn hoá & so khớp đường dẫn (thuần)
│   ├── windowRegistry.ts      # registry giữa các cửa sổ
│   ├── portService.ts         # điều phối quét, cache, sự kiện thay đổi
│   └── killer.ts              # luồng xác nhận → graceful → force → admin
├── features/
│   ├── portInUseDetector.ts   # bắt EADDRINUSE qua Shell Integration
│   ├── statusBar.ts
│   └── commands.ts            # đăng ký toàn bộ lệnh
├── views/
│   └── portTreeProvider.ts
└── test/                      # node:test cho các module thuần
```
Quy tắc: các module trong `core/` (trừ `windowRegistry`, `portService`, `killer`) và `providers/windowsParse.ts` **không import `vscode`** để unit-test được bằng `node --test`.

### 4.2. Pipeline quét (Windows)
Hai tiến trình con được chạy **song song** (không tuần tự), ẩn cửa sổ (`windowsHide: true`):

| # | Lệnh | Dữ liệu thu được |
|---|---|---|
| A | `netstat -ano -p TCP` + `netstat -ano -p TCPv6` | Listener (port, địa chỉ, PID), số kết nối đang mở theo port |
| B | `powershell -NoProfile -NonInteractive -EncodedCommand <…>` → `Get-CimInstance Win32_Process` cho **toàn bộ** tiến trình | `ProcessId, ParentProcessId, Name, CreationDate, WorkingSetSize, CommandLine, ExecutablePath` |

**Lý do quyết định:**
- **Không lọc theo chữ `LISTENING`** (bị bản địa hoá: `ABHÖREN`, `ESCUCHANDO`…). Listener được nhận diện bằng **địa chỉ remote** `0.0.0.0:0` / `[::]:0`.
- Lấy **toàn bộ** bảng tiến trình (≈300 dòng) thay vì lọc theo PID, vì cần đi chuỗi tổ tiên. `CreationDate` dùng để phát hiện PID tái sử dụng.
- Dùng `-EncodedCommand` (UTF-16LE base64) để tránh lỗi escape, và ép UTF-8 output để đường dẫn tiếng Việt/Unicode không vỡ.
- Không dùng `wmic` (đã bị gỡ khỏi Windows 11 24H2).
- Không dùng `Get-NetTCPConnection` làm đường chính vì chậm (≈1–2 s trên một số máy).

### 4.3. Khi nào quét (0% CPU khi nghỉ)
| Sự kiện | Hành vi |
|---|---|
| View trở nên hiển thị | Quét 1 lần |
| Bấm Refresh / sau khi kill (300 ms) | Quét 1 lần |
| `autoRefreshSeconds > 0` **và** view đang hiển thị | Quét định kỳ; dừng timer khi view bị ẩn |
| Mở/đóng terminal (debounce 2 s) | Quét nếu view hiển thị **hoặc** status bar bật |
| Khởi động (sau 3 s) | Quét 1 lần nếu status bar bật |
| EADDRINUSE được phát hiện | Quét 1 lần |
| Quét đang chạy | Các yêu cầu mới **gộp** vào lần quét đang chạy (không chạy song song 2 lần) |

---

## 5. Thuật toán phân loại

### 5.1. Đầu vào
- `currentFolders`: `workspace.workspaceFolders` của cửa sổ hiện tại (chuẩn hoá: chữ thường, `\`, không dấu `\` cuối).
- `currentTerminals`: `Map<shellPid, Terminal>` của cửa sổ hiện tại.
- `otherWindows`: từ registry (§5.3), đã loại các cửa sổ có `hostPid` không còn sống.
- `knownFolders`: hợp của mọi folder từng được đăng ký (tối đa 100, LRU).
- `editorAncestors`: chuỗi tổ tiên của extension host (`process.pid`) — chính là VS Code.

### 5.2. Luồng quyết định (theo thứ tự, dừng ở luật đầu tiên khớp)
| # | Điều kiện | Nhóm | Ghi chú |
|---|---|---|---|
| 1 | Chuỗi tổ tiên chứa một PID trong `currentTerminals` | **Current** | Lưu `terminalPid` → bật Graceful stop & Reveal Terminal |
| 2 | Chuỗi tổ tiên chứa terminal PID của cửa sổ khác | **Other** | `windowLabel` = tên workspace cửa sổ đó |
| 3 | CommandLine/ExecutablePath chứa một `currentFolder` | **Current** | |
| 4 | CommandLine/ExecutablePath chứa folder của cửa sổ khác | **Other** | `windowLabel` |
| 5 | Dev process **và** chuỗi đứt **và** đường dẫn khớp `knownFolders` | **Orphan** | |
| 6 | Dev process | **Other** | `projectName` suy từ đường dẫn (§5.4) |
| 7 | Còn lại | **System** | Ẩn khi bật Dev Filter |

**Bổ sung (v2.1, phát hiện khi test):**
| # | Điều kiện | Nhóm |
|---|---|---|
| 2a | Chưa có nhóm, chuỗi tổ tiên chạm tiến trình editor (`Code.exe`…) mà **con trực tiếp** của editor **không phải shell** (pwsh/cmd/bash…), hoặc file nằm trong thư mục `extensions` → tiến trình do extension sinh ra (vd. `agy.exe` của Antigravity, language server). Ngoại lệ: dev process có đường dẫn trong workspace hiện tại (debugger khởi chạy trực tiếp) | **VS Code Extensions** (ẩn khi bật Dev Filter) |
| 4a | Chưa có nhóm, con trực tiếp của editor **là shell** nhưng terminal không có trong registry (cửa sổ không cài extension) | **Other**, nhãn "cửa sổ VS Code khác" |

Tên dự án của tiến trình chạy trong terminal được suy từ **thư mục làm việc của terminal** (`terminal.shellIntegration.cwd`, đồng bộ qua registry `terminalCwds`) — giải quyết lệnh tương đối như `node server.js`.

**Giao diện (v2.2, thay thế v2.1):** Cây **2 cấp**, không còn node nhóm. Cấp 1 = dự án: thư mục workspace hiện tại (`folder-active` xanh lá, `current (n)`, **chỉ hiện khi đang có port**) → dự án khác theo A–Z (`folder` xanh dương, `(n)`) → **Background / Unassigned** (`server-process`, thu gọn khi có dự án khác; gom tiến trình hệ thống, extension và dev process chưa rõ dự án). Nhóm **Pinned** chỉ xuất hiện khi người dùng có ghim port. Cấp 2 = port: `:3000` + `node · 39 MB · 34s` (thêm `orphaned` / `LAN` khi có). Inline port: Open in Browser `$(link-external)` → Copy Localhost URL `$(copy)` → Kill `$(trash)`; inline dự án: Kill All in Project `$(debug-stop)` (theo `confirmBeforeKill`). Title bar chỉ còn Refresh, Filter, Collapse All; Kill Port…/Pin Port…/Show Logs nằm trong menu `…`; Kill All in Workspace & Clean Up Orphans chỉ còn trong Command Palette. View đổi tên `PORTS`, icon Activity Bar `$(plug)`. `contextValue` bắt đầu bằng `projectGroup` / `portItem`, kèm token (`killable`, `hasPath`, `terminal`, `pinned`) để menu ẩn/hiện đúng.

**Giao diện (v2.1, lịch sử):** Nhóm → **Dự án** → Port. Dòng port: label `:3000`, description `node · 38 MB · 2m · ⇄ 2 · ⚠ LAN`; PID và chi tiết nằm trong tooltip. Icon theo công nghệ lấy từ **Material Icon Theme** (MIT), nhận diện framework từ CommandLine (Vite, Next, Nest, Django, Laravel…). Dòng dự án có nút dừng cả dự án. Badge trên Activity Bar = số port của workspace.

> Luật 1–2 là nguồn chân lý chính (độ chính xác cao); luật 3–4 là dự phòng cho tiến trình chạy ngoài Integrated Terminal (Task, Debug, Windows Terminal…).

**So khớp đường dẫn**: `folder` khớp khi xuất hiện trong chuỗi và ký tự kế tiếp là ranh giới (`\`, `"`, `'`, khoảng trắng, hết chuỗi) — tránh `D:\app` khớp nhầm `D:\app2`.

### 5.3. Window registry
- Vị trí: `<globalStorage>/windows.json` (dùng chung mọi cửa sổ cùng profile).
- Cấu trúc:
```json
{
  "version": 1,
  "windows": {
    "<vscode.env.sessionId>": {
      "hostPid": 12345,
      "label": "backend-api",
      "folders": ["d:\\projects\\backend-api"],
      "terminalPids": [22100, 22388],
      "updatedAt": 1763190000000
    }
  },
  "knownFolders": ["d:\\projects\\backend-api", "d:\\projects\\landing-page"]
}
```
- Ghi khi: activate, mở/đóng terminal, đổi workspace folder; xoá entry của mình khi deactivate.
- Ghi an toàn: đọc → sửa → ghi file tạm → `rename`. Xung đột ghi đồng thời chấp nhận được (dữ liệu tự lành ở lần ghi kế tiếp).
- Dọn rác: entry có `hostPid` không còn sống bị loại khi đọc.

### 5.4. Suy tên dự án (`projectName`)
1. Nếu khớp folder (luật 3–4) → tên thư mục folder.
2. Ngược lại, tách các đường dẫn tuyệt đối trong CommandLine, bỏ qua đường dẫn hệ thống (`Program Files`, `Windows`, `AppData\Roaming\npm`, `nodejs\`, `Python3*`…):
   - Có `\node_modules\` → tên thư mục ngay trước `node_modules`.
   - Là file (có phần mở rộng) → tên thư mục chứa file.
   - Là thư mục → tên thư mục đó.
3. Không suy được → để trống.

### 5.5. Cờ phụ trên mỗi listener
| Cờ | Điều kiện | Hiển thị |
|---|---|---|
| `elevated` | Tiến trình tồn tại nhưng `CommandLine == null` (thiếu quyền đọc) và PID ∉ {0, 4} | 🔒 |
| `lanExposed` | Bind `0.0.0.0`, `::` hoặc một IP không phải loopback | ⚠ LAN |
| `orphan` | §3 | nhóm Orphan, icon riêng |
| `blocked` | §6 | Ẩn nút kill, hiển thị lý do |

---

## 6. Lưới an toàn (Blocked)

| Lý do | Danh sách | Thông báo khi cố kill |
|---|---|---|
| `system` | PID 0, 4; `system`, `idle`, `smss`, `csrss`, `wininit`, `winlogon`, `services`, `lsass`, `svchost`, `dwm`, `spoolsv`, `fontdrvhost`, `explorer` | "Tiến trình hệ thống Windows — không thể dừng từ extension." |
| `editor` | PID thuộc `editorAncestors` hoặc tên `code`, `code - insiders`, `cursor`, `windsurf`, `vscodium`, `codium` | "Tiến trình thuộc trình soạn thảo — dừng nó sẽ đóng VS Code." |
| `docker` | `com.docker.backend`, `com.docker.proxy`, `com.docker.build`, `docker desktop`, `vpnkit`, `dockerd` | "Port do Docker Desktop chuyển tiếp. Hãy dùng `docker stop <container>`." (v1.1: làm tự động) |
| `wsl` | `wslrelay`, `wslhost`, `wsl`, `wslservice`, `vmmem`, `vmmemwsl` | "Port do WSL chuyển tiếp. Dừng tiến trình bên trong WSL." |

Blocked **không bị tắt được bằng setting** ở v1.0 (an toàn là tính năng chính, không phải tuỳ chọn).

---

## 7. User Stories & Acceptance Criteria

### US-01 Xem danh sách port theo nhóm
*Là dev, tôi muốn thấy port đang bị chiếm, phân theo dự án, để biết cái nào là của mình.*
- **AC1** Mở view → trong ≤ 1,5 s (P95, máy chuẩn §11) hiển thị các nhóm: *Pinned* (nếu có), *Current Workspace*, *Other Projects*, *Orphaned* (nếu có), *System* (chỉ khi tắt Dev Filter).
- **AC2** Nhóm rỗng không hiển thị, trừ *Current Workspace* (hiển thị "No ports" để người dùng hiểu).
- **AC3** Mỗi nhóm hiển thị số lượng trong description, ví dụ `Current Workspace  3`.
- **AC4** Cùng (port, PID) bind IPv4 + IPv6 chỉ hiện **1 dòng**.
- **AC5** Danh sách sắp xếp tăng dần theo port trong mỗi nhóm.

### US-02 Đọc thông tin 1 dòng
- **AC1** Label: `:3000 — node.exe`.
- **AC2** Description: `48.5 MB • PID 14280 • backend-api` + cờ (`🔒`, `⚠ LAN`) nếu có.
- **AC3** Tooltip (Markdown): địa chỉ bind, CommandLine đầy đủ, ExecutablePath, PID cha + tên cha, cửa sổ sở hữu, số kết nối đang mở, lý do blocked (nếu có).

### US-03 Kill một tiến trình
- **Given** listener không blocked, **When** bấm `$(flame)`, **Then** nếu `confirmBeforeKill = true` hiện hộp thoại modal: *"Stop node.exe (PID 14280) on port 3000 — backend-api?"* [Stop] [Cancel].
- **AC1** Nếu listener có `terminalPid` và `gracefulStop = true` → gửi Ctrl+C vào terminal đó, chờ tối đa `gracefulTimeoutMs`; port được giải phóng → xong.
- **AC2** Không có terminal hoặc graceful hết giờ → `taskkill /F /T /PID <pid>`.
- **AC3** `taskkill` thất bại và tiến trình vẫn sống → thông báo *"Access denied"* với nút **Kill as Administrator** (UAC). Huỷ UAC → thông báo nhẹ, không lỗi đỏ.
- **AC4** Sau khi xong 300 ms tự quét lại; port biến mất khỏi danh sách.
- **AC5** Listener blocked: không có nút kill inline; gọi lệnh qua menu → hiện lý do §6, không thực thi.

### US-04 Kill Port từ Command Palette
- **AC1** `Who's On My Port: Kill Port...` mở QuickPick liệt kê listener (dev + current trước), có thể **gõ số port**.
- **AC2** Gõ port không có ai chiếm → thông báo *"Port 4000 is free."*
- **AC3** Lệnh nhận tham số `number` khi được gọi từ extension/keybinding khác: `{"command":"whosOnMyPort.killPort","args":3000}`.

### US-05 Phát hiện EADDRINUSE & Kill & Retry
- **Given** `detectPortInUse = true` và shell có Shell Integration (pwsh, PowerShell, Git Bash, zsh/bash), **When** output của lệnh chứa mẫu port bận (§8.3), **Then** hiện thông báo: *"Port 3000 is used by node.exe (PID 14280 — landing-page)."* [Kill & Retry] [Kill] [Show].
- **AC1** Mỗi lần chạy lệnh chỉ thông báo **1 lần** cho mỗi port.
- **AC2** *Kill & Retry*: kill (bỏ qua confirm vì người dùng vừa bấm), chờ lệnh cũ kết thúc (≤ 5 s), chạy lại đúng commandLine trong cùng terminal.
- **AC3** Không báo với dòng *"Port 5173 is in use, trying another one"* (Vite tự đổi port).
- **AC4** Tiến trình giữ port là blocked → thông báo kèm lý do, không có nút Kill.
- **AC5** Shell không có Shell Integration (cmd.exe) → tính năng im lặng không hoạt động; README ghi rõ.

### US-06 Graceful stop & Reveal Terminal
- **AC1** Listener có `terminalPid` có menu *Reveal Terminal* → focus đúng terminal.
- **AC2** Mục *Force Kill* trên context menu luôn bỏ qua graceful.

### US-07 Tiến trình mồ côi
- **AC1** Orphan hiển thị trong nhóm *Orphaned* (icon cảnh báo).
- **AC2** Lệnh *Clean Up Orphaned Processes* (title bar `…`) → confirm 1 lần với danh sách → force kill tất cả (bỏ blocked).
- **AC3** Status bar đổi nền cảnh báo khi số orphan > 0.

### US-08 Kill All in Workspace
- **AC1** Lệnh trên title bar `…` → confirm 1 lần kèm danh sách port → dừng tất cả listener nhóm Current (graceful nếu có terminal).
- **AC2** Không có port nào → thông báo *"No ports in this workspace."*

### US-09 Status bar
- **AC1** `$(plug) 3` = số listener nhóm Current; ẩn số khi 0 (`$(plug)`).
- **AC2** Tooltip: số Current, Other, Orphaned. Click → focus view.
- **AC3** `showStatusBar = false` → ẩn hoàn toàn và không quét lúc khởi động.

### US-10 Ghim & theo dõi port
- **AC1** Context menu *Pin Port* / *Unpin Port*; lệnh palette *Pin Port...* nhập số.
- **AC2** Nhóm *Pinned* luôn hiển thị các port đã ghim: `🟢 :5432 free` hoặc `🔴 :5432 — postgres.exe`.
- **AC3** Lưu vào setting `whosOnMyPort.pinnedPorts` ở cấp **Workspace** nếu có workspace, ngược lại cấp **User**.

### US-11 Tiện ích dòng
- *Open in Browser* (`http://localhost:<port>`), *Copy PID*, *Copy Command Line*, *Open Project Folder* (khi có `projectPath`).

### US-12 Dev Filter
- Nút `$(filter)` / `$(filter-filled)` bật/tắt nhóm System; trạng thái lưu vào `filterDevOnly` (User).

### US-13 Nền tảng không hỗ trợ
- macOS/Linux v1.0: view hiển thị welcome *"Windows only in v1.0 — macOS/Linux coming soon"* + link GitHub; không có lỗi.

---

## 8. Đặc tả UI

### 8.1. Đóng góp (`package.json`)
| Vị trí | Thành phần |
|---|---|
| Activity Bar | Container `whosOnMyPort`, icon `media/plug.svg` |
| View | `whosOnMyPort.ports` ("Ports") |
| Title bar (navigation) | Kill Port… `$(debug-stop)`, Refresh `$(refresh)`, Filter `$(filter)`/`$(filter-filled)`, Collapse All (built-in) |
| Title bar (`…`) | Kill All in Workspace, Clean Up Orphaned Processes, Pin Port… |
| Inline (hover) | Open in Browser `$(globe)`, Kill `$(flame)` (chỉ khi killable) |
| Context menu | Kill, Force Kill, Reveal Terminal, Open in Browser, Copy PID, Copy Command Line, Open Project Folder, Pin/Unpin |
| Status bar | Trái, priority thấp |

### 8.2. `contextValue` của item port
Ghép token, cách nhau bởi `.`: `port` + `killable` | `blocked` + `terminal`? + `project`? + `pinned`|`unpinned`. Menu dùng regex: `viewItem =~ /\bkillable\b/`.

### 8.3. Mẫu nhận diện port bận (sau khi bỏ mã ANSI)
| Nguồn | Regex (i) |
|---|---|
| Node | `EADDRINUSE[^\n]*?:(\d{2,5})` |
| Chung | `address already in use[^\n]*?:(\d{2,5})` |
| Chung | `port (\d{2,5}) is (?:already )?in use(?!, trying)` |
| Spring Boot | `Port (\d{2,5}) was already in use` |
| Python/uvicorn | `\[Errno (?:98|48|10048)\][^\n]*?(\d{2,5})` |
| .NET/Kestrel | `Failed to bind to address [^\s]*:(\d{2,5})` |

---

## 9. Cấu hình

### 9.1. Settings
| Key | Kiểu | Mặc định | Scope | Mô tả |
|---|---|---|---|---|
| `whosOnMyPort.autoRefreshSeconds` | number (0–3600) | `0` | user | Quét định kỳ khi view hiển thị. 0 = tắt |
| `whosOnMyPort.confirmBeforeKill` | boolean | `true` | user | Hỏi trước khi kill |
| `whosOnMyPort.filterDevOnly` | boolean | `true` | user | Ẩn nhóm System |
| `whosOnMyPort.customDevProcesses` | string[] | `[]` | user | Thêm tên tiến trình dev (không cần `.exe`) |
| `whosOnMyPort.gracefulStop` | boolean | `true` | user | Ctrl+C trước với tiến trình trong terminal |
| `whosOnMyPort.gracefulTimeoutMs` | number (500–15000) | `3000` | user | Thời gian chờ graceful trước khi force |
| `whosOnMyPort.detectPortInUse` | boolean | `true` | user | Bắt EADDRINUSE trong terminal |
| `whosOnMyPort.showStatusBar` | boolean | `true` | user | Hiển thị status bar |
| `whosOnMyPort.pinnedPorts` | number[] | `[]` | resource | Port ghim |

### 9.2. Danh sách dev process mặc định
`node, bun, deno, npm, npx, yarn, pnpm, python, python3, pythonw, py, uvicorn, gunicorn, flask, java, javaw, kotlin, gradle, mvn, go, dlv, air, dotnet, iisexpress, ruby, rails, puma, php, php-cgi, httpd, apache, nginx, caddy, mysqld, mariadbd, postgres, mongod, redis-server, memurai, elasticsearch, rabbitmq-server, erl, beam.smp, cargo, hugo, ngrok, cloudflared, esbuild, docker, com.docker.backend, wslrelay` + `customDevProcesses`. Nguồn chân lý: `src/core/safety.ts` (`DEFAULT_DEV_PROCESSES`).

Tên dự án chỉ được suy từ đường dẫn (§5.4 bước 2) với dev process không bị blocked, để tránh nhãn nhiễu như "Microsoft VS Code" cho tiến trình hệ thống.

---

## 10. Lệnh

| Command ID | Tiêu đề | Palette |
|---|---|---|
| `whosOnMyPort.refresh` | Refresh | ✔ |
| `whosOnMyPort.killPort` | Kill Port... | ✔ |
| `whosOnMyPort.killAllInWorkspace` | Kill All Ports in Workspace | ✔ |
| `whosOnMyPort.cleanOrphans` | Clean Up Orphaned Processes | ✔ |
| `whosOnMyPort.pinPort` | Pin Port... | ✔ |
| `whosOnMyPort.filterOn` / `filterOff` | Show Only Dev Processes / Show All Processes | ✗ |
| `whosOnMyPort.kill` / `forceKill` | Kill / Force Kill | ✗ |
| `whosOnMyPort.openBrowser` | Open in Browser | ✗ |
| `whosOnMyPort.revealTerminal` | Reveal Terminal | ✗ |
| `whosOnMyPort.copyPid` / `copyCommandLine` | Copy PID / Copy Command Line | ✗ |
| `whosOnMyPort.openProjectFolder` | Open Project Folder | ✗ |
| `whosOnMyPort.pin` / `unpin` | Pin Port / Unpin Port | ✗ |

---

## 11. Yêu cầu phi chức năng

| Mã | Yêu cầu | Chỉ tiêu |
|---|---|---|
| NFR-01 | Thời gian quét | P95 ≤ 1,5 s; P50 ≤ 800 ms (Win11, SSD, ~300 tiến trình) |
| NFR-02 | CPU khi nghỉ | 0% (không timer khi view ẩn và `autoRefreshSeconds = 0`) |
| NFR-03 | Bộ nhớ | ≤ 15 MB tăng thêm trên extension host |
| NFR-04 | Kích thước gói `.vsix` | ≤ 200 KB, **0 runtime dependency** |
| NFR-05 | Kích hoạt | `onStartupFinished`; activate ≤ 50 ms (không quét đồng bộ) |
| NFR-06 | Quyền riêng tư | Không gửi dữ liệu ra mạng. Không telemetry |
| NFR-07 | Khả năng phục hồi | Lỗi PowerShell/netstat → hiện item lỗi trong view với nút *Retry* + *Open Logs*, không crash |
| NFR-08 | Logging | OutputChannel "Who's On My Port" (`LogOutputChannel`), log thời gian từng bước quét |
| NFR-09 | Accessibility | Mọi item có `accessibilityInformation`; không chỉ dùng màu để truyền thông tin |
| NFR-10 | i18n | Mọi chuỗi qua `vscode.l10n.t` / `package.nls.*.json` |

---

## 12. Edge cases

| # | Tình huống | Hành vi mong đợi |
|---|---|---|
| E1 | Windows tiếng Đức/Nhật (state netstat bản địa hoá) | Vẫn đúng (nhận diện bằng remote addr) |
| E2 | PID cha đã chết và PID bị tái sử dụng bởi tiến trình khác | Coi là chuỗi đứt (so `CreationDate`) |
| E3 | Tiến trình chạy Admin, VS Code không Admin | CommandLine `null` → 🔒, kill thất bại → nút Kill as Administrator |
| E4 | PowerShell bị GPO chặn / Constrained Language Mode | Item lỗi + hướng dẫn trong README; vẫn hiển thị port + PID từ netstat (thiếu tên/RAM) |
| E5 | `npm run dev` → node con giữ port | Kill PID giữ port với `/T`; wrapper npm tự thoát |
| E6 | Port giữ bởi Docker/WSL | Blocked + lý do |
| E7 | Port giữ bởi chính VS Code (debug, language server) | Blocked `editor` |
| E8 | Đường dẫn Unicode (`D:\Dự án\shop`) | Hiển thị đúng (UTF-8 output) |
| E9 | Cùng port, khác PID (SO_REUSEPORT hiếm trên Windows) | Hiện 2 dòng |
| E10 | Tiến trình kết thúc giữa lúc netstat và CIM | Dòng hiện `PID 1234 (exited)`, không kill được, biến mất ở lần quét sau |
| E11 | Hai cửa sổ ghi registry cùng lúc | Ghi atomic (rename); tự lành ở lần ghi sau |
| E12 | Multi-root workspace | So khớp mọi folder; label cửa sổ = tên workspace |
| E13 | Cửa sổ không mở folder | Nhóm Current chỉ dựa vào terminal PID |
| E14 | Vite "Port 5173 is in use, trying another one" | Không thông báo |
| E15 | Cùng lỗi EADDRINUSE in nhiều lần trong 1 lệnh | Thông báo 1 lần |

---

## 13. Kế hoạch kiểm thử

### 13.1. Unit (node:test, chạy trong CI)
- `windowsParse`: netstat EN + DE + IPv6 + dòng rác; JSON CIM (mảng, object đơn, `null`).
- `classifier`: 7 luật §5.2, PID tái sử dụng, dedupe IPv4/IPv6, orphan, blocked, projectName.
- `pathUtils`: ranh giới đường dẫn, chữ hoa/thường, `/` vs `\`.
- `portInUseDetector` patterns: bảng §8.3 + negative (Vite).

### 13.2. Ma trận kiểm thử thủ công
| Môi trường | Biến thể |
|---|---|
| OS | Win10 22H2, Win11 23H2, Win11 24H2 |
| Ngôn ngữ OS | EN, VI, DE |
| PowerShell | 5.1 (mặc định) |
| Shell terminal | pwsh 7, PowerShell 5.1, Git Bash, cmd.exe |
| Editor | VS Code Stable, Insiders, Cursor |
| Quyền | User thường, VS Code chạy Admin |
| Kịch bản | 2 cửa sổ × (vite + express), XAMPP (Apache + MySQL), Django, Spring Boot, Docker Desktop (nginx container), WSL2 `python -m http.server` |

---

## 14. Phát hành & Roadmap

### 14.1. Go-to-market
- Repo GitHub công khai, MIT; README có GIF demo (multi-window, Kill & Retry).
- CI GitHub Actions: build + test trên `windows-latest`; tag `v*` → publish Marketplace (`vsce`) + Open VSX (`ovsx`).
- Từ khoá Marketplace: `port, kill port, EADDRINUSE, process, taskkill, netstat, localhost`.
- Kênh ra mắt: r/vscode, r/webdev, dev.to, Viblo, J2Team/Vietnam Developers.

### 14.2. Roadmap
| Phiên bản | Nội dung |
|---|---|
| 1.0 | Phạm vi §1.4 |
| 1.1 | Docker: ánh xạ port → container, `docker stop`/`restart`; macOS/Linux provider (`lsof`, `ss`, `ps`) |
| 1.2 | Remote (WSL/SSH/Container) — provider chạy phía workspace; UDP |
| 1.3 | "Restart" dev server (kill + chạy lại lệnh gốc trong terminal) |

---

### 14.3. Tính năng v2.3 (đã cài đặt)
Ràng buộc chung: **không thêm toast/notification** (ngoại lệ duy nhất: phản ứng với lỗi bind của chính lệnh người dùng, dùng lại đường Kill & Retry), không polling nền, phản hồi qua icon/badge (FileDecoration), tooltip, `setStatusBarMessage` hoặc tài liệu mở khi người dùng chủ động gọi lệnh.

| # | Tính năng | Cách làm |
|---|---|---|
| 15 | **Copy Port List as Markdown** (`whosOnMyPort.copyAsMarkdown`, menu `…` + Palette) | Bảng `Port \| Process \| PID \| Project \| Memory \| Uptime \| Bound to \| Window` cho các dòng đang hiển thị (tôn trọng Dev Filter). Formatter thuần: `core/markdownReport.ts`. Xác nhận qua status bar. |
| 9 | **Cảnh báo RAM / chạy lâu** (`memoryWarningMB` = 1024, `longRunningHours` = 8; `0` = tắt) | `FileDecorationProvider` trên scheme `whos-on-my-port:` — mỗi port có `resourceUri` `whos-on-my-port:/port/<port>/<pid>`, dự án có `whos-on-my-port:/project/<key>`. Badge `▲` (RAM), `⏱` (uptime), cả hai `▲⏱`; màu `list.warningForeground`; tooltip "Uses 1.4 GB RAM · Running for 9h". Dự án nhận badge gộp. Tính lại sau mỗi lần quét / đổi cấu hình. Ngưỡng thuần: `core/warnings.ts`. |
| 1 | **Restart dev server** (`whosOnMyPort.restart`, inline `$(debug-restart)` giữa Copy URL và Kill + context menu) | `CommandTracker` nghe `onDidStart/EndTerminalShellExecution`, nhớ lệnh cuối (+cwd) theo terminal (bỏ qua confidence Low); `PortInUseDetector` dùng chung tracker. Token `restartable` khi port có `terminalPid` và biết lệnh. Luồng: xác nhận theo `confirmBeforeKill` → Killer (Ctrl+C → taskkill) → chờ execution kết thúc ≤5 s → nếu chưa, taskkill `terminalChildPid` (tiến trình con trực tiếp của shell, vd. `npm`) và chờ thêm 2 s → `shellIntegration.executeCommand(lệnh)`. Phản hồi bằng status bar. |
| 2 | **Port bị Windows giữ chỗ** (Hyper-V/WSL `excludedportrange`) | Parser thuần `core/reservedPorts.ts` (chỉ đọc dòng 2 số + `*`, vì output netsh bị bản địa hoá). Provider `reservedPortRanges()` chạy `netsh interface ipv4/ipv6 show excludedportrange protocol=tcp`, cache 60 s, **chỉ gọi khi cần** (lỗi bind, Kill Port… với port rảnh, port ghim đang rảnh, lệnh Show). Pattern mới `findPortErrors` (kind `denied`): Node `EACCES`, Python `WinError 10013`/`Errno 13`, .NET "forbidden by its access permissions" — chỉ khi trích được số port. Khi lỗi `denied` hoặc không ai giữ port mà port nằm trong dải → cảnh báo "Port 3000 is reserved by Windows (Hyper-V/WSL range 2980–3079)" với một nút **How to fix**. Lệnh `whosOnMyPort.showReservedPorts` mở tài liệu Markdown untitled: danh sách dải + 3 cách sửa (`net stop/start winnat`, `netsh int ipv4 add excludedportrange …`, `netsh int ipv4 set dynamic tcp start=49152 num=16384`) — **không bao giờ tự chạy**. Port ghim rảnh mà bị giữ chỗ: icon `lock`, mô tả "reserved by Windows", bấm để mở hướng dẫn. |
| 11 | **Test trên điện thoại** (`copyLanUrl`, `showQrCode` trong context menu khi có token `lan`) | `core/lanUrl.ts` (thuần, nhận dữ liệu `os.networkInterfaces()`): IPv4, không internal, bỏ `169.254.x`, card ảo (vEthernet/WSL/Hyper-V/VirtualBox/VMware/Docker) xếp sau; bind IP cụ thể thì dùng IP đó. Nhiều IP → QuickPick. QR: vendored Project Nayuki QR Code generator (MIT, `src/vendor/qrcodegen.ts`), ECC M → SVG ghi vào `globalStorage/qr/<port>.svg`, mở bằng image preview (`vscode.openWith … imagePreview.previewEditor`, fallback `vscode.open`). Tooltip port hiện LAN URL. |

---

## 15. Vấn đề còn mở
| # | Câu hỏi | Đề xuất mặc định |
|---|---|---|
| Q1 | Publisher ID Marketplace? | Cần tạo trước khi publish |
| Q2 | Kiểm tra trùng tên "Who's On My Port" trên Marketplace/Open VSX | Kiểm tra trước khi publish |
| Q3 | Có cho phép tắt lưới an toàn (power user)? | Không ở v1.0 |
