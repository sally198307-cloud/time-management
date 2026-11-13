(function(){
"use strict";
// Same-origin Cloudflare Workers + D1 storage. Cloudflare Access protects
// /food-journal and /api/food-journal, just as it protects time-management.
function makeCloud(bridge){
 const enabledKey="fj_cloudflare_sync_enabled_v1";
 let enabled=localStorage.getItem(enabledKey)==="yes";
 let busy=false, timer=null, status=enabled?"準備連線同步":"尚未啟用雲端同步";
 let shadow={}, lastError="", connected=false;
 const types=["meals","waters","library","reports"];
 const recordKey=(type,id)=>type+":"+id;
 function snapshot(data){
  const out={};
  for(const type of ["meals","waters","library"])for(const x of data[type]||[]){
   if(!x||!x.id)continue;
   out[recordKey(type,String(x.id))]={type,id:String(x.id),payload:x};
  }
  for(const [day,x] of Object.entries(data.reports||{}))out[recordKey("reports",day)]={type:"reports",id:day,payload:x};
  return out;
 }
 const safe=s=>String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 function panel(){
  return '<section class="card" id="fjCloudPanel"><div class="row"><h3 style="margin:0">☁️ 同步到雲端</h3><span class="small muted">'+(enabled?"已啟用":"未啟用")+'</span></div>'+
  '<p class="help">與「時間管理」使用同一個 Cloudflare Workers＋D1 雲端，資料分開存放。Safari 和主畫面 App 要開啟同一個 Cloudflare 網址，並通過 Cloudflare Access 驗證。</p>'+
  '<div class="note" style="margin:10px 0">'+safe(status)+'</div>'+
  '<div class="actions">'+(!enabled?'<button class="btn" id="syncEnable">合併並啟用同步</button>':'<button class="btn" id="syncNow" '+(busy?'disabled':'')+'>立即同步</button>')+
  '<button class="btn outline" id="syncBackup">下載 JSON 備份</button></div>'+
  '<p class="help">舊版 GitHub Pages 的 Safari 紀錄不會自動搬過來。請先從原網址的「週報」下載 JSON，接著在這個雲端網站匯入一次，最後啟用同步。不同裝置改同一筆資料時仍可能有衝突，請定期備份。</p></section>';
 }
 function refresh(){const root=document.getElementById("fjCloudPanel");if(root)root.outerHTML=panel()}
 function trackChanges(){
  const data=bridge.get(),current=snapshot(data);
  data._syncVersions=data._syncVersions||{};
  let ts=Date.now()*1000;
  for(const key of new Set([...Object.keys(shadow),...Object.keys(current)])){
   if(JSON.stringify(current[key]||null)!==JSON.stringify(shadow[key]||null)){
    const prior=Number(data._syncVersions[key]?.t||0);
    ts=Math.max(ts+1,prior+1);
    data._syncVersions[key]={t:ts,deleted:!current[key]};
   }
  }
  shadow=snapshot(data);
  if(enabled)queue();
 }
 function queue(){
  if(timer)clearTimeout(timer);
  timer=setTimeout(()=>{timer=null;sync()},1800);
 }
 function collect(data){
  const list=snapshot(data),v=data._syncVersions||{},out={};
  for(const [k,x] of Object.entries(list))out[k]={...x,t:Number(v[k]?.t)||0,deleted:false};
  for(const [k,x] of Object.entries(v)){
   if(!x.deleted||out[k])continue;
   const i=k.indexOf(":");if(i<0)continue;
   out[k]={type:k.slice(0,i),id:k.slice(i+1),payload:null,t:Number(x.t)||0,deleted:true};
  }
  return out;
 }
 function apply(data,r){
  if(!types.includes(r.type))return;
  if(r.type==="reports"){
   data.reports=data.reports||{};
   if(r.deleted)delete data.reports[r.id];
   else data.reports[r.id]=r.payload;
  }else{
   data[r.type]=data[r.type]||[];
   const idx=data[r.type].findIndex(x=>String(x.id)===r.id);
   if(r.deleted){if(idx>=0)data[r.type].splice(idx,1)}
   else if(idx>=0)data[r.type][idx]=r.payload;
   else data[r.type].push(r.payload);
  }
  data._syncVersions=data._syncVersions||{};
  data._syncVersions[recordKey(r.type,r.id)]={t:Number(r.t)||0,deleted:!!r.deleted};
 }
 async function request(method,items){
  const response=await fetch("/api/food-journal",{method,headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",body:items?JSON.stringify({items}):undefined});
  const ct=response.headers.get("content-type")||"";
  if(!ct.includes("application/json"))throw Error("尚未通過時間管理網站的 Cloudflare Access 驗證，或新版 Worker 尚未部署");
  const result=await response.json();
  if(!response.ok)throw Error(result.error||("HTTP "+response.status));
  return result;
 }
 async function sync(){
  if(!enabled||busy)return;
  busy=true;status="正在比對雲端資料";refresh();
  try{
   const response=await request("GET"),remote=response.items||[];
   const data=bridge.get(),local=collect(data),rem=new Map(remote.map(x=>[recordKey(x.type,x.id),x]));
   let changed=0;
   // Pull first, then upload only records not present or newer on the device.
   for(const r of remote){
    const k=recordKey(r.type,r.id),v=local[k]?.t??-1;
    if(Number(r.t)>v){apply(data,r);changed++}
   }
   if(changed)await bridge.saveMerged(data);
   const uploads=[];
   for(const [k,r] of Object.entries(local)){
    const older=rem.get(k);
    if(older&&r.t<=Number(older.t))continue;
    const t=r.t||Date.now()*1000;
    uploads.push({...r,t});
   }
   // Each entry may contain encoded photos: send individually to limit request size.
   for(const item of uploads){
    await request("PUT",[item]);
    data._syncVersions=data._syncVersions||{};
    data._syncVersions[recordKey(item.type,item.id)]={t:item.t,deleted:item.deleted};
   }
   if(uploads.length)await bridge.saveMerged(data);
   shadow=snapshot(data);connected=true;lastError="";
   status="同步成功：已讀取 "+remote.length+" 筆雲端資料，更新 "+changed+" 筆、上傳 "+uploads.length+" 筆。";
  }catch(err){lastError=String(err?.message||err);status="同步失敗，本機紀錄仍保留："+lastError;connected=false}
  finally{busy=false;refresh()}
 }
 async function click(id){
  if(id==="syncBackup"){bridge.backup();return true}
  if(id==="syncEnable"){
   if(!confirm("請先確認已下載目前裝置的 JSON 備份。啟用後會合併本機與雲端的餐點、照片和每日回報，確定繼續？"))return true;
   enabled=true;localStorage.setItem(enabledKey,"yes");refresh();await sync();return true;
  }
  if(id==="syncNow"){await sync();return true}
  return false;
 }
 document.addEventListener("visibilitychange",()=>{if(!document.hidden&&enabled)sync()});
 window.addEventListener("online",()=>{if(enabled)sync()});
 setInterval(()=>{if(!document.hidden&&enabled)sync()},60000);
 return {panel,init:()=>{shadow=snapshot(bridge.get());if(enabled)sync()},trackChanges,click,sync};
}
window.FoodJournalCloud={create:makeCloud};
})();