
// Create an actual PDF locally; no meal photos or report data leave this device.
// A4 pages rendered in Canvas keep traditional Chinese glyphs intact on iOS.
window.FoodJournalPDF = (function(){
 const W=1240,H=1754,M=82,MAX=H-100;
 const enc=new TextEncoder();
 function pdfBlob(pages){
  const parts=[],offsets=[0];let pos=0;
  const put=v=>{const b=typeof v==='string'?enc.encode(v):v;parts.push(b);pos+=b.byteLength};
  const obj=(id,body)=>{offsets[id]=pos;put(id+' 0 obj\n');put(body);put('\nendobj\n')};
  put('%PDF-1.4\n% Food Journal\n');
  const kids=pages.map((_,i)=>(3+i*3)+' 0 R').join(' ');
  obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
  obj(2,'<< /Type /Pages /Count '+pages.length+' /Kids ['+kids+'] >>');
  pages.forEach((bytes,i)=>{
   const page=3+i*3,im=page+1,content=page+2;
   obj(page,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 '+im+' 0 R >> >> /Contents '+content+' 0 R >>');
   offsets[im]=pos;put(im+' 0 obj\n<< /Type /XObject /Subtype /Image /Width '+W+' /Height '+H+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+bytes.byteLength+' >>\nstream\n');put(bytes);put('\nendstream\nendobj\n');
   const cmd='q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n';
   obj(content,'<< /Length '+enc.encode(cmd).length+' >>\nstream\n'+cmd+'endstream');
  });
  const xref=pos;put('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');
  for(let i=1;i<offsets.length;i++)put(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
  put('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
  return new Blob(parts,{type:'application/pdf'});
 }
 function loadImage(src){return new Promise(resolve=>{
  const img=new Image();let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v)};const timer=setTimeout(()=>finish(null),6000);
  img.onload=()=>finish(img);img.onerror=()=>finish(null);img.src=src;
 })}
 function canvasJPEG(c){return new Promise((resolve,reject)=>c.toBlob(async b=>{try{if(!b)throw Error('無法建立 PDF 頁面');resolve(new Uint8Array(await b.arrayBuffer()))}catch(e){reject(e)}},'image/jpeg',0.86))}
 async function build(days){
  const pages=[];let c,ctx,y,current,pageNum=0;
  const ink='#303c31',muted='#686d65',line='#d9d8cf',paper='#fffdf8',accent='#6d7964',body=W-2*M;
  const serif='"Songti TC","Noto Serif TC","PMingLiU",Georgia,serif';
  const sans='"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
  function font(size,bold=false,face=sans){ctx.font=(bold?'600 ':'400 ')+size+'px '+face}
  function text(t,x,yy,size=27,bold=false,color=ink,face=sans){font(size,bold,face);ctx.fillStyle=color;ctx.textBaseline='top';ctx.fillText(String(t),x,yy)}
  function right(t,x,yy,size=27,bold=false,color=ink,face=sans){font(size,bold,face);text(t,x-ctx.measureText(String(t)).width,yy,size,bold,color,face)}
  function lines(t,width,size=27,bold=false,face=sans){font(size,bold,face);const rs=[];for(const part of String(t).split('\n')){let row='';for(const ch of Array.from(part)){if(row&&ctx.measureText(row+ch).width>width){rs.push(row);row=ch}else row+=ch}rs.push(row)}return rs}
  function rule(yy,x=M,w=body){ctx.fillStyle=line;ctx.fillRect(x,yy,w,1.5)}
  async function finish(){if(!c)return;rule(H-84);text('FOOD JOURNAL  /  '+current.date,M,H-61,19,false,muted,serif);right(String(pageNum).padStart(2,'0'),W-M,H-61,21,false,muted,serif);pages.push(await canvasJPEG(c));c.width=1;c.height=1;c=null}
  function begin(day,continued=false){current=day;pageNum++;c=document.createElement('canvas');c.width=W;c.height=H;ctx=c.getContext('2d');ctx.fillStyle=paper;ctx.fillRect(0,0,W,H);
   text('F O O D   J O U R N A L',M,59,20,false,accent,serif);right('飲食紀錄',W-M,59,22,false,muted,serif);
   const title=day.label+(continued?'（續）':'');let size=61;font(size,false,serif);while(size>28&&ctx.measureText(title).width>body){size-=2;font(size,false,serif)}
   text(title,M,105,size,false,ink,serif);rule(188);y=219;
   if(!continued){
    const vals=['3 / 3 / 4',day.total,day.water+' ml'],labels=['目標份量','實際份量','喝水量'];
    labels.forEach((l,i)=>{const x=M+i*body/3;const avail=body/3-22;let sz=39;font(sz,false,serif);while(sz>20&&ctx.measureText(vals[i]).width>avail){sz-=2;font(sz,false,serif)}text(l,x,y,23,false,muted);text(vals[i],x,y+36,sz,false,ink,serif)});
    text('主食 / 蛋白質 / 蔬菜',M,y+90,20,false,muted);y+=129;rule(y);y+=29;
   }
  }
  async function room(h){if(y+h>MAX){await finish();begin(current,true)}}
  function photoDims(img,width,limit){if(!img||!img.naturalWidth||!img.naturalHeight)return {w:width,h:Math.min(limit,180)};const factor=Math.min(width/img.naturalWidth,limit/img.naturalHeight);return {w:Math.round(img.naturalWidth*factor),h:Math.round(img.naturalHeight*factor)}}
  function drawPhoto(img,x,yy,w,h){if(img){ctx.drawImage(img,x,yy,w,h)}else{ctx.fillStyle='#efede7';ctx.fillRect(x,yy,w,h);text('照片無法讀取',x+12,yy+15,20,false,muted)}}
  async function section(name,english,need=180){await room(need);text(name,M,y,33,false,ink,serif);right(english,W-M,y+9,20,false,accent,serif);y+=50;rule(y);y+=20}
  const english={早餐:'BREAKFAST',午餐:'LUNCH',晚餐:'DINNER',點心:'SNACK'};
  for(const day of days){
   begin(day);let hasMeal=false,mealNo=0;
   for(const group of day.meals){
    if(!group.entries.length)continue;hasMeal=true;await section(group.name,english[group.name]||'MEAL',240);
    for(const meal of group.entries){
     const photos=meal.photos||[];const hasPhoto=photos.length>0;const column=hasPhoto?360:0;
     const gap=38,tw=body-(hasPhoto?column+gap:0);
     const title=lines(meal.name,tw,33,false,serif).map(t=>({t,size:33,face:serif,color:ink}));
     const details=meal.details.flatMap(d=>lines(d,tw,26,false,sans)).map(t=>({t,size:26,face:sans,color:muted}));
     const all=[...title,...details];let idx=0,pi=0;const onLeft=mealNo++%2===0;
     while(idx<all.length||pi<photos.length){
      const take=[];let th=0;for(const row of all.slice(idx)){if(take.length&&th+row.size+11>350)break;take.push(row);th+=row.size+11}
      const show=pi<photos.length;const img=show?await loadImage(photos[pi]):null;const dim=show?photoDims(img,column,320):{w:0,h:0};
      const rowH=Math.max(65,th+8,show?dim.h:0);
      await room(rowH+25);
      const tx=show?(onLeft?M+column+gap:M):M;
      if(show){const px=onLeft?M:W-M-column;drawPhoto(img,px+(column-dim.w)/2,y,dim.w,dim.h);pi++}
      let yy=y;for(const r of take){text(r.t,tx,yy,r.size,false,r.color,r.face);yy+=r.size+11}idx+=take.length;
      if(show&&!take.length){text('餐點照片 · '+pi+'/'+photos.length,tx,y,22,false,muted,serif)}
      y+=rowH+23;
     }
     rule(y);y+=22;
    }
    y+=12;
   }
   if(!hasMeal){await room(72);text('當日尚無餐點紀錄',M,y,26,false,muted);y+=72}
   const cells=day.report.map(([k,v])=>({k,v:String(v)}));const col=(body-52)/2;const rows=[];
   for(let i=0;i<cells.length;i+=2){const pair=cells.slice(i,i+2).map(cell=>({...cell,ls:lines(cell.v,col,27,false,serif)}));rows.push({pair,h:Math.max(80,...pair.map(cell=>36+cell.ls.length*36+14))})}
   let started=false;
   for(const {pair,h} of rows){
    if(!started||y+h+12>MAX){await room(h+92);await section(started?'每日十項回報（續）':'每日十項回報','DAILY CHECK-IN',h+90);started=true}
    await room(h+12);
    pair.forEach((cell,i)=>{const x=M+i*(col+52);text(cell.k,x,y,22,false,muted);cell.ls.forEach((v,j)=>text(v,x,y+31+j*36,27,false,ink,serif));rule(y+h-8,x,col)});
    y+=h+12;
   }
   await finish();
  }
  return pdfBlob(pages);
 }
 return {build,pdfBlob};
})();
