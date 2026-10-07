export const ORB_COLORS = [
  {id:'auto',name:'默认',body:'#8069dd',highlight:'#d3c5ff',depth:'#242945',rim:'#7fe0db'},
  {id:'violet',name:'星紫',body:'#8069dd',highlight:'#e0d3ff',depth:'#302751',rim:'#baa6ff'},
  {id:'mint',name:'薄荷',body:'#57bda2',highlight:'#c5f8df',depth:'#204a49',rim:'#86efe0'},
  {id:'blue',name:'冰蓝',body:'#649fdb',highlight:'#d4eaff',depth:'#253e65',rim:'#a0e7ff'},
  {id:'rose',name:'玫瑰',body:'#cf7ba3',highlight:'#ffdbeb',depth:'#512c49',rim:'#ffc5dc'},
  {id:'amber',name:'琥珀',body:'#d7a366',highlight:'#ffebc9',depth:'#57412c',rim:'#fbd995'},
] as const;
export type OrbColor = typeof ORB_COLORS[number]['id'];
