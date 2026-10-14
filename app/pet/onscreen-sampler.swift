/**
 * 连续采样：那只宠物窗**在不在屏幕上**（每 ~40ms 一行）。
 *
 * ⚠️⚠️ 为什么不能只在"点之前 / 点之后"各看一次（`wincheck.swift` 就是那样）：
 *    宠物消失的那一下是 **0.55 秒**（`yieldActivation` 里那句 `orderOut` + 延时放回），
 *    一头一尾两次采样**必然都采到 1** ⇒ 那个探针**永远报"还在"**，
 *    而人眼看得很清楚它在闪。（读者 2026-10-14：「又开始闪一下」，
 *    而 `verify-pet-keeps.sh` 当时是绿的 —— 正是这个原因。）
 *
 * ⚠️ 判据打在**原生窗口列表**上，不用截图：宠物是一块透明小窗，
 *    截图上"它不见了"和"它正好压在深色东西上"长得一样。
 *
 * 用法：  swift app/pet/onscreen-sampler.swift <pid> [秒数] [间隔毫秒]
 * 输出：  每行 "<经过毫秒> <0|1>"，0 = 这一瞬间它不在屏幕上
 */
import Cocoa

let args = CommandLine.arguments
guard args.count >= 2, let pid = Int32(args[1]) else {
    print("用法: onscreen-sampler <pid> [秒数] [间隔毫秒]"); exit(2)
}
let secs = args.count >= 3 ? (Double(args[2]) ?? 8) : 8
let gapMs = args.count >= 4 ? (Int(args[3]) ?? 40) : 40

// 先把宠物那个窗的 windowNumber 找出来（**包括不在屏的时候**，否则量不了"它没了"）
var petWinId: Int = 0
if let all = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
    for w in all {
        guard (w[kCGWindowOwnerPID as String] as? Int32) == pid else { continue }
        let lay = (w[kCGWindowLayer as String] as? Int) ?? 0
        let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let ww = (b["Width"] as? Double) ?? 0, hh = (b["Height"] as? Double) ?? 0
        if lay == 3 && ww >= 90 && hh >= 90 { petWinId = (w[kCGWindowNumber as String] as? Int) ?? 0 }
    }
}

let t0 = Date()
let end = t0.addingTimeInterval(secs)
var line = ""
while Date() < end {
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                          kCGNullWindowID) as? [[String: Any]] ?? []
    var found = false
    for w in list {
        guard (w[kCGWindowOwnerPID as String] as? Int32) == pid else { continue }
        let lay = (w[kCGWindowLayer as String] as? Int) ?? 0
        let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let ww = (b["Width"] as? Double) ?? 0, hh = (b["Height"] as? Double) ?? 0
        // 宠物本体那一块：layer=3、>=90px（设置窗是 500×500 / layer=0，别混进来）
        if lay == 3 && ww >= 90 && hh >= 90 { found = true; break }
    }
    // ⭐⭐ 关键：**窗口还在列表里，不代表它看得见**。
    //   ⚠️ 我第一版只判"在不在列表里"，于是漏掉了读者报的这个闪 ——
    //      真实情况是窗口**还在**（alpha 掉到 0 / 移出可视区），
    //      而 `kCGWindowAlpha` 和矩形**正是这条判据**。
    var alpha = -1.0, bx = 0.0, by = 0.0, bw = 0.0, bh = 0.0
    for w in list {
        guard (w[kCGWindowOwnerPID as String] as? Int32) == pid else { continue }
        let lay = (w[kCGWindowLayer as String] as? Int) ?? 0
        let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let ww = (b["Width"] as? Double) ?? 0, hh = (b["Height"] as? Double) ?? 0
        if lay == 3 && ww >= 90 && hh >= 90 {
            alpha = (w[kCGWindowAlpha as String] as? Double) ?? -1
            bx = (b["X"] as? Double) ?? 0; by = (b["Y"] as? Double) ?? 0
            bw = ww; bh = hh
        }
    }
    line += "\(Int(Date().timeIntervalSince(t0) * 1000)) \(found ? 1 : 0) \(String(format: "%.2f", alpha)) \(Int(bx)),\(Int(by)) \(Int(bw))x\(Int(bh))\n"
    usleep(UInt32(gapMs * 1000))
}
// ⚠️ 一次性打出来（每行 flush 会把进程拖慢、采样间隔就不准了）
print(line, terminator: "")
