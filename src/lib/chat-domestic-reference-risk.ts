import {SAMPLE_LINE,stripVoiceSampleBlock} from './character-voice';

/** Definite possessions are premises, even inside a conditional observer's
 * reaction. This is a bounded check, not universal scene grounding. */
const REFERENCE=/(?:我家|咱家|我们家|我家里)(?:的)?(?:那|这)(?:几|两|三|四|五|六|七|八|九|十|一)(?:盆|棵|株|只|条|把|张|台|辆|本|件|套)/gu;
// "以后不用再给你留…" still asserts earlier repeated care. A proposed
// future choice is free expression; its concrete past premise needs a source.
const REPEATED_CARE=/(?:^|[。！？!?，,；;\n]|-{3,})\s*(?:以后|今后|下次|下回|往后)?(?:我|我们|咱们)[^。！？!?，,；;\n]{0,24}?(?:不用再|不必再|不需要再|无需再|不再)(?:单独|特意|专门)?((?:给你|替你|为你)(?:单独|特意|专门)?(?:留|做|准备)[^。！？!?，,；;\n]{1,48})/gu;
function unquote(text:string):string{return text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');}
function canonical(text:string):string{return text.replace(/我家里|我们家|咱家/gu,'我家').replace(/我家的/gu,'我家');}
function repeatedCareRisk(text:string,authored:string[],records:string[],userSources:string[]):string|undefined {
  const userEvidence=userSources.map(unquote).filter(source=>/^\s*(?:以前|之前|曾经|每次|平时)?你/u.test(source)&&!/(?:不是|没有|并未|不曾|未曾|从未)/u.test(source))
    .map(source=>source.replace(/给我|替我|为我/gu,part=>part.replace('我','你')));
  const evidence=[...authored,...records,...userEvidence]
    .map(unquote).flatMap(source=>source.split(/[。！？!?；;\n]/u)).filter(source=>
      !/(?:如果|假如|假设|要是|若是|没有|没给|没替|没为|并未|从未|不曾|未曾|不再|不用|不必|不需要|无需|[?？])/u.test(source)
      &&!/^\s*(?:朋友|同事|他|她|有人|用户|对话样本)/u.test(source));
  for(const match of text.matchAll(REPEATED_CARE)){
    const start=Math.max(...['。','！','？','!','?','\n'].map(mark=>text.lastIndexOf(mark,match.index!)))+1;
    const sentence=text.slice(start).match(/^[^。！？!?\n]*(?:[。！？!?\n]|$)/u)?.[0]??'';
    // A condition about the user's NEW choice does not erase the old premise.
    // An explicit counterfactual about earlier care does not establish history.
    if(/^(?:朋友|同事|他|她|有人).{0,12}(?:说|问)|(?:假如|假设|如果|要是).{0,6}(?:以前|过去|之前|曾经)|[?？]/u.test(sentence))continue;
    const action=match[1].trim();
    if(!evidence.some(source=>source.replace(/\s/gu,'').includes(action.replace(/\s/gu,''))))return action;
  }
}
export function findDomesticReferenceRisk(content:string,persona='',records:string[]=[],userSources:string[]=[]):string|undefined {
  const authored=stripVoiceSampleBlock(persona).split(/\r?\n/u).filter(line=>!SAMPLE_LINE.test(line));
  const directUserSources=userSources.filter(text=>!/(?:朋友|同事|有人|他|她)(?:刚才|刚|昨天)?(?:说|提到|问)/u.test(text));
  const sources=[...authored,...records,...directUserSources.map(text=>text.replace(/你家里|你家/gu,'我家'))]
    .map(unquote).filter(text=>!/(?:如果|假如|假设|要是|若|以前|从前|曾经|不再|没有|扔了|卖了|送走|不是|[?？])/u.test(text)).map(canonical);
  const text=unquote(content);
  const repeatedCare=repeatedCareRisk(text,authored,records,directUserSources);
  if(repeatedCare)return repeatedCare;
  for(const match of text.matchAll(REFERENCE)){
    const parts=text.slice(0,match.index).split(/[。！？!?\n]|-{3,}/u);
    const prefix=parts[parts.length-1]??'';
    if(/^(?:朋友|同事|他|她|有人).{0,10}(?:说|问|写)|(?:假设|假如|如果|要是|若)(?:咱家|我家|我们家)(?:有|添|买|养)/u.test(prefix.trim()))continue;
    if(/(?:没有|不再有|并没有).{0,3}$/u.test(prefix))continue;
    const reference=canonical(match[0]);
    if(!sources.some(source=>source.includes(reference)))return match[0];
  }
  return undefined;
}
/** Keep independent reactions after the existing retry, without inventing a
 * substitute family scene or restoring an unsupported best draft. */
export function omitDomesticReferences(content:string,persona='',records:string[]=[],userSources:string[]=[]):string {
  return content.split(/\s*-{3,}\s*/u).map(bubble=>bubble.split(/(?<=[。！？!?；;\n])/u)
    .filter(sentence=>!findDomesticReferenceRisk(sentence,persona,records,userSources)).join('').trim()).filter(Boolean).join('\n---\n');
}
