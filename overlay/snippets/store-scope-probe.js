  /* ---------- [dsh-purge-plus] P11 授权范围核对与隧道实测 ---------- */
  //
  // 为什么放在 store 而不是 tools：
  //   · 范围核对要用 ipToInt / scopeOfIp（store-core 已 import，tools 没有）；
  //   · 隧道实测要 raw socket，store-core 已 import tcpConnect；
  //   · 两处各写一份 IP 数学，迟早出现「工具说在范围、报告说不在」。
  // 所以这里只提供事实，工具只负责把它讲成人话。

  /** 本靶标的授权范围（CIDR 数组）。老库没有这个键时返回空数组，不猜。 */
  engagementScope(id) {
    try {
      const meta = readMeta(this.metaPathOf(id)) || {}
      /* [dsh-purge-plus] 走 scopeList：历史库里可能是整串字符串或被 String() 过的对象，
         直接 Array.isArray 判假就返回空，等于把"记过范围"说成"没记范围"。 */
      return scopeList(meta.scope_cidrs)
    } catch { return [] }
  }

  /**
   * 判断一个 IP / URL / 域名是否落在授权范围内。
   *
   * 四种结论，缺一种都会让调用方猜：
   *   in         在范围内（命中某个 CIDR）
   *   out        不在范围内
   *   unscoped   靶标没记授权范围（不阻断，但要提示用户补）
   *   unresolved 目标不是 IP 且解析不出 IP（域名/主机名）
   *
   * 域名不做 DNS 解析：这是**核对**动作，不该在核对时产生网络副作用，
   * 也不该因为解析到 CDN 地址就判成"在范围内"。
   */
  scopeCheckTarget(id, target) {
    const scope = this.engagementScope(id)
    const raw = String(target || '').trim()
    if (scope.length === 0) return { status: 'unscoped', scope, ip: null }
    /* 从 URL / host:port 里取 IP */
    let ip = null
    const bare = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').replace(/^\[/, '')
    const v4 = /^(\d{1,3}(?:\.\d{1,3}){3})/.exec(bare)
    if (v4 !== null) ip = v4[1]
    if (ip === null) {
      const v6 = /^([0-9a-fA-F:]{2,})/.exec(bare)
      if (v6 !== null && isIpv6(v6[1])) ip = v6[1]
    }
    if (ip === null) return { status: 'unresolved', scope, ip: null, target: raw }
    const ipInt = ipToInt(ip)
    if (ipInt === null) return { status: 'unresolved', scope, ip, target: raw }
    for (const cidr of scope) {
      const [base, bitsRaw] = String(cidr).split('/')
      const baseInt = ipToInt(base)
      if (baseInt === null) continue
      const bits = bitsRaw === undefined ? 32 : Number(bitsRaw)
      if (!Number.isFinite(bits) || bits < 0 || bits > 32) continue
      /* 掩码用无符号右移算：>>> 0 保证 32 位全 1 时不变成负数 */
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
      if ((ipInt & mask) >>> 0 === (baseInt & mask) >>> 0) return { status: 'in', scope, ip, cidr }
    }
    return { status: 'out', scope, ip, target: raw }
  }

  /**
   * 通过本地 SOCKS5 监听实测多个内网目标（CONNECT 握手）。
   *
   * 「隧道进程活着」不等于「隧道真的能到内网」：suo5 / chisel 的本地端口可能只是
   * 在监听，后端早已断线。所以必须真握手一次。返回可达矩阵，不做端口扫描。
   */
  async pivotProbe(listen, targets, timeoutMs = 6000) {
    const proxy = String(listen || '').replace(/^socks5:\/\//, '').replace(/^https?:\/\//, '')
    const pi = proxy.lastIndexOf(':')
    const ph = pi > 0 ? proxy.slice(0, pi) : '127.0.0.1'
    const pp = Number(pi > 0 ? proxy.slice(pi + 1) : proxy)
    const list = (Array.isArray(targets) ? targets : []).filter((x) => typeof x === 'string' && x.trim() !== '').slice(0, 50)
    if (!Number.isFinite(pp) || pp <= 0) return { listen, probes: [], error: 'listen 端口无法解析' }
    const one = (target) => new Promise((resolve) => {
      const ti = target.lastIndexOf(':')
      const th = ti > 0 ? target.slice(0, ti) : target
      const tp = Number(ti > 0 ? target.slice(ti + 1) : 0)
      if (!Number.isFinite(tp) || tp <= 0) return resolve({ ok: false, target, error: 'target 端口无法解析' })
      const started = Date.now()
      let done = false
      let stage = 'greeting'
      let socket
      const finish = (okFlag, error) => {
        if (done) return
        done = true
        try { if (socket) socket.destroy() } catch { /* ignore */ }
        resolve({ ok: okFlag, target, latency_ms: Date.now() - started, error: error || undefined })
      }
      try { socket = tcpConnect({ host: ph, port: pp }) } catch (e) { return finish(false, String((e && e.message) || e)) }
      socket.setTimeout(Math.min(Math.max(Number(timeoutMs) || 6000, 1000), 20000))
      socket.on('timeout', () => finish(false, 'timeout'))
      socket.on('error', (e) => finish(false, String((e && e.code) || (e && e.message) || e)))
      socket.on('connect', () => socket.write(Buffer.from([5, 1, 0])))
      socket.on('data', (buf) => {
        if (stage === 'greeting') {
          if (buf.length < 2 || buf[0] !== 5 || buf[1] !== 0) return finish(false, 'SOCKS5 握手失败')
          stage = 'connect'
          const ipInt = ipToInt(th)
          let req
          if (ipInt !== null) {
            req = Buffer.alloc(10)
            req[0] = 5; req[1] = 1; req[2] = 0; req[3] = 1
            req.writeUInt32BE(ipInt >>> 0, 4)
            req.writeUInt16BE(tp, 8)
          } else {
            const hb = Buffer.from(th, 'utf8')
            req = Buffer.alloc(7 + hb.length)
            req[0] = 5; req[1] = 1; req[2] = 0; req[3] = 3; req[4] = hb.length
            hb.copy(req, 5)
            req.writeUInt16BE(tp, 5 + hb.length)
          }
          return socket.write(req)
        }
        if (buf.length < 2) return finish(false, 'SOCKS5 响应过短')
        if (buf[1] === 0) return finish(true)
        return finish(false, 'SOCKS5 连接被拒（rep=' + buf[1] + '）')
      })
    })
    const probes = []
    for (const target of list) probes.push(await one(target))
    return {
      listen,
      total: probes.length,
      reachable: probes.filter((x) => x.ok).length,
      probes,
    }
  }
