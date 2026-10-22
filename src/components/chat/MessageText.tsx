import { useMemo, type ReactNode } from 'react';

type TextBlock = { kind:'text'; text:string } | { kind:'code'; text:string; language:string }
  | { kind:'list'; ordered:boolean; items:{text:string; number?:number}[] };
const listLine = (line:string) => line.match(/^\s{0,3}(?:([-*+])|(\d{1,6})[.)])\s+(.+)$/);

/** A bounded, display-only subset. Raw HTML is always text. Do not guess code
 * structure which an older transport has already removed from stored messages. */
export function messageTextBlocks(raw:string, plain:string): TextBlock[] {
  const source = raw.replace(/\r\n?/g,'\n');
  if (!/^\s{0,3}```/m.test(source) && !source.split('\n').some((line,index,lines)=>listLine(line) && listLine(lines[index+1]??''))) return [{kind:'text',text:plain}];
  const lines=source.split('\n'),blocks:TextBlock[]=[];
  let paragraph:string[]=[];
  const flush=()=>{if(paragraph.length){blocks.push({kind:'text',text:paragraph.join('\n')});paragraph=[];}};
  for(let index=0;index<lines.length;index++) {
    const fence=lines[index].match(/^\s{0,3}```([^`]*)$/);
    if(fence) {
      flush();const body:string[]=[];
      while(++index<lines.length&&!/^\s{0,3}```\s*$/.test(lines[index]))body.push(lines[index]);
      blocks.push({kind:'code',text:body.join('\n'),language:fence[1].trim().slice(0,32)});continue;
    }
    const item=listLine(lines[index]);
    if(item) {
      flush();const ordered=!!item[2],items:{text:string;number?:number}[]=[];
      for(;index<lines.length;index++) {
        const next=listLine(lines[index]);if(!next||!!next[2]!==ordered)break;
        items.push({text:next[3],...(ordered?{number:Number(next[2])}:{})});
      }
      index--;blocks.push({kind:'list',ordered,items});continue;
    }
    if(!lines[index].trim()){flush();continue;}paragraph.push(lines[index]);
  }
  flush();return blocks.length?blocks:[{kind:'text',text:plain}];
}

function inlineText(text:string): ReactNode[] {
  const parts:ReactNode[]=[];
  const pattern=/`([^`\n]+)`|\[([^\]\n]{1,160})\]\((https?:\/\/[^\s()]{1,1800})\)|(https?:\/\/[^\s<>\u3000]+)/g;
  let start=0,match:RegExpExecArray|null;
  while((match=pattern.exec(text))) {
    if(match.index>start)parts.push(text.slice(start,match.index));
    if(match[1]!==undefined)parts.push(<code key={match.index}>{match[1]}</code>);
    else {
      const candidate=match[3]??match[4],href=match[3]?candidate:candidate.replace(/[.,!?;:，。！？；：、）)\]】」』]+$/u,'');
      let safe=false;try{const url=new URL(href);safe=(url.protocol==='https:'||url.protocol==='http:')&&!url.username&&!url.password;}catch{/* Invalid addresses stay literal. */}
      if(safe){parts.push(<a key={match.index} href={href} target="_blank" rel="noopener noreferrer" onClick={event=>event.stopPropagation()}>{match[2]??href}</a>);if(!match[3]&&href.length<candidate.length)parts.push(candidate.slice(href.length));}
      else parts.push(match[0]);
    }
    start=pattern.lastIndex;
  }
  if(start<text.length)parts.push(text.slice(start));return parts;
}

export function MessageText({raw,plain,streaming,suffix}:{raw:string;plain:string;streaming?:boolean;suffix?:ReactNode}) {
  const blocks=useMemo(()=>messageTextBlocks(raw,plain),[raw,plain]);
  const structured=blocks.some(block=>block.kind!=='text');
  return <div className={`vg-message-text${streaming?' vg-stream-text-arrive':''}`} data-message-format={structured?'structured':undefined}>
    {structured?blocks.map((block,index)=>block.kind==='code'?<pre key={index} tabIndex={0} aria-label={block.language?`${block.language}代码`:'代码'}><code>{block.text}</code></pre>
      :block.kind==='list'?block.ordered?<ol key={index}>{block.items.map((item,i)=><li key={i} value={item.number}>{inlineText(item.text)}</li>)}</ol>
        :<ul key={index}>{block.items.map((item,i)=><li key={i}>{inlineText(item.text)}</li>)}</ul>
      :<p key={index}>{inlineText(block.text)}</p>):inlineText(plain)}{suffix}
  </div>;
}
