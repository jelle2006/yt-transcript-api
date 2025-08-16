import { parseStringPromise } from "xml2js";

// Vercel Serverless Function: GET /transcript?videoId=...&lang=auto|nl|en|...
export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    const { videoId, lang = "auto" } = req.query || {};
    if (!videoId || typeof videoId !== "string") {
      res.status(400).json({ error: "Missing or invalid ?videoId" });
      return;
    }

    // 1) Haal lijst met beschikbare caption-tracks op
    const listUrl = `https://www.youtube.com/api/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
    const listXml = await fetch(listUrl).then(r => {
      if (!r.ok) throw new Error(`tracklist HTTP ${r.status}`);
      return r.text();
    });

    const listJson = await parseStringPromise(listXml, { explicitArray: true, explicitCharkey: true });
    const tracks = (listJson?.transcript_list?.track || []).map(t => t.$);

    if (!tracks.length) {
      res.status(404).json({ videoId, hasCaptions: false, lines: [] });
      return;
    }

    // 2) Kies beste track
    const pickTrack = () => {
      if (lang && lang !== "auto") {
        const exact = tracks.find(t => (t.lang_code || "").toLowerCase().startsWith(lang.toLowerCase()));
        if (exact) return exact;
      }
      // Geef voorkeur aan 'asr' (auto captions) of 'default'
      const asr = tracks.find(t => (t.kind || "").toLowerCase() === "asr");
      if (asr) return asr;
      const def = tracks.find(t => t.default === "true");
      if (def) return def;
      return tracks[0];
    };
    const track = pickTrack();
    const langCode = track.lang_code;

    // 3) Haal het transcript zelf op (XML met <text start=".." dur="..">..</text>)
    const transcriptUrl =
      `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(langCode)}`;
    const transcriptXml = await fetch(transcriptUrl).then(r => {
      if (!r.ok) throw new Error(`transcript HTTP ${r.status}`);
      return r.text();
    });

    const transcriptJson = await parseStringPromise(transcriptXml, { explicitArray: true, explicitCharkey: true });
    const nodes = transcriptJson?.transcript?.text || [];

    const decode = (s) => (s || "")
      .replace(/&amp;/g,"&")
      .replace(/&lt;/g,"<")
      .replace(/&gt;/g,">")
      .replace(/&#39;/g,"'")
      .replace(/&quot;/g,'"');

    const lines = nodes.map(n => {
      const start = Number(n.$?.start || 0);
      const dur   = Number(n.$?.dur || 0);
      const text  = decode(n._ || "");
      return { start, dur, text };
    }).filter(x => x.text && x.text.trim().length);

    res.status(200).json({ videoId, hasCaptions: true, lang: langCode, lines });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}
