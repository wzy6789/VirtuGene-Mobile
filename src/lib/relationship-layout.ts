/** Stable portrait layout; the renderer never uses names as spatial labels. */
export type PortraitPoint = { ref: string; x: number; y: number };
export type PortraitEdge = { key: string; left: string; right: string };
export const RELATION_CANVAS = { width: 360, height: 400, x: 180, y: 200 };
export function portraitLayout(center: string, neighbors: string[], edges: PortraitEdge[]): PortraitPoint[] {
  const order = [...new Set(neighbors)].filter(id => id !== center).slice(0, 8);
  const n = order.length;
  const cost = (ids: string[]) => edges.reduce((sum, edge) => {
    const a = ids.indexOf(edge.left), b = ids.indexOf(edge.right);
    if (a < 0 || b < 0) return sum;
    const distance = Math.min(Math.abs(a-b), n-Math.abs(a-b));
    return sum + distance * distance;
  }, 0);
  // Cluster connected portraits along the perimeter to shorten secondary lines.
  for (let pass=0; pass<8; pass++) {
    let changed=false;
    for (let a=0;a<n;a++) for(let b=a+1;b<n;b++) {
      const before=cost(order);[order[a],order[b]]=[order[b],order[a]];
      if(cost(order)<before) changed=true; else [order[a],order[b]]=[order[b],order[a]];
    }
    if(!changed) break;
  }
  return [{ref:center,x:180,y:200}, ...order.map((ref,i) => {
    const angle = -Math.PI/2 + (Math.PI*2*i)/Math.max(3,n);
    return {ref,x:180+138*Math.cos(angle),y:200+150*Math.sin(angle)};
  })];
}
export function portraitRoute(a: PortraitPoint, b: PortraitPoint, points: PortraitPoint[], secondary=false): string {
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.max(1,Math.hypot(dx,dy));
  const inset=Math.min(29,length/3), ux=dx/length,uy=dy/length;
  const start={x:a.x+ux*inset,y:a.y+uy*inset}, end={x:b.x-ux*inset,y:b.y-uy*inset};
  let best={x:(a.x+b.x)/2,y:(a.y+b.y)/2}, bestScore=Infinity;
  for(const offset of (secondary ? [36,-36,65,-65,0,95,-95] : [0,36,-36,65,-65])) {
    const control={x:(a.x+b.x)/2-uy*offset,y:(a.y+b.y)/2+ux*offset};
    let score=Math.abs(offset)*.02;
    for(let s=1;s<20;s++) {
      const t=s/20, x=(1-t)**2*start.x+2*(1-t)*t*control.x+t*t*end.x;
      const y=(1-t)**2*start.y+2*(1-t)*t*control.y+t*t*end.y;
      if(x<12||x>348||y<12||y>388) score+=100;
      for(const p of points) if(p.ref!==a.ref&&p.ref!==b.ref) {
        const d=Math.hypot(x-p.x,y-p.y);
        if(d<36) score+=(36-d)*20;
      }
    }
    if(score<bestScore) {bestScore=score;best=control;}
  }
  return `M ${start.x} ${start.y} Q ${best.x} ${best.y} ${end.x} ${end.y}`;
}
