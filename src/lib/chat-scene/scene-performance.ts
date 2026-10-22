/** Conservative browser frame signal, never a claim about GPU timing.
 * Two complete bad windows are required for each step; this visit never oscillates upward.
 * Re-entering the chat retries the requested quality without changing saved preferences. */
export function createScenePerformanceGuard() {
  let level=0,bad=0;
  return { sample(fps:number,target:number,activeMilliseconds:number) {
    if(activeMilliseconds<3500||!Number.isFinite(fps)||fps<=0)return level;
    bad=fps<target*.55?bad+1:0;
    if(bad>=2){level=Math.min(4,level+1);bad=0;}
    return level;
  },get level(){return level;},resetWindow(){bad=0;} };
}
