const { chromium } = require('playwright');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'vetrecovery-test-'));
const root = path.resolve(__dirname, '..');
const databaseMock = `
export const query = (ref) => ref;
export const orderByChild = () => ({});
export const limitToLast = () => ({});
export const update = async () => {};
export const getDatabase = () => ({});
export const ref = (_, path) => ({ path });
export const push = () => ({ key: 'revision-test' });
export const serverTimestamp = () => 123456;
window.config = null;
window.telemetry = {temperatura:25,umidade:50,movimento:0,led:'DESLIGADO',buzzer:'DESLIGADO',dispositivo:'esp32_01'};
const callbacks = {};
window.emitConfig = value => {window.config=value;callbacks.config(value)};
window.emitTelemetry = value => {window.telemetry=value;callbacks.telemetry(value)};
export function onValue(ref, cb, error) {
 if(ref.path.includes('/ocorrencias')) {queueMicrotask(()=>cb({val:()=>null}));return ()=>{}}
 const kind = ref.path.endsWith('configuracao') ? 'config' : 'telemetry';
 callbacks[kind] = value => cb({val:()=>value});
 window['fail_'+kind] = () => error(new Error('permission_denied'));
 queueMicrotask(()=>callbacks[kind](kind==='config'?window.config:window.telemetry));
}
export async function set(ref, value) {
 window.writes = (window.writes||0)+1;
 if(window.rejectSave) { callbacks.config(value); throw new Error('permission_denied'); }
 callbacks.config(value);
 window.config=value;
}
`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');
  try {res.end(fs.readFileSync(file))}catch{res.writeHead(404);res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,channel:"msedge"});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://www.gstatic.com/firebasejs/**', route=>route.fulfill({contentType:'text/javascript',body:route.request().url().includes('firebase-app')?'export const initializeApp=()=>({});':databaseMock}));
  await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:'window.charts={};window.Chart=class {constructor(el,c){this.data=c.data;this.options=c.options;window.charts[el.id]=this} update(){}}'}));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>document.getElementById('settingsFields').disabled===false);
  assert.match(await page.locator('#environmentStatus').innerText(),/Dentro das regras/);
  assert.equal(await page.evaluate(()=>window.charts.motionChart.options.scales.y.min),0);
  assert.equal(await page.evaluate(()=>window.charts.motionChart.options.scales.y.max),1);
  assert.equal(await page.evaluate(()=>window.charts.motionChart.data.datasets[0].stepped),true);
  await page.evaluate(()=>{
    window.emitTelemetry({...window.telemetry,movimento:0,tempo_execucao_ms:1000});
    window.emitTelemetry({...window.telemetry,movimento:1,tempo_execucao_ms:3000});
    window.emitTelemetry({...window.telemetry,movimento:1,tempo_execucao_ms:5000});
    window.emitTelemetry({...window.telemetry,movimento:0,tempo_execucao_ms:7000});
  });
  assert.equal(await page.locator('#motionEventCount').innerText(),'1');
  assert.equal(await page.locator('#motionLastDuration').innerText(),'4 s');
  assert.equal(await page.evaluate(()=>window.charts.motionChart.data.datasets[0].data.at(-1).y),0);

  await page.locator('#temperatura_min').fill('29');
  await page.locator('#saveSettings').click();
  assert.match(await page.locator('#settingsMessage').innerText(),/mínima deve ser menor/);
  assert.equal(await page.evaluate(()=>window.writes||0),0);
  await page.locator('#temperatura_min').fill('22');
  await page.locator('#temperatura_max').fill('24');
  await page.locator('#saveSettings').click();
  await page.waitForFunction(()=>document.getElementById('settingsMessage').textContent.includes('Configurações salvas'));
  assert.match(await page.locator('#alertMessage').innerText(),/Temperatura fora/);
  assert.match(await page.locator('#temperatureRange').innerText(),/24 °C/);
  assert.match(await page.locator('#deviceConfigStatus').innerText(),/aguardando confirmação/);
  await page.evaluate(()=>window.emitTelemetry({...window.telemetry, configuracao_revisao:'revision-test'}));
  assert.match(await page.locator('#deviceConfigStatus').innerText(),/confirmou/);
  await page.locator('#alerta_temperatura').uncheck();
  await page.locator('#alerta_umidade').check();
  await page.locator('#umidade_max').fill('40');
  await page.locator('#alerta_movimento').check();
  await page.locator('#saveSettings').click();
  await page.waitForFunction(()=>!document.getElementById('settingsFields').disabled);
  await page.evaluate(()=>window.emitTelemetry({...window.telemetry,movimento:1}));
  assert.match(await page.locator('#alertMessage').innerText(),/Umidade fora.*Movimento detectado/);
  await page.evaluate(()=>window.emitTelemetry({...window.telemetry,umidade:40,movimento:0}));
  assert.match(await page.locator('#environmentStatus').innerText(),/Dentro das regras/);
  await page.evaluate(()=>window.emitTelemetry({...window.telemetry,temperatura:null}));
  assert.equal(await page.locator('#temperature').innerText(),'-- °C');
  assert.match(await page.locator('#environmentStatus').innerText(),/incompleta/);
  await page.evaluate(()=>{window.rejectSave=true});
  await page.locator('#temperatura_max').fill('30');
  await page.locator('#saveSettings').click();
  await page.waitForFunction(()=>document.getElementById('settingsMessage').textContent.includes('Não foi possível salvar'));
  assert.equal(await page.evaluate(()=>window.config.temperatura_max),24);
  await page.evaluate(()=>{window.rejectSave=false;window.emitConfig(window.config)});
  assert.equal(await page.locator('#temperatura_max').inputValue(),'30'); // mantém rascunho
  await page.locator('#resetSettings').click();
  assert.equal(await page.locator('#temperatura_max').inputValue(),'28');
  assert.equal(await page.evaluate(()=>window.config.temperatura_max),24); // preencher não salva
  await page.locator('#saveSettings').click();
  await page.waitForFunction(()=>!document.getElementById('settingsFields').disabled);
  await page.evaluate(()=>window.emitTelemetry({...window.telemetry,temperatura:25,umidade:50,movimento:0}));
  await page.screenshot({path:path.join(screenshots,'painel-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(screenshots,'painel-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>window.emitConfig({...window.config,alerta_temperatura:false,alerta_umidade:false,alerta_movimento:false}));
  assert.match(await page.locator('#environmentStatus').innerText(),/desativados/);
  await page.evaluate(()=>window.emitConfig({...window.config,temperatura_min:35,temperatura_max:20}));
  assert.equal(await page.locator('#settingsFields').evaluate(el=>el.disabled),true);
  assert.match(await page.locator('#settingsMessage').innerText(),/inválida/);
  await page.evaluate(()=>window.fail_config());
  assert.equal(await page.locator('#settingsFields').evaluate(el=>el.disabled),true);
  assert.match(await page.locator('#environmentStatus').innerText(),/indisponíveis/);
  assert.deepEqual(errors,[]);
  console.log('PASS: limites inválidos, gravação, regras combinadas, igualdade nos limites, confirmação ESP32, dados ausentes, falha de escrita/leitura, rascunho, padrões e layout mobile. Firebase simulado; nenhuma gravação no banco real.');
 } finally {await browser.close();server.close()}
})().catch(error=>{console.error(error);process.exitCode=1});


