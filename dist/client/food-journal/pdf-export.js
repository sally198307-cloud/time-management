
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
  const pages=[];let c,ctx,y,current;
  function font(size,bold=false){ctx.font=(bold?'700 ':'400 ')+size+'px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'}
  function text(t,x,yy,size=29,bold=false,color='#344e3a'){font(size,bold);ctx.fillStyle=color;ctx.textBaseline='top';ctx.fillText(String(t),x,yy)}
  function lines(t,width,size=29,bold=false){font(size,bold);const result=[];for(const part of String(t).split('\n')){let row='';for(const ch of Array.from(part)){if(row&&ctx.measureText(row+ch).width>width){result.push(row);row=ch}else row+=ch}result.push(row)}return result}
  async function finish(){if(!c)return;ctx.fillStyle='#dce6db';ctx.fillRect(M,H-72,W-2*M,2);text('飲食紀錄 · '+current.date,M,H-58,21,false,'#7b8d7e');pages.push(await canvasJPEG(c));c.width=1;c.height=1;c=null}
  function begin(day,continued=false){current=day;c=document.createElement('canvas');c.width=W;c.height=H;ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
   text('飲食紀錄',M,65,43,true);text('FOOD JOURNAL',M,120,21,false,'#849487');
   text(day.label+(continued?'（續）':''),M,162,32,true);ctx.fillStyle='#dce6db';ctx.fillRect(M,214,W-2*M,2);y=243;
   if(!continued){ctx.fillStyle='#f1f5ef';ctx.fillRect(M,y,W-2*M,126);
    ['目標份量','實際份量','喝水量'].forEach((name,i)=>{let x=M+22+i*((W-2*M)/3);text(name,x,y+13,23,false,'#738575');text(['3 / 3 / 4',day.total,day.water+' ml'][i],x,y+49,36,true)});
    text('主食／蛋白質／蔬菜',M,y+142,22,false,'#819185');y+=185;
   }
  }
  async function room(h){if(y+h>MAX){await finish();begin(current,true)}}
  async function wrapped(t,size=28,bold=false,color='#344e3a'){for(const line of lines(t,W-2*M,size,bold)){await room(size+11);text(line,M,y,size,bold,color);y+=size+11}}
  for(const day of days){
   begin(day);
   let hasMeal=false;
   for(const group of day.meals){if(!group.entries.length)continue;hasMeal=true;await room(84);text(group.name,M,y,34,true);y+=48;ctx.fillStyle='#dce6db';ctx.fillRect(M,y,W-2*M,2);y+=18;
    for(const meal of group.entries){
     await room(84);await wrapped(meal.name,33,true);
     for(const detail of meal.details)await wrapped(detail,26,false,'#607764');
     const pics=meal.photos||[];
     for(let i=0;i<pics.length;i+=3){
      const imgs=await Promise.all(pics.slice(i,i+3).map(loadImage));const side=320,gap=18;
      await room(side+18);
      imgs.forEach((img,j)=>{const x=M+j*(side+gap);ctx.fillStyle='#f1f4ef';ctx.fillRect(x,y,side,side);if(img){const ratio=Math.min(side/img.naturalWidth,side/img.naturalHeight),w=img.naturalWidth*ratio,h=img.naturalHeight*ratio;ctx.drawImage(img,x+(side-w)/2,y+(side-h)/2,w,h)}else text('照片無法讀取',x+18,y+20,24,false,'#819185')});y+=side+18;
     }
     y+=12;
    }
   }
   if(!hasMeal)await wrapped('當日尚無餐點紀錄',27,false,'#819185');
   await room(110);text('每日十項回報',M,y,34,true);y+=58;
   for(const [k,v] of day.report){await wrapped(k+'：'+v,28,false,'#425b47')}
   await finish();
  }
  return pdfBlob(pages);
 }
 return {build,pdfBlob};
})();
