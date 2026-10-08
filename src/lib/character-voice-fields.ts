/** Read explicit authored voice fields without inferring personality from prose. */
export const JUDGMENT_FIELDS = ['判断习惯','价值观','在意的事','关心方式','分歧与失败'] as const;
export const ADDRESS_FIELDS = ['称呼','称谓'] as const;
export const REACTION_FIELDS = ['情境反应','被夸反应','分歧反应','道歉修复','亲密反应','疲惫回应','庆祝反应'] as const;
const FIELDS = new Set<string>([...JUDGMENT_FIELDS,...ADDRESS_FIELDS,...REACTION_FIELDS]);
export interface AuthoredVoiceField { field:string; value:string; line:string }

export function authoredVoiceFields(prompt:string, names:readonly string[]):AuthoredVoiceField[] {
  const selected=new Set(names);
  return prompt.split(/\r?\n/u).flatMap(source=>{
    const line=source.trim();
    const match=line.match(/^(?:[-*•]\s*)?(?:【([^】]+)】\s*[：:]?\s*|([^：:]+)[：:]\s*)(.+)$/u);
    if(!match)return [];
    const field=(match[1]??match[2]).trim(),value=match[3].trim();
    return FIELDS.has(field)&&selected.has(field)&&value?[{field,value,line}]:[];
  });
}
