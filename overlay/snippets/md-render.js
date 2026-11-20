    /* [dsh-purge-plus] P20 报告文档视图：把交付用的 markdown 就地渲染出来
       ------------------------------------------------------------------
       为什么要有：报告页原来只有两种看法——卡片（能看，但不是交付物）和
       下载 .md（要离开面板）。验收人真正要读的是那份文档，所以它得能在这里读。

       刻意不引第三方 markdown 库：本包保持零外部依赖，而报告只用到一个很小的
       子集（标题 / 表格 / 代码块 / 列表 / 引用 / 分隔线 / 行内粗体与行内代码）。
       自己写 60 行解析器比引 200KB 的依赖更可控 —— 出问题能改。

       两条性能纪律（报告动辄几千行）：
         ① 首屏只渲染前 CHUNK 块，其余按需展开（一次渲染 3000 个节点会卡死面板）
         ② 代码块超过 4000 字符折叠，避免一条 64 台终端的回显把页面撑成几万像素
    */
    const MD_CHUNK = 400
    const MD_CODE_CLIP = 4000

    /** 行内标记：`**粗体**`、`` `代码` ``、`[文字](链接)`。其余原样。 */
    function mdInline(text, keyPrefix) {
      const src = String(text === null || text === undefined ? '' : text)
      const out = []
      const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g
      let last = 0
      let m = re.exec(src)
      let i = 0
      while (m !== null) {
        if (m.index > last) out.push(src.slice(last, m.index))
        const tok = m[0]
        const key = (keyPrefix || 'i') + ':' + (i += 1)
        if (tok.slice(0, 2) === '**') {
          out.push(h('strong', { key: key }, tok.slice(2, -2)))
        } else if (tok.charAt(0) === '`') {
          out.push(h('code', { key: key, className: 'rt-md-ic' }, tok.slice(1, -1)))
        } else {
          const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)
          /* 只放行 http/https/mailto/锚点/相对路径。报告正文来自我们自己的 markdown，
             但 `javascript:` 一旦被点就是执行 —— 渲染器不能把「可信输入」当前提。 */
          const href = link === null ? null : (/^(https?:|mailto:|#|\/)/i.test(link[2]) ? link[2] : null)
          out.push(link === null ? tok
            : (href === null ? link[1] : h('a', { key: key, href: href, target: '_blank', rel: 'noreferrer' }, link[1])))
        }
        last = m.index + tok.length
        m = re.exec(src)
      }
      if (last < src.length) out.push(src.slice(last))
      return out
    }

    /**
     * 把 markdown 切成块。**纯函数**，单测直接喂字符串。
     *
     * 只认报告里真会出现的东西；认不出的行按段落处理，不会丢内容 ——
     * 渲染器把内容吃掉比渲染得难看严重得多。
     */
    function mdParseBlocks(md) {
      const lines = String(md === null || md === undefined ? '' : md).replace(/\r\n/g, '\n').split('\n')
      const blocks = []
      let i = 0
      const isTableSep = (t) => /^\|?[\s:-]*-[-\s:|]*\|?$/.test(t) && t.indexOf('|') >= 0
      while (i < lines.length) {
        const line = lines[i]
        const fence = /^```(.*)$/.exec(line)
        if (fence !== null) {
          const lang = fence[1].trim()
          const body = []
          i += 1
          while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i += 1 }
          i += 1
          blocks.push({ type: 'code', lang: lang, text: body.join('\n') })
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading !== null) {
          blocks.push({ type: 'h', level: heading[1].length, text: heading[2].trim() })
          i += 1
          continue
        }
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
          blocks.push({ type: 'hr' })
          i += 1
          continue
        }
        if (/^\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
          /* 按**未转义**的竖线切格：`\|` 是单元格里的字面竖线（真实报告里有，
             例如表格里写 `a\|b`）。直接 split('|') 会把一格切成两格，列数错位。 */
          const split = (t) => {
            const src0 = t.replace(/^\|/, '').replace(/\|$/, '')
            const cells = []
            let cur = ''
            for (let k = 0; k < src0.length; k += 1) {
              const ch = src0[k]
              if (ch === '\\' && src0[k + 1] === '|') { cur += '|'; k += 1; continue }
              if (ch === '|') { cells.push(cur.trim()); cur = ''; continue }
              cur += ch
            }
            cells.push(cur.trim())
            return cells
          }
          const head = split(line)
          i += 2
          const rows = []
          while (i < lines.length && /^\|/.test(lines[i])) { rows.push(split(lines[i])); i += 1 }
          blocks.push({ type: 'table', head: head, rows: rows })
          continue
        }
        if (/^>\s?/.test(line)) {
          const body = []
          while (i < lines.length && /^>\s?/.test(lines[i])) { body.push(lines[i].replace(/^>\s?/, '')); i += 1 }
          blocks.push({ type: 'quote', text: body.join('\n') })
          continue
        }
        const bullet = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line)
        if (bullet !== null) {
          const ordered = /\d/.test(bullet[2])
          const items = []
          while (i < lines.length) {
            const mm = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i])
            if (mm === null) break
            items.push({ depth: Math.min(3, Math.floor(mm[1].length / 2)), text: mm[3] })
            i += 1
          }
          blocks.push({ type: 'list', ordered: ordered, items: items })
          continue
        }
        if (line.trim() === '') { i += 1; continue }
        const para = []
        while (i < lines.length && lines[i].trim() !== ''
          && !/^```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^>\s?/.test(lines[i])
          && !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) && !/^\|/.test(lines[i])) {
          para.push(lines[i]); i += 1
        }
        /* 兜底：任何没被上面分支接住、又进不了段落循环的行（典型：以 `|` 开头但下一行
           不是表格分隔行）在这里按单行段落处理。**必须保证 i 前进** —— 否则同一行会被
           无限重判，标签页直接卡死（实测过：CPU 100% 直到 OOM）。 */
        if (para.length === 0) { para.push(lines[i]); i += 1 }
        blocks.push({ type: 'p', text: para.join('\n') })
      }
      return blocks
    }

    /** 目录：只取 h1–h3，够用了；h4 以下在正文里本来就不需要跳转。 */
    function mdOutline(blocks) {
      const out = []
      for (let i = 0; i < blocks.length; i += 1) {
        const b = blocks[i]
        if (b.type === 'h' && b.level <= 3) out.push({ index: i, level: b.level, text: b.text })
      }
      return out
    }

    function MarkdownDoc(props) {
      const text = props.text || ''
      const [limit, setLimit] = React.useState(MD_CHUNK)
      const [openCode, setOpenCode] = React.useState({})
      const blocks = React.useMemo(() => mdParseBlocks(text), [text])
      const outline = React.useMemo(() => mdOutline(blocks), [blocks])
      const shown = blocks.slice(0, limit)
      const jump = (index) => {
        /* 目标块可能还没渲染（首屏只画 MD_CHUNK 块）。先把上限提到它之后，
           下一帧再滚 —— 否则点了没反应，用户以为目录坏了。 */
        if (index >= limit) {
          setLimit(Math.min(blocks.length, index + MD_CHUNK))
          setTimeout(() => {
            try {
              const el = document.getElementById('rt-md-b' + index)
              if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
            } catch { /* 忽略 */ }
          }, 30)
          return
        }
        try {
          const el = document.getElementById('rt-md-b' + index)
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
        } catch { /* 老浏览器不支持平滑滚动就静默 */ }
      }
      const renderBlock = (b, idx) => {
        const id = 'rt-md-b' + idx
        if (b.type === 'h') {
          const tag = b.level === 1 ? 'h2' : (b.level === 2 ? 'h3' : 'h4')
          return h(tag, { key: id, id: id, className: 'rt-md-h rt-md-h' + b.level }, mdInline(b.text, 'h' + idx))
        }
        if (b.type === 'hr') return h('hr', { key: id, className: 'rt-md-hr' })
        if (b.type === 'code') {
          const tooLong = b.text.length > MD_CODE_CLIP
          const expanded = !!openCode[idx]
          const body = tooLong && !expanded ? b.text.slice(0, MD_CODE_CLIP) : b.text
          return h('div', { key: id, className: 'rt-md-codebox' },
            h('div', { className: 'rt-md-codehead' },
              h('span', null, b.lang || 'text'),
              h('div', { className: 'rt-spacer' }),
              h('button', { className: 'rt-btn', onClick: () => copyText(b.text) }, '复制'),
              tooLong
                ? h('button', {
                    className: 'rt-btn',
                    onClick: () => setOpenCode((prev) => Object.assign({}, prev, { [idx]: !prev[idx] })),
                  }, expanded ? '收起' : '展开全部（' + b.text.length + ' 字符）')
                : null),
            h('pre', { className: 'rt-md-pre' }, body + (tooLong && !expanded ? '\n…（已折叠）' : '')))
        }
        if (b.type === 'table') {
          return h('table', { key: id, className: 'rt-md-table' },
            h('thead', null, h('tr', null, b.head.map((c, ci) => h('th', { key: 'th' + ci }, mdInline(c, id + 'h' + ci))))),
            h('tbody', null, b.rows.map((row, ri) => h('tr', { key: 'tr' + ri },
              row.map((c, ci) => h('td', { key: 'td' + ci }, mdInline(c, id + 'r' + ri + 'c' + ci)))))))
        }
        if (b.type === 'list') {
          const tag = b.ordered ? 'ol' : 'ul'
          return h(tag, { key: id, className: 'rt-md-list' }, b.items.map((it, ii) => h('li', {
            key: 'li' + ii, style: { marginLeft: it.depth * 14 + 'px' },
          }, mdInline(it.text, id + 'l' + ii))))
        }
        if (b.type === 'quote') return h('blockquote', { key: id, className: 'rt-md-quote' }, mdInline(b.text, id + 'q'))
        return h('p', { key: id, className: 'rt-md-p' }, mdInline(b.text, id + 'p'))
      }
      if (blocks.length === 0) return h('div', { className: 'rt-empty' }, '这份报告还没有正文（先记一条得分）')
      return h('div', { className: 'rt-md-wrap' },
        outline.length > 2
          ? h('div', { className: 'rt-md-toc' }, outline.map((o) => h('button', {
              key: 'o' + o.index,
              className: 'rt-md-tocitem rt-md-lv' + o.level,
              onClick: () => jump(o.index),
            }, o.text)))
          : null,
        h('div', { className: 'rt-md-doc' }, shown.map(renderBlock)),
        blocks.length > limit
          ? h('div', { className: 'rt-md-more' },
              h('button', { className: 'rt-btn', onClick: () => setLimit(limit + MD_CHUNK) },
                '继续加载（还有 ' + (blocks.length - limit) + ' 块）'),
              h('button', { className: 'rt-btn', onClick: () => setLimit(blocks.length) }, '全部展开'))
          : null)
    }
