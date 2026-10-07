import { orbSpringCoefficients, sampleOrbOrbit, type OrbAccent } from './soul-orb-motion';
import type { OrbChannel } from './orb-motion-profiles';
import { createOrbLife, sampleOrbLife, type OrbPersonality } from './orb-personality';

type PaintNode = Readonly<{current:Element|null}>;
type OrbPaintRefs = Record<'rig'|'face'|'left'|'right'|'mouth'|'blush'|'orbit'|'shadow'|'darkMouth'|'brows'|'orbitDot'|'waves'|'thoughts'|'sleep'|'tear'|'cross'|'sparkles'|'sheen',PaintNode>;

/** One renderer owns SVG writes; static geometry is not rewritten on every frame. */
export function createOrbPainter(refs:OrbPaintRefs,size:number,phase:number) {
  const {rig,face,left,right,mouth,blush,orbit,shadow,darkMouth,brows,orbitDot,waves,thoughts,sleep,tear,cross,sparkles,sheen}=refs;
  const floatAmplitude=Math.min(10,Math.max(4,360/size));
  const life=createOrbLife(),lifeVelocity=createOrbLife(),lifeKeys=Object.keys(life) as (keyof typeof life)[];
  let previousTime=0,moodSince=0,previousMood:OrbPersonality='idle';
  const written=new WeakMap<Element,Map<string,string>>();
  const write=(node:Element|null|undefined,name:string,value:string)=>{
    if(!node)return;
    let attributes=written.get(node);if(!attributes){attributes=new Map();written.set(node,attributes);}
    if(attributes.get(name)===value)return;
    attributes.set(name,value);node.setAttribute(name,value);
  };
  return (p: Record<OrbChannel,number>, time:number, blink:number, move:boolean, motionStrength:number, gaze:number[], bodyGaze:number[], response:OrbAccent, mood:OrbPersonality='idle',pressed=false,attending=false) => {
    const strength = move ? motionStrength : 0;
    if(!move||time<previousTime){for(const key of lifeKeys){life[key]=0;lifeVelocity[key]=0;}moodSince=time;previousMood=mood;}
    if(mood!==previousMood){moodSince=time;previousMood=mood;}
    const dt=Math.max(0,Math.min(.064,(time-previousTime)/1000));previousTime=time;
    const target=sampleOrbLife(mood,time-moodSince,phase,floatAmplitude),c=orbSpringCoefficients(dt,22);
    // Touch and discrete responses own the body; ambient gestures yield smoothly.
    const yieldToAction=pressed ? .12 : response.elapsed<240 ? .4 : 1;
    for(const key of lifeKeys){
      const attentionGain=attending&&(key==='faceX'||key==='faceY')?0:1;
      const aim=move?target[key]*yieldToAction*attentionGain:0,y=life[key]-aim,v=lifeVelocity[key];
      life[key]=aim+c[0]*y+c[1]*v;lifeVelocity[key]=c[2]*y+c[3]*v;
    }
    const breath=life.stretch*strength,bob=life.lift*strength,sway=life.sway*strength,rock=life.tilt*strength;
    const touch=move?{lift:response.lift,tilt:response.tilt,squash:-response.scale}:{lift:0,tilt:0,squash:0};
    // An explicit attention target always takes priority over a thinking glance.
    const glanceWeight=1-Math.min(1,Math.hypot(...gaze)*2);
    const rise=touch.lift+bob;
    write(rig.current,'transform',`translate(${128+sway+bodyGaze[0]*3} ${132+p.lift+rise+bodyGaze[1]*2}) rotate(${p.tilt+rock+bodyGaze[0]*4+touch.tilt}) scale(${p.scaleX+breath+touch.squash} ${p.scaleY-breath-touch.squash}) translate(-128 -132)`);
    write(face.current,'transform',`translate(${p.faceX+gaze[0]*7+life.faceX*strength*glanceWeight+(gaze[0]-bodyGaze[0])*.3} ${p.faceY+gaze[1]*5+life.faceY*strength*glanceWeight+(gaze[1]-bodyGaze[1])*.3-touch.squash*12}) translate(128 132) scale(${size<64?1.5:size<80?1.3:1}) translate(-128 -132)`);
    write(sheen.current,'transform',`translate(${bodyGaze[0]*-2-touch.tilt*.12} ${bodyGaze[1]*-1.5-rise*.07})`);
    write(sheen.current,'opacity',`${.85+breath*5}`);
    const drawEye = (node: Element|null, x: number, asymmetry=1) => {
      if (!node) return;
      const width=p.eyeWidth, h = Math.max(.45,14*p.eyeOpen*(1-blink)*asymmetry), top = -h+p.eyeCurve, bottom=h+p.eyeCurve;
      write(node,'transform',`translate(${x} 122) scale(1 ${1+life.eye*strength})`);
      write(node,'d',`M ${-width} 0 C ${-width} ${top} ${width} ${top} ${width} 0 C ${width} ${bottom} ${-width} ${bottom} ${-width} 0 Z`);
      write(node,'opacity',`${1-p.cross}`);
    };
    drawEye(left.current,128-p.eyeGap); drawEye(right.current,128+p.eyeGap,p.rightOpen);
    const mouthPath=`M ${128-p.mouthWidth} 153 Q 128 ${153+p.mouthCurve} ${128+p.mouthWidth} 153 Q 128 ${153+p.mouthCurve+p.mouthOpen} ${128-p.mouthWidth} 153 Z`;
    write(mouth.current,'d',mouthPath);write(darkMouth.current,'d',mouthPath);write(darkMouth.current,'opacity',`${p.mouthDark}`);
    const mouthTransform=`translate(128 153) scale(1 ${1+life.mouth*.035*strength}) translate(-128 -153)`;
    write(mouth.current,'transform',mouthTransform);write(darkMouth.current,'transform',mouthTransform);
    write(blush.current,'opacity',`${p.blush}`);
    write(brows.current,'opacity',`${p.brow}`);
    write(brows.current?.children[0],'d',`M 96 ${99+p.browTilt} Q 106 ${96-p.browLift} 116 99`);
    write(brows.current?.children[1],'d',`M 140 99 Q 150 ${96-p.browLift} 160 ${99-p.browTilt}`);
    write(orbit.current,'opacity',`${p.orbit+Math.sin(time/1100)*.07*strength}`);write(orbitDot.current,'r',`${p.orbitDot*(size<64?1.45:1)*(1+Math.sin(time/480)*p.thought*.12*strength)}`);
    const dot=sampleOrbOrbit(time/2400), travel=p.busy*strength;
    write(orbitDot.current,'cx',`${221+(dot[0]-221)*travel}`);
    write(orbitDot.current,'cy',`${119+(dot[1]-119)*travel}`);
    write(orbit.current,'transform',`rotate(${-7+Math.sin(time/1400)*(7+p.thought*12+p.cross*2)*strength} 128 132)`);
    write(waves.current,'opacity',`${p.listening}`);write(thoughts.current,'opacity',`${p.thought}`);
    write(waves.current,'transform',`translate(32 126) scale(${1+Math.sin(time/370)*.08*p.listening*strength}) translate(-32 -126)`);
    write(thoughts.current,'transform',`translate(0 ${Math.sin(time/800)*3*p.thought*strength})`);
    if(thoughts.current)for(let i=0;i<3;i++){
      const wave=Math.sin(time/650-i*.9);
      const thoughtStrength=p.thought*strength;
      write(thoughts.current.children[i],'opacity',`${1-thoughtStrength*.45+thoughtStrength*.45*wave**2}`);
      write(thoughts.current.children[i],'transform',`translate(${wave*.7*p.thought*strength} ${-wave*1.8*p.thought*strength})`);
    }
    write(sleep.current,'opacity',`${p.sleep}`);write(tear.current,'opacity',`${p.tear}`);
    write(cross.current,'opacity',`${p.cross}`);write(sparkles.current,'opacity',`${p.sparkles}`);
    write(sleep.current,'transform',`translate(0 ${Math.sin(time/1300)*4*p.sleep*strength})`);
    write(sparkles.current,'transform',`translate(128 132) scale(${1+Math.sin(time/500)*.06*p.sparkles*strength}) translate(-128 -132)`);
    if(sparkles.current)for(let i=0;i<2;i++)write(sparkles.current.children[i],'opacity',`${1-p.sparkles*strength*.35+p.sparkles*strength*.35*Math.sin(time/700+i*1.7)**2}`);
    const altitude=p.lift+bob+touch.lift;
    write(shadow.current,'cx',`${128+sway*.6+bodyGaze[0]*2}`);
    write(shadow.current,'rx',`${Math.max(30,53+altitude*.7)}`);
    write(shadow.current,'opacity',`${Math.max(.35,Math.min(1,.75+altitude*.016))}`);
  };
}
