import {firstDialogueBoundary,inspectDialogueSegment} from './output-contract';

export interface ReviewedPrefixOptions {
  /** Full persona/fact checks, returning the exact display representation.
   * Returning undefined keeps the text buffered; it never grants publication. */
  review: (raw:string,whole:boolean) => string|undefined;
  validate: () => Promise<void>;
  /** The caller owns a native transaction with fresh source/owner guards.
   * Persist only replyDelivery=in-progress, never a completed answer. Check
   * isCurrent before and after the write so cancellation can roll it back. */
  commit: (text:string,isCurrent:()=>boolean) => Promise<void>;
  publish: (text:string) => void;
  signal?: AbortSignal;
}
export type ReviewedPrefixResult =
  | {kind:'ready';text:string;prefix?:string}
  | {kind:'partial';text:string;reason:'unsafe-suffix'|'changed-prefix'|'cancelled'}
  | {kind:'blocked';reason:'unsafe-output'|'cancelled'};

/** One first-segment decision per model attempt. Complete-sentence boundaries
 * do not themselves grant publication: review, source validation and durable
 * commit must all succeed first. No timer, retry, transport or ledger is added.
 * The sender retains ownership of final commit, recovery and import handling. */
export class ReviewedReplyPrefix {
  private generation=0;
  private raw='';
  private stopped=false;
  private attempted=false;
  private prefix?:string;
  private firstJob?:Promise<void>;
  private failure?:unknown;
  private finishing?:Promise<ReviewedPrefixResult>;
  constructor(private readonly options:ReviewedPrefixOptions){}
  get publishedPrefix(){return this.prefix;}
  private live(generation=this.generation){return generation===this.generation&&!this.stopped&&!this.options.signal?.aborted;}
  push(raw:string):void{
    if(!this.live()||this.finishing)return;
    if(this.raw&&!raw.startsWith(this.raw)){
      this.failure=Error('chat:changed_stream_prefix');this.cancel();return;
    }
    this.raw=raw;
    if(this.attempted)return;
    const boundary=firstDialogueBoundary(raw);
    if(boundary===undefined)return;
    this.attempted=true;
    const candidate=raw.slice(0,boundary),display=this.options.review(candidate,false);
    if(!display?.trim())return;
    const generation=this.generation;
    this.firstJob=(async()=>{
      await this.options.validate();
      if(!this.live(generation))return;
      await this.options.commit(display,()=>this.live(generation));
      if(!this.live(generation))return;
      this.prefix=display;
      this.options.publish(display);
    })().catch(error=>{this.failure=error;});
  }
  cancel(){this.stopped=true;this.generation++;}
  async awaitFirstDecision(){await this.firstJob;if(this.failure)throw this.failure;}
  /** A suffix cannot silently rewrite a visible prefix. A failed whole draft
   * keeps only the verified prefix; its caller settles that as interrupted. */
  finish(raw=this.raw):Promise<ReviewedPrefixResult>{
    if(this.finishing)return this.finishing;
    this.finishing=(async()=>{
      await this.firstJob;
      if(this.failure)throw this.failure;
      if(!this.live())return this.prefix?{kind:'partial',text:this.prefix,reason:'cancelled'}:{kind:'blocked',reason:'cancelled'};
      await this.options.validate();
      if(!this.live())return this.prefix?{kind:'partial',text:this.prefix,reason:'cancelled'}:{kind:'blocked',reason:'cancelled'};
      if(inspectDialogueSegment(raw,'private',true).status!=='ready')return this.prefix?{kind:'partial',text:this.prefix,reason:'unsafe-suffix'}:{kind:'blocked',reason:'unsafe-output'};
      const reviewed=this.options.review(raw,true);
      if(!reviewed?.trim())return this.prefix?{kind:'partial',text:this.prefix,reason:'unsafe-suffix'}:{kind:'blocked',reason:'unsafe-output'};
      if(this.prefix&&!reviewed.startsWith(this.prefix))return {kind:'partial',text:this.prefix,reason:'changed-prefix'};
      return {kind:'ready',text:reviewed,...(this.prefix?{prefix:this.prefix}:{})};
    })();
    return this.finishing;
  }
}
