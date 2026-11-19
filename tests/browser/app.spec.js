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
test('configuration failure is visible and does not pretend to save',async({page})=>{
 await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Supabase ещё не настроен'}}));
 await page.goto('/');await expect(page.getByRole('alert')).toContainText('Supabase ещё не настроен');
 await page.getByRole('button',{name:'Начать сканирование'}).click();
 await expect(page.getByRole('heading',{name:'Каждая линза на учёте.'})).toBeVisible();
});
