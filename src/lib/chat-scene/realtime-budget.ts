const reservations=new Map<number,number>();let serial=0;
let activeContexts=0,activeFrames=0;
export function reserveRealtimeBytes(bytes:number,otherBytes:number,cap:number){
  if(bytes+otherBytes+[...reservations.values()].reduce((sum,value)=>sum+value,0)>cap)return undefined;
  const id=++serial;reservations.set(id,bytes);let released=false;
  return {release(){if(released)return;released=true;reservations.delete(id);}};
}
export function countRealtimeContext(delta:number){activeContexts+=delta;}
export function countRealtimeFrame(delta:number){activeFrames+=delta;}
export function inspectRealtimeResources(){return {realtimeHosts:reservations.size,realtimeContexts:activeContexts,realtimeRafs:activeFrames,realtimeReservedBytes:[...reservations.values()].reduce((sum,value)=>sum+value,0)};}
