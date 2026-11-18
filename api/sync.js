// مزامنة العلامات وآخر صفحة بين الأجهزة بكود — بيستخدم Upstash Redis (من Vercel Marketplace)
const WORDS = ["نور","قمر","شمس","نجم","بحر","نهر","جبل","وادي","زهر","ورد","ريحان","نخل","زيتون","تين","رمان","عنب",
  "سحاب","مطر","ندى","فجر","ضحى","شروق","غروب","صبح","ليل","نسيم","موج","شاطئ","واحة","بستان","حديقة","غصن",
  "طير","حمام","صقر","غزال","نحل","عسل","لبن","خبز","ملح","سكر","كتاب","قلم","لوح","مداد","مصباح","سراج",
  "باب","بيت","سقف","جسر","طريق","سفينة","شراع","مرسى","منار","نبع","بئر","غيث","ربيع","صيف","خريف","شتاء",
  "حجر","ذهب","فضة","لؤلؤ","مرجان","ياقوت","زمرد","عقيق","ضياء","هدى","سلام","أمان","رضا","صبر","شكر","يقين",
  "فرح","أمل","بركة","خير","رحمة","حكمة","علم","فهم","نجاح","فلاح","سعد","جود","كرم","وفاء","صدق","عدل"];
const toAsciiDigits = s => s.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
function canon(code){
  if(typeof code !== "string") return null;
  const parts = toAsciiDigits(code).trim().split(/[\s\-ـ_.،,]+/).filter(Boolean);
  if(parts.length !== 3) return null;
  const [a, n, b] = parts;
  if(!WORDS.includes(a) || !WORDS.includes(b) || !/^\d{4}$/.test(n)) return null;
  return `${a}-${n}-${b}`;
}
function newCode(){
  const r = new Uint32Array(3); require("crypto").webcrypto.getRandomValues(r);
  return `${WORDS[r[0] % WORDS.length]}-${String(r[1] % 10000).padStart(4,"0")}-${WORDS[r[2] % WORDS.length]}`;
}
// بيدوّر على بيانات Upstash بأي بادئة (KV_ أو UPSTASH_ أو أي اسم اتكتب وقت الربط)
function env(){
  const E = process.env, keys = Object.keys(E);
  const pick = re => { const k = keys.find(k => re.test(k) && E[k]); return k ? E[k] : undefined; };
  const url = E.KV_REST_API_URL || E.UPSTASH_REDIS_REST_URL || pick(/(^|_)(KV_REST_API_URL|REDIS_REST_URL|REST_API_URL)$/);
  const token = E.KV_REST_API_TOKEN || E.UPSTASH_REDIS_REST_TOKEN || pick(/(^|_)(KV_REST_API_TOKEN|REDIS_REST_TOKEN|REST_API_TOKEN)$/);
  return { url, token };
}
async function redis(cmd){
  const { url, token } = env();
  const r = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if(j.error) throw new Error(j.error);
  return j.result;
}
function clean(doc){
  const out = { bm: {}, last: null };
  if(doc && typeof doc.bm === "object"){
    for(const [k, v] of Object.entries(doc.bm).slice(0, 2000)){
      const p = parseInt(k, 10), t = Number(v && v.t);
      if(!(p >= 1 && p <= 608) || !(t > 0)) continue;
      const e = { t: Math.floor(t) };
      if(v.d) e.d = 1;
      if(Number.isInteger(v.a) && v.a > 0 && v.a < 300) e.a = v.a;
      out.bm[p] = e;
    }
  }
  if(doc && doc.last){ const p = parseInt(doc.last.p, 10), t = Number(doc.last.t);
    if(p >= 1 && p <= 608 && t > 0) out.last = { p, t: Math.floor(t) }; }
  return out;
}
function merge(a, b){
  const out = { bm: { ...a.bm }, last: a.last };
  for(const [p, e] of Object.entries(b.bm)) if(!out.bm[p] || e.t > out.bm[p].t) out.bm[p] = e;
  if(b.last && (!out.last || b.last.t > out.last.t)) out.last = b.last;
  return out;
}
const KEY = c => "mushaf:sync:" + c;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const { url, token } = env();
  if(req.method === "GET" && req.query && req.query.check !== undefined){
    // فحص: بيرجّع أسماء المتغيرات بس، من غير قيمها
    const names = Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH|STORAGE/i.test(k)).sort();
    let ping = null;
    if(url && token){ try{ ping = await redis(["PING"]); }catch(e){ ping = "error"; } }
    return res.json({ configured: !!(url && token), ping, env_names: names });
  }
  if(!url || !token) return res.status(503).json({ error: "not_configured" });
  try{
    if(req.method === "GET"){
      const code = canon(String(req.query.code || ""));
      if(!code) return res.status(400).json({ error: "bad_code" });
      const raw = await redis(["GET", KEY(code)]);
      if(!raw) return res.status(404).json({ error: "not_found" });
      return res.json({ code, doc: JSON.parse(raw) });
    }
    if(req.method === "POST"){
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if(body.action === "create"){
        for(let i = 0; i < 6; i++){
          const code = newCode();
          const ok = await redis(["SET", KEY(code), JSON.stringify(clean(body.doc)), "NX"]);
          if(ok) return res.json({ code, doc: clean(body.doc) });
        }
        return res.status(500).json({ error: "busy" });
      }
      const code = canon(String(body.code || ""));
      if(!code) return res.status(400).json({ error: "bad_code" });
      const raw = await redis(["GET", KEY(code)]);
      if(!raw) return res.status(404).json({ error: "not_found" });
      const merged = merge(clean(JSON.parse(raw)), clean(body.doc));
      if(JSON.stringify(merged).length > 200000) return res.status(413).json({ error: "too_big" });
      await redis(["SET", KEY(code), JSON.stringify(merged)]);
      return res.json({ code, doc: merged });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method" });
  }catch(e){
    return res.status(500).json({ error: "server" });
  }
};
module.exports.canon = canon; module.exports.merge = merge; module.exports.clean = clean;
