import {test,expect} from '@playwright/test';
test('scan, correct, retry without losing draft, then add next lens',async({page})=>{
 const session={id:'12345678-1234-1234-1234-123456789012',created_at:'2026-11-18T22:30:00Z',completed_at:null};
 let attempts=0;const ids=[];
 await page.route('**/tesseract__js.js*',route=>route.fulfill({contentType:'application/javascript',body:'export async function createWorker(){return {setParameters:async()=>{},recognize:async()=>({data:{text:"MODEL ABX42\\n+18.5 D\\nSN 001234 007",confidence:90}}),terminate:async()=>{}}} export default {createWorker};'}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/lenses')){
   const row=route.request().postDataJSON();ids.push(row.id);attempts++;
   if(attempts===1)return route.fulfill({status:503,json:{error:'Связь прервана'}});
   expect(row.power).toBe(-2.5);expect(row.serial).toBe('001234 007');
   return route.fulfill({json:{...row,scanned_at:'2026-11-18T22:30:00Z'}});
  }
  if(path==='/api/sessions'&&route.request().method()==='POST')return route.fulfill({json:session});
  if(path==='/api/sessions')return route.fulfill({json:{sessions:[],timeZone:'Europe/Moscow'}});
  return route.fulfill({json:{session,rows:[]}});
 });
 await page.goto('/');await page.getByRole('button',{name:'Начать сканирование'}).click();
 await page.locator('input[type=file]').first().setInputFiles({name:'label.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=','base64')});
 await expect(page.getByLabel('Модель линзы',{exact:true})).toHaveValue('ABX42');
 await page.getByLabel('Оптическая сила, D',{exact:true}).fill('-2,5');
 // Values read without locating the label are flagged; adding requires explicit confirmation.
 await page.getByRole('button',{name:'Добавить',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Сверьте выделенные поля');
 await page.getByLabel('Выделенные поля сверены с этикеткой').check();
 await page.getByRole('button',{name:'Добавить',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Связь прервана');
 await expect(page.getByLabel('Серийный номер (SN)')).toHaveValue('001234 007');
 await page.getByRole('button',{name:'Добавить',exact:true}).click();
 await expect(page.getByText('SN 001234 007',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Сфотографируйте этикетку'})).toBeVisible();
 expect(ids[0]).toBe(ids[1]);
});
test('resume session, export, and display saved values',async({page})=>{
 const session={id:'12345678-1234-1234-1234-123456789012',created_at:'2026-11-18T22:30:00Z',completed_at:null};
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/complete')){session.completed_at=new Date().toISOString();return route.fulfill({json:{ok:true}});}
  if(url.pathname.endsWith('/excel'))return route.fulfill({status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:'test-download'});
  if(url.pathname==='/api/sessions')return route.fulfill({json:{timeZone:'Europe/Moscow',sessions:[session]}});
  return route.fulfill({json:{session,rows:[{id:'lens-1',model:'ABX42',power:-2.5,serial:'001234 007',scanned_at:'2026-11-18T22:30:00Z'}]}});
 });
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Каждая линза на учёте.'})).toBeVisible();
 await page.getByRole('button',{name:/Сессия от/}).click();
 await expect(page.getByText('SN 001234 007')).toBeVisible();
 await expect(page.getByText('-2.5 D',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Камера',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Завершить и скачать Excel'}).click();
 await expect(page.getByRole('heading',{name:'Реестр готов'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Сохранить готовый файл .xlsx'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
const session0=()=>({id:'12345678-1234-1234-1234-123456789012',created_at:'2026-11-18T22:30:00Z',completed_at:null});
const OCR_STUB='export async function createWorker(){return {setParameters:async()=>{},recognize:async()=>({data:{text:"MODEL ABX42\\n+18.5 D\\nSN 001234 007",confidence:90}}),terminate:async()=>{}}} export default {createWorker};';
test('camera button shoots in-app through getUserMedia, not the file picker',async({page})=>{
 const session=session0();
 // A canvas stream stands in for the phone camera.
 await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const x=c.getContext('2d');const draw=()=>{x.fillStyle='#fff';x.fillRect(0,0,1280,720);x.fillStyle='#000';x.fillText('SN 001234 007',100,100);requestAnimationFrame(draw);};draw();return c.captureStream(30);};});
 await page.route('**/tesseract__js.js*',route=>route.fulfill({contentType:'application/javascript',body:OCR_STUB}));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/sessions'&&route.request().method()==='POST')return route.fulfill({json:session});if(path==='/api/sessions')return route.fulfill({json:{sessions:[],timeZone:'Europe/Moscow'}});return route.fulfill({json:{session,rows:[]}});});
 let chooser=false;page.on('filechooser',()=>{chooser=true;});
 await page.goto('/');await page.getByRole('button',{name:'Начать сканирование'}).click();
 await page.getByRole('button',{name:'Камера',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Съёмка этикетки'})).toBeVisible();
 await page.getByRole('button',{name:'Снять'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByLabel('Серийный номер (SN)')).toHaveValue('001234 007');
 expect(chooser).toBe(false);
});
test('camera refusal offers the gallery instead of a dead end',async({page})=>{
 const session=session0();
 await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/sessions'&&route.request().method()==='POST')return route.fulfill({json:session});if(path==='/api/sessions')return route.fulfill({json:{sessions:[],timeZone:'Europe/Moscow'}});return route.fulfill({json:{session,rows:[]}});});
 await page.goto('/');await page.getByRole('button',{name:'Начать сканирование'}).click();
 await page.getByRole('button',{name:'Камера',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('Нет доступа к камере');
 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('dialog').getByRole('button',{name:'Из галереи'}).click();
 await chooser;
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('inside Telegram the Excel goes through the native downloader or to the chat',async({page})=>{
 const session=session0();const calls=[];
 await page.route('**/telegram-web-app.js',route=>route.fulfill({contentType:'application/javascript',body:'window.Telegram={WebApp:{initData:"query_id=1&hash=x",ready(){},expand(){},isVersionAtLeast:v=>Number(v)<=8,downloadFile(p,cb){window.__download=p;cb&&cb(true);},HapticFeedback:{notificationOccurred(){}},enableClosingConfirmation(){},disableClosingConfirmation(){}}};'}));
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());calls.push(url.pathname);
  if(url.pathname.endsWith('/complete')){session.completed_at=new Date().toISOString();return route.fulfill({json:{ok:true}});}
  if(url.pathname.endsWith('/excel-link'))return route.fulfill({json:{path:'/api/download/abc.def',fileName:'rescan-12345678.xlsx'}});
  if(url.pathname.endsWith('/excel-to-chat'))return route.fulfill({json:{ok:true}});
  if(url.pathname==='/api/sessions')return route.fulfill({json:{timeZone:'Europe/Moscow',sessions:[session]}});
  return route.fulfill({json:{session,rows:[{id:'lens-1',model:'ABX42',power:-2.5,serial:'001234 007',scanned_at:'2026-11-18T22:30:00Z'}]}});
 });
 await page.goto('/');await page.getByRole('button',{name:/Сессия от/}).click();
 await page.getByRole('button',{name:'Завершить и скачать Excel'}).click();
 await expect(page.getByRole('status')).toContainText('Telegram скачивает файл');
 const requested=await page.evaluate(()=>window.__download);
 expect(requested.file_name).toBe('rescan-12345678.xlsx');
 expect(new URL(requested.url).pathname).toBe('/api/download/abc.def');
 // The blob link only exists in a plain browser; in Telegram it would be a dead link.
 await expect(page.getByRole('link',{name:'Сохранить готовый файл .xlsx'})).toHaveCount(0);
 await page.getByRole('button',{name:'Отправить Excel в чат'}).click();
 await expect(page.getByRole('status')).toContainText('отправлен в чат');
 expect(calls.filter(p=>p.endsWith('/excel'))).toHaveLength(0);
});
test('configuration failure is visible and does not pretend to save',async({page})=>{
 await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Supabase ещё не настроен'}}));
 await page.goto('/');await expect(page.getByRole('alert')).toContainText('Supabase ещё не настроен');
 await page.getByRole('button',{name:'Начать сканирование'}).click();
 await expect(page.getByRole('heading',{name:'Каждая линза на учёте.'})).toBeVisible();
});
