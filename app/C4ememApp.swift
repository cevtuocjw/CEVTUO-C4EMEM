// C4emem —— macOS 菜单栏 App（薄壳）
//
// 定位：**不放任何业务逻辑**。核心仍然是 Bun 服务（src/server.ts），
// 这个 App 只做三件事：① 把核心拉起来 ② 给它一个原生窗口 ③ 常驻菜单栏。
//
// 为什么用 Swift 而不是 Tauri/Electron：
//   · 这台机器**已经有 Swift 工具链**（Command Line Tools 即可），没有 Rust；
//     Tauri 要先装 Rust（~1GB+），Electron 光运行时就是 ~150MB。而这个产物是几百 KB。
//   · 菜单栏常驻（NSStatusItem）是原生的，不需要额外方案。
//   · 核心是 HTTP 服务 ⇒ 以后 Android / 眼镜端复用同一个核心，这里不需要重写。

import Cocoa
import WebKit
import UserNotifications
// ⚠️ 全局快捷键要走 Carbon 的 `RegisterEventHotKey` —— **它不需要辅助功能授权**。
//    换成 `NSEvent.addGlobalMonitorForEvents(matching: .keyDown)` 就要，
//    而没授权时它是**静默不工作**的（看起来像"这个功能没做"）。
import Carbon.HIToolbox

private var gHotKeyRefs: [EventHotKeyRef] = []
private let kHotKeySig: OSType = 0x43344D4D   // 'C4MM'

private let kPort = 8770
/// 构建时由 build.sh 替换成真实路径
private let kProjectDir = "__PROJECT_DIR__"
private let kBase = "http://127.0.0.1:\(kPort)"

/// ⚠️⚠️ 桌面 Pet 那个窗 —— **只有一个尺寸，永远不缩**（2026-10-10 深夜改）。
///
/// ⭐ 为什么原来是"小的 + 展开时放大"、现在不这么干了：
///   读者报的「**点一下别的就乱闪**」根因就是那次 resize。
///   实测（`~/.c4emem/client.log` 里那串 OPEN/CLOSE）：
///     CLOSE{"x":289,"y":292,"px":342,"py":359,"vw":420,"vh":500}
///     OPEN {"x":169,"y":232,"px":222,"py":299,"vw":300,"vh":440}
///   同一个光标、**同一个真实距离**，两次算出来的 d 却不一样（而且都被算成 86）——
///   因为 `setFrame` 是同步的，而 **WKWebView 里那个页面视口是异步跟上的**：
///   中间那几帧里，"原生窗口已在 420×500、页面还以为自己是 300×440"，
///   `getBoundingClientRect()`（页面坐标）和 `convertPoint(fromScreen:)`（窗口坐标）
///   就**不在同一个坐标系里**了 ⇒ 距离算错 ⇒ 越过阈值 ⇒ 开-关-开-关。
///   ⚠️ 这是"**两个坐标系在被改的那一瞬间对不上**"，不是阈值没调好 —— 调阈值只会让它换个地方抖。
///
/// ⇒ 窗**一次给够**，不再 resize（`resizePet` 那个 `abs(old-size)<1` 的分支于是永远直接返回）。
///   代价是这块透明窗**天生会吃点击**，所以配了一条：**光标离宠物远的时候整窗穿透**
///   （见 `feedPetMouse`）—— 桌面该点哪儿还是点哪儿。
///   尺寸是**算出来的**：弧只走 150°~268°（左下→左→上），最外圈半径 = rIn(78)+thick(68)+step(10)+thick(68) ≈ 224，
///   再算上图标外溢和下面那三行字，440×520 够用。
private let kPetIdle = NSSize(width: 440, height: 520)
private let kPetRing = NSSize(width: 440, height: 520)
/// Pet 在窗里的偏移（和 app.css 里 `.pet{right:26px;bottom:96px}` **必须一致**）——
/// 放大/缩小时靠它算锚点，算错了小家伙会在展开的一瞬间跳走。
private let kPetRight: CGFloat = 26
private let kPetBottom: CGFloat = 96

/// ⚠️⚠️ **Pet 开没开、在哪儿，必须记在 UserDefaults 里** ——
///    读者报的「C4 菜单栏 → 桌面 CEVTUO Pet **功能开启没有做到**」就是这个：
///    菜单点一下**当时是开的**（`pet-bridge.log` 里有 `togglePet 开窗`，截图里也看得到），
///    但**重启 App 就没了**（原来只有 `--pet` 启动参数才会自动放出来）。
///    ⇒ 开一次就记住，下次自己回来 —— 否则"开过了"和"没这个功能"在读者眼里一模一样。
/// ⚠️ 放**文件级**（不是类里的 `let`）：它们要在 Timer 闭包里用，
///    写成实例属性就得处处 `self.` —— 编译期直接报错（这个坑刚踩过一次）。
private let kPetOnKey = "petOn"
private let kPetXKey = "petOriginX"
private let kPetYKey = "petOriginY"

/// ⚠️ 桥这一层**出问题是全静默的**（消息没到 = 什么都没发生、控制台一个字都没有）。
/// 所以往一个固定文件里记一行 —— 排查"拖不动 / 展不开 / 点不动"时先看它。
func petLog(_ s: String) {
    let line = "\(Date().timeIntervalSince1970) \(s)\n"
    let p = NSHomeDirectory() + "/Documents/Cevtuo-C4emem/pet-bridge.log"
    if let h = FileHandle(forWritingAtPath: p) {
        h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close()
    } else {
        try? line.write(toFile: p, atomically: true, encoding: .utf8)
    }
}

/**
 * 桌面 Pet 那个窗。
 *
 * ⚠️⚠️ 读者报的两句是**同一个根因**：
 *   「**必须焦点在这个 cevtupet 上时候它才能**」「鼠标移过去还是跳」
 *   ⇒ 之前用的是裸的 `NSWindow` + `.borderless`：**无边框窗默认 `canBecomeKey = false`**，
 *     而 `mouseMoved`（悬停）事件**只有 key 窗口才会拿到** ——
 *     于是必须先在它上面点一下（让它成为 key），那一圈才肯出来。
 *   ⇒ 换成一个 `NSPanel`：
 *      · 覆写 `canBecomeKey = true`（能收键盘/悬停），`canBecomeMain = false`（不去抢主窗口）
 *      · `.nonactivatingPanel` —— **点它不会把整个 App 激活**（否则点一下桌面 Pet，
 *        你正在用的那个 App 就掉到后面去了）
 *      · `acceptsMouseMovedEvents = true` —— 没有这一句，悬停**永远不触发**
 *      · `hidesOnDeactivate = false` —— NSPanel 默认会在 App 失活时躲起来
 *        （那正好把"关掉软件它还留在桌面"这个卖点吃掉）
 */
final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/**
 * ⚠️⚠️ **第一次点击必须算数** —— 这是 reader 报的两件事的**同一个根因**：
 *   「**从每个软件都要双击两次才能打开**」和「**拖动卡片不动**」。
 *
 *   AppKit 的老规矩：**窗口不是 key 的时候，第一次鼠标按下只用来"激活窗口"**，
 *   除非那个 view 的 `acceptsFirstMouse` 回 true。我们的面板是 `.nonactivatingPanel`
 *   （刻意不抢整个 App 的焦点），于是：第一次按 → 被吞掉；从第二次起才真的到网页里。
 *   ⇒ 表现就是"要点两次"，而拖拽更惨：**按下那一下被吞 ⇒ `pointerdown` 从来没发生 ⇒
 *     后面一路 `pointermove` 全被 `if (!dragging) return` 挡掉 ⇒ 一条 `drag` 都不发**
 *     （实测：合成一次完整拖拽，`pet-bridge.log` 里**零条** `drag`）。
 *
 *   ⚠️ 判据不能是"看着像拖动了" —— 要去看**桥里有没有 `drag`**。
 *     这个坑从第一版就在，一直没被发现，就是因为没人去数那几行日志。
 */
final class PetWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var statusItem: NSStatusItem!
    private var statusLine: NSMenuItem!
    private var window: NSWindow?
    private var webView: WKWebView?
    // ── 桌面 Pet：**独立的一个置顶透明窗**，关掉主窗口它也还在 ──
    private var petWindow: NSWindow?
    private var petWeb: WKWebView?
    private var petItem: NSMenuItem!
    private var petThroughItem: NSMenuItem!
    private var server: Process?
    /// 这个进程是不是我们拉起来的（是才在退出时关掉；不是就别动别人的）
    private var ownServer = false

    func applicationDidFinishLaunching(_ note: Notification) {
        // ⚠️ 注册默认值必须在**读**它之前：没存过的时候**默认是开的**
        //    （读者的期望就是"它应该在那儿"，而不是"点一下才有"）
        UserDefaults.standard.register(defaults: [kPetOnKey: true])
        buildMainMenu()
        buildMenu()
        installHotKeys()
        startServerIfNeeded()
        startWatchers()
        // `--open` 启动后直接把窗口开出来（自检 / 开机自启用得上）。
        // 等几秒是留给核心启动 —— 服务没起来之前开窗会看到空白页。
        if CommandLine.arguments.contains("--open") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.openUI() }
        }
        // `--pet` 启动后直接把桌面 Pet 放出来（自检用得上：不用去点菜单栏）。
        // 没带这个参数的时候**按上次记住的状态来**（默认开）。
        if CommandLine.arguments.contains("--pet") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.togglePet() }
        } else if UserDefaults.standard.bool(forKey: kPetOnKey) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                guard let self, self.petWindow?.isVisible != true else { return }
                self.togglePet()
            }
        }
        Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in
            self?.refreshStatus()
        }
        refreshStatus()
    }

    /// ⭐⭐ 读者 2026-10-13：「我点 c4emem 图标，完全没有反应」。
    ///    —— App 是 `LSUIElement`（菜单栏 App，**Dock 里没有图标、也没有窗口**），
    ///    而且**很可能已经在跑了**（Pet 就在屏幕上）。这时候在访达 / 启动台里再点一下，
    ///    macOS 只是发一个 `reopen` 事件，我们**什么都不做** ⇒ 看起来就是"完全没反应"。
    ///    ⇒ 把主界面叫出来，并且明确**回复 true 表示我处理了这个事件**。
    ///    ⚠️ 这一条只有 `LSUIElement` 的 App 需要 —— 有 Dock 图标的 App 由系统自己处理。
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        petLog("reopen（已经在跑，把主界面叫出来）")
        openUI()
        return true
    }

    func applicationWillTerminate(_ note: Notification) {
        // ⚠️ 只关自己拉起来的那个。如果服务本来就在跑（比如你手动开的），
        //    退 App 不该把它带走。
        clipTimer?.invalidate(); schedTimer?.invalidate()
        if ownServer { server?.terminate() }
    }

    // ── 主动式：原生侧检测（这一层**零 token**）──────────────
    //
    // 检测必须在原生侧 —— 网页拿不到系统级事件（前台应用、剪贴板历史、日历）。
    // 这里只负责"报告发生了什么"，**判不判断、推不推由核心说了算**
    // （预算/间隔/静默时段/去重全在服务端，见 src/proactive.ts）。
    private var lastClipCount = -1
    private var clipTimer: Timer?
    private var schedTimer: Timer?

    private func startWatchers() {
        // ① 前台应用切换
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(appSwitched(_:)),
            name: NSWorkspace.didActivateApplicationNotification, object: nil)

        // ② 剪贴板变化（轮询 changeCount —— 这是官方做法，没有事件通知）
        lastClipCount = NSPasteboard.general.changeCount
        clipTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
            self?.checkClipboard()
        }

        // ③ 定时回顾
        schedTimer = Timer.scheduledTimer(withTimeInterval: 1800, repeats: true) { [weak self] _ in
            self?.report(type: "schedule", context: "定时回顾")
        }

        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    @objc private func appSwitched(_ n: Notification) {
        guard let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              // ⚠️ 大小写不敏感：App 已改名成 `cevtuo-c4emem`，写死的 `"C4emem"` 匹配不上了
              //    ⇒ 我们会把自己的切换当成"用户切到了别的软件"往主动式里灌。
              let name = app.localizedName, !name.lowercased().contains("c4emem") else { return }
        report(type: "appSwitch", context: "刚刚切到 \(name)")
    }

    private func checkClipboard() {
        let pb = NSPasteboard.general
        let c = pb.changeCount
        if c == lastClipCount { return }
        lastClipCount = c
        guard let s = pb.string(forType: .string) else { return }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        // 太短的多半是误触，太长的多半是整篇粘贴 —— 都不是"值得提醒"的
        guard t.count >= 12, t.count < 1200 else { return }
        report(type: "clipboard", context: t)
    }

    private func report(type: String, context: String) {
        guard let url = URL(string: "\(kBase)/api/proactive/event") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "type": type, "context": context, "key": String(context.prefix(60)),
        ])
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let data,
                  let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  o["push"] as? Bool == true else { return }
            self?.notify(body: o["body"] as? String ?? "")
        }.resume()
    }

    private func notify(body: String) {
        let c = UNMutableNotificationContent()
        c.title = "cevtuo-c4emem"
        c.body = String(body.prefix(240))
        c.sound = .default
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
    }

    // ── 菜单栏 ──────────────────────────────────────────────
    /// ⚠️⚠️⚠️ 读者 2026-10-13：「**c4emem 现在不能 command M 缩小到 Dock**」。
    ///    真因不是窗口不能最小化（`styleMask` 里一直有 `.miniaturizable`），
    ///    而是 **App 从来没有"主菜单"** —— 以前是 `LSUIElement`（纯菜单栏 App），
    ///    只有状态栏那颗菜单。而 `⌘M` / `⌘H` / `⌘Q` 这些**系统快捷键是靠主菜单里的
    ///    菜单项存在的**：没有那个菜单项，按下去就什么都不发生（而且没处看见）。
    ///    ⇒ 现在它是普通 App 了，把最小的一套主菜单补上。
    private func buildMainMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "关于 cevtuo-c4emem",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 cevtuo-c4emem",
                        action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 cevtuo-c4emem",
                        action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let winItem = NSMenuItem()
        main.addItem(winItem)
        let winMenu = NSMenu(title: "窗口")
        winItem.submenu = winMenu
        // action 的目标留空（nil）⇒ 沿响应链找到 key window 去执行，这才是标准做法
        winMenu.addItem(withTitle: "最小化",
                        action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "缩放",
                        action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winMenu.addItem(.separator())
        winMenu.addItem(withTitle: "前置全部窗口",
                        action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        NSApp.windowsMenu = winMenu          // 让系统知道"这就是窗口菜单"（最小化后还能从它恢复）

        NSApp.mainMenu = main
    }

    // ── 页面加载计时（读者：「加载非常慢，经常会白屏」）──────────────
    // ⚠️ 先量再改：没有这几个数，就只能靠猜（而"慢"和"坏了"看起来一样）。
    private var navStart: Date?
    func webView(_ wv: WKWebView, didStartProvisionalNavigation nav: WKNavigation!) {
        navStart = Date()
        petLog("界面开始加载 \(wv.url?.absoluteString ?? "-")")
    }
    func webView(_ wv: WKWebView, didFinish nav: WKNavigation!) {
        let ms = navStart.map { Int(Date().timeIntervalSince($0) * 1000) } ?? -1
        petLog("界面加载完成 \(ms)ms")
        crashReloads = 0        // 成功一次 ⇒ "连崩"重新计数
    }
    func webView(_ wv: WKWebView, didFail nav: WKNavigation!, withError e: Error) {
        petLog("界面加载失败 \(e.localizedDescription)")
        showBoot("界面加载失败", e.localizedDescription)
    }
    func webView(_ wv: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) {
        // ⚠️ 这一条是**主框架**的（子资源失败不会走到这儿）。不铺一张纸的话，
        //    这里留下的就是一块**纯白**，而用户只会说"软件坏了"。
        petLog("界面加载失败(provisional) \(e.localizedDescription)")
        showBoot("连不上核心", "\(e.localizedDescription)（日志：~/Documents/Cevtuo-C4emem/pet-bridge.log）")
    }

    /// ⚠️⚠️⚠️ 2026-10-13 读者：「刚打开软件这个样子存在了特别久，然后**纯白完全不可用**」。
    ///
    /// 这是 WKWebView 最阴的一种失败：**WebContent 渲染进程被系统杀掉**
    /// （内存压力 / GPU / 渲染进程崩溃），窗口就留一块**永久纯白**。
    /// ⚠️ 页面自己的 `window.onerror` **不会被调用**（跑脚本的那个进程已经没了），
    ///    服务端也看不到任何请求 —— 界面上和日志里都是"什么都没有"。
    ///    **只有这一条回调会响**，而原来根本没接它 ⇒ 白着就白着，永远不会自己回来。
    ///
    /// ⇒ 记一笔 + **自动重载**（限次数：连崩 3 次就停下铺张纸，别变成无限重启）。
    private var crashReloads = 0
    func webViewWebContentProcessDidTerminate(_ wv: WKWebView) {
        crashReloads += 1
        petLog("渲染进程被系统终止（WebContent crash，第 \(crashReloads) 次）")
        if crashReloads <= 3 {
            wv.load(URLRequest(url: URL(string: kBase)!))
        } else {
            showBoot("界面反复崩溃", "已经自动重载 \(crashReloads) 次仍不稳定。日志：~/Documents/Cevtuo-C4emem/pet-bridge.log")
        }
    }

    private func showBoot(_ title: String, _ sub: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.loadHTMLString(Self.bootHTML(title, sub), baseURL: nil)
        }
    }

    private func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        // ⭐ 菜单栏那颗就是**那张扑克牌**（读者 2026-10-13：「你的 applogo…应该是那个扑克牌」）。
        //   ⚠️ 必须用**模板图**（`isTemplate`）：菜单栏深浅色由系统定，
        //      彩色图在深色菜单栏上会糊成一块；模板图只取 alpha，系统自己上色。
        //   ⚠️ 读不到就退回文字「C4」——宁可显示个丑的，也不要显示个**空的**。
        if let mark = Bundle.main.image(forResource: "CardTemplate") {
            mark.isTemplate = true
            statusItem.button?.image = mark
            statusItem.button?.imagePosition = .imageOnly
        } else {
            statusItem.button?.title = "C4"
        }
        statusItem.button?.toolTip = "cevtuo-c4emem"

        let menu = NSMenu()
        let open = NSMenuItem(title: "打开 cevtuo-c4emem", action: #selector(openUI), keyEquivalent: "o")
        open.target = self
        menu.addItem(open)

        let reload = NSMenuItem(title: "重新载入界面", action: #selector(reloadUI), keyEquivalent: "R")
        reload.target = self
        menu.addItem(reload)

        statusLine = NSMenuItem(title: "状态：检查中…", action: nil, keyEquivalent: "")
        statusLine.isEnabled = false
        menu.addItem(statusLine)
        menu.addItem(.separator())

        let sync = NSMenuItem(title: "重新同步 Notion", action: #selector(resync), keyEquivalent: "r")
        sync.target = self
        menu.addItem(sync)

        let pro = NSMenuItem(title: "主动式页面", action: #selector(openProactive), keyEquivalent: "")
        pro.target = self
        menu.addItem(pro)

        // ⭐ CEVTUO Pet —— **真的那个**（独立置顶透明窗，关掉主窗口也还在）
        petItem = NSMenuItem(title: "桌面 CEVTUO Pet（轮盘 ⌥⌘C / ⌥⌘4）", action: #selector(togglePet), keyEquivalent: "p")
        petItem.target = self
        menu.addItem(petItem)

        // ⭐ 点击穿透。⚠️ **必须放在菜单栏里** —— 穿透打开之后那个小家伙就收不到任何点击了，
        //    要是只能从它自己的右键菜单关，那就永远关不掉了。
        petThroughItem = NSMenuItem(title: "Pet 点击穿透（点它不响应，直接穿到桌面）",
                                    action: #selector(togglePetThrough), keyEquivalent: "")
        petThroughItem.target = self
        menu.addItem(petThroughItem)
        menu.addItem(.separator())

        let data = NSMenuItem(title: "打开数据目录", action: #selector(openDataDir), keyEquivalent: "")
        data.target = self
        menu.addItem(data)

        let finder = NSMenuItem(title: "在 Finder 中显示项目", action: #selector(openProject), keyEquivalent: "")
        finder.target = self
        menu.addItem(finder)
        menu.addItem(.separator())

        let quit = NSMenuItem(title: "退出 C4emem", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        statusItem.menu = menu
    }

    // ── 拉起核心 ────────────────────────────────────────────
    private func startServerIfNeeded() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            if self.ping() {
                DispatchQueue.main.async { self.ownServer = false; self.refreshStatus() }
                return
            }
            let p = Process()
            // ⭐⭐ **优先用打包进来的核心**（`Contents/Resources/c4core`）——
            //    这样别人机器上**不需要装 bun**。⚠️ 工作目录必须是 `Resources/app`：
            //    核心是运行时读盘找 `src/ui/*` 和 `scripts/*.py` 的（`process.cwd()`），
            //    目录不对就是"起来了但一片空白"。
            let res = Bundle.main.resourceURL
            let bundled = res?.appendingPathComponent("c4core")
            let appDir = res?.appendingPathComponent("app")
            if let bundled, FileManager.default.fileExists(atPath: bundled.path) {
                p.executableURL = bundled
                p.arguments = []
                if let appDir, FileManager.default.fileExists(atPath: appDir.path) {
                    p.currentDirectoryURL = appDir
                    // ⚠️⚠️ **绝不能把开发者的 token 发出去**：用户配置优先，
                    //    没有就用包里那份**模板**（空的来源凭据）——
                    //    用户在界面上填的东西写在 `~/.c4emem/settings.json`，盖在它上面。
                    var env = ProcessInfo.processInfo.environment
                    let userCfg = NSHomeDirectory() + "/.c4emem/c4emem.config.json"
                    let tpl = appDir.appendingPathComponent("c4emem.config.json")
                    env["C4EMEM_CONFIG"] = FileManager.default.fileExists(atPath: userCfg)
                        ? userCfg : tpl.path
                    // ⚠️⚠️⚠️ **这里是"点了没反应 / 一片白"的真凶之一**：
                    //    配置里 `llm.apiKeyEnv = C4EMEM_LLM_API_KEY` —— 密钥**只能从环境变量来**。
                    //    而 App 起的核心工作目录是包里的 `Resources/app`，那里**没有 `.env`**
                    //    ⇒ `hasLlm=false` ⇒ 所有要用模型的功能（提问 / 自我改进 / 主动式…）
                    //      全部失败，界面上看不出原因，就是"点了一下什么都没有"。
                    //    ⇒ 把 `~/.c4emem/.env` 灌进子进程环境（读者要的"完全独立"也靠它：
                    //      凭据住 App 自己的目录，不住仓库）。
                    let userEnvFile = NSHomeDirectory() + "/.c4emem/.env"
                    if let txt = try? String(contentsOfFile: userEnvFile, encoding: .utf8) {
                        var n = 0
                        for line in txt.split(separator: "\n") {
                            let t = line.trimmingCharacters(in: .whitespaces)
                            guard !t.isEmpty, !t.hasPrefix("#"), let eq = t.firstIndex(of: "=") else { continue }
                            let k = String(t[t.startIndex..<eq]).trimmingCharacters(in: .whitespaces)
                            var v = String(t[t.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
                            if v.hasPrefix("\"") && v.hasSuffix("\"") && v.count >= 2 {
                                v = String(v.dropFirst().dropLast())
                            }
                            if !k.isEmpty { env[k] = v; n += 1 }
                        }
                        petLog("凭据：从 \(userEnvFile) 灌了 \(n) 条环境变量")
                    } else {
                        petLog("⚠️ 没有 \(userEnvFile) —— 没有 key 时所有要用模型的功能都会失败（界面看起来就是「点了一下没反应」）")
                    }
                    p.environment = env
                }
                petLog("用打包的核心跑：\(bundled.path)")
            } else {
                // 开发模式：走仓库里的 bun（构建时没编上核心，或者在本机直接跑）
                p.executableURL = URL(fileURLWithPath: "/bin/zsh")
                p.arguments = ["-lc", "cd '\(kProjectDir)' && exec bun run src/server.ts"]
                petLog("用仓库里的 bun 跑（没打包核心）")
            }
            p.standardOutput = FileHandle.nullDevice
            p.standardError = FileHandle.nullDevice
            do {
                try p.run()
                DispatchQueue.main.async { self.server = p; self.ownServer = true }
            } catch {
                DispatchQueue.main.async { self.statusLine.title = "状态：❌ 起不来（\(error.localizedDescription)）" }
            }
        }
    }

    /// 同步探一次健康检查。只在后台队列调用。
    private func ping() -> Bool {
        guard let url = URL(string: "\(kBase)/api/stats") else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 2.5
        var ok = false
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            ok = (resp as? HTTPURLResponse)?.statusCode == 200
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 3.5)
        return ok
    }

    private func refreshStatus() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            let alive = self.ping()
            var n = ""
            if alive, let url = URL(string: "\(kBase)/api/stats") {
                if let data = try? Data(contentsOf: url),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let docs = obj["docs"] as? Int {
                    n = " · \(docs) 段"
                }
            }
            DispatchQueue.main.async {
                // 服务没在跑：**染成红的**（模板图染色），不再把文字塞回去 ——
                // 图和文字同时挂会让那颗标忽宽忽窄，整排菜单跟着抖。
                if self.statusItem.button?.image != nil {
                    self.statusItem.button?.contentTintColor = alive ? nil : .systemRed
                } else {
                    self.statusItem.button?.title = alive ? "C4" : "C4×"
                }
                self.statusLine.title = alive ? "状态：运行中\(n)" : "状态：未运行"
            }
        }
    }

    // ── 动作 ────────────────────────────────────────────────
    // ── 网页 → 原生的那条桥（`pet.js` 全靠它）──────────────────
    //
    // ⚠️ 为什么必须有一条桥：网页**挪不动原生窗口**，也**开不了别的 App 的窗口**。
    //    Pet 现在住在自己的置顶窗里，那两件事只能由 Swift 做。
    //    没桥时的表现是"拖不动 / 点了没反应"，而控制台一个字都没有。
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let b = m.body as? [String: Any], let cmd = b["cmd"] as? String else { return }
        // ⚠️ 桥这一层**出问题时是全静默的**（消息没到 = 什么都没发生，控制台一个字都没有）。
        //    所以留一行日志到 /tmp/c4emem-pet.log —— "拖不动/展不开/点不动"时先看它有没有在记。
        petLog("didReceive \(cmd) \(b)")
        switch cmd {
        case "resize":
            // ⭐ 轮盘/面板开着的时候，**整窗都要收点击** —— 否则最外圈那几个扇区
            //    和右边那块清单会落在"光标离宠物太远 ⇒ 整窗穿透"的判定里，点不动。
            petWheelOpen = b["open"] as? Bool ?? false
            resizePet(open: petWheelOpen)
        case "modal":
            petPanelOpen = b["on"] as? Bool ?? false
            feedPetMouse()          // 立刻按新状态算一次，别等下一个 50ms 周期
        // ⭐ 拖动交给 **AppKit 自己**（`performDrag`）——
        //   ⚠️ 原来是把位移一路 postMessage 回来再 setFrameOrigin，那是
        //      "网页动一下 → 消息 → 窗口挪一下"，永远落后一两帧（读者：'先拖出图片才跟随'）。
        //      现在按下的一瞬间就把这个事件交给系统拖，窗口跟手指**零延迟**。
        //   ⚠️ `performDrag` 必须在**处理这次 mousedown 的过程中**调 —— 消息是同步派发的，
        //      所以 `NSApp.currentEvent` 就是那个 mousedown。取不到就退回落后的那条老路。
        case "dragstart":
            if let w = petWindow, let ev = NSApp.currentEvent, ev.type == .leftMouseDown {
                // ⚠️ 拖动期间**必须停掉悬停判断**：窗口跟着鼠标走，Pet 在屏幕上的位置一直在变，
                //    距离一会儿进一会儿出 ⇒ 那一圈开-关-开-关（就是读者说的"反复跳"）。
                //    `performDrag` 自己跑事件循环直到松手，所以前后夹一个标志就够。
                petDragging = true
                w.performDrag(with: ev)
                petDragging = false
                petHoverCheck(NSEvent.mouseLocation)   // 松手后按新位置重算一次
            }
        case "drag": movePet(dx: b["dx"] as? Double ?? 0, dy: b["dy"] as? Double ?? 0)
        case "clickthrough":
            petWindow?.ignoresMouseEvents = b["on"] as? Bool ?? false
            refreshPetItem()
        // ⭐ 键盘焦点：轮盘要能接 A–Z，就必须让**这个面板是 key window**
        //    （读者是"点一下之后字母就能用"—— 点那一下干的正是这件事，这里主动做）
        // ⚠️⚠️ **立刻抢，不要延迟**（上一版我加过 350ms 想避开"鼠标路过"，
        //    但那会在"悬停展开 → 马上敲字母"时**按下去没反应** —— 而那种偶发失败
        //    比"鼠标路过时被抢一下焦点"难查得多，也难受得多。读者要的是零摩擦。）
        //    代价由另一头兜：收起时把焦点还回去（`releasePetFocus`）。
        case "focus": takeFocusForPet()
        // 收起时把焦点还回去（**刚切过软件就不还**，否则会把人家刚点开的 App 踢下去）
        case "closed": releasePetFocus(picked: b["picked"] as? Bool ?? false)
        // ⭐ 飞速打开：进程内启动，不走"HTTP → spawn 三个进程"那条路
        // ⭐ 只"让位"：把自己从激活位撤下来（好让**别的进程**能把目标 App 叫上来）
        case "release": yieldPetActivation()
        case "launch": launchFast(b["path"] as? String ?? "")
        case "show": openUI()
        case "voice":
            openUI()
            jsWhenApp("void (window.__app && window.__app.show('voice'))")
        case "settings":
            openUI()
            jsWhenApp("void (window.__app && window.__app.openPetSettings && window.__app.openPetSettings())")
        default: break
        }
    }

    /// ⚠️⚠️ 主界面是个 SPA，**加载要时间**。上一版是 `openUI()` 之后硬等 1.0 秒再
    ///    `evaluateJavaScript` —— 页面还没好的时候 `window.__app` 是 undefined，
    ///    那一句**静默什么都不做**，于是"右键进设置"看起来就是**彻底没做**
    ///    （而桥那一侧其实收到了 `settings`，`pet-bridge.log` 里能看到）。
    /// ⇒ 改成**问它好了没有**，每 350ms 再问一次，最多 12 次（约 4 秒）。
    /// ⚠️ 传进来的那句 JS **记得用 `void (...)` 包一下**：`openPetSettings` 这些是 async，
    ///    直接求值返回的是 Promise，`evaluateJavaScript` **序列化不了**它 ⇒
    ///    回调里拿到"unsupported type"的错。**调用其实成功了**，但日志写着"执行失败"，
    ///    下一次排查就会被它带偏（"报错 ≠ 没做"，这条踩过好几回）。
    private func jsWhenApp(_ js: String, tries: Int = 12) {
        guard let wv = webView else { return }
        wv.evaluateJavaScript("!!(window.__app && window.__app.openPetSettings)") { [weak self] r, _ in
            if (r as? Bool) == true {
                wv.evaluateJavaScript(js) { _, e in
                    if let e { petLog("jsWhenApp 执行失败 \(js): \(e.localizedDescription)") }
                }
            } else if tries > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { self?.jsWhenApp(js, tries: tries - 1) }
            } else {
                petLog("jsWhenApp 放弃：window.__app 一直没就绪")
            }
        }
    }

    /// ⚠️ 锚点：**.pet 在窗里贴着"右下"**（`right:26 / bottom:96`）。
    ///    所以涨窗口时，**左下角原点不动、宽高变大** —— 小家伙原地不动、
    ///    那一圈从它往**左上**长出来。（只改 y 就会让它往下跳，那种"跳"会被读成"没做对"。）
    private func resizePet(open: Bool) {
        guard let w = petWindow else { return }
        let old = w.frame
        let size = open ? kPetRing : kPetIdle
        if abs(old.width - size.width) < 1 && abs(old.height - size.height) < 1 { return }
        let f = NSRect(x: old.origin.x + (old.width - size.width), y: old.origin.y, width: size.width, height: size.height)
        w.setFrame(f, display: true)
        petWeb?.frame = NSRect(origin: .zero, size: size)
    }

    /// 拖：网页只发**位移**过来（它不知道窗口在哪），这里换算成屏幕坐标。
    /// ⚠️ `dy` 要**取反**：网页的 y 往下增长，AppKit 的 y 往上。
    private func movePet(dx: Double, dy: Double) {
        guard let w = petWindow else { return }
        var o = w.frame.origin
        o.x += CGFloat(dx); o.y -= CGFloat(dy)
        w.setFrameOrigin(o)
    }

    /// 位置：**没存过**才用"右下角"那个默认；存过就用回读者自己拖到的地方。
    /// ⚠️ 存过的那个点要**夹回可视区** —— 换过显示器/拔过外接屏之后，
    ///    昨天那个坐标可能落在现在的屏幕外面，而"窗口在屏幕外"和"功能没做"长得一模一样。
    private func positionPetDefault(_ w: NSWindow) {
        let d = UserDefaults.standard
        let hasX = d.object(forKey: kPetXKey) != nil
        if hasX {
            let p = NSPoint(x: d.double(forKey: kPetXKey), y: d.double(forKey: kPetYKey))
            let visible = NSScreen.screens.contains { $0.visibleFrame.insetBy(dx: 40, dy: 40).contains(p) }
            if visible { w.setFrameOrigin(p); return }
        }
        guard let scr = NSScreen.main else { return }
        let f = scr.visibleFrame
        w.setFrameOrigin(NSPoint(x: f.maxX - w.frame.width - 12, y: f.minY + 24))
    }

    /// ⚠️ `didMoveNotification` 在拖动期间**每一像素都发**一次 —— 直接写 UserDefaults 太吵，
    ///    攒 0.6 秒写一次（松手之后那一次一定写得进去）。
    @objc private func petMoved(_ n: Notification) {
        guard let w = n.object as? NSWindow, w === petWindow else { return }
        petSaveTimer?.invalidate()
        petSaveTimer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: false) { _ in
            let d = UserDefaults.standard
            d.set(Double(w.frame.origin.x), forKey: kPetXKey)
            d.set(Double(w.frame.origin.y), forKey: kPetYKey)
        }
    }

    @objc private func togglePet() {
        if let w = petWindow, w.isVisible {
            w.orderOut(nil); stopPetTracking(); refreshPetItem()
            UserDefaults.standard.set(false, forKey: kPetOnKey)
            return
        }
        if petWindow == nil {
            let w = PetPanel(contentRect: NSRect(origin: .zero, size: kPetIdle),
                             styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            // ⚠️ 这三行是"不抢焦点也能用"的全部：没有 `acceptsMouseMovedEvents`
            //    悬停永远不触发；没有 `hidesOnDeactivate=false`，切到别的 App 它就躲起来。
            w.acceptsMouseMovedEvents = true
            w.isFloatingPanel = true
            w.hidesOnDeactivate = false
            // ⚠️ 必须是 false：true 的话"只有当控件需要时才成为 key" ——
            //    而那一圈里的按钮恰恰**需要一个 key 窗口**才收得到点击。
            w.becomesKeyOnlyIfNeeded = false
            // ⚠️⚠️ 这四行少一行就是"桌面上多了一块白板/黑板"：
            //    `isOpaque=false` + `backgroundColor=.clear` + WebView 的 `drawsBackground=false`
            //    三处一起才真的透明；`hasShadow=false` 是因为无边框窗的投影会围出一个**方框**，
            //    那正好把"它其实是块矩形窗"这件事说出来。
            w.isOpaque = false
            w.backgroundColor = .clear
            w.hasShadow = false
            w.level = .floating                       // 浮在普通窗口上面
            // 跟着切 Space / 全屏时也在 —— 这就是"真的在桌面上"
            w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            w.isMovableByWindowBackground = false
            let cfg = WKWebViewConfiguration()
            cfg.userContentController.add(self, name: "c4")
            let wv = PetWebView(frame: NSRect(origin: .zero, size: kPetIdle), configuration: cfg)
            // ⚠️⚠️ **不能写成 `if wv.responds(to: Selector("setDrawsBackground:"))`** ——
            //    那个 key 是 KVC 私有的，`responds(to:)` 对它**返回 false**，
            //    于是这一句被跳过、WebView 留着白底 ⇒ 桌面上多一块**白板**（而窗口确实开了）。
            //    （读者报的「它可以跳出来窗口了，但是依旧只在窗口里」十有八九就是这一句。）
            //    正确做法是直接 setValue 并吞掉异常。
            do { wv.setValue(false, forKey: "drawsBackground") } catch { NSLog("pet: drawsBackground 设不了（%@）", "\(error)") }
            w.contentView = wv
            petWindow = w
            petWeb = wv
            positionPetDefault(w)
            // ⭐ 读者拖着它挪到哪儿，下次还在那儿
            NotificationCenter.default.addObserver(
                self, selector: #selector(petMoved(_:)),
                name: NSWindow.didMoveNotification, object: w)
        }
        UserDefaults.standard.set(true, forKey: kPetOnKey)
        petLog("togglePet 开窗 \(kBase)/ui/pet.html handler=\(petWeb?.configuration.userContentController != nil)")
        petWeb?.load(URLRequest(url: URL(string: kBase + "/ui/pet.html")!))
        petWindow?.orderFrontRegardless()
        startPetTracking()          // 鼠标监视器随窗口一起开
        startPetKeyMonitor()         // ⭐ 键盘那条兜底通路也跟着开
        refreshPetItem()
    }

    private func refreshPetItem() {
        petItem?.state = (petWindow?.isVisible ?? false) ? .on : .off
        // ⚠️ 这里报的是**手动**开关的状态。自动那条（光标远了就穿透）是常态，
        //    报出来的话菜单里就永远是个勾，反而看不出自己点过没有。
        petThroughItem?.state = petThroughManual ? .on : .off
    }

    // ── 悬停：**由 Swift 自己盯鼠标**，不靠网页的 mousemove ──────────
    //
    // ⚠️⚠️ 这是读者那句「**必须焦点在它上面时候它才能**」的真因：
    //    WKWebView 内部的 `NSTrackingArea` 是 `.activeInKeyWindow` 的 ——
    //    **窗口不是 key，hover 事件一个都不发**。而我们是 `.nonactivatingPanel`
    //    （刻意不抢焦点），于是"不点它一下，那一圈永远不出来"。
    //
    // ⭐⭐ 2026-10-10 改成**轮盘**之后，这里**只喂坐标、不判开合**：
    //    上一版把半径写死在这边（d<240 开 / d<380 关 / 104×122 的 Pet 矩形），
    //    而轮盘的外圈半径是**随 App 个数和大小档变的** ⇒ 那个常量一定不准，
    //    不准的表现就是指针明明在扇区上却被判成"出去了" ⇒ **一闪一闪**。
    //    ⇒ 几何判断交给网页（它知道自己画了多大），这边只负责**每 50ms 报一次位置**。
    //    ⚠️ 为什么用**定时器**而不是 `addGlobalMonitorForEvents`：
    //       全局监视器**收不到发给自己的事件** —— 指针一进我们这个窗就断流，
    //       而"断流"正好发生在**指针移到扇区上**的那一刻（最不能断的时候）。
    //       读 `NSEvent.mouseLocation` 的定时器没有这个盲区。
    private var petMouseTimer: Timer?
    private var petHoverOn = false
    private var petDragging = false
    /// 菜单栏那个"点击穿透"是**手动**开关（关掉之后自动那条重新接管）
    private var petThroughManual = false
    private var petSaveTimer: Timer?
    private var petFocusTimer: Timer?
    private var petKeyMon: Any?
    /// 光标已经进到预备圈里（提前占了键盘）
    private var petArmed = false
    /// 轮盘 / 清单面板是不是开着（网页通过 `resize` / `modal` 报上来）——
    /// 开着的时候整窗收点击，和"光标近了才收"是**两条并行的**条件。
    private var petWheelOpen = false
    private var petPanelOpen = false

    /// ⭐⭐⭐ **第二条通路：本地按键监视器**（2026-10-11 读者「按 C 打不开 chrome」）。
    /// 网页那条 `keydown` 要四个条件**同时**成立（App 活动 / 窗口 key / 网页是 first responder /
    /// 网页自己有焦点），任何一件没到位就是**静默失灵**。这条从原生直接抓、直接转给网页，
    /// 少一层响应链 —— 两条路任意一条通就够。
    /// ⚠️ 命中就 `return nil` **把这个键吃掉**，否则网页那条会再处理一次（字母算两遍）。
    /// ⚠️ 带 ⌘/⌃/⌥ 的**不碰**（别抢用户自己的快捷键）。
    private func startPetKeyMonitor() {
        if petKeyMon != nil { return }
        petKeyMon = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] ev in
            guard let self, self.petWheelOpen, self.petWindow?.isKeyWindow == true else { return ev }
            guard ev.modifierFlags.intersection([.command, .control, .option]).isEmpty else { return ev }
            var k = ""
            switch ev.keyCode {
            case 53: k = "Escape"
            case 48: k = "Tab"
            case 51: k = "Backspace"
            case 36, 76: k = "Enter"
            default:
                if let ch = ev.charactersIgnoringModifiers, ch.count == 1, ch != " " { k = ch }
            }
            guard !k.isEmpty else { return ev }
            let lit = "\"" + k.replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"") + "\""
            self.petWeb?.evaluateJavaScript("window.__petKey && window.__petKey(\(lit))")
            petLog("keyMon \(k)")
            return nil
        }
    }

    private func startPetTracking() {
        if petMouseTimer != nil { return }
        petMouseTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            self?.feedPetMouse()
        }
    }
    private func stopPetTracking() {
        petMouseTimer?.invalidate(); petMouseTimer = nil
        petHoverOn = false
    }
    private func feedPetMouse() {
        guard let w = petWindow, w.isVisible, !petDragging else { return }
        // ⚠️ `NSEvent.mouseLocation` 是**屏幕坐标、y 往上**；网页要的是**窗口坐标、y 往下**。
        // ⚠️ 直接减窗口原点再翻 y，**不用 `convertPoint(fromScreen:)`** ——
        //    那个版本要假设"内容视图 == 窗口"（无边框时成立，但换个窗型就静默错位）。
        let m = NSEvent.mouseLocation
        let fr = w.frame
        let x = Double(m.x - fr.minX)
        let y = Double(fr.maxY - m.y)
        // ⭐ 整窗常开 ⇒ 这块透明区域默认**什么都点得到**，那就把桌面挡住了。
        //    ⇒ 光标离宠物远的时候让**整窗穿透**（鼠标事件直接落到下面的桌面/窗口）。
        //    ⚠️ 半径给 300 > 轮盘最外圈（L 档 ≈ 241），否则最外圈那几个扇区点不动。
        //    ⚠️ 菜单栏那个"点击穿透"开关是**手动**的，优先级更高，别被这里覆盖掉。
        if !petThroughManual {
            let pcx = Double(w.frame.width - kPetRight - 52)
            let pcy = Double(kPetBottom + 45)
            let near = hypot(x - pcx, y - pcy) < 300
            let accept = near || petWheelOpen || petPanelOpen
            if w.ignoresMouseEvents == accept { w.ignoresMouseEvents = !accept }
        
            // ⭐⭐⭐ 提前占住键盘（2026-10-11 实测出来的那条缝）：
            //    轮盘在 96px 处展开，而 NSApp.activate 要 200~300ms 才生效。
            //    读者"看到展开了就敲" ⇒ 那一下按下去时我们**还不是活动的 App** ⇒
            //    按键根本进不了我们（走去原来那个 App 了），页面和原生监视器都收不到。
            //    ⇒ 光标进到 260px 就先把焦点占上，等真展开时键盘已经在我们手里。
            //    ⚠️ 走出这个圈、而且轮盘没开 ⇒ 把焦点还回去（别一直占着别人的键盘）。
            let arm = hypot(x - pcx, y - pcy) < 260
            if arm != petArmed {
                petArmed = arm
                if arm { takeFocusForPet() }
                else if !petWheelOpen { releasePetFocus(picked: false) }
            }
        }
        petWeb?.evaluateJavaScript("window.__petMouse && window.__petMouse(\(x), \(y))")
    }
    /// 旧接口留着（`dragstart` 那一条还在）：松手后强制重算一次
    private func petHoverCheck(_ loc: NSPoint) { feedPetMouse() }

    // ── 全局快捷键：⌥⌘C / ⌥⌘4 ────────────────────────────────
    //
    // 读者 2026-10-10：「**做不到 C 和 4 的组合快捷键打开半扇形**，
    // 然后按住 c 就能打开 chrome 类似这种做法」。
    //
    // ⚠️ 为什么必须由原生注册：网页拿不到"别的 App 正在前台时"的按键。
    // ⚠️ 为什么用 Carbon 而不是 NSEvent 全局监视：后者要**辅助功能授权**，
    //    没授权时**一声不响**什么都不发生。
    // ⚠️ 而且**敲字母还要有键盘焦点**：`.nonactivatingPanel` 拿不到键盘
    //    （macOS 的按键是发给**当前活动的 App** 的）⇒ 这里必须真的
    //    `NSApp.activate`，同时**记住原来那个前台 App**，收起时还回去。
    private var prevFrontApp: NSRunningApplication?
    private var petTookFocus = false

    private func installHotKeys() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { (_, _, _) -> OSStatus in
            DispatchQueue.main.async { (NSApp.delegate as? AppDelegate)?.openPetByHotKey() }
            return noErr
        }, 1, &spec, nil, nil)

        // 读者要的是「C 和 4 的组合」⇒ **⌥⌘C 和 ⌥⌘4 两个都注册**（两种读法都照顾到）。
        // 换键只改这一行；名字和 id 只是给日志看的。
        let defs: [(Int, UInt32, String)] = [
            (kVK_ANSI_C, UInt32(optionKey | cmdKey), "⌥⌘C"),
            (kVK_ANSI_4, UInt32(optionKey | cmdKey), "⌥⌘4"),
        ]
        for (i, d) in defs.enumerated() {
            var ref: EventHotKeyRef?
            let hk = EventHotKeyID(signature: kHotKeySig, id: UInt32(i + 1))
            let st = RegisterEventHotKey(UInt32(d.0), d.1, hk, GetApplicationEventTarget(), 0, &ref)
            // ⚠️ 注册失败**必须说出来**：被别的 App 占了就是"按了没反应"，
            //    而"被占用"和"没做这个功能"在屏幕上一样。
            if st == noErr, let ref { gHotKeyRefs.append(ref); petLog("热键 \(d.2) 注册好了") }
            else { petLog("热键 \(d.2) 注册失败（st=\(st)，多半被别的 App 占了）") }
        }
    }

    @objc func openPetByHotKey() {
        if petWindow?.isVisible != true { togglePet() }
        takeFocusForPet()
        petWeb?.evaluateJavaScript("window.__petOpen && window.__petOpen()")
        petLog("hotkey 打开轮盘")
    }

    /// 抢键盘焦点（**先记住原来那个前台 App**，收起时好还回去）
    ///
    /// ⚠️⚠️⚠️ 2026-10-11 **改正我自己上一版的一个错误结论**：
    ///    上一版写的是"只 `makeKey` 就够，别 `NSApp.activate`"—— **那是错的**。
    ///    当时我是拿**合成按键**（`osascript ... keystroke`）验的，它走的是
    ///    System Events 那条路，**直接投给目标**；而**真键盘发给的是"当前活动的 App"**。
    ///    两件事在这里恰好都成功了 ⇒ 我以为"面板是 key 就行"。
    ///    读者的真键盘立刻拆穿了：悬停展开之后敲 C **什么都不发生**。
    ///    ⇒ 要让真键盘进得来，**必须真的 `NSApp.activate`**（点一下能用的原因也是这个）。
    ///
    /// ⚠️ 代价说清楚：鼠标**停在**宠物上时，你正在别的软件里打字会被这个轮盘接走。
    ///    所以配了两条：
    ///      ① 悬停那条路**延迟 350ms** 才抢（鼠标只是路过不会触发，`scheduleTakeFocus`）；
    ///      ② 收起时把焦点**还回**给原来那个 App（`releasePetFocus`；刚切过软件就不还）。
    private func takeFocusForPet() {
        if !petTookFocus {
            let f = NSWorkspace.shared.frontmostApplication
            // ⚠️ 别把"我们自己"记成要还回去的那个 App（不然收起时会原地激活自己）
            if f?.bundleIdentifier != Bundle.main.bundleIdentifier { prevFrontApp = f }
        }
        petTookFocus = true
        NSApp.activate(ignoringOtherApps: true)
        petWindow?.makeKeyAndOrderFront(nil)
        // ⚠️ 探针：把**现在谁在最前面**也记下来 —— 只记 `isActive` 会被
        //    "我们本来就是最前面"这种情况骗过去（上一版就是这么被骗的）。
        // ⚠️⚠️⚠️ 2026-10-11 **第二次修正**：光"App 活动 + 窗口 key"**还不够** ——
        //    真键盘的按键要落到 **first responder** 上。读者「点一下就能用」，
        //    点那一下干的事里就包括"把 WKWebView 变成 first responder"。
        //    ⇒ 这里显式指定，不能只靠 makeKeyAndOrderFront。
        petWindow?.makeFirstResponder(petWeb)
        reportPetFocusState()
        // ⚠️ 应答器是异步落定的，0.25 秒后再钉一次并重报状态
        // ⚠️⚠️ `NSApp.activate` 是**异步**的（实测 200~300ms 才真的生效）。
        //    而读者是"看到轮盘展开了就敲"—— 正好落在这段缝里，那一下按键**进不了我们**
        //    （走去原来那个 App 了），页面和原生监视器都收不到。
        //    ⇒ 补抢几次把它焊死；再配合 `feedPetMouse` 里"光标进 260px 就提前占"。
        for delay in [0.25, 0.7, 1.2] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self, self.petWindow?.isVisible == true, self.petWheelOpen else { return }
                if !NSApp.isActive { NSApp.activate(ignoringOtherApps: true) }
                self.petWindow?.makeKeyAndOrderFront(nil)
                self.petWindow?.makeFirstResponder(self.petWeb)
                self.reportPetFocusState()
            }
        }
    }

    /// 把"键盘到底通没通"**推给网页显示出来**（不再只写日志）。
    /// ⚠️ 判据是三件事同时成立：App 活动 / 窗口是 key / **网页是 first responder**。
    ///    少任何一件，按键都到不了 `keydown` —— 而"按了没反应"必须先能分清是哪一种。
    private func reportPetFocusState() {
        let key = petWindow?.isKeyWindow ?? false
        // ⚠️ `WKWebView` 没有 `isFirstResponder`（Swift 里没这个属性）—— 比 `firstResponder` 才行
        let resp = (petWindow?.firstResponder === petWeb)
        petLog("focusState key=\(key) responder=\(resp) active=\(NSApp.isActive)")
        petWeb?.evaluateJavaScript("window.__petFocus && window.__petFocus(\(key && resp), document.hasFocus())")
    }

    /// 收起时**一定要把焦点还回去**，否则用户会以为"键盘坏了"
    /// （他只是在别处打字，而我们的面板还在最前面接着按键）。
    @objc private func releasePetFocus(picked: Bool) {
        petFocusTimer?.invalidate()
        defer { petTookFocus = false; prevFrontApp = nil }
        guard petTookFocus, !picked, let a = prevFrontApp, !a.isTerminated else { return }
        a.activate(options: [.activateIgnoringOtherApps])
        petLog("focus 还给 \(a.bundleIdentifier ?? "?")")
    }

    /// ⭐⭐ **飞速打开**（读者：「打开软件的速度**太慢太慢**，加速，要飞速打开」）。
    ///
    /// ⚠️ 慢在哪：HTTP 那条路上是 `plutil` 读 bundleId → `osascript ... activate` → `open -a`，
    ///    **三个进程串起来**，每个几十~几百毫秒。而 `NSWorkspace` 是**进程内**的，
    ///    几毫秒就回来了 —— 差别就是"点了要等一下"和"点了立刻切走"。
    /// ⚠️ 已经在跑的直接 `activate`（不起新实例、也不重新加载）；没在跑的才 `openApplication`。
    /// ⚠️ 记账（activity）**不能挡在中间** —— 所以它单独发一条 HTTP，**不等它**。
    /// ⭐⭐⭐ **让位**：把宠物窗口从屏幕上撤下、把自己取消激活，0.55 秒后**无声**放回来。
    /// ⚠️ 为什么非要有这一步：**我们占着"活动 App"的时候，谁都不许把别的 App 叫到前面**
    ///   —— in-process 的 `activate`、`osascript`、`open -a` 三条路都试过，一条都不生效。
    /// ⚠️ 放回**必须用 `order(.above, relativeTo: 0)`**，不能用 `orderFrontRegardless()`
    ///   —— 后者会把前台又抢回来，目标刚上来就被顶下去。
    private func yieldPetActivation() {
        let wasVisible = petWindow?.isVisible ?? false
        if wasVisible { petWindow?.orderOut(nil) }
        NSApp.deactivate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.55) { [weak self] in
            guard let self else { return }
            if wasVisible { self.petWindow?.order(.above, relativeTo: 0) }
            self.refreshPetItem()
        }
    }

    private func launchFast(_ path: String) {
        guard path.hasSuffix(".app") else { return }
        recordAppUse(path)
        let t0 = Date()
        // ⚠️⚠️⚠️ **2026-10-11 的真凶（第二条）**：
        //    实测 —— 只要**我们还占着前台**，`activate(from:options:)` / `osascript ... activate` /
        //    `open -a` **三条路一条都叫不动别人**（三种都试过，`lsappinfo front` 全是我们自己）。
        //    macOS 从 Sonoma 起不允许 App 互相抢前台，而"当前活动 App 让渡"这件事，
        //    `yieldActivation(to:)` **不够** —— 得**真的先不活动**。
        //    ⇒ 顺序必须是：**先把自己撤下来 → 再叫目标 App → 再无声地把宠物放回来**。
        let petWasVisible = petWindow?.isVisible ?? false
        // ⚠️⚠️ 读者 2026-10-13：「**不想让 Pet 一点击软件的时候就闪一下**，
        //    应该点击 app 就只有一圈 app 不显示，而 Pet 依旧在」。
        //    原来这里**一上来就 `orderOut`**（把宠物从屏幕上撤走）再去 activate，
        //    1.2 秒后才放回来 ⇒ 眼睛看到的就是"Pet 闪掉了一下"。
        //    ⇒ 正常路径**不再撤窗**：让出前台的关键那一步是 `NSApp.deactivate()`，
        //      窗口留不留在屏幕上跟"能不能激活别人"是两件事。
        //      万一没叫上来（下面 probe 探得到），才退回"把自己撤走"那套。
        NSApp.deactivate()

        let bid = Bundle(path: path)?.bundleIdentifier ?? ""
        let running = bid.isEmpty ? nil : NSRunningApplication.runningApplications(withBundleIdentifier: bid).first
        let restore = { [weak self] in
            guard let self else { return }
            // ⚠️⚠️ **不能用 `orderFrontRegardless()`** —— 实测它**会把前台又抢回来**：
            //    目标 App 刚上来 1 秒就被我们顶下去，而用户这时候正好在它里面打字。
            //    `order(.above, relativeTo: 0)` 才是"放回屏幕、但不激活"的那一个。
            if petWasVisible { self.petWindow?.order(.above, relativeTo: 0) }
            self.refreshPetItem()
        }

        if let running {
            var ok = false
            if #available(macOS 14.0, *) {
                NSApp.yieldActivation(to: running)
                // ⚠️⚠️ `.activateAllWindows` 不能省：光 `activate` 只把**应用**带到前台，
                //    而这个 App 的窗口可能被压在后面 / 在别的空间 ⇒ `ok=true`、
                //    `frontmostApplication` 也确实是它，**但窗口不上来**。
                //    读者 2026-10-13 专门点了名：「点击 deepseek chat native 还是跳不到前面来」。
                ok = running.activate(from: .current, options: [.activateAllWindows])
            // ⚠️⚠️ 光 activate **不够**：它只把「应用」带到前台。目标 App 的窗口
            //    被最小化 / 只有一个隐藏窗口时，窗口根本不上来 —— 而 `ok=true`、
            //    `frontmostApplication` 确实是它，日志里一切正常。
            //    `NSWorkspace.openApplication` 对**已经在跑**的 App 发的是
            //    `kAEReopenApplication` ⇒ 那正是"把主窗口弄回来"的那条路
            //    （点 Dock 图标走的就是它）。读者点名的 `Deepseek Chat Natvie` 正是这种。
            if let u = Bundle(path: path)?.bundleURL {
                let ro = NSWorkspace.OpenConfiguration()
                ro.activates = true
                NSWorkspace.shared.openApplication(at: u, configuration: ro) { _, _ in }
            }
            } else {
                ok = running.activate(options: [.activateIgnoringOtherApps])
            }
            petLog("launch \(path.split(separator: "/").last ?? "") activate ok=\(ok) \(Int(Date().timeIntervalSince(t0) * 1000))ms")
            // 探针：**放回宠物之前**先看谁在前台（分开"没叫上来"和"被我抢回来"）
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.30) {
                petLog("probe0.30 front=\(NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "?")")
            }
            let petWin = petWindow
            // ⚠️ 自适应：0.30s 后看一眼有没有把目标叫上来。
            //    叫上来了 ⇒ 直接把宠物放回去（**全程没撤过窗，不会闪**）；
            //    没叫上来 ⇒ 才退回"把自己撤走再叫一次"那套（会有一下闪，但总比不动好）。
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.30) {
                let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "?"
                petLog("probe0.30 front=\(front)")
                if front != bid, let petWin, petWasVisible {
                    petLog("目标没到前台 ⇒ 退回「让位」那套")
                    petWin.orderOut(nil)
                    running.activate(from: .current, options: [.activateAllWindows])
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { restore() }
                } else {
                    restore()
                }
            }
            return
        }
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = true
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: path), configuration: cfg) { _, err in
            if let err { petLog("launch 失败：\(err.localizedDescription)") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.55) { restore() }
        }
    }

    /// 只记账、**不启动**（启动已经由 `launchFast` 做完了，再走一遍 `/api/apps/activate`
    /// 会把那个软件开两次 / 或者多绕一圈）
    private func recordAppUse(_ path: String) {
        guard let url = URL(string: "\(kBase)/api/apps/used") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 8
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["path": path])
        URLSession.shared.dataTask(with: req).resume()
    }

    /// 收起时把焦点还给原来那个 App。
    /// ⚠️ **刚切走一个软件的时候不能还** —— 那会把用户刚点开的那个 App 又踢下去。
    /// ⚠️ 而且**一定要还**：不还的话用户会以为"键盘坏了"（他只是在别处打字，
    ///    而我们的面板还在最前面接着按键）。

    /// ⭐ 点击穿透：打开之后 Pet 就**收不到任何鼠标事件**，点击直接落到桌面/下面的窗口上。
    /// ⚠️ 代价说清楚：开着的期间**它自己也点不动**（那一圈也不会出来），
    ///    要关只能从**菜单栏**关（所以上面那条菜单项不是可有可无的）。
    @objc private func togglePetThrough() {
        guard let w = petWindow else { return }
        // ⚠️ 手动打开 ⇒ **一直**穿透（连光标挪到它身上也不响应）；关掉 ⇒ 交回自动那条。
        petThroughManual.toggle()
        w.ignoresMouseEvents = petThroughManual
        refreshPetItem()
    }

    @objc private func openUI() {
        if window == nil {
            let w = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 1320, height: 900),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered, defer: false)
            w.title = "cevtuo-c4emem"
            // ⚠️⚠️ 读者 2026-10-13：「这个软件的**最上边不应该是黑色的一条**」。
            //    界面自己**永远是浅色**（app.css 的 `--bg:#f7f7f4`，而且那里**没有**
            //    `prefers-color-scheme` 分支），而读者的 Mac 是深色模式 ⇒ 系统给窗口
            //    画的标题条是**黑的**，顶上就横着一条黑。
            //    ⇒ 把窗口外观钉死成浅色（和页面同一条路），别再跟系统走。
            w.appearance = NSAppearance(named: .aqua)
            // ⚠️ 页面底色是 #f7f7f4：给它同一个底色，加载那一秒就不是"刺眼的白"，
            //    看起来像"正在铺纸"，而不是"坏了"。
            w.backgroundColor = NSColor(calibratedRed: 0xf7/255.0, green: 0xf7/255.0, blue: 0xf4/255.0, alpha: 1)
            w.center()
            w.minSize = NSSize(width: 900, height: 600)
            // ⚠️ 主窗口这一份也要挂桥：界面里那个"窗口内浮层"版 Pet 右键时要能叫 Swift
            //    打开设置抽屉（`{cmd:'settings'}`）。两边用**同一个** handler 名字 `c4`。
            let cfg = WKWebViewConfiguration()
            cfg.userContentController.add(self, name: "c4")
            let wv = WKWebView(frame: w.contentView?.bounds ?? .zero, configuration: cfg)
            wv.autoresizingMask = [.width, .height]
            wv.navigationDelegate = self
            w.contentView = wv
            window = w
            webView = wv
        }
        // ⚠️⚠️ 上一版**每次**都 `load()` —— 于是 Pet 右键发 `show`/`settings` 进来时，
        //    窗口先被**整页重载**（SPA 要几秒），紧接着那句 `evaluateJavaScript` 打在
        //    一个还在加载的页面上 ⇒ 静默失败。**"重新打开"和"重新加载"被他俩混成了一句。**
        //    ⇒ 只在**还没加载过**的时候 load；要重载走菜单里那条（`uiLoaded` 由它清）。
        if !uiLoaded { loadUI() }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
    private var uiLoaded = false

    /// ⚠️⚠️⚠️ 读者 2026-10-13：「打开之后软件**全白**…很久很久都是全白屏，**一秒都不能有**」。
    ///
    /// 真因（两个叠在一起，一个把另一个锁死了）：
    ///   ① `startServerIfNeeded()` 是**异步**的 —— 要起核心、核心还要读一遍 891 段知识库；
    ///      而 `loadUI()` **立刻**就去加载 `http://127.0.0.1:8770/`。那一刻端口还没人听，
    ///      WKWebView 拿到的是"连接被拒" ⇒ **一片白**。
    ///   ② 更糟的是 `uiLoaded = true` 写在 `load()` **之前** ⇒ `openUI` 里那句
    ///      `if !uiLoaded { loadUI() }` 从此永远为假 ⇒ **再也不会重试**，白屏就一直白着。
    ///
    /// ⇒ 三件事，缺一条都还是白：
    ///   ① 窗口一建出来先把**一段内联的"启动中"页**塞进去（同步的，永远不可能是白的）；
    ///   ② **等核心真的应答了**再加载真界面（后台轮询 + 超时）；
    ///   ③ 超时就**说出来**（把日志路径写在页面上），而不是留一块白让人猜。
    private func loadUI() {
        guard webView != nil else { return }
        uiLoaded = true
        webView?.loadHTMLString(Self.bootHTML("正在启动核心…",
                                             "第一次启动要把知识库读一遍，会慢几秒。这个窗口不会白屏。"),
                                baseURL: nil)
        petLog("界面：先铺启动页，等核心就绪")
        waitForCoreThenLoad(deadline: Date().addingTimeInterval(90))
    }

    /// 后台轮询"核心起来没有"，起来了才把真界面 load 进去。
    /// ⚠️ 跑在后台队列上：`ping()` 是**阻塞**的（信号量，最多 2.5s），放主线程会把刚铺好的启动页卡住。
    private func waitForCoreThenLoad(deadline: Date) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let t0 = Date()
            while Date() < deadline {
                if self.ping() {
                    let ms = Int(Date().timeIntervalSince(t0) * 1000)
                    petLog("核心就绪（等了 \(ms)ms），加载界面")
                    DispatchQueue.main.async { self.webView?.load(URLRequest(url: URL(string: kBase)!)) }
                    return
                }
                Thread.sleep(forTimeInterval: 0.25)
            }
            petLog("等核心超时（90s）—— 把原因写在界面上，不留白")
            DispatchQueue.main.async {
                self.webView?.loadHTMLString(
                    Self.bootHTML("核心没起来",
                                  "看日志：~/Documents/Cevtuo-C4emem/pet-bridge.log —— 里面会写用哪个核心、有没有报错。"),
                    baseURL: nil)
            }
        }
    }

    /// 启动/出错时铺的那张纸。⚠️ 底色和页面同一张纸色（`#f7f7f4`），
    ///   这样"启动中"和"加载完"之间**不闪**，也不会有刺眼的白。
    private static func bootHTML(_ title: String, _ sub: String) -> String {
        """
        <!doctype html><html><head><meta charset="utf-8"><style>
          html,body{margin:0;height:100%;background:#f7f7f4;color:#22252c;
            font:14px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
            display:flex;align-items:center;justify-content:center}
          .b{text-align:center;max-width:520px;padding:0 24px}
          .t{font-size:15px;font-weight:650;letter-spacing:.01em}
          .s{margin-top:10px;font-size:12.5px;color:#8a8d96}
          .d{margin:18px auto 0;width:26px;height:26px;border-radius:50%;
            border:2px solid #dcdcd4;border-top-color:#8a8d96;animation:r .9s linear infinite}
          @keyframes r{to{transform:rotate(360deg)}}
        </style></head><body><div class="b">
          <div class="t">\(title)</div><div class="s">\(sub)</div>
          <div class="d"></div>
        </div></body></html>
        """
    }
    /// 菜单里那条「重新载入界面」—— 上面那句"只加载一次"必须留一个出口，
    /// 否则页面卡住就只能退 App（而"卡住"和"坏了"看起来一样）。
    @objc private func reloadUI() {
        if webView == nil { openUI(); return }
        loadUI()
        window?.makeKeyAndOrderFront(nil)
    }

    @objc private func resync() {
        guard let url = URL(string: "\(kBase)/api/sync") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = "{}".data(using: .utf8)
        URLSession.shared.dataTask(with: req) { _, _, _ in }.resume()
        alert("已开始同步 Notion。全量要 10 分钟以上，跑完在界面里刷新看数字。")
    }

    @objc private func openProactive() {
        openUI()
        // 让界面切到主动式那一页
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            self.webView?.evaluateJavaScript("window.__app && window.__app.show('proactive')")
        }
    }

    @objc private func openDataDir() {
        let p = ("~/.c4emem" as NSString).expandingTildeInPath
        NSWorkspace.shared.open(URL(fileURLWithPath: p))
    }

    @objc private func openProject() {
        NSWorkspace.shared.open(URL(fileURLWithPath: kProjectDir))
    }

    private func alert(_ text: String) {
        DispatchQueue.main.async {
            let a = NSAlert()
            a.messageText = "cevtuo-c4emem"
            a.informativeText = text
            a.runModal()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// ⚠️⚠️⚠️ 就是这一行把 Dock 图标又关掉的 —— **Info.plist 里的 `LSUIElement=false` 被它覆盖了**。
        //    只改 plist 是没用的（我上一版就是这么改的，实测 `lsappinfo` 里
        //    `type` 还是 `UIElement`）。读者 2026-10-13：「点击这个软件，
        //    **没有 logo 在我的 dock 栏里展示**」。
        //    ⇒ 改成 `.regular`：Dock 里有它、应用切换器里有它；
        //      点 Dock 图标走的是 `reopen` ⇒ 直接把主界面叫出来（`applicationShouldHandleReopen`）。
        app.setActivationPolicy(.regular) // Dock + 菜单栏都占（读者要求能在 Dock 里看见）
app.run()
