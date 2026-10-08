import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';

/** Explicit real-test bridge. Never stores the provider secret or logs headers. */
export async function startLiveTestProxy({apiKey,maxCalls=8,maxTokens=500,fetchProvider=fetch}) {
  if(!apiKey||!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>12||!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>500)throw Error('Invalid explicit live-test budget');
  let secret=apiKey,count=0;
  const token=randomUUID(),observations=[];
  const server=createServer(async(request,response)=>{
    response.setHeader('Access-Control-Allow-Origin','*');
    response.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
    if(request.method==='OPTIONS'){response.writeHead(204);response.end();return;}
    if(request.method!=='POST'||request.url!=='/chat/completions'||request.headers.authorization!=='Bearer '+token){response.writeHead(403);response.end('{}');return;}
    let attempt;
    const startedAt=Date.now();
    try {
      const chunks=[];let bytes=0;
      for await(const chunk of request){bytes+=chunk.length;if(bytes>128000)throw Error('Oversized live-test request');chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString());
      if(body.model!=='deepseek-flash'||!Array.isArray(body.messages)||JSON.stringify(body.messages).length>26000)throw Error('Invalid bounded model payload');
      // Check after reading/parsing: parallel requests cannot all pass a stale count.
      if(!secret||count>=maxCalls){response.writeHead(429);response.end('{}');return;}
      attempt=++count;
      body.stream=false;delete body.stream_options;body.max_tokens=maxTokens;
      const upstream=await fetchProvider('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
      const raw=await upstream.text();let parsed;
      try{parsed=JSON.parse(raw);}catch{}
      observations.push({attempt,status:upstream.status,startedAt,durationMs:Date.now()-startedAt,usage:parsed?.usage,finish:parsed?.choices?.[0]?.finish_reason});
      response.writeHead(upstream.status,{'Content-Type':'application/json'});response.end(raw);
    }catch{
      if(attempt)observations.push({attempt,status:502,startedAt,durationMs:Date.now()-startedAt});
      response.writeHead(502,{'Content-Type':'application/json'});response.end('{"error":{"message":"bounded live-test transport failed"}}');
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:'http://127.0.0.1:'+server.address().port+'/chat/completions',token,
    getObservations:()=>observations.map(row=>({...row})),
    close:async()=>{secret='';await new Promise(resolve=>server.close(resolve));}};
}
