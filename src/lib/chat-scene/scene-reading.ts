import { getSceneDescription } from './scene-catalog';
const cafe={
  light:{bg:'#f4f0e9',panel:'#f7f2e8',surface:'#ece7de',surfaceStrong:'#ddd7cd',ai:'#f7f2e8',user:'#dce8e8',action:'#334f70',text:'#262b31',sub:'#515c66',accent:'#334f70',cyan:'#365d62',border:'#a5adb3',borderStrong:'#687681'},
  dark:{bg:'#151a21',panel:'#1b212b',surface:'#26313e',surfaceStrong:'#354454',ai:'#1b212b',user:'#304353',action:'#36526f',text:'#f3f0e8',sub:'#c1cad4',accent:'#c4d4e7',cyan:'#b5d2c8',border:'#6d7d8d',borderStrong:'#99aaba'},
};
/** Text surfaces stay opaque; environment hues are tuned separately for each reading mode. */
const presets={
  cafe,
  frost:{light:{...cafe.light,bg:'#e6edf4',panel:'#eef3f7',ai:'#eef3f7',user:'#dbe6ef',text:'#26313b',sub:'#4f5f6f',accent:'#345777'},dark:{...cafe.dark,bg:'#101c29',panel:'#142231',ai:'#142231',user:'#273f55',text:'#edf3fa',sub:'#c1d0df',accent:'#b8d3ed'}},
  coast:{light:{...cafe.light,bg:'#e5eeea',panel:'#eff4f1',ai:'#eff4f1',user:'#dce7e2',text:'#283b3b',sub:'#536766',accent:'#355d60'},dark:{...cafe.dark,bg:'#111e24',panel:'#16272c',ai:'#16272c',user:'#2b454a',text:'#edf5f1',sub:'#c1d3d0',accent:'#bad7d3'}},
  hearth:{light:{...cafe.light,bg:'#efe6d9',panel:'#f6eee2',ai:'#f6eee2',user:'#eadbcb',text:'#372d28',sub:'#6c584b',accent:'#795134'},dark:{...cafe.dark,bg:'#201a18',panel:'#2a211f',ai:'#2a211f',user:'#49372d',text:'#fff0df',sub:'#dac6b5',accent:'#e5c8a8'}},
  midnight:{light:{...cafe.light,bg:'#e5e9f1',panel:'#edf0f6',ai:'#edf0f6',user:'#dce3ed',text:'#2a3042',sub:'#596275',accent:'#435579'},dark:{...cafe.dark,bg:'#101521',panel:'#171d2b',ai:'#171d2b',user:'#2d3b52',text:'#f1f2fa',sub:'#c6cce0',accent:'#c1cfee'}},
};
export function getSceneReadingPalette(id:unknown) { return presets[getSceneDescription(id).readingPreset]; }
/** A scene owns its complete reading palette. Legacy role hues cannot recolor its light or glass. */
export function getSceneReadingVariables(id:unknown):Record<`--${string}`,string> {
  const variables:Record<`--${string}`,string>={};
  for(const [mode,palette] of Object.entries(getSceneReadingPalette(id))){
    const colors={...palette,edge:palette.border,glow:palette.accent,glowSecondary:palette.cyan,
      highlight:mode==='dark'?'rgba(241,242,250,.08)':'rgba(255,255,255,.75)',
      shadow:mode==='dark'?'rgba(0,0,0,.32)':'rgba(28,40,56,.10)'};
    for(const [key,value] of Object.entries(colors))variables[`--chat-${mode}-${key.replace(/[A-Z]/g,s=>'-'+s.toLowerCase())}`]=value;
  }
  return variables;
}
