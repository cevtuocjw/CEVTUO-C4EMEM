// 搬鼠标 / 点鼠标 / 报窗口位置 —— 用来验**原生窗**那条路（Playwright 驱动不了 AppKit 窗口）。
//
// ⚠️⚠️ 坐标约定是这个工具唯一会骗人的地方，所以它**每次都把读回来的值打出来**：
//   · 命令行里的 x y 一律是**屏幕左上原点**（和 `screencapture -R` 一致，人肉看图好对）；
//   · `CGWarpMouseCursorPosition` 收的也是左上原点（Quartz 全局坐标）；
//   · 而 `NSEvent.mouseLocation` 是**左下原点**（Cocoa）。
//   ⇒ `probe` 会把两个都打出来，主屏高度 H 时应当满足 cocoaY = H - quartzY。
//     （上一轮就是这里差了 593px：我以为喂的是左上，其实喂给了要左下的那个口，
//      于是"我悬停了"而光标离宠物 593px —— **量具坏了被读成产品坏了**。）
//
// 用法：
//   mvtool probe                                  报鼠标位置（两种口径）+ 本 App 的窗口 + 主屏尺寸
//   mvtool move <x> <y>                           把指针搬过去（真点积木；只搬不点）
//   mvtool click <x> <y> <left|right>             搬过去再按一下
import Cocoa

func quartzLoc() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }
func cocoaLoc() -> CGPoint { NSEvent.mouseLocation }

func warp(_ q: CGPoint) {
  let src = CGEventSource(stateID: .hidSystemState)
  CGWarpMouseCursorPosition(q)
  CGAssociateMouseAndMouseCursorPosition(1)
  // ⚠️ 只 warp 的话，物理鼠标的下一个 HID 事件会把指针**拽回去**（所以还要补一条 moved）
  if let mv = CGEvent(mouseEventSource: src, mouseType: .mouseMoved,
                      mouseCursorPosition: q, mouseButton: .left) {
    mv.post(tap: .cghidEventTap)
  }
  usleep(120_000)
}

func clickAt(_ q: CGPoint, _ button: CGMouseButton) {
  warp(q)
  let src = CGEventSource(stateID: .hidSystemState)
  let down: CGEventType = button == .right ? .rightMouseDown : .leftMouseDown
  let up: CGEventType = button == .right ? .rightMouseUp : .leftMouseUp
  CGEvent(mouseEventSource: src, mouseType: down, mouseCursorPosition: q, mouseButton: button)?.post(tap: .cghidEventTap)
  usleep(60_000)
  CGEvent(mouseEventSource: src, mouseType: up, mouseCursorPosition: q, mouseButton: button)?.post(tap: .cghidEventTap)
  usleep(180_000)
}

/// 本 App（ownerName 里含 "Cevtuo"）的窗口矩形。⚠️ `kCGWindowBounds` 也是**左上原点**。
func appWindows() -> [[String: Any]] {
  let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return [] }
  return list.filter { (($0[kCGWindowOwnerName as String] as? String) ?? "").contains("Cevtuo") }
}

let args = Array(CommandLine.arguments.dropFirst())
let main = NSScreen.screens.first
let H = main?.frame.height ?? 0
func report() {
  let q = quartzLoc(), c = cocoaLoc()
  print("cursor  quartz=(\(Int(q.x)),\(Int(q.y)))  cocoa=(\(Int(c.x)),\(Int(c.y)))  主屏H=\(Int(H))  校验 cocoaY==H-quartzY ⇒ \(Int(H - c.y) == Int(q.y))")
  for w in appWindows() {
    if let b = w[kCGWindowBounds as String] as? [String: Any],
       let x = b["X"] as? Double, let y = b["Y"] as? Double,
       let ww = b["Width"] as? Double, let hh = b["Height"] as? Double {
      let name = (w[kCGWindowOwnerName as String] as? String) ?? "?"
      let num = (w[kCGWindowNumber as String] as? Int) ?? 0
      // ⚠️ 带上 windowNumber：截图一定要用 `screencapture -l <num>` 按**窗口**截，
      //    用 `-R x,y,w,h` 截屏区域会把**压在上面的别的窗口**一起截进来
      //    （第一次就这么截到了一张聊天窗，看起来像"我们的窗口没开"）。
      print("window  \(name)  id=\(num)  x=\(Int(x)) y=\(Int(y)) w=\(Int(ww)) h=\(Int(hh))  right=\(Int(x + ww)) bottom=\(Int(y + hh))")
    }
  }
}

switch args.first {
case "probe": report()
case "move", "click":
  guard args.count >= 3, let x = Double(args[1]), let y = Double(args[2]) else {
    print("用法: mvtool move|click <x> <y> [left|right]"); exit(2)
  }
  let p = CGPoint(x: x, y: y)
  if args[0] == "click" {
    clickAt(p, args.count > 3 && args[3] == "right" ? .right : .left)
  } else { warp(p) }
  print("要搬到的位置(左上口径) = (\(Int(x)),\(Int(y)))")
  report()
default:
  print("用法: mvtool probe | move <x> <y> | click <x> <y> <left|right>")
}
