export const CHAT_IMAGE_LIMITS = { bytes: 15 * 1024 * 1024, pixels: 24_000_000, longestEdge: 2048 } as const;
const dimensionCheck = (w: number, h: number) => {
  if (!w || !h || w * h > CHAT_IMAGE_LIMITS.pixels || w > 24000 || h > 24000) throw Error('图片尺寸过大，请使用不超过2400万像素的静态图片。');
  return {width:w,height:h};
};
/** Read dimensions before allocating a decoded bitmap. Reject SVG, animation and spoofed file extensions. */
export async function inspectBackgroundImage(file: Blob) {
  if (!file.size || file.size > CHAT_IMAGE_LIMITS.bytes) throw Error('请选择15 MB以内的JPEG、PNG或静态WebP图片。');
  const b = new Uint8Array(await file.arrayBuffer()), v = new DataView(b.buffer);
  const word = (offset: number, length = 4) => String.fromCharCode(...b.subarray(offset,offset+length));
  if (b[0] === 137 && word(1,3) === 'PNG' && word(12) === 'IHDR') {
    if(b.length<33)throw Error('PNG文件不完整，请换一张图片。');
    for (let i=8; i+12<=b.length;) { const length = v.getUint32(i); if (word(i+4)==='acTL') throw Error('暂不支持动态PNG，请选择静态图片。'); if (length>b.length-i-12) throw Error('图片文件损坏，请换一张。'); i += length+12; }
    return {format:'image/png',...dimensionCheck(v.getUint32(16),v.getUint32(20))};
  }
  if (b[0]===255 && b[1]===216) {
    for (let i=2; i+4<b.length;) {
      if (b[i]!==255) break;
      while(b[i]===255)i++;
      const marker=b[i++]; if(marker===217 || marker===218)break;
      if(marker===1 || marker>=208&&marker<=215)continue;
      const length=v.getUint16(i); if(length<2 || i+length>b.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8) return {format:'image/jpeg',...dimensionCheck(v.getUint16(i+5),v.getUint16(i+3))};
      i+=length;
    }
    throw Error('JPEG文件不完整或损坏，请换一张。');
  }
  if (word(0)==='RIFF' && word(8)==='WEBP') {
    let dimensions: {width:number;height:number}|undefined;
    for(let i=12;i+8<=b.length;) {
      const type=word(i),length=v.getUint32(i+4,true),at=i+8;
      if(length>b.length-at)throw Error('WebP文件损坏，请换一张。');
      if(type==='ANIM'||type==='ANMF'||type==='VP8X'&&(b[at]&2))throw Error('暂不支持动态WebP，请选择静态图片。');
      if(type==='VP8X'&&length>=10) dimensions=dimensionCheck(1+b[at+4]+(b[at+5]<<8)+(b[at+6]<<16),1+b[at+7]+(b[at+8]<<8)+(b[at+9]<<16));
      if(type==='VP8 '&&length>=10&&b[at+3]===157&&b[at+4]===1&&b[at+5]===42)dimensions=dimensionCheck(v.getUint16(at+6,true)&16383,v.getUint16(at+8,true)&16383);
      if(type==='VP8L'&&length>=5&&b[at]===47){const bits=v.getUint32(at+1,true);dimensions=dimensionCheck((bits&16383)+1,((bits>>>14)&16383)+1);}
      i+=8+length+(length%2);
    }
    if(dimensions)return {format:'image/webp',...dimensions};
  }
  throw Error('无法识别静态图片。请使用JPEG、PNG或静态WebP，不支持GIF、视频和远程链接。');
}
const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('图片处理失败，请换一张或使用更小图片。')), 'image/jpeg', .94));
const current = (signal?: AbortSignal) => { if(signal?.aborted)throw new DOMException('Cancelled','AbortError'); };
export async function normalizeBackgroundImage(file: Blob, signal?: AbortSignal) {
  await inspectBackgroundImage(file); current(signal);
  let bitmap: ImageBitmap;
  try { bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}); } catch { throw Error('设备无法解码这张图片，请使用JPEG或PNG。'); }
  try {
    current(signal); dimensionCheck(bitmap.width,bitmap.height);
    const scale=Math.min(1,CHAT_IMAGE_LIMITS.longestEdge/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('图片处理暂不可用。');
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.fillStyle='#e4e4e4';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const source=await toBlob(canvas);current(signal);return {source,width:canvas.width,height:canvas.height};
  } finally {bitmap.close();}
}
/** Blur is baked once before the storage transaction, never animated as a full-screen filter. */
export async function renderBackgroundImage(source: Blob, blur: number, signal?: AbortSignal) {
  current(signal); if(blur===0)return source;
  const bitmap=await createImageBitmap(source);
  try {
    current(signal);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('图片处理暂不可用。');
    // Extend the image under the blur kernel to avoid transparent dark fringe.
    const pad=Math.ceil(blur*3);ctx.filter=`blur(${blur}px)`;ctx.drawImage(bitmap,-pad,-pad,canvas.width+pad*2,canvas.height+pad*2);
    const blob=await toBlob(canvas);current(signal);return blob;
  }finally{bitmap.close();}
}
