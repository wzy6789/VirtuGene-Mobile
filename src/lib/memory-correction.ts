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
  const old = simpleAssertion(previous), next = simpleAssertion(replacement);
  return Boolean(old && next && old.predicate === next.predicate && old.object === next.object && old.negative !== next.negative);
}
