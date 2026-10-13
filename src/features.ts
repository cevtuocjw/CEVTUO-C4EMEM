/**
 * 功能注册表 —— 侧栏那一串**不再写死在 HTML 里**，从这一份生成。
 *
 * 为什么必须有一张表（读者 2026-10-09 原话）：
 *   「侧栏的功能做成那种抽屉式样的，以时间顺序或者以软件来分区…因为每个软件（源）的
 *    功能和接的越来越多」
 *   「所有的功能都有归属，是从哪里来的，把功能的后边对应加上—来源的图标，不然会乱套」
 *   「所有的功能都有删除的能力」
 *   「这个软件不仅仅给我自己使用，未来也可以给任何其他的人使用…很多你需要优化和接口，
 *    而不是单独仅仅符合我」
 *   ⇒ 一个功能 = **一条数据**：名字 / 图标 / 归属哪个源 / 要哪个源有数据 / 谁装的 / 能不能删。
 *
 * ⚠️⚠️ **`source` 和 `needs` 是两件不同的事，别合并**（合并过一次，发现时已经乱了）：
 *    · `source` = 这个功能**是哪儿来的**（内置 / Notion / 邮件 / 用户自装）—— 只用来**显示图标**
 *    · `needs`  = 它**要哪个源有数据才用得了** —— 只用来**灰掉**
 *    一个"内置"功能完全可以需要 Notion 的数据（推荐就是这样）。
 *
 * ⚠️ 这份表是**服务端**的（不是 UI 里的常量）：
 *    ① 用户装了什么要**落盘**、要跨设备一致；
 *    ② 以后"对话式开发功能"要由服务端把新功能写进来；
 *    ③ 归属关系要被检索、被统计（"这个功能是哪个源带来的"）。
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 归属 = **这个功能是哪个软件带来的 / 它靠哪份数据吃饭**。
 *
 * ⚠️⚠️ 第一版把它理解成"谁发行的"，于是 12 个功能里 10 个都标「内置」——
 *    读者一眼看出来：「所有的来源logo都一样，感觉不太合理」。
 *    **同一个角标出现在几乎所有行上，那个角标就等于没说话。**
 *    ⇒ 判据是「**能不能靠它把功能分开**」，不是「每一行都有角标」。
 *
 * ⚠️ 读者 2026-10-09 又补了一句口径：「**如果是 notion 作为源的，你就标记 notion**」。
 *    ⇒ 从笔记语料里长出来的那几个（推荐 / 主题 / 词条 / 链接）归属就是 Notion，
 *      **不要**笼统写「全部来源」—— 那句话把"它从哪来"这件事抹掉了。
 *      真正跨所有源的（搜索 / 主动 / 自我改进）才用 `all`。
 */

export const SOURCES: Record<string, { label: string; icon: string }> = {
  // ⚠️ 别改回 rocket —— 那是「自我改进」的行图标，并排两枚一样的火箭看起来像渲染错了
  builtin: { label: '内置', icon: 'builtin' },
  // 「它靠**全部**已接入的来源吃饭」—— 和「内置」不是一回事：
  // 内置 = 和任何源都无关；all = 少接一个源它就少看一块。
  all: { label: '全部来源', icon: 'globe' },
  notion: { label: 'Notion', icon: 'notion' },
  exmail: { label: '企业邮箱', icon: 'mail' },
  figma: { label: 'Figma', icon: 'pen' },
  phone: { label: '手机', icon: 'phone' },
  feishu: { label: '飞书', icon: 'feishu' },
  wecom: { label: '企业微信', icon: 'mail' },
  local: { label: '本机', icon: 'window' },
  user: { label: '自己装的', icon: 'hand' },
};

/**
 * ⭐⭐ 侧栏按**软件**分组（不再按「知识库 / 邮件 / 主动 / 功能 / 核心」）。
 *
 * 读者 2026-10-10 原话：
 *   「所有的功能，你不要按照知识库这种写法，**要按照软件来！**」
 *   「你侧边按照软件，**按照 zen 那种模式**，按照软件来排列。
 *     如果点击，就在**下边拉出**所有跟这个软件相关的功能」
 *   「tech-learn 什么这 4 种也是**合在一起，都是 notion 的**」
 *
 * ⚠️ 分组的依据是功能的 `source`（**归属**），不是它读哪份数据（`needs`）——
 *    这两个字段的区别见文件头，别搞混。
 * ⚠️ `bottom:true` 的**沉到底部**：`内置`（工作区/语音/文字/结构流）要落在
 *    **拇指够得到**的地方。分组方式换了，但这条别丢 —— 它不是"更整齐"，是把最好按的东西挪远了。
 */
export const SOFTWARE: { id: string; name: string; icon: string; blurb: string; bottom?: boolean }[] = [
  // ⭐⭐ 读者 2026-10-10：「**主动和自我改进放到更重要的位置，这两个是核心**」
  //    ⇒ `主动` 这一块排到**最前面**，而且它现在装着四个：
  //      主动 / 自我改进 / 工作区 / 项目档案（后两个也是他要求挪进来的）。
  { id: 'proactive', name: '主动', icon: 'bell', blurb: '它主动给你的东西、让它自己改进、工作区和项目档案' },
  { id: 'notion', name: 'Notion', icon: 'notion', blurb: '你的笔记语料（4 个库合在一起算一个）' },
  { id: 'exmail', name: '企业邮箱', icon: 'mail', blurb: '收到的信、线程、待办' },
  { id: 'wecom', name: '企业微信邮件', icon: 'mail', blurb: '企业微信里的邮件' },
  { id: 'figma', name: 'Figma', icon: 'pen', blurb: '设计稿与项目' },
  { id: 'phone', name: '手机', icon: 'phone', blurb: '通知流与健康数据' },
  { id: 'feishu', name: '飞书', icon: 'feishu', blurb: '文档与消息' },
  { id: 'all', name: '跨来源', icon: 'globe', blurb: '同时读好几个软件的功能' },
  { id: 'user', name: '自己装的', icon: 'hand', blurb: '由推荐或对话加进来的' },
];
// ⚠️⚠️ 2026-10-10 **去掉了「内置」分区**（读者：「去掉内置这个分区」）。
//    原来挂在上面的四个各有去处：
//      · 工作区     → `主动`（他要求）
//      · 语音/文字/结构流 → **不上侧栏**（见 Feature.navHidden），它们本来就有右上角那三颗模式灯
//      · 用量       → 进**设置**（他要求），也不上侧栏
//    ⚠️ `builtin`/`local` 这两个 id **不要在 SOFTWARE 里留空壳** ——
//       留着的话万一哪天有功能忘了改 source，会静静地落进「其他」分区而不是报错。

export interface Feature {
  id: string;
  name: string;
  icon: string;
  group: string;
  /** 归属 —— 侧栏里那个来源小图标就是它 */
  source: string;
  /** 需要哪些 space 有数据才可用；省略 = 不挑。⚠️ 和 `source` 不是一回事，见文件头 */
  needs?: string[];
  /** 能不能删。⚠️ 内置的一律 false —— "删除能力"是针对**装进来的**那些 */
  removable?: boolean;
  origin: 'builtin' | 'installed';
  hint?: string;
  /** 打开哪个视图（和 data-v 同一个值） */
  view: string;
  /**
   * 侧栏里归到哪一块。**省略 = 跟 `source` 一样。**
   *
   * ⚠️⚠️ 为什么这两个必须分开：`source` 是**归属**（这个功能是哪儿来的，只用来显示角标），
   *    而侧栏要按**分区**摆。读者 2026-10-10 既要求「工作区/项目档案放到主动里」，
   *    又早就要求过「**如果是 notion 作为源的你就标记 notion**」——
   *    把两者塞进同一个字段，就会逼出"为了归到主动，把项目档案的归属写成主动"这种事，
   *    而那样它的角标就在撒谎。
   * ⇒ **归属照实写，分区另外指定。**
   */
  section?: string;
  /**
   * **不进侧栏**。
   * ⚠️ 读者 2026-10-10：「语音等剩下三个在这个边栏不显示」——
   *    它们本来就有右上角那三颗模式灯（`.modes`），在侧栏再列一遍是重复的两处入口。
   * ⚠️ 不是"删掉"：`installFeature`/`removeFeature`/按来源放行那些逻辑照旧认它们，
   *    只是 `navModel()` 不把它们画进侧栏。
   */
  navHidden?: boolean;
  /**
   * **暂时关闭**（读者 2026-10-10：「点 × 之前要确认是**暂时关闭不显示**还是**卸载**」）。
   * ⚠️⚠️ 和"卸载"是**两件事**，别合并：
   *    · 暂时关闭 = **还在**，只是从侧栏收起来；管理页里一个开关就能打开；
   *      内置功能**只能**这样（它的代码在仓库里，删不掉）。
   *    · 卸载     = 从"已装"里移走，进「待安装」，**保留 30 天**可以一键装回来。
   * ⇒ 关闭只影响"露不露出来"，卸载影响"算不算装着"。
   */
  off?: boolean;
  /**
   * ⭐⭐ **能不能作为「主动式」**（读者 2026-10-10：
   *   「自我改进里的功能可以标记是否为主动式，然后在对话去沟通怎么作为主动式，
   *     当然也要给推荐（所以有一些是能主动式的勾选就做）」）。
   *
   * ⚠️⚠️ 这一位**不是"用户想不想"**，是"**它做不做得到**"：
   *    一个只读的知识库功能（比如"链接"）主动起来没有任何东西可推，
   *    给它一个能勾的框，勾了也只会得到沉默 —— 那就是在骗人。
   *    能不能勾由注册表说了算，勾不勾由用户说了算（`proactiveOn`）。
   */
  proactive?: boolean;
  /** 它主动起来**长什么样** —— 勾选框旁边那行字，也是对话的起点 */
  proactiveHint?: string;
  /** 用户勾了"作为主动式" */
  proactiveOn?: boolean;
  /** 对话里聊出来的：这个功能主动时该守什么规矩 */
  proactiveNote?: string;
  /**
   * ⭐⭐ **这个功能自己的设置项**。读者 2026-10-10：「所有的设置等还有功能展示都是
   *    **根据到时候自我进化的功能走**，这样比较好」。
   *
   * ⚠️ 验收判据（也是它唯一说得清的做法）：**往这里加一条，设置里就自己多一格**，
   *    `app.js` 一行都不用改。加不进来 = 它还是写死的。
   * ⚠️ 只放**这个功能自己的**设置。**引擎级的别放**（外观、同步、接入凭据、恢复出厂）——
   *    那些不是功能，是底座；塞进来的话会变成"卸掉 Pet 连背景也一起没了"。
   *    （原话就是这条边界：「别把引擎级的设置也动态化」。）
   */
  settings?: Array<{
    /** 这些值存在哪。目前只支持 `'pet'`（`localStorage` 的 `c4emem.pet`）。 */
    store: 'pet';
    fields: Array<
      | { key: string; label: string; type: 'check'; hint?: string; default?: boolean }
      | { key: string; label: string; type: 'select'; options: Array<{ v: string; t: string }>; default?: string }
    >;
  }>;
}

/**
 * 内置功能。⚠️ 加一个功能**只改这里**，不要去改 app.html ——
 * 那份 HTML 里已经不再写死导航项了。
 */
export const BUILTIN: Feature[] = [
  // ── 核心：离手指最近 ──
  // ⚠️ 读者 2026-10-10：「工作区、项目档案都放到主动里」
  { id: 'home', name: '工作区', icon: 'work', group: 'core', source: 'builtin', section: 'proactive', origin: 'builtin', view: 'home' },
  // ⚠️ 这三个**不上侧栏**（navHidden）—— 右上角那三颗模式灯就是它们的入口，列两遍是重复的。
  { id: 'voice', name: '语音', icon: 'mic', group: 'core', source: 'builtin', origin: 'builtin', view: 'voice', navHidden: true },
  { id: 'text', name: '文字', icon: 'keys', group: 'core', source: 'builtin', origin: 'builtin', view: 'text', navHidden: true },
  { id: 'flow', name: '结构流', icon: 'flow', group: 'core', source: 'builtin', origin: 'builtin', view: 'flow', navHidden: true },
  // ── 知识库：这五个**读知识库** ⇒ 要有源的数据才给点（见 KB_FEATURES） ──
  { id: 'rec', name: '推荐', icon: 'spark', group: 'kb', source: 'notion', needs: ['*kb'], origin: 'builtin', view: 'rec' },
  // ⭐ 读者 2026-10-10 傍晚**改回来了**：「**搜索还是应该是跨来源才对，放回去，抱歉**」。
  //    （上一轮他要的是"搜笔记、放 Notion"，实际用过之后发现搜的确实是全部来源 ⇒ 归属写 `all`。）
  //    ⚠️ 别再自作主张改回 notion —— 这是他用过之后定的。
  { id: 'search', name: '搜索', icon: 'search', group: 'kb', source: 'all', needs: ['*kb'], origin: 'builtin', view: 'search' },
  { id: 'tax', name: '主题', icon: 'topic', group: 'kb', source: 'notion', needs: ['*kb'], origin: 'builtin', view: 'tax' },
  { id: 'vocab', name: '词条', icon: 'abc', group: 'kb', source: 'notion', needs: ['*kb'], origin: 'builtin', view: 'vocab' },
  { id: 'links', name: '链接', icon: 'link', group: 'kb', source: 'notion', needs: ['*kb'], origin: 'builtin', view: 'links' },
  // ⭐ 读者 2026-10-10：「**手机图片、手机信息**这几个部分功能至少」——
  //    它是**那双通过 ADB 去够手机的手**的第一个界面（见 src/sources/adbfs.ts）。
  //    ⚠️ 数据和「手机」那个来源是同一个 space（`adb`），不另开一个 ——
  //       AndroMeld 也归到它名下（同一条手机）。
  { id: 'phone', name: '手机', icon: 'phone', group: 'tool', source: 'phone', origin: 'builtin', view: 'phone',
    hint: '机型 / 电量 / 存储 + 相册 —— 走 ADB，连的是你插着/无线连着的那台' },
  // ⭐ 读者 2026-10-09：「也要有另外的按照软件的版式样，给知识库功能都列一起的那种视图方式每个软件」
  { id: 'bysource', name: '按软件', icon: 'window', group: 'kb', source: 'all', origin: 'builtin', view: 'bysource',
    hint: '每个软件一块：它带来多少内容、带来了哪些功能' },
  // ⚠️ 读者 2026-10-10：「用量也放到设置里」⇒ 设置抽屉里有它，侧栏不再列。
  { id: 'usage', name: '用量', icon: 'gauge', group: 'tool', source: 'local', origin: 'builtin', view: 'usage', navHidden: true },
  // ⚠️ 它**不进侧栏**（`navHidden`）：它的入口是菜单栏那颗和桌面那个小家伙，
  //    在侧栏再列一条就是第三个入口了。
  {
    id: 'pet', name: '桌面 CEVTUO Pet', icon: 'spark', group: 'tool', source: 'builtin',
    origin: 'builtin', view: 'voice', navHidden: true,
    hint: '在桌上放一个小家伙：鼠标放上去弹出一个轮盘（照 Launchy 做的）—— 每个 App 占一个扇区、' +
      '指针压到哪个哪个亮、中轴下面写着它的名字；敲角上那个字母直接切过去，打别的字就筛选，' +
      '下面那颗药丸点一下在「正在运行」和「全部应用」之间换（这就是"多软件打开"）。' +
      '拖着挪位置，Esc 收起；右键弹的是正在运行的软件清单（勾选 → 批量退出），' +
      '设置在那张面板底部的「Pet 设置…」上。',
    settings: [{
      store: 'pet',
      fields: [
        { key: 'on', label: '开关', type: 'check', hint: '显示这个家伙', default: false },
        // ⚠️ 形态 / 轮盘大小这两张表的**数值**在 `pet.js` 里，这里只给名字（两边各写一份数字就会漂）
        { key: 'form', label: '形态', type: 'select', options: [
          { v: 'card', t: 'CEVTUO 卡片' }, { v: 'pearl', t: '珍珠' }, { v: 'silver', t: '银' },
          { v: 'lead', t: '铅' }, { v: 'zinc', t: '锌' }] },
        { key: 'mode', label: '点它做什么', type: 'select', options: [
          { v: 'apps', t: '弹出一圈正在运行的软件（再点收回）' }, { v: 'voice', t: '开始 / 结束说话' },
          { v: 'c4emem', t: '打开 C4emem 的窗口' }, { v: 'open', t: '打开下面指定的那个软件' }] },
        { key: 'size', label: '轮盘大小', type: 'select', options: [
          { v: 's', t: '小' }, { v: 'm', t: '中' }, { v: 'l', t: '大' }] },
        { key: 'letters', label: '轮盘里的字母角标', type: 'check', default: true,
          hint: '在图标角上标一个字母（敲它 = 直接切过去，不用拿鼠标点）' },
        { key: 'keepOpen', label: '切完还留着吗', type: 'check', default: false,
          hint: '切过去之后轮盘<b>不收起</b>（要连着开好几个的时候勾上）' },
      ],
    }],
  },
  // ── 主动：读者要求「自我改进**也在主动这个部分里单独列出来**」 ──
  { id: 'proactive', name: '主动', icon: 'bell', group: 'proactive', source: 'all', section: 'proactive', origin: 'builtin', view: 'proactive' },
  { id: 'selfimprove', name: '自我改进', icon: 'rocket', group: 'proactive', source: 'all', section: 'proactive', origin: 'builtin', view: 'selfimprove',
    hint: '让软件分析你的数据、推荐功能、或者你直接对话让它做一个' },
];

/**
 * 可安装的目录 —— 「我能通过你的安排分析来获取功能，然后我选择…安装到侧栏去」。
 *
 * ⚠️ `ready:false` 的**不给装**：装了会点开一片空白，而空白和"坏了"长得一模一样。
 *    它们先摆在"可装"列表里，写明还差什么。
 */
export interface CatalogItem extends Partial<Feature> {
  id: string;
  name: string;
  icon: string;
  group: string;
  source: string;
  /** 这个功能**真的能用**了吗（代码写了没有） */
  ready: boolean;
  why: string;
}

export const CATALOG: CatalogItem[] = [
  {
    id: 'contacts', name: '联系人 / 公司', icon: 'chat', group: 'mail', source: 'exmail', ready: true,
    why: '从邮件里自动攒出「这个人是谁、我们聊过什么、上次什么时候」',
    // ⭐ 它**做得到**主动：攒够了人就能主动告诉你"这个人三个月没联系了"。
    proactive: true, proactiveHint: '某人多久没联系了、这封信是不是该回',
  },
  {
    id: 'mailtodo', name: '待办抽取', icon: 'check', group: 'mail', source: 'exmail', ready: true,
    why: '从正文里抽「谁要我做什么、什么时候要」。⚠️ 规则做的 —— 会漏也会错，每条都带原文让你自己判断',
    proactive: true, proactiveHint: '新邮件里冒出来的待办，到点提醒你',
  },
  {
    id: 'mailthread', name: '线程未结提醒', icon: 'clock', group: 'mail', source: 'exmail', ready: true,
    why: '一条来回很多封的线程有没有结论 —— 判"球在谁那边"，未结的会进工作区的主动板',
    proactive: true, proactiveHint: '一条线程晾了几天没回，主动提你一句',
  },
  {
    // ⚠️ 它**跨来源**（邮件 + 笔记一起读）⇒ 归属是 `all`（🌐），不是 exmail。
    //    「如果是 notion 作为源的你就标记 notion」那条口径的反面：这个功能不靠单一来源吃饭。
    // ⚠️ 分区放在「知识库」而不是「邮件」：它读的是内容（和 按软件 同一类），
    //    读者定的规矩是「纯知识库是纯知识库，纯功能是纯功能」。
    id: 'projects', name: '项目档案', icon: 'flask', group: 'kb', source: 'all', section: 'proactive', ready: true,
    why: '把一个项目的邮件 + 笔记 + 报价聚到一处；项目名可以自己定',
    proactive: true, proactiveHint: '一个项目好久没动静了，或者又来了新料',
  },
  {
    id: 'subscribe', name: '关键词订阅', icon: 'tag', group: 'mail', source: 'exmail', ready: false,
    why: '出现某些词就提醒',
    // ⚠️ `ready:false` 的**不给勾**：它连自己都还没做出来，谈不上"主动地做"。
    proactive: false,
  },
];

/**
 * ⚠️⚠️ **内置功能哪些"做得到主动"** —— 它们不在 CATALOG 里，得单独说一遍。
 *    只列**做得到**的：能"主动"地去找出点什么的才有意义。
 *    「用量」这种纯统计的列进来，勾了只会得到沉默 —— 那是在骗人。
 */
export const BUILTIN_PROACTIVE: Record<string, { hint: string; on: boolean }> = {
  rec: { hint: '你笔记里反复出现的词，攒到一定量主动推给你', on: true },
  tax: { hint: '一个新的主题冒头时提你一句', on: true },
  vocab: { hint: '某个词条你一直没看，或者最近又出现很多次', on: true },
  links: { hint: '你存过的链接里，有新的和旧的对上了', on: false },
  bysource: { hint: '某个软件的接入突然断了 / 一直没数据', on: false },
  proactive: { hint: '（它自己就是主动）', on: true },
  // ⚠️ 别把 CATALOG 里的（mailthread / projects）也写进来 ——
  //    它们已经在自己的条目上声明了 `proactive`，
  //    两边都写的话**装进来的那个会被这张旁表覆盖**（表里没有它的记录就回落到"开"），
  //    于是用户关掉的主动式自己又开了。
};

/** 卸载了**保留多久**（读者 2026-10-10：「卸载之后的功能也要保留 30 天，可以重新安装回来」） */
export const RETENTION_DAYS = 30;

interface Removed {
  id: string;
  name: string;
  /** 卸载的时刻（毫秒）。判"还剩几天"靠它。 */
  at: number;
}

interface Store {
  installed: Feature[];
  /** 装过又删了的 —— 记着，免得"推荐"又把同一个推一遍 */
  dismissed: string[];
  /**
   * **暂时关闭**的功能 id（内置和装进来的都算）。
   * ⚠️ 它们**仍算"装着"**，只是 `navModel` 不把它们画进侧栏。
   */
  off?: string[];
  /** 卸载了但**还在保留期内**的 —— 这就是「待安装」那一栏 */
  removed?: Removed[];
  /**
   * ⚠️ 内置功能的「主动式」设置（旁表：id → {on, note}）。
   *    内置的不在 `installed` 里，它们的勾选没地方放，只能单独记一张表。
   *    ⚠️⚠️ **这个键必须在 `loadStore` 里显式读出来** —— 少一行的话，
   *      写完立刻读就没了（表现是"勾了、一刷新又回去了"），而且**不报任何错**。第一版就是这样。
   */
  proactive?: Record<string, { on: boolean; note?: string }>;
}

const fileOf = (dataDir: string) => join(dataDir, 'features.json');

/**
 * 把过了保留期的卸载记录丢掉。
 * ⚠️ 判据是 **`RETENTION_DAYS` 天前那个时刻**，不是"清空重来" ——
 *    清空的话，昨天刚卸的今天还能装回来，而三个月前卸的会**一直**躺在待安装里。
 */
function prune(removed: Removed[], now = Date.now()): Removed[] {
  const cut = now - RETENTION_DAYS * 86400000;
  return removed.filter((r) => typeof r.at === 'number' && r.at >= cut);
}

export function loadStore(dataDir: string): Store {
  const p = fileOf(dataDir);
  if (!existsSync(p)) return { installed: [], dismissed: [], off: [], removed: [] };
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return {
      installed: Array.isArray(j?.installed) ? j.installed : [],
      dismissed: Array.isArray(j?.dismissed) ? j.dismissed : [],
      off: Array.isArray(j?.off) ? j.off : [],
      removed: Array.isArray(j?.removed) ? prune(j.removed) : [],
      proactive: j?.proactive && typeof j.proactive === 'object' ? j.proactive : {},
    };
  } catch {
    // 坏文件不装作没有 —— 留档再重来，不然下一次安装会把它整份覆盖掉
    try { renameSync(p, `${p}.bad-${Date.now()}`); } catch { /* 留档失败也不能当成空表继续写 */ }
    return { installed: [], dismissed: [], off: [], removed: [] };
  }
}

function saveStore(dataDir: string, s: Store) {
  mkdirSync(dataDir, { recursive: true });
  const p = fileOf(dataDir);
  // ⚠️ 每次落盘都**顺手 prune 一次** —— 只在 load 时 prune 的话，一个常年开着的
  //    服务进程永远不会把过期的丢掉（它不重读）。
  s.removed = prune(s.removed ?? []);
  writeFileSync(`${p}.tmp`, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
  renameSync(`${p}.tmp`, p);
}

/** 装一个功能。⚠️ 只在目录里、而且 `ready` 的才给装。 */
export function installFeature(dataDir: string, id: string) {
  const cat = CATALOG.find((c) => c.id === id);
  if (!cat) return { ok: false as const, error: `目录里没有这个功能：${id}` };
  // ⚠️ 这一条是**防"点开一片空白"**的：没写好的功能装上去，用户只会看到空白，
  //    而空白和"坏了"长得一模一样。
  if (!cat.ready) return { ok: false as const, error: `${cat.name}还没做：${cat.why}` };
  const s = loadStore(dataDir);
  if (s.installed.some((f) => f.id === id)) return { ok: true as const, feature: s.installed.find((f) => f.id === id)!, already: true };
  const f: Feature = {
    id: cat.id, name: cat.name, icon: cat.icon, group: cat.group, source: cat.source,
    needs: cat.needs, removable: true, origin: 'installed', hint: cat.why, view: cat.id,
    section: (cat as Feature).section, navHidden: (cat as Feature).navHidden,
    proactive: cat.proactive, proactiveHint: cat.proactiveHint,
  };
  s.installed.push(f);
  s.dismissed = s.dismissed.filter((x) => x !== id);
  // 装回来（或新装）时要**把"暂时关闭"一起清掉** —— 不清的话会出现
  // "装成功了、侧栏里却没有"，而那是这个项目栽过很多次的那种静默失败。
  s.off = (s.off ?? []).filter((x) => x !== id);
  s.removed = prune((s.removed ?? []).filter((r) => r.id !== id));
  saveStore(dataDir, s);
  return { ok: true as const, feature: f, already: false };
}

/**
 * ⭐ 卸载。⚠️ 内置的**不许卸载**，但**允许暂时关闭** —— 它的代码在仓库里，
 *    说"能卸载"是撒谎；而"暂时不显示"是做得到的，所以那条路要留着。
 */
export function removeFeature(dataDir: string, id: string) {
  if (BUILTIN.some((f) => f.id === id)) {
    return { ok: false as const, error: `${id} 是内置功能，卸不掉 —— 只能用「暂时关闭」`, builtin: true as const };
  }
  const s = loadStore(dataDir);
  const cat = CATALOG.find((c) => c.id === id);
  const name = s.installed.find((f) => f.id === id)?.name ?? cat?.name ?? id;
  const before = s.installed.length;
  s.installed = s.installed.filter((f) => f.id !== id);
  const removed = before - s.installed.length;
  if (removed) {
    if (!s.dismissed.includes(id)) s.dismissed.push(id);
    s.removed = prune([...(s.removed ?? []).filter((r) => r.id !== id), { id, name, at: Date.now() }]);
    s.off = (s.off ?? []).filter((x) => x !== id);   // 都不在了，留着"关着"没有意义
    saveStore(dataDir, s);
  }
  return { ok: true as const, removed, name };
}

/** ⭐ 一键装回来（只在保留期内有这个入口） */
export function restoreFeature(dataDir: string, id: string) {
  const s = loadStore(dataDir);
  const r = (s.removed ?? []).find((x) => x.id === id);
  if (!r) return { ok: false as const, error: '这个已经过了保留期，请到「可装」里重新装' };
  const days = Math.max(0, Math.ceil((r.at + RETENTION_DAYS * 86400000 - Date.now()) / 86400000));
  const res = installFeature(dataDir, id);
  return { ...res, daysLeftBefore: days };
}

/**
 * ⭐ 暂时关闭 / 打开。
 * ⚠️ 返回里带 `off` 之后的样子，界面不用自己猜（猜错就会"点了没反应"）。
 */
export function setFeatureOff(dataDir: string, id: string, off: boolean) {
  const known = BUILTIN.some((f) => f.id === id) || loadStore(dataDir).installed.some((f) => f.id === id);
  if (!known) return { ok: false as const, error: `没有这个功能：${id}` };
  const s = loadStore(dataDir);
  const set = new Set(s.off ?? []);
  if (off) set.add(id); else set.delete(id);
  s.off = [...set];
  saveStore(dataDir, s);
  return { ok: true as const, id, off };
}
/** 这个 id 现在是不是"暂时关闭"着（侧栏要用它来决定露不露） */
export function isOff(dataDir: string, id: string) { return (loadStore(dataDir).off ?? []).includes(id); }

/**
 * ⭐⭐ 把这个功能**标记为主动式**（读者 2026-10-10）。
 *
 * ⚠️⚠️ 分两层：**能不能**（`proactive`，注册表说了算 —— 只读的功能主动起来没事可做），
 *    **要不要**（`proactiveOn`，用户说了算）。这里只动"要不要"，
 *    动"能不能"要向调用方说清楚 —— 否则用户会以为"勾不动就是坏了"。
 */
export function setFeatureProactive(dataDir: string, id: string, on: boolean, note?: string) {
  const s = loadStore(dataDir);
  const builtin = BUILTIN.find((f) => f.id === id);
  if (builtin) {
    const cap = BUILTIN_PROACTIVE[id];
    if (!cap) return { ok: false as const, error: `${builtin.name}做不了主动式 —— 它没有"主动地给你点什么"的余地` };
    s.installed = s.installed.filter((f) => f.id !== id);   // 内置的不进 installed，别误插进去
    const patch = { id, on, note };
    s.proactive = { ...(s.proactive ?? {}), [id]: { on, ...(note != null ? { note } : {}) } };
    saveStore(dataDir, s);
    return { ok: true as const, ...patch };
  }
  const f = s.installed.find((x) => x.id === id);
  if (!f) return { ok: false as const, error: `没有这个功能：${id}` };
  const cat = CATALOG.find((c) => c.id === id);
  if (cat && cat.proactive === false) {
    return { ok: false as const, error: `${f.name}做不了主动式 —— 它只是在你要看的时候把东西列出来` };
  }
  f.proactiveOn = !!on;
  if (note != null) f.proactiveNote = note;
  saveStore(dataDir, s);
  return { ok: true as const, id, on, note };
}
/** 内置功能的主动设置（旁表） */
export function builtinProactive(dataDir: string): Record<string, { on: boolean; note?: string }> {
  return loadStore(dataDir).proactive ?? {};
}

/**
 * ⭐⭐ **断开这个来源** —— 读者 2026-10-10：
 *   「这里应该有把这个软件**全部断联卸载**的功能，不是卸载那个软件的意思，
 *     是**卸载我们这软件里**这些连接功能，然后这些功能就落到可以一键安装那里去了，保留 30 天」。
 *
 * ⚠️⚠️ 说清它不是什么：**它不动你的电脑、也不删数据**。
 *    删的是"我们这边为了用那个软件而装的功能"。数据还在库里，重新装上就又能用。
 *
 * 两条路各走各的（因为它们**本来就不同**）：
 *   · 装进来的 → **卸载**（进待安装，保留 30 天，一键装回）
 *   · 内置的   → **暂时关闭**（代码在仓库里，卸不掉；关掉就是"侧栏里不再出现"）
 *   把内置的也"卸载"是在撒谎；把装进来的只"关闭"则不给用户"真的拿掉"的路。
 */
export function disconnectSource(dataDir: string, source: string) {
  if (!source) return { ok: false as const, error: '没说断哪个来源' };
  const installed = loadStore(dataDir).installed.filter((f) => (CATALOG.find((c) => c.id === f.id)?.source ?? f.source) === source);
  const removed: string[] = [];
  for (const f of installed) {
    const r = removeFeature(dataDir, f.id);
    if (r.ok && r.removed) removed.push(f.id);
  }
  // ⚠️ 内置的**只关掉没在用的**：已经是关闭状态的不用再写一遍（`setFeatureOff` 是幂等的，
  //    但少写一次状态文件就少一次"手滑"的机会）
  const offNow = new Set(loadStore(dataDir).off ?? []);
  const off: string[] = [];
  for (const b of BUILTIN) {
    if (b.source !== source) continue;
    if (offNow.has(b.id)) { off.push(b.id); continue; }
    const r = setFeatureOff(dataDir, b.id, true);
    if (r.ok) off.push(b.id);
  }
  return { ok: true as const, source, removed, off };
}

/** 这个来源名下有几个功能（用来在界面上写"断开它 = 要动 N 个功能"） */
export function sourceFeatureCount(dataDir: string, source: string) {
  const m = manageModel(dataDir);
  const all = [...m.builtins, ...m.installed].filter((f) => f.source === source);
  return { total: all.length, removable: all.filter((f) => f.removable).length, names: all.map((f) => f.name) };
}

/**
 * ⭐⭐ **被标成主动式、而且真的打开了的**功能 —— 生成层要用它（见 server.ts 的
 *    `/api/proactive/event`）。
 *
 * ⚠️⚠️ 存在这一份**不是为了显示**，是为了让"勾选"和"写的那句规矩"**真的参与生成**。
 *    只显示不喂给模型的话，用户勾了、写了、推送却一点没变 —— 而这种
 *    "操作了但没有任何反馈"正是这个项目反复栽过的形状（而且它不报错）。
 */
export function proactiveMarks(dataDir: string): { id: string; name: string; note: string; hint: string }[] {
  const m = manageModel(dataDir);
  return [...m.builtins, ...m.installed]
    .filter((f) => f.proactive && f.proactiveOn && !f.off)
    .map((f) => ({ id: f.id, name: f.name, note: f.proactiveNote || '', hint: f.proactiveHint || '' }));
}

/**
 * 侧栏要的那一份：内置 + 装进来的，按分区归好。
 * ⚠️ 分区顺序由 `GROUPS` 定；**空的分区不返回**（不然侧栏会挂一堆空标题）。
 */
/**
 * 把**装进来的**功能按目录里那份重新对一遍。
 *
 * ⚠️⚠️ `features.json` 里存的是**安装当时的快照**。于是：给 `Feature` 加一个新字段
 *    （比如这次的 `section`），**已经装过的那些不会有它** ——
 *    表现是"我明明把项目档案归到主动了，它还在跨来源里"，而**不报任何错**。
 *    ⇒ 放置方式（分区 / 归属 / 上不上侧栏 / 名字 / 图标）一律**以目录为准**，
 *      存下来的那份只留"装过"这个事实和安装时的少数决定。
 *    ⚠️ 目录里已经没有的（下架了）就**用存下来的那份**，不能让它静默消失。
 */
function resolveInstalled(f: Feature): Feature {
  const c = CATALOG.find((x) => x.id === f.id);
  if (!c) return f;
  return {
    ...f,
    name: c.name, icon: c.icon, source: c.source, section: c.section,
    navHidden: c.navHidden, needs: c.needs, hint: c.why ?? f.hint,
    // ⚠️ "能不能做主动式"也**以目录为准** —— 和放置方式同一个道理（见上面那条注释）。
    //    存下来的那份里没有这个字段的话，已经装过的功能会**永远勾不动**。
    proactive: c.proactive ?? f.proactive, proactiveHint: c.proactiveHint ?? f.proactiveHint,
  };
}

/** 内置功能的主动设置（旁表）合并进 Feature —— 内置的不在 `installed` 里 */
function withBuiltinProactive(f: Feature, table: Record<string, { on: boolean; note?: string }>): Feature {
  const cap = BUILTIN_PROACTIVE[f.id];
  if (!cap) return f;
  const s = table[f.id];
  return { ...f, proactive: true, proactiveHint: cap.hint, proactiveOn: s ? s.on : cap.on, proactiveNote: s?.note };
}

export function navModel(dataDir: string) {
  const s = loadStore(dataDir);
  const table = builtinProactive(dataDir);
  const all = [
    ...BUILTIN.map((f) => withBuiltinProactive(f, table)),
    ...s.installed.map((f) => withBuiltinProactive(resolveInstalled(f), table)),
  ];
  const itemsOf = (fs: Feature[]) =>
    fs.map((f) => ({
      id: f.id, name: f.name, icon: f.icon, view: f.view, needs: f.needs ?? [],
      // ⚠️⚠️ 这一份是**逐个字段挑**的 —— 新加的 `settings` 不显式带出去就会被**静默丢掉**
      //    （表现是"注册表里明明写了，设置里就是不出现"，而且一点错都不报）。
      settings: f.settings,
      // ⚠️ 界面要按**分区**判断"这个功能属于哪一块"（按来源放行那件事），
      //    所以这一份必须带上它 —— 只有 `source` 的话，项目档案会被判成"跨来源"，
      //    而它其实摆在「主动」里。
      section: f.section ?? f.source,
      source: f.source, sourceLabel: SOURCES[f.source]?.label ?? f.source,
      sourceIcon: SOURCES[f.source]?.icon ?? 'help',
      removable: !!f.removable, origin: f.origin, hint: f.hint ?? '',
      // ⭐ 「暂时关闭」和「主动式」这两位必须传到界面 ——
      //    界面自己猜的话，"关了却还在"和"勾了却没反应"就分不开了。
      off: (s.off ?? []).includes(f.id),
      proactive: !!f.proactive, proactiveOn: !!f.proactiveOn,
      proactiveHint: f.proactiveHint ?? '', proactiveNote: f.proactiveNote ?? '',
    }));

  // ⚠️ `navHidden` 的功能**先滤掉再分组** —— 顺序反了的话它们会先落进「其他」那一堆，
  //    而那正是"明明说了不上侧栏，它却在一个叫其他的分区里"。
  const shown = all.filter((f) => !f.navHidden);
  // ⭐ 「暂时关闭」的**不画进侧栏**（读者：「暂时关闭不显示」），但要在管理页里找得到
  //    —— 所以它们不进 `groups`，进 `offItems`。
  const offSet = new Set(s.off ?? []);
  const visible = shown.filter((f) => !offSet.has(f.id));
  const hidden = shown.filter((f) => offSet.has(f.id));

  // ⚠️ 按 `section ?? source` 分组 —— `section` 是**侧栏分区**，`source` 是**归属**（角标）。
  //    两个字段各自的意义见 `Feature` 上的注释，别合并。
  const groups = SOFTWARE
    .map((sw) => ({
      id: sw.id, name: sw.name, icon: sw.icon, blurb: sw.blurb, bottom: !!sw.bottom,
      items: itemsOf(visible.filter((f) => (f.section ?? f.source) === sw.id)),
    }))
    .filter((g) => g.items.length);

  // ⚠️⚠️ 兜底：`source` 不在 `SOFTWARE` 表里的功能**绝不能静默消失** ——
  //    表现会变成"这个功能明明装上了，侧栏里却找不到"，而**不报任何错**。
  //    （"归不上类就没了"是这个项目反复栽过的形状。）
  const known = new Set(SOFTWARE.map((x) => x.id));
  const orphans = visible.filter((f) => !known.has(f.section ?? f.source));
  if (orphans.length) {
    groups.push({ id: '__other', name: '其他', icon: 'help', blurb: '还没归到某个软件下的', bottom: false, items: itemsOf(orphans) });
  }
  const now = Date.now();
  return {
    groups,
    installed: s.installed.map((f) => f.id),
    dismissed: s.dismissed,
    /** 暂时关闭着的（管理页里给一个开关打开） */
    offItems: itemsOf(hidden),
    /** 卸载了但还在保留期内的 —— 「待安装」，一键装回来 */
    removed: (s.removed ?? []).map((r) => ({
      ...r,
      daysLeft: Math.max(0, Math.ceil((r.at + RETENTION_DAYS * 86400000 - now) / 86400000)),
      name: r.name || CATALOG.find((c) => c.id === r.id)?.name || r.id,
    })),
    retentionDays: RETENTION_DAYS,
  };
}

/**
 * 「可装」列表：目录里还没装的（含还没做的 —— 但要带 `ready` 让界面说得出口）。
 * ⚠️ **卸载还在保留期内的那些要排除掉** —— 它们有自己的「待安装」那一栏，
 *    同时在两处出现的话，用户会以为"卸载没生效"。
 */
/**
 * ⭐⭐ **带设置的功能**的扁平清单（给设置页用）。
 *
 * ⚠️⚠️ 别想着从 `navModel().groups` 里找 —— 那是**侧栏**的分组，按 `section` 分，
 *    而 `builtin` 不是任何一组 ⇒ 语音/文字/结构流/Pet 这些**根本不在里面**。
 *    第一版就是从 groups 里找 pet，结果"注册表里明明写了，设置里就是不出现"，
 *    而且**一点错都不报**（和"逐个字段挑"那个坑是同一个形状）。
 */
export function settingsModel(dataDir: string) {
  const st = loadStore(dataDir);
  const installed = (st.installed ?? [])
    .map((id) => CATALOG.find((c) => c.id === id))
    .filter(Boolean) as unknown as Feature[];
  return [...BUILTIN, ...installed]
    .filter((f) => Array.isArray(f.settings) && f.settings.length > 0)
    .map((f) => ({ id: f.id, name: f.name, hint: f.hint ?? '', settings: f.settings! }));
}

export function catalogFor(dataDir: string) {
  const s = loadStore(dataDir);
  const tray = new Set((s.removed ?? []).map((r) => r.id));
  return CATALOG.filter((c) => !s.installed.some((f) => f.id === c.id) && !tray.has(c.id));
}

/** ⭐ 管理页要的那一份：**所有功能**（内置 / 已装 / 暂关 / 已卸载）分组列出来 */
export function manageModel(dataDir: string) {
  const nav = navModel(dataDir);
  const s = loadStore(dataDir);
  const table = builtinProactive(dataDir);
  const caps = (f: Feature) => ({
    proactive: !!f.proactive, proactiveOn: !!f.proactiveOn,
    proactiveHint: f.proactiveHint ?? '', proactiveNote: f.proactiveNote ?? '',
  });
  const builtins = BUILTIN.map((f) => withBuiltinProactive(f, table))
    .filter((f) => !f.navHidden)
    .map((f) => ({
      id: f.id, name: f.name, icon: f.icon, source: f.source, hint: f.hint ?? '',
      origin: 'builtin' as const, removable: false,
      off: (s.off ?? []).includes(f.id), ...caps(f),
    }));
  const installed = s.installed.map((f) => withBuiltinProactive(resolveInstalled(f), table)).map((f) => ({
    id: f.id, name: f.name, icon: f.icon, source: f.source, hint: f.hint ?? '',
    origin: 'installed' as const, removable: true,
    off: (s.off ?? []).includes(f.id), ...caps(f),
  }));
  return { builtins, installed, navHidden: BUILTIN.filter((f) => f.navHidden).map((f) => f.id), offItems: nav.offItems, removed: nav.removed, retentionDays: RETENTION_DAYS };
}
