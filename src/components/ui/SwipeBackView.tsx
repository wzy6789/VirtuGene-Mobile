import type { ReactNode } from 'react';
import { usePageSwipe } from './usePageSwipe';
export function SwipeBackView({onBack,enabled=true,children,className=''}:{onBack:()=>void;enabled?:boolean;children:ReactNode;className?:string}) {
  const ref=usePageSwipe(enabled,'back',dx=>dx>0,()=>onBack(),true);
  return <div ref={ref} data-swipe-back="true" className={`h-full min-h-0 ${className}`} style={{touchAction:'pan-y'}}>{children}</div>;
}
