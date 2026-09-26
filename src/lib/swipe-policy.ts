export const SWIPE_EDGE = 28;
export function swipeDirection(dx:number,dy:number):'x'|'y'|null {
  if(Math.max(Math.abs(dx),Math.abs(dy))<12)return null;
  return Math.abs(dx)>Math.abs(dy)*1.4?'x':'y';
}
export function swipeCommits(dx:number,elapsed:number,width:number):boolean {
  const distance=Math.abs(dx);
  return distance>=Math.min(96,Math.max(64,width*.22))||(distance>=36&&distance/Math.max(1,elapsed)>=.55);
}
export function swipeBlocked(target:EventTarget|null,root:Element,row=false):boolean {
  if(document.querySelector('[aria-modal="true"],.vg-message-context-menu,[data-group-dialog]')||window.getSelection()?.toString())return true;
  const node=target instanceof Element?target:null;if(!node)return true;
  if(node.closest(row?'input,textarea,select,[contenteditable="true"],[data-no-back-swipe],[data-no-page-swipe]':'button,a,input,textarea,select,[contenteditable="true"],[data-no-back-swipe],[data-no-page-swipe],[data-swipe-action-item],canvas'))return true;
  for(let parent:Element|null=node;parent&&parent!==root;parent=parent.parentElement) {
    if(parent.scrollWidth>parent.clientWidth+2&&/auto|scroll/.test(getComputedStyle(parent).overflowX))return true;
  }
  return false;
}
