type FrameClient = (dt: number, now: number) => void;
const clients = new Set<FrameClient>();
let frame = 0, previous = 0;

/** All visible orbs share one clock. No component state is updated on a frame. */
function tick(now: number) {
  frame = 0;
  const dt = previous ? Math.min(.064, (now - previous) / 1000) : 1 / 60;
  previous = now;
  clients.forEach(client => client(dt, now));
  if (clients.size) frame = requestAnimationFrame(tick);
}
export function subscribeSoulOrbFrame(client: FrameClient): () => void {
  clients.add(client);
  if (!frame) { previous = 0; frame = requestAnimationFrame(tick); }
  return () => {
    clients.delete(client);
    if (!clients.size) { cancelAnimationFrame(frame); frame = 0; previous = 0; }
  };
}
export const soulOrbMotionActivity = () => ({ clients: clients.size, scheduled: !!frame });

/** Exact critically damped integration remains stable at variable frame rates. */
export function settleOrbValue(value: number, velocity: number, target: number, dt: number, frequency = 16): [number, number] {
  const displacement = value - target;
  const c = velocity + frequency * displacement, decay = Math.exp(-frequency * dt);
  return [target + (displacement + c * dt) * decay, (velocity - frequency * c * dt) * decay];
}

/** One coefficient set per channel group, not one exp/trig call per property. */
export function orbSpringCoefficients(dt:number, angularFrequency=16, dampingRatio=1):readonly [number,number,number,number] {
  if(!Number.isFinite(dt)||dt<0||!Number.isFinite(angularFrequency)||angularFrequency<=0||!Number.isFinite(dampingRatio)||dampingRatio<.75||dampingRatio>1)return [0,0,0,0];
  const w=angularFrequency, z=dampingRatio, decay=Math.exp(-z*w*dt);
  if(z> .9999)return [decay*(1+w*dt),decay*dt,-decay*w*w*dt,decay*(1-w*dt)];
  const b=w*Math.sqrt(1-z*z), cosine=Math.cos(b*dt), sine=Math.sin(b*dt)/b;
  return [decay*(cosine+z*w*sine),decay*sine,-decay*w*w*sine,decay*(cosine-z*w*sine)];
}
export function stepOrbSpring(value:number,velocity:number,target:number,dt:number,angularFrequency=16,dampingRatio=1):[number,number] {
  if(!Number.isFinite(target))return [0,0];
  if(!Number.isFinite(value)||!Number.isFinite(velocity))return [target,0];
  const c=orbSpringCoefficients(dt,angularFrequency,dampingRatio), y=value-target;
  return [target+c[0]*y+c[1]*velocity,c[2]*y+c[3]*velocity];
}

export type OrbCue='touch'|'success'|'error'|'surprised'|'happy';
const accentProfiles:Record<OrbCue,readonly [number,number,number,number,number]>={
  // preparation(ms), angular frequency, stretch impulse, lift impulse, roll
  touch:[0,24,0,0,80],success:[50,24,2.3,480,-80],error:[50,24,0,0,0],
  surprised:[35,28,2.3,390,25],happy:[45,24,1.8,340,-65],
};
export interface OrbAccent {
  kind:OrbCue; elapsed:number; launched:boolean; compression:number;
  scale:number; scaleVelocity:number; lift:number; liftVelocity:number; tilt:number; tiltVelocity:number;
}
export const createOrbAccent=():OrbAccent=>({kind:'touch',elapsed:320,launched:false,compression:.03,scale:0,scaleVelocity:0,lift:0,liftVelocity:0,tilt:0,tiltVelocity:0});
// Store the underlying spring separately from its finite presentation envelope.
// Repeatedly multiplying the spring state by a fade makes motion frame dependent.
const accentStates=new WeakMap<OrbAccent,{elapsed:number;values:number[]}>();
export function startOrbAccent(a:OrbAccent,kind:OrbCue,compression=.03) {
  accentStates.delete(a);
  a.kind=kind;a.elapsed=0;a.launched=false;a.compression=Math.max(.015,Math.min(.09,compression));
  // Retain the visible value on interruption; absorb momentum when failure wins.
  if(kind==='error'){a.scaleVelocity=0;a.liftVelocity=0;a.tiltVelocity=0;}
}
export function stepOrbAccent(a:OrbAccent,dt:number) {
  if(a.elapsed>=320||!Number.isFinite(dt)||dt<=0)return;
  const stored=accentStates.get(a);
  const values=stored?.elapsed===a.elapsed?stored.values:[a.scale,a.scaleVelocity,a.lift,a.liftVelocity,a.tilt,a.tiltVelocity];
  const end=Math.min(320,a.elapsed+dt*1000);
  const [preparation,frequency,stretchImpulse,liftImpulse,rollImpulse]=accentProfiles[a.kind];
  // Split exactly at takeoff, even when a slow frame straddles preparation.
  while(a.elapsed<end){
    if(!a.launched&&a.elapsed>=preparation){
      a.launched=true;
      if(a.kind!=='error'){
        values[1]=Math.min(2.3,values[1]+(a.kind==='touch'?Math.min(1.25,a.compression*14):stretchImpulse));
        values[3]=Math.max(-480,values[3]-(a.kind==='touch'?190+a.compression*2400:liftImpulse));
        values[5]=Math.max(-100,Math.min(100,values[5]+rollImpulse));
      }
    }
    const preparing=a.elapsed<preparation;
    const next=preparing?Math.min(end,preparation):end;
    const seconds=(next-a.elapsed)/1000;
    [values[0],values[1]]=stepOrbSpring(values[0],values[1],preparing&&a.kind!=='error'?-.018:0,seconds,frequency,.8);
    [values[2],values[3]]=stepOrbSpring(values[2],values[3],preparing?2:0,seconds,frequency,.8);
    if(a.kind==='error'&&!preparing){
      // Exact sinusoidal forcing: two small head shakes, independent of rAF rate.
      const w=45,z=.8,k=4*Math.PI/.27,d=w*w-k*k,b=2*z*w*k,den=d*d+b*b;
      const sine=3*w*w*d/den,cosine=-3*w*w*b/den;
      const particular=(ms:number):[number,number]=>{
        const phase=(ms-preparation)/1000*k;
        return [sine*Math.sin(phase)+cosine*Math.cos(phase),k*(sine*Math.cos(phase)-cosine*Math.sin(phase))];
      };
      const before=particular(a.elapsed),after=particular(next);
      const transient=stepOrbSpring(values[4]-before[0],values[5]-before[1],0,seconds,w,z);
      values[4]=transient[0]+after[0];values[5]=transient[1]+after[1];
    }else [values[4],values[5]]=stepOrbSpring(values[4],values[5],0,seconds,a.kind==='error'?45:frequency,.8);
    a.elapsed=next;
  }
  const t=Math.max(0,(a.elapsed-240)/80),fade=1-t*t*(3-2*t),fadeVelocity=-6*t*(1-t)/.08;
  for(const [index,position,velocity] of [[0,'scale','scaleVelocity'],[2,'lift','liftVelocity'],[4,'tilt','tiltVelocity']] as const){
    a[position]=values[index]*fade;
    a[velocity]=values[index+1]*fade+values[index]*fadeVelocity;
  }
  accentStates.set(a,{elapsed:a.elapsed,values});
}

/** Analytic sampling of the artwork's two cubic arcs; no SVG layout reads. */
export function sampleOrbOrbit(phase: number): [number, number] {
  const unit = ((phase % 1) + 1) % 1;
  // Travel out and back, slowing at the ends instead of jumping across the face.
  const progress = (1 - Math.cos(unit * Math.PI * 2)) / 2;
  const second = progress >= .5, t = second ? progress * 2 - 1 : progress * 2;
  const a = 1-t, w0=a*a*a, w1=3*a*a*t, w2=3*a*t*t, w3=t*t*t;
  return second
    ? [w0*140+w1*193+w2*233+w3*222,w0*185+w1*176+w2*148+w3*121]
    : [w0*35+w1*26+w2*80+w3*140,w0*144+w1*174+w2*195+w3*185];
}

/** Legacy pure touch sampler for compatibility; production uses OrbAccent energy. */
export function sampleOrbTouch(elapsed: number): { lift: number; tilt: number; squash: number } {
  if(elapsed < 0 || elapsed >= 320)return {lift:0,tilt:0,squash:0};
  const t=elapsed/320, envelope=Math.sin(Math.PI*t)**2;
  // Compression on takeoff/landing, extension in flight. Endpoint velocity is zero.
  return {lift:-12*envelope,tilt:7*Math.sin(Math.PI*2*t)*envelope,squash:.065*Math.cos(Math.PI*2*t)*envelope};
}

/** Eyelids close quickly and reopen gently; both endpoints have zero velocity. */
export function sampleOrbBlink(elapsed: number): number {
  if(elapsed<=0||elapsed>=210)return 0;
  const t=elapsed<65?elapsed/65:(210-elapsed)/145;
  return t*t*(3-2*t);
}
