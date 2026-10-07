import type { ReactNode } from 'react';
import { MOBILE_TABS, type MobileTab } from '../../store/ui-store';
import { usePageSwipe } from './usePageSwipe';
import { confirm } from '../../lib/haptics';
const TAB_ORDER = MOBILE_TABS.map(tab => tab.key);
export function MobileTabSwipe({activeTab,enabled=true,onTabSwipe,children}:{activeTab:MobileTab;enabled?:boolean;onTabSwipe:(tab:MobileTab)=>void;children:ReactNode}) {
  const next=(dx:number)=>TAB_ORDER[TAB_ORDER.indexOf(activeTab)+(dx<0?1:-1)];
  const ref=usePageSwipe(enabled,activeTab,dx=>!!next(dx),dx=>{const tab=next(dx);if(tab){onTabSwipe(tab);confirm();}});
  return <div ref={ref} data-page-swipe="true" className="h-full min-w-0 mobile-tab-swipe" style={{touchAction:'pan-y',overscrollBehaviorX:'none'}}>{children}</div>;
}
