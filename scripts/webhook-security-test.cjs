const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module'),{webcrypto,createHash}=require('node:crypto');
let handler,exists=true,fetchOK=true,status={},appliedCalls=[];
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',MIDTRANS_SERVER_KEY:'fixture-key',MIDTRANS_IS_PRODUCTION:'true'};
const admin={from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:exists?{id:'fixture',user_id:'fixture',order_id:'fixture-order',program:'ners',amount:20000}:null,error:null})}},rpc:async(name,args)=>{appliedCalls.push(args);return {data:{paid:false,hold_email:true},error:null}}};
const source=fs.readFileSync('supabase/functions/midtrans-webhook/index.ts','utf8').replace(/^\s*import[^\n]*\n/,'');
vm.runInNewContext(stripTypeScriptTypes(source),{createClient:()=>admin,Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},crypto:webcrypto,TextEncoder,Response,Request,console,btoa,fetch:async()=>new Response(JSON.stringify(status),{status:fetchOK?200:502})});
const sign=p=>({...p,signature_key:createHash('sha512').update(p.order_id+p.status_code+p.gross_amount+env.MIDTRANS_SERVER_KEY).digest('hex')});
const base={order_id:'fixture-order',status_code:'200',gross_amount:'20000.00'};
async function call(p,method='POST'){const r=await handler(new Request('https://fixture.invalid',{method,body:method==='POST'?typeof p==='string'?p:JSON.stringify(p):undefined}));return {status:r.status,body:await r.json()}}
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name)}
(async()=>{
await test('method restriction',async()=>assert.equal((await call(null,'GET')).status,405));
await test('invalid JSON rejected',async()=>assert.equal((await call('{')).status,400));
await test('missing signature rejected',async()=>assert.equal((await call(base)).status,400));
await test('forged signature rejected',async()=>assert.equal((await call({...base,signature_key:'0'.repeat(128)})).status,401));
await test('unknown order ignored',async()=>{exists=false;assert.equal((await call(sign(base))).body.ignored,true);exists=true});
await test('amount tampering rejected',async()=>assert.equal((await call(sign({...base,gross_amount:'1.00'}))).status,400));
await test('malformed amount rejected',async()=>assert.equal((await call(sign({...base,gross_amount:'2e4'}))).status,400));
await test('gateway failure rejected',async()=>{fetchOK=false;assert.equal((await call(sign(base))).status,502);fetchOK=true});
await test('server order mismatch rejected',async()=>{status={order_id:'other',gross_amount:'20000.00'};assert.equal((await call(sign(base))).status,409)});
await test('server amount mismatch rejected',async()=>{status={order_id:base.order_id,gross_amount:'1.00'};assert.equal((await call(sign(base))).status,409)});
await test('client settlement cannot override server pending',async()=>{status={...base,transaction_status:'pending'};const r=await call(sign({...base,transaction_status:'settlement'}));assert.equal(r.body.paid,false);assert.equal(appliedCalls.at(-1).p_transaction_status,'pending')});
await test('fraud challenge grants no paid entitlement',async()=>{status={...base,transaction_status:'capture',fraud_status:'challenge'};const r=await call(sign(base));assert.equal(r.body.paid,false);assert.equal(appliedCalls.at(-1).p_transaction_status,'unverified_capture')});
await test('verified settlement uses atomic ledger',async()=>{status={...base,transaction_status:'settlement',fraud_status:'accept'};const r=await call(sign(base));assert.equal(r.body.paid,true);assert.equal(appliedCalls.at(-1).p_transaction_status,'settlement')});
console.log(count+' webhook security tests passed; all network calls mocked');
})().catch(e=>{console.error(e);process.exit(1)});


