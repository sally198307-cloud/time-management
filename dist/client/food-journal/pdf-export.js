
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
  const ink='#344e3a',muted='#748378',line='#dce4d9',cream='#faf9f5',sage='#e9efe5',body=W-2*M;
  function font(size,bold=false){ctx.font=(bold?'700 ':'400 ')+size+'px "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif'}
  function text(t,x,yy,size=29,bold=false,color=ink){font(size,bold);ctx.fillStyle=color;ctx.textBaseline='top';ctx.fillText(String(t),x,yy)}
  function lines(t,width,size=29,bold=false){font(size,bold);const result=[];for(const part of String(t).split('\n')){let row='';for(const ch of Array.from(part)){if(row&&ctx.measureText(row+ch).width>width){result.push(row);row=ch}else row+=ch}result.push(row)}return result}
  function rounded(x,yy,w,h,r,fill){ctx.beginPath();ctx.moveTo(x+r,yy);ctx.arcTo(x+w,yy,x+w,yy+h,r);ctx.arcTo(x+w,yy+h,x,yy+h,r);ctx.arcTo(x,yy+h,x,yy,r);ctx.arcTo(x,yy,x+w,yy,r);ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill()}}
  function rule(yy){ctx.fillStyle=line;ctx.fillRect(M,yy,body,2)}
  async function finish(){if(!c)return;rule(H-82);text('FOOD JOURNAL   /   '+current.date,M,H-61,19,false,muted);const n=String(pageNum).padStart(2,'0');font(20);text(n,W-M-ctx.measureText(n).width,H-61,20,false,muted);pages.push(await canvasJPEG(c));c.width=1;c.height=1;c=null}
  function begin(day,continued=false){current=day;pageNum++;c=document.createElement('canvas');c.width=W;c.height=H;ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
   text('D A I L Y   F O O D   J O U R N A L',M,58,20,true,muted);text(day.label+(continued?'（續）':''),M,99,49,true);
   rule(174);y=202;
   if(!continued){rounded(M,y,body,128,21,sage);
    const labels=['目標份量','實際份量','喝水量'],values=['3 / 3 / 4',day.total,day.water+' ml'];
    labels.forEach((label,i)=>{const x=M+25+i*body/3;text(label,x,y+19,23,false,muted);text(values[i],x,y+58,36,true)});
    text('主食 / 蛋白質 / 蔬菜',M+3,y+143,21,false,muted);y+=192;
   }
  }
  async function room(h){if(y+h>MAX){await finish();begin(current,true)}}
  function picture(img,x,yy,w,h){ctx.save();rounded(x,yy,w,h,17,cream);ctx.clip();if(img){const ratio=Math.min(w/img.naturalWidth,h/img.naturalHeight),iw=img.naturalWidth*ratio,ih=img.naturalHeight*ratio;ctx.drawImage(img,x+(w-iw)/2,yy+(h-ih)/2,iw,ih)}else text('照片無法讀取',x+12,yy+18,21,false,muted);ctx.restore()}
  async function groupTitle(name){await room(170);text(name,M,y,31,true);y+=43;rule(y);y+=15}
  for(const day of days){
   begin(day);let hasMeal=false;
   for(const group of day.meals){if(!group.entries.length)continue;hasMeal=true;await groupTitle(group.name);
    for(const meal of group.entries){
     const photos=meal.photos||[],photoW=photos.length?272:0,tx=M+(photoW?photoW+31:0),tw=W-M-tx-10;
     const titleLines=lines(meal.name,tw-20,32,true);
     const detailLines=meal.details.flatMap(d=>lines(d,tw-20,25,false));
     const all=[...titleLines.map(t=>({t,size:32,bold:true})),...detailLines.map(t=>({t,size:25,bold:false}))];
     let index=0,photoIndex=0;
     while(index<all.length||photoIndex<photos.length){
      const first=index===0&&photoIndex===0;
      const remaining=all.slice(index);
      const take=[];let th=0;
      for(const row of remaining){if(take.length&&th+row.size+12>340)break;take.push(row);th+=row.size+12}
      const showPhoto=photoIndex<photos.length,rowH=Math.max(th+34,showPhoto?224:0,76);
      await room(rowH+12);
      rounded(M,y,body,rowH,20,cream);
      if(showPhoto){const img=await loadImage(photos[photoIndex++]);picture(img,M+12,y+12,photoW-12,rowH-24)}
      let yy=y+17;for(const r of take){text(r.t,tx+12,yy,r.size,r.bold,r.bold?ink:muted);yy+=r.size+12}index+=take.length;
      if(!take.length&&showPhoto)text(meal.name.length>24?meal.name.slice(0,24)+'…':meal.name,tx+12,yy,24,true);
      y+=rowH+12;
     }
    }y+=15;
   }
   if(!hasMeal){await room(70);text('當日尚無餐點紀錄',M,y,26,false,muted);y+=65}
   const cells=day.report.map(([k,v])=>({k,v:String(v)}));
   const half=(body-18)/2;
   const rows=[];for(let i=0;i<cells.length;i+=2){const pair=cells.slice(i,i+2).map(cell=>({...cell,ls:lines(cell.v,half-44,27,true)}));rows.push({pair,h:Math.max(93,...pair.map(cell=>48+cell.ls.length*36))})}
   let reportStarted=false;
   for(const {pair,h} of rows){
    const needsHeader=!reportStarted||y+h>MAX;
    if(needsHeader){await room(h+62);text(reportStarted?'每日十項回報（續）':'每日十項回報',M,y,32,true);y+=50;reportStarted=true}
    await room(h+8);
    pair.forEach((cell,i)=>{const x=M+i*(half+18);rounded(x,y,half,h,16,sage);text(cell.k,x+20,y+14,22,false,muted);cell.ls.forEach((v,j)=>text(v,x+20,y+43+j*36,27,true))});y+=h+8;
   }
   await finish();
  }
  return pdfBlob(pages);
 }
 return {build,pdfBlob};
})();
