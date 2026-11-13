const { chromium } = require('playwright');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname,'..');
const mock = `
export const getDatabase=()=>({});
export const ref=(_,path)=>({path});
export const query=(ref,...constraints)=>({...ref,limit:constraints.find(x=>x.limit)?.limit});
export const orderByChild=key=>({order:key});
export const limitToLast=limit=>({limit});
export const push=()=>({key:'test-revision'});
export const serverTimestamp=()=>Date.now();
export const set=async()=>{};
window.events={};window.writes=[];window.listeners=[];
const config={temperatura_min:22,temperatura_max:28,umidade_min:0,umidade_max:100,alerta_temperatura:true,alerta_umidade:false,alerta_movimento:false};
function emit(listener){
 let value=null;
 if(listener.path.endsWith('/configuracao')) value=config;
 else if(listener.path.endsWith('/telemetria')) value={temperatura:25,umidade:50,movimento:0};
 else if(listener.path.endsWith('/ocorrencias')) value=Object.fromEntries(Object.entries(window.events).sort((a,b)=>a[1].inicio_em-b[1].inicio_em).slice(-listener.limit));
 else value=window.events[listener.path.split('/').pop()]||null;
 listener.cb({val:()=>value});
}
window.publish=()=>window.listeners.slice().forEach(emit);
window.denyRead=()=>window.listeners.filter(x=>x.path.endsWith('/ocorrencias')).forEach(x=>x.error(new Error('permission_denied')));
export function onValue(source,cb,error){const listener={...source,cb,error};window.listeners.push(listener);queueMicrotask(()=>emit(listener));return ()=>{window.listeners=window.listeners.filter(x=>x!==listener)}}
export async function update(source,value){
 window.writes.push({path:source.path,value});
 if(window.rejectSave) throw new Error('permission_denied');
 const id=source.path.split('/').at(-2);
 window.events[id].acompanhamento={...window.events[id].acompanhamento,...value};
 window.publish();
}
`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');
  try{res.end(fs.readFileSync(file))}catch{res.writeHead(404);res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  await page.addInitScript(() => {Date.now=()=>Date.parse('2026-11-13T16:00:00Z')});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://www.gstatic.com/firebasejs/**',route=>route.fulfill({contentType:'text/javascript',body:route.request().url().includes('firebase-app')?'export const initializeApp=()=>({});':mock}));
  await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:'window.Chart=class{constructor(el,c){this.data=c.data}update(){}}'}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>document.getElementById('occurrenceMessage').textContent.includes('Nenhuma ocorrência registrada'));
  assert.equal(await page.evaluate(()=>window.writes.length),0);
  await page.evaluate(()=>{
   const start=Date.parse('2026-11-13T15:00:00Z');
   window.events={
    a:{tipo:'temperatura_alta',estado:'em_andamento',inicio_em:start,ultima_atualizacao_em:start+120000,dispositivo:'<img src=x onerror=alert(1)>',box:'Box 01',leitura_inicial:{temperatura:30,umidade:50,movimento:0},ultima_leitura:{temperatura:31},regra:{min:22,max:28},configuracao_revisao:'r1'},
    b:{tipo:'umidade_baixa',estado:'encerrada',inicio_em:start-86400000,fim_em:start-86400000+300000,ultima_atualizacao_em:start-86400000+300000,leitura_inicial:{umidade:20},leitura_final:{umidade:45},regra:{min:40,max:60},motivo_encerramento:'Retorno à faixa'},
    c:{tipo:'movimento',estado:'interrompida',inicio_em:start-172800000,ultima_atualizacao_em:start-172800000+1000,regra:{ativa:true}}
   };window.publish();
  });
  assert.equal(await page.locator('.occurrence-item').count(),3);
  assert.match(await page.locator('#occurrenceCount').innerText(),/1 em andamento/);
  assert.match(await page.locator('#occurrenceList').innerText(),/Sem atualização recente/);
  await page.selectOption('#occurrenceType','umidade');
  assert.equal(await page.locator('.occurrence-item').count(),1);
  await page.locator('#occurrenceList button').click();
  await page.waitForFunction(()=>document.getElementById('occurrenceDetails').textContent.includes('5min'));
  assert.match(await page.locator('#occurrenceDetails').innerText(),/40 a 60 %/);
  await page.locator('#closeOccurrenceDialog').click();
  await page.locator('#clearOccurrenceFilters').click();
  await page.selectOption('#occurrenceState','em_andamento');
  await page.locator('#occurrenceList button').click();
  await page.waitForFunction(()=>!document.getElementById('occurrenceReviewFields').disabled);
  assert.match(await page.locator('#occurrenceDetails').innerText(),/2min/);
  assert.equal(await page.locator('#occurrenceDetails tr').count(),9);
  assert.deepEqual(await page.locator('#occurrenceDetails th').allTextContents(),['Tipo de ocorrência','Local','Data e hora de início','Temperatura inicial','Regra aplicada','Situação','Data e hora de encerramento','Duração','Identificação do dispositivo']);
  assert.match(await page.locator('#occurrenceDetails').innerText(),/30.0 °C/);
  assert.match(await page.locator('#occurrenceDetails').innerText(),/Ainda não confirmado/);
  assert.equal(await page.locator('#occurrenceDetails img').count(),0);
  await page.locator('#occurrenceNotes').fill('Animal acompanhado pela equipe.');
  await page.evaluate(()=>{window.events.a.ultima_leitura={temperatura:32};window.publish()});
  assert.equal(await page.locator('#occurrenceNotes').inputValue(),'Animal acompanhado pela equipe.');
  await page.locator('#occurrenceReviewed').check();
  await page.locator('#occurrenceReviewForm button').click();
  await page.waitForFunction(()=>document.getElementById('occurrenceReviewMessage').textContent.includes('salvo no Firebase'));
  assert.equal(await page.evaluate(()=>window.events.a.estado),'em_andamento');
  assert.deepEqual(await page.evaluate(()=>Object.keys(window.writes[0].value).sort()),['atualizado_em','observacao','revisada']);
  assert.equal(await page.evaluate(()=>window.writes[0].path),'vetrecovery/box01/ocorrencias/a/acompanhamento');
  await page.locator('#closeOccurrenceDialog').click();
  await page.locator('#occurrenceList button').click();
  await page.waitForFunction(()=>document.getElementById('occurrenceNotes').value==='Animal acompanhado pela equipe.');
  await page.evaluate(()=>{window.rejectSave=true});
  await page.locator('#occurrenceNotes').fill('Rascunho preservado');
  await page.locator('#occurrenceReviewForm button').click();
  await page.waitForFunction(()=>document.getElementById('occurrenceReviewMessage').textContent.includes('Não foi possível salvar'));
  assert.equal(await page.locator('#occurrenceNotes').inputValue(),'Rascunho preservado');
  assert.equal(await page.evaluate(()=>window.events.a.acompanhamento.observacao),'Animal acompanhado pela equipe.');
  await page.keyboard.press('Escape');
  await page.locator('#clearOccurrenceFilters').click();
  await page.locator('#occurrenceFrom').fill('2026-11-13');
  await page.locator('#occurrenceTo').fill('2026-11-13');
  await page.locator('#occurrenceTo').blur();
  assert.equal(await page.locator('.occurrence-item').count(),1);
  await page.locator('#occurrenceFrom').fill('2026-11-14');await page.locator('#occurrenceFrom').blur();
  assert.match(await page.locator('#occurrenceMessage').innerText(),/não pode ser posterior/);
  await page.locator('#clearOccurrenceFilters').click();
  const screenshots=fs.mkdtempSync(path.join(os.tmpdir(),'vetrecovery-occurrences-'));
  await page.locator('#occurrencesTitle').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(screenshots,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(screenshots,'mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#occurrenceList button').first().click();
  await page.waitForFunction(()=>document.getElementById('occurrenceDetails').textContent.includes('Temperatura'));
  await page.screenshot({path:path.join(screenshots,'details-mobile.png')});
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{for(let i=0;i<60;i++)window.events['extra'+i]={tipo:'movimento',estado:'encerrada',inicio_em:Date.now()+i*1000};window.publish()});
  assert.equal(await page.locator('.occurrence-item').count(),50);
  await page.locator('#loadMoreOccurrences').click();
  await page.waitForFunction(()=>document.querySelectorAll('.occurrence-item').length===63);
  assert.equal(await page.locator('#loadMoreOccurrences').isHidden(),true);
  await page.evaluate(()=>window.denyRead());
  assert.match(await page.locator('#occurrenceMessage').innerText(),/Não foi possível consultar/);
  assert.equal(await page.locator('.occurrence-item').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: estado vazio, filtros, detalhes, duração, dados antigos, revisão e observações, escrita parcial, falha de escrita, preservação de rascunho, Escape, paginação, falha de leitura, XSS e layout mobile. Firebase simulado.');
  console.log('Capturas: '+screenshots);
 }finally{if(browser)await browser.close();server.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
