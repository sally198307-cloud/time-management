// Food journal storage shares the existing protected Worker + D1 deployment,
// but uses separate, namespaced records (never touches calendar state).
// Cloudflare Access must protect ALL routes including /api/food-journal.
const PREFIX = "food-journal-v2:";
const TYPES = new Set(["meals","waters","library","reports"]);
const HEADERS = {"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const output = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
function parseRecord(x){
  if(!x||typeof x!=="object"||!TYPES.has(x.type)||typeof x.id!=="string"||!x.id||x.id.length>140||!/^[-a-zA-Z0-9_:]+$/.test(x.id))return null;
  const t=Number(x.t);
  if(!Number.isSafeInteger(t)||t<0)return null;
  const deleted=x.deleted===true;
  if(!deleted&&(x.payload===null||typeof x.payload!=="object"||Array.isArray(x.payload)))return null;
  return {type:x.type,id:x.id,t,deleted,payload:deleted?null:x.payload};
}
export async function handleFoodJournal(request,env){
  if(!env.DB)return output({error:"D1 未設定"},503);
  // This endpoint must be behind the existing Cloudflare Access 'All traffic' policy.
  // The identity header is set by Access after a successful authentication.
  // Cloudflare Access protects the Worker at the edge. Its assertion carries
  // the authenticated email even when the injected email header is absent.
  const assertion=request.headers.get("Cf-Access-Jwt-Assertion");
  let email=request.headers.get("Cf-Access-Authenticated-User-Email");
  if(!email&&assertion){
    try{
      const payload=assertion.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
      email=JSON.parse(atob(payload)).email||null;
    }catch{}
  }
  if(!email||!assertion)return output({error:"請先通過 Cloudflare Access 電子郵件驗證"},401);
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(email.trim().toLowerCase()));
  const owner=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  const prefix=PREFIX+owner+":";
  if(request.method==="GET"){
    const rows=await env.DB.prepare("SELECT user_id,state_json FROM user_state WHERE substr(user_id,1,?) = ? ORDER BY user_id LIMIT 10000").bind(prefix.length,prefix).all();
    const items=[];
    for(const row of rows.results||[]){
      try{const x=JSON.parse(row.state_json);if(parseRecord(x))items.push(x)}catch{}
    }
    return output({items});
  }
  if(request.method!=="PUT")return output({error:"不支援的操作"},405);
  const origin=request.headers.get("Origin");
  if(origin&&origin!==new URL(request.url).origin)return output({error:"請由原網站同步"},403);
  const size=Number(request.headers.get("content-length")||0);
  if(size>1800000)return output({error:"同步資料太大，請先減少單筆照片大小並備份"},413);
  let body;
  try{body=await request.json()}catch{return output({error:"資料格式錯誤"},400)}
  const input=body?.items;
  if(!Array.isArray(input)||input.length===0||input.length>5)return output({error:"每次只能上傳 1 到 5 筆紀錄"},400);
  const prepared=[];
  for(const obj of input){
    const rec=parseRecord(obj);
    if(!rec)return output({error:"資料格式不正確"},400);
    const text=JSON.stringify(rec);
    if(text.length>1400000)return output({error:"單筆資料或照片太大，請先下載 JSON 備份"},413);
    prepared.push({key:prefix+rec.type+":"+rec.id,text,t:rec.t});
  }
  const results=await env.DB.batch(prepared.map(r=>env.DB.prepare(
    "INSERT INTO user_state(user_id,state_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) "+
    "ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP "+
    "WHERE CAST(json_extract(user_state.state_json,'$.t') AS INTEGER)<=?"
  ).bind(r.key,r.text,r.t)));
  return output({ok:true,processed:results.length});
}
