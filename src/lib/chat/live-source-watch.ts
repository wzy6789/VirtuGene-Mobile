import Dexie, {type ObservabilitySet} from 'dexie';

/** A send-local publication gate. Mutations pause synchronously; fresh selected
 * evidence is checked once per coalesced change, never once per token. The
 * final database transaction must still perform its own authoritative guard. */
export class ChatLiveSourceWatch {
  private requested=0;
  private checked=0;
  private fullCheck=false;
  private running?:Promise<void>;
  private closed=false;
  private failure?:Error;
  constructor(private readonly options:{databaseName:string;validate:(checkMemory:boolean)=>Promise<void>;pause:()=>void;resume:()=>void;invalid:(error:Error)=>void}){
    options.pause();
    Dexie.on.storagemutated.subscribe(this.changed);
  }
  private changed=(parts:ObservabilitySet)=>{
    if(this.closed||!parts.all&&!Object.keys(parts).some(part=>part.startsWith('idb://'+this.options.databaseName+'/')))return;
    void this.check(true).catch(()=>undefined);
  };
  async check(checkMemory:boolean):Promise<void>{
    if(this.closed)throw this.failure??Error('chat:request_finished');
    this.requested++;
    this.fullCheck||=checkMemory;
    this.options.pause();
    while(!this.closed&&this.checked<this.requested)await this.pump();
    if(this.failure)throw this.failure;
    if(this.closed)throw Error('chat:request_finished');
  }
  private pump():Promise<void>{
    if(this.running)return this.running;
    this.running=Promise.resolve().then(async()=>{
      while(!this.closed&&this.checked<this.requested){
        const version=this.requested,full=this.fullCheck;this.fullCheck=false;
        // Storage notifications can run inside another transaction's complete
        // callback. Validate in fresh reads, never inherit that finished zone.
        await Dexie.ignoreTransaction(()=>this.options.validate(full));
        if(!this.closed)this.checked=version;
      }
      if(!this.closed&&this.checked===this.requested)this.options.resume();
    }).catch(error=>{
      this.invalidate(error);
      throw this.failure??error;
    }).finally(()=>{this.running=undefined;});
    return this.running;
  }
  invalidate(cause:unknown){
    if(this.closed)return;
    const error=cause instanceof Error&&cause.message.startsWith('chat:')?cause:Error('chat:request_invalidated');
    this.failure=error;
    this.dispose();
    this.options.invalid(error);
  }
  dispose(){
    if(this.closed)return;
    this.closed=true;
    Dexie.on.storagemutated.unsubscribe(this.changed);
  }
}
