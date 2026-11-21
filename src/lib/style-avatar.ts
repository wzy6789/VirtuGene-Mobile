import { normalizeBackgroundImage } from './chat-background-image';

function encode(bitmap: ImageBitmap, x=.5, y=.5, zoom=1, size=256) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法处理头像，请重试。');
  const side=Math.min(bitmap.width,bitmap.height)/zoom;
  ctx.drawImage(bitmap,(bitmap.width-side)*x,(bitmap.height-side)*y,side,side,0,0,size,size);
  return canvas.toDataURL('image/jpeg',.88);
}
export async function prepareStyleAvatar(file: File, signal: AbortSignal) {
  const normalized=await normalizeBackgroundImage(file,signal),bitmap=await createImageBitmap(normalized.source);
  try {
    signal.throwIfAborted();
    const canvas=document.createElement('canvas'),ratio=Math.min(1,768/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法处理头像，请重试。');
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return {source:canvas.toDataURL('image/jpeg',.88),image:encode(bitmap),x:.5,y:.5,zoom:1};
  } finally { bitmap.close(); }
}
export async function cropStyleAvatar(source: string, x: number, y: number, zoom: number, signal: AbortSignal) {
  const bytes=Uint8Array.from(atob(source.slice(source.indexOf(',')+1)),c=>c.charCodeAt(0));
  const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
  try {signal.throwIfAborted();return encode(bitmap,x,y,zoom);} finally {bitmap.close();}
}
