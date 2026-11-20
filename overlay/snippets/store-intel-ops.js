    /* ---------- [dsh-purge-plus] P10 资源保鲜 op ---------- */
    /* 不需要靶标：资源是全机共享的，靶标还没建的时候也该能看。 */
    if (op === 'intelStatus') {
      try {
        return Object.assign({ ok: true }, store.intelStatus())
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
    if (op === 'intelRefresh') {
      try {
        return Object.assign({ ok: true }, store.intelRefresh())
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
