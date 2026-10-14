/**
 * CEVTUO-PET —— **独立的桌面宠物 App**。
 *
 * 读者 2026-10-13：
 *   「cevtuopet **单独打包制作一个 macos 软件**，logo 就用那个铅，单独一个分发，
 *     在 apps.cevtuogrnd.com/cevtuopet
 *     能够有一个**设置页面**，能够单独的切换功能，**多APP（包含右键完整功能）、单个app**，
 *     以及**输入 api**，它能**沟通连续对话 prompt 帮忙处理工作**，
 *     它在**导航栏是否常驻或者 dock 栏是否常驻有设置，至少有一个是开**」
 *
 * ⭐ 它和 `cevtuo-c4emem` **共用同一个核心**（也就是同一个「对话 → 真的做出来」的引擎）——
 *    读者原话：「你看我想让你做的 cevtuopet app 以及现在的 c4emem app **都是这个路子**」。
 *    ⇒ 不要另写一套。**同一个 `~/.c4emem`，同一个 c4core，只换外壳和界面。**
 *    ⚠️ 两个 App 会同时跑 ⇒ 核心只能有一个（先探 8770，活着就复用）。
 *       各起一个的话是**两个写入方抢同一个库**（这个项目栽过，见 FACT）。
 *
 * ⚠️⚠️ 这个文件里那些「为什么」的注释**大部分是从 C4ememApp.swift 搬过来的**，
 *    每一条都对应一个真实出现过的故障（悬停不出来 / 要点两次 / 桌面上多一块白板…）。
 *    **搬的时候不要把注释删掉** —— 删了就等于把这些坑重新埋回去。
 */
import Cocoa
import UniformTypeIdentifiers
import WebKit
import Carbon

// ── 常量 ─────────────────────────────────────────────────────
/// 优先复用的那个（c4emem 也在用）
private let kPort = 8770
/// ⚠️ **备用端口**：已经在跑的那个核心**没有我要的页面**时，自己起一个在这。
///    为什么不是"直接杀掉重起"：那会把用户正在用的 c4emem 一起弄断。
private var port = kPort
/// ⚠️ 备用端口：8770 被"没有我这一版文件"的核心占着时用
private let kPortBackup = 8775
private var kBase: String { "http://127.0.0.1:\(port)" }
private let kName = "cevtuo-pet"
/// Pet 空闲时那块小窗；展开轮盘时会临时长大
private let kPetIdle = NSSize(width: 440, height: 520)
private let kPetRing = NSSize(width: 560, height: 600)
private let kPetRight: CGFloat = 26
private let kPetBottom: CGFloat = 96

private let kDockOnKey = "pet.dockOn"
private let kMenuOnKey = "pet.menuBarOn"
private let kPetOnKey = "pet.shown"
private let kPetXKey = "pet.originX"
private let kPetYKey = "pet.originY"

/**
 * ⚠️ 桥这一层**出问题是全静默的**（消息没到 = 什么都没发生、控制台一个字都没有）。
 *    所以往一个固定文件里记一行 —— 排查"拖不动 / 展不开 / 点不动"时先看它。
 */
func petLog(_ s: String) {
    let line = "\(Date().timeIntervalSince1970) \(s)\n"
    let dir = NSHomeDirectory() + "/.c4emem"
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let p = dir + "/pet.log"
    if let h = FileHandle(forWritingAtPath: p) {
        h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close()
    } else {
        try? line.write(toFile: p, atomically: true, encoding: .utf8)
    }
}

/**
 * Pet 那个窗。
 *
 * ⚠️⚠️ 读者当年报的两句是**同一个根因**：
 *   「必须焦点在这个 pet 上时候它才能」「鼠标移过去还是跳」
 *   ⇒ 裸 `NSWindow` + `.borderless` 的 **`canBecomeKey` 默认是 false**，
 *     而 `mouseMoved`（悬停）**只有 key 窗口才拿得到**
 *     ⇒ 必须先在它上面点一下，那一圈才肯出来。
 *   ⇒ 换成 `NSPanel`：覆写 `canBecomeKey = true`（收键盘/悬停）、`canBecomeMain = false`（不抢主窗），
 *     配 `.nonactivatingPanel`（点它不把整个 App 激活）、`acceptsMouseMovedEvents`、
 *     `hidesOnDeactivate = false`（否则切走它就躲起来，"留在桌面上"这个卖点就没了）。
 */
final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/**
 * ⚠️⚠️ **第一次点击必须算数。** AppKit 的老规矩：窗口不是 key 时，
 *    第一次按下只用来"激活窗口"，除非 view 的 `acceptsFirstMouse` 回 true。
 *    我们的面板是 `.nonactivatingPanel`（刻意不抢焦点）⇒ 第一次按被吞掉 ⇒
 *    表现是"要点两次"；拖拽更惨：按下被吞 ⇒ `pointerdown` 从来没发生 ⇒ 一条 drag 都不发。
 */
final class PetWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    // ── 菜单栏 + 窗口 ──
    private var statusItem: NSStatusItem?
    private var petWindow: NSWindow?
    private var petWeb: WKWebView?
    private var settingsWindow: NSWindow?
    private var server: Process?
    private var ownServer = false
    /// ⚠️ **核心真的就绪了**才允许 load —— 不然第一次 load 会抢在核心前面，
    ///    撞出一个「打不开界面」的错误页（一闪而过，但看起来像坏了）。
    private var coreReady = false

    // ── Pet 的运行时状态 ──
    private var petWheelOpen = false
    private var petPanelOpen = false
    private var petDragging = false
    private var petThroughManual = false
    private var petArmed = false
    private var petMouseTimer: Timer?
    private var petKeyMon: Any?
    private var prevFrontApp: NSRunningApplication?
    private var petTookFocus = false

    // ═══════════════════════════════════════════════════════════
    //  启动
    // ═══════════════════════════════════════════════════════════
    func applicationDidFinishLaunching(_ note: Notification) {
        // ⚠️ **先按偏好定"进不进 Dock"**，再去建窗口 ——
        //    顺序反了的话，Dock 图标会在启动时闪一下（切策略是有动画的）。
        //    ⭐ 读者要求：「导航栏是否常驻或者 dock 栏是否常驻**有设置，至少有一个是开**」。
        applyActivationPolicy()

        buildMenu()

        // ⚠️⚠️ 核心这条线**必须是一条**：「探活 → 定端口 → 起核心 → 等就绪 → 装页面」。
        //    我第一版把它拆成两条并发的（`startServerIfNeeded` + `waitForCoreThenOpenPet`），
        //    于是"端口"这个**两边都要读、其中一边才写**的变量出现了竞态：
        //    探活那条已经决定改用 8775 了，装页面那条还盯着 8770 ⇒ 打开的是别人的页（或 404）。
        //    ⇒ 一条队列走到底，端口定了再往下。
        bootCore()

        // ⚠️ **先铺一张"正在启动"的页**，别让窗口先白着。
        //    （这个项目栽过：loadUI 先设了 uiLoaded 标志再 load，失败之后就再也不重试 ⇒ 一直白。）
        if UserDefaults.standard.object(forKey: kPetOnKey) == nil {
            UserDefaults.standard.set(true, forKey: kPetOnKey)   // 第一次默认显示
        }
        if UserDefaults.standard.bool(forKey: kPetOnKey) { showPet() }
    }

    /// ⭐ 「至少有一个是开」—— 两个都关的话**强制把菜单栏打开**，并把这件事说出来。
    private func applyActivationPolicy() {
        let dock = UserDefaults.standard.bool(forKey: kDockOnKey)
        var menu = UserDefaults.standard.object(forKey: kMenuOnKey) == nil
            ? true : UserDefaults.standard.bool(forKey: kMenuOnKey)
        if !dock && !menu {
            // ⚠️ 静默改回 true 是不行的 —— 用户会以为开关坏了。
            //    记一行日志 + 下次开设置页时界面自己会说（见 petsettings.js）。
            menu = true
            UserDefaults.standard.set(true, forKey: kMenuOnKey)
            petLog("⚠️ Dock 和菜单栏都关 ⇒ 强制把菜单栏打开（不然这个 App 没有办法操作）")
        }
        // ⚠️ `Info.plist` 里的 `LSUIElement` **会被运行时代码覆盖** ——
        //    改 plist 是没用的（照抄别人的配置很容易踩这个）。
        //    判据是 `lsappinfo list` 里那个 `type=`：`Foreground` 才有 Dock 图标。
        NSApp.setActivationPolicy(dock ? .regular : .accessory)
        petLog("激活策略：\(dock ? "regular(有 Dock)" : "accessory(只有菜单栏)") 菜单栏=\(menu)")
    }

    // ═══════════════════════════════════════════════════════════
    //  核心：探活 / 起一个 / 等就绪
    // ═══════════════════════════════════════════════════════════
    private func ping(_ p: Int? = nil) -> Bool { ok200("http://127.0.0.1:\(p ?? port)/api/stats") }

    private func ok200(_ u: String) -> Bool {
        guard let url = URL(string: u) else { return false }
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

    /**
     * ⚠️⚠️ **光"核心活着"是不够的 —— 得问它"你有没有我要的那一页"。**
     *
     * 真事：c4emem 和 pet 共用同一个核心，而 8770 上那个是从 **c4emem 的包**里起的。
     * `petsettings.html` 是后加的 ⇒ 那个包的服务快照里**没有它** ⇒
     * 设置窗打开是 **404**，而且**看起来就像"设置页坏了"**。
     * ⇒ 判据要打在**真正要用的那个资源**上，不是"端口通不通"。
     *    （同一个家族：代理那条路要单独测、装了不等于能搜得到。）
     */
    private func coreHasPetUI() -> Bool { ok200(kBase + "/ui/petsettings.html") }

    /**
     * ⭐ **一条线**：探活 → 定端口 → 起核心 → 等就绪 → 告诉主线程可以装页面了。
     *
     * ⚠️ 为什么不能拆成两条并发：`port` 是**两边都要读、其中一边才写**的变量。
     *    拆开之后，"探活那条已经决定改用 8775、装页面那条还盯着 8770"这种竞态
     *    **必然会发生**（它不报错，只是打开别人的页 / 404）。
     */
    private func bootCore() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            // ① 8770 上有核心吗？
            let has = self.ping(kPort)
            if has {
                if self.ok200("http://127.0.0.1:\(kPort)/ui/petsettings.html") {
                    port = kPort
                    petLog("核心已在跑，而且有我要的页面（复用 \(kPort)）")
                } else {
                    // ⚠️ 活着但**没有我这一版的服务端文件**（多半是 c4emem 的旧包）。
                    //    不去抢它的端口（那是用户正在用的 c4emem），自己起一个在 8775。
                    //    两个核心写同一个 SQLite（WAL 支持并发），
                    //    比"把用户正在用的那个打断"划算得多。
                    petLog("⚠️ \(kPort) 上那个核心没有 /ui/petsettings.html —— 自己起一个在 \(kPortBackup)")
                    port = kPortBackup
                    self.spawnCore()
                }
            } else {
                port = kPort
                self.spawnCore()
            }
            // ② 等它就绪（**等条件，不要等秒数** —— 固定 sleep 之后失败的话，
            //    "没等够"和"功能坏了"在日志里长得一模一样）
            let deadline = Date().addingTimeInterval(60)
            while Date() < deadline {
                if self.ping() {
                    DispatchQueue.main.async { self.coreReady = true; self.loadPet() }
                    return
                }
                Thread.sleep(forTimeInterval: 0.4)
            }
            DispatchQueue.main.async { self.showBoot("核心没起来", "看 ~/.c4emem/core.log") }
        }
    }

    /// 起**自己**的核心。⚠️ 端口被占时要能看出来 —— 否则就是"起了个进程、什么都没发生"。
    private func spawnCore() {
        let p = Process()
        let res = Bundle.main.resourceURL
        guard let bundled = res?.appendingPathComponent("c4core"),
              FileManager.default.fileExists(atPath: bundled.path) else {
            petLog("⚠️ 包里没有 c4core —— 只能用已经在跑的那个")
            return
        }
        p.executableURL = bundled
        // ⚠️ 工作目录必须是 `Resources/app`：核心是**运行时读盘**找 `src/ui/*` 的
        //    （`process.cwd()`），目录不对就是"起来了但一片白"。
        if let appDir = res?.appendingPathComponent("app") { p.currentDirectoryURL = appDir }
        var env = ProcessInfo.processInfo.environment
        env["C4EMEM_PORT"] = String(port)          // ⚠️ 不传这个它就去抢 8770
        let userCfg = NSHomeDirectory() + "/.c4emem/c4emem.config.json"
        let tpl = res?.appendingPathComponent("app/c4emem.config.json")
        env["C4EMEM_CONFIG"] = FileManager.default.fileExists(atPath: userCfg) ? userCfg : (tpl?.path ?? "")
        // ⚠️⚠️⚠️ 凭据：配置里 `llm.apiKeyEnv = C4EMEM_LLM_API_KEY`，密钥**只能从环境变量来**。
        //    而 GUI App 起的子进程**继承不到 shell 的环境** ⇒ 不灌这一份的话 `hasLlm=false`，
        //    一切要用模型的功能全挂，而界面上看不出原因（就是"点了一下什么都没有"）。
        let userEnvFile = NSHomeDirectory() + "/.c4emem/.env"
        if let txt = try? String(contentsOfFile: userEnvFile, encoding: .utf8) {
            var n = 0
            for line in txt.split(separator: "\n") {
                let t = line.trimmingCharacters(in: .whitespaces)
                guard !t.isEmpty, !t.hasPrefix("#"), let eq = t.firstIndex(of: "=") else { continue }
                let k = String(t[t.startIndex..<eq]).trimmingCharacters(in: .whitespaces)
                var v = String(t[t.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
                if v.hasPrefix("\"") && v.hasSuffix("\"") && v.count >= 2 { v = String(v.dropFirst().dropLast()) }
                if !k.isEmpty { env[k] = v; n += 1 }
            }
            petLog("凭据：从 \(userEnvFile) 灌了 \(n) 条环境变量")
        } else {
            petLog("⚠️ 没有 \(userEnvFile) —— 没有 key 时模型功能会失败（界面看起来就是「点了一下没反应」）")
        }
        p.environment = env
        // ⚠️ 核心的输出**不要丢进 /dev/null** —— 丢了的后果是
        //    "核心起来了却没在听端口"这种故障**一个字都看不到**，只能靠猜。
        let home = NSHomeDirectory() + "/.c4emem"
        try? FileManager.default.createDirectory(atPath: home, withIntermediateDirectories: true)
        let coreLog = home + "/core.log"
        if !FileManager.default.fileExists(atPath: coreLog) {
            FileManager.default.createFile(atPath: coreLog, contents: nil)
        }
        if let fh = FileHandle(forWritingAtPath: coreLog) {
            try? fh.seekToEnd()
            p.standardOutput = fh
            p.standardError = fh
        }
        do { try p.run(); server = p; ownServer = true; petLog("起了自己的核心（端口 \(port)）") }
        catch { petLog("❌ 核心起不来：\(error.localizedDescription)") }
    }

    private func loadPet() {
        guard let wv = petWeb else { return }
        // ⚠️ 每次 load 都带一个**不一样的查询串** —— 只改 hash 的导航 Chrome/WebKit
        //    当成同文档导航，**一次都不重载**（这个坑记过两次）。
        let q = Int(Date().timeIntervalSince1970)
        wv.load(URLRequest(url: URL(string: "\(kBase)/ui/pet.html?p=\(q)")!))
        petLog("loadPet \(kBase)/ui/pet.html")
    }

    private func showBoot(_ title: String, _ sub: String) {
        let html = """
        <!doctype html><meta charset="utf-8">
        <style>html,body{background:transparent;margin:0;height:100%;overflow:hidden}
        body{display:flex;align-items:center;justify-content:center;font:13px -apple-system;
        color:#2b2b2b;text-align:center;padding:12px}
        b{display:block;font-size:15px;margin-bottom:6px}.k{opacity:.6;font-size:12px}</style>
        <div><b>\(title)</b><span class="k">\(sub)</span></div>
        """
        petWeb?.loadHTMLString(html, baseURL: nil)
    }

    // ═══════════════════════════════════════════════════════════
    //  Pet 窗
    // ═══════════════════════════════════════════════════════════
    @objc private func togglePet() {
        if let w = petWindow, w.isVisible {
            w.orderOut(nil); stopPetTracking()
            UserDefaults.standard.set(false, forKey: kPetOnKey)
            return
        }
        showPet()
    }

    private func showPet() {
        if petWindow == nil { buildPetWindow() }
        UserDefaults.standard.set(true, forKey: kPetOnKey)
        if coreReady { loadPet() } else { showBoot("正在启动…", "核心起来就好") }
        petWindow?.orderFrontRegardless()
        startPetTracking()
        startPetKeyMonitor()
    }

    private func buildPetWindow() {
        let w = PetPanel(contentRect: NSRect(origin: .zero, size: kPetIdle),
                         styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        // ⚠️ 这三行是"不抢焦点也能用"的全部：
        //    没有 `acceptsMouseMovedEvents` 悬停永远不触发；
        //    没有 `hidesOnDeactivate=false` 切到别的 App 它就躲起来。
        w.acceptsMouseMovedEvents = true
        w.isFloatingPanel = true
        w.hidesOnDeactivate = false
        // ⚠️ 必须 false：true 的话"只有控件需要时才成为 key"，
        //    而轮盘里那些按钮**恰恰需要一个 key 窗口**才收得到点击。
        w.becomesKeyOnlyIfNeeded = false
        // ⚠️⚠️ 四行少一行就是"桌面上多了一块白板/黑板"：
        //    `isOpaque=false` + `backgroundColor=.clear` + WebView 的 `drawsBackground=false`
        //    三处一起才真的透明；`hasShadow=false` 是因为无边框窗的投影会围出一个**方框**
        //    —— 那正好把"它其实是块矩形窗"这件事说出来。
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false
        w.level = .floating
        w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        w.isMovableByWindowBackground = false

        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "c4")
        let wv = PetWebView(frame: NSRect(origin: .zero, size: kPetIdle), configuration: cfg)
        wv.navigationDelegate = self
        wv.uiDelegate = self        // ⭐ 不挂这个，「选文件」就永远不会弹面板（见文件末尾那段）
        // ⚠️⚠️ **不能写成 `if wv.responds(to: Selector("setDrawsBackground:"))`** ——
        //    那个 key 是 KVC 私有的，`responds(to:)` 对它**返回 false**，
        //    于是这一句被跳过、WebView 留着白底 ⇒ 桌面上多一块白板（而窗口确实开了）。
        do { wv.setValue(false, forKey: "drawsBackground") } catch { petLog("drawsBackground 设不了") }
        w.contentView = wv
        petWindow = w
        petWeb = wv
        positionPetDefault(w)
        NotificationCenter.default.addObserver(self, selector: #selector(petMoved(_:)),
                                               name: NSWindow.didMoveNotification, object: w)
    }

    private func positionPetDefault(_ w: NSWindow) {
        let ud = UserDefaults.standard
        if ud.object(forKey: kPetXKey) != nil {
            let x = ud.double(forKey: kPetXKey), y = ud.double(forKey: kPetYKey)
            w.setFrameOrigin(NSPoint(x: x, y: y))
            return
        }
        guard let scr = NSScreen.main else { return }
        let v = scr.visibleFrame
        w.setFrameOrigin(NSPoint(x: v.maxX - kPetIdle.width - kPetRight,
                                 y: v.minY + kPetBottom))
    }

    @objc private func petMoved(_ n: Notification) {
        guard let w = n.object as? NSWindow, w === petWindow else { return }
        UserDefaults.standard.set(Double(w.frame.origin.x), forKey: kPetXKey)
        UserDefaults.standard.set(Double(w.frame.origin.y), forKey: kPetYKey)
    }

    private func resizePet(open: Bool) {
        guard let w = petWindow else { return }
        let size = open ? kPetRing : kPetIdle
        let old = w.frame
        // ⚠️ 锚**右下角** —— 轮盘是从宠物中心长出去的，
        //    锚左上角的话窗口一变大，宠物自己就在屏幕上跳一下。
        let nf = NSRect(x: old.minX + old.width - size.width,
                        y: old.minY,
                        width: size.width, height: size.height)
        w.setFrame(nf, display: true)
    }

    private func movePet(dx: Double, dy: Double) {
        guard let w = petWindow else { return }
        var o = w.frame.origin
        o.x += CGFloat(dx); o.y -= CGFloat(dy)     // ⚠️ 网页 y 往下，屏幕坐标 y 往上
        w.setFrameOrigin(o)
    }

    // ═══════════════════════════════════════════════════════════
    //  悬停：**由 Swift 自己盯鼠标**，不靠网页的 mousemove
    // ═══════════════════════════════════════════════════════════
    //
    // ⚠️⚠️ WKWebView 内部的 `NSTrackingArea` 是 `.activeInKeyWindow` 的 ——
    //    **窗口不是 key，hover 事件一个都不发**。而我们是 `.nonactivatingPanel`，
    //    于是"不点它一下，那一圈永远不出来"。
    // ⭐ 这边**只喂坐标、不判开合**：几何判断交给网页（它知道自己画了多大），
    //    否则半径写死在原生这边，而外圈半径是**随 App 个数和大小档变的** ⇒
    //    指针明明在扇区上却被判成"出去了" ⇒ **一闪一闪**（读者报过）。
    private func startPetTracking() {
        if petMouseTimer != nil { return }
        // ⚠️ 用**定时器读 `NSEvent.mouseLocation`**，不用 `addGlobalMonitorForEvents`：
        //    全局监视器**收不到发给自己的事件** —— 指针一进我们这窗就断流，
        //    而断流正好发生在**指针移到扇区上**的那一刻（最不能断的时候）。
        petMouseTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            self?.feedPetMouse()
        }
    }
    private func stopPetTracking() {
        petMouseTimer?.invalidate(); petMouseTimer = nil
        petArmed = false
    }

    private func feedPetMouse() {
        guard let w = petWindow, w.isVisible, !petDragging else { return }
        let m = NSEvent.mouseLocation
        let fr = w.frame
        // ⚠️ `NSEvent.mouseLocation` 是**屏幕坐标、y 往上**；网页要**窗口坐标、y 往下**。
        let x = Double(m.x - fr.minX)
        let y = Double(fr.maxY - m.y)
        // ⭐ 整窗常开 ⇒ 这块透明区域默认什么都点得到，就把桌面挡住了。
        //    ⇒ 光标离宠物远的时候让**整窗穿透**。
        //    ⚠️ 半径给 300 > 轮盘最外圈，否则最外圈那几个扇区点不动。
        //    ⚠️ 菜单栏那个"点击穿透"开关是**手动**的，优先级更高，别被这里覆盖。
        if !petThroughManual {
            let pcx = Double(fr.width - kPetRight - 52)
            let pcy = Double(kPetBottom + 45)
            let near = hypot(x - pcx, y - pcy) < 300
            let accept = near || petWheelOpen || petPanelOpen
            if w.ignoresMouseEvents == accept { w.ignoresMouseEvents = !accept }
            // ⭐⭐⭐ 提前占住键盘：轮盘在 96px 处展开，而 `NSApp.activate` 要 200~300ms 才生效。
            //    读者"看到展开了就敲" ⇒ 那一下按下去时我们**还不是活动的 App** ⇒ 按键进不来。
            //    ⇒ 光标进到 260px 就先把焦点占上。
            let arm = hypot(x - pcx, y - pcy) < 260
            if arm != petArmed {
                petArmed = arm
                if arm { takeFocus() } else if !petWheelOpen { releaseFocus(picked: false) }
            }
        }
        petWeb?.evaluateJavaScript("window.__petMouse && window.__petMouse(\(x), \(y))")
    }

    // ── 键盘：轮盘要能接 A–Z，就必须让这个面板是 key window ──
    private func startPetKeyMonitor() {
        if petKeyMon != nil { return }
        petKeyMon = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] ev in
            guard let self, self.petWheelOpen, self.petWindow?.isKeyWindow == true else { return ev }
            // ⚠️⚠️ **必须过滤修饰键**：用户在**别的 App** 里按 ⌘C 的那一下会落到轮盘上 ——
            //    真机日志坐实过 `key="Meta"` 紧跟 `key="c"` ⇒ 一个 ⌘C 把 Chrome 叫起来了。
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
            return nil
        }
    }

    /// 轮盘开了就把自己顶到最前（不然字母键根本进不来）
    private func takeFocus() {
        if !petTookFocus {
            prevFrontApp = NSWorkspace.shared.frontmostApplication
            petTookFocus = true
        }
        NSApp.activate(ignoringOtherApps: true)
        petWindow?.makeKeyAndOrderFront(nil)
        petLog("takeFocus 上一任=\(prevFrontApp?.localizedName ?? "?")")
    }
    /// 收起时把焦点还回去 —— **刚切过软件就不还**（否则会把人家刚点开的 App 踢下去）
    private func releaseFocus(picked: Bool) {
        guard petTookFocus, !picked else { petTookFocus = false; return }
        petTookFocus = false
        if let prev = prevFrontApp, !prev.isTerminated { prev.activate() }
        prevFrontApp = nil
    }

    // ═══════════════════════════════════════════════════════════
    //  原生桥
    // ═══════════════════════════════════════════════════════════
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let b = m.body as? [String: Any], let cmd = b["cmd"] as? String else { return }
        petLog("didReceive \(cmd) \(b)")
        switch cmd {
        case "resize":
            // ⭐ 轮盘开着时**整窗都要收点击** —— 否则最外圈那几个扇区会落在
            //    "光标离宠物太远 ⇒ 整窗穿透"的判定里，点不动。
            petWheelOpen = b["open"] as? Bool ?? false
            resizePet(open: petWheelOpen)
        case "modal":
            petPanelOpen = b["on"] as? Bool ?? false
            feedPetMouse()                       // 立刻按新状态算一次，别等下一个 50ms
        case "dragstart":
            // ⭐ 拖动交给 **AppKit 自己**（`performDrag`）——「网页动一下 → 消息 → 窗口挪一下」
            //    永远落后一两帧（读者："先拖出图片才跟随"）。按下的一瞬间交给系统拖 = 零延迟。
            //   ⚠️ 必须在**处理这次 mousedown 的过程中**调；消息是同步派发的，
            //      所以 `NSApp.currentEvent` 就是那个 mousedown。
            if let w = petWindow, let ev = NSApp.currentEvent, ev.type == .leftMouseDown {
                // ⚠️ 拖动期间**必须停掉悬停判断**：窗口跟着鼠标走，距离一会儿进一会儿出
                //    ⇒ 那一圈开-关-开-关（读者说的"反复跳"）。
                petDragging = true
                w.performDrag(with: ev)
                petDragging = false
                feedPetMouse()
            }
        case "drag": movePet(dx: b["dx"] as? Double ?? 0, dy: b["dy"] as? Double ?? 0)
        case "clickthrough":
            petThroughManual = b["on"] as? Bool ?? false
            petWindow?.ignoresMouseEvents = petThroughManual
        case "focus": takeFocus()
        case "closed": releaseFocus(picked: b["picked"] as? Bool ?? false)
        case "launch": launchFast(b["path"] as? String ?? "")
        case "quit": quitApp(b["path"] as? String ?? "")
        // ⭐ 设置页换了"形态"之后要**让桌面上那个 Pet 重画一遍**。
        //   ⚠️ 两个是**不同的文档**（设置窗 / 桌面小窗）—— localStorage 是共享的，
        //      但桌面那个不会自己知道 ⇒ 必须有人去叫它。
        //   ⚠️ 不叫的后果：设置里点了"银玫瑰"，桌面上那个**纹丝不动**，
        //      而用户会以为"这个功能没做"。重开一次才生效 = 最坏的那种"其实做了"。
        case "reloadPet":
            petWeb?.evaluateJavaScript("location.reload()")
            petLog("pet 重画（设置页换了形态）")
        case "show": openSettings()          // 这个 App 没有"主界面" ⇒ 打开设置
        case "settings": openSettings()
        // ⭐ 常驻开关住在 **Swift 的 UserDefaults** 里（它是 App 级的事），
        //    网页改不了 UserDefaults ⇒ 走桥。
        //    ⚠️ 读者要求「**至少有一个是开**」—— 两个都关的时候要**当场说清楚**，
        //       不能静默把某一个改回去（那样用户会以为开关坏了）。
        case "prefs":
            let wantDock = b["dock"] as? Bool ?? UserDefaults.standard.bool(forKey: kDockOnKey)
            let wantMenu = b["menu"] as? Bool ?? (UserDefaults.standard.object(forKey: kMenuOnKey) == nil
                ? true : UserDefaults.standard.bool(forKey: kMenuOnKey))
            if !wantDock && !wantMenu {
                petLog("⚠️ 用户想两个都关 —— 不允许（至少留一个，不然这个 App 没法操作）")
                reply(c, ["ok": false, "why": "两个都关的话就没有任何入口能再打开它了 —— 至少留一个",
                          "dock": UserDefaults.standard.bool(forKey: kDockOnKey),
                          "menu": UserDefaults.standard.object(forKey: kMenuOnKey) == nil
                              ? true : UserDefaults.standard.bool(forKey: kMenuOnKey)])
                return
            }
            UserDefaults.standard.set(wantDock, forKey: kDockOnKey)
            UserDefaults.standard.set(wantMenu, forKey: kMenuOnKey)
            applyActivationPolicy()
            rebuildMenuBar()
            reply(c, ["ok": true, "dock": wantDock, "menu": wantMenu])
        case "prefs_get":
            reply(c, ["dock": UserDefaults.standard.bool(forKey: kDockOnKey),
                      "menu": UserDefaults.standard.object(forKey: kMenuOnKey) == nil
                          ? true : UserDefaults.standard.bool(forKey: kMenuOnKey)])
        default: petLog("⚠️ 不认识的命令：\(cmd)")
        }
    }

    /// 把结果回给网页（`postMessage` 是**单向**的，回话只能 evaluateJavaScript）。
    /// ⚠️ 用 JSON 序列化拼参数 —— 手拼字符串遇到引号/反斜杠就会把脚本弄坏，
    ///    而那种失败**是静默的**（脚本语法错 → 什么都不发生）。
    private func reply(_ c: WKUserContentController, _ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return }
        for wv in [petWeb, settingsWindow?.contentView as? WKWebView].compactMap({ $0 }) {
            wv.evaluateJavaScript("window.__petPrefs && window.__petPrefs(\(s))")
        }
    }

    /// 菜单栏开关变了要**真的把那一项建出来 / 拿掉**（光改 UserDefaults 不会让图标消失）。
    private func rebuildMenuBar() {
        if let s = statusItem { NSStatusBar.system.removeStatusItem(s); statusItem = nil }
        buildMenu()
    }

    /**
     * ⭐ 进程内启动，不走"HTTP → spawn 三个进程"那条路。
     * ⚠️ 而且**先让位再叫**：把 App 从激活位撤下来，好让**别的进程**能把目标 App 叫上来
     *    （读者报过"点击不能让窗口抬到最前面"—— 就是没让位）。
     */
    private func launchFast(_ path: String) {
        guard !path.isEmpty else { return }
        let url = URL(fileURLWithPath: path)
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = true
        yieldActivation()
        NSWorkspace.shared.openApplication(at: url, configuration: cfg) { [weak self] app, err in
            if let err { petLog("launch ❌ \(path): \(err.localizedDescription)"); return }
            petLog("launch \(url.lastPathComponent) ok")
            guard let app else { return }
            // ⭐ **不靠隐藏自己**的兜底：万一目标 App 没抢到前台，就**再激活它一次**。
            //   ⚠️⚠️ 老代码在这里靠的是"把宠物藏起来让路"，而那正是读者看到的那个闪。
            //      这一条替代它：**宠物一直留着**，要动就动"目标 App 的激活"。
            let target = app.processIdentifier
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.30) { [weak self] in
                guard let self else { return }
                if NSWorkspace.shared.frontmostApplication?.processIdentifier != target {
                    app.activate()
                    petLog("launch 兜底：再推一次 \(url.lastPathComponent) 到前台")
                }
                self.assertPetVisible("launch +0.3s")   // ⚠️ 顺手再确认宠物还在
            }
        }
    }

    private func quitApp(_ path: String) {
        guard !path.isEmpty else { return }
        let target = URL(fileURLWithPath: path)
        for app in NSWorkspace.shared.runningApplications
        where app.bundleURL?.standardizedFileURL == target.standardizedFileURL {
            app.terminate()
        }
    }

    /**
     * ⭐⭐⭐ **让位**：把"活动 App"这个身份让出去 —— **但宠物一步都不许离开屏幕。**
     *
     * ⚠️⚠️⚠️ 读者 2026-10-14（他原话：「这个要**写死**，让你改过很多次了」）：
     *   「我点击周围的 app 时候，中间这个 pet，**又开始闪一下**，
     *     我希望**完全不闪，一直在**。」
     *
     * 真凶就是原来这一句 `petWindow?.orderOut(nil)` + 0.55 秒之后再放回：
     * 那 0.55 秒里**窗口真的不在屏幕上**（录屏里第 46~55 帧整块是空的，只剩鼠标）。
     *
     * ⚠️ 为什么可以不要它：
     *   · "让位"要的是**取消自己的激活状态**，不是把自己藏起来 —— 那句是 `NSApp.deactivate()`；
     *   · 宠物窗本来就是 `hidesOnDeactivate = false` + `level = .floating`
     *     ⇒ 自己失活它**照样在屏幕上**（这正是我们要的效果）。
     *
     * ⚠️⚠️ 为什么"延时放回"也必须**一起**删掉：
     *   只要代码里还留着"藏起来 → 过一会儿再放回"这个**形状**，
     *   就一定会有人（包括我自己）去调那个延时、去换 `order` / `orderFrontRegardless` ——
     *   而每一个变体都会闪。**要删的是形状本身，不是那个数字。**
     *
     * ⚠️ 那"万一别处把它弄没了"呢：`assertPetVisible` 会**当场**放回来（不延时、不淡入），
     *   并且留一行日志。判据是 `petWindow.isVisible`，不是"我调过 showPet 了"。
     */
    private func yieldActivation() {
        petTookFocus = false
        NSApp.deactivate()
        // ⭐ 让位之后立刻确认它还在屏幕上
        assertPetVisible("让位之后")
        // ⚠️ launch 是异步的：目标 App 起来后的几百毫秒里，窗口服务器还可能重排一次。
        //    再确认三次 —— 但**只确认、从不隐藏、也不延时放回**。
        for delay in [0.10, 0.35, 0.80] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.assertPetVisible("让位 +\(delay)s")
            }
        }
    }

    /**
     * **宠物必须在屏幕上；不在就立刻放回来。**
     *
     * ⚠️ 这个函数**永远只做"放回"，永远不做"藏起来"** ——
     *    把它单独抽出来，是为了让"藏"这件事在整个文件里**只有一处**
     *    （菜单里那个「显示 / 隐藏 Pet」，`togglePet()`），`grep orderOut` 就能数出来。
     *    ⇒ 以后谁再想在启动路径上藏它一下，都得先看见这段注释。
     */
    private func assertPetVisible(_ where_: String) {
        // 用户自己在菜单里关掉的，不许硬开回来
        let on = UserDefaults.standard.object(forKey: kPetOnKey) == nil
            ? true : UserDefaults.standard.bool(forKey: kPetOnKey)
        guard on, let w = petWindow else { return }
        if !w.isVisible {
            petLog("⚠️ 宠物不见了（\(where_)）—— 立刻放回，不走延时")
            w.orderFrontRegardless()
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  菜单栏
    // ═══════════════════════════════════════════════════════════
    private func buildMenu() {
        guard UserDefaults.standard.object(forKey: kMenuOnKey) == nil
                ? true : UserDefaults.standard.bool(forKey: kMenuOnKey) else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        // ⭐ 菜单栏那颗 = **一枚圈 + 里面那朵小花**（和 App 图标同一套品牌）。
        //   ⚠️⚠️ 原来是 `pencil.tip`（读者：「导航栏那个 logo 现在是一个**圆规**」
        //      —— 他说得对，那支铅笔看着就是圆规）。
        //   ⚠️ 菜单栏要的是**单色模板图**（`isTemplate = true`，macOS 自己按深浅色上色）：
        //      把那张彩色照片塞进来会变成一块糊的黑方块，而且深浅色下都不自适应。
        //      ⇒ 模板图是另画的一张（`app/make-menubar.py`），不是图标缩一缩。
        if let u = Bundle.main.url(forResource: "menubar", withExtension: "png"),
           let im = NSImage(contentsOf: u) {
            im.isTemplate = true
            im.size = NSSize(width: 20, height: 20)
            item.button?.image = im
        } else {
            item.button?.image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "CEVTUO-PET")
        }
        item.button?.image?.isTemplate = true
        let menu = NSMenu()
        menu.addItem(withTitle: "显示 / 隐藏 Pet", action: #selector(togglePet), keyEquivalent: "p").target = self
        menu.addItem(withTitle: "设置…", action: #selector(openSettings), keyEquivalent: ",").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "打开数据目录", action: #selector(openDataDir), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 CEVTUO-PET", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        statusItem = item
    }

    @objc private func openDataDir() {
        NSWorkspace.shared.open(URL(fileURLWithPath: NSHomeDirectory() + "/.c4emem"))
    }

    // ═══════════════════════════════════════════════════════════
    //  设置窗
    // ═══════════════════════════════════════════════════════════
    @objc private func openSettings() {
        if settingsWindow == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 780, height: 660),
                             styleMask: [.titled, .closable, .resizable, .miniaturizable],
                             backing: .buffered, defer: false)
            w.title = "CEVTUO-PET 设置"
            w.center()
            let cfg = WKWebViewConfiguration()
            cfg.userContentController.add(self, name: "c4")
            let wv = WKWebView(frame: w.contentView!.bounds, configuration: cfg)
            wv.autoresizingMask = [.width, .height]
            // ⭐⭐ 设置页就是「一起造一只新的」那一页 —— **不挂 uiDelegate，选文件永远没反应**
            wv.uiDelegate = self
            wv.navigationDelegate = self
            w.contentView = wv
            settingsWindow = w
        }
        // ⚠️ 带查询串，保证是**真重载**（只改 hash 的导航不重载）。
        if let wv = settingsWindow?.contentView as? WKWebView {
            wv.load(URLRequest(url: URL(string: "\(kBase)/ui/petsettings.html?p=\(Int(Date().timeIntervalSince1970))")!))
        }
        settingsWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // ═══════════════════════════════════════════════════════════
    //  导航失败 → 说出来（别留一块空白让人猜）
    // ═══════════════════════════════════════════════════════════
    func webView(_ wv: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) {
        petLog("⚠️ 导航失败：\(e.localizedDescription)")
        if wv === petWeb { showBoot("打不开界面", "核心可能没起来 —— \(e.localizedDescription)") }
    }
    /// ⚠️ 网页进程崩了要能自愈（白屏最常见的一种），但也不能无限重载。
    func webViewWebContentProcessDidTerminate(_ wv: WKWebView) {
        petLog("⚠️ 网页进程终止，重载一次")
        if wv === petWeb { loadPet() }
    }

    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        showPet(); return true
    }
    func applicationWillTerminate(_ note: Notification) {
        // ⚠️ 只关自己起的那个 —— 复用别人核心的时候**不要去杀它**。
        if ownServer { server?.terminate() }
    }
}

// ── 入口 ─────────────────────────────────────────────────────
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)      // 真正的策略在 didFinishLaunching 里按偏好定
app.run()

// ════════════════════════════════════════════════════════════════════
//  ⭐⭐⭐ 「选文件」那一半：**WKWebView 自己不会开文件面板**
// ════════════════════════════════════════════════════════════════════
//
// ⚠️⚠️⚠️ 读者 2026-10-14：「支持选文件和贴链接**一个都不好用**！！！」
//    真因：网页里的 `<input type="file">` 点了以后，WebKit 会去问宿主的
//    UI 代理 `webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)`。
//    **代理没实现 = 什么都不发生** —— 不报错、按钮也不变灰、控制台一个字都没有。
//    （两个 App 原来都只有 `navigationDelegate`，**没有 `uiDelegate`**。）
//
// ⚠️ 所以"点了没反应"和"这个功能没做"在这里长得一模一样 ——
//    而它离"网页写错了"也很像。以后凡是 `<input type="file">` / `<select>` 在
//    WKWebView 里没反应，先来看这里，不要先去改网页。
extension AppDelegate {
    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.image]
        panel.message = "挑一张图 —— 它会变成一只可以转的 3D Pet"
        panel.prompt = "用它"
        let done: (NSApplication.ModalResponse) -> Void = { r in
            completionHandler(r == .OK && !panel.urls.isEmpty ? panel.urls : nil)
        }
        // ⚠️ 挂在窗口上当 sheet（不然面板可能跑到别的窗口后面，看起来像"没弹出来"）
        if let host = webView.window { panel.beginSheetModal(for: host, completionHandler: done) }
        else { panel.begin(completionHandler: done) }
    }
}
