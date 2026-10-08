import assert from 'node:assert/strict';
import {startLiveTestProxy} from './live-test-proxy.mjs';
let providerCalls=0;
const proxy=await startLiveTestProxy({apiKey:'isolated-fixture-key',maxCalls:1,fetchProvider:async(_url,init)=>{providerCalls++;assert.equal(JSON.parse(init.body).max_tokens,500);assert.equal(JSON.parse(init.body).stream,false);return new Response(JSON.stringify({usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12},choices:[{message:{content:'测试'},finish_reason:'stop'}]}));}});
try {
  const send=(model='deepseek-flash',token=proxy.token)=>fetch(proxy.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({model,messages:[{role:'user',content:'synthetic fixture'}],max_tokens:9999,stream:true})});
  assert.equal((await send('other-model')).status,502);assert.equal(providerCalls,0);
  assert.equal((await send('deepseek-flash','wrong-local-token')).status,403);assert.equal(providerCalls,0);
  const results=await Promise.all([send(),send(),send()]);
  assert.equal(results.filter(row=>row.status===200).length,1);assert.equal(results.filter(row=>row.status===429).length,2);assert.equal(providerCalls,1);
  const observations=proxy.getObservations();assert.equal(observations.length,1);assert.equal(observations[0].usage.total_tokens,12);assert.ok(!JSON.stringify(observations).includes('isolated-fixture-key'));
  console.log('PASS live-test-proxy: real concurrent budget enforcement, model/output limits and secret-free usage; zero paid calls');
}finally{await proxy.close();}
