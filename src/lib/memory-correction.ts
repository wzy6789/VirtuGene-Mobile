import {parseScopedDeclaration,isHistoricalResidence} from './chat-scoped-facts';
/** Shared topics or “其实” do not prove that an earlier fact is false.
 * Automatic retirement accepts direct contradictions only; more complex
 * changes remain sourced instead of silently deleting a possibly valid fact.
 */
function simpleAssertion(content: string): { predicate: string; object: string; negative: boolean } | undefined {
  const text = content.normalize('NFKC').trim().replace(/[。.!！]+$/u, '');
  const match = text.match(/^(?:其实|更正[:：]?|纠正[:：]?|记住[:：]?)?(?:用户|我)(?:现在|已经|一直|很|真的|其实)*(不再|已经不|不|没有|没)?(喜欢|讨厌|爱吃|喝|吸烟|抽烟)([^，,；;。！？!?“”"‘’'：:()（）]+?)(?:了)?$/u);
  if (!match) return undefined;
  const object = match[3].trim();
  if (!object || /也|还|以及|或者|或是|但是|不过|只是|如果|可能|大概|今天|这次|暂时|最近|以前|过去|小时候|周末|工作日|有时|偶尔|通常|只在|和|与|并且|都/u.test(object)) return undefined;
  return { predicate: match[2], object, negative: Boolean(match[1]) };
}

export function contradictsSimpleMemory(previous: string, replacement: string): boolean {
  const scopedOld=parseScopedDeclaration(previous),scopedNext=parseScopedDeclaration(replacement);
  if(scopedOld||scopedNext){
    if(scopedNext?.kind==='residence'&&!isHistoricalResidence(scopedNext.period)&&scopedNext.explicitSelf){
      const oldText=previous.normalize('NFKC').trim().replace(/[。.!！]+$/u,'');
      const oldPlace=scopedOld?.kind==='residence'&&!isHistoricalResidence(scopedOld.period)&&scopedOld.explicitSelf?scopedOld.place
        :!/[吗么？?的]|朋友|同事|或者|还是|可能|如果|假如/u.test(oldText)?oldText.match(/^我住(?:在)?([\p{L}\p{N}]{1,30})$/u)?.[1]:undefined;
      return !!oldPlace&&oldPlace!==scopedNext.place;
    }
    return !!scopedOld&&!!scopedNext&&scopedOld.kind==='preference'&&scopedNext.kind==='preference'
      &&scopedOld.explicitSelf&&scopedNext.explicitSelf&&scopedOld.period===scopedNext.period&&!!scopedOld.object&&scopedOld.object===scopedNext.object
      &&scopedOld.stance?.startsWith('不')!==scopedNext.stance?.startsWith('不');
  }
  const old = simpleAssertion(previous), next = simpleAssertion(replacement);
  return Boolean(old && next && old.predicate === next.predicate && old.object === next.object && old.negative !== next.negative);
}
