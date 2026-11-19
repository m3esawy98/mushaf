// توقيت آيات تلاوة المنشاوي (مرتل) جوه ملف السورة الكاملة — بيجيبه من Quran.com ويرجّعه مختصر
// GET /api/timing?s=2        → { s, url, t: [[from,to], ...] }  (بالمللي ثانية، عنصر لكل آية)
// GET /api/timing?s=2&debug  → تفاصيل المحاولات لو حصلت مشكلة
const RECITER = 9; // محمد صديق المنشاوي — مرتل (Quran.com)

const SOURCES = [
  s => `https://api.qurancdn.com/api/qdc/audio/reciters/${RECITER}/audio_files?chapter=${s}&segments=true`,
  s => `https://api.quran.com/api/qdc/audio/reciters/${RECITER}/audio_files?chapter=${s}&segments=true`,
  s => `https://api.quran.com/api/v4/chapter_recitations/${RECITER}/${s}?segments=true`
];

function pick(json){
  // qdc: { audio_files: [ { audio_url, verse_timings: [ {verse_key, timestamp_from, timestamp_to} ] } ] }
  // v4 : { audio_file: { audio_url, timestamps: [ ... ] } }
  const f = (json && (Array.isArray(json.audio_files) ? json.audio_files[0] : json.audio_file)) || null;
  if(!f) return null;
  const list = f.verse_timings || f.timestamps || [];
  if(!f.audio_url || !list.length) return null;
  return { url: f.audio_url, list };
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const s = parseInt(q.s, 10);
  if(!(s >= 1 && s <= 114)){ res.status(400).json({ error: "s لازم يبقى من 1 لـ 114" }); return; }
  const tries = [];
  for(const make of SOURCES){
    const src = make(s);
    try{
      const r = await fetch(src, { headers: { accept: "application/json", "user-agent": "mushaf-app" } });
      if(!r.ok){ tries.push({ src, status: r.status }); continue; }
      const got = pick(await r.json());
      if(!got){ tries.push({ src, status: r.status, note: "شكل البيانات مختلف" }); continue; }
      const t = [];
      for(const v of got.list){
        const a = parseInt(String(v.verse_key || "").split(":")[1], 10);
        if(a >= 1) t[a-1] = [Math.max(0, Math.round(v.timestamp_from)), Math.max(0, Math.round(v.timestamp_to))];
      }
      for(let i = 0; i < t.length; i++) if(!t[i]) t[i] = null;
      if("debug" in q){ res.status(200).json({ ok: true, src, ayahs: t.length, url: got.url, first: t.slice(0, 3), tries }); return; }
      res.setHeader("Cache-Control", "public, s-maxage=2592000, max-age=604800");
      res.status(200).json({ s, url: got.url, t });
      return;
    }catch(e){ tries.push({ src, error: String(e && e.message || e) }); }
  }
  res.status(502).json({ error: "مقدرناش نجيب التوقيت", tries });
};
