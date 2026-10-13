/**
 * 报某个 pid 的**在屏窗口**（用来验"宠物还在不在"）。
 *
 * ⚠️ 为什么不用截图判：宠物是一块**透明**的小窗，截图上有没有它取决于背景颜色，
 *    而"它不见了"和"它正好压在深色东西上"在缩略图里长得一样。
 *    ⇒ 判据要打在**窗口列表**上：`kCGWindowIsOnscreen` + 非零尺寸。
 *
 * 用法：  swift app/pet/wincheck.swift <pid>        只报在屏的
 *        swift app/pet/wincheck.swift <pid> all    连不在屏的一起报
 */
import Cocoa

let args = CommandLine.arguments
guard args.count >= 2, let pid = Int32(args[1]) else {
    print("用法: wincheck <pid> [all]"); exit(2)
}
let all = args.count >= 3 && args[2] == "all"

guard let list = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
    print("拿不到窗口列表"); exit(1)
}

var onscreen = 0
for w in list {
    guard let owner = w[kCGWindowOwnerPID as String] as? Int32, owner == pid else { continue }
    let on = (w[kCGWindowIsOnscreen as String] as? Bool) ?? false
    if !on && !all { continue }
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let x = (b["X"] as? Double) ?? 0, y = (b["Y"] as? Double) ?? 0
    let ww = (b["Width"] as? Double) ?? 0, hh = (b["Height"] as? Double) ?? 0
    let layer = (w[kCGWindowLayer as String] as? Int) ?? -1
    let name = (w[kCGWindowName as String] as? String) ?? ""
    if on { onscreen += 1 }
    // ⚠️ 坐标是**左上原点**（和 `screencapture -R`、`mvtool` 命令行一致）
    print("onscreen=\(on ? 1 : 0) layer=\(layer) \(Int(x)),\(Int(y)) \(Int(ww))x\(Int(hh)) \(name)")
}
print("ONSCREEN_COUNT=\(onscreen)")
