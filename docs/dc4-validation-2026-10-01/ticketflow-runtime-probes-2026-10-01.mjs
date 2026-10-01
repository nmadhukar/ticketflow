// Throwaway runtime acceptance probes; executed only inside node:20-slim on the compose network.
const base = 'http://app:5000';
const headers = { 'content-type': 'application/json' };
const rows = [];
let admin, customer, staff, second, task, team, article, guideCategory, guide;
async function call(method, path, body, actor) {
  try {
    const r = await fetch(base + path, { method, headers: { ...headers, ...(actor?.cookie ? {cookie:actor.cookie} : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let data;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 160); }
    return { status:r.status, data, cookie:r.headers.get('set-cookie')?.split(';')[0], headers:Object.fromEntries(r.headers) };
  } catch(e) { return {status:0, data:String(e)}; }
}
function record(id, r, expected, detail='') {
 const pass=typeof expected==='function' ? expected(r) : r.status===expected;
 const evidence=`${r.status} ${JSON.stringify(r.data).slice(0,200)}${detail ? ' '+detail : ''}`;
 rows.push({id, result:pass?'RUNTIME-VERIFIED':'RUNTIME-FAILED', evidence});
 console.log(`${id} ${pass?'VERIFIED':'FAILED'} ${evidence}`);
 return pass;
}
const unique='phase2-'+Date.now();
const login=async(email,password)=>{const r=await call('POST','/api/auth/login',{email,password});return {...r, email};};
const run=async()=>{
 admin=await login('admin@ticketflow.local','Admin123!'); record('A2',admin,r=>r.status===200&&!!r.cookie&&r.data.role==='admin');
 record('A3',await call('POST','/api/auth/login',{email:admin.email,password:'bad'}),401);
 record('Y1',await call('GET','/api/tasks'),401);
 for(const path of ['/api/teams','/api/admin/users','/api/knowledge/search']) record('Y1',await call('GET',path),401,path);
 record('Y8',await call('GET','/api/security/health'),r=>r.status===200&&!!r.headers['x-frame-options']&&!!r.headers['content-security-policy']);
 const who=await call('GET','/api/auth/user',undefined,admin);record('A2',who,r=>r.status===200&&r.data.id===admin.data.id,'cookie reread');
 record('Y9',admin,r=>r.cookie?.startsWith('connect.sid=')===true,'session cookie issued; attributes inspected separately');
 const fresh=await call('POST','/api/auth/register',{email:unique+'@example.test',password:'SafePass123!',firstName:'New',lastName:'Customer'});record('A1',fresh,r=>r.status===201&&r.data.user?.isApproved===false);
 record('A1',await login(unique+'@example.test','SafePass123!'),r=>r.status===401&&/pending/i.test(r.data.message),'pending login');
 record('A1',await call('POST','/api/auth/register',{email:unique+'@example.test',password:'SafePass123!',firstName:'New',lastName:'Customer'}),400,'duplicate');
 customer={data:fresh.data.user,email:unique+'@example.test'};
 record('S1',await call('POST',`/api/admin/users/${customer.data.id}/approve`,undefined,admin),200,'approve customer');
 customer=await login(customer.email,'SafePass123!');
 record('Y3',await call('GET','/api/admin/users',undefined,customer),403);
 record('D3',await call('GET','/api/admin/stats',undefined,admin),200);
 record('D3',await call('GET','/api/admin/stats',undefined,customer),403);
 const staffSignup=await call('POST','/api/auth/register',{email:unique+'-staff@example.test',password:'SafePass123!',firstName:'Staff',lastName:'User'});
 staff={data:staffSignup.data.user,email:unique+'-staff@example.test'};
 record('A7',await call('PATCH',`/api/admin/users/${staff.data.id}`,{role:'user',isApproved:true},admin),200);
 staff=await login(staff.email,'SafePass123!');record('A7',staff,r=>r.status===200&&r.data.role==='user');
 second=await call('POST','/api/auth/register',{email:unique+'-other@example.test',password:'SafePass123!',firstName:'Other',lastName:'Customer'});
 await call('POST',`/api/admin/users/${second.data.user.id}/approve`,undefined,admin);
 second=await login(unique+'-other@example.test','SafePass123!');
 const payload={title:'Early '+unique,description:'Description entered once '+unique,category:'bug',priority:'high',tags:['early'],estimatedHours:3,dueDate:'2026-10-20T00:00:00.000Z'};
 let first=await call('POST','/api/tasks',payload,customer);
 record('T1',first,r=>r.status===201&&/^TKT-\d{4}-\d{4}$/.test(r.data.ticketNumber||''),'documented create');
 if(first.status!==201) first=await call('POST','/api/tasks',{...payload,ticketNumber:'ignored-by-storage'},customer);
 record('T1-workaround',first,r=>r.status===201&&r.data.createdBy===customer.data.id&&r.data.status==='open');
 task=first.data;
 if(!task.id) return;
 record('T2',await call('POST','/api/tasks',{...payload,ticketNumber:'ignored-by-storage',title:''},customer),400,'invalid empty title');
 record('T4',await call('GET','/api/tasks/nan',undefined,admin),400);
 record('T4',await call('GET','/api/tasks/9999999',undefined,admin),404);
 record('T4',await call('GET',`/api/tasks/${task.id}`,undefined,customer),r=>r.status===200&&r.data.id===task.id);
 record('T5',await call('GET','/api/tasks',undefined,customer),r=>r.status===200&&Array.isArray(r.data)&&r.data.some(t=>t.id===task.id));
 for(const [name,query] of [['status','status=open'],['category','category=bug'],['search','search='+encodeURIComponent(unique)]]) record(name==='search'?'T7':'T6',await call('GET','/api/tasks?'+query,undefined,admin),r=>r.status===200&&r.data.some(t=>t.id===task.id));
 record('T7',await call('GET','/api/tasks?search=impossible-phrase-'+unique,undefined,admin),r=>r.status===200&&r.data.length===0);
 record('T8',await call('GET','/api/tasks?limit=2&offset=0',undefined,admin),r=>r.status===200&&r.data.length<=2);
 record('T9',await call('GET','/api/tasks/my',undefined,admin),r=>r.status===200&&Array.isArray(r.data));
 record('Y2',await call('GET',`/api/tasks/${task.id}`,undefined,second),403,'cross-customer GET');
 record('Y2',await call('PATCH',`/api/tasks/${task.id}`,{priority:'urgent'},second),403,'cross-customer PATCH');
 record('Y2',await call('POST',`/api/tasks/${task.id}/comments`,{content:'cross'},second),403,'cross-customer comment');
 record('Y4',await call('GET',`/api/tasks/${task.id}`,undefined,staff),403,'unrelated staff direct-ID');
 record('T10',await call('PATCH',`/api/tasks/${task.id}`,{priority:'urgent'},admin),r=>r.status===200&&r.data.priority==='urgent');
 record('T10',await call('PATCH',`/api/tasks/${task.id}`,{priority:'not-valid'},admin),400,'invalid priority');
 record('T11',await call('PATCH',`/api/tasks/${task.id}`,{assigneeId:staff.data.id},admin),r=>r.status===200&&r.data.assigneeId===staff.data.id);
 record('T9',await call('GET','/api/tasks/my',undefined,staff),r=>r.status===200&&r.data.some(t=>t.id===task.id));
 record('T14',await call('POST',`/api/tasks/${task.id}/comments`,{content:'Followup '+unique},staff),201);
 record('T14',await call('GET',`/api/tasks/${task.id}/comments`,undefined,staff),r=>r.status===200&&r.data.some(c=>c.content==='Followup '+unique));
 record('T14',await call('POST',`/api/tasks/${task.id}/comments`,{content:''},staff),400,'empty comment');
 for(const status of ['in_progress','on_hold','resolved','closed','open']) {
  const changed=await call('PATCH',`/api/tasks/${task.id}`,{status},staff);
  record('T12-'+status,changed,r=>r.status===200&&r.data.status===status&&r.data.description===payload.description&&r.data.tags?.[0]==='early');
  if(status==='resolved')record('T12-resolvedAt',changed,r=>r.status===200&&!!r.data.resolvedAt);
  if(status==='closed')record('T12-closedAt',changed,r=>r.status===200&&!!r.data.closedAt);
 }
 record('T12',await call('PATCH',`/api/tasks/${task.id}`,{status:'invalid'},staff),400,'invalid stage');
 record('T18',await call('GET',`/api/tasks/${task.id}`,undefined,customer),r=>r.status===200&&r.data.estimatedHours===3&&r.data.tags?.[0]==='early'&&r.data.dueDate?.startsWith('2026-10-20'));
 record('T17',await call('GET',`/api/tasks/${task.id}/history`,undefined,admin),r=>r.status===200&&Array.isArray(r.data),'ticket-specific audit');
 record('D2',await call('GET','/api/activity?limit=5',undefined,admin),r=>r.status===200&&Array.isArray(r.data)&&r.data.length<=5);
 record('D1',await call('GET','/api/stats',undefined,admin),200);
 record('I1',await call('GET',`/api/tasks/${task.id}/auto-response`,undefined,admin),200,'AI fallback read');
 record('I6',await call('GET','/api/admin/ai-settings',undefined,admin),200);
 record('I7',await call('GET','/api/analytics/ai-performance',undefined,admin),200);
 record('I7',await call('GET','/api/bedrock/usage/summary',undefined,admin),200);
 record('I9',await call('GET','/api/admin/learning-queue/status',undefined,admin),200);
 record('K8',await call('POST','/api/s3/presigned-url',{fileName:'probe.pdf',fileType:'application/pdf'}),401);
 record('K1',await call('GET','/api/admin/knowledge',undefined,customer),403);
 record('K1',await call('GET','/api/admin/knowledge',undefined,admin),200);
 record('K3',await call('GET','/api/knowledge/search?query=missing',undefined,admin),200);
 record('K7',await call('GET','/api/guide-categories',undefined,admin),200);
 record('K7',await call('GET','/api/guides',undefined,admin),200);
 record('E2',await call('GET','/api/email-templates',undefined,admin),200);
 record('G1',await call('POST','/api/teams',{name:'Staff team '+unique,description:'staff should be refused'},staff),403);
 record('G5',await call('GET','/api/departments',undefined,staff),200);
 record('S1',await call('GET','/api/admin/users',undefined,admin),200);
 record('S2',await call('GET','/api/company-settings',undefined,admin),200);
 record('S5',await call('GET','/api/faq-cache',undefined,admin),200);
 record('A9',await call('GET','/api/sso/status',undefined,admin),200);
 record('S6',await call('GET','/api/sso/config',undefined,admin),200);
 record('T16',await call('DELETE',`/api/tasks/${task.id}`,undefined,customer),403,'customer delete');
 record('T16',await call('DELETE',`/api/tasks/${task.id}`,undefined,staff),403,'staff delete should be forbidden');
 record('P2',await call('GET','/api-docs',undefined,admin),r=>r.status===200&&String(r.data).includes('html'),'UI route HTML');
 record('E5',await call('GET','/notifications',undefined,admin),r=>r.status===200&&String(r.data).includes('html'),'UI route HTML');
 const gone=await call('POST','/api/auth/logout',undefined,customer);
 record('A4',gone,200); record('A4',await call('GET','/api/auth/user',undefined,customer),401,'old cookie');
};
try { await run(); } catch(e) { console.error('Probe error',e); process.exitCode=1; }
const counts=rows.reduce((r,row)=>(r[row.result]=(r[row.result]||0)+1,r),{});
console.log('PROBE_COUNTS',JSON.stringify(counts));
console.log('PROBE_ROWS',JSON.stringify(rows));
