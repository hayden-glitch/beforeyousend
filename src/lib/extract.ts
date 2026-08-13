// REAL CONTENT SORT (owner 2026-08-11): on-device text extraction for Sort My
// Pile. PDFs (multi-page, text layer), .txt, .docx, and .zip containers — each
// contained file becomes ONE unit classified from ITS OWN full text. Scanned
// photos/PDFs return readable:false (honest "needs sorting" — no OCR claims
// anywhere). File bytes NEVER leave the device: only the extracted text (<=10k
// chars per paper) is POSTed.
//
// CRITICAL: pdfjs-dist and jszip are dynamically imported ONLY inside these
// functions — never at module top level — so the SSR/server bundle never
// includes them; Vite emits them as lazy client chunks.
export type ExtractUnit = {
  localId: string;
  name: string; // file name; zip entries carry their full relative path
  text: string; // extracted text, truncated to MAX_SEND_CHARS (what we POST)
  fullText: string; // extracted text, truncated to MAX_EXTRACT_CHARS
  readable: boolean;
  blockReason?: "oversize" | "unknown" | "empty" | "corrupt" | "nested-zip";
};

export type ExtractCallbacks = {
  onPage?: (p: number, n: number) => void; // PDF page progress (counts only)
};

export const MAX_RAW_BYTES = 25 * 1024 * 1024; // "Up to 25 MB per file."
export const MAX_EXTRACT_CHARS = 25000;
export const MAX_SEND_CHARS = 10000;

function localId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function truncate(text: string): { text: string; fullText: string } {
  const clean = String(text || "").replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return { text: clean.slice(0, MAX_SEND_CHARS), fullText: clean.slice(0, MAX_EXTRACT_CHARS) };
}

function unreadable(name: string, reason: ExtractUnit["blockReason"]): ExtractUnit {
  return { localId: localId(), name, text: "", fullText: "", readable: false, blockReason: reason };
}

function extOf(name: string): string {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

async function readTxtEntry(name: string, read: () => Promise<string>): Promise<ExtractUnit> {
  let raw = "";
  try {
    raw = (await read()) || "";
  } catch {
    return unreadable(name, "corrupt");
  }
  const { text, fullText } = truncate(raw);
  if (!text) return unreadable(name, "empty");
  return { localId: localId(), name, text, fullText, readable: true };
}

async function readPdfEntry(name: string, data: ArrayBuffer, cb?: ExtractCallbacks): Promise<ExtractUnit> {
  let pdfjs: any;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    return unreadable(name, "corrupt");
  }
  let doc: any = null;
  try {
    // pdfjs-dist v4+ IGNORES disableWorker:true and always spawns a real worker
    // from GlobalWorkerOptions.workerSrc — with it unset every getDocument
    // throws 'No "GlobalWorkerOptions.workerSrc" specified' and every PDF
    // degrades to "Can't read this one". Resolve the worker asset URL lazily
    // inside this client-only branch (Vite emits the file as a hashed static
    // asset via the ?url import) so the SSR/server bundle never sees it.
    // Naively pointing workerSrc at the main bundle hangs the tab — the real
    // pdfjs worker file is required.
    if (!pdfjs.GlobalWorkerOptions?.workerSrc) {
      try {
        const w = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = w.default || w;
      } catch {
        // leave unset — getDocument below will fail loudly rather than hang
      }
    }
    doc = await pdfjs.getDocument({ data, disableWorker: true, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      cb?.onPage?.(p, doc.numPages);
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const line = tc.items.map((it: any) => (typeof it?.str === "string" ? it.str : "")).join(" ");
      if (line.trim()) pages.push("--- Page " + p + " ---\n" + line.trim());
      page.cleanup();
      // Yield to the UI thread between pages so the progress line repaints.
      await new Promise((r) => setTimeout(r, 0));
    }
    doc.destroy?.();
    const { text, fullText } = truncate(pages.join("\n\n"));
    if (!text) return unreadable(name, "empty"); // image-only/scanned PDF
    return { localId: localId(), name, text, fullText, readable: true };
  } catch {
    try { doc?.destroy?.(); } catch {}
    return unreadable(name, "corrupt");
  }
}

async function readDocxEntry(name: string, data: ArrayBuffer): Promise<ExtractUnit> {
  let JSZip: any;
  try {
    JSZip = await import("jszip");
  } catch {
    return unreadable(name, "corrupt");
  }
  try {
    const zip = await JSZip.loadAsync(data);
    const doc = zip.file("word/document.xml");
    if (!doc) return unreadable(name, "corrupt");
    const xml = await doc.async("string");
    const dom = new DOMParser().parseFromString(xml, "application/xml");
    const bodyText = (dom.getElementsByTagName("w:t").length
      ? Array.from(dom.getElementsByTagName("w:t")).map((n) => n.textContent || "").join("")
      : (dom.documentElement.textContent || "").replace(/\s+/g, " ")
    ).replace(/\r/g, "");
    // Word packs runs per inline element; add paragraph breaks from w:p.
    const paras = dom.getElementsByTagName("w:p");
    if (paras.length) {
      const out: string[] = [];
      for (const p of Array.from(paras)) {
        const t = Array.from(p.getElementsByTagName("w:t")).map((n) => n.textContent || "").join("");
        if (t.trim()) out.push(t.trim());
      }
      const { text, fullText } = truncate(out.join("\n"));
      if (!text) return unreadable(name, "empty");
      return { localId: localId(), name, text, fullText, readable: true };
    }
    const { text, fullText } = truncate(bodyText);
    if (!text) return unreadable(name, "empty");
    return { localId: localId(), name, text, fullText, readable: true };
  } catch {
    return unreadable(name, "corrupt");
  }
}

async function readZipEntry(name: string, entry: any, cb?: ExtractCallbacks): Promise<ExtractUnit> {
  const ext = extOf(name);
  if (ext === "txt") return readTxtEntry(name, () => entry.async("string"));
  if (ext === "pdf") {
    try {
      const buf = await entry.async("arraybuffer");
      return await readPdfEntry(name, buf, cb);
    } catch {
      return unreadable(name, "corrupt");
    }
  }
  if (ext === "docx") {
    try {
      const buf = await entry.async("arraybuffer");
      return await readDocxEntry(name, buf);
    } catch {
      return unreadable(name, "corrupt");
    }
  }
  if (ext === "zip") return unreadable(name, "nested-zip");
  return unreadable(name, "unknown");
}

async function expandZip(file: File, cb?: ExtractCallbacks): Promise<ExtractUnit[]> {
  let JSZip: any;
  try {
    JSZip = await import("jszip");
  } catch {
    return [unreadable(file.name, "corrupt")];
  }
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = Object.keys(zip.files)
      .filter((p) => !zip.files[p].dir)
      .map((p) => ({ path: p, entry: zip.files[p] }));
    if (entries.length === 0) return [unreadable(file.name, "empty")];
    // One unit per entry; dedupe by RELATIVE PATH (two same-basename entries in
    // different zip folders are distinct papers — fixes the old by-name dedupe).
    const seen = new Set<string>();
    const units: ExtractUnit[] = [];
    for (const e of entries) {
      if (seen.has(e.path)) continue;
      seen.add(e.path);
      units.push(await readZipEntry(e.path, e.entry, cb));
    }
    return units;
  } catch {
    return [unreadable(file.name, "corrupt")];
  }
}

// Extract ONE picked file into units. A plain file yields one unit; a .zip
// yields one unit per contained file (the zip itself is never a unit; nested
// zips and image entries become readable:false units with a calm reason).
export async function extractFile(file: File, cb?: ExtractCallbacks): Promise<ExtractUnit[]> {
  const name = String(file?.name || "paper").slice(0, 120);
  if (!file || file.size <= 0) return [unreadable(name, "empty")];
  if (file.size > MAX_RAW_BYTES) return [unreadable(name, "oversize")];
  const ext = extOf(name);
  try {
    if (ext === "txt") return [await readTxtEntry(name, () => file.text())];
    if (ext === "pdf") return [await readPdfEntry(name, await file.arrayBuffer(), cb)];
    if (ext === "docx") return [await readDocxEntry(name, await file.arrayBuffer())];
    if (ext === "zip") return await expandZip(file, cb);
    return [unreadable(name, "unknown")]; // photos/scans — honest, no OCR
  } catch {
    return [unreadable(name, "corrupt")];
  }
}
