/** Real-test accounting only. No credentials or production dependencies. */
export function createLiveUsageLedger({maxCalls,maxTotalTokens,maxOutputTokens,fetchImpl=fetch}) {
  let chargedRequests=0,totalTokens=0,usageMissing=false;
  const active=new Set(),records=[];
  const snapshot=()=>({chargedRequests,totalTokens,knownUsageCalls:records.filter(r=>Number.isFinite(r.usage?.total_tokens)).length,unknownUsageCalls:records.filter(r=>!r.pending&&!Number.isFinite(r.usage?.total_tokens)).length,pendingCalls:active.size,usageMissing,incomplete:active.size>0||usageMissing});
  const fetchProvider=async(url,init)=>{
    const body=JSON.parse(init.body),reserve=Buffer.byteLength(JSON.stringify(body.messages),'utf8')+maxOutputTokens;
    if(usageMissing||chargedRequests>=maxCalls||totalTokens+records.filter(r=>r.pending).reduce((n,r)=>n+r.reserve,0)+reserve>maxTotalTokens)throw Error('Bounded real-test budget reached');
    const record={attempt:++chargedRequests,model:body.model,messages:body.messages,reserve,pending:true,startedAt:Date.now()};records.push(record);
    let done;const completion=new Promise(resolve=>{done=resolve;});active.add(completion);
    try {
      const response=await fetchImpl(url,init),parsed=await response.clone().json().catch(()=>undefined);
      record.status=response.status;record.usage=parsed?.usage;record.raw=parsed?.choices?.[0]?.message?.content;record.finish=parsed?.choices?.[0]?.finish_reason;
      if(Number.isFinite(parsed?.usage?.total_tokens))totalTokens+=parsed.usage.total_tokens;else usageMissing=true;
      return response;
    } catch(error) {record.error=error.message;usageMissing=true;throw error;}
    finally {record.pending=false;record.durationMs=Date.now()-record.startedAt;active.delete(completion);done();}
  };
  return {fetchProvider,snapshot,records,async drain(){while(active.size)await Promise.all([...active]);return snapshot();}};
}
