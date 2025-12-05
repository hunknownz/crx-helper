export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    console.log("[crx-helper/content] content script loaded on", location.href);
    chrome.runtime.onMessage.addListener((msg) => {
      console.log("[crx-helper/content] onMessage", msg?.type);
      if (msg?.type === "OPEN_TOOLBOX") {
        openToolbox();
      } else if (msg?.type === "CAPTURE_PAGE") {
        captureAndDownload().catch((e) => console.warn("capture failed", e));
      } else if (msg?.type === "EXPORT_ANALYSIS") {
        exportAnalysis().catch((e) => console.warn("analysis failed", e));
      }
    });

    function openToolbox() {
      const id = "crx-helper-toolbox";
      if (document.getElementById(id)) return;
      const wrap = document.createElement("div");
      wrap.id = id;
      wrap.style.cssText = [
        "position:fixed",
        "top:12px",
        "right:12px",
        "z-index:2147483647",
        "font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
      ].join(";");
      wrap.innerHTML = `
        <div style="background:#111827; color:#fff; border:1px solid #374151; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.3); padding:10px; min-width:220px">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px">
            <strong style="font-size:12px; opacity:.9">CRX Helper</strong>
            <button id="crx-helper-close" style="background:transparent; color:#9CA3AF; border:0; cursor:pointer; font-size:14px">✕</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px">
            <button id="crx-helper-export-analysis" style="padding:6px 8px; border-radius:6px; border:1px solid #4B5563; background:#1F2937; color:#fff; cursor:pointer; text-align:left">导出分析上下文（JSON + HTML）</button>
            <button id="crx-helper-capture-html" style="padding:6px 8px; border-radius:6px; border:1px solid #4B5563; background:#1F2937; color:#fff; cursor:pointer; text-align:left">导出 HTML 快照</button>
          </div>
          <div id="crx-helper-status" style="margin-top:6px; color:#9CA3AF; font-size:12px"></div>
        </div>
      `;
      document.documentElement.appendChild(wrap);
      const closeBtn = wrap.querySelector("#crx-helper-close") as HTMLButtonElement | null;
      const exportBtn = wrap.querySelector("#crx-helper-export-analysis") as HTMLButtonElement | null;
      const captureBtn = wrap.querySelector("#crx-helper-capture-html") as HTMLButtonElement | null;
      const statusEl = wrap.querySelector("#crx-helper-status") as HTMLDivElement | null;
      closeBtn?.addEventListener("click", () => wrap.remove());
      exportBtn?.addEventListener("click", async () => {
        statusEl && (statusEl.textContent = "分析中…");
        console.log("[crx-helper/content] EXPORT_ANALYSIS start");
        try {
          await exportAnalysis();
          statusEl && (statusEl.textContent = "已导出 page_analysis.json 与 page_clean.html");
          console.log("[crx-helper/content] EXPORT_ANALYSIS done");
        } catch (e) {
          statusEl && (statusEl.textContent = "导出失败，请重试");
          console.warn("[crx-helper/content] EXPORT_ANALYSIS error", e);
        }
      });
      captureBtn?.addEventListener("click", async () => {
        statusEl && (statusEl.textContent = "导出 HTML…");
        console.log("[crx-helper/content] CAPTURE_PAGE start");
        try {
          await captureAndDownload();
          statusEl && (statusEl.textContent = "已导出 HTML 快照");
          console.log("[crx-helper/content] CAPTURE_PAGE done");
        } catch (e) {
          statusEl && (statusEl.textContent = "导出失败，请重试");
          console.warn("[crx-helper/content] CAPTURE_PAGE error", e);
        }
      });
    }

    async function captureAndDownload() {
      // Small delay to let late mutations settle
      await new Promise((r) => setTimeout(r, 120));

      const serializer = new XMLSerializer();
      const html = serializer.serializeToString(document);

      const meta = {
        url: location.href,
        title: document.title,
        ts: new Date().toISOString(),
      } as const;

      // Send to background for logging or future processing
      try {
        void chrome.runtime.sendMessage({ type: "PAGE_HTML", html, meta });
      } catch {}

      // Download a snapshot so you can feed it to an LLM
      try {
        const header = `<!-- Captured by crx-helper @ ${meta.ts}\nURL: ${meta.url}\nTitle: ${meta.title}\n-->\n`;
        const blob = new Blob([header, html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const safeName = (meta.title || "page").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
        a.href = url;
        a.download = `${safeName || "page"}.html`;
        a.style.display = "none";
        document.documentElement.appendChild(a);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
          a.remove();
        }, 1000);
      } catch (e) {
        console.warn("Download failed, falling back to console output.");
        console.log("PAGE_HTML_START", meta, html, "PAGE_HTML_END");
      }
    }

    async function exportAnalysis() {
      // Wait a bit for hydration to settle
      console.log("[crx-helper/content] waitForStability…");
      await waitForStability(300, 4000);

      const meta = buildMeta();
      const outline = collectOutline();
      const landmarks = collectLandmarks();
      const actions = collectActions(300);
      const paginationHints = detectPagination(actions);
      const limits = { scannedActions: actions.length };

      const analysis = { meta, outline, landmarks, actions, paginationHints, limits } as const;
      console.log("[crx-helper/content] analysis built", {
        actions: actions.length,
        headings: outline.length,
        hasNext: paginationHints?.hasNext,
      });

      // Cleaned HTML (minimal: remove script/style/noscript/link[rel=stylesheet])
      const cleanedHtml = buildCleanHtml();

      const analysisText = JSON.stringify(analysis, null, 2);
      const htmlText = cleanedHtml;

      // Prefer background downloads to avoid site multiple-download blocks
      const base = safeBaseName();
      await downloadViaBackground(base + ".page_analysis.json", analysisText, "application/json;charset=utf-8");
      await downloadViaBackground(base + ".page_clean.html", htmlText, "text/html;charset=utf-8");
      console.log("[crx-helper/content] requested background downloads", base);

      try {
        void chrome.runtime.sendMessage({
          type: "ANALYSIS_DONE",
          meta: { url: meta.url, analysisBytes: analysisText.length, htmlBytes: htmlText.length },
        });
      } catch (e) {
        console.warn("[crx-helper/content] send ANALYSIS_DONE failed", e);
      }
    }

    function buildMeta() {
      const vp = {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      };
      return {
        url: location.href,
        title: document.title,
        lang: document.documentElement.lang || navigator.language || "",
        timestamp: new Date().toISOString(),
        viewport: vp,
      };
    }

    function collectOutline() {
      const res: Array<{ level: number; text: string; selector: string }> = [];
      const hs = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"));
      for (const h of hs) {
        if (!isVisible(h)) continue;
        const level = Number(h.tagName.substring(1));
        const text = (h.textContent || "").trim().slice(0, 300);
        res.push({ level, text, selector: cssSelector(h) });
      }
      return res;
    }

    function collectLandmarks() {
      const tags = ["header", "nav", "main", "aside", "footer"] as const;
      const res: Array<{ tag: string; selector: string; visible: boolean }> = [];
      for (const tag of tags) {
        const el = document.querySelector(tag);
        if (!el) continue;
        res.push({ tag, selector: cssSelector(el), visible: isVisible(el) });
      }
      return res;
    }

    function collectActions(limit = 300) {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          "button, a, [role=button], input[type=submit], input[type=button]"
        )
      );
      const actions: Array<{
        tag: string;
        text: string;
        ariaLabel?: string;
        title?: string;
        disabled?: boolean;
        selector: string;
        visible: boolean;
      }> = [];
      for (const el of candidates) {
        if (actions.length >= limit) break;
        const visible = isVisible(el);
        const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120);
        const aria = el.getAttribute("aria-label") || undefined;
        const title = el.getAttribute("title") || undefined;
        const disabled =
          (el as HTMLButtonElement).disabled === true ||
          el.getAttribute("aria-disabled") === "true" ||
          getComputedStyle(el).pointerEvents === "none";
        actions.push({
          tag: el.tagName.toLowerCase(),
          text,
          ariaLabel: aria,
          title,
          disabled,
          selector: cssSelector(el),
          visible,
        });
      }
      return actions;
    }

    function detectPagination(actions: ReturnType<typeof collectActions>) {
      const iconOnly = new Set([">", "›", "»", "→"]);
      const hits = actions.filter((a) => {
        const t = (a.text || "").trim();
        const byText = /\bnext\b|下一页/i.test(t) || iconOnly.has(t);
        const byAria = /\bnext\b|forward|下一页/i.test(a.ariaLabel || "") || /\bnext\b/i.test(a.title || "");
        // Note: className not included in actions to keep output small; re-check DOM here
        let el: HTMLElement | null = null;
        let cls = "";
        try {
          el = document.querySelector(a.selector) as HTMLElement | null;
          cls = el?.className?.toString() || "";
        } catch (e) {
          console.warn("[crx-helper/content] invalid selector skipped:", a.selector);
        }
        const byClass = /chevron.*right|arrow.*right|pager.*next/i.test(cls);
        return (byText || byAria || byClass) && !a.disabled && a.visible;
      });
      return {
        hasNext: hits.length > 0,
        nextCandidates: hits.slice(0, 5),
      };
    }

    function buildCleanHtml() {
      try {
        const root = document.documentElement.cloneNode(true) as HTMLElement;
        // Remove noisy nodes
        const toRemove = root.querySelectorAll(
          'script, style, noscript, link[rel="stylesheet"], relingo-app, plasmo-csui, [data-wxt-shadow-root]'
        );
        toRemove.forEach((n) => n.remove());
        const ser = new XMLSerializer();
        return ser.serializeToString(root);
      } catch (e) {
        // Fallback to full document
        const ser = new XMLSerializer();
        return ser.serializeToString(document);
      }
    }

    async function downloadViaBackground(filename: string, data: string, mime: string) {
      try {
        await chrome.runtime.sendMessage({ type: "DOWNLOAD_FILE", filename, data, mime });
      } catch (e) {
        // Fallback to in-page anchor if messaging fails
        const blob = new Blob([data], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.documentElement.appendChild(a);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
          a.remove();
        }, 1000);
      }
    }

    function safeBaseName() {
      const base = (document.title || new URL(location.href).hostname || "page").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
      return base || "page";
    }

    function isVisible(el: Element) {
      const rect = (el as HTMLElement).getBoundingClientRect?.();
      const cs = getComputedStyle(el as HTMLElement);
      if (!rect) return true;
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
      if (rect.width <= 0 || rect.height <= 0) return false;
      // Consider off-screen still visible for analysis, so skip viewport check
      return true;
    }

    function cssSelector(el: Element): string {
      // Prefer id
      if (el.id && /^[A-Za-z][A-Za-z0-9_\-:.]*$/.test(el.id)) return `#${cssIdent(el.id)}`;
      // Prefer stable attributes
      const attrCandidates = ["data-testid", "data-qa", "aria-label", "name", "title", "role"];
      for (const attr of attrCandidates) {
        const v = el.getAttribute(attr);
        if (v && v.length <= 120) return `${el.tagName.toLowerCase()}[${attr}="${cssString(v)}"]`;
      }
      // Class-based with nth-of-type fallback
      const parts: string[] = [];
      let node: Element | null = el;
      let depth = 0;
      while (node && depth < 5) {
        const tag = node.tagName.toLowerCase();
        let seg = tag;
        const cls = (node.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) seg += "." + cls.map((c) => cssIdent(c)).join(".");
        const parent = node.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
          if (sameTag.length > 1) {
            const index = sameTag.indexOf(node as Element) + 1;
            seg += `:nth-of-type(${index})`;
          }
        }
        parts.unshift(seg);
        node = node.parentElement;
        depth++;
      }
      return parts.join(" > ");
    }

    function cssIdent(s: string) {
      try {
        // @ts-ignore
        if (window.CSS && typeof (window as any).CSS.escape === "function") {
          // @ts-ignore
          return (window as any).CSS.escape(s);
        }
      } catch {}
      // Fallback: escape anything not in [-_a-zA-Z0-9]
      return s.replace(/[^a-zA-Z0-9_-]/g, (ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return `\\${code.toString(16)} `;
      });
    }

    function cssString(s: string) {
      // Escape backslash and double-quote inside attribute value quotes
      return s.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
    }

    async function waitForStability(idleMs = 300, maxWaitMs = 5000) {
      const started = Date.now();
      return await new Promise<void>((resolve) => {
        let timer: number | undefined;
        const mo = new MutationObserver(() => {
          if (timer) clearTimeout(timer);
          timer = window.setTimeout(done, idleMs);
        });
        function done() {
          mo.disconnect();
          resolve();
        }
        mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        // Initial idle window
        timer = window.setTimeout(done, idleMs);
        // Hard timeout
        window.setTimeout(() => {
          mo.disconnect();
          resolve();
        }, Math.max(idleMs, maxWaitMs - (Date.now() - started)));
      });
    }
  },
});
