export type OrbPersonality='idle'|'curious'|'listening'|'thinking'|'working'|'happy'|'surprised'|'shy'|'sleepy'|'sad'|'error'|'success';
export interface OrbLife {
  lift:number; sway:number; tilt:number; stretch:number;
  faceX:number; faceY:number; eye:number; mouth:number;
}
export const createOrbLife=():OrbLife=>({lift:0,sway:0,tilt:0,stretch:0,faceX:0,faceY:0,eye:0,mouth:0});
const rhythms:Record<OrbPersonality,readonly [number,number,number]>={
  idle:[1,1,1],curious:[.7,.8,1.3],listening:[.4,.7,.45],thinking:[.48,.65,.55],
  working:[.25,.5,.3],happy:[.7,1.1,1.1],surprised:[.3,.8,.4],shy:[.32,.75,.35],
  sleepy:[.2,.45,.3],sad:[.16,.6,.2],error:[.15,.65,.2],success:[.65,1,.8],
};
// Smooth pulses have stationary endpoints, with stillness between gestures.
const pulse=(time:number,start:number,duration:number)=>{
  const t=(time-start)/duration;
  return t<=0||t>=1?0:Math.sin(Math.PI*t)**2;
};
const smooth=(t:number)=>{const u=Math.max(0,Math.min(1,t));return u*u*(3-2*u);};

/** Original character choreography, sampled from time rather than frame count.
 * No random work, timers, DOM reads or business state live in this layer. */
export function sampleOrbLife(mood:OrbPersonality,time:number,phase:number,amplitude=6):OrbLife {
  if(!Number.isFinite(time)||!Number.isFinite(phase)||!Number.isFinite(amplitude))return createOrbLife();
  const clock=Math.max(0,time)+phase*1000, [float,breath,swing]=rhythms[mood];
  const p:OrbLife={
    lift:(Math.sin(clock/1100)+Math.sin(clock/2300)*.18)*amplitude*float,
    sway:Math.sin(clock/1900)*amplitude*.3*swing,
    tilt:Math.sin(clock/1700)*1.8*swing,
    stretch:(Math.sin(clock/900)+Math.sin(clock/1700)*.25)*.016*breath,
    faceX:0,faceY:0,eye:0,mouth:0,
  };
  // Breathing keeps each orb's full phase; gestures start near a state entry,
  // with only a small personal offset rather than several seconds of delay.
  const gestureClock=Math.max(0,time)+phase*180;
  const cycle=(period:number)=>((gestureClock%period)+period)%period;
  if(mood==='curious'){
    const peek=pulse(cycle(6400),900,1800);
    p.tilt-=4*peek;p.faceY-=1.8*peek;p.eye=.1*peek;p.sway+=1.5*peek;
  }else if(mood==='listening'){
    const t=cycle(4900),nod=pulse(t,750,520)+.55*pulse(t,1370,440);
    p.lift+=4*nod;p.tilt+=2.4*nod;p.faceY-=1.4*nod;p.eye=-.05*nod;
  }else if(mood==='thinking'){
    const t=cycle(6800);
    // Look, hold, then return; thinking is not an endless eye oscillation.
    const glance=smooth((t-650)/400)*(1-smooth((t-2500)/550));
    p.faceX=3*glance;p.faceY=-1.5*glance;p.tilt+=2*glance;
  }else if(mood==='working'){
    const concentrate=pulse(cycle(4200),600,900);
    p.faceY+=.8*concentrate;p.tilt-=1.6*concentrate;p.stretch-=.006*concentrate;
  }else if(mood==='happy'||mood==='success'){
    const t=cycle(mood==='happy'?5300:6200);
    const hop=pulse(t,1000,560),echo=.5*pulse(t,1690,440);
    const takeoff=pulse(t,850,150),landing=pulse(t,1570,120);
    p.lift-=8*(hop+echo);p.stretch+=.018*(takeoff+landing)-.018*(hop+echo);
    p.tilt+=3*hop-2*echo;p.faceY-=.7*hop;p.mouth=1.2*hop;
  }else if(mood==='surprised'){
    const recover=pulse(cycle(5700),1100,1600);
    p.tilt-=1.5*recover;p.eye=.04*recover;p.faceY-=.8*recover;
  }else if(mood==='shy'){
    const tuck=pulse(cycle(6800),1000,2200);
    p.faceX=-1.2*tuck;p.faceY=1.8*tuck;p.tilt+=2*tuck;p.eye=-.05*tuck;
  }else if(mood==='sleepy'){
    const doze=pulse(cycle(7600),1000,3200);
    p.lift+=3*doze;p.tilt-=2.5*doze;p.faceY=1.5*doze;p.mouth=3*pulse(cycle(7600),1900,1500);
  }else if(mood==='sad'){
    const sigh=pulse(cycle(7400),1300,2400);
    p.lift+=2.5*sigh;p.faceY=sigh;p.stretch-=.006*sigh;
  }
  return p;
}
