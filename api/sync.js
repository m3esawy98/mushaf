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
// قاعدة البيانات: Supabase (جدول mushaf_sync) أو Upstash Redis — اللي متاح في متغيرات Vercel
function sbEnv(){
  const E = process.env;
  const url = E.SUPABASE_URL || E.NEXT_PUBLIC_SUPABASE_URL;
  const key = E.SUPABASE_SECRET_KEY || E.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}
function upEnv(){
  const E = process.env, keys = Object.keys(E);
  const pick = re => { const k = keys.find(k => re.test(k) && E[k]); return k ? E[k] : undefined; };
  const url = E.KV_REST_API_URL || E.UPSTASH_REDIS_REST_URL || pick(/(^|_)(KV_REST_API_URL|REDIS_REST_URL)$/);
  const token = E.KV_REST_API_TOKEN || E.UPSTASH_REDIS_REST_TOKEN || pick(/(^|_)(KV_REST_API_TOKEN|REDIS_REST_TOKEN)$/);
  return url && token ? { url, token } : null;
}
function backend(){
  const sb = sbEnv();
  if(sb){
    const h = { apikey: sb.key, "Content-Type": "application/json" };
    if(!sb.key.startsWith("sb_")) h.Authorization = "Bearer " + sb.key;   // مفاتيح JWT القديمة
    const T = sb.url + "/rest/v1/mushaf_sync";
    return { name: "supabase",
      async get(code){ const r = await fetch(`${T}?code=eq.${encodeURIComponent(code)}&select=doc`, { headers: h });
        if(!r.ok) throw new Error("sb_" + r.status); const j = await r.json(); return j.length ? j[0].doc : null; },
      async create(code, doc){ const r = await fetch(T, { method: "POST", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ code, doc }) });
        if(r.status === 409) return false; if(!r.ok) throw new Error("sb_" + r.status); return true; },
      async put(code, doc){ const r = await fetch(`${T}?code=eq.${encodeURIComponent(code)}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ doc, updated_at: new Date().toISOString() }) });
        if(!r.ok) throw new Error("sb_" + r.status); },
      async ping(){ const r = await fetch(`${T}?select=code&limit=1`, { headers: h }); return r.ok ? "ok" : (r.status === 404 ? "table_missing" : "error_" + r.status); } };
  }
  const up = upEnv();
  if(up){
    const redis = async cmd => { const r = await fetch(up.url, { method: "POST", headers: { Authorization: "Bearer " + up.token, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
      const j = await r.json(); if(j.error) throw new Error(j.error); return j.result; };
    const K = c => "mushaf:sync:" + c;
    return { name: "upstash",
      async get(code){ const raw = await redis(["GET", K(code)]); return raw ? JSON.parse(raw) : null; },
      async create(code, doc){ return !!(await redis(["SET", K(code), JSON.stringify(doc), "NX"])); },
      async put(code, doc){ await redis(["SET", K(code), JSON.stringify(doc)]); },
      async ping(){ try{ return (await redis(["PING"])) === "PONG" ? "ok" : "error"; }catch(e){ return "error"; } } };
  }
  return null;
}
function clean(doc){
  const out = { bm: {}, tdb: {}, last: null };
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
  if(doc && doc.tdb && typeof doc.tdb === "object"){
    for(const [k, v] of Object.entries(doc.tdb).slice(0, 3000)){
      const m = /^(\d{1,3}):(\d{1,3})-(\d{1,3})$/.exec(k), t = Number(v && v.t);
      if(!m || !(t > 0)) continue;
      const s = +m[1], a = +m[2], b = +m[3];
      if(s < 1 || s > 114 || a < 1 || b < a || b > 286) continue;
      if(v.d){ out.tdb[k] = { t: Math.floor(t), d: 1 }; continue; }
      const g = Array.isArray(v.g) ? v.g.filter(x => typeof x === "string" && x.trim()).slice(0, 10).map(x => x.trim().slice(0, 30)) : [];
      out.tdb[k] = { t: Math.floor(t), s, a, b, n: typeof v.n === "string" ? v.n.slice(0, 2000) : "", g };
    }
  }
  if(doc && doc.last){ const p = parseInt(doc.last.p, 10), t = Number(doc.last.t);
    if(p >= 1 && p <= 608 && t > 0) out.last = { p, t: Math.floor(t) }; }
  // علامة التفسير: واحدة بس
  if(doc && doc.tfbm && Number(doc.tfbm.t) > 0){ const v = doc.tfbm, t = Math.floor(Number(v.t));
    if(v.d) out.tfbm = { t, d: 1 };
    else { const s = parseInt(v.s, 10), a = parseInt(v.a, 10), b = parseInt(v.b, 10) || a;
      if(s >= 1 && s <= 114 && a >= 1 && a <= 286 && b >= a && b <= 286) out.tfbm = { s, a, b, t, tf: typeof v.tf === "string" ? v.tf.slice(0, 20) : "" }; } }
  if(doc && doc.lsbm && Number(doc.lsbm.t) > 0){ const v = doc.lsbm, t = Math.floor(Number(v.t));
    if(v.d) out.lsbm = { t, d: 1 };
    else { const s = parseInt(v.s, 10), a = parseInt(v.a, 10);
      if(s >= 1 && s <= 114 && a >= 1 && a <= 286) out.lsbm = { s, a, t }; } }
  return out;
}
function merge(a, b){
  const out = { bm: { ...a.bm }, tdb: { ...(a.tdb || {}) }, last: a.last };
  for(const [k, e] of Object.entries(b.tdb || {})) if(!out.tdb[k] || e.t > out.tdb[k].t) out.tdb[k] = e;
  for(const [p, e] of Object.entries(b.bm)) if(!out.bm[p] || e.t > out.bm[p].t) out.bm[p] = e;
  if(b.last && (!out.last || b.last.t > out.last.t)) out.last = b.last;
  out.tfbm = a.tfbm;
  if(b.tfbm && (!out.tfbm || b.tfbm.t > out.tfbm.t)) out.tfbm = b.tfbm;
  if(!out.tfbm) delete out.tfbm;
  out.lsbm = a.lsbm;
  if(b.lsbm && (!out.lsbm || b.lsbm.t > out.lsbm.t)) out.lsbm = b.lsbm;
  if(!out.lsbm) delete out.lsbm;
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const db = backend();
  if(req.method === "GET" && req.query && req.query.check !== undefined){
    // فحص: بيرجّع أسماء المتغيرات بس، من غير قيمها
    const names = Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH|SUPABASE|POSTGRES/i.test(k)).sort();
    let ping = null; if(db){ try{ ping = await db.ping(); }catch(e){ ping = "error"; } }
    return res.json({ configured: !!db, backend: db ? db.name : null, ping, env_names: names });
  }
  if(!db) return res.status(503).json({ error: "not_configured" });
  try{
    if(req.method === "GET"){
      const code = canon(String(req.query.code || ""));
      if(!code) return res.status(400).json({ error: "bad_code" });
      const doc = await db.get(code);
      if(!doc) return res.status(404).json({ error: "not_found" });
      return res.json({ code, doc });
    }
    if(req.method === "POST"){
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if(body.action === "create"){
        const doc = clean(body.doc);
        for(let i = 0; i < 6; i++){ const code = newCode(); if(await db.create(code, doc)) return res.json({ code, doc }); }
        return res.status(500).json({ error: "busy" });
      }
      const code = canon(String(body.code || ""));
      if(!code) return res.status(400).json({ error: "bad_code" });
      const cur = await db.get(code);
      if(!cur) return res.status(404).json({ error: "not_found" });
      const merged = merge(clean(cur), clean(body.doc));
      if(JSON.stringify(merged).length > 200000) return res.status(413).json({ error: "too_big" });
      await db.put(code, merged);
      return res.json({ code, doc: merged });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method" });
  }catch(e){
    return res.status(500).json({ error: "server" });
  }
};
module.exports.canon = canon; module.exports.merge = merge; module.exports.clean = clean;
